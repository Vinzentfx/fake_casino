"use strict";

/* Aufträge
   Für alle dieselben, mit Fortschrittsbalken und automatischer Auszahlung.
   Die Meldung beim Abschluss kommt über das Ereignis quest:done. */

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
        <b class="quest-reward">${q.done ? "✓ kassiert" : "+" + fmt(q.reward) + "<i class=mk></i>"}</b>
      </div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="quest-prog">${q.prog}/${q.target}</div>
    </div>`;
  }

  function repeatRow(q) {
    const pct = Math.min(100, Math.round((100 * q.prog) / q.target));
    return `<div class="quest ${q.maxed ? "done" : ""}">
      <div class="quest-top">
        <span class="quest-label">${escapeHtml(q.label)}</span>
        <b class="quest-reward">${q.maxed ? "morgen wieder" : "+" + fmt(q.reward) + "<i class=mk></i>"}</b>
      </div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="quest-prog">${q.prog}/${q.target} · heute ${q.done}/${q.cap}× geschafft</div>
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
      // Was oben steht, ist das, was ankommt. Happy Hour verdoppelt, die
      // Vermoegensbremse zieht ab; beides war vorher unsichtbar.
      const hinweis = $("#quest-hinweis");
      if (hinweis) {
        const teile = [];
        if (res.happy) teile.push("Happy Hour: doppelte Belohnung.");
        if (res.faucet != null && res.faucet < 100) teile.push(`Ab einer Million Vermögen werden Gratis-Einnahmen abgeschwächt, bei dir auf ${res.faucet} %.`);
        hinweis.textContent = teile.join(" ");
        hinweis.classList.toggle("hidden", !teile.length);
      }
      const rBox = $("#quest-repeat");
      if (rBox) rBox.innerHTML = (res.repeatable || []).map(repeatRow).join("");
      if (dBox) dBox.innerHTML = res.dailies.map(questRow).join("");
      if (wBox) wBox.innerHTML = res.weeklies.map(questRow).join("");
      const dt = $("#quest-day-timer"), wt = $("#quest-week-timer");
      if (dt) dt.textContent = `· ${res.rotation?.dayName || "Tagesmix"} · neue in ${hhmm(res.msDay)}`;
      if (wt) wt.textContent = `· ${res.rotation?.weekName || "Wochenmix"} · neue in ${hhmm(res.msWeek)}`;
    });
  }

  // Kleine Feier beim Abschluss (nur für mich, die großen sehen eh alle im Chat).
  socket.on("quest:done", (q) => {
    const acc = window.Casino.getAccount && window.Casino.getAccount();
    if (!q || !acc || !q.user || q.user.toLowerCase() !== acc.name.toLowerCase()) return;
    toast(`Auftrag erledigt: ${q.label} (+${fmt(q.reward)} Chips)`);
    // neu laden, wenn die Tafel offen ist
    const screen = document.querySelector('[data-screen="quests"]');
    if (screen && screen.classList.contains("active")) load();
  });

  window.Casino._loadQuests = load;
})();
