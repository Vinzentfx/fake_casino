"use strict";

/**
 * Daily & weekly quests — "Verdienen durchs Spielen", gedeckelt.
 *
 * Global rotation: every player sees the SAME 3 dailies (per UTC day) and
 * 2 weeklies (per epoch week), picked deterministically from the pools, so
 * friends can talk about "today's quests". Progress is tracked purely
 * server-side (recordHand listener + city/bonus hooks); completing a quest
 * pays instantly (like achievements). Progress lives on the account:
 *   acc.quests = { day, week, prog: {qid:n}, claimed: {qid:true} }
 *
 * This is the bounded, non-farmable version of "slots over 100% RTP": active
 * play generates income, but only up to the quest rewards per day/week.
 */

const DAILY_POOL = [
  { id: "slots10",    ev: "play_slots",       target: 10, reward: 3000,  label: "🎰 Spiele 10 Slot-Runden" },
  { id: "win3",       ev: "win",              target: 3,  reward: 4000,  label: "🍀 Gewinne 3 Runden (egal was)" },
  { id: "bj5",        ev: "play_blackjack",   target: 5,  reward: 3000,  label: "♠️ Spiele 5 Blackjack-Hände" },
  { id: "roulette5",  ev: "play_roulette",    target: 5,  reward: 3000,  label: "🎡 Spiele 5 Roulette-Runden" },
  { id: "sport1",     ev: "bet_sport",        target: 1,  reward: 2500,  label: "⚽ Platziere 1 Sportwette" },
  { id: "any20",      ev: "play",             target: 20, reward: 5000,  label: "🎲 Spiele 20 Runden (egal was)" },
  { id: "house1",     ev: "buy_house",        target: 1,  reward: 3000,  label: "🏠 Kauf 1 Gebäude in der Stadt" },
  { id: "bonus3",     ev: "claim_bonus",      target: 3,  reward: 2500,  label: "⏰ Hol 3× den Stunden-Bonus" },
];

const WEEKLY_POOL = [
  { id: "win50",      ev: "win",       target: 50,  reward: 30000, label: "🏆 Gewinne 50 Runden diese Woche" },
  { id: "play100",    ev: "play",      target: 100, reward: 25000, label: "🔥 Spiele 100 Runden diese Woche" },
  { id: "houses3",    ev: "buy_house", target: 3,   reward: 20000, label: "🏘️ Kauf 3 Gebäude diese Woche" },
];

const DAILIES_PER_DAY = 3;
const WEEKLIES_PER_WEEK = 2;

const dayNow = () => Math.floor(Date.now() / 86400000);
const weekNow = () => Math.floor((Date.now() / 86400000 + 3) / 7);

/** Deterministic global rotation (same quests for everyone). */
function activeDailies(day = dayNow()) {
  const out = [];
  for (let i = 0; out.length < DAILIES_PER_DAY && i < DAILY_POOL.length; i++) {
    const q = DAILY_POOL[(day * 5 + i * 3) % DAILY_POOL.length];
    if (!out.includes(q)) out.push(q);
  }
  return out;
}
function activeWeeklies(week = weekNow()) {
  const out = [];
  for (let i = 0; out.length < WEEKLIES_PER_WEEK && i < WEEKLY_POOL.length; i++) {
    const q = WEEKLY_POOL[(week * 2 + i) % WEEKLY_POOL.length];
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

let _io = null, _accounts = null;

function ensureQuests(acc) {
  const d = dayNow(), w = weekNow();
  if (!acc.quests) acc.quests = { day: d, week: w, prog: {}, claimed: {} };
  const q = acc.quests;
  if (q.day !== d) {
    for (const def of DAILY_POOL) { delete q.prog[def.id]; delete q.claimed[def.id]; }
    q.bought = []; // buy-quest anti-farm list resets daily
    q.day = d;
  }
  if (q.week !== w) {
    for (const def of WEEKLY_POOL) { delete q.prog[def.id]; delete q.claimed[def.id]; }
    q.week = w;
  }
  return q;
}

/** Count an event for a player's active quests; completed ones pay instantly.
 *  `meta` (optional): buy_house passes the buildingId so the same building
 *  can't be sold & re-bought for quest progress. */
function track(name, ev, n = 1, meta = null) {
  if (!_accounts) return;
  const acc = _accounts.get(name);
  if (!acc) return;
  const q = ensureQuests(acc);
  // Anti-farm: each building counts only once per day for buy quests.
  if (ev === "buy_house" && meta != null) {
    q.bought = q.bought || [];
    if (q.bought.includes(meta)) return;
    q.bought.push(meta);
  }
  const active = [...activeDailies(), ...activeWeeklies()];
  let changed = false;
  for (const def of active) {
    if (q.claimed[def.id]) continue;
    if (def.ev !== ev && !(def.ev === "play" && ev.startsWith("play_"))) continue;
    q.prog[def.id] = Math.min(def.target, (q.prog[def.id] || 0) + n);
    changed = true;
    if (q.prog[def.id] >= def.target) {
      q.claimed[def.id] = true;
      _accounts.adjustChips(String(name).trim().toLowerCase(), def.reward);
      if (_io) _io.emit("quest:done", { user: acc.name, label: def.label, reward: def.reward });
    }
  }
  if (changed) _accounts.save();
}

/** Quest board for one player. */
function listFor(name) {
  const acc = _accounts && _accounts.get(name);
  if (!acc) return null;
  const q = ensureQuests(acc);
  const view = (def) => ({
    id: def.id, label: def.label, target: def.target, reward: def.reward,
    prog: Math.min(def.target, q.prog[def.id] || 0), done: !!q.claimed[def.id],
  });
  const msDay = 86400000 - (Date.now() % 86400000);
  // Week w covers day indices [7w-3, 7(w+1)-3) → next rollover at day 7(w+1)-3.
  const msWeek = ((weekNow() + 1) * 7 - 3) * 86400000 - Date.now();
  return {
    dailies: activeDailies().map(view),
    weeklies: activeWeeklies().map(view),
    msDay,
    msWeek: Math.max(0, msWeek),
  };
}

function setupQuests(io, accounts) {
  _io = io;
  _accounts = accounts;
  // Game rounds feed quest progress through the shared recordHand funnel.
  // Free spins don't count — one bonus trigger must not clear a 10-spin quest.
  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    track(name, "play_" + (game || "any"));
    if (winnings > 0) track(name, "win");
  });

  io.on("connection", (socket) => {
    socket.on("quest:list", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...listFor(socket.data.account) });
    });
  });
}

module.exports = { setupQuests, track, listFor };
