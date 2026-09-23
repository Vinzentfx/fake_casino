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

  const paths = {
    play_slots: ["slots", "Slots"], play_blackjack: ["blackjack", "Blackjack"],
    play_roulette: ["roulette", "Roulette"], bet_sport: ["sports", "Sportwetten"],
    buy_house: ["businesses", "Zur Stadt"], claim_bonus: ["lobby", "Bonus abholen"],
    play_mines: ["mines", "Mines"], play_crash: ["crash", "Crash"],
    play_pinco: ["pinco", "Pinco"], play_poker: ["poker", "Poker"],
    playtime: ["lobby", "Spielen"], play: ["lobby", "Spiel wählen"], win: ["lobby", "Spiel wählen"],
  };

  function action(q) {
    const [screen, label] = paths[q.ev] || paths.play;
    return `<button class="quest-action" type="button" data-nav="${screen}">${label} <span aria-hidden="true">↗</span></button>`;
  }

  function questRow(q) {
    const pct = Math.min(100, Math.round((100 * q.prog) / q.target));
    return `<article class="quest ${q.done ? "done" : ""}">
      <div class="quest-eyebrow"><span>${q.done ? "✓ ERLEDIGT" : "✦ AKTIV"}</span><span>${pct}%</span></div>
      <div class="quest-top">
        <span class="quest-label">${escapeHtml(q.label)}</span>
      </div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="quest-foot"><span>${q.prog} / ${q.target}</span><b class="quest-reward">${q.done ? "Ausgezahlt" : "+" + fmt(q.reward) + " <i class=mk></i>"}</b></div>
      ${q.done ? "" : action(q)}
    </article>`;
  }

  function repeatRow(q) {
    const pct = Math.min(100, Math.round((100 * q.prog) / q.target));
    return `<article class="quest ${q.maxed ? "done" : ""}">
      <div class="quest-eyebrow"><span>${q.maxed ? "✓ TAGESLIMIT" : "↻ WIEDERHOLBAR"}</span><span>${q.done} / ${q.cap} heute</span></div>
      <div class="quest-top">
        <span class="quest-label">${escapeHtml(q.label)}</span>
      </div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="quest-foot"><span>${q.prog} / ${q.target}</span><b class="quest-reward">${q.maxed ? "Morgen wieder" : "+" + fmt(q.reward) + " <i class=mk></i>"}</b></div>
      ${q.maxed ? "" : action(q)}
    </article>`;
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
      const oneTime = [...res.dailies, ...res.weeklies];
      const done = oneTime.filter((q) => q.done).length;
      const next = oneTime.filter((q) => !q.done).sort((a, b) =>
        (b.prog / b.target) - (a.prog / a.target))[0];
      $("#quest-hero-done").textContent = done;
      $("#quest-hero-total").textContent = oneTime.length;
      $("#quest-hero-fill").style.width = `${oneTime.length ? Math.round(100 * done / oneTime.length) : 0}%`;
      $("#quest-next").textContent = next
        ? `Nächstes Ziel: ${next.label} · ${next.prog} / ${next.target}`
        : "Alle Tages- und Wochenziele erledigt. Stark gespielt!";
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
