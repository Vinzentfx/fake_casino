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
    "rad_fortuna", "auk_hologramm", "kiste_lack", "adm_zensiert", "sml_glutkern",
    "aurora", "hochspannung", "gala_gravur", "gala_rampenlicht", "staub_quecksilber"]);
  const RAHMEN = new Set(["silber", "gold", "neon", "rotierend", "flamme", "sterne", "s2_wolf",
    "rad_fortuna", "adm_orbit", "uhrwerk", "kiste_sprung", "gala_kranz", "staub_zahnkranz"]);
  const AUREN = new Set(["auk_goldstaub", "auk_leere", "kiste_funken", "adm_eklipse", "sml_nachtschwarm",
    "kiste_ringsystem", "gala_konfetti", "staub_sternenschmiede"]);

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
   * Ohne Aura kommt auch keine Huelle, dann steht ueberall genau dasselbe
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

  /*
   * Das Prunkstueck: eine kleine Marke mit der Nummer, direkt am Namen.
   *
   * Das ist die Antwort auf das eigentliche Problem mit Kosmetik in diesem
   * Haus: Kartenruecken sieht nur man selbst, eine Aura nur, wer
   * gleichzeitig online ist, ein Banner erst, wer einen antippt. In einer
   * Runde, die versetzt spielt, ist das teuerste Stueck damit praktisch
   * unsichtbar. Die Marke haengt am Namen und reist deshalb ueberall mit,
   * wo der Name hingeht.
   *
   * Die Stufe kommt als KENNUNG vom Server und wird hier gegen eine feste
   * Liste geprueft. Eine Farbe direkt aus der Nachricht zu uebernehmen
   * hiesse, Fremdes ins Dokument zu schreiben; dieselbe Regel wie bei
   * Stilen, Rahmen und Auren.
   */
  /* Chat-Zeichen: gezeichnete Symbole aus core/icons.js. Erlaubnisliste wie
     ueberall, ein unbekannter Wert aus einer alten Nachricht darf kein
     fremdes Symbol ins Dokument schreiben. */
  const ZEICHEN = {
    stern: "stern-voll", flagge: "flagge", ziel: "ziel", blitz: "blitz",
    edelstein: "edelstein", krone: "krone", bombe: "bombe", totenkopf: "totenkopf",
    auk_marke: "marke",
    hai: "hai", klingen: "krieg", tresor: "schatzkammer",
    gala_konfetti: "konfetti", gala_stern: "gala-stern",
    staub_siegel: "marke",
  };
  /** Das Zeichen vor einer Chat-Nachricht. Nichts, wenn keins angelegt ist. */
  function zeichen(p) {
    const id = p && p.zeichen;
    if (!id || !ZEICHEN[id]) return "";
    const icons = Casino.icons;
    if (!icons || !icons.ui) return "";
    return `<span class="pl-zeichen zn-${id}" aria-hidden="true">${icons.ui(ZEICHEN[id])}</span>`;
  }

  const PRUNK_STUFEN = new Set(["gewoehnlich", "selten", "episch", "legendaer", "mythisch", "einzel", "haus"]);
  const SERIEN_RANG = new Set(["standard", "glueck", "gold", "jackpot"]);
  function serienCode(k) {
    if (!k || !k.nr) return "";
    return (k.serie && k.serie.code) || String(k.nr).padStart(4, "0");
  }
  function serienRang(k) {
    const rang = k && k.serie && k.serie.id;
    return SERIEN_RANG.has(rang) ? rang : "standard";
  }
  function serienBadge(k, { label = true } = {}) {
    if (!k || !k.nr) return "";
    const rang = serienRang(k);
    const name = (k.serie && k.serie.label) || "Klassische Serie";
    return `<span class="serie-badge serie-${rang}" title="${esc(name)} #${serienCode(k)}">`
      + `<i></i>${label ? `<small>${esc(name)}</small>` : ""}<b>#${serienCode(k)}</b></span>`;
  }

  /* Die Marke am Namen zeigt nicht mehr, wer zuerst geklickt hat, sondern
     welche zufällige Serienprägung dieses konkrete Exemplar trägt. */
  function prunk(p) {
    const k = p && p.prunk;
    if (!k || !k.nr) return "";
    const stufe = PRUNK_STUFEN.has(k.stufe) ? k.stufe : "gewoehnlich";
    const rang = serienRang(k);
    const titel = `${k.label} #${serienCode(k)} — ${(k.serie && k.serie.label) || "Klassische Serie"}`;
    return `<span class="pl-prunk pr-${stufe} serie-${rang}" title="${esc(titel)}">`
      + `<i></i>${esc(serienCode(k))}</span>`;
  }

  /*
   * Die Garnitur: drei oder mehr Stuecke derselben Familie gleichzeitig.
   *
   * Sie beantwortet die Frage, warum man mehr als zwoelf Stuecke besitzen
   * sollte. Tragen kann man immer nur zwoelf, also ist jedes weitere
   * Stueck fuer die Aussenwirkung wertlos — ausser man sammelt EINE
   * Familie und traegt sie zusammen.
   *
   * Die Familien stehen als feste Liste hier, wie bei Stilen und Rahmen
   * auch: der Server schickt nur die Kennung, und ein unbekannter Wert aus
   * einer alten Nachricht darf keine fremde Klasse ins Dokument schreiben.
   */
  const FAMILIEN = new Set(["gala", "sml", "auk", "adm", "s2", "kiste", "rad", "staub"]);
  function garnitur(p) {
    const g = p && p.garnitur;
    if (!g || !FAMILIEN.has(g.id) || !g.teile) return "";
    /* Ab fuenf Teilen leuchtet sie. Drei sind ein Anfang, fuenf sind eine
       Ansage, und wer will, dass es auffaellt, sammelt weiter. */
    const voll = g.teile >= 5 ? " voll" : "";
    return `<span class="pl-garnitur ga-${g.id}${voll}" title="${esc(g.label)}-Garnitur: ${g.teile} Stücke gleichzeitig angelegt">`
      + `<i></i>${esc(String(g.teile))}</span>`;
  }

  /** Der Titel, falls einer angelegt ist. Sonst nichts. */
  function title(p) {
    return p && p.title ? `<span class="pl-title">${esc(p.title)}</span>` : "";
  }

  /** Bild, Name und Titel zusammen. Fuer Listen. */
  function chip(p, opts = {}) {
    return avatar(p) + `<span class="pl-text">` + name(p, opts) + prunk(p) + garnitur(p) + title(p) + `</span>`;
  }

  /*
   * Wie ein Kosmetikstueck AUSSIEHT, als Vorschau.
   *
   * Steht hier und nicht im Laden, weil es zwei Stellen gibt, die es
   * brauchen: den Laden und den Markt. Ein Markt, auf dem man ein Aussehen
   * kauft, ohne es zu sehen, ist kaputt, und dieselbe Kachel zweimal zu
   * schreiben endet damit, dass eine von beiden nach dem naechsten Umbau
   * anders aussieht. Genau das war mit der Namenszeile passiert, bevor
   * Casino.spieler entstand.
   *
   * `stueck` ist { art, id, label, text, emoji, color }, also genau das, was
   * cosmetics.vorschauDaten() auf dem Server liefert.
   */
  function kosVorschau(stueck, opts = {}) {
    if (!stueck) return "";
    const { art, id, label, text, emoji, color } = stueck;
    const wer = opts.name || "Du";
    const l = esc(label || id);
    switch (art) {
      case "style":
        return `<span class="cos-style-demo ${id === "standard" ? "" : "nm-" + id}">${l}</span>`;
      case "title":
        return `<span class="cos-title-demo">${text ? esc(text) : "(ohne)"}</span>`;
      case "spruch":
        return `<span class="cos-title-demo">${text ? esc(String(text).replace("{name}", wer)) : "(ohne)"}</span>`;
      case "frame":
        return `<span class="pl-ava ${id === "keiner" ? "" : "fr-" + id}">🙂</span>`;
      case "aura":
        return `<span class="cos-aura-demo ${id === "keine" ? "" : "au-" + id}"><span class="pl-ava">🙂</span></span>`;
      case "karte":
        return `<span class="cos-karte-demo" data-karte="${esc(id)}"></span>`;
      case "schild":
        return `<span class="online-player cos-schild-demo${id === "keins" ? "" : " sch-" + id}"><span>🙂</span><b>${esc(wer)}</b></span>`;
      case "banner":
        return `<span class="cos-banner-demo" data-banner="${esc(id)}"></span>`;
      case "avatar":
        return `<span class="cos-emoji">${esc(emoji || "🙂")}</span>`;
      case "color":
        return `<span class="cos-swatch" style="background:${esc(color || "#e8e8e8")}"></span>`;
      /* Der Gewinn-Effekt ist das einzige Stueck, das man nicht stehend
         zeigen kann: er passiert einmal und ist vorbei. Bleibt beim Namen. */
      case "effect":
      default:
        return `<span class="cos-effekt-demo">${l}</span>`;
    }
  }

  Casino.spieler = { name, avatar, title, chip, prunk, garnitur, zeichen, kosVorschau, serienCode, serienRang, serienBadge };
})();
