"use strict";

/**
 * Social duel challenges — relay a "challenge to a duel" from one online player
 * to another. The CHALLENGER first creates a private match for the chosen game
 * (client-side, via the game's own create), then sends the invite carrying the
 * match code; this module just forwards it to the target if they're online. The
 * target accepts by joining that code — reusing all existing PvP match logic.
 */

const GAME_LABELS = {
  memory: "Memory-Duell",
  sudoku: "Sudoku-Race",
  solrace: "Solitär-Race",
  chess: "Schach-Duell",
};
const VALID_GAMES = new Set(Object.keys(GAME_LABELS));
const CHALLENGE_COOLDOWN_MS = 30 * 1000;
const challengeCooldown = new Map();

function setupSocial(io, accounts) {
  function socketOf(key) {
    for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === key) return s;
    return null;
  }

  io.on("connection", (socket) => {
    socket.on("social:challenge", ({ to, game, code, stake, label } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!VALID_GAMES.has(game)) return ack({ ok: false, error: "Unbekanntes Spiel." });
      code = String(code || "").trim().toUpperCase();
      if (!code) return ack({ ok: false, error: "Kein Match-Code." });
      const targetKey = String(to || "").trim().toLowerCase();
      if (!targetKey || targetKey === socket.data.account) return ack({ ok: false, error: "Ungültiges Ziel." });
      const cdKey = `${socket.data.account}:${targetKey}`;
      const now = Date.now();
      const last = challengeCooldown.get(cdKey) || 0;
      if (now - last < CHALLENGE_COOLDOWN_MS) {
        return ack({ ok: false, error: "Warte kurz, bevor du diese Person nochmal herausforderst." });
      }
      challengeCooldown.set(cdKey, now);

      const label2 = GAME_LABELS[game] || label || "Duell";
      const fromAcc = accounts.get(socket.data.account);
      const fromName = fromAcc ? fromAcc.name : socket.data.account;
      const ts = socketOf(targetKey);
      if (!ts) return ack({ ok: true, delivered: false, label: label2 });

      ts.emit("social:challengeIncoming", {
        from: fromName, game, code,
        stake: Math.max(0, Math.floor(Number(stake)) || 0),
        label: label2,
      });
      ack({ ok: true, delivered: true, label: label2 });
    });

    // Target declined → let the challenger know so they can cancel their waiting room.
    socket.on("social:challengeDecline", ({ to, game } = {}) => {
      if (!socket.data.account) return;
      const targetKey = String(to || "").trim().toLowerCase();
      const ts = socketOf(targetKey);
      const me = accounts.get(socket.data.account);
      if (ts) ts.emit("social:challengeDeclined", { by: me ? me.name : socket.data.account, label: GAME_LABELS[game] || "Duell" });
    });
  });
}

module.exports = { setupSocial, SOCIAL_GAME_LABELS: GAME_LABELS };
