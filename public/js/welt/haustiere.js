"use strict";

/*
 * Haustiere. Sie laufen der Figur hinterher und gehören zur Kleidung
 * (Katalog: game/kleidung.js, Art "haustier").
 *
 * Gezeichnet wird nur die Seitenansicht, nach rechts schauend; läuft das
 * Tier nach links, wird es gespiegelt. Von vorn oder hinten wäre ein Dackel
 * ein brauner Punkt. viewBox 0 0 40 32, Füße bei y 30.
 *
 * Wohin es läuft, rechnet jeder Browser selbst aus der Figur aus. Der
 * Server kennt nur, welches Tier jemand angelegt hat: ein Tier, das einen
 * halben Meter hinter seinem Menschen herläuft, braucht keine eigene
 * Plausibilisierung.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const L = "#16241f";

  function bein(x, y, farbe, h = 4) {
    return `<rect class="ht-bein" x="${x}" y="${y}" width="2.4" height="${h}" rx="1.1" fill="${farbe}"/>`;
  }

  const TIERE = {
    taube: () => `
      <path class="ht-kopf" d="M27 12q4-3 6.4 0q1 2-1 3.6L27.6 17Z" fill="#8c95a3" stroke="${L}" stroke-width=".7"/>
      <path d="M33 13.4l2.6.8-2.6.8z" fill="#e2a144"/>
      <circle cx="31" cy="12.8" r=".8" fill="#e5534b"/>
      <path d="M26.4 16Q30 20 27 24Q20 28 11 25Q6 23 5 20Q12 20 16 17Q21 14 26.4 16Z" fill="#9aa3b1" stroke="${L}" stroke-width=".7"/>
      <path d="M26 16.4q2 2.6-.6 4.6" fill="none" stroke="#6fbf8f" stroke-width="1.4"/>
      <path d="M14 20q5-1 9 2" fill="none" stroke="#6b7482" stroke-width="1"/>
      ${bein(16, 25, "#d86a5a", 4.6)}${bein(21, 25, "#d86a5a", 4.6)}`,
    hamster: () => `
      <ellipse cx="20" cy="21" rx="11" ry="8" fill="#e2a86a" stroke="${L}" stroke-width=".7"/>
      <ellipse cx="22" cy="24" rx="6" ry="4.4" fill="#fbead2"/>
      <circle cx="27" cy="14.6" r="2.6" fill="#e2a86a" stroke="${L}" stroke-width=".6"/><circle cx="27" cy="14.6" r="1.3" fill="#f5b8c8"/>
      <circle cx="28.4" cy="19" r="1.1" fill="#1d1d23"/><circle cx="31" cy="21.4" r=".8" fill="#d86a8a"/>
      ${bein(15, 27, "#c78a4c", 3)}${bein(24, 27, "#c78a4c", 3)}`,
    frosch: () => `
      <path class="ht-koerper" d="M8 26Q7 16 18 15Q30 14 32 22Q33 28 26 28H12Q8 28 8 26Z" fill="#5ab04a" stroke="${L}" stroke-width=".7"/>
      <circle cx="24" cy="14" r="3.6" fill="#5ab04a" stroke="${L}" stroke-width=".6"/><circle cx="30" cy="15" r="3.4" fill="#5ab04a" stroke="${L}" stroke-width=".6"/>
      <circle cx="24.6" cy="13.6" r="1.6" fill="#fff"/><circle cx="30.4" cy="14.6" r="1.5" fill="#fff"/><circle cx="25" cy="13.8" r=".8" fill="#1d1d23"/><circle cx="30.8" cy="14.8" r=".8" fill="#1d1d23"/>
      <path d="M22 23q5 2.4 10 0" fill="none" stroke="#2e6a26" stroke-width=".8"/>
      <path d="M8 27q-3 1-4 3h8M27 28q2 1 3 2h-6" fill="#4a9a3c" stroke="${L}" stroke-width=".5"/>`,
    katze: (farbe = "#e2873a", streifen = "#b35e1c", halsband = null) => `
      <path class="ht-schwanz" d="M8 20Q2 16 4 8Q5 5 7 6Q6 14 11 18Z" fill="${farbe}" stroke="${L}" stroke-width=".7"/>
      <path d="M9 18Q9 14 16 14H25Q29 14 29 19V24Q29 26 27 26H11Q9 26 9 24Z" fill="${farbe}" stroke="${L}" stroke-width=".7"/>
      <path d="M14 15v5M18 14.6v5M22 14.6v5" stroke="${streifen}" stroke-width="1.2"/>
      <circle cx="29" cy="13.4" r="6" fill="${farbe}" stroke="${L}" stroke-width=".7"/>
      <path d="M24.6 9.6L25.4 4.4L28.6 8ZM30.4 7.6L33.8 4.2L34.2 9.4Z" fill="${farbe}" stroke="${L}" stroke-width=".6"/>
      <circle cx="31" cy="12.6" r="1" fill="#1d1d23"/><circle cx="34" cy="14.6" r=".7" fill="#d86a8a"/>
      <path d="M34 15.4l3.4-.6M34 16.2l3.4.4" stroke="#fff" stroke-width=".4"/>
      ${halsband ? `<path d="M24.4 17.6q4.4 2 8.4-.4" fill="none" stroke="${halsband}" stroke-width="1.6"/><circle cx="28.6" cy="19.6" r="1.4" fill="#e2b656" stroke="#8e6931" stroke-width=".4"/>` : ""}
      ${bein(11, 25, farbe, 5)}${bein(15, 25, farbe, 5)}${bein(22, 25, farbe, 5)}${bein(26, 25, farbe, 5)}`,
    dackel: () => `
      <path class="ht-schwanz" d="M5 17Q2 12 4 9" fill="none" stroke="#8a4b22" stroke-width="2" stroke-linecap="round"/>
      <rect x="4" y="15" width="26" height="9" rx="4.4" fill="#9a5a2a" stroke="${L}" stroke-width=".7"/>
      <path d="M26 16Q27 10 32 10Q37 10 38.4 14Q39 17 35 18L29 19Z" fill="#9a5a2a" stroke="${L}" stroke-width=".7"/>
      <path d="M28.4 11.4Q25 13 26.4 19Q29 19 29.6 14Z" fill="#6b3c1a" stroke="${L}" stroke-width=".5"/>
      <circle cx="33.4" cy="12.8" r=".9" fill="#1d1d23"/><circle cx="38.2" cy="14.6" r="1" fill="#1d1d23"/>
      ${bein(7, 23, "#8a4b22", 5.6)}${bein(11, 23, "#8a4b22", 5.6)}${bein(23, 23, "#8a4b22", 5.6)}${bein(27, 23, "#8a4b22", 5.6)}`,
    waschbaer: () => `
      <g class="ht-schwanz"><path d="M8 20Q1 18 2 11Q3 8 6 9Q6 15 11 18Z" fill="#8c8f96" stroke="${L}" stroke-width=".7"/><path d="M3 12.6l3 .8M2.6 15.4l3.4.8M4.4 18l3 1" stroke="#2a2d33" stroke-width="1.2"/></g>
      <path d="M9 18Q9 14 16 14H24Q29 14 29 19V24Q29 26 27 26H11Q9 26 9 24Z" fill="#8c8f96" stroke="${L}" stroke-width=".7"/>
      <circle cx="29" cy="14" r="6" fill="#a8acb4" stroke="${L}" stroke-width=".7"/>
      <path d="M24.8 10L25.8 6L28.6 9ZM30.6 8.4L33.6 5.6L34 10Z" fill="#8c8f96" stroke="${L}" stroke-width=".6"/>
      <path d="M26 13q4-2 9.6 .6q-1 3-4.4 2.4q-2.6.4-5.2-3z" fill="#2a2d33"/><circle cx="31" cy="13.4" r=".9" fill="#fff"/>
      <circle cx="35.2" cy="16" r=".9" fill="#1d1d23"/>
      ${bein(11, 25, "#6b6f76", 5)}${bein(15, 25, "#6b6f76", 5)}${bein(22, 25, "#6b6f76", 5)}${bein(26, 25, "#6b6f76", 5)}`,
    gluecksschwein: () => `
      <path class="ht-schwanz" d="M7 18q-3-2-1.4-4q2-1 1 1.4q-1 1.6 1.6 1" fill="none" stroke="#e98fa0" stroke-width="1.2"/>
      <ellipse cx="18" cy="20" rx="11" ry="7.4" fill="#f5b8c8" stroke="${L}" stroke-width=".7"/>
      <circle cx="28" cy="16.6" r="5.6" fill="#f5b8c8" stroke="${L}" stroke-width=".7"/>
      <path d="M25 11.6L25.6 8.4L28 10.8Z" fill="#f09bb0" stroke="${L}" stroke-width=".5"/>
      <ellipse cx="33" cy="18" rx="2.4" ry="2" fill="#f09bb0" stroke="${L}" stroke-width=".5"/><circle cx="32.4" cy="18" r=".5" fill="#7a3a4a"/><circle cx="33.8" cy="18" r=".5" fill="#7a3a4a"/>
      <circle cx="29.4" cy="14.8" r=".8" fill="#1d1d23"/>
      <g transform="translate(24 20)">${[0, 90, 180, 270].map((w) => `<circle cx="${(Math.cos((w * Math.PI) / 180) * 1.3).toFixed(2)}" cy="${(Math.sin((w * Math.PI) / 180) * 1.3).toFixed(2)}" r="1.3" fill="#3f8a4a"/>`).join("")}</g>
      ${bein(11, 25, "#e98fa0", 4.4)}${bein(15, 25, "#e98fa0", 4.4)}${bein(21, 25, "#e98fa0", 4.4)}${bein(25, 25, "#e98fa0", 4.4)}`,
    minidrache: () => `
      <path class="ht-schwanz" d="M9 21Q2 22 1 15l3 1.4L3 12Q7 18 12 18Z" fill="#3f9a6a" stroke="${L}" stroke-width=".7"/>
      <g class="ht-fluegel"><path d="M15 16Q12 5 20 2Q19 8 24 9Q21 13 20 16Z" fill="#8d5bd6" stroke="${L}" stroke-width=".6"/></g>
      <path d="M9 19Q10 14 17 14H23Q28 14 28 19V23Q28 25 26 25H12Q9 25 9 23Z" fill="#3f9a6a" stroke="${L}" stroke-width=".7"/>
      <path d="M13 22h12" stroke="#bfe6a8" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M25 15Q26 9 32 9Q37 9 38 13Q38 17 33 17H27Z" fill="#46ad76" stroke="${L}" stroke-width=".7"/>
      <path d="M28 9.6L28.6 6L31 8.8ZM32 8.8L33.8 5.6L35 9.2Z" fill="#f2c94c"/>
      <circle cx="33" cy="12" r="1" fill="#1d1d23"/><circle cx="36.8" cy="14" r=".6" fill="#1d1d23"/>
      <g class="ht-feuer"><path d="M38.4 15l3.4-1.6-1.2 1.8 2.6.6-3.6 1Z" fill="#ff8a3d"/></g>
      ${bein(12, 24, "#2e7a52", 5)}${bein(16, 24, "#2e7a52", 5)}${bein(21, 24, "#2e7a52", 5)}${bein(25, 24, "#2e7a52", 5)}`,
    tresorkatze: () => TIERE.katze("#7d8591", "#5c646d", "#1d2a6e"),
    igel: () => `
      <path d="M8 25Q6 14 17 12Q27 11 29 20L30 25Z" fill="#6b4a2e" stroke="${L}" stroke-width=".7"/>
      ${[[10, 18], [13, 14.6], [17, 13], [21, 13], [25, 14.6], [12, 21.6], [16, 17], [20, 16.6], [24, 18]].map(([x, y]) => `<path d="M${x} ${y}l-2.4-3.6 3.6 1.4z" fill="#4a3220"/>`).join("")}
      <path d="M27 18Q34 19 36 23Q33 26 28 25Z" fill="#d9b38a" stroke="${L}" stroke-width=".6"/>
      <circle cx="36" cy="23" r="1.2" fill="#1d1d23"/><circle cx="31" cy="20.6" r=".8" fill="#1d1d23"/>
      ${bein(12, 25, "#a8805a", 3.4)}${bein(24, 25, "#a8805a", 3.4)}`,
    hase: () => `
      <circle class="ht-schwanz" cx="7.6" cy="20" r="2.6" fill="#f4f1ea" stroke="${L}" stroke-width=".5"/>
      <ellipse cx="17" cy="21" rx="9.4" ry="6.8" fill="#c9b59a" stroke="${L}" stroke-width=".7"/>
      <circle cx="27" cy="16.4" r="5" fill="#c9b59a" stroke="${L}" stroke-width=".7"/>
      <g class="ht-ohren"><path d="M24 12Q22 2 25 1Q27 2 26.6 12Z" fill="#c9b59a" stroke="${L}" stroke-width=".6"/><path d="M24.8 11Q23.6 4 25 3" stroke="#f5b8c8" stroke-width="1"/><path d="M27 12Q28 3 31 3Q32 5 29 12.6Z" fill="#c9b59a" stroke="${L}" stroke-width=".6"/></g>
      <circle cx="29" cy="15.4" r=".9" fill="#1d1d23"/><circle cx="31.8" cy="17.6" r=".7" fill="#e98fa0"/>
      ${bein(12, 25, "#b8a284", 4)}${bein(21, 25, "#b8a284", 4)}`,
    schildkroete: () => `
      <path d="M30 22Q36 20 37 23Q36 26 31 25Z" fill="#8fbf6a" stroke="${L}" stroke-width=".6"/><circle cx="35" cy="22.4" r=".8" fill="#1d1d23"/>
      <path d="M6 25Q6 13 19 12Q31 13 31 25Z" fill="#6b8a3a" stroke="${L}" stroke-width=".8"/>
      <path d="M12 24l3-7h8l3 7M15 17l4-4 4 4M19 13v4" fill="none" stroke="#4a6228" stroke-width=".9"/>
      <path d="M5 25H32" stroke="#4a6228" stroke-width="1.6"/>
      ${bein(9, 25, "#8fbf6a", 3)}${bein(26, 25, "#8fbf6a", 3)}`,
    pinguin: () => `
      <ellipse cx="20" cy="18" rx="8" ry="11" fill="#1d1f26" stroke="${L}" stroke-width=".7"/>
      <ellipse cx="22" cy="20" rx="5.2" ry="8.4" fill="#f4f1ea"/>
      <g class="ht-fluegel"><path d="M13 16Q9 22 12 27Q15 22 15 16Z" fill="#1d1f26"/></g>
      <circle cx="24.4" cy="11.6" r="1" fill="#fff"/><circle cx="24.8" cy="11.6" r=".6" fill="#1d1d23"/>
      <path d="M27 13l4.4 1.2-4.4 1.2z" fill="#f2a33a"/>
      <path d="M22 13.6q2 2.4 0 4" fill="none" stroke="#f2c94c" stroke-width="1.6" opacity=".7"/>
      <path d="M16 29h5M21 29h5" stroke="#f2a33a" stroke-width="1.8" stroke-linecap="round"/>`,
    papagei: () => `
      <path class="ht-schwanz" d="M14 22L4 30L7 31L16 25Z" fill="#3f6fd0" stroke="${L}" stroke-width=".6"/>
      <ellipse cx="20" cy="19" rx="7" ry="8.6" fill="#e5534b" stroke="${L}" stroke-width=".7"/>
      <g class="ht-fluegel"><path d="M15 16Q12 24 18 28Q22 22 20 15Z" fill="#4fb76a" stroke="${L}" stroke-width=".6"/><path d="M15.6 22q2 1 3.6 0M16 25q1.6 .8 3 0" stroke="#f2c94c" stroke-width=".7" fill="none"/></g>
      <circle cx="24" cy="10.6" r="5.4" fill="#e5534b" stroke="${L}" stroke-width=".7"/>
      <ellipse cx="25.6" cy="10" rx="2.2" ry="2.6" fill="#fff"/><circle cx="26" cy="10" r="1" fill="#1d1d23"/>
      <path d="M28.4 9.4Q33 10 31.6 14.4Q30 13 28.6 13Z" fill="#f2c94c" stroke="${L}" stroke-width=".6"/>
      <path d="M17 27v3M22 27v3" stroke="#6b7078" stroke-width="1.2"/>`,
  };

  /** Das Tier als SVG, oder "" wenn es das nicht gibt. */
  function tier(id) {
    const zeichne = TIERE[id];
    if (!zeichne) return "";
    return `<svg class="ht" viewBox="0 0 40 32" focusable="false" aria-hidden="true"><ellipse class="ht-schatten" cx="20" cy="30" rx="12" ry="2.2"/>${zeichne()}</svg>`;
  }

  Casino.haustiere = { tier, hat: (id) => !!TIERE[id] };
})();
