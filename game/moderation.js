"use strict";

const fs = require("fs");
const path = require("path");

const OWNER = "vincent";
const AUDIT_FILE = path.join(__dirname, "..", "data", "moderation-audit.jsonl");
const RANKS = Object.freeze({ 0: "Spieler", 1: "Helfer", 2: "Moderator", 3: "Leitmoderator", 4: "Besitzer" });
const READ_EVENTS = new Set([
  "admin:dashboard", "admin:listAccounts", "admin:strafen", "admin:regie",
  "admin:filterState", "admin:bilder", "admin:filterProbe", "admin:filterPruefeBestand",
  "admin:ipbanList", "admin:devicebanList", "admin:cityLots", "admin:kosmetikKatalog",
  "admin:sport", "admin:announcementState", "admin:team", "admin:audit", "admin:identityQueue",
]);

function level(acc, key) {
  if (String(key || "").toLowerCase() === OWNER) return 4;
  if (!acc) return 0;
  if (Number.isInteger(acc.modLevel) && acc.modLevel >= 1 && acc.modLevel <= 3) return acc.modLevel;
  return acc.rolle === "mod" ? 2 : 0;
}

function rank(acc, key) { return RANKS[level(acc, key)]; }

function record({ actor, action, target, details }) {
  const entry = {
    at: new Date().toISOString(), actor: String(actor || "system").slice(0, 40),
    action: String(action || "unknown").slice(0, 80),
    target: String(target || "").slice(0, 80),
    details: details && typeof details === "object" ? details : {},
  };
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}

function recent(limit = 100, offset = 0) {
  try {
    const rows = fs.readFileSync(AUDIT_FILE, "utf8").trim().split("\n").filter(Boolean);
    const size = Math.max(1, Math.min(200, Number(limit) || 100));
    const skip = Math.max(0, Math.floor(Number(offset) || 0));
    const selected = rows.slice(Math.max(0, rows.length - skip - size), Math.max(0, rows.length - skip));
    const entries = selected.reverse().flatMap((row) => { try { return [JSON.parse(row)]; } catch { return []; } });
    const nextOffset = skip + selected.length;
    return { entries, nextOffset, hasMore: rows.length > nextOffset };
  } catch { return { entries: [], nextOffset: 0, hasMore: false }; }
}

function auditSocket(socket, accounts) {
  socket.use((packet, next) => {
    const event = packet[0];
    if (typeof event !== "string" || !event.startsWith("admin:") || READ_EVENTS.has(event)) return next();
    const callbackIndex = packet.length - 1;
    const original = packet[callbackIndex];
    if (typeof original !== "function") return next();
    const payload = packet[1] && typeof packet[1] === "object" ? packet[1] : {};
    packet[callbackIndex] = (result) => {
      if (result && result.ok) {
        const key = socket.data.account;
        const acc = accounts.get(key);
        const details = {};
        // Keine Passwörter, echten Namen, Stufen oder Nachrichtentexte im Protokoll.
        for (const field of ["art", "minuten", "wert", "spiele", "rolle", "level", "action", "known", "amount", "neu", "on", "plotId", "districtId", "prozent", "freigrenze", "wort", "ziel", "id", "weg"]) {
          if (field in payload) details[field] = String(payload[field]).slice(0, 80);
        }
        if ("realName" in payload) details.nameGeaendert = "ja";
        if ("grade" in payload) details.stufeGeaendert = "ja";
        try {
          module.exports.record({ actor: acc ? acc.name : key, action: event, target: payload.target || payload.name || "", details });
        } catch (err) { console.error("Moderationsprotokoll konnte nicht geschrieben werden:", err); }
      }
      original(result);
    };
    next();
  });
}

module.exports = { OWNER, RANKS, level, rank, record, recent, auditSocket };
