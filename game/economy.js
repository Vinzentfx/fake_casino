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

function setupEconomy(io, accounts) {
  const acct = (s) => (s.data.account ? accounts.get(s.data.account) : null);

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
        pending: city.totalPending(socket.data.account),
      });
    });

    // Collect ONE business's accrued income (you must tap each business).
    socket.on("economy:collectLot", ({ plotId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = city.collectLot(plotId, key);
      if (!r.ok) return ack(r);
      r.commit();
      const res = accounts.adjustChips(key, r.amount);
      ack({ ok: true, amount: r.amount, account: res.account, city: city.publicCity(key) });
    });

    // ── Shared city ───────────────────────────────────────────────────────
    socket.on("city:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      ack({ ok: true, city: city.publicCity(key), casinoOwner: city.casinoOwner() });
    });

    // Generic city action: validate, pay any chip cost (buy/build) or gain
    // (sell), commit, broadcast. On a takeover/lease the previous operator's
    // accrued income for that lot is banked to them first (so it isn't lost).
    function doAction(socket, ack, make, plotId) {
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = make(key, acc.name);
      if (!r.ok) return ack(r);
      if (r.cost && accounts.get(key).chips < r.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      if (r.prevOwner && r.prevOwner !== key && plotId != null) {
        const pc = city.collectLot(plotId, r.prevOwner); // bank their pending before they lose it
        if (pc.ok && pc.amount > 0) { accounts.adjustChips(r.prevOwner, pc.amount); pc.commit(); }
      }
      r.commit();
      let res;
      if (r.cost) res = accounts.adjustChips(key, -r.cost).account;
      else if (r.gain) res = accounts.adjustChips(key, r.gain).account;
      else res = accounts.publicAccount(accounts.get(key));
      ack({ ok: true, account: res, cost: r.cost || 0, gain: r.gain || 0, city: city.publicCity(key), casinoOwner: city.casinoOwner() });
      broadcastCity();
    }

    const A = (fn) => ({ plotId, type, val } = {}, ack) => {
      if (typeof ack !== "function") return;
      doAction(socket, ack, (key, name) => fn(plotId, key, name, type, val), plotId);
    };
    socket.on("city:buyLand",    A((id, key, name) => city.buyLand(id, key, name)));
    socket.on("city:sellLand",   A((id, key) => city.sellLand(id, key)));
    socket.on("city:setForRent", A((id, key, name, type, val) => city.setForRent(id, key, val)));
    socket.on("city:build",      A((id, key, name, type) => city.build(id, key, type, name)));
    socket.on("city:buyBiz",     A((id, key, name) => city.buyBiz(id, key, name)));
    socket.on("city:takeover",   A((id, key, name) => city.takeover(id, key, name)));
    socket.on("city:setForLease",A((id, key, name, type, val) => city.setForLease(id, key, val)));
    socket.on("city:lease",      A((id, key, name) => city.lease(id, key, name)));

    socket.on("disconnect", () => clickTimes.delete(socket.id));
  });

  // Market life: every 15s nudge each business's performance and let open
  // city screens refresh, so income figures visibly move instead of sitting flat.
  setInterval(() => { city.tickMarket(); io.emit("city:update"); }, 15000);
}

module.exports = { setupEconomy };
