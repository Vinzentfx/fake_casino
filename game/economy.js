"use strict";

/**
 * Economy: the work clicker (a capped bootstrap, NOT an idle game) plus passive
 * income from buildings owned in the shared city (game/city.js).
 *
 * The clicker exists only to help a broke/new player afford their first lot —
 * it's deliberately capped so it never competes with the casino or businesses.
 * Real money comes from owning the city and the games.
 */

const city = require("./city");

// ─── Work clicker (capped) ──────────────────────────────────────────────────
const CLICK_BASE = 1;          // chips per click at level 0
const MAX_CLICK_LEVEL = 5;     // a few upgrades, then it's maxed out
const clickUpgradeCost = (lvl) => 200 * (lvl + 1); // lvl 0→200, 1→400, … 4→1000

const MAX_OFFLINE_SEC = 8 * 60 * 60; // passive income capped at 8h offline

function ensureEconomy(acc) {
  if (!acc.economy) acc.economy = {};
  const e = acc.economy;
  if (typeof e.clickLevel !== "number") {
    // Migrate from the old clickPower field if present, else start fresh.
    e.clickLevel = e.clickPower ? Math.min(MAX_CLICK_LEVEL, e.clickPower - 1) : 0;
  }
  if (typeof e.lastCollect !== "number") e.lastCollect = Date.now();
  return e;
}

const clickPower = (e) => CLICK_BASE + e.clickLevel;

// ─── Passive income ───────────────────────────────────────────────────────
function pendingIncome(key, e) {
  const rate = city.ownerIncomeRate(key);
  const elapsed = Math.min((Date.now() - e.lastCollect) / 1000, MAX_OFFLINE_SEC);
  return Math.floor(rate * elapsed);
}

function setupEconomy(io, accounts) {
  const acct = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  /** Bank a player's accrued passive income and reset their timer. Returns amount. */
  function settleIncome(key) {
    const acc = accounts.get(key);
    if (!acc) return 0;
    const e = ensureEconomy(acc);
    const amount = pendingIncome(key, e);
    e.lastCollect = Date.now();
    accounts.adjustChips(key, amount); // delta 0 still persists the timer
    return amount;
  }

  /** Tell everyone the shared city changed; clients re-pull city:state. */
  function broadcastCity() {
    io.emit("city:update");
  }

  // Per-socket click rate limiter (~20/s).
  const clickTimes = new Map();
  const CLICK_MAX = 20, CLICK_WINDOW = 1000;

  io.on("connection", (socket) => {
    // ── Work clicker ────────────────────────────────────────────────────────
    socket.on("work:click", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const now = Date.now();
      const times = (clickTimes.get(socket.id) || []).filter((t) => now - t < CLICK_WINDOW);
      if (times.length >= CLICK_MAX) { clickTimes.set(socket.id, times); return ack({ ok: false, error: "Zu schnell." }); }
      times.push(now); clickTimes.set(socket.id, times);

      const e = ensureEconomy(acc);
      const earned = clickPower(e);
      const res = accounts.adjustChips(socket.data.account, earned);
      ack({ ok: res.ok, account: res.account, earned });
    });

    socket.on("work:upgrade", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      if (e.clickLevel >= MAX_CLICK_LEVEL) return ack({ ok: false, error: "Schon voll ausgebaut — der Rest kommt aus Unternehmen & Casino." });
      const cost = clickUpgradeCost(e.clickLevel);
      if (acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips." });
      e.clickLevel += 1;
      const res = accounts.adjustChips(socket.data.account, -cost);
      if (!res.ok) { e.clickLevel -= 1; return ack({ ok: false, error: res.error }); }
      ack({ ok: true, account: res.account, clickPower: clickPower(e), clickLevel: e.clickLevel, maxed: e.clickLevel >= MAX_CLICK_LEVEL });
    });

    socket.on("economy:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const maxed = e.clickLevel >= MAX_CLICK_LEVEL;
      ack({
        ok: true,
        clickPower: clickPower(e),
        clickLevel: e.clickLevel,
        maxClickLevel: MAX_CLICK_LEVEL,
        upgradeCost: maxed ? null : clickUpgradeCost(e.clickLevel),
        maxed,
        ratePerSec: city.ownerIncomeRate(socket.data.account),
        pending: pendingIncome(socket.data.account, e),
      });
    });

    socket.on("economy:collect", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const amount = settleIncome(socket.data.account);
      ack({ ok: true, amount, account: accounts.publicAccount(accounts.get(socket.data.account)) });
    });

    // ── Shared city ───────────────────────────────────────────────────────
    socket.on("city:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      ack({ ok: true, city: city.publicCity(key), casinoOwner: city.casinoOwner() });
    });

    // Generic helper for the three buy actions: settle income, check chips,
    // charge, commit the city change, broadcast.
    function doBuy(socket, ack, build) {
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = build(key, acc.name);
      if (!r.ok) return ack(r);
      settleIncome(key);                 // bank income before the rate changes
      if (r.prevOwner && r.prevOwner !== key) settleIncome(r.prevOwner); // and the seller's
      const fresh = accounts.get(key);
      if (fresh.chips < r.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      r.commit();
      const res = accounts.adjustChips(key, -r.cost);
      ack({ ok: true, account: res.account, cost: r.cost, city: city.publicCity(key), casinoOwner: city.casinoOwner() });
      broadcastCity();
    }

    socket.on("city:buyLand", ({ plotId } = {}, ack) => {
      if (typeof ack !== "function") return;
      doBuy(socket, ack, (key, name) => city.buyLand(plotId, key, name));
    });
    socket.on("city:build", ({ plotId, type } = {}, ack) => {
      if (typeof ack !== "function") return;
      doBuy(socket, ack, (key, name) => city.build(plotId, key, type, name));
    });
    socket.on("city:buyBiz", ({ plotId } = {}, ack) => {
      if (typeof ack !== "function") return;
      doBuy(socket, ack, (key, name) => city.buyBiz(plotId, key, name));
    });
    socket.on("city:takeover", ({ plotId } = {}, ack) => {
      if (typeof ack !== "function") return;
      doBuy(socket, ack, (key, name) => city.takeover(plotId, key, name));
    });

    socket.on("disconnect", () => clickTimes.delete(socket.id));
  });

  // Market life: every 15s nudge each business's performance and let open
  // city screens refresh, so income figures visibly move instead of sitting flat.
  setInterval(() => { city.tickMarket(); io.emit("city:update"); }, 15000);
}

module.exports = { setupEconomy };
