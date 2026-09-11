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
    // Zwei Karten hintereinander, die obere zeigt Pfeile hoch/tief.
    hilo: `<rect x="3.2" y="5.6" width="11" height="14.5" rx="2" ${S} opacity=".45" transform="rotate(-9 8.7 12.8)"/>
      <rect x="9.5" y="4.2" width="11.3" height="15.6" rx="2" ${S}/>
      <path d="M15.2 8.4v7.6" ${S} opacity=".7"/>
      <path d="M13.3 10.1l1.9-1.9 1.9 1.9" ${A} stroke="none"/>
      <path d="M17.1 14.3l-1.9 1.9-1.9-1.9" ${S}/>`,
    // Zwei Wuerfel: Kniffel geht gegeneinander.
    kniffel: `<rect x="2.6" y="8.4" width="11" height="11" rx="2.2" ${S}/>
      <circle cx="5.9" cy="11.7" r="1" ${A}/><circle cx="10.3" cy="16.1" r="1" ${A}/>
      <circle cx="8.1" cy="13.9" r="1" ${A}/>
      <rect x="11.4" y="3.4" width="10.2" height="10.2" rx="2" ${S} opacity=".75"/>
      <circle cx="14.4" cy="6.4" r=".95" ${A}/><circle cx="18.6" cy="6.4" r=".95" ${A}/>
      <circle cx="14.4" cy="10.6" r=".95" ${A}/><circle cx="18.6" cy="10.6" r=".95" ${A}/>`,
    // Ein Wuerfel in Schraegsicht mit fuenf Augen.
    wuerfel: `<rect x="3.5" y="6" width="12.5" height="12.5" rx="2.5" ${S}/>
      <circle cx="7" cy="9.5" r="1.05" ${A}/><circle cx="12.5" cy="9.5" r="1.05" ${A}/>
      <circle cx="9.75" cy="12.25" r="1.05" ${A}/>
      <circle cx="7" cy="15" r="1.05" ${A}/><circle cx="12.5" cy="15" r="1.05" ${A}/>
      <path d="M16 6.2l3.9-1.7a1.6 1.6 0 0 1 2.2 1.5v9.4a1.6 1.6 0 0 1-1 1.5L16 18.5" ${S} opacity=".5"/>`,
    // Los mit gezackter Kante und angekreuzten Zahlen.
    lotterie: `<path d="M3.5 6.5h17v4a1.7 1.7 0 0 0 0 3.4v3.6h-17v-3.6a1.7 1.7 0 0 0 0-3.4z" ${S}/>
      <circle cx="8" cy="10" r="1.5" ${A}/><circle cx="12" cy="10" r="1.5" ${S} opacity=".55"/>
      <circle cx="16" cy="10" r="1.5" ${A}/>
      <path d="M6.5 14.5h11" ${S} opacity=".45"/>`,
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

    // Nagelbrett mit fallendem Ball und Faechern unten, das, was das Spiel
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
   * Symbole innerhalb der Spiele (Edelstein, Bombe, Ei, Totenkopf). Emoji
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


  /*
   * Symbole fuer die Oberflaeche selbst: Menue, Kopfzeile, Bedienknoepfe.
   *
   * Die Spielkacheln hatten ihre gezeichneten Symbole schon, das Menue
   * daneben stand weiter auf Emoji. Das faellt genau da auf, wo beides
   * nebeneinander liegt: in der Lobby zeigt die Kachel eine Strichzeichnung
   * im Spielton, der Knopf oben rechts ein buntes 🎁. Emoji bringen ihre
   * eigene Farbe mit, also stimmen sie hoechstens in einem der drei Designs.
   *
   * Gleiches Raster wie die Spielsymbole: 24x24, Strichstaerke 1,75, Farbe
   * ueber currentColor. Wer eine Akzentflaeche will, nimmt A.
   */
  const UI = {
    // --- Menue: Fortschritt ---
    // Paket mit Schleife.
    geschenk: `<rect x="3" y="8.5" width="18" height="12.5" rx="1.8" ${S}/>
      <path d="M3 12.5h18" ${S}/>
      <path d="M12 8.5V21" ${S}/>
      <path d="M12 8.5C10.4 8.5 7.6 8.2 7.6 6.1A2.1 2.1 0 0 1 12 5.4a2.1 2.1 0 0 1 4.4.7c0 2.1-2.8 2.4-4.4 2.4Z" ${A}/>`,

    // Zielscheibe mit Pfeil in der Mitte.
    quests: `<circle cx="11" cy="13" r="8.2" ${S}/>
      <circle cx="11" cy="13" r="4.6" ${S} opacity=".55"/>
      <circle cx="11" cy="13" r="1.5" ${A}/>
      <path d="m14.4 9.6 5.4-5.4M17.4 4.2h2.4v2.4" ${S}/>`,

    // Eintrittskarte mit abgerissener Kante.
    season: `<path d="M3 7.4a1.4 1.4 0 0 1 1.4-1.4h15.2A1.4 1.4 0 0 1 21 7.4v2.4a2.2 2.2 0 0 0 0 4.4v2.4a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 16.6v-2.4a2.2 2.2 0 0 0 0-4.4Z" ${S}/>
      <path d="M14.2 6v2M14.2 11v2M14.2 16v2" ${S} opacity=".6"/>
      <circle cx="8.6" cy="12" r="1.6" ${A}/>`,

    // Kalenderblatt mit markiertem Tag.
    kalender: `<rect x="3" y="5" width="18" height="16" rx="2.2" ${S}/>
      <path d="M3 9.6h18" ${S}/>
      <path d="M8 3v4M16 3v4" ${S}/>
      <rect x="6.4" y="12.4" width="3.4" height="3.2" rx=".8" ${A}/>
      <path d="M12.8 13.8h4.8M12.8 17.4h4.8M6.6 17.4h2.6" ${S} opacity=".5"/>`,

    // Gluecksrad: Kranz, Speichen, Zeiger.
    gluecksrad: `<circle cx="12" cy="13" r="8.2" ${S}/>
      <path d="M12 4.8v16.4M3.8 13h16.4M6.2 7.2l11.6 11.6M17.8 7.2 6.2 18.8" ${S} opacity=".45"/>
      <circle cx="12" cy="13" r="1.6" ${A}/>
      <path d="M12 1.8 10.2 5h3.6Z" ${A}/>`,

    // Siegertreppchen: sagt "Rangliste", nicht nur "Preis".
    bestenliste: `<path d="M2.5 21h19" ${S}/>
      <rect x="9" y="7.5" width="6" height="13.5" rx=".9" ${A}/>
      <rect x="2.8" y="12" width="6.2" height="9" rx=".9" ${S}/>
      <rect x="15" y="10" width="6.2" height="11" rx=".9" ${S}/>
      <path d="M12 3 12.9 5l2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L9 5.3 11.1 5Z" ${S}/>`,

    // Balken mit Trendlinie.
    statistik: `<path d="M3.5 20.5h17" ${S}/>
      <rect x="4.6" y="13" width="3.4" height="7.5" rx=".8" ${S}/>
      <rect x="10.3" y="9" width="3.4" height="11.5" rx=".8" ${A}/>
      <rect x="16" y="5" width="3.4" height="15.5" rx=".8" ${S}/>
      <path d="M4.8 10.4 9.4 6.6l3.6 2.2 5.4-4.6" ${S} stroke-width="1.4" opacity=".55"/>`,

    // --- Menue: Miteinander ---
    // Wappenschild mit Zeichen.
    clans: `<path d="M12 2.6 20 5.4v6.1c0 4.6-3.2 8.2-8 9.9-4.8-1.7-8-5.3-8-9.9V5.4Z" ${S}/>
      <path d="M12 7.4 13.4 10.5l3.2.3-2.4 2.2.7 3.2-2.9-1.7-2.9 1.7.7-3.2-2.4-2.2 3.2-.3Z" ${A}/>`,

    // Muenze wandert von einer Hand zur anderen.
    transfer: `<circle cx="7" cy="8" r="3.6" ${S}/>
      <path d="M5.6 8h2.8M7 6.6v2.8" ${S} stroke-width="1.4"/>
      <circle cx="17" cy="8" r="3.6" ${A} opacity=".85"/>
      <path d="M4.4 20.4c0-2.4 2.1-4 4.6-4M14.6 20.4c0-2.4 2.1-4 4.6-4" ${S}/>
      <path d="M9.4 14.4h5.2m-1.6-1.8 1.8 1.8-1.8 1.8" ${S}/>`,

    // --- Menue: Das Casino ---
    // Aufgerollte Urkunde.
    updates: `<path d="M6.4 3h11.2a1.8 1.8 0 0 1 1.8 1.8v14.4a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V4.8A1.8 1.8 0 0 1 6.4 3Z" ${S}/>
      <path d="M8 7.6h8M8 11.2h8M8 14.8h5" ${S} opacity=".55"/>
      <circle cx="16.4" cy="16.4" r="1.5" ${A}/>`,

    // Kompassrose mit Nadel.
    rundgang: `<circle cx="12" cy="12" r="9" ${S}/>
      <path d="m15.4 8.6-2 5.4-5.4 2 2-5.4Z" ${A}/>
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21" ${S} opacity=".5"/>`,

    // Gluehbirne mit Sockel.
    vorschlaege: `<path d="M12 2.8a6.4 6.4 0 0 1 3.9 11.5c-.6.5-.9 1-.9 1.7v.4H9v-.4c0-.7-.3-1.2-.9-1.7A6.4 6.4 0 0 1 12 2.8Z" ${S}/>
      <path d="M9.6 18.6h4.8M10.4 21h3.2" ${S}/>
      <path d="M10.4 9.4a2.4 2.4 0 0 1 3.2 0" ${A} stroke="hsl(var(--h,45) 70% 62%)" fill="none" stroke-width="1.6" stroke-linecap="round"/>`,

    // --- Menue: Du ---
    // Kopf und Schultern.
    profil: `<circle cx="12" cy="8.4" r="4.1" ${S}/>
      <path d="M4.4 21c0-4 3.4-6.6 7.6-6.6s7.6 2.6 7.6 6.6" ${S}/>`,

    // Palette mit Farbklecksen: Kosmetik ist Aussehen.
    kosmetik: `<path d="M12 3.2c5 0 8.8 3.4 8.8 7.8 0 2.6-2 3.6-3.8 3.6h-1.6c-1.2 0-2 .8-2 1.8 0 .5.2.9.4 1.3.3.4.4.8.4 1.2 0 1-.8 1.9-2.2 1.9-4.9 0-8.8-3.9-8.8-8.8S7.1 3.2 12 3.2Z" ${S}/>
      <circle cx="8.2" cy="9.4" r="1.25" ${A}/>
      <circle cx="12.6" cy="7.4" r="1.25" fill="currentColor" opacity=".55"/>
      <circle cx="16.4" cy="10" r="1.25" ${A}/>`,

    // Zahnrad.
    einstellungen: `<circle cx="12" cy="12" r="3.2" ${A}/>
      <path d="M12 2.6l1.5 2.3 2.7-.6.5 2.7 2.6 1-1.2 2.5 1.8 2.1-2.2 1.7.5 2.7-2.7.2-1.2 2.5-2.3-1.5-2.3 1.5-1.2-2.5-2.7-.2.5-2.7-2.2-1.7 1.8-2.1L4.7 8l2.6-1 .5-2.7 2.7.6Z" ${S}/>`,

    // Schieberegler: Verwaltung, nicht Schraubenschluessel.
    admin: `<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3" ${S}/>
      <circle cx="15" cy="7" r="2.1" ${A}/>
      <circle cx="9" cy="12" r="2.1" ${S}/>
      <circle cx="15" cy="17" r="2.1" ${S}/>`,

    // --- Kopfzeile ---
    // Spielmarke von oben: Rand mit Kerben, Ring, Mitte.
    chip: `<circle cx="12" cy="12" r="9" ${S}/>
      <circle cx="12" cy="12" r="5.4" ${S} opacity=".6"/>
      <circle cx="12" cy="12" r="2.4" ${A}/>
      <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" ${S} stroke-width="2"/>`,

    // Marke des Hauses: Torbogen mit Spielmarke.
    marke: `<path d="M3.2 20.4h17.6" ${S}/>
      <path d="M5 20.4V10.4a7 7 0 0 1 14 0v10" ${S}/>
      <circle cx="12" cy="10.6" r="2.9" ${A}/>
      <path d="M8.4 20.4v-4.2M15.6 20.4v-4.2" ${S} opacity=".5"/>`,

    // Drei Striche. Als Zeichnung statt als Schriftzeichen, damit sie in
    // jeder Schrift gleich dick und gleich breit sind.
    menue: `<path d="M4 7h16M4 12h16M4 17h16" ${S} stroke-width="2"/>`,

    // --- Bedienknoepfe ---
    schliessen: `<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" ${S} stroke-width="2"/>`,

    aktualisieren: `<path d="M20 12a8 8 0 1 1-2.6-5.9" ${S}/>
      <path d="M20.4 3.6v4.2h-4.2" ${S}/>`,

    senden: `<path d="M3.4 11.6 20.6 4l-7.6 17.2-2-7.4Z" ${S}/>
      <path d="m11 14 3.4-3.4" ${S}/>`,

    chat: `<path d="M4.2 4.6h15.6a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H9.4L5 21v-4H4.2a1.6 1.6 0 0 1-1.6-1.6V6.2a1.6 1.6 0 0 1 1.6-1.6Z" ${S}/>
      <path d="M7.4 9.4h9.2M7.4 12.8h5.8" ${S} opacity=".55"/>`,

    // Megafon: Mitspieler rufen.
    rufen: `<path d="M4 9.4h3.2L14.6 5v14l-7.4-4.4H4a1.4 1.4 0 0 1-1.4-1.4v-2.4A1.4 1.4 0 0 1 4 9.4Z" ${S}/>
      <path d="M17.6 9.2a4.2 4.2 0 0 1 0 5.6" ${S}/>
      <path d="M6.6 14.6V19h3" ${S} opacity=".6"/>`,

    // Stift.
    bearbeiten: `<path d="M4 20h4.2l10-10a2.4 2.4 0 0 0-3.4-3.4l-10 10Z" ${S}/>
      <path d="m13.6 7.4 3.4 3.4" ${S}/>`,

    // Haken und Kreuz: Anfragen annehmen/ablehnen.
    ja: `<path d="M4.6 12.6 9.8 17.8 19.4 6.8" ${S} stroke-width="2.2"/>`,
    nein: `<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" ${S} stroke-width="2.2"/>`,

    // Krone: Gruender.
    krone: `<path d="M3.4 8.2 7 12.4l5-7.4 5 7.4 3.6-4.2-1.6 10.6H5Z" ${A}/>
      <path d="M5 19.6h14" ${S}/>`,

    // Stern: Offizier. Voll und leer, fuer Rang und fuer Favoriten.
    stern: `<path d="M12 3.4 14.7 9l6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9 9.3 9Z" ${S}/>`,
    "stern-voll": `<path d="M12 3.4 14.7 9l6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9 9.3 9Z" ${A} stroke="hsl(var(--h,45) 70% 62%)" stroke-width="1.4" stroke-linejoin="round"/>`,

    // Person mit Pfeil hoch / runter: befoerdern und degradieren.
    // Beide brauchten bisher einen Tooltip, um verstanden zu werden; auf dem
    // iPad gibt es keinen.
    befoerdern: `<circle cx="9.4" cy="8" r="3.6" ${S}/>
      <path d="M2.8 20.4c0-3.5 2.9-5.8 6.6-5.8 1 0 1.9.2 2.8.5" ${S}/>
      <path d="M18 20.2v-7.4M15 15.6l3-3 3 3" ${A} stroke="hsl(var(--h,45) 70% 62%)" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
    degradieren: `<circle cx="9.4" cy="8" r="3.6" ${S}/>
      <path d="M2.8 20.4c0-3.5 2.9-5.8 6.6-5.8 1 0 1.9.2 2.8.5" ${S}/>
      <path d="M18 12.8v7.4M15 17.4l3 3 3-3" ${S} stroke-width="1.9"/>`,

    // Person mit Kreuz: rauswerfen. Die gefaehrlichste Schaltflaeche im
    // Clan stand vorher als nacktes 🚫 neben einem nackten ⬇️.
    kicken: `<circle cx="9.4" cy="8" r="3.6" ${S}/>
      <path d="M2.8 20.4c0-3.5 2.9-5.8 6.6-5.8 1 0 1.9.2 2.8.5" ${S}/>
      <path d="M15.6 14.4 21 19.8M21 14.4l-5.4 5.4" ${S} stroke-width="1.9"/>`,

    // Schloss: geschlossener Clan.
    sperre: `<rect x="4.6" y="10.4" width="14.8" height="10.4" rx="2.2" ${S}/>
      <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" ${S}/>
      <circle cx="12" cy="15.6" r="1.6" ${A}/>`,

    // Schatzkammer: Truhe mit Beschlag.
    schatzkammer: `<path d="M3.4 10.6a3 3 0 0 1 3-3h11.2a3 3 0 0 1 3 3v8.2a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z" ${S}/>
      <path d="M3.4 13.4h17.2" ${S}/>
      <rect x="10.4" y="11.4" width="3.2" height="4.4" rx="1" ${A}/>`,

    /* Gekreuzte Klingen: Clan-Krieg. Zwei blosse Striche ergaben bei
       zwanzig Pixeln ein X und sonst nichts; erst Spitze, Parierstange und
       Griff machen daraus ein Schwert. */
    krieg: `<path d="M3.4 3.2h3.2l9 9-3.2 3.2-9-9Z" ${S}/>
      <path d="M20.6 3.2h-3.2l-9 9 3.2 3.2 9-9Z" ${S}/>
      <path d="m6.6 15.4 2 2-3 3-2-2Z" ${A}/>
      <path d="m17.4 15.4-2 2 3 3 2-2Z" ${A}/>
      <path d="M13.8 13.2 17 16.4M10.2 13.2 7 16.4" ${S} stroke-width="1.5" opacity=".6"/>`,

    // Lautsprecher: Ansage des Hauses.
    ansage: `<path d="M3.4 9.6h3.4l6.4-4.2v13.2l-6.4-4.2H3.4a1.2 1.2 0 0 1-1.2-1.2v-2.4a1.2 1.2 0 0 1 1.2-1.2Z" ${A}/>
      <path d="M16.6 8.6a5 5 0 0 1 0 6.8M19.4 6a8.4 8.4 0 0 1 0 12" ${S}/>`,

    // Sprossen mit Pfeil: Level und Aufstieg.
    level: `<path d="M3.4 20.6h17.2" ${S}/>
      <rect x="4.4" y="14" width="4.2" height="6.6" rx=".9" ${S}/>
      <rect x="9.9" y="10" width="4.2" height="10.6" rx=".9" ${S}/>
      <rect x="15.4" y="5.6" width="4.2" height="15" rx=".9" ${A}/>`,

    // Spieltisch mit zwei Plaetzen: offene Lobbys warten auf Mitspieler.
    "poker-tisch": `<ellipse cx="12" cy="12" rx="9.2" ry="6.2" ${S}/>
      <ellipse cx="12" cy="12" rx="5.4" ry="3.2" ${S} opacity=".45"/>
      <circle cx="4.2" cy="7.4" r="1.8" ${A}/>
      <circle cx="19.8" cy="16.6" r="1.8" ${S}/>`,

    // Sendemast: was gerade im Haus passiert.
    feed: `<circle cx="12" cy="16.4" r="2.2" ${A}/>
      <path d="M8.4 12.8a5 5 0 0 1 7.2 0" ${S}/>
      <path d="M5.6 9.8a9 9 0 0 1 12.8 0" ${S} opacity=".7"/>
      <path d="M2.9 6.8a12.8 12.8 0 0 1 18.2 0" ${S} opacity=".45"/>
      <path d="M12 18.6V21" ${S}/>`,

    // --- Spielhandlungen ---
    // Zwei Koepfe: Lobby, Duell, Mitspieler.
    gruppe: `<circle cx="8.6" cy="8.4" r="3.4" ${S}/>
      <path d="M2.6 20c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4" ${S}/>
      <circle cx="16.6" cy="7.6" r="2.6" ${A} opacity=".85"/>
      <path d="M15 14.9c2.9-.5 6.4 1 6.4 4.4" ${S} opacity=".7"/>`,

    // Weisse Fahne: aufgeben.
    flagge: `<path d="M6 21V3.4" ${S} stroke-width="2"/>
      <path d="M6 4.2h11.4l-2.2 3.9 2.2 3.9H6Z" ${A}/>`,

    // Zielflagge: Rennen.
    ziel: `<path d="M5.4 21V3.4" ${S} stroke-width="2"/>
      <path d="M5.4 4.2h13.2v8.4H5.4Z" ${S}/>
      <path d="M5.4 4.2h4.4v2.8h4.4v2.8h4.4M9.8 7v2.8H5.4M14.2 4.2v2.8M14.2 9.8v2.8" ${S} stroke-width="1.3" opacity=".65"/>`,

    // Auktionshammer auf dem Klangblock: Auktionshaus.
    auktion: `<path d="M4.2 20.4h9.2" ${S} stroke-width="2"/>
      <rect x="5" y="16.8" width="7.6" height="2.2" rx="0.8" ${A}/>
      <path d="M9.6 16.8 15 9.6" ${S} stroke-width="1.8"/>
      <rect x="13.2" y="4.2" width="7.2" height="4.4" rx="1.2" transform="rotate(37 16.8 6.4)" ${A}/>`,

    // Einkaufswagen: Markt.
    warenkorb: `<path d="M2.6 3.4h2.6l2.4 11.2h9.8l2-7.6H6.4" ${S}/>
      <circle cx="9.4" cy="19.4" r="1.7" ${A}/>
      <circle cx="17" cy="19.4" r="1.7" ${A}/>`,

    // Blitz: Sprint, Tempo.
    blitz: `<path d="M13.6 2.4 5.6 13.4h5.2l-1.4 8.2 8.2-11.2h-5.2Z" ${A}/>`,

    // Pfeil nach oben in einem Kasten: aufwerten.
    aufwerten: `<path d="M12 20.4V6.4M6.6 11.8 12 6.4l5.4 5.4" ${S} stroke-width="2"/>
      <path d="M4.6 3.4h14.8" ${A} stroke="hsl(var(--h,45) 70% 62%)" fill="none" stroke-width="2.4" stroke-linecap="round"/>`,

    // Aufprall: knacken, draufhauen.
    schlag: `<path d="M12 2.4 14 8l5.8-2.2-3 5.4 5.2 3.2-6.1.7 1.4 5.9-4.9-3.9-4.9 3.9 1.4-5.9-6.1-.7 5.2-3.2-3-5.4L10 8Z" ${A}/>`,

    // Signalleuchte: Heist, Alarm.
    alarm: `<path d="M6.4 15.4a5.6 5.6 0 0 1 11.2 0Z" ${A}/>
      <path d="M4 15.4h16M6.6 18.6h10.8" ${S} stroke-width="2"/>
      <path d="M12 3.4v3M5.6 6.4l2 2M18.4 6.4l-2 2" ${S} opacity=".65"/>`,

    // Fragezeichen im Kreis: Quiz.
    frage: `<circle cx="12" cy="12" r="9" ${S}/>
      <path d="M9.4 9.4a2.7 2.7 0 0 1 5.3.6c0 1.8-2.6 2.1-2.6 3.9" ${S}/>
      <circle cx="12.1" cy="17.2" r="1.15" ${A}/>`,

    // Diskette: sichern.
    speichern: `<path d="M4.4 3.4h11.8L20.6 7.8v12.8H4.4Z" ${S}/>
      <path d="M8 3.4v5.2h7.4V3.4" ${S}/>
      <rect x="7.4" y="12.6" width="9.2" height="8" rx="1" ${A}/>`,

    // Hand mit Muenze: auszahlen, kassieren.
    auszahlen: `<circle cx="12" cy="6.6" r="3.6" ${A}/>
      <path d="M3.4 20.6c0-3.4 3-5.8 6.4-5.8h4.4c3.4 0 6.4 2.4 6.4 5.8" ${S}/>
      <path d="M12 13v3.4M10.4 14.6h3.2" ${S} stroke-width="1.4" opacity=".7"/>`,

    // Wuerfel: Zufall.
    wuerfel: `<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.4" ${S}/>
      <circle cx="8.4" cy="8.4" r="1.5" ${A}/>
      <circle cx="15.6" cy="15.6" r="1.5" ${A}/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" opacity=".65"/>`,

    // Doppelpfeil: vorspulen, automatisch weiterlaufen lassen.
    vor: `<path d="M4 5.4 12 12l-8 6.6ZM12.4 5.4 20.4 12l-8 6.6Z" ${S}/>`,

    // --- Werte eines Rennpferds ---
    // Herzschlag: Ausdauer.
    ausdauer: `<path d="M2.6 12.6h4l1.8-4.4 3 9.6 2.6-7 1.6 3.4h5.8" ${S} stroke-width="2"/>
      <circle cx="20.4" cy="14.2" r="1.4" ${A}/>`,

    // Hantel: Kondition und Training.
    kondition: `<path d="M3.4 9.4v5.2M6.4 7.4v9.2M17.6 7.4v9.2M20.6 9.4v5.2" ${S} stroke-width="2"/>
      <path d="M6.4 12h11.2" ${A} stroke="hsl(var(--h,45) 70% 62%)" fill="none" stroke-width="2.6" stroke-linecap="round"/>`,

    // Waage: gleichmaessige Taktik.
    waage: `<path d="M12 3.4v17.2M7.4 20.6h9.2" ${S}/>
      <path d="M4 8.2h16" ${S}/>
      <path d="M4 8.2 1.8 14h4.4ZM20 8.2 17.8 14h4.4Z" ${A}/>
      <circle cx="12" cy="8.2" r="1.4" ${S}/>`,

    // Laufende Figur: Frontrunner.
    laeufer: `<circle cx="14.6" cy="4.6" r="2.1" ${A}/>
      <path d="M8.4 20.6l2.6-4.6-2-3.4 1.6-4 3.4-1 3 2.4 2.6 1" ${S}/>
      <path d="M11 12.6 7 11.4l-2.6 2.4M13 16l2.4 1.4 1 3.2" ${S}/>`,

    // --- Rangstufen ---
    // Sechs Stufen vom Neuling zur Ikone. Vorher 🌱🎲🎯🦈🌟👑, sechs
    // Bildchen aus sechs verschiedenen Welten, die nebeneinander keine
    // Reihe ergaben. Gezeichnet steigern sie sich sichtbar.
    neuling: `<path d="M12 20.6v-7.2" ${S}/>
      <path d="M12 13.4C12 9.8 9.2 7 5.6 7c0 3.6 2.8 6.4 6.4 6.4Z" ${A}/>
      <path d="M12 11.8c0-3 2.4-5.4 5.4-5.4 0 3-2.4 5.4-5.4 5.4Z" ${S}/>`,

    stammgast: `<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.4" ${S}/>
      <circle cx="8.4" cy="8.4" r="1.5" ${A}/>
      <circle cx="15.6" cy="15.6" r="1.5" ${A}/>
      <circle cx="8.4" cy="15.6" r="1.5" fill="currentColor" opacity=".6"/>
      <circle cx="15.6" cy="8.4" r="1.5" fill="currentColor" opacity=".6"/>`,

    profi: `<circle cx="12" cy="12" r="8.6" ${S}/>
      <circle cx="12" cy="12" r="5" ${S} opacity=".6"/>
      <circle cx="12" cy="12" r="1.8" ${A}/>`,

    // Rueckenflosse ueber der Wasserlinie. Mehr braucht ein Hai nicht.
    hai: `<path d="M12 3.4c3.4 2.6 5.6 6.6 6.4 11.6h-9.6c.4-4.4 1.4-8.2 3.2-11.6Z" ${A}/>
      <path d="M2.6 17.6c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6" ${S}/>`,

    legende: `<path d="M12 2.4 14.9 8.4l6.6.9-4.8 4.6 1.2 6.5L12 17.3l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9Z" ${A}/>
      <path d="M18.8 3.4v2.8M20.2 4.8h-2.8M5.2 17.8v2.4M6.4 19h-2.4" ${S} stroke-width="1.4" opacity=".7"/>`,

    ikone: `<path d="M3.4 8.2 7 12.4l5-7.4 5 7.4 3.6-4.2-1.6 10.6H5Z" ${A}/>
      <path d="M5 19.6h14" ${S}/>
      <circle cx="12" cy="3.2" r="1.2" ${S}/>`,

    // Sanduhr: laufende Wartezeit. Das ⏳ davor war auf jedem Geraet
    // ein anderes Bild und in halben Zeilenhoehen mal oben, mal unten.
    uhr: `<path d="M6.4 3h11.2M6.4 21h11.2" ${S} stroke-width="2"/>
      <path d="M7.6 3v3.4c0 2 1.5 3.6 3.2 4.6v1.8c-1.7 1-3.2 2.6-3.2 4.6V21M16.4 3v3.4c0 2-1.5 3.6-3.2 4.6v1.8c1.7 1 3.2 2.6 3.2 4.6V21" ${S}/>
      <path d="M9.6 18.4c0-1.4 1-2.4 2.4-2.4s2.4 1 2.4 2.4Z" ${A}/>`,

    // Notfall-Ring: Soforthilfe bei Pleite.
    hilfe: `<circle cx="12" cy="12" r="8.6" ${S}/>
      <circle cx="12" cy="12" r="3.8" ${S} opacity=".55"/>
      <path d="M12 3.4v4.8M12 15.8v4.8M3.4 12h4.8M15.8 12h4.8" ${A} stroke="hsl(var(--h,45) 70% 62%)" fill="none" stroke-width="2"/>`,
  };

  /**
   * Symbol fuer die Oberflaeche. Gleiche Groesse wie die Spielsymbole,
   * aber eigene Klasse, damit Menue und Kopfzeile sie getrennt vom
   * Kachel-Symbol massschneidern koennen.
   */
  function ui(id, klasse) {
    /* Faellt auf die Spielsymbole zurueck. "Turm starten" will den Turm aus
       der Spielkachel und kein zweites, aehnliches Bild daneben. Dasselbe
       Spiel soll ueberall dasselbe Zeichen tragen. */
    const d = UI[id] || ICONS[id];
    if (!d) return "";
    return `<svg class="ui-icon${klasse ? " " + klasse : ""}" viewBox="0 0 24 24" aria-hidden="true"
      stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }

  /** Fertiges SVG fuer eine Spielkennung, oder null. */
  function icon(id) {
    const d = ICONS[id];
    if (!d) return null;
    return `<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true"
      stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }

  /*
   * Chip-Betraege.
   *
   * Hinter jeder Zahl im Haus stand ein 🪙. An ueber dreihundert Stellen.
   * Das Emoji ist auf jedem Geraet ein anderes Bild, meistens ein gelber
   * Kreis mit Praegung, und es sitzt zu tief in der Zeile. Neben einer
   * Zahl in der Rundschrift sah es aus wie ein Tippfehler.
   *
   * `betrag(n)` schreibt die Zahl deutsch und haengt die gezeichnete
   * Spielmarke an. Sie erbt die Textfarbe, laeuft also in Gruen mit, wenn
   * der Betrag ein Gewinn ist, und in Rot, wenn er einer abgeht.
   *
   * Wichtig: das Ergebnis ist HTML. Wo nur Text hingehoert (Toast,
   * Chat-Ansage, `textContent`) nimmt man `betragText`, das die Marke
   * durch das Wort "Chips" ersetzt.
   */
  const MARKE = `<svg class="chip-mark" viewBox="0 0 24 24" aria-hidden="true"
    stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4" opacity=".65"/>
    <path d="M12 3.6v2.4M12 18v2.4M3.6 12H6M18 12h2.4"/></svg>`;

  const zahl = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

  /** Betrag mit gezeichneter Spielmarke. Ergibt HTML. */
  function betrag(n) {
    return `<span class="betrag">${zahl(n)}${MARKE}</span>`;
  }

  /** Betrag mit Vorzeichen: Gewinne gruen, Verluste rot. Ergibt HTML. */
  function betragDelta(n) {
    const v = Number(n) || 0;
    const kl = v > 0 ? "pos" : v < 0 ? "neg" : "";
    const vz = v > 0 ? "+" : v < 0 ? "\u2212" : "";
    return `<span class="betrag ${kl}">${vz}${zahl(Math.abs(v))}${MARKE}</span>`;
  }

  /**
   * Rangzeichen zu einer Level-Info des Servers.
   *
   * Der Server schickt `rang` ("neuling" … "ikone"). Aeltere Spielstaende
   * und Nachrichten, die vor dieser Umstellung entstanden sind, haben nur
   * `emoji`; dann faellt es auf die unterste Stufe zurueck, statt eine
   * Luecke zu lassen.
   */
  function rangZeichen(lvl) {
    return ui((lvl && lvl.rang) || "neuling");
  }

  /**
   * Ein Symbol als SVG-Gruppe, zum Einsetzen in eine bestehende Zeichnung.
   *
   * Die Stadtkarte ist ein einziges grosses SVG. Ihre Marker standen bisher
   * als Emoji in `<text>`-Elementen, dort geht kein HTML, also half weder
   * `ui()` noch die Marken-Klasse. Diese Fassung liefert stattdessen eine
   * verschobene und skalierte `<g>`, die sich wie jedes andere Kartenteil
   * einfuegt.
   *
   * @param {string} id     Kennung aus UI oder ICONS.
   * @param {number} x      Mittelpunkt in Karten-Koordinaten.
   * @param {number} y      Mittelpunkt in Karten-Koordinaten.
   * @param {number} groesse Kantenlaenge; das Raster ist 24x24.
   * @param {string} [farbe] currentColor greift im fremden SVG nicht, also
   *                         wird die Farbe hier gesetzt.
   */
  function svgGruppe(id, x, y, groesse, farbe) {
    const d = UI[id] || ICONS[id];
    if (!d) return "";
    const f = groesse / 24;
    const inhalt = farbe ? d.replace(/currentColor/g, farbe) : d;
    return `<g transform="translate(${x - groesse / 2} ${y - groesse / 2}) scale(${f})"
      stroke-width="${1.75 / f > 3 ? 2.4 : 1.75}" stroke-linecap="round" stroke-linejoin="round"
      style="pointer-events:none">${inhalt}</g>`;
  }

  /**
   * Platzziffer fuer Ranglisten.
   *
   * Vorher stand an drei Stellen dieselbe Zeile `["🥇","🥈","🥉"]` und ab
   * Platz vier eine nackte "4.", drei Bildchen, dann Text, in drei
   * verschiedenen Groessen, und die Medaillen brachten ihre eigenen Gold-,
   * Silber- und Bronzetoene mit, die in Neon und Mitternacht falsch lagen.
   *
   * @param {number} i Nullbasierter Rang.
   */
  function platz(i) {
    const n = Number(i) || 0;
    return `<span class="platz${n < 3 ? " p" + (n + 1) : ""}">${n + 1}</span>`;
  }

  /** Betrag als reiner Text, fuer Toasts, Chat und textContent. */
  function betragText(n) {
    return `${zahl(n)} Chips`;
  }

  /*
   * Platzhalter im festen HTML fuellen.
   *
   * In index.html steht nur `<i data-icon="clans">`. Die Zeichnung kommt von
   * hier, damit die Pfade an einer Stelle liegen und nicht sechzehnmal im
   * Dokument. Wer Inhalte selbst zusammenbaut, ruft `ui()` direkt im
   * Template auf und braucht das hier nicht.
   */
  function zeichne(wurzel) {
    const ziel = wurzel || document;
    ziel.querySelectorAll("[data-icon]").forEach((el) => {
      const svg = ui(el.dataset.icon);
      if (svg && el.innerHTML !== svg) el.innerHTML = svg;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => zeichne());
  } else {
    zeichne();
  }

  Casino.icons = { icon, has: (id) => !!ICONS[id], spielSymbol, ui, hatUi: (id) => !!(UI[id] || ICONS[id]), marke: () => MARKE, zeichne, rangZeichen, platz, svgGruppe };
  Casino.betrag = betrag;
  Casino.betragDelta = betragDelta;
  Casino.betragText = betragText;
})();
