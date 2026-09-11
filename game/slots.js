"use strict";

/**
 * Slots, komplett auf dem Server.
 *
 * Zufall und Kontostand liegen beim Server: der Client schickt einen Einsatz,
 * der Server würfelt das Raster, wertet aus, bucht und schickt ein fertiges
 * Ergebnis zurück, das der Client nur noch animiert.
 *
 * Die Automaten sind Konfiguration und teilen sich vier Auswertungen:
 *   lines     feste Gewinnlinien von links, Wild ersetzt
 *   anywhere  ab N gleichen Symbolen irgendwo im Raster (Wild ersetzt)
 *   ways      N-Ways (Produkt der Treffer je Walze in Folge)
 *   cluster   zusammenhängende Gruppen ab 5, mit nachrutschenden Walzen
 *
 * Intern ist jeder Gewinn `unit * payMultiplier` mit unit = Einsatz / 20.
 * So bleiben die Automaten vergleichbar, egal wie viele Linien sie haben.
 */

const crypto = require("crypto");
const liveops = require("./liveops");

// ---------------------------------------------------------------------------
// Machine definitions
// ---------------------------------------------------------------------------

const BET_LEVELS = [10, 20, 50, 100, 250, 500];

// Gewinnlinien für den 3x3-Automaten (Zeile je Spalte).
const LINES_3x3 = [
  [1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0],
];

// 20 Gewinnlinien für den 5x3-Automaten.
const LINES_5x3 = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [0, 2, 0, 2, 0],
];

// 10 Gewinnlinien für den 5x4-Automaten (Zeilen 0 bis 3).
const LINES_5x4 = [
  [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3], [0, 1, 2, 3, 3],
  [3, 2, 1, 0, 0], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
];

const CASCADE_MULT = [1, 2, 3, 5, 8, 12]; // Multiplikator je Kaskadenschritt (Grundspiel)

const MACHINES = [
  {
    id: "lucky7",
    name: "Lucky 7s",
    tagline: "Klassisch · 3×3 · zahlt überall",
    theme: "classic",
    cols: 3,
    rows: 3,
    mode: "anywhere",
    minMatch: 3,
    wild: "W",
    scatter: null,
    unlockCost: 0,
    bets: [50, 100, 500, 1000, 5000, 25000],
    payScale: 3.12, // ~98% RTP incl. jackpot expectation (small buff)
    // "Pays anywhere": 3 gleiche Symbole irgendwo im Raster gewinnen. Viele
    // kleine, häufige Gewinne, also ständig Geblinke (die Casino-Parodie).
    symbols: {
      cherry: { emoji: "🍒", weight: 28 },
      lemon: { emoji: "🍋", weight: 24 },
      orange: { emoji: "🍊", weight: 20 },
      grape: { emoji: "🍇", weight: 16 },
      bell: { emoji: "🔔", weight: 12 },
      gem: { emoji: "💎", weight: 8 },
      seven: { emoji: "7️⃣", weight: 5 },
      W: { emoji: "⭐", weight: 4 },
    },
    pays: {
      cherry: { 3: 1, 4: 2, 5: 6, 6: 16, 7: 40 },
      lemon: { 3: 1.5, 4: 3, 5: 8, 6: 20, 7: 50 },
      orange: { 3: 2, 4: 4, 5: 11, 6: 28, 7: 70 },
      grape: { 3: 3, 4: 7, 5: 16, 6: 40, 7: 100 },
      bell: { 3: 5, 4: 12, 5: 28, 6: 70, 7: 180 },
      gem: { 3: 9, 4: 22, 5: 55, 6: 140, 7: 350 },
      seven: { 3: 18, 4: 50, 5: 150, 6: 400, 7: 777 },
    },
  },
  {
    id: "gemstorm",
    name: "Gem Storm",
    tagline: "5×3 · 20 Linien · Freispiele",
    theme: "gems",
    cols: 5,
    rows: 3,
    mode: "lines",
    lines: LINES_5x3,
    minMatch: 3,
    wild: "W",
    scatter: "S",
    unlockCost: 10000,
    bets: [100, 500, 1000, 5000, 25000, 100000],
    payScale: 1.36, // ~98% RTP incl. scaling free spins + jackpot expectation (small buff)
    freeSpins: { trigger: 3, count: 10, multiplier: 2 },
    buyBonus: 18, // Freispiele kaufen kostet 18× Einsatz
    symbols: {
      blue: { emoji: "💙", weight: 28 },
      green: { emoji: "💚", weight: 24 },
      orange: { emoji: "🧡", weight: 20 },
      purple: { emoji: "💜", weight: 18 },
      red: { emoji: "❤️", weight: 14 },
      crown: { emoji: "👑", weight: 8 },
      W: { emoji: "💎", weight: 5 },
      S: { emoji: "🌟", weight: 5 },
    },
    pays: {
      blue: { 3: 3, 4: 9, 5: 25 },
      green: { 3: 4, 4: 11, 5: 30 },
      orange: { 3: 6, 4: 15, 5: 40 },
      purple: { 3: 8, 4: 20, 5: 55 },
      red: { 3: 11, 4: 30, 5: 80 },
      crown: { 3: 22, 4: 65, 5: 190 },
      W: { 3: 30, 4: 120, 5: 400 },
    },
  },
  // Dragon's Hoard ist vorübergehend aus dem Sortiment genommen (2026-07-10,
  // User-Wunsch). Definition bleibt zum Reaktivieren erhalten:
  // { id: "dragon", name: "Dragon's Hoard", tagline: "5×4 · 10 Linien · Hochvolatil",
  //   theme: "dragon", cols: 5, rows: 4, mode: "lines", lines: LINES_5x4, minMatch: 3,
  //   wild: "W", scatter: "S", unlockCost: 50000,
  //   bets: [500, 1000, 5000, 25000, 100000, 250000], payScale: 1.03,
  //   freeSpins: { trigger: 3, count: 8, multiplier: 3 }, buyBonus: 14,
  //   symbols: { coin: { emoji: "Chips", weight: 28 }, sword: { emoji: "🗡️", weight: 24 },
  //     shield: { emoji: "🛡️", weight: 20 }, ring: { emoji: "💍", weight: 16 },
  //     chest: { emoji: "💰", weight: 12 }, dragon: { emoji: "🐲", weight: 8 },
  //     W: { emoji: "🐉", weight: 5 }, S: { emoji: "🔥", weight: 5 } },
  //   pays: { coin: { 3: 2, 4: 10, 5: 45 }, sword: { 3: 3, 4: 13, 5: 60 },
  //     shield: { 3: 4, 4: 17, 5: 90 }, ring: { 3: 6, 4: 26, 5: 140 },
  //     chest: { 3: 10, 4: 50, 5: 240 }, dragon: { 3: 25, 4: 130, 5: 600 },
  //     W: { 3: 40, 4: 220, 5: 900 } } },
  {
    id: "algae",
    name: "Algen Abyss",
    tagline: "5×4 · Mystery-Algen · Nudge & Reveal",
    theme: "algae",
    cols: 5,
    rows: 4,
    mode: "ways",
    minMatch: 3,
    wild: "W",
    scatter: "S",
    mystery: "M",
    golden: "G",
    unlockCost: 120000,
    bets: [500, 1000, 5000, 25000, 100000, 250000],
    payScale: 0.058,
    freeSpins: { trigger: 3, count: 4, extra: 1, persistentMultiplier: true },
    // Kein Bonus-Kauf: Freispiele nur echt erspielbar (Bonus-EV ≈ 48× wäre
    // als Kauf entweder Exploit oder unattraktiv teuer).
    symbols: {
      anchor: { emoji: "⚓", asset: "/assets/slots/algae/symbols/anchor.webp", weight: 48 },
      puffer: { emoji: "🐡", asset: "/assets/slots/algae/symbols/puffer.webp", weight: 44 },
      crystal: { emoji: "💎", asset: "/assets/slots/algae/symbols/crystal.webp", weight: 40 },
      pearl: { emoji: "🦪", asset: "/assets/slots/algae/symbols/pearl.webp", weight: 32 },
      helmet: { emoji: "🤿", asset: "/assets/slots/algae/symbols/helmet.webp", weight: 26 },
      chest: { emoji: "🧰", asset: "/assets/slots/algae/symbols/chest.webp", weight: 18 },
      shark: { emoji: "🦈", asset: "/assets/slots/algae/symbols/shark.webp", weight: 12 },
      W: { emoji: "🔱", asset: "/assets/slots/algae/symbols/wild.webp", weight: 8 },
      S: { emoji: "🐚", asset: "/assets/slots/algae/symbols/bonus.webp", weight: 5 },
      M: { emoji: "🌿", asset: "/assets/slots/algae/symbols/algae.webp", weight: 2 },
      G: { emoji: "🦈", asset: "/assets/slots/algae/symbols/golden-shark.webp", weight: 0 },
    },
    // Unisono-Reveal: alle Mystery-Zellen eines Spins decken dasselbe Symbol
    // auf, oder der ganze Stack wird zu Golden Sharks (goldenChance in %).
    unisonReveals: [
      ["anchor", 24], ["puffer", 22], ["crystal", 18], ["pearl", 12],
      ["helmet", 8], ["chest", 5], ["shark", 3], ["W", 2],
    ],
    goldenChance: 7,
    // Golden-Shark-Münzen: [Wert in ×Einsatz, Gewicht]. Bronze <10, Silber
    // 10-50, Gold 100+ (Tier = reine Optik, der Wert zählt).
    coinValues: [
      [1, 20000], [2, 6000], [3, 2500], [5, 1200], [10, 380], [25, 120],
      [50, 45], [100, 12], [250, 5], [500, 2], [1000, 1], [2500, 1],
    ],
    minWin: 0.25, // jeder Treffer zahlt mindestens 0,25× Einsatz (Anti-Krümel)
    coinScatterChance: 6, // % je Golden-Position (nur 1. Welle): Scatter statt Münze
    // Low-Symbole zahlen bei 3 Walzen nur symbolisch (der minWin-Floor hebt
    // das auf 0,25× an). So fühlt sich ein Reveal mit 3er-Treffer nie "leer"
    // an, ohne dass Krümel-Beträge angezeigt werden.
    pays: {
      anchor: { 3: 3, 4: 10, 5: 30 },
      puffer: { 3: 3.5, 4: 12, 5: 38 },
      crystal: { 3: 4, 4: 15, 5: 48 },
      pearl: { 3: 8, 4: 22, 5: 70 },
      helmet: { 3: 11, 4: 32, 5: 100 },
      chest: { 3: 16, 4: 52, 5: 180 },
      shark: { 3: 30, 4: 120, 5: 500 },
      W: { 3: 42, 4: 170, 5: 750 },
    },
  },
  // Cosmic Cluster ist vorübergehend aus dem Sortiment genommen (2026-07-10,
  // ersetzt durch Book of Rah). Definition bleibt zum Reaktivieren erhalten:
  // { id: "cosmic", name: "Cosmic Cluster", tagline: "6×5 · Cluster · Kaskaden",
  //   theme: "cosmic", cols: 6, rows: 5, mode: "cluster", minCluster: 5,
  //   wild: "W", scatter: "S", unlockCost: 200000,
  //   bets: [1000, 5000, 25000, 100000, 250000, 1000000], payScale: 3.25,
  //   freeSpins: { trigger: 4, count: 10, persistentMultiplier: true }, buyBonus: 25,
  //   symbols: { planet: { emoji: "🪐", weight: 24 }, moon: { emoji: "🌙", weight: 22 },
  //     comet: { emoji: "☄️", weight: 20 }, earth: { emoji: "🌍", weight: 16 },
  //     alien: { emoji: "👽", weight: 12 }, ufo: { emoji: "🛸", weight: 8 },
  //     W: { emoji: "🌟", weight: 5 }, S: { emoji: "🌌", weight: 4 } },
  //   clusterPays: { planet: { 5: 1.5, 7: 3, 9: 6, 12: 18 }, moon: { 5: 2, 7: 4, 9: 8, 12: 24 },
  //     comet: { 5: 2.5, 7: 5, 9: 12, 12: 35 }, earth: { 5: 3, 7: 6, 9: 14, 12: 45 },
  //     alien: { 5: 4, 7: 8, 9: 18, 12: 60 }, ufo: { 5: 6, 7: 14, 9: 35, 12: 120 } } },
  {
    id: "pharaoh",
    name: "Book of Rah",
    tagline: "5×3 · 10 Linien · Expandierendes Bonussymbol",
    theme: "pharaoh",
    cols: 5,
    rows: 3,
    mode: "lines",
    lines: LINES_5x3.slice(0, 10),
    minMatch: 3,
    // Das BUCH ist Wild und Scatter zugleich: Es ersetzt jedes Symbol,
    // zahlt ab 2 Stück irgendwo (bookPays × Gesamteinsatz) und 3+ starten
    // die Freispiele mit expandierendem Bonussymbol.
    wild: "B",
    scatter: "B",
    unlockCost: 120000,
    bets: [500, 1000, 5000, 25000, 100000, 250000],
    payScale: 4.85, // ~98,5 % RTP (2 Mio. Drehs simuliert), der großzügigste Automat im Haus
    freeSpins: { trigger: 3, count: 10, extra: 0 },
    expandingSpecial: true, // Freispiele mit zufälligem expandierendem Symbol
    gamble: { maxSteps: 5 }, // Risiko: Gewinn auf Kartenfarbe verdoppeln
    symbols: {
      "10": { emoji: "🔟", asset: "/assets/slots/pharaoh/symbols/10.webp", weight: 24 },
      j: { emoji: "🇯", asset: "/assets/slots/pharaoh/symbols/j.webp", weight: 24 },
      q: { emoji: "🇶", asset: "/assets/slots/pharaoh/symbols/q.webp", weight: 22 },
      k: { emoji: "🇰", asset: "/assets/slots/pharaoh/symbols/k.webp", weight: 20 },
      a: { emoji: "🇦", asset: "/assets/slots/pharaoh/symbols/a.webp", weight: 18 },
      scarab: { emoji: "🪲", asset: "/assets/slots/pharaoh/symbols/scarab.webp", weight: 12 },
      anubis: { emoji: "🐕", asset: "/assets/slots/pharaoh/symbols/anubis.webp", weight: 12 },
      queen: { emoji: "👸", asset: "/assets/slots/pharaoh/symbols/queen.webp", weight: 10 },
      pharaoh: { emoji: "🤴", asset: "/assets/slots/pharaoh/symbols/pharaoh.webp", weight: 8 },
      explorer: { emoji: "🤠", asset: "/assets/slots/pharaoh/symbols/explorer.webp", weight: 6 },
      B: { emoji: "📖", asset: "/assets/slots/pharaoh/symbols/book.webp", weight: 5 },
    },
    // Buch-Scatter-Auszahlung in × Gesamteinsatz (unabhängig von payScale).
    bookPays: { 2: 0.5, 3: 1.5, 4: 15, 5: 150 },
    pays: {
      "10": { 3: 3, 4: 12, 5: 60 },
      j: { 3: 3, 4: 12, 5: 60 },
      q: { 3: 3, 4: 15, 5: 75 },
      k: { 3: 3, 4: 15, 5: 75 },
      a: { 3: 4, 4: 18, 5: 90 },
      scarab: { 3: 6, 4: 20, 5: 130 },
      anubis: { 3: 6, 4: 20, 5: 130 },
      queen: { 3: 8, 4: 40, 5: 200 },
      pharaoh: { 3: 12, 4: 70, 5: 350 },
      explorer: { 3: 20, 4: 150, 5: 900 },
    },
  },
];

const MACHINE_BY_ID = Object.fromEntries(MACHINES.map((m) => [m.id, m]));

/** Sicht auf alle Automaten für den Client (ohne Gewichte, die wären aber auch harmlos). */
function publicMachines() {
  return MACHINES.map((m) => ({
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    theme: m.theme,
    cols: m.cols,
    rows: m.rows,
    mode: m.mode,
    wild: m.wild,
    scatter: m.scatter || null,
    freeSpins: m.freeSpins || null,
    buyBonus: m.buyBonus || null,
    unlockCost: m.unlockCost || 0,
    bets: m.bets,
    emojis: Object.fromEntries(Object.entries(m.symbols).map(([k, v]) => [k, v.emoji])),
    assets: Object.fromEntries(Object.entries(m.symbols).filter(([, v]) => v.asset).map(([k, v]) => [k, v.asset])),
    mystery: m.mystery || null,
    bookPays: m.bookPays || null,
    gamble: m.gamble ? { maxSteps: m.gamble.maxSteps || 5 } : null,
    lineCount: m.lines ? m.lines.length : 0,
    payKeys: Object.keys(m.pays || m.clusterPays || {}),
    // Auszahlungen als Vielfaches des Gesamteinsatzes (für die Gewinntabelle im Spiel).
    pays: m.pays || null,
    clusterPays: m.clusterPays || null,
    payScale: m.payScale || 1,
  }));
}

// ---------------------------------------------------------------------------
// Spinning & evaluation
// ---------------------------------------------------------------------------

function weightedPick(machine) {
  const entries = Object.entries(machine.symbols);
  const total = entries.reduce((s, [, v]) => s + v.weight, 0);
  let r = crypto.randomInt(total);
  for (const [key, v] of entries) {
    if (r < v.weight) return key;
    r -= v.weight;
  }
  return entries[0][0];
}

function weightedPickEntries(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = crypto.randomInt(total);
  for (const [key, weight] of entries) {
    if (r < weight) return key;
    r -= weight;
  }
  return entries[0][0];
}

function cloneGrid(grid) {
  return grid.map((col) => col.slice());
}

function isAlgae(machine) {
  return machine && machine.id === "algae";
}

function prepareMysteryGrid(machine, grid, session, inFree) {
  if (!isAlgae(machine)) return grid;
  const out = cloneGrid(grid);
  if (inFree) {
    // Freispiele: Stacks auf Walze 2+4 rutschen pro Spin eine Zeile nach
    // unten aus dem Bild. Resthöhe = verbleibende Spins (unten ausgerichtet);
    // Retrigger (+Spins) schieben den Stack wieder hoch.
    const height = Math.min(machine.rows, ((session && session.remaining) || 0) + 1);
    for (const c of [1, 3]) for (let r = machine.rows - height; r < machine.rows; r++) out[c][r] = machine.mystery;
    return out;
  }
  const stackCols = [];
  for (let c = 0; c < machine.cols; c++) {
    if (out[c].includes(machine.mystery)) stackCols.push(c);
  }
  for (const c of stackCols.slice(0, 2)) for (let r = 0; r < machine.rows; r++) out[c][r] = machine.mystery;
  for (const c of stackCols.slice(2)) for (let r = 0; r < machine.rows; r++) if (out[c][r] === machine.mystery) out[c][r] = weightedPickNonMystery(machine);
  return out;
}

function weightedPickNonMystery(machine) {
  for (let i = 0; i < 20; i++) {
    const s = weightedPick(machine);
    if (s !== machine.mystery && s !== machine.golden) return s;
  }
  return Object.keys(machine.symbols).find((s) => s !== machine.mystery && s !== machine.golden) || Object.keys(machine.symbols)[0];
}

function coinTier(value) {
  return value >= 100 ? "gold" : value >= 10 ? "silver" : "bronze";
}

/** Expandierendes Bonussymbol ziehen: gewichtet nach Symbol-Häufigkeit
 *  (häufige Lows öfter, das Top-Symbol selten, so bleibt der Traum-Bonus
 *  selten und wertvoll). */
function pickSpecial(machine) {
  const entries = Object.keys(machine.pays)
    .map((s) => [s, machine.symbols[s] ? machine.symbols[s].weight : 1]);
  return weightedPickEntries(entries);
}

/**
 * Unisono-Reveal + Nudge & Reveal.
 * alle Mystery-Zellen eines Spins decken gemeinsam ein Symbol auf, oder
 * (goldenChance) der ganze Stack wird zu Golden Sharks. Golden Sharks laufen
 * dann als Nudge-Sequenz: pro Welle deckt jede sichtbare Golden-Position eine
 * Münze (Wert × Einsatz × aktueller Multiplikator) oder (nur in Welle 1)
 * einen Scatter auf; danach rutscht der Stack eine Zeile nach unten und der
 * Multiplikator steigt um +1, bis der Stack aus dem Bild ist.
 * Rückgabe: { grid, displayGrid, reveal, instantWin, nudges }.
 */
function applyReveal(machine, grid, bet, startMult) {
  const none = { grid, displayGrid: null, reveal: null, instantWin: 0, nudges: 0 };
  if (!machine.mystery || !machine.unisonReveals) return none;
  const cells = [];
  for (let c = 0; c < machine.cols; c++)
    for (let r = 0; r < machine.rows; r++)
      if (grid[c][r] === machine.mystery) cells.push([c, r]);
  if (!cells.length) return none;

  const displayGrid = cloneGrid(grid);
  const finalGrid = cloneGrid(grid);

  if (crypto.randomInt(100) >= (machine.goldenChance || 0)) {
    const symbol = weightedPickEntries(machine.unisonReveals);
    for (const [c, r] of cells) finalGrid[c][r] = symbol;
    return { grid: finalGrid, displayGrid, reveal: { kind: "symbol", symbol, cells }, instantWin: 0, nudges: 0 };
  }

  // Golden Sharks: Stack-Positionen je Spalte (oben → unten sortiert).
  const live = new Map();
  for (const [c, r] of cells) {
    if (!live.has(c)) live.set(c, []);
    live.get(c).push(r);
  }
  for (const rs of live.values()) rs.sort((a, b) => a - b);

  let mult = Math.max(1, startMult || 1);
  let instantWin = 0;
  let nudges = 0;
  const waves = [];

  // Beim Aufdecken des Stacks können einzelne Positionen Scatter zeigen,
  // sie verlassen den Golden-Stack und bleiben als Scatter liegen.
  const scatters0 = [];
  for (const [c, rs] of live) {
    for (let i = 0; i < rs.length; i++) {
      if (machine.coinScatterChance && crypto.randomInt(100) < machine.coinScatterChance) {
        finalGrid[c][rs[i]] = machine.scatter;
        scatters0.push([c, rs[i]]);
        rs.splice(i, 1);
        i--;
      }
    }
  }

  // Nudge-Wellen: Jeder Golden Shark trägt eine Münze. Pro Nudge zahlt die
  // unterste Reihe (Wert × Einsatz × aktueller Multiplikator), dann rutscht
  // der Stack ab und der Multiplikator steigt um +1, die oberen Münzen sind
  // also mehr wert.
  while ([...live.values()].some((rs) => rs.length)) {
    const coins = [];
    for (const [c, rs] of live) {
      if (!rs.length) continue;
      const r = rs.pop(); // unterste Position dieser Spalte
      const value = Number(weightedPickEntries(machine.coinValues.map(([v, w]) => [String(v), w])));
      const win = Math.round(bet * value * mult);
      instantWin += win;
      coins.push({ c, r, value, tier: coinTier(value), win });
    }
    waves.push({ mult, coins, scatters: nudges === 0 ? scatters0 : [] });
    mult += 1;
    nudges += 1;
    if (nudges > machine.rows + 1) break; // Sicherheitsnetz
  }
  if (!waves.length && scatters0.length) waves.push({ mult, coins: [], scatters: scatters0 });

  // Golden-Spalten im Endraster mit frischen Symbolen auffüllen.
  for (let c = 0; c < machine.cols; c++)
    for (let r = 0; r < machine.rows; r++)
      if (finalGrid[c][r] === machine.mystery) finalGrid[c][r] = weightedPickNonMystery(machine);

  return {
    grid: finalGrid,
    displayGrid,
    reveal: { kind: "golden", columns: [...live.keys()], waves },
    instantWin,
    nudges,
  };
}

/** grid[col][row] */
function spinGrid(machine) {
  const grid = [];
  for (let c = 0; c < machine.cols; c++) {
    const col = [];
    for (let r = 0; r < machine.rows; r++) col.push(weightedPick(machine));
    grid.push(col);
  }
  return grid;
}

// --- Progressiver Gemeinschafts-Jackpot ---
// 0,5 % jedes bezahlten Drehs im Grundspiel gehen in einen gemeinsamen Topf, und
// jeder bezahlte Dreh hat eine Chance proportional zum Einsatz (im Schnitt ein
// Treffer je ~50 Mio. Einsatz, der Topf liegt dann um 250k). Kommt aus den Einsätzen, die RTP bleibt unter 100 %.
const path = require("path");
const fs = require("fs");
const JP_FILE = path.join(__dirname, "..", "data", "jackpot.json");
const JP_SEED = 10000, JP_FEED = 0.005, JP_ODDS = 50_000_000;

let jackpot = (() => {
  try { const j = JSON.parse(fs.readFileSync(JP_FILE, "utf8")); if (j && j.pot >= JP_SEED) return j; } catch {}
  return { pot: JP_SEED };
})();
function saveJackpot() {
  try { fs.mkdirSync(path.dirname(JP_FILE), { recursive: true }); fs.writeFileSync(JP_FILE, JSON.stringify(jackpot)); } catch {}
}
/** Topf füllen und auf Treffer würfeln. Gibt die Auszahlung zurück (0 = nichts). */
function jackpotSpin(bet) {
  jackpot.pot += bet * JP_FEED;
  let win = 0;
  if (crypto.randomInt(JP_ODDS) < bet) {
    win = Math.round(jackpot.pot);
    jackpot.pot = JP_SEED;
  }
  saveJackpot();
  return win;
}
const jackpotPot = () => Math.round(jackpot.pot);

// --- Admin: den größtmöglichen Wurf erzwingen (zum Vorführen der Animationen) ---
// Der Besitzer kann eine einmalige Markierung setzen. Der nächste Dreh im
// Grundspiel ist dann ein volles Raster mit dem besten Symbol, jede Linie trifft
// auf einmal ihre höchste Stufe (thresholdPay zahlt bei Überschuss die oberste).
const forcedWin = new Set(); // Konten mit scharf gestelltem Maximalgewinn

function armForceWin(key) {
  forcedWin.add(String(key).toLowerCase());
}
function consumeForceWin(key) {
  return forcedWin.delete(String(key).toLowerCase());
}

/** Pechvogel-Modus: so lange würfeln, bis ein Raster gar nichts zahlt (kein Gewinn, keine Freispiele). */
function losingGrid(machine, bet) {
  for (let i = 0; i < 300; i++) {
    const g = spinGrid(machine);
    const probe = evaluateSpin(machine, bet, null, g); // ohne Session, also ohne Nebenwirkungen
    if (probe.totalWin === 0 && probe.result.freeSpinsAwarded === 0) return cloneGrid(probe.result.grid);
  }
  return null;
}

/** Pechvogel-Modus mit Beinahe-Treffer: das Raster Richtung der seltensten
 *  teuren Symbole schieben (z. B. viele 7en bei Lucky 7s), aber nie so weit,
 *  dass es zahlt. Die typische "so knapp"-Pechsträhne. Von vielen solchen
 *  Nieten bleibt die mit den meisten Top-Symbolen. */
function teaseGrid(machine, bet) {
  const payTable = machine.pays || machine.clusterPays || {};
  const ranked = Object.keys(payTable)
    .filter((s) => s !== machine.scatter && s !== machine.wild)
    .sort((a, b) => Math.max(...Object.values(payTable[b]).map(Number)) - Math.max(...Object.values(payTable[a]).map(Number)));
  if (!ranked.length) return losingGrid(machine, bet);
  const topSyms = ranked.slice(0, 3);
  const bestSym = ranked[0];
  let best = null, bestScore = -1;
  for (let i = 0; i < 500; i++) {
    const g = [];
    for (let c = 0; c < machine.cols; c++) {
      const col = [];
      for (let r = 0; r < machine.rows; r++)
        col.push(Math.random() < 0.5 ? topSyms[crypto.randomInt(topSyms.length)] : weightedPick(machine));
      g.push(col);
    }
    const probe = evaluateSpin(machine, bet, null, g);
    if (probe.totalWin !== 0 || probe.result.freeSpinsAwarded !== 0) continue; // darf nichts zahlen
    let score = 0;
    for (const col of g) for (const s of col) if (s === bestSym) score++;
    if (score > bestScore) { best = cloneGrid(probe.result.grid); bestScore = score; }
  }
  return best || losingGrid(machine, bet);
}

/** Volles Raster mit dem bestbezahlten Symbol (ohne Scatter). */
function bestGrid(machine) {
  const pays = machine.pays || machine.clusterPays || {};
  let best = null, bestPay = -1;
  for (const [sym, table] of Object.entries(pays)) {
    if (sym === machine.scatter) continue;
    const top = Math.max(...Object.values(table).map(Number));
    if (top > bestPay) { bestPay = top; best = sym; }
  }
  if (!best) best = Object.keys(machine.symbols)[0];
  const grid = [];
  for (let c = 0; c < machine.cols; c++) grid.push(new Array(machine.rows).fill(best));
  return grid;
}

function countScatters(machine, grid) {
  if (!machine.scatter) return { count: 0, positions: [] };
  const positions = [];
  for (let c = 0; c < machine.cols; c++)
    for (let r = 0; r < machine.rows; r++)
      if (grid[c][r] === machine.scatter) positions.push([c, r]);
  return { count: positions.length, positions };
}

function evaluateLines(machine, grid, unit) {
  const wild = machine.wild;
  const wins = [];
  machine.lines.forEach((line, idx) => {
    const cells = line.map((row, col) => grid[col][row]);
    // Das zahlende Symbol: das erste, das kein Wild ist, sonst das Wild selbst.
    let symbol = cells.find((s) => s !== wild && s !== machine.scatter);
    if (symbol === undefined) symbol = wild;
    if (symbol === machine.scatter || !machine.pays[symbol]) return;
    let count = 0;
    for (const s of cells) {
      if (s === symbol || s === wild) count++;
      else break;
    }
    const pay = machine.pays[symbol][count];
    if (count >= machine.minMatch && pay) {
      wins.push({
        type: "line",
        line: idx,
        symbol,
        count,
        win: unit * pay * (machine.payScale || 1),
        positions: line.slice(0, count).map((row, col) => [col, row]),
      });
    }
  });
  return wins;
}

// Höchste Stufe, deren Schwelle <= Anzahl ist (6 gleiche zahlen also die "5+"-Stufe).
function thresholdPay(table, count) {
  let pay = 0;
  for (const k of Object.keys(table).map(Number).sort((a, b) => a - b)) if (count >= k) pay = table[k];
  return pay;
}

// "Pays anywhere": ab N gleichen Symbolen irgendwo im Raster, egal wo. Wild
// ersetzt jedes Symbol. Soll großzügig und laut sein.
function evaluateAnywhere(machine, grid, unit) {
  const wild = machine.wild;
  const wildPos = [];
  const symPos = {};
  for (let c = 0; c < machine.cols; c++)
    for (let r = 0; r < machine.rows; r++) {
      const s = grid[c][r];
      if (s === wild) wildPos.push([c, r]);
      else if (s === machine.scatter) continue;
      else (symPos[s] = symPos[s] || []).push([c, r]);
    }
  const wins = [];
  for (const sym of Object.keys(machine.pays)) {
    if (sym === wild) continue; // Wild ersetzt hier nur
    const base = symPos[sym] || [];
    const count = base.length + wildPos.length;
    if (count < machine.minMatch) continue;
    const pay = thresholdPay(machine.pays[sym], count);
    if (!pay) continue;
    wins.push({
      type: "any", symbol: sym, count,
      win: unit * pay * (machine.payScale || 1),
      positions: base.concat(wildPos),
    });
  }
  // Bigger symbol wins first → nicer escalating reveal.
  wins.sort((a, b) => b.win - a.win);
  return wins;
}

function evaluateWays(machine, grid, unit) {
  const wild = machine.wild;
  const wins = [];
  for (const symbol of Object.keys(machine.pays)) {
    let ways = 1;
    let reels = 0;
    const positions = [];
    for (let c = 0; c < machine.cols; c++) {
      const hits = [];
      for (let r = 0; r < machine.rows; r++) {
        const s = grid[c][r];
        if (s === symbol || s === wild) hits.push([c, r]);
      }
      if (hits.length === 0) break;
      ways *= hits.length;
      reels++;
      positions.push(...hits);
    }
    const pay = machine.pays[symbol][reels];
    if (reels >= machine.minMatch && pay) {
      wins.push({ type: "ways", symbol, count: reels, ways, win: unit * pay * ways * (machine.payScale || 1), positions });
    }
  }
  return wins;
}

/** Zusammenhängende Gruppen gleicher Symbole finden (waagerecht/senkrecht), Wild zählt überall mit. */
function findClusters(machine, grid) {
  const cols = machine.cols, rows = machine.rows, wild = machine.wild;
  const seen = Array.from({ length: cols }, () => new Array(rows).fill(false));
  const clusters = [];

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const sym = grid[c][r];
      if (seen[c][r] || sym === wild || sym === machine.scatter || !machine.clusterPays[sym]) continue;
      // Breitensuche über Felder mit sym oder Wild.
      const stack = [[c, r]];
      const cells = [];
      seen[c][r] = true;
      while (stack.length) {
        const [cc, rr] = stack.pop();
        cells.push([cc, rr]);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc, nr = rr + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[nc][nr]) continue;
          const ns = grid[nc][nr];
          if (ns === sym || ns === wild) {
            seen[nc][nr] = true;
            stack.push([nc, nr]);
          }
        }
      }
      if (cells.length >= machine.minCluster) clusters.push({ symbol: sym, positions: cells });
    }
  }
  return clusters;
}

function clusterPay(machine, symbol, size) {
  const table = machine.clusterPays[symbol];
  let pay = 0;
  for (const threshold of Object.keys(table).map(Number).sort((a, b) => a - b)) {
    if (size >= threshold) pay = table[threshold];
  }
  return pay;
}

/** Cluster-Automat mit Nachrutschen auswerten. Gibt { totalWin, cascades, endMultiplier } zurück. */
function evaluateCluster(machine, grid, unit, startMultiplier) {
  const cascades = [];
  let totalWin = 0;
  let step = 0;
  let multiplier = startMultiplier || 1;

  while (true) {
    const clusters = findClusters(machine, grid);
    if (clusters.length === 0) break;

    const stepMult = machine.freeSpins && machine.freeSpins.persistentMultiplier && startMultiplier
      ? multiplier
      : CASCADE_MULT[Math.min(step, CASCADE_MULT.length - 1)];

    let stepWin = 0;
    const wins = clusters.map((cl) => {
      const w = unit * clusterPay(machine, cl.symbol, cl.positions.length) * stepMult * (machine.payScale || 1);
      stepWin += w;
      return { symbol: cl.symbol, size: cl.positions.length, positions: cl.positions, win: w };
    });
    totalWin += stepWin;

    // Gewinnfelder raus, Rest nach unten rutschen lassen, oben auffüllen.
    const removed = new Set();
    for (const cl of clusters) for (const [c, r] of cl.positions) removed.add(c + ":" + r);
    const newGrid = grid.map((col) => col.slice());
    for (let c = 0; c < machine.cols; c++) {
      const survivors = [];
      for (let r = machine.rows - 1; r >= 0; r--) {
        if (!removed.has(c + ":" + r)) survivors.push(grid[c][r]);
      }
      const col = new Array(machine.rows);
      // Übrige rutschen von unten nach
      for (let i = 0; i < survivors.length; i++) col[machine.rows - 1 - i] = survivors[i];
      for (let r = machine.rows - 1 - survivors.length; r >= 0; r--) col[r] = weightedPick(machine);
      newGrid[c] = col;
    }

    cascades.push({ wins, stepWin, multiplier: stepMult, gridAfter: newGrid.map((c) => c.slice()) });
    grid = newGrid;
    step++;
    if (machine.freeSpins && machine.freeSpins.persistentMultiplier) multiplier++;
    if (step > 30) break; // Notbremse
  }

  return { totalWin, cascades, endMultiplier: multiplier };
}

// ---------------------------------------------------------------------------
// Der eigentliche Dreh, ohne Konto und ohne Buchung. Nutzen Einzelspieler-Slots
// und PvP gemeinsam. `session` sind die Freispiele für diesen Automaten (oder null).
// Gibt { result, session, spinBet, totalWin, inFree } zurück.
// ---------------------------------------------------------------------------

function evaluateSpin(machine, bet, session, forceGrid = null) {
  const inFree = !!(session && session.remaining > 0);
  const spinBet = inFree ? session.bet : bet;
  const unit = spinBet / 20;
  if (inFree) session.remaining -= 1;

  const rawGrid = prepareMysteryGrid(machine, forceGrid || spinGrid(machine), session, inFree);
  // Multiplikator vor dem Reveal (Freispiele: persistenter Session-Wert),
  // Golden-Nudges erhöhen ihn innerhalb der Sequenz weiter.
  const startMult = isAlgae(machine) && inFree && session.multiplier ? session.multiplier : 1;
  const mystery = applyReveal(machine, rawGrid, spinBet, startMult);
  const grid = mystery.grid;
  const scatters = countScatters(machine, grid);

  let wins = [];
  let cascades = null;
  let baseWin = 0;
  let endMultiplier = null;

  if (machine.mode === "lines") {
    wins = evaluateLines(machine, grid, unit);
    baseWin = wins.reduce((s, w) => s + w.win, 0);
  } else if (machine.mode === "anywhere") {
    wins = evaluateAnywhere(machine, grid, unit);
    baseWin = wins.reduce((s, w) => s + w.win, 0);
  } else if (machine.mode === "ways") {
    wins = evaluateWays(machine, grid, unit);
    baseWin = wins.reduce((s, w) => s + w.win, 0);
  } else if (machine.mode === "cluster") {
    const startMult = inFree && session.multiplier ? session.multiplier : 1;
    const res = evaluateCluster(machine, grid, unit, machine.freeSpins.persistentMultiplier ? startMult : 1);
    baseWin = res.totalWin;
    cascades = res.cascades;
    endMultiplier = res.endMultiplier;
    if (inFree && machine.freeSpins.persistentMultiplier) session.multiplier = res.endMultiplier;
  }

  // Book of Rah: Buch-Scatter zahlt ab 2 Stück irgendwo (× Gesamteinsatz) …
  if (machine.bookPays && scatters.count >= 2) {
    const bookWin = Math.round(spinBet * thresholdPay(machine.bookPays, scatters.count));
    if (bookWin > 0) {
      wins.push({ type: "book", symbol: machine.scatter, count: scatters.count, win: bookWin, positions: scatters.positions });
      baseWin += bookWin;
    }
  }
  // … und in den Freispielen expandiert das Bonussymbol: Landet es auf genug
  // Walzen, füllt es sie komplett und zahlt scatter-artig auf allen Linien.
  if (machine.expandingSpecial && inFree && session.special) {
    const special = session.special;
    const reels = [];
    for (let c = 0; c < machine.cols; c++) if (grid[c].includes(special)) reels.push(c);
    const pay = machine.pays[special] ? thresholdPay(machine.pays[special], reels.length) : 0;
    if (reels.length >= machine.minMatch && pay > 0) {
      const positions = [];
      for (const c of reels) for (let r = 0; r < machine.rows; r++) positions.push([c, r]);
      const win = Math.round(unit * pay * machine.lines.length * (machine.payScale || 1));
      wins.push({ type: "expand", symbol: special, count: reels.length, win, positions });
      baseWin += win;
    }
  }

  const fsMult = inFree && machine.freeSpins && machine.freeSpins.multiplier ? machine.freeSpins.multiplier : 1;
  // Algen: In den Freispielen zahlen Liniengewinne mit dem Multiplikator nach
  // der Nudge-Sequenz; im Basisspiel bleiben sie unmultipliziert (die Nudges
  // pumpen dort nur die Münzen). Münzen sind in instantWin bereits Welle für
  // Welle multipliziert.
  const algaeMult = isAlgae(machine) && inFree ? startMult + mystery.nudges : 1;
  let totalWin = Math.round(baseWin * fsMult * algaeMult) + mystery.instantWin;
  // Mindestgewinn: Ways-Krümel (z. B. 0,01× Einsatz) werden auf minWin×Einsatz
  // angehoben. Nie wieder "+10" bei 1.000 Einsatz. Die Einzelgewinne werden
  // mitskaliert, damit der Client-Zähler sauber auf den Endbetrag hochläuft
  // statt am Ende auf den Floor zu springen.
  if (machine.minWin && totalWin > 0 && totalWin < spinBet * machine.minWin) {
    const floored = Math.round(spinBet * machine.minWin);
    const factor = floored / totalWin;
    for (const w of wins) w.win = Math.round(w.win * factor);
    totalWin = floored;
  }

  // Trigger / retrigger free spins.
  let freeSpinsAwarded = 0;
  let newSession = session;
  if (isAlgae(machine) && inFree) {
    // In den Freispielen zählt jeder Scatter: +1 Spin (Stack rutscht wieder hoch).
    freeSpinsAwarded = scatters.count;
    session.remaining += freeSpinsAwarded;
  } else if (machine.freeSpins && scatters.count >= machine.freeSpins.trigger) {
    // Mehr Scatter als nötig geben mehr Freispiele (z. B. 3→10, 4→15, 5→20 …).
    const fs = machine.freeSpins;
    const extra = fs.extra != null ? fs.extra : Math.round(fs.count / 2);
    freeSpinsAwarded = fs.count + Math.max(0, scatters.count - fs.trigger) * extra;
    if (inFree) {
      session.remaining += freeSpinsAwarded;
    } else {
      newSession = {
        machineId: machine.id,
        remaining: freeSpinsAwarded,
        bet: spinBet,
        multiplier: machine.freeSpins.persistentMultiplier ? 1 : machine.freeSpins.multiplier,
        // Book of Rah: ein zufälliges Bonussymbol für die ganze Freispiel-
        // Serie (gewichtet nach Häufigkeit: Lows öfter, Explorer selten).
        special: machine.expandingSpecial ? pickSpecial(machine) : undefined,
      };
    }
  }
  if (isAlgae(machine) && inFree && newSession) {
    // Persistenter Bonus-Multiplikator: +1 pro Spin (die Stacks nudgen) plus
    // die Golden-Nudges der Sequenz. Kein Cap. Das ist der Razor-Kick.
    newSession.multiplier = startMult + mystery.nudges + 1;
  }
  if (newSession && newSession.remaining <= 0) newSession = null;

  const freeState = newSession && newSession.remaining > 0
    ? { active: true, remaining: newSession.remaining, multiplier: newSession.multiplier, special: newSession.special || null }
    : { active: false, remaining: 0, multiplier: 1 };

  const result = {
    ok: true,
    grid,
    displayGrid: mystery.displayGrid,
    reveal: mystery.reveal,
    instantWin: mystery.instantWin,
    wins,
    cascades,
    scatterCount: scatters.count,
    scatterPositions: scatters.positions,
    bet: spinBet,
    totalWin,
    multiplier: algaeMult !== 1 ? algaeMult : fsMult !== 1 ? fsMult : endMultiplier || 1,
    wasFreeSpin: inFree,
    freeSpinsAwarded,
    freeSpins: freeState,
  };
  return { result, session: newSession, spinBet, totalWin, inFree };
}

// ---------------------------------------------------------------------------
// Socket wiring (single-player, account-backed)
// ---------------------------------------------------------------------------

function setupSlots(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("slots:machines", (ack) => ack && ack({ machines: publicMachines(), jackpot: jackpotPot() }));

    // Automaten für das angemeldete Konto freischalten.
    socket.on("slots:unlock", ({ machineId } = {}, ack) => {
      if (!ack) return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const machine = MACHINE_BY_ID[machineId];
      if (!machine) return ack({ ok: false, error: "Unbekannter Automat." });
      const res = accounts.unlock(socket.data.account, machineId, machine.unlockCost || 0);
      if (!res.ok) return ack(res);
      ack({ ok: true, account: res.account });
    });

    socket.on("slots:spin", ({ machineId, bet } = {}, ack) => {
      if (!ack) return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const machine = MACHINE_BY_ID[machineId];
      if (!machine) return ack({ ok: false, error: "Unbekannter Automat." });
      if (!accounts.isUnlocked(socket.data.account, machineId)) return ack({ ok: false, error: "Automat noch nicht freigeschaltet." });

      const sess = socket.data.slots;
      const session = sess && sess.machineId === machineId && sess.remaining > 0 ? sess : null;
      const inFree = !!session;

      bet = Math.floor(Number(bet));
      if (!inFree && !machine.bets.includes(bet)) return ack({ ok: false, error: "Ungültiger Einsatz." });

      const spinBet = inFree ? session.bet : bet;

      // Einsatz abbuchen (nur im Grundspiel).
      if (!inFree) {
        const deduct = accounts.adjustChips(socket.data.account, -spinBet);
        if (!deduct.ok) return ack({ ok: false, error: "Nicht genug Chips." });
      }

      // Vorführung: ein scharf gestellter Maximalgewinn macht diesen Dreh zum
      // größtmöglichen Wurf. Zahlt Chips, taucht aber in Statistik, Rake und
      // Bestenlisten nicht auf. Pechvogel-Modus: das Raster bleibt immer leer.
      const showcase = consumeForceWin(socket.data.account);
      let forced = showcase ? bestGrid(machine) : null;
      if (!forced && accounts.isShadowbanned(socket.data.account)) {
        forced = teaseGrid(machine, inFree ? session.bet : bet);
      }
      let { result, session: newSession, totalWin } = evaluateSpin(machine, bet, session, forced);
      socket.data.slots = newSession;

      // Glücksklee / Goldbarren: Gewinne erhöhen. Die Zahlen im Ergebnis mit
      // skalieren, damit die Hochzähl-Animation zum gebuchten Betrag passt.
      const boost = accounts.buffMult(socket.data.account, "winBoost");
      if (boost > 1 && totalWin > 0) {
        totalWin = Math.round(totalWin * boost);
        result.totalWin = totalWin;
        if (result.wins) result.wins.forEach((w) => (w.win = Math.round(w.win * boost)));
        if (result.cascades) result.cascades.forEach((st) => {
          st.stepWin = Math.round((st.stepWin || 0) * boost);
          (st.wins || []).forEach((w) => (w.win = Math.round(w.win * boost)));
        });
      }

      // Jackpot: bezahlte Drehs im Grundspiel füllen den Topf und können ihn treffen.
      // Vorführ-Drehs bleiben komplett draußen.
      let jackpotWin = 0;
      if (!inFree && !showcase) {
        jackpotWin = jackpotSpin(spinBet);
        if (jackpotWin > 0) {
          totalWin += jackpotWin;
          result.totalWin = totalWin;
          result.jackpot = jackpotWin;
          const acc = accounts.get(socket.data.account);
          require("./chat").announce(io, `Jackpot! ${acc ? acc.name : "?"} knackt den Gemeinschafts-Jackpot: +${jackpotWin.toLocaleString("de-DE")} Chips!`);
        }
      }

      // Gewinn (samt Jackpot) auszahlen und verbuchen. Vorführ-Drehs zahlen
      // Chips, gehen aber nie durch recordHand: keine falschen Rekorde,
      // Achievements, Wochenbilanz oder Auftragsfortschritte.
      let balance = accounts.get(socket.data.account).chips;
      if (totalWin > 0) {
        const credit = accounts.adjustChips(socket.data.account, totalWin);
        if (credit.ok) {
          balance = credit.account.chips;
          if (!showcase) {
            accounts.recordHand(socket.data.account, totalWin - (inFree ? 0 : spinBet), true, "slots", { free: inFree, einsatz: inFree ? 0 : spinBet });
            liveops.recordTourneyWin(socket.data.account, totalWin, spinBet); // gewertet nach dem Vielfachen
          }
        }
      } else if (!showcase) {
        accounts.recordHand(socket.data.account, -(inFree ? 0 : spinBet), true, "slots", { free: inFree });
      }

      // Risiko-Feature: Nach einem Basisspiel-Gewinn (ohne laufende Freispiele)
      // darf der Gewinn auf Kartenfarbe verdoppelt werden. Jeder Spin setzt
      // den Anspruch neu. Nur der letzte Gewinn ist riskierbar.
      socket.data.gamble = machine.gamble && !inFree && !showcase && totalWin > 0 && !result.freeSpins.active
        ? { machineId, amount: totalWin, steps: 0 }
        : null;

      ack({ ...result, balance, jackpotPot: jackpotPot(), winBoost: boost > 1 ? boost : 1, canGamble: !!socket.data.gamble });
    });

    // Risiko / Gamble: 50/50 auf Rot oder Schwarz, Gewinn verdoppelt sich,
    // Fehlgriff löscht ihn. Max. Stufen pro Gewinn begrenzt; EV-neutral.
    socket.on("slots:gamble", ({ guess } = {}, ack) => {
      if (!ack) return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const g = socket.data.gamble;
      if (!g || !(g.amount > 0)) return ack({ ok: false, error: "Kein Gewinn zum Riskieren." });
      const machine = MACHINE_BY_ID[g.machineId];
      if (!machine || !machine.gamble) return ack({ ok: false, error: "Kein Risiko-Spiel hier." });
      if (guess !== "red" && guess !== "black") return ack({ ok: false, error: "Rot oder Schwarz?" });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < g.amount) return ack({ ok: false, error: "Nicht genug Chips für den Einsatz." });
      const deduct = accounts.adjustChips(socket.data.account, -g.amount);
      if (!deduct.ok) return ack({ ok: false, error: deduct.error });
      const card = crypto.randomInt(2) === 0 ? "red" : "black";
      const won = card === guess;
      let balance = deduct.account.chips;
      if (won) {
        const stake = g.amount;
        g.amount = stake * 2;
        g.steps += 1;
        const credit = accounts.adjustChips(socket.data.account, g.amount);
        if (credit.ok) balance = credit.account.chips;
        accounts.recordHand(socket.data.account, stake, true, "slots");
        if (g.steps >= (machine.gamble.maxSteps || 5)) socket.data.gamble = null;
      } else {
        accounts.recordHand(socket.data.account, -g.amount, true, "slots");
        socket.data.gamble = null;
      }
      ack({
        ok: true, card, won,
        amount: won ? g.amount : 0,
        steps: won ? g.steps : 0,
        canContinue: won && !!socket.data.gamble,
        balance,
      });
    });

    // Bonus kaufen: ein Vielfaches des Einsatzes zahlen und sofort Freispiele starten.
    socket.on("slots:buyBonus", ({ machineId, bet } = {}, ack) => {
      if (!ack) return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const machine = MACHINE_BY_ID[machineId];
      if (!machine || !machine.buyBonus || !machine.freeSpins) return ack({ ok: false, error: "Kein Bonus-Kauf hier." });
      if (!accounts.isUnlocked(socket.data.account, machineId)) return ack({ ok: false, error: "Automat noch nicht freigeschaltet." });
      if (socket.data.slots && socket.data.slots.remaining > 0) return ack({ ok: false, error: "Freispiele laufen schon." });
      bet = Math.floor(Number(bet));
      if (!machine.bets.includes(bet)) return ack({ ok: false, error: "Ungültiger Einsatz." });
      const cost = bet * machine.buyBonus;
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips für den Bonus-Kauf." });
      const deduct = accounts.adjustChips(socket.data.account, -cost);
      if (!deduct.ok) return ack({ ok: false, error: deduct.error });
      // Der Kauf ist ein echter Verlust: zählt für Statistik, Rake, Cashback und
      // Wochenbilanz (die Freispiele verbuchen ihre Gewinne danach als reinen Gewinn).
      accounts.recordHand(socket.data.account, -cost, true, "slots");
      socket.data.gamble = null; // alter Risiko-Anspruch verfällt
      socket.data.slots = {
        machineId, bet, remaining: machine.freeSpins.count,
        multiplier: machine.freeSpins.persistentMultiplier ? 1 : machine.freeSpins.multiplier,
        special: machine.expandingSpecial ? pickSpecial(machine) : undefined,
      };
      ack({ ok: true, cost, balance: deduct.account.chips, freeSpins: { active: true, remaining: machine.freeSpins.count, multiplier: socket.data.slots.multiplier, special: socket.data.slots.special || null } });
    });
  });
}

module.exports = { setupSlots, evaluateSpin, MACHINE_BY_ID, MACHINES, publicMachines, BET_LEVELS, armForceWin };

// Für die RTP-Simulation und Tests.
module.exports._internals = {
  MACHINE_BY_ID,
  spinGrid,
  countScatters,
  evaluateLines,
  evaluateWays,
  evaluateCluster,
  evaluateAnywhere,
};
