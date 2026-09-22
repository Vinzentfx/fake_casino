"use strict";

/**
 * Team-Tresorkampf, ein Admin-Event: alle, die online sind, werden auf Rot und
 * Blau verteilt, beide Teams hauen auf ihren eigenen Tresor ein. Wer seinen
 * zuerst knackt (oder bei Zeitablauf mehr Schaden gemacht hat), teilt den Topf
 * unter seinen Leuten auf, je nach Anzahl der Treffer.
 *
 * Die Lebenspunkte des Tresors wachsen mit der Teamgröße, ungleiche Teams
 * bleiben also fair. Wer später dazukommt, landet beim ersten Treffer im
 * kleineren Team (ohne dass sich die Lebenspunkte ändern).
 */

const chat = require("./chat");

const HIT_MAX = 8, HIT_WINDOW = 1000; // höchstens 8 Treffer pro Sekunde und Konto
const HP_PER_PLAYER = 180;
const MIN_HP = 350;

const TEAMS = ["red", "blue"];
const LABEL = { red: "Team Rot", blue: "Team Blau" };

function setupTeamVault(io, accounts) {
  let state = null; // { endsAt, pot, teams:{red:{hp,max,members:Set,hits:{}}, blue:{...}}, assign:{key:team} }
  let ticker = null;
  const hitTimes = new Map();

  const onlineKeys = () => {
    const keys = new Set();
    for (const s of io.of("/").sockets.values()) if (s.data && s.data.account) keys.add(s.data.account);
    return Array.from(keys);
  };

  const teamNames = (t) => Array.from(state.teams[t].members).map((k) => { const a = accounts.get(k); return a ? a.name : k; });

  const snapshot = () => state
    ? {
        active: true, endsAt: state.endsAt, pot: state.pot,
        red: { hp: Math.max(0, state.teams.red.hp), max: state.teams.red.max, names: teamNames("red") },
        blue: { hp: Math.max(0, state.teams.blue.hp), max: state.teams.blue.max, names: teamNames("blue") },
      }
    : { active: false };

  function cleanup() { clearInterval(ticker); ticker = null; state = null; hitTimes.clear(); }

  function payout(team) {
    const t = state.teams[team];
    const total = Object.values(t.hits).reduce((a, b) => a + b, 0) || 1;
    const results = [];
    for (const [key, h] of Object.entries(t.hits)) {
      const share = Math.floor((state.pot * h) / total);
      if (share > 0) { accounts.adjustChips(key, share); const a = accounts.get(key); results.push({ name: a ? a.name : key, share, hits: h }); }
    }
    results.sort((a, b) => b.share - a.share);
    // Nur die Trefferliste des Siegerteams traegt Kontoschluessel. Der alte
    // Zugriff auf `state.hits` war immer undefined und warf genau nach der
    // Auszahlung einen Fehler: Chips waren bereits gutgeschrieben, aber das
    // Ende kam nie bei den Clients an und der Tresor blieb scheinbar haengen.
    accounts.meldeStand(io, ...Object.keys(t.hits));
    return results;
  }

  function finish(winner) {
    if (!state) return;
    if (!winner) {
      // Zeit um: mehr Schaden (als Anteil der Lebenspunkte) gewinnt, sonst unentschieden.
      const dmg = (t) => (state.teams[t].max - state.teams[t].hp) / state.teams[t].max;
      if (dmg("red") > dmg("blue")) winner = "red";
      else if (dmg("blue") > dmg("red")) winner = "blue";
    }
    if (!winner) {
      chat.announce(io, "Tresorkampf vorbei, genau unentschieden. Der Topf bleibt im Tresor.");
      io.emit("vault:end", { draw: true });
      cleanup();
      return;
    }
    const results = payout(winner);
    chat.announce(io, `${LABEL[winner]} gewinnt den Tresorkampf und teilt sich ${state.pot.toLocaleString("de-DE")} Chips!` + (results[0] ? ` MVP: ${results[0].name} (+${results[0].share.toLocaleString("de-DE")})` : ""));
    io.emit("vault:end", { winner, pot: state.pot, results });
    cleanup();
  }

  function start(pot, seconds, opts = {}) {
    if (state) return { ok: false, error: "Es läuft schon ein Tresorkampf." };
    pot = Math.max(1000, Math.floor(pot) || 500000);
    seconds = Math.max(20, Math.min(300, Math.floor(seconds) || 90));
    const keys = onlineKeys();
    if (keys.length < 2) return { ok: false, error: "Mindestens 2 Spieler müssen online sein." };

    // Mischen und abwechselnd auf zwei Teams verteilen.
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    const teams = {};
    for (const t of TEAMS) teams[t] = { members: new Set(), hits: {}, hp: 0, max: 0 };
    keys.forEach((k, i) => teams[TEAMS[i % 2]].members.add(k));
    const assign = {};
    for (const t of TEAMS) {
      teams[t].max = teams[t].hp = Math.max(MIN_HP, HP_PER_PLAYER * teams[t].members.size);
      for (const k of teams[t].members) assign[k] = t;
    }

    state = { endsAt: Date.now() + seconds * 1000, pot, teams, assign };
    const prefix = opts.auto ? "Zufälliger " : "";
    chat.announce(io, `${prefix}Tresorkampf! Rot gegen Blau, wer seinen Tresor zuerst knackt, teilt sich ${pot.toLocaleString("de-DE")} Chips. ${seconds} Sekunden, los!`);
    io.emit("vault:start", snapshot());
    ticker = setInterval(() => {
      if (!state) return;
      if (Date.now() >= state.endsAt) return finish(null);
      io.emit("vault:progress", snapshot());
    }, 300);
    return { ok: true };
  }

  function stop() {
    if (!state) return;
    chat.announce(io, "Tresorkampf abgebrochen.");
    io.emit("vault:end", { aborted: true });
    cleanup();
  }
  function active() { return !!state; }

  io.on("connection", (socket) => {
    socket.on("vault:state", (ack) => {
      if (typeof ack !== "function") return;
      const s = snapshot();
      if (s.active && socket.data.account) s.myTeam = state.assign[socket.data.account] || null;
      ack({ ok: true, ...s });
    });

    socket.on("vault:hit", (ack) => {
      const done = (r) => { if (typeof ack === "function") ack(r); };
      if (!state || !socket.data.account) return done({ ok: false });
      const key = socket.data.account, now = Date.now();
      const times = (hitTimes.get(key) || []).filter((t) => now - t < HIT_WINDOW);
      if (times.length >= HIT_MAX) { hitTimes.set(key, times); return done({ ok: false, rate: true }); }
      times.push(now); hitTimes.set(key, times);

      let team = state.assign[key];
      if (!team) { // Nachzügler ins kleinere Team
        team = state.teams.red.members.size <= state.teams.blue.members.size ? "red" : "blue";
        state.assign[key] = team;
        state.teams[team].members.add(key);
      }
      const t = state.teams[team];
      t.hits[key] = (t.hits[key] || 0) + 1;
      t.hp -= 1;
      done({ ok: true, team, myHits: t.hits[key], hp: Math.max(0, t.hp) });
      if (t.hp <= 0) finish(team);
    });
  });

  // `zustand` gibt Restzeit, Topf und beide Mannschaften nach aussen, der Admin-Bildschirm
  // zeigt damit einen Countdown statt nur "laeuft".
  return { start, stop, active, zustand: snapshot };
}

module.exports = { setupTeamVault };
