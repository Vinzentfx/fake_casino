"use strict";

/**
 * Loans & banking.
 *
 * Any player can take ONE loan at a time (capped at a share of their net worth)
 * and must repay it in full before borrowing again. Interest accrues over time
 * (simple interest). When the loan is repaid, the interest goes to whoever owns
 * the Bank building in the shared city (game/city.js) — or vanishes as a sink if
 * the Bank is NPC-owned. The Bank's own passive "NPC lending" income flows
 * through its normal city P&L.
 *
 * Loan state lives on the account (`acc.loan = { principal, takenAt }`), so it
 * persists with accounts.json.
 */

const city = require("./city");

const RATE_PER_HOUR = 0.05;                         // 5% simple interest per hour
const RATE_PER_MS = RATE_PER_HOUR / 3_600_000;
const MIN_LOAN = 100;
const MAX_LOAN_FRACTION = 0.5;                      // borrow up to 50% of net worth

// Savings: a safe but modest yield (deliberately far below loan rate + capped,
// so it never out-earns active play).
const SAVINGS_RATE_PER_HOUR = 0.0012;               // ~2.9% / day
const SAVINGS_RATE_PER_MS = SAVINGS_RATE_PER_HOUR / 3_600_000;
const SAVINGS_CAP = 25_000_000;                     // max chips on deposit

/** Credit accrued interest into the savings balance (compounds on interaction). */
function accrueSavings(acc, now = Date.now()) {
  const s = acc.savings;
  if (!s || !s.amount || !s.since) return;
  const interest = Math.floor(s.amount * SAVINGS_RATE_PER_MS * Math.max(0, now - s.since));
  if (interest > 0) s.amount += interest;
  s.since = now;
}
function savingsState(acc) {
  accrueSavings(acc);
  return {
    savings: (acc.savings && acc.savings.amount) || 0,
    savingsRatePerHour: SAVINGS_RATE_PER_HOUR,
    savingsCap: SAVINGS_CAP,
  };
}

/** Current amount owed on a loan (principal + simple interest). */
function loanOwed(loan, now = Date.now()) {
  if (!loan) return 0;
  return Math.ceil(loan.principal * (1 + RATE_PER_MS * Math.max(0, now - loan.takenAt)));
}

function maxLoan(acc, accounts) {
  const nw = accounts.publicAccount(acc).netWorth || 0;
  return Math.max(0, Math.floor(nw * MAX_LOAN_FRACTION));
}

function stateFor(acc, accounts) {
  const base = {
    ratePerHour: RATE_PER_HOUR,
    minLoan: MIN_LOAN,
    maxLoan: maxLoan(acc, accounts),
    bankOwner: city.bankOwner(),
    ...savingsState(acc),
  };
  if (!acc.loan) return { ...base, active: false };
  const owed = loanOwed(acc.loan);
  return { ...base, active: true, principal: acc.loan.principal, owed, interest: owed - acc.loan.principal, takenAt: acc.loan.takenAt };
}

function setupBank(io, accounts) {
  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    socket.on("loan:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...stateFor(acc, accounts) });
    });

    socket.on("loan:take", ({ amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (acc.loan) return ack({ ok: false, error: "Erst den laufenden Kredit abzahlen." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < MIN_LOAN)
        return ack({ ok: false, error: `Mindestkredit ${MIN_LOAN} 🪙.` });
      const max = maxLoan(acc, accounts);
      if (amount > max) return ack({ ok: false, error: `Über deinem Limit (${max.toLocaleString("de-DE")} 🪙).` });
      acc.loan = { principal: amount, takenAt: Date.now() };
      const res = accounts.adjustChips(socket.data.account, amount); // credits + saves loan
      ack({ ok: true, amount, account: res.account, ...stateFor(acc, accounts) });
    });

    socket.on("loan:repay", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!acc.loan) return ack({ ok: false, error: "Kein offener Kredit." });
      const owed = loanOwed(acc.loan);
      if (acc.chips < owed)
        return ack({ ok: false, error: `Nicht genug Chips für die volle Rückzahlung (${owed.toLocaleString("de-DE")} 🪙).` });
      const interest = owed - acc.loan.principal;
      delete acc.loan;
      const res = accounts.adjustChips(socket.data.account, -owed); // pay it off (saves cleared loan)
      const banker = city.bankOwner();
      if (banker && interest > 0 && banker !== socket.data.account) accounts.adjustChips(banker, interest);
      ack({ ok: true, paid: owed, interest, account: res.account, ...stateFor(acc, accounts) });
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
      ack({ ok: true, account: res.account, ...stateFor(acc, accounts) });
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
      ack({ ok: true, account: res.account, ...stateFor(acc, accounts) });
    });
  });
}

module.exports = { setupBank, loanOwed };
