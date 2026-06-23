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

// Balanced so efficiency (income/cost) rises with tier (progression rewarded)
// and rent stays roughly flat ≈ land-based (uniform landlord ROI, ~13–37 min,
// meaningful for small businesses, negligible for big ones — realistic).
const BUILDING_TYPES = {
  kiosk:   { name: "Kiosk",   emoji: "🏪", cost: 600,     gross: 2.5,  wages: 0.75, rent: 0.9, tax: 0.12, buildable: true },
  cafe:    { name: "Café",    emoji: "☕", cost: 3000,    gross: 13.5, wages: 4,    rent: 1.1, tax: 0.13, buildable: true },
  shop:    { name: "Laden",   emoji: "🛍️", cost: 12000,   gross: 60,   wages: 18,   rent: 1.4, tax: 0.14, buildable: true },
  hotel:   { name: "Hotel",   emoji: "🏨", cost: 45000,   gross: 250,  wages: 75,   rent: 1.8, tax: 0.15, buildable: true },
  factory: { name: "Fabrik",  emoji: "🏭", cost: 160000,  gross: 1000, wages: 300,  rent: 2.5, tax: 0.17, buildable: true },
  casino:  { name: "Casino",  emoji: "🎰", cost: 1000000, gross: 6200, wages: 1860, rent: 0,   tax: 0.10, buildable: false, unique: true },
  // The Bank earns passive "NPC lending" income via this P&L (volatile = default
  // risk) AND collects the interest from every player loan (see game/bank.js).
  bank:    { name: "Bank",    emoji: "🏦", cost: 500000,  gross: 3200, wages: 700,  rent: 0,   tax: 0.10, buildable: false, unique: true },
};

const BASE_LAND = 2000;        // base land value at market index 1.0
const SELL_SPREAD = 0.9;       // sell land back to the market at 90% (10% sink)
const BUYOUT_PREMIUM = 1.5;    // hostile takeover of a rival's owned business
const PERF_MIN = 0.6, PERF_MAX = 1.4;
const LAND_MIN = 0.55, LAND_MAX = 1.9;

const COLS = 5, ROWS = 4;

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
  const pool = ["kiosk", "kiosk", "cafe", "cafe", "shop", "hotel"];
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

// ─── P&L ──────────────────────────────────────────────────────────────────
function bizNet(lot) {
  const t = BUILDING_TYPES[lot.biz.type];
  const gross = t.gross * (lot.biz.perf || 1);
  const rent = lot.biz.operator !== lot.landOwner ? t.rent : 0;
  return gross - t.wages - rent - gross * t.tax;
}

function lotById(id) { return city.lots.find((l) => l.id === id) || null; }

// ─── Per-business income accrual (collect each business individually) ──────
const COLLECT_CAP_MS = 8 * 60 * 60 * 1000; // 8h offline cap per business
const elapsedMs = (since, now) => Math.min(now - (since || now), COLLECT_CAP_MS);

/** Chips `key` has accrued from one lot (operating profit if they run it, else
 *  rent if they're the landlord letting a tenant operate). */
function lotPending(lot, key, now = Date.now()) {
  if (!lot.biz) return 0;
  if (lot.biz.operator === key)
    return Math.max(0, bizNet(lot)) * elapsedMs(lot.biz.opAt, now) / 1000;
  if (lot.landOwner === key && lot.biz.operator && lot.biz.operator !== key)
    return BUILDING_TYPES[lot.biz.type].rent * elapsedMs(lot.biz.rentAt, now) / 1000;
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
  return {
    cols: COLS, rows: ROWS, buildingTypes: BUILDING_TYPES, buyoutPremium: BUYOUT_PREMIUM,
    landPrice: landPrice(), landSellPrice: landSellPrice(), landIndex: round(city.landIndex || 1),
    lots: city.lots.map((l) => {
      const t = l.biz && BUILDING_TYPES[l.biz.type];
      // P&L from the viewer's perspective (rent shown unless the viewer owns the land).
      let pnl = null;
      if (l.biz) {
        const operator = l.biz.operator;
        const landOwnedByOp = operator === null ? l.landOwner === key : l.landOwner === operator;
        const gross = t.gross * (l.biz.perf || 1);
        const rent = landOwnedByOp ? 0 : t.rent;
        const tax = gross * t.tax;
        pnl = { gross: round(gross), wages: round(t.wages), rent: round(rent), tax: round(tax), net: round(gross - t.wages - rent - tax) };
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
          forLease: l.biz.forLease, pnl,
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

function err(error) { return { ok: false, error }; }

module.exports = {
  BUILDING_TYPES,
  publicCity, ownerIncomeRate, ownerValue, casinoOwner, bankOwner, tickMarket,
  buyLand, sellLand, setForRent, build, buyBiz, takeover, setForLease, lease, lotById,
  collectLot, totalPending,
};
