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
const SECRET_FILE = path.join(DATA_DIR, ".secret");

const STARTING_CHIPS = 5000; // ein erster Abend Spielgeld — weit unter jedem Hauspreis
// Hard anti-cheat ceiling: no account may hold more than this. Enforced on every
// chip change AND swept periodically (see startChipCapSweep), so old exploited
// balances (the bot-faucet trillions) get clamped down automatically and forever.
const MAX_CHIPS = 100_000_000_000; // 100 Mrd. — far above any legit balance
// HOURLY bonus — the economy's "salary". Hourly instead of daily so active
// players progress fast (user request): an evening of play funds a house, the
// games themselves stay <100% RTP. (Export names keep the legacy DAILY_ prefix
// for API stability.)
const DAILY_BONUS = 1000;                    // per claim (1×/hour)
const DAILY_BONUS_COOLDOWN_MS = 60 * 60 * 1000; // 1h

// Claim streak: each consecutive hourly claim (within the grace window) adds
// STREAK_STEP, capped at STREAK_MAX extra claims → max +2.500.
const STREAK_STEP = 250;
const STREAK_MAX = 10;

// Street tribute: each complete street monopoly adds to every hourly bonus.
// The weekly GOLDEN street counts double.
const STREET_TRIBUTE = 2000;
const STREET_TRIBUTE_CAP = 10; // at most 10 streets pay tribute (max +20.000/h)

// House tribute: EVERY owned building pays a little rent with the hourly
// bonus — capped so hoarding thousands of cheap houses isn't a money printer.
const HOUSE_TRIBUTE = 200;
const HOUSE_TRIBUTE_CAP = 100; // max 100 houses count (→ +20.000/h)

// Cashback (like a real casino's loyalty program): a cut of your house-game
// losses since the last claim comes back with the next bonus. Bounded by
// actual losses → mathematically safe, can't be farmed. The Kirchenpatron
// trophy upgrades both numbers ("Segen").
const CASHBACK_RATE = 0.10;
const CASHBACK_CAP = 25000;          // per hourly claim
const CASHBACK_RATE_BLESSED = 0.15;  // ⛪ Kirche
const CASHBACK_CAP_BLESSED = 50000;  // ⛪ Kirche
const STREAK_GRACE_MS = 2 * DAILY_BONUS_COOLDOWN_MS; // miss this window → streak resets

// Pleite-Schutz: keep a broke player in the game without waiting for the bonus.
const RESCUE_THRESHOLD = 50;       // only available when chips are below this
const RESCUE_TO = 150;             // tops the balance up to this amount
const RESCUE_COOLDOWN_MS = 10 * 60 * 1000; // 10 min, bounds any farming

// Brute-force protection on PIN login.
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000; // 5 min lockout after too many wrong PINs
const loginFails = new Map(); // key -> { count, until }

let accounts = load();
startChipCapSweep(); // permanent anti-cheat chip ceiling

// Server secret for signing session tokens. Persisted in the data volume so
// tokens survive redeploys; generated once on first run.
const SECRET = loadSecret();

function loadSecret() {
  try {
    const s = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (s) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  } catch {}
  return s;
}

/** Issue a signed, stateless session token for an account name. */
function issueToken(name) {
  const payload = `${normalizeName(name)}|${Date.now()}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64") + "." + sig;
}

/**
 * Verify a session token. Returns the normalized account key on success,
 * or null if the token is missing, malformed, forged, or the account is gone.
 */
function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  let payload;
  try {
    payload = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig || "", "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const key = payload.split("|")[0];
  if (!key || !accounts[key] || accounts[key].banned) return null;
  return key;
}

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

// Permanently-active anti-cheat: every few minutes, clamp any account over the
// ceiling (catches direct chip mutations like casino rake, and cleans up old
// exploited balances even if the player is offline).
function startChipCapSweep() {
  setInterval(() => {
    let changed = false;
    for (const acc of Object.values(accounts)) {
      if (acc && typeof acc.chips === "number" && acc.chips > MAX_CHIPS) { acc.chips = MAX_CHIPS; changed = true; }
    }
    if (changed) save();
  }, 3 * 60 * 1000).unref();
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

// Net worth = liquid chips + value of everything owned in the shared city
// minus any outstanding loan (a liability).
const city = require("./city");
const bank = require("./bank");
const stocks = require("./stocks");

function _netWorth(acc) {
  const worth = acc.chips || 0;
  const debt = acc.loan ? bank.loanOwed(acc.loan) : 0;
  const key = normalizeName(acc.name);
  return worth + city.ownerValue(key) + stocks.portfolioValue(key) - debt;
}

// ─── Buffs (from business products) ─────────────────────────────────────────
/** Active buffs for an account, with expired ones pruned. { type: {until, mult} } */
function activeBuffs(acc) {
  if (!acc || !acc.buffs) return {};
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(acc.buffs)) {
    if (acc.buffs[k].until <= now) { delete acc.buffs[k]; changed = true; }
  }
  if (changed) save();
  return acc.buffs;
}

function grantBuff(name, type, mins, mult) {
  const acc = get(name);
  if (!acc) return;
  acc.buffs = acc.buffs || {};
  const until = Date.now() + mins * 60000;
  // Refresh/extend: keep the stronger multiplier and the later expiry.
  const cur = acc.buffs[type];
  acc.buffs[type] = { until: Math.max(until, cur ? cur.until : 0), mult: Math.max(mult || 1, cur ? cur.mult || 1 : 1) };
  save();
}

/** Multiplier for a legacy timed buff (1 if inactive). Ownership no longer
 *  grants buffs — city perks come from unique TROPHY buildings instead
 *  (city.hasTrophy), wired directly where they apply. */
function buffMult(name, type) {
  const acc = get(name);
  const b = acc && acc.buffs && acc.buffs[type];
  return b && b.until > Date.now() ? (b.mult || 1) : 1;
}
/** Whether a (legacy timed) buff is currently active. */
function hasBuff(name, type) {
  return buffMult(name, type) > 1;
}

// ─── Inventory (product items you can use or resell) ────────────────────────
function getInventory(name) {
  const acc = get(name);
  return (acc && acc.inventory) || {};
}
function addItem(name, key, n = 1) {
  const acc = get(name);
  if (!acc) return;
  acc.inventory = acc.inventory || {};
  acc.inventory[key] = (acc.inventory[key] || 0) + n;
  save();
}
function removeItem(name, key, n = 1) {
  const acc = get(name);
  if (!acc || !acc.inventory || (acc.inventory[key] || 0) < n) return false;
  acc.inventory[key] -= n;
  if (acc.inventory[key] <= 0) delete acc.inventory[key];
  save();
  return true;
}

function publicAccount(acc) {
  if (!acc) return null;
  return {
    name: acc.name,
    chips: acc.chips,
    createdAt: acc.createdAt,
    lastBonusAt: acc.lastBonusAt,
    bonusStreak: acc.bonusStreak || 0,
    stats: acc.stats,
    unlocked: acc.unlocked || ["lucky7"],
    netWorth: _netWorth(acc),
    buffs: acc.buffs ? activeBuffs(acc) : {},
    residence: acc.residence != null ? { id: acc.residence, ...city.bldInfo(acc.residence) } : null,
  };
}

function bonusAvailable(acc) {
  return Date.now() - (acc.lastBonusAt || 0) >= DAILY_BONUS_COOLDOWN_MS;
}

/** Create or authenticate. Returns { ok, created, account, token } or { ok:false, error }. */
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

  // Brute-force lockout (per account name).
  const lock = loginFails.get(key);
  if (lock && lock.until > Date.now()) {
    const minLeft = Math.ceil((lock.until - Date.now()) / 60000);
    return { ok: false, error: `Zu viele Fehlversuche. Versuche es in ${minLeft} Min erneut.` };
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
    return { ok: true, created: true, account: publicAccount(acc), token: issueToken(name) };
  }

  if (acc.banned) return { ok: false, error: "Dein Account wurde gesperrt." };
  if (acc.pinHash !== hashPin(pin, acc.salt)) {
    const fails = (lock && lock.until > Date.now() ? lock.count : (lock ? lock.count : 0)) + 1;
    if (fails >= LOGIN_MAX_FAILS) {
      loginFails.set(key, { count: 0, until: Date.now() + LOGIN_LOCK_MS });
      return { ok: false, error: "Zu viele Fehlversuche. Account für 5 Min gesperrt." };
    }
    loginFails.set(key, { count: fails, until: 0 });
    return { ok: false, error: "Falsche PIN für diesen Namen." };
  }
  loginFails.delete(key); // successful login clears the counter
  return { ok: true, created: false, account: publicAccount(acc), token: issueToken(acc.name) };
}

/** Claim daily bonus. Returns { ok, amount, streak, account } or { ok:false, error, msLeft }. */
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
  const now = Date.now();
  const key = normalizeName(acc.name);
  // Schulleiter trophy: education sticks — the streak NEVER expires and each
  // streak step counts double.
  const schule = city.hasTrophy(key, "schule");
  const onTime = schule || (acc.lastBonusAt && now - acc.lastBonusAt <= STREAK_GRACE_MS);
  acc.bonusStreak = onTime ? (acc.bonusStreak || 1) + 1 : 1;
  const streakBonus = Math.min(acc.bonusStreak - 1, STREAK_MAX) * STREAK_STEP * (schule ? 2 : 1);
  // Bahnhofs-Baron trophy: commuters bring money — hourly bonus ×1.5.
  const pendler = city.hasTrophy(key, "bahnhof") ? 1.5 : 1;
  const base = Math.round((DAILY_BONUS + streakBonus) * pendler);
  // Street tribute: complete streets pay when you show up; the weekly GOLDEN
  // street pays double.
  const streets = Math.min(city.streetCount(key), STREET_TRIBUTE_CAP);
  const golden = city.ownsGolden(key) ? STREET_TRIBUTE : 0;
  const tribute = streets * STREET_TRIBUTE + golden;
  // House tribute: every owned building pays a little (capped).
  const housesOwned = city.houseCount(key);
  const houses = Math.min(housesOwned, HOUSE_TRIBUTE_CAP) * HOUSE_TRIBUTE;
  // Collection sets (Stadtbekannt, Kaffee-Kartell …).
  const setList = city.setsOf(key);
  const sets = setList.reduce((s, x) => s + x.tribute, 0);
  // Loss cashback since the last claim — blessed players (⛪) get more back.
  const blessed = city.hasTrophy(key, "kirche");
  const cashback = Math.min(
    blessed ? CASHBACK_CAP_BLESSED : CASHBACK_CAP,
    Math.floor((acc.lossSince || 0) * (blessed ? CASHBACK_RATE_BLESSED : CASHBACK_RATE))
  );
  acc.lossSince = 0;
  const amount = base + tribute + houses + sets + cashback;
  acc.chips += amount;
  acc.lastBonusAt = now;
  save();
  return {
    ok: true, amount, base, tribute, streets, golden, houses, housesOwned,
    sets, setList, cashback, streak: acc.bonusStreak, account: publicAccount(acc),
  };
}

/**
 * Pleite-Schutz: top a nearly-broke balance back up so the player can keep
 * playing instead of waiting out the bonus cooldown. Rate-limited to bound abuse.
 * Returns { ok, amount, account } or { ok:false, error, msLeft }.
 */
function rescue(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (acc.chips >= RESCUE_THRESHOLD)
    return { ok: false, error: "Du hast noch genug Chips." };
  // Kirchenpatron trophy: blessed — double top-up, half cooldown.
  const blessed = city.hasTrophy(normalizeName(acc.name), "kirche");
  const cooldown = blessed ? RESCUE_COOLDOWN_MS / 2 : RESCUE_COOLDOWN_MS;
  const since = Date.now() - (acc.lastRescueAt || 0);
  if (since < cooldown)
    return { ok: false, error: "Soforthilfe gerade erst genutzt.", msLeft: cooldown - since };
  const target = Math.round(RESCUE_TO * (blessed ? 2 : 1));
  const amount = target - acc.chips;
  acc.chips = target;
  acc.lastRescueAt = Date.now();
  save();
  return { ok: true, amount, account: publicAccount(acc) };
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
  if (acc.chips > MAX_CHIPS) acc.chips = MAX_CHIPS; // anti-cheat ceiling
  save();
  return { ok: true, account: publicAccount(acc) };
}

const CASINO_RAKE = 0.05; // 5% of a player's house-game losses go to the casino owner

/**
 * Record a hand result for stats (winnings = net chips won/lost in a single round).
 * For house games (slots/roulette/blackjack — `house` true), 5% of any loss is
 * raked to whoever owns the Casino in the shared city. Pass house=false for
 * player-vs-player games (poker, PvP slots) so they stay zero-sum.
 */
// Listeners fired after every recorded hand (achievements etc.) — registered
// via onHand() to avoid a circular require.
const handListeners = [];
const onHand = (cb) => handListeners.push(cb);

function recordHand(name, winnings, house = true, game = null) {
  const acc = get(name);
  if (!acc) return;
  acc.stats = acc.stats || { gamesPlayed: 0, handsWon: 0, biggestWin: 0, biggestLoss: 0 };
  if (acc.stats.biggestLoss === undefined) acc.stats.biggestLoss = 0;
  acc.stats.gamesPlayed += 1;
  acc.weeklyNet = (acc.weeklyNet || 0) + winnings; // Spieler-der-Woche race (weekly.js resets)
  // Per-game breakdown (plays / wins / net) for the stats screen.
  if (game) {
    acc.stats.perGame = acc.stats.perGame || {};
    const g = acc.stats.perGame[game] || (acc.stats.perGame[game] = { plays: 0, wins: 0, net: 0 });
    g.plays += 1; g.net += winnings; if (winnings > 0) g.wins += 1;
  }
  if (winnings > 0) {
    acc.stats.handsWon += 1;
    if (winnings > acc.stats.biggestWin) acc.stats.biggestWin = winnings;
  } else if (winnings < 0) {
    const loss = -winnings;
    if (loss > acc.stats.biggestLoss) acc.stats.biggestLoss = loss;
    if (house) {
      acc.lossSince = (acc.lossSince || 0) + loss; // feeds the daily cashback
      // Casino owner's house edge: a cut of the loss materialises as their income.
      const owner = city.casinoOwner();
      if (owner && owner !== normalizeName(name)) {
        const rake = Math.floor(loss * CASINO_RAKE);
        const o = accounts[owner];
        if (rake > 0 && o) o.chips += rake; // save() below persists it
      }
    }
  }
  save();
  for (const cb of handListeners) { try { cb(name, winnings, house, game); } catch {} }
}

const LEADERBOARD_CATS = {
  rich:    { sort: (a) => a.chips,                    label: "💰 Reichste" },
  week:    { sort: (a) => a.weeklyNet || 0,           label: "🔥 Spieler der Woche" },
  estate:  { sort: (a) => city.ownerValue(normalizeName(a.name)), label: "🏘️ Immobilien-Mogul" },
  streets: { sort: (a) => city.streetCount(normalizeName(a.name)), label: "👑 Straßenkönig" },
  bigwin:  { sort: (a) => (a.stats && a.stats.biggestWin) || 0,  label: "🎰 Größter Einzelgewinn" },
  bigloss: { sort: (a) => (a.stats && a.stats.biggestLoss) || 0, label: "💸 Größter Einzelverlust" },
  games:   { sort: (a) => (a.stats && a.stats.gamesPlayed) || 0, label: "🎲 Aktivste" },
};

/** One ranked list for a single category. */
function leaderboardBy(cat, limit = 10) {
  const c = LEADERBOARD_CATS[cat];
  if (!c) return [];
  // Lazy requires: achievements holds the title emoji, weekly the champ crown.
  const achievements = require("./achievements");
  const weekly = require("./weekly");
  const champ = weekly.champName();
  return Object.values(accounts)
    .map((a) => ({
      name: a.name, value: c.sort(a), chips: a.chips,
      badge: a.badge ? achievements.emojiOf(a.badge) : null,
      champ: champ != null && normalizeName(a.name) === champ,
    }))
    .filter((x) => x.value > 0 || cat === "rich")
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Raw account objects (weekly.js needs weeklyNet of everyone). */
function rawAll() {
  return Object.values(accounts);
}

/** All leaderboard categories at once (one fetch, client switches tabs). */
function leaderboard(limit = 10) {
  const out = {};
  for (const cat of Object.keys(LEADERBOARD_CATS)) {
    out[cat] = { label: LEADERBOARD_CATS[cat].label, entries: leaderboardBy(cat, limit) };
  }
  return out;
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

// ─── Wohnsitz (residence — pure social flavour, free) ──────────────────────
function setResidence(name, buildingId) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (buildingId == null) { delete acc.residence; save(); return { ok: true, residence: null }; }
  if (!city.bldExists(buildingId)) return { ok: false, error: "Gebäude nicht gefunden." };
  acc.residence = Number(buildingId);
  save();
  return { ok: true, residence: acc.residence };
}

/** Map buildingId -> [names] of everyone who set their residence there. */
function residentsByBuilding() {
  const out = {};
  for (const acc of Object.values(accounts)) {
    if (acc.residence == null) continue;
    (out[acc.residence] = out[acc.residence] || []).push(acc.name);
  }
  return out;
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
  save,
  get,
  publicAccount,
  login,
  verifyToken,
  claimDailyBonus,
  rescue,
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
  grantBuff,
  buffMult,
  hasBuff,
  activeBuffs,
  getInventory,
  addItem,
  removeItem,
  setResidence,
  residentsByBuilding,
  onHand,
  rawAll,
};
