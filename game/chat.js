"use strict";

/**
 * Generic real-time chat — a global room (the lobby/home screen) plus optional
 * per-room channels (one per game lobby, keyed by that lobby's code). Messages
 * are ephemeral: only the last N per room are kept in memory for late joiners.
 *
 * Rooms:
 *   "global"        → everyone online, shown on the home screen.
 *   "<CODE>"        → a single game lobby; only sockets that joined the
 *                     Socket.IO room <CODE> (poker/slots-pvp/blackjack) receive it.
 *
 * Text is stored raw (trimmed + length-capped); clients MUST escape on render.
 */

const wortfilter = require("./wortfilter");

const HISTORY = 40;          // messages kept per room
const MAX_LEN = 280;         // characters per message
const MIN_INTERVAL_MS = 600; // per-socket flood guard

const rooms = new Map();     // room -> [{ name, text, ts }]

function history(room) {
  return rooms.get(room) || [];
}

function push(room, msg) {
  let list = rooms.get(room);
  if (!list) { list = []; rooms.set(room, list); }
  list.push(msg);
  if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
}

/** Drop a lobby channel when its lobby is torn down. */
function clearRoom(room) {
  rooms.delete(room);
}

/** System announcement into the global chat (conquests, achievements …). */
function announce(io, text) {
  const msg = { name: "📣 Stadt", text: String(text).slice(0, MAX_LEN), ts: Date.now(), system: true };
  push("global", msg);
  io.emit("chat:msg", { room: "global", msg });
}

function setupChat(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("chat:history", ({ room } = {}, ack) => {
      if (typeof ack !== "function") return;
      room = String(room || "global");
      ack({ ok: true, room, messages: history(room) });
    });

    socket.on("chat:send", ({ room, text } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Nicht eingeloggt." });
      room = String(room || "global");
      text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
      if (!text) return ack && ack({ ok: false, error: "Leere Nachricht." });
      /* Im Chat wird maskiert, nicht abgelehnt: eine verschluckte Nachricht
         erzeugt Nachfragen ("kam das an?"), eine maskierte erklaert sich
         selbst. Gefiltert wird vor dem Speichern — die Verlaufsliste soll
         das Wort gar nicht erst enthalten. */
      text = wortfilter.entschaerfe(text).text;

      const now = Date.now();
      if (now - (socket.data.lastChatTs || 0) < MIN_INTERVAL_MS)
        return ack && ack({ ok: false, error: "Etwas langsamer." });
      socket.data.lastChatTs = now;

      // For a lobby channel, only allow posting if the socket is actually in that
      // Socket.IO room (i.e. they joined that lobby). "global" is open to all.
      if (room !== "global" && !socket.rooms.has(room))
        return ack && ack({ ok: false, error: "Du bist nicht in dieser Lobby." });

      const acc = accounts.get(socket.data.account);
      // Der Chat zeigte Namen bisher als nackten Text: wer sich eine Farbe
      // gekauft hatte, sah davon ausgerechnet dort nichts, wo man sich am
      // meisten sieht. Das Aussehen haengt jetzt an der Nachricht.
      const look = acc ? require("./cosmetics").publicLook(acc) : {};
      const msg = {
        name: (acc && acc.name) || socket.data.displayName || "?",
        text, ts: now,
        avatar: look.avatar || null,
        nameColor: look.nameColor || null,
        nameStyle: look.nameStyle || null,
        title: look.title || null,
      };
      push(room, msg);

      if (room === "global") io.emit("chat:msg", { room, msg });
      else io.to(room).emit("chat:msg", { room, msg });

      ack && ack({ ok: true });
    });
  });
}

module.exports = { setupChat, clearRoom, announce, CHAT_HISTORY: HISTORY };
