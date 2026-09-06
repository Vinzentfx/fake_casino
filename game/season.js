"use strict";

/**
 * Casino Season / Pass.
 *
 * Progress is earned through real play and completed quests, with daily XP caps
 * so tiny-bet loops cannot grind unlimited faucet value. Rewards are claimed
 * manually and chip rewards go through the normal wealth taper.
 */

const SEASON = {
  id: "porta-herbst-2",
  name: "Porta-Herbst",
  subtitle: "Acht Wochen, zwanzig Stufen. Spiel einfach, der Rest läuft nebenbei mit.",
  startsAt: Date.UTC(2026, 8, 6, 0, 0, 0),   // 6. September 2026
  endsAt: Date.UTC(2026, 10, 1, 0, 0, 0),    // 1. November 2026, also acht Wochen
};

const PLAY_XP_DAILY_CAP = 700;
const QUEST_XP_DAILY_CAP = 280;

/*
 * Was das Grinden traegt.
 *
 * Season 1 gab stumpf 2 XP pro Runde, egal was man spielte, gedeckelt bei
 * 500 am Tag. Damit war jeder Abend gleich und ab dem Deckel egal. Drei
 * Zutaten aendern das:
 *
 *   TAGES-FOKUS   Ein Spiel gibt heute doppelte XP. Es wechselt taeglich und
 *                 ist fuer alle dasselbe, damit man darueber reden kann.
 *   TAGESSERIE    Wer an aufeinanderfolgenden Tagen spielt, sammelt schneller
 *                 (+5 % je Tag, hoechstens +50 %). Der Grund, morgen wieder
 *                 reinzuschauen.
 *   CLAN-BONUS    Der Clan-Fortschritt gibt allen Mitgliedern bis zu +25 %.
 *
 * Alle drei wirken VOR dem Tagesdeckel. Der Deckel bleibt die harte Grenze,
 * die Boni entscheiden nur, wie schnell man ihn erreicht.
 */
const FOKUS_FAKTOR = 2;
const SERIE_PRO_TAG = 0.05;
const SERIE_MAX = 0.50;

// Reihenfolge ist fest, damit der Fokus vorhersehbar durchrotiert.
const FOKUS_SPIELE = [
  { id: "slots",     label: "Slots",        icon: "🎰" },
  { id: "blackjack", label: "Blackjack",    icon: "♠️" },
  { id: "roulette",  label: "Roulette",     icon: "🎡" },
  { id: "crash",     label: "Crash",        icon: "🚀" },
  { id: "mines",     label: "Mines",        icon: "💣" },
  { id: "towers",    label: "Towers",       icon: "🗼" },
  { id: "pinco",     label: "Pinco Ball",   icon: "🟢" },
  { id: "sports",    label: "Sportwetten",  icon: "⚽" },
  { id: "horses",    label: "Rennbahn",     icon: "🐎" },
  { id: "poker",     label: "Poker",        icon: "🃏" },
];

const dayNow = () => Math.floor(Date.now() / 86400000);

/** Das Fokus-Spiel des Tages. Fuer alle gleich, weil es aus dem Datum faellt. */
function fokusHeute() {
  return FOKUS_SPIELE[dayNow() % FOKUS_SPIELE.length];
}

const LEVELS = [
  { level: 1,  xp: 120,    chips: 2500 },
  { level: 2,  xp: 280,    chips: 4000 },
  { level: 3,  xp: 480,    chips: 6000 },
  { level: 4,  xp: 720,    chips: 8000 },
  { level: 5,  xp: 1000,   chips: 0,      kosmetik: [{ type: "avatar", id: "s2_joker" }] },
  { level: 6,  xp: 1330,   chips: 11000 },
  { level: 7,  xp: 1710,   chips: 13000 },
  { level: 8,  xp: 2140,   chips: 16000 },
  { level: 9,  xp: 2620,   chips: 19000 },
  { level: 10, xp: 3150,   chips: 24000,  kosmetik: [{ type: "style", id: "s2_bernstein" }] },
  { level: 11, xp: 3740,   chips: 27000 },
  { level: 12, xp: 4390,   chips: 30000 },
  { level: 13, xp: 5100,   chips: 34000 },
  { level: 14, xp: 5880,   chips: 38000 },
  { level: 15, xp: 6730,   chips: 45000,  kosmetik: [{ type: "avatar", id: "s2_wolf" }, { type: "frame", id: "s2_wolf" }] },
  { level: 16, xp: 7650,   chips: 48000 },
  { level: 17, xp: 8650,   chips: 53000 },
  { level: 18, xp: 9730,   chips: 58000 },
  { level: 19, xp: 10890,  chips: 64000 },
  { level: 20, xp: 12140,  chips: 80000,  kosmetik: [{ type: "avatar", id: "s2_phoenix" }, { type: "style", id: "s2_phoenix" }, { type: "title", id: "s2_phoenix" }] },
];

for (const r of LEVELS) {
  if (!r.label) r.label = `${r.chips.toLocaleString("de-DE")} Chips`;
}

let _io = null;
let _accounts = null;

function ensure(acc) {
  acc.season = acc.season || {};
  if (acc.season.id !== SEASON.id) {
    acc.season = { id: SEASON.id, xp: 0, claimed: {}, day: dayNow(), playDayXp: 0, questDayXp: 0, serie: 0 };
  }
  const s = acc.season;
  s.claimed = s.claimed || {};
  if (typeof s.serie !== "number") s.serie = 0;

  const heute = dayNow();
  if (s.day !== heute) {
    // Die Serie zaehlt nur bei LUECKENLOSEN Tagen weiter. Ein ausgelassener
    // Tag setzt sie zurueck, sonst waere sie keine Serie.
    s.serie = s.day === heute - 1 ? Math.min(999, (s.serie || 0) + 1) : 1;
    s.day = heute;
    s.playDayXp = 0;
    s.questDayXp = 0;
  }
  if (!s.serie) s.serie = 1;
  return s;
}

/** Serienbonus als Faktor: Tag 1 = 1,0 · Tag 5 = 1,20 · ab Tag 11 = 1,50. */
function serienFaktor(s) {
  return 1 + Math.min(SERIE_MAX, Math.max(0, (s.serie || 1) - 1) * SERIE_PRO_TAG);
}

/** Clan-Bonus als Faktor. Kommt aus der Clan-Season, siehe game/clans.js. */
function clanFaktor(key) {
  try { return require("./clans").seasonBonusFor(key); } catch { return 1; }
}

function publicState(acc) {
  const s = ensure(acc);
  const xp = Math.floor(s.xp || 0);
  const unlocked = LEVELS.filter((r) => xp >= r.xp).length;
  const next = LEVELS.find((r) => xp < r.xp) || null;
  const jetzt = Date.now();
  const fokus = fokusHeute();
  const key = String(acc.name || "").trim().toLowerCase();
  // Drei Zustaende, nicht zwei: vor dem Start, laufend, vorbei. Ohne die
  // Unterscheidung stand vor dem Start "beendet" am Screen.
  const phase = jetzt < SEASON.startsAt ? "vor" : jetzt < SEASON.endsAt ? "laeuft" : "vorbei";
  const faktor = _accounts ? _accounts.faucetFactor(acc.name) : 1;
  return {
    ok: true,
    season: SEASON,
    phase,
    laeuft: phase === "laeuft",
    msLeft: Math.max(0, SEASON.endsAt - jetzt),
    msToStart: Math.max(0, SEASON.startsAt - jetzt),
    xp,
    level: unlocked,
    nextXp: next ? next.xp : LEVELS[LEVELS.length - 1].xp,
    playCap: { used: Math.floor(s.playDayXp || 0), max: PLAY_XP_DAILY_CAP },
    questCap: { used: Math.floor(s.questDayXp || 0), max: QUEST_XP_DAILY_CAP },
    fokus: { ...fokus, faktor: FOKUS_FAKTOR },
    serie: { tage: s.serie || 1, faktor: serienFaktor(s), max: 1 + SERIE_MAX },
    clanBonus: clanFaktor(key),
    rewards: LEVELS.map((r) => ({
      ...r,
      // Beschriftung kommt vom Server aus den echten Werten. Vorher stand sie
      // als fester Text daneben ("200.000 Chips") und war nach der ersten
      // Zahlenaenderung falsch.
      label: belohnungsText(r, faktor),
      chipsFuerDich: Math.round((r.chips || 0) * faktor),
      unlocked: xp >= r.xp,
      claimed: !!s.claimed[r.level],
    })),
    // Prozent der vollen Auszahlung. Unter 100 wird es im Screen erklaert.
    faucet: Math.round(faktor * 100),
  };
}

function emitState(name) {
  if (!_io || !_accounts) return;
  const key = String(name || "").trim().toLowerCase();
  const acc = _accounts.get(key);
  if (!acc) return;
  for (const s of _io.of("/").sockets.values()) {
    if (s.data && s.data.account === key) s.emit("season:update", publicState(acc));
  }
}

/**
 * XP gutschreiben.
 *
 * Reihenfolge: Grundwert × Fokus × Serie × Clan, danach am Tagesdeckel
 * abschneiden. Die Boni entscheiden also, wie schnell man den Deckel
 * erreicht, nicht wie hoch er liegt — sonst waere er keiner.
 */
function addXp(name, amount, kind = "play", spiel = null) {
  if (!_accounts) return 0;
  const key = String(name || "").trim().toLowerCase();
  const acc = _accounts.get(key);
  if (!acc) return 0;
  const s = ensure(acc);

  let roh = Math.max(0, Math.floor(amount) || 0);
  if (!roh) return 0;
  if (kind === "play" && spiel && spiel === fokusHeute().id) roh *= FOKUS_FAKTOR;
  roh = Math.floor(roh * serienFaktor(s) * clanFaktor(key));

  const capKey = kind === "quest" ? "questDayXp" : "playDayXp";
  const cap = kind === "quest" ? QUEST_XP_DAILY_CAP : PLAY_XP_DAILY_CAP;
  const room = Math.max(0, cap - (s[capKey] || 0));
  const gain = Math.max(0, Math.min(room, roh));
  if (!gain) return 0;
  s[capKey] = (s[capKey] || 0) + gain;
  s.xp = (s.xp || 0) + gain;
  _accounts.save();

  // Dieselbe XP zaehlt auch fuer den Clan. Das ist der Grund, warum ein Clan
  // mehr sein soll als ein Kuerzel neben dem Namen: was einer spielt, bringt
  // die ganze Gruppe voran.
  try { require("./clans").addSeasonXp(key, gain); } catch {}

  emitState(key);
  return gain;
}

/**
 * Was eine Stufe gibt, als Satz. Einzige Quelle fuer die Beschriftung.
 *
 * `faktor` ist die Vermoegensbremse des Spielers. Ohne sie stand auf der
 * Leiter "24.000 Chips", ausgezahlt wurden aber 16.043, und niemand konnte
 * sehen warum. Jetzt steht die Zahl da, die wirklich ankommt.
 */
function belohnungsText(r, faktor = 1) {
  const teile = [];
  const chips = Math.round((r.chips || 0) * faktor);
  if (chips > 0) teile.push(`${chips.toLocaleString("de-DE")} Chips`);
  for (const k of r.kosmetik || []) {
    try { teile.push(require("./cosmetics").label(k.type, k.id)); } catch { teile.push(k.id); }
  }
  return teile.join(" + ") || "—";
}

function setupSeason(io, accounts) {
  _io = io;
  _accounts = accounts;

  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    const xp = 2 + (winnings > 0 ? 1 : 0);
    addXp(name, xp, "play", game);
  });

  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    socket.on("season:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(publicState(acc));
    });

    socket.on("season:claim", ({ level } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const lvl = Math.floor(Number(level));
      const reward = LEVELS.find((r) => r.level === lvl);
      if (!reward) return ack({ ok: false, error: "Unbekannte Stufe." });
      const s = ensure(acc);
      if ((s.xp || 0) < reward.xp) return ack({ ok: false, error: "Noch nicht freigeschaltet." });
      if (s.claimed[lvl]) return ack({ ok: false, error: "Schon abgeholt." });
      const key = socket.data.account;
      const chips = Math.round((reward.chips || 0) * accounts.faucetFactor(key));
      s.claimed[lvl] = true;
      if (chips > 0) accounts.adjustChips(key, chips);
      // Eine Stufe kann mehrere Stuecke geben: Stufe 20 etwa Avatar, Namensstil
      // und Titel zusammen. Das ist der Abschluss von acht Wochen, da darf es
      // mehr sein als ein Emoji.
      const erhalten = [];
      for (const k of reward.kosmetik || []) {
        try {
          const cos = require("./cosmetics");
          if (cos.grant(acc, k.type, k.id)) erhalten.push(cos.label(k.type, k.id));
        } catch {}
      }
      const kosmetik = erhalten.length ? erhalten.join(" + ") : null;
      accounts.save();
      const state = publicState(acc);
      const account = accounts.publicAccount(acc);
      const was = kosmetik
        ? (chips > 0 ? `${chips.toLocaleString("de-DE")} Chips und ${kosmetik}` : String(kosmetik))
        : `${chips.toLocaleString("de-DE")} Chips`;
      try { require("./feed").add("season", `${acc.name} holt Season-Stufe ${lvl}: ${was}.`, { user: acc.name, level: lvl, chips }); } catch {}
      socket.emit("account:update", { account });
      ack({ ok: true, chips, kosmetik, account, ...state });
    });
  });
}

module.exports = { setupSeason, addXp, fokusHeute, SEASON };
