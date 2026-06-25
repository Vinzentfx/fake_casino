"use strict";

/**
 * Shared city + real-estate market.
 *
 * Three independent roles per lot:
 *   - landOwner : owns the land (a tradeable asset; price follows a market index)
 *   - builtBy   : owns the building/business asset (whoever paid to build/buy it)
 *   - operator  : runs the business — keeps the profit, pays RENT to the landOwner
 *
 * This lets every real-estate play work:
 *   • Buy land (market price), sell it back to the market (price fluctuates).
 *   • Mark your empty land "for rent" → other players build there & pay you rent.
 *   • Build on your own land and operate it yourself (no rent), …
 *   • …or lease the operation out → a tenant runs it and pays you rent while you
 *     keep the land + building.
 *   • Buy NPC businesses; hostile-take-over a rival's owned business at +50%.
 *
 * Business net/sec = revenue − wages − rent − taxes, revenue drifting with a
 * per-business performance factor. Persisted to data/city.json.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const CITY_FILE = path.join(DATA_DIR, "city.json");

// Each building yields chunky income PER MINUTE and (the real reason to own it)
// produces a PRODUCT that grants a gameplay buff. Others buy the product from the
// operator (revenue to them); the operator buys it at OWNER_DISCOUNT. Buildings
// are deliberately expensive (~40-min income payback) — the buff/product economy
// is the point, not the trickle of passive income.
// Each building yields income/MINUTE (~70-min payback) and sells SEVERAL products,
// each granting a buff. Products are priced by buff utility: cosmetic/weak buffs
// (fastSpins, clickBoost) are cheap; money buffs (winBoost) scale with strength.
// Buildings are EXPENSIVE; passive income is deliberately modest (big buildings
// don't pay back through income alone — they're bought for their buffs/products,
// the casino rake and prestige). The casino games (high bets) are the real money
// engine. Each building sells several buff-products.
const BUILDING_TYPES = {
  kiosk:   { name: "Kiosk",   emoji: "🏪", cost: 400000,       income: 1200,    rent: 1000,   buildable: true, products: [
             { key: "zitrone",    name: "Zitrone",      emoji: "🍋", price: 50000,    buff: "fastSpins",  mult: 2,    mins: 10, desc: "Slots 2× schneller" },
             { key: "energy",     name: "Energy-Drink", emoji: "🥤", price: 60000,    buff: "clickBoost", mult: 3,    mins: 10, desc: "Arbeiten ×3" } ] },
  cafe:    { name: "Café",    emoji: "☕", cost: 2000000,      income: 5000,    rent: 2000,   buildable: true, products: [
             { key: "espresso",   name: "Espresso",     emoji: "☕", price: 120000,   buff: "clickBoost", mult: 5,    mins: 15, desc: "Arbeiten ×5" },
             { key: "kuchen",     name: "Glückskuchen", emoji: "🍰", price: 300000,   buff: "winBoost",   mult: 1.1,  mins: 10, desc: "Haus-Gewinne +10 %" } ] },
  shop:    { name: "Laden",   emoji: "🛍️", cost: 10000000,     income: 18000,   rent: 4000,   buildable: true, products: [
             { key: "klee",       name: "Glücksklee",   emoji: "🍀", price: 600000,   buff: "winBoost",   mult: 1.2,  mins: 10, desc: "Haus-Gewinne +20 %" },
             { key: "jeton",      name: "Glücks-Jeton", emoji: "🎰", price: 150000,   buff: "fastSpins",  mult: 3,    mins: 10, desc: "Slots 3× schneller" } ] },
  hotel:   { name: "Hotel",   emoji: "🏨", cost: 50000000,     income: 60000,   rent: 8000,   buildable: true, products: [
             { key: "vip",        name: "VIP-Pass",     emoji: "🎟️", price: 900000,   buff: "vip",        mult: 2,    mins: 30, desc: "Bonus & Soforthilfe ×2, kein Rake" },
             { key: "champagner", name: "Champagner",   emoji: "🍾", price: 1200000,  buff: "winBoost",   mult: 1.3,  mins: 12, desc: "Haus-Gewinne +30 %" } ] },
  factory: { name: "Fabrik",  emoji: "🏭", cost: 250000000,    income: 200000,  rent: 15000,  buildable: true, products: [
             { key: "gold",       name: "Goldbarren",   emoji: "💎", price: 2500000,  buff: "winBoost",   mult: 1.5,  mins: 8,  desc: "Haus-Gewinne +50 %" },
             { key: "turbo",      name: "Turbo-Chip",   emoji: "⚙️", price: 400000,   buff: "fastSpins",  mult: 4,    mins: 12, desc: "Slots 4× schneller" } ] },
  // The Casino owner also collects the house rake (see accounts.recordHand).
  casino:  { name: "Casino",  emoji: "🎰", cost: 1200000000,   income: 600000,  rent: 0,      buildable: false, unique: true },
  // The Bank also collects interest from every player loan (see game/bank.js).
  bank:    { name: "Bank",    emoji: "🏦", cost: 600000000,    income: 350000,  rent: 0,      buildable: false, unique: true },
};

const OWNER_DISCOUNT = 0.5;    // the business operator buys their own product at 50% off
const BASE_LAND = 500000;      // base land value at market index 1.0 (pricey world, hard to monopolise)
const SELL_SPREAD = 0.9;       // sell land back to the market at 90% (10% sink)
const BUYOUT_PREMIUM = 1.5;    // hostile takeover of a rival's owned business
const PERF_MIN = 0.6, PERF_MAX = 1.4;
const LAND_MIN = 0.55, LAND_MAX = 1.9;

const COLS = 6, ROWS = 5;

let city = load();

function load() {
  try {
    const c = JSON.parse(fs.readFileSync(CITY_FILE, "utf8"));
    if (c && Array.isArray(c.lots) && c.lots.length && "forRent" in c.lots[0]) return c;
  } catch {}
  return generate();
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CITY_FILE, JSON.stringify(city, null, 2));
  } catch {}
}

function generate() {
  const lots = [];
  let id = 0;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      lots.push({ id: id++, x, y, landOwner: null, landOwnerName: null, forRent: false, biz: null });

  const mkBiz = (type) => ({ type, builtBy: null, builtByName: null, operator: null, operatorName: null, perf: 1, forLease: false });
  lots[Math.floor(lots.length / 2)].biz = mkBiz("casino");
  lots[2].biz = mkBiz("bank"); // the one Bank (NPC-owned until someone buys it)
  const pool = ["kiosk", "kiosk", "kiosk", "cafe", "cafe", "cafe", "shop", "shop", "hotel", "factory"];
  const free = lots.filter((l) => !l.biz);
  for (const t of pool) {
    if (!free.length) break;
    const i = crypto.randomInt(free.length);
    free[i].biz = mkBiz(t);
    free.splice(i, 1);
  }
  return { lots, landIndex: 1, createdAt: Date.now() };
}

// ─── Market life ────────────────────────────────────────────────────────────
function tickMarket() {
  // Per-business performance.
  for (const lot of city.lots) {
    if (!lot.biz) continue;
    const p = lot.biz.perf || 1;
    lot.biz.perf = clamp(p + (1 - p) * 0.1 + (Math.random() * 2 - 1) * 0.12, PERF_MIN, PERF_MAX);
  }
  // City-wide land price index.
  const i = city.landIndex || 1;
  city.landIndex = clamp(i + (1 - i) * 0.05 + (Math.random() * 2 - 1) * 0.08, LAND_MIN, LAND_MAX);
  save();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (n) => Math.round(n * 100) / 100;
const landPrice = () => Math.round(BASE_LAND * (city.landIndex || 1));
const landSellPrice = () => Math.round(landPrice() * SELL_SPREAD);

// ─── P&L (all figures are PER MINUTE) ─────────────────────────────────────
function bizNet(lot) {
  const t = BUILDING_TYPES[lot.biz.type];
  const income = t.income * (lot.biz.perf || 1);
  const rent = lot.biz.operator !== lot.landOwner ? t.rent : 0; // pay rent if you don't own the land
  return income - rent;
}

function lotById(id) { return city.lots.find((l) => l.id === id) || null; }

// ─── Per-business income accrual (collect each business individually) ──────
const COLLECT_CAP_MS = 3 * 60 * 60 * 1000; // 3h offline cap per business (income stays modest)
const MS_PER_MIN = 60000;
const elapsedMs = (since, now) => Math.min(now - (since || now), COLLECT_CAP_MS);

/** Chips `key` has accrued from one lot (operating profit if they run it, else
 *  rent if they're the landlord letting a tenant operate). Income is per minute. */
function lotPending(lot, key, now = Date.now()) {
  if (!lot.biz) return 0;
  if (lot.biz.operator === key)
    return Math.max(0, bizNet(lot)) * elapsedMs(lot.biz.opAt, now) / MS_PER_MIN;
  if (lot.landOwner === key && lot.biz.operator && lot.biz.operator !== key)
    return BUILDING_TYPES[lot.biz.type].rent * elapsedMs(lot.biz.rentAt, now) / MS_PER_MIN;
  return 0;
}

function totalPending(key) {
  let sum = 0;
  for (const lot of city.lots) sum += lotPending(lot, key);
  return sum;
}

/** Collect one business's accrued income for `key`; resets that timer. */
function collectLot(id, key) {
  const lot = lotById(id);
  const now = Date.now();
  if (!lot || !lot.biz) return err("Nichts einzusammeln.");
  const isOp = lot.biz.operator === key;
  const isLandlord = lot.landOwner === key && lot.biz.operator && lot.biz.operator !== key;
  if (!isOp && !isLandlord) return err("Hier hast du kein Einkommen.");
  const amount = Math.floor(lotPending(lot, key, now));
  return {
    ok: true, amount,
    commit: () => { if (isOp) lot.biz.opAt = now; else lot.biz.rentAt = now; save(); },
  };
}

/** Income/sec for `key`: operating profit of businesses they run + rent from land they let. */
function ownerIncomeRate(key) {
  let rate = 0;
  for (const lot of city.lots) {
    if (lot.biz && lot.biz.operator === key) rate += bizNet(lot);
    if (lot.landOwner === key && lot.biz && lot.biz.operator && lot.biz.operator !== key) {
      rate += BUILDING_TYPES[lot.biz.type].rent;
    }
  }
  return rate;
}

/** Net-worth value: land owned (at market) + building assets owned. */
function ownerValue(key) {
  let total = 0;
  for (const lot of city.lots) {
    if (lot.landOwner === key) total += landPrice();
    if (lot.biz && lot.biz.builtBy === key) total += BUILDING_TYPES[lot.biz.type].cost;
  }
  return total;
}

function casinoOwner() {
  const lot = city.lots.find((l) => l.biz && l.biz.type === "casino");
  return lot && lot.biz ? lot.biz.operator : null;
}

function bankOwner() {
  const lot = city.lots.find((l) => l.biz && l.biz.type === "bank");
  return lot && lot.biz ? lot.biz.operator : null;
}

function publicCity(key) {
  // Strip product lists from the catalog: products are private to each business's
  // operator, so the generic "this type sells X" list must not leak either. The
  // client only needs name/emoji/cost/income/rent here for the build menu.
  const buildingTypes = {};
  for (const [id, t] of Object.entries(BUILDING_TYPES)) {
    const { products, ...rest } = t;
    buildingTypes[id] = rest;
  }
  return {
    cols: COLS, rows: ROWS, buildingTypes, buyoutPremium: BUYOUT_PREMIUM,
    landPrice: landPrice(), landSellPrice: landSellPrice(), landIndex: round(city.landIndex || 1),
    lots: city.lots.map((l) => {
      const t = l.biz && BUILDING_TYPES[l.biz.type];
      // P&L per minute, from the viewer's perspective (rent shown unless they own the land).
      let pnl = null;
      if (l.biz) {
        const operator = l.biz.operator;
        const landOwnedByOp = operator === null ? l.landOwner === key : l.landOwner === operator;
        const income = t.income * (l.biz.perf || 1);
        const rent = landOwnedByOp ? 0 : t.rent;
        pnl = { income: round(income), rent: round(rent), net: round(income - rent) };
      }
      // Products are PRIVATE to the business operator: only the owner sees them
      // (and buys them at the owner discount). Outsiders get `products: null` —
      // they can't even see which products exist; they buy them off the player
      // market once the operator lists them there.
      let products = null;
      if (t && t.products && l.biz.operator === key) {
        products = t.products.map((pr) => ({ ...pr, payPrice: Math.round(pr.price * OWNER_DISCOUNT), owned: true }));
      }
      const landMine = l.landOwner === key;
      const canBuildHere = !l.biz && (landMine || (l.forRent && l.landOwner && l.landOwner !== key));
      return {
        id: l.id, x: l.x, y: l.y,
        landOwner: l.landOwner, landOwnerName: l.landOwnerName, landMine, forRent: l.forRent,
        emoji: t ? t.emoji : null,
        biz: l.biz ? {
          type: l.biz.type, name: t.name, emoji: t.emoji,
          builtBy: l.biz.builtBy, builtByName: l.biz.builtByName, builtMine: l.biz.builtBy === key,
          operator: l.biz.operator, operatorName: l.biz.operatorName, operatorMine: l.biz.operator === key,
          forLease: l.biz.forLease, listed: !!l.biz.listed, pnl, products,
        } : null,
        canBuildHere,
        pending: round(lotPending(l, key)),
        rival: (l.landOwner && !landMine) || (l.biz && l.biz.operator && l.biz.operator !== key),
        mine: landMine || (l.biz && (l.biz.operator === key || l.biz.builtBy === key)),
      };
    }),
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────
// Buy/build cost the player chips → { ok, cost, commit }.
// Selling pays the player → { ok, gain, commit }. Toggles are free → { ok, commit }.

function buyLand(id, key, name) {
  const lot = lotById(id);
  if (!lot) return err("Grundstück nicht gefunden.");
  if (lot.landOwner !== null) return err("Grundstück ist nicht frei.");
  return { ok: true, cost: landPrice(), commit: () => { lot.landOwner = key; lot.landOwnerName = name; save(); } };
}

function sellLand(id, key) {
  const lot = lotById(id);
  if (!lot) return err("Nicht gefunden.");
  if (lot.landOwner !== key) return err("Gehört dir nicht.");
  if (lot.biz) return err("Erst das Gebäude loswerden.");
  return { ok: true, gain: landSellPrice(), commit: () => { lot.landOwner = null; lot.landOwnerName = null; lot.forRent = false; save(); } };
}

function setForRent(id, key, val) {
  const lot = lotById(id);
  if (!lot) return err("Nicht gefunden.");
  if (lot.landOwner !== key) return err("Gehört dir nicht.");
  if (lot.biz) return err("Schon bebaut.");
  return { ok: true, commit: () => { lot.forRent = !!val; save(); } };
}

function build(id, key, typeId, name) {
  const lot = lotById(id);
  if (!lot) return err("Nicht gefunden.");
  if (lot.biz) return err("Hier steht schon etwas.");
  const ownLand = lot.landOwner === key;
  const rented = lot.forRent && lot.landOwner && lot.landOwner !== key;
  if (!ownLand && !rented) return err("Erst Grundstück kaufen (oder gemietetes Land nutzen).");
  const t = BUILDING_TYPES[typeId];
  if (!t || !t.buildable) return err("Kann hier nicht gebaut werden.");
  return { ok: true, cost: t.cost, commit: () => {
    const now = Date.now();
    lot.biz = { type: typeId, builtBy: key, builtByName: name, operator: key, operatorName: name, perf: 1, forLease: false, opAt: now, rentAt: now };
    save();
  } };
}

function buyBiz(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen hier.");
  if (lot.biz.operator !== null || lot.biz.builtBy !== null) return err("Gehört schon jemandem.");
  const t = BUILDING_TYPES[lot.biz.type];
  return { ok: true, cost: t.cost, commit: () => {
    const now = Date.now();
    lot.biz.builtBy = key; lot.biz.builtByName = name; lot.biz.operator = key; lot.biz.operatorName = name;
    lot.biz.opAt = now; lot.biz.rentAt = now; save();
  } };
}

function takeover(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen hier.");
  if (lot.biz.operator === null) return err("Nutze „kaufen“.");
  if (lot.biz.operator === key) return err("Gehört dir bereits.");
  if (lot.biz.builtBy !== lot.biz.operator) return err("Verpachtetes Unternehmen — nicht übernehmbar.");
  const t = BUILDING_TYPES[lot.biz.type];
  const prevOwner = lot.biz.operator;
  return { ok: true, cost: Math.ceil(t.cost * BUYOUT_PREMIUM), prevOwner, commit: () => {
    const now = Date.now();
    lot.biz.builtBy = key; lot.biz.builtByName = name; lot.biz.operator = key; lot.biz.operatorName = name; lot.biz.forLease = false;
    lot.biz.opAt = now; lot.biz.rentAt = lot.biz.rentAt || now; save();
  } };
}

function setForLease(id, key, val) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen.");
  if (lot.biz.builtBy !== key) return err("Du besitzt das Gebäude nicht.");
  return { ok: true, commit: () => { lot.biz.forLease = !!val; save(); } };
}

function lease(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen.");
  if (!lot.biz.forLease) return err("Nicht zur Pacht angeboten.");
  if (lot.biz.operator === key) return err("Betreibst du schon.");
  const prevOwner = lot.biz.operator; // previous operator (the builder) — settle their income
  return { ok: true, cost: 0, prevOwner, commit: () => {
    const now = Date.now();
    lot.biz.operator = key; lot.biz.operatorName = name; lot.biz.forLease = false;
    lot.biz.opAt = now; lot.biz.rentAt = now; save();
  } };
}

/** Validate that `key` can list this lot's business on the stock market. */
function listCompany(id, key) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen hier.");
  if (lot.biz.builtBy !== key) return err("Du musst das Gebäude besitzen.");
  const t = BUILDING_TYPES[lot.biz.type];
  if (!t.buildable) return err("Casino & Bank können nicht an die Börse.");
  if (lot.biz.listed) return err("Schon börsennotiert.");
  const seedPrice = Math.max(20, Math.round(bizNet(lot) * 25));
  const raise = Math.round(t.cost * 0.5);
  const name = `${lot.biz.builtByName || "Spieler"} ${t.name} AG`;
  return { ok: true, name, seedPrice, raise, commit: () => { lot.biz.listed = true; save(); } };
}

/** Buy a business's product (grants a buff). Operator pays a discount; a rival
 *  buyer pays full price to the operator. Returns { ok, cost, product, seller }. */
function buyProduct(id, key, productKey) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen hier.");
  const t = BUILDING_TYPES[lot.biz.type];
  const product = t.products && t.products.find((p) => p.key === productKey);
  if (!product) return err("Produkt nicht gefunden.");
  // Products are private to the operator — only they can buy them (at a discount),
  // then resell on the player market. Outsiders are rejected.
  if (lot.biz.operator !== key) return err("Nur der Besitzer kann hier Produkte kaufen.");
  const cost = Math.round(product.price * OWNER_DISCOUNT);
  return { ok: true, cost, product, seller: null };
}

/** Admin: wipe the whole city back to a fresh NPC-owned start (e.g. after a big
 *  price rebalance, so early cheap buyers don't keep a permanent monopoly). */
function resetCity() {
  city = generate();
  save();
}

/** Admin: strip all ownership from a lot (land + business → NPC/unowned). The
 *  building stays as a buyable NPC business. */
function adminClearLot(id) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Feld nicht gefunden." };
  lot.landOwner = null; lot.landOwnerName = null; lot.forRent = false;
  if (lot.biz) {
    lot.biz.operator = null; lot.biz.operatorName = null;
    lot.biz.builtBy = null; lot.biz.builtByName = null;
    lot.biz.listed = false; lot.biz.forLease = false;
  }
  save();
  return { ok: true };
}

/** Admin/UI helper: all lots currently owned by someone (land or business). */
function ownedLots() {
  return city.lots
    .filter((l) => l.landOwner || (l.biz && (l.biz.operator || l.biz.builtBy)))
    .map((l) => ({
      id: l.id,
      type: l.biz ? l.biz.type : null,
      name: l.biz ? BUILDING_TYPES[l.biz.type].name : "Grundstück",
      emoji: l.biz ? BUILDING_TYPES[l.biz.type].emoji : "🟩",
      owner: (l.biz && l.biz.operatorName) || l.landOwnerName || null,
    }));
}

function err(error) { return { ok: false, error }; }

module.exports = {
  BUILDING_TYPES,
  publicCity, ownerIncomeRate, ownerValue, casinoOwner, bankOwner, tickMarket,
  buyLand, sellLand, setForRent, build, buyBiz, takeover, setForLease, lease, lotById,
  collectLot, totalPending, listCompany, buyProduct, adminClearLot, ownedLots, resetCity,
};
