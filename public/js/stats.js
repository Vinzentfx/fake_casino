"use strict";

/* ============================================================
   Fake Casino – stats screen.
   Shows YOUR stats by default; the leaderboard links here for
   any player (window.Casino.openStats(name)). Sections: records,
   city empire, achievements, per-game breakdown.
   ============================================================ */

(function () {
  const { escapeHtml, showScreen } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const GAME_META = {
    slots: { e: "🎰", n: "Slots" }, blackjack: { e: "♠️", n: "Blackjack" },
    roulette: { e: "🎡", n: "Roulette" }, sportwetten: { e: "⚽", n: "Sportwetten" },
    poker: { e: "🃏", n: "Poker" },
  };

  // When set, the next load shows this player instead of yourself.
  let pendingName = null;

  function load() {
    const me = window.Casino.getAccount();
    const name = pendingName || (me && me.name);
    pendingName = null;
    if (!name) return;
    fetch("/api/account/" + encodeURIComponent(name))
      .then((r) => r.json())
      .then((d) => render(name, d))
      .catch(() => render(name, null));
  }

  function render(name, d) {
    const me = window.Casino.getAccount();
    const isMe = me && me.name.toLowerCase() === name.toLowerCase();
    const acc = (d && d.account) || {};
    const badge = d && d.ach && d.ach.badge ? ` ${d.ach.badge}` : "";
    $("#stats-title").textContent = isMe ? `📊 Deine Statistik${badge}` : `📊 ${acc.name || name}${badge}`;

    // Rivalen / Kopfgeld panel (only when viewing someone else).
    const rivalBox = $("#stats-rival");
    if (rivalBox) {
      if (isMe) {
        rivalBox.innerHTML = (d && d.bounty)
          ? `<div class="cd-buff on">🎯 Auf deinen Kopf sind <b>${(d.bounty).toLocaleString("de-DE")} 🪙</b> Kopfgeld ausgesetzt!</div>` : "";
      } else {
        const b = (d && d.bounty) || 0;
        rivalBox.innerHTML =
          (b ? `<div class="cd-buff">🎯 Aktuelles Kopfgeld: <b>${b.toLocaleString("de-DE")} 🪙</b></div>` : "") +
          `<button class="btn-primary cd-btn" id="bounty-btn" data-target="${escapeHtml(acc.name || name)}">🎯 Kopfgeld aussetzen</button>` +
          `<p class="muted small" style="margin:4px 0 0">Wer ${escapeHtml(acc.name || name)} ein Gebäude abnimmt, kassiert das Kopfgeld.</p>`;
      }
    }

    const s = acc.stats || {};
    const played = s.gamesPlayed || 0, won = s.handsWon || 0;
    const rate = played ? Math.round((100 * won) / played) : 0;
    const ov = $("#stats-overview");
    if (ov) ov.innerHTML = `
      <div class="stat-row"><span>Chips</span><b>${fmt(acc.chips || 0)} 🪙</b></div>
      <div class="stat-row"><span>Netto-Vermögen</span><b>${fmt(acc.netWorth || acc.chips || 0)} 🪙</b></div>
      <div class="stat-row"><span>Spiele gespielt</span><b>${fmt(played)}</b></div>
      <div class="stat-row"><span>Gewonnen · Quote</span><b>${fmt(won)} · ${rate}%</b></div>
      <div class="stat-row"><span>Größter Einzelgewinn</span><b class="pos">+${fmt(s.biggestWin || 0)} 🪙</b></div>
      <div class="stat-row"><span>Größter Einzelverlust</span><b class="neg">−${fmt(s.biggestLoss || 0)} 🪙</b></div>
      <div class="stat-row" style="border:none"><span>Dabei seit</span><b>${acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "–"}</b></div>`;

    // ── City empire ──
    const cityBox = $("#stats-city");
    if (cityBox) {
      const c = d && d.city;
      if (!c || !c.houses) {
        cityBox.innerHTML = '<p class="muted small">Noch kein Immobilien-Besitz.</p>';
      } else {
        const chips = [];
        chips.push(`<span class="buff-chip" style="border-color:${c.color};color:${c.color}">🏠 ${c.houses} ${c.houses === 1 ? "Haus" : "Häuser"}</span>`);
        chips.push(`<span class="buff-chip">💎 ${fmt(c.value)} 🪙 Wert</span>`);
        if (c.streets) chips.push(`<span class="buff-chip">👑 ${c.streets} ${c.streets === 1 ? "Straße" : "Straßen"} komplett</span>`);
        for (const t of c.trophies || []) chips.push(`<span class="buff-chip">${t.emoji} ${escapeHtml(t.title)}</span>`);
        for (const b of c.bossOf || []) chips.push(`<span class="buff-chip">🥇 Boss von ${escapeHtml(b)}</span>`);
        cityBox.innerHTML = `<div class="biz-buffs">${chips.join("")}</div>`;
      }
    }

    // ── Achievements ──
    const achBox = $("#stats-ach");
    if (achBox) {
      const a = d && d.ach;
      if (!a || !a.unlocked || !a.unlocked.length) {
        achBox.innerHTML = '<p class="muted small">Noch keine Achievements.</p>';
      } else {
        achBox.innerHTML =
          `<p class="muted small" style="margin:0 0 6px">${a.unlocked.length}/${a.total} freigeschaltet` +
          (isMe ? ' · <span class="muted">Emoji fürs Leaderboard wählst du im 👤 Profil</span>' : "") + `</p>` +
          `<div class="biz-buffs">` +
          a.unlocked.map((u) => `<span class="buff-chip" title="${escapeHtml(u.label)}">${u.emoji} ${escapeHtml(u.label)}</span>`).join("") +
          `</div>`;
      }
    }

    // ── Per game ──
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

  // Place a bounty on the viewed player.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#bounty-btn");
    if (!btn) return;
    const target = btn.dataset.target;
    const raw = prompt(`Wie viel Kopfgeld auf ${target} aussetzen? (min. 1.000 🪙)`, "5000");
    if (raw == null) return;
    const amount = parseInt(raw, 10);
    if (!Number.isFinite(amount) || amount < 1000) return window.Casino.toast("Mindestens 1.000 🪙.");
    window.Casino.socket.emit("bounty:place", { target, amount }, (r) => {
      if (!r || !r.ok) return window.Casino.toast(r?.error || "Fehler.");
      window.Casino.applyAccount(r.account);
      window.Casino.toast(`🎯 ${amount.toLocaleString("de-DE")} 🪙 Kopfgeld auf ${target} ausgesetzt!`);
      load();
    });
  });

  window.Casino._loadStats = load;
  /** Leaderboard → inspect any player's stats. */
  window.Casino.openStats = (name) => {
    pendingName = name || null;
    showScreen("stats");
  };
})();
