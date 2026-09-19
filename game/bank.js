"use strict";

/**
 * Sparkonto.
 *
 * Die Bank ist ein bescheidener Parkplatz für Chips, keine Gelddruckmaschine.
 */

// Sparen: ein winziger Zins fürs Parken, gedeckelt, damit er nie mehr bringt als Spielen.
const SAVINGS_RATE_PER_DAY = 0.0008;                // 0,08 % pro Tag
const SAVINGS_RATE_PER_HOUR = SAVINGS_RATE_PER_DAY / 24;
const SAVINGS_RATE_PER_MS = SAVINGS_RATE_PER_HOUR / 3_600_000;
const SAVINGS_CAP = 25_000_000;                     // höchstens so viel auf dem Konto

let _accounts = null; // gesetzt in setupBank, für Faucet-Tapering

/** Aufgelaufene Zinsen gutschreiben (verzinst sich bei jeder Aktion mit). */
function accrueSavings(acc, now = Date.now()) {
  const s = acc.savings;
  if (!s || !s.amount || !s.since) return;
  s.amount = Math.min(SAVINGS_CAP, Math.max(0, Math.floor(s.amount)));
  // Reiche werden getapert (wie alle anderen Faucets), Zins ist neu erzeugtes Geld.
  const f = _accounts && _accounts.faucetFactor ? _accounts.faucetFactor(acc.name) : 1;
  const interest = Math.floor(s.amount * SAVINGS_RATE_PER_MS * Math.max(0, now - s.since) * f);
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

/**
 * Ist das Sparkonto voll?
 *
 * Fuer die Marke auf der Lobby-Kachel. Am Deckel hoert der Zins auf, und
 * das merkt sonst niemand: der Stand steht ja weiter da und sieht gut aus.
 * Im Stand vom 18.9. liegt ein Konto bei 17 von 25 Millionen, der Deckel
 * ist also erreichbar und nicht bloss theoretisch.
 *
 * Es ist die einzige Sache in der Bank, die ueberhaupt auf einen wartet:
 * Zinsen laufen von selbst auf, es gibt nichts abzuholen und keine
 * Kredite. Eine Marke ohne Bedeutung waere schlimmer als keine.
 */
function sparVoll(acc) {
  if (!acc || !acc.savings) return false;
  accrueSavings(acc);
  return (acc.savings.amount || 0) >= SAVINGS_CAP;
}

function setupBank(io, accounts) {
  _accounts = accounts;
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
        return ack({ ok: false, error: `Max. ${SAVINGS_CAP.toLocaleString("de-DE")} Chips auf dem Sparkonto.` });
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

module.exports = { setupBank, sparVoll, SAVINGS_CAP };
