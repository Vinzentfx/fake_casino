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
 *  • CLAN-KRIEGE: a clan stakes treasury chips and challenges another clan; over
 *    a few days each member PvP-duel win scores a point, the higher score takes
 *    the pot minus rake into its treasury (a tie refunds). Chips only move
 *    between clans (rake is the sink) → not farmable.
 *  • WOCHENLIGA: every member PvP win also counts toward the clan's weekly score;
 *    at the Monday rollover the top clan is crowned "Clan der Woche".
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

// Ensure a clan object has all newer fields (lazy migration).
function ensureClan(c) {
  if (!c) return c;
  if (typeof c.treasury !== "number") c.treasury = 0;
  if (!Array.isArray(c.officers)) c.officers = [];
  if (typeof c.motto !== "string") c.motto = "";
  if (typeof c.closed !== "boolean") c.closed = false;
  if (!Array.isArray(c.requests)) c.requests = [];
  if (typeof c.weeklyWins !== "number") c.weeklyWins = 0;
  if (typeof c.totalWins !== "number") c.totalWins = 0;
  return c;
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
function weeklyLeague(limit = 15) {
  return Object.keys(clans).map((id) => {
    const c = ensureClan(clans[id]);
    return { id: c.id, name: c.name, tag: c.tag, color: c.color, wins: c.weeklyWins || 0, size: c.members.length };
  }).filter((c) => c.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, limit);
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
  if (board.length && board[0].wins > 0) {
    const top = clans[board[0].id];
    if (top) { ensureClan(top); top.treasury += WEEKLY_TOP_PRIZE; }
    if (io) chat.announce(io, `🛡️ CLAN DER WOCHE: [${board[0].tag}] ${board[0].name} mit ${board[0].wins} Duell-Siegen! ${WEEKLY_TOP_PRIZE.toLocaleString("de-DE")} 🪙 in die Schatzkammer.`);
  }
  for (const id of Object.keys(clans)) { ensureClan(clans[id]).weeklyWins = 0; }
  save();
}

let _wid = Date.now();
const newWarId = () => "w" + (_wid++).toString(36);

function setupClans(io, accounts) {
  _accounts = accounts;

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
      const c = ensureClan(clans[id]); c.treasury += amount; save();
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
};
