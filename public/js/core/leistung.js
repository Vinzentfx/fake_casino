"use strict";

/*
 * Grafik: volle Effekte oder sparsam.
 *
 * Gespielt wird auf dem iPad, und dort kosten genau die Dinge am meisten,
 * die man kaum bemerkt: Weichzeichner hinter Glas (backdrop-filter), der
 * unscharfe Raum hinter einem Spiel, Leuchtschatten auf Neonröhren und
 * Hintergründe, die über ihre background-position wandern. Jedes davon
 * zwingt Safari, große Flächen in jedem Bild neu zu rechnen, während vorn
 * die Walzen laufen.
 *
 * Drei Stufen, am Konto gespeichert (prefs.leistung):
 *   auto     sparsam auf Touch-Geräten, voll am Rechner (Standard)
 *   voll     alles an
 *   sparsam  alles aus, was nur hübsch ist
 *
 * „Bewegung reduzieren“ schaltet sparsam immer mit ein. Wer keine Bewegung
 * will, braucht auch keinen wandernden Goldstaub.
 *
 * Das Inline-Skript im <head> setzt die Klasse schon vor dem ersten
 * Zeichnen aus dem localStorage, damit nichts aufblitzt.
 */
(function () {
  const KEY = "casino_leistung";
  const MODI = ["auto", "voll", "sparsam"];
  const html = document.documentElement;

  let modus = "auto";
  try {
    const m = localStorage.getItem(KEY);
    if (MODI.includes(m)) modus = m;
  } catch {}

  /* Ein iPad meldet sich in Safari als Mac, nur mit Touchpunkten. Mit
     angestecktem Trackpad sagt es außerdem „pointer: fine“, deshalb wird
     es über den Namen erkannt und nicht über den Zeiger. */
  function beruehrung() {
    try {
      const ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod|Android/.test(ua)) return true;
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
      return navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches;
    } catch { return false; }
  }

  function sparsam() {
    if (html.classList.contains("reduce-motion")) return true;
    if (modus === "sparsam") return true;
    if (modus === "voll") return false;
    return beruehrung();
  }

  function anwenden() {
    html.classList.toggle("sparsam", sparsam());
    html.dataset.leistung = modus;
  }

  function setze(m, { speichern = true } = {}) {
    if (!MODI.includes(m)) return modus;
    modus = m;
    try { localStorage.setItem(KEY, m); } catch {}
    anwenden();
    if (speichern && window.Casino && window.Casino.savePrefs) window.Casino.savePrefs({ leistung: m });
    return modus;
  }

  // Wer „Bewegung reduzieren“ umschaltet, ändert die Klasse an html; dem folgen wir.
  if (window.MutationObserver) {
    let warReduziert = html.classList.contains("reduce-motion");
    new MutationObserver(() => {
      const jetzt = html.classList.contains("reduce-motion");
      if (jetzt !== warReduziert) { warReduziert = jetzt; anwenden(); }
    }).observe(html, { attributes: true, attributeFilter: ["class"] });
  }

  anwenden();
  window.Casino = window.Casino || {};
  window.Casino.leistung = { modus: () => modus, setze, sparsam, MODI };
})();
