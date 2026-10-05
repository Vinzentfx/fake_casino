"use strict";

/**
 * Backup und Wiederherstellen des ganzen data/-Ordners.
 *
 * Sichern: alle flachen Dateien als Text, dazu die hochgeladenen Bilder als
 * base64. Vorher werden die Module, die gebündelt schreiben (Konten,
 * Chronik, Gala-Lose), auf die Platte gezwungen; sonst fehlten dem Backup ihre
 * letzten Sekunden. Halbfertige Kopien (*.tmp) bleiben draußen.
 *
 * Einspielen in ZWEI Schritten. Früher schrieb der Restore die Dateien
 * direkt nach data/ und beendete danach den Prozess. Dazwischen lief der
 * Server aber weiter: ein einziger Dreh, der in dieser Lücke das Konto
 * speichert, schrieb die alte accounts.json über die gerade eingespielte.
 * Jetzt landet das Backup erst in einem Wartebereich (`data/.wiederherstellung`),
 * mit einer Liste aller Dateien als letztem Schritt. Getauscht wird beim
 * nächsten Start, bevor irgendein Spielmodul seine Datei liest
 * (`ausstehendeEinspielen`, ganz oben in server.js). Was der alte Prozess
 * bis zu seinem Ende noch schreibt, ist damit egal.
 *
 * Fehlt die Liste, war das Schreiben unvollständig: der Wartebereich wird
 * verworfen und der alte Stand bleibt. Bricht der Tausch selbst ab, macht
 * der nächste Start da weiter, wo er aufgehört hat.
 *
 * Dieses Modul lädt beim Start keine anderen Spielmodule.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const pruefsumme = (inhalt) => crypto.createHash("sha256").update(inhalt).digest("hex");

const DATA_DIR = path.join(__dirname, "..", "data");
const WARTE = path.join(DATA_DIR, ".wiederherstellung");
const LISTE = "LISTE.json";
const PROTOKOLL = "moderation-audit.jsonl";
const NAME_OK = (n) => /^[\w.\-]+$/.test(n) && !n.includes("..") && n !== LISTE;

/** Das Backup als Objekt, so wie es der Admin-Knopf herunterlädt. */
function sichern() {
  /* Was gebündelt schreibt, muss vorher auf die Platte. Scheitert das, gibt
     es KEIN Backup: sonst sähe ein alter Dateistand aus wie ein frischer, und
     „erfolgreich“ hieße nicht mehr, dass der zugesagte Stand drinsteckt. */
  for (const m of ["./chronik", "./comeback"]) {
    let modul = null;
    try { modul = require(m); } catch { continue; }
    if (typeof modul.jetztSchreiben !== "function") continue;
    try { modul.jetztSchreiben(); } catch (e) { throw new Error(`${m.slice(2)} ließ sich vorher nicht speichern (${e.message})`); }
  }
  try { require("./accounts").saveJetzt(); } catch (e) { throw new Error(`Die Konten ließen sich vorher nicht speichern (${e.message})`); }
  const files = {};
  const binaer = {};
  for (const name of fs.readdirSync(DATA_DIR)) {
    const p = path.join(DATA_DIR, name);
    const st = fs.statSync(p);
    if (st.isFile()) {
      // Eine halb geschriebene Kopie aus einem Absturz gehört nicht ins Backup.
      if (name.endsWith(".tmp")) continue;
      files[name] = fs.readFileSync(p, "utf8");
      continue;
    }
    // Genau ein Unterordner ist vorgesehen; der Wartebereich gehört nicht dazu.
    if (!st.isDirectory() || name !== "bilder") continue;
    for (const datei of fs.readdirSync(p)) {
      const dp = path.join(p, datei);
      // Ein Bild, das sich nicht lesen lässt, macht das Backup unvollständig: lieber laut scheitern.
      if (fs.statSync(dp).isFile()) binaer[`bilder/${datei}`] = fs.readFileSync(dp).toString("base64");
    }
  }
  return { files, binaer };
}

/**
 * Ein Backup in den Wartebereich legen. Wirft bei einer kaputten Datei,
 * bevor irgendetwas geschrieben ist. Gibt die Zahl der Dateien zurück.
 */
/* Ist das ein echtes Kontenverzeichnis? Ein Objekt mit Konten darin, jedes
   mit Name und ganzzahligem Guthaben. Vorher reichte es, dass der Text
   JSON war: `null` ging als Kontodatei durch und wurde eingespielt. */
function kontenPruefen(text) {
  let k;
  try { k = JSON.parse(text); } catch (e) { return `accounts.json ist kein gültiges JSON (${e.message}).`; }
  if (!k || typeof k !== "object" || Array.isArray(k)) return "accounts.json enthält keine Konten.";
  const konten = Object.entries(k);
  if (!konten.length) return "accounts.json ist leer.";
  for (const [key, a] of konten) {
    if (!a || typeof a !== "object") return `Konto „${key}“ ist kein Konto.`;
    if (typeof a.name !== "string" || !a.name) return `Konto „${key}“ hat keinen Namen.`;
    if (!Number.isSafeInteger(a.chips) || a.chips < 0) return `Konto „${key}“ hat kein gültiges Guthaben.`;
  }
  return null;
}

/** Was ein Backup enthält, bevor man es einspielt: für die Rückfrage im Admin-Bildschirm. */
function vorschau(files) {
  const da = new Set(fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter((n) => n.endsWith(".json") && NAME_OK(n)) : []);
  const im = new Set(Object.keys(files || {}));
  let konten = 0;
  try { konten = Object.keys(JSON.parse(files["accounts.json"]) || {}).length; } catch {}
  return { konten, dateien: im.size, fehlen: [...da].filter((n) => !im.has(n)).sort() };
}

function einspielenVorbereiten(files, binaer, { erzwingen = false } = {}) {
  if (!files || typeof files !== "object" || typeof files["accounts.json"] !== "string") {
    throw Object.assign(new Error("Das ist kein Fake-Casino-Backup (accounts.json fehlt)."), { code: "KEIN_BACKUP" });
  }
  const kontoFehler = kontenPruefen(files["accounts.json"]);
  if (kontoFehler) throw Object.assign(new Error(`Das Backup ist unbrauchbar: ${kontoFehler}`), { code: "KEIN_BACKUP" });
  const namen = Object.keys(files).filter((n) => NAME_OK(n) && typeof files[n] === "string");
  for (const n of namen) {
    if (!n.endsWith(".json")) continue;
    let wert;
    try { wert = JSON.parse(files[n]); } catch (e) { throw Object.assign(new Error(`${n} ist beschädigt (${e.message}).`), { code: "KEIN_BACKUP" }); }
    if (wert === null || typeof wert !== "object") throw Object.assign(new Error(`${n} enthält keine Daten.`), { code: "KEIN_BACKUP" });
  }
  /* Ein Backup ersetzt den ganzen Stand: was es nicht kennt, wird gelöscht.
     Fehlen darin Dateien, die es jetzt gibt, ist das entweder ein altes
     Backup oder ein unvollständiges. Ohne ausdrückliche Bestätigung nicht. */
  const v = vorschau(files);
  if (v.fehlen.length && !erzwingen) {
    throw Object.assign(new Error(`Im Backup fehlen ${v.fehlen.length} Dateien, die es jetzt gibt: ${v.fehlen.join(", ")}. Beim Einspielen wären sie weg.`), { code: "UNVOLLSTAENDIG", fehlen: v.fehlen });
  }
  const bilder = [];
  if (binaer && typeof binaer === "object") {
    for (const [pfad, b64] of Object.entries(binaer)) {
      const m = /^bilder\/([\w.\-]+)$/.exec(String(pfad));
      if (m && !m[1].includes("..") && typeof b64 === "string") bilder.push([m[1], b64]);
    }
  }
  fs.rmSync(WARTE, { recursive: true, force: true });
  fs.mkdirSync(path.join(WARTE, "bilder"), { recursive: true });
  for (const n of namen) fs.writeFileSync(path.join(WARTE, n), files[n]);
  for (const [n, b64] of bilder) fs.writeFileSync(path.join(WARTE, "bilder", n), Buffer.from(b64, "base64"));
  /* Zuletzt die Liste, mit Größe und Prüfsumme je Datei: erst mit ihr gilt
     der Wartebereich als vollständig, und beim Tausch lässt sich damit
     prüfen, ob jede Datei wirklich die ist, die eingespielt werden soll. */
  const summen = {};
  for (const n of namen) summen[n] = pruefsumme(Buffer.from(files[n]));
  const bildSummen = {};
  for (const [n, b64] of bilder) bildSummen[n] = pruefsumme(Buffer.from(b64, "base64"));
  fs.writeFileSync(path.join(WARTE, LISTE), JSON.stringify({ dateien: namen, bilder: bilder.map(([n]) => n), summen, bildSummen, am: Date.now() }));
  return namen.length + bilder.length;
}

/**
 * Beim Start: einen vollständigen Wartebereich nach data/ tauschen. Läuft,
 * bevor ein Spielmodul seine Datei liest. Wiederholbar, falls der Tausch
 * selbst abbricht.
 */
function ausstehendeEinspielen() {
  if (!fs.existsSync(WARTE)) return null;
  let liste = null;
  try { liste = JSON.parse(fs.readFileSync(path.join(WARTE, LISTE), "utf8")); } catch {}
  if (!liste || !Array.isArray(liste.dateien) || !liste.dateien.includes("accounts.json")) {
    console.error("[datensicherung] Unvollständiges Backup im Wartebereich verworfen, der bisherige Stand bleibt.");
    fs.rmSync(WARTE, { recursive: true, force: true });
    return { verworfen: true };
  }
  /* Erst prüfen, dann ändern. Jede Datei der Liste muss entweder im
     Wartebereich liegen oder schon getauscht in data/ stehen, und zwar mit
     der Prüfsumme aus der Liste. Vorher galt eine fehlende Quelle einfach als
     „schon getauscht“, und die Löschungen liefen davor: ein beschädigter
     Wartebereich hinterließ einen halben Stand. Bei Unklarheit bleibt der
     alte Stand ganz, und der Wartebereich wird zur Seite gelegt. */
  const summen = liste.summen || null;
  const stimmt = (datei, soll) => {
    if (!soll) return fs.existsSync(datei);
    try { return pruefsumme(fs.readFileSync(datei)) === soll; } catch { return false; }
  };
  const unklar = [];
  for (const name of liste.dateien) {
    const soll = summen ? summen[name] : null;
    if (!stimmt(path.join(WARTE, name), soll) && !stimmt(path.join(DATA_DIR, name), soll)) unklar.push(name);
  }
  for (const name of liste.bilder || []) {
    const soll = liste.bildSummen ? liste.bildSummen[name] : null;
    if (!stimmt(path.join(WARTE, "bilder", name), soll) && !stimmt(path.join(DATA_DIR, "bilder", name), soll)) unklar.push(`bilder/${name}`);
  }
  if (unklar.length) {
    const beiseite = `${WARTE}-unklar-${Date.now()}`;
    console.error(`[datensicherung] Wartebereich passt nicht zur Liste (${unklar.slice(0, 5).join(", ")}${unklar.length > 5 ? " …" : ""}). Der bisherige Stand bleibt, der Wartebereich liegt in ${path.basename(beiseite)}.`);
    try { fs.renameSync(WARTE, beiseite); } catch { fs.rmSync(WARTE, { recursive: true, force: true }); }
    return { verworfen: true, unklar };
  }
  const soll = new Set(liste.dateien);
  // Ein Schnappschuss, kein Zusammenmischen: was das Backup nicht kennt, geht.
  // Das neue Moderationsprotokoll darf ein altes Backup nie zurückdrehen.
  for (const name of fs.readdirSync(DATA_DIR)) {
    const p = path.join(DATA_DIR, name);
    if (name !== PROTOKOLL && !soll.has(name) && fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
  let getauscht = 0;
  for (const name of liste.dateien) {
    const von = path.join(WARTE, name);
    if (!fs.existsSync(von)) continue;   // schon getauscht, der Start davor brach ab
    if (name === PROTOKOLL && fs.existsSync(path.join(DATA_DIR, name))) { fs.unlinkSync(von); continue; }
    fs.renameSync(von, path.join(DATA_DIR, name));
    getauscht++;
  }
  // Bilder: genau die aus dem Backup, ältere Backups ohne Bilder leeren den Ordner.
  const bilderZiel = path.join(DATA_DIR, "bilder");
  const bilderWarte = path.join(WARTE, "bilder");
  const bilderSoll = new Set(liste.bilder || []);
  fs.mkdirSync(bilderZiel, { recursive: true });
  for (const name of fs.readdirSync(bilderZiel)) {
    const p = path.join(bilderZiel, name);
    if (!bilderSoll.has(name) && fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
  for (const name of bilderSoll) {
    const von = path.join(bilderWarte, name);
    if (fs.existsSync(von)) { fs.renameSync(von, path.join(bilderZiel, name)); getauscht++; }
  }
  fs.rmSync(WARTE, { recursive: true, force: true });
  console.log(`[datensicherung] Backup eingespielt: ${getauscht} Dateien.`);
  return { getauscht };
}

module.exports = { sichern, einspielenVorbereiten, ausstehendeEinspielen, vorschau, WARTE };
