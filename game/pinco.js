"use strict";

const crypto = require("crypto");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const HISTORY_MAX = 24;
const MIN_BET = 50;
const MAX_BET = 100000;
const BALLS_PER_RECORDED_ROUND = 10;
const PLAYER_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

const BOARDS = {
  medium: {
    label: "Mittel",
    rows: 10,
    // Buffed ~95% → ~98% RTP (still < 100%, house keeps its edge).
    multipliers: [7.33, 2.74, 1.57, 1.11, 0.84, 0.70, 0.84, 1.11, 1.57, 2.74, 7.33],
  },
  large: {
    label: "Groß",
    rows: 14,
    // Buffed ~93% → ~98% RTP.
    multipliers: [15.23, 6.41, 3.20, 2.05, 1.33, 0.96, 0.81, 0.70, 0.81, 0.96, 1.33, 2.05, 3.20, 6.41, 15.23],
  },
};

const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function boardOf(size) {
  return BOARDS[size] || BOARDS.medium;
}

function normalizeSize(size) {
  return BOARDS[size] ? size : "medium";
}

function makeDrop(size, bet) {
  const board = boardOf(size);
  const path = [];
  let slot = 0;
  for (let i = 0; i < board.rows; i++) {
    const right = crypto.randomInt(2);
    path.push(right);
    slot += right;
  }
  const mult = board.multipliers[slot] || 0;
  return {
    id: crypto.randomUUID(),
    size,
    rows: board.rows,
    path,
    slot,
    multiplier: mult,
    payout: Math.floor(bet * mult),
  };
}

function publicBoards() {
  return Object.fromEntries(Object.entries(BOARDS).map(([key, b]) => [key, {
    label: b.label,
    rows: b.rows,
    multipliers: b.multipliers,
  }]));
}

function roomState(room, viewerKey) {
  return {
    code: room.code,
    host: room.hostName,
    isHost: room.hostKey === viewerKey,
    players: [...room.players.values()].map((p) => ({ name: p.name, net: p.net, drops: p.drops, color: p.color })),
    history: room.history.slice(0, HISTORY_MAX),
  };
}

function describe(room) {
  return {
    code: room.code,
    game: "pinco",
    label: "🟢 Pinco Ball",
    host: room.hostName,
    players: room.players.size,
    max: MAX_PLAYERS,
    buyIn: "Live-Drops",
    joinable: room.players.size < MAX_PLAYERS,
  };
}

const register = (code) => lobby.add(code, () => (rooms.has(code) ? describe(rooms.get(code)) : null));

function setupPinco(io, accounts) {
  function colorFor(room) {
    const used = new Set([...room.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
  }
  function nameOf(socket) {
    const acc = accounts.get(socket.data.account);
    return (acc && acc.name) || socket.data.displayName || "?";
  }
  function recordPincoBall(key, net) {
    const acc = accounts.get(key);
    if (!acc) return;
    acc.pincoRoundBalls = (acc.pincoRoundBalls || 0) + 1;
    acc.pincoRoundNet = (acc.pincoRoundNet || 0) + net;
    if (acc.pincoRoundBalls >= BALLS_PER_RECORDED_ROUND) {
      const roundNet = acc.pincoRoundNet || 0;
      acc.pincoRoundBalls = 0;
      acc.pincoRoundNet = 0;
      accounts.recordHand(key, roundNet, true, "pinco", { balls: BALLS_PER_RECORDED_ROUND });
    } else {
      accounts.save();
    }
  }
  function currentRoom(socket) {
    return rooms.get(socket.data.pincoRoom);
  }
  function broadcast(room) {
    for (const s of room.sockets) s.emit("pinco:room", roomState(room, s.data.account));
  }
  function leave(socket) {
    const code = socket.data.pincoRoom;
    if (!code) return;
    socket.data.pincoRoom = null;
    socket.leave(code);
    const room = rooms.get(code);
    if (!room) return;
    room.sockets.delete(socket);
    const stillHere = [...room.sockets].some((s) => s.data.account === socket.data.account);
    if (!stillHere) room.players.delete(socket.data.account);
    if (room.players.size === 0) {
      rooms.delete(code);
      lobby.remove(code);
      return;
    }
    if (room.hostKey === socket.data.account && !stillHere) {
      const first = [...room.players.values()][0];
      room.hostKey = first.key;
      room.hostName = first.name;
    }
    broadcast(room);
    lobby.changed();
  }
  function addPlayer(room, socket) {
    if (!room.players.has(socket.data.account)) {
      room.players.set(socket.data.account, { key: socket.data.account, name: nameOf(socket), net: 0, drops: 0, color: colorFor(room) });
    }
    room.sockets.add(socket);
    socket.join(room.code);
    socket.data.pincoRoom = room.code;
  }

  io.on("connection", (socket) => {
    socket.on("pinco:config", (ack) => {
      if (typeof ack === "function") ack({ ok: true, boards: publicBoards(), minBet: MIN_BET, maxBet: MAX_BET });
    });

    socket.on("pinco:drop", ({ size, bet } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      size = normalizeSize(size);
      bet = Math.floor(Number(bet));
      if (!Number.isFinite(bet) || bet < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} 🪙.` });
      if (bet > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} 🪙.` });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < bet) return ack({ ok: false, error: "Nicht genug Chips." });

      const drop = makeDrop(size, bet);
      const debit = accounts.adjustChips(socket.data.account, -bet);
      if (!debit.ok) return ack({ ok: false, error: debit.error });
      let account = debit.account;
      if (drop.payout > 0) {
        const credit = accounts.adjustChips(socket.data.account, drop.payout);
        if (credit.ok) account = credit.account;
      }
      recordPincoBall(socket.data.account, drop.payout - bet);

      const room = currentRoom(socket);
      const roomPlayer = room && room.players.get(socket.data.account);
      const event = {
        ...drop,
        name: acc.name,
        color: roomPlayer ? roomPlayer.color : PLAYER_COLORS[0],
        bet,
        net: drop.payout - bet,
        at: Date.now(),
      };
      if (room) {
        const player = roomPlayer;
        if (player) {
          player.net += event.net;
          player.drops += 1;
        }
        room.history.unshift(event);
        if (room.history.length > HISTORY_MAX) room.history.pop();
        io.to(room.code).emit("pinco:drop", event);
        broadcast(room);
        lobby.changed();
      }
      ack({ ok: true, account, drop: event });
    });

    socket.on("pinco:create", (ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      leave(socket);
      const code = makeCode();
      const name = nameOf(socket);
      const room = {
        code,
        hostKey: socket.data.account,
        hostName: name,
        players: new Map(),
        sockets: new Set(),
        history: [],
      };
      rooms.set(code, room);
      addPlayer(room, socket);
      register(code);
      ack && ack({ ok: true, code });
      broadcast(room);
      lobby.changed();
    });

    socket.on("pinco:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "Lobby nicht gefunden." });
      if (room.players.size >= MAX_PLAYERS && !room.players.has(socket.data.account))
        return ack && ack({ ok: false, error: "Lobby ist voll." });
      leave(socket);
      addPlayer(room, socket);
      ack && ack({ ok: true, code });
      broadcast(room);
      lobby.changed();
    });

    socket.on("pinco:leave", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
}

module.exports = { setupPinco, BOARDS };
