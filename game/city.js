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

const BUILDING_TYPES = {
  kiosk:   { name: "Kiosk",   emoji: "🏪", cost: 600,     gross: 3,    wages: 0.8,  rent: 0.6,  tax: 0.12, buildable: true },
  cafe:    { name: "Café",    emoji: "☕", cost: 3000,    gross: 14,   wages: 4.5,  rent: 2.5,  tax: 0.14, buildable: true },
  shop:    { name: "Laden",   emoji: "🛍️", cost: 12000,   gross: 48,   wages: 15,   rent: 8,    tax: 0.15, buildable: true },
  hotel:   { name: "Hotel",   emoji: "🏨", cost: 45000,   gross: 160,  wages: 52,   rent: 26,   tax: 0.16, buildable: true },
  factory: { name: "Fabrik",  emoji: "🏭", cost: 160000,  gross: 700,  wages: 200,  rent: 95,   tax: 0.15, buildable: true },
  casino:  { name: "Casino",  emoji: "🎰", cost: 1000000, gross: 6000, wages: 1800, rent: 0,    tax: 0.10, buildable: false, unique: true },
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
    lot.biz = { type: typeId, builtBy: key, builtByName: name, operator: key, operatorName: name, perf: 1, forLease: false };
    save();
  } };
}

function buyBiz(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return err("Kein Unternehmen hier.");
  if (lot.biz.operator !== null || lot.biz.builtBy !== null) return err("Gehört schon jemandem.");
  const t = BUILDING_TYPES[lot.biz.type];
  return { ok: true, cost: t.cost, commit: () => {
    lot.biz.builtBy = key; lot.biz.builtByName = name; lot.biz.operator = key; lot.biz.operatorName = name; save();
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
    lot.biz.builtBy = key; lot.biz.builtByName = name; lot.biz.operator = key; lot.biz.operatorName = name; lot.biz.forLease = false; save();
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
    lot.biz.operator = key; lot.biz.operatorName = name; lot.biz.forLease = false; save();
  } };
}

function err(error) { return { ok: false, error }; }

module.exports = {
  BUILDING_TYPES,
  publicCity, ownerIncomeRate, ownerValue, casinoOwner, tickMarket,
  buyLand, sellLand, setForRent, build, buyBiz, takeover, setForLease, lease, lotById,
};
