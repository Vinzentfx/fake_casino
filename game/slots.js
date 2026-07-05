"use strict";

/**
 * Slot machines — server-authoritative.
 *
 * The server owns the RNG and the chip balance: the client asks for a spin
 * with a bet, the server rolls the grid, evaluates wins, updates the account,
 * and returns a structured result for the client to animate.
 *
 * Config-driven machines share four evaluators:
 *   - "lines"    : fixed paylines, left-aligned, wild substitutes
 *   - "anywhere" : N+ of a symbol anywhere on the grid pays (wild substitutes)
 *   - "ways"     : N-ways (product of matching symbols per consecutive reel)
 *   - "cluster"  : connected groups of 5+ with cascading/tumbling reels
 *
 * Internally every win is `unit * payMultiplier`, where unit = bet / 20.
 * This keeps payouts comparable across machines regardless of line count.
 */

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Machine definitions
// ---------------------------------------------------------------------------

const BET_LEVELS = [10, 20, 50, 100, 250, 500];

// Paylines for the 3x3 machine (row index per column).
const LINES_3x3 = [
  [1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0],
];

// 20 paylines for the 5x3 machine.
const LINES_5x3 = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [0, 2, 0, 2, 0],
];

// 10 paylines for the 5x4 machine (rows 0-3).
const LINES_5x4 = [
  [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3], [0, 1, 2, 3, 3],
  [3, 2, 1, 0, 0], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
];

const CASCADE_MULT = [1, 2, 3, 5, 8, 12]; // multiplier per cascade step (base game)

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
    payScale: 3.17,
    // "Pays anywhere": 3+ of the same symbol ANYWHERE on the grid wins. Tons of
    // small, frequent wins → constant flashing (the casino-parody dopamine drip).
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
    payScale: 1.38, // ~98.5% RTP incl. scaling free spins
    freeSpins: { trigger: 3, count: 10, multiplier: 2 },
    buyBonus: 17, // cost to buy free spins = 17× bet (~93% RTP)
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
  {
    id: "dragon",
    name: "Dragon's Hoard",
    tagline: "5×4 · 10 Linien · Hochvolatil",
    theme: "dragon",
    cols: 5,
    rows: 4,
    mode: "lines",
    lines: LINES_5x4,
    minMatch: 3,
    wild: "W",
    scatter: "S",
    unlockCost: 50000,
    bets: [500, 1000, 5000, 25000, 100000, 250000],
    payScale: 1.035, // ~98.6% RTP incl. scaling free spins (high volatility)
    // High volatility: small line hits pay little, but 5-of-a-kind tops are huge.
    freeSpins: { trigger: 3, count: 8, multiplier: 3 },
    buyBonus: 13,
    symbols: {
      coin: { emoji: "🪙", weight: 28 },
      sword: { emoji: "🗡️", weight: 24 },
      shield: { emoji: "🛡️", weight: 20 },
      ring: { emoji: "💍", weight: 16 },
      chest: { emoji: "💰", weight: 12 },
      dragon: { emoji: "🐲", weight: 8 },
      W: { emoji: "🐉", weight: 5 },
      S: { emoji: "🔥", weight: 5 },
    },
    pays: {
      coin: { 3: 2, 4: 10, 5: 45 },
      sword: { 3: 3, 4: 13, 5: 60 },
      shield: { 3: 4, 4: 17, 5: 90 },
      ring: { 3: 6, 4: 26, 5: 140 },
      chest: { 3: 10, 4: 50, 5: 240 },
      dragon: { 3: 25, 4: 130, 5: 600 },
      W: { 3: 40, 4: 220, 5: 900 },
    },
  },
  {
    id: "cosmic",
    name: "Cosmic Cluster",
    tagline: "6×5 · Cluster · Kaskaden",
    theme: "cosmic",
    cols: 6,
    rows: 5,
    mode: "cluster",
    minCluster: 5,
    wild: "W",
    scatter: "S",
    unlockCost: 200000,
    bets: [1000, 5000, 25000, 100000, 250000, 1000000],
    payScale: 3.26, // ~98.5% RTP incl. scaling free spins (persistent multiplier)
    freeSpins: { trigger: 4, count: 10, persistentMultiplier: true },
    buyBonus: 23,
    symbols: {
      planet: { emoji: "🪐", weight: 24 },
      moon: { emoji: "🌙", weight: 22 },
      comet: { emoji: "☄️", weight: 20 },
      earth: { emoji: "🌍", weight: 16 },
      alien: { emoji: "👽", weight: 12 },
      ufo: { emoji: "🛸", weight: 8 },
      W: { emoji: "🌟", weight: 5 },
      S: { emoji: "🌌", weight: 4 },
    },
    // cluster pays keyed by size threshold (size >= key)
    clusterPays: {
      planet: { 5: 1.5, 7: 3, 9: 6, 12: 18 },
      moon: { 5: 2, 7: 4, 9: 8, 12: 24 },
      comet: { 5: 2.5, 7: 5, 9: 12, 12: 35 },
      earth: { 5: 3, 7: 6, 9: 14, 12: 45 },
      alien: { 5: 4, 7: 8, 9: 18, 12: 60 },
      ufo: { 5: 6, 7: 14, 9: 35, 12: 120 },
    },
  },
];

const MACHINE_BY_ID = Object.fromEntries(MACHINES.map((m) => [m.id, m]));

/** Public, client-safe view of all machines (no internal weights needed, but harmless). */
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
    payKeys: Object.keys(m.pays || m.clusterPays || {}),
    // Payouts expressed as a multiple of the total bet (for the in-game paytable).
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

// ── Progressiver Gemeinschafts-Jackpot ──────────────────────────────────────
// 0,5% of every paid base-game spin feeds a shared pot; every paid spin has a
// bet-proportional chance to hit it (expected: one hit per ~50M wagered → pot
// averages ~250k). Fed by bets → overall RTP stays below 100%.
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
/** Feed the pot and roll for a hit. Returns the payout (0 = no hit). */
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

// ── Admin: force the maximum possible roll (animation showcase) ────────────
// The owner can arm a one-shot flag; the NEXT base-game spin comes up as a
// full grid of the machine's best-paying symbol → every line/way/cluster hits
// its top tier at once (thresholdPay pays the highest tier on overshoot).
const forcedWin = new Set(); // account keys with an armed force-win

function armForceWin(key) {
  forcedWin.add(String(key).toLowerCase());
}
function consumeForceWin(key) {
  return forcedWin.delete(String(key).toLowerCase());
}

/** Shadowban: roll grids until one pays NOTHING (no win, no free spins).
 *  Lucky 7s wins ~90% of spins, so a losing grid needs a few rerolls; if none
 *  is found the spin stays honest (practically never happens). */
function losingGrid(machine, bet) {
  for (let i = 0; i < 300; i++) {
    const g = spinGrid(machine);
    const probe = evaluateSpin(machine, bet, null, g); // session null → no side effects
    if (probe.totalWin === 0 && probe.result.freeSpinsAwarded === 0) return g;
  }
  return null;
}

/** Full grid of the best-paying symbol (scatter excluded). */
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
    // Determine the paying symbol: first non-wild, or wild itself.
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

// Highest pay tier whose threshold is <= count (so 6 of a kind still pays the "5+" tier).
function thresholdPay(table, count) {
  let pay = 0;
  for (const k of Object.keys(table).map(Number).sort((a, b) => a - b)) if (count >= k) pay = table[k];
  return pay;
}

// "Pays anywhere" — N+ of the same symbol ANYWHERE on the grid pays, regardless
// of position. Wild substitutes for every symbol. Generous & flashy by design.
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
    if (sym === wild) continue; // wild only substitutes here
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

/** Find connected same-symbol clusters (orthogonal), wild substitutes into any cluster. */
function findClusters(machine, grid) {
  const cols = machine.cols, rows = machine.rows, wild = machine.wild;
  const seen = Array.from({ length: cols }, () => new Array(rows).fill(false));
  const clusters = [];

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const sym = grid[c][r];
      if (seen[c][r] || sym === wild || sym === machine.scatter || !machine.clusterPays[sym]) continue;
      // BFS over cells matching sym or wild.
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

/** Evaluate a cluster machine with cascades. Returns { totalWin, cascades, endMultiplier }. */
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

    // Remove winning cells, tumble remaining down, refill from top.
    const removed = new Set();
    for (const cl of clusters) for (const [c, r] of cl.positions) removed.add(c + ":" + r);
    const newGrid = grid.map((col) => col.slice());
    for (let c = 0; c < machine.cols; c++) {
      const survivors = [];
      for (let r = machine.rows - 1; r >= 0; r--) {
        if (!removed.has(c + ":" + r)) survivors.push(grid[c][r]);
      }
      const col = new Array(machine.rows);
      // survivors fill from bottom
      for (let i = 0; i < survivors.length; i++) col[machine.rows - 1 - i] = survivors[i];
      for (let r = machine.rows - 1 - survivors.length; r >= 0; r--) col[r] = weightedPick(machine);
      newGrid[c] = col;
    }

    cascades.push({ wins, stepWin, multiplier: stepMult, gridAfter: newGrid.map((c) => c.slice()) });
    grid = newGrid;
    step++;
    if (machine.freeSpins && machine.freeSpins.persistentMultiplier) multiplier++;
    if (step > 30) break; // safety
  }

  return { totalWin, cascades, endMultiplier: multiplier };
}

// ---------------------------------------------------------------------------
// Core spin (no account / no balance side effects) — shared by single-player
// slots and PvP. `session` is the free-spins session for THIS machine (or null).
// Returns { result, session, spinBet, totalWin, inFree }.
// ---------------------------------------------------------------------------

function evaluateSpin(machine, bet, session, forceGrid = null) {
  const inFree = !!(session && session.remaining > 0);
  const spinBet = inFree ? session.bet : bet;
  const unit = spinBet / 20;
  if (inFree) session.remaining -= 1;

  const grid = forceGrid || spinGrid(machine);
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

  const fsMult = inFree && machine.freeSpins && machine.freeSpins.multiplier ? machine.freeSpins.multiplier : 1;
  const totalWin = Math.round(baseWin * fsMult);

  // Trigger / retrigger free spins.
  let freeSpinsAwarded = 0;
  let newSession = session;
  if (machine.freeSpins && scatters.count >= machine.freeSpins.trigger) {
    // More scatters than required → more free spins (e.g. 3→10, 4→15, 5→20…).
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
      };
    }
  }
  if (newSession && newSession.remaining <= 0) newSession = null;

  const freeState = newSession && newSession.remaining > 0
    ? { active: true, remaining: newSession.remaining, multiplier: newSession.multiplier }
    : { active: false, remaining: 0, multiplier: 1 };

  const result = {
    ok: true,
    grid,
    wins,
    cascades,
    scatterCount: scatters.count,
    scatterPositions: scatters.positions,
    bet: spinBet,
    totalWin,
    multiplier: fsMult !== 1 ? fsMult : endMultiplier || 1,
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

    // Unlock a machine for the logged-in account.
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

      // Charge the bet (base game only).
      if (!inFree) {
        const deduct = accounts.adjustChips(socket.data.account, -spinBet);
        if (!deduct.ok) return ack({ ok: false, error: "Nicht genug Chips." });
      }

      // Admin showcase: an armed force-win turns this spin into the maximum roll.
      // Shadowban: the RNG hates this player — the grid always comes up empty.
      let forced = consumeForceWin(socket.data.account) ? bestGrid(machine) : null;
      if (!forced && accounts.isShadowbanned(socket.data.account)) {
        forced = losingGrid(machine, inFree ? session.bet : bet);
      }
      let { result, session: newSession, totalWin } = evaluateSpin(machine, bet, session, forced);
      socket.data.slots = newSession;

      // Glücksklee / Goldbarren: boost wins. Scale the result figures too so the
      // count-up animation matches the credited amount.
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

      // Progressive jackpot: paid base-game spins feed the pot & may hit it.
      let jackpotWin = 0;
      if (!inFree) {
        jackpotWin = jackpotSpin(spinBet);
        if (jackpotWin > 0) {
          totalWin += jackpotWin;
          result.totalWin = totalWin;
          result.jackpot = jackpotWin;
          const acc = accounts.get(socket.data.account);
          require("./chat").announce(io, `💰💥 JACKPOT! ${acc ? acc.name : "?"} knackt den Gemeinschafts-Jackpot: +${jackpotWin.toLocaleString("de-DE")} 🪙!`);
        }
      }

      // Pay out (no account:update — client applies bet at spin start, win after reveal).
      let balance = accounts.get(socket.data.account).chips;
      if (totalWin > 0) {
        const credit = accounts.adjustChips(socket.data.account, totalWin);
        if (credit.ok) {
          balance = credit.account.chips;
          accounts.recordHand(socket.data.account, totalWin - (inFree ? 0 : spinBet), true, "slots");
        }
      } else {
        accounts.recordHand(socket.data.account, -(inFree ? 0 : spinBet), true, "slots");
      }

      ack({ ...result, balance, jackpotPot: jackpotPot(), winBoost: boost > 1 ? boost : 1 });
    });

    // Bonus-Buy: pay a multiple of the bet to start free spins immediately.
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
      socket.data.slots = {
        machineId, bet, remaining: machine.freeSpins.count,
        multiplier: machine.freeSpins.persistentMultiplier ? 1 : machine.freeSpins.multiplier,
      };
      ack({ ok: true, cost, balance: deduct.account.chips, freeSpins: { active: true, remaining: machine.freeSpins.count, multiplier: socket.data.slots.multiplier } });
    });
  });
}

module.exports = { setupSlots, evaluateSpin, MACHINE_BY_ID, MACHINES, publicMachines, BET_LEVELS, armForceWin };

// Exposed for offline RTP simulation / tests.
module.exports._internals = {
  MACHINE_BY_ID,
  spinGrid,
  countScatters,
  evaluateLines,
  evaluateWays,
  evaluateCluster,
  evaluateAnywhere,
};
