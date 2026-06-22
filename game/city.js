"use strict";

/**
 * Shared city — a single world map owned by everyone together.
 *
 * The city is a fixed set of lots laid out on a street grid. Each lot is one of:
 *   - empty land (owner null, type null)        → buy the land, then build on it
 *   - an NPC business (owner null, type set)     → buy it out at its base price
 *   - a player business (owner set, type set)    → another player can buy it out
 *                                                  at a premium (hostile takeover)
 * Exactly one CASINO lot exists (the endgame trophy). Income & lot value are
 * computed per owner from the buildings they hold. Persisted to data/city.json.
 *
 * Knows nothing about accounts — chip moves are the caller's job (economy.js).
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const CITY_FILE = path.join(DATA_DIR, "city.json");

// Building catalog. `cost` = build / NPC-buyout price; `income` = chips/sec to owner.
// BALANCING NOTE: placeholder values, tuned later.
const BUILDING_TYPES = {
  kiosk:   { name: "Kiosk",   emoji: "🏪", cost: 500,     income: 1,    buildable: true },
  cafe:    { name: "Café",    emoji: "☕", cost: 2500,    income: 5,    buildable: true },
  shop:    { name: "Laden",   emoji: "🛍️", cost: 10000,   income: 18,   buildable: true },
  hotel:   { name: "Hotel",   emoji: "🏨", cost: 40000,   income: 65,   buildable: true },
  factory: { name: "Fabrik",  emoji: "🏭", cost: 150000,  income: 230,  buildable: true },
  casino:  { name: "Casino",  emoji: "🎰", cost: 1000000, income: 1500, buildable: false, unique: true },
};

const LAND_COST = 1000;        // price to buy an empty lot
const BUYOUT_PREMIUM = 1.5;    // multiplier when seizing another player's business

const COLS = 5;
const ROWS = 4;                // 20 lots total

let city = load();

function load() {
  try {
    const c = JSON.parse(fs.readFileSync(CITY_FILE, "utf8"));
    if (c && Array.isArray(c.lots) && c.lots.length) return c;
  } catch {}
  return generate();
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CITY_FILE, JSON.stringify(city, null, 2));
  } catch {}
}

/** Build the initial city: one casino, a handful of NPC businesses, the rest empty land. */
function generate() {
  const lots = [];
  let id = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      lots.push({ id: id++, x, y, type: null, owner: null, ownerName: null });
    }
  }
  const rnd = (n) => crypto.randomInt(n);
  // Casino roughly in the middle.
  const mid = lots[Math.floor(lots.length / 2)];
  mid.type = "casino";
  // Seed ~6 NPC businesses (cheaper ones more common) on random empty lots.
  const npcPool = ["kiosk", "kiosk", "cafe", "cafe", "shop", "hotel"];
  const free = lots.filter((l) => l.type === null);
  for (const t of npcPool) {
    if (!free.length) break;
    const i = rnd(free.length);
    free[i].type = t;
    free.splice(i, 1);
  }
  return { lots, createdAt: Date.now() };
}

// ─── Queries ──────────────────────────────────────────────────────────────

function lotById(id) {
  return city.lots.find((l) => l.id === id) || null;
}

function lotValue(lot) {
  if (!lot || lot.owner === null) return 0; // only owned lots count toward net worth
  if (lot.type && BUILDING_TYPES[lot.type]) return BUILDING_TYPES[lot.type].cost;
  return LAND_COST; // owned empty land
}

/** Passive income per second for everything `key` owns. */
function ownerIncomeRate(key) {
  let rate = 0;
  for (const lot of city.lots) {
    if (lot.owner === key && lot.type && BUILDING_TYPES[lot.type]) {
      rate += BUILDING_TYPES[lot.type].income;
    }
  }
  return rate;
}

/** Total chip value of everything `key` owns (for net worth). */
function ownerValue(key) {
  let total = 0;
  for (const lot of city.lots) if (lot.owner === key) total += lotValue(lot);
  return total;
}

/** Is `key` the casino owner? */
function casinoOwner() {
  const lot = city.lots.find((l) => l.type === "casino");
  return lot ? lot.owner : null;
}

/** Public, client-safe view. `key` marks which lots are the viewer's. */
function publicCity(key) {
  return {
    cols: COLS,
    rows: ROWS,
    landCost: LAND_COST,
    buyoutPremium: BUYOUT_PREMIUM,
    buildingTypes: BUILDING_TYPES,
    lots: city.lots.map((l) => {
      const t = l.type && BUILDING_TYPES[l.type];
      return {
        id: l.id, x: l.x, y: l.y,
        type: l.type,
        emoji: t ? t.emoji : null,
        typeName: t ? t.name : null,
        income: t ? t.income : 0,
        owner: l.owner,
        ownerName: l.ownerName,
        mine: l.owner === key,
        // What the viewer would pay to act on this lot.
        price: priceFor(l, key),
        action: actionFor(l, key),
      };
    }),
  };
}

/** Which action a viewer can take on a lot: "buyLand" | "build" | "buyout" | null. */
function actionFor(lot, key) {
  if (lot.owner === key) return lot.type === null ? "build" : null; // own empty land → build
  if (lot.owner === null) return lot.type === null ? "buyLand" : "buyout"; // empty/NPC
  return "buyout"; // someone else's business → hostile takeover
}

function priceFor(lot, key) {
  const a = actionFor(lot, key);
  if (a === "buyLand") return LAND_COST;
  if (a === "buyout") {
    const base = lot.type && BUILDING_TYPES[lot.type] ? BUILDING_TYPES[lot.type].cost : LAND_COST;
    return lot.owner === null ? base : Math.ceil(base * BUYOUT_PREMIUM);
  }
  return 0;
}

// ─── Mutations (validated; return { ok, cost, error }) ──────────────────────

function buyLand(id, key, name) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Grundstück nicht gefunden." };
  if (lot.type !== null || lot.owner !== null) return { ok: false, error: "Nicht verfügbar." };
  return { ok: true, cost: LAND_COST, commit: () => { lot.owner = key; lot.ownerName = name; save(); } };
}

function build(id, key, typeId, name) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Grundstück nicht gefunden." };
  if (lot.owner !== key) return { ok: false, error: "Gehört dir nicht." };
  if (lot.type !== null) return { ok: false, error: "Hier steht schon etwas." };
  const t = BUILDING_TYPES[typeId];
  if (!t || !t.buildable) return { ok: false, error: "Kann hier nicht gebaut werden." };
  return { ok: true, cost: t.cost, commit: () => { lot.type = typeId; lot.ownerName = name; save(); } };
}

function buyout(id, key, name) {
  const lot = lotById(id);
  if (!lot) return { ok: false, error: "Nicht gefunden." };
  if (lot.type === null) return { ok: false, error: "Leeres Grundstück — kauf das Land." };
  if (lot.owner === key) return { ok: false, error: "Gehört dir bereits." };
  const cost = priceFor(lot, key);
  const prevOwner = lot.owner;
  return {
    ok: true, cost, prevOwner,
    commit: () => { lot.owner = key; lot.ownerName = name; save(); },
  };
}

module.exports = {
  BUILDING_TYPES, LAND_COST,
  publicCity, ownerIncomeRate, ownerValue, casinoOwner,
  buyLand, build, buyout, lotById,
};
