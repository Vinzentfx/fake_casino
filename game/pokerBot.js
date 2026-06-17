"use strict";

/**
 * Simple, deliberately beatable poker bot.
 *
 * Style: loose-passive — calls a lot with medium hands, folds trash to bets,
 * rarely bluffs, only raises with strong hands. A thinking human profits over
 * time, which is the point (play vs bots to earn).
 */

const { evaluateBest7 } = require("./handEvaluator");

const BOT_NAMES = ["Bot Alex", "Bot Mia", "Bot Leo", "Bot Nora", "Bot Sam"];

// Chen-style preflop strength, normalized to ~0..1.
function preflopStrength(hole) {
  const [a, b] = hole;
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const val = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score;
  if (a.rank === b.rank) {
    score = Math.max(val(hi) * 2, 5); // pair
  } else {
    score = val(hi);
    if (a.suit === b.suit) score += 2;
    const gap = hi - lo - 1;
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) score += 1; // straightish bonus
  }
  return Math.max(0, Math.min(1, score / 20));
}

function postflopStrength(hole, board) {
  const cat = evaluateBest7([...hole, ...board]).value[0];
  // category 0 high .. 8 straight flush
  const map = [0.16, 0.42, 0.63, 0.76, 0.85, 0.9, 0.95, 0.98, 1];
  return map[cat] ?? 0.16;
}

/** Decide a bot action for table.seats[idx]. Returns { action, amount? }. */
function decide(table, idx) {
  const seat = table.seats[idx];
  const toCall = table.currentBet - seat.bet;
  const pot = Math.max(table.pot, table.bigBlind);
  const bb = table.bigBlind;
  const stack = seat.chips;

  let strength = table.board.length
    ? postflopStrength(seat.hole, table.board)
    : preflopStrength(seat.hole);
  strength += (Math.random() - 0.5) * 0.1; // a little unpredictability

  if (toCall <= 0) {
    // Check, or bet when strong.
    if (strength > 0.62 && Math.random() < 0.55) {
      const target = Math.min(Math.max(bb * 2, Math.round(pot * 0.5)), stack);
      if (target > 0) return { action: "raise", amount: seat.bet + target };
    }
    return { action: "check" };
  }

  const potOdds = toCall / (pot + toCall);

  // Trash facing a bet → mostly fold (call only tiny bets sometimes).
  if (strength < 0.3) {
    if (toCall <= bb && Math.random() < 0.45) return { action: "call" };
    return { action: "fold" };
  }
  // Strong → sometimes raise.
  if (strength > 0.78 && Math.random() < 0.5) {
    const raiseTo = table.currentBet + Math.max(bb * 2, Math.round(pot * 0.6));
    const maxTo = seat.bet + stack;
    if (raiseTo > table.currentBet && raiseTo <= maxTo) return { action: "raise", amount: raiseTo };
    return { action: "call" };
  }
  // Medium → loose call when odds aren't terrible.
  if (strength > potOdds * 0.8) return { action: "call" };
  return { action: "fold" };
}

module.exports = { decide, BOT_NAMES };
