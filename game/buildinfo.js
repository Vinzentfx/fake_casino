"use strict";

/**
 * Bau-Kennung der laufenden Instanz.
 *
 * Wird an zwei Stellen gebraucht:
 *   1. Update-Erkennung. Der Client vergleicht seine Kennung mit der des
 *      Servers und laedt neu, wenn sie auseinanderlaufen.
 *   2. Cache-Busting. Alle Skripte und Stylesheets bekommen sie als ?v=
 *      angehaengt, damit sie ein Jahr lang gecacht werden duerfen und beim
 *      naechsten Deploy trotzdem sicher neu geholt werden.
 *
 * Warum ein Fingerabdruck und nicht die Paketversion: die stand seit jeher
 * auf 0.1.0. Auf dem Server gibt es keine RAILWAY_GIT_COMMIT_SHA mehr, also
 * fiel APP_VERSION auf diese Konstante zurueck und aenderte sich bei keinem
 * Deploy. Die Update-Aufforderung konnte deshalb nie ausloesen: wer den Tab
 * offen hatte, spielte mit altem Frontend gegen einen neuen Server weiter.
 *
 * Der Fingerabdruck kommt aus Pfad, Groesse und Aenderungszeit aller
 * ausgelieferten Dateien. Er aendert sich zwangslaeufig bei jedem Deploy und
 * braucht weder git noch einen Build-Schritt.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const WATCHED = ["public", "game", "server.js"];
const SKIP = new Set([".DS_Store"]);

function walk(target, out) {
  let stat;
  try { stat = fs.statSync(target); } catch { return; }
  if (stat.isDirectory()) {
    let entries;
    try { entries = fs.readdirSync(target).sort(); } catch { return; }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      walk(path.join(target, name), out);
    }
    return;
  }
  out.push(`${path.relative(ROOT, target)}:${stat.size}:${stat.mtimeMs}`);
}

function fingerprint() {
  const parts = [];
  for (const w of WATCHED) walk(path.join(ROOT, w), parts);
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);
}

/** Commit-Kuerzel, falls das Verzeichnis ein git-Klon ist. Nur fuer Logs. */
function gitShort() {
  try {
    const head = fs.readFileSync(path.join(ROOT, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5) : null;
    const sha = ref
      ? fs.readFileSync(path.join(ROOT, ".git", ref), "utf8").trim()
      : head;
    return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : null;
  } catch {
    return null;
  }
}

// Einmal beim Start berechnet. Ein Deploy startet den Dienst neu, damit ist
// der Wert immer aktuell, ohne dass im Betrieb das Dateisystem abgelaufen wird.
const VERSION = process.env.APP_VERSION || fingerprint();
const GIT = gitShort();

module.exports = { VERSION, GIT };
