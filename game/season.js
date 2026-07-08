"use strict";

/**
 * Casino Season / Pass.
 *
 * Progress is earned through real play and completed quests, with daily XP caps
 * so tiny-bet loops cannot grind unlimited faucet value. Rewards are claimed
 * manually and chip rewards go through the normal wealth taper.
 */

const SEASON = {
  id: "porta-sommer-1",
  name: "Porta-Sommer Season",
  subtitle: "Spiele Runden, erledige Aufträge und sammle Pass-XP.",
  endsAt: Date.UTC(2026, 7, 1, 0, 0, 0),
};

const PLAY_XP_DAILY_CAP = 500;
const QUEST_XP_DAILY_CAP = 280;

const LEVELS = [
  { level: 1, xp: 40,   chips: 5000,   label: "5.000 Chips" },
  { level: 2, xp: 100,  chips: 8000,   label: "8.000 Chips" },
  { level: 3, xp: 180,  chips: 12000,  label: "12.000 Chips" },
  { level: 4, xp: 290,  chips: 16000,  label: "16.000 Chips" },
  { level: 5, xp: 430,  chips: 25000,  label: "25.000 Chips" },
  { level: 6, xp: 610,  chips: 35000,  label: "35.000 Chips" },
  { level: 7, xp: 840,  chips: 45000,  label: "45.000 Chips" },
  { level: 8, xp: 1120, chips: 60000,  label: "60.000 Chips" },
  { level: 9, xp: 1460, chips: 75000,  label: "75.000 Chips" },
  { level: 10, xp: 1860, chips: 100000, label: "100.000 Chips" },
];

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
  return {
    ok: true,
    season: SEASON,
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
      const chips = Math.round(reward.chips * accounts.faucetFactor(key));
      s.claimed[lvl] = true;
      if (chips > 0) accounts.adjustChips(key, chips);
      accounts.save();
      const state = publicState(acc);
      const account = accounts.publicAccount(acc);
      socket.emit("account:update", { account });
      ack({ ok: true, chips, account, ...state });
    });
  });
}

module.exports = { setupSeason, addXp };
