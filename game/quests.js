"use strict";

/**
 * Tages- und Wochenaufträge, "Verdienen durchs Spielen", gedeckelt.
 *
 * Alle bekommen dieselben: 3 für den Tag (je UTC-Tag) und 2 für die Woche,
 * fest aus den Töpfen gezogen, damit man über "die Aufträge von heute" reden
 * kann. Gezählt wird nur auf dem Server (über recordHand und die Hooks in Stadt
 * und Bonus), ein erfüllter Auftrag zahlt sofort aus. Der Stand hängt am Konto:
 *   acc.quests = { day, week, prog: {qid:n}, claimed: {qid:true} }
 *
 * Das ist die gedeckelte, nicht farmbare Variante von "Slots über 100 % RTP":
 * wer aktiv spielt, verdient, aber nur bis zu den Belohnungen je Tag und Woche.
 */

const DAILY_POOL = [
  { id: "slots12",    ev: "play_slots",       target: 12, reward: 3200,  label: "Spiele 12 Slot-Runden" },
  { id: "win4",       ev: "win",              target: 4,  reward: 4200,  label: "Gewinne 4 Runden (egal was)" },
  { id: "bj6",        ev: "play_blackjack",   target: 6,  reward: 3200,  label: "Spiele 6 Blackjack-Hände" },
  { id: "roulette6",  ev: "play_roulette",    target: 6,  reward: 3200,  label: "Spiele 6 Roulette-Runden" },
  { id: "sport1",     ev: "bet_sport",        target: 1,  reward: 2500,  label: "Platziere 1 Sportwette" },
  { id: "any24",      ev: "play",             target: 24, reward: 5200,  label: "Spiele 24 Runden (egal was)" },
  { id: "house1",     ev: "buy_house",        target: 1,  reward: 3000,  label: "Kauf 1 Gebäude in der Stadt" },
  { id: "bonus2",     ev: "claim_bonus",      target: 2,  reward: 2000,  label: "Hol 2× den Stunden-Bonus" },
  { id: "mines6",     ev: "play_mines",       target: 6,  reward: 3400,  label: "Spiele 6 Mines-Runden" },
  { id: "crash6",     ev: "play_crash",       target: 6,  reward: 3400,  label: "Spiele 6 Crash-Runden" },
  { id: "pinco3",     ev: "play_pinco",       target: 3,  reward: 3000,  label: "Spiele 3 Pinco-Runden (30 Bälle)" },
  { id: "poker4",     ev: "play_poker",       target: 4,  reward: 3500,  label: "Spiele 4 Poker-Hände" },
];

const WEEKLY_POOL = [
  { id: "win60",      ev: "win",            target: 60,  reward: 32000, label: "Gewinne 60 Runden diese Woche" },
  { id: "play140",    ev: "play",           target: 140, reward: 28000, label: "Spiele 140 Runden diese Woche" },
  { id: "houses4",    ev: "buy_house",      target: 4,   reward: 22000, label: "Kauf 4 Gebäude diese Woche" },
  { id: "slots120",   ev: "play_slots",     target: 120, reward: 28000, label: "Spiele 120 Slot-Runden diese Woche" },
  { id: "mines45",    ev: "play_mines",     target: 45,  reward: 26000, label: "Spiele 45 Mines-Runden diese Woche" },
  { id: "crash45",    ev: "play_crash",     target: 45,  reward: 26000, label: "Spiele 45 Crash-Runden diese Woche" },
  { id: "pinco24",    ev: "play_pinco",     target: 24,  reward: 26000, label: "Spiele 24 Pinco-Runden diese Woche" },
  { id: "sports5",    ev: "bet_sport",      target: 5,   reward: 18000, label: "Platziere 5 Sportwetten diese Woche" },
  { id: "casino60",   ev: "play_blackjack", target: 60,  reward: 25000, label: "Spiele 60 Blackjack-Hände diese Woche" },
];

// Wiederholbare Aufträge: immer da, ohne Wechsel. Erfüllt heißt ausgezahlt und
// zurückgesetzt, aber höchstens `cap` mal am Tag, also eine gedeckelte Quelle
// und keine Gelddruckmaschine. "playtime" sind Sekunden, in denen wirklich
// gespielt wurde (Pausen zählen nicht).
const REPEATABLE_POOL = [
  { id: "rp_time",  ev: "playtime",   target: 300, reward: 1500, cap: 8, label: "Spiele 5 Minuten" },
  { id: "rp_slots", ev: "play_slots", target: 30,  reward: 2000, cap: 6, label: "Dreh 30 Slot-Runden" },
  { id: "rp_win",   ev: "win",        target: 8,   reward: 2000, cap: 6, label: "Gewinne 8 Runden" },
];

const DAILIES_PER_DAY = 3;
const WEEKLIES_PER_WEEK = 2;

const dayNow = () => Math.floor(Date.now() / 86400000);
const weekNow = () => Math.floor((Date.now() / 86400000 + 3) / 7);

const DAY_THEMES = ["Klassiker-Mix", "Risikoabend", "Sport & Stadt", "Rundenjagd", "Highroll light"];
const WEEK_THEMES = ["Casino-Woche", "Stadtwoche", "Risikowoche", "Ausdauerwoche", "Turniertraining"];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled(pool, seed) {
  const out = pool.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function rotation(pool, count, period, salt) {
  return shuffled(pool, hashSeed(`${salt}:${period}`)).slice(0, count);
}

/** Deterministic global rotation (same quests for everyone). */
function activeDailies(day = dayNow()) {
  return rotation(DAILY_POOL, DAILIES_PER_DAY, day, "daily");
}
function activeWeeklies(week = weekNow()) {
  return rotation(WEEKLY_POOL, WEEKLIES_PER_WEEK, week, "weekly");
}
function rotationInfo() {
  const d = dayNow();
  const w = weekNow();
  return {
    dayName: DAY_THEMES[hashSeed(`day-theme:${d}`) % DAY_THEMES.length],
    weekName: WEEK_THEMES[hashSeed(`week-theme:${w}`) % WEEK_THEMES.length],
  };
}

let _io = null, _accounts = null;

function ensureQuests(acc) {
  const d = dayNow(), w = weekNow();
  if (!acc.quests) acc.quests = { day: d, week: w, prog: {}, claimed: {} };
  const q = acc.quests;
  q.prog = q.prog || {};
  q.claimed = q.claimed || {};
  if (q.day !== d) {
    for (const def of DAILY_POOL) { delete q.prog[def.id]; delete q.claimed[def.id]; }
    q.bought = []; // buy-quest anti-farm list resets daily
    q.rep = {};    // repeatable quest progress + daily completion counts reset
    q.day = d;
  }
  if (q.week !== w) {
    for (const def of WEEKLY_POOL) { delete q.prog[def.id]; delete q.claimed[def.id]; }
    q.week = w;
  }
  return q;
}

/** Ein Ereignis für die laufenden Aufträge zählen, erfüllte zahlen sofort.
 *  `meta` (optional): buy_house schickt die buildingId mit, damit man nicht
 *  dasselbe Haus verkaufen und neu kaufen kann, um weiterzukommen. */
function track(name, ev, n = 1, meta = null) {
  if (!_accounts) return;
  const acc = _accounts.get(name);
  if (!acc) return;
  const q = ensureQuests(acc);
  // Gegen Farming: jedes Gebäude zählt bei Kauf-Aufträgen nur einmal am Tag.
  if (ev === "buy_house" && meta != null) {
    q.bought = q.bought || [];
    if (q.bought.includes(meta)) return;
    q.bought.push(meta);
  }
  const key = String(name).trim().toLowerCase();
  const matches = (def) => def.ev === ev || (def.ev === "play" && ev.startsWith("play_"));
  // Happy Hour verdoppelt, die Vermögensbremse kürzt für die ganz Reichen.
  const mult = require("./liveops").questMult() * _accounts.faucetFactor(key);
  let changed = false;

  // One-time daily & weekly quests.
  for (const def of [...activeDailies(), ...activeWeeklies()]) {
    if (q.claimed[def.id] || !matches(def)) continue;
    q.prog[def.id] = Math.min(def.target, (q.prog[def.id] || 0) + n);
    changed = true;
    if (q.prog[def.id] >= def.target) {
      q.claimed[def.id] = true;
      const reward = Math.round(def.reward * mult);
      _accounts.adjustChips(key, reward);
      try { require("./season").addXp(key, def.reward >= 10000 ? 55 : 24, "quest"); } catch {}
      if (_io) _io.emit("quest:done", { user: acc.name, label: def.label, reward, happy: mult > 1 });
    }
  }

  // Wiederholbare: erfüllt heißt auszahlen und zurücksetzen, höchstens `cap` mal am Tag.
  q.rep = q.rep || {};
  for (const def of REPEATABLE_POOL) {
    if (!matches(def)) continue;
    const r = q.rep[def.id] || (q.rep[def.id] = { prog: 0, done: 0 });
    if (r.done >= def.cap) continue;
    r.prog += n;
    changed = true;
    while (r.prog >= def.target && r.done < def.cap) {
      r.prog -= def.target;
      r.done += 1;
      const reward = Math.round(def.reward * mult);
      _accounts.adjustChips(key, reward);
      try { require("./season").addXp(key, 8, "quest"); } catch {}
      if (_io) _io.emit("quest:done", { user: acc.name, label: def.label, reward, repeat: true, happy: mult > 1 });
    }
    if (r.done >= def.cap) r.prog = def.target; // für heute als voll anzeigen
  }

  if (changed) _accounts.save();
}

/** Quest board for one player. */
function listFor(name) {
  const acc = _accounts && _accounts.get(name);
  if (!acc) return null;
  const q = ensureQuests(acc);
  /*
   * Ausgezahlt wird `reward` mal Happy Hour mal Vermoegensbremse. Angezeigt
   * wurde bisher nur `reward`, wer 3.200 gelesen und 2.100 bekommen hat,
   * musste das fuer einen Fehler halten. Der Client bekommt jetzt beides: den
   * Grundwert und das, was wirklich ankommt.
   */
  const key = String(name).trim().toLowerCase();
  const happy = require("./liveops").questMult();
  const bremse = _accounts.faucetFactor(key);
  const echt = (r) => Math.round(r * happy * bremse);

  const view = (def) => ({
    id: def.id, label: def.label, target: def.target, reward: echt(def.reward), grundwert: def.reward,
    prog: Math.min(def.target, q.prog[def.id] || 0), done: !!q.claimed[def.id],
  });
  q.rep = q.rep || {};
  const repView = (def) => {
    const r = q.rep[def.id] || { prog: 0, done: 0 };
    return {
      id: def.id, label: def.label, target: def.target, reward: echt(def.reward), grundwert: def.reward,
      cap: def.cap, done: r.done, prog: Math.min(def.target, r.prog),
      maxed: r.done >= def.cap,
    };
  };
  const msDay = 86400000 - (Date.now() % 86400000);
  // Woche w umfasst die Tage [7w-3, 7(w+1)-3), der nächste Wechsel ist bei Tag 7(w+1)-3.
  const msWeek = ((weekNow() + 1) * 7 - 3) * 86400000 - Date.now();
  return {
    dailies: activeDailies().map(view),
    weeklies: activeWeeklies().map(view),
    repeatable: REPEATABLE_POOL.map(repView),
    rotation: rotationInfo(),
    msDay,
    msWeek: Math.max(0, msWeek),
    happy: happy > 1,
    faucet: Math.round(bremse * 100),
  };
}

function setupQuests(io, accounts) {
  _io = io;
  _accounts = accounts;
  // Spielrunden zählen über denselben recordHand-Weg für die Aufträge.
  // Freispiele zählen nicht, sonst erledigt ein Bonus einen 10-Dreh-Auftrag.
  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    // Aktive Spielzeit = Abstand zur letzten Runde, gedeckelt, damit Leerlauf
    // (oder ein offen gelassener Tab) nicht zählt. Für den Auftrag "Spiele 5 Min".
    const acc = accounts.get(name);
    if (acc) {
      const q = ensureQuests(acc);
      const now = Date.now();
      const gap = Math.min(now - (q.lastPlayTs || now), 30000); // cap idle gaps
      q.lastPlayTs = now;
      q.playAccMs = (q.playAccMs || 0) + gap; // accumulate fractional seconds
      const secs = Math.floor(q.playAccMs / 1000);
      if (secs > 0) { q.playAccMs -= secs * 1000; track(name, "playtime", secs); }
    }
    track(name, "play_" + (game || "any"));
    if (winnings > 0) track(name, "win");
  });

  io.on("connection", (socket) => {
    socket.on("quest:list", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...listFor(socket.data.account) });
    });
  });
}

module.exports = { setupQuests, track, listFor };
