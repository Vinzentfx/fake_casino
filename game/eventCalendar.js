"use strict";

/**
 * Der feste Wochenend-Pokal.
 *
 * Kurze Zufalls-Events funktionieren nur, wenn mehrere Leute gleichzeitig
 * online sind. Dieses Hauptevent steht deshalb jede Woche lange vorher fest:
 * Freitag 18:00 bis Montag 00:00 (Europe/Berlin). Jede abgeschlossene Runde
 * gibt genau einen Punkt, unabhaengig vom Einsatz, und nach 30 Punkten ist
 * Schluss. So kann man zu seiner eigenen Zeit mitmachen und Geld gewinnt
 * keinen Vorsprung.
 */

const fs = require("fs");
const path = require("path");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "event-calendar.json");
const ZONE = "Europe/Berlin";
const PERSONAL_CAP = 30;
const COMMUNITY_TARGET = 30;
const COMMUNITY_REWARD = 7500;
const MILESTONES = Object.freeze([
  { points: 5, reward: 2500, label: "Warmgespielt" },
  { points: 15, reward: 6000, label: "Halbzeit" },
  { points: 30, reward: 12000, label: "Pokalrunde" },
]);

const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function zonedParts(ms) {
  const p = {};
  for (const x of berlinFormat.formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return p;
}

/** Lokale Berliner Uhrzeit robust in UTC umrechnen, auch beim Zeitwechsel. */
function berlinToUtc(y, m, d, hour, minute = 0) {
  const target = Date.UTC(y, m - 1, d, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess);
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - shownAsUtc;
  }
  return guess;
}

function scheduleAt(now = Date.now()) {
  const p = zonedParts(now);
  const date = Date.UTC(p.year, p.month - 1, p.day);
  const weekday = new Date(date).getUTCDay();
  const monday = date - ((weekday + 6) % 7) * 86400000;
  const mon = new Date(monday);
  const fri = new Date(monday + 4 * 86400000);
  const nextMon = new Date(monday + 7 * 86400000);
  const startAt = berlinToUtc(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 18);
  const endAt = berlinToUtc(nextMon.getUTCFullYear(), nextMon.getUTCMonth() + 1, nextMon.getUTCDate(), 0);
  const id = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
  return { id, startAt, endAt, active: now >= startAt && now < endAt };
}

function emptyState(id) { return { eventId: id, total: 0, players: {}, announced: false }; }
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s === "object" && s.players && typeof s.players === "object") return s;
  } catch {}
  return emptyState(scheduleAt().id);
}

let state = load();

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}

function setupEventCalendar(io, accounts, opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : Date.now;

  function ensureWeek() {
    const schedule = scheduleAt(now());
    if (state.eventId !== schedule.id) {
      state = emptyState(schedule.id);
      save();
    }
    return schedule;
  }

  function player(key) {
    return state.players[key] || (state.players[key] = { points: 0, claimed: [], communityRewarded: false });
  }

  function scaledReward(key, base) {
    return Math.max(1, Math.round(base * accounts.faucetFactor(key)));
  }

  function award(key, base) {
    const amount = scaledReward(key, base);
    const res = accounts.adjustChips(key, amount);
    if (res && res.ok) accounts.meldeStand(io, key);
    return res && res.ok ? amount : 0;
  }

  function publicState(key) {
    const schedule = ensureWeek();
    const p = key && state.players[key] ? state.players[key] : { points: 0, claimed: [], communityRewarded: false };
    return {
      ok: true,
      title: "Wochenend-Pokal",
      schedule,
      points: p.points || 0,
      cap: PERSONAL_CAP,
      milestones: MILESTONES.map((m) => ({ ...m, reward: key ? scaledReward(key, m.reward) : m.reward, claimed: p.claimed.includes(m.points) })),
      community: {
        points: Math.min(COMMUNITY_TARGET, state.total || 0),
        target: COMMUNITY_TARGET,
        reward: key ? scaledReward(key, COMMUNITY_REWARD) : COMMUNITY_REWARD,
        unlocked: (state.total || 0) >= COMMUNITY_TARGET,
        rewarded: !!p.communityRewarded,
        participants: Object.values(state.players).filter((x) => (x.points || 0) > 0).length,
      },
    };
  }

  function socketsFor(key) {
    const out = [];
    for (const socket of io.of("/").sockets.values()) {
      if (socket.data && socket.data.account === key) out.push(socket);
    }
    return out;
  }

  function emitPlayer(key, extra = null) {
    const data = publicState(key);
    for (const socket of socketsFor(key)) {
      socket.emit("eventcalendar:update", data);
      if (extra) socket.emit("eventcalendar:reward", extra);
    }
  }

  function rewardCommunityParticipant(key) {
    const p = player(key);
    if (state.total < COMMUNITY_TARGET || p.communityRewarded || p.points < 1) return 0;
    p.communityRewarded = true;
    return award(key, COMMUNITY_REWARD);
  }

  accounts.onHand((name, _winnings, _house, _game, meta) => {
    if (meta && (meta.free || meta.event === false)) return;
    const schedule = ensureWeek();
    if (!schedule.active) return;
    const key = accounts.kanonisch(name);
    if (!key) return;
    const p = player(key);
    if (p.points >= PERSONAL_CAP) return;

    p.points += 1;
    state.total += 1;
    const rewards = [];
    for (const m of MILESTONES) {
      if (p.points >= m.points && !p.claimed.includes(m.points)) {
        p.claimed.push(m.points);
        const amount = award(key, m.reward);
        if (amount) rewards.push({ kind: "milestone", points: m.points, label: m.label, amount });
      }
    }

    if (state.total >= COMMUNITY_TARGET && !state.announced) {
      state.announced = true;
      chat.announce(io, `Der Wochenend-Pokal ist gemeinsam gefüllt. Alle Teilnehmenden erhalten ihre Gemeinschaftsbelohnung.`);
      try { require("./feed").add("event", "Der gemeinsame Wochenend-Pokal wurde gefüllt."); } catch {}
    }

    const communityAmount = rewardCommunityParticipant(key);
    if (communityAmount) rewards.push({ kind: "community", amount: communityAmount });

    /* Beim Freischalten bekommen auch die bisherigen Teilnehmenden sofort
       ihren Anteil. Wer spaeter einsteigt, erhaelt ihn nach der ersten Runde. */
    if (state.total >= COMMUNITY_TARGET) {
      for (const otherKey of Object.keys(state.players)) {
        if (otherKey === key) continue;
        const amount = rewardCommunityParticipant(otherKey);
        if (amount) emitPlayer(otherKey, { kind: "community", amount });
      }
    }
    save();
    emitPlayer(key, rewards.length ? { kind: "bundle", rewards } : null);
  });

  io.on("connection", (socket) => {
    socket.on("eventcalendar:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key || !accounts.get(key)) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      ack(publicState(key));
    });
  });

  return { publicState, ensureWeek, getState: () => state };
}

module.exports = {
  setupEventCalendar, scheduleAt, berlinToUtc,
  PERSONAL_CAP, COMMUNITY_TARGET, COMMUNITY_REWARD, MILESTONES,
};
