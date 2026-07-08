"use strict";

/* ============================================================
   Casino Season / Pass.
   Active-play reward track with capped XP and manual claims.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString("de-DE");

  function timeLeft(ts) {
    const ms = Math.max(0, Number(ts || 0) - Date.now());
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return d > 0 ? `${d} T ${h} Std` : `${h} Std`;
  }

  function capLine(label, cap) {
    const used = Math.min(cap.max || 0, cap.used || 0);
    const pct = cap.max ? Math.round((100 * used) / cap.max) : 0;
    return `<div>
      <div class="muted small">${label}: ${fmt(used)}/${fmt(cap.max)} XP heute</div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  function render(s) {
    const box = $("#season-box");
    if (!box || !s || !s.ok) return;
    const season = s.season || {};
    const pct = s.nextXp ? Math.min(100, Math.round((100 * s.xp) / s.nextXp)) : 100;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h2 style="margin:.1rem 0">${season.name || "Casino Season"}</h2>
          <p class="muted small" style="margin:.15rem 0">${season.subtitle || ""}</p>
        </div>
        <div class="muted small">endet in ${timeLeft(season.endsAt)}</div>
      </div>
      <div style="margin:.85rem 0">
        <div style="display:flex;justify-content:space-between;gap:.5rem"><b>Level ${s.level}/10</b><span>${fmt(s.xp)} / ${fmt(s.nextXp)} XP</span></div>
        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.65rem;margin-bottom:.9rem">
        ${capLine("Spiel-XP", s.playCap || { used: 0, max: 0 })}
        ${capLine("Auftrags-XP", s.questCap || { used: 0, max: 0 })}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.65rem">
        ${(s.rewards || []).map((r) => `
          <div class="quest ${r.claimed ? "done" : ""}" style="margin:0">
            <div class="quest-top"><span class="quest-label">Stufe ${r.level}</span><b class="quest-reward">${escapeHtml(r.label)}</b></div>
            <div class="muted small">${fmt(r.xp)} XP benötigt</div>
            <button class="${r.claimed ? "chip-btn" : "btn-primary"}" data-season-claim="${r.level}" ${!r.unlocked || r.claimed ? "disabled" : ""} style="width:100%;margin-top:.45rem">
              ${r.claimed ? "✓ abgeholt" : r.unlocked ? "Abholen" : "Gesperrt"}
            </button>
          </div>`).join("")}
      </div>`;
  }

  function load() {
    const box = $("#season-box");
    if (box) box.innerHTML = '<p class="muted small">Lädt…</p>';
    socket.emit("season:state", (s) => {
      if (!s || !s.ok) { if (box) box.innerHTML = '<p class="muted small">Bitte einloggen.</p>'; return; }
      render(s);
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-season-claim]");
    if (!btn) return;
    socket.emit("season:claim", { level: btn.dataset.seasonClaim }, (r) => {
      if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      toast(`🎟️ Season-Belohnung abgeholt: +${fmt(r.chips)} 🪙`);
      render(r);
    });
  });

  socket.on("season:update", (s) => {
    const screen = document.querySelector('[data-screen="season"]');
    if (screen && screen.classList.contains("active")) render(s);
  });

  window.Casino._loadSeason = load;
})();
