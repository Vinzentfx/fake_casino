"use strict";

/**
 * Prägung: aus einem Häkchen wird ein Gegenstand.
 *
 * Bisher war Kosmetikbesitz eine Liste von Kennungen am Konto
 * (`acc.cosOwned.titles = ["rueckkehrer", …]`). Das reicht für "hat er oder
 * hat er nicht", und mehr war auch nie nötig, solange man Stücke nur kaufen
 * konnte. Es reicht nicht für das, was ein Stück wertvoll macht.
 *
 * Im echten Spielstand vom 18.9. besaßen von 80 Konten überhaupt 33 irgendein
 * Kosmetikstück, und fast alles davon war verschenkt: Salut 27 Mal,
 * Rückkehrer 27 Mal, Season 12 Mal. Wirklich GEKAUFT wurden im ganzen Haus
 * rund fünfzehn Stück. Der Laden ist der größte Chip-Abfluss, den das Casino
 * hat, und er wird nicht benutzt, weil ein Stück nichts erzählt.
 *
 * Hier bekommt jedes limitierte Exemplar deshalb eine zufaellige Seriennummer, ein
 * Prägedatum, einen Erstbesitzer und eine Kette aller Besitzer mit den
 * Preisen, zu denen es den Besitzer gewechselt hat. Aus "Hologramm" wird
 * "Hologramm #0427, geprägt für Ben, zweimal weitergegeben, zuletzt für
 * 840.000". Erst damit lohnt sich ein Markt, und erst damit ist Seltenheit
 * etwas, das man sehen kann.
 *
 * Was hier bewusst NICHT passiert:
 *
 *   Der Besitz bleibt in `cosOwned`. Das ist weiterhin die einzige Wahrheit
 *   darüber, wer was anlegen darf. Die Prägung hängt daneben und beschreibt
 *   nur, WELCHES Exemplar. Zwei Quellen für dieselbe Frage wären zwei
 *   Quellen, die auseinanderlaufen können (siehe Fortuna: der Zähler ist
 *   bewusst die Anzahl der Besitzer und keine eigene Datei).
 *
 *   Ladenware wird nicht geprägt. Eine Nummer an etwas, das es unbegrenzt zu
 *   kaufen gibt, wäre "Nr. 4312 von unendlich" und damit ein Witz.
 *
 * Stand in data/praegung.json.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "praegung.json");

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && raw.stuecke) return {
      v: Number(raw.v) || 1,
      next: raw.next || {},
      stuecke: raw.stuecke,
      vergeben: raw.vergeben || {},
      nachgetragen: !!raw.nachgetragen,
      einsKorrigiert: !!raw.einsKorrigiert,
      serienZufall: !!raw.serienZufall,
    };
  } catch (e) {
    /* Fehlt die Datei, ist ein leeres Register richtig: dann wird gleich
       nachgetragen. Ist sie da und unlesbar, darf NICHT weitergelaufen
       werden, sonst prägt der Nachtrag alles ein zweites Mal und jede
       Nummer im Haus ist eine andere als gestern. Dieselbe Regel wie bei
       accounts.load(). */
    if (e.code !== "ENOENT") {
      console.error("praegung: data/praegung.json ist da, aber unlesbar. Start abgebrochen.", e.message);
      throw e;
    }
  }
  return { v: 2, next: {}, stuecke: {}, vergeben: {}, nachgetragen: false, einsKorrigiert: true, serienZufall: true };
}

let state = load();
/* Beim Nachtragen wird nicht nach jedem Stück geschrieben, sondern einmal am
   Ende. Sonst sind es hundert Schreibvorgänge auf dieselbe wachsende Datei. */
let sammeln = false;

/**
 * Immer sofort schreiben.
 *
 * Hier stand erst ein gebündelter Schreibvorgang nach 800 ms, mit `unref()`,
 * abgeschaut von der Chronik. Für die Chronik passt das (ein verlorener
 * Eintrag ist eine verlorene Zeile), hier nicht: eine Prägung verschwand,
 * wenn der Prozess in derselben Sekunde endete. Der Besitz stand danach in
 * `cosOwned` und das Exemplar nirgends, und nachgetragen wird nur einmal.
 * Übrig wäre ein Stück ohne Nummer, das keine mehr bekommt.
 *
 * Geprägt wird ein paar Mal am Tag, nicht ein paar Mal je Sekunde. Der
 * Schreibvorgang kostet hier nichts.
 */
function save() {
  if (sammeln) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}
const saveJetzt = save;

const schluessel = (art, id) => `${art}:${id}`;
const neueUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ------------------------------------------------------------------
 * Serienlotterie
 *
 * Eine laufende Nummer belohnt Tempo: wer nach einem neuen Katalogstueck
 * zuerst genug Kisten aufmacht, kann die Eins praktisch erzwingen. Eine
 * Seriennummer soll aber ein Fund sein, kein Wettrennen.
 *
 * Jede neue Praegung zieht deshalb zuerst eine Klasse und danach eine noch
 * freie vierstellige Nummer aus deren Muster-Topf. Die Chance bleibt bei
 * jedem Exemplar gleich, egal ob es das erste oder das hundertste ist.
 * Innerhalb eines Stuecks wird eine Nummer nie doppelt vergeben.
 * ------------------------------------------------------------------ */
const SERIEN_MAX = 9_999;
const SERIEN = [
  { id: "jackpot", label: "Jackpot-Serie", kurz: "Jackpot", chance: 0.5, farbe: "#b6ff4d" },
  { id: "gold", label: "Gold-Serie", kurz: "Gold", chance: 2, farbe: "#f4d782" },
  { id: "glueck", label: "Glücksserie", kurz: "Glück", chance: 7.5, farbe: "#5eead4" },
  { id: "standard", label: "Klassische Serie", kurz: "Klassisch", chance: 90, farbe: "#9aa4ae" },
];

const JACKPOT_NUMMERN = new Set([1, 7, 77, 777, 7777]);
const GOLD_NUMMERN = new Set([123, 321, 1234, 2026, 4321]);
for (let z = 1; z <= 9; z++) {
  GOLD_NUMMERN.add(z * 11);
  GOLD_NUMMERN.add(z * 111);
  GOLD_NUMMERN.add(z * 1111);
}
for (const n of JACKPOT_NUMMERN) GOLD_NUMMERN.delete(n);

const istSpiegel = (n) => {
  const s = String(n);
  return s.length >= 3 && s === s.split("").reverse().join("");
};
const GLUECK_NUMMERN = new Set();
for (let n = 10; n <= SERIEN_MAX; n++) {
  if (istSpiegel(n) || n % 100 === 0) GLUECK_NUMMERN.add(n);
}
for (const n of JACKPOT_NUMMERN) GLUECK_NUMMERN.delete(n);
for (const n of GOLD_NUMMERN) GLUECK_NUMMERN.delete(n);

const POOLS = {
  jackpot: [...JACKPOT_NUMMERN],
  gold: [...GOLD_NUMMERN],
  glueck: [...GLUECK_NUMMERN],
  standard: [],
};
for (let n = 1; n <= SERIEN_MAX; n++) {
  if (!JACKPOT_NUMMERN.has(n) && !GOLD_NUMMERN.has(n) && !GLUECK_NUMMERN.has(n)) POOLS.standard.push(n);
}

function serienRang(nr) {
  nr = Number(nr) || 0;
  if (JACKPOT_NUMMERN.has(nr)) return "jackpot";
  if (GOLD_NUMMERN.has(nr)) return "gold";
  if (GLUECK_NUMMERN.has(nr)) return "glueck";
  return "standard";
}

function serieVon(nr) {
  nr = Number(nr) || 0;
  if (!nr) return null;
  const def = SERIEN.find((s) => s.id === serienRang(nr)) || SERIEN[SERIEN.length - 1];
  return { ...def, nr, code: String(nr).padStart(4, "0") };
}

function belegteNummern(art, id) {
  const k = schluessel(art, id);
  const out = new Set((state.vergeben && state.vergeben[k]) || []);
  for (const s of Object.values(state.stuecke)) {
    if (s.art === art && s.id === id && s.nr) out.add(Number(s.nr));
  }
  return out;
}

function merkeVergeben(art, id, nr) {
  const k = schluessel(art, id);
  state.vergeben = state.vergeben || {};
  const liste = state.vergeben[k] || (state.vergeben[k] = []);
  if (!liste.includes(nr)) liste.push(nr);
}

function zieheRang() {
  const r = crypto.randomInt(10_000);
  if (r < 50) return "jackpot";
  if (r < 250) return "gold";
  if (r < 1_000) return "glueck";
  return "standard";
}

function zieheNummer(art, id) {
  const belegt = belegteNummern(art, id);
  const start = zieheRang();
  const reihenfolge = start === "jackpot" ? ["jackpot", "gold", "glueck", "standard"]
    : start === "gold" ? ["gold", "glueck", "standard", "jackpot"]
    : start === "glueck" ? ["glueck", "standard", "gold", "jackpot"]
    : ["standard", "glueck", "gold", "jackpot"];
  for (const rang of reihenfolge) {
    const frei = POOLS[rang].filter((n) => !belegt.has(n));
    if (frei.length) return frei[crypto.randomInt(frei.length)];
  }
  throw new Error(`Alle Seriennummern fuer ${art}:${id} sind vergeben.`);
}

const mitSerie = (uid, s) => ({ uid, ...s, serie: serieVon(s.nr) });

function serienRegeln() {
  return {
    stellen: 4,
    max: SERIEN_MAX,
    klassen: SERIEN.map((s) => ({ ...s })),
    hinweis: "Jede Nummer wird zufällig gezogen und je Stück nur einmal vergeben.",
  };
}

/**
 * Wie viele Exemplare dieses Stücks es wirklich gibt.
 *
 * Gezählt wird, was DA ist, nicht wie viele Seriennummern jemals vergeben
 * wurden. Ein eingezogenes Stück (`entpraegen`) fehlt hier, seine Nummer
 * bleibt in `vergeben` aber dauerhaft gesperrt. So können nie zwei Besitzer
 * in ihrer Historie dasselbe Exemplar beanspruchen.
 */
function bestand(art, id) {
  const k = schluessel(art, id);
  let n = 0;
  for (const s of Object.values(state.stuecke)) {
    if (s.art === art && s.id === id) n++;
  }
  return n;
}

/** Das Exemplar, das `key` von diesem Stück hält. Null, wenn keins. */
function stueckVon(key, art, id) {
  for (const [uid, s] of Object.entries(state.stuecke)) {
    if (s.besitzer === key && s.art === art && s.id === id) return mitSerie(uid, s);
  }
  return null;
}

/** Alle Exemplare von `key`, als { "art:id": stueck }. */
function alleVon(key) {
  const out = {};
  for (const [uid, s] of Object.entries(state.stuecke)) {
    if (s.besitzer === key) out[schluessel(s.art, s.id)] = mitSerie(uid, s);
  }
  return out;
}

const stueck = (uid) => (state.stuecke[uid] ? mitSerie(uid, state.stuecke[uid]) : null);

/**
 * Ein neues Exemplar prägen.
 *
 * Gibt das Stück zurück oder null, wenn `key` dieses Stück schon hat. Prägen
 * ist kein Vergeben: der Besitz steht weiter in `cosOwned`, hier entsteht nur
 * die Nummer dazu.
 */
function praegen(art, id, key, name, at = Date.now()) {
  if (!art || !id || !key) return null;
  if (stueckVon(key, art, id)) return null;
  const nr = zieheNummer(art, id);
  merkeVergeben(art, id, nr);
  const uid = neueUid();
  state.stuecke[uid] = {
    art, id, nr, gepraegtAm: at,
    fuer: key, fuerName: name || key,
    besitzer: key, besitzerName: name || key,
    kette: [{ key, name: name || key, at, preis: 0 }],
  };
  save();
  return mitSerie(uid, state.stuecke[uid]);
}

/**
 * Ein Exemplar weitergeben.
 *
 * Die Kette wächst und wird nie gekürzt: sie IST der Wert des Stücks. Ein
 * Hologramm, das schon durch drei Hände ging, ist eine andere Sache als eins,
 * das seit der Prägung beim Ersten liegt.
 */
function uebertragen(uid, nachKey, nachName, preis = 0, at = Date.now()) {
  const s = state.stuecke[uid];
  if (!s) return null;
  s.besitzer = nachKey;
  s.besitzerName = nachName || nachKey;
  s.kette.push({ key: nachKey, name: nachName || nachKey, at, preis: Math.max(0, Math.round(preis) || 0) });
  saveJetzt();
  return mitSerie(uid, s);
}

/**
 * Ein Exemplar aus der Welt nehmen (Admin nimmt ein Stück zurück).
 *
 * Die Nummer bleibt vergeben. Sonst bekäme das nächste geprägte Stück
 * dieselbe, und zwei Leute hätten irgendwann beide die Nummer 3.
 */
function entpraegen(uid) {
  if (!state.stuecke[uid]) return false;
  delete state.stuecke[uid];
  saveJetzt();
  return true;
}

/**
 * Der Besitzer heißt jetzt anders.
 *
 * Die Kette speichert Namen als Kopie, nicht als Verweis: sie soll Jahre
 * später noch lesbar sein, ohne dass jedes Konto dafür existieren muss. Genau
 * deshalb muss sie bei einer Umbenennung mitgezogen werden, sonst steht der
 * alte Name ausgerechnet dort weiter, wo ihn alle nachlesen.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  for (const s of Object.values(state.stuecke)) {
    if (s.fuer === key && s.fuerName !== neu) { s.fuerName = neu; n++; }
    if (s.besitzer === key && s.besitzerName !== neu) { s.besitzerName = neu; n++; }
    for (const e of s.kette) if (e.key === key && e.name !== neu) { e.name = neu; n++; }
  }
  if (n) saveJetzt();
  return n;
}

/**
 * Bestehende Bestände einmalig nachprägen.
 *
 * Auch alte Bestände gehen durch dieselbe Serienlotterie wie ein neuer Zug.
 * Das Kontoalter bestimmt nur die stabile Arbeitsreihenfolge, nicht mehr die
 * Qualität der Nummer. `praegbar` und `topfNachArt` kommen aus cosmetics.js,
 * damit das Register den Katalog nicht doppelt kennen muss.
 */
function nachtragen(accounts, praegbar, topfNachArt) {
  if (state.nachgetragen) return 0;
  sammeln = true;
  const alle = accounts.rawAll ? accounts.rawAll() : [];
  const sortiert = alle.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let n = 0;
  for (const acc of sortiert) {
    const key = accounts.schluesselVon ? accounts.schluesselVon(acc) : String(acc.name || "").toLowerCase();
    const owned = acc.cosOwned || {};
    for (const [art, topf] of Object.entries(topfNachArt)) {
      for (const id of owned[topf] || []) {
        if (!praegbar(art, id)) continue;
        if (praegen(art, id, key, acc.name, acc.createdAt || Date.now())) n++;
      }
    }
  }
  state.nachgetragen = true;
  sammeln = false;
  save();
  if (n) console.log(`praegung: ${n} vorhandene Stücke nachträglich geprägt.`);
  return n;
}

/**
 * Einmaliger Wechsel von den alten laufenden Nummern zur Serienlotterie.
 *
 * Besitzer, Praegedatum und komplette Handelskette bleiben unberuehrt. Die
 * alte Nummer wird als `altNr` aufgehoben, aber nicht mehr als Wertung
 * gezeigt. Danach werden alle Exemplare frisch und ohne Reihenfolge-Vorteil
 * gezogen. Ein Neustart wiederholt das nicht (`serienZufall`).
 */
function migriereSerien() {
  if (state.serienZufall) return 0;
  const uids = Object.keys(state.stuecke);
  state.vergeben = {};
  for (const uid of uids) {
    const s = state.stuecke[uid];
    if (s.nr && !s.altNr) s.altNr = s.nr;
    s.nr = 0;
  }
  // Die Arbeitsreihenfolge selbst darf keinen Vorteil schaffen.
  for (let i = uids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [uids[i], uids[j]] = [uids[j], uids[i]];
  }
  for (const uid of uids) {
    const s = state.stuecke[uid];
    s.nr = zieheNummer(s.art, s.id);
  }
  state.v = 2;
  state.next = {};
  for (const s of Object.values(state.stuecke)) merkeVergeben(s.art, s.id, s.nr);
  state.serienZufall = true;
  state.einsKorrigiert = true;
  save();
  if (uids.length) console.log(`praegung: ${uids.length} Stücke auf zufällige Seriennummern umgestellt.`);
  return uids.length;
}

migriereSerien();

module.exports = {
  praegen, uebertragen, entpraegen, stueckVon, alleVon, stueck, bestand,
  umbenennen, nachtragen, serieVon, serienRegeln,
  _intern: { serienRang, zieheRang, zieheNummer, migriereSerien, POOLS, SERIEN },
};
