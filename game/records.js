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

/**
 * Welche Spiele eine Bestmarke fuehren, und WORAUF.
 *
 * Das Vielfache des Einsatzes passt nicht ueberall. Blackjack zahlt hoechstens
 * das Zweieinhalbfache; dort war die Bestmarke nach dem ersten natuerlichen
 * Blackjack bei 2,50 und danach fuer immer unschlagbar — alle weiteren
 * Spieler haetten nur noch gleichziehen koennen. Ein Rekord, den man nicht
 * brechen kann, ist kein Rekord.
 *
 * Deshalb hat jedes Spiel eine `art`:
 *   faktor  Bestes Vielfaches des Einsatzes. Fuer alles mit offener Decke.
 *   serie   Laengste Serie gewonnener Haende am Stueck. Fuer Blackjack, wo
 *           die Auszahlung gedeckelt ist, das Durchhalten aber nicht.
 *
 * `min` ist die Untergrenze, ab der etwas ueberhaupt als Rekord zaehlt. Sie
 * richtet sich nach der Decke des jeweiligen Spiels: bei Pinco sind 15,23×
 * das Maximum, bei Mines geht es ins Unermessliche.
 */
const SPIELE = {
  slots:       { label: "Slots",       icon: "🎰", art: "faktor", min: 5 },
  roulette:    { label: "Roulette",    icon: "🎡", art: "faktor", min: 3 },
  crash:       { label: "Crash",       icon: "🚀", art: "faktor", min: 3 },
  mines:       { label: "Mines",       icon: "💣", art: "faktor", min: 3 },
  towers:      { label: "Towers",      icon: "🗼", art: "faktor", min: 3 },
  pinco:       { label: "Pinco Ball",  icon: "🟢", art: "faktor", min: 2 },
  horses:      { label: "Rennbahn",    icon: "🐎", art: "faktor", min: 3 },
  sportwetten: { label: "Sportwetten", icon: "⚽", art: "faktor", min: 3 },
  blackjack:   { label: "Blackjack",   icon: "♠️", art: "serie",  min: 3 },
  hilo:        { label: "Higher/Lower", icon: "🂡", art: "faktor", min: 3 },
  wuerfel:     { label: "Würfelpoker",  icon: "🎲", art: "faktor", min: 2 },
};

// Unter diesem Einsatz zaehlt nichts: sonst setzt jemand 1 Chip und gewinnt
// 500, was ein Vielfaches von 500 waere, aber nichts bedeutet.
const MIN_EINSATZ = 50;

let state = load();
let _io = null;
let _accounts = null;

/**
 * Alte Eintraege auf die neue Form bringen.
 *
 * Bis zum 7.9. stand in einem Rekord `faktor`; jetzt steht dort `wert` plus
 * ein fertiger Text, weil nicht jedes Spiel ein Vielfaches misst. Ohne diese
 * Umstellung standen die vorhandenen Rekorde als "NaN×" da, und der alte
 * Blackjack-Eintrag als "undefined Siege am Stück".
 *
 * Zwei Faelle werden dabei bewusst weggeworfen statt umgerechnet:
 *   - Spiele, deren Art sich geaendert hat (Blackjack: Vielfaches -> Serie).
 *     Ein Vielfaches laesst sich nicht in eine Serie umrechnen.
 *   - Werte unter der neuen Untergrenze. Sonst stuende auf der Karte "ab 3x"
 *     und darunter ein Rekord von 2,55.
 */
function migriere(best) {
  const out = {};
  for (const [spiel, b] of Object.entries(best || {})) {
    const meta = SPIELE[spiel];
    if (!meta || !b) continue;
    const wert = b.wert != null ? b.wert : (meta.art === "faktor" ? b.faktor : null);
    if (wert == null || !Number.isFinite(Number(wert))) continue;
    if (Number(wert) < meta.min) continue;
    out[spiel] = { ...b, wert: Number(wert), art: meta.art, text: wertText(spiel, Number(wert)) };
    delete out[spiel].faktor;
  }
  return out;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.week === weekNow()) {
      return { week: raw.week, best: migriere(raw.best), letzteWoche: migriere(raw.letzteWoche) };
    }
    if (raw && typeof raw === "object") return { week: weekNow(), best: {}, letzteWoche: migriere(raw.best) };
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
  // Laufende Serien enden mit der Woche. Sonst truege jemand eine Serie aus
  // der Vorwoche in die neue hinein und haette dort einen Vorsprung, den er
  // sich gar nicht erspielt hat.
  if (_accounts) {
    for (const acc of _accounts.rawAll()) if (acc.serien) acc.serien = {};
    _accounts.save();
  }
  save();
}

/** Wie ein Wert eines Spiels heisst, wenn man ihn hinschreibt. */
function wertText(spiel, wert) {
  return SPIELE[spiel].art === "serie"
    ? `${wert} Siege am Stück`
    : `${Number(wert).toFixed(2)}×`;
}

/**
 * Eine Runde melden. `einsatz` und `gewinn` sind Brutto-Chips.
 * Gibt den neuen Rekord zurueck, wenn einer aufgestellt wurde, sonst null.
 */
function melde(key, spiel, einsatz, gewinn) {
  ensureWeek();
  const meta = SPIELE[spiel];
  if (!meta || meta.art !== "faktor") return null;
  einsatz = Math.floor(Number(einsatz) || 0);
  gewinn = Math.floor(Number(gewinn) || 0);
  if (einsatz < MIN_EINSATZ || gewinn <= 0) return null;

  const faktor = Math.round((gewinn / einsatz) * 100) / 100;
  if (faktor < meta.min) return null;
  return setze(key, spiel, faktor, { einsatz, gewinn });
}

/**
 * Blackjack: Serie gewonnener Haende.
 *
 * `net` ist das Ergebnis der Hand. Ein Push (0) laesst die Serie stehen — man
 * hat ja nicht verloren. Die laufende Serie haengt am Account, damit sie einen
 * Neustart des Servers ueberlebt.
 */
function meldeSerie(key, spiel, net) {
  ensureWeek();
  const meta = SPIELE[spiel];
  if (!meta || meta.art !== "serie") return null;
  const acc = _accounts && _accounts.get(key);
  if (!acc) return null;
  if (!acc.serien || typeof acc.serien !== "object") acc.serien = {};
  if (net === 0) return null;                      // Unentschieden: nichts passiert
  if (net < 0) { acc.serien[spiel] = 0; _accounts.save(); return null; }
  const laenge = (acc.serien[spiel] || 0) + 1;
  acc.serien[spiel] = laenge;
  // Bestwert getrennt von der LAUFENDEN Serie: die faellt beim naechsten
  // Verlust auf null, das Achievement soll aber bestehen bleiben.
  const bestFeld = spiel + "Best";
  if ((acc.serien[bestFeld] || 0) < laenge) acc.serien[bestFeld] = laenge;
  // recordHand speichert die Konten BEVOR es die Zuhoerer aufruft. Diese
  // Aenderung liegt also hinter dem Speichern und muesste sonst darauf warten,
  // dass irgendwer anders speichert — bei einem Neustart waere die laufende
  // Serie weg.
  _accounts.save();
  if (laenge < meta.min) return null;
  return setze(key, spiel, laenge, { serie: laenge });
}

/** Gemeinsamer Teil: eintragen, ansagen, benachrichtigen. */
function setze(key, spiel, wert, extra) {
  const alt = state.best[spiel];
  if (alt && alt.wert >= wert) return null;

  const acc = _accounts && _accounts.get(key);
  state.best[spiel] = {
    key,
    name: acc ? acc.name : key,
    wert,
    art: SPIELE[spiel].art,
    text: wertText(spiel, wert),
    ...extra,
    at: Date.now(),
  };
  save();

  // Zaehler fuer das Achievement "Rekordhalter". Einmal gehalten zaehlt fuer
  // immer, auch wenn der Rekord spaeter wieder faellt.
  if (acc) { acc.rekorde = (acc.rekorde || 0) + 1; try { _accounts.save(); } catch {} }

  // Nur ansagen, wenn jemand einen FREMDEN Rekord schlaegt. Wer seinen eigenen
  // verbessert, muss dafuer nicht den Chat vollschreiben.
  if (alt && alt.key !== key && _io) {
    try {
      chat.announce(_io, `🏅 ${state.best[spiel].name} schlägt ${alt.name} bei ${SPIELE[spiel].label}: ${state.best[spiel].text} statt ${alt.text}!`);
    } catch {}
    // Der alte Halter ist fast immer gerade NICHT da — das ist ja der Punkt.
    // Genau darum lohnt sich hier eine Nachricht aufs Geraet.
    try {
      require("./push").an(alt.key, "rekord", {
        title: `🏅 ${SPIELE[spiel].label}: Rekord weg`,
        body: `${state.best[spiel].name} hat deine ${alt.text} mit ${state.best[spiel].text} überboten.`,
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
      spiel: id, label: meta.label, icon: meta.icon, art: meta.art, min: meta.min,
      // Worauf hier ueberhaupt gespielt wird. Ohne die Zeile steht bei
      // Blackjack eine Zahl ohne Einheit.
      regel: meta.art === "serie"
        ? `Längste Serie gewonnener Hände, ab ${meta.min}`
        : `Bestes Vielfaches des Einsatzes, ab ${meta.min}×`,
      best: b ? {
        name: b.name, wert: b.wert, text: b.text || wertText(id, b.wert),
        einsatz: b.einsatz || 0, gewinn: b.gewinn || 0, at: b.at, meiner: b.key === meinKey,
      } : null,
      vorwoche: v ? { name: v.name, text: v.text || wertText(id, v.wert) } : null,
    };
  });
  // Spiele mit Rekord zuerst, danach die offenen: die offenen sind die
  // Einladung ("hier steht noch nichts, hol ihn dir").
  zeilen.sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  return { ok: true, week: state.week, zeilen, minEinsatz: MIN_EINSATZ };
}

function setupRecords(io, accounts) {
  _io = io;
  _accounts = accounts;
  ensureWeek();
  // Die Umstellung alter Eintraege passiert beim Laden im Speicher. Einmal
  // schreiben, damit die Datei danach auch die neue Form hat und nicht erst
  // beim naechsten Rekord.
  save();

  // Jede abgerechnete Runde laeuft hier durch. Gewertet wird nur, was einen
  // Einsatz mitliefert: Freispiele und Runden ohne echten Einsatz haetten sonst
  // ein unendliches Vielfaches.
  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    const art = SPIELE[game] && SPIELE[game].art;
    if (!art) return;
    const key = String(name).trim().toLowerCase();
    try {
      if (art === "serie") {
        // Serien brauchen JEDE Hand, auch die verlorene: die beendet sie ja.
        meldeSerie(key, game, Number(winnings || 0));
        return;
      }
      const einsatz = Number(meta && meta.einsatz) || 0;
      if (einsatz <= 0) return;
      melde(key, game, einsatz, einsatz + Number(winnings || 0));
    } catch {}
  });

  io.on("connection", (socket) => {
    socket.on("records:state", (ack) => {
      if (typeof ack !== "function") return;
      ack(publicState(socket.data.account || null));
    });
  });
}

module.exports = { setupRecords, melde, meldeSerie, publicState, SPIELE };
