"use strict";

/**
 * Klondike-Solitär, reine Spiellogik, entschieden auf dem Server.
 *
 * Karte: { r: 1..13, s: 0..3 }, Farben 0=♠ 1=♥ 2=♦ 3=♣ (♥♦ rot, ♠♣ schwarz).
 * Zustand:
 *   stock        verdeckter Nachziehstapel (Array, oben = letztes)
 *   waste        offener Ablagestapel (Array, oben = letztes)
 *   foundations  4 Zielstapel, je Farbe aufsteigend (A bis K)
 *   tableau      7 Stapel aus { card, up } (von unten nach oben)
 *   draw         1 oder 3 Karten je Nachziehen
 *   recycles     wie oft der Ablagestapel noch zurück auf den Nachziehstapel darf
 *
 * Nach außen gibt es nur erlaubte Züge, jede Änderung prüft die Klondike-Regeln.
 * Die öffentliche Sicht versteckt verdeckte Karten, der Client kennt sie also nie vorher.
 */

const crypto = require("crypto");

const isRed = (s) => s === 1 || s === 2;
const sameColor = (a, b) => isRed(a.s) === isRed(b.s);

function makeDeck(seedShuffle) {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Neues Spiel geben. `deck` optional (für gleiche Karten im PvP), sonst zufällig. */
function deal(opts = {}) {
  const deck = opts.deck ? opts.deck.map((c) => ({ ...c })) : makeDeck();
  const tableau = [[], [], [], [], [], [], []];
  let k = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      tableau[col].push({ card: deck[k++], up: row === col });
    }
  }
  const stock = deck.slice(k).map((card) => card); // remaining 24
  return {
    stock, waste: [], foundations: [[], [], [], []], tableau,
    draw: opts.draw === 3 ? 3 : 1,
    recycles: Number.isInteger(opts.recycles) ? opts.recycles : Infinity,
    moves: 0,
  };
}

const topOf = (pile) => (pile.length ? pile[pile.length - 1] : null);

function canToFoundation(card, foundation) {
  const t = topOf(foundation);
  if (!t) return card.r === 1;            // leer: nur ein Ass
  return t.s === card.s && card.r === t.r + 1;
}
function foundationForSuit(state, s) {
  // Jede Farbe hat einen festen Zielstapel = Farbe (einfach und stabil).
  return state.foundations[s];
}
function canOntoTableau(card, pile) {
  const t = topOf(pile);
  if (!t) return card.r === 13;           // leer: nur ein König
  return t.up && !sameColor(card, t.card) && card.r === t.card.r - 1;
}

// --- Züge ---
/** Vom Nachziehstapel ziehen (oder den Ablagestapel umdrehen, wenn der leer ist). */
function drawStock(state) {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return { ok: false, error: "Stapel leer." };
    if (state.recycles <= 0) return { ok: false, error: "Keine Neuauflage mehr." };
    state.recycles -= 1;
    state.stock = state.waste.reverse();
    state.waste = [];
    state.moves++;
    return { ok: true };
  }
  const n = Math.min(state.draw, state.stock.length);
  for (let i = 0; i < n; i++) state.waste.push(state.stock.pop());
  state.moves++;
  return { ok: true };
}

/** Oberste Karte der Ablage auf einen Zielstapel. */
function wasteToFoundation(state) {
  const card = topOf(state.waste);
  if (!card) return { ok: false, error: "Ablage leer." };
  const f = foundationForSuit(state, card.s);
  if (!canToFoundation(card, f)) return { ok: false, error: "Passt nicht auf die Basis." };
  f.push(state.waste.pop());
  state.moves++;
  return { ok: true };
}

/** Oberste Karte der Ablage auf einen Tableau-Stapel. */
function wasteToTableau(state, col) {
  const pile = state.tableau[col];
  if (!pile) return { ok: false, error: "Ungültige Spalte." };
  const card = topOf(state.waste);
  if (!card) return { ok: false, error: "Ablage leer." };
  if (!canOntoTableau(card, pile)) return { ok: false, error: "Passt nicht." };
  pile.push({ card: state.waste.pop(), up: true });
  state.moves++;
  return { ok: true };
}

/** Oberste Karte eines Tableau-Stapels auf ihren Zielstapel. */
function tableauToFoundation(state, col) {
  const pile = state.tableau[col];
  if (!pile || !pile.length) return { ok: false, error: "Leer." };
  const top = topOf(pile);
  if (!top.up) return { ok: false, error: "Karte verdeckt." };
  const f = foundationForSuit(state, top.card.s);
  if (!canToFoundation(top.card, f)) return { ok: false, error: "Passt nicht auf die Basis." };
  f.push(pile.pop().card);
  flipExposed(pile);
  state.moves++;
  return { ok: true };
}

/** Eine Folge offener Karten von einem Tableau-Stapel auf einen anderen. */
function tableauToTableau(state, from, to, count) {
  const src = state.tableau[from], dst = state.tableau[to];
  if (!src || !dst || from === to) return { ok: false, error: "Ungültiger Zug." };
  count = Math.floor(Number(count)) || 1;
  if (count < 1 || count > src.length) return { ok: false, error: "Ungültige Anzahl." };
  const slice = src.slice(src.length - count);
  if (!slice.every((c) => c.up)) return { ok: false, error: "Verdeckte Karte im Stapel." };
  // Das Stück muss selbst eine gültige absteigende Folge mit wechselnden Farben sein.
  for (let i = 0; i < slice.length - 1; i++) {
    const a = slice[i].card, b = slice[i + 1].card;
    if (sameColor(a, b) || b.r !== a.r - 1) return { ok: false, error: "Ungültige Kartenfolge." };
  }
  if (!canOntoTableau(slice[0].card, dst)) return { ok: false, error: "Passt nicht." };
  dst.push(...src.splice(src.length - count, count));
  flipExposed(src);
  state.moves++;
  return { ok: true };
}

/** Oberste Karte eines Zielstapels zurück auf einen Tableau-Stapel. */
function foundationToTableau(state, s, to) {
  const f = state.foundations[s], dst = state.tableau[to];
  if (!f || !f.length || !dst) return { ok: false, error: "Ungültig." };
  const card = topOf(f);
  if (!canOntoTableau(card, dst)) return { ok: false, error: "Passt nicht." };
  dst.push({ card: f.pop(), up: true });
  state.moves++;
  return { ok: true };
}

function flipExposed(pile) {
  const t = topOf(pile);
  if (t && !t.up) t.up = true;
}

function foundationCount(state) {
  return state.foundations.reduce((n, f) => n + f.length, 0);
}
function isWon(state) {
  return foundationCount(state) === 52;
}

/** Alles, was sicher auf einen Zielstapel kann, automatisch hochlegen ("Auto-Finish").
 * Läuft nur, wenn keine verdeckten Karten mehr liegen. */
function autoComplete(state) {
  const hasHidden = state.tableau.some((p) => p.some((c) => !c.up)) || state.stock.length || state.waste.length;
  if (hasHidden) return { ok: false, error: "Noch nicht bereit für Auto-Ablage." };
  let moved = 0, changed = true;
  while (changed && !isWon(state)) {
    changed = false;
    for (let col = 0; col < 7; col++) {
      const r = tableauToFoundation(state, col);
      if (r.ok) { moved++; changed = true; }
    }
  }
  return { ok: true, moved, won: isWon(state) };
}

/** Sicht für den Client: verdeckte Karten sind null. */
function publicView(state) {
  return {
    stockCount: state.stock.length,
    waste: state.waste.slice(-3), // es zählen nur die paar sichtbaren oben
    wasteCount: state.waste.length,
    foundations: state.foundations.map((f) => (f.length ? f[f.length - 1] : null)),
    foundationCounts: state.foundations.map((f) => f.length),
    tableau: state.tableau.map((pile) => pile.map((c) => (c.up ? { r: c.card.r, s: c.card.s, up: true } : { up: false }))),
    draw: state.draw,
    recycles: state.recycles === Infinity ? null : state.recycles,
    moves: state.moves,
    foundationTotal: foundationCount(state),
    won: isWon(state),
  };
}

module.exports = {
  deal, drawStock, wasteToFoundation, wasteToTableau, tableauToFoundation,
  tableauToTableau, foundationToTableau, autoComplete, publicView,
  isWon, foundationCount, canToFoundation, canOntoTableau, makeDeck,
};
