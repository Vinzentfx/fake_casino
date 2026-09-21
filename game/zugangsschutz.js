"use strict";

/* Schutz für Konto-Erstellungen und gezielte Gerätesperren.

   Eine IP ist kein Mensch: Familien, Schulen und Mobilfunk teilen Adressen;
   VPNs wechseln sie. Deshalb ist die IP nur eine zweite Bremse. Primär
   merken wir einen zufälligen, servergesetzten Browser-Schlüssel. Er ist
   kein Fingerabdruck und enthält keinerlei Geräteinformationen. */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "zugangsschutz.json");
const DAY = 24 * 60 * 60 * 1000;
const AUFBEWAHREN = 7 * DAY;
const PRO_GERAET_TAG = 2;
const PRO_IP_TAG = 8;

let store = { geraete: {}, ips: {}, gesperrt: [] };
try {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (raw && typeof raw === "object") store = {
    geraete: raw.geraete && typeof raw.geraete === "object" ? raw.geraete : {},
    ips: raw.ips && typeof raw.ips === "object" ? raw.ips : {},
    gesperrt: Array.isArray(raw.gesperrt) ? raw.gesperrt : [],
  };
} catch {}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store));
  } catch {}
}

function cookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || "");
  for (const teil of raw.split(";")) {
    const i = teil.indexOf("=");
    if (i > -1 && teil.slice(0, i).trim() === name) return decodeURIComponent(teil.slice(i + 1).trim());
  }
  return "";
}

function geraet(req, res) {
  let id = cookie(req, "fc_device");
  if (!/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString("hex");
    const sicher = req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
    res.append("Set-Cookie", `fc_device=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${sicher ? "; Secure" : ""}`);
  }
  return id;
}

function idAusRequest(req) {
  const id = cookie(req || {}, "fc_device");
  return /^[a-f0-9]{32}$/.test(id) ? id : "";
}

function ipKey(ip) {
  return crypto.createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 24);
}

function frisch(liste, seit) {
  return (Array.isArray(liste) ? liste : []).filter((t) => Number(t) >= seit);
}

function pruefeNeueAnmeldung(ip, deviceId) {
  const seit = Date.now() - DAY;
  const g = frisch(store.geraete[deviceId], seit);
  const i = frisch(store.ips[ipKey(ip)], seit);
  if (g.length >= PRO_GERAET_TAG) return { ok: false, error: "Auf diesem Gerät wurden heute schon mehrere Konten erstellt. Bitte nutze eines davon oder versuche es morgen wieder." };
  if (i.length >= PRO_IP_TAG) return { ok: false, error: "Aus diesem Netzwerk wurden heute ungewöhnlich viele Konten erstellt. Bitte später erneut versuchen." };
  return { ok: true };
}

function merkeNeueAnmeldung(ip, deviceId) {
  const jetzt = Date.now();
  const seit = jetzt - AUFBEWAHREN;
  const ik = ipKey(ip);
  store.geraete[deviceId] = [...frisch(store.geraete[deviceId], seit), jetzt];
  store.ips[ik] = [...frisch(store.ips[ik], seit), jetzt];
  save();
}

function istGesperrt(deviceId) { return !!deviceId && store.gesperrt.includes(deviceId); }
function sperre(deviceId) {
  if (!/^[a-f0-9]{32}$/.test(String(deviceId || ""))) return false;
  if (!store.gesperrt.includes(deviceId)) store.gesperrt.push(deviceId);
  save();
  return true;
}
function entsperre(deviceId) {
  const vorher = store.gesperrt.length;
  store.gesperrt = store.gesperrt.filter((x) => x !== deviceId);
  if (store.gesperrt.length !== vorher) save();
  return store.gesperrt.length !== vorher;
}
function liste() { return [...store.gesperrt]; }

module.exports = {
  geraet, idAusRequest, pruefeNeueAnmeldung, merkeNeueAnmeldung,
  istGesperrt, sperre, entsperre, liste,
  PRO_GERAET_TAG, PRO_IP_TAG,
};
