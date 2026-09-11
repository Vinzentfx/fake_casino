"use strict";

/**
 * Duell-Herausforderungen: leitet ein "Ich fordere dich heraus" von einem Spieler
 * an einen anderen weiter. Der Herausforderer legt zuerst ein privates Match im
 * gewählten Spiel an (im Client, über das Anlegen des Spiels selbst) und schickt
 * dann die Einladung mit dem Code. Dieses Modul reicht sie nur weiter, wenn das
 * Ziel online ist. Angenommen wird durch Beitreten mit dem Code, also mit der
 * ganz normalen PvP-Logik.
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

    // Abgelehnt: dem Herausforderer Bescheid geben, damit er seinen Warteraum schließen kann.
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
