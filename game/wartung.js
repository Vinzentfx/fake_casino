"use strict";

/**
 * Wartungsmodus: das Haus zu, der Besitzer drin.
 *
 * Bisher gab es zwischen "laeuft" und "Server aus" nichts. Wer etwas an der
 * Wirtschaft richten, ein Backup einspielen oder eine kaputte Runde aufraeumen
 * wollte, machte das im laufenden Betrieb, waehrend siebzig Leute weiterspielen
 * und auf halb umgestellte Zahlen treffen. Der Ausweg war, es nachts zu machen.
 *
 * Der Zustand liegt in data/wartung.json und uebersteht damit einen Neustart.
 * Das ist der ganze Sinn: der haeufigste Grund fuer eine Wartung ist ein
 * Update, und ein Update startet den Server neu. Waere der Zustand nur im
 * Speicher, ginge die Tuer genau in dem Moment wieder auf, in dem man sie
 * braucht.
 *
 * Wer drinnen ist, wird getrennt; der Besitzer kommt weiter rein.
 */

const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "data", "wartung.json");

const STANDARD = "Das Casino ist gerade kurz zu. Wir sind gleich wieder da.";

let zustand = { an: false, text: STANDARD, seit: 0 };
try {
  const roh = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (roh && typeof roh === "object") {
    zustand = { an: !!roh.an, text: String(roh.text || STANDARD).slice(0, 200), seit: Number(roh.seit) || 0 };
  }
} catch {}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(zustand));
  } catch {}
}

const an = () => !!zustand.an;
const text = () => zustand.text || STANDARD;
const state = () => ({ ...zustand, standardText: STANDARD });

/**
 * Aufmachen oder zumachen.
 * @param {boolean} auf   true = Wartung an (Haus zu).
 * @param {string} grund  Was die Spieler zu sehen bekommen.
 */
function setze(auf, grund) {
  zustand = {
    an: !!auf,
    text: String(grund || "").trim().slice(0, 200) || STANDARD,
    seit: auf ? Date.now() : 0,
  };
  save();
  return { ok: true, ...state() };
}

/** Darf dieser Kontoname gerade rein? */
function darfRein(key, owner) {
  if (!an()) return true;
  return String(key || "").toLowerCase() === String(owner || "").toLowerCase();
}

module.exports = { an, text, state, setze, darfRein, STANDARD };
