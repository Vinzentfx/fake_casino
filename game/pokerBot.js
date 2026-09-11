"use strict";

/**
 * Einfacher Poker-Bot, absichtlich schlagbar.
 *
 * Spielt locker und passiv: callt viel mit mittleren Händen, wirft Schrott weg,
 * wenn gesetzt wird, blufft selten und erhöht nur mit starken Händen. Wer
 * mitdenkt, gewinnt auf Dauer, genau darum ging es (gegen Bots Chips verdienen).
 */

const { evaluateBest7 } = require("./handEvaluator");

const BOT_NAMES = ["Bot Alex", "Bot Mia", "Bot Leo", "Bot Nora", "Bot Sam"];

// Preflop-Stärke ungefähr nach Chen, auf ~0..1 gebracht.
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
    if (gap <= 1 && hi < 12) score += 1; // kleiner Bonus für Straßen-Nähe
  }
  return Math.max(0, Math.min(1, score / 20));
}

function postflopStrength(hole, board) {
  const cat = evaluateBest7([...hole, ...board]).value[0];
  // category 0 high .. 8 straight flush
  const map = [0.16, 0.42, 0.63, 0.76, 0.85, 0.9, 0.95, 0.98, 1];
  return map[cat] ?? 0.16;
}

/** Aktion für den Bot auf table.seats[idx] wählen. Gibt { action, amount? } zurück. */
function decide(table, idx) {
  const seat = table.seats[idx];
  const toCall = table.currentBet - seat.bet;
  const pot = Math.max(table.pot, table.bigBlind);
  const bb = table.bigBlind;
  const stack = seat.chips;

  let strength = table.board.length
    ? postflopStrength(seat.hole, table.board)
    : preflopStrength(seat.hole);
  strength += (Math.random() - 0.5) * 0.1; // ein bisschen unberechenbar

  if (toCall <= 0) {
    // Checken, oder setzen, wenn stark.
    if (strength > 0.62 && Math.random() < 0.55) {
      const target = Math.min(Math.max(bb * 2, Math.round(pot * 0.5)), stack);
      if (target > 0) return { action: "raise", amount: seat.bet + target };
    }
    return { action: "check" };
  }

  const potOdds = toCall / (pot + toCall);

  // Schrott gegen einen Einsatz: meistens folden (kleine Einsätze manchmal callen).
  if (strength < 0.3) {
    if (toCall <= bb && Math.random() < 0.45) return { action: "call" };
    return { action: "fold" };
  }
  // Stark: manchmal erhöhen.
  if (strength > 0.78 && Math.random() < 0.5) {
    const raiseTo = table.currentBet + Math.max(bb * 2, Math.round(pot * 0.6));
    const maxTo = seat.bet + stack;
    if (raiseTo > table.currentBet && raiseTo <= maxTo) return { action: "raise", amount: raiseTo };
    return { action: "call" };
  }
  // Mittel: locker callen, wenn die Pot Odds nicht furchtbar sind.
  if (strength > potOdds * 0.8) return { action: "call" };
  return { action: "fold" };
}

module.exports = { decide, BOT_NAMES };
