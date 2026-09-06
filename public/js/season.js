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
    const stufen = s.rewards || [];
    const gesamt = stufen.length;
    const offen = stufen.filter((r) => r.unlocked && !r.claimed).length;
    // Fortschritt zur NAECHSTEN Stufe, nicht zum Ende. Vorher stand der
    // Balken bei 3.000 von 12.140 XP fast leer, obwohl schon vier Stufen
    // freigeschaltet waren.
    const vorige = stufen.filter((r) => r.unlocked).slice(-1)[0];
    const basis = vorige ? vorige.xp : 0;
    const spanne = Math.max(1, (s.nextXp || 0) - basis);
    const pct = s.level >= gesamt ? 100 : Math.min(100, Math.round((100 * (s.xp - basis)) / spanne));

    box.innerHTML = `
      <div class="se-head">
        <div>
          <h2>${escapeHtml(season.name || "Casino Season")}</h2>
          <p class="muted small">${escapeHtml(season.subtitle || "")}</p>
        </div>
        <div class="se-timer">${
          s.phase === "vor" ? "startet in " + timeLeft(season.startsAt)
          : s.phase === "vorbei" ? "beendet"
          : "noch " + timeLeft(season.endsAt)
        }</div>
      </div>

      <div class="se-progress">
        <div class="se-progress-top">
          <b>Stufe ${s.level} von ${gesamt}</b>
          <span class="muted small">${s.level >= gesamt ? "alles freigeschaltet" : `${fmt(s.xp)} / ${fmt(s.nextXp)} XP`}</span>
        </div>
        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
        ${offen ? `<div class="se-open">${offen} ${offen === 1 ? "Belohnung wartet" : "Belohnungen warten"} auf dich</div>` : ""}
      </div>

      <div class="se-caps">
        ${capLine("Spiel-XP", s.playCap || { used: 0, max: 0 })}
        ${capLine("Auftrags-XP", s.questCap || { used: 0, max: 0 })}
      </div>
      <p class="hint">XP kommen vom Spielen und von Aufträgen, beides täglich gedeckelt. Wer den ganzen Tag dreht, kommt schneller voran, aber nicht beliebig schnell.</p>

      <div class="se-track">
        ${stufen.map((r) => {
          const zustand = r.claimed ? "claimed" : r.unlocked ? "ready" : "locked";
          return `
          <div class="se-step se-${zustand}${r.cosmetic ? " se-special" : ""}">
            <div class="se-step-num">${r.level}</div>
            <div class="se-step-body">
              <b>${escapeHtml(r.label)}</b>
              <small>${fmt(r.xp)} XP</small>
            </div>
            <button class="se-step-btn" data-season-claim="${r.level}" ${!r.unlocked || r.claimed ? "disabled" : ""}>
              ${r.claimed ? "✓" : r.unlocked ? "Abholen" : "🔒"}
            </button>
          </div>`;
        }).join("")}
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
      const teile = [];
      if (r.chips > 0) teile.push(`+${fmt(r.chips)} 🪙`);
      if (r.kosmetik) teile.push(`${r.kosmetik} freigeschaltet`);
      toast(`🎟️ Stufe ${btn.dataset.seasonClaim}: ${teile.join(" · ") || "abgeholt"}`);
      // Kosmetik ist selten und darf gefeiert werden.
      if (r.kosmetik) window.Casino.fx.bigWin(r.chips || 0, { label: `Stufe ${btn.dataset.seasonClaim} · ${r.kosmetik}` });
      else if (r.chips > 0) { window.Casino.sound.play("cash"); window.Casino.fx.coins(btn); }
      render(r);
    });
  });

  socket.on("season:update", (s) => {
    const screen = document.querySelector('[data-screen="season"]');
    if (screen && screen.classList.contains("active")) render(s);
  });

  window.Casino._loadSeason = load;
})();
