"use strict";

/**
 * Eigene Dialoge statt confirm(), prompt() und alert().
 *
 * Achtzehn Stellen im Casino haben die eingebauten Browser-Dialoge benutzt:
 * Clan verlassen, Kriegs-Einsatz, Pferd umbenennen, Kopfgeld aussetzen,
 * Automat freischalten, Backup einspielen. Auf dem iPad ist das jedes Mal ein
 * graues System-Fenster mitten in einer Seite, die sonst durchgestaltet ist,
 * und in der Home-Bildschirm-Fassung wirkt es wie ein Fehler.
 *
 * Schlimmer als das Aussehen ist die Wirkung: confirm() und prompt() halten
 * den ganzen JavaScript-Ablauf an. In einer Anwendung, die permanent mit dem
 * Server spricht, steht damit alles — Chat, Timer, laufende Runden — bis
 * jemand auf OK tippt.
 *
 * Diese Dialoge geben stattdessen ein Promise zurueck. Aufrufer muessen also
 * mit await arbeiten, dafuer laeuft alles andere weiter.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let offen = null;   // { schliessen(wert) }

  function baue({ titel, text, art, wert, platzhalter, okText, abbruchText, gefahr, optionen }) {
    const wrap = document.createElement("div");
    wrap.className = "dlg-overlay";
    wrap.innerHTML = `
      <div class="dlg-card" role="dialog" aria-modal="true">
        ${titel ? `<h3 class="dlg-titel">${esc(titel)}</h3>` : ""}
        <p class="dlg-text">${esc(text).replace(/\n/g, "<br>")}</p>
        ${art === "eingabe" ? `<input class="dlg-input" id="dlg-input" value="${esc(wert || "")}" placeholder="${esc(platzhalter || "")}" />` : ""}
        ${art === "wahl" ? `<div class="dlg-wahl">${(optionen || []).map((o, i) =>
          `<button type="button" class="dlg-option" data-wert="${esc(o.wert)}">
             <b>${esc(o.label)}</b>${o.hinweis ? `<small>${esc(o.hinweis)}</small>` : ""}</button>`).join("")}</div>` : ""}
        <div class="dlg-knoepfe">
          ${art === "hinweis" ? "" : `<button type="button" class="dlg-abbruch">${esc(abbruchText || "Abbrechen")}</button>`}
          ${art === "wahl" ? "" : `<button type="button" class="dlg-ok${gefahr ? " gefahr" : ""}">${esc(okText || "OK")}</button>`}
        </div>
      </div>`;
    return wrap;
  }

  function zeige(opts) {
    // Nur einer gleichzeitig: sonst stapeln sich Dialoge, wenn jemand zweimal
    // tippt, und der zweite verdeckt die Antwort auf den ersten.
    if (offen) offen.schliessen(null);

    return new Promise((fertig) => {
      const wrap = baue(opts);
      document.body.appendChild(wrap);
      const input = wrap.querySelector(".dlg-input");
      const schliessen = (wert) => {
        document.removeEventListener("keydown", aufTaste);
        wrap.remove();
        offen = null;
        fertig(wert);
      };
      offen = { schliessen };

      const bestaetigen = () => schliessen(opts.art === "eingabe" ? (input ? input.value : "") : true);
      const abbrechen = () => schliessen(opts.art === "eingabe" || opts.art === "wahl" ? null : false);

      wrap.querySelectorAll(".dlg-option").forEach((b) =>
        b.addEventListener("click", () => schliessen(b.dataset.wert)));
      wrap.querySelector(".dlg-ok")?.addEventListener("click", bestaetigen);
      wrap.querySelector(".dlg-abbruch")?.addEventListener("click", abbrechen);
      // Tipp neben die Karte schliesst ab, wie man es von Blaettern kennt.
      wrap.addEventListener("click", (e) => { if (e.target === wrap) abbrechen(); });

      function aufTaste(e) {
        if (e.key === "Escape") { e.preventDefault(); abbrechen(); }
        else if (e.key === "Enter" && opts.art !== "wahl" &&
                 (opts.art !== "eingabe" || document.activeElement === input)) {
          e.preventDefault(); bestaetigen();
        }
      }
      document.addEventListener("keydown", aufTaste);

      // Auf dem iPad wuerde ein sofortiger focus() die Tastatur hochreissen,
      // bevor der Dialog fertig eingeblendet ist. Ein Bild spaeter ist ruhiger.
      if (input) requestAnimationFrame(() => { input.focus(); input.select(); });
      else (wrap.querySelector(".dlg-ok") || wrap.querySelector(".dlg-option"))?.focus();
    });
  }

  Casino.dialog = {
    /** Ja/Nein. Antwortet mit true oder false. */
    frage: (text, opts = {}) => zeige({ ...opts, text, art: "frage" }),
    /** Texteingabe. Antwortet mit dem Text oder null bei Abbruch. */
    eingabe: (text, opts = {}) => zeige({ ...opts, text, art: "eingabe" }),
    /** Nur zur Kenntnis. */
    hinweis: (text, opts = {}) => zeige({ ...opts, text, art: "hinweis" }),
    /*
     * Auswahl aus mehreren festen Moeglichkeiten. Antwortet mit dem `wert`
     * der gewaehlten Option oder null bei Abbruch.
     *
     * Gab es bisher nicht, und das merkte man: die Kriegsdauer wurde als
     * freie Texteingabe erfragt ("1, 3 oder 7"), obwohl der Server nur genau
     * diese drei Werte annimmt. Wer 5 tippte, bekam kommentarlos 3.
     *
     *   const tage = await Casino.dialog.wahl("Wie lange?", {
     *     optionen: [{ wert: "1", label: "1 Tag" }, { wert: "3", label: "3 Tage" }],
     *   });
     */
    wahl: (text, opts = {}) => zeige({ ...opts, text, art: "wahl" }),
  };
})();
