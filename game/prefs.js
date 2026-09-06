"use strict";

/**
 * Client-Einstellungen am Account.
 *
 * Alles hier ist reine Darstellung: Theme, Ton, Lautstärke, Bewegung,
 * später die angehefteten Lobby-Favoriten. Nichts davon bewegt Chips,
 * deshalb reicht eine simple Whitelist ohne weitere Prüfung.
 *
 * Warum am Account und nicht nur im localStorage: gespielt wird auf iPad
 * und Handy, und Safari wirft localStorage beim Aufräumen gerne weg. Der
 * Account ist der verlässlichere Ort, der localStorage bleibt als
 * Sofort-Cache davor (sonst blitzt beim Laden das falsche Theme auf).
 */

const THEMES = new Set(["klassik", "mitternacht", "neon"]);
const MAX_FAVORITES = 8;

const DEFAULTS = {
  theme: "klassik",
  sound: true,
  volume: 0.8,
  reduceMotion: false,
  favorites: [],
  // Zuletzt gelesener Update-Eintrag. Gehoert an den Account und nicht nur in
  // den localStorage: Safari raeumt bei Seiten, die man laenger nicht besucht
  // hat, nach sieben Tagen allen lokalen Speicher weg. Wer zwei Monate Pause
  // macht, kommt also ohne Merkwert zurueck — und genau der soll dann sein
  // Comeback-Fenster sehen.
  seenUpdate: null,
};

/** Nimmt entgegen, was der Client schickt, und gibt nur Sauberes zurück. */
function sanitize(input, current = {}) {
  const out = { ...DEFAULTS, ...current };
  if (!input || typeof input !== "object") return out;

  if (typeof input.theme === "string" && THEMES.has(input.theme)) out.theme = input.theme;
  if (typeof input.sound === "boolean") out.sound = input.sound;
  if (typeof input.volume === "number" && Number.isFinite(input.volume)) {
    out.volume = Math.min(1, Math.max(0, input.volume));
  }
  if (typeof input.reduceMotion === "boolean") out.reduceMotion = input.reduceMotion;
  if (typeof input.seenUpdate === "string" && /^[0-9A-Za-z-]{1,40}$/.test(input.seenUpdate)) {
    out.seenUpdate = input.seenUpdate;
  }
  if (Array.isArray(input.favorites)) {
    out.favorites = input.favorites
      .filter((f) => typeof f === "string" && /^[a-z]{2,20}$/.test(f))
      .slice(0, MAX_FAVORITES);
  }
  return out;
}

function get(acc) {
  return sanitize(acc && acc.prefs, acc && acc.prefs);
}

function setupPrefs(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("prefs:get", (ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, prefs: get(acc) });
    });

    socket.on("prefs:set", (patch, ack) => {
      const acc = socket.data.account && accounts.get(socket.data.account);
      if (!acc) return typeof ack === "function" && ack({ ok: false, error: "Nicht eingeloggt." });
      acc.prefs = sanitize(patch, acc.prefs);
      accounts.save();
      if (typeof ack === "function") ack({ ok: true, prefs: acc.prefs });
    });
  });
}

module.exports = { setupPrefs, get, sanitize, THEMES, DEFAULTS };
