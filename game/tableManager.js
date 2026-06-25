"use strict";

/**
 * Manages all live poker tables and wires them to Socket.IO.
 *
 * One socket can be at one table at a time. Chips move between an account's
 * bank (accounts.js) and a table seat on buy-in / cash-out; while seated, the
 * seat's stack is the source of truth.
 */

const { PokerTable } = require("./pokerTable");
const { decide: botDecide, BOT_NAMES } = require("./pokerBot");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const NEXT_HAND_DELAY_MS = 4500;

function setupPoker(io, accounts) {
  /** code -> { table, sockets:Set<Socket>, timer } */
  const tables = new Map();

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      ).join("");
    } while (tables.has(code));
    return code;
  }

  function broadcast(code) {
    const entry = tables.get(code);
    if (!entry) return;
    for (const sock of entry.sockets) {
      const viewerId = sock.data.account || null;
      const st = entry.table.getStateFor(viewerId);
      st.isHost = !entry.vsBots && entry.hostKey === viewerId;
      st.hostName = entry.hostName || null;
      st.vsBots = !!entry.vsBots;
      sock.emit("poker:state", st);
    }
  }

  function destroyIfEmpty(code) {
    const entry = tables.get(code);
    if (!entry) return;
    // No human sockets → tear the table down (bots don't keep it alive).
    if (entry.sockets.size === 0) {
      clearTimeout(entry.timer);
      clearTimeout(entry.botTimer);
      tables.delete(code);
      lobby.remove(code);
    }
  }

  // Public lobby descriptor for the shared browser (only open friend tables,
  // not private solo-vs-bots games).
  function describePoker(entry) {
    const { table } = entry;
    const maxSeats = table.seats.length;
    return {
      code: table.code,
      game: "poker",
      label: "🃏 Poker",
      host: entry.hostName || "?",
      players: entry.sockets.size,
      max: maxSeats,
      buyIn: `Blinds ${table.smallBlind}/${table.bigBlind}`,
      joinable: !entry.vsBots && entry.sockets.size < maxSeats,
    };
  }
  const registerLobby = (code) =>
    lobby.add(code, () => (tables.has(code) ? describePoker(tables.get(code)) : null));

  function humanHasChips(table) {
    return table.seats.some((s) => s && !s.isBot && s.chips > 0);
  }
  function tableHasBots(table) {
    return table.seats.some((s) => s && s.isBot);
  }
  function pickBotName(table) {
    const used = new Set(table.seats.filter((s) => s && s.isBot).map((s) => s.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const pool = free.length ? free : BOT_NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // If it's a bot's turn, play it after a short "thinking" delay, then chain.
  function scheduleBots(entry) {
    const { table } = entry;
    if (!table.handActive || table.toAct < 0) return;
    const idx = table.toAct;
    const seat = table.seats[idx];
    if (!seat || !seat.isBot) return;
    clearTimeout(entry.botTimer);
    entry.botTimer = setTimeout(() => {
      if (!tables.has(table.code) || !table.handActive || table.toAct !== idx) return;
      let { action, amount } = botDecide(table, idx);
      let res = table.act(seat.id, action, amount);
      if (!res.ok) {
        const toCall = table.currentBet - seat.bet;
        res = table.act(seat.id, toCall > 0 ? "call" : "check", 0);
        if (!res.ok) table.act(seat.id, "fold", 0);
      }
      broadcast(table.code);
      scheduleBots(entry);
    }, 800 + Math.random() * 700);
  }

  function attachHooks(entry, code) {
    const { table } = entry;
    // Stats per hand (net chips won/lost), via the account store.
    table.onResults = (results) => {
      for (const r of results) accounts.recordHand(r.id, r.amount, false); // poker is PvP — no casino rake
    };
    // After a hand ends: show result, then auto-start the next one.
    table.onHandComplete = () => {
      broadcast(code);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        // Don't keep bots playing each other once the human is broke/gone.
        if (tableHasBots(table) && !humanHasChips(table)) return;
        if (table.canStart()) {
          table.startHand();
          broadcast(code);
          scheduleBots(entry);
        }
      }, NEXT_HAND_DELAY_MS);
    };
  }

  function currentEntry(socket) {
    const code = socket.data.tableCode;
    return code ? tables.get(code) : null;
  }

  /** Move a socket out of its current table (cashing out any seat). */
  function leaveCurrent(socket) {
    const entry = currentEntry(socket);
    if (!entry) return;
    const { table } = entry;
    const code = table.code;

    const seatIdx = table.findSeat(socket.data.account);
    if (seatIdx !== -1) {
      const chips = table.stand(socket.data.account);
      if (chips > 0 && socket.data.account) {
        const res = accounts.adjustChips(socket.data.account, chips);
        if (res.ok) socket.emit("account:update", { account: res.account });
      }
    }
    entry.sockets.delete(socket);
    socket.leave(code);
    socket.data.tableCode = null;
    broadcast(code);
    destroyIfEmpty(code);
    if (tables.has(code)) lobby.changed(); // player left but table lives on
  }

  io.on("connection", (socket) => {
    socket.data.account = null;
    socket.data.tableCode = null;

    socket.on("auth", ({ token } = {}) => {
      const key = accounts.verifyToken(token);
      const acc = key ? accounts.get(key) : null;
      socket.data.account = acc ? acc.name.toLowerCase() : null;
      socket.data.displayName = acc ? acc.name : null;
    });

    socket.on("poker:create", ({ smallBlind = 10, bigBlind = 20 } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      leaveCurrent(socket);
      const code = makeCode();
      const sb = clampInt(smallBlind, 1, 100000, 10);
      const bb = Math.max(clampInt(bigBlind, 2, 200000, 20), sb * 2);
      const table = new PokerTable(code, { smallBlind: sb, bigBlind: bb });
      const acc = accounts.get(socket.data.account);
      const entry = {
        table, sockets: new Set(), timer: null,
        hostKey: socket.data.account, hostName: (acc && acc.name) || socket.data.displayName || "?",
      };
      tables.set(code, entry);
      attachHooks(entry, code);

      entry.sockets.add(socket);
      socket.join(code);
      socket.data.tableCode = code;
      registerLobby(code);
      ack && ack({ ok: true, code });
      broadcast(code);
    });

    socket.on("poker:createBots", ({ bots = 3, buyIn, bigBlind = 20 } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      const acc = accounts.get(socket.data.account);
      if (!acc) return ack && ack({ ok: false, error: "Account nicht gefunden." });
      leaveCurrent(socket);

      const bb = clampInt(bigBlind, 2, 200000, 20);
      const sb = Math.max(1, Math.floor(bb / 2));
      const botCount = clampInt(bots, 1, 5, 3);
      const amount = clampInt(buyIn, bb, acc.chips, Math.min(acc.chips, bb * 100));
      if (amount < bb || amount > acc.chips)
        return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      const code = makeCode();
      const table = new PokerTable(code, { smallBlind: sb, bigBlind: bb });
      const entry = { table, sockets: new Set(), timer: null, botTimer: null, vsBots: true };
      tables.set(code, entry);
      attachHooks(entry, code);
      entry.sockets.add(socket);
      socket.join(code);
      socket.data.tableCode = code;

      const deduct = accounts.adjustChips(socket.data.account, -amount);
      if (!deduct.ok) {
        tables.delete(code);
        return ack && ack({ ok: false, error: deduct.error });
      }
      table.sit(socket.data.account, acc.name, amount);
      socket.emit("account:update", { account: deduct.account });

      for (let i = 0; i < botCount; i++) {
        const bidx = table.sit("bot:" + i, pickBotName(table), amount);
        if (bidx !== -1) table.seats[bidx].isBot = true;
      }

      ack && ack({ ok: true, code });
      if (table.startHand()) {
        broadcast(code);
        scheduleBots(entry);
      } else {
        broadcast(code);
      }
    });

    socket.on("poker:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const entry = tables.get(code);
      if (!entry) return ack && ack({ ok: false, error: "Tisch nicht gefunden." });
      leaveCurrent(socket);
      entry.sockets.add(socket);
      socket.join(code);
      socket.data.tableCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("poker:sit", ({ buyIn } = {}, ack) => {
      const entry = currentEntry(socket);
      if (!entry) return ack && ack({ ok: false, error: "Du bist an keinem Tisch." });
      const { table } = entry;
      if (table.findSeat(socket.data.account) !== -1)
        return ack && ack({ ok: false, error: "Du sitzt bereits." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack && ack({ ok: false, error: "Account nicht gefunden." });
      const amount = clampInt(buyIn, table.bigBlind, acc.chips, Math.min(acc.chips, table.bigBlind * 50));
      if (amount < table.bigBlind || amount > acc.chips)
        return ack && ack({ ok: false, error: "Ungültiger Buy-in." });

      const deduct = accounts.adjustChips(socket.data.account, -amount);
      if (!deduct.ok) return ack && ack({ ok: false, error: deduct.error });

      const idx = table.sit(socket.data.account, acc.name, amount);
      if (idx === -1) {
        accounts.adjustChips(socket.data.account, amount); // refund — table full
        return ack && ack({ ok: false, error: "Tisch ist voll." });
      }
      socket.emit("account:update", { account: deduct.account });
      ack && ack({ ok: true });
      broadcast(table.code);
    });

    // Add a single bot to the current table (e.g. to fill a friends' lobby).
    socket.on("poker:addBot", (ack) => {
      const entry = currentEntry(socket);
      if (!entry) return ack && ack && ack({ ok: false, error: "Du bist an keinem Tisch." });
      const { table } = entry;
      if (table.seats.every((s) => s !== null)) return ack && ack && ack({ ok: false, error: "Tisch ist voll." });
      let n = 0;
      while (table.findSeat("bot:" + n) !== -1) n++;
      const idx = table.sit("bot:" + n, pickBotName(table), table.bigBlind * 50);
      if (idx !== -1) table.seats[idx].isBot = true;
      ack && ack && ack({ ok: true });
      broadcast(table.code);
      scheduleBots(entry);
    });

    socket.on("poker:stand", (ack) => {
      const entry = currentEntry(socket);
      if (!entry) return ack && ack && ack({ ok: false });
      const { table } = entry;
      const chips = table.stand(socket.data.account);
      if (chips > 0) {
        const res = accounts.adjustChips(socket.data.account, chips);
        if (res.ok) socket.emit("account:update", { account: res.account });
      }
      ack && ack && ack({ ok: true });
      broadcast(table.code);
    });

    socket.on("poker:leave", () => leaveCurrent(socket));

    socket.on("poker:start", (ack) => {
      const entry = currentEntry(socket);
      if (!entry) return;
      // Only the lobby leader (table creator) may start the first hand. Bot
      // tables have no human host gate (the solo player runs the show).
      if (!entry.vsBots && entry.hostKey && entry.hostKey !== socket.data.account)
        return ack && ack({ ok: false, error: "Nur der Anführer kann starten." });
      if (entry.table.startHand()) {
        broadcast(entry.table.code);
        scheduleBots(entry);
      }
      ack && ack({ ok: true });
    });

    socket.on("poker:action", ({ action, amount } = {}) => {
      const entry = currentEntry(socket);
      if (!entry) return;
      const res = entry.table.act(socket.data.account, action, amount);
      if (!res.ok) socket.emit("poker:error", { message: res.error });
      broadcast(entry.table.code);
      scheduleBots(entry);
    });

    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

function clampInt(v, min, max, fallback) {
  v = Math.floor(Number(v));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

module.exports = { setupPoker };
