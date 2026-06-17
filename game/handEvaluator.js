"use strict";

/**
 * Texas Hold'em hand evaluation.
 *
 * evaluateBest7(cards) takes up to 7 cards and returns the best 5-card hand:
 *   { value: number[], name: string, cards: card[] }
 *
 * `value` is a comparable array: first element is the category (8 = straight
 * flush ... 0 = high card), followed by tiebreaker ranks (high to low).
 * Compare two hands with compareValue(a, b).
 */

const { RANK_LABEL } = require("./cards");

const CATEGORY = {
  STRAIGHT_FLUSH: 8,
  FOUR_KIND: 7,
  FULL_HOUSE: 6,
  FLUSH: 5,
  STRAIGHT: 4,
  THREE_KIND: 3,
  TWO_PAIR: 2,
  ONE_PAIR: 1,
  HIGH_CARD: 0,
};

const CATEGORY_NAME = {
  8: "Straight Flush",
  7: "Vierling",
  6: "Full House",
  5: "Flush",
  4: "Straße",
  3: "Drilling",
  2: "Zwei Paare",
  1: "Ein Paar",
  0: "Höchste Karte",
};

/** Lexicographic compare of two value arrays. >0 if a is better. */
function compareValue(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Find the high card of a straight from a set of distinct ranks (handles wheel A-2-3-4-5). */
function straightHigh(distinctRanksDesc) {
  // Add Ace as low (1) if present, to detect the wheel.
  const ranks = distinctRanksDesc.slice();
  if (ranks.includes(14)) ranks.push(1);
  let run = 1;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] - 1) {
      run++;
      if (run >= 5) return ranks[i - 4]; // high card of the straight
    } else {
      run = 1;
    }
  }
  return 0;
}

/** Evaluate exactly 5 cards → value array. */
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  // Count ranks
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  // Groups sorted by (count desc, rank desc)
  const groups = Object.keys(counts)
    .map(Number)
    .sort((a, b) => counts[b] - counts[a] || b - a);

  const isFlush = suits.every((s) => s === suits[0]);
  const distinct = [...new Set(ranks)].sort((a, b) => b - a);
  const sHigh = distinct.length >= 5 ? straightHigh(distinct) : 0;

  if (isFlush && sHigh) return [CATEGORY.STRAIGHT_FLUSH, sHigh];
  if (counts[groups[0]] === 4) return [CATEGORY.FOUR_KIND, groups[0], groups[1]];
  if (counts[groups[0]] === 3 && counts[groups[1]] === 2)
    return [CATEGORY.FULL_HOUSE, groups[0], groups[1]];
  if (isFlush) return [CATEGORY.FLUSH, ...ranks];
  if (sHigh) return [CATEGORY.STRAIGHT, sHigh];
  if (counts[groups[0]] === 3) return [CATEGORY.THREE_KIND, groups[0], groups[1], groups[2]];
  if (counts[groups[0]] === 2 && counts[groups[1]] === 2)
    return [CATEGORY.TWO_PAIR, groups[0], groups[1], groups[2]];
  if (counts[groups[0]] === 2) return [CATEGORY.ONE_PAIR, groups[0], groups[1], groups[2], groups[3]];
  return [CATEGORY.HIGH_CARD, ...ranks];
}

/** All 5-card combinations of an array. */
function combinations5(arr) {
  const res = [];
  const n = arr.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            res.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
  return res;
}

/** Best 5-card hand from up to 7 cards. */
function evaluateBest7(cards) {
  let best = null;
  const combos = cards.length <= 5 ? [cards] : combinations5(cards);
  for (const combo of combos) {
    const value = evaluate5(combo);
    if (!best || compareValue(value, best.value) > 0) {
      best = { value, cards: combo };
    }
  }
  best.name = CATEGORY_NAME[best.value[0]];
  return best;
}

module.exports = { evaluateBest7, evaluate5, compareValue, CATEGORY, CATEGORY_NAME, RANK_LABEL };
