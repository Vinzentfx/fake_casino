"use strict";

/**
 * Chat in Echtzeit: ein allgemeiner Raum (Lobby und Startseite) und dazu je
 * Spiel-Lobby ein eigener Kanal (Schlüssel ist der Code der Lobby). Nachrichten
 * sind flüchtig, pro Raum bleiben nur die letzten N im Speicher für Nachzügler.
 *
 * Räume:
 *   "global"   alle, die online sind, auf der Startseite zu sehen.
 *   "<CODE>"   eine einzelne Lobby. Das bekommen nur Sockets, die im
 *              Socket.IO-Raum <CODE> sind (Poker, Slots-PvP, Blackjack).
 *
 * Der Text wird roh gespeichert (getrimmt, gekürzt), die Clients müssen beim
 * Anzeigen escapen.
 */

const wortfilter = require("./wortfilter");
const strafen = require("./strafen");

const HISTORY = 40;          // Nachrichten je Raum
const MAX_LEN = 280;         // Zeichen je Nachricht
const MIN_INTERVAL_MS = 600; // Flutschutz je Socket

const rooms = new Map();     // je Raum: [{ name, text, ts }]

function history(room) {
  return rooms.get(room) || [];
}

function push(room, msg) {
  let list = rooms.get(room);
  if (!list) { list = []; rooms.set(room, list); }
  list.push(msg);
  if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
}

/** Kanal einer Lobby wegwerfen, wenn die Lobby abgebaut wird. */
function clearRoom(room) {
  rooms.delete(room);
}

/** Ansage des Systems im allgemeinen Chat (Eroberungen, Achievements …). */
function announce(io, text) {
  const msg = { name: "Stadt", text: String(text).slice(0, MAX_LEN), ts: Date.now(), system: true };
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
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Nicht eingeloggt." });
      room = String(room || "global");
      text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
      if (!text) return typeof ack === "function" && ack({ ok: false, error: "Leere Nachricht." });
      /* Im Chat wird maskiert, nicht abgelehnt: eine verschluckte Nachricht
         erzeugt Nachfragen ("kam das an?"), eine maskierte erklaert sich
         selbst. Gefiltert wird vor dem Speichern, die Verlaufsliste soll
         das Wort gar nicht erst enthalten. */
      text = wortfilter.entschaerfe(text).text;

      /* Maulkorb: darf spielen, aber nicht schreiben. Abgelehnt wird mit
         Grund und Restzeit, nicht stumm verschluckt: eine Nachricht, die
         einfach nicht erscheint, sieht wie ein Fehler aus und erzeugt genau
         die Nachfragen, die man vermeiden wollte. */
      const acc0 = accounts.get(socket.data.account);
      const maulkorb = acc0 && strafen.aktiv(acc0, "stumm");
      if (maulkorb) {
        return typeof ack === "function" && ack({
          ok: false,
          error: `Du darfst gerade nicht schreiben (${strafen.restText(maulkorb)})${maulkorb.grund ? `: ${maulkorb.grund}` : "."}`,
        });
      }

      const now = Date.now();
      if (now - (socket.data.lastChatTs || 0) < MIN_INTERVAL_MS)
        return typeof ack === "function" && ack({ ok: false, error: "Etwas langsamer." });
      socket.data.lastChatTs = now;

      // In einem Lobby-Kanal nur schreiben, wenn der Socket wirklich in diesem
      // Socket.IO-Raum ist (also der Lobby beigetreten ist). "global" ist offen.
      if (room !== "global" && !socket.rooms.has(room))
        return typeof ack === "function" && ack({ ok: false, error: "Du bist nicht in dieser Lobby." });

      const acc = accounts.get(socket.data.account);
      // Der Chat zeigte Namen bisher als nackten Text: wer sich eine Farbe
      // gekauft hatte, sah davon ausgerechnet dort nichts, wo man sich am
      // meisten sieht. Das Aussehen haengt jetzt an der Nachricht.
      const look = acc ? require("./cosmetics").publicLook(acc) : {};
      /* Wer hier ein Feld vergisst, baut ein Stueck, das man kaufen, anlegen
         und dann nirgends sehen kann. Genau das war mit dem Chat-Zeichen und
         dem Prunkstueck passiert: beide standen in publicLook, aber diese
         Liste kopierte nur vier Felder, und ausgerechnet im Chat, der am
         meisten gelesenen Flaeche im Haus, kam nichts davon an.
         Nicht mitkommen soll nur, was privat ist: der Kartenruecken wirkt
         allein auf dem eigenen Bildschirm, der Gewinn-Effekt braucht hier
         niemanden. */
      const msg = {
        name: (acc && acc.name) || socket.data.displayName || "?",
        text, ts: now,
        avatar: look.avatar || null,
        nameColor: look.nameColor || null,
        nameStyle: look.nameStyle || null,
        title: look.title || null,
        frame: look.frame || null,
        aura: look.aura || null,
        zeichen: look.zeichen || null,
        prunk: look.prunk || null,
        /* Und die Garnitur. Genau dieselbe Falle wie oben: sie steht in
           publicLook, und wer sie hier vergisst, baut ein Stueck, das
           ausgerechnet im Chat nichts tut. */
        garnitur: look.garnitur || null,
      };
      push(room, msg);

      if (room === "global") io.emit("chat:msg", { room, msg });
      else io.to(room).emit("chat:msg", { room, msg });

      typeof ack === "function" && ack({ ok: true });
    });
  });
}

module.exports = { setupChat, clearRoom, announce, CHAT_HISTORY: HISTORY };
