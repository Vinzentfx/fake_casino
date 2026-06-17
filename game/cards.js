"use strict";

/**
 * Card deck utilities. A card is { rank: 2..14, suit: "s"|"h"|"d"|"c" }.
 * Rank 11=J, 12=Q, 13=K, 14=A.
 */

const crypto = require("crypto");

const SUITS = ["s", "h", "d", "c"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABEL = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};
const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher–Yates shuffle using a cryptographically strong RNG. */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardStr(card) {
  return RANK_LABEL[card.rank] + SUIT_SYMBOL[card.suit];
}

module.exports = { SUITS, RANKS, RANK_LABEL, SUIT_SYMBOL, makeDeck, shuffle, cardStr };
