"use strict";

/* ============================================================
   Fake Casino – Bank client (loans)
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, showScreen } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const RATE_PER_MS = 0.05 / 3_600_000; // mirror of server (5%/h)

  let state = null;

  function loadBank() {
    socket.emit("loan:state", (res) => {
      if (!res || !res.ok) return;
      state = res;
      render();
    });
  }

  function liveOwed() {
    if (!state || !state.active) return 0;
    return Math.ceil(state.principal * (1 + RATE_PER_MS * Math.max(0, Date.now() - state.takenAt)));
  }

  function render() {
    const panel = $("#bank-loan-panel");
    if (!panel || !state) return;
    const ownerLine = $("#bank-owner-line");
    if (ownerLine) {
      ownerLine.innerHTML = state.bankOwner
        ? `Bank-Besitzer: <b>${window.Casino.escapeHtml(state.bankOwner)}</b> — kassiert alle Kredit-Zinsen.`
        : `Die Bank gehört noch niemandem — Zinsen verfallen. Kauf die 🏦 in der Stadt!`;
    }

    if (state.active) {
      const owed = liveOwed();
      const interest = owed - state.principal;
      panel.innerHTML = `
        <div class="stat-row"><span>Aufgenommen</span><b>${fmt(state.principal)} 🪙</b></div>
        <div class="stat-row"><span>Zinsen (5 %/Std.)</span><b class="neg">+${fmt(interest)} 🪙</b></div>
        <div class="stat-row" style="border:none"><span>Schuld jetzt</span><b id="bank-owed" class="neg">${fmt(owed)} 🪙</b></div>
        <button class="btn-primary" id="bank-repay-btn" style="margin-top:12px">Kredit abzahlen — ${fmt(owed)} 🪙</button>
        <div class="form-error" id="bank-error"></div>`;
      $("#bank-repay-btn").addEventListener("click", repay);
    } else {
      panel.innerHTML = `
        <div class="stat-row" style="border:none"><span>Max. Kredit (50 % vom Vermögen)</span><b>${fmt(state.maxLoan)} 🪙</b></div>
        <label class="bank-input-row">
          <span>Betrag</span>
          <input id="bank-amount" type="number" min="${state.minLoan}" max="${state.maxLoan}" value="${Math.min(state.maxLoan, 1000)}" />
        </label>
        <button class="btn-primary" id="bank-take-btn" style="margin-top:12px"${state.maxLoan < state.minLoan ? " disabled" : ""}>💰 Kredit aufnehmen</button>
        <div class="form-error" id="bank-error"></div>
        ${state.maxLoan < state.minLoan ? '<p class="muted small" style="margin-top:8px">Dein Vermögen ist zu klein für einen Kredit.</p>' : ""}`;
      $("#bank-take-btn").addEventListener("click", takeLoan);
    }
  }

  function takeLoan() {
    const err = $("#bank-error");
    err.textContent = "";
    const amount = parseInt($("#bank-amount").value, 10);
    socket.emit("loan:take", { amount }, (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account);
      state = res;
      render();
      toast(`💰 +${fmt(res.amount)} 🪙 Kredit aufgenommen.`);
    });
  }

  function repay() {
    const err = $("#bank-error");
    err.textContent = "";
    socket.emit("loan:repay", (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account);
      state = res;
      render();
      toast(`✓ Kredit abgezahlt (−${fmt(res.paid)} 🪙).`);
    });
  }

  // Live-tick the whole loan panel while on the bank screen so the owed amount,
  // interest line and repay button stay consistent.
  setInterval(() => {
    const screen = document.querySelector('[data-screen="bank"]');
    if (!screen || !screen.classList.contains("active") || !state || !state.active) return;
    render();
  }, 1000);

  // app.js's showScreen calls this when the bank screen opens.
  window.Casino._loadBank = loadBank;
})();
