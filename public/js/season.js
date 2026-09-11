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

  /** Das Spiel, das heute doppelte XP gibt. */
  function fokusKarte(f) {
    if (!f) return "";
    return `<button class="se-boost se-boost-fokus" data-nav="${escapeHtml(f.id)}" type="button">
      <span class="se-boost-icon">${f.icon}</span>
      <span class="se-boost-text">
        <small>Fokus heute · ${f.faktor}× XP</small>
        <b>${escapeHtml(f.label)}</b>
      </span>
    </button>`;
  }

  /** Tagesserie: der Grund, morgen wieder reinzuschauen. */
  function serienKarte(se) {
    if (!se) return "";
    const proz = Math.round((se.faktor - 1) * 100);
    const amMax = se.faktor >= se.max - 0.001;
    return `<div class="se-boost">
      <span class="se-boost-icon">🔥</span>
      <span class="se-boost-text">
        <small>${se.tage === 1 ? "Erster Tag" : `${se.tage} Tage in Folge`}${amMax ? " · Maximum" : ""}</small>
        <b>+${proz} % XP</b>
      </span>
    </div>`;
  }

  function clanKarte(s) {
    const bonus = Math.round(((s.clanBonus || 1) - 1) * 100);
    return `<div class="se-boost${bonus ? "" : " se-boost-aus"}">
      <span class="se-boost-icon">🛡️</span>
      <span class="se-boost-text">
        <small>${bonus ? "Durch deinen Clan" : "Ohne Clan"}</small>
        <b>${bonus ? `+${bonus} % XP` : "kein Bonus"}</b>
      </span>
    </div>`;
  }

  /**
   * Der Season-Bildschirm.
   *
   * Vorher war es eine senkrechte Liste aus zwanzig gleich aussehenden
   * Zeilen: runterscrollen, abholen, fertig. Man sah weder, wo man steht,
   * noch wohin es geht, noch was die vier besonderen Stufen ueberhaupt sind.
   *
   * Jetzt drei Ebenen:
   *   oben   Wie weit bin ich, was kommt als Naechstes, wie lange noch.
   *   MITTE  Eine Schiene mit allen zwanzig Stufen auf einen Blick, die
   *          besonderen hervorgehoben, die eigene Position markiert.
   *   UNTEN  Die Belohnungen als waagerechte Bahn, automatisch zur aktuellen
   *          Stufe gescrollt. Abholbares leuchtet.
   */
  function render(s) {
    const box = $("#season-box");
    if (!box || !s || !s.ok) return;
    const season = s.season || {};
    const stufen = s.rewards || [];
    const gesamt = stufen.length;
    const offen = stufen.filter((r) => r.unlocked && !r.claimed);
    const naechste = stufen.find((r) => !r.unlocked) || null;

    // Fortschritt zur NAECHSTEN Stufe, nicht zum Ende. Ein Balken, der bei
    // 3.000 von 12.140 XP fast leer steht, obwohl vier Stufen offen sind,
    // erzaehlt das Falsche.
    const vorige = stufen.filter((r) => r.unlocked).slice(-1)[0];
    const basis = vorige ? vorige.xp : 0;
    const spanne = Math.max(1, (s.nextXp || 0) - basis);
    const pct = s.level >= gesamt ? 100 : Math.min(100, Math.round((100 * (s.xp - basis)) / spanne));

    const zustand = (r) => (r.claimed ? "claimed" : r.unlocked ? "ready" : "locked");
    const istSpecial = (r) => !!(r.kosmetik && r.kosmetik.length);

    box.innerHTML = `
      <div class="se-hero">
        <div class="se-hero-kopf">
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

        <div class="se-stand">
          <div class="se-stufe">
            <small>Stufe</small>
            <b>${s.level}</b>
            <small>von ${gesamt}</small>
          </div>
          <div class="se-stand-bar">
            <div class="se-stand-top">
              <span>${s.level >= gesamt ? "Alles freigeschaltet" : `Noch ${fmt(Math.max(0, (s.nextXp || 0) - s.xp))} XP bis Stufe ${s.level + 1}`}</span>
              <span class="muted small">${fmt(s.xp)} / ${fmt(s.nextXp || s.xp)} XP</span>
            </div>
            <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
            ${naechste ? `<div class="se-naechste">Als Nächstes: <b>${escapeHtml(naechste.label)}</b></div>` : ""}
          </div>
        </div>

        <!-- Alle zwanzig Stufen auf einen Blick. Das ist der Teil, den man
             vorher nur durch Scrollen erahnen konnte. -->
        <div class="se-schiene" aria-hidden="true">
          ${stufen.map((r) => `<span class="se-knoten se-${zustand(r)}${istSpecial(r) ? " se-k-special" : ""}${r.level === s.level ? " se-k-hier" : ""}"></span>`).join("")}
        </div>

        ${offen.length ? `<button class="btn-primary se-alle" id="se-alle-abholen">${offen.length === 1 ? "Belohnung abholen" : `Alle ${offen.length} Belohnungen abholen`}</button>` : ""}
      </div>

      <div class="se-boosts">
        ${fokusKarte(s.fokus)}
        ${serienKarte(s.serie)}
        ${clanKarte(s)}
      </div>

      <h3 class="section-title">Belohnungen</h3>
      <div class="se-bahn" id="se-bahn">
        ${stufen.map((r) => `
          <div class="se-karte se-${zustand(r)}${istSpecial(r) ? " se-special" : ""}" data-level="${r.level}">
            <div class="se-karte-kopf">
              <span class="se-karte-num">${r.level}</span>
              ${istSpecial(r) ? '<span class="se-karte-tag">Einzigartig</span>' : ""}
            </div>
            <div class="se-karte-body">
              <b>${escapeHtml(r.label)}</b>
              <small>${fmt(r.xp)} XP</small>
            </div>
            <button class="se-karte-btn" data-season-claim="${r.level}" ${!r.unlocked || r.claimed ? "disabled" : ""}>
              ${r.claimed ? "✓ Geholt" : r.unlocked ? "Abholen" : "🔒"}
            </button>
          </div>`).join("")}
      </div>

      <details class="se-details">
        <summary>Wie du XP bekommst</summary>
        <div class="se-caps">
          ${capLine("Spiel-XP", s.playCap || { used: 0, max: 0 })}
          ${capLine("Auftrags-XP", s.questCap || { used: 0, max: 0 })}
        </div>
        <p class="hint">Die Boni wirken auf jede Runde, der Tagesdeckel bleibt aber die Grenze. Sie entscheiden also, wie schnell du den Deckel erreichst, nicht wie hoch er liegt.</p>
        ${s.faucet != null && s.faucet < 100 ? `<p class="hint">Die Chip-Beträge sind schon deine: ab einer Million Vermögen werden Gratis-Einnahmen abgeschwächt, bei dir auf ${s.faucet} %. Kosmetik ist davon nie betroffen.</p>` : ""}
      </details>`;

    // Die Bahn dorthin schieben, wo man gerade steht, sonst startet sie bei
    // Stufe 1, und die ist nach der ersten Woche uninteressant.
    const bahn = $("#se-bahn");
    const hier = bahn && bahn.querySelector(`[data-level="${Math.max(1, s.level)}"]`);
    if (bahn && hier) bahn.scrollLeft = Math.max(0, hier.offsetLeft - bahn.clientWidth / 2 + hier.clientWidth / 2);
  }

  function load() {
    const box = $("#season-box");
    if (box) box.innerHTML = '<p class="muted small">Lädt…</p>';
    socket.emit("season:state", (s) => {
      if (!s || !s.ok) { if (box) box.innerHTML = '<p class="muted small">Bitte einloggen.</p>'; return; }
      render(s);
    });
  }

  /**
   * Alle offenen Stufen nacheinander abholen.
   *
   * Wer eine Woche nicht da war, hat schnell fuenf offene Stufen und musste
   * fuenfmal scrollen und tippen. Der Reihe nach, nicht alle auf einmal:
   * jede Stufe hat ihre eigene Auszahlung und ihre eigene Ansage.
   */
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#se-alle-abholen")) return;
    const knopf = e.target.closest("#se-alle-abholen");
    knopf.disabled = true;
    const offen = [...document.querySelectorAll("[data-season-claim]:not([disabled])")]
      .map((b) => b.dataset.seasonClaim);
    let chips = 0;
    const stuecke = [];
    for (const level of offen) {
      const r = await new Promise((x) => socket.emit("season:claim", { level }, x));
      if (!r || !r.ok) continue;
      if (r.account) applyAccount(r.account);
      chips += r.chips || 0;
      if (r.kosmetik) stuecke.push(r.kosmetik);
      await new Promise((x) => setTimeout(x, 180));
    }
    if (chips > 0 || stuecke.length) {
      window.Casino.fx.bigWin(chips, { label: stuecke.length ? stuecke.join(" · ") : "Season-Belohnungen" });
      toast(`${offen.length} ${offen.length === 1 ? "Stufe" : "Stufen"} abgeholt: +${fmt(chips)} Chips${stuecke.length ? " und " + stuecke.join(", ") : ""}`);
    }
    load();
    if (window.Casino.renderAbholBadge) window.Casino.renderAbholBadge();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-season-claim]");
    if (!btn) return;
    socket.emit("season:claim", { level: btn.dataset.seasonClaim }, (r) => {
      if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      const teile = [];
      if (r.chips > 0) teile.push(`+${fmt(r.chips)} Chips`);
      if (r.kosmetik) teile.push(`${r.kosmetik} freigeschaltet`);
      toast(`Stufe ${btn.dataset.seasonClaim}: ${teile.join(" · ") || "abgeholt"}`);
      // Kosmetik ist selten und darf gefeiert werden.
      if (r.kosmetik) window.Casino.fx.bigWin(r.chips || 0, { label: `Stufe ${btn.dataset.seasonClaim} · ${r.kosmetik}` });
      else if (r.chips > 0) { window.Casino.sound.play("cash"); window.Casino.fx.coins(btn); }
      render(r);
      if (window.Casino.renderAbholBadge) window.Casino.renderAbholBadge();
    });
  });

  socket.on("season:update", (s) => {
    const screen = document.querySelector('[data-screen="season"]');
    if (screen && screen.classList.contains("active")) render(s);
  });

  window.Casino._loadSeason = load;
})();
