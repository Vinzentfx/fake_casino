"use strict";

/*
 * Wie die Kleidung aussieht (Katalog: game/kleidung.js).
 *
 * Jede Art liefert Stücke für die drei Ansichten der Figur. Die Maße
 * passen zur Figur in public/js/welt/figur.js (viewBox 64 x 96, Füße bei
 * y 88, Kopfmitte bei 32 / 29). Die Seitenansicht schaut nach rechts, nach
 * links wird sie gespiegelt.
 *
 * Farben stehen hier fest. Kleidung hat ihre eigene Farbe wie Spielkarten
 * und Automaten; ein Hawaiihemd, das mit dem Thema die Farbe wechselt,
 * wäre kein Hawaiihemd mehr.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const L = "#16241f";

  function dunkler(hex, anteil = 0.28) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#1d2f2a";
    const n = parseInt(m[1], 16);
    const k = (v) => Math.max(0, Math.min(255, Math.round(v * (1 - anteil))));
    return "#" + [k(n >> 16), k((n >> 8) & 255), k(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  /* Hosen */
  const HOSEN = {
    jeans:          { farbe: "#3d5a8a", naht: "#7f9cc8" },
    jogger:         { farbe: "#8d949c", bund: true },
    jogger_schwarz: { farbe: "#1e1f24", bund: true, streifen: "#f2f2f2" },
    shorts:         { farbe: "#c9a46a", kurz: 73, socke: "#f4f1ea" },
    cargo:          { farbe: "#6b6a4a", tasche: true },
    anzughose:      { farbe: "#2c3550", falte: true },
    karohose:       { farbe: "#b3261e", karo: true },
    lederhose:      { farbe: "#6b4423", kurz: 74, socke: "#e9e2cf", traeger: true },
    glitzerhose:    { farbe: "#b8bfd0", glitzer: true },
    latzhose:       { farbe: "#3f6fb5", naht: "#8fb0e0", latz: true },
    faltenrock:     { farbe: "#6b4a7a", rock: true, strumpf: "#e8d8c8" },
    leggings:       { farbe: "#1d1d23", glanzlinie: true },
    jeansrock:      { farbe: "#4a6fa8", rock: true, strumpf: "haut", mini: true, naht: "#9fb6dc" },
    schlaghose:     { farbe: "#5a7fb8", naht: "#9fb6dc", schlag: true },
  };

  function hoseVon(f) {
    const h = HOSEN[f.k.hose];
    return h || { farbe: f.hose };
  }

  /** Ein Bein von vorn oder hinten, ohne Schuh. `x` ist die linke Kante. */
  function bein(f, x, rechts) {
    const h = hoseVon(f);
    let s = "";
    if (h.rock) return h.strumpf === "haut"
      ? `<rect x="${x + 0.8}" y="66" width="5.4" height="17.5" rx="2" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>`
      : `<rect x="${x + 0.8}" y="66" width="5.4" height="17.5" rx="2" fill="${h.strumpf}" stroke="#b9a896" stroke-width=".7"/>`;
    if (h.kurz) {
      s += `<rect x="${x + 0.8}" y="${h.kurz - 2}" width="5.4" height="${83.5 - h.kurz + 2}" rx="2" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>`;
      s += `<rect x="${x + 0.6}" y="78" width="5.8" height="5.5" rx="1" fill="${h.socke}"/>`;
      s += `<rect x="${x}" y="65" width="7" height="${h.kurz - 65}" rx="2.2" fill="${h.farbe}" stroke="${L}" stroke-width="1"/>`;
    } else {
      s += `<rect x="${x}" y="65" width="7" height="18.5" rx="2.4" fill="${h.farbe}" stroke="${L}" stroke-width="1"/>`;
    }
    if (!h.kurz) s += `<rect x="${x + (rechts ? 0.4 : 4.6)}" y="66" width="2" height="16.5" rx="1" fill="#000" opacity=".13"/>`;
    if (h.naht) s += `<path d="M${x + (rechts ? 1.4 : 5.6)} 66.5V82" stroke="${h.naht}" stroke-width=".7"/>`;
    if (h.bund) s += `<rect x="${x + 0.4}" y="79.6" width="6.2" height="3.2" rx="1.2" fill="${dunkler(h.farbe, 0.25)}"/>`;
    if (h.streifen) s += `<path d="M${x + (rechts ? 6.1 : 0.9)} 66V80" stroke="${h.streifen}" stroke-width="1"/>`;
    if (h.tasche) s += `<rect x="${x + (rechts ? 3.6 : 0.4)}" y="70.5" width="3" height="4.4" rx=".6" fill="${dunkler(h.farbe, 0.2)}" stroke="${L}" stroke-width=".5"/>`;
    if (h.falte) s += `<path d="M${x + 3.5} 66.5V82.5" stroke="#46527a" stroke-width=".6"/>`;
    if (h.karo) s += [68.5, 72.5, 76.5, 80.5].map((y) => `<path d="M${x} ${y}h7" stroke="#1d1d23" stroke-opacity=".55" stroke-width="1"/>`).join("")
      + `<path d="M${x + 2.3} 65.5V83M${x + 4.7} 65.5V83" stroke="#1d1d23" stroke-opacity=".45" stroke-width="1"/><path d="M${x} 74.5h7" stroke="#f2c94c" stroke-opacity=".7" stroke-width=".5"/>`;
    if (h.glitzer) s += `<g class="fg-glitzer" fill="#fff">${[[1.6, 68], [4.8, 71], [2.2, 75.5], [5.2, 79], [3, 81.5]].map(([a, b]) => `<circle cx="${x + a}" cy="${b}" r=".55"/>`).join("")}</g>`;
    if (h.glanzlinie) s += `<path d="M${x + (rechts ? 1.6 : 5.4)} 67V82" stroke="#fff" stroke-opacity=".22" stroke-width="1"/>`;
    // Schlaghose: unten weit ausgestellt.
    if (h.schlag) s += `<path d="M${x} 76L${x - 1.6} 83.6H${x + 8.6}L${x + 7} 76Z" fill="${h.farbe}" stroke="${L}" stroke-width="1"/>`;
    return s;
  }

  function beinSeite(f, dunkel) {
    const h = hoseVon(f);
    const farbe = dunkel ? dunkler(h.farbe, 0.22) : h.farbe;
    let s = "";
    if (h.rock) {
      const strumpf = h.strumpf === "haut" ? (dunkel ? f.hautD : f.haut) : (dunkel ? dunkler(h.strumpf, 0.12) : h.strumpf);
      return `<rect x="29.3" y="66" width="5.4" height="17.5" rx="2" fill="${strumpf}" stroke="${h.strumpf === "haut" ? f.hautD : "#b9a896"}" stroke-width=".7"/>`;
    }
    if (h.kurz) {
      s += `<rect x="29.3" y="${h.kurz - 2}" width="5.4" height="${83.5 - h.kurz + 2}" rx="2" fill="${dunkel ? f.hautD : f.haut}" stroke="${f.hautD}" stroke-width=".7"/>`;
      s += `<rect x="29.1" y="78" width="5.8" height="5.5" rx="1" fill="${h.socke}"/>`;
      s += `<rect x="28.5" y="65" width="7" height="${h.kurz - 65}" rx="2.2" fill="${farbe}" stroke="${L}" stroke-width="1"/>`;
    } else {
      s += `<rect x="28.5" y="65" width="7" height="18.5" rx="2.4" fill="${farbe}" stroke="${L}" stroke-width="1"/>`;
    }
    if (h.bund) s += `<rect x="28.9" y="79.6" width="6.2" height="3.2" rx="1.2" fill="${dunkler(farbe, 0.25)}"/>`;
    if (h.streifen) s += `<path d="M32 66V80" stroke="${h.streifen}" stroke-width="1"/>`;
    if (h.tasche) s += `<rect x="30" y="70.5" width="4" height="4.4" rx=".6" fill="${dunkler(farbe, 0.2)}" stroke="${L}" stroke-width=".5"/>`;
    if (h.karo) s += [68.5, 72.5, 76.5].map((y) => `<path d="M28.5 ${y}h7" stroke="#1d1d23" stroke-opacity=".5" stroke-width="1"/>`).join("");
    if (h.glitzer) s += `<g class="fg-glitzer" fill="#fff"><circle cx="30.5" cy="69" r=".55"/><circle cx="33.5" cy="74" r=".55"/><circle cx="31" cy="79" r=".55"/></g>`;
    if (h.schlag) s += `<path d="M28.5 76L27 83.6H37L35.5 76Z" fill="${farbe}" stroke="${L}" stroke-width="1"/>`;
    return s;
  }

  /* Hosenträger der Lederhose liegen über dem Oberteil. */
  function traeger(f, ansicht) {
    const h = hoseVon(f);
    if (h.rock) {
      const c = h.farbe, d = dunkler(c, 0.3);
      // Ein Mini (Jeansrock) endet höher und hat statt Falten eine Naht.
      const u = h.mini ? 74 : 78;
      if (ansicht === "seite") return `<path d="M23.4 66L41 66L${h.mini ? 42.2 : 43.4} ${u}Q32 ${u + 3} ${h.mini ? 22.2 : 21.2} ${u}Z" fill="${c}" stroke="${d}" stroke-width=".9"/>${h.mini ? `<path d="M23.6 68.4H40.8" stroke="${h.naht}" stroke-width=".6" stroke-dasharray="1 .8"/>` : `<path d="M27 67l-1.4 11M32 67v12.4M37 67l1.4 11" stroke="${d}" stroke-width=".6"/>`}`;
      if (h.mini) return `<path d="M19.4 66H44.6L46.4 ${u}Q32 ${u + 3.6} 17.6 ${u}Z" fill="${c}" stroke="${d}" stroke-width=".9"/><path d="M19.6 68.4H44.4M32 66V${u + 2.6}" stroke="${h.naht}" stroke-width=".6" stroke-dasharray="1 .8"/>`;
      return `<path d="M19.4 66H44.6L48 78Q32 82.4 16 78Z" fill="${c}" stroke="${d}" stroke-width=".9"/>${[22, 27, 32, 37, 42].map((x) => `<path d="M${x} 67l${(x - 32) * 0.18} 12" stroke="${d}" stroke-width=".6"/>`).join("")}`;
    }
    if (h.latz) {
      const c = h.farbe, d = dunkler(c, 0.3);
      if (ansicht === "seite") return `<path d="M34 50H40L40.8 68H33Z" fill="${c}" stroke="${d}" stroke-width=".8"/><path d="M30 45.5L35 51" stroke="${d}" stroke-width="1.6"/>`;
      if (ansicht === "hinten") return `<path d="M25 46L31 56L37.5 46M31 56V67" fill="none" stroke="${c}" stroke-width="2.2"/>`;
      return `<path d="M25.4 46L27 52M38.6 46L37 52" stroke="${c}" stroke-width="2.2"/><path d="M26 52H38V68H26Z" fill="${c}" stroke="${d}" stroke-width=".8"/><rect x="29.4" y="55" width="5.2" height="4.6" rx=".8" fill="none" stroke="${h.naht}" stroke-width=".6"/><circle cx="27.4" cy="53.4" r=".9" fill="#e2b656"/><circle cx="36.6" cy="53.4" r=".9" fill="#e2b656"/>`;
    }
    if (!h.traeger) return "";
    const c = "#4a2e14";
    if (ansicht === "seite") return `<path d="M30 45.5L31.5 67" stroke="${c}" stroke-width="1.8"/>`;
    if (ansicht === "hinten") return `<path d="M25 46L31 56L37.5 46M31 56V68" fill="none" stroke="${c}" stroke-width="1.8"/>`;
    return `<path d="M25.5 46L26.5 67.5M38.5 46L37.5 67.5M26 55.5H38" fill="none" stroke="${c}" stroke-width="1.8"/><rect x="29.5" y="53.5" width="5" height="4" rx=".8" fill="#2e7d4f" stroke="${c}" stroke-width=".6"/>`;
  }

  /* Schuhe */
  const SCHUHE = {
    standard:        { farbe: "#ece6d2", sohle: "#8b9a8c" },
    badelatschen:    { barfuss: true, riemen: "#1f4f9e" },
    socken_sandalen: { socke: "#f4f1ea", riemen: "#7a4b22" },
    skaterschuhe:    { farbe: "#1d1d23", sohle: "#f4f1ea", karo: true },
    stiefel:         { farbe: "#6b4423", sohle: "#2b1a0c", hoch: 5 },
    airsneaker:      { farbe: "#f4f4f4", sohle: "#d24a3c", dick: true },
    clogs:           { farbe: "#5ad16b", sohle: "#3a9c4a", loecher: true },
    lackschuhe:      { farbe: "#0f0f12", sohle: "#0f0f12", glanz: true },
    goldsneaker:     { farbe: "#e2b656", sohle: "#fff4d0", glanz: true },
    raketenstiefel:  { farbe: "#c8cdd4", sohle: "#6b7078", hoch: 4, rakete: true },
    ballerinas:      { farbe: "#f5b8c8", sohle: "#d98aa0", flach: true, schleife: "#e5534b" },
    plateau:         { farbe: "#f4f4f4", sohle: "#f06a8a", dick: true, plateau: true },
    pumps:           { farbe: "#b3261e", sohle: "#5c0f0c", flach: true, absatz: "#5c0f0c", glanz: true },
    overknees:       { farbe: "#1d1d23", sohle: "#0f0f12", hoch: 14, glanz: true, absatz: "#0f0f12" },
    glitzerheels:    { farbe: "#e2b656", sohle: "#8e6931", flach: true, absatz: "#8e6931", glitzer: true },
  };

  function schuh(f, x) {
    const sch = SCHUHE[f.k.schuhe] || SCHUHE.standard;
    if (sch.barfuss) {
      return `<rect x="${x - 0.8}" y="82.6" width="8.6" height="5.6" rx="2.4" fill="${f.haut}" stroke="${f.hautD}" stroke-width=".7"/>`
        + `<rect x="${x - 1.2}" y="82.4" width="9.4" height="3" rx="1.2" fill="${sch.riemen}"/><path d="M${x - 1.4} 88.4h10" stroke="#20242a" stroke-width="1.2"/>`;
    }
    if (sch.socke) {
      return `<rect x="${x + 0.2}" y="78" width="6.6" height="9.4" rx="1.6" fill="${sch.socke}" stroke="#b9b3a2" stroke-width=".5"/>`
        + `<path d="M${x - 0.6} 84.2h8.2M${x - 0.6} 86.4h8.2" stroke="${sch.riemen}" stroke-width="1.3"/><path d="M${x - 1.2} 88.2h9.4" stroke="${sch.riemen}" stroke-width="1.4"/>`;
    }
    const oben = 81.6 - (sch.hoch || 0) - (sch.dick ? 0.8 : 0) - (sch.plateau ? 1.4 : 0) + (sch.flach ? 2.2 : 0);
    const breit = sch.dick ? 1.2 : 0;
    let s = `<path d="M${x - 1.6 - breit} ${oben}h${10 + 2 * breit}q1.4 0 1.4 2.2v${4.6 + (88.2 - oben - 7)}q0 .4-.4.4h-${10.6 + 2 * breit}q-.4 0-.4-.4v-${4.6 + (88.2 - oben - 7)}q0-2.2 1.4-2.2z" fill="${sch.farbe}" stroke="${L}" stroke-width="1"/>`;
    s += `<path d="M${x - 2 - breit} ${sch.dick ? 86 : 86.6}h${11 + 2 * breit}" stroke="${sch.sohle}" stroke-width="${sch.dick ? 2.4 : 1.1}"/>`;
    if (sch.dick) s += `<rect x="${x + 4.4}" y="85.4" width="3.2" height="1.6" rx=".8" fill="#ff8a7a"/>`;
    if (sch.karo) s += `<g fill="#f4f1ea">${[0, 2, 4, 6].map((d) => `<rect x="${x - 0.6 + d}" y="${oben + 1 + (d % 4 ? 1.6 : 0)}" width="1.4" height="1.4"/>`).join("")}</g>`;
    if (sch.loecher) s += `<g fill="${dunkler(sch.farbe, 0.35)}"><circle cx="${x + 1}" cy="${oben + 2}" r=".6"/><circle cx="${x + 3.5}" cy="${oben + 1.6}" r=".6"/><circle cx="${x + 6}" cy="${oben + 2}" r=".6"/></g>`;
    if (sch.glanz) s += `<path d="M${x} ${oben + 1.6}q2.5-1 5 0" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".7"/>`;
    if (sch.hoch && !sch.rakete) s += `<path d="M${x + 1.5} ${oben + 1.5}h4M${x + 1.5} ${oben + 3.2}h4" stroke="#e9d3a8" stroke-width=".5"/>`;
    if (sch.rakete) s += `<g class="fg-rakete"><path d="M${x + 0.5} 88.6L${x + 3.5} 95L${x + 6.5} 88.6Z" fill="#ff8a3d"/><path d="M${x + 2} 88.6L${x + 3.5} 92.5L${x + 5} 88.6Z" fill="#ffe27a"/></g>`;
    if (sch.plateau) s += `<path d="M${x - 3.2} 87.6h13.4" stroke="${sch.sohle}" stroke-width="2.2"/>`;
    if (sch.schleife) s += `<path d="M${x + 3.5} ${oben + 1.2}l-2-1.2v2.4zM${x + 3.5} ${oben + 1.2}l2-1.2v2.4z" fill="${sch.schleife}"/>`;
    if (sch.absatz) s += `<rect x="${x + 6.2}" y="86.4" width="1.6" height="2.4" fill="${sch.absatz}"/>`;
    if (sch.glitzer) s += `<g class="fg-glitzer" fill="#fff"><circle cx="${x + 1}" cy="${oben + 2}" r=".5"/><circle cx="${x + 4}" cy="${oben + 3.4}" r=".5"/><circle cx="${x + 6.4}" cy="${oben + 1.8}" r=".5"/></g>`;
    return s;
  }

  function schuhSeite(f, dunkel) {
    const sch = SCHUHE[f.k.schuhe] || SCHUHE.standard;
    if (sch.barfuss) {
      return `<rect x="28.6" y="83" width="11.6" height="5.2" rx="2.4" fill="${dunkel ? f.hautD : f.haut}" stroke="${f.hautD}" stroke-width=".7"/><rect x="31" y="82.8" width="5" height="3" rx="1" fill="${sch.riemen}"/><path d="M27.8 88.4h13.4" stroke="#20242a" stroke-width="1.2"/>`;
    }
    if (sch.socke) {
      return `<rect x="28.8" y="78" width="7" height="9.4" rx="1.6" fill="${sch.socke}" stroke="#b9b3a2" stroke-width=".5"/><rect x="34" y="83.6" width="6" height="4" rx="1.6" fill="${sch.socke}"/><path d="M28.4 84.6h11.6M28.4 86.6h11.6M27.8 88.2h13.4" stroke="${sch.riemen}" stroke-width="1.2"/>`;
    }
    const farbe = dunkel ? dunkler(sch.farbe, 0.18) : sch.farbe;
    const oben = 82.5 - (sch.hoch || 0) - (sch.dick ? 0.8 : 0) - (sch.plateau ? 1.4 : 0) + (sch.flach ? 2 : 0);
    let s = sch.absatz
      // Mit Absatz: die Ferse steht hoch, die Spitze unten.
      ? `<path d="M27.5 ${oben}h9.5q4.5 0 4.5 ${88.2 - oben - 2.8}q0 2.8-3 2.8h-6l-1.4-2.6h-3.6z" fill="${farbe}" stroke="${L}" stroke-width="1"/><path d="M28 85.6V88.6" stroke="${sch.absatz}" stroke-width="1.8"/>`
      : `<path d="M27.5 ${oben}h9.5q4.5 0 4.5 ${88.2 - oben - 2.8}q0 2.8-3 2.8h-11z" fill="${farbe}" stroke="${L}" stroke-width="1"/>`;
    s += `<path d="M27.5 ${sch.dick ? 86.4 : 87.2}h14" stroke="${sch.sohle}" stroke-width="${sch.dick ? 2.4 : 1.2}"/>`;
    if (sch.dick) s += `<rect x="28.6" y="85.6" width="3.4" height="1.6" rx=".8" fill="#ff8a7a"/>`;
    if (sch.karo) s += `<g fill="#f4f1ea"><rect x="30" y="${oben + 1}" width="1.4" height="1.4"/><rect x="33" y="${oben + 2.4}" width="1.4" height="1.4"/><rect x="36" y="${oben + 1}" width="1.4" height="1.4"/></g>`;
    if (sch.loecher) s += `<g fill="${dunkler(sch.farbe, 0.35)}"><circle cx="31" cy="${oben + 2}" r=".6"/><circle cx="34" cy="${oben + 2}" r=".6"/><circle cx="37" cy="${oben + 2.4}" r=".6"/></g>`;
    if (sch.glanz) s += `<path d="M31 ${oben + 1.4}q3-1 6 .4" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".7"/>`;
    if (sch.rakete) s += `<g class="fg-rakete"><path d="M29 88.6L32 95L35 88.6Z" fill="#ff8a3d"/><path d="M30.5 88.6L32 92.5L33.5 88.6Z" fill="#ffe27a"/></g>`;
    if (sch.plateau) s += `<path d="M27.2 87.8h14.6" stroke="${sch.sohle}" stroke-width="2.2"/>`;
    if (sch.schleife) s += `<path d="M37 ${oben + 1}l-1.8-1.1v2.2zM37 ${oben + 1}l1.8-1.1v2.2z" fill="${sch.schleife}"/>`;
    if (sch.glitzer) s += `<g class="fg-glitzer" fill="#fff"><circle cx="31" cy="${oben + 1.6}" r=".5"/><circle cx="35" cy="${oben + 2.6}" r=".5"/><circle cx="38.6" cy="${oben + 3.4}" r=".5"/></g>`;
    return s;
  }

  /* Oberteile */
  const OBER = {
    tshirt:         { farbe: "#f2efe8", kurz: true, kragen: "rund" },
    hoodie:         { farbe: "#8d949c", kapuze: true },
    skatehoodie:    { farbe: "#c8453c", kapuze: true, druck: "skate" },
    trainingsjacke: { farbe: "#1d1f24", streifen: "#f2f2f2", zipper: true, kragen: "steh" },
    trikot:         { farbe: "#2f9e57", kurz: true, kragen: "v", nummer: "10", akzent: "#ffffff" },
    hawaiihemd:     { farbe: "#2aa3c9", kurz: true, kragen: "offen", muster: "blumen" },
    windbreaker:    { farbe: "#c8f03c", unten: "#7a3cf0", zipper: true, kragen: "steh" },
    weste:          { farbe: "#f4f1ea", weste: "#7a1f2b" },
    lederjacke:     { farbe: "#26262b", leder: true, kragen: "revers" },
    sakko:          { farbe: "#2c3550", kragen: "revers", hemd: "#f4f1ea", krawatte: "#b3261e" },
    pelzmantel:     { farbe: "#e8dcc4", pelz: true, lang: true },
    goldanzug:      { farbe: "#e2b656", kragen: "revers", hemd: "#1d1d23", krawatte: "#1d1d23", glanz: true },
    warnweste:      { farbe: "#f4f1ea", weste: "#ff7a1a", reflex: true, kurz: true },
    strickjacke:    { farbe: "#c9b48a", strick: true, knoepfe: true, kragen: "v" , akzent: "#a8926a" },
    kochjacke:      { farbe: "#f7f5ef", koch: true, kragen: "steh" },
    croptop:        { farbe: "#f06a8a", kurz: true, crop: true, kragen: "rund" },
    bluse:          { farbe: "#f6efe6", kragen: "rueschen", knoepfe: true },
    sommerkleid:    { farbe: "#7ec8e3", kurz: true, kleid: true, muster: "punkte", kragen: "rund" },
    glitzerkleid:   { farbe: "#a77ce0", aermellos: true, kleid: true, lang: false, bodenlang: true, glitzer: true },
    ballonseide:    { farbe: "#5b3fa8", unten: "#1fb3a6", ballon: "#f0509a", zipper: true, kragen: "steh", knistert: true },
  };

  /* Das Oberteil in Farben, auch für die Clubjacke (Farbe aus dem Stil). */
  function oberVon(f) {
    const o = OBER[f.k.oberteil];
    if (o) return { ...o, dunkel: dunkler(o.farbe) };
    return { farbe: f.jacke, dunkel: f.jackeD, clubjacke: true };
  }

  const RUMPF_VORN = "M21 45.6Q32 40.6 43 45.6L45.2 69Q32 74.2 18.8 69Z";
  const RUMPF_LANG = "M20.4 45.4Q32 40.4 43.6 45.4L46.6 77Q32 81 17.4 77Z";
  const RUMPF_SEITE = "M24.8 45.8Q32 41.8 39.4 45.8L40.8 69Q32 73 23.2 69Z";
  const RUMPF_SEITE_LANG = "M24.4 45.6Q32 41.6 39.8 45.6L41.8 77Q32 80 22.2 77Z";

  function fell(pfad, farbe) {
    return `<path d="${pfad}" fill="none" stroke="${farbe}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray=".1 2.6"/>`;
  }

  /** Der Rumpf. `ansicht` ist vorne, hinten oder seite. */
  function rumpf(f, ansicht, aufnaeher) {
    const o = oberVon(f);
    const seite = ansicht === "seite";
    const pfad = seite ? (o.lang ? RUMPF_SEITE_LANG : RUMPF_SEITE) : (o.lang ? RUMPF_LANG : RUMPF_VORN);
    const koerper = o.weste ? o.weste : o.crop ? f.haut : o.farbe;
    let s = `<path d="${pfad}" fill="${koerper}" stroke="${o.crop ? f.hautD : L}" stroke-width="1.1"/>`;
    // Crop-Top: der Bauch bleibt frei, das Oberteil endet unter der Brust.
    if (o.crop) s += `<path d="${seite ? "M24.8 45.8Q32 41.8 39.4 45.8L40 58Q32 60.6 24 58Z" : "M21 45.6Q32 40.6 43 45.6L44 58.4Q32 61.6 20 58.4Z"}" fill="${o.farbe}" stroke="${L}" stroke-width="1.1"/>`;
    if (o.unten) s += `<path d="${seite ? "M23.8 60L40.2 55L40.8 69Q32 73 23.2 69Z" : "M19.8 61L44.2 54L45.2 69Q32 74.2 18.8 69Z"}" fill="${o.unten}"/>`;
    if (o.pelz) s += fell(pfad, dunkler(o.farbe, 0.1));
    // Ballonseide: drei Farben schräg übereinander, und sie glänzt wie Folie.
    if (o.ballon) s += `<path d="${seite ? "M23.8 57.6L40.2 52.4L40.4 56.2L24 61.4Z" : "M19.6 57.4L44.4 50.2L44.7 54.4L19.9 61.6Z"}" fill="${o.ballon}"/><path d="${seite ? "M26 49L28.4 66" : "M24 48.6L26.6 67M39.6 47.6L41.2 56"}" stroke="#fff" stroke-opacity=".28" stroke-width="1.4" stroke-linecap="round"/>`;
    /* Etwas Tiefe: eine Schattenseite rechts, eine Glanzkante links. Nicht
       beim Goldanzug, der schimmert schon selbst. */
    if (!o.glanz) s += seite
      ? `<path d="M34 44.6Q38 45 39.4 45.8L40.8 69Q37 71 34.6 71.4Z" fill="#000" opacity=".12"/>`
      : `<path d="M38 43.8Q41 44.4 43 45.6L45.2 69Q42 71 38.8 71.8Z" fill="#000" opacity=".13"/><path d="M22.4 47.4L21.2 66" stroke="#fff" stroke-opacity=".14" stroke-width="1.2" stroke-linecap="round"/>`;
    if (o.reflex) s += seite
      ? `<path d="M24.4 56H40.4M23.8 62H40.6" stroke="#e8f0f2" stroke-width="2"/>`
      : `<path d="M19.8 56H44.2M19.4 62H44.6" stroke="#e8f0f2" stroke-width="2.2"/><path d="M19.8 56H44.2M19.4 62H44.6" stroke="#9fb1b8" stroke-width=".5"/>`;
    if (o.strick) s += `<path d="${seite ? "M26 50H38M25.4 56H39M25 62H39.6" : "M21 50H43M20.6 56H43.6M20.2 62H44"}" stroke="${dunkler(o.farbe, 0.15)}" stroke-width=".7" stroke-dasharray="1.2 1"/>`;
    if (o.koch && ansicht === "vorne") s += [[27.6, 51], [27.6, 57], [27.6, 63], [36.4, 51], [36.4, 57], [36.4, 63]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#c9c1ac"/>`).join("") + `<path d="M32 47V70" stroke="#d9d3c4" stroke-width=".7"/>`;
    if (o.knoepfe && ansicht === "vorne") s += [52, 57, 62, 67].map((y) => `<circle cx="32" cy="${y}" r=".9" fill="#6b4a2e"/>`).join("") + `<path d="M32 50V70" stroke="${dunkler(o.farbe, 0.25)}" stroke-width=".7"/>`;
    if (o.glanz) s += `<path class="fg-schimmer" d="${seite ? "M27 48L29 68" : "M24 48L27 68"}" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`;
    /* Kleider fallen ab der Taille über die Beine, das bodenlange bis zu
       den Knöcheln. Gezeichnet nach den Beinen, also davor. */
    if (o.kleid) {
      const u = o.bodenlang ? 86 : 80, d = dunkler(o.farbe, 0.28);
      const rock = seite ? `M23.4 63H40.6L${o.bodenlang ? 44.6 : 43.4} ${u}Q32 ${u + 3} ${o.bodenlang ? 19.4 : 20.6} ${u}Z` : `M19.2 63H44.8L${o.bodenlang ? 50.4 : 49} ${u}Q32 ${u + 4} ${o.bodenlang ? 13.6 : 15} ${u}Z`;
      s += `<path d="${rock}" fill="${o.farbe}" stroke="${L}" stroke-width="1"/><path d="${seite ? "M24 63.4H40" : "M19.6 63.4H44.4"}" stroke="${d}" stroke-width="1.2"/>`;
      if (!seite) s += `<path d="M27 66L25 ${u}M37 66L39 ${u}" stroke="${d}" stroke-opacity=".6" stroke-width=".7"/>`;
      if (o.muster === "punkte") s += `<g fill="#fff" opacity=".85">${(seite ? [[27, 68], [34, 72], [29, 77], [38, 76]] : [[22, 68], [30, 70], [40, 69], [25, 75], [35, 76], [44, 75], [31, 80]]).map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9"/>`).join("")}</g>`;
      if (o.glitzer) s += `<g class="fg-glitzer" fill="#fff">${(seite ? [[27, 50], [35, 57], [29, 70], [38, 78], [26, 82]] : [[24, 50], [38, 52], [30, 60], [42, 66], [22, 72], [34, 78], [46, 82], [18, 83]]).map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".6"/>`).join("")}</g>`;
    }
    if (o.clubjacke) {
      if (!seite) s += `<path d="M19.4 65.6Q32 70.8 44.6 65.6L45.2 69.4Q32 74.6 18.8 69.4Z" fill="${o.dunkel}"/>`;
      else s += `<path d="M23.6 65.6Q32 69.6 40.4 65.6L40.8 69.4Q32 73.4 23.2 69.4Z" fill="${o.dunkel}"/>`;
    }
    if (ansicht === "vorne") {
      if (o.clubjacke) {
        s += `<path d="M27.4 44.4L32 50.4L36.6 44.4Z" fill="#1f2e2a"/><path d="M26.2 44.6L32 51.2L37.8 44.6" fill="none" stroke="#e8e2cc" stroke-opacity=".7" stroke-width="1.1"/><path d="M32 51.5V69.6" stroke="#000" stroke-opacity=".3" stroke-width=".9"/>`;
        s += aufnaeher;
      }
      if (o.kragen === "rund") s += `<path d="M27.5 43.8Q32 47.6 36.5 43.8" fill="none" stroke="${dunkler(o.farbe, 0.2)}" stroke-width="1.2"/>`;
      if (o.kragen === "rueschen") s += `<path d="M26.4 44.2q1.4 1.8 2.8 0q1.4 1.8 2.8 0q1.4 1.8 2.8 0q1.4 1.8 2.8 0" fill="none" stroke="#d8cbb6" stroke-width="1.2"/><path d="M32 47q1.6 1.4 0 2.8q1.6 1.4 0 2.8q1.6 1.4 0 2.8" fill="none" stroke="#d8cbb6" stroke-width="1.1"/>`;
      if (o.aermellos) s += `<path d="M24 45.2L26.6 43M40 45.2L37.4 43" stroke="${dunkler(o.farbe, 0.2)}" stroke-width="1.4"/><path d="M26 44.6Q32 49 38 44.6" fill="none" stroke="${dunkler(o.farbe, 0.25)}" stroke-width="1"/>`;
      if (o.kragen === "v") s += `<path d="M27.2 43.8L32 50L36.8 43.8" fill="${f.haut}" stroke="${o.akzent}" stroke-width="1.2"/>`;
      if (o.kragen === "steh") s += `<path d="M27 42.8L27.4 46.6Q32 48.4 36.6 46.6L37 42.8" fill="${o.farbe}" stroke="${L}" stroke-width=".8"/>`;
      if (o.zipper) s += `<path d="M32 47.2V70.6" stroke="#c0c6cc" stroke-width=".9"/><rect x="31.2" y="50" width="1.6" height="2.6" rx=".4" fill="#c0c6cc"/>`;
      if (o.kragen === "offen") s += `<path d="M27.4 44.2L32 52.6L36.6 44.2Z" fill="${f.haut}"/><path d="M26 44.4L29.6 51.6L32 52.6M38 44.4L34.4 51.6L32 52.6" fill="none" stroke="${dunkler(o.farbe, 0.3)}" stroke-width="1.1"/><path d="M32 53V70" stroke="${dunkler(o.farbe, 0.3)}" stroke-width=".6" stroke-dasharray="1 3"/>`;
      if (o.kragen === "revers") {
        s += `<path d="M27.2 44L32 56.4L36.8 44Z" fill="${o.hemd || "#2a2a30"}"/>`;
        if (o.krawatte) s += `<path d="M31 46.4h2l.6 1.6-.9 7.6-.7 1.2-.7-1.2-.9-7.6z" fill="${o.krawatte}"/>`;
        s += `<path d="M26.2 44.2L29.4 52.6L27.4 53.8L32 60.4M37.8 44.2L34.6 52.6L36.6 53.8L32 60.4" fill="none" stroke="${o.leder ? "#55555c" : dunkler(o.farbe, 0.35)}" stroke-width="1.1"/>`;
        s += `<circle cx="32" cy="63" r=".8" fill="${dunkler(o.farbe, 0.4)}"/><circle cx="32" cy="66.4" r=".8" fill="${dunkler(o.farbe, 0.4)}"/>`;
      }
      if (o.leder) s += `<path d="M34.8 50.5L29.2 70.2" stroke="#c0c6cc" stroke-width=".9"/><path d="M22 52.4q2.6 1 5 0" fill="none" stroke="#3a3a42" stroke-width=".8"/>`;
      if (o.kapuze) s += `<path d="M25.6 44.2Q32 50 38.4 44.2" fill="none" stroke="${dunkler(o.farbe, 0.25)}" stroke-width="2.4"/><path d="M29.6 47.2V54.6M34.4 47.2V54.6" stroke="#f4f1ea" stroke-width=".8"/><rect x="25.2" y="59.8" width="13.6" height="7" rx="2.8" fill="${dunkler(o.farbe, 0.12)}" stroke="${dunkler(o.farbe, 0.3)}" stroke-width=".7"/>`;
      if (o.druck === "skate") s += `<g transform="translate(32 53.4) rotate(-12)"><rect x="-6" y="-1.3" width="12" height="2.6" rx="1.3" fill="#f2c94c"/><circle cx="-3.6" cy="2" r="1" fill="#f4f1ea"/><circle cx="3.6" cy="2" r="1" fill="#f4f1ea"/></g>`;
      if (o.nummer) s += `<text x="32" y="63.6" text-anchor="middle" font-size="8.5" font-weight="900" fill="${o.akzent}" font-family="ui-rounded, system-ui">${o.nummer}</text><path d="M19.6 56.2H44.4" stroke="${o.akzent}" stroke-opacity=".6" stroke-width="1"/>`;
      if (o.muster === "blumen") s += blumen([[24, 50], [38, 49], [27, 60], [36.5, 62], [42, 57], [22, 65.5], [31.6, 68]]);
      if (o.streifen) s += `<path d="M20.4 50V68M43.6 50V68" stroke="${o.streifen}" stroke-width="1.3"/>`;
      if (o.weste && !o.reflex) {
        s += `<path d="M27.2 44L32 55.6L36.8 44Z" fill="${o.farbe}"/><path d="M26.4 44L32 57.6L37.6 44" fill="none" stroke="${dunkler(o.weste, 0.3)}" stroke-width="1"/>`;
        s += [59.5, 63, 66.5].map((y) => `<circle cx="32" cy="${y}" r=".75" fill="#e2b656"/>`).join("");
      }
      if (o.reflex) s += `<path d="M27.2 44L32 50L36.8 44Z" fill="${o.farbe}"/><path d="M32 50V70" stroke="#c85a12" stroke-width=".8"/>`;
    } else if (ansicht === "hinten") {
      if (o.clubjacke) s += `<path d="M22 47Q32 43.4 42 47" fill="none" stroke="${o.dunkel}" stroke-width="2"/><circle cx="32" cy="56.5" r="4.2" fill="none" stroke="#e8e2cc" stroke-opacity=".55" stroke-width="1.1"/><path d="M32 53.6l2.2 2.9-2.2 2.9-2.2-2.9z" fill="#e8e2cc" fill-opacity=".55"/>`;
      if (o.kapuze) s += `<path d="M24.6 44Q32 41 39.4 44L37.8 54Q32 57.2 26.2 54Z" fill="${dunkler(o.farbe, 0.12)}" stroke="${dunkler(o.farbe, 0.3)}" stroke-width=".8"/>`;
      if (o.nummer) s += `<text x="32" y="65" text-anchor="middle" font-size="12" font-weight="900" fill="${o.akzent}" font-family="ui-rounded, system-ui">${o.nummer}</text>`;
      if (o.muster === "blumen") s += blumen([[25, 50], [38, 52], [30, 58], [41, 62], [23, 64], [34, 67]]);
      if (o.streifen) s += `<path d="M20.4 50V68M43.6 50V68" stroke="${o.streifen}" stroke-width="1.3"/>`;
      if (o.kragen === "steh") s += `<path d="M27 42.8L27.4 46.4Q32 47.8 36.6 46.4L37 42.8Z" fill="${o.farbe}" stroke="${L}" stroke-width=".8"/>`;
      if (o.weste) s += `<path d="M24 60Q32 62.4 40 60" fill="none" stroke="#2a1014" stroke-width="1.4"/>`;
      if (o.kragen === "revers") s += `<path d="M26 44.2Q32 47 38 44.2" fill="none" stroke="${dunkler(o.farbe, 0.35)}" stroke-width="1.6"/>`;
    } else {
      if (o.clubjacke) s += `<path d="M36.2 44.8L39.8 50" fill="none" stroke="#e8e2cc" stroke-opacity=".7" stroke-width="1.1"/>`;
      if (o.kapuze) s += `<path d="M24.4 45.4Q23.6 52 26.6 55.6L29.4 46Z" fill="${dunkler(o.farbe, 0.15)}" stroke="${dunkler(o.farbe, 0.3)}" stroke-width=".7"/>`;
      if (o.kragen === "revers" || o.kragen === "offen") s += `<path d="M36.2 44.4L39.4 52.6" stroke="${o.hemd || f.haut}" stroke-width="2.2"/>`;
      if (o.krawatte) s += `<path d="M39.2 47L40 56" stroke="${o.krawatte}" stroke-width="1.5"/>`;
      if (o.zipper) s += `<path d="M39.8 47.6L40.6 69" stroke="#c0c6cc" stroke-width=".8"/>`;
      if (o.muster === "blumen") s += blumen([[30, 50], [35, 58], [28, 63], [37, 66]]);
      if (o.nummer) s += `<path d="M23.6 56.2H40.4" stroke="${o.akzent}" stroke-opacity=".6" stroke-width="1"/>`;
      if (o.weste) s += `<path d="M36.4 44.6L39.8 54" stroke="${o.farbe}" stroke-width="2.4"/>`;
    }
    return s;
  }

  function blumen(punkte) {
    return punkte.map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="1.5" fill="#f9e27a"/>${[0, 72, 144, 216, 288].map((w) => `<circle cx="${(Math.cos((w * Math.PI) / 180) * 1.9).toFixed(2)}" cy="${(Math.sin((w * Math.PI) / 180) * 1.9).toFixed(2)}" r="1.1" fill="#f06a8a"/>`).join("")}<circle r=".7" fill="#f9e27a"/></g>`).join("");
  }

  /** Ein Ärmel mit Hand. `x` bestimmt die Seite (links 0, rechts gespiegelt). */
  function aermel(f, rechts, seite, hinterer) {
    const o0 = oberVon(f);
    // Ärmellos: der Arm ist Haut, gezeichnet wie ein langer Ärmel.
    const o = o0.aermellos ? { farbe: f.haut } : o0;
    const farbe = o.farbe;
    const dunkel = hinterer ? dunkler(farbe, 0.25) : farbe;
    const haut = hinterer ? f.hautD : f.haut;
    if (seite) {
      const lang = `<path d="M29.4 47Q35.4 45.8 35.8 52L35.4 64.2L30.4 64.4L29.2 53Z" fill="${dunkel}" stroke="${L}" stroke-width="1"/>`;
      const kurz = `<path d="M29.8 53.4L30.4 64.4L35.4 64.2L35.6 53.6Z" fill="${haut}" stroke="${f.hautD}" stroke-width=".7"/><path d="M29.4 47Q35.4 45.8 35.8 52L35.6 54.4L29.8 54.4L29.2 53Z" fill="${dunkel}" stroke="${L}" stroke-width="1"/>`;
      let s = o.kurz ? kurz : lang;
      if (o.streifen && !o.kurz) s += `<path d="M33.6 47.4L33.2 63.6" stroke="${o.streifen}" stroke-width="1.1"/>`;
      if (o.pelz) s += fell("M29.4 47Q35.4 45.8 35.8 52L35.4 64.2", dunkler(farbe, 0.1));
      return s + `<circle cx="33" cy="66.2" r="3.1" fill="${haut}" stroke="${f.hautD}" stroke-width=".7"/>`;
    }
    const spiegel = (d) => (rechts ? d.replace(/([ML]|Q|\s)(-?[\d.]+)(\s)(-?[\d.]+)/g, (m, c, x, sp, y) => `${c}${(64 - Number(x)).toFixed(1)}${sp}${y}`) : d);
    const langP = spiegel("M22.4 46.4Q16.8 48 16.3 55.5L15.9 64.3L21.3 64.6L22.9 54.6Z");
    const kappeP = spiegel("M22.4 46.4Q16.8 48 16.5 54.8L22.7 55.2Z");
    const unterP = spiegel("M16.5 54.8L15.9 64.3L21.3 64.6L22.7 55.2Z");
    let s = o.kurz
      ? `<path d="${unterP}" fill="${haut}" stroke="${f.hautD}" stroke-width=".7"/><path d="${kappeP}" fill="${dunkel}" stroke="${L}" stroke-width="1"/>`
      : `<path d="${langP}" fill="${dunkel}" stroke="${L}" stroke-width="1"/>`;
    if (o.streifen && !o.kurz) s += `<path d="M${rechts ? 45.2 : 18.8} 48.4L${rechts ? 45.6 : 18.4} 63.8" stroke="${o.streifen}" stroke-width="1.1"/>`;
    if (o.pelz) s += fell(spiegel("M22.4 46.4Q16.8 48 16.3 55.5L15.9 64.3"), dunkler(farbe, 0.1));
    if (o.muster === "blumen" && o.kurz) s += blumen([[rechts ? 43.5 : 20.5, 50.5]]);
    if (o.nummer && o.kurz) s += `<path d="${spiegel("M16.6 54.2L22.6 54.6")}" stroke="${o.akzent}" stroke-width="1"/>`;
    const hx = rechts ? 45.4 : 18.6;
    return s + `<circle cx="${hx}" cy="66.2" r="3.1" fill="${haut}" stroke="${f.hautD}" stroke-width=".7"/>`;
  }

  /* Frisuren. Die Farbe kommt aus der Grundform, außer bei den zwei
     Stücken, die ihre eigene haben. */
  const FRISUR_FARBE = { regenbogen_iro: null, sternenhaar: "#1d2250", meerjungfrau: "#36b8c4" };

  function haarFarbe(f) {
    if (f.k.frisur && FRISUR_FARBE[f.k.frisur] !== undefined && FRISUR_FARBE[f.k.frisur]) return FRISUR_FARBE[f.k.frisur];
    return f.haar;
  }

  function sterne(punkte) {
    return `<g class="fg-funkeln-haar" fill="#fff3b0">${punkte.map(([x, y]) => `<path d="M${x} ${y - 1.3}l.4 .9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4z"/>`).join("")}</g>`;
  }

  const REGENBOGEN = ["#e5534b", "#f0a23b", "#e9d44a", "#4fb76a", "#4a8fe0", "#8d5bd6"];

  /** Haar hinter dem Kopf (nur bei langen Frisuren). Null: Grundform zeichnen. */
  function frisurHinten(f, ansicht) {
    const id = f.k.frisur;
    if (!id) return null;
    const c = haarFarbe(f), d = dunkler(c, 0.35);
    const k = `fill="${c}" stroke="${d}" stroke-width=".8"`;
    if (id === "vokuhila") {
      if (ansicht === "seite") return `<path d="M19.5 28Q16.5 42 21 47Q25 45.6 26.4 40L25 30Z" ${k}/>`;
      if (ansicht === "vorne") return `<path d="M18.6 32Q17.4 43 21.6 46L24.2 38ZM45.4 32Q46.6 43 42.4 46L39.8 38Z" ${k}/>`;
      return "";
    }
    if (id === "zoepfe" && ansicht === "vorne") return "";
    if (id === "afro") return `<circle cx="32" cy="24" r="${ansicht === "seite" ? 18 : 19.5}" ${k}/>`;
    if (id === "sternenhaar" && ansicht !== "hinten") return `<path d="M17.2 28Q15 44 20 50Q25 49 24.6 40L39.4 40Q39 49 44 50Q49 44 46.8 28Z" ${k}/>`;
    /* Lange Haare fallen hinter dem Körper bis über die Schultern. */
    if (id === "wellen" || id === "meerjungfrau") {
      const welle = "M16.6 28Q13.6 38 16.4 46Q14.6 52 18 58Q22 60 24 54Q22.6 48 24.6 42L39.4 42Q41.4 48 40 54Q42 60 46 58Q49.4 52 47.6 46Q50.4 38 47.4 28Z";
      if (ansicht === "seite") return `<path d="M20 26Q15 40 18 50Q16 56 20 60Q26 60 27 52Q25 44 27 36Z" ${k}/>`;
      if (ansicht === "vorne") return `<path d="${welle}" ${k}/>${id === "meerjungfrau" ? `<path d="M18 46q2 4 1 9M46 46q-2 4-1 9" stroke="#b07fe0" stroke-width="1.6" fill="none"/>` : ""}`;
      return "";
    }
    if (id === "pferdeschwanz" && ansicht === "seite") return `<path class="fg-zopf-wippt" d="M21 18Q13 22 14 34Q14.6 42 18.6 46Q19 38 21.6 30Q22.6 24 24 20Z" ${k}/><circle cx="22" cy="18.6" r="1.6" fill="#e5534b"/>`;
    return "";
  }

  /** Haar vor dem Kopf (vorn und seitlich) bzw. über dem Hinterkopf. */
  function frisurVorn(f, ansicht) {
    const id = f.k.frisur;
    if (!id) return null;
    const c = haarFarbe(f), d = dunkler(c, 0.35);
    const k = `fill="${c}" stroke="${d}" stroke-width=".8"`;
    const seite = ansicht === "seite", hinten = ansicht === "hinten";
    switch (id) {
      case "glatze":
        return `<path d="${seite ? "M26 20q4-5 10-4" : "M24 19q5-4.5 11-3.4"}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>`;
      case "undercut":
        if (hinten) return `<path d="M18.8 30Q17.6 17 32 15.6Q46.4 17 45.2 30Q44 22 32 21Q20 22 18.8 30Z" fill="${d}" opacity=".45"/><path d="M20 22Q20 12 32 11.6Q44 12 44 22Q38 19 32 19.4Q26 19 20 22Z" ${k}/>`;
        if (seite) return `<path d="M20.6 30Q19 18 26 15L28 22Q23 24 20.6 30Z" fill="${d}" opacity=".45"/><path d="M22.4 20Q23 11 34 11.6Q45 12.6 46.4 21Q40 16.8 33 18Q27 20.6 22.4 20Z" ${k}/>`;
        return `<path d="M18.8 29Q18 21 20.6 18.6L22 26ZM45.2 29Q46 21 43.4 18.6L42 26Z" fill="${d}" opacity=".45"/><path d="M20.4 20Q20.6 10.8 33 10.8Q45 11.4 44.6 21.2Q41 16.4 35 17.6Q26.4 19.8 20.4 20Z" ${k}/>`;
      case "mittelscheitel":
        if (hinten) return `<path d="M18.4 31Q16.8 13 32 12.8Q47.2 13 45.6 31Q45 39 38.4 41H25.6Q19 39 18.4 31Z" ${k}/>`;
        if (seite) return `<path d="M19.6 32Q17.4 12.8 33.4 12.8Q46 13.6 45.6 27.6Q43.4 22 40.2 20.4Q36.6 23 30 26.4Q27 33 23 37Q19.6 36 19.6 32Z" ${k}/>`;
        return `<path d="M18.2 32Q16 12.6 32 12.6Q48 12.6 45.8 32Q44.4 24 39.6 20.4Q35 19.6 32 15.6Q29 19.6 24.4 20.4Q19.6 24 18.2 32Z" ${k}/><path d="M32 15.4V19" stroke="${d}" stroke-width=".8"/>`;
      case "dutt":
        if (seite) return `<path d="M19.6 31Q17.8 14 33 13.4Q45 13.8 45 24Q39 19.6 32 20Q24 22 19.6 31Z" ${k}/><circle cx="27" cy="11" r="4.6" ${k}/>`;
        return `<path d="M18.6 30Q17.2 14 32 13.6Q46.8 14 45.4 30Q42 20 32 19.8Q22 20 18.6 30Z" ${k}/><circle cx="32" cy="9.4" r="5" ${k}/><path d="M28 12.4Q32 14.4 36 12.4" fill="none" stroke="#d24a3c" stroke-width="1.2"/>`;
      case "vokuhila":
        if (hinten) return `<path d="M18.6 30Q17.4 14 32 13.6Q46.6 14 45.4 30Q45.8 44 40 47H24Q18.2 44 18.6 30Z" ${k}/>`;
        if (seite) return `<path d="M19.6 31Q17.6 13.4 33 13.2Q45.4 13.8 45 23Q41 19.4 34.6 20.4Q31 25.4 27.4 29Q25 33 22.6 34Q19.6 33.6 19.6 31Z" ${k}/>`;
        return `<path d="M18.8 28.6Q17.4 13.8 32 13.4Q46.6 13.8 45.2 28.6Q43.8 21 38.6 19.8Q32 22.6 25.4 19.8Q20.2 21 18.8 28.6Z" ${k}/>`;
      case "zoepfe": {
        const zopf = (x) => `<path d="M${x - 2.4} 30Q${x - 3} 40 ${x} 49Q${x + 3} 40 ${x + 2.4} 30Z" ${k}/><path d="M${x - 2} 35h4M${x - 2.2} 40h4.4M${x - 1.6} 45h3.2" stroke="${d}" stroke-width=".7"/><circle cx="${x}" cy="49" r="1.3" fill="#e5534b"/>`;
        if (hinten) return `<path d="M18.4 30Q16.8 13 32 12.8Q47.2 13 45.6 30Q45 38 40 40H24Q19 38 18.4 30Z" ${k}/><path d="M32 13V40" stroke="${d}" stroke-width=".8"/>${zopf(20)}${zopf(44)}`;
        if (seite) return `<path d="M19.6 31Q17.6 13 33 13Q45.6 13.4 45 23Q39.6 19.6 33 20.4Q27.4 24 24.6 30Z" ${k}/>${zopf(22)}`;
        return `<path d="M18.6 29Q17.2 13.4 32 13.2Q46.8 13.4 45.4 29Q42 19.4 32 19.2Q22 19.4 18.6 29Z" ${k}/><path d="M32 13.2V19" stroke="${d}" stroke-width=".8"/>${zopf(18.6)}${zopf(45.4)}`;
      }
      case "irokese":
      case "regenbogen_iro": {
        const bunt = id === "regenbogen_iro";
        const farbe = (i) => (bunt ? REGENBOGEN[i % REGENBOGEN.length] : c);
        if (seite) {
          const zacken = [[24, 20, 18, 12], [28, 15.6, 24, 5], [33, 14, 32, 2], [38, 15, 40, 4], [42, 19, 46.6, 10]];
          return `<path d="M20.6 31Q19 18 26 15.4L27.6 22Q23 24 20.6 31Z" fill="${d}" opacity=".35"/>`
            + zacken.map(([x, y, tx, ty], i) => `<path d="M${x - 3} ${y + 1}L${tx} ${ty}L${x + 3} ${y + 1}Z" fill="${farbe(i)}" stroke="${bunt ? dunkler(farbe(i), 0.3) : d}" stroke-width=".7"/>`).join("");
        }
        const streifen = hinten ? "M28.6 14Q32 12 35.4 14L35 40H29Z" : "M28.4 17Q32 14 35.6 17L34.8 22H29.2Z";
        let s = `<path d="M18.6 30Q18 21 21 17.6M45.4 30Q46 21 43 17.6" fill="none" stroke="${d}" stroke-opacity=".35" stroke-width="1.6"/>`;
        s += `<path d="${streifen}" fill="${farbe(2)}" stroke="${d}" stroke-width=".7"/>`;
        s += [[29, 5], [32, 1], [35, 5]].map(([x, y], i) => `<path d="M${x - 2.6} 17L${x} ${y}L${x + 2.6} 17Z" fill="${farbe(i + 1)}" stroke="${bunt ? dunkler(farbe(i + 1), 0.3) : d}" stroke-width=".7"/>`).join("");
        return s;
      }
      case "afro":
        if (hinten) return `<circle cx="32" cy="26" r="17" ${k}/>`;
        if (seite) return `<path d="M20 34Q12 24 18 14Q26 5 38 8Q48 12 47 22Q42 18 35 19Q30 25 27 32Q24 37 20 34Z" ${k}/>`;
        return `<path d="M17.4 30Q13 16 22 10.6Q32 4.6 42 10.6Q51 16 46.6 30Q44 20 38 18.6Q32 21.6 26 18.6Q20 20 17.4 30Z" ${k}/>`;
      case "tolle":
        if (hinten) return `<path d="M18.6 30Q17.4 14 32 13Q46.6 14 45.4 30Q45.6 38 40 40H24Q18.4 38 18.6 30Z" ${k}/>`;
        if (seite) return `<path d="M19.6 31Q17.6 14 30 12.4Q40 6 50 11Q48 16 44 19Q39 18.6 34.4 20.6Q29 25 25 31Q22 35 19.6 31Z" ${k}/><path d="M36 10Q44 8.6 48.6 11" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>`;
        return `<path d="M18.6 29Q17.2 14 26 11Q31 3.6 41 6.4Q47.6 9 45.6 17.4Q46.6 22 45.4 29Q43 21 36 20Q28 20.8 22 22.4Q19.6 24.6 18.6 29Z" ${k}/><path d="M29 9.6Q36 6.4 42.6 9.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>`;
      case "pferdeschwanz":
        if (hinten) return `<path d="M18.6 30Q17.2 13.4 32 13.2Q46.8 13.4 45.4 30Q43 22 32 21Q21 22 18.6 30Z" ${k}/><path class="fg-zopf-wippt" d="M29.4 14Q26 26 28.4 40Q32 46 35.6 40Q38 26 34.6 14Z" ${k}/><circle cx="32" cy="15" r="2" fill="#e5534b"/>`;
        if (seite) return `<path d="M19.8 30Q18 13.4 33 13Q45.4 13.6 45 23Q40 18.6 33 19.6Q26 21.6 21.6 28Z" ${k}/>`;
        return `<path d="M18.6 29Q17.4 13.2 32 13Q46.6 13.2 45.4 29Q43.6 20.6 38 19.2Q32 20.4 26 19.2Q20.4 20.6 18.6 29Z" ${k}/><circle cx="32" cy="11.4" r="2.6" ${k}/>`;
      case "bob":
        if (hinten) return `<path d="M17.4 33Q15.6 12.6 32 12.4Q48.4 12.6 46.6 33Q46 38 42 39H22Q18 38 17.4 33Z" ${k}/>`;
        if (seite) return `<path d="M19 36Q16.6 12.6 33 12.4Q46.6 13 46 25Q42 18 34 19Q32 26 29.6 33Q27 38 22 38Q19.6 38 19 36Z" ${k}/>`;
        return `<path d="M17.4 37Q15.4 12.4 32 12.2Q48.6 12.4 46.6 37Q44.6 38.6 42.6 36Q42.6 26 40.4 22.6H23.6Q21.4 26 21.4 36Q19.4 38.6 17.4 37Z" ${k}/><path d="M23.6 22.6Q32 25 40.4 22.6" fill="none" stroke="${d}" stroke-width=".8"/>`;
      case "wellen":
      case "meerjungfrau": {
        const extra = id === "meerjungfrau" ? sterne([[24, 18], [40, 20], [30, 14]]) : "";
        if (hinten) return `<path d="M17 30Q15 12.4 32 12.4Q49 12.4 47 30Q50 40 47 48Q49 56 45 60H19Q15 56 17 48Q14 40 17 30Z" ${k}/>${id === "meerjungfrau" ? `<path d="M24 30q-2 12 1 26M40 30q2 12-1 26" stroke="#b07fe0" stroke-width="1.6" fill="none"/>` : ""}${extra}`;
        if (seite) return `<path d="M19.4 32Q17 12.6 33 12.4Q46.4 13 45.6 26Q41 18.6 33.6 20Q29 24 26 30Q24 36 22 40Q19.4 38 19.4 32Z" ${k}/>${extra}`;
        return `<path d="M17.6 32Q15.8 12.4 32 12.2Q48.2 12.4 46.4 32Q44.6 22 39 19.6Q30 18 26 22Q21 24 19.8 34Z" ${k}/>${extra}`;
      }
      case "space_buns":
        if (hinten) return `<path d="M18.6 30Q17.2 14 32 13.6Q46.8 14 45.4 30Q42 20 32 19.8Q22 20 18.6 30Z" ${k}/><circle cx="21.4" cy="13.4" r="5" ${k}/><circle cx="42.6" cy="13.4" r="5" ${k}/>`;
        if (seite) return `<path d="M19.6 31Q17.8 14 33 13.4Q45 13.8 45 24Q39 19.6 32 20Q24 22 19.6 31Z" ${k}/><circle cx="27" cy="11.4" r="5" ${k}/>`;
        return `<path d="M18.6 30Q17.2 14 32 13.6Q46.8 14 45.4 30Q42 20 32 19.8Q22 20 18.6 30Z" ${k}/><circle cx="21" cy="12.6" r="5.2" ${k}/><circle cx="43" cy="12.6" r="5.2" ${k}/><path d="M18.6 12q2.4 2 4.8 0M40.6 12q2.4 2 4.8 0" fill="none" stroke="${d}" stroke-width=".7"/>`;
      case "sternenhaar":
        if (hinten) return `<path d="M18.4 30Q16.8 12.8 32 12.8Q47.2 12.8 45.6 30Q45.4 50 42 50H22Q18.6 50 18.4 30Z" ${k}/>${sterne([[25, 22], [36, 30], [29, 42], [40, 19]])}`;
        if (seite) return `<path d="M19.3 33Q17 12.6 33 12.6Q46 13 45.3 24.5Q40.5 19.8 34 21Q30 26 27.5 31Q26.5 40 27.5 48Q21 45 19.3 33Z" ${k}/>${sterne([[25, 22], [23, 38], [37, 16]])}`;
        return `<path d="M18 31Q16.2 12.5 32 12.4Q47.8 12.5 46 31Q44 21 38 19.5Q33 24 25 21.5Q20 24 18 31Z" ${k}/>${sterne([[24, 18], [38, 16], [31, 14]])}`;
      default:
        return null;
    }
  }

  /* Brillen. Von hinten sieht man nur das Band der Skibrille. */
  function brille(f, ansicht) {
    const id = f.k.brille;
    if (!id) return "";
    const seite = ansicht === "seite";
    if (ansicht === "hinten") return id === "skibrille" ? `<path d="M18.6 29.6Q32 32.6 45.4 29.6" fill="none" stroke="#1d1d23" stroke-width="2.6"/>` : "";
    const buegel = (farbe) => `<path d="M${seite ? "37 30.4L28.6 30" : ""}" stroke="${farbe}" stroke-width=".9"/>`;
    switch (id) {
      case "hornbrille":
        if (seite) return `<rect x="37" y="28.4" width="5.4" height="4.8" rx="1.6" fill="#ffffff" fill-opacity=".15" stroke="#4a2e14" stroke-width="1.1"/>${buegel("#4a2e14")}`;
        return `<rect x="23.4" y="28.4" width="7.2" height="5.4" rx="1.8" fill="#fff" fill-opacity=".15" stroke="#4a2e14" stroke-width="1.2"/><rect x="33.4" y="28.4" width="7.2" height="5.4" rx="1.8" fill="#fff" fill-opacity=".15" stroke="#4a2e14" stroke-width="1.2"/><path d="M30.6 30.4h2.8" stroke="#4a2e14" stroke-width="1.1"/>`;
      case "sonnenbrille":
        if (seite) return `<path d="M36.6 28.6h6.4v3.4q-3.2 2.2-6.4 0z" fill="#111317" stroke="#000" stroke-width=".6"/>${buegel("#111317")}`;
        return `<path d="M22.8 28.6h8v3.2q-4 3.2-8 0zM33.2 28.6h8v3.2q-4 3.2-8 0z" fill="#111317" stroke="#000" stroke-width=".6"/><path d="M30.8 29.2h2.4" stroke="#111317" stroke-width="1.1"/><path d="M24 29.8l2-.8M34.4 29.8l2-.8" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/>`;
      case "herzbrille": {
        const herz = (x) => `<path d="M${x} 33.6l-3.6-3.6q-1.8-2.4.6-3.6q1.8-.8 3 .9q1.2-1.7 3-.9q2.4 1.2.6 3.6z" fill="#f06a8a" fill-opacity=".85" stroke="#b3265a" stroke-width=".7"/>`;
        if (seite) return herz(39.8) + buegel("#b3265a");
        return herz(27) + herz(37) + `<path d="M30.2 29.4h3.6" stroke="#b3265a" stroke-width=".8"/>`;
      }
      case "pilot":
        if (seite) return `<path d="M36.8 28.4h6q.4 4-3 4.6q-3 0-3-4.6z" fill="#3a2a10" fill-opacity=".8" stroke="#e2b656" stroke-width=".8"/>${buegel("#e2b656")}`;
        return `<path d="M22.8 28.2h8q.6 5-4 5.8q-4.6-.2-4-5.8zM33.2 28.2h8q.6 5.6-4 5.8q-4.6-.8-4-5.8z" fill="#3a2a10" fill-opacity=".82" stroke="#e2b656" stroke-width=".8"/><path d="M30.8 28.8h2.4" stroke="#e2b656" stroke-width=".9"/>`;
      case "skibrille":
        if (seite) return `<path d="M34.6 27.4h8.4v5.8h-8.4z" fill="#ff9d3a" stroke="#1d1d23" stroke-width="1"/><path d="M34.6 30L19.4 30.6" stroke="#1d1d23" stroke-width="2.4"/>`;
        return `<path d="M18.6 30H22.4M41.6 30H45.4" stroke="#1d1d23" stroke-width="2.6"/><rect x="22" y="26.6" width="20" height="7.4" rx="3.2" fill="#ff9d3a" stroke="#1d1d23" stroke-width="1.2"/><path d="M24 28.4q8-1.6 16 0" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/>`;
      case "monokel":
        if (seite) return `<circle cx="39.6" cy="31" r="3" fill="#fff" fill-opacity=".2" stroke="#e2b656" stroke-width="1"/><path d="M38 33.8Q36 40 38.4 46" fill="none" stroke="#e2b656" stroke-width=".5"/>`;
        return `<circle cx="37" cy="31" r="3.3" fill="#fff" fill-opacity=".2" stroke="#e2b656" stroke-width="1.1"/><path d="M39.6 33.4Q41 40 38.6 47" fill="none" stroke="#e2b656" stroke-width=".5"/>`;
      case "augenklappe":
        if (seite) return `<path d="M36.6 28.2h6v5q-3 1.8-6 0z" fill="#111317"/><path d="M36.6 29L28.6 26.6" stroke="#111317" stroke-width="1"/>`;
        return `<path d="M34 28h6.2v5q-3.1 1.8-6.2 0z" fill="#111317"/><path d="M19.4 25L34.4 28.6M40 28.4L45 26.6" stroke="#111317" stroke-width="1"/>`;
      case "cateye":
        if (seite) return `<path d="M36.8 28.6h5.6l1.6-1.6v3.6q-3.4 2.4-7.2 0z" fill="#fff" fill-opacity=".12" stroke="#7a1022" stroke-width="1.1"/>${buegel("#7a1022")}`;
        return `<path d="M22.4 28.8h8.2v2.6q-3.8 3-7.4 0l-1.8-.4-1.2-3.2z" fill="#fff" fill-opacity=".12" stroke="#7a1022" stroke-width="1.2"/><path d="M33.4 28.8h8.2l2.6-.6-1.2 3.2-1.8.4q-3.6 3-7.8 0z" fill="#fff" fill-opacity=".12" stroke="#7a1022" stroke-width="1.2"/><path d="M30.6 29.6h2.8" stroke="#7a1022" stroke-width="1.1"/>`;
      case "spiegelbrille":
        if (seite) return `<path d="M36.6 28.6h6.4v3.4q-3.2 2.2-6.4 0z" fill="url(#fg-hologramm)" stroke="#8d949c" stroke-width=".7"/>${buegel("#8d949c")}`;
        return `<path d="M22.8 28.6h8v3.2q-4 3.2-8 0zM33.2 28.6h8v3.2q-4 3.2-8 0z" fill="url(#fg-hologramm)" stroke="#8d949c" stroke-width=".7"/><path d="M30.8 29.2h2.4" stroke="#8d949c" stroke-width="1"/><path d="M24 29.6l3-.9M34.4 29.6l3-.9" stroke="#fff" stroke-opacity=".8" stroke-width=".7"/>`;
      case "laservisier":
        if (seite) return `<path d="M34 27.6h10v5.4H34z" fill="#ff2d4b" fill-opacity=".65" stroke="#7a1022" stroke-width=".8"/><path class="fg-laser" d="M34.5 30.3H43.5" stroke="#fff" stroke-width=".8"/>`;
        return `<path d="M20.4 27.8Q32 25.8 43.6 27.8V33Q32 35 20.4 33Z" fill="#ff2d4b" fill-opacity=".65" stroke="#7a1022" stroke-width=".8"/><path class="fg-laser" d="M21.5 30.4H42.5" stroke="#fff" stroke-width=".8"/>`;
      default:
        return "";
    }
  }

  /* Accessoires, in zwei Lagen: hinter dem Körper (Umhang, Flügel,
     Rucksack von vorn) und davor. */
  function accessoireHinten(f, ansicht) {
    const id = f.k.accessoire;
    if (id === "umhang") {
      if (ansicht === "seite") return `<path class="fg-wehen" d="M26 45Q15 58 16 82Q22 84 28 80L30 47Z" fill="#8e1f2b" stroke="#4a0f16" stroke-width=".8"/>`;
      if (ansicht === "vorne") return `<path d="M20.6 45Q12 62 14 83L20 82L22 50ZM43.4 45Q52 62 50 83L44 82L42 50Z" fill="#8e1f2b" stroke="#4a0f16" stroke-width=".8"/>`;
      return "";
    }
    if (id === "fluegel") {
      const fluegel = (spiegel) => `<g class="fg-flattern${spiegel ? " rechts" : ""}"><path d="${spiegel ? "M40 50Q56 36 62 44Q58 50 60 56Q54 58 55 64Q48 64 42 60Z" : "M24 50Q8 36 2 44Q6 50 4 56Q10 58 9 64Q16 64 22 60Z"}" fill="#fbf7ec" stroke="#c9c1ac" stroke-width=".8"/></g>`;
      if (ansicht === "seite") return fluegel(false);
      if (ansicht === "vorne") return fluegel(false) + fluegel(true);
      return "";
    }
    if (id === "rucksack" && ansicht === "seite") return `<rect x="17.4" y="47" width="8" height="15" rx="2.6" fill="#2e6fb5" stroke="${L}" stroke-width=".9"/><rect x="16.6" y="54" width="3" height="6" rx="1" fill="#245893"/>`;
    return "";
  }

  function accessoireVorn(f, ansicht) {
    const id = f.k.accessoire;
    const seite = ansicht === "seite", hinten = ansicht === "hinten";
    switch (id) {
      case "schal":
        if (seite) return `<path d="M27 42.6Q33 45.6 38.6 43.2L38.8 47Q33 49.6 26.8 46.4Z" fill="#c8453c" stroke="#7a221c" stroke-width=".7"/><path d="M36 46L37.4 56L34.4 56.4L33.6 47Z" fill="#c8453c" stroke="#7a221c" stroke-width=".7"/>`;
        return `<path d="M24.4 43.4Q32 47.6 39.6 43.4L39.8 47.2Q32 51.6 24.2 47.2Z" fill="#c8453c" stroke="#7a221c" stroke-width=".7"/>${hinten ? "" : `<path d="M34.6 47.6L36.4 59L33.2 59.4L32 48.6Z" fill="#c8453c" stroke="#7a221c" stroke-width=".7"/><path d="M33 58h3.4M33.2 56h3" stroke="#f2c94c" stroke-width=".6"/>`}`;
      case "fliege":
        if (hinten) return "";
        if (seite) return `<path d="M38.4 44.6l2.6-1.6v3.4z" fill="#b3261e" stroke="#5c0f0c" stroke-width=".6"/>`;
        return `<path d="M32 45.6l-4.2-2.2v4.4zM32 45.6l4.2-2.2v4.4z" fill="#b3261e" stroke="#5c0f0c" stroke-width=".6"/><rect x="31.2" y="44.6" width="1.6" height="2" rx=".4" fill="#7a1512"/>`;
      case "rucksack":
        if (hinten) return `<rect x="23" y="46.6" width="18" height="19" rx="3.6" fill="#2e6fb5" stroke="${L}" stroke-width="1"/><rect x="25.6" y="56" width="12.8" height="7.6" rx="2" fill="#245893" stroke="${L}" stroke-width=".6"/><path d="M26 50.4h12" stroke="#f2c94c" stroke-width=".8"/>`;
        if (seite) return `<path d="M29 45.4L27.4 58" stroke="#245893" stroke-width="1.8"/>`;
        return `<path d="M25 45.2L24.2 60M39 45.2L39.8 60" stroke="#245893" stroke-width="2"/>`;
      case "bauchtasche":
        if (hinten) return `<path d="M38.6 45.4L24.6 64" stroke="#3a2a1a" stroke-width="1.6"/>`;
        if (seite) return `<path d="M34 45.4L32 60" stroke="#3a2a1a" stroke-width="1.6"/><rect x="34.6" y="50" width="6.8" height="7" rx="2.4" fill="#6b4a2e" stroke="#2b1a0c" stroke-width=".7"/><path d="M35.2 52.6h5.6" stroke="#e2b656" stroke-width=".6"/>`;
        return `<path d="M39 45.2L25.6 62" stroke="#3a2a1a" stroke-width="1.6"/><rect x="22.4" y="49.8" width="14.2" height="7.4" rx="3.2" fill="#6b4a2e" stroke="#2b1a0c" stroke-width=".8" transform="rotate(-18 29.5 53.5)"/><g transform="rotate(-18 29.5 53.5)"><path d="M23.6 52.4h11.8" stroke="#e2b656" stroke-width=".7"/><circle cx="26" cy="55" r=".5" fill="#e9d3a8"/><circle cx="29" cy="55" r=".5" fill="#e9d3a8"/><circle cx="32" cy="55" r=".5" fill="#e9d3a8"/></g>`;
      case "handtasche":
        if (hinten) return `<path d="M42 50Q46 58 44 62" fill="none" stroke="#6b2e3a" stroke-width="1.2"/><rect x="41" y="61.4" width="8" height="6.4" rx="1.6" fill="#8e2f45" stroke="#4a1622" stroke-width=".7"/>`;
        if (seite) return `<path d="M31 52Q35 58 34 61" fill="none" stroke="#6b2e3a" stroke-width="1.2"/><rect x="30.6" y="60.6" width="8" height="6.4" rx="1.6" fill="#8e2f45" stroke="#4a1622" stroke-width=".7"/><rect x="33.6" y="62.6" width="2" height="1.4" fill="#e2b656"/>`;
        return `<path d="M16.4 54Q15 60 16.6 62" fill="none" stroke="#6b2e3a" stroke-width="1.2"/><path d="M20.6 54Q22 60 20.4 62" fill="none" stroke="#6b2e3a" stroke-width="1.2"/><rect x="13.6" y="61.4" width="9.8" height="7.4" rx="1.8" fill="#8e2f45" stroke="#4a1622" stroke-width=".7"/><rect x="17.6" y="63.2" width="2" height="1.6" fill="#e2b656"/>`;
      case "perlenkette": {
        const perlen = (pkt) => pkt.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fbf7ec" stroke="#c9c1ac" stroke-width=".35"/>`).join("");
        if (hinten) return "";
        if (seite) return perlen([[30, 44], [32, 46.6], [34.4, 48.4], [36.8, 48.6], [38.6, 47]]);
        return perlen([[25.4, 44.4], [26.8, 47], [28.6, 49.2], [30.8, 50.4], [33.2, 50.4], [35.4, 49.2], [37.2, 47], [38.6, 44.4]]);
      }
      case "creolen":
        if (hinten) return `<circle cx="19" cy="35.6" r="2.4" fill="none" stroke="#e2b656" stroke-width=".9"/><circle cx="45" cy="35.6" r="2.4" fill="none" stroke="#e2b656" stroke-width=".9"/>`;
        if (seite) return `<circle cx="28.6" cy="36" r="2.6" fill="none" stroke="#e2b656" stroke-width=".9"/>`;
        return `<circle cx="19.2" cy="36.4" r="2.6" fill="none" stroke="#e2b656" stroke-width=".9"/><circle cx="44.8" cy="36.4" r="2.6" fill="none" stroke="#e2b656" stroke-width=".9"/>`;
      case "clutch":
        if (hinten) return `<rect x="41.6" y="60.4" width="8.4" height="5.4" rx="1.4" fill="#e2b656" stroke="#8e6931" stroke-width=".7"/>`;
        if (seite) return `<rect x="30.4" y="58.6" width="8.4" height="5.4" rx="1.4" fill="#e2b656" stroke="#8e6931" stroke-width=".7"/><g class="fg-glitzer" fill="#fff"><circle cx="32.4" cy="60.4" r=".45"/><circle cx="36.4" cy="62" r=".45"/></g>`;
        return `<rect x="13.4" y="59.6" width="9" height="5.8" rx="1.4" fill="#e2b656" stroke="#8e6931" stroke-width=".7"/><path d="M13.4 61.6h9" stroke="#8e6931" stroke-width=".5"/><g class="fg-glitzer" fill="#fff"><circle cx="15.4" cy="63.4" r=".45"/><circle cx="19.6" cy="62.6" r=".45"/><circle cx="21" cy="64.4" r=".45"/></g>`;
      case "goldkette":
        if (hinten) return `<path d="M25 43.4Q32 46 39 43.4" fill="none" stroke="#e2b656" stroke-width="1.4" stroke-dasharray="1.2 .6"/>`;
        if (seite) return `<path d="M29 43.4Q34 52 38.8 46" fill="none" stroke="#e2b656" stroke-width="1.4" stroke-dasharray="1.2 .6"/><circle cx="36" cy="51" r="1.8" fill="#e2b656" stroke="#8e6931" stroke-width=".5"/>`;
        return `<path d="M25 43.6Q32 57 39 43.6" fill="none" stroke="#e2b656" stroke-width="1.5" stroke-dasharray="1.2 .6"/><circle cx="32" cy="52.6" r="2.4" fill="#e2b656" stroke="#8e6931" stroke-width=".6"/><text x="32" y="54" text-anchor="middle" font-size="3.4" font-weight="900" fill="#8e6931" font-family="ui-rounded, system-ui">$</text>`;
      case "umhang":
        if (hinten) return `<path class="fg-wehen" d="M21 45Q32 42 43 45L48 84Q32 88 16 84Z" fill="#8e1f2b" stroke="#4a0f16" stroke-width=".9"/><path d="M16.4 82Q32 86 47.6 82" fill="none" stroke="#e2b656" stroke-width="1.2"/>`;
        if (seite) return "";
        return `<circle cx="27" cy="45" r="1.4" fill="#e2b656"/><circle cx="37" cy="45" r="1.4" fill="#e2b656"/>`;
      case "fluegel":
        if (!hinten) return "";
        return `<g class="fg-flattern"><path d="M28 50Q10 30 0 40Q5 48 2 55Q9 58 8 66Q17 66 27 60Z" fill="#fbf7ec" stroke="#c9c1ac" stroke-width=".8"/><path d="M8 45q6 4 14 6M6 53q7 2 15 3" fill="none" stroke="#d9d1bc" stroke-width=".7"/></g><g class="fg-flattern rechts"><path d="M36 50Q54 30 64 40Q59 48 62 55Q55 58 56 66Q47 66 37 60Z" fill="#fbf7ec" stroke="#c9c1ac" stroke-width=".8"/><path d="M56 45q-6 4-14 6M58 53q-7 2-15 3" fill="none" stroke="#d9d1bc" stroke-width=".7"/></g>`;
      default:
        return "";
    }
  }

  /* Dinge in der Hand. Null heißt: das Chat-Zeichen oder der Chip. */
  function handding(id, hx, hy) {
    const t = `transform="translate(${hx} ${hy})"`;
    switch (id) {
      case "kaffee": return `<g class="fg-ding" ${t}><path d="M-1.4 -9h8l-1 9h-6z" fill="#f4efe2" stroke="#6b5a45" stroke-width=".7"/><rect x="-1.8" y="-10.6" width="8.8" height="2" rx=".8" fill="#3a2a1a"/><rect x="-1" y="-6" width="7" height="3" fill="#5a9d91"/><path class="fg-dampf" d="M1.5 -12q-1 -2 .6 -3.6M4 -12q-1 -2 .6 -3.6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".6"/></g>`;
      case "lutscher": return `<g class="fg-ding" ${t}><path d="M1 1V-10" stroke="#f4efe2" stroke-width="1.1"/><circle cx="1" cy="-14" r="5" fill="#f06a8a" stroke="#b3265a" stroke-width=".7"/><path d="M1 -14m-3.2 0a3.2 3.2 0 1 1 3.2 3.2a2 2 0 1 1-2-2" fill="none" stroke="#fff" stroke-width="1"/></g>`;
      case "energy": return `<g class="fg-ding" ${t}><rect x="-1.6" y="-10.6" width="6.8" height="11" rx="1.4" fill="#1d2a6e" stroke="#0b1236" stroke-width=".6"/><path d="M1.8 -8.6l-2 3.4h2l-1.4 3.4" fill="none" stroke="#c8f03c" stroke-width="1"/><rect x="-1.2" y="-11.4" width="6" height="1.2" rx=".4" fill="#c0c6cc"/></g>`;
      case "eis": return `<g class="fg-ding" ${t}><path d="M-1.6 -6L1.8 3L5.2 -6Z" fill="#d9a15a" stroke="#8e5a22" stroke-width=".6"/><path d="M-1 -5l5 5M4.6 -5l-5 5" stroke="#8e5a22" stroke-width=".4"/><circle cx="1.8" cy="-8.6" r="3.4" fill="#f5b8c8"/><circle cx="1.8" cy="-12.6" r="2.8" fill="#fff4c9"/><circle cx="2.6" cy="-15" r="1" fill="#d24a3c"/></g>`;
      case "vape": return `<g class="fg-ding" ${t}><rect x="-.6" y="-11.6" width="4" height="10" rx="1.4" fill="#2a2d33" stroke="#0f1013" stroke-width=".6"/><rect x="0" y="-9.6" width="2.8" height="3.4" rx=".6" fill="#8d5bd6"/><rect x=".4" y="-13.4" width="2" height="2" rx=".6" fill="#6b7078"/><g class="fg-wolke" fill="#eef2f6"><circle cx="2" cy="-17" r="2"/><circle cx="4.6" cy="-19.4" r="2.6"/><circle cx="1" cy="-21.6" r="2.2"/></g></g>`;
      case "handy": return `<g class="fg-ding" ${t}><rect x="-1.4" y="-11" width="6.2" height="11" rx="1.2" fill="#1d1d23" stroke="#000" stroke-width=".5"/><rect x="-.8" y="-10" width="5" height="8.6" rx=".6" class="fg-bildschirm" fill="#6fb6d9"/></g>`;
      case "doener": return `<g class="fg-ding" ${t}><path d="M-3 -2L1.6 -13.6L7.6 -3.4Z" fill="#f0d59a" stroke="#a8803c" stroke-width=".7"/><path d="M-.6 -6.4L2.2 -12L5.4 -5.8" fill="#9a5a2a"/><circle cx="1.4" cy="-7.4" r=".9" fill="#4fb76a"/><circle cx="3.6" cy="-6.8" r=".8" fill="#d24a3c"/><path d="M-1 -5.4q3-1.4 6 0" fill="none" stroke="#fff" stroke-width=".8"/></g>`;
      case "rose": return `<g class="fg-ding" ${t}><path d="M1 2V-11" stroke="#2e7d4f" stroke-width="1"/><path d="M1 -6q3-2 4 0q-3 1-4 0" fill="#3f8a4a"/><circle cx="1" cy="-13.4" r="3" fill="#c8243a" stroke="#7a1022" stroke-width=".6"/><path d="M-.4 -13.6q1.4-1.6 2.8 0" fill="none" stroke="#7a1022" stroke-width=".6"/></g>`;
      case "kamera": return `<g class="fg-ding" ${t}><rect x="-3" y="-9" width="11" height="7.4" rx="1.4" fill="#2a2d33" stroke="#0f1013" stroke-width=".6"/><circle cx="2.6" cy="-5.3" r="2.6" fill="#6b7078" stroke="#c0c6cc" stroke-width=".6"/><circle cx="2.6" cy="-5.3" r="1.2" fill="#6fb6d9"/><rect x="5" y="-10.2" width="2.2" height="1.4" rx=".4" fill="#e5534b"/></g>`;
      case "luftballon": return `<g class="fg-ding" ${t}><path d="M1 0Q-2 -10 1 -20Q3 -26 1 -34" fill="none" stroke="#f4efe2" stroke-width=".5"/><g class="fg-ballon"><ellipse cx="1" cy="-40" rx="6" ry="7.2" fill="#e5534b" stroke="#8e2320" stroke-width=".6"/><path d="M-1.4 -44q1.6-1.8 3.4-1" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1"/><path d="M0 -32.6l1-1.2 1 1.2z" fill="#8e2320"/></g></g>`;
      case "chipstapel": return `<g class="fg-ding" ${t}>${[0, 1, 2, 3, 4].map((i) => `<rect x="-2.4" y="${-3 - i * 2.2}" width="8" height="2.4" rx="1.1" fill="${["#e5534b", "#f4efe2", "#3f6fd0", "#1d1d23", "#e2b656"][i]}" stroke="#555" stroke-width=".4"/>`).join("")}</g>`;
      case "zollstock": return `<g class="fg-ding" ${t}><path d="M0 2L1.4 -8L-3 -14L1.6 -20" fill="none" stroke="#f2c94c" stroke-width="2.2" stroke-linejoin="bevel"/><path d="M.6 -2l.2-1.4M1 -5l.2-1.4M-1 -11l-.8-1.2M.2 -17l.8-1.2" stroke="#1d1d23" stroke-width=".5"/></g>`;
      case "kuchen": return `<g class="fg-ding" ${t}><ellipse cx="2.4" cy="-3" rx="7" ry="2" fill="#f4f1ea" stroke="#b9b3a2" stroke-width=".6"/><path d="M-2 -4L6 -4L2.4 -10Z" fill="#f0d59a" stroke="#a8803c" stroke-width=".6"/><path d="M-1.2 -5.4H5.2" stroke="#f5b8c8" stroke-width="1.2"/><path d="M0.6 -7.6H4.2" stroke="#f5b8c8" stroke-width="1"/><circle cx="2.4" cy="-10.6" r="1.1" fill="#d24a3c"/></g>`;
      case "pfanne": return `<g class="fg-ding" ${t}><path d="M0 1L1 -8" stroke="#3a2718" stroke-width="2" stroke-linecap="round"/><ellipse cx="3" cy="-13" rx="7" ry="4.4" fill="#2a2d33" stroke="#111317" stroke-width=".8"/><ellipse cx="3" cy="-13.4" rx="5.2" ry="3" fill="#3a3e44"/><ellipse cx="2" cy="-13.6" rx="2" ry="1.4" fill="#fff4c9"/><circle cx="2" cy="-13.6" r=".8" fill="#f0a23b"/></g>`;
      case "lasso": return `<g class="fg-ding" ${t}><ellipse cx="3" cy="-6" rx="6" ry="4" fill="none" stroke="#c9a46a" stroke-width="1.2"/><ellipse cx="3" cy="-6" rx="4.4" ry="2.8" fill="none" stroke="#a8803c" stroke-width=".8"/><path d="M-1 -3Q-4 4 -2 8" fill="none" stroke="#c9a46a" stroke-width="1.1"/></g>`;
      case "kleeblatt": return `<g class="fg-ding" ${t}><path d="M1 2Q0 -4 1.4 -8" fill="none" stroke="#2e7d4f" stroke-width="1"/>${[[-2.4, -10.4], [1.4, -13.6], [4.8, -10], [1.2, -7]].map(([x, y]) => `<circle cx="${x + 0.4}" cy="${y}" r="2.5" fill="#4fb76a" stroke="#2e7d4f" stroke-width=".5"/>`).join("")}<circle cx="1.4" cy="-10.3" r=".9" fill="#c8f03c"/></g>`;
      case "goldbarren": return `<g class="fg-ding" ${t}><path d="M-3.6 -2L-1.6 -8H6.6L8.6 -2Z" fill="#e2b656" stroke="#8e6931" stroke-width=".7"/><path d="M-1.6 -8L0 -5.6H5L6.6 -8" fill="#f4d782" stroke="#8e6931" stroke-width=".4"/><path class="fg-schimmer" d="M.5 -6.8l1.6 3" stroke="#fff" stroke-width=".8"/></g>`;
      case "bubble_tea": return `<g class="fg-ding" ${t}><path d="M-1.6 -10h8l-1 10h-6z" fill="#e8c7a0" fill-opacity=".9" stroke="#8e6931" stroke-width=".6"/><path d="M-1.8 -10q4.2-4 8.4 0z" fill="#f4f1ea" fill-opacity=".8" stroke="#b9b3a2" stroke-width=".5"/><path d="M3.6 -12.6L5.8 -19" stroke="#f06a8a" stroke-width="1.4"/>${[[0.6, -2], [2.6, -1.4], [4.4, -2.2], [1.6, -3.6], [3.6, -3.8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#2b1a0c"/>`).join("")}</g>`;
      case "faecher": return `<g class="fg-ding" ${t}><g class="fg-faecher"><path d="M1 1L-8 -10Q1 -18 10 -10Z" fill="#c8243a" stroke="#7a1022" stroke-width=".6"/>${[-6, -3, 0, 3, 6].map((dx) => `<path d="M1 1L${1 + dx * 1.2} -${11 + Math.abs(dx) * -0.4}" stroke="#7a1022" stroke-width=".4"/>`).join("")}<path d="M-6 -11.6Q1 -17 8 -11.6" fill="none" stroke="#f2c94c" stroke-width=".7"/></g></g>`;
      case "blumenstrauss": return `<g class="fg-ding" ${t}><path d="M-.6 2L.2 -8M2.4 2L1.6 -8M1 2V-8" stroke="#2e7d4f" stroke-width=".8"/><path d="M-2 -2L1 2L4 -2L2.6 -6H-.6Z" fill="#f4efe2" stroke="#b9b3a2" stroke-width=".5"/>${[[-2, -11, "#f06a8a"], [1, -13.4, "#f9e27a"], [4, -11, "#c49bff"], [-0.4, -9, "#7ec8ff"], [2.6, -9, "#f06a8a"]].map(([x, y, c]) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((w) => `<circle cx="${(Math.cos((w * Math.PI) / 180) * 1.3).toFixed(2)}" cy="${(Math.sin((w * Math.PI) / 180) * 1.3).toFixed(2)}" r="1" fill="${c}"/>`).join("")}<circle r=".6" fill="#fff4c9"/></g>`).join("")}</g>`;
      case "schallplatte": return `<g class="fg-ding" ${t}><circle cx="2" cy="-9" r="7.2" fill="#15151a" stroke="#000" stroke-width=".5"/><circle cx="2" cy="-9" r="5.4" fill="none" stroke="#2c2c34" stroke-width=".5"/><circle cx="2" cy="-9" r="3.8" fill="none" stroke="#2c2c34" stroke-width=".5"/><circle cx="2" cy="-9" r="2.2" fill="#c8243a"/><circle cx="2" cy="-9" r=".6" fill="#f4f1ea"/><path d="M-2.6 -14q2-1.6 4.4-1.2" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/></g>`;
      case "pokal": return `<g class="fg-ding" ${t}><path d="M-3 -15H7L6 -9Q5 -5 2 -5Q-1 -5 -2 -9Z" fill="#e2b656" stroke="#8e6931" stroke-width=".7"/><path d="M-3 -14Q-6 -14 -5.4 -11Q-4.6 -9 -2 -9M7 -14Q10 -14 9.4 -11Q8.6 -9 6 -9" fill="none" stroke="#e2b656" stroke-width="1.1"/><rect x="1" y="-5" width="2" height="3" fill="#c9a14a"/><rect x="-1.4" y="-2.2" width="6.8" height="2.4" rx=".6" fill="#8e6931"/><path class="fg-schimmer" d="M0 -13.6l1.4 5" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/></g>`;
      case "wunderkerze": return `<g class="fg-ding" ${t}><path d="M1 2L2.6 -14" stroke="#8a929c" stroke-width="1"/><path d="M2.2 -10L2.8 -16" stroke="#3a3f47" stroke-width="1.4"/><g class="fg-funken">${[[-3, -20], [7, -21], [2, -24], [-1, -15], [6, -15], [8, -18], [-4, -17]].map(([x, y]) => `<path d="M2.8 -16L${x} ${y}" stroke="#ffe27a" stroke-width=".6"/><circle cx="${x}" cy="${y}" r=".7" fill="#fff6c8"/>`).join("")}</g><circle cx="2.8" cy="-16" r="1.6" fill="#fff" opacity=".9"/></g>`;
      case "spezi": return `<g class="fg-ding" ${t}><rect x="-1.4" y="-11" width="6.6" height="11.4" rx="1.8" fill="#4a2410" stroke="#24110a" stroke-width=".6"/><rect x=".2" y="-15.4" width="3.4" height="5" rx=".8" fill="#4a2410" stroke="#24110a" stroke-width=".5"/><rect x="-.1" y="-16.4" width="4" height="1.6" rx=".5" fill="#d24a3c"/><rect x="-1.4" y="-8" width="6.6" height="4.6" fill="#f2a33a"/><path d="M-.4 -5.6q2.6-2 4.6 0" fill="none" stroke="#d24a3c" stroke-width=".9"/><path d="M-.4 -10.4V-1" stroke="#fff" stroke-opacity=".3" stroke-width=".7"/></g>`;
      default: return null;
    }
  }

  /*
   * Fahrzeuge. Drei Teile: was hinter der Figur liegt, was davor, und wie
   * weit die Figur darauf steht (`hub`, nach oben in Einheiten der
   * viewBox). Bei den Autos sitzt sie, die Beine sind dann weg.
   */
  const FAHRZEUG = {
    skateboard: { hub: 3.4 },
    e_roller: { hub: 3.6 },
    bobbycar: { hub: -1, sitzt: true },
    hoverboard: { hub: 4.6 },
    mopedauto: { hub: -3, sitzt: true, auto: "#e8e4dc" },
    aufsitzmaeher: { hub: 2, sitzt: true },
    goldmoped: { hub: -3, sitzt: true, auto: "#e2b656", gold: true },
    simme: { hub: -4, sitzt: true, tank: "#3c7fc0" },
    e46: { hub: -3, sitzt: true, auto: "#aeb4bb" },
  };

  // Griffe, Schutzbleche und Anzeige des E-Rollers: eine Farbe, die man von weitem erkennt.
  const ROLLER = "#2bd49a";

  function rad(cx, cy, r, farbe = "#1d1d23") {
    return `<g class="fz-rad" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${farbe}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#c0c6cc"/><path d="M${cx - r * 0.7} ${cy}h${r * 1.4}" stroke="#6b7078" stroke-width=".5"/></g>`;
  }

  /* Die Simme. Man sitzt rittlings drauf, also zeichnet sie die Beine
     selbst: ausgestellt von vorn und hinten, angewinkelt von der Seite. */
  const CHROM = "#c0c6cc";
  function simmeFarben(f) {
    const h = hoseVon(f), sch = SCHUHE[f.k.schuhe] || SCHUHE.standard;
    const bein = h.rock ? (h.strumpf === "haut" ? f.haut : h.strumpf) : h.farbe;
    return { bein, schuh: sch.barfuss ? f.haut : sch.farbe, tank: FAHRZEUG.simme.tank, dunkel: dunkler(FAHRZEUG.simme.tank, 0.35) };
  }
  function simmeBeine(f) {
    const c = simmeFarben(f);
    return `<g class="fz-beine"><path d="M27.4 72.6L21.4 79L21.8 85.4M36.6 72.6L42.6 79L42.2 85.4" fill="none" stroke="${c.bein}" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<ellipse cx="21.6" cy="87" rx="3.6" ry="1.9" fill="${c.schuh}" stroke="${L}" stroke-width=".7"/><ellipse cx="42.4" cy="87" rx="3.6" ry="1.9" fill="${c.schuh}" stroke="${L}" stroke-width=".7"/></g>`;
  }
  function simmeSpiegel(x) {
    return `<path d="M${x} 66L${x < 32 ? x - 2.6 : x + 2.6} 57.6" stroke="${CHROM}" stroke-width=".9"/><circle cx="${x < 32 ? x - 2.8 : x + 2.8}" cy="56.4" r="2.2" fill="${CHROM}" stroke="#6b7078" stroke-width=".5"/>`;
  }

  function fahrzeugHinten(f, ansicht) {
    const id = f.k.fahrzeug;
    const seite = ansicht === "seite";
    switch (id) {
      case "skateboard":
        if (seite) return `<path d="M12 85.6h40q2.4 0 3-2.2M12 85.6q-2.4 0-3-2.2" fill="none" stroke="#6b4a2e" stroke-width="2.2" stroke-linecap="round"/><rect x="12" y="84.4" width="40" height="2.6" rx="1.3" fill="#c8453c"/>${rad(17, 89.4, 2.2, "#f2c94c")}${rad(47, 89.4, 2.2, "#f2c94c")}`;
        return `<rect x="21" y="84.6" width="22" height="2.8" rx="1.4" fill="#c8453c" stroke="#6b2320" stroke-width=".6"/><rect x="22" y="87.6" width="4" height="3" rx="1.2" fill="#f2c94c"/><rect x="38" y="87.6" width="4" height="3" rx="1.2" fill="#f2c94c"/>`;
      case "e_roller":
        if (seite) return `${rad(15.6, 89, 3.2)}<path d="M11.6 88Q12 84.4 15.6 84.4" fill="none" stroke="${ROLLER}" stroke-width="1.4"/><rect x="11.2" y="85.4" width="1.6" height="1.4" fill="#e5534b"/><rect x="15" y="84.6" width="32" height="3" rx="1.4" fill="#2a2d33"/><path class="fz-led" d="M17 88.8h28" stroke="#42f5a7" stroke-width="1.2" opacity="0"/>`;
        /* Von vorn und hinten war vom Roller nur ein Strich auf Handhöhe
           übrig: Brett unter den Schuhen, Stange in Hosenfarbe. Jetzt ragt
           das Brett seitlich heraus, und von hinten steht der Lenker
           breiter als die Schultern hinter dem Körper. */
        return `<rect x="17" y="84.6" width="30" height="3.6" rx="1.6" fill="#2a2d33" stroke="#15171b" stroke-width=".5"/><path d="M18.4 85.4h27.2" stroke="#6b7078" stroke-width=".6"/><path class="fz-led" d="M18.6 88.6h26.8" stroke="#42f5a7" stroke-width="1.2" opacity="0"/>`
          + (ansicht === "hinten" ? `<path d="M9.6 66.2h44.8" stroke="#1d1d23" stroke-width="2.6" stroke-linecap="round"/><rect x="9" y="64.6" width="6.4" height="3.2" rx="1.4" fill="${ROLLER}"/><rect x="48.6" y="64.6" width="6.4" height="3.2" rx="1.4" fill="${ROLLER}"/>` : "");
      case "hoverboard":
        return `<g class="fz-schweben"><ellipse cx="32" cy="91.6" rx="${seite ? 12 : 17}" ry="2" fill="#42c6f5" opacity=".35"/><rect x="${seite ? 22 : 15}" y="84.8" width="${seite ? 20 : 34}" height="3.4" rx="1.7" fill="#f4f4f4" stroke="#6b7078" stroke-width=".6"/>${seite ? rad(32, 88.6, 3.2, "#2a2d33") : `<rect x="13" y="83.6" width="5" height="7" rx="2.4" fill="#2a2d33"/><rect x="46" y="83.6" width="5" height="7" rx="2.4" fill="#2a2d33"/>`}<path d="M${seite ? 24 : 18} 86.4h${seite ? 16 : 28}" stroke="#42c6f5" stroke-width=".9"/></g>`;
      case "bobbycar":
        if (seite) return `${rad(18, 88.4, 3.6)}${rad(46, 88.4, 3.6)}`;
        return `${rad(17, 88.6, 3.2)}${rad(47, 88.6, 3.2)}`;
      case "simme": {
        const c = simmeFarben(f);
        if (seite) return `${rad(14, 84.4, 6.2)}${rad(51, 84.4, 6.2)}`
          + `<path d="M7.2 82Q8 75.4 14 75Q20 75.4 20.8 80" fill="none" stroke="${c.tank}" stroke-width="2"/><path d="M5 71.6H19M7.4 71.6L9.4 77" stroke="${CHROM}" stroke-width="1.3"/>`
          + `<path d="M17 76.4L44 66" stroke="#2a2d33" stroke-width="2.2"/><rect x="26" y="75" width="13" height="8.4" rx="2" fill="#8a9099" stroke="#555b63" stroke-width=".7"/><path d="M28 77.4h9M28 79.6h9" stroke="#555b63" stroke-width=".6"/>`
          + `<path d="M36 81.6Q30 85.8 20 85.4H9" fill="none" stroke="${CHROM}" stroke-width="2.4" stroke-linecap="round"/><rect x="5.4" y="83.4" width="10" height="3.6" rx="1.8" fill="${CHROM}" stroke="#6b7078" stroke-width=".5"/>`
          + `<path d="M10 70.4Q10 67.8 14 67.8H33Q35.2 67.8 35.2 70.4V72.4H10Z" fill="#1d1d23"/><path d="M17 72.6H30L28.4 78.4H18.4Z" fill="${c.tank}" stroke="${c.dunkel}" stroke-width=".6"/><text x="23.4" y="76.8" text-anchor="middle" font-size="2.8" font-weight="900" fill="#f4f1ea" font-family="ui-rounded, system-ui">S51</text>`
          + `<rect x="5" y="70.2" width="2.6" height="2.4" rx=".6" fill="#e5534b"/>`;
        // Von hinten sieht man den Lenker breiter als die Schultern, von vorn den Auspuff seitlich.
        if (ansicht === "hinten") return `<path d="M12.6 66.4Q32 64 51.4 66.4" fill="none" stroke="#2a2d33" stroke-width="1.8"/><rect x="10.4" y="64.8" width="5" height="3" rx="1.4" fill="#1d1d23"/><rect x="48.6" y="64.8" width="5" height="3" rx="1.4" fill="#1d1d23"/>${simmeSpiegel(14.6)}${simmeSpiegel(49.4)}`;
        return `<rect x="40.6" y="81.6" width="7.6" height="3.4" rx="1.6" fill="${CHROM}" stroke="#6b7078" stroke-width=".5"/>`;
      }
      case "aufsitzmaeher":
        if (seite) return `${rad(14, 86.6, 5.6)}`;
        if (ansicht === "hinten") return `<rect x="14" y="70" width="36" height="16" rx="4" fill="#5a4632" stroke="#2b1a0c" stroke-width=".8"/><path d="M18 74h28M18 78h28M18 82h28" stroke="#3f8a4a" stroke-width="1"/>`;
        return "";
      default:
        return "";
    }
  }

  function fahrzeugVorn(f, ansicht) {
    const id = f.k.fahrzeug;
    const seite = ansicht === "seite";
    switch (id) {
      case "skateboard":
        // Von vorn und hinten sieht man das Brett stirnseitig: die hochgebogene Spitze vor den Füßen, dazu die Achse mit den Rollen.
        if (seite) return "";
        return `<path d="M20 89.6h24" stroke="#8a929c" stroke-width="1.6"/><rect x="17.4" y="87.8" width="4.6" height="4.4" rx="1.6" fill="#f2c94c" stroke="#9a7a1c" stroke-width=".5"/><rect x="42" y="87.8" width="4.6" height="4.4" rx="1.6" fill="#f2c94c" stroke="#9a7a1c" stroke-width=".5"/>`
          + `<path d="M22.4 86.6Q22.6 91.4 32 91.4Q41.4 91.4 41.6 86.6L39.6 87.6Q32 89.2 24.4 87.6Z" fill="#c8453c" stroke="#6b2320" stroke-width=".7"/><path d="M27 89.4h10" stroke="#f4f1ea" stroke-width=".9" stroke-linecap="round"/>`;
      case "e_roller":
        if (seite) return `<path d="M47 85.6L45 62.6" stroke="#6b7078" stroke-width="1.8"/><path d="M41.4 62.2h6.4" stroke="#1d1d23" stroke-width="2.2" stroke-linecap="round"/><rect x="40.4" y="60.8" width="4.4" height="2.8" rx="1.2" fill="${ROLLER}"/>${rad(47.4, 89, 3.2)}<path d="M43.2 88Q43.6 84.6 47.4 84.4Q51 84.6 51.6 88" fill="none" stroke="${ROLLER}" stroke-width="1.4"/><circle cx="45.8" cy="68" r="1.4" fill="#fff5c9" stroke="#3a3f47" stroke-width=".5"/>`;
        // Hinterrad mit Schutzblech und Rücklicht: der Teil, der auf den Betrachter zeigt.
        if (ansicht === "hinten") return `<rect x="29" y="85.6" width="6" height="7.4" rx="2.6" fill="#1d1d23"/><path d="M27.6 87.6Q27.6 83.2 32 83.2Q36.4 83.2 36.4 87.6" fill="none" stroke="${ROLLER}" stroke-width="1.8"/><rect x="29.4" y="81.6" width="5.2" height="2" rx=".8" fill="#e5534b"/><rect x="30.4" y="82" width="3.2" height=".8" fill="#ffb3ad"/>`;
        return `<rect x="30" y="67" width="4" height="21" rx="1.4" fill="#3a3f47"/><path d="M31 68.6V86" stroke="#8a929c" stroke-width=".7"/><path class="fz-led" d="M33.2 72V84" stroke="#42f5a7" stroke-width=".9" opacity="0"/>`
          + `<path d="M11.6 66.2h40.8" stroke="#1d1d23" stroke-width="2.6" stroke-linecap="round"/><rect x="11" y="64.6" width="6.6" height="3.2" rx="1.4" fill="${ROLLER}"/><rect x="46.4" y="64.6" width="6.6" height="3.2" rx="1.4" fill="${ROLLER}"/>`
          + `<rect x="29" y="62.8" width="6" height="3.6" rx="1" fill="#1d1d23"/><rect x="29.9" y="63.6" width="4.2" height="2" rx=".5" fill="${ROLLER}" opacity=".85"/>`
          + `<circle cx="32" cy="70.6" r="2.6" fill="#fff5c9" stroke="#3a3f47" stroke-width=".9"/><circle cx="31.4" cy="70" r=".8" fill="#fff"/>`
          + `<rect x="29.2" y="85.4" width="5.6" height="7.6" rx="2.6" fill="#1d1d23"/><path d="M27.8 87.4Q27.8 83.4 32 83.4Q36.2 83.4 36.2 87.4" fill="none" stroke="${ROLLER}" stroke-width="1.8"/>`;
      case "bobbycar":
        if (seite) return `<path d="M11 86Q10 76 18 74L38 73Q46 72 52 78Q54 83 52 86Z" fill="#d93a33" stroke="#7a1b17" stroke-width=".9"/><path d="M40 74L43 66" stroke="#2a2d33" stroke-width="1.6"/><path d="M40.6 66.2h5" stroke="#2a2d33" stroke-width="2" stroke-linecap="round"/><circle cx="50" cy="79" r="1.6" fill="#fff5c9"/>`;
        if (ansicht === "hinten") return `<path d="M15 88Q14 76 22 74H42Q50 76 49 88Z" fill="#d93a33" stroke="#7a1b17" stroke-width=".9"/><rect x="26" y="78" width="12" height="3" rx="1" fill="#f4f1ea"/>`;
        return `<path d="M15 89Q14 77 21 74H43Q50 77 49 89Z" fill="#d93a33" stroke="#7a1b17" stroke-width=".9"/><circle cx="22.6" cy="81" r="2.2" fill="#fff5c9" stroke="#7a1b17" stroke-width=".5"/><circle cx="41.4" cy="81" r="2.2" fill="#fff5c9" stroke="#7a1b17" stroke-width=".5"/><path d="M26 71.6h12" stroke="#2a2d33" stroke-width="2" stroke-linecap="round"/><path d="M32 71.6V75" stroke="#2a2d33" stroke-width="1.4"/>`;
      case "mopedauto":
      case "goldmoped": {
        const c = FAHRZEUG[id].auto, d = dunkler(c, 0.3);
        const gold = FAHRZEUG[id].gold ? `<path class="fg-schimmer" d="M20 60l6 20" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>` : "";
        if (seite) {
          return `<path d="M2 86Q1 70 8 66L16 50Q18 46 24 46H44Q49 46 52 52L58 64Q63 68 62 86Z" fill="${c}" stroke="${d}" stroke-width="1"/>`
            + `<path d="M18 52Q20 49 24 49H31V64H13Z" fill="#9fd3ea" fill-opacity=".45" stroke="${d}" stroke-width=".8"/><path d="M34 49H43Q47 49 49 53L54 64H34Z" fill="#9fd3ea" fill-opacity=".45" stroke="${d}" stroke-width=".8"/>`
            + `<path d="M4 72H60" stroke="${d}" stroke-width=".8"/><rect x="36" y="70" width="5" height="1.6" rx=".8" fill="${d}"/><circle cx="60" cy="72" r="1.6" fill="#fff5c9"/><rect x="2" y="70" width="2.4" height="4" fill="#e5534b"/>`
            + `${rad(14, 86, 5.4)}${rad(51, 86, 5.4)}<text x="28" y="80" font-size="4.6" font-weight="900" fill="${d}" font-family="ui-rounded, system-ui">45</text>${gold}`;
        }
        if (ansicht === "hinten") {
          return `<path d="M8 90Q6 64 14 50Q17 44 24 44H40Q47 44 50 50Q58 64 56 90Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M18 52Q20 48 25 48H39Q44 48 46 52L48 62H16Z" fill="#9fd3ea" fill-opacity=".45" stroke="${d}" stroke-width=".8"/>`
            + `<rect x="10" y="68" width="7" height="4" rx="1.4" fill="#e5534b"/><rect x="47" y="68" width="7" height="4" rx="1.4" fill="#e5534b"/><rect x="24" y="72" width="16" height="6" rx="1" fill="#f4f1ea" stroke="${d}" stroke-width=".5"/><text x="32" y="77" text-anchor="middle" font-size="4.4" font-weight="900" fill="#1d1d23" font-family="ui-rounded, system-ui">45</text>${gold}`
            + `<rect x="8" y="86" width="8" height="6" rx="2" fill="#1d1d23"/><rect x="48" y="86" width="8" height="6" rx="2" fill="#1d1d23"/>`;
        }
        return `<path d="M8 90Q6 64 14 50Q17 44 24 44H40Q47 44 50 50Q58 64 56 90Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M18 52Q20 48 25 48H39Q44 48 46 52L48 62H16Z" fill="#9fd3ea" fill-opacity=".38" stroke="${d}" stroke-width=".8"/>`
          + `<circle cx="15.4" cy="70" r="3.4" fill="#fff5c9" stroke="${d}" stroke-width=".7"/><circle cx="48.6" cy="70" r="3.4" fill="#fff5c9" stroke="${d}" stroke-width=".7"/><rect x="24" y="72" width="16" height="4" rx="1.4" fill="${d}"/><path d="M26 74h12" stroke="${c}" stroke-width=".6"/>`
          + `<rect x="8" y="86" width="8" height="6" rx="2" fill="#1d1d23"/><rect x="48" y="86" width="8" height="6" rx="2" fill="#1d1d23"/>${gold}`;
      }
      case "simme": {
        const c = simmeFarben(f);
        if (seite) {
          return `<path d="M33 66Q35 62.6 41 62.6Q46 62.8 47 66L46 71.6H34Z" fill="${c.tank}" stroke="${c.dunkel}" stroke-width=".8"/><path d="M36 65.6H44" stroke="#fff" stroke-opacity=".5" stroke-width="1"/><rect x="36.4" y="67.2" width="6" height="3" rx="1" fill="#2a2d33"/>`
            + `<g class="fz-beine"><path d="M27 70.6L39.4 72L38.2 82.6" fill="none" stroke="${c.bein}" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="39.6" cy="84" rx="3.8" ry="1.9" fill="${c.schuh}" stroke="${L}" stroke-width=".7"/></g><path d="M35.6 85.4H42.4" stroke="${CHROM}" stroke-width="1.2"/>`
            + `<path d="M46.6 63L51 84.4" stroke="${CHROM}" stroke-width="1.8"/><path d="M45.4 80.4Q46.4 76.6 51 76.4Q55.6 76.6 56.6 80.4" fill="none" stroke="${c.tank}" stroke-width="2"/>`
            + `<path d="M47.4 61L40.6 61.8" stroke="#2a2d33" stroke-width="1.8"/><path d="M40.2 61.8h2.8" stroke="#1d1d23" stroke-width="2.6" stroke-linecap="round"/><path d="M46 61L44.6 55" stroke="${CHROM}" stroke-width=".8"/><circle cx="44.4" cy="54.2" r="1.7" fill="${CHROM}" stroke="#6b7078" stroke-width=".4"/>`
            + `<circle cx="49.8" cy="64.4" r="3.8" fill="${CHROM}" stroke="#555b63" stroke-width=".7"/><circle cx="50.6" cy="64.4" r="2.4" fill="#fff5c9"/>`;
        }
        if (ansicht === "hinten") {
          return simmeBeine(f)
            + `<path d="M25.6 73.8Q25.6 71 32 71Q38.4 71 38.4 73.8V75.4H25.6Z" fill="#1d1d23"/>`
            + `<path d="M40 85Q44.6 85 46.4 81" fill="none" stroke="${CHROM}" stroke-width="2.2" stroke-linecap="round"/><rect x="42.6" y="79" width="6.4" height="3.4" rx="1.6" fill="${CHROM}" stroke="#6b7078" stroke-width=".5"/>`
            + `<rect x="29.4" y="80" width="5.2" height="11.4" rx="2.4" fill="#1d1d23"/><path d="M27 83V78Q27 75.4 32 75.4Q37 75.4 37 78V83Z" fill="${c.tank}" stroke="${c.dunkel}" stroke-width=".7"/>`
            + `<rect x="29.4" y="74.4" width="5.2" height="2.4" rx=".8" fill="#e5534b"/><rect x="27.8" y="78" width="8.4" height="4.6" rx=".6" fill="#f4f1ea" stroke="#1d1d23" stroke-width=".4"/><text x="32" y="81.6" text-anchor="middle" font-size="3.2" font-weight="900" fill="#1d1d23" font-family="ui-rounded, system-ui">S51</text>`;
        }
        return simmeBeine(f)
          + `<rect x="29.4" y="78.4" width="5.2" height="12.8" rx="2.4" fill="#1d1d23"/><path d="M27.6 81.4V78Q27.6 75.6 32 75.6Q36.4 75.6 36.4 78V81.4Z" fill="${c.tank}" stroke="${c.dunkel}" stroke-width=".7"/>`
          + `<path d="M28.4 66.6V79M35.6 66.6V79" stroke="${CHROM}" stroke-width="1.6"/>`
          + `<path d="M14.6 66.4Q32 64 49.4 66.4" fill="none" stroke="#2a2d33" stroke-width="1.8"/><rect x="11" y="64.8" width="5" height="3" rx="1.4" fill="#1d1d23"/><rect x="48" y="64.8" width="5" height="3" rx="1.4" fill="#1d1d23"/>${simmeSpiegel(16)}${simmeSpiegel(48)}`
          + `<circle cx="32" cy="70.4" r="4.8" fill="${CHROM}" stroke="#555b63" stroke-width=".8"/><circle cx="32" cy="70.4" r="3.2" fill="#fff5c9"/><circle cx="30.8" cy="69.2" r=".9" fill="#fff"/>`;
      }
      case "e46": {
        /* Der alte Dreier in Titansilber, mit einer Tür in Grundierung und
           ein paar Rostflecken: er hat schon einiges hinter sich. */
        const c = FAHRZEUG.e46.auto, d = dunkler(c, 0.35), tuer = "#7d8288", rost = "#8a4a22";
        const felge = (cx) => `<g class="fz-rad" style="transform-origin:${cx}px 86px"><circle cx="${cx}" cy="86" r="5.6" fill="#1d1d23"/><circle cx="${cx}" cy="86" r="3.4" fill="#c0c6cc"/>${[0, 72, 144, 216, 288].map((w) => `<path d="M${cx} 86L${(cx + Math.cos((w * Math.PI) / 180) * 3.2).toFixed(2)} ${(86 + Math.sin((w * Math.PI) / 180) * 3.2).toFixed(2)}" stroke="#7d8288" stroke-width=".9"/>`).join("")}<circle cx="${cx}" cy="86" r=".9" fill="#6b7078"/></g>`;
        if (seite) {
          // Lange Haube, flaches Dach, Stufenheck: so sieht ein Dreier von der Seite aus.
          return `<path d="M-3 84Q-4 75 -1 71L14 69.4L22 58Q23.4 56.4 25.6 56.4H38.4Q40.6 56.4 42 58.2L50.4 68.6L64 70.4Q67.4 72 66.6 84Z" fill="${c}" stroke="${d}" stroke-width="1"/>`
            + `<path d="M16.4 68.4L23.4 59.6Q24 58.8 25.4 58.8H31.2V68.4Z" fill="#9fd3ea" fill-opacity=".42" stroke="${d}" stroke-width=".7"/><path d="M33.2 58.8H38.4Q39.6 58.8 40.4 59.8L47.6 68.4H33.2Z" fill="#9fd3ea" fill-opacity=".42" stroke="${d}" stroke-width=".7"/>`
            + `<path d="M32.2 58.6V83H48.4V69.2L40.6 59.2Z" fill="${tuer}" fill-opacity=".8"/><path d="M33.2 58.8H38.4Q39.6 58.8 40.4 59.8L47.6 68.4H33.2Z" fill="#9fd3ea" fill-opacity=".42"/><path d="M32.2 58.6V83M16 69V83" stroke="${d}" stroke-width=".7"/>`
            + `<path d="M-2 74.4H66" stroke="${d}" stroke-width=".7"/><rect x="26" y="71.4" width="4" height="1.2" rx=".6" fill="${d}"/><rect x="42" y="71.4" width="4" height="1.2" rx=".6" fill="${d}"/>`
            + `<rect x="62" y="71.2" width="4.4" height="3" rx="1" fill="#fff5c9"/><rect x="-3" y="71.2" width="3.4" height="3.4" rx=".8" fill="#c8243a"/>`
            + `<circle cx="7" cy="80" r="1.4" fill="${rost}" opacity=".8"/><circle cx="57" cy="79" r="1" fill="${rost}" opacity=".8"/><path d="M1 81q2 1 4 0" stroke="${rost}" stroke-width=".8" fill="none"/>`
            + `${felge(9)}${felge(53)}`;
        }
        if (ansicht === "hinten") {
          return `<path d="M6 90Q4 66 13 52Q16 46 24 46H40Q48 46 51 52Q60 66 58 90Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M17 54Q19 50 25 50H39Q45 50 47 54L49 63H15Z" fill="#9fd3ea" fill-opacity=".38" stroke="${d}" stroke-width=".8"/>`
            + `<path d="M9 68H20V73H13Z" fill="#c8243a" stroke="#6b1018" stroke-width=".5"/><path d="M55 68H44V73H51Z" fill="#c8243a" stroke="#6b1018" stroke-width=".5"/><path d="M10 70.4H18M54 70.4H46" stroke="#f2a33a" stroke-width=".8"/>`
            + `<circle cx="32" cy="69" r="2" fill="#f4f4f4" stroke="#1d1d23" stroke-width=".6"/><path d="M32 67v4M30 69h4" stroke="#3f6fb5" stroke-width=".9"/>`
            + `<rect x="24" y="75" width="16" height="5.4" rx=".8" fill="#f4f1ea" stroke="${d}" stroke-width=".5"/><text x="32" y="79.4" text-anchor="middle" font-size="3.6" font-weight="900" fill="#1d1d23" font-family="ui-rounded, system-ui">PW E 46</text>`
            + `<circle cx="18" cy="80" r="1.2" fill="${rost}" opacity=".8"/><rect x="40" y="84" width="5" height="2.4" rx="1.2" fill="#6b7078"/>`
            + `<rect x="6" y="86" width="9" height="6" rx="2" fill="#1d1d23"/><rect x="49" y="86" width="9" height="6" rx="2" fill="#1d1d23"/>`;
        }
        return `<path d="M6 90Q4 66 13 52Q16 46 24 46H40Q48 46 51 52Q60 66 58 90Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M17 54Q19 50 25 50H39Q45 50 47 54L49 63H15Z" fill="#9fd3ea" fill-opacity=".34" stroke="${d}" stroke-width=".8"/>`
          + `<path d="M9 67Q10 65 13 65H23L22 71H11Z" fill="#dfe6ec" stroke="${d}" stroke-width=".6"/><path d="M55 67Q54 65 51 65H41L42 71H53Z" fill="#dfe6ec" stroke="${d}" stroke-width=".6"/>`
          + `<circle cx="14" cy="68" r="2" fill="#fff5c9"/><circle cx="19.4" cy="68" r="2" fill="#fff5c9"/><circle cx="50" cy="68" r="2" fill="#fff5c9"/><circle cx="44.6" cy="68" r="2" fill="#fff5c9"/>`
          + `<rect x="26" y="65" width="5.4" height="7" rx="2.4" fill="#1d1d23" stroke="#c0c6cc" stroke-width=".8"/><rect x="32.6" y="65" width="5.4" height="7" rx="2.4" fill="#1d1d23" stroke="#c0c6cc" stroke-width=".8"/>`
          + `<path d="M27.6 66.6v4M29.4 66.6v4M34.2 66.6v4M36 66.6v4" stroke="#55555c" stroke-width=".5"/><circle cx="32" cy="60.6" r="1.6" fill="#f4f4f4" stroke="#1d1d23" stroke-width=".5"/><path d="M32 59v3.2M30.4 60.6h3.2" stroke="#3f6fb5" stroke-width=".7"/>`
          + `<rect x="10" y="76" width="44" height="5" rx="1.6" fill="${d}"/><rect x="24" y="77" width="16" height="3.6" rx=".6" fill="#f4f1ea"/><circle cx="48" cy="74" r="1.1" fill="${rost}" opacity=".8"/>`
          + `<rect x="6" y="86" width="9" height="6" rx="2" fill="#1d1d23"/><rect x="49" y="86" width="9" height="6" rx="2" fill="#1d1d23"/>`;
      }
      case "aufsitzmaeher":
        if (seite) return `<path d="M10 84Q9 70 18 68H44Q52 68 56 76Q58 82 56 86H10Z" fill="#3f8a4a" stroke="#1d4a26" stroke-width="1"/><rect x="40" y="62" width="2" height="8" fill="#2a2d33"/><path d="M38 61.6h6" stroke="#2a2d33" stroke-width="2" stroke-linecap="round"/><path d="M12 74h40" stroke="#f2c94c" stroke-width="1.2"/>${rad(48, 88, 3.2)}${rad(20, 86.6, 5.2)}`;
        if (ansicht === "hinten") return `${rad(12, 87, 4.6)}${rad(52, 87, 4.6)}`;
        return `<path d="M12 90Q11 72 20 70H44Q53 72 52 90Z" fill="#3f8a4a" stroke="#1d4a26" stroke-width="1"/><rect x="22" y="78" width="20" height="6" rx="1" fill="#1d4a26"/><path d="M24 80h16M24 82h16" stroke="#6b7078" stroke-width=".6"/><circle cx="18" cy="76" r="2" fill="#fff5c9"/><circle cx="46" cy="76" r="2" fill="#fff5c9"/><path d="M26 66h12" stroke="#2a2d33" stroke-width="2" stroke-linecap="round"/>${rad(12, 88, 4)}${rad(52, 88, 4)}`;
      default:
        return "";
    }
  }

  /* Kopfbedeckungen der Kleidung. Sie liegen über den Haaren; die Seiten-
     ansicht schaut nach rechts, die Krempe einer Kappe zeigt also dorthin. */
  function kopf(f, ansicht) {
    const id = f.k.kopf;
    if (!id) return null;
    const seite = ansicht === "seite", hinten = ansicht === "hinten";
    switch (id) {
      case "basecap": {
        const c = "#2e6fb5", d = dunkler(c, 0.35);
        if (seite) return `<path d="M19 22Q19 11 32 11Q43 11 44.6 20.6Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M42 20Q49 19.4 52 22.4Q47 23.4 42 22.6Z" fill="${d}"/><circle cx="31" cy="11.4" r="1.2" fill="${d}"/>`;
        if (hinten) return `<path d="M18.4 23Q18 10.6 32 10.6Q46 10.6 45.6 23Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M27 21Q32 18.4 37 21" fill="none" stroke="${d}" stroke-width="1.6"/><circle cx="32" cy="10.8" r="1.2" fill="${d}"/>`;
        return `<path d="M18.4 22Q18 10.6 32 10.6Q46 10.6 45.6 22Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M17 22.4Q32 18 47 22.4Q44 26.4 32 25.4Q20 26.4 17 22.4Z" fill="${d}"/><path d="M32 11V21" stroke="${d}" stroke-width=".7"/><circle cx="32" cy="10.8" r="1.2" fill="${d}"/><path d="M27.6 15.4h8.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`;
      }
      case "stirnband":
        return `<path d="${seite ? "M20 23.4Q32 20.6 45.2 23.4L45 27.4Q32 24.8 20.4 27.6Z" : "M18.6 23.6Q32 20 45.4 23.6L45.2 27.6Q32 24.4 18.8 27.8Z"}" fill="#e5534b" stroke="#8e2320" stroke-width=".7"/><path d="${seite ? "M20.4 25.4Q32 22.8 45 25.4" : "M18.8 25.6Q32 22.2 45.2 25.6"}" fill="none" stroke="#fff" stroke-width="1"/>`;
      case "beanie": {
        const c = "#d9a13a", d = dunkler(c, 0.3);
        return `<path d="M17.8 24Q17 8.6 32 8.4Q47 8.6 46.2 24Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M22 12v11M27 10v13M32 9v14M37 10v13M42 12v11" stroke="${d}" stroke-opacity=".45" stroke-width=".8"/><rect x="17" y="20.6" width="30" height="5.6" rx="2.2" fill="${d}"/>${seite ? "" : `<rect x="29" y="21.6" width="6" height="3.4" rx=".6" fill="#1d1d23"/>`}`;
      }
      case "fischerhut": {
        const c = "#e8dcc4", d = dunkler(c, 0.28);
        return `<path d="M20 20Q20 9 32 9Q44 9 44 20Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M14 23.6Q32 17 50 23.6L47 26.6Q32 22 17 26.6Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M20.2 19.6H43.8" stroke="${d}" stroke-width="1.2"/><path d="M22 14q5-2 8 1M34 12q5 0 7 3" fill="none" stroke="#6fb6d9" stroke-width="1"/>`;
      }
      case "partyhut":
        return `<g class="fg-partyhut"><path d="M24 20L32 -2L40 20Z" fill="#8d5bd6" stroke="#4a2a80" stroke-width="1"/><path d="M26.6 13L37.4 13M28.8 7L35.2 7" stroke="#f2c94c" stroke-width="1.6"/><circle cx="29" cy="17" r="1" fill="#4fb76a"/><circle cx="35" cy="17" r="1" fill="#e5534b"/><circle cx="32" cy="-2.6" r="2.4" fill="#f06a8a"/></g>${seite ? "" : `<path d="M24.4 20Q22 30 20.6 32M39.6 20Q42 30 43.4 32" fill="none" stroke="#1d1d23" stroke-width=".5"/>`}`;
      case "bauhelm": {
        const c = "#f2c230", d = dunkler(c, 0.35);
        return `<path d="M17.6 22Q17.4 8.6 32 8.4Q46.6 8.6 46.4 22Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M29.8 8.8H34.2V21H29.8Z" fill="${dunkler(c, 0.12)}"/><path d="M14.6 22.6H49.4Q49 25.6 46 25.6H18Q15 25.6 14.6 22.6Z" fill="${c}" stroke="${d}" stroke-width="1"/>${seite || hinten ? "" : `<rect x="27" y="14" width="10" height="4" rx="1" fill="#fff" opacity=".8"/>`}`;
      }
      case "kopfhoerer": {
        const c = "#1d1d23", r = "#e5534b";
        if (seite) return `<path d="M22 30Q20 10 33 10Q44 10.6 43 22" fill="none" stroke="${c}" stroke-width="3.2"/><rect x="22.8" y="23.6" width="8.4" height="12.4" rx="3.4" fill="${c}" stroke="${r}" stroke-width="1.4"/><path d="M29 34Q34 40 38 38" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="38.4" cy="38" r="1.2" fill="${r}"/>`;
        return `<path d="M18.6 30Q17.6 10 32 10Q46.4 10 45.4 30" fill="none" stroke="${c}" stroke-width="3.2"/><rect x="13.6" y="23.6" width="8" height="13" rx="3.4" fill="${c}" stroke="${r}" stroke-width="1.4"/><rect x="42.4" y="23.6" width="8" height="13" rx="3.4" fill="${c}" stroke="${r}" stroke-width="1.4"/>${hinten ? "" : `<path d="M20 34Q22 40 27 38.6" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="27.4" cy="38.4" r="1.2" fill="${r}"/>`}`;
      }
      case "blumenkranz":
        return `<path d="M18.6 22Q32 15 45.4 22" fill="none" stroke="#3f8a4a" stroke-width="1.6"/>${[[19.4, 21.4, "#f06a8a"], [24, 18.4, "#f9e27a"], [29, 16.8, "#7ec8ff"], [35, 16.8, "#f06a8a"], [40, 18.4, "#f9e27a"], [44.6, 21.4, "#c49bff"]].map(([x, y, c]) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((w) => `<circle cx="${(Math.cos((w * Math.PI) / 180) * 1.6).toFixed(2)}" cy="${(Math.sin((w * Math.PI) / 180) * 1.6).toFixed(2)}" r="1.3" fill="${c}"/>`).join("")}<circle r=".9" fill="#fff4c9"/></g>`).join("")}`;
      case "haarreif":
        if (hinten) return `<path d="M18.6 26Q32 13 45.4 26" fill="none" stroke="#e5534b" stroke-width="2"/>`;
        if (seite) return `<path d="M21 25Q28 13 42 17" fill="none" stroke="#e5534b" stroke-width="2"/><path d="M27 15.4l-4-3v6zM27 15.4l4-3v6z" fill="#e5534b" stroke="#8e2320" stroke-width=".6"/><circle cx="27" cy="15.4" r="1.2" fill="#8e2320"/>`;
        return `<path d="M18.8 24Q32 12 45.2 24" fill="none" stroke="#e5534b" stroke-width="2"/><path d="M24 16.6l-4.6-3.2v6.4zM24 16.6l4.6-3.2v6.4z" fill="#e5534b" stroke="#8e2320" stroke-width=".6"/><circle cx="24" cy="16.6" r="1.3" fill="#8e2320"/>`;
      case "baskenmuetze": {
        const c = "#2b2f3a";
        if (seite) return `<ellipse cx="33" cy="15.6" rx="14" ry="5.4" fill="${c}" transform="rotate(-8 33 15.6)"/><path d="M33 10.4v-2" stroke="${c}" stroke-width="1.6"/>`;
        return `<ellipse cx="34" cy="15.2" rx="15.6" ry="5.6" fill="${c}" transform="rotate(${hinten ? -6 : 8} 34 15.2)"/><path d="M34 10v-2.2" stroke="${c}" stroke-width="1.6"/>`;
      }
      case "sonnenhut": {
        const c = "#e8d39a", d = "#a8916a";
        if (seite) return `<path d="M24 19Q24 9 32.6 9Q41 9 41 19Z" fill="${c}" stroke="${d}" stroke-width=".9"/><path d="M24.4 17.4H40.6" stroke="#f06a8a" stroke-width="1.8"/><ellipse cx="32.6" cy="19.6" rx="17" ry="3.2" fill="${c}" stroke="${d}" stroke-width=".9"/>`;
        return `<path d="M22.6 19Q22.6 8.4 32 8.4Q41.4 8.4 41.4 19Z" fill="${c}" stroke="${d}" stroke-width=".9"/><path d="M23 17.2H41" stroke="#f06a8a" stroke-width="1.8"/>${hinten ? "" : `<circle cx="38" cy="16.6" r="1.6" fill="#f9e27a"/>`}<ellipse cx="32" cy="19.8" rx="20" ry="3.8" fill="${c}" stroke="${d}" stroke-width=".9"/><path d="M14 19.6q18 3 36 0" fill="none" stroke="${d}" stroke-width=".5" stroke-dasharray="1 1.2"/>`;
      }
      case "diadem":
        if (hinten) return `<path d="M19.6 23Q32 18.6 44.4 23" fill="none" stroke="#e2b656" stroke-width="1.6"/>`;
        if (seite) return `<path d="M24 20Q32 16 42 19" fill="none" stroke="#e2b656" stroke-width="1.6"/><path d="M36 18L38 13L40 18.4" fill="#e2b656" stroke="#8e6931" stroke-width=".5"/><circle cx="38" cy="15.6" r="1" fill="#7ec8ff" class="fg-glitzer"/>`;
        return `<path d="M20 22Q32 17 44 22" fill="none" stroke="#e2b656" stroke-width="1.6"/><path d="M25.6 20.2L28 15L30 19.4L32 11.6L34 19.4L36 15L38.4 20.2" fill="#e2b656" stroke="#8e6931" stroke-width=".6"/><circle cx="32" cy="15.6" r="1.4" fill="#7ec8ff" stroke="#3f6fd0" stroke-width=".4"/><circle cx="28" cy="18" r=".8" fill="#f06a8a"/><circle cx="36" cy="18" r=".8" fill="#f06a8a"/><g class="fg-glitzer" fill="#fff"><circle cx="30" cy="13.6" r=".5"/><circle cx="35" cy="14.6" r=".5"/></g>`;
      case "kochmuetze":
        return `<path d="M21 20V14Q14 12 17 5Q20 0 25 3Q27 -3 32 -2Q37 -3 39 3Q44 0 47 5Q50 12 43 14V20Z" fill="#fbf9f4" stroke="#c9c1ac" stroke-width="1"/><rect x="20.4" y="17" width="23.2" height="5" rx="1.6" fill="#f0ece2" stroke="#c9c1ac" stroke-width=".8"/><path d="M26 6q1 5 0 10M32 4v12M38 6q-1 5 0 10" stroke="#e2dcc9" stroke-width=".8" fill="none"/>`;
      case "cowboyhut": {
        const c = "#8a5a2e", d = dunkler(c, 0.35);
        return `<path d="M22 19L23 8Q27.6 5 32 8Q36.4 5 41 8L42 19Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M22.4 16.6H41.6" stroke="#3a2718" stroke-width="2.2"/><path d="M10 19.6Q14 24.6 32 23.6Q50 24.6 54 19.6Q52 17 46 18.4Q32 21 18 18.4Q12 17 10 19.6Z" fill="${c}" stroke="${d}" stroke-width="1"/>`;
      }
      case "piratenhut":
        return `<path d="M13 22Q12 14 18 12Q24 4 32 6Q40 4 46 12Q52 14 51 22Q32 16 13 22Z" fill="#1d1d23" stroke="#000" stroke-width="1"/><path d="M14.6 20.6Q32 15 49.4 20.6" fill="none" stroke="#e2b656" stroke-width="1.2"/>${seite || hinten ? "" : `<circle cx="32" cy="12.4" r="2.6" fill="#f4efe2"/><path d="M28.6 16l6.8-2.4M28.6 13.6l6.8 2.4" stroke="#f4efe2" stroke-width="1"/><circle cx="31.2" cy="12.2" r=".5" fill="#1d1d23"/><circle cx="32.8" cy="12.2" r=".5" fill="#1d1d23"/>`}`;
      case "schalenhelm": {
        /* Der offene Helm mit Lederlaschen über den Ohren, wie ihn jeder
           auf der Simme hatte. Der rote Streifen läuft über den Scheitel. */
        const c = "#ece8de", d = "#a8a294", leder = "#6b4423";
        if (seite) return `<path d="M19 27Q18.6 9 32 9Q45 9 45.6 25Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M22 14Q32 7 43 14" fill="none" stroke="#c8243a" stroke-width="3"/><path d="M42.6 23.6Q49 22.8 51 25.4Q47 27 42.8 26.4Z" fill="#2a2d33"/><path d="M25.6 24h6v8q-3 2-6 0z" fill="${leder}"/><path d="M28.6 32Q32 41 40 41" fill="none" stroke="${leder}" stroke-width="1"/>`;
        if (hinten) return `<path d="M17 28Q16.4 8.4 32 8.2Q47.6 8.4 47 28Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M30 8.6H34V28H30Z" fill="#c8243a"/><path d="M17 24h5v9q-3 0-5-3zM47 24h-5v9q3 0 5-3z" fill="${leder}"/>`;
        return `<path d="M17 27Q16.4 8.4 32 8.2Q47.6 8.4 47 27Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M30 8.6H34V22H30Z" fill="#c8243a"/><path d="M20 24.6Q32 20.4 44 24.6L42.6 27.2Q32 24 21.4 27.2Z" fill="#2a2d33"/><path d="M17 24h5v10q-3 0-5-3zM47 24h-5v10q3 0 5-3z" fill="${leder}"/><path d="M20 33Q32 46 44 33" fill="none" stroke="${leder}" stroke-width="1"/><path d="M22 14q3-3 6-3.6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/>`;
      }
      case "wikingerhelm": {
        const c = "#8b929c", d = dunkler(c, 0.4);
        return `<path d="M17.6 23Q17.4 9 32 8.6Q46.6 9 46.4 23Z" fill="${c}" stroke="${d}" stroke-width="1"/><path d="M17 20.4H47" stroke="#c9a14a" stroke-width="2.6"/><path d="M32 9V20" stroke="#c9a14a" stroke-width="2"/><path d="M18 15Q10 12 9 2Q14 8 19.6 10Z" fill="#f4efe2" stroke="#b9b3a2" stroke-width=".8"/><path d="M46 15Q54 12 55 2Q50 8 44.4 10Z" fill="#f4efe2" stroke="#b9b3a2" stroke-width=".8"/>${[21, 26, 38, 43].map((x) => `<circle cx="${x}" cy="20.4" r=".7" fill="#6e5420"/>`).join("")}`;
      }
      default:
        return null;
    }
  }

  Casino.figurTeile = {
    kopf,
    bein, beinSeite, traeger, schuh, schuhSeite, rumpf, aermel, oberVon,
    frisurHinten, frisurVorn, brille, accessoireHinten, accessoireVorn, handding,
    fahrzeugHinten, fahrzeugVorn, FAHRZEUG, dunkler, haarFarbe,
  };
})();
