"use strict";

/**
 * Simulated stock market (shared world).
 *
 * A handful of fictional companies whose prices random-walk every tick, with
 * occasional news shocks and the risk of BANKRUPTCY (price → 0; long holders
 * lose their stake, a fresh company relists in its place).
 *
 * Players open LONG or SHORT positions with margin and leverage (day-trading or
 * hold). Equity = margin + direction × (price − entry) × shares; if equity hits
 * 0 the position is LIQUIDATED (margin lost). P&L is created/destroyed against
 * the market (a money source/sink, like the casino games). Persisted to
 * data/stocks.json.
 */

const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "stocks.json");

const MAX_LEVERAGE = 5;
const HISTORY_LEN = 40;

const COMPANY_NAMES = [
  "LuckyDip Casinos", "MoonCoin", "ChipWorks", "FizzPop Drinks", "RockSolid Mining",
  "ByteForge Tech", "AeroNova", "GreenLeaf Farms", "Vortex Motors", "Solaris Energy",
  "PixelPlay Games", "IronClad Steel", "NimbusCloud", "DeepBlue Foods", "QuantumLeap",
];

function newCompany(sym, seed) {
  const tiers = [
    { vol: 0.025, drift: 0.0008, price: [60, 220] },   // stable
    { vol: 0.045, drift: 0.0012, price: [80, 320] },   // medium
    { vol: 0.09,  drift: 0.0005, price: [30, 120] },   // volatile (bankruptcy-prone)
  ];
  const t = tiers[seed % tiers.length];
  const price = Math.round(t.price[0] + Math.random() * (t.price[1] - t.price[0]));
  return {
    sym,
    name: COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)],
    price, basePrice: price, vol: t.vol, drift: t.drift,
    history: [price], bankrupt: false,
  };
}

let market = load();

function load() {
  try {
    const m = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (m && m.stocks && m.positions) return m;
  } catch {}
  return generate();
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(market, null, 2));
  } catch {}
}

function generate() {
  const syms = ["LUCK", "MOON", "CHIP", "FIZZ", "ROCK", "BYTE"];
  const stocks = {};
  syms.forEach((s, i) => (stocks[s] = newCompany(s, i)));
  return { stocks, positions: {}, nextId: 1, news: [] };
}

// ─── Trading helpers ────────────────────────────────────────────────────────
function priceOf(sym) {
  const s = market.stocks[sym];
  return s ? s.price : 0;
}

/** Equity (chips you'd get back) of a position at the current price. */
function equity(pos) {
  const price = priceOf(pos.sym);
  const pnl = pos.dir * (price - pos.entry) * pos.shares;
  return pos.margin + pnl;
}

function pushNews(text) {
  market.news.unshift({ text, at: Date.now() });
  if (market.news.length > 8) market.news.pop();
}

// ─── Market tick ──────────────────────────────────────────────────────────
// Returns { liquidated: [{owner, sym, margin}], bankruptcies: [sym] } for the
// caller to notify players.
function tick() {
  const liquidated = [];
  const bankruptcies = [];

  for (const sym of Object.keys(market.stocks)) {
    const s = market.stocks[sym];
    // Random walk.
    const shock = (Math.random() * 2 - 1) * s.vol;
    s.price = Math.max(0.01, s.price * (1 + s.drift + shock));

    // Occasional news shock.
    if (Math.random() < 0.04) {
      const up = Math.random() < 0.5;
      const mag = 0.05 + Math.random() * 0.18;
      s.price = Math.max(0.01, s.price * (up ? 1 + mag : 1 - mag));
      pushNews(`${up ? "📈" : "📉"} ${s.name} (${sym}) ${up ? "+" : "−"}${Math.round(mag * 100)} %`);
    }

    // Bankruptcy: crashed far below base, or a rare bolt from the blue.
    const crashed = s.price < s.basePrice * 0.12;
    if (!s.bankrupt && (crashed || Math.random() < 0.0025)) {
      s.bankrupt = true;
      s.price = 0;
      pushNews(`💥 ${s.name} (${sym}) hat Insolvenz angemeldet!`);
      bankruptcies.push(sym);
    }
    s.history.push(Math.round(s.price * 100) / 100);
    if (s.history.length > HISTORY_LEN) s.history.shift();
  }

  // Resolve positions: liquidate on bankruptcy or zero/negative equity.
  for (const id of Object.keys(market.positions)) {
    const pos = market.positions[id];
    const s = market.stocks[pos.sym];
    if (!s) { delete market.positions[id]; continue; }
    if (s.bankrupt) {
      // Short positions profit from a bankruptcy and are auto-closed at the gain;
      // longs lose their margin.
      if (pos.dir < 0) liquidated.push({ owner: pos.owner, sym: pos.sym, payout: Math.max(0, pos.margin + pos.margin * pos.lev), margin: pos.margin });
      else liquidated.push({ owner: pos.owner, sym: pos.sym, payout: 0, margin: pos.margin });
      delete market.positions[id];
      continue;
    }
    if (equity(pos) <= 0) {
      liquidated.push({ owner: pos.owner, sym: pos.sym, payout: 0, margin: pos.margin });
      delete market.positions[id];
    }
  }

  // After a bankruptcy: relist NPC companies fresh; delist player-IPO stocks.
  for (const sym of bankruptcies) {
    if (market.stocks[sym] && market.stocks[sym].ipo) delete market.stocks[sym];
    else {
      const seed = Object.keys(market.stocks).indexOf(sym);
      market.stocks[sym] = newCompany(sym, seed < 0 ? 0 : seed);
    }
  }

  save();
  return { liquidated, bankruptcies };
}

// ─── Public views ───────────────────────────────────────────────────────────
function publicStocks() {
  return Object.values(market.stocks).map((s) => {
    const prev = s.history.length > 1 ? s.history[s.history.length - 2] : s.price;
    const changePct = prev > 0 ? ((s.price - prev) / prev) * 100 : 0;
    return {
      sym: s.sym, name: s.name,
      price: Math.round(s.price * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      vol: s.vol, history: s.history.slice(-30), bankrupt: s.bankrupt,
    };
  });
}

function positionsFor(key) {
  return Object.entries(market.positions)
    .filter(([, p]) => p.owner === key)
    .map(([id, p]) => ({
      id, sym: p.sym, dir: p.dir, lev: p.lev, margin: p.margin,
      entry: Math.round(p.entry * 100) / 100,
      price: Math.round(priceOf(p.sym) * 100) / 100,
      shares: Math.round(p.shares * 1000) / 1000,
      equity: Math.round(Math.max(0, equity(p))),
      pnl: Math.round(equity(p) - p.margin),
    }));
}

/** Total chip value tied up in a player's open positions (for net worth). */
function portfolioValue(key) {
  let v = 0;
  for (const p of Object.values(market.positions)) if (p.owner === key) v += Math.max(0, equity(p));
  return Math.round(v);
}

// ─── Mutations ──────────────────────────────────────────────────────────────
function open(key, sym, dir, margin, lev) {
  const s = market.stocks[sym];
  if (!s || s.bankrupt) return { ok: false, error: "Aktie nicht handelbar." };
  margin = Math.floor(Number(margin));
  lev = Math.floor(Number(lev));
  if (!Number.isFinite(margin) || margin < 10) return { ok: false, error: "Mindest-Einsatz 10 🪙." };
  if (!Number.isFinite(lev) || lev < 1 || lev > MAX_LEVERAGE) return { ok: false, error: `Hebel 1–${MAX_LEVERAGE}.` };
  dir = dir < 0 ? -1 : 1;
  const shares = (margin * lev) / s.price;
  const id = String(market.nextId++);
  market.positions[id] = { owner: key, sym, dir, entry: s.price, shares, margin, lev, openedAt: Date.now() };
  save();
  return { ok: true, cost: margin, id };
}

function close(key, id) {
  const pos = market.positions[id];
  if (!pos) return { ok: false, error: "Position nicht gefunden." };
  if (pos.owner !== key) return { ok: false, error: "Nicht deine Position." };
  const payout = Math.round(Math.max(0, equity(pos)));
  delete market.positions[id];
  save();
  return { ok: true, payout, margin: pos.margin };
}

// ─── Socket wiring ────────────────────────────────────────────────────────
function setupStocks(io, accounts) {
  function snapshot(key) {
    return { stocks: publicStocks(), positions: positionsFor(key), news: market.news.slice(0, 6), maxLeverage: MAX_LEVERAGE };
  }

  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    socket.on("stocks:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: true, ...snapshot(key() || null) });
    });

    socket.on("stocks:open", ({ sym, dir, margin, lev } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = key() && accounts.get(key());
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = open(key(), sym, dir, margin, lev);
      if (!r.ok) return ack(r);
      if (acc.chips < r.cost) { delete market.positions[r.id]; return ack({ ok: false, error: "Nicht genug Chips." }); }
      const res = accounts.adjustChips(key(), -r.cost);
      ack({ ok: true, account: res.account, ...snapshot(key()) });
    });

    socket.on("stocks:close", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = key() && accounts.get(key());
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = close(key(), id);
      if (!r.ok) return ack(r);
      const res = accounts.adjustChips(key(), r.payout);
      ack({ ok: true, payout: r.payout, margin: r.margin, account: res.account, ...snapshot(key()) });
    });
  });

  // Market lives: tick prices, pay out short-bankruptcy windfalls, notify
  // liquidated players, and push a fresh market to everyone.
  setInterval(() => {
    const { liquidated } = tick();
    for (const ev of liquidated) {
      if (ev.payout > 0) accounts.adjustChips(ev.owner, ev.payout); // short cashed out on a bankruptcy
    }
    for (const s of io.of("/").sockets.values()) {
      const k = s.data && s.data.account;
      const mine = liquidated.filter((e) => e.owner === k);
      if (mine.length) {
        const lost = mine.filter((e) => e.payout === 0).reduce((a, e) => a + e.margin, 0);
        const won = mine.filter((e) => e.payout > 0).reduce((a, e) => a + e.payout, 0);
        s.emit("stocks:liquidated", { lost, won, account: accounts.publicAccount(accounts.get(k)) });
      }
      s.emit("stocks:update");
    }
  }, 6000);
}

/** List a player's company as a tradeable stock. Returns { ok, sym }. */
function ipo(key, name, seedPrice) {
  const base = (name || "CO").replace(/[^A-Za-z]/g, "").toUpperCase();
  let sym = (base.slice(0, 4) || "CO");
  let n = 1;
  while (market.stocks[sym]) sym = (base.slice(0, 3) || "CO") + (n++);
  const price = Math.max(20, Math.round(seedPrice || 100));
  market.stocks[sym] = {
    sym, name, price, basePrice: price,
    vol: 0.05, drift: 0.0012, history: [price], bankrupt: false,
    ipo: true, founder: key,
  };
  pushNews(`🚀 ${name} (${sym}) ist an die Börse gegangen!`);
  save();
  return { ok: true, sym };
}

module.exports = {
  MAX_LEVERAGE, tick, publicStocks, positionsFor, portfolioValue, open, close, ipo, setupStocks,
};
