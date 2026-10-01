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

const DATA_DIR = path.join(__dirname, "..", "data");
const WARTE = path.join(DATA_DIR, ".wiederherstellung");
const LISTE = "LISTE.json";
const PROTOKOLL = "moderation-audit.jsonl";
const NAME_OK = (n) => /^[\w.\-]+$/.test(n) && !n.includes("..") && n !== LISTE;

/** Das Backup als Objekt, so wie es der Admin-Knopf herunterlädt. */
function sichern() {
  for (const m of ["./chronik", "./comeback"]) {
    try { require(m).jetztSchreiben(); } catch {}
  }
  // Die Konten speichern gebündelt; was noch aussteht, gehört ins Backup.
  try { require("./accounts").saveJetzt(); } catch {}
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
      try {
        if (fs.statSync(dp).isFile()) binaer[`bilder/${datei}`] = fs.readFileSync(dp).toString("base64");
      } catch {}
    }
  }
  return { files, binaer };
}

/**
 * Ein Backup in den Wartebereich legen. Wirft bei einer kaputten Datei,
 * bevor irgendetwas geschrieben ist. Gibt die Zahl der Dateien zurück.
 */
function einspielenVorbereiten(files, binaer) {
  if (!files || typeof files !== "object" || typeof files["accounts.json"] !== "string") {
    throw Object.assign(new Error("Das ist kein Fake-Casino-Backup (accounts.json fehlt)."), { code: "KEIN_BACKUP" });
  }
  const namen = Object.keys(files).filter((n) => NAME_OK(n) && typeof files[n] === "string");
  for (const n of namen) if (n.endsWith(".json")) JSON.parse(files[n]);
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
  // Zuletzt die Liste: erst mit ihr gilt der Wartebereich als vollständig.
  fs.writeFileSync(path.join(WARTE, LISTE), JSON.stringify({ dateien: namen, bilder: bilder.map(([n]) => n), am: Date.now() }));
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

module.exports = { sichern, einspielenVorbereiten, ausstehendeEinspielen, WARTE };
