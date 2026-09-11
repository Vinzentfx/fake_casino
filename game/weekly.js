"use strict";

/**
 * Die Woche: "Spieler der Woche" und Goldene Straße.
 *
 * Jedes Konto sammelt über accounts.recordHand ein weeklyNet (Netto über alle
 * Spiele). Beim Wochenwechsel gewinnt, wer das höchste positive Netto hat, den
 * Wochen-Pokal: Chips, eine Ansage im Chat und eine Woche lang die Krone neben
 * dem Namen in allen Bestenlisten. Danach gehen alle Zähler auf null und eine
 * neue GOLDENE STRASSE wird gezogen (die zahlt doppelten Tribut).
 *
 * Stand in data/weekly.json, tick() ruft economy.js jede Minute auf.
 */

const path = require("path");
const fs = require("fs");
const city = require("./city");
const chat = require("./chat");
const clans = require("./clans");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "weekly.json");

const PRIZE = 100000; // Wochen-Pokal prize

// Wochennummer seit 1970 (wechselt Montag 00:00 UTC, reicht für uns).
const weekNow = () => Math.floor((Date.now() / 86400000 + 3) / 7);

let state = load();

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s.week === "number") return s;
  } catch {}
  return { week: weekNow(), lastWinner: null };
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}

/** Schlüssel des aktuellen Spielers der Woche (oder null). */
function champName() {
  return state.lastWinner ? state.lastWinner.key : null;
}
function lastWinner() {
  return state.lastWinner;
}

/** Woche weiterschalten: Sieger krönen, Zähler zurücksetzen, neue Goldene Straße. */
function rollover(io, accounts) {
  // Sieger der Woche, die gerade endet: das höchste positive Netto.
  let winner = null;
  for (const a of accounts.rawAll()) {
    if ((a.weeklyNet || 0) > 0 && (!winner || a.weeklyNet > winner.weeklyNet)) winner = a;
  }
  if (winner) {
    const key = String(winner.name).trim().toLowerCase();
    state.lastWinner = { key, name: winner.name, net: Math.round(winner.weeklyNet) };
    accounts.adjustChips(key, PRIZE);
    chat.announce(io, `Spieler der Woche ist ${winner.name} mit +${Math.round(winner.weeklyNet).toLocaleString("de-DE")} Chips. Dafür gibt es ${PRIZE.toLocaleString("de-DE")} Chips und eine Woche lang die Krone in der Bestenliste.`);
    try {
      require("./chronik").notiere("woche", `Spieler der Woche: ${winner.name} mit +${Math.round(winner.weeklyNet).toLocaleString("de-DE")} Chips netto.`, { user: winner.name });
    } catch {}
  } else {
    state.lastWinner = null;
  }
  for (const a of accounts.rawAll()) a.weeklyNet = 0;
  accounts.save();

  const g = city.rollGoldenStreet();
  if (g) {
    chat.announce(io, `Neue Goldene Straße: ${g.st} in ${g.districtName} zahlt diese Woche doppelten Tribut.`);
    try { require("./chronik").notiere("woche", `Neue Goldene Straße: ${g.st} in ${g.districtName} zahlt doppelten Tribut.`); } catch {}
  }

  // Clan der Woche: den besten Clan der Woche krönen, dann zurücksetzen.
  try { clans.weeklyRollover(io); } catch (e) { console.error("clan weekly rollover:", e.message); }

  state.week = weekNow();
  save();
  io.emit("city:update");
}

/** Läuft jede Minute und schaltet die Woche weiter, wenn sie gewechselt hat.
 *  Legt außerdem die allererste Goldene Straße an, falls es noch keine gibt. */
function tick(io, accounts) {
  if (!city.goldenStreet()) {
    const g = city.rollGoldenStreet();
    if (g) chat.announce(io, `Goldene Straße: ${g.st} in ${g.districtName} zahlt diese Woche doppelten Tribut.`);
  }
  try { clans.tickWars(io); } catch (e) { console.error("clan war tick:", e.message); }
  if (weekNow() !== state.week) rollover(io, accounts);
}

/** Admin und Tests: Wochenwechsel sofort auslösen. */
function forceRollover(io, accounts) {
  rollover(io, accounts);
}

module.exports = { tick, rollover, forceRollover, champName, lastWinner, PRIZE };
