"use strict";

/* ============================================================
   Fake Casino – personal stats screen (records + per-game breakdown).
   ============================================================ */

(function () {
  const { escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const GAME_META = {
    slots: { e: "🎰", n: "Slots" }, blackjack: { e: "♠️", n: "Blackjack" },
    roulette: { e: "🎡", n: "Roulette" }, sportwetten: { e: "⚽", n: "Sportwetten" },
    poker: { e: "🃏", n: "Poker" },
  };

  function load() {
    const acc = window.Casino.getAccount();
    if (!acc) return;
    fetch("/api/account/" + encodeURIComponent(acc.name))
      .then((r) => r.json()).then((d) => render(d.account || acc)).catch(() => render(acc));
  }

  function render(acc) {
    const s = (acc && acc.stats) || {};
    const played = s.gamesPlayed || 0, won = s.handsWon || 0;
    const rate = played ? Math.round((100 * won) / played) : 0;
    const ov = $("#stats-overview");
    if (ov) ov.innerHTML = `
      <div class="stat-row"><span>Netto-Vermögen</span><b>${fmt(acc.netWorth || acc.chips || 0)} 🪙</b></div>
      <div class="stat-row"><span>Spiele gespielt</span><b>${fmt(played)}</b></div>
      <div class="stat-row"><span>Gewonnen · Quote</span><b>${fmt(won)} · ${rate}%</b></div>
      <div class="stat-row"><span>Größter Einzelgewinn</span><b class="pos">+${fmt(s.biggestWin || 0)} 🪙</b></div>
      <div class="stat-row" style="border:none"><span>Größter Einzelverlust</span><b class="neg">−${fmt(s.biggestLoss || 0)} 🪙</b></div>`;

    const bg = $("#stats-by-game");
    if (!bg) return;
    const pg = s.perGame || {};
    const keys = Object.keys(pg).sort((a, b) => pg[b].plays - pg[a].plays);
    if (!keys.length) { bg.innerHTML = '<p class="muted small">Noch keine Spiele gespielt.</p>'; return; }
    bg.innerHTML = keys.map((k) => {
      const g = pg[k], m = GAME_META[k] || { e: "🎮", n: k };
      const r = g.plays ? Math.round((100 * g.wins) / g.plays) : 0;
      const cls = g.net >= 0 ? "pos" : "neg";
      return `<div class="stat-row"><span>${m.e} ${escapeHtml(m.n)} <span class="muted small">(${fmt(g.plays)}×, ${r}%)</span></span><b class="${cls}">${g.net >= 0 ? "+" : "−"}${fmt(Math.abs(g.net))} 🪙</b></div>`;
    }).join("");
  }

  window.Casino._loadStats = load;
})();
