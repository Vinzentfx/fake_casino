"use strict";

/* Tagesbericht

   Was war, waehrend du weg warst. Oeffnet sich beim ersten
   Reinkommen am Tag von selbst, wenn etwas drinsteht, und ist
   danach jederzeit ueber das Menue erreichbar.

   Der Server (game/bericht.js) liefert fertige Zeilen. Hier
   wird nur gezeichnet und navigiert, damit die Texte an einer
   Stelle stehen und nicht doppelt gepflegt werden muessen. */

(function () {
  const Casino = window.Casino;
  const { socket } = Casino;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => Casino.escapeHtml(String(s == null ? "" : s));
  const sym = (name) => (Casino.icons.hatUi(name) ? Casino.icons.ui(name) : Casino.icons.ui("feed"));

  let letzter = null;
  let heuteGezeigt = false;

  function zeitraum(b) {
    if (b.erstesMal) return "Dein erster Bericht, er geht zwei Tage zurück.";
    const h = Math.max(1, b.stunden || 0);
    if (h < 20) return `Seit deinem letzten Bericht vor ${h} ${h === 1 ? "Stunde" : "Stunden"}.`;
    const t = Math.round(h / 24);
    if (t <= 1) return "Seit gestern.";
    return `Seit deinem letzten Bericht vor ${t} Tagen.`;
  }

  /*
   * Der Bericht als Zeitung: Kopf mit Ausgabe und Datum, darunter die
   * Anzeigen (was auf einen wartet, antippbar), eine Schlagzeile, die
   * übrigen Meldungen in zwei Spalten und ein Kasten mit den Zahlen.
   * Die Sätze kommen weiter fertig vom Server; hier wird nur gesetzt.
   */
  function zeichne(b) {
    const kopf = $("#bericht-zeitraum");
    if (kopf) kopf.textContent = zeitraum(b);
    const heute = new Date();
    const datum = $("#zt-datum");
    if (datum) datum.textContent = heute.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const ausgabe = $("#zt-ausgabe");
    // Eine laufende Nummer, wie sie eine Zeitung hat: Tage seit Jahresbeginn.
    if (ausgabe) ausgabe.textContent = `Ausgabe Nr. ${Math.floor((heute - new Date(heute.getFullYear(), 0, 0)) / 86400000)}`;

    /*
     * Wer etwas getan hat, steht hier mit seinem Aussehen.
     *
     * Das ist die einzige Flaeche, die in dieser Runde wirklich jeder liest,
     * auch Tage spaeter. Alles andere (Online-Liste, Pokertisch, Aura)
     * verlangt Gleichzeitigkeit, und die gibt es hier fast nie. Wer etwas
     * Seltenes hat, wird also hier gesehen oder nirgends.
     */
    const wer = (p) => {
      if (!p.look || !Casino.spieler) return "";
      return `<span class="tb-wer">${Casino.spieler.avatar(p.look)}`
        + `${Casino.spieler.zeichen(p.look)}${Casino.spieler.prunk(p.look)}${Casino.spieler.garnitur(p.look)}</span>`;
    };

    const anzeigen = b.abholbar.length
      ? `<section class="zt-anzeigen"><h3 class="zt-rubrik">${b.marken.gesamt === 1 ? "Anzeige: Eine Sache wartet auf dich" : `Anzeigen: ${b.marken.gesamt || b.abholbar.length} Sachen warten auf dich`}</h3>
          <div class="zt-anzeigen-liste">${b.abholbar.map((a) => `
            <button class="zt-anzeige" type="button" ${a.nav ? `data-nav="${esc(a.nav)}"` : ""} ${a.tun ? `data-tun="${esc(a.tun)}"` : ""}>
              <span class="tb-sym">${sym(a.icon)}</span><b>${esc(a.titel)}</b><small>${esc(a.text)}</small>
            </button>`).join("")}</div></section>`
      : "";

    const [aufmacher, ...rest] = b.punkte;
    const meldungen = aufmacher
      ? `<article class="zt-aufmacher${aufmacher.leise ? " tb-leise" : ""}"><h3>${esc(aufmacher.text)}</h3>${wer(aufmacher)}</article>`
        + (rest.length ? `<div class="zt-spalten">${rest.map((p) => `
            <p class="zt-meldung${p.leise ? " tb-leise" : ""}"><span class="tb-sym">${sym(p.icon)}</span>${esc(p.text)}${wer(p)}</p>`).join("")}</div>` : "")
      : `<article class="zt-aufmacher"><h3>Ruhiger Tag im Casino</h3><p class="zt-leit">Nichts Großes passiert. Dann bist du jetzt der Erste.</p></article>`;

    const zahlen = b.zahlen.length
      ? `<aside class="zt-kasten"><h4>Zahlen des Tages</h4>${b.zahlen.map((z) => `
          <${z.nav ? "button" : "div"} class="zt-zahl" ${z.nav ? `type="button" data-nav="${esc(z.nav)}"` : ""}>
            <span>${esc(z.label)}</span><b>${esc(z.wert)}</b>${z.sub ? `<small>${esc(z.sub)}</small>` : ""}
          </${z.nav ? "button" : "div"}>`).join("")}</aside>`
      : "";

    /* Wenig los: die Zahlen nicht als hohe Spalte neben einer einzigen
       Schlagzeile (das ließ links eine leere halbe Seite), sondern quer
       darunter. */
    const quer = b.punkte.length <= 2;
    $("#bericht-inhalt").innerHTML = anzeigen + `<div class="zt-blatt${quer ? " quer" : ""}"><div class="zt-haupt">${meldungen}</div>${zahlen}</div>`;
  }

  function oeffne(b) {
    letzter = b;
    zeichne(b);
    $("#bericht-modal")?.classList.remove("hidden");
    // Gelesen heisst: ab hier faengt der naechste Bericht an. Erst nach dem
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
  function vielleicht(versuch = 0) {
    if (heuteGezeigt) return;
    /* Im Warteraum wartet die Zeitung: dort hat niemand etwas verpasst,
       und bei der Öffnung kämen sonst drei Fenster gleichzeitig. Nach der
       Öffnung ruft public/js/einlass.js sie als letztes auf. */
    const einl = Casino.einlass;
    if ((!einl || !einl.geladen()) && versuch < 20) { setTimeout(() => vielleicht(versuch + 1), 500); return; }
    if (einl && einl.gesperrt()) return;
    const acc = Casino.getAccount();
    /* Ein Konto, das gerade erst entstanden ist, hat nichts verpasst. Sein
       erster Bildschirm gehoert dem Starter-Pass, nicht einem Rueckblick auf
       fremde Wochenereignisse. Ueber das Menue bleibt der Bericht erreichbar. */
    if (acc && Date.now() - Number(acc.createdAt || 0) < 10 * 60 * 1000
      && Number(acc.stats && acc.stats.gamesPlayed) === 0) {
      heuteGezeigt = true;
      return;
    }
    const stoert = ["#onboarding-modal", "#update-modal", "#geschenk-modal"]
      .some((s) => { const el = $(s); return el && !el.classList.contains("hidden"); }) || !!document.querySelector(".dlg-overlay");
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

  // Der Zeitungsständer am Eingang in der Welt liest dieselbe Zeitung.
  Casino._berichtZeigen = zeige;

  document.getElementById("menu-bericht")?.addEventListener("click", () => {
    Casino.menuSchliessen?.();
    zeige();
  });

  Casino._bericht = zeige;
  Casino._berichtVielleicht = vielleicht;
})();
