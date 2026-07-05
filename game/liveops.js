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

const SLOT_ROTATION = ["lucky7", "gemstorm", "dragon", "cosmic"];
const SOTD_WIN_BONUS = 0.15;     // +15% on wins on the day's machine …
const SOTD_DAILY_CAP = 50000;    // … but at most this many bonus chips/player/day

let _io = null, _accounts = null;
let state = load();

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s === "object") return { happyUntil: s.happyUntil || 0, tourney: s.tourney || null };
  } catch {}
  return { happyUntil: 0, tourney: null };
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch {}
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

// ─── Slot des Tages ─────────────────────────────────────────────────────────
const slotOfDay = () => SLOT_ROTATION[Math.floor(Date.now() / 86400000) % SLOT_ROTATION.length];

/** Bonus chips to add on a win on the day's machine, respecting the per-day
 *  cap. Mutates the account's tracker. Returns the bonus (0 if none). */
function slotOfDayBonus(acc, machineId, win) {
  if (!acc || win <= 0 || machineId !== slotOfDay()) return 0;
  const day = Math.floor(Date.now() / 86400000);
  if (!acc.sotd || acc.sotd.day !== day) acc.sotd = { day, used: 0 };
  const bonus = Math.min(Math.round(win * SOTD_WIN_BONUS), SOTD_DAILY_CAP - acc.sotd.used);
  if (bonus <= 0) return 0;
  acc.sotd.used += bonus;
  return bonus;
}

// ─── Mini-Turnier ───────────────────────────────────────────────────────────
const tourneyActive = () => !!(state.tourney && state.tourney.endsAt > Date.now());

function startTourney(minutes, prize) {
  if (tourneyActive()) return { ok: false, error: "Läuft schon ein Turnier." };
  const mins = Math.max(1, Math.min(120, Math.floor(minutes) || 10));
  const pr = Math.max(0, Math.floor(prize) || 100000);
  state.tourney = { endsAt: Date.now() + mins * 60000, prize: pr, best: {} }; // best: key → {name, win}
  save();
  if (_io) { chat.announce(_io, `🏁 SLOT-TURNIER gestartet! ${mins} Min — der größte Einzelgewinn holt ${pr.toLocaleString("de-DE")} 🪙. Los!`); broadcast(); }
  return { ok: true };
}

/** Record a slot win toward the running tournament (called from slots.js). */
function recordTourneyWin(name, win) {
  if (!tourneyActive() || win <= 0) return;
  const key = String(name).trim().toLowerCase();
  const acc = _accounts && _accounts.get(key);
  const cur = state.tourney.best[key];
  if (!cur || win > cur.win) {
    state.tourney.best[key] = { name: acc ? acc.name : key, win };
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
  for (const [key, v] of Object.entries(t.best)) if (!winner || v.win > winner.win) winner = { key, ...v };
  if (winner && _accounts) {
    _accounts.adjustChips(winner.key, t.prize);
    const acc = _accounts.get(winner.key);
    if (acc) { acc.tourneyWins = (acc.tourneyWins || 0) + 1; _accounts.save(); }
    try { require("./achievements").check(winner.key); } catch {}
    if (_io) chat.announce(_io, `🏆 TURNIER-SIEG: ${winner.name} mit einem ${winner.win.toLocaleString("de-DE")} 🪙 Gewinn — Preis: ${t.prize.toLocaleString("de-DE")} 🪙!`);
    if (_io) _io.emit("liveops:tourneyWin", { name: winner.name, win: winner.win, prize: t.prize });
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
    board = Object.values(t.best).sort((a, b) => b.win - a.win).slice(0, 5);
  }
  return {
    happyUntil: state.happyUntil,
    happyActive: happyActive(),
    slotOfDay: slotOfDay(),
    tourney: tourneyActive() ? { endsAt: t.endsAt, prize: t.prize, board } : null,
  };
}
function broadcast() { if (_io) _io.emit("liveops:state", publicState()); }

/** Auto-expire happy hour + tournaments. Call periodically. */
function tick() {
  if (state.tourney && state.tourney.endsAt <= Date.now()) settleTourney();
  if (state.happyUntil && state.happyUntil <= Date.now()) { state.happyUntil = 0; save(); broadcast(); }
}

function setup(io, accounts) {
  _io = io;
  _accounts = accounts;
  setInterval(tick, 10000).unref();
  io.on("connection", (socket) => {
    socket.on("liveops:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...publicState() }); });
  });
}

module.exports = {
  setup, tick, questMult, happyActive, slotOfDay, slotOfDayBonus,
  recordTourneyWin, tourneyActive,
  startHappy, stopHappy, startTourney, stopTourney,
};
