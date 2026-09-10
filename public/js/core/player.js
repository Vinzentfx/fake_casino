"use strict";

/**
 * Wie ein Spieler aussieht.
 *
 * Bisher stand an jeder Stelle, die einen Namen zeigt, dieselbe Zeile:
 *   const color = p.nameColor ? ` style="color:${p.nameColor}"` : "";
 * Sieben Mal in app.js, dazu Bestenliste und Statistik, und im Chat gar
 * nicht. Wer sich eine Farbe gekauft hatte, sah davon ausgerechnet im Chat
 * nichts. Mit Stilen, Rahmen und Titeln waeren daraus sieben Kopien einer
 * immer komplizierteren Regel geworden.
 *
 * Deshalb steht das Aussehen ab jetzt genau hier. Wer einen Spieler anzeigt,
 * ruft Casino.spieler.name(p) oder .avatar(p) auf und bekommt fertiges HTML.
 *
 * Die Stile sind CSS-Klassen (nm-feuer, fr-flamme). Der Server schickt nur
 * die Kennung, damit man einen Stil aendern kann, ohne dass alte Accounts
 * eine kaputte Farbe mit sich herumtragen.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Nur was der Server auch kennt. Ein unbekannter Wert aus einer alten
  // Nachricht darf keine fremde Klasse ins Dokument schreiben.
  const STILE = new Set(["sonne", "eis", "gift", "beere", "puls", "schimmer",
    "neon", "regenbogen", "feuer", "glitch", "vanta", "splitter", "krone", "s2_bernstein", "s2_phoenix",
    "rad_fortuna"]);
  const RAHMEN = new Set(["silber", "gold", "neon", "rotierend", "flamme", "sterne", "s2_wolf",
    "rad_fortuna"]);

  /**
   * Der Name mit Farbe oder Stil.
   * @param {object} p  Spieler (name, nameColor, nameStyle)
   * @param {{tag?: string, extra?: string}} [opts]  Element und Zusatzklassen
   */
  function name(p, opts = {}) {
    const tag = opts.tag || "span";
    const stil = p && p.nameStyle && STILE.has(p.nameStyle) ? p.nameStyle : null;
    const klassen = ["pl-name"];
    if (stil) klassen.push("nm-" + stil);
    if (opts.extra) klassen.push(opts.extra);
    // Ein Stil faerbt ueber einen Verlauf und ueberschreibt die flache Farbe.
    const style = !stil && p && p.nameColor ? ` style="color:${esc(p.nameColor)}"` : "";
    // data-name traegt den Text noch einmal: die Stile Glitch und Splitter
    // legen darueber versetzte Kopien aus ::before/::after, und die kommen
    // nur ueber attr() an den Namen.
    return `<${tag} class="${klassen.join(" ")}"${style} data-name="${esc(p && p.name)}">${esc(p && p.name)}</${tag}>`;
  }

  /** Das Bild mit Rahmen. */
  function avatar(p, opts = {}) {
    const r = p && p.frame && RAHMEN.has(p.frame) ? p.frame : null;
    const klassen = ["pl-ava"];
    if (r) klassen.push("fr-" + r);
    if (opts.extra) klassen.push(opts.extra);
    return `<span class="${klassen.join(" ")}" aria-hidden="true">${esc((p && p.avatar) || "🙂")}</span>`;
  }

  /** Der Titel, falls einer angelegt ist. Sonst nichts. */
  function title(p) {
    return p && p.title ? `<span class="pl-title">${esc(p.title)}</span>` : "";
  }

  /** Bild, Name und Titel zusammen. Fuer Listen. */
  function chip(p, opts = {}) {
    return avatar(p) + `<span class="pl-text">` + name(p, opts) + title(p) + `</span>`;
  }

  Casino.spieler = { name, avatar, title, chip };
})();
