"use strict";

/**
 * Wortfilter fuer alles, was Spieler eintippen und andere lesen.
 *
 * Zwei Anwendungen mit verschiedener Haerte:
 *
 *   ENTSCHAERFEN  Chat. Die Nachricht geht durch, das Wort wird zu ***.
 *                 Eine geloeschte Nachricht erzeugt Nachfragen, eine
 *                 maskierte erklaert sich selbst.
 *
 *   ABLEHNEN      Namen, Mottos, Pferdenamen, Tischnamen. Was dauerhaft
 *                 irgendwo steht, soll gar nicht erst entstehen.
 *
 * ---------------------------------------------------------------------------
 * Die zwei Probleme, an denen solche Filter scheitern
 *
 * UMGEHUNG. "Sch3iße", "S c h e i ß e", "Scheeeiße", "$cheiße": wer will,
 * kommt an einer naiven Wortliste vorbei. Dagegen wird der Text vor der
 * Pruefung normalisiert: Ziffern und Zeichen, die wie Buchstaben aussehen,
 * werden zurueckuebersetzt, lange Wiederholungen gekuerzt.
 *
 * FEHLALARM. Wer nur nach Teilzeichenketten sucht, verbietet irgendwann
 * "Fickmuehle" (ein Brettspiel) oder "Sextett". Deshalb zwei Durchgaenge:
 *
 *   1. An Wortgrenzen, auf dem normal geschriebenen Text. Findet die
 *      normale Verwendung und trifft nichts Harmloses.
 *   2. Verdichtet (alles ausser Buchstaben faellt weg) aber nur mit den
 *      Woertern aus HART, die auch mitten in einem Wort nie harmlos sind.
 *      Das faengt "s c h e i ß e" und "f.i.c.k", ohne "Sextett" zu treffen.
 *
 * Was in eurer Runde als schlimm gilt, entscheidet ihr: die Basisliste
 * unten laesst sich im Admin-Bereich um eigene Woerter und um Ausnahmen
 * ergaenzen (data/wortfilter.json).
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "wortfilter.json");

/* ---------------------------------------------------------------------------
   Basisliste.

   Bewusst kurz gehalten und auf das Grobe beschraenkt: Beleidigungen,
   Herabwuerdigungen, Sexuelles. Eine ausufernde Liste erzeugt vor allem
   Fehlalarme, und in einer Runde von Freunden ist ein rauer Ton nicht das
   Problem: ein Name in der Bestenliste, den man niemandem zeigen mag,
   schon.
--------------------------------------------------------------------------- */

// Wird an Wortgrenzen geprueft. Beugungen deckt die Endungs-Regel unten ab.
const BASIS = [
  // Beleidigungen
  "arschloch", "wichser", "hurensohn", "missgeburt", "spast", "spasti",
  "mongo", "behindert", "krüppel", "kruppel", "vollidiot", "trottel",
  "schlampe", "nutte", "fotze", "bastard", "wixer", "wixxer",
  // Sexuelles
  "ficken", "fick", "ficker", "gefickt", "blasen", "schwanz", "muschi",
  "titten", "porno", "penis", "vagina", "onanieren", "wichsen",
  // Fäkal
  "scheiße", "scheisse", "kacke", "kotze", "pisse", "arsch",
  // Herabwürdigend
  "schwuchtel", "transe", "zigeuner", "neger", "nigger", "kanake",
  "judensau", "untermensch",
  // Englisch, weil im Netz gross geworden
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bitch", "asshole",
  "cunt", "dick", "pussy", "whore", "slut", "faggot", "retard", "nigga",
  // Gewalt/Extremismus
  "hitler", "nazi", "heilhitler", "hakenkreuz", "sieg heil", "sieghell",
];

/* Woerter, die auch verdichtet und mitten im Text nie harmlos sind. Nur
   diese gehen in den zweiten Durchgang, deshalb ist die Liste kurz und
   enthaelt nichts, was Teil eines normalen Wortes sein koennte. */
const HART = [
  "hurensohn", "arschloch", "wichser", "wixxer", "hitler", "nigger", "nigga",
  "fotze", "schwuchtel", "judensau", "hakenkreuz", "motherfucker", "faggot",
  "missgeburt", "heilhitler",
];

/* Ausnahmen. Erwischt der Filter eines dieser Woerter, ist es kein Treffer.
   Steht hier, weil "Fickmuehle" ein Brettspiel ist und "Arschbombe" ein
   Sprung ins Wasser, beides wuerde man nicht sperren wollen. */
const AUSNAHMEN_BASIS = [
  "fickmühle", "fickmuehle", "arschbombe", "sextett", "sexta", "dickicht",
  "dickmilch", "schwanzflosse", "blasenentzündung", "blasmusik", "blasrohr",
  "kackerlake", "kakerlake", "assel", "passiv", "klassenfahrt",
];

let eigene = { woerter: [], ausnahmen: [] };
try {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (raw && typeof raw === "object") {
    eigene.woerter = Array.isArray(raw.woerter) ? raw.woerter : [];
    eigene.ausnahmen = Array.isArray(raw.ausnahmen) ? raw.ausnahmen : [];
  }
} catch { /* Datei gibt es beim ersten Start noch nicht. */ }

function speichern() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(eigene, null, 2));
  } catch {}
}

/* ---------------------------------------------------------------------------
   Normalisierung
--------------------------------------------------------------------------- */

// Was wie ein Buchstabe aussieht, aber keiner ist.
const ERSATZ = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e", "£": "l",
  "á": "a", "à": "a", "---": "a", "ã": "a", "å": "a",
  "é": "e", "è": "e", "ê": "e", "ë": "e",
  "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ó": "o", "ò": "o", "ô": "o", "õ": "o",
  "ú": "u", "ù": "u", "û": "u",
  "ç": "c", "ñ": "n",
};

/**
 * Text vereinheitlichen und dabei merken, wo jedes Zeichen herkam.
 *
 * Das Mitfuehren der Herkunft ist der Grund, warum das hier keine drei
 * Zeilen sind: nur so laesst sich im Chat genau die Stelle maskieren, die
 * den Treffer ausgeloest hat, und nicht der halbe Satz.
 *
 * @returns {{text: string, herkunft: number[]}}
 */
function normalisiere(roh) {
  const s = String(roh || "").toLowerCase();
  let text = "";
  const herkunft = [];
  let letzter = "";
  let wdh = 0;

  for (let i = 0; i < s.length; i++) {
    let z = s[i];
    z = ERSATZ[z] || z;
    // ß und ss sind fuer den Filter dasselbe Wort.
    if (z === "ß") z = "s";

    if (z === letzter) {
      wdh++;
      // Bis zu zwei gleiche bleiben ("Schiff"), ab dem dritten wird gekuerzt.
      if (wdh >= 2) { continue; }
    } else {
      wdh = 0;
    }
    letzter = z;
    text += z;
    herkunft.push(i);
  }
  return { text, herkunft };
}

/**
 * Nur Buchstaben. Fuer den zweiten Durchgang gegen "s c h e i ß e".
 *
 * @param {boolean} [einfach] Zusaetzlich jede Wiederholung auf einen
 *   Buchstaben kuerzen. `normalisiere` laesst zwei stehen, weil "Schiff"
 *   sonst zu "Schif" wuerde, hier stoert das nicht, denn geprueft wird nur
 *   gegen die eindeutigen Woerter, und "arschlooooch" soll greifen.
 */
function verdichte(roh, einfach) {
  const { text, herkunft } = normalisiere(roh);
  let dicht = "";
  const dichtHerkunft = [];
  for (let i = 0; i < text.length; i++) {
    if (!/[a-zäöü]/.test(text[i])) continue;
    if (einfach && dicht && dicht[dicht.length - 1] === text[i]) continue;
    dicht += text[i];
    dichtHerkunft.push(herkunft[i]);
  }
  return { text: dicht, herkunft: dichtHerkunft };
}

const alleWoerter = () => [...BASIS, ...eigene.woerter.map((w) => String(w).toLowerCase())];
const alleAusnahmen = () => [...AUSNAHMEN_BASIS, ...eigene.ausnahmen.map((w) => String(w).toLowerCase())];

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Alle Treffer in einem Text.
 *
 * @returns {Array<{wort: string, von: number, bis: number}>} Stellen im
 *   ORIGINALTEXT, damit der Aufrufer genau dort maskieren kann.
 */
function treffer(roh) {
  const original = String(roh || "");
  if (!original.trim()) return [];

  const ausnahmen = alleAusnahmen();
  const nDicht = verdichte(original, true).text;
  // Steht eine Ausnahme im Text, ist der Treffer, der in ihr steckt, keiner.
  const ausnahmeStellen = [];
  for (const a of ausnahmen) {
    const na = verdichte(a, true).text;
    if (!na) continue;
    let ab = 0, idx;
    while ((idx = nDicht.indexOf(na, ab)) !== -1) {
      ausnahmeStellen.push([idx, idx + na.length]);
      ab = idx + 1;
    }
  }
  const inAusnahme = (von, bis) =>
    ausnahmeStellen.some(([a, b]) => von >= a && bis <= b);

  const gefunden = new Map();   // "von:bis" -> Treffer

  // --- Durchgang 1: an Wortgrenzen ---
  const { text: nText, herkunft } = normalisiere(original);
  for (const w of alleWoerter()) {
    const nw = normalisiere(w).text;
    if (!nw) continue;
    /* Endungen mitnehmen: aus "arschloch" wird auch "arschloecher",
       aus "fick" auch "fickst". Vorne bleibt die Wortgrenze hart, sonst
       traefe "fick" jedes Wort, das darauf endet. */
    const re = new RegExp("\\b" + escapeRe(nw) + "[a-zäöü]{0,4}\\b", "gi");
    let m;
    while ((m = re.exec(nText)) !== null) {
      const dVon = m.index, dBis = m.index + m[0].length;
      const dichtVon = verdichte(nText.slice(0, dVon), true).text.length;
      const dichtBis = dichtVon + verdichte(m[0], true).text.length;
      if (inAusnahme(dichtVon, dichtBis)) continue;
      const von = herkunft[dVon];
      const bis = (herkunft[dBis - 1] ?? von) + 1;
      gefunden.set(`${von}:${bis}`, { wort: w, von, bis });
    }
  }

  // --- Durchgang 2: verdichtet, nur die eindeutigen ---
  const { text: dText, herkunft: dHerkunft } = verdichte(original, true);
  const harte = [...HART, ...eigene.woerter.filter((w) => String(w).length >= 6).map((w) => String(w).toLowerCase())];
  for (const w of harte) {
    const nw = verdichte(w, true).text;
    if (!nw || nw.length < 4) continue;
    let ab = 0, idx;
    while ((idx = dText.indexOf(nw, ab)) !== -1) {
      ab = idx + 1;
      if (inAusnahme(idx, idx + nw.length)) continue;
      const von = dHerkunft[idx];
      const bis = (dHerkunft[idx + nw.length - 1] ?? von) + 1;
      gefunden.set(`${von}:${bis}`, { wort: w, von, bis });
    }
  }

  return [...gefunden.values()].sort((a, b) => a.von - b.von);
}

/** Enthaelt der Text etwas aus der Liste? */
function istSauber(roh) {
  return treffer(roh).length === 0;
}

/**
 * Fuer Namen und alles, was dauerhaft stehenbleibt.
 * @returns {{ok: boolean, error?: string, woerter?: string[]}}
 */
function pruefe(roh, was = "Der Text") {
  const t = treffer(roh);
  if (!t.length) return { ok: true };
  return {
    ok: false,
    error: `${was} enthält ein Wort, das hier nicht erwünscht ist.`,
    woerter: [...new Set(t.map((x) => x.wort))],
  };
}

/**
 * Fuer den Chat: die Stelle wird maskiert, der Rest bleibt.
 *
 * Der erste Buchstabe bleibt stehen. Das reicht, damit die Nachricht
 * lesbar bleibt ("du a****" statt "du *****"), und macht sichtbar, dass
 * hier gefiltert wurde und nicht der Absender genuschelt hat.
 */
function entschaerfe(roh) {
  const original = String(roh || "");
  const t = treffer(original);
  if (!t.length) return { text: original, gefiltert: false };

  let out = "";
  let pos = 0;
  for (const { von, bis } of t) {
    if (von < pos) continue;             // Ueberlappung: die erste gewinnt
    out += original.slice(pos, von);
    const stueck = original.slice(von, bis);
    out += stueck[0] + "*".repeat(Math.max(1, stueck.length - 1));
    pos = bis;
  }
  out += original.slice(pos);
  return { text: out, gefiltert: true };
}

/* ---------------------------------------------------------------------------
   Pflege der eigenen Liste
--------------------------------------------------------------------------- */

const saeubereEintrag = (w) => String(w || "").trim().toLowerCase().slice(0, 40);

function listeState() {
  return {
    eigene: [...eigene.woerter],
    ausnahmen: [...eigene.ausnahmen],
    basisAnzahl: BASIS.length,
  };
}

function ergaenze(wort) {
  const w = saeubereEintrag(wort);
  if (!w || w.length < 2) return { ok: false, error: "Mindestens zwei Zeichen." };
  if (BASIS.includes(w) || eigene.woerter.includes(w)) return { ok: false, error: "Steht schon auf der Liste." };
  eigene.woerter.push(w);
  speichern();
  return { ok: true, ...listeState() };
}

function entferne(wort) {
  const w = saeubereEintrag(wort);
  const i = eigene.woerter.indexOf(w);
  if (i === -1) return { ok: false, error: "Steht nicht auf deiner Liste. Wörter der Basisliste lassen sich über eine Ausnahme entschärfen." };
  eigene.woerter.splice(i, 1);
  speichern();
  return { ok: true, ...listeState() };
}

function ergaenzeAusnahme(wort) {
  const w = saeubereEintrag(wort);
  if (!w || w.length < 3) return { ok: false, error: "Mindestens drei Zeichen." };
  if (eigene.ausnahmen.includes(w)) return { ok: false, error: "Steht schon als Ausnahme." };
  eigene.ausnahmen.push(w);
  speichern();
  return { ok: true, ...listeState() };
}

function entferneAusnahme(wort) {
  const w = saeubereEintrag(wort);
  const i = eigene.ausnahmen.indexOf(w);
  if (i === -1) return { ok: false, error: "Steht nicht auf deiner Ausnahmeliste." };
  eigene.ausnahmen.splice(i, 1);
  speichern();
  return { ok: true, ...listeState() };
}

module.exports = {
  treffer, istSauber, pruefe, entschaerfe,
  listeState, ergaenze, entferne, ergaenzeAusnahme, entferneAusnahme,
};
