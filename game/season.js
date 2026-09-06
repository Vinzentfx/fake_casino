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

const PLAY_XP_DAILY_CAP = 500;
const QUEST_XP_DAILY_CAP = 280;

/*
 * Die Stufenleiter.
 *
 * Season 1 hatte zehn Stufen mit zusammen 1.860 XP. Bei einer Tagesgrenze von
 * 780 XP war sie damit an einem langen Wochenende durch — bei einer Laufzeit
 * von vierundzwanzig Tagen. Der Pass war also die meiste Zeit leer.
 *
 * Season 2 rechnet andersherum: zwanzig Stufen, zusammen 12.140 XP. Wer
 * gemaechlich spielt (rund 250 XP am Tag, etwa hundert Runden) ist nach gut
 * sieben Wochen durch, also kurz vor Schluss. Wer die Tagesgrenze ausreizt,
 * schafft es in gut zwei Wochen — das darf sein, dafuer hat er gespielt.
 *
 * Die Chips laufen wie jede andere Gratis-Einnahme durch accounts.faucetFactor:
 * wer ohnehin Millionen hat, bekommt bis auf 25 % heruntergerechnet.
 *
 * Die vier Kosmetik-Stufen sind der eigentliche Reiz. Die Stuecke gibt es
 * nirgends zu kaufen, auch spaeter nicht — daran sieht man, wer dabei war.
 */
const LEVELS = [
  { level: 1,  xp: 120,    chips: 3000 },
  { level: 2,  xp: 280,    chips: 5000 },
  { level: 3,  xp: 480,    chips: 8000 },
  { level: 4,  xp: 720,    chips: 12000 },
  { level: 5,  xp: 1000,   chips: 0,      cosmetic: { type: "avatar", id: "s2_joker" },  label: "🃏 Joker-Avatar" },
  { level: 6,  xp: 1330,   chips: 16000 },
  { level: 7,  xp: 1710,   chips: 20000 },
  { level: 8,  xp: 2140,   chips: 25000 },
  { level: 9,  xp: 2620,   chips: 30000 },
  { level: 10, xp: 3150,   chips: 35000, cosmetic: { type: "color", id: "s2_amber" },    label: "35.000 Chips + 🟠 Bernstein-Name" },
  { level: 11, xp: 3740,   chips: 40000 },
  { level: 12, xp: 4390,   chips: 45000 },
  { level: 13, xp: 5100,   chips: 50000 },
  { level: 14, xp: 5880,   chips: 55000 },
  { level: 15, xp: 6730,   chips: 60000, cosmetic: { type: "avatar", id: "s2_wolf" },    label: "60.000 Chips + 🐺 Wolf-Avatar" },
  { level: 16, xp: 7650,   chips: 65000 },
  { level: 17, xp: 8650,   chips: 70000 },
  { level: 18, xp: 9730,   chips: 75000 },
  { level: 19, xp: 10890,  chips: 85000 },
  { level: 20, xp: 12140,  chips: 100000, cosmetic: { type: "avatar", id: "s2_phoenix" }, label: "100.000 Chips + 🔥 Phönix-Avatar" },
];

// Beschriftung fuer Stufen ohne eigene: reine Chip-Stufen.
for (const r of LEVELS) {
  if (!r.label) r.label = `${r.chips.toLocaleString("de-DE")} Chips`;
}

let _io = null;
let _accounts = null;

const dayNow = () => Math.floor(Date.now() / 86400000);

function ensure(acc) {
  acc.season = acc.season || {};
  if (acc.season.id !== SEASON.id) acc.season = { id: SEASON.id, xp: 0, claimed: {}, day: dayNow(), playDayXp: 0, questDayXp: 0 };
  const s = acc.season;
  s.claimed = s.claimed || {};
  if (s.day !== dayNow()) {
    s.day = dayNow();
    s.playDayXp = 0;
    s.questDayXp = 0;
  }
  return s;
}

function publicState(acc) {
  const s = ensure(acc);
  const xp = Math.floor(s.xp || 0);
  const unlocked = LEVELS.filter((r) => xp >= r.xp).length;
  const next = LEVELS.find((r) => xp < r.xp) || null;
  const jetzt = Date.now();
  // Drei Zustaende, nicht zwei: vor dem Start, laufend, vorbei. Ohne die
  // Unterscheidung stand vor dem Start "beendet" am Screen.
  const phase = jetzt < SEASON.startsAt ? "vor" : jetzt < SEASON.endsAt ? "laeuft" : "vorbei";
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
    rewards: LEVELS.map((r) => ({
      ...r,
      unlocked: xp >= r.xp,
      claimed: !!s.claimed[r.level],
    })),
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

function addXp(name, amount, kind = "play") {
  if (!_accounts) return 0;
  const key = String(name || "").trim().toLowerCase();
  const acc = _accounts.get(key);
  if (!acc) return 0;
  const s = ensure(acc);
  const capKey = kind === "quest" ? "questDayXp" : "playDayXp";
  const cap = kind === "quest" ? QUEST_XP_DAILY_CAP : PLAY_XP_DAILY_CAP;
  const room = Math.max(0, cap - (s[capKey] || 0));
  const gain = Math.max(0, Math.min(room, Math.floor(amount) || 0));
  if (!gain) return 0;
  s[capKey] = (s[capKey] || 0) + gain;
  s.xp = (s.xp || 0) + gain;
  _accounts.save();
  emitState(key);
  return gain;
}

function setupSeason(io, accounts) {
  _io = io;
  _accounts = accounts;

  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    const xp = 2 + (winnings > 0 ? 1 : 0);
    addXp(name, xp, "play");
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
      let kosmetik = null;
      if (reward.cosmetic) {
        try {
          const cos = require("./cosmetics");
          if (cos.grant(acc, reward.cosmetic.type, reward.cosmetic.id)) {
            kosmetik = cos.label(reward.cosmetic.type, reward.cosmetic.id);
          }
        } catch {}
      }
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

module.exports = { setupSeason, addXp };
