"use strict";

/**
 * Vorschläge / Suggestions — players send game ideas straight to the owner.
 *
 * Anti-spam: max SUGGEST_PER_HOUR per account per rolling hour (in-memory).
 * Suggestions persist to data/suggestions.json so the owner sees them across
 * sessions. Only the owner ("vincent") can list/delete them.
 */

const path = require("path");
const fs = require("fs");

const OWNER = "vincent";
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "suggestions.json");
const SUGGEST_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const MAX_LEN = 500;
const MIN_LEN = 3;

let items = load();
function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, "utf8")); if (Array.isArray(d)) return d; } catch {}
  return [];
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items)); } catch {}
}

const rate = new Map(); // key -> [timestamps]
function recent(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < HOUR_MS);
  rate.set(key, list);
  return list;
}

function setupSuggestions(io, accounts) {
  const isOwner = (socket) => socket.data.account === OWNER;

  function ownerSocket() {
    for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === OWNER) return s;
    return null;
  }

  function stateFor(socket) {
    const key = socket.data.account;
    const used = key ? recent(key).length : 0;
    const out = { ok: true, perHour: SUGGEST_PER_HOUR, remaining: Math.max(0, SUGGEST_PER_HOUR - used), isOwner: isOwner(socket) };
    if (isOwner(socket)) out.items = [...items].sort((a, b) => b.at - a.at);
    return out;
  }

  io.on("connection", (socket) => {
    socket.on("suggest:state", (ack) => {
      if (typeof ack !== "function") return;
      ack(stateFor(socket));
    });

    socket.on("suggest:send", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      text = String(text || "").trim().slice(0, MAX_LEN);
      if (text.length < MIN_LEN) return ack({ ok: false, error: "Vorschlag ist zu kurz." });
      const key = socket.data.account;
      const used = recent(key);
      if (used.length >= SUGGEST_PER_HOUR)
        return ack({ ok: false, error: `Max. ${SUGGEST_PER_HOUR} Vorschläge pro Stunde — versuch es später nochmal.` });

      used.push(Date.now());
      const item = { name: acc.name, text, at: Date.now() };
      items.push(item);
      if (items.length > 1000) items = items.slice(-1000); // hard cap
      save();

      // Ping the owner if online.
      const os = ownerSocket();
      if (os) os.emit("suggest:new", { name: acc.name });

      ack({ ok: true, remaining: Math.max(0, SUGGEST_PER_HOUR - used.length) });
    });

    socket.on("suggest:delete", ({ at } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner(socket)) return ack({ ok: false, error: "Kein Zugriff." });
      const before = items.length;
      items = items.filter((i) => i.at !== at);
      if (items.length !== before) save();
      ack(stateFor(socket));
    });
  });
}

module.exports = { setupSuggestions, SUGGEST_PER_HOUR };
