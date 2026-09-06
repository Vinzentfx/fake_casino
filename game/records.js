"use strict";

/**
 * Wochenrekorde je Spiel.
 *
 * Das Grundproblem des Casinos ist nicht, dass zu wenig da waere, sondern dass
 * ALLES Soziale gleichzeitige Anwesenheit verlangt: Poker, die Roulette- und
 * Blackjack-Lobby, Pinco, saemtliche Duelle, Clan-Kriege. Gespielt wird aber in
 * Schueben, manchmal wochenlang gar nicht. Damit laeuft der ganze
 * Mehrspieler-Teil praktisch nie.
 *
 * Hier steht die Gegenmassnahme: man spielt gegeneinander, OHNE gleichzeitig da
 * zu sein. Jede Woche haelt jedes Spiel seinen besten Wert fest, mit Namen. Wer
 * reinkommt, sieht, was die anderen hinterlassen haben, und kann es schlagen.
 *
 * Bewusst NICHT gewertet wird der absolute Gewinn — sonst gewinnt immer, wer am
 * meisten setzt. Gewertet wird das VIELFACHE des Einsatzes. Damit hat jemand mit
 * 200 Chips dieselbe Chance auf den Wochenrekord wie jemand mit zwei Millionen,
 * und genau das haelt eine Freundesrunde zusammen.
 *
 * Stand in data/records.json.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "records.json");

/** Epochen-Woche, rollt Montag 00:00 UTC. Gleiche Formel wie in weekly.js. */
const weekNow = () => Math.floor((Date.now() / 86400000 + 3) / 7);

// Welche Spiele eine eigene Bestmarke fuehren, und wie sie heisst.
const SPIELE = {
  slots:     { label: "Slots",       icon: "🎰" },
  blackjack: { label: "Blackjack",   icon: "♠️" },
  roulette:  { label: "Roulette",    icon: "🎡" },
  crash:     { label: "Crash",       icon: "🚀" },
  mines:     { label: "Mines",       icon: "💣" },
  towers:    { label: "Towers",      icon: "🗼" },
  pinco:     { label: "Pinco Ball",  icon: "🟢" },
  horses:    { label: "Rennbahn",    icon: "🐎" },
  sportwetten: { label: "Sportwetten", icon: "⚽" },
};

// Unter diesem Vielfachen ist es kein Rekord, sondern ein normaler Treffer.
const MIN_FAKTOR = 2;
// Und unter diesem Einsatz zaehlt es nicht: sonst setzt jemand 1 Chip und
// gewinnt 500, was ein Vielfaches von 500 waere, aber nichts bedeutet.
const MIN_EINSATZ = 50;

let state = load();
let _io = null;
let _accounts = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.week === weekNow()) return raw;
    if (raw && typeof raw === "object") return { week: weekNow(), best: {}, letzteWoche: raw.best || {} };
  } catch {}
  return { week: weekNow(), best: {}, letzteWoche: {} };
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}

/** Wochenwechsel: die alten Bestmarken wandern ins Archiv, neu wird gezaehlt. */
function ensureWeek() {
  const wk = weekNow();
  if (state.week === wk) return;
  state.letzteWoche = state.best || {};
  state.best = {};
  state.week = wk;
  save();
}

/**
 * Eine Runde melden. `einsatz` und `gewinn` sind Brutto-Chips.
 * Gibt den neuen Rekord zurueck, wenn einer aufgestellt wurde, sonst null.
 */
function melde(key, spiel, einsatz, gewinn) {
  ensureWeek();
  if (!SPIELE[spiel]) return null;
  einsatz = Math.floor(Number(einsatz) || 0);
  gewinn = Math.floor(Number(gewinn) || 0);
  if (einsatz < MIN_EINSATZ || gewinn <= 0) return null;

  const faktor = gewinn / einsatz;
  if (faktor < MIN_FAKTOR) return null;

  const alt = state.best[spiel];
  if (alt && alt.faktor >= faktor) return null;

  const acc = _accounts && _accounts.get(key);
  state.best[spiel] = {
    key,
    name: acc ? acc.name : key,
    faktor: Math.round(faktor * 100) / 100,
    einsatz,
    gewinn,
    at: Date.now(),
  };
  save();

  // Nur ansagen, wenn jemand einen FREMDEN Rekord schlaegt. Wer seinen eigenen
  // verbessert, muss dafuer nicht den Chat vollschreiben.
  if (alt && alt.key !== key && _io) {
    try {
      chat.announce(_io, `🏅 ${state.best[spiel].name} schlägt ${alt.name} bei ${SPIELE[spiel].label}: ${state.best[spiel].faktor.toFixed(2)}× statt ${alt.faktor.toFixed(2)}×!`);
    } catch {}
    // Der alte Halter ist fast immer gerade NICHT da — das ist ja der Punkt.
    // Genau darum lohnt sich hier eine Nachricht aufs Geraet.
    try {
      require("./push").an(alt.key, "rekord", {
        title: `🏅 ${SPIELE[spiel].label}: Rekord weg`,
        body: `${state.best[spiel].name} hat deine ${alt.faktor.toFixed(2)}× mit ${state.best[spiel].faktor.toFixed(2)}× überboten.`,
        url: "/",
      });
    } catch {}
  }
  if (_io) _io.emit("records:update");
  return { spiel, ...state.best[spiel], vorher: alt || null };
}

/** Alles, was der Client zum Anzeigen braucht. */
function publicState(meinKey) {
  ensureWeek();
  const zeilen = Object.entries(SPIELE).map(([id, meta]) => {
    const b = state.best[id] || null;
    const v = (state.letzteWoche || {})[id] || null;
    return {
      spiel: id, label: meta.label, icon: meta.icon,
      best: b ? { name: b.name, faktor: b.faktor, einsatz: b.einsatz, gewinn: b.gewinn, at: b.at, meiner: b.key === meinKey } : null,
      vorwoche: v ? { name: v.name, faktor: v.faktor } : null,
    };
  });
  // Spiele mit Rekord zuerst, danach die offenen: die offenen sind die
  // Einladung ("hier steht noch nichts, hol ihn dir").
  zeilen.sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0) || (b.best?.faktor || 0) - (a.best?.faktor || 0));
  return { ok: true, week: state.week, zeilen, minFaktor: MIN_FAKTOR, minEinsatz: MIN_EINSATZ };
}

function setupRecords(io, accounts) {
  _io = io;
  _accounts = accounts;
  ensureWeek();

  // Jede abgerechnete Runde laeuft hier durch. Gewertet wird nur, was einen
  // Einsatz mitliefert: Freispiele und Runden ohne echten Einsatz haetten sonst
  // ein unendliches Vielfaches.
  accounts.onHand((name, winnings, house, game, meta) => {
    if (!meta || meta.free) return;
    const einsatz = Number(meta.einsatz) || 0;
    if (einsatz <= 0) return;
    try {
      melde(String(name).trim().toLowerCase(), game, einsatz, einsatz + Number(winnings || 0));
    } catch {}
  });

  io.on("connection", (socket) => {
    socket.on("records:state", (ack) => {
      if (typeof ack !== "function") return;
      ack(publicState(socket.data.account || null));
    });
  });
}

module.exports = { setupRecords, melde, publicState, SPIELE };
