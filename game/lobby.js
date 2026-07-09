"use strict";

/**
 * Shared lobby registry — a single browsable list of open game lobbies across
 * all game types, so players can SEE and JOIN any lobby without exchanging
 * codes. Each game (poker, slots-pvp, …) registers a `describe()` provider per
 * open lobby; the registry pulls live descriptors when building the public list.
 *
 * A descriptor looks like:
 *   { code, game, label, host, players, max, buyIn, joinable }
 * Only `joinable` descriptors are advertised; a provider returning null (or
 * joinable:false) hides its lobby (e.g. once a match has started or filled).
 */

let ioRef = null;
const providers = new Map(); // code -> () => descriptor|null

function publicList() {
  const out = [];
  for (const describe of providers.values()) {
    let d;
    try { d = describe(); } catch { d = null; }
    if (d && (d.joinable || d.watchable)) out.push(d); // joinable OR spectatable (running games)
  }
  // Group by game, newest-ish first within (insertion order is roughly age).
  return out.sort((a, b) => String(a.game).localeCompare(String(b.game)));
}

function broadcast() {
  if (ioRef) ioRef.emit("lobby:list", publicList());
}

/** A game calls this when it opens a lobby. */
function add(code, describe) {
  providers.set(code, describe);
  broadcast();
}
/** Re-advertise after a notable change (player joined/left, state change). */
function changed() {
  broadcast();
}
/** A game calls this when a lobby is torn down. */
function remove(code) {
  if (providers.delete(code)) broadcast();
}

function setupLobby(io) {
  ioRef = io;
  io.on("connection", (socket) => {
    socket.on("lobby:list", (ack) => {
      if (typeof ack === "function") ack({ ok: true, lobbies: publicList() });
    });
  });
}

module.exports = { setupLobby, add, remove, changed };
