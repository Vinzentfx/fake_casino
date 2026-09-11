"use strict";

/**
 * Chronik: was passiert ist, waehrend niemand hingesehen hat.
 *
 * Der Live-Feed (game/feed.js) haelt dreissig Eintraege im Speicher und ist
 * nach jedem Deploy leer. Genau das, was ein Tagesbericht braucht, ist damit
 * weg: die Tage, an denen man selbst nicht da war. Hier stehen dieselben
 * Momente auf der Platte, mit Zeitstempel.
 *
 * Bewusst kein zweites Anzeigesystem: die Chronik zeigt nichts an, sie hebt
 * nur auf. Gelesen wird sie ausschliesslich vom Tagesbericht
 * (game/bericht.js).
 *
 * Stand in data/chronik.json.
 */

const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "chronik.json");

/* Ein Eintrag ist winzig, aber 70 Spieler erzeugen viele. Zwei Wochen sind
   mehr als jeder Bericht je braucht (der laengste sinnvolle Zeitraum ist
   "seit letztem Besuch") und halten die Datei unter 100 KB. */
const MAX = 600;
const ALTER_MS = 14 * 86400000;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && Array.isArray(raw.items)) return { items: raw.items };
  } catch {}
  return { items: [] };
}

let state = load();
let schreibZeit = null;

/* Gesammelt schreiben. Ein Renntag setzt ein Dutzend Eintraege in wenigen
   Sekunden ab; jeder einzeln waere ein eigener Dateischreibvorgang. */
function save() {
  if (schreibZeit) return;
  schreibZeit = setTimeout(() => {
    schreibZeit = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ v: 1, items: state.items }));
    } catch {}
  }, 1500);
  if (schreibZeit.unref) schreibZeit.unref();
}

function aufraeumen() {
  const grenze = Date.now() - ALTER_MS;
  let weg = 0;
  while (state.items.length && state.items[state.items.length - 1].ts < grenze) {
    state.items.pop();
    weg++;
  }
  if (state.items.length > MAX) { weg += state.items.length - MAX; state.items.length = MAX; }
  return weg;
}

/**
 * Einen Moment aufschreiben.
 *
 * `art` gruppiert im Bericht (rekord, stadt, woche, event, gewinn, season,
 * horses, level). `wert` ist optional und dient nur der Reihenfolge innerhalb
 * einer Gruppe: bei Gewinnen sollen die groessten oben stehen, nicht die
 * neuesten.
 */
function notiere(art, text, meta = {}) {
  const eintrag = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    art: String(art || "event"),
    text: String(text || "").slice(0, 200),
  };
  if (meta.user) eintrag.user = String(meta.user).slice(0, 24);
  if (Number.isFinite(Number(meta.wert))) eintrag.wert = Math.round(Number(meta.wert));
  state.items.unshift(eintrag);
  if (aufraeumen() === 0 && state.items.length > MAX) state.items.length = MAX;
  save();
  return eintrag;
}

/** Alles ab einem Zeitpunkt, neueste zuerst. */
function seit(ts) {
  const grenze = Number(ts) || 0;
  const out = [];
  for (const e of state.items) {
    if (e.ts <= grenze) break;   // die Liste ist absteigend sortiert
    out.push(e);
  }
  return out;
}

const anzahl = () => state.items.length;

module.exports = { notiere, seit, anzahl };
