"use strict";

// Reject malformed envelopes before any game listener sees them. Game-specific
// business rules still belong in each handler, before it reserves or pays chips.
function validPayload(value) {
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 12000 || depth > 12) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return v.length <= 450000;
    if (typeof v !== "object" || Buffer.isBuffer(v)) return false;
    if (Array.isArray(v)) return v.length <= 2048 && v.every(x => visit(x, depth + 1));
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    return Object.entries(v).every(([k, x]) => !["__proto__", "constructor", "prototype"].includes(k) && visit(x, depth + 1));
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) && visit(value, 0);
}

function protectSocket(socket, logger = console) {
  socket.use((packet, next) => {
    const args = packet.slice(1);
    const ack = typeof args.at(-1) === "function" ? args.pop() : null;
    const bad = args.length > 1 || (args.length === 1 && !validPayload(args[0]))
      || (packet[0] === "auth" && (args.length !== 1 || typeof args[0]?.token !== "string" || args[0].token.length > 2048));
    if (bad) {
      const response = { ok: false, error: "Ungültige Anfrage. Bitte die Seite aktualisieren." };
      if (ack) ack(response); else socket.emit("request:error", response);
      return;
    }
    next();
  });
  const on = socket.on.bind(socket);
  socket.on = (event, handler) => on(event, function (...args) {
    const fail = () => {
      // Never log tokens, private messages or complete payloads.
      logger.error("[socket] Aktion abgebrochen:", event);
      const ack = args.at(-1);
      const response = { ok: false, error: "Aktion unterbrochen. Bitte den aktuellen Stand prüfen, bevor du sie wiederholst." };
      if (typeof ack === "function") ack(response); else socket.emit("request:error", response);
    };
    try {
      const result = handler.apply(this, args);
      if (result && typeof result.catch === "function") result.catch(fail);
      return result;
    } catch { fail(); }
  });
}
module.exports = { protectSocket, validPayload };
