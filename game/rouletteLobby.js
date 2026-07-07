"use strict";

/**
 * Roulette lobbies — a SHARED table: everyone places bets on the same wheel and
 * sees what the others are betting on; the lobby leader spins ONE ball and that
 * single result settles every player's bets at once. Each lobby keeps its own
 * shared roll board (recent winning numbers).
 *
 * Bets touch real account chips when placed (deducted), are refunded on clear /
 * leave, and pay out on the shared spin. Reuses the payout math from
 * game/roulette.js so the odds match the solo game exactly.
 */

const crypto = require("crypto");
const lobby = require("./lobby");
const { numColor, payoutFactor, VALID_TYPES, MIN_BET, MAX_TOTAL, WHEEL_SEQ } = require("./roulette");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 8;
const HISTORY_MAX = 18;

let ioRef = null;
let accountsRef = null;
const rooms = new Map(); // code -> room

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
    game: "roulette",
    label: "🎡 Roulette",
    host: room.hostName,
    players: room.players.size,
    max: MAX_PLAYERS,
    buyIn: "geteilter Kessel",
    joinable: room.players.size < MAX_PLAYERS,
  };
}
const register = (code) => lobby.add(code, () => (rooms.has(code) ? describe(rooms.get(code)) : null));

function betLabel(b) {
  const L = { red: "Rot", black: "Schwarz", odd: "Ungerade", even: "Gerade", low: "1–18", high: "19–36" };
  if (b.type === "number") return "Zahl " + b.value;
  if (b.type === "dozen") return b.value + ". Dutzend";
  if (b.type === "column") return b.value + ". Reihe";
  return L[b.type] || b.type;
}

function stateFor(room, viewerKey) {
  const me = room.players.get(viewerKey);
  return {
    code: room.code,
    host: room.hostName,
    isHost: room.hostKey === viewerKey,
    spinning: room.spinning,
    players: [...room.players.values()].map((p) => ({
      name: p.name, staked: p.staked, net: p.net, betCount: p.bets.length,
    })),
    // Every player's current-round bets, so you can see what others backed.
    bets: [...room.players.values()].flatMap((p) =>
      p.bets.map((b) => ({ name: p.name, label: betLabel(b), amount: b.amount, type: b.type, value: b.value }))),
    myBets: me ? me.bets.map((b) => ({ type: b.type, value: b.value, amount: b.amount })) : [],
    myStaked: me ? me.staked : 0,
    history: room.history.slice(0, HISTORY_MAX),
  };
}

function broadcast(room) {
  for (const s of room.sockets) s.emit("rlobby:state", stateFor(room, s.data.account));
}

function refund(room, player) {
  if (player.staked > 0 && accountsRef) {
    const r = accountsRef.adjustChips(player.key, player.staked);
    const sock = [...room.sockets].find((s) => s.data.account === player.key);
    if (sock && r.ok) sock.emit("account:update", { account: r.account });
  }
  player.bets = [];
  player.staked = 0;
}

function leave(socket) {
  const code = socket.data.rouletteRoom;
  if (!code) return;
  socket.data.rouletteRoom = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  room.sockets.delete(socket);
  const player = room.players.get(socket.data.account);
  // Only refund/remove if this was the player's last socket in the room.
  const stillHere = [...room.sockets].some((s) => s.data.account === socket.data.account);
  if (player && !stillHere) {
    if (!room.spinning) refund(room, player); // mid-spin bets still resolve
    room.players.delete(socket.data.account);
  }
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

function validateBet(b) {
  const amount = Math.floor(Number(b.amount));
  if (!VALID_TYPES.has(b.type) || !Number.isFinite(amount) || amount < MIN_BET) return null;
  if (b.type === "number") {
    const v = Math.floor(Number(b.value));
    if (v < 0 || v > 36) return null;
    return { type: "number", value: v, amount };
  }
  if (b.type === "dozen" || b.type === "column") {
    const v = Math.floor(Number(b.value));
    if (v < 1 || v > 3) return null;
    return { type: b.type, value: v, amount };
  }
  return { type: b.type, amount };
}

function setupRouletteLobby(io, accounts) {
  ioRef = io;
  accountsRef = accounts;

  io.on("connection", (socket) => {
    const nameOf = () => {
      const acc = accounts.get(socket.data.account);
      return (acc && acc.name) || socket.data.displayName || "?";
    };
    const curRoom = () => rooms.get(socket.data.rouletteRoom);

    socket.on("rlobby:create", (ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      leave(socket);
      const code = makeCode();
      const name = nameOf();
      const room = {
        code, hostKey: socket.data.account, hostName: name,
        players: new Map(), sockets: new Set(), history: [], spinning: false,
      };
      room.players.set(socket.data.account, { key: socket.data.account, name, bets: [], staked: 0, net: 0 });
      room.sockets.add(socket);
      rooms.set(code, room);
      socket.join(code);
      socket.data.rouletteRoom = code;
      register(code);
      ack && ack({ ok: true, code });
      broadcast(room);
    });

    socket.on("rlobby:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return ack && ack({ ok: false, error: "Lobby nicht gefunden." });
      if (room.players.size >= MAX_PLAYERS && !room.players.has(socket.data.account))
        return ack && ack({ ok: false, error: "Lobby ist voll." });
      leave(socket);
      if (!room.players.has(socket.data.account))
        room.players.set(socket.data.account, { key: socket.data.account, name: nameOf(), bets: [], staked: 0, net: 0 });
      room.sockets.add(socket);
      socket.join(code);
      socket.data.rouletteRoom = code;
      ack && ack({ ok: true, code });
      broadcast(room);
      lobby.changed();
    });

    socket.on("rlobby:bet", (payload = {}, ack) => {
      const room = curRoom();
      if (!room) return ack && ack({ ok: false, error: "Keine Lobby." });
      if (room.spinning) return ack && ack({ ok: false, error: "Kessel dreht — warte." });
      const player = room.players.get(socket.data.account);
      if (!player) return ack && ack({ ok: false, error: "Nicht am Tisch." });
      const bet = validateBet(payload);
      if (!bet) return ack && ack({ ok: false, error: "Ungültige Wette." });
      if (player.staked + bet.amount > MAX_TOTAL) return ack && ack({ ok: false, error: "Max. 50.000 Chips Gesamteinsatz." });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < bet.amount) return ack && ack({ ok: false, error: "Nicht genug Chips." });
      const r = accounts.adjustChips(socket.data.account, -bet.amount);
      socket.emit("account:update", { account: r.account });
      player.bets.push(bet);
      player.staked += bet.amount;
      ack && ack({ ok: true });
      broadcast(room);
    });

    socket.on("rlobby:clear", (ack) => {
      const room = curRoom();
      if (!room) return ack && ack && ack({ ok: false });
      if (room.spinning) return ack && ack && ack({ ok: false, error: "Kessel dreht." });
      const player = room.players.get(socket.data.account);
      if (player) refund(room, player);
      ack && ack && ack({ ok: true });
      broadcast(room);
    });

    socket.on("rlobby:spin", (ack) => {
      const room = curRoom();
      if (!room) return ack && ack && ack({ ok: false, error: "Keine Lobby." });
      if (room.hostKey !== socket.data.account) return ack && ack && ack({ ok: false, error: "Nur der Anführer dreht." });
      if (room.spinning) return ack && ack && ack({ ok: false, error: "Dreht bereits." });
      const anyBets = [...room.players.values()].some((p) => p.bets.length);
      if (!anyBets) return ack && ack && ack({ ok: false, error: "Noch keine Wetten am Tisch." });

      room.spinning = true;
      broadcast(room);

      const number = crypto.randomInt(37);
      const color = numColor(number);
      const wheelIdx = WHEEL_SEQ.indexOf(number);

      const perPlayer = [];
      for (const p of room.players.values()) {
        let ret = 0;
        for (const b of p.bets) ret += Math.floor(b.amount * payoutFactor(b.type, b.value, number));
        const boost = accounts.buffMult(p.key, "winBoost");
        if (boost > 1 && ret > 0) ret = Math.round(ret * boost);
        const staked = p.staked;
        if (ret > 0) {
          const r = accounts.adjustChips(p.key, ret);
          const sock = [...room.sockets].find((s) => s.data.account === p.key);
          if (sock && r.ok) sock.emit("account:update", { account: r.account });
        }
        accounts.recordHand(p.key, ret - staked, true, "roulette"); // win or loss → keeps stats accurate
        p.net += ret - staked;
        if (staked > 0 || ret > 0) perPlayer.push({ name: p.name, staked, ret, net: ret - staked });
        p.bets = [];
        p.staked = 0;
      }

      room.history.unshift({ number, color });
      if (room.history.length > HISTORY_MAX) room.history.pop();

      ack && ack && ack({ ok: true });
      ioRef.to(room.code).emit("rlobby:result", { number, color, wheelIdx, perPlayer });
      // Settle the spin after the wheel animation so balances/bets clear in sync.
      setTimeout(() => {
        const r = rooms.get(room.code);
        if (!r) return;
        r.spinning = false;
        broadcast(r);
      }, 5200);
    });

    socket.on("rlobby:state", (ack) => {
      if (typeof ack !== "function") return;
      const room = curRoom();
      ack(room ? { ok: true, ...stateFor(room, socket.data.account) } : { ok: false });
    });

    socket.on("rlobby:leave", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
}

module.exports = { setupRouletteLobby };
