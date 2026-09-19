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
 * Hier bekommt jedes limitierte Exemplar deshalb eine laufende Nummer, ein
 * Prägedatum, einen Erstbesitzer und eine Kette aller Besitzer mit den
 * Preisen, zu denen es den Besitzer gewechselt hat. Aus "Hologramm" wird
 * "Hologramm Nr. 3 von 7, geprägt für Ben, zweimal weitergegeben, zuletzt für
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

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "praegung.json");

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && raw.stuecke) return { v: 1, next: raw.next || {}, stuecke: raw.stuecke, nachgetragen: !!raw.nachgetragen, einsKorrigiert: !!raw.einsKorrigiert };
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
  return { v: 1, next: {}, stuecke: {}, nachgetragen: false, einsKorrigiert: false };
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

/**
 * Wie viele Exemplare dieses Stücks es wirklich gibt.
 *
 * Gezählt wird, was DA ist, nicht wie weit der Zähler steht. Seit der
 * Nachtrag bei 2 anfängt (die Nummer 1 bleibt dem ersten echten Zug
 * vorbehalten), sind die beiden Zahlen nicht mehr dasselbe: der Zähler stünde
 * bei 28, während 27 Exemplare existieren, und an jedem Angebot stünde
 * „Nr. 5 von 28" für eine Sache, die es 27 Mal gibt. Ein eingezogenes Stück
 * (`entpraegen`) fehlt hier ebenfalls, und das ist richtig so.
 *
 * Der Zähler bleibt daneben bestehen und vergibt weiter Nummern: eine Nummer
 * darf nie zweimal vergeben werden, auch wenn das Exemplar dazu nicht mehr
 * existiert.
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
    if (s.besitzer === key && s.art === art && s.id === id) return { uid, ...s };
  }
  return null;
}

/** Alle Exemplare von `key`, als { "art:id": stueck }. */
function alleVon(key) {
  const out = {};
  for (const [uid, s] of Object.entries(state.stuecke)) {
    if (s.besitzer === key) out[schluessel(s.art, s.id)] = { uid, ...s };
  }
  return out;
}

const stueck = (uid) => (state.stuecke[uid] ? { uid, ...state.stuecke[uid] } : null);

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
  const k = schluessel(art, id);
  const nr = (state.next[k] || 0) + 1;
  state.next[k] = nr;
  const uid = neueUid();
  state.stuecke[uid] = {
    art, id, nr, gepraegtAm: at,
    fuer: key, fuerName: name || key,
    besitzer: key, besitzerName: name || key,
    kette: [{ key, name: name || key, at, preis: 0 }],
  };
  save();
  return { uid, ...state.stuecke[uid] };
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
  return { uid, ...s };
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
 * Läuft genau einmal, beim ersten Start nach dem Umbau. Die Reihenfolge der
 * Nummern muss dabei irgendwo herkommen, und "wer war zuerst da" ist die
 * einzige Angabe, die für alle Stücke existiert: sortiert wird nach dem Alter
 * des Kontos. Wer sein Stück wirklich zuerst hatte, lässt sich nachträglich
 * nicht mehr feststellen, aber eine willkürliche Reihenfolge wäre schlechter
 * als eine nachvollziehbare.
 *
 * `praegbar(art, id)` entscheidet, was eine Nummer bekommt, und kommt aus
 * game/cosmetics.js. Dieses Modul kennt den Katalog absichtlich nicht: sonst
 * hinge das Register an den Preisen im Laden.
 */
/*
 * Die Nummer 1 bleibt frei.
 *
 * Nachgetragen wird nach Kontoalter, das ist die einzige Reihenfolge, die es
 * für alten Besitz überhaupt gibt. Damit gingen aber ALLE Erstprägungen an
 * die ältesten Konten: im Stand vom 18.9. hätte der Besitzer allein 20 von
 * 37 bekommen, nicht weil er sie gezogen hat, sondern weil sein Konto das
 * erste war. In dem Moment, in dem die Nummer 1 eine sichtbare Auszeichnung
 * ist, wäre das keine.
 *
 * Also fängt der Nachtrag bei 2 an. Die Nummer 1 eines Stücks bekommt, wer
 * es nach der Umstellung als Erster wirklich aus einer Kiste zieht — und
 * wenn es niemand zieht, bleibt sie für immer frei. Das nimmt niemandem
 * etwas weg: alle behalten ihre Stücke und ihre Reihenfolge, sie fängt nur
 * eins höher an.
 */
const NACHTRAG_AB = 2;

/**
 * Stuecke, bei denen die Nummer 1 NICHT freibleiben darf.
 *
 * Die Regel darueber (Nachtrag faengt bei 2 an) hat einen guten Grund:
 * nachgetragen wird nach Kontoalter, und wer die Eins allein deshalb
 * bekaeme, weil sein Konto das erste war, hat sie nicht verdient. Sie
 * bleibt frei fuer den, der das Stueck als Erster wirklich aus einer
 * Kiste zieht.
 *
 * Bei einem Los aus dem Auktionshaus gibt es diesen Ersten aber schon,
 * und es wird nie einen zweiten geben: ein Haus-Los verschwindet nach
 * dem Zuschlag aus dem Angebot und kommt nie wieder. Die Eins blieb
 * damit fuer immer unerreichbar, und der Gewinner hielt „Nr. 2" von
 * etwas, das es genau ein Mal gibt. Er HAT es als Erster gehabt, vor
 * aller Augen, mit Gebot und Uhrzeit.
 */
function startNummer(art, id, abEins) {
  return abEins && abEins(art, id) ? 0 : NACHTRAG_AB - 1;
}

function nachtragen(accounts, praegbar, topfNachArt, abEins) {
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
        const k = schluessel(art, id);
        if (!state.next[k]) state.next[k] = startNummer(art, id, abEins);
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
 * Nachtraeglich geradeziehen, was der erste Nachtrag falsch nummeriert hat.
 *
 * Laeuft der Nachtrag einmal, sind die Nummern vergeben — auch die zu
 * hohen. Wer das Haus schon gestartet hatte, bevor `abEins` existierte,
 * haette sonst fuer immer ein Auktionsstueck mit der Nummer 2, von dem es
 * genau ein Exemplar gibt, und die 1 waere fuer niemanden mehr zu haben.
 *
 * Angefasst wird nur der eindeutige Fall: genau EIN Exemplar, und keines
 * traegt die 1. Gibt es mehrere (etwa weil jemand von Hand nachgeholfen
 * hat), bleibt alles stehen und es gibt eine Zeile in der Konsole — eine
 * Nummer stillschweigend umzuschreiben, waere schlimmer als eine falsche.
 *
 * Laeuft genau einmal (`state.einsKorrigiert`).
 */
function korrigiereErstpraegung(abEins) {
  if (state.einsKorrigiert || typeof abEins !== "function") return 0;
  const nach = new Map();           // "art:id" -> [uid, …]
  for (const [uid, st] of Object.entries(state.stuecke)) {
    if (!abEins(st.art, st.id)) continue;
    const k = schluessel(st.art, st.id);
    if (!nach.has(k)) nach.set(k, []);
    nach.get(k).push(uid);
  }
  let n = 0;
  for (const [k, uids] of nach) {
    if (uids.some((u) => state.stuecke[u].nr === 1)) continue;
    if (uids.length !== 1) {
      console.log(`praegung: ${k} hat ${uids.length} Exemplare und keine Nr. 1 — von Hand ansehen.`);
      continue;
    }
    state.stuecke[uids[0]].nr = 1;
    state.next[k] = Math.max(1, ...uids.map((u) => state.stuecke[u].nr));
    n++;
  }
  state.einsKorrigiert = true;
  save();
  if (n) console.log(`praegung: ${n} Auktionsstück(e) auf Nr. 1 gesetzt.`);
  return n;
}

module.exports = {
  praegen, uebertragen, entpraegen, stueckVon, alleVon, stueck, bestand,
  umbenennen, nachtragen, korrigiereErstpraegung,
};
