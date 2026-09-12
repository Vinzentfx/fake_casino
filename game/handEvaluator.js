"use strict";

/**
 * Texas Hold'em: Hände bewerten.
 *
 * evaluateBest7(cards) nimmt bis zu 7 Karten und gibt die beste 5er-Hand zurück:
 *   { value: number[], name: string, cards: card[] }
 *
 * `value` ist ein vergleichbares Array: zuerst die Kategorie (8 = Straight Flush
 * ... 0 = High Card), danach die Ränge für den Gleichstand (von hoch nach niedrig).
 * Zwei Hände vergleicht compareValue(a, b).
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

/** Zwei value-Arrays der Reihe nach vergleichen. >0, wenn a besser ist. */
function compareValue(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Höchste Karte einer Straße aus einer Menge verschiedener Ränge (auch A-2-3-4-5). */
function straightHigh(distinctRanksDesc) {
  // Ass zusätzlich als 1 dazunehmen, damit A-2-3-4-5 erkannt wird.
  const ranks = distinctRanksDesc.slice();
  if (ranks.includes(14)) ranks.push(1);
  let run = 1;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] - 1) {
      run++;
      if (run >= 5) return ranks[i - 4]; // höchste Karte der Straße
    } else {
      run = 1;
    }
  }
  return 0;
}

/** Wertet genau 5 Karten aus und gibt ein Array mit Werten zurück. */
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  // Count ranks
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  // Gruppen sortiert nach (Anzahl absteigend, Rang absteigend)
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

/** Alle 5er-Kombinationen eines Arrays. */
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

/** Beste 5er-Hand aus bis zu 7 Karten. */
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
