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
    "rad_fortuna", "auk_hologramm"]);
  const RAHMEN = new Set(["silber", "gold", "neon", "rotierend", "flamme", "sterne", "s2_wolf",
    "rad_fortuna"]);
  const AUREN = new Set(["auk_goldstaub", "auk_leere"]);

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

  /**
   * Das Bild mit Rahmen und Aura.
   *
   * Die Aura braucht eine eigene Huelle um das Bild: sie malt ihre Teilchen in
   * ::before/::after, und das Bild selbst benutzt beide schon fuer den Rahmen.
   * Ohne Aura kommt auch keine Huelle — dann steht ueberall genau dasselbe
   * Markup wie vorher.
   */
  function avatar(p, opts = {}) {
    const r = p && p.frame && RAHMEN.has(p.frame) ? p.frame : null;
    const a = p && p.aura && AUREN.has(p.aura) ? p.aura : null;
    const klassen = ["pl-ava"];
    if (r) klassen.push("fr-" + r);
    if (opts.extra) klassen.push(opts.extra);
    const bild = `<span class="${klassen.join(" ")}" aria-hidden="true">${esc((p && p.avatar) || "🙂")}</span>`;
    return a ? `<span class="pl-aura au-${a}" aria-hidden="true">${bild}</span>` : bild;
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
