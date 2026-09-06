"use strict";

/**
 * Einsatz-Schnellwahl.
 *
 * In Mines, Towers, Crash und Pinco stand der Einsatz als nacktes Zahlenfeld
 * da. Auf dem iPad heisst das: Tastatur aufklappen, Zahl loeschen, neue Zahl
 * tippen, Tastatur wegklappen — fuer jede Runde. Wer mit 200.000 Chips spielt,
 * tippt sechs Ziffern.
 *
 * Diese Leiste haengt sich unter ein vorhandenes Zahlenfeld und macht daraus
 * halbieren, verdoppeln und "alles was geht". Sie kennt das Konto ueber
 * Casino.getAccount(), damit "Max" nie mehr vorschlaegt, als man hat.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, Math.floor(v) || min));
  }

  /**
   * @param {HTMLInputElement} input  das Einsatzfeld
   * @param {{min:number, max:number, schritt?:number}} opts
   */
  function leiste(input, opts) {
    if (!input || input.dataset.betBar === "1") return;
    input.dataset.betBar = "1";
    const min = opts.min, max = opts.max;
    const schritt = opts.schritt || min;

    const bar = document.createElement("div");
    bar.className = "bet-quick";
    bar.innerHTML =
      `<button type="button" data-bet="min">Min</button>` +
      `<button type="button" data-bet="half">½</button>` +
      `<button type="button" data-bet="double">2×</button>` +
      `<button type="button" data-bet="max">Max</button>`;

    // Unter das Label haengen, in dem das Feld steckt. Faellt es aus dem
    // Rahmen, tut es das direkt hinter dem Feld.
    const anker = input.closest("label") || input;
    anker.parentNode.insertBefore(bar, anker.nextSibling);

    const setze = (v) => {
      input.value = String(clamp(v, min, max));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-bet]");
      if (!b) return;
      const jetzt = parseInt(input.value, 10) || min;
      const acc = Casino.getAccount ? Casino.getAccount() : null;
      const guthaben = acc && Number.isFinite(acc.chips) ? acc.chips : max;
      if (Casino.sound) Casino.sound.play("tick");
      switch (b.dataset.bet) {
        case "min": return setze(min);
        case "half": return setze(Math.max(min, Math.round(jetzt / 2 / schritt) * schritt));
        case "double": return setze(Math.min(max, jetzt * 2));
        // Max heisst: so viel wie erlaubt UND vorhanden. Ein Vorschlag, den
        // der Server dann ablehnt, waere nur aergerlich.
        case "max": return setze(Math.min(max, guthaben));
      }
    });
    return bar;
  }

  Casino.einsatz = { leiste };
})();
