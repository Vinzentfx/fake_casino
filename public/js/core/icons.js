"use strict";

/**
 * Gezeichnete Symbole fuer die Spielkacheln.
 *
 * Vorher stand in jeder Kachel ein Emoji. Emoji sehen auf jedem Geraet anders
 * aus, tragen ihre eigenen Farben mit sich herum und passen deshalb zu keinem
 * der drei Designs. Und manche sagen schlicht nichts: Pinco Ball war ein
 * gruener Kreis, was ein Spiel mit Naegeln und Faechern ueberhaupt nicht
 * beschreibt.
 *
 * Diese hier sind Strichzeichnungen in einem gemeinsamen Raster (24x24,
 * Strichstaerke 1,75, runde Enden). Sie nehmen ihre Farbe ueber currentColor
 * aus der Kachel, laufen also in Klassik, Mitternacht und Neon mit. Die
 * Akzentflaechen benutzen `--h`, den Farbton, den die Kachel ohnehin schon
 * fuehrt.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});

  // Kurzschreibweisen, damit die Zeichnungen lesbar bleiben.
  const A = 'fill="hsl(var(--h,45) 70% 62%)"';       // Akzentflaeche im Spielton
  const S = 'stroke="currentColor" fill="none"';

  const ICONS = {
    // Drei Walzen mit Fenster und einer leuchtenden Sieben.
    slots: `<rect x="2.5" y="5" width="19" height="14" rx="2.5" ${S}/>
      <path d="M8 5v14M14.5 5v14" ${S} opacity=".55"/>
      <path d="M5 9.5h1.8M5 13h1.8" ${S} opacity=".5"/>
      <path d="M10 9h3l-1.8 6" ${S}/>
      <circle cx="18.2" cy="12" r="1.6" ${A}/>`,

    // Zwei Karten, die vordere mit Pik.
    blackjack: `<rect x="3" y="6" width="10" height="14" rx="1.8" ${S} transform="rotate(-9 8 13)"/>
      <rect x="10.5" y="4.5" width="10.5" height="15" rx="1.8" ${S}/>
      <path d="M15.7 8.2c1.7 1.9 3 2.8 3 4.2a1.6 1.6 0 0 1-3 .5 1.6 1.6 0 0 1-3-.5c0-1.4 1.3-2.3 3-4.2Z" ${A}/>
      <path d="M15.7 13.6v2.4" ${S}/>`,

    // Kessel von oben: Sektoren, Nabe, Kugel.
    roulette: `<circle cx="12" cy="12" r="9" ${S}/>
      <circle cx="12" cy="12" r="4.4" ${S} opacity=".6"/>
      <circle cx="12" cy="12" r="1.5" ${A}/>
      <path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21M5.6 5.6l2.4 2.4M16 16l2.4 2.4M18.4 5.6 16 8M8 16l-2.4 2.4" ${S} opacity=".45"/>
      <circle cx="12" cy="5.2" r="1.15" fill="currentColor"/>`,

    // Rakete mit Fenster, Flossen und Flugbahn.
    crash: `<path d="M12 3.2c2.6 2.3 3.9 5.2 3.9 8.7v4.2h-7.8v-4.2c0-3.5 1.3-6.4 3.9-8.7Z" ${S}/>
      <circle cx="12" cy="9.6" r="1.7" ${A}/>
      <path d="M8.1 12.6 5.4 15v3.1l2.7-1.9Zm7.8 0L18.6 15v3.1l-2.7-1.9Z" ${S}/>
      <path d="M10.6 18.4c.3 1.3.8 2.3 1.4 3 .6-.7 1.1-1.7 1.4-3" ${S}/>`,

    // Feld mit Edelstein und aufgedeckter Mine.
    mines: `<rect x="3" y="3" width="18" height="18" rx="2.5" ${S}/>
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" ${S} opacity=".35"/>
      <path d="M6 10.6 7.5 12l-1.5 1.4L4.5 12Z" ${A}/>
      <circle cx="17.6" cy="17.6" r="2" ${S}/>
      <path d="M19 16.2l1.1-1.1" ${S}/>`,

    // Gestufter Turm mit Krone oben.
    towers: `<rect x="4" y="16" width="16" height="5" rx="1.2" ${S}/>
      <rect x="6" y="11" width="12" height="5" rx="1.2" ${S}/>
      <rect x="8.5" y="6" width="7" height="5" rx="1.2" ${S}/>
      <path d="M9.4 6 12 2.6 14.6 6Z" ${A}/>`,

    // Nagelbrett mit fallendem Ball und Faechern unten — das, was das Spiel
    // wirklich ist. Vorher stand hier ein gruener Kreis.
    pinco: `<circle cx="12" cy="3.6" r="1.6" ${A}/>
      <path d="M8.6 8h.01M12 8h.01M15.4 8h.01M6.9 11.6h.01M10.3 11.6h.01M13.7 11.6h.01M17.1 11.6h.01M5.2 15.2h.01M8.6 15.2h.01M12 15.2h.01M15.4 15.2h.01M18.8 15.2h.01"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M3 18.6h18M6 18.6V21M10 18.6V21M14 18.6V21M18 18.6V21" ${S}/>`,

    // Hufeisen. Ein Pferd in 24 Pixeln wird immer ein Kringel; das Hufeisen
    // erkennt dagegen jeder sofort.
    horses: `<path d="M7.6 20.5V16c-1.1-1.2-1.7-2.7-1.7-4.5a6.1 6.1 0 0 1 12.2 0c0 1.8-.6 3.3-1.7 4.5v4.5" ${S} stroke-width="2.1"/>
      <path d="M7.6 20.5h2.6M13.8 20.5h2.6" ${S} stroke-width="2.1"/>
      <circle cx="8.6" cy="8.6" r=".85" ${A}/>
      <circle cx="12" cy="7.3" r=".85" ${A}/>
      <circle cx="15.4" cy="8.6" r=".85" ${A}/>`,

    // Fussball mit den typischen Fuenfecken.
    sports: `<circle cx="12" cy="12" r="8.8" ${S}/>
      <path d="m12 8.6 2.3 1.7-.9 2.7h-2.8l-.9-2.7Z" ${A}/>
      <path d="M12 4.6v4M5.6 9.9l4.1 1.2M18.4 9.9l-4.1 1.2M8.3 18.1l2.2-4.9M15.7 18.1l-2.2-4.9" ${S} stroke-width="1.4" opacity=".5"/>`,

    // Aufgefaecherte Karten mit Chip.
    poker: `<rect x="2.4" y="5.5" width="8" height="11.5" rx="1.6" ${S} transform="rotate(-14 6.4 11.2)"/>
      <rect x="7.6" y="4" width="8" height="11.5" rx="1.6" ${S}/>
      <path d="M11.6 6.9c1.2 1.4 2.2 2.1 2.2 3.1a1.2 1.2 0 0 1-2.2.4 1.2 1.2 0 0 1-2.2-.4c0-1 1-1.7 2.2-3.1Z" ${A}/>
      <circle cx="16.6" cy="17" r="4" ${S}/>
      <path d="M16.6 13v1.6M16.6 19.4V21M12.6 17h1.6M19 17h1.6" ${S}/>`,

    // Springer.
    chess: `<path d="M7 20h10l-.6-3.4c1.3-3.3.6-6.6-2-8.8l.9-2.3-2.2.7-1-1.9-1.2 2.6-2.6 1.9c-1.1.8-1.5 2-1 3l2.2-1.2 1.4 1.3-3.3 3.4c-.9 1-.9 2.4-.1 3.4Z" ${S}/>
      <circle cx="13.6" cy="9.4" r=".85" fill="currentColor"/>
      <path d="M6 20h12v1.4H6Z" ${A}/>`,

    // Zwei Karten, eine offen.
    memory: `<rect x="2.8" y="4.5" width="8.4" height="12" rx="1.6" ${S}/>
      <path d="M5 7.5h4M5 10h4M5 12.5h2.6" ${S} opacity=".45"/>
      <rect x="12.2" y="7.5" width="9" height="12" rx="1.6" ${S}/>
      <circle cx="16.7" cy="13.5" r="2.4" ${A}/>`,

    // Zahlenraster.
    sudoku: `<rect x="3" y="3" width="18" height="18" rx="2.2" ${S}/>
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" ${S} opacity=".55"/>
      <path d="M5.4 6.4h1.2v3.4" ${S} stroke-width="1.5"/>
      <path d="M11.2 12.6c0-.7.6-1.2 1.3-1.2s1.3.5 1.3 1.2c0 1.2-2.6 1.6-2.6 3.2h2.6" ${S} stroke-width="1.5"/>
      <circle cx="18" cy="18" r="1.5" ${A}/>`,

    // Kartenkaskade.
    solitaire: `<rect x="3" y="3.5" width="8.5" height="11" rx="1.6" ${S}/>
      <rect x="6.6" y="6.5" width="8.5" height="11" rx="1.6" ${S}/>
      <rect x="10.2" y="9.5" width="8.5" height="11" rx="1.6" ${S}/>
      <path d="M14.4 13.2c1.2 1.4 2.1 2 2.1 3a1.15 1.15 0 0 1-2.1.4 1.15 1.15 0 0 1-2.1-.4c0-1 .9-1.6 2.1-3Z" ${A}/>`,

    // Skyline mit Turm.
    businesses: `<path d="M2.5 21h19" ${S}/>
      <rect x="3.5" y="11" width="5" height="10" rx=".8" ${S}/>
      <rect x="9.8" y="6" width="5" height="15" rx=".8" ${S}/>
      <rect x="16.1" y="13.5" width="4.4" height="7.5" rx=".8" ${S}/>
      <path d="M5.3 13.5h1.4M5.3 16.5h1.4M11.6 8.5h1.4M11.6 11.5h1.4M11.6 14.5h1.4" ${S} opacity=".5"/>
      <path d="M12.3 6V3.2" ${S}/>
      <circle cx="12.3" cy="2.6" r="1.1" ${A}/>`,

    // Kerzenchart.
    stocks: `<path d="M3 21h18" ${S}/>
      <path d="M6.5 6v12M11 9v9M15.5 4.5v11M20 8v7" ${S} opacity=".45"/>
      <rect x="5.2" y="9" width="2.6" height="6" rx=".7" ${S}/>
      <rect x="9.7" y="11.5" width="2.6" height="5" rx=".7" ${A}/>
      <rect x="14.2" y="7" width="2.6" height="6.5" rx=".7" ${S}/>
      <rect x="18.7" y="10" width="2.6" height="4" rx=".7" ${A}/>`,

    // Bankgebaeude mit Saeulen.
    bank: `<path d="M2.5 21h19" ${S}/>
      <path d="M12 3 3 8h18Z" ${S}/>
      <path d="M6 11v7M10 11v7M14 11v7M18 11v7" ${S}/>
      <path d="M4 18.4h16" ${S}/>
      <circle cx="12" cy="6" r="1.1" ${A}/>`,

    // Fliege und Tablett: man arbeitet im Casino, nicht im Lager.
    work: `<path d="M3.5 15.5h17l-1.5 5a1.7 1.7 0 0 1-1.6 1.2H6.6a1.7 1.7 0 0 1-1.6-1.2Z" ${S}/>
      <path d="M12 15.5v-2.2" ${S}/>
      <path d="M7.2 5.4 11 8.2l-3.8 2.8Zm9.6 0L13 8.2l3.8 2.8Z" ${A}/>
      <rect x="10.6" y="6.8" width="2.8" height="2.8" rx=".8" ${S}/>`,
  };

  /*
   * Symbole INNERHALB der Spiele (Edelstein, Bombe, Ei, Totenkopf). Emoji
   * sahen dort auf jedem Geraet anders aus und poppten beim Aufdecken einfach
   * auf; gezeichnet lassen sie sich faerben, glaenzen und mit dem Feld
   * zusammen umdrehen.
   */
  const SPIEL = {
    edelstein: `<path d="M7.4 3h9.2l4.4 6-9 12-9-12Z" fill="url(#gemV)" stroke="#bff5d0" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M7.4 3 12 9l4.6-6M3 9h18M12 9v12" stroke="rgba(255,255,255,.6)" stroke-width=".9" fill="none"/>
      <defs><linearGradient id="gemV" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8ef7c0"/><stop offset=".5" stop-color="#2fd18a"/><stop offset="1" stop-color="#0e8f5c"/>
      </linearGradient></defs>`,

    bombe: `<circle cx="11" cy="14.5" r="6.6" fill="#2a2f38" stroke="#12151a" stroke-width="1.1"/>
      <path d="M8.4 12.2a3.6 3.6 0 0 1 2.3-2" stroke="rgba(255,255,255,.55)" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M14.6 9.4 16.4 7" stroke="#8a5a2b" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M16.4 7c1.3-1.2 3-1.1 3.9.2" stroke="#c8862f" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <circle cx="20.6" cy="7.6" r="1.7" fill="#ffb347"/>
      <circle cx="20.6" cy="7.6" r=".8" fill="#fff3c4"/>`,

    ei: `<path d="M12 3.2c3.2 0 5.8 4.6 5.8 8.6a5.8 5.8 0 0 1-11.6 0c0-4 2.6-8.6 5.8-8.6Z" fill="url(#eiV)" stroke="#bff5d0" stroke-width="1.1"/>
      <path d="M9.2 9.4c.3-1.6 1-3 1.9-3.9" stroke="rgba(255,255,255,.65)" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <defs><linearGradient id="eiV" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a8f7cd"/><stop offset="1" stop-color="#1e9f68"/>
      </linearGradient></defs>`,

    totenkopf: `<path d="M12 2.8c4.4 0 7.3 3 7.3 7 0 2.5-1.1 4-2.4 5v2.1a1.6 1.6 0 0 1-1.6 1.6H8.7a1.6 1.6 0 0 1-1.6-1.6v-2.1c-1.3-1-2.4-2.5-2.4-5 0-4 2.9-7 7.3-7Z"
        fill="#e8e6e1" stroke="#9a978f" stroke-width="1"/>
      <ellipse cx="9.1" cy="10.2" rx="2.05" ry="2.35" fill="#1b1d22"/>
      <ellipse cx="14.9" cy="10.2" rx="2.05" ry="2.35" fill="#1b1d22"/>
      <path d="M12 13.4l-1 2h2Z" fill="#1b1d22"/>
      <path d="M9.4 18.5v2.1M12 18.5v2.1M14.6 18.5v2.1" stroke="#9a978f" stroke-width="1.3" stroke-linecap="round"/>`,
  };

  /** Symbol aus einem Spiel (Edelstein, Bombe, …), fertig als SVG. */
  function spielSymbol(id) {
    const d = SPIEL[id];
    return d ? `<svg class="sp-icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>` : "";
  }

  /** Fertiges SVG fuer eine Spielkennung, oder null. */
  function icon(id) {
    const d = ICONS[id];
    if (!d) return null;
    return `<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"
      stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }

  Casino.icons = { icon, has: (id) => !!ICONS[id], spielSymbol };
})();
