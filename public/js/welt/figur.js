"use strict";

/*
 * Die Figur in drei Ansichten: von vorn, von hinten und von der Seite.
 *
 * Grundlage ist die Clubfigur aus core/player.js (dunkle Haare,
 * Bomberjacke, Sneaker, Chip in der Hand). Für die Welt musste sie sich
 * drehen und laufen können, und dafür ist sie in Teile zerlegt: Beine, Arme,
 * Rumpf und Kopf sind eigene Gruppen, die das CSS einzeln bewegt.
 *
 * Was man an ihr sieht, kommt aus dem, was jemand schon besitzt und angelegt
 * hat. Es gibt dafür keinen neuen Besitz und keine Umwandlung:
 *
 *   Namensstil     die Jacke (Farbe, bei manchen ein Muster)
 *   Namensfarbe    die Jacke, wenn kein Stil angelegt ist
 *   Rahmen         die Kopfbedeckung, jede mit eigener Form
 *   Chat-Zeichen   der Gegenstand in der Hand
 *   Aura           ein Schein am Boden
 *   Avatar         der Aufnäher auf der Brust
 *
 * Dazu kommt die Grundform (Haut, Haare, Frisur, Hose). Sie kostet nichts
 * und steht jedem vom ersten Abend an offen.
 *
 * Unbekannte Kennungen fallen auf die Grundausstattung zurück. Ein alter
 * Wert aus einer Nachricht darf nichts Fremdes ins Dokument schreiben,
 * dieselbe Regel wie bei den Stilen in core/player.js.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const HAUT = ["#f3cdae", "#dca77d", "#c68a5e", "#a86b45", "#7d4b30", "#573322"];
  const HAAR = ["#20302c", "#5b3a26", "#a8683a", "#dfbd6c", "#c3c6cf", "#c4588d", "#4169c9"];
  const HOSE = ["#22312f", "#2e4068", "#5a4632", "#1d1d23", "#80858d"];
  const FRISUREN = ["Kurz", "Scheitel", "Locken", "Zopf", "Lang"];
  const NAMEN = {
    haut: ["Hell", "Warm", "Oliv", "Bronze", "Dunkel", "Tief"],
    haar: ["Schwarz", "Braun", "Kupfer", "Blond", "Silber", "Pink", "Blau"],
    frisur: FRISUREN,
    hose: ["Waldgrün", "Jeans", "Cord", "Schwarz", "Grau"],
  };

  /* Jacke je Namensstil. Einige haben ein Muster statt einer Farbe; die
     Verläufe liegen einmal im Dokument (siehe defs unten). */
  const JACKE = {
    sonne: "#e2a144", eis: "#74b7d6", gift: "#8cb65b", beere: "#aa668c", puls: "#d4557a",
    schimmer: "#b9b1dd", neon: "#34d39a", feuer: "#ce6950", glitch: "#6a5acd", vanta: "#1d1e25",
    splitter: "#98a3b8", krone: "#d9b557", s2_bernstein: "#cf8b44", s2_phoenix: "#d56c43",
    rad_fortuna: "#d9b557", kiste_lack: "#b8323a", adm_zensiert: "#26262b", sml_glutkern: "#b5461f",
    hochspannung: "#e8c93a", gala_gravur: "#b29558", gala_rampenlicht: "#e6d3a3", staub_quecksilber: "#aab3bf",
    regenbogen: "url(#fg-regenbogen)", auk_hologramm: "url(#fg-hologramm)", aurora: "url(#fg-aurora)",
  };
  const JACKE_GRUND = "#5a9d91";

  const MUETZEN = new Set(["silber", "gold", "neon", "rotierend", "flamme", "sterne", "s2_wolf", "rad_fortuna",
    "adm_orbit", "uhrwerk", "kiste_sprung", "gala_kranz", "staub_zahnkranz"]);
  const HAND = new Set(["stern", "flagge", "ziel", "blitz", "edelstein", "krone", "bombe", "totenkopf", "auk_marke",
    "hai", "klingen", "tresor", "gala_konfetti", "gala_stern", "staub_siegel"]);
  const AUREN = new Set(["auk_goldstaub", "auk_leere", "kiste_funken", "adm_eklipse", "sml_nachtschwarm",
    "kiste_ringsystem", "gala_konfetti", "staub_sternenschmiede"]);

  const MUETZE_NAME = {
    silber: "Strickmütze", gold: "Krone", neon: "Neon-Kopfhörer", rotierend: "Propellermütze", flamme: "Flammenschopf",
    sterne: "Sternenkranz", s2_wolf: "Wolfskapuze", rad_fortuna: "Fortuna-Diadem", adm_orbit: "Orbitring",
    uhrwerk: "Uhrwerk-Zylinder", kiste_sprung: "Sprungfeder", gala_kranz: "Lorbeerkranz", staub_zahnkranz: "Zahnradkrone",
  };
  const HAND_NAME = {
    stern: "Sternstab", flagge: "Fähnchen", ziel: "Dartscheibe", blitz: "Blitzschild", edelstein: "Edelstein",
    krone: "Zepter", bombe: "Knallbombe", totenkopf: "Totenkopf", auk_marke: "Siegelstempel", hai: "Plüschhai",
    klingen: "Holzschwert", tresor: "Mini-Tresor", gala_konfetti: "Konfettikanone", gala_stern: "Wunderkerze",
    staub_siegel: "Siegelstempel",
  };

  function dunkler(hex, anteil = 0.28) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#1d2f2a";
    const n = parseInt(m[1], 16);
    const k = (v) => Math.max(0, Math.round(v * (1 - anteil)));
    return "#" + [k(n >> 16), k((n >> 8) & 255), k(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function farbenVon(p) {
    const g = (p && p.figur) || {};
    const wahl = (liste, i) => liste[Number.isInteger(i) && i >= 0 && i < liste.length ? i : 0];
    const stil = p && p.nameStyle && Object.prototype.hasOwnProperty.call(JACKE, p.nameStyle) ? p.nameStyle : null;
    const namensfarbe = p && /^#[0-9a-f]{6}$/i.test(p.nameColor || "") ? p.nameColor : null;
    const jacke = stil ? JACKE[stil] : (namensfarbe || JACKE_GRUND);
    const haut = wahl(HAUT, g.haut);
    return {
      haut, hautD: dunkler(haut, 0.2),
      haar: wahl(HAAR, g.haar), haarD: dunkler(wahl(HAAR, g.haar), 0.35),
      hose: wahl(HOSE, g.hose),
      jacke, jackeD: jacke.startsWith("url") ? "#2c2f3a" : dunkler(jacke),
      frisur: Number.isInteger(g.frisur) && g.frisur >= 0 && g.frisur < FRISUREN.length ? g.frisur : 0,
      muetze: p && MUETZEN.has(p.frame) ? p.frame : null,
      hand: p && HAND.has(p.zeichen) ? p.zeichen : null,
      aura: p && AUREN.has(p.aura) ? p.aura : null,
      stil,
      k: kleidungVon(p),
    };
  }

  /* Die Kleidung kommt als Kennungen vom Server. Sie wird nur als
     Nachschlagewert benutzt und nie ins Dokument geschrieben; trotzdem
     bleibt nur, was wie eine Kennung aussieht. */
  const KLEIDUNG_ARTEN = ["kopf", "frisur", "oberteil", "hose", "schuhe", "brille", "accessoire", "hand", "fahrzeug", "haustier"];
  function kleidungVon(p) {
    const roh = (p && p.kleidung) || {};
    const k = {};
    for (const art of KLEIDUNG_ARTEN) {
      const id = roh[art];
      if (typeof id === "string" && /^[a-z0-9_]{2,24}$/.test(id)) k[art] = id;
    }
    return k;
  }

  const LINIE = "#16241f";

  /* Ein paar Muster, die als Farbe nicht gehen. Sie stehen genau einmal im
     Dokument, in einem unsichtbaren, aber gezeichneten SVG: Verläufe in
     einem ausgeblendeten SVG malen manche Browser gar nicht, und die
     Ansichten der Figur werden ja gerade ein- und ausgeblendet. */
  function defsEinhaengen() {
    if (document.getElementById("fg-defs")) return;
    const div = document.createElement("div");
    div.innerHTML = `<svg id="fg-defs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>
      <linearGradient id="fg-regenbogen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e5534b"/><stop offset=".2" stop-color="#f0a23b"/><stop offset=".4" stop-color="#e9d44a"/><stop offset=".6" stop-color="#4fb76a"/><stop offset=".8" stop-color="#4a8fe0"/><stop offset="1" stop-color="#8d5bd6"/></linearGradient>
      <linearGradient id="fg-hologramm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fe7ff"/><stop offset=".35" stop-color="#e6b3ff"/><stop offset=".7" stop-color="#b5ffd9"/><stop offset="1" stop-color="#ffe0a3"/></linearGradient>
      <linearGradient id="fg-aurora" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f7a6a"/><stop offset=".5" stop-color="#46c49a"/><stop offset="1" stop-color="#7b5bd1"/></linearGradient>
    </defs></svg>`;
    document.body.appendChild(div.firstChild);
  }

  function handDing(art, hx, hy) {
    const t = `transform="translate(${hx} ${hy})"`;
    switch (art) {
      case "stern": return `<g class="fg-ding" ${t}><path d="M0 1L2 -11" stroke="#7a5a3a" stroke-width="1.4" stroke-linecap="round"/><path d="M2.4 -18.6l1.5 3.1 3.4.4-2.5 2.3.7 3.4-3.1-1.7-3 1.7.6-3.4-2.5-2.3 3.4-.4z" fill="#ffd75e" stroke="#a37d1c" stroke-width=".8"/></g>`;
      case "flagge": return `<g class="fg-ding" ${t}><path d="M0 3V-17" stroke="#6d5a45" stroke-width="1.4" stroke-linecap="round"/><path class="fg-fahne" d="M0.6 -17L11 -14L0.6 -10.4Z" fill="#e25b4a" stroke="#8e2f25" stroke-width=".7"/></g>`;
      case "ziel": return `<g class="fg-ding" ${t}><circle cx="3" cy="-4" r="5.6" fill="#f2eadb" stroke="#40302a" stroke-width=".8"/><circle cx="3" cy="-4" r="3.8" fill="#d24a3c"/><circle cx="3" cy="-4" r="2.1" fill="#f2eadb"/><circle cx="3" cy="-4" r=".8" fill="#d24a3c"/></g>`;
      case "blitz": return `<g class="fg-ding" ${t}><path d="M2 -16L-3 -5.5H1.4L-1 3L7 -9H2.6L6 -16Z" fill="#ffd23f" stroke="#9a6b00" stroke-width=".8" stroke-linejoin="round"/></g>`;
      case "edelstein": return `<g class="fg-ding" ${t}><path d="M-2.5 -7L1.5 -11.5H7.5L11.5 -7L4.5 2Z" fill="#5ec8f2" stroke="#1e6d8f" stroke-width=".8" stroke-linejoin="round"/><path d="M-2.5 -7H11.5M1.5 -11.5L4.5 2L7.5 -11.5" fill="none" stroke="#bfefff" stroke-width=".6"/></g>`;
      case "krone": return `<g class="fg-ding" ${t}><path d="M0 3L1 -12" stroke="#c9a043" stroke-width="2" stroke-linecap="round"/><circle cx="1.1" cy="-14.4" r="2.9" fill="#f0c75a" stroke="#8e6931" stroke-width=".8"/><path d="M1.1 -19.5v2.4M0 -18.6h2.2" stroke="#8e6931" stroke-width=".8"/></g>`;
      case "bombe": return `<g class="fg-ding" ${t}><circle cx="3" cy="-4.5" r="5.4" fill="#23262b" stroke="#0e0f12" stroke-width=".8"/><circle cx="1.2" cy="-6.6" r="1.3" fill="#fff" opacity=".35"/><path d="M6.4 -8.6q3 -2.6 2.2 -6" fill="none" stroke="#b08d57" stroke-width="1.1"/><path class="fg-funke" d="M8.6 -16.8l.8 1.6 1.7.3-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.3z" fill="#ffcf4a"/></g>`;
      case "totenkopf": return `<g class="fg-ding" ${t}><path d="M-1.6 -5.2a4.8 4.8 0 1 1 9.6 0q0 2.6-1.8 3.6v2.1h-6v-2.1q-1.8-1-1.8-3.6z" fill="#f1ede3" stroke="#5c5448" stroke-width=".8"/><circle cx="1.4" cy="-5" r="1.3" fill="#2a2622"/><circle cx="5" cy="-5" r="1.3" fill="#2a2622"/><path d="M2 .2v-1.3M3.2 .2v-1.3M4.4 .2v-1.3" stroke="#5c5448" stroke-width=".6"/></g>`;
      case "auk_marke":
      case "staub_siegel": return `<g class="fg-ding" ${t}><rect x="-1.4" y="-13" width="3.2" height="8.5" rx="1.4" fill="#6b4a2e"/><circle cx=".2" cy="-13.8" r="2.4" fill="#8a6440"/><rect x="-4.2" y="-5" width="8.8" height="3.2" rx="1" fill="#b33a3a" stroke="#6d1f1f" stroke-width=".7"/></g>`;
      case "hai": return `<g class="fg-ding" ${t}><path d="M-3 -4q5 -5.5 13.5 -2.2q-1.6 1.4 0 3.2q-8.5 3.4 -13.5 -1z" fill="#8aa3b3" stroke="#475d6b" stroke-width=".8"/><path d="M3 -7.4l2 -4.2l1.8 4.2" fill="#8aa3b3" stroke="#475d6b" stroke-width=".7"/><circle cx="0" cy="-4.4" r=".7" fill="#1b2328"/><path d="M-1 -2.3q2 .8 4 0" stroke="#fff" stroke-width=".5" fill="none"/></g>`;
      case "klingen": return `<g class="fg-ding" ${t}><path d="M-.9 -3.5L.9 -3.5L1.1 -20L0 -22.4L-1.1 -20Z" fill="#d9c7a3" stroke="#7d6a4a" stroke-width=".6"/><rect x="-3.6" y="-4" width="7.2" height="1.8" rx=".8" fill="#8e5a33"/><rect x="-.9" y="-2.2" width="1.8" height="4.4" fill="#5a3a24"/></g>`;
      case "tresor": return `<g class="fg-ding" ${t}><rect x="-3.5" y="-10" width="11" height="9.5" rx="1.4" fill="#6b7078" stroke="#3a3e44" stroke-width=".8"/><circle cx="2" cy="-5.3" r="2.4" fill="#c9ccd1" stroke="#3a3e44" stroke-width=".6"/><path d="M2 -5.3l1.3 -1" stroke="#3a3e44" stroke-width=".6"/></g>`;
      case "gala_konfetti": return `<g class="fg-ding" ${t}><path d="M-1.8 1L4.2 -12L9 -8.8Z" fill="#e2b656" stroke="#8e6931" stroke-width=".7" stroke-linejoin="round"/><g class="fg-konfetti"><rect x="5" y="-19" width="1.8" height="1.8" fill="#e5534b"/><rect x="9" y="-16" width="1.6" height="1.6" fill="#4a8fe0"/><rect x="1.5" y="-17" width="1.6" height="1.6" fill="#4fb76a"/><rect x="7.5" y="-21.5" width="1.5" height="1.5" fill="#f0a23b"/></g></g>`;
      case "gala_stern": return `<g class="fg-ding" ${t}><path d="M0 3L3 -11" stroke="#5a5a5a" stroke-width="1.2" stroke-linecap="round"/><g class="fg-funkeln"><path d="M3.4 -18.5v7M-.1 -15h7M1 -17.4l4.8 4.8M5.8 -17.4l-4.8 4.8" stroke="#fff3b0" stroke-width="1" stroke-linecap="round"/><circle cx="3.4" cy="-15" r="1.2" fill="#ffe27a"/></g></g>`;
      default: return `<g class="fg-ding" ${t}><circle cx="3" cy="-3.2" r="4.3" fill="#e9c775" stroke="#806235" stroke-width="1"/><path d="M3 -6.2v6m-3-3h6" stroke="#ffebac" stroke-width="1.1"/></g>`;
    }
  }

  /* Kopfbedeckungen. Sie sind so gezeichnet, dass sie von vorn, hinten und
     der Seite gleich aussehen dürfen; nur die Kopfhörer brauchen eine
     eigene Seitenansicht, sonst schwebt eine Muschel in der Luft. */
  function muetze(art, ansicht) {
    switch (art) {
      case "silber": return `<g class="fg-hut"><path d="M17.3 24Q16.8 9.4 32 9Q47.2 9.4 46.7 24Z" fill="#b9c0c8" stroke="#5c646d" stroke-width="1"/><path d="M22 12v11M27 10v13M32 9.5v13.5M37 10v13M42 12v11" stroke="#9aa3ad" stroke-width=".8"/><rect x="16.6" y="21" width="30.8" height="5" rx="2" fill="#98a1ab" stroke="#5c646d" stroke-width="1"/><circle cx="32" cy="7.4" r="3.4" fill="#eef1f4" stroke="#8e97a1" stroke-width=".8"/></g>`;
      case "gold": return `<g class="fg-hut"><path d="M20.5 17L19.5 5.5L25.8 10.5L32 3L38.2 10.5L44.5 5.5L43.5 17Z" fill="#e2b656" stroke="#8e6931" stroke-width="1" stroke-linejoin="round"/><path d="M20.3 14h23.4" stroke="#b88f3c" stroke-width="1.2"/><circle cx="32" cy="10.8" r="1.6" fill="#d24a3c"/><circle cx="25.5" cy="13" r="1.1" fill="#4a8fe0"/><circle cx="38.5" cy="13" r="1.1" fill="#4fb76a"/></g>`;
      case "neon":
        if (ansicht === "seite") return `<g class="fg-hut fg-neon"><path d="M22 30Q20 11 33 11Q44 11.5 43 22" fill="none" stroke="#1d2226" stroke-width="3"/><rect x="23.5" y="24.5" width="7.5" height="11.5" rx="3" fill="#2b3136" stroke="#42f5a7" stroke-width="1.4"/></g>`;
        return `<g class="fg-hut fg-neon"><path d="M19 30Q18 11 32 11Q46 11 45 30" fill="none" stroke="#1d2226" stroke-width="3"/><rect x="14.6" y="24.5" width="7" height="12" rx="3" fill="#2b3136" stroke="#42f5a7" stroke-width="1.4"/><rect x="42.4" y="24.5" width="7" height="12" rx="3" fill="#2b3136" stroke="#42f5a7" stroke-width="1.4"/></g>`;
      case "rotierend": return `<g class="fg-hut"><path d="M18 22Q18 9.5 32 9.5Q46 9.5 46 22Z" fill="#d94c45" stroke="#6d2320" stroke-width="1"/><path d="M32 9.5Q28 14 27 22H37Q36 14 32 9.5Z" fill="#f2c94c"/><path d="M32 9.5Q24 12 22.5 22" fill="none" stroke="#3d6ec9" stroke-width="3"/><path d="M16 22.2h32" stroke="#6d2320" stroke-width="2.2" stroke-linecap="round"/><path d="M32 9.5V5.5" stroke="#333" stroke-width="1.2"/><g class="fg-propeller"><ellipse cx="32" cy="5" rx="8.5" ry="1.6" fill="#3d6ec9" stroke="#1d3b73" stroke-width=".6"/></g><circle cx="32" cy="5" r="1.2" fill="#f2c94c"/></g>`;
      case "flamme": return `<g class="fg-hut fg-flamme"><path d="M21 18Q19.5 8 25 3.5Q24.4 10 28.4 12.5Q28.2 3.5 34 -.5Q33 8 37.2 11Q39 5.2 42.5 4.4Q41.2 12 43 18Q32 22 21 18Z" fill="#ff8a3d" stroke="#b44a12" stroke-width=".8" stroke-linejoin="round"/><path d="M25 17Q24.5 11 27.5 8.5Q28 13 31.5 14.5Q31.5 8.5 34.5 5.5Q34.5 11 38 13.5Q39 10 40.5 9.5Q40 14 40.5 17.5Q32 20 25 17Z" fill="#ffd25e"/></g>`;
      case "sterne": return `<g class="fg-hut fg-sterne"><path d="M20 12.6l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="#ffe27a" stroke="#b78d1c" stroke-width=".6"/><path d="M32 4l1.4 2.8 3.1.4-2.3 2.1.6 3-2.8-1.5-2.8 1.5.6-3-2.3-2.1 3.1-.4z" fill="#fff0a8" stroke="#b78d1c" stroke-width=".6"/><path d="M44 12.6l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="#ffe27a" stroke="#b78d1c" stroke-width=".6"/></g>`;
      case "s2_wolf": return `<g class="fg-hut"><path d="M18.5 16L19.5 3L27.5 11.5Z" fill="#7d8591" stroke="#434852" stroke-width="1" stroke-linejoin="round"/><path d="M45.5 16L44.5 3L36.5 11.5Z" fill="#7d8591" stroke="#434852" stroke-width="1" stroke-linejoin="round"/><path d="M20.8 12.5L21.4 6.5L25 10.4Z" fill="#d9a3a8"/><path d="M43.2 12.5L42.6 6.5L39 10.4Z" fill="#d9a3a8"/>${ansicht === "vorne" ? `<path d="M15.5 33Q13.5 9.5 32 9Q50.5 9.5 48.5 33Q47 21.5 32 20.5Q17 21.5 15.5 33Z" fill="#7d8591" stroke="#434852" stroke-width="1"/>`
        : ansicht === "seite" ? `<path d="M17.5 36Q14 9.5 33 9Q47.5 9.8 46.5 23Q40.5 18.5 34.5 20Q29.5 26 27.5 33Q25 41.5 18.5 40Z" fill="#7d8591" stroke="#434852" stroke-width="1"/>`
        : `<path d="M15.5 33Q13.5 9.5 32 9Q50.5 9.5 48.5 33Q46 42 32 42.5Q18 42 15.5 33Z" fill="#7d8591" stroke="#434852" stroke-width="1"/>`}</g>`;
      case "rad_fortuna": return `<g class="fg-hut"><path d="M18.5 22.5Q32 12.5 45.5 22.5" fill="none" stroke="#d9b557" stroke-width="2.6" stroke-linecap="round"/><g class="fg-rad"><circle cx="32" cy="10.5" r="5.8" fill="#f3dc8f" stroke="#9a7a2d" stroke-width="1"/><path d="M32 4.7v11.6M26.2 10.5h11.6M27.9 6.4l8.2 8.2M36.1 6.4l-8.2 8.2" stroke="#9a7a2d" stroke-width=".8"/><circle cx="32" cy="10.5" r="1.3" fill="#d24a3c"/></g></g>`;
      case "adm_orbit": return `<g class="fg-hut fg-orbit"><ellipse cx="32" cy="16" rx="19" ry="4.6" fill="none" stroke="#9fb7ff" stroke-width="1.6" transform="rotate(-10 32 16)"/><circle class="fg-mond" cx="13.6" cy="19" r="2.2" fill="#d7e2ff" stroke="#5a6fb0" stroke-width=".6"/></g>`;
      case "uhrwerk": return `<g class="fg-hut"><ellipse cx="32" cy="17" rx="15.5" ry="3" fill="#2a2530" stroke="#141117" stroke-width="1"/><path d="M22.2 17L23 1.5H41L41.8 17Z" fill="#2f2a36" stroke="#141117" stroke-width="1"/><rect x="22.6" y="11.4" width="18.8" height="3.4" fill="#8a5a2b"/><g class="fg-zahnrad"><circle cx="37.4" cy="13" r="3.4" fill="#c9a14a" stroke="#6e5420" stroke-width=".8" stroke-dasharray="1.6 1"/><circle cx="37.4" cy="13" r="1.1" fill="#6e5420"/></g></g>`;
      case "kiste_sprung": return `<g class="fg-hut fg-feder"><path d="M32 16l-3.4-2 6.8-2-6.8-2 6.8-2-6.8-2 3.4-1.4" fill="none" stroke="#c0c6cc" stroke-width="1.5" stroke-linejoin="round"/><circle cx="32" cy="1.2" r="3.4" fill="#e2574c" stroke="#8e2a22" stroke-width=".8"/><circle cx="30.8" cy=".1" r="1" fill="#fff" opacity=".5"/></g>`;
      case "gala_kranz": return `<g class="fg-hut">${[[19, 25, -60], [20.5, 20.5, -45], [23.5, 16.5, -30], [27.5, 13.8, -12], [45, 25, 60], [43.5, 20.5, 45], [40.5, 16.5, 30], [36.5, 13.8, 12]].map(([x, y, w]) => `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="3.6" fill="#b5a64a" stroke="#6f6a23" stroke-width=".6" transform="rotate(${w} ${x} ${y})"/>`).join("")}<circle cx="32" cy="13" r="1.4" fill="#e2b656"/></g>`;
      case "staub_zahnkranz": return `<g class="fg-hut"><path d="M20 17.5V9.5H23V6.5H26V9.5H29V5H35V9.5H38V6.5H41V9.5H44V17.5Z" fill="#8b929c" stroke="#4c535c" stroke-width="1" stroke-linejoin="round"/><circle cx="24.5" cy="14" r=".9" fill="#d5d9de"/><circle cx="32" cy="14" r=".9" fill="#d5d9de"/><circle cx="39.5" cy="14" r=".9" fill="#d5d9de"/></g>`;
      default: return "";
    }
  }

  /* Haare in zwei Lagen: was hinter dem Kopf liegt, und was davor. */
  function haarHinten(f, ansicht) {
    const c = f.haar;
    if (f.frisur === 4) {
      if (ansicht === "seite") return `<path d="M19.5 26Q19 43 26.5 50L31 47Q27 38 28 27Z" fill="${c}"/>`;
      return `<path d="M17.5 28Q16 44 20 50.5Q25 48 24.5 40L39.5 40Q39 48 44 50.5Q48 44 46.5 28Z" fill="${c}" stroke="${f.haarD}" stroke-width=".8"/>`;
    }
    if (f.frisur === 3 && ansicht !== "vorne") {
      return ansicht === "seite"
        ? `<path d="M20 27Q13 32 15.5 42Q17.5 47 20.5 44Q18.5 37 23 30Z" fill="${c}" stroke="${f.haarD}" stroke-width=".8"/>`
        : "";
    }
    return "";
  }

  function haarVorn(f) {
    const c = f.haar;
    const k = `fill="${c}" stroke="${f.haarD}" stroke-width=".8"`;
    switch (f.frisur) {
      case 1: return `<path d="M18.4 30.5Q16 12.8 33 12.6Q48 13.6 45.7 30Q44 20.5 36.5 18.4Q29 25 19.8 25.4Z" ${k}/>`;
      case 2: return `<g ${k}>${[[20.2, 25.5], [21.6, 19.5], [26, 15.2], [32, 13.6], [38, 15.2], [42.4, 19.5], [43.8, 25.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.4"/>`).join("")}</g><path d="M22 22Q32 17 42 22" fill="none" stroke="${f.haarD}" stroke-width=".6"/>`;
      case 3: return `<path d="M18.5 29.5Q17 13.2 32 13.2Q47 13.2 45.5 29.5Q42 19.5 32 19.4Q22 19.5 18.5 29.5Z" ${k}/><path d="M24 15.8Q32 13.8 40 15.8" fill="none" stroke="${dunkler(c, 0.15)}" stroke-width="1"/>`;
      case 4: return `<path d="M18 31Q16.2 12.5 32 12.4Q47.8 12.5 46 31Q44 21 38 19.5Q33 24 25 21.5Q20 24 18 31Z" ${k}/>`;
      default: return `<path d="M18.6 29.5Q17 13.6 32 13.3Q47 13.6 45.4 29.5Q44 22 38.2 20.6Q35 25.2 30.2 22Q26 25.2 22.2 21.8Q19.6 24 18.6 29.5Z" ${k}/><path d="M24 16Q32 12.6 40 16" fill="none" stroke="${dunkler(c, -0.4)}" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round"/>`;
    }
  }

  function haarRuecken(f) {
    const c = f.haar;
    const k = `fill="${c}" stroke="${f.haarD}" stroke-width=".8"`;
    if (f.frisur === 2) {
      return `<g ${k}>${[[20, 25], [21.5, 19], [26, 15], [32, 13.4], [38, 15], [42.5, 19], [44, 25], [21, 32], [27, 36.5], [32, 38], [37, 36.5], [43, 32], [26.5, 27], [32, 25], [37.5, 27], [32, 31.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.6"/>`).join("")}</g>`;
    }
    const lang = f.frisur === 4;
    const kopf = `<path d="M18.4 30Q16.8 12.8 32 12.8Q47.2 12.8 45.6 30Q45.4 ${lang ? 50 : 39.5} ${lang ? 42 : 38.5} ${lang ? 50 : 42}H${lang ? 22 : 25.5}Q${lang ? 18.6 : 18.8} ${lang ? 50 : 39.5} 18.4 30Z" ${k}/>`;
    const zopf = f.frisur === 3
      ? `<path d="M29.5 39Q27.5 50 31 57Q35 51 34.5 39Z" ${k}/><rect x="29.4" y="37.4" width="5.2" height="2.6" rx="1.2" fill="#d24a3c"/>`
      : "";
    const wirbel = f.frisur === 1 ? `<path d="M26 18Q33 15 39 20" fill="none" stroke="${f.haarD}" stroke-width=".8"/>` : "";
    return kopf + zopf + wirbel;
  }

  function haarSeite(f) {
    const c = f.haar;
    const k = `fill="${c}" stroke="${f.haarD}" stroke-width=".8"`;
    switch (f.frisur) {
      case 2: return `<g ${k}>${[[21, 26], [22.5, 20], [27, 15.4], [33, 13.6], [39, 15], [43, 19.5], [21.5, 32.5], [25, 37]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.4"/>`).join("")}</g>`;
      case 3: return `<path d="M19.5 32Q17.5 13 33 13Q45.5 13.5 45 24Q40 20 33 20.5Q27 22 25 29Q23 34 21 35Q19.5 34 19.5 32Z" ${k}/><rect x="17.8" y="26.6" width="4" height="3.4" rx="1.4" fill="#d24a3c"/>`;
      case 4: return `<path d="M19.3 33Q17 12.6 33 12.6Q46 13 45.3 24.5Q40.5 19.8 34 21Q30 26 27.5 31Q26.5 40 27.5 48Q21 45 19.3 33Z" ${k}/>`;
      case 1: return `<path d="M19.5 32Q17.5 12.6 33.5 12.6Q46.5 13.4 45.6 26Q41 19 34 19.5Q29 26 25.5 31Q24 36 21.5 37Q19.5 35 19.5 32Z" ${k}/>`;
      default: return `<path d="M19.5 32Q17 13 33 13Q45.5 13.5 45 24Q40 20.4 34.2 21.4Q31.2 27 27 31Q25 36.2 22 38Q19.5 36 19.5 32Z" ${k}/>`;
    }
  }

  function aufnaeher(p) {
    const av = p && p.avatar && p.avatar !== "🙂" ? String(p.avatar).slice(0, 8) : null;
    return av
      ? `<text x="38.6" y="58.6" text-anchor="middle" font-size="6.6">${esc(av)}</text>`
      : `<path d="M38.6 53.4l2.4 2.4-2.4 2.4-2.4-2.4z" fill="#ecd29a" stroke="${LINIE}" stroke-width=".6"/>`;
  }

  const T = () => Casino.figurTeile;

  /* Was in der Hand liegt: erst das Handding aus der Kleidung, dann das
     Chat-Zeichen, sonst der Chip. */
  function hand(f, hx, hy) {
    const aus = f.k.hand ? T().handding(f.k.hand, hx, hy) : null;
    return aus || handDing(f.hand, hx, hy);
  }

  /* Eine Kopfbedeckung aus der Kleidung geht vor; sonst trägt die Figur,
     was ihr Rahmen hergibt. */
  function kopfbedeckung(f, ansicht) {
    const k = T().kopf(f, ansicht);
    return k === null ? muetze(f.muetze, ansicht) : k;
  }

  function fahrzeugInfo(f) {
    return (f.k.fahrzeug && T().FAHRZEUG[f.k.fahrzeug]) || null;
  }

  /* Die Figur hebt sich auf das Fahrzeug oder sinkt in den Sitz. */
  function leibAuf(f, inhalt) {
    const fz = fahrzeugInfo(f);
    return fz ? `<g transform="translate(0 ${-fz.hub})">${inhalt}</g>` : inhalt;
  }

  function beineVorn(f) {
    const fz = fahrzeugInfo(f);
    if (fz && fz.sitzt) return "";
    return `<g class="fg-beine"><g class="fg-bein fg-bein-l">${T().bein(f, 24.5, false)}${T().schuh(f, 24.5)}</g>`
      + `<g class="fg-bein fg-bein-r">${T().bein(f, 32.5, true)}${T().schuh(f, 32.5)}</g></g>`;
  }

  function beineSeite(f) {
    const fz = fahrzeugInfo(f);
    if (fz && fz.sitzt) return "";
    return `<g class="fg-beine"><g class="fg-bein fg-bein-h">${T().beinSeite(f, true)}${T().schuhSeite(f, true)}</g>`
      + `<g class="fg-bein fg-bein-v">${T().beinSeite(f, false)}${T().schuhSeite(f, false)}</g></g>`;
  }

  function schatten(rx, ry) {
    return `<ellipse class="fg-schatten" cx="32" cy="88.6" rx="${rx}" ry="${ry}"/>`;
  }

  function vorne(p, f) {
    const t = T();
    const frisurH = t.frisurHinten(f, "vorne");
    const frisurV = t.frisurVorn(f, "vorne");
    return `<svg class="fg fg-vorne" viewBox="0 0 64 96" focusable="false" aria-hidden="true">
      ${schatten(14.5, 3.4)}
      <g class="fz">${t.fahrzeugHinten(f, "vorne")}</g>
      <g class="fg-leib">${leibAuf(f, `
        ${t.accessoireHinten(f, "vorne")}
        ${frisurH === null ? haarHinten(f, "vorne") : frisurH}
        ${beineVorn(f)}
        <g class="fg-oben">
          <g class="fg-arm fg-arm-l">${t.aermel(f, false, false, false)}</g>
          ${t.rumpf(f, "vorne", aufnaeher(p))}
          ${t.traeger(f, "vorne")}
          ${t.accessoireVorn(f, "vorne")}
          <g class="fg-arm fg-arm-r">${t.aermel(f, true, false, false)}${hand(f, 45.4, 66.2)}</g>
          <g class="fg-kopf">
            <rect x="28.8" y="39" width="6.4" height="6.4" rx="2" fill="${f.hautD}"/>
            <ellipse cx="19.4" cy="31" rx="2.6" ry="3.5" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>
            <ellipse cx="44.6" cy="31" rx="2.6" ry="3.5" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>
            <ellipse cx="32" cy="29" rx="13" ry="13.4" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".8"/>
            <g class="fg-augen" fill="#26342d"><ellipse cx="27" cy="31" rx="1.7" ry="2.2"/><ellipse cx="37" cy="31" rx="1.7" ry="2.2"/></g>
            <path d="M24.8 27.2L28.8 26.6M35.2 26.6L39.2 27.2" stroke="${f.haarD}" stroke-width="1.2" stroke-linecap="round"/>
            <path d="M32.2 32.4l-.9 2.4h1.8" fill="none" stroke="${f.hautD}" stroke-width=".9" stroke-linecap="round"/>
            <path class="fg-mund" d="M29 37Q32 39.4 35 37" fill="none" stroke="#6e4435" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="24.4" cy="35" r="1.8" fill="#e58a7a" opacity=".35"/><circle cx="39.6" cy="35" r="1.8" fill="#e58a7a" opacity=".35"/>
            ${frisurV === null ? haarVorn(f) : frisurV}
            ${t.brille(f, "vorne")}
            ${kopfbedeckung(f, "vorne")}
          </g>
        </g>`)}
      </g>
      <g class="fz">${t.fahrzeugVorn(f, "vorne")}</g></svg>`;
  }

  function hinten(p, f) {
    const t = T();
    const frisurV = t.frisurVorn(f, "hinten");
    return `<svg class="fg fg-hinten" viewBox="0 0 64 96" focusable="false" aria-hidden="true">
      ${schatten(14.5, 3.4)}
      <g class="fz">${t.fahrzeugHinten(f, "hinten")}</g>
      <g class="fg-leib">${leibAuf(f, `
        ${beineVorn(f)}
        <g class="fg-oben">
          <g class="fg-arm fg-arm-r">${t.aermel(f, true, false, false)}</g>
          <g class="fg-arm fg-arm-l">${t.aermel(f, false, false, false)}${hand(f, 18.6, 66.2)}</g>
          ${t.rumpf(f, "hinten", "")}
          ${t.traeger(f, "hinten")}
          ${t.accessoireVorn(f, "hinten")}
          <g class="fg-kopf">
            <rect x="28.8" y="39" width="6.4" height="6.4" rx="2" fill="${f.hautD}"/>
            <ellipse cx="19.4" cy="31" rx="2.6" ry="3.5" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>
            <ellipse cx="44.6" cy="31" rx="2.6" ry="3.5" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>
            <ellipse cx="32" cy="29" rx="13" ry="13.4" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".8"/>
            ${frisurV === null ? haarRuecken(f) : frisurV}
            ${t.brille(f, "hinten")}
            ${kopfbedeckung(f, "hinten")}
          </g>
        </g>`)}
      </g>
      <g class="fz">${t.fahrzeugVorn(f, "hinten")}</g></svg>`;
  }

  function seite(p, f) {
    const t = T();
    const frisurH = t.frisurHinten(f, "seite");
    const frisurV = t.frisurVorn(f, "seite");
    return `<svg class="fg fg-seite" viewBox="0 0 64 96" focusable="false" aria-hidden="true">
      ${schatten(12.5, 3.2)}
      <g class="fz">${t.fahrzeugHinten(f, "seite")}</g>
      <g class="fg-leib">${leibAuf(f, `
        ${t.accessoireHinten(f, "seite")}
        ${frisurH === null ? haarHinten(f, "seite") : frisurH}
        ${beineSeite(f)}
        <g class="fg-oben">
          <g class="fg-arm fg-arm-h">${t.aermel(f, false, true, true)}</g>
          ${t.rumpf(f, "seite", "")}
          ${t.traeger(f, "seite")}
          ${t.accessoireVorn(f, "seite")}
          <g class="fg-arm fg-arm-v">${t.aermel(f, false, true, false)}${hand(f, 33, 66.2)}</g>
          <g class="fg-kopf">
            <rect x="28.6" y="39" width="6.4" height="6.4" rx="2" fill="${f.hautD}"/>
            <ellipse cx="32.4" cy="29" rx="12.6" ry="13.4" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".8"/>
            <path d="M44.4 29.4q2.6 1.8 .2 3.8" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".8"/>
            <g class="fg-augen" fill="#26342d"><ellipse cx="39.6" cy="31" rx="1.6" ry="2.2"/></g>
            <path d="M37.8 27L41.4 26.8" stroke="${f.haarD}" stroke-width="1.2" stroke-linecap="round"/>
            <path class="fg-mund" d="M40 37.4q2.4 .8 3.6 -.6" fill="none" stroke="#6e4435" stroke-width="1.2" stroke-linecap="round"/>
            <circle cx="38.6" cy="35" r="1.8" fill="#e58a7a" opacity=".35"/>
            ${frisurV === null ? haarSeite(f) : frisurV}
            <ellipse cx="28.6" cy="31" rx="2.5" ry="3.4" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>
            ${t.brille(f, "seite")}
            ${kopfbedeckung(f, "seite")}
          </g>
        </g>`)}
      </g>
      <g class="fz">${t.fahrzeugVorn(f, "seite")}</g></svg>`;
  }

  /** Alle drei Ansichten. Welche sichtbar ist, entscheidet eine Klasse am Umschlag. */
  function ansichten(p) {
    defsEinhaengen();
    const f = farbenVon(p || {});
    return vorne(p, f) + hinten(p, f) + seite(p, f);
  }

  /** Nur die Vorderansicht, für Profil, Garderobe und Listen. */
  function vorschau(p) {
    defsEinhaengen();
    const f = farbenVon(p || {});
    return vorne(p, f);
  }

  /** In Worten, was die Figur gerade trägt. Für Garderobe und Spielerkarte. */
  function beschreibung(p) {
    const f = farbenVon(p || {});
    return {
      kopf: f.k.kopf ? null : f.muetze ? MUETZE_NAME[f.muetze] : null,
      hand: f.hand ? HAND_NAME[f.hand] : "Casino-Chip",
    };
  }

  /*
   * Ein einzelnes Stück als Bild, für Garderobe, Kisten und Markt.
   *
   * Gezeigt wird die eigene Figur mit genau diesem Stück, aber nur der
   * Ausschnitt, auf den es ankommt: bei Schuhen die Füße, bei einer Brille
   * das Gesicht. Ein Schuh ohne Fuß daran ist auf einer Kachel schwer zu
   * erkennen, und eine zweite Zeichnung je Stück liefe irgendwann anders
   * aus als die an der Figur.
   */
  const AUSSCHNITT = {
    kopf: "4 -6 56 46", frisur: "8 0 48 46", brille: "14 17 36 24", oberteil: "6 37 52 42", hose: "13 60 38 32",
    schuhe: "12 74 40 22", accessoire: "0 32 64 56", hand: "24 20 42 54", fahrzeug: "-8 34 80 62",
  };
  const VON_HINTEN = new Set(["umhang", "fluegel", "rucksack"]);
  function stueckVorschau(art, id, p) {
    if (art === "haustier") {
      return `<span class="fg-stueck fg-stueck-haustier">${Casino.haustiere ? Casino.haustiere.tier(id) : ""}</span>`;
    }
    if (!AUSSCHNITT[art]) return "";
    defsEinhaengen();
    const look = { ...(p || {}), kleidung: { ...((p && p.kleidung) || {}), [art]: id } };
    /* Ein Fahrzeug verdeckt fast alles: im 45er-Auto sieht man von einer
       Fliege oder Shorts nichts. Gezeigt wird es nur, wenn es selbst das
       Stück ist. */
    if (art !== "fahrzeug") look.kleidung.fahrzeug = undefined;
    const f = farbenVon(look);
    const ansicht = art === "fahrzeug" ? seite(look, f) : art === "accessoire" && VON_HINTEN.has(id) ? hinten(look, f) : vorne(look, f);
    return `<span class="fg-stueck fg-stueck-${art}">${ansicht.replace('viewBox="0 0 64 96"', `viewBox="${AUSSCHNITT[art]}"`)}</span>`;
  }

  Casino.figur = {
    ansichten, vorschau, beschreibung, farbenVon, stueckVorschau,
    HAUT, HAAR, HOSE, FRISUREN, NAMEN, AUREN, KLEIDUNG_ARTEN,
  };
})();
