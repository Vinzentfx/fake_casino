"use strict";

/**
 * Achievements & badges — one-time milestones with chip rewards.
 *
 * Server-authoritative: progress is derived from data the server already owns
 * (acc.stats, chip balance, city territory), never from the client. Unlocks
 * pay out instantly via adjustChips, notify the player (socket "ach:unlocked")
 * and announce big ones (reward ≥ 100k) in the global chat.
 *
 * Unlocked ids live on the account: acc.ach = { [id]: timestamp }.
 *
 * These payouts are the "career income" of the economy — together with the
 * daily bonus they fund a new player's first houses while the games keep a
 * house edge (<100% RTP).
 */

const city = require("./city");

// check(acc, key) → true when reached. Sorted roughly by progression.
const DEFS = [
  // ── Casino ────────────────────────────────────────────────────────────────
  { id: "first_win",   emoji: "🎉", label: "Erster Gewinn",   desc: "Gewinne deine erste Runde",              reward: 1000,
    check: (a) => ((a.stats && a.stats.handsWon) || 0) >= 1 },
  { id: "plays_100",   emoji: "🎲", label: "Stammgast",       desc: "Spiele 100 Runden",                      reward: 10000,
    check: (a) => ((a.stats && a.stats.gamesPlayed) || 0) >= 100 },
  { id: "plays_1000",  emoji: "🔥", label: "Inventar",        desc: "Spiele 1.000 Runden",                    reward: 100000,
    check: (a) => ((a.stats && a.stats.gamesPlayed) || 0) >= 1000 },
  { id: "bigwin_10k",  emoji: "💥", label: "Dicker Fisch",    desc: "Einzelgewinn über 10.000",               reward: 5000,
    check: (a) => ((a.stats && a.stats.biggestWin) || 0) >= 10000 },
  { id: "bigwin_100k", emoji: "🚀", label: "Jackpot-Jäger",   desc: "Einzelgewinn über 100.000",              reward: 50000,
    check: (a) => ((a.stats && a.stats.biggestWin) || 0) >= 100000 },
  { id: "bigwin_1m",   emoji: "🌋", label: "Legende",         desc: "Einzelgewinn über 1 Million",            reward: 250000,
    check: (a) => ((a.stats && a.stats.biggestWin) || 0) >= 1000000 },
  { id: "chips_100k",  emoji: "💰", label: "Erste 100k",      desc: "Kontostand über 100.000",                reward: 10000,
    check: (a) => (a.chips || 0) >= 100000 },
  { id: "chips_1m",    emoji: "💎", label: "Millionär",       desc: "Kontostand über 1 Million",              reward: 50000,
    check: (a) => (a.chips || 0) >= 1000000 },
  { id: "chips_100m",  emoji: "👑", label: "Krösus",          desc: "Kontostand über 100 Millionen",          reward: 500000,
    check: (a) => (a.chips || 0) >= 100000000 },
  { id: "streak_7",    emoji: "📅", label: "Bonus-Serie",     desc: "Hol den Stunden-Bonus 7× in Folge",      reward: 25000,
    check: (a) => (a.bonusStreak || 0) >= 7 },
  // ── Stadt ────────────────────────────────────────────────────────────────
  { id: "first_house", emoji: "🏠", label: "Eigenheim",       desc: "Kauf dein erstes Haus",                  reward: 2500,
    check: (a, k) => cityStats(k).houses >= 1 },
  { id: "houses_10",   emoji: "🏘️", label: "Häuslebauer",     desc: "Besitze 10 Häuser",                      reward: 25000,
    check: (a, k) => cityStats(k).houses >= 10 },
  { id: "houses_50",   emoji: "🏗️", label: "Immobilienhai",   desc: "Besitze 50 Häuser",                      reward: 100000,
    check: (a, k) => cityStats(k).houses >= 50 },
  { id: "first_street", emoji: "👑", label: "Straßenzug",     desc: "Erstes Straßen-Monopol",                 reward: 50000,
    check: (a, k) => city.streetCount(k) >= 1 },
  { id: "streets_5",   emoji: "🛣️", label: "Straßenkönig",    desc: "5 komplette Straßen",                    reward: 250000,
    check: (a, k) => city.streetCount(k) >= 5 },
  { id: "first_trophy", emoji: "🏆", label: "Trophäen-Jäger", desc: "Kauf ein Trophäen-Gebäude",              reward: 100000,
    check: (a, k) => city.trophiesOf(k).length >= 1 },
  { id: "boss",        emoji: "🥇", label: "Stadtteil-Boss",  desc: "Werde Boss eines Ortsteils",             reward: 100000,
    check: (a, k) => cityStats(k).boss >= 1 },
  { id: "bank_baron",  emoji: "🏦", label: "Bank-Baron",      desc: "Besitze die Bank",                       reward: 500000,
    check: (a, k) => city.bankOwner() === k },
  { id: "casino_king", emoji: "🎰", label: "Casino-König",    desc: "Besitze das Casino",                     reward: 1000000,
    check: (a, k) => city.casinoOwner() === k },
  // ── Meta / Events ─────────────────────────────────────────────────────────
  { id: "cal_week",    emoji: "📅", label: "Treuer Gast",     desc: "Hol Tag 7 im Login-Kalender",            reward: 25000,
    check: (a) => (a.calBest || 0) >= 7 },
  { id: "tourney_win", emoji: "🏁", label: "Turniersieger",   desc: "Gewinne ein Slot-Turnier",               reward: 50000,
    check: (a) => (a.tourneyWins || 0) >= 1 },
  { id: "bounty",      emoji: "🎯", label: "Kopfgeldjäger",   desc: "Kassiere ein Kopfgeld",                  reward: 50000,
    check: (a) => (a.bountyClaims || 0) >= 1 },
  // ── Denkspiele (PvP-Duelle & Solitär) ─────────────────────────────────────
  { id: "duel_win_1",  emoji: "🤝", label: "Erstes Duell",    desc: "Gewinne dein erstes PvP-Duell",          reward: 2500,
    check: (a) => (a.pvpWins || 0) >= 1 },
  { id: "duel_win_25", emoji: "⚔️", label: "Duellmeister",    desc: "Gewinne 25 PvP-Duelle",                  reward: 50000,
    check: (a) => (a.pvpWins || 0) >= 25 },
  { id: "memory_win",  emoji: "🧠", label: "Gedächtniskünstler", desc: "Gewinne ein Memory-Duell",            reward: 5000,
    check: (a) => ((a.pvpWinsByGame && a.pvpWinsByGame.memory) || 0) >= 1 },
  { id: "sudoku_win",  emoji: "🔢", label: "Zahlenjäger",     desc: "Gewinne ein Sudoku-Race",                reward: 5000,
    check: (a) => ((a.pvpWinsByGame && a.pvpWinsByGame.sudoku) || 0) >= 1 },
  { id: "chess_win_1", emoji: "♟️", label: "Schachmatt",      desc: "Gewinne ein Schach-Duell",               reward: 5000,
    check: (a) => (a.chessWins || 0) >= 1 },
  { id: "chess_win_10", emoji: "♚", label: "Großmeister",     desc: "Gewinne 10 Schach-Duelle",               reward: 75000,
    check: (a) => (a.chessWins || 0) >= 10 },
  { id: "sol_clear",   emoji: "🃏", label: "Patience-Profi",  desc: "Räum Solitär gegen das Haus ab",         reward: 5000,
    check: (a) => (a.solitaireClears || 0) >= 1 },
];

// Cheap city aggregates for the checks above.
function cityStats(key) {
  const ov = city.publicOverview(key);
  return { houses: ov.me ? ov.me.houses : 0, boss: ov.me ? ov.me.bossOf.length : 0 };
}

let _io = null, _accounts = null;

/** Evaluate all definitions for one player; unlock, pay & notify new ones. */
function check(name) {
  if (!_accounts) return;
  const acc = _accounts.get(name);
  if (!acc) return;
  const key = String(name).trim().toLowerCase();
  acc.ach = acc.ach || {};
  for (const d of DEFS) {
    if (acc.ach[d.id]) continue;
    let hit = false;
    try { hit = d.check(acc, key); } catch {}
    if (!hit) continue;
    acc.ach[d.id] = Date.now();
    _accounts.adjustChips(key, d.reward); // pays + saves (chip cap applies)
    if (_io) {
      _io.emit("ach:unlocked", { user: acc.name, id: d.id, emoji: d.emoji, label: d.label, reward: d.reward });
      if (d.reward >= 100000) {
        const chat = require("./chat");
        chat.announce(_io, `🏆 ${acc.name} hat „${d.emoji} ${d.label}“ freigeschaltet!`);
      }
    }
  }
}

/** All definitions with the player's unlock state (profile badges). */
function listFor(name) {
  const acc = _accounts && _accounts.get(name);
  const ach = (acc && acc.ach) || {};
  return DEFS.map((d) => ({
    id: d.id, emoji: d.emoji, label: d.label, desc: d.desc, reward: d.reward,
    unlocked: !!ach[d.id], at: ach[d.id] || null,
  }));
}

/** Emoji of one achievement id (leaderboard title badge), or null. */
function emojiOf(id) {
  const d = DEFS.find((x) => x.id === id);
  return d ? d.emoji : null;
}

function setupAchievements(io, accounts) {
  _io = io;
  _accounts = accounts;
  // Every recorded hand may complete a casino achievement.
  accounts.onHand((name) => check(name));

  io.on("connection", (socket) => {
    socket.on("ach:list", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const acc = accounts.get(socket.data.account);
      ack({ ok: true, list: listFor(socket.data.account), badge: (acc && acc.badge) || null });
    });

    // Pick ONE unlocked achievement as the title emoji shown behind your name
    // in the leaderboard (id = null clears it).
    socket.on("ach:setBadge", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      if (id == null) { delete acc.badge; accounts.save(); return ack({ ok: true, badge: null }); }
      if (!acc.ach || !acc.ach[id]) return ack({ ok: false, error: "Achievement noch nicht freigeschaltet." });
      acc.badge = id;
      accounts.save();
      ack({ ok: true, badge: id });
    });
  });
}

module.exports = { setupAchievements, check, listFor, emojiOf };
