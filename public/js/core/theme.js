"use strict";

/**
 * Theme-Umschaltung.
 *
 * Die Palette hängt an html[data-theme]. Gesetzt wird sie an drei Stellen,
 * absichtlich mehrfach:
 *   1. Inline-Skript im <head>  → noch vor dem ersten Zeichnen, kein Aufblitzen
 *   2. localStorage             → sofort verfügbar, auch offline
 *   3. Account (prefs:set)      → folgt dem Spieler auf iPad und Handy
 *
 * Der Account gewinnt beim Login, weil er geräteübergreifend gilt. Danach
 * schreibt jede Änderung in beide Richtungen zurück.
 */
(function () {
  const KEY = "casino_theme";
  const THEMES = {
    klassik: { label: "Klassik", hint: "Filzgrün und Gold", swatch: ["#0f4029", "#e7c66b"], meta: "#0b2a1d" },
    mitternacht: { label: "Mitternacht", hint: "Marineblau und Gold", swatch: ["#1c2842", "#e9c478"], meta: "#0e1626" },
    neon: { label: "Neon", hint: "Fast schwarz und Türkis", swatch: ["#141d2f", "#2ee6c8"], meta: "#080b13" },
  };
  const DEFAULT = "klassik";
  const isValid = (t) => Object.prototype.hasOwnProperty.call(THEMES, t);

  let current = DEFAULT;
  try {
    const stored = localStorage.getItem(KEY);
    if (isValid(stored)) current = stored;
  } catch {}

  function apply(name, { persist = true, sync = true } = {}) {
    if (!isValid(name)) return current;
    current = name;
    document.documentElement.setAttribute("data-theme", name);

    // Safari färbt die Statusleiste nach diesem Meta-Tag. Ohne Update
    // bliebe oben ein grüner Streifen über einem blauen Theme stehen.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEMES[name].meta);

    if (persist) { try { localStorage.setItem(KEY, name); } catch {} }
    if (sync && window.Casino && window.Casino.savePrefs) {
      window.Casino.savePrefs({ theme: name });
    }
    document.dispatchEvent(new CustomEvent("casino:themechange", { detail: { theme: name } }));
    return current;
  }

  // Beim Start einmal anwenden: das Inline-Skript hat data-theme zwar schon
  // gesetzt, aber weder das Meta-Tag noch das Event ausgelöst.
  apply(current, { persist: false, sync: false });

  window.Casino = window.Casino || {};
  window.Casino.theme = {
    get: () => current,
    set: (name) => apply(name),
    list: () => Object.entries(THEMES).map(([id, t]) => ({ id, ...t })),
    /** Wird nach dem Login mit dem Wert vom Server aufgerufen. */
    adoptFromAccount(name) {
      if (isValid(name) && name !== current) apply(name, { persist: true, sync: false });
    },
  };
})();
