"use strict";

/**
 * Oeffentliches Vorschlagsbrett.
 *
 * Ideen sind fuer alle sichtbar und koennen pro Konto einmal unterstuetzt
 * werden. Der Besitzer kann einen Bearbeitungsstand setzen und direkt unter
 * der Idee antworten. Aehnliche Einsendungen werden zusammengefuehrt, statt
 * das Brett mit demselben Wunsch mehrfach zu fuellen.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const OWNER = "vincent";
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "suggestions.json");
const SUGGEST_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const MAX_LEN = 500;
const MAX_REPLY = 600;
const MIN_LEN = 3;
const STATUS = new Set(["open", "planned", "done", "rejected"]);
const STATUS_ORDER = { planned: 0, open: 1, done: 2, rejected: 3 };

const STOP = new Set([
  "aber", "auch", "bitte", "dass", "das", "den", "der", "die", "ein", "eine", "einen",
  "alle", "feature", "fuer", "fur", "geben", "hinzufuegen", "hinzufugen", "ich", "idee", "ihr", "koennte", "konntet",
  "machen", "man", "mit", "moechte", "neue", "neuer", "neues", "nummer", "oder", "sollte", "spiel",
  "und", "vielleicht", "waere", "wenn", "wieder", "wir", "zum", "zur",
]);

const keyVon = (v) => String(v || "").trim().toLowerCase();

/** Nur fuer den Dublettenvergleich; der Originaltext bleibt unveraendert. */
function suchText(text) {
  const woerter = String(text || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(woerter)].sort().join(" ");
}

function aehnlich(a, b) {
  const ka = suchText(a), kb = suchText(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const A = new Set(ka.split(" ")), B = new Set(kb.split(" "));
  if (Math.min(A.size, B.size) < 3) return false;
  let gemeinsam = 0;
  for (const w of A) if (B.has(w)) gemeinsam++;
  const jaccard = gemeinsam / (A.size + B.size - gemeinsam);
  const deckung = gemeinsam / Math.min(A.size, B.size);
  // Ein kurzer Wunsch darf in einer ausfuehrlicheren Beschreibung stecken.
  // Mindestens drei bedeutende Woerter verhindern, dass etwa jede Idee mit
  // dem Wort "Stadt" zusammenfaellt.
  return jaccard >= 0.86 || (gemeinsam >= 3 && deckung >= 0.9);
}

function neuesId() {
  return `idee-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalisiere(raw, index) {
  const at = Number(raw && raw.at) || Date.now();
  const name = String(raw && raw.name || "Unbekannt").slice(0, 40);
  const voters = Array.isArray(raw && raw.voters) ? raw.voters.map(keyVon).filter(Boolean) : [];
  // Eine alte Einsendung zaehlt selbst als erste Unterstuetzung.
  const autorKey = keyVon(raw && (raw.authorKey || raw.name));
  if (autorKey && !voters.includes(autorKey)) voters.push(autorKey);
  return {
    id: String(raw && raw.id || `idee-alt-${at.toString(36)}-${index}`),
    name,
    authorKey: autorKey,
    text: String(raw && raw.text || "").slice(0, MAX_LEN),
    at,
    status: STATUS.has(raw && raw.status) ? raw.status : "open",
    voters: [...new Set(voters)],
    reply: String(raw && raw.reply || "").slice(0, MAX_REPLY),
    repliedAt: Number(raw && raw.repliedAt) || 0,
    merged: Array.isArray(raw && raw.merged) ? raw.merged.slice(0, 50) : [],
  };
}

/** Alte Mehrfacheinsendungen bleiben im Feld `merged` erhalten. */
function zusammenfassen(list) {
  const out = [];
  for (const raw of list) {
    const item = normalisiere(raw, out.length);
    if (!item.text) continue;
    const gleich = out.find((x) => aehnlich(x.text, item.text));
    if (!gleich) { out.push(item); continue; }
    gleich.merged.push({ name: item.name, text: item.text, at: item.at });
    gleich.voters = [...new Set([...gleich.voters, ...item.voters])];
    if ((STATUS_ORDER[item.status] ?? 9) < (STATUS_ORDER[gleich.status] ?? 9)) gleich.status = item.status;
    if (!gleich.reply && item.reply) { gleich.reply = item.reply; gleich.repliedAt = item.repliedAt; }
  }
  return out;
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? zusammenfassen(data) : [];
  } catch { return []; }
}

let items = load();

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items));
  } catch {}
}

const rate = new Map();
function recent(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < HOUR_MS);
  rate.set(key, list);
  return list;
}

function setupSuggestions(io, accounts) {
  const isOwner = (socket) => socket.data.account === OWNER;

  function sichtbar(item, key) {
    return {
      id: item.id, name: item.name, text: item.text, at: item.at, status: item.status,
      votes: item.voters.length, voted: !!key && item.voters.includes(key),
      reply: item.reply || "", repliedAt: item.repliedAt || 0,
      mergedCount: item.merged.length,
    };
  }

  function sortiert() {
    return [...items].sort((a, b) =>
      (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) ||
      (b.voters.length - a.voters.length) || (b.at - a.at));
  }

  function stateFor(socket) {
    const key = socket.data.account;
    const used = key ? recent(key).length : 0;
    const counts = { all: items.length, open: 0, planned: 0, done: 0, rejected: 0 };
    for (const item of items) counts[item.status]++;
    return {
      ok: true, perHour: SUGGEST_PER_HOUR,
      remaining: Math.max(0, SUGGEST_PER_HOUR - used), isOwner: isOwner(socket), counts,
      items: sortiert().map((item) => sichtbar(item, key)),
    };
  }

  // `voted` ist fuer jeden Socket anders, daher nur neu laden lassen.
  const changed = () => io.emit("suggest:changed");

  io.on("connection", (socket) => {
    socket.on("suggest:state", (ack) => {
      if (typeof ack === "function") ack(stateFor(socket));
    });

    socket.on("suggest:send", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key && accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      text = String(text || "").trim().slice(0, MAX_LEN);
      if (text.length < MIN_LEN) return ack({ ok: false, error: "Vorschlag ist zu kurz." });
      text = require("./wortfilter").entschaerfe(text).text.trim();
      if (text.length < MIN_LEN) return ack({ ok: false, error: "Von dem Vorschlag ist zu wenig lesbarer Text übrig." });

      const vorhanden = items.find((item) => aehnlich(item.text, text));
      if (vorhanden) {
        const warSchon = vorhanden.voters.includes(key);
        if (!warSchon) {
          vorhanden.voters.push(key);
          vorhanden.merged.push({ name: acc.name, text, at: Date.now() });
          save(); changed();
        }
        return ack({
          ok: true, duplicate: true, alreadyVoted: warSchon,
          item: sichtbar(vorhanden, key),
          remaining: Math.max(0, SUGGEST_PER_HOUR - recent(key).length),
        });
      }

      const used = recent(key);
      if (used.length >= SUGGEST_PER_HOUR)
        return ack({ ok: false, error: `Max. ${SUGGEST_PER_HOUR} Vorschläge pro Stunde, versuch es später noch mal.` });

      used.push(Date.now());
      const item = {
        id: neuesId(), name: acc.name, authorKey: key, text, at: Date.now(),
        status: "open", voters: [key], reply: "", repliedAt: 0, merged: [],
      };
      items.push(item);
      if (items.length > 1000) items = sortiert().slice(0, 1000);
      save(); changed();
      ack({ ok: true, duplicate: false, item: sichtbar(item, key), remaining: Math.max(0, SUGGEST_PER_HOUR - used.length) });
    });

    socket.on("suggest:vote", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key || !accounts.get(key)) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const item = items.find((x) => x.id === String(id || ""));
      if (!item) return ack({ ok: false, error: "Diese Idee gibt es nicht mehr." });
      const pos = item.voters.indexOf(key);
      if (pos >= 0) item.voters.splice(pos, 1); else item.voters.push(key);
      save(); changed();
      ack({ ok: true, item: sichtbar(item, key) });
    });

    socket.on("suggest:moderate", ({ id, status, reply } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner(socket)) return ack({ ok: false, error: "Kein Zugriff." });
      const item = items.find((x) => x.id === String(id || ""));
      if (!item) return ack({ ok: false, error: "Vorschlag nicht gefunden." });
      if (!STATUS.has(status)) return ack({ ok: false, error: "Unbekannter Status." });
      reply = String(reply || "").trim().slice(0, MAX_REPLY);
      if (reply) reply = require("./wortfilter").entschaerfe(reply).text.trim();
      item.status = status;
      item.reply = reply;
      item.repliedAt = reply ? Date.now() : 0;
      save(); changed();
      ack(stateFor(socket));
    });

    socket.on("suggest:delete", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner(socket)) return ack({ ok: false, error: "Kein Zugriff." });
      const before = items.length;
      items = items.filter((item) => item.id !== String(id || ""));
      if (items.length !== before) { save(); changed(); }
      ack(stateFor(socket));
    });
  });

  // Persistiert alte Eintraege einmal im neuen, verlustfreien Schema.
  save();
}

module.exports = { setupSuggestions, SUGGEST_PER_HOUR, suchText, aehnlich };
