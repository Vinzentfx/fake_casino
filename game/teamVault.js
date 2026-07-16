"use strict";

/**
 * Team-Tresorkampf — admin event: everyone online is split into team Rot and
 * team Blau; both teams hammer their own vault. The first team to crack its
 * vault (or the one with more damage when time runs out) splits the pot among
 * its members in proportion to their hits.
 *
 * Vault HP scales with team size so uneven teams stay fair. Latecomers are
 * assigned to the smaller team on their first hit (without changing HP).
 */

const chat = require("./chat");

const HIT_MAX = 8, HIT_WINDOW = 1000; // ≤8 hits/s per account
const HP_PER_PLAYER = 180;
const MIN_HP = 350;

const TEAMS = ["red", "blue"];
const LABEL = { red: "🔴 Team Rot", blue: "🔵 Team Blau" };

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
    return results;
  }

  function finish(winner) {
    if (!state) return;
    if (!winner) {
      // Timeout: more damage (as a fraction of max HP) wins; dead tie splits nothing fancy — red/blue by raw damage, else draw.
      const dmg = (t) => (state.teams[t].max - state.teams[t].hp) / state.teams[t].max;
      if (dmg("red") > dmg("blue")) winner = "red";
      else if (dmg("blue") > dmg("red")) winner = "blue";
    }
    if (!winner) {
      chat.announce(io, "⚔️ Tresorkampf vorbei — exakt unentschieden, der Pot bleibt im Tresor!");
      io.emit("vault:end", { draw: true });
      cleanup();
      return;
    }
    const results = payout(winner);
    chat.announce(io, `⚔️ ${LABEL[winner]} gewinnt den Tresorkampf und teilt sich ${state.pot.toLocaleString("de-DE")} 🪙!` + (results[0] ? ` MVP: ${results[0].name} (+${results[0].share.toLocaleString("de-DE")})` : ""));
    io.emit("vault:end", { winner, pot: state.pot, results });
    cleanup();
  }

  function start(pot, seconds) {
    if (state) return { ok: false, error: "Es läuft schon ein Tresorkampf." };
    pot = Math.max(1000, Math.floor(pot) || 500000);
    seconds = Math.max(20, Math.min(300, Math.floor(seconds) || 90));
    const keys = onlineKeys();
    if (keys.length < 2) return { ok: false, error: "Mindestens 2 Spieler müssen online sein." };

    // Shuffle & alternate into two teams.
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
    chat.announce(io, `⚔️ TEAM-TRESORKAMPF! Rot gegen Blau — wer seinen Tresor zuerst knackt, teilt sich ${pot.toLocaleString("de-DE")} 🪙. ${seconds} Sekunden, los!`);
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
    chat.announce(io, "⚔️ Tresorkampf abgebrochen.");
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
      if (!team) { // latecomer → smaller team
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

  return { start, stop, active };
}

module.exports = { setupTeamVault };
