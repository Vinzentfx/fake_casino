"use strict";

/**
 * Shared city — one world map owned by everyone together, with a per-business
 * profit-and-loss model so running a company feels real:
 *
 *   net profit/sec = revenue − wages − rent − taxes
 *
 * Revenue fluctuates with a per-business "performance" factor that drifts over
 * time (a little market life, not a flat number). Land and business are owned
 * SEPARATELY: if you run a business on land you don't own, you pay rent to the
 * landowner (or to the city, if it's NPC land). Owning the land too = no rent.
 * Exactly one casino lot is the endgame trophy. Persisted to data/city.json.
 *
 * Knows nothing about accounts — chip moves are the caller's job (economy.js).
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const CITY_FILE = path.join(DATA_DIR, "city.json");

// Per-second figures. BALANCING NOTE: placeholders; net stays positive even at
// the worst performance (PERF_MIN) so businesses never silently drain a bank.
const BUILDING_TYPES = {
  kiosk:   { name: "Kiosk",   emoji: "🏪", cost: 600,     gross: 3,    wages: 0.8,  rent: 0.6,  tax: 0.12, buildable: true },
  cafe:    { name: "Café",    emoji: "☕", cost: 3000,    gross: 14,   wages: 4.5,  rent: 2.5,  tax: 0.14, buildable: true },
  shop:    { name: "Laden",   emoji: "🛍️", cost: 12000,   gross: 48,   wages: 15,   rent: 8,    tax: 0.15, buildable: true },
  hotel:   { name: "Hotel",   emoji: "🏨", cost: 45000,   gross: 160,  wages: 52,   rent: 26,   tax: 0.16, buildable: true },
  factory: { name: "Fabrik",  emoji: "🏭", cost: 160000,  gross: 700,  wages: 200,  rent: 95,   tax: 0.15, buildable: true },
  casino:  { name: "Casino",  emoji: "🎰", cost: 1000000, gross: 6000, wages: 1800, rent: 0,    tax: 0.10, buildable: false, unique: true },
};

const LAND_COST = 2000;        // price to buy a lot's land
const BUYOUT_PREMIUM = 1.5;    // hostile takeover of another player's business
const PERF_MIN = 0.6, PERF_MAX = 1.4;

const COLS = 5, ROWS = 4;      // 20 lots

let city = load();

function load() {
  try {
    const c = JSON.parse(fs.readFileSync(CITY_FILE, "utf8"));
    if (c && Array.isArray(c.lots) && c.lots.length && "landOwner" in c.lots[0]) return c;
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
      lots.push({ id: id++, x, y, landOwner: null, landOwnerName: null, biz: null });

  const mkBiz = (type) => ({ type, owner: null, ownerName: null, perf: 1 });
  const mid = lots[Math.floor(lots.length / 2)];
  mid.biz = mkBiz("casino");
  const pool = ["kiosk", "kiosk", "cafe", "cafe", "shop", "hotel"];
  const free = lots.filter((l) => !l.biz);
  for (const t of pool) {
    if (!free.length) break;
    const i = crypto.randomInt(free.length);
    free[i].biz = mkBiz(t);
    free.splice(i, 1);
  }
  return { lots, createdAt: Date.now() };
}

// ─── Market life: drift each business's performance toward 1.0 with noise ───
function tickMarket() {
  for (const lot of city.lots) {
    if (!lot.biz) continue;
    const p = lot.biz.perf || 1;
    const drift = (1 - p) * 0.1;
    const noise = (Math.random() * 2 - 1) * 0.12;
    lot.biz.perf = Math.max(PERF_MIN, Math.min(PERF_MAX, p + drift + noise));
  }
  save();
}

// ─── P&L ────────────────────────────────────────────────────────────────────
function bizPnl(lot) {
  const t = BUILDING_TYPES[lot.biz.type];
  const gross = t.gross * (lot.biz.perf || 1);
  const rent = lot.biz.owner !== lot.landOwner ? t.rent : 0; // rent unless you own the land
  const tax = gross * t.tax;
  const net = gross - t.wages - rent - tax;
  return { gross, wages: t.wages, rent, tax, net };
}

function lotById(id) { return city.lots.find((l) => l.id === id) || null; }

/** Passive income/sec for `key`: net profit of businesses they run + rent from land they let. */
function ownerIncomeRate(key) {
  let rate = 0;
  for (const lot of city.lots) {
    if (lot.biz && lot.biz.owner === key) rate += bizPnl(lot).net;
    // Landlord: someone else runs a business on your land → you collect its rent.
    if (lot.landOwner === key && lot.biz && lot.biz.owner && lot.biz.owner !== key) {
      rate += BUILDING_TYPES[lot.biz.type].rent;
    }
  }
  return rate;
}

/** Chip value of land + businesses `key` owns (for net worth). */
function ownerValue(key) {
  let total = 0;
  for (const lot of city.lots) {
    if (lot.landOwner === key) total += LAND_COST;
    if (lot.biz && lot.biz.owner === key) total += BUILDING_TYPES[lot.biz.type].cost;
  }
  return total;
}

function casinoOwner() {
  const lot = city.lots.find((l) => l.biz && l.biz.type === "casino");
  return lot && lot.biz ? lot.biz.owner : null;
}

const round = (n) => Math.round(n * 100) / 100;

function publicCity(key) {
  return {
    cols: COLS, rows: ROWS, landCost: LAND_COST, buyoutPremium: BUYOUT_PREMIUM,
    buildingTypes: BUILDING_TYPES,
    lots: city.lots.map((l) => {
      const t = l.biz && BUILDING_TYPES[l.biz.type];
      // P&L perspective: for a free business show what the VIEWER would earn if
      // they bought it (rent unless they own the land); for an owned business
      // show the actual operator's figures.
      let pnl = null;
      if (l.biz) {
        const operator = l.biz.owner;
        const landOwnedByOperator = operator === null ? l.landOwner === key : l.landOwner === operator;
        const gross = t.gross * (l.biz.perf || 1);
        const rent = landOwnedByOperator ? 0 : t.rent;
        const tax = gross * t.tax;
        pnl = { gross, wages: t.wages, rent, tax, net: gross - t.wages - rent - tax };
      }
      // Available actions for this viewer.
      const landAction = l.landOwner === null ? "buyLand" : null;
      let bizAction = null, bizPrice = 0;
      if (!l.biz) {
        if (l.landOwner === key) bizAction = "build";
      } else if (l.biz.owner === null) { bizAction = "buy"; bizPrice = t.cost; }
      else if (l.biz.owner === key) bizAction = null;
      else { bizAction = "takeover"; bizPrice = Math.ceil(t.cost * BUYOUT_PREMIUM); }
      return {
        id: l.id, x: l.x, y: l.y,
        landOwner: l.landOwner, landOwnerName: l.landOwnerName, landMine: l.landOwner === key,
        landAction, landPrice: LAND_COST,
        emoji: t ? t.emoji : null,
        biz: l.biz ? {
          type: l.biz.type, name: t.name, emoji: t.emoji,
          owner: l.biz.owner, ownerName: l.biz.ownerName, mine: l.biz.owner === key,
          pnl: { gross: round(pnl.gross), wages: round(pnl.wages), rent: round(pnl.rent), tax: round(pnl.tax), net: round(pnl.net) },
        } : null,
        bizAction, bizPrice,
        // "mine" = viewer has any stake (land or business) on this lot.
        mine: l.landOwner === key || (l.biz && l.biz.owner === key),
        rival: (l.landOwner && l.landOwner !== key) || (l.biz && l.biz.owner && l.biz.owner !== key),
      };
    }),
  };
}

// ─── Mutations (return { ok, cost, [prevOwner], commit } or { ok:false, error }) ──
function buyLand(id, key, name) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Grundstück nicht gefunden." };
  if (lot.landOwner !== null) return { ok: false, error: "Grundstück ist nicht frei." };
  return { ok: true, cost: LAND_COST, commit: () => { lot.landOwner = key; lot.landOwnerName = name; save(); } };
}

function build(id, key, typeId, name) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Grundstück nicht gefunden." };
  if (lot.landOwner !== key) return { ok: false, error: "Du musst erst das Grundstück besitzen." };
  if (lot.biz) return { ok: false, error: "Hier steht schon etwas." };
  const t = BUILDING_TYPES[typeId];
  if (!t || !t.buildable) return { ok: false, error: "Kann hier nicht gebaut werden." };
  return { ok: true, cost: t.cost, commit: () => { lot.biz = { type: typeId, owner: key, ownerName: name, perf: 1 }; save(); } };
}

function buyBiz(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return { ok: false, error: "Kein Unternehmen hier." };
  if (lot.biz.owner !== null) return { ok: false, error: "Gehört schon jemandem." };
  const t = BUILDING_TYPES[lot.biz.type];
  return { ok: true, cost: t.cost, commit: () => { lot.biz.owner = key; lot.biz.ownerName = name; save(); } };
}

function takeover(id, key, name) {
  const lot = lotById(id);
  if (!lot || !lot.biz) return { ok: false, error: "Kein Unternehmen hier." };
  if (lot.biz.owner === null) return { ok: false, error: "Nutze „kaufen“." };
  if (lot.biz.owner === key) return { ok: false, error: "Gehört dir bereits." };
  const t = BUILDING_TYPES[lot.biz.type];
  const cost = Math.ceil(t.cost * BUYOUT_PREMIUM);
  const prevOwner = lot.biz.owner;
  return { ok: true, cost, prevOwner, commit: () => { lot.biz.owner = key; lot.biz.ownerName = name; save(); } };
}

module.exports = {
  BUILDING_TYPES, LAND_COST,
  publicCity, ownerIncomeRate, ownerValue, casinoOwner, tickMarket,
  buyLand, build, buyBiz, takeover, lotById,
};
