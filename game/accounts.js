"use strict";

/**
 * Play-money account store, shared by the HTTP API (server.js) and the poker
 * tables (buy-in / cash-out). Single source of truth — both must go through
 * this module so chip balances never diverge.
 *
 * Persisted to data/accounts.json. PINs are stored as salted scrypt hashes.
 * This is play money for friends, not real security.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const STARTING_CHIPS = 1000;
const DAILY_BONUS = 500;
const DAILY_BONUS_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20h

let accounts = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function get(name) {
  return accounts[normalizeName(name)] || null;
}

function publicAccount(acc) {
  if (!acc) return null;
  return {
    name: acc.name,
    chips: acc.chips,
    createdAt: acc.createdAt,
    lastBonusAt: acc.lastBonusAt,
    stats: acc.stats,
    unlocked: acc.unlocked || ["lucky7"],
  };
}

function bonusAvailable(acc) {
  return Date.now() - (acc.lastBonusAt || 0) >= DAILY_BONUS_COOLDOWN_MS;
}

/** Create or authenticate. Returns { ok, created, account } or { ok:false, error }. */
function login(name, pin) {
  name = String(name || "").trim();
  pin = String(pin || "").trim();
  const key = normalizeName(name);

  if (!key || name.length < 2 || name.length > 16) {
    return { ok: false, error: "Name muss 2–16 Zeichen lang sein." };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "PIN muss genau 4 Ziffern haben." };
  }

  let acc = accounts[key];
  if (!acc) {
    const salt = crypto.randomBytes(16).toString("hex");
    acc = {
      name,
      salt,
      pinHash: hashPin(pin, salt),
      chips: STARTING_CHIPS,
      createdAt: Date.now(),
      lastBonusAt: 0,
      stats: { gamesPlayed: 0, handsWon: 0, biggestWin: 0 },
      unlocked: ["lucky7"],
    };
    accounts[key] = acc;
    save();
    return { ok: true, created: true, account: publicAccount(acc) };
  }

  if (acc.banned) return { ok: false, error: "Dein Account wurde gesperrt." };
  if (acc.pinHash !== hashPin(pin, acc.salt)) {
    return { ok: false, error: "Falsche PIN für diesen Namen." };
  }
  return { ok: true, created: false, account: publicAccount(acc) };
}

/** Claim daily bonus. Returns { ok, amount, account } or { ok:false, error, msLeft }. */
function claimDailyBonus(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (!bonusAvailable(acc)) {
    return {
      ok: false,
      error: "Bonus noch nicht verfügbar.",
      msLeft: DAILY_BONUS_COOLDOWN_MS - (Date.now() - acc.lastBonusAt),
    };
  }
  acc.chips += DAILY_BONUS;
  acc.lastBonusAt = Date.now();
  save();
  return { ok: true, amount: DAILY_BONUS, account: publicAccount(acc) };
}

/**
 * Add `delta` chips to an account (negative to deduct, e.g. table buy-in).
 * Returns { ok, account } or { ok:false, error }. Never goes below 0.
 */
function adjustChips(name, delta) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (acc.chips + delta < 0) return { ok: false, error: "Nicht genug Chips." };
  acc.chips += delta;
  save();
  return { ok: true, account: publicAccount(acc) };
}

/** Record a hand result for stats (winnings = net chips won in a hand). */
function recordHand(name, winnings) {
  const acc = get(name);
  if (!acc) return;
  acc.stats = acc.stats || { gamesPlayed: 0, handsWon: 0, biggestWin: 0 };
  acc.stats.gamesPlayed += 1;
  if (winnings > 0) {
    acc.stats.handsWon += 1;
    if (winnings > acc.stats.biggestWin) acc.stats.biggestWin = winnings;
  }
  save();
}

function leaderboard(limit = 10) {
  return Object.values(accounts)
    .sort((a, b) => b.chips - a.chips)
    .slice(0, limit)
    .map((a) => ({ name: a.name, chips: a.chips }));
}

function changePin(name, oldPin, newPin) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (acc.pinHash !== hashPin(String(oldPin), acc.salt))
    return { ok: false, error: "Alte PIN falsch." };
  if (!/^\d{4}$/.test(String(newPin)))
    return { ok: false, error: "Neue PIN muss genau 4 Ziffern haben." };
  acc.pinHash = hashPin(String(newPin), acc.salt);
  save();
  return { ok: true };
}

function ban(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.banned = true;
  save();
  return { ok: true };
}

function unban(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.banned = false;
  save();
  return { ok: true };
}

const TRANSFER_MIN_AGE_MS = 24 * 60 * 60 * 1000; // account must be 24h old to send

function transfer(fromName, toName, amount) {
  const fromKey = normalizeName(fromName);
  const toKey = normalizeName(toName);
  if (!fromKey || !toKey) return { ok: false, error: "Ungültiger Name." };
  if (fromKey === toKey) return { ok: false, error: "Kannst nicht an dich selbst senden." };
  const from = accounts[fromKey];
  const to = accounts[toKey];
  if (!from) return { ok: false, error: "Absender nicht gefunden." };
  if (!to) return { ok: false, error: `Spieler "${toName}" nicht gefunden.` };
  if (Date.now() - (from.createdAt || 0) < TRANSFER_MIN_AGE_MS)
    return { ok: false, error: "Dein Account muss mindestens 24 Stunden alt sein um Chips zu senden." };
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Ungültiger Betrag." };
  if (from.chips < amount) return { ok: false, error: "Nicht genug Chips." };
  from.chips -= amount;
  to.chips += amount;
  save();
  return { ok: true, fromAccount: publicAccount(from), toAccount: publicAccount(to) };
}

function deleteAccount(name) {
  const key = normalizeName(name);
  if (!accounts[key]) return { ok: false, error: "Account nicht gefunden." };
  delete accounts[key];
  save();
  return { ok: true };
}

function listAll() {
  return Object.values(accounts).map((a) => ({
    name: a.name,
    chips: a.chips,
    banned: !!a.banned,
  }));
}

/** Whether a machine is unlocked for this account (lucky7 is always free). */
function isUnlocked(name, machineId) {
  if (machineId === "lucky7") return true;
  const acc = get(name);
  if (!acc) return false;
  return (acc.unlocked || ["lucky7"]).includes(machineId);
}

/** Buy an unlock. Returns { ok, account } or { ok:false, error }. */
function unlock(name, machineId, cost) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.unlocked = acc.unlocked || ["lucky7"];
  if (acc.unlocked.includes(machineId)) return { ok: true, account: publicAccount(acc) };
  if (acc.chips < cost) return { ok: false, error: "Nicht genug Chips zum Freischalten." };
  acc.chips -= cost;
  acc.unlocked.push(machineId);
  save();
  return { ok: true, account: publicAccount(acc) };
}

module.exports = {
  STARTING_CHIPS,
  DAILY_BONUS,
  DAILY_BONUS_COOLDOWN_MS,
  get,
  publicAccount,
  login,
  claimDailyBonus,
  adjustChips,
  recordHand,
  leaderboard,
  isUnlocked,
  unlock,
  changePin,
  ban,
  unban,
  transfer,
  deleteAccount,
  listAll,
};
