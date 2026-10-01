"use strict";

/**
 * Käufe in Läden und im Schaufenster als EINE Buchung.
 *
 * Ein Kauf verändert drei Dinge, die in drei Dateien liegen: das Konto
 * (Chips, Besitz, angelegtes Stück, Tiername) in accounts.json, das
 * Exemplar im Prägeregister und beim Zoo den Bestand und das Limit je
 * Lieferung in laeden.json. Bricht der Prozess zwischen zwei Schreibvorgängen
 * ab, stehen dort verschiedene Wahrheiten: abgebucht und nichts bekommen,
 * oder ein Tier bekommen und der Zoo hat es nie verkauft.
 *
 * Deshalb ein Journal. Bevor irgendetwas geändert wird, steht die Buchung
 * mit eigener Kennung auf der Platte. Dann wird geändert und gespeichert,
 * das Konto zuletzt. Erst wenn alles sicher liegt, verschwindet die Buchung
 * aus dem Journal, und erst dann bekommt der Käufer sein „gekauft“.
 * Scheitert ein Schreibvorgang, wird im Speicher alles zurückgedreht und
 * der Käufer bekommt einen Fehler, keine Chips sind weg.
 *
 * Beim Start (`wiederaufnehmen`) entscheidet das Konto auf der Platte, wie
 * eine offen gebliebene Buchung ausgeht: Chips und Besitz stehen dort in
 * derselben Datei und werden im selben Schreibvorgang gesichert. Hat das
 * Konto das Stück, wird der Rest nachgezogen (Exemplar, Zoo). Hat es das
 * Stück nicht, wird der Rest zurückgenommen. Ein halber Kauf bleibt nie
 * stehen.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATEI = path.join(__dirname, "..", "data", "buchungen.json");

let offen = {};
try {
  const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  if (roh && typeof roh === "object" && roh.offen && typeof roh.offen === "object") offen = roh.offen;
} catch (e) {
  // Fehlt die Datei, ist das Journal leer. Ist sie da und unlesbar, darf
  // der Start nicht weitermachen: sonst gingen offene Buchungen verloren.
  if (e.code !== "ENOENT") throw new Error(`[buchungen] ${DATEI} ist nicht lesbar: ${e.message}`);
}

/** Die Datei sicher ersetzen: erst eine Kopie schreiben und auf die Platte
    zwingen, dann umbenennen. Wirft bei jedem Fehler. */
function sicherSchreiben(datei, inhalt) {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, inhalt);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, datei);
}

const pruefung = { schreiben: sicherSchreiben, abbruchNach: null };

/* Eine Buchung braucht das Konto SOFORT auf der Platte, nicht gebündelt
   (siehe accounts.save). Fehlt saveJetzt (ältere Testattrappen), tut es save. */
const sofort = (accounts) => (accounts.saveJetzt ? accounts.saveJetzt() : accounts.save());

function sichern() {
  pruefung.schreiben(DATEI, JSON.stringify({ offen }));
}
/** Für Dateien, die zu einer Buchung gehören (der Zoo): sicher ersetzen,
    und im Test lässt sich hier ein Schreibfehler einschleusen. */
const schreiben = (datei, inhalt) => pruefung.schreiben(datei, inhalt);

/* Für Tests: ein Absturz mitten in der Buchung. Kein Zurückdrehen, kein
   Aufräumen, genau wie bei einem Prozess, der einfach weg ist. */
class Abbruch extends Error {}
function schritt(name) {
  if (pruefung.abbruchNach === name) throw new Abbruch(name);
}

/**
 * Einen Kauf buchen.
 *
 * @param {object} o
 * @param o.accounts     das Kontenmodul
 * @param o.cosmetics    das Kosmetikmodul (grant, TOPF, praegbar)
 * @param o.praegung     das Prägeregister
 * @param o.key, o.acc   Käufer
 * @param o.quelle       "laden" oder "boutique"
 * @param o.art, o.id    das Stück
 * @param o.preis        in Chips, wird verbrannt
 * @param o.konto(acc)   was am Konto zusätzlich passiert (anlegen, Tiername);
 *                       muss eine Funktion zum Zurückdrehen liefern
 * @param o.zusatz       optional, für Zustand außerhalb des Kontos (Zoo):
 *                       { angewendet(e), anwenden(e), zurueck(e), speichern() },
 *                       dieselben Haken, die auch die Wiederaufnahme benutzt
 * @param o.meta         was die Wiederaufnahme über die Buchung wissen muss
 */
function buche(o) {
  const { accounts, cosmetics, praegung, key, acc, quelle, art, id, preis } = o;
  if (!acc || !Number.isFinite(preis) || preis < 0) return { ok: false, error: "Ungültige Buchung." };
  if ((acc.chips || 0) < preis) return { ok: false, error: "Nicht genug Chips." };

  const bid = crypto.randomBytes(8).toString("hex");
  const eintrag = { bid, quelle, key, art, id, preis, ts: Date.now(), ...(o.meta || {}) };
  offen[bid] = eintrag;
  try {
    sichern();
  } catch (e) {
    delete offen[bid];
    console.error("[buchungen] Journal nicht schreibbar:", e.message);
    return { ok: false, error: "Gerade lässt sich nichts kaufen. Es wurde nichts abgebucht." };
  }
  schritt("journal");

  const chipsVorher = acc.chips;
  /* Der ganze Besitz vorher, nicht nur das eine Stück: grant() kann eine
     Kollektion vollmachen und deren Belohnung gleich mitvergeben. Auch die
     muss beim Zurückdrehen wieder weg, samt Exemplar. */
  const besitzVorher = JSON.stringify(acc.cosOwned || {});
  const exemplareVorher = new Set(Object.values(praegung.alleVon(key) || {}).map((st) => st.uid));
  let kontoZurueck = null;
  let zusatzAngewendet = false;

  const zurueckdrehen = () => {
    acc.chips = chipsVorher;
    acc.cosOwned = JSON.parse(besitzVorher);
    for (const st of Object.values(praegung.alleVon(key) || {})) {
      if (!exemplareVorher.has(st.uid)) praegung.entpraegen(st.uid);
    }
    if (kontoZurueck) kontoZurueck();
    if (zusatzAngewendet && o.zusatz) o.zusatz.zurueck(eintrag);
  };
  const scheitern = (meldung, fehler) => {
    if (fehler instanceof Abbruch) throw fehler;
    if (fehler) console.error(`[buchungen] ${bid} gescheitert:`, fehler.message);
    zurueckdrehen();
    // So gut es geht wieder auf die Platte. Gelingt das nicht, bleibt die
    // Buchung im Journal, und der nächste Start räumt nach der Platte auf.
    let sauber = true;
    try { if (o.zusatz && zusatzAngewendet) o.zusatz.speichern(); } catch { sauber = false; }
    try { sofort(accounts); } catch { sauber = false; }
    if (sauber) { delete offen[bid]; try { sichern(); } catch {} }
    return { ok: false, error: meldung };
  };

  try {
    // Abgebucht wird direkt am Konto und nicht über adjustChips: das würde
    // sofort speichern, und dann stünden die Chips ohne das Stück auf der Platte.
    acc.chips = chipsVorher - preis;
    if (!cosmetics.grant(acc, art, id, key)) return scheitern("Das ging gerade nicht. Deine Chips sind zurück.");
    if (cosmetics.praegbar(art, id) && praegung.letzterSchreibfehler && praegung.letzterSchreibfehler()) {
      return scheitern("Das ließ sich gerade nicht sichern. Deine Chips sind zurück.", praegung.letzterSchreibfehler());
    }
    schritt("praegung");
    kontoZurueck = o.konto ? o.konto(acc) : null;
    if (o.zusatz) {
      o.zusatz.anwenden(eintrag);
      zusatzAngewendet = true;
      o.zusatz.speichern();
    }
    schritt("zusatz");
    sofort(accounts);
    schritt("konto");
  } catch (e) {
    return scheitern("Das ließ sich gerade nicht sichern. Deine Chips sind zurück.", e);
  }

  delete offen[bid];
  try { sichern(); } catch (e) {
    // Der Kauf ist vollständig gesichert. Bleibt er im Journal stehen,
    // erkennt der nächste Start ihn am Konto als erledigt.
    console.error("[buchungen] Journal nicht aufgeräumt:", e.message);
  }
  return { ok: true, bid };
}

/**
 * Ein Stück ans Haus zurückgeben (game/ankauf.js). Spiegelbildlich zum
 * Kauf: das Konto verliert das Stück und bekommt die Chips im selben
 * Schreibvorgang, danach verschwindet das Exemplar aus dem Register. Bricht
 * es dazwischen ab, sieht die Wiederaufnahme am Konto, dass verkauft wurde,
 * und räumt das Exemplar nach.
 */
function verkaufe(o) {
  const { accounts, cosmetics, praegung, key, acc, art, id, preis } = o;
  if (!acc || !Number.isFinite(preis) || preis < 0) return { ok: false, error: "Ungültige Buchung." };
  const liste = acc.cosOwned && acc.cosOwned[cosmetics.TOPF[art]];
  if (!Array.isArray(liste) || !liste.includes(id)) return { ok: false, error: "Das hast du nicht." };
  const bid = crypto.randomBytes(8).toString("hex");
  const eintrag = { bid, quelle: "ankauf", richtung: "verkauf", key, art, id, preis, ts: Date.now() };
  offen[bid] = eintrag;
  try { sichern(); } catch (e) {
    delete offen[bid];
    console.error("[buchungen] Journal nicht schreibbar:", e.message);
    return { ok: false, error: "Gerade lässt sich nichts verkaufen. Es hat sich nichts geändert." };
  }
  schritt("journal");
  // Flache Kopie: besitzNehmen legt ein angelegtes Stück ab, indem es das
  // Feld am Konto löscht. Beim Zurückdrehen kommt es so wieder.
  const vorher = { chips: acc.chips, besitz: JSON.stringify(acc.cosOwned || {}), felder: { ...acc } };
  try {
    cosmetics.besitzNehmen(acc, art, id);
    acc.chips = (acc.chips || 0) + preis;
    sofort(accounts);
    schritt("konto");
  } catch (e) {
    if (e instanceof Abbruch) throw e;
    console.error(`[buchungen] ${bid} Verkauf gescheitert:`, e.message);
    acc.chips = vorher.chips;
    acc.cosOwned = JSON.parse(vorher.besitz);
    for (const [f, w] of Object.entries(vorher.felder)) if (!(f in acc)) acc[f] = w;
    let sauber = true;
    try { sofort(accounts); } catch { sauber = false; }
    if (sauber) { delete offen[bid]; try { sichern(); } catch {} }
    return { ok: false, error: "Das ließ sich gerade nicht sichern. Es hat sich nichts geändert." };
  }
  const st = praegung.stueckVon(key, art, id);
  if (st) praegung.entpraegen(st.uid);
  schritt("praegung");
  delete offen[bid];
  try { sichern(); } catch (e) { console.error("[buchungen] Journal nicht aufgeräumt:", e.message); }
  return { ok: true, bid };
}

/* Liegt ein Exemplar im Markt oder Auktionshaus, steht es nicht im Besitz
   und gehört trotzdem jemandem. So etwas nimmt die Wiederaufnahme nie weg. */
function hinterlegt(uid) {
  for (const m of ["./market", "./auktion"]) {
    try { if (require(m).istHinterlegt(uid)) return true; } catch {}
  }
  return false;
}

/**
 * Offene Buchungen beim Start zu Ende bringen. Läuft, bevor jemand
 * verbunden ist. `zusatz[quelle]` kennt den Zustand außerhalb des Kontos:
 * { angewendet(e), anwenden(e), zurueck(e), speichern() }.
 */
function wiederaufnehmen({ accounts, cosmetics, praegung, zusatz = {} }) {
  const ergebnis = [];
  for (const e of Object.values(offen)) {
    const acc = accounts.get(e.key);
    const liste = acc && acc.cosOwned && acc.cosOwned[cosmetics.TOPF[e.art]];
    const kontoHat = Array.isArray(liste) && liste.includes(e.id);
    const z = zusatz[e.quelle] || null;
    try {
      if (e.richtung === "verkauf") {
        // Ein Verkauf ans Haus: steht er am Konto (Stück weg), ist er gültig,
        // und das Exemplar wird nachträglich gelöscht. Sonst ist nichts passiert.
        if (!kontoHat) {
          const st = praegung.stueckVon(e.key, e.art, e.id);
          if (st && !hinterlegt(st.uid)) praegung.entpraegen(st.uid);
        }
        ergebnis.push({ bid: e.bid, ausgang: kontoHat ? "zurueckgenommen" : "abgeschlossen" });
        delete offen[e.bid];
        continue;
      }
      if (kontoHat) {
        // Das Konto hat bezahlt und das Stück: den Rest nachziehen.
        if (cosmetics.praegbar(e.art, e.id) && !praegung.stueckVon(e.key, e.art, e.id)) praegung.praegen(e.art, e.id, e.key, acc.name);
        if (z && !z.angewendet(e)) { z.anwenden(e); z.speichern(); }
        ergebnis.push({ bid: e.bid, ausgang: "abgeschlossen" });
      } else {
        // Das Konto hat nichts davon: alles andere zurück, auch Exemplare
        // einer Kollektions-Belohnung, die dieselbe Buchung mitgeprägt hat.
        const besitz = (acc && acc.cosOwned) || {};
        for (const st of Object.values(praegung.alleVon(e.key) || {})) {
          const hat = Array.isArray(besitz[cosmetics.TOPF[st.art]]) && besitz[cosmetics.TOPF[st.art]].includes(st.id);
          if (!hat && st.gepraegtAm >= e.ts && !hinterlegt(st.uid)) praegung.entpraegen(st.uid);
        }
        if (z && z.angewendet(e)) { z.zurueck(e); z.speichern(); }
        ergebnis.push({ bid: e.bid, ausgang: "zurueckgenommen" });
      }
      delete offen[e.bid];
    } catch (err) {
      console.error(`[buchungen] ${e.bid} ließ sich nicht wiederaufnehmen:`, err.message);
    }
  }
  if (ergebnis.length) {
    sichern();
    console.log("[buchungen] beim Start nachgezogen:", ergebnis.map((r) => `${r.bid} ${r.ausgang}`).join(", "));
  }
  return ergebnis;
}

module.exports = { buche, verkaufe, wiederaufnehmen, sicherSchreiben, schreiben, Abbruch, _pruefung: pruefung, _offen: () => offen };
