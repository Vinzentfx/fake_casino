"use strict";

/**
 * Clans / "Familien" — team up with friends.
 *
 * Found a clan (costs chips — a sink), pick a 2–4 letter tag & colour; others
 * join. One clan per player. The clan tag shows next to your name, there's a
 * clan leaderboard (ranked by combined member net worth), a member roster and
 * a private clan chat channel.
 *
 * Persisted to data/clans.json. Membership also lives on the account
 * (acc.clan = clanId) so it survives with accounts.json.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "clans.json");

const CREATE_COST = 100000;
const COLORS = ["#e6b04b", "#5ea8e0", "#66c07a", "#c86bd6", "#e0705e", "#4fc7c0"];

let clans = load();
function load() {
  try { const c = JSON.parse(fs.readFileSync(FILE, "utf8")); if (c && typeof c === "object") return c; } catch {}
  return {};
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(clans)); } catch {}
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clanRoom = (id) => "clan:" + id;

let _accounts = null;

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

function clanPublic(id) {
  const c = clans[id];
  if (!c) return null;
  const members = c.members.map((k) => {
    const acc = _accounts && _accounts.get(k);
    return { name: acc ? acc.name : k, value: memberValue(k), founder: k === c.founder };
  }).sort((a, b) => b.value - a.value);
  return {
    id: c.id, name: c.name, tag: c.tag, color: c.color, founder: c.founder,
    members, size: c.members.length, value: members.reduce((s, m) => s + m.value, 0),
  };
}

function leaderboard(limit = 15) {
  return Object.keys(clans).map((id) => {
    const c = clans[id];
    const value = c.members.reduce((s, k) => s + memberValue(k), 0);
    return { id: c.id, name: c.name, tag: c.tag, color: c.color, size: c.members.length, value };
  }).sort((a, b) => b.value - a.value).slice(0, limit);
}

function setupClans(io, accounts) {
  _accounts = accounts;

  const myClan = (socket) => {
    const acc = socket.data.account && accounts.get(socket.data.account);
    return acc && acc.clan && clans[acc.clan] ? acc.clan : null;
  };

  io.on("connection", (socket) => {
    // Join the clan chat room on (re)connect if in a clan.
    const rejoin = () => { const id = myClan(socket); if (id) socket.join(clanRoom(id)); };
    socket.on("clan:state", (ack) => {
      if (typeof ack !== "function") return;
      rejoin();
      const id = myClan(socket);
      ack({ ok: true, clan: id ? clanPublic(id) : null, leaderboard: leaderboard(), createCost: CREATE_COST });
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
      clans[id] = { id, name, tag, color, founder: key, members: [key], createdAt: Date.now() };
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
      const c = clans[id];
      if (!c) return ack({ ok: false, error: "Clan nicht gefunden." });
      if (c.members.length >= 20) return ack({ ok: false, error: "Clan ist voll (20)." });
      const key = socket.data.account;
      c.members.push(key); acc.clan = id; accounts.save(); save();
      socket.join(clanRoom(id));
      io.to(clanRoom(id)).emit("clan:update");
      ack({ ok: true, clan: clanPublic(id) });
    });

    socket.on("clan:leave", (ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc || !acc.clan || !clans[acc.clan]) return ack({ ok: false, error: "Du bist in keinem Clan." });
      const id = acc.clan, c = clans[id], key = socket.data.account;
      c.members = c.members.filter((k) => k !== key);
      if (c.founder === key) c.founder = c.members[0] || null; // pass leadership
      if (!c.members.length) delete clans[id];
      delete acc.clan; accounts.save(); save();
      socket.leave(clanRoom(id));
      io.to(clanRoom(id)).emit("clan:update");
      ack({ ok: true });
    });
  });
}

module.exports = { setupClans, tagOf, clanColorOf };
