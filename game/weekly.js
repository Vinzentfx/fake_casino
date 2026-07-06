"use strict";

/**
 * Weekly cycle: "Spieler der Woche" + Goldene Straße.
 *
 * Every account accumulates weeklyNet (net chips won/lost, all games) via
 * accounts.recordHand. At the week rollover the player with the highest
 * positive net wins the Wochen-Pokal: a chip prize, a chat announcement and
 * the 🏆 crown next to their name in every leaderboard for the whole next
 * week. Then all weeklyNet counters reset and a new GOLDEN STREET is rolled
 * (that street pays double tribute — fight for it).
 *
 * State in data/weekly.json; tick() is called every minute from economy.js.
 */

const path = require("path");
const fs = require("fs");
const city = require("./city");
const chat = require("./chat");
const clans = require("./clans");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "weekly.json");

const PRIZE = 100000; // Wochen-Pokal prize

// Epoch week number (rolls over Monday 00:00 UTC — good enough for friends).
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

/** Normalized key of the reigning Spieler der Woche (or null). */
function champName() {
  return state.lastWinner ? state.lastWinner.key : null;
}
function lastWinner() {
  return state.lastWinner;
}

/** Advance the week: crown the winner, reset nets, roll the golden street. */
function rollover(io, accounts) {
  // Winner of the ENDING week: highest positive weekly net.
  let winner = null;
  for (const a of accounts.rawAll()) {
    if ((a.weeklyNet || 0) > 0 && (!winner || a.weeklyNet > winner.weeklyNet)) winner = a;
  }
  if (winner) {
    const key = String(winner.name).trim().toLowerCase();
    state.lastWinner = { key, name: winner.name, net: Math.round(winner.weeklyNet) };
    accounts.adjustChips(key, PRIZE);
    chat.announce(io, `🏆 SPIELER DER WOCHE: ${winner.name} mit +${Math.round(winner.weeklyNet).toLocaleString("de-DE")} 🪙 Netto — Preis: ${PRIZE.toLocaleString("de-DE")} 🪙! Die Krone glänzt eine Woche im Leaderboard.`);
  } else {
    state.lastWinner = null;
  }
  for (const a of accounts.rawAll()) a.weeklyNet = 0;
  accounts.save();

  const g = city.rollGoldenStreet();
  if (g) chat.announce(io, `✨ NEUE GOLDENE STRASSE: ${g.st} in ${g.districtName} zahlt diese Woche DOPPELTEN Tribut — holt sie euch!`);

  // Clan der Woche: crown the top clan by weekly PvP-duel wins, then reset.
  try { clans.weeklyRollover(io); } catch (e) { console.error("clan weekly rollover:", e.message); }

  state.week = weekNow();
  save();
  io.emit("city:update");
}

/** Called every minute; fires the rollover when the week changes. Also seeds
 *  the very first golden street if none exists yet. */
function tick(io, accounts) {
  if (!city.goldenStreet()) {
    const g = city.rollGoldenStreet();
    if (g) chat.announce(io, `✨ GOLDENE STRASSE: ${g.st} in ${g.districtName} zahlt diese Woche DOPPELTEN Tribut!`);
  }
  try { clans.tickWars(io); } catch (e) { console.error("clan war tick:", e.message); }
  if (weekNow() !== state.week) rollover(io, accounts);
}

/** Admin/testing: force the weekly rollover right now. */
function forceRollover(io, accounts) {
  rollover(io, accounts);
}

module.exports = { tick, rollover, forceRollover, champName, lastWinner, PRIZE };
