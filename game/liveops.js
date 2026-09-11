"use strict";

/**
 * Live-Ops: Events auf Zeit, damit im Casino etwas los ist.
 *
 *   HAPPY HOUR      alle Auftragsbelohnungen zählen eine Weile doppelt.
 *   SLOT DES TAGES  ein Automat (wechselt täglich) zahlt auf Gewinne einen
 *                   Bonus, je Spieler und Tag gedeckelt, damit die RTP nicht
 *                   davonläuft.
 *   MINI-TURNIER    N Minuten lang holt der größte einzelne Slot-Gewinn einen
 *                   Preis. Mit Live-Tabelle und Ansagen im Chat.
 *
 * Der Besitzer kann alles im Admin starten und stoppen, Happy Hour und
 * Turniere laufen auch von selbst aus. Der Stand liegt in data/liveops.json
 * und übersteht einen Neustart.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");
const city = require("./city");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "liveops.json");

let _io = null, _accounts = null, _heist = null;
let _events = {}; // { rain, quiz, vault }, Admin-Events, die auch zufällig spawnen (setEvents)
let state = load();

const AUTO_CHECK_MS = 10 * 60 * 1000;
const AUTO_TOURNEY_CHANCE = 0.04;
const AUTO_HEIST_CHANCE = 0.015;
const AUTO_HAPPY_CHANCE = 0.02;
const AUTO_CITY_CHANCE = 0.025;
// Chip-Regen / Blitz-Quiz / Tresorkampf: gleiche faire Chance wie der Heist,
// mit eigenen langen Cooldowns → im Schnitt grob ein zufälliges Geld-Event
// alle paar Stunden Online-Zeit, nie zwei gleichzeitig vom selben Typ.
const AUTO_RAIN_CHANCE = 0.015;
const AUTO_QUIZ_CHANCE = 0.015;
const AUTO_VAULT_CHANCE = 0.015;
const TOURNEY_PRIZE_MIN = 25000;
const TOURNEY_PRIZE_MAX = 60000;
const HEIST_LOOT_MIN = 150000;
const HEIST_LOOT_MAX = 500000;
const RAIN_POT_MIN = 60000, RAIN_POT_MAX = 150000;
const QUIZ_PRIZE_MIN = 8000, QUIZ_PRIZE_MAX = 15000;
const VAULT_POT_MIN = 100000, VAULT_POT_MAX = 250000;

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s === "object") return {
      happyUntil: s.happyUntil || 0,
      tourney: s.tourney || null,
      auto: s.auto || {},
    };
  } catch {}
  return { happyUntil: 0, tourney: null, auto: {} };
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch {}
}
function autoState() {
  state.auto = state.auto || {};
  return state.auto;
}
function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function onlineCount() {
  if (!_io) return 0;
  let n = 0;
  for (const s of _io.of("/").sockets.values()) if (s.data && s.data.account) n++;
  return n;
}

/**
 * Push nur fuer Events, die lange genug laufen, dass Nachkommen sich lohnt.
 * Chip-Regen, Heist und Tresorkampf dauern unter zwei Minuten, wer da erst
 * durch die Nachricht aufwacht, kommt zu spaet und aergert sich nur.
 */
function meldePush(titel, text) {
  try {
    require("./push").anAlle("live", { title: titel, body: text, url: "/" });
  } catch {}
}

// --- Happy Hour ---
const happyActive = () => state.happyUntil > Date.now();
/** Quest reward multiplier (used by quests.js). */
const questMult = () => (happyActive() ? 2 : 1);

function startHappy(minutes) {
  const mins = Math.max(1, Math.min(240, Math.floor(minutes) || 60));
  state.happyUntil = Date.now() + mins * 60000;
  save();
  if (_io) { chat.announce(_io, `Happy Hour! ${mins} Minuten lang zahlen alle Aufträge doppelt.`); broadcast(); }
  meldePush("Happy Hour läuft", `${mins} Minuten lang doppelte Belohnungen für Aufträge.`);
}
function stopHappy() {
  state.happyUntil = 0;
  save();
  if (_io) { chat.announce(_io, "Happy Hour ist vorbei."); broadcast(); }
}

// --- Mini-Turnier ---
const tourneyActive = () => !!(state.tourney && state.tourney.endsAt > Date.now());

function startTourney(minutes, prize, opts = {}) {
  if (tourneyActive()) return { ok: false, error: "Läuft schon ein Turnier." };
  const mins = Math.max(1, Math.min(120, Math.floor(minutes) || 10));
  const pr = Math.max(0, Math.floor(prize) || 100000);
  state.tourney = { endsAt: Date.now() + mins * 60000, prize: pr, best: {} }; // best: key → {name, win}
  autoState().tourneyCooldownUntil = state.tourney.endsAt + randInt(90, 180) * 60000;
  save();
  const prefix = opts.auto ? "Zufälliges " : "";
  if (_io) { chat.announce(_io, `${prefix}Slot-Turnier läuft, ${mins} Minuten. Das beste Vielfache holt ${pr.toLocaleString("de-DE")} Chips.`); broadcast(); }
  meldePush("Slot-Turnier läuft", `${mins} Minuten, ${pr.toLocaleString("de-DE")} Chips für das beste Vielfache.`);
  return { ok: true };
}

/** Einen Slot-Gewinn fürs laufende Turnier eintragen (ruft slots.js auf).
 *  Gewertet wird das Vielfache (Gewinn / Einsatz), nicht der absolute Gewinn,
 *  damit jemand mit kleinem Einsatz und Glück einen Großspieler schlagen kann. */
function recordTourneyWin(name, win, bet) {
  if (!tourneyActive() || win <= 0 || !bet || bet <= 0) return;
  const mult = win / bet;
  const key = String(name).trim().toLowerCase();
  const acc = _accounts && _accounts.get(key);
  const cur = state.tourney.best[key];
  if (!cur || mult > cur.mult) {
    state.tourney.best[key] = { name: acc ? acc.name : key, mult: Math.round(mult * 100) / 100, win };
    save();
    broadcast();
  }
}

function settleTourney() {
  const t = state.tourney;
  state.tourney = null;
  save();
  if (!t) return;
  let winner = null;
  for (const [key, v] of Object.entries(t.best)) if (!winner || v.mult > winner.mult) winner = { key, ...v };
  if (winner && _accounts) {
    _accounts.adjustChips(winner.key, t.prize);
    const acc = _accounts.get(winner.key);
    if (acc) { acc.tourneyWins = (acc.tourneyWins || 0) + 1; _accounts.save(); }
    try { require("./achievements").check(winner.key); } catch {}
    if (_io) chat.announce(_io, `${winner.name} gewinnt das Slot-Turnier mit ${winner.mult}× Einsatz und bekommt ${t.prize.toLocaleString("de-DE")} Chips.`);
    if (_io) _io.emit("liveops:tourneyWin", { name: winner.name, mult: winner.mult, prize: t.prize });
  } else if (_io) {
    chat.announce(_io, "Turnier vorbei. Niemand hat mitgespielt, also auch kein Sieger.");
  }
  broadcast();
}
function stopTourney() { if (state.tourney) settleTourney(); }

// --- Public state + wiring ---
function publicState() {
  const t = state.tourney;
  let board = null;
  if (tourneyActive()) {
    board = Object.values(t.best).sort((a, b) => b.mult - a.mult).slice(0, 5);
  }
  return {
    happyUntil: state.happyUntil,
    happyActive: happyActive(),
    tourney: tourneyActive() ? { endsAt: t.endsAt, prize: t.prize, board } : null,
  };
}
function broadcast() { if (_io) _io.emit("liveops:state", publicState()); }

/** Auto-expire happy hour + tournaments. Call periodically. */
function tick() {
  if (state.tourney && state.tourney.endsAt <= Date.now()) settleTourney();
  if (state.happyUntil && state.happyUntil <= Date.now()) { state.happyUntil = 0; save(); broadcast(); }
  maybeAutoSpawn();
}

function maybeAutoSpawn() {
  if (!_io) return;
  const now = Date.now();
  const a = autoState();
  if (!a.nextCheckAt) a.nextCheckAt = now + AUTO_CHECK_MS;
  if (now < a.nextCheckAt) return;
  a.nextCheckAt = now + AUTO_CHECK_MS;

  const online = onlineCount();
  if (online > 0 && !tourneyActive() && now >= (a.tourneyCooldownUntil || 0) && Math.random() < AUTO_TOURNEY_CHANCE) {
    const prize = Math.round(randInt(TOURNEY_PRIZE_MIN, TOURNEY_PRIZE_MAX) / 1000) * 1000;
    startTourney(randInt(8, 15), prize, { auto: true });
  }

  if (_heist && (!_heist.active || !_heist.active()) && online > 0 &&
      now >= (a.heistCooldownUntil || 0) && Math.random() < AUTO_HEIST_CHANCE) {
    const loot = Math.round(randInt(HEIST_LOOT_MIN, HEIST_LOOT_MAX) / 1000) * 1000;
    const seconds = randInt(45, 90);
    const res = _heist.start(loot, seconds, { auto: true });
    if (res && res.ok) a.heistCooldownUntil = Date.now() + randInt(180, 360) * 60000;
  }

  if (online > 0 && !happyActive() && now >= (a.happyCooldownUntil || 0) && Math.random() < AUTO_HAPPY_CHANCE) {
    const mins = randInt(15, 30);
    startHappy(mins);
    a.happyCooldownUntil = Date.now() + randInt(360, 720) * 60000;
    try { require("./feed").add("event", `Seltene Mini-Happy-Hour startet für ${mins} Minuten.`); } catch {}
  }

  if (_events.rain && !_events.rain.active() && online > 0 &&
      now >= (a.rainCooldownUntil || 0) && Math.random() < AUTO_RAIN_CHANCE) {
    const pot = Math.round(randInt(RAIN_POT_MIN, RAIN_POT_MAX) / 1000) * 1000;
    const res = _events.rain.start(pot, randInt(25, 45), { auto: true });
    if (res && res.ok) a.rainCooldownUntil = Date.now() + randInt(180, 360) * 60000;
  }

  if (_events.quiz && !_events.quiz.active() && online > 0 &&
      now >= (a.quizCooldownUntil || 0) && Math.random() < AUTO_QUIZ_CHANCE) {
    const prize = Math.round(randInt(QUIZ_PRIZE_MIN, QUIZ_PRIZE_MAX) / 500) * 500;
    const res = _events.quiz.start(randInt(3, 5), prize, { auto: true });
    if (res && res.ok) a.quizCooldownUntil = Date.now() + randInt(180, 360) * 60000;
  }

  // Tresorkampf braucht ≥2 Spieler online (start() prüft das selbst und lehnt
  // sonst ab, dann bleibt der Cooldown ungesetzt und es klappt später wieder).
  if (_events.vault && !_events.vault.active() && online >= 2 &&
      now >= (a.vaultCooldownUntil || 0) && Math.random() < AUTO_VAULT_CHANCE) {
    const pot = Math.round(randInt(VAULT_POT_MIN, VAULT_POT_MAX) / 1000) * 1000;
    const res = _events.vault.start(pot, randInt(60, 90), { auto: true });
    if (res && res.ok) a.vaultCooldownUntil = Date.now() + randInt(240, 420) * 60000;
  }

  if (online > 0 && now >= (a.cityCooldownUntil || 0) && Math.random() < AUTO_CITY_CHANCE) {
    const event = city.fireEvent(null);
    if (event) {
      _io.emit("city:update");
      _io.emit("city:news", event);
      chat.announce(_io, `Seltenes Stadt-Ereignis: ${event.txt}`);
      try { require("./feed").add("event", `Stadt-Ereignis: ${event.txt}`); } catch {}
      a.cityCooldownUntil = Date.now() + randInt(180, 360) * 60000;
    }
  }

  save();
}

function setup(io, accounts, heist = null) {
  _io = io;
  _accounts = accounts;
  _heist = heist || _heist;
  setInterval(tick, 10000).unref();
  io.on("connection", (socket) => {
    socket.on("liveops:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...publicState() }); });
  });
}

function setHeist(heist) { _heist = heist; }
function setEvents(events) { _events = events || {}; }

module.exports = {
  setup, tick, questMult, happyActive,
  recordTourneyWin, tourneyActive,
  startHappy, stopHappy, startTourney, stopTourney,
  publicState, setHeist, setEvents,
};
