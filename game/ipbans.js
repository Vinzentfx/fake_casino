"use strict";

/**
 * IP-Bans — Owner-Tool, um eine IP-Adresse komplett auszusperren (unabhängig
 * vom Account). Persistiert in data/ipbans.json (überlebt Neustarts im
 * Railway-Volume). Gesperrte IPs werden bei jeder neuen Verbindung getrennt.
 */

const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "data", "ipbans.json");

let banned = new Set();
try {
  const arr = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (Array.isArray(arr)) banned = new Set(arr.map(String));
} catch {}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify([...banned]));
  } catch {}
}

/** Normalisiert eine IP: nimmt bei x-forwarded-for die erste, entfernt IPv4-in-IPv6-Präfix. */
function normIp(ip) {
  if (!ip) return "";
  ip = String(ip).trim();
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

/** Echte Client-IP eines Sockets (Railway läuft hinter Proxy → x-forwarded-for). */
function ipOf(socket) {
  const h = socket.handshake || {};
  const xff = h.headers && (h.headers["x-forwarded-for"] || h.headers["X-Forwarded-For"]);
  return normIp(xff || h.address || "");
}

function isBanned(ip) {
  return banned.has(normIp(ip));
}
function ban(ip) {
  ip = normIp(ip);
  if (!ip) return false;
  banned.add(ip);
  save();
  return true;
}
function unban(ip) {
  const ok = banned.delete(normIp(ip));
  if (ok) save();
  return ok;
}
function list() {
  return [...banned];
}

module.exports = { normIp, ipOf, isBanned, ban, unban, list };
