"use strict";

/**
 * Live-Ops: time-limited events that make the casino feel alive.
 *
 *   • HAPPY HOUR — all quest rewards double for a while.
 *   • SLOT DES TAGES — one machine (rotates daily) pays a bonus on wins,
 *     capped per player/day so RTP can't run away.
 *   • MINI-TURNIER — for N minutes, whoever lands the biggest single slot win
 *     takes a prize pot. Live scoreboard, chat announcements.
 *
 * The owner ("vincent") can start/stop each from the admin panel; Happy Hour
 * and tournaments also auto-expire. Global state is persisted to
 * data/liveops.json so it survives restarts.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "liveops.json");

let _io = null, _accounts = null, _heist = null;
let state = load();

const AUTO_CHECK_MS = 10 * 60 * 1000;
const AUTO_TOURNEY_CHANCE = 0.04;
const AUTO_HEIST_CHANCE = 0.015;
const TOURNEY_PRIZE_MIN = 25000;
const TOURNEY_PRIZE_MAX = 60000;
const HEIST_LOOT_MIN = 150000;
const HEIST_LOOT_MAX = 500000;

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

// ─── Happy Hour ─────────────────────────────────────────────────────────────
const happyActive = () => state.happyUntil > Date.now();
/** Quest reward multiplier (used by quests.js). */
const questMult = () => (happyActive() ? 2 : 1);

function startHappy(minutes) {
  const mins = Math.max(1, Math.min(240, Math.floor(minutes) || 60));
  state.happyUntil = Date.now() + mins * 60000;
  save();
  if (_io) { chat.announce(_io, `🍹 HAPPY HOUR! Für ${mins} Minuten gibt's DOPPELTE Quest-Belohnungen — ran an die Aufträge!`); broadcast(); }
}
function stopHappy() {
  state.happyUntil = 0;
  save();
  if (_io) { chat.announce(_io, "🍹 Happy Hour ist vorbei."); broadcast(); }
}

// ─── Mini-Turnier ───────────────────────────────────────────────────────────
const tourneyActive = () => !!(state.tourney && state.tourney.endsAt > Date.now());

function startTourney(minutes, prize, opts = {}) {
  if (tourneyActive()) return { ok: false, error: "Läuft schon ein Turnier." };
  const mins = Math.max(1, Math.min(120, Math.floor(minutes) || 10));
  const pr = Math.max(0, Math.floor(prize) || 100000);
  state.tourney = { endsAt: Date.now() + mins * 60000, prize: pr, best: {} }; // best: key → {name, win}
  autoState().tourneyCooldownUntil = state.tourney.endsAt + randInt(90, 180) * 60000;
  save();
  const prefix = opts.auto ? "🎲 Zufälliges " : "";
  if (_io) { chat.announce(_io, `🏁 ${prefix}SLOT-TURNIER gestartet! ${mins} Min — der größte Einzelgewinn holt ${pr.toLocaleString("de-DE")} 🪙. Los!`); broadcast(); }
  return { ok: true };
}

/** Record a slot win toward the running tournament (called from slots.js).
 *  Ranked by the win MULTIPLE (win / bet), not the absolute win, so a small
 *  better with a lucky big multiplier can beat a whale — fair across stakes. */
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
    if (_io) chat.announce(_io, `🏆 TURNIER-SIEG: ${winner.name} mit ${winner.mult}× Einsatz — Preis: ${t.prize.toLocaleString("de-DE")} 🪙!`);
    if (_io) _io.emit("liveops:tourneyWin", { name: winner.name, mult: winner.mult, prize: t.prize });
  } else if (_io) {
    chat.announce(_io, "🏁 Turnier vorbei — niemand hat gespielt, kein Sieger.");
  }
  broadcast();
}
function stopTourney() { if (state.tourney) settleTourney(); }

// ─── Public state + wiring ──────────────────────────────────────────────────
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

module.exports = {
  setup, tick, questMult, happyActive,
  recordTourneyWin, tourneyActive,
  startHappy, stopHappy, startTourney, stopTourney,
  setHeist,
};
