"use strict";

/**
 * Clans / "Familien" — team up with friends.
 *
 * Found a clan (costs chips — a sink), pick a 2–4 letter tag & colour; others
 * join. One clan per player. The clan tag shows next to your name, there's a
 * clan leaderboard (ranked by combined member net worth), a member roster and
 * a private clan chat channel.
 *
 * Extended features:
 *  • SCHATZKAMMER (treasury): members donate chips into a shared vault.
 *  • CLAN-KRIEGE: ein Clan setzt Chips aus der Schatzkammer und fordert einen
 *    anderen heraus. Ueber ein paar Tage zaehlt die gemeinsam gesammelte
 *    Season-XP beider Seiten; wer mehr hat, nimmt den Topf minus Rake mit
 *    (unentschieden zahlt zurueck). Chips wandern nur zwischen Clans, der
 *    Rake ist die Senke → nicht farmbar. Der Tagesdeckel der Season sorgt
 *    dafuer, dass Teilnahme zaehlt und nicht ein einzelner Vielspieler.
 *  • WOCHENLIGA: dasselbe Mass ueber eine Woche; montags wird der beste Clan
 *    zum "Clan der Woche" gekuert.
 *  • ROLLEN & ANFRAGEN: founder + officers manage the clan (motto, kick, promote,
 *    closed clans with join requests).
 *
 * Persisted to data/clans.json as { clans, wars }. Membership also lives on the
 * account (acc.clan = clanId) so it survives with accounts.json.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "clans.json");

const CREATE_COST = 100000;
const COLORS = ["#e6b04b", "#5ea8e0", "#66c07a", "#c86bd6", "#e0705e", "#4fc7c0"];
const MAX_MEMBERS = 20;

// Clan wars
const WAR_RAKE = 0.10;
const WAR_MIN_STAKE = 10000;
const WAR_DAYS = { 1: 1, 3: 3, 7: 7 };   // allowed durations (days)
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_TOP_PRIZE = 250000;         // "Clan der Woche" treasury prize
const CLAN_XP_PER_PVP_WIN = 25;
const CLAN_LEVEL_STEP = 500;

/* ---------------------------------------------------------------------------
   CLAN-SEASON

   Der Clan-Fortschritt kam bisher AUSSCHLIESSLICH aus PvP-Duellsiegen
   (25 XP je Sieg). Gemessen an den echten Daten hiess das: alle drei Clans
   standen bei genau 25 XP, also einem einzigen Sieg, seit Monaten. Alles
   andere, was jemand spielte, zaehlte fuer seinen Clan gar nichts.

   Jetzt fliesst jede Season-XP eines Mitglieds auch in den Clan. Damit
   bringt jede Runde, die irgendwer dreht, die ganze Gruppe voran.

   Die Stufen zahlen abwechselnd in die Schatzkammer (alle koennen sie
   nutzen) und einen XP-Bonus fuer ALLE Mitglieder. Der Bonus ist der Kern:
   er macht es lohnend, Leute zu holen und sie bei der Stange zu halten,
   statt nur selbst zu spielen. Gedeckelt bei +25 %, damit die Rueckkopplung
   (mehr Bonus -> mehr XP -> mehr Bonus) nicht davonlaeuft.
--------------------------------------------------------------------------- */
const CLAN_SEASON_LEVELS = [
  { level: 1,  xp: 2000,  chips: 25000 },
  { level: 2,  xp: 5000,  bonus: 0.05 },
  { level: 3,  xp: 9000,  chips: 50000 },
  { level: 4,  xp: 14000, bonus: 0.10 },
  { level: 5,  xp: 20000, chips: 100000 },
  { level: 6,  xp: 27000, bonus: 0.15 },
  { level: 7,  xp: 35000, chips: 175000 },
  { level: 8,  xp: 44000, bonus: 0.20 },
  { level: 9,  xp: 54000, chips: 250000 },
  { level: 10, xp: 65000, bonus: 0.25, banner: true },
];

function clanSeasonState(c) {
  const xp = Math.max(0, Math.floor((c && c.seasonXp) || 0));
  const erreicht = CLAN_SEASON_LEVELS.filter((r) => xp >= r.xp);
  const naechste = CLAN_SEASON_LEVELS.find((r) => xp < r.xp) || null;
  const bonus = erreicht.reduce((b, r) => (r.bonus != null ? r.bonus : b), 0);
  return {
    xp,
    level: erreicht.length,
    bonus,
    nextXp: naechste ? naechste.xp : CLAN_SEASON_LEVELS[CLAN_SEASON_LEVELS.length - 1].xp,
    levels: CLAN_SEASON_LEVELS.map((r) => ({
      ...r,
      label: r.chips
        ? `${r.chips.toLocaleString("de-DE")} Chips in die Kasse`
        : r.banner
          ? `+${Math.round(r.bonus * 100)} % Season-XP für alle · Clan-Banner`
          : `+${Math.round(r.bonus * 100)} % Season-XP für alle`,
      erreicht: xp >= r.xp,
    })),
  };
}

/**
 * Season-XP eines Mitglieds dem Clan gutschreiben. Wird aus game/season.js
 * aufgerufen. Ueberschrittene Stufen zahlen sofort in die Schatzkammer.
 */
function addSeasonXp(key, amount) {
  const acc = _accounts && _accounts.get(key);
  const c = acc && acc.clan && clans[acc.clan];
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (!c || !gain) return;

  /* Dieselbe XP zaehlt an drei Stellen: Clan-Season, Wochenliga und ein
     laufender Krieg. Vorher haingen Liga und Krieg ausschliesslich an
     PvP-Duellsiegen — dem am wenigsten gespielten Teil der App. Deshalb
     standen alle drei Clans seit Monaten bei genau 25 XP und die Liga war
     jede Woche leer.

     Der Tagesdeckel der Season wirkt hier als natuerliche Bremse: ein
     einzelner Vielspieler kann seinen Clan nicht allein nach oben tragen,
     fuenf Leute, die normal spielen, schon. Genau so soll ein Clan sich
     anfuehlen. */
  c.weeklyXp = Math.max(0, Math.floor(c.weeklyXp || 0) + gain);
  const krieg = activeWarOf(c.id);
  if (krieg && krieg.state === "active") {
    if (krieg.aId === c.id) krieg.aScore += gain; else krieg.bScore += gain;
  }
  trackClanQuest(c, "aktiv", gain);

  const vorher = clanSeasonState(c).level;
  c.seasonXp = Math.max(0, Math.floor(c.seasonXp || 0) + gain);
  const nachher = clanSeasonState(c);
  if (nachher.level > vorher) {
    for (let l = vorher + 1; l <= nachher.level; l++) {
      const stufe = CLAN_SEASON_LEVELS.find((r) => r.level === l);
      if (stufe && stufe.chips) c.treasury = Math.max(0, Math.floor(c.treasury || 0) + stufe.chips);
      try {
        if (_io) {
          chat.announce(_io, `🏅 [${c.tag}] ${c.name} erreicht Clan-Stufe ${l}: ${
            stufe && stufe.chips
              ? `${stufe.chips.toLocaleString("de-DE")} 🪙 in die Schatzkammer`
              : `+${Math.round((stufe.bonus || 0) * 100)} % Season-XP für alle Mitglieder`
          }!`);
        }
      } catch {}
    }
  }
  save();
}

/** XP-Faktor, den ein Spieler durch seinen Clan bekommt (1 = kein Bonus). */
function seasonBonusFor(key) {
  const acc = _accounts && _accounts.get(key);
  const c = acc && acc.clan && clans[acc.clan];
  if (!c) return 1;
  return 1 + clanSeasonState(c).bonus;
}

/*
 * Woechentliche Clan-Auftraege.
 *
 * Vorher: zwei von drei verlangten Duellsiege. Wer keine Denkspiele spielt —
 * also die meisten — konnte fuer seinen Clan schlicht nichts tun. Jetzt
 * fuehrt der Hauptauftrag ueber normales Spielen, Duelle sind ein Bonus
 * daneben statt die Voraussetzung.
 */
const CLAN_QUESTS = [
  { id: "aktiv_2500", label: "Sammelt zusammen 2.500 Season-XP", type: "aktiv", target: 2500, xp: 220 },
  { id: "aktiv_8000", label: "Sammelt zusammen 8.000 Season-XP", type: "aktiv", target: 8000, xp: 560 },
  { id: "duels_5", label: "Gewinnt 5 Duelle gegeneinander", type: "pvp", target: 5, xp: 180 },
  { id: "donate_250k", label: "Spendet 250.000 in die Schatzkammer", type: "donate", target: 250000, xp: 240 },
];

let store = load();
let clans = store.clans;
let wars = store.wars;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw === "object") {
      if (raw.clans) return { clans: raw.clans, wars: Array.isArray(raw.wars) ? raw.wars : [] };
      return { clans: raw, wars: [] }; // migrate old format (file WAS the clans object)
    }
  } catch {}
  return { clans: {}, wars: [] };
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ clans, wars })); } catch {}
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clanRoom = (id) => "clan:" + id;

let _accounts = null;
let _io = null; // fuer Ankuendigungen aus addSeasonXp heraus

// Ensure a clan object has all newer fields (lazy migration).
function ensureClan(c) {
  if (!c) return c;
  if (typeof c.treasury !== "number") c.treasury = 0;
  if (typeof c.weeklyXp !== "number") c.weeklyXp = 0;
  if (typeof c.seasonXp !== "number") c.seasonXp = 0;
  if (!Array.isArray(c.log)) c.log = [];
  if (!Array.isArray(c.officers)) c.officers = [];
  if (typeof c.motto !== "string") c.motto = "";
  if (typeof c.closed !== "boolean") c.closed = false;
  if (!Array.isArray(c.requests)) c.requests = [];
  if (typeof c.weeklyWins !== "number") c.weeklyWins = 0;
  if (typeof c.totalWins !== "number") c.totalWins = 0;
  if (typeof c.xp !== "number") c.xp = 0;
  if (typeof c.totalXp !== "number") c.totalXp = c.xp || 0;
  ensureClanQuests(c);
  return c;
}

function weekKey() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function ensureClanQuests(c) {
  if (!c) return;
  const wk = weekKey();
  if (c.questWeek !== wk || !Array.isArray(c.quests)) {
    c.questWeek = wk;
    c.quests = CLAN_QUESTS.map((q) => ({ id: q.id, progress: 0, done: false }));
    return;
  }
  /* Auftraege, die es beim letzten Wochenwechsel noch nicht gab, nachtragen.
     Ohne das behalten bestehende Clans bis zum naechsten Montag ihre alte
     Liste, und ein neu eingefuehrter Auftrag bleibt die ganze Woche bei null:
     trackClanQuest findet den Eintrag nicht und ueberspringt ihn. Genau das
     ist beim Umbau auf die Aktivitaets-Auftraege passiert. */
  const vorhanden = new Set(c.quests.map((q) => q.id));
  for (const meta of CLAN_QUESTS) {
    if (!vorhanden.has(meta.id)) c.quests.push({ id: meta.id, progress: 0, done: false });
  }
  // Abgeschaffte Auftraege entfernen, damit die Liste nicht zuwaechst.
  const gueltig = new Set(CLAN_QUESTS.map((q) => q.id));
  c.quests = c.quests.filter((q) => gueltig.has(q.id));
}

/**
 * Kurzes Clan-Protokoll. Zwanzig Eintraege reichen, um nachzuvollziehen, wer
 * was mit der gemeinsamen Kasse gemacht hat.
 */
const LOG_MAX = 20;
function logClan(c, text) {
  if (!c) return;
  if (!Array.isArray(c.log)) c.log = [];
  c.log.unshift({ text: String(text).slice(0, 160), at: Date.now() });
  if (c.log.length > LOG_MAX) c.log.length = LOG_MAX;
}

function clanLevel(c) {
  const xp = Math.max(0, Math.floor((c && c.xp) || 0));
  const level = Math.floor(xp / CLAN_LEVEL_STEP) + 1;
  const xpInLevel = xp % CLAN_LEVEL_STEP;
  return { level, xp, xpInLevel, xpForNext: CLAN_LEVEL_STEP };
}

function addClanXp(c, amount) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!c || !amount) return;
  c.xp = Math.max(0, Math.floor(c.xp || 0) + amount);
  c.totalXp = Math.max(c.totalXp || 0, c.xp);
}

function clanQuestPublic(c) {
  ensureClanQuests(c);
  const byId = new Map((c.quests || []).map((q) => [q.id, q]));
  return CLAN_QUESTS.map((meta) => {
    const q = byId.get(meta.id) || { progress: 0, done: false };
    return {
      id: meta.id,
      label: meta.label,
      target: meta.target,
      progress: Math.min(meta.target, Math.floor(q.progress || 0)),
      done: !!q.done,
      xp: meta.xp,
    };
  });
}

function trackClanQuest(c, type, amount) {
  ensureClanQuests(c);
  let gained = 0;
  for (const meta of CLAN_QUESTS) {
    if (meta.type !== type) continue;
    const q = c.quests.find((x) => x.id === meta.id);
    if (!q || q.done) continue;
    q.progress = Math.min(meta.target, Math.floor(q.progress || 0) + Math.max(1, Math.floor(amount || 1)));
    if (q.progress >= meta.target) {
      q.done = true;
      gained += meta.xp;
    }
  }
  if (gained) addClanXp(c, gained);
  return gained;
}

/** Role of a member key within their clan: "founder" | "officer" | "member" | null. */
function roleOf(clanId, key) {
  const c = clans[clanId]; if (!c) return null;
  if (c.founder === key) return "founder";
  if ((c.officers || []).includes(key)) return "officer";
  if (c.members.includes(key)) return "member";
  return null;
}
const canManage = (clanId, key) => { const r = roleOf(clanId, key); return r === "founder" || r === "officer"; };

/** The clan tag of a player (for name decorations), or null. */
function tagOf(key) {
  const acc = _accounts && _accounts.get(key);
  const c = acc && acc.clan && clans[acc.clan];
  return c ? c.tag : null;
}
function clanColorOf(key) {
  const acc = _accounts && _accounts.get(key);
  const c = acc && acc.clan && clans[acc.clan];
  return c ? c.color : null;
}

function memberValue(key) {
  const acc = _accounts && _accounts.get(key);
  return acc ? (_accounts.publicAccount(acc).netWorth || 0) : 0;
}

function activeWarOf(clanId) {
  return wars.find((w) => (w.aId === clanId || w.bId === clanId) && (w.state === "pending" || w.state === "active")) || null;
}

function warPublic(w) {
  if (!w) return null;
  const a = clans[w.aId], b = clans[w.bId];
  return {
    id: w.id, state: w.state, stake: w.stake, days: w.days,
    aId: w.aId, aTag: a ? a.tag : "?", aName: a ? a.name : "?", aScore: w.aScore,
    bId: w.bId, bTag: b ? b.tag : "?", bName: b ? b.name : "?", bScore: w.bScore,
    endsAt: w.endsAt || null,
  };
}

function clanPublic(id) {
  const c = ensureClan(clans[id]);
  if (!c) return null;
  const members = c.members.map((k) => {
    const acc = _accounts && _accounts.get(k);
    return { key: k, name: acc ? acc.name : k, value: memberValue(k), role: roleOf(id, k) };
  }).sort((a, b) => b.value - a.value);
  return {
    id: c.id, name: c.name, tag: c.tag, color: c.color, founder: c.founder,
    motto: c.motto || "", closed: !!c.closed,
    treasury: c.treasury || 0, weeklyWins: c.weeklyWins || 0, totalWins: c.totalWins || 0,
    level: clanLevel(c), quests: clanQuestPublic(c),
    saison: clanSeasonState(c),
    weeklyXp: c.weeklyXp || 0,
    log: (c.log || []).slice(0, LOG_MAX),
    members, size: c.members.length, value: members.reduce((s, m) => s + m.value, 0),
    requests: (c.requests || []).map((k) => { const a = _accounts && _accounts.get(k); return { key: k, name: a ? a.name : k }; }),
    war: warPublic(activeWarOf(id)),
  };
}

function leaderboard(limit = 15) {
  return Object.keys(clans).map((id) => {
    const c = ensureClan(clans[id]);
    const value = c.members.reduce((s, k) => s + memberValue(k), 0);
    return { id: c.id, name: c.name, tag: c.tag, color: c.color, size: c.members.length, value };
  }).sort((a, b) => b.value - a.value).slice(0, limit);
}

/** Weekly clan league — ranked by PvP-duel wins this week. */
/**
 * Wochenliga. Gewertet wird die gemeinsam gesammelte Season-XP der Woche,
 * nicht mehr die Zahl der Duellsiege. Duellsiege stehen weiter dabei, aber
 * nur als Zusatzinfo — an ihnen haengt nichts mehr.
 */
function weeklyLeague(limit = 15) {
  return Object.keys(clans).map((id) => {
    const c = ensureClan(clans[id]);
    return {
      id: c.id, name: c.name, tag: c.tag, color: c.color,
      xp: c.weeklyXp || 0,
      wins: c.weeklyWins || 0,
      size: c.members.length,
    };
  }).filter((c) => c.xp > 0).sort((a, b) => b.xp - a.xp).slice(0, limit);
}

function adminRemoveMember(key) {
  key = String(key || "").trim().toLowerCase();
  if (!key) return { ok: false, changed: false };
  const removedClans = new Set();
  let changed = false;
  for (const id of Object.keys(clans)) {
    const c = ensureClan(clans[id]);
    c.members = Array.isArray(c.members) ? c.members : [];
    const beforeMembers = c.members.length;
    const beforeFounder = c.founder;
    c.members = c.members.filter((m) => m !== key);
    c.officers = (c.officers || []).filter((m) => m !== key);
    c.requests = (c.requests || []).filter((m) => m !== key);
    if (c.founder === key) c.founder = c.members[0] || null;
    if (c.members.length !== beforeMembers || c.founder !== beforeFounder) changed = true;
    if (!c.members.length) {
      delete clans[id];
      removedClans.add(id);
      changed = true;
    }
  }
  if (removedClans.size) {
    wars = wars.filter((w) => !removedClans.has(w.aId) && !removedClans.has(w.bId));
    store.wars = wars;
  }
  if (changed) save();
  return { ok: true, changed, removedClans: removedClans.size };
}

// ── PvP win hook (called by every PvP game on a decisive win) ───────────────
/** Record that `winnerKey` won a PvP duel: counts toward the clan weekly league
 *  and any active clan war, plus per-account counters for achievements. */
function recordPvpWin(winnerKey, game) {
  if (!winnerKey) return;
  const key = String(winnerKey).trim().toLowerCase();
  const acc = _accounts && _accounts.get(key);
  if (acc) {
    acc.pvpWins = (acc.pvpWins || 0) + 1;
    acc.pvpWinsByGame = acc.pvpWinsByGame || {};
    if (game) acc.pvpWinsByGame[game] = (acc.pvpWinsByGame[game] || 0) + 1;
  }
  const clanId = acc && acc.clan && clans[acc.clan] ? acc.clan : null;
  if (clanId) {
    const c = ensureClan(clans[clanId]);
    c.weeklyWins = (c.weeklyWins || 0) + 1;
    c.totalWins = (c.totalWins || 0) + 1;
    addClanXp(c, CLAN_XP_PER_PVP_WIN);
    trackClanQuest(c, "pvp", 1);
    const w = activeWarOf(clanId);
    if (w && w.state === "active") {
      if (w.aId === clanId) w.aScore++; else w.bScore++;
    }
  }
  if (_accounts) _accounts.save();
  save();
  // Fire achievement checks (lazy require to avoid a load cycle).
  try { require("./achievements").check(key); } catch {}
}

// ── Clan wars settlement ────────────────────────────────────────────────────
function settleWar(io, w, reason) {
  const a = clans[w.aId], b = clans[w.bId];
  if (w.state === "pending") {
    // Never accepted → refund the challenger's escrowed stake.
    if (a) { ensureClan(a); a.treasury += w.stake; }
    w.state = "done"; w.result = "expired";
    save();
    return;
  }
  const pot = w.stake * 2;
  let winId = null;
  if (w.aScore > w.bScore) winId = w.aId;
  else if (w.bScore > w.aScore) winId = w.bId;
  if (winId) {
    const wc = ensureClan(clans[winId]);
    const rake = Math.floor(pot * WAR_RAKE);
    wc.treasury += pot - rake;
    w.result = "win"; w.winnerId = winId; w.rake = rake;
    if (io) chat.announce(io, `⚔️ CLAN-KRIEG entschieden: [${wc.tag}] ${wc.name} schlägt [${(winId === w.aId ? b : a) ? (winId === w.aId ? b.tag : a.tag) : "?"}] ${w.aScore}:${w.bScore} und holt ${(pot - rake).toLocaleString("de-DE")} 🪙 in die Schatzkammer!`);
  } else {
    // Tie → refund both.
    if (a) { ensureClan(a); a.treasury += w.stake; }
    if (b) { ensureClan(b); b.treasury += w.stake; }
    w.result = "tie";
    if (io) chat.announce(io, `⚔️ CLAN-KRIEG endet unentschieden (${w.aScore}:${w.bScore}) — Einsätze zurück in die Schatzkammern.`);
  }
  w.state = "done";
  save();
}

/** Called from weekly.tick every minute: settle finished/expired wars. */
function tickWars(io) {
  const now = Date.now();
  let changed = false;
  for (const w of wars) {
    if (w.state === "active" && w.endsAt && now >= w.endsAt) { settleWar(io, w, "time"); changed = true; }
    else if (w.state === "pending" && w.expiresAt && now >= w.expiresAt) { settleWar(io, w, "expire"); changed = true; }
  }
  if (changed) {
    // Trim old finished wars (keep last 20).
    const done = wars.filter((w) => w.state === "done");
    if (done.length > 20) wars = wars.filter((w) => w.state !== "done").concat(done.slice(-20));
    store.wars = wars;
    io && io.emit("clan:update");
  }
}

/** Called from the weekly rollover: crown the "Clan der Woche", reset scores. */
function weeklyRollover(io) {
  const board = weeklyLeague(1);
  if (board.length && board[0].xp > 0) {
    const top = clans[board[0].id];
    if (top) { ensureClan(top); top.treasury += WEEKLY_TOP_PRIZE; }
    if (io) chat.announce(io, `🛡️ CLAN DER WOCHE: [${board[0].tag}] ${board[0].name} mit ${board[0].xp.toLocaleString("de-DE")} XP! ${WEEKLY_TOP_PRIZE.toLocaleString("de-DE")} 🪙 in die Schatzkammer.`);
  }
  for (const id of Object.keys(clans)) {
    const c = ensureClan(clans[id]);
    c.weeklyWins = 0;
    c.weeklyXp = 0;
  }
  save();
}

let _wid = Date.now();
const newWarId = () => "w" + (_wid++).toString(36);

function setupClans(io, accounts) {
  _accounts = accounts;
  _io = io;

  const myClan = (socket) => {
    const acc = socket.data.account && accounts.get(socket.data.account);
    return acc && acc.clan && clans[acc.clan] ? acc.clan : null;
  };
  const notifyClan = (id) => io.to(clanRoom(id)).emit("clan:update");

  io.on("connection", (socket) => {
    const rejoin = () => { const id = myClan(socket); if (id) socket.join(clanRoom(id)); };

    socket.on("clan:state", (ack) => {
      if (typeof ack !== "function") return;
      rejoin();
      const id = myClan(socket);
      ack({
        ok: true,
        clan: id ? clanPublic(id) : null,
        myRole: id ? roleOf(id, socket.data.account) : null,
        leaderboard: leaderboard(),
        weeklyLeague: weeklyLeague(),
        createCost: CREATE_COST,
        warConfig: { minStake: WAR_MIN_STAKE, rake: WAR_RAKE, days: Object.keys(WAR_DAYS).map(Number) },
      });
    });

    socket.on("clan:create", ({ name, tag } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (acc.clan && clans[acc.clan]) return ack({ ok: false, error: "Du bist schon in einem Clan." });
      name = String(name || "").trim().slice(0, 22);
      tag = String(tag || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      if (name.length < 3) return ack({ ok: false, error: "Name mind. 3 Zeichen." });
      if (tag.length < 2) return ack({ ok: false, error: "Tag 2–4 Buchstaben/Zahlen." });
      const id = slug(name);
      if (!id || clans[id]) return ack({ ok: false, error: "Name schon vergeben." });
      if (Object.values(clans).some((c) => c.tag === tag)) return ack({ ok: false, error: "Tag schon vergeben." });
      if (acc.chips < CREATE_COST) return ack({ ok: false, error: `Gründung kostet ${CREATE_COST.toLocaleString("de-DE")} 🪙.` });
      const key = socket.data.account;
      accounts.adjustChips(key, -CREATE_COST);
      const color = COLORS[Object.keys(clans).length % COLORS.length];
      clans[id] = ensureClan({ id, name, tag, color, founder: key, members: [key], createdAt: Date.now() });
      acc.clan = id; accounts.save(); save();
      socket.join(clanRoom(id));
      chat.announce(io, `🛡️ Neuer Clan gegründet: [${tag}] ${name} von ${acc.name}!`);
      ack({ ok: true, clan: clanPublic(id), account: accounts.publicAccount(acc) });
    });

    socket.on("clan:join", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (acc.clan && clans[acc.clan]) return ack({ ok: false, error: "Verlasse erst deinen Clan." });
      const c = ensureClan(clans[id]);
      if (!c) return ack({ ok: false, error: "Clan nicht gefunden." });
      if (c.members.length >= MAX_MEMBERS) return ack({ ok: false, error: `Clan ist voll (${MAX_MEMBERS}).` });
      const key = socket.data.account;
      if (c.closed) {
        // Closed clan → queue a join request instead of joining.
        if (!c.requests.includes(key)) c.requests.push(key);
        save(); notifyClan(id);
        return ack({ ok: true, requested: true });
      }
      c.members.push(key); acc.clan = id; accounts.save(); save();
      socket.join(clanRoom(id));
      notifyClan(id);
      ack({ ok: true, clan: clanPublic(id) });
    });

    socket.on("clan:leave", (ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc || !acc.clan || !clans[acc.clan]) return ack({ ok: false, error: "Du bist in keinem Clan." });
      const id = acc.clan, c = ensureClan(clans[id]), key = socket.data.account;
      c.members = c.members.filter((k) => k !== key);
      c.officers = (c.officers || []).filter((k) => k !== key);
      if (c.founder === key) c.founder = c.members[0] || null; // pass leadership
      if (!c.members.length) delete clans[id];
      delete acc.clan; accounts.save(); save();
      socket.leave(clanRoom(id));
      notifyClan(id);
      ack({ ok: true });
    });

    // ── Treasury ──
    socket.on("clan:donate", ({ amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      const id = myClan(socket);
      if (!acc || !id) return ack({ ok: false, error: "Du bist in keinem Clan." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 1) return ack({ ok: false, error: "Ungültiger Betrag." });
      if (acc.chips < amount) return ack({ ok: false, error: "Nicht genug Chips." });
      accounts.adjustChips(socket.data.account, -amount);
      const c = ensureClan(clans[id]); c.treasury += amount;
      trackClanQuest(c, "donate", amount);
      logClan(c, `${acc.name} spendet ${amount.toLocaleString("de-DE")} 🪙`);
      save();
      notifyClan(id);
      ack({ ok: true, clan: clanPublic(id), account: accounts.publicAccount(acc) });
    });

    /**
     * Aus der Schatzkammer an ein Mitglied auszahlen.
     *
     * Bisher fuehrte aus der Kasse ueberhaupt kein Weg heraus: man konnte nur
     * einspenden, und ausgegeben wurde sie ausschliesslich als Kriegseinsatz.
     * Bei "Die Buben" lagen dadurch 500.001 Chips tot herum. Damit war Spenden
     * ein Fass ohne Boden statt einer gemeinsamen Kasse.
     *
     * Auszahlen duerfen nur Gruender und Offiziere, und jede Auszahlung steht
     * mit Namen und Betrag im Clan-Protokoll und im Clan-Chat. Missbrauch ist
     * damit nicht verhindert, aber er ist fuer alle sichtbar — und das ist bei
     * einer Gruppe von Freunden die passende Bremse.
     */
    socket.on("clan:payout", ({ to, amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      const id = myClan(socket);
      if (!acc || !id) return ack({ ok: false, error: "Du bist in keinem Clan." });
      if (!canManage(id, socket.data.account)) return ack({ ok: false, error: "Nur Gründer und Offiziere dürfen auszahlen." });

      const c = ensureClan(clans[id]);
      const zielKey = String(to || "").trim().toLowerCase();
      if (!c.members.includes(zielKey)) return ack({ ok: false, error: "Diese Person ist nicht in deinem Clan." });
      const ziel = accounts.get(zielKey);
      if (!ziel) return ack({ ok: false, error: "Unbekanntes Mitglied." });

      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 1) return ack({ ok: false, error: "Ungültiger Betrag." });
      if ((c.treasury || 0) < amount) return ack({ ok: false, error: "So viel liegt nicht in der Schatzkammer." });

      c.treasury -= amount;
      accounts.adjustChips(zielKey, amount);
      const text = `${acc.name} zahlt ${amount.toLocaleString("de-DE")} 🪙 an ${ziel.name} aus`;
      logClan(c, text);
      try { if (_io) chat.announce(_io, `🛡️ [${c.tag}] ${text}.`); } catch {}
      save();
      notifyClan(id);
      ack({ ok: true, clan: clanPublic(id), account: accounts.publicAccount(acc) });
    });

    // ── Roles / management (founder + officers) ──
    socket.on("clan:setMotto", ({ motto } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      clans[id].motto = String(motto || "").trim().slice(0, 120); save(); notifyClan(id);
      ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:setClosed", ({ closed } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      clans[id].closed = !!closed; save(); notifyClan(id);
      ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:kick", ({ key } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const c = ensureClan(clans[id]);
      if (key === c.founder) return ack({ ok: false, error: "Gründer kann nicht gekickt werden." });
      if (roleOf(id, key) === "officer" && roleOf(id, socket.data.account) !== "founder")
        return ack({ ok: false, error: "Nur der Gründer kann Offiziere entfernen." });
      c.members = c.members.filter((k) => k !== key);
      c.officers = c.officers.filter((k) => k !== key);
      const target = accounts.get(key); if (target && target.clan === id) { delete target.clan; }
      accounts.save(); save(); notifyClan(id);
      // Kick the kicked player's socket out of the clan chat room.
      for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === key) s.leave(clanRoom(id));
      ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:promote", ({ key } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || roleOf(id, socket.data.account) !== "founder") return ack({ ok: false, error: "Nur der Gründer." });
      const c = ensureClan(clans[id]);
      if (!c.members.includes(key) || key === c.founder) return ack({ ok: false, error: "Ungültig." });
      if (!c.officers.includes(key)) c.officers.push(key);
      save(); notifyClan(id); ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:demote", ({ key } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || roleOf(id, socket.data.account) !== "founder") return ack({ ok: false, error: "Nur der Gründer." });
      const c = ensureClan(clans[id]); c.officers = c.officers.filter((k) => k !== key);
      save(); notifyClan(id); ack({ ok: true, clan: clanPublic(id) });
    });

    // ── Join requests (closed clans) ──
    socket.on("clan:approveRequest", ({ key } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const c = ensureClan(clans[id]);
      if (!c.requests.includes(key)) return ack({ ok: false, error: "Keine Anfrage." });
      c.requests = c.requests.filter((k) => k !== key);
      const target = accounts.get(key);
      if (target && !target.clan && c.members.length < MAX_MEMBERS) {
        c.members.push(key); target.clan = id; accounts.save();
        for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === key) s.join(clanRoom(id));
      }
      save(); notifyClan(id); ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:denyRequest", ({ key } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const c = ensureClan(clans[id]); c.requests = c.requests.filter((k) => k !== key);
      save(); notifyClan(id); ack({ ok: true, clan: clanPublic(id) });
    });

    // ── Clan wars ──
    socket.on("clan:declareWar", ({ targetId, stake, days } = {}, ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const c = ensureClan(clans[id]);
      const target = ensureClan(clans[targetId]);
      if (!target || targetId === id) return ack({ ok: false, error: "Ungültiger Gegner." });
      if (activeWarOf(id)) return ack({ ok: false, error: "Dein Clan ist schon im Krieg." });
      if (activeWarOf(targetId)) return ack({ ok: false, error: "Der Gegner ist schon im Krieg." });
      stake = Math.floor(Number(stake));
      if (!Number.isFinite(stake) || stake < WAR_MIN_STAKE) return ack({ ok: false, error: `Mindesteinsatz ${WAR_MIN_STAKE.toLocaleString("de-DE")} 🪙.` });
      if (c.treasury < stake) return ack({ ok: false, error: "Nicht genug in der Schatzkammer." });
      days = WAR_DAYS[days] || 3;
      c.treasury -= stake; // escrow
      const w = { id: newWarId(), aId: id, bId: targetId, stake, days, aScore: 0, bScore: 0, state: "pending", createdAt: Date.now(), expiresAt: Date.now() + DAY_MS };
      wars.push(w); store.wars = wars; save();
      notifyClan(id); notifyClan(targetId);
      chat.announce(io, `⚔️ [${c.tag}] ${c.name} fordert [${target.tag}] ${target.name} zum CLAN-KRIEG (${stake.toLocaleString("de-DE")} 🪙, ${days} Tage)!`);
      ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:acceptWar", (ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const w = wars.find((x) => x.bId === id && x.state === "pending");
      if (!w) return ack({ ok: false, error: "Keine offene Kriegs-Herausforderung." });
      const c = ensureClan(clans[id]);
      if (c.treasury < w.stake) return ack({ ok: false, error: "Nicht genug in der Schatzkammer für den Einsatz." });
      c.treasury -= w.stake; // escrow
      w.state = "active"; w.endsAt = Date.now() + w.days * DAY_MS; save();
      notifyClan(w.aId); notifyClan(w.bId);
      const a = clans[w.aId];
      chat.announce(io, `⚔️ CLAN-KRIEG LÄUFT: [${a.tag}] vs [${c.tag}] um ${(w.stake * 2).toLocaleString("de-DE")} 🪙 — jeder Duell-Sieg zählt!`);
      ack({ ok: true, clan: clanPublic(id) });
    });
    socket.on("clan:declineWar", (ack) => {
      if (typeof ack !== "function") return;
      const id = myClan(socket);
      if (!id || !canManage(id, socket.data.account)) return ack({ ok: false, error: "Keine Berechtigung." });
      const w = wars.find((x) => x.bId === id && x.state === "pending");
      if (!w) return ack({ ok: false, error: "Keine offene Herausforderung." });
      settleWar(io, w, "declined"); // refunds challenger
      notifyClan(w.aId); notifyClan(w.bId);
      ack({ ok: true, clan: clanPublic(id) });
    });

    // Owner-only: force-settle every open war now (admin tool / testing).
    socket.on("clan:adminSettleWars", (ack) => {
      if (socket.data.account !== "vincent") return ack && ack({ ok: false, error: "Kein Zugriff." });
      for (const w of wars) if (w.state === "active" || w.state === "pending") settleWar(io, w, "admin");
      io.emit("clan:update");
      ack && ack({ ok: true });
    });
  });
}

module.exports = {
  setupClans, tagOf, clanColorOf,
  recordPvpWin, tickWars, weeklyRollover,
  adminRemoveMember,
  addSeasonXp, seasonBonusFor, clanSeasonState,
};
