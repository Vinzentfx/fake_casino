"use strict";

/* Bank: Sparkonto */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let state = null;

  function loadBank() {
    socket.emit("bank:state", (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Bank konnte nicht geladen werden."); return; }
      state = res;
      render();
    });
  }

  function renderSavings() {
    const p = $("#bank-savings-panel");
    if (!p || !state) return;
    if (document.activeElement && document.activeElement.id === "sav-amount") return; // don't wipe typing
    const bal = state.savings || 0;
    // Der persönliche Satz nach der Vermögensbremse, nicht der allgemeine.
    const satz = state.savingsRatePerDayEffektiv != null ? state.savingsRatePerDayEffektiv : state.savingsRatePerDay || 0;
    const ratePct = (satz * 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    const gebremst = state.savingsFaktor != null && state.savingsFaktor < 0.999;
    const allgemein = ((state.savingsRatePerDay || 0) * 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    p.innerHTML = `
      <div class="stat-row"><span>Guthaben (${ratePct} %/Tag für dich)</span><b class="pos">${fmt(bal)}<i class=mk></i></b></div>
      ${bal > 0 ? `<div class="stat-row" style="border:none"><span>Zinsen am Tag</span><b>etwa +${fmt(state.savingsProTag || 0)}<i class=mk></i></b></div>` : ""}
      ${gebremst ? `<p class="muted small" style="margin:4px 0 6px">Weil dein Vermögen groß ist, bekommst du nur ${Math.round(state.savingsFaktor * 100)} % des allgemeinen Satzes von ${allgemein} %. Das gilt für alle Gratis-Einnahmen gleich.</p>` : ""}
      <div class="stat-row" style="border:none"><span>Limit</span><b>${fmt(state.savingsCap || 0)}<i class=mk></i></b></div>
      <label class="bank-input-row"><span>Betrag</span><input id="sav-amount" type="number" min="1" value="1000" /></label>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" id="sav-deposit" style="flex:1">⬇ Einzahlen</button>
        <button class="btn-primary" id="sav-withdraw" style="flex:1">⬆ Abheben</button>
      </div>
      <button class="chip-btn" id="sav-withdraw-all" style="margin-top:8px;width:100%"${bal < 1 ? " disabled" : ""}>Alles abheben (${fmt(bal)}<i class=mk></i>)</button>
      <div class="form-error" id="sav-error"></div>`;
    const amt = () => parseInt($("#sav-amount").value, 10);
    $("#sav-deposit").addEventListener("click", () => savings("savings:deposit", { amount: amt() }));
    $("#sav-withdraw").addEventListener("click", () => savings("savings:withdraw", { amount: amt() }));
    $("#sav-withdraw-all").addEventListener("click", () => savings("savings:withdraw", { amount: "all" }));
  }
  function savings(ev, payload) {
    const err = $("#sav-error"); if (err) err.textContent = "";
    socket.emit(ev, payload, (res) => {
      if (!res || !res.ok) { if (err) err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account); state = res; render();
      toast(ev === "savings:deposit" ? "Eingezahlt." : "Abgehoben.");
    });
  }

  function render() {
    renderSavings();
    const ownerLine = $("#bank-owner-line");
    if (ownerLine) ownerLine.textContent = "Park Chips sicher auf dem Sparkonto. Geld kommt weiterhin aus den Spielen.";
  }

  // Ruft der Router auf, wenn der Bank-Screen aufgeht.
  window.Casino._loadBank = loadBank;
})();
