"use strict";

/**
 * Shared city — REAL MAP EDITION (Porta Westfalica), territory & status model.
 *
 * The map is a one-time OSM snapshot (game/data/porta.json): multiple Stadtteile
 * with their real buildings, streets and landmarks. The city is a chip SINK +
 * a TERRITORY/STATUS layer — money comes from playing the games. There are no
 * ownership buffs any more. Instead, owning real estate gives you:
 *
 *   • STRASSEN-MONOPOLE — own every addressed house of a street (≥3 houses)
 *     and the street lights up in your colour on the map, for everyone.
 *   • STADTTEIL-BOSS — the player with the highest property value in a
 *     district wears the crown on the overview map.
 *   • TROPHÄEN — unique real buildings (Bahnhof, Kirchen, Schulen, plus the
 *     biggest building of each district) with a title and a small thematic
 *     perk. Only one owner each.
 *   • SPEKULATION — every district has its own price index, moved by drift
 *     and by silly local news events. Buy low, sell high (10% spread).
 *   • The CASINO (rake) and the BANK (prestige) stay the two apex
 *     assets, tied to other players actively gambling.
 *
 * Static geometry lives in the repo; ownership lives in data/city.json.
 */

const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "city.json");
const MAP_FILE = path.join(__dirname, "data", "porta.json");

// Building classes drive the PRICE only (no buffs).
const CLASSES = {
  residential: { name: "Wohnhaus",   emoji: "🏠", base: 25000,      refA: 140 },
  civic:       { name: "Öffentlich", emoji: "🏛️", base: 120000,     refA: 400 },
  kiosk:       { name: "Kiosk",      emoji: "🏪", base: 400000,     refA: 100 },
  cafe:        { name: "Café",       emoji: "☕", base: 2000000,    refA: 150 },
  shop:        { name: "Laden",      emoji: "🛍️", base: 10000000,   refA: 300 },
  hotel:       { name: "Hotel",      emoji: "🏨", base: 50000000,   refA: 500 },
  factory:     { name: "Fabrik",     emoji: "🏭", base: 250000000,  refA: 1500 },
  casino:      { name: "Casino",     emoji: "🎰", base: 1200000000, refA: 0, perk: "Kassiert den Rake aller Hausspiele." },
  bank:        { name: "Bank",       emoji: "🏦", base: 600000000,  refA: 0, perk: "Prestige-Objekt der Stadt." },
};

// Unique trophy buildings: title + small thematic perk. Price = normal × mult.
const TROPHIES = {
  bahnhof:     { title: "Bahnhofs-Baron",   emoji: "🚉", perk: "Pendler-Bonus: Stunden-Bonus ×1,5", mult: 10 },
  kirche:      { title: "Kirchenpatron",    emoji: "⛪", perk: "Segen: 15 % Verlust-Cashback (statt 10 %) mit doppeltem Limit · Soforthilfe ×2", mult: 8 },
  schule:      { title: "Schulleiter",      emoji: "🏫", perk: "Bildung: Serien-Bonus ×2 & Serie verfällt nie · Klicks ×3", mult: 8 },
  wahrzeichen: { title: "Wahrzeichen",      emoji: "🏛️", perk: "Prestige: das größte Gebäude des Ortsteils", mult: 12 },
};

const SELL_SPREAD = 0.9;     // sell back at 90% (10% sink) → speculation needs real moves
const BUYOUT_PREMIUM = 1.5;  // takeover: buyer pays 150%, ex-owner gets 100%, 50% burns
const IDX_MIN = 0.55, IDX_MAX = 1.9;
const LANDMARK_BOOST = 1.25;
const LANDMARK_RADIUS = 120;
const MONOPOly_MIN = 3;      // a street needs ≥3 addressed houses to be a monopoly target

// Stable player colours for territory painting (same hash client-side).
const PLAYER_COLORS = ["#e6b04b", "#5ea8e0", "#66c07a", "#c86bd6", "#e0705e", "#4fc7c0", "#d1a35e", "#8f9fe8"];
function colorFor(key) {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

// Local news that move a district's price index (Spekulation).
const EVENT_POOL = [
  { txt: "🎪 Schützenfest in {d} — alle wollen hin!", f: 1.15 },
  { txt: "🚧 Großbaustelle in {d} — der Lärm nervt.", f: 0.87 },
  { txt: "🚌 Neue Buslinie nach {d}!", f: 1.10 },
  { txt: "🌊 Weser-Hochwasser bei {d} — Keller unter Wasser.", f: 0.84 },
  { txt: "🛜 Glasfaser-Ausbau in {d} abgeschlossen.", f: 1.12 },
  { txt: "🦫 Biber blockieren Neubaugebiet in {d}.", f: 0.91 },
  { txt: "🏆 {d} gewinnt den „Schönstes Dorf“-Wettbewerb!", f: 1.18 },
  { txt: "👻 Spuk-Gerüchte in {d} — Makler verzweifelt.", f: 0.89 },
  { txt: "☕ Hippes Café eröffnet in {d}.", f: 1.08 },
  { txt: "🛣️ Umgehungsstraße entlastet {d}.", f: 1.07 },
  { txt: "🐗 Wildschwein-Rotte wühlt Gärten in {d} um.", f: 0.93 },
  { txt: "🎬 Filmteam dreht in {d} — {d} ist berühmt!", f: 1.14 },
  { txt: "💨 Starker Wind beschädigt Dächer in {d}.", f: 0.88 },
  { txt: "🎡 Jahrmarkt in {d} — alle wollen hin!", f: 1.13 },
  { txt: "🦠 Virus-Ausbruch in {d} — alle bleiben zu Hause.", f: 0.85 },
  { txt: "🌳 Big Yahu ist in {d}.", f: 1.2 },
  { txt: "🦗 Der Axtmörder treibt sein unwesen in {d}!", f: 0.82 },
];

// ─── Static map (repo snapshot) ─────────────────────────────────────────────
let MAP = { city: "?", districts: [] };
const bldIndex = new Map();   // building id -> { b, district }
let CASINO_ID = null, BANK_ID = null;

function loadMap() {
  try {
    MAP = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  } catch (e) {
    console.error("city: Karten-Snapshot fehlt (game/data/porta.json) — Stadt ist leer.", e.message);
    MAP = { city: "Porta Westfalica", districts: [] };
  }
  bldIndex.clear();
  for (const d of MAP.districts) {
    for (const b of d.buildings) {
      b._did = d.id;
      // Street key: only buildings with a real house number belong to a street
      // set ("Zur Porta 88" → "Zur Porta"); borrowed street names don't count.
      const m = b.n && b.n.match(/^(.+?)\s+(\d.*)$/);
      b.st = m ? m[1] : null;
      b.lm = 0;
      for (const l of d.landmarks || []) {
        if (Math.abs(l.x - b.c[0]) < LANDMARK_RADIUS && Math.abs(l.y - b.c[1]) < LANDMARK_RADIUS) { b.lm = 1; break; }
      }
      bldIndex.set(b.id, { b, district: d });
    }
  }
  // Unique prestige assets: Casino = largest non-residential in Hausberge,
  // Bank = largest real bank building.
  const hb = MAP.districts.find((d) => d.id === "hausberge");
  if (hb) {
    const cand = hb.buildings.filter((b) => b.cls !== "residential").sort((a, z) => z.a - a.a);
    if (cand.length) { CASINO_ID = cand[0].id; cand[0].cls = "casino"; }
  }
  let banks = [];
  for (const d of MAP.districts) banks = banks.concat(d.buildings.filter((b) => b.bank && b.id !== CASINO_ID));
  if (!banks.length) for (const d of MAP.districts) banks = banks.concat(d.buildings.filter((b) => b.cls === "civic" && b.id !== CASINO_ID));
  banks.sort((a, z) => z.a - a.a);
  if (banks.length) { BANK_ID = banks[0].id; banks[0].cls = "bank"; }

  // Trophies: Bahnhöfe, Kirchen, Schulgebäude — plus the biggest building of
  // each district as its "Wahrzeichen". One owner each, real names included.
  for (const d of MAP.districts) {
    for (const b of d.buildings) {
      if (b.id === CASINO_ID || b.id === BANK_ID) continue;
      if (b.t === "train_station") b.trophy = "bahnhof";
      else if (b.t === "church" || b.t === "chapel") b.trophy = "kirche";
      else if (b.t === "school" || (b.nm && /schule/i.test(b.nm))) b.trophy = "schule";
    }
    const biggest = d.buildings
      .filter((b) => !b.trophy && b.id !== CASINO_ID && b.id !== BANK_ID)
      .sort((a, z) => z.a - a.a)[0];
    if (biggest) biggest.trophy = "wahrzeichen";
  }

  // Street groups per district (monopoly targets).
  for (const d of MAP.districts) {
    d._streets = new Map();
    for (const b of d.buildings) {
      if (!b.st) continue;
      if (!d._streets.has(b.st)) d._streets.set(b.st, []);
      d._streets.get(b.st).push(b.id);
    }
    for (const [st, ids] of d._streets) if (ids.length < MONOPOly_MIN) d._streets.delete(st);
  }
}
loadMap();

// ─── Ownership state (data volume) ──────────────────────────────────────────
let state = loadState();

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s && s.v === "porta2" && s.own) return s;
    if (s && s.v === "porta1" && s.own) return { v: "porta2", own: s.own, idx: {}, news: [], createdAt: s.createdAt || Date.now() };
  } catch {}
  return { v: "porta2", own: {}, idx: {}, news: [], createdAt: Date.now() };
}

function save() {
  derivedDirty = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {}
}

const idxOf = (did) => state.idx[did] || 1;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (n) => Math.round(n * 100) / 100;

// ─── Market life: per-district index drift + local news events ─────────────

/** Fire a random local news event (optionally in a chosen district). */
function fireEvent(districtId) {
  if (!MAP.districts.length) return null;
  const d = (districtId && MAP.districts.find((x) => x.id === districtId))
    || MAP.districts[Math.floor(Math.random() * MAP.districts.length)];
  const ev = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)];
  state.idx[d.id] = clamp(idxOf(d.id) * ev.f, IDX_MIN, IDX_MAX);
  const event = { txt: ev.txt.replace(/\{d\}/g, d.name), district: d.id, up: ev.f > 1, at: Date.now() };
  state.news.unshift(event);
  state.news = state.news.slice(0, 6);
  save();
  return event;
}

function tickMarket() {
  for (const d of MAP.districts) {
    const i = idxOf(d.id);
    // Weak mean reversion + strong noise: after an event the index takes
    // unpredictable HOURS to normalise (was 4%/min → a dip recovered in ~30
    // min, which made "buy every crash" a riskless arbitrage loop).
    state.idx[d.id] = clamp(i + (1 - i) * 0.006 + (Math.random() * 2 - 1) * 0.02, IDX_MIN, IDX_MAX);
  }
  // Roughly every ~8 minutes (60s ticks) a local event shakes one district.
  const event = MAP.districts.length && Math.random() < 0.12 ? fireEvent() : null;
  save();
  return event;
}

/** Price: class base × footprint scale × landmark × trophy premium × district index.
 *  Trophies are clamped into a 5M–500M band: always a serious purchase, but
 *  always below Bank (600M) and Casino (1.2B). */
function priceOf(b) {
  const c = CLASSES[b.cls];
  if (b.cls === "casino" || b.cls === "bank") return c.base;
  const sizeScale = clamp(Math.pow(b.a / c.refA, 0.6), 0.6, 2.5);
  const lm = b.lm ? LANDMARK_BOOST : 1;
  let price = c.base * sizeScale * lm;
  if (b.trophy) price = clamp(price * TROPHIES[b.trophy].mult, 5_000_000, 500_000_000);
  return Math.round((price * idxOf(b._did)) / 100) * 100;
}
const sellPriceOf = (b) => Math.round(priceOf(b) * SELL_SPREAD);
const ownerOf = (id) => (state.own[id] ? state.own[id].owner : null);

// ─── Derived territory stats (cached, recomputed after every change) ───────
let derivedDirty = true;
let derived = null;

function getDerived() {
  if (!derivedDirty && derived) return derived;
  const monopolies = {};       // did -> [{ st, owner, ownerName, color, count }]
  const streetsByOwner = {};   // key -> count of complete streets
  const bossByDistrict = {};   // did -> { owner, name, color, value }
  const valueByOwner = {};     // key -> total property value

  for (const d of MAP.districts) {
    monopolies[d.id] = [];
    const perOwner = {};
    for (const b of d.buildings) {
      const o = state.own[b.id];
      if (!o) continue;
      perOwner[o.owner] = perOwner[o.owner] || { value: 0, name: o.ownerName };
      perOwner[o.owner].value += priceOf(b);
      valueByOwner[o.owner] = (valueByOwner[o.owner] || 0) + priceOf(b);
    }
    let boss = null;
    for (const [k, v] of Object.entries(perOwner)) {
      if (!boss || v.value > boss.value) boss = { owner: k, name: v.name, value: v.value };
    }
    if (boss) bossByDistrict[d.id] = { ...boss, color: colorFor(boss.owner) };

    for (const [st, ids] of d._streets) {
      const first = state.own[ids[0]];
      if (!first) continue;
      const owner = first.owner;
      if (ids.every((id) => state.own[id] && state.own[id].owner === owner)) {
        monopolies[d.id].push({ st, owner, ownerName: first.ownerName, color: colorFor(owner), count: ids.length });
        streetsByOwner[owner] = (streetsByOwner[owner] || 0) + 1;
      }
    }
  }
  derived = { monopolies, streetsByOwner, bossByDistrict, valueByOwner };
  derivedDirty = false;
  return derived;
}

/** Complete streets a player owns (Straßenkönig leaderboard). */
const streetCount = (key) => getDerived().streetsByOwner[key] || 0;

/** Number of buildings a player owns (Haus-Tribut). */
function houseCount(key) {
  let n = 0;
  for (const o of Object.values(state.own)) if (o.owner === key) n++;
  return n;
}

// ─── Goldene Straße der Woche ───────────────────────────────────────────────
// One random street per week pays DOUBLE tribute — everyone fights over it.
function rollGoldenStreet() {
  const candidates = [];
  for (const d of MAP.districts)
    for (const st of d._streets.keys()) candidates.push({ district: d.id, districtName: d.name, st });
  if (!candidates.length) { state.golden = null; save(); return null; }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.golden = pick;
  save();
  return pick;
}
const goldenStreet = () => state.golden || null;
/** Does `key` hold the complete golden street? (→ its tribute counts double.) */
function ownsGolden(key) {
  const g = state.golden;
  if (!g) return false;
  const list = getDerived().monopolies[g.district] || [];
  return list.some((m) => m.st === g.st && m.owner === key);
}

// ─── Haus-Sets (collection bonuses) ─────────────────────────────────────────
/** Sets `key` has completed → [{id, label, emoji, tribute}] */
function setsOf(key) {
  const out = [];
  if (!key || !MAP.districts.length) return out;
  // 🌍 Stadtbekannt: at least one building in EVERY district.
  const perDistrict = MAP.districts.map((d) => d.buildings.some((b) => state.own[b.id] && state.own[b.id].owner === key));
  if (perDistrict.every(Boolean))
    out.push({ id: "stadtbekannt", label: "Stadtbekannt", emoji: "🌍", tribute: 2000 });
  // ☕ Kaffee-Kartell: ALL cafés of one district (needs ≥3 cafés there).
  for (const d of MAP.districts) {
    const cafes = d.buildings.filter((b) => b.cls === "cafe");
    if (cafes.length >= 3 && cafes.every((b) => state.own[b.id] && state.own[b.id].owner === key)) {
      out.push({ id: "kartell_" + d.id, label: `Kaffee-Kartell ${d.name}`, emoji: "☕", tribute: 3000 });
    }
  }
  return out;
}

/** Total city property value of a player (net worth + Immobilien-Mogul). */
function ownerValue(key) {
  return getDerived().valueByOwner[key] || 0;
}

/** Trophies a player holds → [{kind, title, emoji, name}] */
function trophiesOf(key) {
  const out = [];
  for (const [id, o] of Object.entries(state.own)) {
    if (o.owner !== key) continue;
    const e = bldIndex.get(Number(id));
    if (e && e.b.trophy) out.push({ kind: e.b.trophy, ...TROPHIES[e.b.trophy], name: e.b.nm || e.b.n || e.district.name });
  }
  return out;
}
const hasTrophy = (key, kind) => trophiesOf(key).some((t) => t.kind === kind);

const casinoOwner = () => (CASINO_ID != null ? ownerOf(CASINO_ID) : null);
const bankOwner = () => (BANK_ID != null ? ownerOf(BANK_ID) : null);

/** Is `key` the current boss of a district? (Boss buys 10% cheaper there.) */
const BOSS_DISCOUNT = 0.9;
function isBoss(key, did) {
  const b = getDerived().bossByDistrict[did];
  return !!(b && b.owner === key);
}

/** Cheap territory snapshot for conquest broadcasts (diff before/after). */
function territorySnapshot() {
  const der = getDerived();
  const monos = new Set();
  for (const [did, list] of Object.entries(der.monopolies))
    for (const m of list) monos.add(`${did}|${m.st}|${m.owner}`);
  const boss = {};
  for (const [did, b] of Object.entries(der.bossByDistrict)) boss[did] = b.owner;
  return { monos, boss };
}

/** Human messages for everything that changed between two snapshots. */
function territoryDiff(before, after) {
  const msgs = [];
  const nameOf = (did) => { const d = MAP.districts.find((x) => x.id === did); return d ? d.name : did; };
  for (const entry of after.monos) {
    if (before.monos.has(entry)) continue;
    const [, st, owner] = entry.split("|");
    const o = Object.values(state.own).find((x) => x.owner === owner);
    msgs.push(`👑 ${o ? o.ownerName : owner} hat die ${st} erobert — Straßen-Monopol!`);
  }
  for (const [did, owner] of Object.entries(after.boss)) {
    if (before.boss[did] === owner) continue;
    const o = Object.values(state.own).find((x) => x.owner === owner);
    msgs.push(`🥇 ${o ? o.ownerName : owner} ist jetzt der Boss von ${nameOf(did)}!`);
  }
  return msgs;
}

// ─── Public views ───────────────────────────────────────────────────────────
function publicOverview(key) {
  const der = getDerived();
  let me = null;
  if (key) {
    // "Meine Immobilien": every owned building, for the jump-to list.
    const properties = [];
    for (const [id, o] of Object.entries(state.own)) {
      if (o.owner !== key) continue;
      const e = bldIndex.get(Number(id));
      if (!e) continue;
      properties.push({
        id: Number(id), did: e.district.id, districtName: e.district.name,
        label: e.b.nm || e.b.n || CLASSES[e.b.cls].name,
        emoji: e.b.trophy ? TROPHIES[e.b.trophy].emoji : CLASSES[e.b.cls].emoji,
        price: priceOf(e.b),
      });
    }
    properties.sort((a, z) => z.price - a.price);
    me = {
      houses: properties.length,
      value: ownerValue(key),
      streets: streetCount(key),
      trophies: trophiesOf(key),
      bossOf: MAP.districts.filter((d) => der.bossByDistrict[d.id] && der.bossByDistrict[d.id].owner === key).map((d) => d.name),
      color: colorFor(key),
      sets: setsOf(key),
      hasGolden: ownsGolden(key),
      properties: properties.slice(0, 200),
    };
  }
  return {
    city: MAP.city,
    news: state.news,
    golden: state.golden || null,
    me,
    casinoOwnerName: CASINO_ID != null && state.own[CASINO_ID] ? state.own[CASINO_ID].ownerName : null,
    bankOwnerName: BANK_ID != null && state.own[BANK_ID] ? state.own[BANK_ID].ownerName : null,
    districts: MAP.districts.map((d) => {
      let mine = 0, taken = 0;
      for (const b of d.buildings) {
        const o = state.own[b.id];
        if (!o) continue;
        if (o.owner === key) mine++; else taken++;
      }
      const boss = der.bossByDistrict[d.id] || null;
      return {
        id: d.id, name: d.name, ring: d.ring,
        total: d.buildings.length, mine, taken,
        idx: round2(idxOf(d.id)),
        boss: boss ? { name: boss.name, color: boss.color, isMe: boss.owner === key } : null,
        monos: (der.monopolies[d.id] || []).length,
        hasCasino: d.buildings.some((b) => b.id === CASINO_ID),
        hasBank: d.buildings.some((b) => b.id === BANK_ID),
      };
    }),
  };
}

function publicDistrict(id, key) {
  const d = MAP.districts.find((x) => x.id === id);
  if (!d) return null;
  const der = getDerived();
  // Street progress info for the panel: total addressed houses per street.
  const streetTotals = {};
  for (const [st, ids] of d._streets) streetTotals[st] = ids.length;
  return {
    id: d.id, name: d.name, ring: d.ring,
    idx: round2(idxOf(d.id)),
    classes: Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, { name: c.name, emoji: c.emoji, perk: c.perk || null }])),
    trophies: TROPHIES,
    monopolies: der.monopolies[d.id] || [],
    boss: der.bossByDistrict[d.id] ? { name: der.bossByDistrict[d.id].name, color: der.bossByDistrict[d.id].color } : null,
    streetTotals,
    landmarks: (d.landmarks || []).map((l) => ({ type: l.type, name: l.name, x: l.x, y: l.y, pts: l.pts || null })),
    roads: d.roads || [],
    iAmBoss: !!key && isBoss(key, d.id),
    golden: state.golden && state.golden.district === d.id ? state.golden.st : null,
    buildings: d.buildings.map((b) => {
      const o = state.own[b.id];
      const price = priceOf(b);
      return {
        id: b.id, pts: b.pts, c: b.c, a: b.a, cls: b.cls, n: b.n, st: b.st, lm: b.lm,
        t: b.t || null, nm: b.nm || null, lv: b.lv || null,
        trophy: b.trophy || null,
        price, sellPrice: sellPriceOf(b),
        myPrice: key && isBoss(key, d.id) ? Math.round(price * BOSS_DISCOUNT) : price,
        owner: o ? o.owner : null, ownerName: o ? o.ownerName : null,
        color: o ? colorFor(o.owner) : null,
        mine: !!o && o.owner === key, listed: !!(o && o.listed),
      };
    }),
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────
function buyBuilding(id, key, name) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  if (ownerOf(e.b.id)) return err("Gehört schon jemandem — nutze „Übernehmen“.");
  // District boss buys 10% cheaper in "his" district (territory rewards territory).
  const discount = isBoss(key, e.b._did) ? BOSS_DISCOUNT : 1;
  return { ok: true, cost: Math.round(priceOf(e.b) * discount), commit: () => {
    state.own[e.b.id] = { owner: key, ownerName: name };
    save();
  } };
}

function sellBuilding(id, key) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o || o.owner !== key) return err("Gehört dir nicht.");
  return { ok: true, gain: sellPriceOf(e.b), commit: () => { delete state.own[e.b.id]; save(); } };
}

function takeover(id, key, name) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o) return err("Ist frei — einfach kaufen.");
  if (o.owner === key) return err("Gehört dir bereits.");
  const value = priceOf(e.b);
  return {
    ok: true,
    cost: Math.ceil(value * BUYOUT_PREMIUM),
    payout: { to: o.owner, amount: value },
    commit: () => { state.own[e.b.id] = { owner: key, ownerName: name }; save(); },
  };
}

function listCompany(id, key) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o || o.owner !== key) return err("Du musst das Gebäude besitzen.");
  if (!/^(kiosk|cafe|shop|hotel|factory)$/.test(e.b.cls)) return err("Nur richtige Betriebe können an die Börse.");
  if (o.listed) return err("Schon börsennotiert.");
  const t = CLASSES[e.b.cls];
  const seedPrice = Math.max(20, Math.round(priceOf(e.b) / 5000));
  const raise = Math.round(priceOf(e.b) * 0.5);
  const name = `${o.ownerName || "Spieler"} ${t.name} AG`;
  return { ok: true, name, seedPrice, raise, commit: () => { o.listed = true; save(); } };
}

const bldExists = (id) => bldIndex.has(Number(id));
/** Short display info for a building (residence line in the profile). */
function bldInfo(id) {
  const e = bldIndex.get(Number(id));
  if (!e) return null;
  const o = state.own[e.b.id];
  return {
    label: e.b.nm || e.b.n || CLASSES[e.b.cls].name,
    district: e.district.name,
    ownerName: o ? o.ownerName : null,
  };
}

function resetCity() {
  state = { v: "porta2", own: {}, idx: {}, news: [], createdAt: Date.now() };
  save();
}

function adminClearLot(id) {
  if (!state.own[id]) return { ok: false, error: "Gebäude gehört niemandem." };
  delete state.own[id];
  save();
  return { ok: true };
}

function adminRemoveOwner(key) {
  key = String(key || "").trim().toLowerCase();
  if (!key) return { ok: false, removed: 0 };
  let removed = 0;
  for (const [id, o] of Object.entries(state.own)) {
    if (o && o.owner === key) {
      delete state.own[id];
      removed++;
    }
  }
  if (removed > 0) save();
  return { ok: true, removed };
}

function ownedLots() {
  return Object.entries(state.own).map(([id, o]) => {
    const e = bldIndex.get(Number(id));
    const c = e ? CLASSES[e.b.cls] : null;
    return {
      id: Number(id),
      type: e ? e.b.cls : null,
      name: c ? `${c.name}${e.district ? " · " + e.district.name : ""}` : "Gebäude",
      emoji: c ? c.emoji : "🏠",
      owner: o.ownerName || null,
    };
  });
}

function err(error) { return { ok: false, error }; }

module.exports = {
  CLASSES, TROPHIES, colorFor,
  publicOverview, publicDistrict, ownerValue, casinoOwner, bankOwner, tickMarket, fireEvent,
  streetCount, trophiesOf, hasTrophy, bldExists, bldInfo, isBoss,
  houseCount, rollGoldenStreet, goldenStreet, ownsGolden, setsOf,
  territorySnapshot, territoryDiff,
  buyBuilding, sellBuilding, takeover,
  listCompany, adminClearLot, adminRemoveOwner, ownedLots, resetCity,
};
