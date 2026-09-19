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
 *
 * TESTZUGANG. Dazu kommt eine Namensliste: wer daraufsteht, darf auch bei
 * geschlossenem Haus rein. Das ist der Grund, warum es das ueberhaupt gibt —
 * ein Update will man mit drei, vier Leuten ausprobieren, bevor siebzig
 * darauf treffen, und die Alternative waere, das Haus offen zu lassen und
 * zu hoffen. Die Liste ueberlebt den Neustart wie der Rest.
 *
 * Gespeichert wird der normalisierte Name, nicht der Schluessel: hier wird
 * jemand eingetragen, bevor er verbunden ist, und der Schluessel steht erst
 * danach fest. Die Pruefung vergleicht kleingeschrieben, damit "Ben" und
 * "ben" dieselbe Person sind.
 */

const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "data", "wartung.json");

const STANDARD = "Das Casino ist gerade kurz zu. Wir sind gleich wieder da.";

const norm = (n) => String(n || "").trim().toLowerCase();

let zustand = { an: false, text: STANDARD, seit: 0, zugang: [] };
try {
  const roh = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (roh && typeof roh === "object") {
    zustand = {
      an: !!roh.an,
      text: String(roh.text || STANDARD).slice(0, 200),
      seit: Number(roh.seit) || 0,
      zugang: Array.isArray(roh.zugang) ? roh.zugang.map(norm).filter(Boolean) : [],
    };
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
    /* Die Testliste bleibt stehen. Wer sie beim Aufmachen loeschen wuerde,
       muesste sie beim naechsten Update neu tippen — und genau dann hat
       man es eilig. */
    zugang: zustand.zugang || [],
  };
  save();
  return { ok: true, ...state() };
}

/** Jemanden auf die Testliste setzen. */
function erlaube(name) {
  const n = norm(name);
  if (!n) return { ok: false, error: "Kein Name." };
  if (zustand.zugang.includes(n)) return { ok: false, error: "Steht schon drauf." };
  if (zustand.zugang.length >= 20) return { ok: false, error: "Höchstens 20 auf der Testliste." };
  zustand.zugang.push(n);
  save();
  return { ok: true, ...state() };
}

/** Wieder herunternehmen. */
function verbiete(name) {
  const n = norm(name);
  const i = zustand.zugang.indexOf(n);
  if (i < 0) return { ok: false, error: "Steht nicht drauf." };
  zustand.zugang.splice(i, 1);
  save();
  return { ok: true, ...state() };
}

/** Testliste leeren. */
function leere() {
  zustand.zugang = [];
  save();
  return { ok: true, ...state() };
}

/** Steht dieser Name auf der Testliste? */
const hatZugang = (name) => zustand.zugang.includes(norm(name));

/** Darf dieser Kontoname gerade rein? */
function darfRein(key, owner) {
  if (!an()) return true;
  if (norm(key) === norm(owner)) return true;
  return hatZugang(key);
}

module.exports = { an, text, state, setze, darfRein, erlaube, verbiete, leere, hatZugang, STANDARD };
