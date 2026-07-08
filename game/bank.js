"use strict";

/**
 * Bank savings.
 *
 * The bank is a modest chip parking place, not a way to mint bankroll.
 */

// Savings: a tiny parking yield, capped so it never out-earns active play.
const SAVINGS_RATE_PER_DAY = 0.0008;                // 0.08% / day
const SAVINGS_RATE_PER_HOUR = SAVINGS_RATE_PER_DAY / 24;
const SAVINGS_RATE_PER_MS = SAVINGS_RATE_PER_HOUR / 3_600_000;
const SAVINGS_CAP = 25_000_000;                     // max chips on deposit

/** Credit accrued interest into the savings balance (compounds on interaction). */
function accrueSavings(acc, now = Date.now()) {
  const s = acc.savings;
  if (!s || !s.amount || !s.since) return;
  s.amount = Math.min(SAVINGS_CAP, Math.max(0, Math.floor(s.amount)));
  const interest = Math.floor(s.amount * SAVINGS_RATE_PER_MS * Math.max(0, now - s.since));
  if (interest > 0) s.amount = Math.min(SAVINGS_CAP, s.amount + interest);
  s.since = now;
}
function savingsState(acc) {
  accrueSavings(acc);
  return {
    savings: (acc.savings && acc.savings.amount) || 0,
    savingsRatePerHour: SAVINGS_RATE_PER_HOUR,
    savingsRatePerDay: SAVINGS_RATE_PER_DAY,
    savingsCap: SAVINGS_CAP,
  };
}

function stateFor(acc) {
  return {
    ...savingsState(acc),
  };
}

function setupBank(io, accounts) {
  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    socket.on("bank:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...stateFor(acc) });
    });

    socket.on("savings:deposit", ({ amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 1) return ack({ ok: false, error: "Ungültiger Betrag." });
      if (acc.chips < amount) return ack({ ok: false, error: "Nicht genug Chips." });
      acc.savings = acc.savings || { amount: 0, since: Date.now() };
      accrueSavings(acc);
      if (acc.savings.amount + amount > SAVINGS_CAP)
        return ack({ ok: false, error: `Max. ${SAVINGS_CAP.toLocaleString("de-DE")} 🪙 auf dem Sparkonto.` });
      const res = accounts.adjustChips(socket.data.account, -amount); // saves
      acc.savings.amount += amount;
      acc.savings.since = Date.now();
      accounts.save();
      ack({ ok: true, account: res.account, ...stateFor(acc) });
    });

    socket.on("savings:withdraw", ({ amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      acc.savings = acc.savings || { amount: 0, since: Date.now() };
      accrueSavings(acc);
      amount = amount === "all" ? acc.savings.amount : Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 1) return ack({ ok: false, error: "Ungültiger Betrag." });
      if (amount > acc.savings.amount) return ack({ ok: false, error: "So viel ist nicht gespart." });
      acc.savings.amount -= amount;
      acc.savings.since = Date.now();
      const res = accounts.adjustChips(socket.data.account, amount); // saves (incl. savings field)
      ack({ ok: true, account: res.account, ...stateFor(acc) });
    });
  });
}

module.exports = { setupBank };
