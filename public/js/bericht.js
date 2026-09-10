"use strict";

/* ============================================================
   Fake Casino – Tagesbericht.

   Was war, waehrend du weg warst. Oeffnet sich beim ersten
   Reinkommen am Tag von selbst, wenn etwas drinsteht, und ist
   danach jederzeit ueber das Menue erreichbar.

   Der Server (game/bericht.js) liefert fertige Zeilen. Hier
   wird nur gezeichnet und navigiert — damit die Texte an einer
   Stelle stehen und nicht doppelt gepflegt werden muessen.
   ============================================================ */

(function () {
  const Casino = window.Casino;
  const { socket } = Casino;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => Casino.escapeHtml(String(s == null ? "" : s));
  const sym = (name) => (Casino.icons.hatUi(name) ? Casino.icons.ui(name) : Casino.icons.ui("feed"));

  let letzter = null;
  let heuteGezeigt = false;

  function zeitraum(b) {
    if (b.erstesMal) return "Dein erster Bericht — die letzten zwei Tage.";
    const h = Math.max(1, b.stunden || 0);
    if (h < 20) return `Seit deinem letzten Bericht vor ${h} ${h === 1 ? "Stunde" : "Stunden"}.`;
    const t = Math.round(h / 24);
    if (t <= 1) return "Seit gestern.";
    return `Seit deinem letzten Bericht vor ${t} Tagen.`;
  }

  function abschnitt(titel, inhalt) {
    if (!inhalt) return "";
    return `<div class="tb-block"><h3 class="tb-h">${esc(titel)}</h3>${inhalt}</div>`;
  }

  function zeichne(b) {
    const kopf = $("#bericht-zeitraum");
    if (kopf) kopf.textContent = zeitraum(b);

    const abholbar = b.abholbar.length
      ? `<div class="tb-liste">${b.abholbar.map((a) => `
          <button class="tb-zeile tb-tun" type="button" ${a.nav ? `data-nav="${esc(a.nav)}"` : ""} ${a.tun ? `data-tun="${esc(a.tun)}"` : ""}>
            <span class="tb-sym tb-sym-gold">${sym(a.icon)}</span>
            <span class="tb-text"><b>${esc(a.titel)}</b><small>${esc(a.text)}</small></span>
            <span class="tb-pfeil" aria-hidden="true">›</span>
          </button>`).join("")}</div>`
      : "";

    const punkte = b.punkte.length
      ? `<div class="tb-liste">${b.punkte.map((p) => `
          <div class="tb-zeile${p.leise ? " tb-leise" : ""}">
            <span class="tb-sym">${sym(p.icon)}</span>
            <span class="tb-text">${esc(p.text)}</span>
          </div>`).join("")}</div>`
      : `<p class="muted small tb-nichts">Nichts Großes passiert. Dann bist du jetzt der Erste.</p>`;

    const zahlen = b.zahlen.length
      ? `<div class="tb-liste">${b.zahlen.map((z) => `
          <${z.nav ? "button" : "div"} class="tb-zeile${z.nav ? " tb-tun" : ""}" ${z.nav ? `type="button" data-nav="${esc(z.nav)}"` : ""}>
            <span class="tb-sym">${sym(z.icon)}</span>
            <span class="tb-text"><small>${esc(z.label)}</small><b>${esc(z.wert)}</b>${z.sub ? `<small>${esc(z.sub)}</small>` : ""}</span>
            ${z.nav ? '<span class="tb-pfeil" aria-hidden="true">›</span>' : ""}
          </${z.nav ? "button" : "div"}>`).join("")}</div>`
      : "";

    $("#bericht-inhalt").innerHTML =
      abschnitt(b.marken.gesamt === 1 ? "Eine Sache wartet auf dich" : b.marken.gesamt ? `${b.marken.gesamt} Sachen warten auf dich` : "", abholbar) +
      abschnitt("Das war los", punkte) +
      abschnitt("Stand jetzt", zahlen);
  }

  function oeffne(b) {
    letzter = b;
    zeichne(b);
    $("#bericht-modal")?.classList.remove("hidden");
    // Gelesen heisst: ab hier faengt der naechste Bericht an. Erst NACH dem
    // Zeichnen, sonst berichtet der Server sich selbst weg.
    socket.emit("bericht:gelesen", () => {
      if (Casino.renderAbholBadge) Casino.renderAbholBadge();
    });
    heuteGezeigt = true;
  }

  function schliesse() {
    $("#bericht-modal")?.classList.add("hidden");
  }

  /** Aus dem Menue: immer zeigen, auch wenn nichts drinsteht. */
  function zeige() {
    socket.emit("bericht:state", (b) => {
      if (!b || !b.ok) return;
      oeffne(b);
    });
  }

  /**
   * Beim Reinkommen: nur einmal pro Sitzung, nur wenn der Server ihn als neu
   * meldet, und nur wenn nicht schon ein anderes Fenster offen ist. Zwei
   * gestapelte Modals sind schlimmer als ein verpasster Bericht.
   */
  function vielleicht() {
    if (heuteGezeigt) return;
    const stoert = ["#onboarding-modal", "#update-modal", "#geschenk-modal"]
      .some((s) => { const el = $(s); return el && !el.classList.contains("hidden"); });
    if (stoert) return;
    socket.emit("bericht:state", (b) => {
      if (!b || !b.ok || !b.neu) return;
      oeffne(b);
    });
  }

  $("#bericht-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "bericht-modal" || e.target.closest("#bericht-close")) { schliesse(); return; }
    const zeile = e.target.closest("[data-nav],[data-tun]");
    if (!zeile) return;
    Casino.sound.play("select");
    schliesse();
    if (zeile.dataset.tun === "paket" && Casino._zeigePaket) { Casino._zeigePaket(); return; }
    if (zeile.dataset.nav) Casino.screens.show(zeile.dataset.nav);
  });

  document.getElementById("menu-bericht")?.addEventListener("click", () => {
    Casino.menuSchliessen?.();
    zeige();
  });

  Casino._bericht = zeige;
  Casino._berichtVielleicht = vielleicht;
})();
