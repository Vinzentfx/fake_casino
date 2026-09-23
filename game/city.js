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

// Die Gebäudeklasse bestimmt nur den Preis (keine Boni).
const CLASSES = {
  residential: { name: "Wohnhaus",   emoji: "🏠", base: 25000,      refA: 140 },
  pension:     { name: "Pension",    emoji: "🛏️", base: 100000,     refA: 120 },
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

/* Ausbau: aus einem Wohnhaus wird ein Betrieb
 *
 * Der Grund steht in den Zahlen. Auf der Karte liegen 267 Laeden, 132
 * Fabriken, 50 Cafes und 13 Hotels, und im Stand vom 18.9. besass davon
 * niemand ein einziges Stueck: 1.261 der 1.263 besetzten Gebaeude waren
 * Wohnhaeuser. Ein Laden kostet zehn Millionen, eine Fabrik 250, und das
 * groesste Konto im Haus hat neunzehn. Die halbe Stadt war Deko.
 *
 * Also kauft man sie nicht mehr, man baut sie. Jede Stufe kostet die
 * Differenz der Klassen plus Aufschlag, dauert echte Zeit und hebt Wert und
 * Miete. Waehrend gebaut wird, laeuft die alte Miete weiter: warten soll
 * Geduld kosten, keine Einnahmen.
 *
 * Die Mindestgroesse ist der eigentliche Reiz. Aus einem 60-Quadratmeter-
 * Haeuschen wird kein Hotel, und gegen die echte Karte gerechnet heisst das:
 * Pension koennen 78 Prozent aller Wohnhaeuser werden, Kiosk 31, Cafe 5,
 * Laden 1 und Hotel 0,2. Damit lohnt es sich zum ersten Mal, die Karte
 * wirklich anzusehen, statt das naechstbeste freie Feld anzutippen. Spender
 * haette mit 232 Haeusern genau neun Cafe-Grundstuecke und ein einziges fuer
 * einen Laden.
 *
 * Nach oben bauen hebt den Wert, aber nicht den Grundsteuersatz, denn der
 * haengt an der ANZAHL. In die Breite kaufen hat sinkende Rendite, in die
 * Hoehe bauen nicht. Genau das soll der Unterschied sein.
 */
const AUSBAU = {
  residential: { ziel: "pension", minA: 80 },
  // Ein oeffentliches Gebaeude ist sonst eine Sackgasse, die mehr kostet als
  // eine Pension und weniger einbringt. Umnutzung zum Kiosk statt nichts.
  civic:       { ziel: "kiosk",   minA: 150 },
  pension:     { ziel: "kiosk",   minA: 150 },
  kiosk:       { ziel: "cafe",    minA: 300 },
  cafe:        { ziel: "shop",    minA: 600 },
  shop:        { ziel: "hotel",   minA: 1200 },
  hotel:       { ziel: "factory", minA: 2500 },
};
// Aufschlag auf die Wertdifferenz. Das ist der Teil, der verbrennt, und der
// Grund, warum der Ausbau ueberhaupt gegen die Inflation hilft.
const AUSBAU_AUFSCHLAG = 1.25;
// Bauzeit je Zielklasse. Bewusst in Stunden: die Runde spielt versetzt, man
// stellt etwas an und kommt wieder.
const BAUZEIT_H = { pension: 2, kiosk: 4, cafe: 8, shop: 12, hotel: 24, factory: 48 };
// Mehr als drei Baustellen gleichzeitig waeren keine Entscheidung mehr,
// sondern eine Warteschlange, die man einmal befuellt und vergisst.
const BAUSTELLEN_MAX = 3;

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

// Karte (Auszug im Repo)
let MAP = { city: "?", districts: [] };
const bldIndex = new Map();   // je Gebäude-ID: { b, district }
let CASINO_ID = null, BANK_ID = null;

function loadMap() {
  try {
    MAP = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  } catch (e) {
    console.error("city: Karten-Snapshot fehlt (game/data/porta.json), die Stadt bleibt leer.", e.message);
    MAP = { city: "Porta Westfalica", districts: [] };
  }
  bldIndex.clear();
  /*
   * Doppelte Gebaeude aussortieren. Seit dem 19.9. ist das nur noch ein
   * Netz: die Karte selbst ist bereinigt und `tools/fetch-porta.js`
   * entdoppelt beim Abruf. Die Pruefung bleibt hier, weil ein Auszug von
   * Hand jederzeit wieder welche hereintragen kann — und dann soll es
   * auffallen und nicht die Bilanz verschieben.
   *
   * Der Overpass-Auszug fragt je Ortsteil nach Gebaeuden IN dessen Flaeche.
   * An den Grenzen liegt dasselbe Haus in zwei Flaechen, und ein paar Wege
   * kamen sogar innerhalb einer Abfrage zweimal zurueck. In der Karte vom
   * 10.7. waren 65 der 11.869 Gebaeude doppelt, sieben davon in Besitz.
   *
   * Aufgefallen ist es nicht, weil `bldIndex` eine Map ist und der zweite
   * Eintrag den ersten still ueberschreibt. Gezaehlt wurde trotzdem zweimal:
   * getDerived() laeuft ueber die Gebaeudelisten und nicht ueber den Index,
   * also stand bei Melloween und Marlon je ein Haus mit doppeltem Wert in der
   * Bilanz, und im Zweifel entschied das darueber, wer Boss eines Ortsteils
   * ist. houseCount() zaehlt dagegen ueber den Besitz und lag richtig; die
   * beiden Zahlen widersprachen sich also.
   *
   * Behalten wird der LETZTE Eintrag, weil genau den auch bldIndex behielt:
   * so aendert sich an der Zuordnung nichts, es wird nur nicht mehr doppelt
   * gezaehlt.
   */
  const letzter = new Map();
  MAP.districts.forEach((d, di) => (d.buildings || []).forEach((b, bi) => letzter.set(b.id, di * 1e7 + bi)));
  let doppelt = 0;
  MAP.districts.forEach((d, di) => {
    const vorher = d.buildings.length;
    d.buildings = d.buildings.filter((b, bi) => letzter.get(b.id) === di * 1e7 + bi);
    doppelt += vorher - d.buildings.length;
  });
  if (doppelt) console.log(`city: ${doppelt} doppelte Gebäude in der Karte übersprungen.`);
  for (const d of MAP.districts) {
    for (const b of d.buildings) {
      b._did = d.id;
      // Straßenschlüssel: nur Gebäude mit echter Hausnummer gehören zu einer
      // Straße (aus "Zur Porta 88" wird "Zur Porta"), geliehene Straßennamen zählen nicht.
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

// Besitz (liegt im Datenordner)
let state = loadState();

function loadState() {
  // `aus` haelt je Gebaeude die ausgebaute Klasse, `bau` die laufenden
  // Baustellen. Beide kommen bei alten Staenden einfach leer dazu.
  const frisch = (s) => ({ idx: {}, news: [], aus: {}, bau: {}, personal: {}, ereignis: {}, effekt: {}, zoll: {}, createdAt: Date.now(), ...s });
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s && s.v === "porta2" && s.own) return frisch(s);
    if (s && s.v === "porta1" && s.own) return frisch({ v: "porta2", own: s.own, createdAt: s.createdAt });
  } catch {}
  return frisch({ v: "porta2", own: {} });
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

// Marktgeschehen: Drift je Ortsteil und Lokalnachrichten

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
  // Erst die fertigen Baustellen einbuchen: sie aendern Werte und damit alles,
  // was danach gerechnet wird.
  const fertig = bautenPruefen();
  for (const d of MAP.districts) {
    const i = idxOf(d.id);
    // Schwacher Zug zurück zur Mitte, starkes Rauschen: nach einem Ereignis
    // braucht der Index unvorhersehbar Stunden (vorher 4 %/min, ein Einbruch war
    // nach ~30 min erholt, und "jeden Crash kaufen" war risikolos).
    state.idx[d.id] = clamp(i + (1 - i) * 0.006 + (Math.random() * 2 - 1) * 0.02, IDX_MIN, IDX_MAX);
  }
  // Ungefähr alle 8 Minuten (Takt 60 s) rüttelt eine Nachricht einen Ortsteil durch.
  const event = MAP.districts.length && Math.random() < 0.12 ? fireEvent() : null;
  save();
  return { event, fertig };
}

/**
 * Die Klasse, die ein Gebaeude WIRKLICH hat.
 *
 * `b.cls` steht im Kartenauszug und aendert sich nie, der Ausbau liegt im
 * Spielstand. Ueberall, wo es um Preis, Miete oder Anzeige geht, zaehlt
 * diese hier, sonst zahlt ein ausgebautes Cafe weiter Wohnhaus-Miete.
 */
function klasseVon(b) {
  if (!b) return "residential";
  if (b.cls === "casino" || b.cls === "bank") return b.cls;
  const a = state.aus[b.id];
  return a && CLASSES[a] ? a : b.cls;
}

/**
 * Fertige Baustellen einbuchen.
 *
 * Bewusst beim Lesen und im Minutentakt statt mit einem Timer je Baustelle,
 * genau wie die Strafen ihre abgelaufenen Eintraege beim Lesen wegraeumen.
 * Ein Timer waere nach jedem Neustart weg, und dann stuende die Baustelle
 * fuer immer. Gibt die fertig gewordenen zurueck, damit der Aufrufer sie
 * melden kann.
 */
function bautenPruefen(now = Date.now()) {
  const fertig = [];
  let geaendert = false;
  for (const [id, b] of Object.entries(state.bau || {})) {
    if (!b || b.fertig > now) continue;
    delete state.bau[id];
    geaendert = true;
    // Wem das Gebaeude inzwischen nicht mehr gehoert, dem wird auch nichts
    // fertig. Uebernehmen laesst sich eine Baustelle zwar nicht, verkaufen
    // aber theoretisch ueber den Admin, und dann soll nichts haengen bleiben.
    const o = state.own[id];
    if (!o || o.owner !== b.key) continue;
    state.aus[id] = b.ziel;
    const e = bldIndex.get(Number(id));
    fertig.push({
      id: Number(id), key: b.key, name: o.ownerName || b.key, ziel: b.ziel,
      klasse: CLASSES[b.ziel].name, emoji: CLASSES[b.ziel].emoji,
      label: e ? (e.b.nm || e.b.n || CLASSES[b.ziel].name) : CLASSES[b.ziel].name,
      district: e ? e.district.name : "",
    });
  }
  if (geaendert) save();
  return fertig;
}

/** Laeuft an diesem Gebaeude gerade ein Ausbau? */
const bauAn = (id) => state.bau[id] || null;
/** Wie viele Baustellen hat `key` offen? */
function baustellen(key) {
  let n = 0;
  for (const b of Object.values(state.bau || {})) if (b && b.key === key) n++;
  return n;
}

/** Preis: Klassenbasis × Größe × Wahrzeichen × Trophäenaufschlag × Ortsteilindex.
 *  Trophäen liegen immer zwischen 5 Mio. und 500 Mio.: ein ernsthafter Kauf,
 *  aber immer unter Bank (600 Mio.) und Casino (1,2 Mrd.). */
function preisAls(b, cls) {
  const c = CLASSES[cls];
  if (cls === "casino" || cls === "bank") return c.base;
  const sizeScale = clamp(Math.pow(b.a / c.refA, 0.6), 0.6, 2.5);
  const lm = b.lm ? LANDMARK_BOOST : 1;
  let price = c.base * sizeScale * lm;
  if (b.trophy) price = clamp(price * TROPHIES[b.trophy].mult, 5_000_000, 500_000_000);
  return Math.round((price * idxOf(b._did)) / 100) * 100;
}
const priceOf = (b) => preisAls(b, klasseVon(b));
const sellPriceOf = (b) => Math.round(priceOf(b) * SELL_SPREAD);
const ownerOf = (id) => (state.own[id] ? state.own[id].owner : null);

// Abgeleitete Zahlen (zwischengespeichert, nach jeder Änderung neu)
let derivedDirty = true;
let derived = null;

function getDerived() {
  if (!derivedDirty && derived) return derived;
  const monopolies = {};       // je Ortsteil: [{ st, owner, ownerName, color, count }]
  const streetsByOwner = {};   // je Spieler: Anzahl kompletter Straßen
  const bossByDistrict = {};   // je Ortsteil: { owner, name, color, value }
  const valueByOwner = {};     // je Spieler: gesamter Immobilienwert

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

// Goldene Straße der Woche
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

// Haus-Sets (Sammelboni)
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
    const cafes = d.buildings.filter((b) => klasseVon(b) === "cafe");
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

/* Grundsteuer statt Kaufaufschlag
 *
 * Vorher zahlte jeder auf jeden Kauf einen Aufschlag, der mit der Zahl seiner
 * Haeuser wuchs: vier Prozent je Haus, gedeckelt beim Dreifachen. Gemeint war
 * das als Anti-Monopol, herausgekommen ist eine Pauschalsteuer. Der Deckel
 * war schon bei fuenfzig Haeusern erreicht, und im Stand vom 18.9. standen
 * alle sieben, die in der Stadt ueberhaupt etwas machen, darueber: Spender
 * mit 232 Haeusern, Marlon mit 193, CharlieEpstein mit 175. Fuer die war es
 * keine Bremse mehr, sondern ein fester Dreifachpreis ohne Ausweg, weil
 * Besitz nicht von selbst schrumpft.
 *
 * Dazu kam, dass der Verkaufserloes bewusst NICHT mitwuchs. Ein mittleres
 * Wohnhaus kostet 23.000; Spender zahlte 69.000 und bekam beim Verkauf
 * 21.000 zurueck. Jeder Kauf verbrannte 48.000 Chips. Und der Haus-Tribut
 * deckelte bei hundert Haeusern, seine Haeuser 101 bis 232 brachten exakt
 * nichts, zaehlten aber voll in die Vermoegensbremse, die ihm den Tribut
 * dann noch einmal viertelte. Wer viel spielte, wurde zweimal bestraft.
 *
 * Jetzt kostet nicht mehr der Kauf, sondern der Besitz. Der Kaufpreis ist
 * wieder fuer alle der Marktwert. Dafuer zahlt jedes Gebaeude Miete (ein
 * fester Anteil seines Werts je Stunde), und darauf liegt eine Grundsteuer,
 * die mit der ZAHL der Gebaeude steigt. Die ersten 25 sind steuerfrei,
 * danach waechst der Satz: 29 Prozent bei 50 Gebaeuden, 50 bei hundert,
 * 67 bei 232.
 *
 * Der Unterschied zur Staffel ist der, auf den es ankommt: es gibt keinen
 * Deckel, an dem alles gleich teuer wird, und jedes weitere Gebaeude bringt
 * immer noch etwas. Haus 233 zahlt 68 Chips die Stunde statt null. Wer in
 * die Breite kauft, bekommt sinkende Rendite; wer ausbaut, hebt den Wert
 * seiner Gebaeude, ohne dass der Steuersatz steigt, denn der haengt an der
 * Anzahl. Dieselbe Bremse, aber sie fuehlt sich wie eine Entscheidung an
 * statt wie eine Strafe.
 *
 * Die Uebernahme laeuft wieder bei glatten 150 Prozent. Mit der Staffel
 * zahlten die Grossen das Vierenhalbfache, und deshalb hat in der ganzen
 * Runde nie jemand jemandem etwas weggenommen.
 */
const MIETE_SATZ = 0.009;   // Anteil des Gebaeudewerts, den es je Stunde abwirft

/* Warum die Grundsteuer am EINKOMMEN haengt und nicht an der Anzahl
 *
 * Erster Anlauf: Steuersatz = f(Anzahl der Gebaeude). Die Idee war, dass
 * Ausbauen den Wert hebt, aber nicht den Satz, weil der an der Anzahl haengt.
 * Genau das war das Loch. Wer die Steuer umgehen wollte, verkaufte auf 25
 * Gebaeude herunter und baute die groessten aus. Durchgerechnet am echten
 * Stand: Ben haette mit 67 Wohnhaeusern 8.828 Chips die Stunde bekommen, mit
 * 25 ausgebauten Gebaeuden 137.393 bei null Prozent Steuer. Theoretisches
 * Optimum: 1,1 Millionen die Stunde. Das gesamte fluessige Geld im Haus sind
 * 82 Millionen.
 *
 * Jetzt zwei Abzuege, die zusammen beide Richtungen abdecken:
 *
 *   VERWALTUNG, ein fester Betrag JE GEBAEUDE ab dem 26. Ein Wohnhaus wirft
 *   rund 207 die Stunde ab, ein Cafe 27.000. Ein fester Abzug tut deshalb
 *   dem in die Breite gekauften Schuppen weh und dem ausgebauten Betrieb
 *   nicht. Das ist die Bremse gegen tausend billige Haeuser. Die ersten 25
 *   sind frei, damit sie Anfaenger nicht trifft.
 *
 *   GRUNDSTEUER auf das, was danach uebrig ist, mit einer Wurzelkurve. Zehn
 *   Mal so viel Mieteinnahme ergibt gut drei Mal so viel Netto. Man bekommt
 *   immer mehr, wenn man mehr hat, aber nie proportional.
 *
 * Gegen den echten Stand vom 18.9. geeicht: fuer jeden, der heute wirklich
 * spielt, aendert sich fast nichts (Spender 17.577 auf 17.989, Vincent
 * 10.925 auf 11.602, Leif unveraendert). Der Schleichweg schrumpft von
 * 137.393 auf 34.673, das theoretische Optimum von 1.125.000 auf 99.216,
 * und 800 billig gekaufte Haeuser bringen 20.120 statt 19.139, also
 * praktisch nichts mehr als Spenders 232.
 *
 * Und der Anreiz stimmt weiter: fuer Vincent amortisiert sich ein Ausbau in
 * 377 Abholungen, ein Zukauf in 484. Wer schon etwas hat, baut in die Hoehe.
 * Fuer einen Anfaenger ist es umgekehrt (111 zu 139), und das ist richtig:
 * erst kaufen, dann ausbauen.
 */
const VERWALTUNG = 80;        // Kosten je Stunde und Gebaeude …
const VERWALTUNG_FREI = 25;   // … ab dem 26. Gebaeude
const STEUER_FREI = 8750;     // so viel Mieteinnahme je Stunde bleibt steuerfrei

/** Was von `basis` (Miete minus Verwaltung) nach der Grundsteuer uebrig ist. */
function nachSteuer(basis) {
  if (basis <= STEUER_FREI) return basis;
  return Math.sqrt(STEUER_FREI * basis);
}
/** Der Satz, den das ergibt. Nur zum Anzeigen. */
const steuersatz = (basis) => (basis > 0 ? 1 - nachSteuer(basis) / basis : 0);

/* Personal
 *
 * Ein Wohnhaus vermietet sich selbst, eine Pension auch. Ein Kiosk, ein Cafe,
 * ein Laden, ein Hotel und eine Fabrik nicht: hinter dem Tresen muss jemand
 * stehen. Wer niemanden einstellt, dessen Betriebe laufen auf halber Kraft.
 *
 * Bewusst EINE Entscheidung fuer alle Betriebe zusammen und nicht eine je
 * Gebaeude. Wer zwanzig Laeden hat, soll nicht zwanzig Knoepfe druecken; auf
 * dem iPad waere das die Arbeit und nicht das Spiel.
 *
 * Der Lohn geht sofort weg und richtet sich nach dem, was die Betriebe
 * abwerfen: wer mehr hat, zahlt mehr. Die Leitung ist nicht einfach die beste
 * Stufe, sie ist die teuerste Wette: sechs Stunden Miete im Voraus, und sie
 * lohnt sich nur, wenn man die vollen 24 Stunden auch abholt. Wer einmal am
 * Tag vorbeischaut, faehrt mit der Aushilfe besser.
 *
 * Halbe Kraft statt gar nichts ist Absicht. Ein Betrieb, der ohne Personal
 * null zahlt, macht aus dem Ausbau eine Falle: man haette teuer umgebaut und
 * stuende schlechter da als vorher, sobald man zwei Tage nicht da war.
 */
const OHNE_PERSONAL = 0.5;
const PERSONAL = {
  aushilfe:  { label: "Aushilfe",       faktor: 0.85, stunden: 12, lohnAnteil: 0.10 },
  fachkraft: { label: "Fachkraft",      faktor: 1.00, stunden: 12, lohnAnteil: 0.18 },
  leitung:   { label: "Geschäftsführung", faktor: 1.15, stunden: 24, lohnAnteil: 0.18 },
};
// Was als Betrieb zaehlt (und damit Personal braucht).
const BETRIEB = /^(kiosk|cafe|shop|hotel|factory)$/;

/**
 * Das Personal von `key`, abgelaufene Schichten weggeraeumt.
 *
 * Wie bei den Strafen beim Lesen und nicht per Timer: ein Timer waere nach
 * jedem Neustart weg, und dann liefe die Schicht ewig weiter.
 */
function personalVon(key) {
  const p = state.personal[key];
  if (!p) return null;
  if (p.bis <= Date.now()) { delete state.personal[key]; save(); return null; }
  return p;
}

/** Miete der Betriebe und der Wohngebaeude getrennt. */
function mietTeile(key) {
  let wohn = 0, betrieb = 0, betriebe = 0;
  for (const [id, o] of Object.entries(state.own)) {
    if (o.owner !== key) continue;
    const e = bldIndex.get(Number(id));
    if (!e) continue;
    // Ein laufendes Ereignis (Wasserschaden, Dreharbeiten) wirkt genau hier
    // und nur auf dieses eine Gebaeude.
    const eff = effektVon(e.b.id);
    const p = priceOf(e.b) * MIETE_SATZ * (eff ? eff.faktor : 1);
    if (BETRIEB.test(klasseVon(e.b))) { betrieb += p; betriebe++; } else wohn += p;
  }
  return { wohn, betrieb, betriebe };
}

/**
 * Was die Stadt `key` je Stunde einbringt.
 *
 * Bewusst hier und nicht in accounts.js: die Stadt kennt Werte, Anzahl und
 * Personal, der Bonus soll nur noch eine Zahl abholen.
 */
function mieteVon(key) {
  const leer = { haeuser: 0, wert: 0, miete: 0, verwaltung: 0, satz: 0, steuer: 0, netto: 0,
    betriebe: 0, personal: null, personalFaktor: 1, ohnePersonal: 0 };
  if (!key) return leer;
  const haeuser = houseCount(key);
  const wert = ownerValue(key);
  const { wohn, betrieb, betriebe } = mietTeile(key);
  const p = personalVon(key);
  const faktor = betriebe ? (p && PERSONAL[p.stufe] ? PERSONAL[p.stufe].faktor : OHNE_PERSONAL) : 1;
  const miete = Math.round(wohn + betrieb * faktor);
  const verwaltung = Math.max(0, haeuser - VERWALTUNG_FREI) * VERWALTUNG;
  // Nie unter null: der Stunden-Bonus soll niemandem Chips wegnehmen, auch
  // dem nicht, dessen Ortsteil gerade im Keller ist.
  const basis = Math.max(0, miete - verwaltung);
  const netto = Math.round(nachSteuer(basis));
  const satz = steuersatz(basis);
  return {
    haeuser, wert, miete, verwaltung, satz, steuer: basis - netto, netto,
    // Die Zahlen mitschicken statt sie im Client noch einmal zu tippen. Genau
    // so lief Towers auseinander: dort stand der Maximaleinsatz als 50000 im
    // Browser und als etwas anderes im Server.
    verwJe: VERWALTUNG, verwFrei: VERWALTUNG_FREI, steuerFrei: STEUER_FREI,
    betriebe,
    personal: p ? { stufe: p.stufe, label: PERSONAL[p.stufe].label, bis: p.bis, seit: p.seit || null } : null,
    personalFaktor: faktor,
    // Was einem gerade durch fehlendes Personal entgeht. Ohne die Zahl ist
    // "halbe Kraft" ein Wort und kein Grund, etwas zu tun.
    ohnePersonal: betriebe && !p ? Math.round(betrieb * (1 - OHNE_PERSONAL)) : 0,
  };
}

/** Die drei Stufen mit dem Lohn, den DIESER Spieler zahlen wuerde. */
function personalAngebot(key) {
  const { betrieb, betriebe } = mietTeile(key);
  const p = personalVon(key);
  return {
    betriebe,
    aktuell: p ? { stufe: p.stufe, label: PERSONAL[p.stufe].label, bis: p.bis, seit: p.seit || null } : null,
    ohnePersonal: OHNE_PERSONAL,
    stufen: Object.entries(PERSONAL).map(([id, x]) => ({
      id, label: x.label, faktor: x.faktor, stunden: x.stunden,
      lohn: Math.round(betrieb * x.stunden * x.lohnAnteil),
      /*
       * Ab wie vielen Abholungen sich die Schicht lohnt.
       *
       * Nicht "was sie insgesamt bringt": die Miete kommt mit dem
       * Stunden-Bonus, also je ABHOLUNG und nicht je Stunde. Wer in zwoelf
       * Stunden dreimal vorbeischaut, bekommt dreimal Miete, nicht zwoelfmal.
       * Eine Zahl, die zwoelf Abholungen unterstellt, waere schlicht gelogen,
       * und der Unterschied ist genau die Entscheidung, um die es hier geht:
       * die Aushilfe fuer den, der kurz reinschaut, die Geschaeftsfuehrung
       * fuer den, der den ganzen Tag da ist.
       */
      abholungen: Math.ceil((x.stunden * x.lohnAnteil) / (x.faktor - OHNE_PERSONAL)),
    })),
  };
}

/* Ortsteil-Politik: der Boss bestimmt die Abgabe
 *
 * Boss eines Ortsteils war bisher eine Krone auf der Uebersicht und ein
 * Rabatt von zehn Prozent fuer einen selbst. Also ein Titel, den man
 * mitnimmt, wenn er einem zufaellt, und den zu verteidigen sich nicht lohnt.
 *
 * Jetzt setzt der Boss fest, was Fremde in seinem Ortsteil abgeben, wenn sie
 * dort kaufen, uebernehmen oder ausbauen: null bis zehn Prozent, und das Geld
 * geht an ihn. Damit ist die Krone zum ersten Mal etwas wert und damit auch
 * etwas, das jemand einem wegnehmen will.
 *
 * Zwei Begrenzungen, beide aus demselben Grund:
 *   Zehn Prozent Deckel. Ein Boss, der hundert Prozent verlangen kann,
 *   schliesst seinen Ortsteil, und dann gibt es dort nichts mehr zu erobern.
 *   Eine Aenderung je Stunde. Sonst stellt man den Satz auf null, laesst den
 *   anderen kaufen und dreht ihn hoch, sobald jemand ausbauen will.
 *
 * Der Satz haengt am ORTSTEIL, nicht an der Person. Wer den Boss stuerzt,
 * erbt den Satz und kann ihn aendern, wie er will.
 */
const ZOLL_MAX = 0.10;
const ZOLL_PAUSE_MS = 60 * 60 * 1000;

const zollSatz = (did) => Math.max(0, Math.min(ZOLL_MAX, (state.zoll[did] && state.zoll[did].satz) || 0));

/**
 * Was bei einem Kauf in `did` an den Boss geht. Null, wenn es keinen Boss
 * gibt, der Satz null ist oder der Kaeufer selbst der Boss ist.
 */
function zollFuer(key, did, betrag) {
  const satz = zollSatz(did);
  if (!satz || !betrag) return null;
  const b = getDerived().bossByDistrict[did];
  if (!b || b.owner === key) return null;
  return { to: b.owner, name: b.name, satz, amount: Math.round(betrag * satz) };
}

/** Den Satz aendern. Nur der Boss, hoechstens einmal je Stunde. */
function zollSetzen(key, did, satz) {
  const d = MAP.districts.find((x) => x.id === did);
  if (!d) return err("Diesen Ortsteil gibt es nicht.");
  if (!isBoss(key, did)) return err("Nur der Boss des Ortsteils legt die Abgabe fest.");
  const wert = Math.max(0, Math.min(ZOLL_MAX, Number(satz) || 0));
  const jetzt = state.zoll[did];
  if (jetzt && Date.now() - (jetzt.at || 0) < ZOLL_PAUSE_MS) {
    const min = Math.ceil((ZOLL_PAUSE_MS - (Date.now() - jetzt.at)) / 60000);
    return err(`Der Satz lässt sich einmal je Stunde ändern. Noch ${min} Minuten.`);
  }
  state.zoll[did] = { satz: wert, at: Date.now(), von: key };
  save();
  return { ok: true, satz: wert, district: d.name };
}

/* Mieter und Ereignisse: die Stadt als bewohnter Ort
 *
 * Bisher war ein Gebaeude eine Zahl mit einem Umriss. Hier bekommt es einen
 * Menschen und ab und zu ein Problem.
 *
 * Drei Regeln, die aus dem hervorgehen, was hier schon schiefgegangen ist:
 *
 *   Nur ausgebaute Gebaeude. Spender hat 232 Haeuser. Wenn jedes davon
 *   Ereignisse ausloesen koennte, waere die Stadt ein Postfach. Wer ausbaut,
 *   hat wenige und teure Gebaeude, und genau die sind eine Geschichte wert.
 *
 *   Genau EIN offenes Ereignis je Spieler. Kein Stapel, den man abarbeitet.
 *
 *   Ein Ereignis laeuft NICHT ab, und solange es offen ist, passiert nichts
 *   Schlimmes. Die Runde spielt versetzt; ein Ereignis, das nach 24 Stunden
 *   von selbst schlecht ausgeht, bestraft genau die Leute, die selten da
 *   sind. Wer nie entscheidet, bekommt eben kein zweites Ereignis.
 *
 * Der Mieter selbst wird NICHT gespeichert. Er faellt aus der Gebaeude-ID,
 * ist also fuer alle und fuer immer derselbe und kostet kein Byte im
 * Spielstand.
 */
const MIETER_NAMEN = [
  "Kortmann", "Brinkmeier", "Sudhoff", "Wehmeyer", "Lohmann", "Nolting",
  "Hachmeister", "Rehmann", "Steinmeier", "Bruns", "Kösters", "Wiegmann",
  "Diekmann", "Struckmann", "Ahlers", "Peitzmeier", "Rottmann", "Schierbaum",
  "Vahle", "Meinert", "Tölle", "Grothe", "Windmeier", "Sieker",
];
const MIETER_ROLLE = {
  pension: ["Pächterin", "Pächter"], kiosk: ["Kioskfrau", "Kioskmann"],
  cafe: ["Wirtin", "Wirt"], shop: ["Geschäftsführerin", "Geschäftsführer"],
  hotel: ["Hoteldirektorin", "Hoteldirektor"], factory: ["Betriebsleiterin", "Betriebsleiter"],
};
/** Der Mensch hinter einem Gebaeude. Faellt aus der ID, wird nie gespeichert. */
function mieterVon(b) {
  const cls = klasseVon(b);
  const rollen = MIETER_ROLLE[cls];
  if (!rollen) return null;
  let h = 2166136261;
  for (const ch of String(b.id)) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  /* Anrede und Rolle muessen an DEMSELBEN Bit haengen. Vorher waren es zwei
     verschiedene, und dann stand da "Frau Lohmann, Pächter". */
  const weiblich = (h >>> 8) % 2 === 0;
  return {
    name: `${weiblich ? "Frau" : "Herr"} ${MIETER_NAMEN[h % MIETER_NAMEN.length]}`,
    rolle: rollen[weiblich ? 0 : 1],
  };
}

/* Die Ereignisse. Jedes hat zwei Wege, und beide kosten etwas: der eine
 * Chips, der andere Ertrag. Ein Ereignis, bei dem eine Wahl offensichtlich
 * besser ist, waere ein Knopf mit zwei Beschriftungen.
 *
 * `kosten` und `gewinn` zaehlen in STUNDEN-MIETEN des betroffenen Gebaeudes,
 * nicht in festen Chips. Sonst waere dieselbe Reparatur fuer eine Fabrik ein
 * Witz und fuer eine Pension der Ruin.
 */
const EREIGNISSE = {
  wasserschaden: {
    titel: "Wasserschaden",
    text: "In {haus} steht das Wasser im Keller. {mieter} ruft jeden Tag an.",
    wahl: [
      { id: "reparieren", label: "Handwerker rufen", kosten: 8,
        meldung: "Trocken gelegt. {mieter} ist zufrieden." },
      { id: "aussitzen", label: "Aussitzen", folge: { faktor: 0.4, stunden: 24 },
        meldung: "{mieter} mindert die Miete. 24 Stunden auf 40 Prozent." },
    ],
  },
  filmteam: {
    titel: "Ein Filmteam fragt an",
    text: "Für einen Tatort soll in {haus} gedreht werden. {mieter} ist skeptisch.",
    wahl: [
      { id: "zusagen", label: "Drehen lassen", gewinn: 26, folge: { faktor: 0, stunden: 8 },
        meldung: "Die Gage ist da. Acht Stunden bleibt {haus} zu." },
      { id: "absagen", label: "Absagen",
        meldung: "{mieter} atmet auf. Alles bleibt, wie es ist." },
    ],
  },
  nachmieter: {
    titel: "Der Pächter will raus",
    text: "{mieter} kündigt. {haus} braucht jemand Neuen.",
    wahl: [
      { id: "suchen", label: "Makler beauftragen", kosten: 5, folge: { faktor: 1.25, stunden: 48 },
        meldung: "Der Neue zahlt mehr. 48 Stunden auf 125 Prozent." },
      { id: "warten", label: "Selber jemanden finden", folge: { faktor: 0.6, stunden: 24 },
        meldung: "Erstmal steht {haus} halb leer." },
    ],
  },
  kontrolle: {
    titel: "Das Ordnungsamt war da",
    text: "Eine Auflage für {haus}. {mieter} hat den Zettel schon weitergereicht.",
    wahl: [
      { id: "erfuellen", label: "Auflage erfüllen", kosten: 10,
        meldung: "Erledigt. Der Prüfer kommt so schnell nicht wieder." },
      { id: "streiten", label: "Widerspruch einlegen", streit: true,
        meldung: "Der Widerspruch läuft." },
    ],
  },
};

/** Ausgebaute Gebaeude eines Spielers (nur die haben Mieter und Ereignisse). */
function betriebeVon(key) {
  const out = [];
  for (const [id, o] of Object.entries(state.own)) {
    if (o.owner !== key) continue;
    const e = bldIndex.get(Number(id));
    if (!e || !MIETER_ROLLE[klasseVon(e.b)]) continue;
    out.push(e);
  }
  return out;
}

/** Laeuft an einem Gebaeude gerade ein Effekt? Abgelaufene raeumt der Leser weg. */
function effektVon(id) {
  const e = state.effekt[id];
  if (!e) return null;
  if (e.bis <= Date.now()) { delete state.effekt[id]; save(); return null; }
  return e;
}

/** Das offene Ereignis eines Spielers, fertig zum Anzeigen. */
function ereignisVon(key) {
  const ev = state.ereignis[key];
  if (!ev) return null;
  const vorlage = EREIGNISSE[ev.art];
  const e = bldIndex.get(Number(ev.id));
  if (!vorlage || !e || !state.own[ev.id] || state.own[ev.id].owner !== key) {
    // Gebaeude verkauft oder Ereignisart entfallen: still wegraeumen.
    delete state.ereignis[key]; save(); return null;
  }
  const mieter = mieterVon(e.b);
  const haus = e.b.nm || e.b.n || CLASSES[klasseVon(e.b)].name;
  const fuell = (t) => t.replace(/\{haus\}/g, haus).replace(/\{mieter\}/g, mieter.name);
  const stundenMiete = priceOf(e.b) * MIETE_SATZ;
  return {
    art: ev.art, id: Number(ev.id), seit: ev.seit,
    titel: vorlage.titel, text: fuell(vorlage.text),
    haus, district: e.district.name, mieter: mieter.name, rolle: mieter.rolle,
    wahl: vorlage.wahl.map((w) => ({
      id: w.id, label: w.label,
      kosten: Math.round((w.kosten || 0) * stundenMiete),
      gewinn: Math.round((w.gewinn || 0) * stundenMiete),
      folge: w.folge ? { faktor: w.folge.faktor, stunden: w.folge.stunden } : null,
      streit: !!w.streit,
    })),
  };
}

/**
 * Ein Ereignis ziehen. Laeuft im Minutentakt mit und trifft nur Spieler ohne
 * offenes Ereignis und mit mindestens einem ausgebauten Gebaeude.
 */
function ereignisZiehen(now = Date.now()) {
  const kandidaten = new Set();
  for (const o of Object.values(state.own)) if (!state.ereignis[o.owner]) kandidaten.add(o.owner);
  if (!kandidaten.size) return null;
  const liste = [...kandidaten];
  const key = liste[Math.floor(Math.random() * liste.length)];
  const betriebe = betriebeVon(key);
  if (!betriebe.length) return null;
  const e = betriebe[Math.floor(Math.random() * betriebe.length)];
  const arten = Object.keys(EREIGNISSE);
  const art = arten[Math.floor(Math.random() * arten.length)];
  state.ereignis[key] = { art, id: e.b.id, seit: now };
  save();
  return { key, name: state.own[e.b.id].ownerName || key, ...ereignisVon(key) };
}

/** Eine Wahl treffen. Gleiche Form wie buyBuilding, damit doAction ihn kennt. */
function ereignisWaehlen(key, wahlId) {
  const offen = ereignisVon(key);
  if (!offen) return err("Du hast gerade kein Ereignis.");
  const vorlage = EREIGNISSE[offen.art];
  const w = vorlage.wahl.find((x) => x.id === wahlId);
  const anzeige = offen.wahl.find((x) => x.id === wahlId);
  if (!w || !anzeige) return err("Diese Wahl gibt es nicht.");
  const e = bldIndex.get(offen.id);
  const mieter = mieterVon(e.b);
  const fuell = (t) => t.replace(/\{haus\}/g, offen.haus).replace(/\{mieter\}/g, mieter.name);
  /* Der Widerspruch ist die einzige Wahl mit Zufall, und er wird HIER
     geworfen und nicht beim Anzeigen: sonst stuende das Ergebnis schon in
     der Antwort, bevor jemand gedrueckt hat. */
  let folge = w.folge || null, meldung = fuell(w.meldung);
  if (w.streit) {
    if (Math.random() < 0.5) meldung = "Der Widerspruch hat gewirkt, die Auflage ist vom Tisch.";
    else { folge = { faktor: 0.3, stunden: 24 }; meldung = `Verloren. ${offen.haus} bleibt 24 Stunden fast dicht.`; }
  }
  return {
    ok: true,
    cost: anzeige.kosten || 0,
    gain: anzeige.gewinn || 0,
    meldung,
    commit: () => {
      delete state.ereignis[key];
      if (folge) state.effekt[offen.id] = { faktor: folge.faktor, bis: Date.now() + folge.stunden * 3600 * 1000 };
      save();
    },
  };
}

/** Personal einstellen. Gleiche Form wie buyBuilding, damit doAction ihn kennt. */
function personalEinstellen(key, stufe) {
  const x = PERSONAL[stufe];
  if (!x) return err("Diese Stufe gibt es nicht.");
  const { betrieb, betriebe } = mietTeile(key);
  if (!betriebe) return err("Du hast keine Betriebe. Bau erst ein Haus zum Kiosk aus.");
  const p = personalVon(key);
  if (p) return err(`Deine ${PERSONAL[p.stufe].label} arbeitet noch.`);
  const lohn = Math.round(betrieb * x.stunden * x.lohnAnteil);
  const bis = Date.now() + x.stunden * 3600 * 1000;
  return { ok: true, cost: lohn, commit: () => {
    state.personal[key] = { stufe, bis, seit: Date.now() };
    save();
  } };
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
  /* Was bei jedem hinten herauskommt. Der Wert allein sagt nicht, wer die
     Stadt im Griff hat: 232 billige Haeuser sind viel Wert und wenig
     Einnahme, ein ausgebautes Cafe ist umgekehrt. Die Aufstellung macht das
     sichtbar, fuer einen selbst und fuer alle anderen. */
  liste.forEach((z, i) => {
    z.rang = i + 1;
    const m = mieteVon(z.key);
    z.miete = m.miete; z.verwaltung = m.verwaltung; z.steuer = m.steuer; z.netto = m.netto;
    z.betriebe = m.betriebe; z.personal = m.personal ? m.personal.label : null;
  });
  return {
    liste, besetzt, frei: gesamt - besetzt, gesamt,
    verwJe: VERWALTUNG, verwFrei: VERWALTUNG_FREI, steuerFrei: STEUER_FREI, mietSatz: MIETE_SATZ,
  };
}

/**
 * Die Gebaeude eines Besitzers, mit dem Preis, den der Betrachter fuer eine
 * Uebernahme zahlen muesste. Bewusst ein eigener Aufruf: die Uebersicht soll
 * nicht bei jedem Laden alle Haeuser aller Spieler mitschleppen.
 */
function ownerProperties(ownerKey, viewerKey, limit = 60) {
  const out = [];
  for (const [id, o] of Object.entries(state.own)) {
    if (o.owner !== ownerKey) continue;
    const e = bldIndex.get(Number(id));
    if (!e) continue;
    const price = priceOf(e.b);
    out.push({
      id: Number(id), did: e.district.id, districtName: e.district.name,
      label: e.b.nm || e.b.n || CLASSES[klasseVon(e.b)].name,
      emoji: e.b.trophy ? TROPHIES[e.b.trophy].emoji : CLASSES[klasseVon(e.b)].emoji,
      st: e.b.st || null,
      price,
      takeoverCost: Math.ceil(price * BUYOUT_PREMIUM),
      mine: ownerKey === viewerKey,
    });
  }
  // Billigste zuerst: die Liste soll zeigen, was erreichbar ist, nicht was
  // am meisten Eindruck macht.
  out.sort((a, z) => a.takeoverCost - z.takeoverCost);
  return out.slice(0, limit);
}

// Ansichten für den Client
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
        label: e.b.nm || e.b.n || CLASSES[klasseVon(e.b)].name,
        emoji: e.b.trophy ? TROPHIES[e.b.trophy].emoji : CLASSES[klasseVon(e.b)].emoji,
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
      // Personal gehoert in die Uebersicht und nicht in einen eigenen Aufruf:
      // es ist der einzige Knopf in der Stadt, den man mehrmals am Tag drueckt.
      personal: personalAngebot(key),
      // Das offene Ereignis gehoert ganz nach oben: es ist das Einzige in der
      // Stadt, das auf eine Entscheidung wartet.
      ereignis: ereignisVon(key),
      properties: properties.slice(0, 200),
    };
  }
  return {
    city: MAP.city,
    news: state.news,
    golden: state.golden || null,
    me,
    board: ownerBoard(key),
    steuer: mieteVon(key),
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
  /* Der Satz, den DIESER Betrachter hier zahlt. Der Boss selbst zahlt nichts,
     deshalb einmal je Aufruf und nicht je Gebaeude. */
  const fremdZoll = key && !isBoss(key, d.id) ? zollSatz(d.id) : 0;
  // Fortschritt je Straße fürs Panel: Häuser mit Nummer pro Straße.
  const streetTotals = {};
  for (const [st, ids] of d._streets) streetTotals[st] = ids.length;
  // Einmal je Aufruf, nicht je Gebaeude: haengt nur am Spieler.
  return {
    id: d.id, name: d.name, ring: d.ring,
    steuer: mieteVon(key),
    idx: round2(idxOf(d.id)),
    classes: Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, { name: c.name, emoji: c.emoji, perk: c.perk || null }])),
    trophies: TROPHIES,
    monopolies: der.monopolies[d.id] || [],
    boss: der.bossByDistrict[d.id] ? { name: der.bossByDistrict[d.id].name, color: der.bossByDistrict[d.id].color } : null,
    streetTotals,
    landmarks: (d.landmarks || []).map((l) => ({ type: l.type, name: l.name, x: l.x, y: l.y, pts: l.pts || null })),
    roads: d.roads || [],
    iAmBoss: !!key && isBoss(key, d.id),
    zoll: {
      satz: zollSatz(d.id), max: ZOLL_MAX,
      // Wann der Boss ihn wieder aendern darf. Ohne die Zahl drueckt er und
      // bekommt eine Absage, ohne zu wissen, wie lange noch.
      frei: (state.zoll[d.id] && state.zoll[d.id].at ? state.zoll[d.id].at + ZOLL_PAUSE_MS : 0),
      bossName: der.bossByDistrict[d.id] ? der.bossByDistrict[d.id].name : null,
    },
    golden: state.golden && state.golden.district === d.id ? state.golden.st : null,
    buildings: d.buildings.map((b) => {
      const o = state.own[b.id];
      const price = priceOf(b);
      return {
        id: b.id, pts: b.pts, c: b.c, a: b.a, cls: klasseVon(b), n: b.n, st: b.st, lm: b.lm,
        t: b.t || null, nm: b.nm || null, lv: b.lv || null,
        trophy: b.trophy || null,
        price, sellPrice: sellPriceOf(b),
        /* Was dieser Spieler zahlen wuerde: der Boss-Rabatt gehoert auf den
           Server. Vorher rechnete der Client den Uebernahmepreis selbst als
           price × 1,5 nach und lag falsch, sobald etwas dazukam. */
        myPrice: Math.round(price * (key && isBoss(key, d.id) ? BOSS_DISCOUNT : 1) * (1 + fremdZoll)),
        takeoverCost: Math.ceil(price * BUYOUT_PREMIUM * (1 + fremdZoll)),
        owner: o ? o.owner : null, ownerName: o ? o.ownerName : null,
        color: o ? colorFor(o.owner) : null,
        mine: !!o && o.owner === key, listed: !!(o && o.listed),
        bau: state.bau[b.id] ? { ziel: state.bau[b.id].ziel, fertig: state.bau[b.id].fertig, seit: state.bau[b.id].seit || null } : null,
        // Mieter gibt es erst ab der Pension: ein Wohnhaus vermietet sich selbst.
        mieter: mieterVon(b),
        effekt: state.effekt[b.id] && state.effekt[b.id].bis > Date.now()
          ? { faktor: state.effekt[b.id].faktor, bis: state.effekt[b.id].bis } : null,
      };
    }),
  };
}

/**
 * Was an diesem Gebaeude moeglich ist. Auch dann beantwortet, wenn nichts
 * geht: der Client soll "zu klein" oder "schon eine Fabrik" anzeigen koennen
 * statt einen Knopf, der stumm nichts tut.
 */
function ausbauInfo(id, key) {
  const e = bldIndex.get(Number(id));
  if (!e) return null;
  const b = e.b;
  const jetzt = klasseVon(b);
  const laufend = bauAn(b.id);
  const o = state.own[b.id];
  const info = {
    id: Number(id), a: b.a,
    klasse: jetzt, klasseName: CLASSES[jetzt].name, klasseEmoji: CLASSES[jetzt].emoji,
    bau: laufend ? { ziel: laufend.ziel, zielName: CLASSES[laufend.ziel].name, fertig: laufend.fertig, seit: laufend.seit || null } : null,
    offen: key ? baustellen(key) : 0, max: BAUSTELLEN_MAX,
    moeglich: false, grund: null, ziel: null,
  };
  const naechste = AUSBAU[jetzt];
  if (b.trophy) { info.grund = "Trophäen bleiben, wie sie sind."; return info; }
  if (!naechste) { info.grund = "Mehr geht nicht."; return info; }
  info.ziel = naechste.ziel;
  info.zielName = CLASSES[naechste.ziel].name;
  info.zielEmoji = CLASSES[naechste.ziel].emoji;
  info.minA = naechste.minA;
  info.kosten = Math.round(Math.max(0, preisAls(b, naechste.ziel) - priceOf(b)) * AUSBAU_AUFSCHLAG);
  /* Die Abgabe des Ortsteils gehoert in den PREIS am Knopf und nicht in eine
     Fussnote. Sonst steht "Ausbauen fuer 723.500" und abgebucht werden
     795.850. */
  const z = zollFuer(key, b._did, info.kosten);
  info.zoll = z ? { satz: z.satz, amount: z.amount, name: z.name } : null;
  info.kosten += z ? z.amount : 0;
  info.dauerMs = BAUZEIT_H[naechste.ziel] * 3600 * 1000;
  // Was es nachher bringt. Ohne diese Zahl ist der Ausbau eine Wette.
  info.mieteJetzt = Math.round(priceOf(b) * MIETE_SATZ);
  info.mieteNachher = Math.round(preisAls(b, naechste.ziel) * MIETE_SATZ);
  if (laufend) info.grund = "Wird schon umgebaut.";
  else if (!o || o.owner !== key) info.grund = "Gehört dir nicht.";
  else if (b.a < naechste.minA) info.grund = `Zu klein: ${CLASSES[naechste.ziel].name} braucht ${naechste.minA} m², das hier hat ${b.a}.`;
  else if (baustellen(key) >= BAUSTELLEN_MAX) info.grund = `Du hast schon ${BAUSTELLEN_MAX} Baustellen offen.`;
  else info.moeglich = true;
  return info;
}

/** Ausbau anfangen. Gleiche Form wie buyBuilding, damit doAction ihn kennt. */
function ausbauStart(id, key) {
  const info = ausbauInfo(id, key);
  if (!info) return err("Gebäude nicht gefunden.");
  if (!info.moeglich) return err(info.grund || "Geht hier nicht.");
  const fertig = Date.now() + info.dauerMs;
  const e = bldIndex.get(Number(id));
  const zoll = zollFuer(key, e.b._did, info.kosten);
  return { ok: true, cost: info.kosten + (zoll ? zoll.amount : 0), zoll, commit: () => {
    // `seit` nur fuers Anzeigen: ohne Anfang laesst sich kein Fortschritt
    // rechnen, nur eine Restzeit, und eine Zahl ohne Balken sagt nicht, ob
    // man gerade angefangen hat oder gleich fertig ist.
    state.bau[id] = { ziel: info.ziel, fertig, seit: Date.now(), key };
    save();
  } };
}

// Änderungen
function buyBuilding(id, key, name) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  if (ownerOf(e.b.id)) return err("Gehört schon jemandem, dafür gibt es „Übernehmen“.");
  // Der Boss kauft in seinem Ortsteil 10 % billiger (Gebiet belohnt Gebiet).
  const discount = isBoss(key, e.b._did) ? BOSS_DISCOUNT : 1;
  const grund = Math.round(priceOf(e.b) * discount);
  const zoll = zollFuer(key, e.b._did, grund);
  return { ok: true, cost: grund + (zoll ? zoll.amount : 0), zoll, purchaseIds: [e.b.id], commit: () => {
    state.own[e.b.id] = { owner: key, ownerName: name };
    save();
  } };
}

function sellBuilding(id, key) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o || o.owner !== key) return err("Gehört dir nicht.");
  if (bauAn(e.b.id)) return err("Hier wird gerade gebaut. Erst fertig werden lassen.");
  return { ok: true, gain: sellPriceOf(e.b), commit: () => { delete state.own[e.b.id]; save(); } };
}

function takeover(id, key, name) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o) return err("Ist frei, einfach kaufen.");
  if (o.owner === key) return err("Gehört dir bereits.");
  // Eine Baustelle ist unantastbar. Sonst waere Ausbauen ein Signal an die
  // anderen, wo sich das Zuschlagen am meisten lohnt, und niemand faengt an.
  if (bauAn(e.b.id)) return err("Da wird gerade gebaut, das ist nicht zu haben.");
  const value = priceOf(e.b);
  const grund = Math.ceil(value * BUYOUT_PREMIUM);
  const zoll = zollFuer(key, e.b._did, grund);
  return {
    ok: true,
    // Der Kaeufer zahlt den Aufschlag, der Vorbesitzer bekommt den reinen
    // Marktwert. Die Differenz verbrennt, wie bisher.
    cost: grund + (zoll ? zoll.amount : 0), purchaseIds: [e.b.id],
    zoll,
    payout: { to: o.owner, amount: value },
    commit: () => { state.own[e.b.id] = { owner: key, ownerName: name }; save(); },
  };
}

/** Ein Straßenkauf ist eine einzige, vorab vollständig berechnete Aktion.
 *  Andere Eigentümer erhalten für jedes übernommene Haus den normalen
 *  Marktwert; Baustellen blockieren den gesamten Kauf statt eines Teilkaufs. */
function streetPlan(districtId, street, key, name) {
  const d = MAP.districts.find((x) => x.id === districtId);
  const streetName = String(street || "");
  const ids = d && d._streets.get(streetName);
  if (!ids) return err("Diese Straße ist kein kaufbares Monopol in diesem Ortsteil.");
  const actions = [];
  let free = 0, takeovers = 0, owned = 0;
  for (const id of ids) {
    const holder = state.own[id];
    if (holder && holder.owner === key) { owned++; continue; }
    const action = holder ? takeover(id, key, name) : buyBuilding(id, key, name);
    if (!action.ok) return err(`${streetName}: ${action.error}`);
    actions.push(action);
    if (holder) takeovers++; else free++;
  }
  if (!actions.length) return err("Dir gehört diese Straße bereits vollständig.");
  return {
    ok: true, street: streetName, districtId, total: ids.length, free, takeovers, owned,
    count: actions.length, cost: actions.reduce((sum, a) => sum + a.cost, 0),
    zolls: actions.map((a) => a.zoll).filter(Boolean),
    payouts: actions.map((a) => a.payout).filter(Boolean),
    purchaseIds: actions.flatMap((a) => a.purchaseIds),
    commit: () => {
      /* Alle Bedingungen und die volle Deckung prüft der Aufrufer vor diesem
         Schritt. Ein Speichern genügt für das gesamte Monopol. */
      for (const id of actions.flatMap((a) => a.purchaseIds))
        state.own[id] = { owner: key, ownerName: name };
      save();
    },
  };
}

function streetOffer(districtId, street, key, name) {
  const plan = streetPlan(districtId, street, key, name);
  if (!plan.ok) return plan;
  const { ok, total, free, takeovers, owned, count, cost } = plan;
  return { ok, street: plan.street, total, free, takeovers, owned, count, cost };
}

function listCompany(id, key) {
  const e = bldIndex.get(Number(id));
  if (!e) return err("Gebäude nicht gefunden.");
  const o = state.own[e.b.id];
  if (!o || o.owner !== key) return err("Du musst das Gebäude besitzen.");
  if (!/^(kiosk|cafe|shop|hotel|factory)$/.test(klasseVon(e.b))) return err("Nur richtige Betriebe können an die Börse.");
  if (o.listed) return err("Schon börsennotiert.");
  const t = CLASSES[klasseVon(e.b)];
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
    label: e.b.nm || e.b.n || CLASSES[klasseVon(e.b)].name,
    district: e.district.name,
    ownerName: o ? o.ownerName : null,
  };
}

function resetCity() {
  state = { v: "porta2", own: {}, idx: {}, news: [], aus: {}, bau: {}, personal: {}, ereignis: {}, effekt: {}, zoll: {}, createdAt: Date.now() };
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
    const c = e ? CLASSES[klasseVon(e.b)] : null;
    return {
      id: Number(id),
      type: e ? klasseVon(e.b) : null,
      name: c ? `${c.name}${e.district ? " · " + e.district.name : ""}` : "Gebäude",
      emoji: c ? c.emoji : "🏠",
      owner: o.ownerName || null,
    };
  });
}

function err(error) { return { ok: false, error }; }

/**
 * Der Besitzer heisst jetzt anders.
 *
 * Die Stadt speichert zu jedem Grundstueck den Namen mit, nicht nur den
 * Schluessel (`{ owner, ownerName }`). Ohne diesen Durchlauf stuende der alte
 * Name weiter an jedem Haus, in jedem Monopol und bei jedem Bosswechsel,
 * also ausgerechnet dort, wo ihn jeder sieht.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  for (const o of Object.values(state.own || {})) {
    if (o && o.owner === key) { o.ownerName = neu; n++; }
  }
  if (n) save();
  return n;
}

module.exports = {
  umbenennen,
  CLASSES, TROPHIES, colorFor,
  publicOverview, publicDistrict, ownerValue, casinoOwner, bankOwner, tickMarket, fireEvent,
  streetCount, trophiesOf, hasTrophy, bldExists, bldInfo, isBoss, istBossIrgendwo,
  houseCount, rollGoldenStreet, goldenStreet, ownsGolden, setsOf,
  territorySnapshot, territoryDiff,
  ownerBoard, ownerProperties, mieteVon, steuersatz,
  klasseVon, ausbauInfo, ausbauStart, bautenPruefen, AUSBAU, BAUSTELLEN_MAX,
  personalAngebot, personalEinstellen, personalVon,
  mieterVon, ereignisVon, ereignisZiehen, ereignisWaehlen, effektVon,
  zollSatz, zollSetzen, zollFuer, ZOLL_MAX,
  buyBuilding, sellBuilding, takeover, streetPlan, streetOffer,
  listCompany, adminClearLot, adminRemoveOwner, ownedLots, resetCity,
};
