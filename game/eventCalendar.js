"use strict";

/**
 * Das Wochenend-Derby.
 *
 * Vorher stand hier ein Wochenend-Pokal: jede Runde ein Punkt, nach 30
 * Runden Schluss, dazu ein Gemeinschaftsziel von 30 Runden, das ein
 * einzelner Spieler allein füllte. Dafür gab es rund 92.000 Chips, ohne
 * dass man etwas entscheiden, sehen oder gegen jemanden spielen musste.
 * Es lief nebenher und interessierte niemanden.
 *
 * Jetzt spielen zwei Teams gegeneinander, Freitag 18 Uhr bis Sonntag
 * Mitternacht (Europe/Berlin). Wer am Wochenende die erste Runde spielt,
 * kommt in ein Team; das kleinere bekommt ihn, Clanmitglieder landen
 * zusammen, solange das die Teams nicht schief macht. Jede Runde zählt
 * einen Punkt fürs Team, höchstens 25 am Tag, und der erste an jedem Tag
 * fünf extra. Damit gewinnt nicht, wer am meisten setzt oder am längsten
 * spielt, sondern das Team, dessen Leute an mehr Tagen wiederkommen. Das
 * passt zur Runde, die versetzt spielt: man trägt bei, wann es passt, und
 * sieht beim nächsten Besuch, wohin sich der Balken bewegt hat.
 *
 * Sichtbar wird es dreifach: im Kalender (Tauziehen, beste Spieler beider
 * Teams), in der Welt (Schal und Marke in Teamfarbe am Namen) und im Chat
 * (Start, Führungswechsel, Ergebnis). Das Ergebnis geht über den Feed in
 * die Chronik und damit in die Zeitung vom Montag.
 *
 * Abgerechnet wird beim Wochenwechsel, im Minutentakt geprüft und beim
 * Start nachgeholt. Belohnt wird ab 10 Punkten: Sieger 30.000, Verlierer
 * 10.000, unentschieden beide 20.000, alles durch die Vermögensbremse.
 * Wer zum ersten Mal gewinnt, bekommt den Siegerschal.
 */

const fs = require("fs");
const path = require("path");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "event-calendar.json");
const ZONE = "Europe/Berlin";
const TAGES_DECKEL = 25;       // Punkte aus Runden je Tag und Person
const ANTRITT = 5;             // für die erste Runde an jedem Tag
const MIN_BEITRAG = 10;        // ab hier gibt es eine Belohnung
const LOHN = Object.freeze({ sieg: 30000, niederlage: 10000, remis: 20000 });
/* Wie oft der Chat höchstens einen Führungswechsel ansagt. Ein enges
   Rennen am Sonntagabend wechselt sonst jede Minute. */
const ANSAGE_PAUSE_MS = 30 * 60 * 1000;

/* Die Paarungen, eine je Woche im Wechsel. Rot ist immer das erste Team,
   Blau das zweite: die Farbe ist das, woran man sich in der Welt erkennt,
   der Name ist die Geschichte dazu. Die Farben stehen bewusst fest wie bei
   den Automaten, ein Team darf in keiner Palette anders aussehen. */
const PAARUNGEN = Object.freeze([
  ["Wittekindsberg", "Jakobsberg"],
  ["Nordufer", "Südufer"],
  ["Kaiser", "Fernsehturm"],
  ["Hausberge", "Barkhausen"],
  ["Weser", "Werre"],
  ["Eisbergen", "Veltheim"],
]);
const FARBEN = Object.freeze(["#d9483b", "#3b7bd9"]);

const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function zonedParts(ms) {
  const p = {};
  for (const x of berlinFormat.formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return p;
}

/** Lokale Berliner Uhrzeit robust in UTC umrechnen, auch beim Zeitwechsel. */
function berlinToUtc(y, m, d, hour, minute = 0) {
  const target = Date.UTC(y, m - 1, d, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - shownAsUtc;
  }
  return guess;
}

function scheduleAt(now = Date.now()) {
  const p = zonedParts(now);
  const date = Date.UTC(p.year, p.month - 1, p.day);
  const weekday = new Date(date).getUTCDay();
  const monday = date - ((weekday + 6) % 7) * 86400000;
  const mon = new Date(monday);
  const fri = new Date(monday + 4 * 86400000);
  const nextMon = new Date(monday + 7 * 86400000);
  const startAt = berlinToUtc(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 18);
  const endAt = berlinToUtc(nextMon.getUTCFullYear(), nextMon.getUTCMonth() + 1, nextMon.getUTCDate(), 0);
  const id = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
  return { id, startAt, endAt, active: now >= startAt && now < endAt };
}

/** Welche Paarung in der Woche spielt, deren Montag `id` ist (JJJJ-MM-TT). */
function paarungVon(id) {
  const [y, m, d] = String(id).split("-").map(Number);
  const woche = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86400000));
  const paar = PAARUNGEN[((woche % PAARUNGEN.length) + PAARUNGEN.length) % PAARUNGEN.length];
  return paar.map((name, i) => ({ name, farbe: FARBEN[i] }));
}

/** Der Kalendertag in Berlin, an dem eine Runde zählt. */
function tagVon(ms) {
  const p = zonedParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/* Version 2 ist das Derby. Ein Stand des alten Pokals wird nicht
   übernommen: der hat seine Belohnungen schon während des Wochenendes
   ausgezahlt, da ist nichts mehr offen. */
function emptyState(id, letztes = null) {
  return { version: 2, eventId: id, abgerechnet: false, gestartet: false, punkte: [0, 0], players: {}, fuehrung: -1, letzteAnsage: 0, letztes };
}
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && s.version === 2 && s.players && Array.isArray(s.punkte)) return s;
  } catch {}
  return emptyState(scheduleAt().id);
}

let state = load();
/* Die Welt zeigt das Team am Namen. Ändert es sich, muss sie die Figur neu
   schicken; die Welt hängt sich hier selbst ein (`setAussehen`), nicht
   umgekehrt, sonst bräuchte dieses Modul die ganze Welt. */
let aussehenNeu = () => {};

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(state));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch {}
}

/** Das Team von `key`, solange ein Derby läuft, sonst null. Für die Welt. */
function teamVon(key, jetzt = Date.now()) {
  if (!scheduleAt(jetzt).active || state.eventId !== scheduleAt(jetzt).id) return null;
  const p = state.players[String(key || "").toLowerCase()];
  return p ? p.team : null;
}

function setupEventCalendar(io, accounts, opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const name = (key) => { const a = accounts.get(key); return a ? a.name : key; };

  function ansagen(text) {
    try { chat.announce(io, text); } catch {}
  }

  /** Zahlt aus, was das vergangene Derby schuldet. Genau einmal. */
  function abrechnen() {
    if (state.abgerechnet) return;
    state.abgerechnet = true;
    const teams = paarungVon(state.eventId);
    const [a, b] = state.punkte;
    const sieger = a === b ? -1 : a > b ? 0 : 1;
    const teilnehmer = Object.entries(state.players);
    let belohnt = 0;
    for (const [key, p] of teilnehmer) {
      const acc = accounts.get(key);
      if (!acc) continue;
      acc.derby = acc.derby || { teilnahmen: 0, siege: 0 };
      acc.derby.teilnahmen += 1;
      if (p.punkte < MIN_BEITRAG) continue;
      const art = sieger === -1 ? "remis" : p.team === sieger ? "sieg" : "niederlage";
      const betrag = Math.max(1, Math.round(LOHN[art] * accounts.faucetFactor(key)));
      const res = accounts.adjustChips(key, betrag);
      if (!res || !res.ok) continue;
      belohnt += 1;
      let schal = false;
      if (art === "sieg") {
        acc.derby.siege += 1;
        try { schal = require("./cosmetics").grant(acc, "accessoire", "siegerschal", key); } catch {}
      }
      p.lohn = { art, betrag, schal };
      for (const socket of socketsFor(key)) socket.emit("eventcalendar:reward", { kind: "derby", art, betrag, schal, team: teams[p.team].name });
    }
    accounts.save();
    accounts.meldeStand(io, ...teilnehmer.map(([k]) => k));
    const text = !teilnehmer.length ? null
      : sieger === -1 ? `Das Wochenend-Derby endet unentschieden, ${a} zu ${b} zwischen ${teams[0].name} und ${teams[1].name}.`
      : `${teams[sieger].name} gewinnt das Wochenend-Derby gegen ${teams[1 - sieger].name}, ${Math.max(a, b)} zu ${Math.min(a, b)}.`;
    if (text) {
      ansagen(text + (belohnt ? ` ${belohnt} ${belohnt === 1 ? "Spieler bekommt" : "Spieler bekommen"} ihre Belohnung.` : ""));
      try { require("./feed").add("event", text); } catch {}
    }
    state.letztes = teilnehmer.length ? {
      eventId: state.eventId, teams, punkte: [a, b], sieger,
      beste: [0, 1].map((t) => besteVon(t, 3)),
      lohn: Object.fromEntries(teilnehmer.filter(([, p]) => p.lohn).map(([k, p]) => [k, p.lohn])),
    } : state.letztes;
    save();
    for (const [key] of teilnehmer) aussehenNeu(key);
  }

  /* Die Woche wechseln. Vorher wird abgerechnet, sonst wäre der Stand des
     Wochenendes mit dem Zurücksetzen einfach weg. */
  function ensureWeek() {
    const schedule = scheduleAt(now());
    if (state.eventId !== schedule.id) {
      abrechnen();
      state = emptyState(schedule.id, state.letztes || null);
      save();
    }
    if (schedule.active && !state.gestartet) {
      state.gestartet = true;
      save();
      const t = paarungVon(state.eventId);
      ansagen(`Das Wochenend-Derby beginnt: ${t[0].name} gegen ${t[1].name}. Jede Runde zählt für dein Team, bis Sonntag Mitternacht.`);
    }
    return schedule;
  }

  function besteVon(team, n) {
    return Object.entries(state.players)
      .filter(([, p]) => p.team === team && p.punkte > 0)
      .sort((x, y) => y[1].punkte - x[1].punkte || x[1].seit - y[1].seit)
      .slice(0, n)
      .map(([key, p]) => ({ name: name(key), punkte: p.punkte }));
  }

  /* In welches Team jemand kommt. Das kleinere bekommt ihn; Clanmitglieder
     spielen zusammen, solange die Teams danach höchstens zwei auseinander
     liegen. Bei Gleichstand entscheidet ein fester Zufall aus Schlüssel und
     Woche, damit nicht immer der Erste eines Wochenendes bei Rot landet. */
  function teamFuer(key) {
    const groesse = [0, 0];
    for (const p of Object.values(state.players)) groesse[p.team] += 1;
    const clan = (accounts.get(key) || {}).clan;
    if (clan) {
      const im = [0, 0];
      for (const [k, p] of Object.entries(state.players)) if ((accounts.get(k) || {}).clan === clan) im[p.team] += 1;
      if (im[0] !== im[1]) {
        const t = im[0] > im[1] ? 0 : 1;
        if (groesse[t] + 1 - groesse[1 - t] <= 2) return t;
      }
    }
    if (groesse[0] !== groesse[1]) return groesse[0] < groesse[1] ? 0 : 1;
    let h = 0;
    for (const c of key + state.eventId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 2;
  }

  function publicState(key) {
    const schedule = ensureWeek();
    const teams = paarungVon(state.eventId);
    const p = key && state.players[key];
    const heute = tagVon(now());
    const groesse = [0, 0];
    for (const x of Object.values(state.players)) groesse[x.team] += 1;
    const letztes = state.letztes ? {
      teams: state.letztes.teams, punkte: state.letztes.punkte, sieger: state.letztes.sieger,
      beste: state.letztes.beste, meins: key && state.letztes.lohn ? state.letztes.lohn[key] || null : null,
    } : null;
    const acc = key ? accounts.get(key) : null;
    return {
      ok: true,
      title: "Wochenend-Derby",
      schedule,
      teams: teams.map((t, i) => ({ ...t, punkte: state.punkte[i], spieler: groesse[i], beste: besteVon(i, 5) })),
      ich: p ? {
        team: p.team, punkte: p.punkte,
        heute: (p.tage && p.tage[heute]) || 0,
        angetreten: !!(p.tage && p.tage[heute] !== undefined),
      } : null,
      regeln: { tagesDeckel: TAGES_DECKEL, antritt: ANTRITT, minBeitrag: MIN_BEITRAG,
        lohn: Object.fromEntries(Object.entries(LOHN).map(([k, v]) => [k, key ? Math.round(v * accounts.faucetFactor(key)) : v])) },
      bilanz: acc && acc.derby ? { teilnahmen: acc.derby.teilnahmen || 0, siege: acc.derby.siege || 0 } : { teilnahmen: 0, siege: 0 },
      letztes,
    };
  }

  function socketsFor(key) {
    const out = [];
    for (const socket of io.of("/").sockets.values()) {
      if (socket.data && socket.data.account === key) out.push(socket);
    }
    return out;
  }

  /* Allen den neuen Stand schicken, nicht nur dem, der gespielt hat: das
     Tauziehen ist das, was man sehen soll. Gebündelt, höchstens einmal je
     zwei Sekunden, sonst schickt ein Automat im Dauerlauf alles an alle. */
  let verteilenGeplant = null;
  function verteilen() {
    if (verteilenGeplant) return;
    verteilenGeplant = setTimeout(() => {
      verteilenGeplant = null;
      for (const socket of io.of("/").sockets.values()) {
        const key = socket.data && socket.data.account;
        if (key && accounts.get(key)) socket.emit("eventcalendar:update", publicState(key));
      }
    }, 2000);
    if (verteilenGeplant.unref) verteilenGeplant.unref();
  }

  accounts.onHand((spieler, _winnings, _house, _game, meta) => {
    if (meta && (meta.free || meta.event === false)) return;
    const schedule = ensureWeek();
    if (!schedule.active) return;
    const key = accounts.kanonisch(spieler);
    if (!key) return;
    let p = state.players[key];
    const neu = !p;
    if (!p) p = state.players[key] = { team: teamFuer(key), punkte: 0, tage: {}, seit: now() };
    const heute = tagVon(now());
    let gewinn = 0;
    if (p.tage[heute] === undefined) { p.tage[heute] = 0; gewinn += ANTRITT; }
    if (p.tage[heute] < TAGES_DECKEL) { p.tage[heute] += 1; gewinn += 1; }
    if (!gewinn) return;
    p.punkte += gewinn;
    state.punkte[p.team] += gewinn;

    const [a, b] = state.punkte;
    const vorn = a === b ? -1 : a > b ? 0 : 1;
    if (vorn !== -1 && vorn !== state.fuehrung) {
      const war = state.fuehrung;
      state.fuehrung = vorn;
      // Die erste Führung des Wochenendes ist kein Wechsel.
      if (war !== -1 && now() - state.letzteAnsage > ANSAGE_PAUSE_MS) {
        state.letzteAnsage = now();
        const t = paarungVon(state.eventId);
        ansagen(`Führungswechsel im Wochenend-Derby: ${t[vorn].name} liegt jetzt vorn, ${Math.max(a, b)} zu ${Math.min(a, b)}.`);
      }
    }
    save();
    if (neu) {
      const t = paarungVon(state.eventId)[p.team];
      for (const socket of socketsFor(key)) socket.emit("eventcalendar:reward", { kind: "team", team: t.name, farbe: p.team });
      aussehenNeu(key);
    }
    verteilen();
  });

  // Abrechnen und Starten passieren auch, wenn gerade niemand spielt.
  if (!process.env.NODE_TEST_CONTEXT) setInterval(ensureWeek, 60 * 1000).unref();
  ensureWeek();

  io.on("connection", (socket) => {
    socket.on("eventcalendar:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key || !accounts.get(key)) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      ack(publicState(key));
    });
  });

  return { publicState, ensureWeek, abrechnen, getState: () => state };
}

module.exports = {
  setupEventCalendar, scheduleAt, berlinToUtc, paarungVon, teamVon,
  TAGES_DECKEL, ANTRITT, MIN_BEITRAG, LOHN, PAARUNGEN, FARBEN,
  setAussehen(fn) { if (typeof fn === "function") aussehenNeu = fn; },
  _setState(s) { state = s; },
};
