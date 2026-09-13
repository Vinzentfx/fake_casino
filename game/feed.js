"use strict";

/**
 * Live-Feed für die Lobby.
 *
 * Flüchtig und knapp: zeigt, was gerade passiert, ersetzt aber weder den Chat
 * noch verrät er, was nur der Admin wissen soll.
 */

const HISTORY = 30;
const BIG_WIN = 100000;
const BIG_LOSS = 250000;

let _io = null;
let _accounts = null;
const items = [];

/* Chronik-Gruppe je Feed-Typ. Was hier nicht steht, wandert unter seinem
   eigenen Namen in die Chronik. */
const CHRONIK_ART = { win: "gewinn", loss: "verlust" };

function push(type, text, meta = {}) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, text: String(text).slice(0, 180), ts: Date.now(), meta };
  items.unshift(item);
  if (items.length > HISTORY) items.length = HISTORY;
  if (_io) _io.emit("feed:update", item);
  /* Derselbe Moment noch einmal auf die Platte, fuer den Tagesbericht. Der
     Feed haelt nur dreissig Eintraege und ist nach jedem Deploy leer, wer
     drei Tage weg war, hat sonst nichts zum Nachlesen. */
  try {
    require("./chronik").notiere(CHRONIK_ART[type] || type, text, {
      user: meta.user, wert: meta.amount,
    });
  } catch {}
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

/** Denselben Namen im Live-Feed ersetzen (siehe chronik.umbenennen). */
function umbenennen(alt, neu) {
  const a = String(alt || "").trim();
  if (!a || a === neu) return 0;
  const muster = new RegExp(`(?<![\\p{L}\\p{N}_])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu");
  let n = 0;
  for (const e of items) {
    if (muster.test(e.text)) { e.text = e.text.replace(muster, neu); n++; }
    if (e.user && e.user.toLowerCase() === a.toLowerCase()) e.user = neu;
  }
  return n;
}

module.exports = { setupFeed, add, umbenennen };
