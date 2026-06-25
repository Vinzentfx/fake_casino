"use strict";

/**
 * Blackjack lobbies — a purely SOCIAL layer over the normal single-player game.
 *
 * Mechanically nothing changes: every player still plays their own hands against
 * their own dealer (game/blackjack.js is untouched in its rules). A lobby just
 * seats people together so they can see a live roster and a feed of who won/lost
 * how much, plus the shared per-lobby chat. No round-start gating — everyone
 * plays at their own pace.
 *
 * game/blackjack.js calls `report(socket, net)` whenever a hand resolves.
 */

const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const FEED_MAX = 25;

let ioRef = null;
const rooms = new Map(); // code -> { code, hostKey, hostName, players: Map(key -> {key,name,net,hands}), feed: [] }

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function describe(room) {
  return {
    code: room.code,
    game: "blackjack",
    label: "♠️ Blackjack",
    host: room.hostName,
    players: room.players.size,
    max: MAX_PLAYERS,
    buyIn: "jeder gegen den Dealer",
    joinable: room.players.size < MAX_PLAYERS,
  };
}
const register = (code) => lobby.add(code, () => (rooms.has(code) ? describe(rooms.get(code)) : null));

function stateFor(room) {
  return {
    code: room.code,
    host: room.hostName,
    players: [...room.players.values()].map((p) => ({ name: p.name, net: p.net, hands: p.hands })),
    feed: room.feed.slice(-20),
  };
}
function broadcast(room) {
  if (ioRef) ioRef.to(room.code).emit("bjlobby:state", stateFor(room));
}

function leave(socket) {
  const code = socket.data.bjRoom;
  if (!code) return;
  socket.data.bjRoom = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(socket.data.account);
  if (room.players.size === 0) {
    rooms.delete(code);
    lobby.remove(code);
    return;
  }
  // Host left → hand leadership to whoever's still here.
  if (room.hostKey === socket.data.account) {
    const first = [...room.players.values()][0];
    room.hostKey = first.key;
    room.hostName = first.name;
  }
  broadcast(room);
  lobby.changed();
}

/** Called by game/blackjack.js when a hand resolves. */
function report(socket, net) {
  const code = socket && socket.data && socket.data.bjRoom;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(socket.data.account);
  if (!p) return;
  p.net += net;
  p.hands += 1;
  room.feed.push({ name: p.name, net, ts: Date.now() });
  if (room.feed.length > FEED_MAX) room.feed.splice(0, room.feed.length - FEED_MAX);
  broadcast(room);
}

function setupBlackjackLobby(io, accounts) {
  ioRef = io;
  io.on("connection", (socket) => {
    const nameOf = () => {
      const acc = accounts.get(socket.data.account);
      return (acc && acc.name) || socket.data.displayName || "?";
    };

    socket.on("bjlobby:create", (ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      leave(socket);
      const code = makeCode();
      const name = nameOf();
      const room = { code, hostKey: socket.data.account, hostName: name, players: new Map(), feed: [] };
      room.players.set(socket.data.account, { key: socket.data.account, name, net: 0, hands: 0 });
      rooms.set(code, room);
      socket.join(code);
      socket.data.bjRoom = code;
      register(code);
      ack && ack({ ok: true, code });
      broadcast(room);
    });

    socket.on("bjlobby:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "Lobby nicht gefunden." });
      if (room.players.size >= MAX_PLAYERS && !room.players.has(socket.data.account))
        return ack && ack({ ok: false, error: "Lobby ist voll." });
      leave(socket);
      if (!room.players.has(socket.data.account))
        room.players.set(socket.data.account, { key: socket.data.account, name: nameOf(), net: 0, hands: 0 });
      socket.join(code);
      socket.data.bjRoom = code;
      ack && ack({ ok: true, code });
      broadcast(room);
      lobby.changed();
    });

    socket.on("bjlobby:state", (ack) => {
      if (typeof ack !== "function") return;
      const room = rooms.get(socket.data.bjRoom);
      ack(room ? { ok: true, ...stateFor(room) } : { ok: false });
    });

    socket.on("bjlobby:leave", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
}

module.exports = { setupBlackjackLobby, report };
