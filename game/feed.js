"use strict";

/**
 * Global live feed for the lobby.
 *
 * Ephemeral and compact: it highlights notable moments without replacing chat
 * or revealing admin-only mechanics.
 */

const HISTORY = 30;
const BIG_WIN = 100000;
const BIG_LOSS = 250000;

let _io = null;
let _accounts = null;
const items = [];

function push(type, text, meta = {}) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, text: String(text).slice(0, 180), ts: Date.now(), meta };
  items.unshift(item);
  if (items.length > HISTORY) items.length = HISTORY;
  if (_io) _io.emit("feed:update", item);
  return item;
}

function add(type, text, meta = {}) {
  return push(type, text, meta);
}

function setupFeed(io, accounts) {
  _io = io;
  _accounts = accounts;

  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    const acc = accounts.get(name);
    const display = acc ? acc.name : String(name || "?");
    const net = Math.floor(Number(winnings) || 0);
    const gameLabel = game ? String(game) : "Casino";
    if (net >= BIG_WIN) {
      push("win", `${display} gewinnt ${net.toLocaleString("de-DE")} Chips bei ${gameLabel}.`, { user: display, amount: net, game });
    } else if (net <= -BIG_LOSS) {
      push("loss", `${display} verliert ${Math.abs(net).toLocaleString("de-DE")} Chips bei ${gameLabel}.`, { user: display, amount: Math.abs(net), game });
    }
  });

  io.on("connection", (socket) => {
    socket.on("feed:list", (ack) => {
      if (typeof ack === "function") ack({ ok: true, items });
    });
  });
}

module.exports = { setupFeed, add };
