"use strict";

// Ein schwankender Marktwert darf aus einem Haus keine Chip-Druckmaschine
// machen. Relevant sind nur tatsächlich gezahlte Chips, einschließlich
// Ausbau und Ortsteilabgabe. IPO-Erlöse zählen bereits als Rückzahlung.
function basisOf(holding, fallbackValue) {
  const n = Number(holding && holding.costBasis);
  return Number.isSafeInteger(n) && n > 0 ? n : Math.max(0, Math.floor(Number(fallbackValue) || 0));
}

function recoveredOf(holding) {
  const n = Number(holding && holding.capitalRecovered);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function sellPayout(holding, marketValue) {
  const market = Math.max(0, Math.round(Number(marketValue) || 0));
  const invested = basisOf(holding, market);
  return Math.max(0, Math.min(Math.round(market * 0.9), Math.floor(invested * 0.9 - recoveredOf(holding))));
}

function takeoverPayout(holding, marketValue) {
  const market = Math.max(0, Math.round(Number(marketValue) || 0));
  return Math.max(0, Math.min(market, basisOf(holding, market) - recoveredOf(holding)));
}

function ipoRaise(holding, marketValue) {
  const market = Math.max(0, Math.round(Number(marketValue) || 0));
  const remaining = Math.max(0, basisOf(holding, market) - recoveredOf(holding));
  return Math.max(0, Math.min(Math.round(market * 0.5), Math.floor(remaining * 0.5)));
}

module.exports = { basisOf, recoveredOf, sellPayout, takeoverPayout, ipoRaise };
