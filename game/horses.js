"use strict";

/**
 * 🐎 Porta-Rennbahn — geteilte Live-Pferderennen mit Besitz, Training & Wetten.
 *
 * Rhythmus wie Crash: EIN globales Rennen für alle im festen Takt
 * (Wettfenster → Live-Rennen, server-getickt → Auswertung). Spieler besitzen
 * Pferde (Markt → kaufen → trainieren → anmelden → Preisgeld), NPC-Pferde
 * füllen leere Bahnen, damit immer gewettet werden kann.
 *
 * Anti-Langeweile-Kern:
 *  - Tagesform driftet, Distanz + Bahnzustand wechseln → Favoriten rotieren
 *  - Taktik-Wahl (Frontrunner/Verfolger/Schlussspurt) vor dem Start
 *  - SPRINT-Knopf: 1× pro Rennen, Timing zählt (zu früh = Einbruch am Ende)
 *  - Foto-Finish, Live-Kommentar, fremde Wetten sichtbar
 *
 * Balance: Wett-Quoten aus Monte-Carlo + Marge (Haus gewinnt im Schnitt),
 * Preisgeld-Topf ≈ Startgelder + kleiner Haus-Zuschuss, Training/Kauf sind
 * Sinks, Kondition + Tages-Caps verhindern Farm-Loops.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HORSES_FILE = path.join(__dirname, "..", "data", "horses.json");

// ── Balance-Konstanten ───────────────────────────────────────────────────────
const FIELD_SIZE = 8;
const BET_WINDOW_MS = 90_000;   // Wetten offen
const RESULT_LINGER_MS = 22_000; // Ergebnis-Anzeige, dann nächste Runde
const TICK_MS = 250;            // Simulationstakt (Broadcast jeden 2. Tick)
const RACE_TICKS = { 1000: 120, 1600: 168, 2400: 220 }; // Renndauer in Ticks

const MIN_BET = 50;
const MAX_BET = 100_000;
const WIN_MARGIN = 0.15;        // Hausvorteil Siegwette (Favoriten-Bucket blieb sonst zu heiß)
const PLACE_MARGIN = 0.15;      // Hausvorteil Platzwette (Top 3)
const MC_RUNS = 1500;           // Monte-Carlo-Läufe für die Quoten

const ENTRY_FEE = 2_000;        // Startgeld pro Anmeldung
const PURSE_BASE = 3_500;       // Haus-Zuschuss zum Preisgeld-Topf
const PURSE_SPLIT = [0.42, 0.24, 0.14]; // Anteile Platz 1-3 (Rest = Sink; Voll-Feld bleibt <100% EV)

const MAX_OWNED = 4;            // Pferde pro Spieler
const MARKET_SIZE = 6;          // Angebote im Markt
const MARKET_REFRESH_MS = 30 * 60_000;
const SELL_FACTOR = 0.4;        // Rückverkauf ans Haus
const TRAIN_PER_DAY = 3;        // Trainingseinheiten pro Pferd pro Tag
const TRAIN_DURATION_MS = 20 * 60_000; // Training dauert 20 Min — Pferd solange gesperrt
const TRAIN_BASE_COST = 5_000; // teurer als vorher (echter Chip-Sink)
const RACE_CONDITION_COST = 30; // Kondition pro Rennen
const CONDITION_REGEN_PER_H = 5;
const ENTER_MIN_CONDITION = 50;

const SPRINT_TICKS = 14;        // Boost-Dauer
const SPRINT_BOOST = 0.09;      // +9% Tempo während des Boosts
const SPRINT_EARLY_PENALTY = 0.035; // Einbruch danach, wenn zu früh gezündet
const SPRINT_SAFE_PROGRESS = 0.62;  // ab hier gilt der Sprint als "gut getimt"

// ── Pferde-Store ─────────────────────────────────────────────────────────────
let store = { seq: 1, horses: {}, market: [], marketAt: 0 };
try {
  const raw = JSON.parse(fs.readFileSync(HORSES_FILE, "utf8"));
  if (raw && raw.horses) store = raw;
} catch {}
function save() {
  try {
    fs.mkdirSync(path.dirname(HORSES_FILE), { recursive: true });
    fs.writeFileSync(HORSES_FILE, JSON.stringify(store));
  } catch {}
}

const NAME_A = ["Blitz", "Donner", "Sturm", "Gold", "Schatten", "Feuer", "Wirbel", "Silber", "Nacht", "Königs", "Porta", "Weser", "Turbo", "Kaiser", "Mitternacht", "Diamant"];
const NAME_B = ["hufe", "wind", "pfeil", "stern", "läufer", "flamme", "geist", "prinz", "graf", "rakete", "blitz", "träumer", "jäger", "tänzer", "donner", "legende"];
function horseName() {
  for (let i = 0; i < 30; i++) {
    const n = NAME_A[crypto.randomInt(NAME_A.length)] + NAME_B[crypto.randomInt(NAME_B.length)];
    if (!Object.values(store.horses).some((h) => h.name === n)) return n;
  }
  return "Pferd" + store.seq;
}

function newHorse(quality) {
  // quality 0..1 steuert das Stat-Budget; potential = verstecktes Trainings-Limit.
  const budget = 100 + Math.round(quality * 70); // Summe aus speed+stamina Basis
  const speed = 45 + crypto.randomInt(21) + Math.round(quality * 15);
  const stamina = Math.max(35, budget - speed + crypto.randomInt(11) - 5);
  const h = {
    id: "h" + store.seq++,
    name: horseName(),
    owner: null,
    speed: Math.min(92, speed),
    stamina: Math.min(92, stamina),
    temperament: 3 + crypto.randomInt(8),   // Streuung: hoch = Wundertüte
    potential: 78 + crypto.randomInt(18),   // Cap fürs Training (versteckt)
    form: crypto.randomInt(11) - 5,         // Tagesform −5..+5, driftet täglich
    formAt: Date.now(),
    condition: 100,
    conditionAt: Date.now(),
    races: 0, wins: 0, podiums: 0, earnings: 0,
    careerLimit: 100 + crypto.randomInt(50),
    retired: false,
    trainedDay: "", trainedCount: 0,
  };
  store.horses[h.id] = h;
  return h;
}

function horsePrice(h) {
  // Preis nach Stärke — Markt-Kauf ist ein reiner Chip-Sink.
  const power = h.speed + h.stamina + h.potential * 0.5;
  return Math.round(power * power * 2.2 / 100) * 100;
}

function regenCondition(h) {
  const now = Date.now();
  const hours = (now - (h.conditionAt || now)) / 3_600_000;
  if (hours > 0.01) {
    h.condition = Math.min(100, h.condition + hours * CONDITION_REGEN_PER_H);
    h.conditionAt = now;
  }
}

function driftForm(h) {
  // Tagesform: wandert 1×/Tag um −3..+3, gedeckelt auf ±8.
  const day = new Date().toDateString();
  if (h.formDay === day) return;
  h.formDay = day;
  h.form = Math.max(-8, Math.min(8, (h.form || 0) + crypto.randomInt(7) - 3));
}

function ageFactor(h) {
  // Karriere-Kurve: jung 0.93 → Peak 1.0 → Spätkarriere 0.90.
  const t = h.races / Math.max(1, h.careerLimit);
  if (t < 0.25) return 0.93 + t * 0.28;
  if (t < 0.7) return 1.0;
  return 1.0 - (t - 0.7) * 0.33;
}

function refreshMarket(force) {
  const now = Date.now();
  if (!force && store.market.length >= MARKET_SIZE && now - store.marketAt < MARKET_REFRESH_MS) return;
  // Alte unverkaufte Marktpferde löschen, neues Sortiment generieren.
  for (const id of store.market) {
    const h = store.horses[id];
    if (h && !h.owner) delete store.horses[id];
  }
  store.market = [];
  for (let i = 0; i < MARKET_SIZE; i++) {
    const h = newHorse(Math.random() * 0.9 + (i === 0 ? 0.55 : 0.1)); // 1 Premium-Angebot
    store.market.push(h.id);
  }
  store.marketAt = now;
  save();
}

// NPC-Rennpferde (füllen leere Bahnen). Pool wird bei Bedarf nachgefüllt.
function npcPool() {
  const npcs = Object.values(store.horses).filter((h) => !h.owner && !h.retired && !store.market.includes(h.id));
  while (npcs.length < 14) {
    const h = newHorse(Math.random() * 0.75);
    h.npc = true;
    npcs.push(h);
  }
  return npcs;
}

function publicHorse(h, opts = {}) {
  regenCondition(h);
  driftForm(h);
  return {
    id: h.id, name: h.name, owner: h.owner || null, npc: !h.owner,
    speed: h.speed, stamina: h.stamina, temperament: h.temperament,
    // Form nur als grobe Tendenz — der genaue Wert bleibt geheim (Wett-Spannung).
    formHint: h.form >= 3 ? "up" : h.form <= -3 ? "down" : "mid",
    condition: Math.round(h.condition),
    races: h.races, wins: h.wins, podiums: h.podiums, earnings: h.earnings,
    career: Math.min(1, h.races / h.careerLimit), retired: !!h.retired,
    event: activeEvent(h) ? { label: h.event.label, hoursLeft: Math.ceil((h.event.until - Date.now()) / 3_600_000), block: !!h.event.block } : null,
    training: h.trainingUntil && h.trainingUntil > Date.now() ? { minsLeft: Math.ceil((h.trainingUntil - Date.now()) / 60_000) } : null,
    handicap: (h.recentWins || 0) >= 0.9, // 🏋️ trägt gerade Sieger-Zusatzgewicht
    price: opts.withPrice ? horsePrice(h) : undefined,
    trainsLeft: opts.own ? trainsLeft(h) : undefined,
    potentialHint: opts.own ? (h.speed + 6 < h.potential || h.stamina + 6 < h.potential ? "viel Luft" : "nah am Limit") : undefined,
  };
}

function trainsLeft(h) {
  const day = new Date().toDateString();
  return h.trainedDay === day ? Math.max(0, TRAIN_PER_DAY - h.trainedCount) : TRAIN_PER_DAY;
}

// ── Zufalls-Events (nur Spieler-Pferde) ──────────────────────────────────────
// block = kann nicht antreten, formDelta = Leistung während des Events,
// condPlus = Sofort-Effekt. Alles zeitlich begrenzt, nichts permanent.
const HORSE_EVENTS = [
  { id: "preg", label: "🤰 Schwanger!", hours: 20, weight: 5, block: true,
    msg: (n) => `${n} ist schwanger und pausiert — mal sehen, was daraus wird … 👀` },
  { id: "leg", label: "🦴 Beinbruch", hours: 30, weight: 7, block: true,
    msg: (n) => `${n} hat sich das Bein gebrochen und fällt aus! Gute Besserung. 🏥` },
  { id: "colic", label: "🤢 Möhren-Kolik", hours: 8, weight: 10, block: true,
    msg: (n) => `${n} hat zu viele Möhren gefressen und liegt flach. 🥕🥕🥕` },
  { id: "diva", label: "💅 Diva-Phase", hours: 10, weight: 9, block: true,
    msg: (n) => `${n} verweigert den Stall-Ausgang. Diven eben.` },
  { id: "bee", label: "🐝 Wespenstich", hours: 12, weight: 10, formDelta: -3,
    msg: (n) => `${n} wurde von einer Wespe gestochen und ist etwas neben der Spur.` },
  { id: "lovesick", label: "💘 Verliebt", hours: 16, weight: 8, formDelta: -4,
    msg: (n) => `${n} hat sich in ein Kutschpferd verliebt und träumt statt zu galoppieren.` },
  { id: "zoomies", label: "⚡ Zoomies", hours: 12, weight: 9, formDelta: 4,
    msg: (n) => `${n} hat die Zoomies — rennt wie von der Tarantel gestochen!` },
  { id: "fans", label: "🥕 Fan-Möhren", hours: 0, weight: 10, condPlus: 30,
    msg: (n) => `Fans haben ${n} mit Möhren verwöhnt — Kondition getankt!` },
];

function activeEvent(h) {
  return h.event && h.event.until > Date.now() ? h.event : null;
}

function rollEvent(h, chancePct) {
  if (!h.owner || h.retired || activeEvent(h)) return;
  if (crypto.randomInt(1000) >= chancePct * 10) return;
  const ev = HORSE_EVENTS[weightedPickIdx(HORSE_EVENTS.map((e) => e.weight))];
  h.event = { id: ev.id, label: ev.label, until: Date.now() + ev.hours * 3_600_000, formDelta: ev.formDelta || 0, block: !!ev.block };
  if (ev.condPlus) { regenCondition(h); h.condition = Math.min(100, h.condition + ev.condPlus); }
  const acc = accounts && accounts.get(h.owner);
  try { require("./feed").add("horses", `${ev.label} ${ev.msg(h.name)}${acc ? ` (Stall ${acc.name})` : ""}`); } catch {}
  save();
}

function weightedPickIdx(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = crypto.randomInt(total);
  for (let i = 0; i < weights.length; i++) { if (r < weights[i]) return i; r -= weights[i]; }
  return 0;
}

// Abgelaufene Events aufräumen; Schwangerschaft kann ein FOHLEN bringen:
// schwache Start-Werte, aber hohes Potential — der Zucht-Mini-Loop.
function sweepEvents() {
  const now = Date.now();
  for (const h of Object.values(store.horses)) {
    if (!h.event || h.event.until > now) continue;
    const ev = h.event;
    h.event = null;
    if (ev.id === "preg" && h.owner) {
      const owned = Object.values(store.horses).filter((x) => x.owner === h.owner && !x.retired).length;
      const acc = accounts && accounts.get(h.owner);
      if (owned < MAX_OWNED) {
        const foal = newHorse(0.12);
        foal.owner = h.owner;
        foal.name = (h.name.length > 10 ? h.name.slice(0, 10) : h.name) + " Junior";
        foal.potential = 88 + crypto.randomInt(8); // Fohlen: schwach, aber Rohdiamant
        try { require("./chat").announce(io, `🐣🐎 Nachwuchs! ${h.name} (Stall ${acc ? acc.name : "?"}) hat ein Fohlen: ${foal.name}!`); } catch {}
      } else {
        try { require("./feed").add("horses", `🐣 ${h.name} hat ein Fohlen bekommen — aber der Stall${acc ? ` von ${acc.name}` : ""} ist voll. Es hüpft davon. 🌈`); } catch {}
      }
    }
  }
  save();
}

// ── Renn-Modell ──────────────────────────────────────────────────────────────
// Effektive Stärke eines Pferds für DIESES Rennen (Distanz + Bahn + Form +
// Alter + Erfolgs-Handicap + Event). Wird von Quoten-MC UND Live-Rennen
// benutzt — Änderungen hier bleiben dadurch automatisch fair eingepreist.
function effective(h, distance, going) {
  const distT = distance === 1000 ? 0.72 : distance === 1600 ? 0.5 : 0.3; // Speed-Gewicht
  let base = h.speed * distT + h.stamina * (1 - distT);
  base *= ageFactor(h);
  base += (h.form || 0) * 1.1;
  // Erfolgs-Handicap: Sieger tragen Zusatzgewicht (klingt ab) — verhindert,
  // dass ein austrainiertes Pferd die Freunde dauerhaft dominiert.
  base -= Math.min(7, (h.recentWins || 0) * 2.4);
  // Aktives Event kann die Leistung drücken/heben (z. B. verliebt/Zoomies).
  if (h.event && h.event.until > Date.now() && h.event.formDelta) base += h.event.formDelta;
  if (going === "matschig") base = base * 0.82 + 12; // Matsch drückt die Unterschiede zusammen
  return base;
}

// Ein abstrakter Schnelldurchlauf fürs Quoten-Monte-Carlo (kein Tick-Detail).
function quickRace(field, distance, going) {
  const scores = field.map((f) => {
    const noise = (crypto.randomInt(2000) / 1000 - 1) * (6 + f.h.temperament * 1.35);
    return { f, score: effective(f.h, distance, going) + noise };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.map((s) => s.f.lane);
}

function computeOdds(field, distance, going) {
  const winCount = new Array(field.length).fill(0);
  const placeCount = new Array(field.length).fill(0);
  for (let i = 0; i < MC_RUNS; i++) {
    const order = quickRace(field, distance, going);
    winCount[order[0]]++;
    for (let p = 0; p < 3 && p < order.length; p++) placeCount[order[p]]++;
  }
  return field.map((f) => {
    const pWin = Math.max(0.008, winCount[f.lane] / MC_RUNS);
    const pPlace = Math.max(0.03, placeCount[f.lane] / MC_RUNS);
    return {
      win: Math.max(1.12, Math.min(30, (1 - WIN_MARGIN) / pWin)),
      place: Math.max(1.06, Math.min(10, (1 - PLACE_MARGIN) / pPlace)),
    };
  });
}

// ── Renn-Zustand ─────────────────────────────────────────────────────────────
const race = {
  phase: "betting",        // betting | running | done
  no: 0,
  distance: 1600,
  going: "trocken",
  field: [],               // { lane, h, tactic, sprintAt, sprintUsed, progress, finished, finishTick, silk }
  odds: [],
  bets: [],                // { key, name, lane, type: win|place, amount, odds, paid }
  entries: [],             // Anmelde-Queue fürs NÄCHSTE Rennen: { horseId, tactic }
  endsAt: 0,
  tick: 0,
  raceTicks: 168,
  result: null,            // [{lane, name, owner}] nach Zieleinlauf
  commentary: [],
};

function fieldForClient() {
  return race.field.map((f) => ({
    lane: f.lane, silk: f.silk,
    horse: publicHorse(f.h),
    tactic: f.tactic,
    odds: race.odds[f.lane] ? { win: +race.odds[f.lane].win.toFixed(2), place: +race.odds[f.lane].place.toFixed(2) } : null,
    progress: +(f.progress || 0).toFixed(4),
    finished: !!f.finished,
    sprintUsed: !!f.sprintUsed,
  }));
}

function stateFor(key) {
  return {
    ok: true,
    phase: race.phase, no: race.no, distance: race.distance, going: race.going,
    msLeft: Math.max(0, race.endsAt - Date.now()),
    field: fieldForClient(),
    bets: race.bets.map((b) => ({ name: b.name, lane: b.lane, type: b.type, amount: b.amount, odds: b.odds, won: b.won })),
    myBets: key ? race.bets.filter((b) => b.key === key).map((b) => ({ lane: b.lane, type: b.type, amount: b.amount, odds: b.odds })) : [],
    result: race.result,
    commentary: race.commentary.slice(-6),
    entriesNext: race.entries.length,
  };
}

// ── Rennschleife ─────────────────────────────────────────────────────────────
let io = null;
let accounts = null;

function say(text) {
  race.commentary.push(text);
  if (race.commentary.length > 24) race.commentary.shift();
  io.emit("horses:say", { text });
}

function startBetting() {
  sweepEvents(); // abgelaufene Events auflösen (inkl. Fohlen-Geburten)
  // Ruhende Stall-Pferde können auch abseits der Rennen etwas erleben.
  for (const h of Object.values(store.horses)) {
    if (h.owner && !h.retired && h.eventRollDay !== new Date().toDateString()) {
      h.eventRollDay = new Date().toDateString();
      rollEvent(h, 6);
    }
  }
  race.phase = "betting";
  race.no += 1;
  race.tick = 0;
  race.result = null;
  race.bets = [];
  race.commentary = [];
  race.distance = [1000, 1600, 2400][crypto.randomInt(3)];
  race.going = crypto.randomInt(100) < 26 ? "matschig" : "trocken";
  race.raceTicks = RACE_TICKS[race.distance];

  // Feld: angemeldete Spieler-Pferde zuerst, NPCs füllen auf.
  const field = [];
  const seen = new Set();
  for (const e of race.entries.splice(0, FIELD_SIZE)) {
    const h = store.horses[e.horseId];
    if (!h || h.retired || seen.has(h.id)) continue;
    seen.add(h.id);
    field.push({ h, tactic: e.tactic });
  }
  // Klassen-Rennen: NPCs werden nach Stärke passend zum Feld gewählt —
  // enge Felder = spannendere Rennen UND keine chancenlosen 200:1-Krücken,
  // die von der Quoten-Obergrenze systematisch unterbezahlt würden.
  const power = (h) => h.speed + h.stamina;
  const npcs = npcPool().filter((h) => !seen.has(h.id));
  const anchor = field.length
    ? field.reduce((s, f) => s + power(f.h), 0) / field.length
    : npcs.length ? power(npcs[crypto.randomInt(npcs.length)]) : 120;
  npcs.sort((a, b) => Math.abs(power(a) - anchor) - Math.abs(power(b) - anchor));
  while (field.length < FIELD_SIZE && npcs.length) {
    const h = npcs.splice(crypto.randomInt(Math.min(3, npcs.length)), 1)[0]; // leichte Streuung
    field.push({ h, tactic: ["front", "closer", "stayer"][crypto.randomInt(3)] });
  }
  race.field = field.map((f, lane) => ({
    ...f, lane, silk: lane, progress: 0, finished: false, finishTick: null,
    sprintAt: null, sprintUsed: false,
    // EIN Tagesleistungs-Wurf pro Rennen — exakt dieselbe Streuung wie im
    // Quoten-Monte-Carlo (quickRace). Ohne ihn mittelt sich Pro-Tick-Rauschen
    // über ~170 Ticks weg und Favoriten gewinnen viel öfter, als die Quoten
    // einpreisen (wäre +EV-farmbar; Sim: 115% RTP auf Favoriten).
    raceNoise: (crypto.randomInt(2000) / 1000 - 1) * (6 + f.h.temperament * 1.35),
  }));
  race.odds = computeOdds(race.field, race.distance, race.going);
  race.endsAt = Date.now() + BET_WINDOW_MS;
  save();
  io.emit("horses:round", stateFor(null));
  setTimeout(startRunning, BET_WINDOW_MS);
}

function tacticPace(tactic, t) {
  // Tempo-Kurve über den Rennverlauf t∈[0,1] je Taktik (Summe ≈ gleich).
  if (tactic === "front") return t < 0.35 ? 1.06 : t < 0.75 ? 1.0 : 0.945;
  if (tactic === "closer") return t < 0.5 ? 0.95 : t < 0.8 ? 1.02 : 1.075;
  return 1.0; // stayer
}

function startRunning() {
  race.phase = "running";
  race.endsAt = Date.now() + race.raceTicks * TICK_MS + 4000;
  const names = race.field.map((f) => f.h.name).join(", ");
  say(`🏁 Und sie sind unterwegs! Am Start: ${names}.`);
  io.emit("horses:round", stateFor(null));

  const iv = setInterval(() => {
    race.tick++;
    const t = race.tick / race.raceTicks;
    let leaderSwap = null;
    const prevLeader = leaderLane();
    for (const f of race.field) {
      if (f.finished) continue;
      const eff = effective(f.h, race.distance, race.going) + f.raceNoise;
      let pace = (eff / 68) * tacticPace(f.tactic, t);
      // Kondition unter 70 kostet spürbar Tempo (müde Pferde).
      if (f.h.condition < 70) pace *= 0.985 - (70 - f.h.condition) * 0.0012;
      // Sprint-Boost + Erschöpfungs-Malus bei zu frühem Zünden.
      if (f.sprintAt != null) {
        const since = race.tick - f.sprintAt;
        if (since >= 0 && since < SPRINT_TICKS) pace *= 1 + SPRINT_BOOST;
        else if (since >= SPRINT_TICKS && f.sprintEarly) pace *= 1 - SPRINT_EARLY_PENALTY;
      }
      // Kleines Pro-Tick-Zittern — rein fürs Auge, entscheidet nichts.
      pace *= 1 + (crypto.randomInt(2000) / 1000 - 1) * 0.008;
      f.progress += pace / race.raceTicks;
      if (f.progress >= 1 && !f.finished) {
        f.finished = true;
        f.finishTick = race.tick + (f.progress - 1); // Bruchteil für Foto-Finish
      }
    }
    const newLeader = leaderLane();
    if (prevLeader != null && newLeader !== prevLeader && race.tick > 8 && !race.field[newLeader].finished) {
      leaderSwap = race.field[newLeader].h.name;
    }
    if (leaderSwap && race.tick % 6 === 0) say(`💨 ${leaderSwap} übernimmt die Führung!`);
    if (race.tick % 2 === 0) io.emit("horses:tick", { tick: race.tick, t: +t.toFixed(3), field: race.field.map((f) => ({ lane: f.lane, p: +f.progress.toFixed(4), fin: !!f.finished, spr: f.sprintAt != null && race.tick - f.sprintAt < SPRINT_TICKS })) });

    if (race.field.every((f) => f.finished) || race.tick > race.raceTicks * 1.6) {
      clearInterval(iv);
      finishRace();
    }
  }, TICK_MS);
}

function leaderLane() {
  let best = null, bp = -1;
  for (const f of race.field) if (f.progress > bp) { bp = f.progress; best = f.lane; }
  return best;
}

function finishRace() {
  race.phase = "done";
  race.endsAt = Date.now() + RESULT_LINGER_MS;
  // Reihenfolge: zuerst Ziel-Tick (mit Bruchteil), Nachzügler nach Fortschritt.
  const order = race.field.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTick - b.finishTick;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  const photo = order.length > 1 && order[0].finished && order[1].finished && Math.abs(order[0].finishTick - order[1].finishTick) < 0.9;
  race.result = order.map((f, pos) => ({ pos: pos + 1, lane: f.lane, name: f.h.name, owner: f.h.owner || null, photo: photo && pos < 2 }));

  // Preisgelder: Topf = Haus-Zuschuss + Startgelder; NPC-Anteile verfallen (Sink).
  const playerEntries = race.field.filter((f) => f.h.owner).length;
  const purse = PURSE_BASE + ENTRY_FEE * playerEntries;
  order.slice(0, 3).forEach((f, i) => {
    const prize = Math.round(purse * PURSE_SPLIT[i]);
    if (f.h.owner) {
      const r = accounts.adjustChips(f.h.owner, prize);
      if (r.ok) {
        accounts.recordHand(f.h.owner, prize, true, "horses");
        f.h.earnings += prize;
        pushAccount(f.h.owner, r.account);
      }
    }
  });

  // Wetten auswerten.
  const winnerLane = order[0].lane;
  const placedLanes = new Set(order.slice(0, 3).map((f) => f.lane));
  for (const b of race.bets) {
    const won = b.type === "win" ? b.lane === winnerLane : placedLanes.has(b.lane);
    b.won = won;
    const payout = won ? Math.round(b.amount * b.odds) : 0;
    if (payout > 0) {
      const r = accounts.adjustChips(b.key, payout);
      if (r.ok) pushAccount(b.key, r.account);
    }
    accounts.recordHand(b.key, payout - b.amount, true, "horses");
  }

  // Verschleiß + Statistik + Erfolgs-Handicap + Events + Rente.
  for (const f of race.field) {
    const h = f.h;
    regenCondition(h);
    h.condition = Math.max(0, h.condition - RACE_CONDITION_COST);
    h.races += 1;
    const pos = race.result.find((r) => r.lane === f.lane).pos;
    // Handicap-Zähler: Siege laden Zusatzgewicht auf, das über Rennen abklingt.
    h.recentWins = (h.recentWins || 0) * 0.7 + (pos === 1 ? 1 : 0);
    if (pos === 1) h.wins += 1;
    if (pos <= 3) h.podiums += 1;
    // Besitzer-Stats fürs Leaderboard + Wochen-Ausschüttung.
    if (h.owner) accounts.recordHorseResult(h.owner, pos);
    rollEvent(h, 5); // 5% Chance auf ein Zufalls-Event nach jedem Renneinsatz
    if (h.races >= h.careerLimit && !h.retired) {
      h.retired = true;
      if (h.owner) {
        const acc = accounts.get(h.owner);
        require("./chat").announce(io, `🐎👋 ${h.name} (Stall ${acc ? acc.name : h.owner}) geht nach ${h.races} Rennen und ${h.wins} Siegen in Rente!`);
      }
    }
  }
  save();

  const w = order[0];
  const wOdds = race.odds[w.lane] ? race.odds[w.lane].win : 0;
  say(photo ? `📸 FOTO-FINISH! ${w.h.name} gewinnt um eine Nasenlänge!` : `🏆 ${w.h.name} gewinnt Rennen #${race.no}!`);
  if (wOdds >= 8 && race.bets.some((b) => b.won && b.type === "win")) {
    require("./chat").announce(io, `🐎💥 Außenseiter-Sieg! ${w.h.name} (Quote ${wOdds.toFixed(1)}) gewinnt auf der Porta-Rennbahn!`);
  }
  io.emit("horses:round", stateFor(null));
  setTimeout(startBetting, RESULT_LINGER_MS);
}

function pushAccount(key, account) {
  if (!io) return;
  for (const [, s] of io.of("/").sockets) {
    if (s.data && s.data.account === key) s.emit("account:update", { account: accounts.publicAccount ? accounts.publicAccount(account) : account });
  }
}

// ── Socket-API ───────────────────────────────────────────────────────────────
function setupHorses(_io, _accounts) {
  io = _io;
  accounts = _accounts;
  refreshMarket(false);
  setTimeout(startBetting, 2500);
  setInterval(() => refreshMarket(false), 5 * 60_000);

  io.on("connection", (socket) => {
    const key = () => socket.data.account;
    const me = () => key() && accounts.get(key());

    socket.on("horses:state", (ack) => {
      if (!ack) return;
      const s = stateFor(key());
      s.stable = key() ? Object.values(store.horses).filter((h) => h.owner === key()).map((h) => publicHorse(h, { own: true })) : [];
      refreshMarket(false);
      s.market = store.market.map((id) => store.horses[id]).filter(Boolean).map((h) => publicHorse(h, { withPrice: true }));
      s.config = { entryFee: ENTRY_FEE, maxOwned: MAX_OWNED, minBet: MIN_BET, maxBet: MAX_BET, enterMinCondition: ENTER_MIN_CONDITION, sellFactor: SELL_FACTOR };
      ack(s);
    });

    socket.on("horses:bet", ({ lane, type, amount } = {}, ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (race.phase !== "betting") return ack({ ok: false, error: "Wetten sind zu — Rennen läuft." });
      lane = Math.floor(Number(lane));
      amount = Math.floor(Number(amount));
      if (!race.field[lane]) return ack({ ok: false, error: "Unbekanntes Pferd." });
      if (type !== "win" && type !== "place") return ack({ ok: false, error: "Wettart?" });
      if (!Number.isFinite(amount) || amount < MIN_BET || amount > MAX_BET) return ack({ ok: false, error: `Einsatz ${MIN_BET}–${MAX_BET.toLocaleString("de-DE")}.` });
      const staked = race.bets.filter((b) => b.key === key()).reduce((s, b) => s + b.amount, 0);
      if (staked + amount > MAX_BET * 2) return ack({ ok: false, error: "Wett-Limit für dieses Rennen erreicht." });
      const deduct = accounts.adjustChips(key(), -amount);
      if (!deduct.ok) return ack({ ok: false, error: "Nicht genug Chips." });
      const odds = type === "win" ? race.odds[lane].win : race.odds[lane].place;
      const bet = { key: key(), name: me().name, lane, type, amount, odds: +odds.toFixed(2) };
      race.bets.push(bet);
      io.emit("horses:bets", { bets: race.bets.map((b) => ({ name: b.name, lane: b.lane, type: b.type, amount: b.amount, odds: b.odds })) });
      ack({ ok: true, account: deduct.account, bet: { lane, type, amount, odds: bet.odds } });
    });

    socket.on("horses:enter", ({ horseId, tactic } = {}, ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const h = store.horses[horseId];
      if (!h || h.owner !== key()) return ack({ ok: false, error: "Nicht dein Pferd." });
      if (h.retired) return ack({ ok: false, error: `${h.name} ist in Rente.` });
      const ev = activeEvent(h);
      if (ev && ev.block) {
        const hrs = Math.ceil((ev.until - Date.now()) / 3_600_000);
        return ack({ ok: false, error: `${h.name} kann nicht antreten: ${ev.label} (noch ~${hrs}h).` });
      }
      if (h.trainingUntil && h.trainingUntil > Date.now()) {
        const mins = Math.ceil((h.trainingUntil - Date.now()) / 60_000);
        return ack({ ok: false, error: `${h.name} ist noch ~${mins} Min im Training.` });
      }
      regenCondition(h);
      if (h.condition < ENTER_MIN_CONDITION) return ack({ ok: false, error: `${h.name} braucht Ruhe (Kondition ${Math.round(h.condition)}/${ENTER_MIN_CONDITION}).` });
      if (race.entries.some((e) => e.horseId === horseId) || race.field.some((f) => f.h.id === horseId && race.phase !== "done"))
        return ack({ ok: false, error: "Schon angemeldet." });
      if (race.entries.length >= FIELD_SIZE) return ack({ ok: false, error: "Nächstes Rennen ist voll." });
      if (!["front", "closer", "stayer"].includes(tactic)) tactic = "stayer";
      const deduct = accounts.adjustChips(key(), -ENTRY_FEE);
      if (!deduct.ok) return ack({ ok: false, error: `Startgeld ${ENTRY_FEE.toLocaleString("de-DE")} 🪙 fehlt.` });
      accounts.recordHand(key(), -ENTRY_FEE, true, "horses");
      race.entries.push({ horseId, tactic });
      ack({ ok: true, account: deduct.account, position: race.entries.length });
      io.emit("horses:entries", { count: race.entries.length });
    });

    socket.on("horses:sprint", (ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (race.phase !== "running") return ack({ ok: false, error: "Kein Rennen im Gange." });
      const f = race.field.find((x) => x.h.owner === key() && !x.finished);
      if (!f) return ack({ ok: false, error: "Kein eigenes Pferd im Rennen." });
      if (f.sprintUsed) return ack({ ok: false, error: "Sprint schon gezündet!" });
      f.sprintUsed = true;
      f.sprintAt = race.tick;
      f.sprintEarly = f.progress < SPRINT_SAFE_PROGRESS;
      say(`⚡ ${f.h.name} zündet den Sprint${f.sprintEarly ? " — sehr früh!" : "!"}`);
      ack({ ok: true, early: f.sprintEarly });
    });

    socket.on("horses:buy", ({ horseId } = {}, ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (!store.market.includes(horseId)) return ack({ ok: false, error: "Nicht mehr im Angebot." });
      const h = store.horses[horseId];
      if (!h || h.owner) return ack({ ok: false, error: "Schon verkauft." });
      const owned = Object.values(store.horses).filter((x) => x.owner === key() && !x.retired).length;
      if (owned >= MAX_OWNED) return ack({ ok: false, error: `Max. ${MAX_OWNED} aktive Pferde im Stall.` });
      const price = horsePrice(h);
      const deduct = accounts.adjustChips(key(), -price);
      if (!deduct.ok) return ack({ ok: false, error: `${price.toLocaleString("de-DE")} 🪙 fehlen.` });
      h.owner = key();
      store.market = store.market.filter((id) => id !== horseId);
      save();
      const acc = accounts.get(key());
      try { require("./feed").add("horses", `🐎 ${acc.name} kauft ${h.name} für ${price.toLocaleString("de-DE")} 🪙.`, { user: acc.name }); } catch {}
      ack({ ok: true, account: deduct.account, horse: publicHorse(h, { own: true }) });
    });

    socket.on("horses:sell", ({ horseId } = {}, ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const h = store.horses[horseId];
      if (!h || h.owner !== key()) return ack({ ok: false, error: "Nicht dein Pferd." });
      if (race.field.some((f) => f.h.id === horseId) || race.entries.some((e) => e.horseId === horseId))
        return ack({ ok: false, error: "Ist gerade im Renneinsatz." });
      const refund = h.retired ? 0 : Math.round(horsePrice(h) * SELL_FACTOR);
      delete store.horses[horseId];
      save();
      if (refund > 0) {
        const r = accounts.adjustChips(key(), refund);
        return ack({ ok: true, refund, account: r.ok ? r.account : undefined });
      }
      ack({ ok: true, refund: 0 });
    });

    socket.on("horses:train", ({ horseId, stat } = {}, ack) => {
      if (!ack) return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const h = store.horses[horseId];
      if (!h || h.owner !== key()) return ack({ ok: false, error: "Nicht dein Pferd." });
      if (h.retired) return ack({ ok: false, error: "In Rente trainiert man nicht mehr." });
      if (stat !== "speed" && stat !== "stamina") return ack({ ok: false, error: "Speed oder Ausdauer?" });
      if (h.trainingUntil && h.trainingUntil > Date.now())
        return ack({ ok: false, error: `${h.name} trainiert schon (noch ~${Math.ceil((h.trainingUntil - Date.now()) / 60_000)} Min).` });
      const day = new Date().toDateString();
      if (h.trainedDay !== day) { h.trainedDay = day; h.trainedCount = 0; }
      if (h.trainedCount >= TRAIN_PER_DAY) return ack({ ok: false, error: "Für heute austrainiert (3/Tag)." });
      if (h[stat] >= h.potential) return ack({ ok: false, error: `${h.name} ist bei ${stat === "speed" ? "Tempo" : "Ausdauer"} am Limit.` });
      // Kosten steigen mit dem Stat-Level (Sink), Zuwachs wird knapper am Limit.
      const cost = Math.round(TRAIN_BASE_COST * Math.pow(h[stat] / 45, 2) / 100) * 100;
      const deduct = accounts.adjustChips(key(), -cost);
      if (!deduct.ok) return ack({ ok: false, error: `${cost.toLocaleString("de-DE")} 🪙 fehlen.` });
      const gain = h[stat] >= h.potential - 4 ? 1 : 1 + crypto.randomInt(2);
      h[stat] = Math.min(h.potential, h[stat] + gain);
      h.trainedCount += 1;
      // Training bindet das Pferd: 20 Min gesperrt für Rennen (und weiteres Training).
      h.trainingUntil = Date.now() + TRAIN_DURATION_MS;
      save();
      ack({ ok: true, account: deduct.account, stat, gain, value: h[stat], cost, trainsLeft: trainsLeft(h), trainingMins: Math.round(TRAIN_DURATION_MS / 60_000), horse: publicHorse(h, { own: true }) });
    });
  });
}

module.exports = { setupHorses };
// Für Offline-Balancing-Simulationen:
module.exports._internals = { newHorse, effective, quickRace, computeOdds, horsePrice, store, ENTRY_FEE, PURSE_BASE, PURSE_SPLIT, WIN_MARGIN, PLACE_MARGIN, rollEvent, sweepEvents, activeEvent, HORSE_EVENTS };
