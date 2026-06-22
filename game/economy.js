"use strict";

// ─── Business catalog ───────────────────────────────────────────────────────
// BALANCING NOTE (Vincent): baseCost, incomePerSec, and the upgrade cost
// formula below are placeholder values. Adjust freely after seeing them
// in practice — numbers are not locked in.
const BUSINESSES = [
  { id: "kiosk",  name: "Kiosk",  emoji: "🏪", baseCost: 100,    incomePerSec: 0.5  },
  { id: "cafe",   name: "Café",   emoji: "☕", baseCost: 500,    incomePerSec: 2    },
  { id: "imbiss", name: "Imbiss", emoji: "🌭", baseCost: 2000,   incomePerSec: 8    },
  { id: "hotel",  name: "Hotel",  emoji: "🏨", baseCost: 10000,  incomePerSec: 35   },
  { id: "fabrik", name: "Fabrik", emoji: "🏭", baseCost: 50000,  incomePerSec: 150  },
  { id: "kasino", name: "Kasino", emoji: "🎰", baseCost: 250000, incomePerSec: 700  },
];

const MAX_OFFLINE_SEC = 8 * 60 * 60; // 8-hour cap on offline earnings

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureEconomy(acc) {
  if (!acc.economy) {
    acc.economy = { clickPower: 1, businesses: {}, lastCollect: Date.now() };
    return true; // signals: was just initialized, caller should save
  }
  if (!acc.economy.clickPower) acc.economy.clickPower = 1;
  if (!acc.economy.businesses) acc.economy.businesses = {};
  if (!acc.economy.lastCollect) acc.economy.lastCollect = Date.now();
  return false;
}

// BALANCING NOTE: cost = 50 * 1.5^(clickPower-1), rounded up.
function clickUpgradeCost(clickPower) {
  return Math.ceil(50 * Math.pow(1.5, clickPower - 1));
}

// BALANCING NOTE: cost = baseCost * 1.15^owned, rounded up.
function buyCost(business, owned) {
  return Math.ceil(business.baseCost * Math.pow(1.15, owned));
}

function incomeRatePerSec(eco) {
  let rate = 0;
  for (const b of BUSINESSES) {
    rate += b.incomePerSec * (eco.businesses[b.id] || 0);
  }
  return rate;
}

function pendingIncome(acc) {
  const eco = acc.economy;
  if (!eco) return 0;
  const elapsedSec = Math.min((Date.now() - eco.lastCollect) / 1000, MAX_OFFLINE_SEC);
  return Math.floor(incomeRatePerSec(eco) * elapsedSec);
}

// Total chips spent purchasing businesses (used for netWorth).
// Keep in sync with BUSINESSES catalog above.
function businessesSpent(eco) {
  if (!eco) return 0;
  let total = 0;
  for (const b of BUSINESSES) {
    const count = (eco.businesses || {})[b.id] || 0;
    for (let i = 0; i < count; i++) {
      total += Math.ceil(b.baseCost * Math.pow(1.15, i));
    }
  }
  return total;
}

// ─── Socket setup ───────────────────────────────────────────────────────────

function setupEconomy(io, accounts) {
  // Per-socket click rate limiter (max ~20 clicks / second)
  const clickTimes = new Map(); // socketId -> timestamp[]
  const CLICK_MAX = 20;
  const CLICK_WINDOW_MS = 1000;

  io.on("connection", (socket) => {
    // ── work:click ──────────────────────────────────────────────────────────
    socket.on("work:click", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });

      // Rate limit
      const now = Date.now();
      const times = (clickTimes.get(socket.id) || []).filter((t) => now - t < CLICK_WINDOW_MS);
      if (times.length >= CLICK_MAX) {
        clickTimes.set(socket.id, times);
        return ack({ ok: false, error: "Zu schnell." });
      }
      times.push(now);
      clickTimes.set(socket.id, times);

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const justInit = ensureEconomy(acc);

      const delta = acc.economy.clickPower;
      const res = accounts.adjustChips(socket.data.account, delta); // also saves economy if justInit
      if (!res.ok) return ack({ ok: false, error: res.error });
      if (justInit) accounts.adjustChips(socket.data.account, 0); // ensure init is persisted
      ack({ ok: true, account: res.account, earned: delta });
    });

    // ── work:upgrade ────────────────────────────────────────────────────────
    socket.on("work:upgrade", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      ensureEconomy(acc);

      const cost = clickUpgradeCost(acc.economy.clickPower);
      if (acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips." });

      acc.economy.clickPower += 1;
      const newPower = acc.economy.clickPower;
      const res = accounts.adjustChips(socket.data.account, -cost); // saves
      if (!res.ok) {
        acc.economy.clickPower -= 1; // rollback (shouldn't happen after the chip check)
        return ack({ ok: false, error: res.error });
      }
      ack({ ok: true, account: res.account, clickPower: newPower });
    });

    // ── economy:state ───────────────────────────────────────────────────────
    socket.on("economy:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const justInit = ensureEconomy(acc);
      if (justInit) accounts.adjustChips(socket.data.account, 0); // persist init

      const eco = acc.economy;
      const owned = {};
      for (const b of BUSINESSES) owned[b.id] = eco.businesses[b.id] || 0;

      ack({
        ok: true,
        catalog: BUSINESSES,
        owned,
        clickPower: eco.clickPower,
        pending: pendingIncome(acc),
        ratePerSec: incomeRatePerSec(eco),
        lastCollect: eco.lastCollect,
      });
    });

    // ── economy:buy ─────────────────────────────────────────────────────────
    socket.on("economy:buy", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });

      const business = BUSINESSES.find((b) => b.id === id);
      if (!business) return ack({ ok: false, error: "Unbekanntes Unternehmen." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      ensureEconomy(acc);

      const prevOwned = acc.economy.businesses[id] || 0;
      const cost = buyCost(business, prevOwned);
      if (acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips." });

      acc.economy.businesses[id] = prevOwned + 1;
      const newOwned = acc.economy.businesses[id];
      const res = accounts.adjustChips(socket.data.account, -cost); // saves
      if (!res.ok) {
        acc.economy.businesses[id] = prevOwned; // rollback
        return ack({ ok: false, error: res.error });
      }
      ack({
        ok: true,
        account: res.account,
        id,
        owned: newOwned,
        nextCost: buyCost(business, newOwned),
        ratePerSec: incomeRatePerSec(acc.economy),
      });
    });

    // ── economy:collect ─────────────────────────────────────────────────────
    socket.on("economy:collect", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      ensureEconomy(acc);

      const amount = pendingIncome(acc);
      acc.economy.lastCollect = Date.now(); // always reset the timer

      // adjustChips(delta=0) is used as a save-only call when no chips change
      const res = accounts.adjustChips(socket.data.account, amount); // saves (works for delta=0 too)
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, amount, account: res.account });
    });

    socket.on("disconnect", () => {
      clickTimes.delete(socket.id);
    });
  });
}

module.exports = { setupEconomy, BUSINESSES, businessesSpent };
