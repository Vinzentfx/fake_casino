"use strict";

/* ============================================================
   Fake Casino – quest board (Aufträge).
   Global rotation (same for everyone), progress bars, auto-paid
   rewards; completion toasts arrive via the quest:done event.
   ============================================================ */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  function hhmm(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h >= 24 ? `${Math.floor(h / 24)} T ${h % 24} Std` : `${h} Std ${m} Min`;
  }

  function questRow(q) {
    const pct = Math.min(100, Math.round((100 * q.prog) / q.target));
    return `<div class="quest ${q.done ? "done" : ""}">
      <div class="quest-top">
        <span class="quest-label">${escapeHtml(q.label)}</span>
        <b class="quest-reward">${q.done ? "✓ kassiert" : "+" + fmt(q.reward) + " 🪙"}</b>
      </div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="quest-prog">${q.prog}/${q.target}</div>
    </div>`;
  }

  function load() {
    socket.emit("quest:list", (res) => {
      const dBox = $("#quest-dailies"), wBox = $("#quest-weeklies");
      if (!res || !res.ok) {
        if (dBox) dBox.innerHTML = '<p class="muted small">Bitte einloggen.</p>';
        if (wBox) wBox.innerHTML = "";
        return;
      }
      if (dBox) dBox.innerHTML = res.dailies.map(questRow).join("");
      if (wBox) wBox.innerHTML = res.weeklies.map(questRow).join("");
      const dt = $("#quest-day-timer"), wt = $("#quest-week-timer");
      if (dt) dt.textContent = `· neue in ${hhmm(res.msDay)}`;
      if (wt) wt.textContent = `· neue in ${hhmm(res.msWeek)}`;
    });
  }

  // Completion celebration (mine only — big ones everyone sees in chat anyway).
  socket.on("quest:done", (q) => {
    const acc = window.Casino.getAccount && window.Casino.getAccount();
    if (!q || !acc || !q.user || q.user.toLowerCase() !== acc.name.toLowerCase()) return;
    toast(`🎯 Auftrag erledigt: ${q.label} — +${fmt(q.reward)} 🪙!`);
    // refresh if the board is open
    const screen = document.querySelector('[data-screen="quests"]');
    if (screen && screen.classList.contains("active")) load();
  });

  window.Casino._loadQuests = load;
})();
