"use strict";

/**
 * Die gemeinsame Stadt, auf der echten Karte von Porta Westfalica.
 *
 * Die Karte ist ein einmaliger OSM-Auszug (game/data/porta.json): mehrere
 * Stadtteile mit ihren echten Gebäuden, Straßen und Wahrzeichen. Die Stadt
 * schluckt Chips und zeigt, wem was gehört. Verdient wird in den Spielen,
 * Besitz gibt keine Boni mehr. Stattdessen bekommt man:
 *
 *   Straßen-Monopole  Wem jedes Haus mit Hausnummer einer Straße gehört (ab 3
 *                     Häusern), dem leuchtet sie auf der Karte in seiner Farbe.
 *   Stadtteil-Boss    Wer im Ortsteil den höchsten Immobilienwert hat, trägt
 *                     auf der Übersicht die Krone.
 *   Trophäen          Einzelne echte Gebäude (Bahnhof, Kirchen, Schulen und
 *                     das größte Haus je Ortsteil) mit Titel und kleinem Vorteil.
 *                     Jedes hat genau einen Besitzer.
 *   Spekulation       Jeder Ortsteil hat einen eigenen Preisindex, der driftet
 *                     und von albernen Lokalnachrichten bewegt wird. Billig
 *                     kaufen, teuer verkaufen (10 % Abschlag).
 *   Casino und Bank   Die beiden teuersten Stücke. Das Casino kassiert den Rake,
 *                     beides lebt davon, dass die anderen spielen.
 *
 * Die Geometrie liegt im Repo, der Besitz in data/city.json.
 */

const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "city.json");
const MAP_FILE = path.join(__dirname, "data", "porta.json");

// Die Gebäudeklasse bestimmt nur den PREIS (keine Boni).
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

// Trophäen-Gebäude: Titel und ein kleiner passender Vorteil. Preis = normal × mult.
const TROPHIES = {
  bahnhof:     { title: "Bahnhofs-Baron",   emoji: "🚉", perk: "Pendler-Bonus: Stunden-Bonus ×1,5", mult: 10 },
  kirche:      { title: "Kirchenpatron",    emoji: "⛪", perk: "Segen: 15 % Verlust-Cashback (statt 10 %) mit doppeltem Limit · Soforthilfe ×2", mult: 8 },
  schule:      { title: "Schulleiter",      emoji: "🏫", perk: "Bildung: Serien-Bonus ×2 & Serie verfällt nie · Klicks ×3", mult: 8 },
  wahrzeichen: { title: "Wahrzeichen",      emoji: "🏛️", perk: "Prestige: das größte Gebäude des Ortsteils", mult: 12 },
};

const SELL_SPREAD = 0.9;     // Rückkauf zu 90 % (10 % verschwinden), Spekulieren lohnt also nur bei echten Ausschlägen
const BUYOUT_PREMIUM = 1.5;  // Übernahme: Käufer zahlt 150 %, Vorbesitzer bekommt 100 %, 50 % verbrennen
const IDX_MIN = 0.55, IDX_MAX = 1.9;
const LANDMARK_BOOST = 1.25;
const LANDMARK_RADIUS = 120;
const MONOPOly_MIN = 3;      // eine Straße braucht mindestens 3 Häuser mit Nummer für ein Monopol

// Feste Spielerfarben fürs Einfärben der Karte (gleicher Hash wie im Client).
const PLAYER_COLORS = ["#e6b04b", "#5ea8e0", "#66c07a", "#c86bd6", "#e0705e", "#4fc7c0", "#d1a35e", "#8f9fe8"];
function colorFor(key) {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

// Lokalnachrichten, die den Preisindex eines Ortsteils bewegen (Spekulation).
const EVENT_POOL = [
  { txt: "Schützenfest in {d}, alle wollen hin!", f: 1.15 },
  { txt: "Großbaustelle in {d}, der Lärm nervt.", f: 0.87 },
  { txt: "Neue Buslinie nach {d}!", f: 1.10 },
  { txt: "Weser-Hochwasser bei {d}, die Keller stehen unter Wasser.", f: 0.84 },
  { txt: "Glasfaser-Ausbau in {d} abgeschlossen.", f: 1.12 },
  { txt: "Biber blockieren Neubaugebiet in {d}.", f: 0.91 },
  { txt: "{d} gewinnt den „Schönstes Dorf“-Wettbewerb!", f: 1.18 },
  { txt: "Spuk-Gerüchte in {d}, die Makler verzweifeln.", f: 0.89 },
  { txt: "Hippes Café eröffnet in {d}.", f: 1.08 },
  { txt: "Umgehungsstraße entlastet {d}.", f: 1.07 },
  { txt: "Wildschwein-Rotte wühlt Gärten in {d} um.", f: 0.93 },
  { txt: "Filmteam dreht in {d}. Jetzt ist {d} berühmt!", f: 1.14 },
  { txt: "Starker Wind beschädigt Dächer in {d}.", f: 0.88 },
  { txt: "Jahrmarkt in {d}, alle wollen hin!", f: 1.13 },
  { txt: "Virus-Ausbruch in {d}, alle bleiben zu Hause.", f: 0.85 },
  { txt: "Big Yahu ist in {d}.", f: 1.2 },
  { txt: "Der Axtmörder treibt sein unwesen in {d}!", f: 0.82 },
];

// --- Karte (Auszug im Repo) ---
let MAP = { city: "?", districts: [] };
const bldIndex = new Map();   // Gebäude-ID -> { b, district }
let CASINO_ID = null, BANK_ID = null;

function loadMap() {
  try {
    MAP = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  } catch (e) {
    console.error("city: Karten-Snapshot fehlt (game/data/porta.json), die Stadt bleibt leer.", e.message);
    MAP = { city: "Porta Westfalica", districts: [] };
  }
  bldIndex.clear();
  for (const d of MAP.districts) {
    for (const b of d.buildings) {
      b._did = d.id;
      // Straßenschlüssel: nur Gebäude mit echter Hausnummer gehören zu einer
      // Straße ("Zur Porta 88" -> "Zur Porta"), geliehene Straßennamen zählen nicht.
      const m = b.n && b.n.match(/^(.+?)\s+(\d.*)$/);
      b.st = m ? m[1] : null;
      b.lm = 0;
      for (const l of d.landmarks || []) {
        if (Math.abs(l.x - b.c[0]) < LANDMARK_RADIUS && Math.abs(l.y - b.c[1]) < LANDMARK_RADIUS) { b.lm = 1; break; }
      }
      bldIndex.set(b.id, { b, district: d });
    }
  }
  // Die beiden Prestige-Stücke: Casino = größtes Nicht-Wohngebäude in Hausberge,
  // Bank = größtes echtes Bankgebäude.
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

  // Trophäen: Bahnhöfe, Kirchen, Schulgebäude und das größte Gebäude jedes
  // Ortsteils als "Wahrzeichen". Je ein Besitzer, echte Namen inklusive.
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

  // Straßengruppen je Ortsteil (Ziele für Monopole).
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

// --- Besitz (liegt im Datenordner) ---
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

// --- Marktgeschehen: Drift je Ortsteil und Lokalnachrichten ---

/** Eine zufällige Lokalnachricht auslösen (auf Wunsch in einem bestimmten Ortsteil). */
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
    // Schwacher Zug zurück zur Mitte, starkes Rauschen: nach einem Ereignis
    // braucht der Index unvorhersehbar STUNDEN (vorher 4 %/min, ein Einbruch war
    // nach ~30 min erholt, und "jeden Crash kaufen" war risikolos).
    state.idx[d.id] = clamp(i + (1 - i) * 0.006 + (Math.random() * 2 - 1) * 0.02, IDX_MIN, IDX_MAX);
  }
  // Ungefähr alle 8 Minuten (Takt 60 s) rüttelt eine Nachricht einen Ortsteil durch.
  const event = MAP.districts.length && Math.random() < 0.12 ? fireEvent() : null;
  save();
  return event;
}

/** Preis: Klassenbasis × Größe × Wahrzeichen × Trophäenaufschlag × Ortsteilindex.
 *  Trophäen liegen immer zwischen 5 Mio. und 500 Mio.: ein ernsthafter Kauf,
 *  aber immer unter Bank (600 Mio.) und Casino (1,2 Mrd.). */
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

// --- Abgeleitete Zahlen (zwischengespeichert, nach jeder Änderung neu) ---
let derivedDirty = true;
let derived = null;

function getDerived() {
  if (!derivedDirty && derived) return derived;
  const monopolies = {};       // Ortsteil -> [{ st, owner, ownerName, color, count }]
  const streetsByOwner = {};   // Spieler -> Anzahl kompletter Straßen
  const bossByDistrict = {};   // Ortsteil -> { owner, name, color, value }
  const valueByOwner = {};     // Spieler -> gesamter Immobilienwert

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

/** Ist `key` irgendwo Boss? Billiger als publicOverview, das die ganze
 *  Immobilienliste mitbaut, nur um eine Ja/Nein-Frage zu beantworten. */
function istBossIrgendwo(key) {
  const b = getDerived().bossByDistrict;
  for (const eintrag of Object.values(b)) if (eintrag && eintrag.owner === key) return true;
  return false;
}

/** Komplette Straßen eines Spielers (Bestenliste Straßenkönig). */
const streetCount = (key) => getDerived().streetsByOwner[key] || 0;

/** Anzahl Gebäude eines Spielers (Haus-Tribut). */
function houseCount(key) {
  let n = 0;
  for (const o of Object.values(state.own)) if (o.owner === key) n++;
  return n;
}

// --- Goldene Straße der Woche ---
// Jede Woche zahlt eine zufällige Straße doppelten Tribut, alle wollen sie.
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
/** Hat `key` die komplette Goldene Straße? (Dann zählt ihr Tribut doppelt.) */
function ownsGolden(key) {
  const g = state.golden;
  if (!g) return false;
  const list = getDerived().monopolies[g.district] || [];
  return list.some((m) => m.st === g.st && m.owner === key);
}

// --- Haus-Sets (Sammelboni) ---
/** Sets, die `key` voll hat: [{id, label, emoji, tribute}] */
function setsOf(key) {
  const out = [];
  if (!key || !MAP.districts.length) return out;
  // Stadtbekannt: mindestens ein Gebäude in jedem Ortsteil.
  const perDistrict = MAP.districts.map((d) => d.buildings.some((b) => state.own[b.id] && state.own[b.id].owner === key));
  if (perDistrict.every(Boolean))
    out.push({ id: "stadtbekannt", label: "Stadtbekannt", emoji: "🌍", tribute: 2000 });
  // Kaffee-Kartell: alle Cafés eines Ortsteils (braucht dort mindestens 3).
  for (const d of MAP.districts) {
    const cafes = d.buildings.filter((b) => b.cls === "cafe");
    if (cafes.length >= 3 && cafes.every((b) => state.own[b.id] && state.own[b.id].owner === key)) {
      out.push({ id: "kartell_" + d.id, label: `Kaffee-Kartell ${d.name}`, emoji: "☕", tribute: 3000 });
    }
  }
  return out;
}

/** Gesamter Immobilienwert eines Spielers (für Vermögen und Immobilien-Mogul). */
function ownerValue(key) {
  return getDerived().valueByOwner[key] || 0;
}

/** Trophäen eines Spielers: [{kind, title, emoji, name}] */
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

/** Ist `key` gerade Boss eines Ortsteils? (Der Boss kauft dort 10 % billiger.) */
const BOSS_DISCOUNT = 0.9;

/* --- Besitzer-Staffel (Anti-Monopol) ---
 *
 * Bisher kostete das dreissigste Haus genauso viel wie das erste. Wer einmal
 * vorne lag, kaufte deshalb immer weiter, und fuer alle anderen war die Stadt
 * erledigt, bevor sie angefangen hatten.
 *
 * Jetzt zahlt jeder auf jeden Kauf einen Aufschlag, der mit der Zahl seiner
 * eigenen Haeuser waechst: vier Prozent je Haus, das man schon besitzt,
 * gedeckelt beim Dreifachen. Das nimmt niemandem etwas weg und druckt auch
 * kein Geld, es macht das Weiterkaufen nur teurer, je mehr man schon hat.
 *
 * Wichtig ist, was nicht mitwaechst:
 *   • Der Verkaufserloes. Sonst waere die Staffel nur eine Zahl, die man
 *     beim Verkauf wieder hereinholt, und sie wuerde gar nichts bremsen.
 *   • Die Entschaedigung bei einer Uebernahme. Die richtet sich nach dem
 *     Marktwert des Hauses, nicht danach, wie viel der Vorbesitzer hortet.
 *     Sonst wuerde ausgerechnet der Monopolist am Uebernommenwerden verdienen.
 *
 * Bis etwa zehn Haeuser merkt man kaum etwas (×1,4), eine komplette Strasse
 * bleibt also gut erreichbar. Weh tut es ab zwanzig.
 */
const OWNER_STEP = 0.04;   // Aufschlag je Haus, das man schon hat
const OWNER_MAX = 3.0;     // Deckel

/** Preisfaktor fuer `key` beim naechsten Kauf. Ohne Besitz genau 1. */
function ownerScale(key) {
  if (!key) return 1;
  return Math.min(OWNER_MAX, 1 + OWNER_STEP * houseCount(key));
}
function isBoss(key, did) {
  const b = getDerived().bossByDistrict[did];
  return !!(b && b.owner === key);
}

/** Kleiner Schnappschuss für die Eroberungsmeldungen (vorher/nachher vergleichen). */
function territorySnapshot() {
  const der = getDerived();
  const monos = new Set();
  for (const [did, list] of Object.entries(der.monopolies))
    for (const m of list) monos.add(`${did}|${m.st}|${m.owner}`);
  const boss = {};
  for (const [did, b] of Object.entries(der.bossByDistrict)) boss[did] = b.owner;
  return { monos, boss };
}

/** Meldungen für alles, was sich zwischen zwei Schnappschüssen geändert hat. */
function territoryDiff(before, after) {
  const msgs = [];
  const nameOf = (did) => { const d = MAP.districts.find((x) => x.id === did); return d ? d.name : did; };
  for (const entry of after.monos) {
    if (before.monos.has(entry)) continue;
    const [, st, owner] = entry.split("|");
    const o = Object.values(state.own).find((x) => x.owner === owner);
    msgs.push(`${o ? o.ownerName : owner} hat die ${st} komplett, Straßen-Monopol!`);
  }
  for (const [did, owner] of Object.entries(after.boss)) {
    if (before.boss[did] === owner) continue;
    const o = Object.values(state.own).find((x) => x.owner === owner);
    msgs.push(`${o ? o.ownerName : owner} ist jetzt der Boss von ${nameOf(did)}!`);
  }
  return msgs;
}

/**
 * Wem gehoert was.
 *
 * Die Uebernahme (150 %, Vorbesitzer bekommt den Marktwert) gab es schon
 * lange, aber man kam nur daran, indem man in einem Ortsteil ein bestimmtes
 * Haus antippte. Wer neu anfing, sah die Stadt als geschlossene Gesellschaft
 * und hatte kein einziges Ziel vor Augen. Diese Liste macht den Besitz und
 * damit die Angreifbarkeit sichtbar.
 */
function ownerBoard(key) {
  const der = getDerived();
  const zeilen = {};
  let besetzt = 0, gesamt = 0;
  for (const d of MAP.districts) gesamt += d.buildings.length;
  for (const [id, o] of Object.entries(state.own)) {
    const e = bldIndex.get(Number(id));
    if (!e) continue;
    besetzt++;
    const z = zeilen[o.owner] || (zeilen[o.owner] = {
      key: o.owner, name: o.ownerName || o.owner, color: colorFor(o.owner),
      houses: 0, value: 0, streets: streetCount(o.owner),
      trophies: trophiesOf(o.owner).length, isMe: o.owner === key,
    });
    z.houses++;
    z.value += priceOf(e.b);
  }
  const liste = Object.values(zeilen).sort((a, b) => b.value - a.value);
  liste.forEach((z, i) => { z.rang = i + 1; });
  return { liste, besetzt, frei: gesamt - besetzt, gesamt };
}

/**
 * Die Gebaeude EINES Besitzers, mit dem Preis, den der Betrachter fuer eine
 * Uebernahme zahlen muesste. Bewusst ein eigener Aufruf: die Uebersicht soll
 * nicht bei jedem Laden alle Haeuser aller Spieler mitschleppen.
 */
function ownerProperties(ownerKey, viewerKey, limit = 60) {
  const scale = ownerScale(viewerKey);
  const out = [];
  for (const [id, o] of Object.entries(state.own)) {
    if (o.owner !== ownerKey) continue;
    const e = bldIndex.get(Number(id));
    if (!e) continue;
    const price = priceOf(e.b);
    out.push({
      id: Number(id), did: e.district.id, districtName: e.district.name,
      label: e.b.nm || e.b.n || CLASSES[e.b.cls].name,
      emoji: e.b.trophy ? TROPHIES[e.b.trophy].emoji : CLASSES[e.b.cls].emoji,
      st: e.b.st || null,
      price,
      takeoverCost: Math.ceil(price * BUYOUT_PREMIUM * scale),
      mine: ownerKey === viewerKey,
    });
  }
  // Billigste zuerst: die Liste soll zeigen, was erreichbar ist, nicht was
  // am meisten Eindruck macht.
  out.sort((a, z) => a.takeoverCost - z.takeoverCost);
  return out.slice(0, limit);
}

// --- Ansichten für den Client ---
function publicOverview(key) {
  const der = getDerived();
  let me = null;
  if (key) {
    // "Meine Immobilien": jedes eigene Gebäude, für die Sprungliste.
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
    board: ownerBoard(key),
    ownerScale: round2(ownerScale(key)),
    ownerScaleMax: OWNER_MAX,
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
  // Fortschritt je Straße fürs Panel: Häuser mit Nummer pro Straße.
  const streetTotals = {};
  for (const [st, ids] of d._streets) streetTotals[st] = ids.length;
  // Einmal je Aufruf, nicht je Gebaeude: haengt nur am Spieler.
  const scale = ownerScale(key);
  const meineHaeuser = key ? houseCount(key) : 0;
  return {
    id: d.id, name: d.name, ring: d.ring,
    ownerScale: round2(scale), ownerHouses: meineHaeuser, ownerScaleMax: OWNER_MAX,
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
        /* Was dieser Spieler zahlen wuerde: Boss-Rabatt und Besitzer-Staffel
           gehoeren auf den Server. Vorher rechnete der Client den
           Uebernahmepreis selbst als price × 1,5 nach und haette mit der
           Staffel eine falsche Zahl angezeigt. */
        myPrice: Math.round(price * (key && isBoss(key, d.id) ? BOSS_DISCOUNT : 1) * scale),
        takeoverCost: Math.ceil(price * BUYOUT_PREMIUM * scale),
        owner: o ? o.owner : null, ownerName: o ? o.ownerName : null,
        color: o ? colorFor(o.owner) : null,
        mine: !!o && o.owner === key, listed: !!(o && o.listed),
      };
    }),
  };
}

// --- Änderungen ---
function buyBuilding(id, key, name) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  if (ownerOf(e.b.id)) return err("Gehört schon jemandem, dafür gibt es „Übernehmen“.");
  // Der Boss kauft in seinem Ortsteil 10 % billiger (Gebiet belohnt Gebiet).
  const discount = isBoss(key, e.b._did) ? BOSS_DISCOUNT : 1;
  return { ok: true, cost: Math.round(priceOf(e.b) * discount * ownerScale(key)), commit: () => {
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
  if (!o) return err("Ist frei, einfach kaufen.");
  if (o.owner === key) return err("Gehört dir bereits.");
  const value = priceOf(e.b);
  return {
    ok: true,
    // Der Kaeufer zahlt Aufschlag und Staffel, der Vorbesitzer bekommt den
    // reinen Marktwert. Die Differenz verbrennt, wie bisher.
    cost: Math.ceil(value * BUYOUT_PREMIUM * ownerScale(key)),
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
/** Kurzinfo zu einem Gebäude (Wohnsitz-Zeile im Profil). */
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
  streetCount, trophiesOf, hasTrophy, bldExists, bldInfo, isBoss, istBossIrgendwo,
  houseCount, rollGoldenStreet, goldenStreet, ownsGolden, setsOf,
  territorySnapshot, territoryDiff,
  ownerBoard, ownerProperties, ownerScale,
  buyBuilding, sellBuilding, takeover,
  listCompany, adminClearLot, adminRemoveOwner, ownedLots, resetCity,
};
