"use strict";

/**
 * Casino-Heist — a rare co-op event the owner triggers.
 *
 * Everyone online hammers a "Knacken!" button to drain the shared vault's HP
 * before the timer runs out. Crack it in time and the loot is split among the
 * crooks in proportion to their hits; run out of time and the vault holds.
 *
 * Vault HP scales with the number of players online at the start, so it always
 * needs teamwork. Hits are rate-limited per account (no autoclicker runaway).
 */

const chat = require("./chat");

const HIT_MAX = 8, HIT_WINDOW = 1000; // ≤8 hits/s per account
const HP_PER_PLAYER = 200;
const MIN_HP = 400;

function setupHeist(io, accounts) {
  let state = null; // { endsAt, vaultMax, vaultHp, hits:{key:n}, loot }
  let ticker = null;
  const hitTimes = new Map();

  const online = () => { let n = 0; for (const s of io.of("/").sockets.values()) if (s.data && s.data.account) n++; return n; };
  const snapshot = () => state
    ? { active: true, endsAt: state.endsAt, vaultMax: state.vaultMax, vaultHp: Math.max(0, state.vaultHp), loot: state.loot }
    : { active: false };

  function cleanup() { if (ticker) clearInterval(ticker); ticker = null; state = null; hitTimes.clear(); }

  function success() {
    const total = Object.values(state.hits).reduce((a, b) => a + b, 0) || 1;
    const results = [];
    for (const [key, h] of Object.entries(state.hits)) {
      const share = Math.floor(state.loot * h / total);
      if (share > 0) { accounts.adjustChips(key, share); const a = accounts.get(key); results.push({ name: a ? a.name : key, share, hits: h }); }
    }
    results.sort((a, b) => b.share - a.share);
    chat.announce(io, `💰 TRESOR GEKNACKT! ${results.length} Ganoven teilen sich ${state.loot.toLocaleString("de-DE")} 🪙!`);
    io.emit("heist:end", { success: true, loot: state.loot, results });
    cleanup();
  }
  function fail() {
    chat.announce(io, "🔒 Heist gescheitert — der Tresor hat gehalten. Nächstes Mal!");
    io.emit("heist:end", { success: false });
    cleanup();
  }

  function start(loot, seconds, opts = {}) {
    if (state) return { ok: false, error: "Es läuft schon ein Heist." };
    loot = Math.max(1000, Math.floor(loot) || 500000);
    seconds = Math.max(15, Math.min(300, Math.floor(seconds) || 60));
    const hp = Math.max(MIN_HP, HP_PER_PLAYER * online());
    state = { endsAt: Date.now() + seconds * 1000, vaultMax: hp, vaultHp: hp, hits: {}, loot };
    const prefix = opts.auto ? "ZUFÄLLIGER " : "";
    chat.announce(io, `🚨 ${prefix}CASINO-HEIST! Knackt gemeinsam den Tresor — ${loot.toLocaleString("de-DE")} 🪙 Beute wartet. Alle ran an den Button!`);
    io.emit("heist:start", snapshot());
    ticker = setInterval(() => {
      if (!state) return;
      if (Date.now() >= state.endsAt) return fail();
      io.emit("heist:progress", snapshot());
    }, 300);
    return { ok: true };
  }
  function stop() { if (state) fail(); }
  function active() { return !!state; }

  io.on("connection", (socket) => {
    socket.on("heist:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...snapshot() }); });

    socket.on("heist:hit", (ack) => {
      if (!state || !socket.data.account) return typeof ack === "function" && ack({ ok: false });
      const key = socket.data.account, now = Date.now();
      const times = (hitTimes.get(key) || []).filter((t) => now - t < HIT_WINDOW);
      if (times.length >= HIT_MAX) { hitTimes.set(key, times); return typeof ack === "function" && ack({ ok: false, rate: true }); }
      times.push(now); hitTimes.set(key, times);
      state.hits[key] = (state.hits[key] || 0) + 1;
      state.vaultHp -= 1;
      if (typeof ack === "function") ack({ ok: true, myHits: state.hits[key], vaultHp: Math.max(0, state.vaultHp) });
      if (state.vaultHp <= 0) success();
    });
  });

  return { start, stop, active };
}

module.exports = { setupHeist };
