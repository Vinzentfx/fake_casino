"use strict";

/**
 * Screen-Verwaltung und Verlauf.
 *
 * Vorher stand in app.js eine Kette aus rund dreissig
 * `if (name === "…") window.Casino._loadX()`. Jeder neue Screen brauchte dort
 * eine weitere Zeile, und einen Verlauf gab es gar nicht: die Zurueck-Geste
 * auf dem iPad fuehrte aus der App heraus statt einen Screen zurueck, und
 * einen Tisch konnte man niemandem verlinken.
 *
 * Dieses Modul macht drei Dinge:
 *
 *   Registrierung  Ein Screen meldet sich mit register(name, {onEnter, onLeave}).
 *                  Damit das nicht alle dreissig Spielmodule auf einmal
 *                  umgebaut werden muessen, gilt weiter die alte Konvention:
 *                  gibt es keinen registrierten Eintrag, wird
 *                  Casino._load<Name> aufgerufen, so wie bisher.
 *
 *   Verlauf        Jeder Wechsel schreibt einen History-Eintrag (#/name).
 *                  Damit funktionieren Zurueck-Geste, Zurueck-Taste und
 *                  geteilte Links.
 *
 *   Abschirmung    Ein Waechter kann einen Wechsel verhindern, etwa weil der
 *                  Screen gesperrt ist oder niemand eingeloggt ist.
 *
 * app.js haengt sich fuer alles Uebergreifende (Topbar, Praesenz, Chat) an
 * das Ereignis "casino:screen".
 */
(function () {
  const handlers = new Map();   // je name: { onEnter, onLeave }
  let guard = null;             // (name) => true | false
  let fallback = "login";       // wohin, wenn der Waechter ablehnt
  let current = null;
  let navigating = false;       // schuetzt vor Schleifen ueber popstate

  const el = (name) => document.querySelector(`.screen[data-screen="${name}"]`);
  const exists = (name) => !!el(name);

  /** aus "blackjackLobby" wird "_loadBlackjackLobby" */
  const legacyHookName = (name) => "_load" + name.charAt(0).toUpperCase() + name.slice(1);

  function runEnter(name) {
    const entry = handlers.get(name);
    if (entry && typeof entry.onEnter === "function") {
      entry.onEnter(name);
      return;
    }
    // Alte Konvention: Casino._loadWork, Casino._loadBank …
    const legacy = window.Casino && window.Casino[legacyHookName(name)];
    if (typeof legacy === "function") legacy(name);
  }

  function runLeave(name) {
    const entry = handlers.get(name);
    if (entry && typeof entry.onLeave === "function") entry.onLeave(name);
  }

  /**
   * @param {string} name
   * @param {{history?: "push"|"replace"|"none"}} [opts]
   */
  function show(name, opts = {}) {
    if (!exists(name)) return false;
    if (guard && guard(name) === false) return false;

    const previous = current;
    if (previous && previous !== name) runLeave(previous);

    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el(name).classList.add("active");
    current = name;

    const mode = opts.history || (previous === name ? "none" : "push");
    if (mode !== "none" && !navigating) {
      const url = "#/" + name;
      const state = { screen: name };
      if (mode === "replace" || previous === null) history.replaceState(state, "", url);
      else history.pushState(state, "", url);
    }

    runEnter(name);
    document.dispatchEvent(new CustomEvent("casino:screen", {
      detail: { screen: name, previous },
    }));
    return true;
  }

  // Zurueck-Geste, Zurueck-Taste, verlinkter Aufruf.
  window.addEventListener("popstate", (e) => {
    const name = (e.state && e.state.screen) || fromHash();
    if (!name || !exists(name)) return;
    navigating = true;
    const ok = show(name, { history: "none" });
    navigating = false;
    // Abgelehnt, etwa weil inzwischen niemand mehr eingeloggt ist. Dann muss
    // die Adresse mitziehen, sonst steht #/blackjack in der Leiste, waehrend
    // der Login zu sehen ist.
    if (!ok && fallback && exists(fallback)) show(fallback, { history: "replace" });
  });

  function fromHash() {
    const h = String(location.hash || "");
    const m = h.match(/^#\/([a-zA-Z]+)$/);
    return m ? m[1] : null;
  }

  window.Casino = window.Casino || {};
  window.Casino.screens = {
    register(name, hooks) { handlers.set(name, hooks || {}); },
    setGuard(fn) { guard = fn; },
    setFallback(name) { fallback = name; },
    show,
    current: () => current,
    exists,
    /** Screen aus der Adresse, falls jemand einen Link geteilt hat. */
    fromHash,
    back() { history.back(); },
  };
})();
