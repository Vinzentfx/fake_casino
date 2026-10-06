"use strict";

/*
 * Wie Räume und Möbel aussehen.
 *
 * Gezeichnet wird in Pixeln einer Kachel von 48, die Kamera skaliert
 * danach. Alles, was zum Thema gehört (Wände, Boden, Filz, Goldkanten),
 * färbt sich über Klassen aus public/css/welt.css und damit über die
 * Tokens der drei Paletten. Fest eingetragen sind nur Dinge mit eigener
 * Farbe: Holz, Automatengehäuse, Pflanzen, die Stadtkarte. Das ist dieselbe
 * Ausnahme wie bei Spielkarten und den Eigenfarben der Automaten.
 *
 * Jede Zeichnung liefert ein Rechteck in Weltpixeln. Unten in der Mitte
 * steht das Ding auf dem Boden, danach wird es gegen die Figuren sortiert.
 */
(function () {
  const Casino = (window.Casino = window.Casino || {});
  const T = 48;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const AUTOMAT = {
    rot: ["#c8453c", "#7c211c", "#ffd36b"],
    blau: ["#3f6fd0", "#1f3a78", "#9fe7ff"],
    tuerkis: ["#23a197", "#0e5752", "#b5ffd9"],
    gold: ["#d6a93a", "#7c5b12", "#fff0a8"],
  };

  function svg(w, h, innen, klasse = "") {
    return `<svg class="${klasse}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" focusable="false" aria-hidden="true">${innen}</svg>`;
  }

  function automat(ding) {
    const [f, fd, licht] = AUTOMAT[ding.farbe] || AUTOMAT.rot;
    const w = 56, h = 112;
    const symbole = { rot: ["7", "7", "7"], blau: ["◆", "◆", "◆"], tuerkis: ["✿", "✿", "✿"], gold: ["▲", "▲", "▲"] }[ding.farbe] || ["7", "7", "7"];
    const innen = `
      <rect x="4" y="106" width="48" height="5" rx="2" fill="#000" opacity=".25"/>
      <rect x="5" y="18" width="46" height="90" rx="5" fill="${fd}"/>
      <rect x="7" y="20" width="42" height="84" rx="4" fill="${f}"/>
      <path d="M7 24Q7 4 28 3Q49 4 49 24Z" fill="${fd}"/>
      <path d="M10 23Q10 8 28 7Q46 8 46 23Z" fill="${f}"/>
      <g class="m-birnen">${[12, 18, 24, 32, 38, 44].map((x, i) => `<circle cx="${x}" cy="${i % 5 === 0 ? 20 : 12 + Math.abs(28 - x) * 0.25}" r="1.6" fill="${licht}"/>`).join("")}</g>
      <text x="28" y="20" text-anchor="middle" font-size="7.5" font-weight="800" fill="${licht}" font-family="ui-rounded, system-ui"${ding.label.length > 8 ? ' textLength="40" lengthAdjust="spacingAndGlyphs"' : ""}>${esc(ding.label)}</text>
      <rect x="10" y="30" width="36" height="24" rx="3" fill="#10141a"/>
      ${symbole.map((s, i) => `<rect x="${12 + i * 11.3}" y="32" width="9.6" height="20" rx="2" fill="#f4efe2"/><text x="${16.8 + i * 11.3}" y="46" text-anchor="middle" font-size="10" font-weight="900" fill="${fd}">${s}</text>`).join("")}
      <path d="M10 42H46" stroke="#e5534b" stroke-width=".8" opacity=".7"/>
      <rect x="10" y="60" width="36" height="12" rx="2.5" fill="${fd}"/>
      <circle cx="18" cy="66" r="3.2" fill="#e5534b"/><circle cx="28" cy="66" r="3.2" fill="#f2c94c"/><circle cx="38" cy="66" r="3.2" fill="#4fb76a"/>
      <rect x="14" y="78" width="28" height="4" rx="2" fill="#10141a"/>
      <rect x="10" y="88" width="36" height="14" rx="2" fill="${fd}" opacity=".7"/>
      <path d="M50 44h3v-14" stroke="#9aa0a6" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="53" cy="28" r="3.4" fill="#e5534b"/>`;
    return { svg: svg(w, h, innen, "m-automat"), w, h };
  }

  /* Das Glücksrad hat dieselben zwölf Felder wie das echte, gemessen ab
     oben im Uhrzeigersinn wie in public/js/wheel.js. Welche Stufe ein Feld
     hat, weiß nur der Server; bis die Antwort da ist, wechseln sich Chips
     und Sonderfeld ab, so wie sie auch auf dem echten Rad liegen. */
  const RAD_FELDER = 12;
  /* Das Glücksrad: Holzrand mit Lauflichtern, beschriftete Felder (die
     Beschriftung setzt welt.js aus wheel:state), eine Zeigerzunge oben, die
     beim Drehen über die Stifte klappert, und ein Sockel mit Schild. */
  function rad() {
    const w = 132, h = 154;
    const cx = 66, cy = 68, r = 50;
    const p = (grad, rr = r) => { const a = (grad * Math.PI) / 180; return `${(cx + Math.sin(a) * rr).toFixed(1)} ${(cy - Math.cos(a) * rr).toFixed(1)}`; };
    let stuecke = "", texte = "", stifte = "";
    for (let i = 0; i < RAD_FELDER; i++) {
      const a1 = (i * 360) / RAD_FELDER, a2 = ((i + 1) * 360) / RAD_FELDER, mitte = (a1 + a2) / 2;
      stuecke += `<path class="m-radfeld rs-${i % 2 ? "sonder" : "klein"}" data-feld="${i}" d="M${cx} ${cy}L${p(a1)}A${r} ${r} 0 0 1 ${p(a2)}Z"/>`;
      // Die Schrift liegt entlang des Radius, wie auf einem echten Rad.
      const [tx, ty] = p(mitte, r * 0.6).split(" ");
      texte += `<text class="m-radtext" data-feld-text="${i}" x="${tx}" y="${ty}" transform="rotate(${(mitte - 90).toFixed(1)} ${tx} ${ty})" text-anchor="middle" dominant-baseline="central"></text>`;
      stifte += `<circle cx="${p(a1, r + 1).split(" ")[0]}" cy="${p(a1, r + 1).split(" ")[1]}" r="1.6" fill="#e2b656" stroke="#6b4b16" stroke-width=".5"/>`;
    }
    const birnen = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<circle class="m-radbirne" style="--i:${i % 3}" cx="${(cx + Math.cos(a) * (r + 7)).toFixed(1)}" cy="${(cy + Math.sin(a) * (r + 7)).toFixed(1)}" r="2"/>`; }).join("");
    const innen = `
      <defs><radialGradient id="m-rad-glanz" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient></defs>
      <ellipse cx="${cx}" cy="${h - 4}" rx="34" ry="4" fill="#000" opacity=".3"/>
      <path d="M${cx - 12} ${cy + r + 4}L${cx - 26} ${h - 8}H${cx + 26}L${cx + 12} ${cy + r + 4}Z" fill="#5a3d27" stroke="#2b1a0c" stroke-width="1"/>
      <path d="M${cx - 30} ${h - 10}H${cx + 30}V${h - 4}H${cx - 30}Z" class="m-gold"/>
      <rect x="${cx - 24}" y="${h - 26}" width="48" height="11" rx="2" fill="#1a1d24" stroke="#e2b656" stroke-width=".8"/>
      <text x="${cx}" y="${h - 18}" text-anchor="middle" font-size="6.4" font-weight="900" letter-spacing="1.2" fill="#f4d782" font-family="ui-rounded, system-ui">GLÜCKSRAD</text>
      <circle cx="${cx}" cy="${cy}" r="${r + 11}" fill="#4a2e14" stroke="#2b1a0c" stroke-width="1.2"/>
      <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="none" class="m-gold-strich" stroke-width="5"/>
      <g class="m-radbirnen">${birnen}</g>
      <g class="m-rad-drehung" style="transform-origin:${cx}px ${cy}px">${stuecke}
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#m-rad-glanz)" pointer-events="none"/>
        ${texte}${stifte}</g>
      <circle cx="${cx}" cy="${cy}" r="12" class="m-gold"/><circle cx="${cx}" cy="${cy}" r="12" fill="url(#m-rad-glanz)"/>
      <path d="M${cx} ${cy - 7}l2 4.4 4.8.6-3.5 3.3.9 4.8-4.2-2.3-4.2 2.3.9-4.8-3.5-3.3 4.8-.6z" fill="#fff5d6" stroke="#8e6931" stroke-width=".6"/>
      <g class="m-rad-zeiger" style="transform-origin:${cx}px 4px"><path d="M${cx - 7} 2H${cx + 7}L${cx} 20Z" fill="#d6402f" stroke="#6b1018" stroke-width="1"/><circle cx="${cx}" cy="5" r="2.6" class="m-gold"/></g>`;
    return { svg: svg(w, h, innen, "m-rad"), w, h };
  }

  /* „Fake Casino“ als Leuchtschild mit Glühbirnenrahmen. Schmal genug, dass
     es zwischen Glücksrad und Torbogen passt; vorher ragte es in beide
     hinein, und das Flackern der Schrift sah aus wie ein Darstellungsfehler. */
  function schild() {
    const w = 96, h = 78;
    const birnen = [];
    for (let i = 0; i < 9; i++) birnen.push([8 + i * 10, 6], [8 + i * 10, h - 12]);
    for (let i = 1; i < 6; i++) birnen.push([6, 6 + i * 10], [w - 6, 6 + i * 10]);
    const innen = `
      <rect x="2" y="2" width="${w - 4}" height="${h - 8}" rx="8" fill="#2a0d14" stroke="#e2b656" stroke-width="2"/>
      <rect x="10" y="12" width="${w - 20}" height="${h - 28}" rx="4" fill="#12060a"/>
      <g class="m-schildbirnen">${birnen.map(([x, y], i) => `<circle class="m-schildbirne" style="--i:${i % 2}" cx="${x}" cy="${y}" r="2.1"/>`).join("")}</g>
      <text x="${w / 2}" y="29" text-anchor="middle" font-size="10" letter-spacing="5" class="m-schild-fake" font-weight="800" font-family="ui-rounded, system-ui">FAKE</text>
      <text x="${w / 2}" y="51" text-anchor="middle" font-size="19" letter-spacing="1.5" class="m-schild-casino" font-weight="900" font-family="Georgia, serif">CASINO</text>
      <path d="M22 57H${w - 22}" stroke="#e2b656" stroke-opacity=".7" stroke-width="1"/>`;
    return { svg: svg(w, h, innen, "m-schild"), w, h, unten: -30 };
  }

  function spielhalle() {
    const w = 148, h = 104;
    const bild = [
      `<path d="M0 6L6 -6L12 6Z" fill="#ff8a3d"/><circle cx="6" cy="0" r="1.6" fill="#fff"/>`,
      `<circle cx="6" cy="1" r="5" fill="#23262b"/><path d="M9 -3q2 -2 1 -4" stroke="#ffcf4a" fill="none"/>`,
      `<rect x="1" y="-6" width="10" height="12" fill="#8d5bd6"/><rect x="3" y="-4" width="6" height="2" fill="#fff"/><rect x="3" y="1" width="6" height="2" fill="#fff"/>`,
    ];
    const farben = [["#8d5bd6", "#3a1f6b"], ["#e5534b", "#6d1f1b"], ["#23a197", "#0e4a45"]];
    const innen = farben.map(([f, fd], i) => {
      const x = i * 49;
      return `<g transform="translate(${x} 0)">
        <rect x="3" y="100" width="44" height="4" rx="2" fill="#000" opacity=".25"/>
        <path d="M5 102V26L10 10H40L45 26V102Z" fill="${fd}"/>
        <path d="M8 100V28L12 14H38L42 28V100Z" fill="${f}"/>
        <rect x="12" y="18" width="26" height="7" rx="2" fill="${fd}"/>
        <rect x="12" y="30" width="26" height="22" rx="2" fill="#0b0e14"/>
        <g class="m-bildschirm" transform="translate(19 41)">${bild[i]}</g>
        <path d="M10 60H40L42 70H8Z" fill="${fd}"/>
        <circle cx="18" cy="64" r="2.4" fill="#f2c94c"/><circle cx="31" cy="64" r="2.4" fill="#4fb76a"/>
        <rect x="12" y="76" width="26" height="20" rx="2" fill="${fd}" opacity=".6"/>
      </g>`;
    }).join("");
    return { svg: svg(w, h, innen, "m-spielhalle"), w, h };
  }

  function wettschalter() {
    const w = 98, h = 116;
    const innen = `
      <rect x="18" y="4" width="62" height="40" rx="4" fill="#1a1d24" stroke="#555c66" stroke-width="2"/>
      <rect x="22" y="8" width="54" height="32" rx="2" fill="#2f7a3c"/>
      <path d="M22 24H76M49 8V40" stroke="#dff5d9" stroke-opacity=".7" stroke-width=".8"/>
      <circle cx="49" cy="24" r="6" fill="none" stroke="#dff5d9" stroke-opacity=".7" stroke-width=".8"/>
      <circle class="m-ball" cx="36" cy="18" r="2" fill="#fff"/>
      <rect x="46" y="44" width="6" height="16" fill="#555c66"/>
      <path d="M2 64H96V112H2Z" fill="#5a3d27"/>
      <path d="M0 60H98V68H0Z" class="m-holz-hell"/>
      <rect x="10" y="74" width="78" height="30" rx="3" class="m-filz"/>
      <text x="49" y="94" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="2" class="m-akzent-text">WETTEN</text>`;
    return { svg: svg(w, h, innen, "m-wett"), w, h };
  }

  /* Maße des kleinen Tableaus in Pixeln des Tischs. welt.js liest dieselben
     Zahlen, um jeden Einsatz auf seine Fläche zu legen. */
  const TABLEAU = { x: 78, y: 9, zw: 12, zh: 14, dy: 38, ay: 47, rh: 8 };
  function roulette(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 20;
    /* Das Tableau im Kleinen, mit einer Fläche für jede Wette, die man in
       der Welt setzen kann (TABLEAU in welt.js legt die Chips genau dorthin):
       Null links, Zahlen in 6 × 2 Feldern, darunter die Dutzende und die
       Reihe 1 bis 18, Gerade, Rot, Schwarz, Ungerade, 19 bis 36. */
    const L = TABLEAU;
    const zahlen = Array.from({ length: 12 }, (_, i) => {
      const cx = L.x + (i % 6) * L.zw, cy = L.y + Math.floor(i / 6) * L.zh;
      return `<rect x="${cx}" y="${cy}" width="${L.zw - 1}" height="${L.zh - 1}" fill="${(i + Math.floor(i / 6)) % 2 ? "#1a1a1a" : "#b3261e"}" stroke="#e8e2cc" stroke-width=".6"/>`;
    }).join("");
    const linie = `stroke="#e8e2cc" stroke-width=".6" fill="none"`;
    const schrift = (x, y, t) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="4.6" font-weight="800" fill="#e8e2cc">${t}</text>`;
    const dutzende = [0, 1, 2].map((k) => `<rect x="${L.x + k * L.zw * 2}" y="${L.dy}" width="${L.zw * 2 - 1}" height="${L.rh}" ${linie}/>`
      + schrift(L.x + k * L.zw * 2 + L.zw - 0.5, L.dy + 5.6, ["1-12", "13-24", "25-36"][k])).join("");
    const aussen = ["1-18", "GER", "rot", "schwarz", "UNG", "19-36"].map((t, k) => {
      const x = L.x + k * L.zw, mx = x + L.zw / 2 - 0.5, my = L.ay + L.rh / 2;
      const inhalt = t === "rot" ? `<path d="M${mx} ${my - 3}l3 3-3 3-3-3z" fill="#b3261e"/>`
        : t === "schwarz" ? `<path d="M${mx} ${my - 3}l3 3-3 3-3-3z" fill="#1a1a1a" stroke="#e8e2cc" stroke-width=".4"/>`
          : schrift(mx, my + 1.6, t);
      return `<rect x="${x}" y="${L.ay}" width="${L.zw - 1}" height="${L.rh}" ${linie}/>${inhalt}`;
    }).join("");
    const innen = `
      <rect x="4" y="${tiefe + 8}" width="${w - 8}" height="10" rx="3" fill="#000" opacity=".25"/>
      <rect x="2" y="2" width="${w - 4}" height="${tiefe}" rx="16" fill="#5a3d27"/>
      <rect x="2" y="${tiefe - 8}" width="${w - 4}" height="20" rx="8" fill="#4a3120"/>
      <rect x="8" y="6" width="${w - 16}" height="${tiefe - 12}" rx="11" class="m-filz"/>
      <circle cx="40" cy="${tiefe / 2}" r="${tiefe / 2 - 12}" fill="#4a3120"/>
      <g class="m-roulette-rad" style="transform-origin:40px ${tiefe / 2}px">
        <circle cx="40" cy="${tiefe / 2}" r="${tiefe / 2 - 16}" fill="#b3261e"/>
        <circle cx="40" cy="${tiefe / 2}" r="${tiefe / 2 - 16}" fill="none" stroke="#1a1a1a" stroke-width="7" stroke-dasharray="4 4"/>
        <circle cx="40" cy="${tiefe / 2}" r="7" class="m-gold"/>
        <circle cx="${40 + tiefe / 2 - 20}" cy="${tiefe / 2}" r="2" fill="#fff"/>
      </g>
      ${zahlen}
      <rect x="${L.x - L.zw}" y="${L.y}" width="${L.zw - 1}" height="${L.zh * 2 - 1}" fill="#2f7a3c" stroke="#e8e2cc" stroke-width=".6"/>
      ${schrift(L.x - L.zw / 2 - 0.5, L.y + L.zh + 1.6, "0")}
      ${dutzende}${aussen}`;
    /* Die Einsätze, die man in der Welt setzt, liegen hier auf dem Filz. */
    return { svg: svg(w, h, innen, "m-tisch"), w, h, unten: 12, html: `<div class="welt-anzeige welt-tischchips" data-anzeige="roulette-chips"></div>` };
  }

  function blackjack(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 34;
    const mx = w / 2;
    const innen = `
      <ellipse cx="${mx}" cy="${tiefe + 24}" rx="${w / 2 - 6}" ry="7" fill="#000" opacity=".22"/>
      <path d="M4 4H${w - 4}V${tiefe - 6}Q${mx} ${tiefe + 34} 4 ${tiefe - 6}Z" fill="#5a3d27"/>
      <path d="M11 8H${w - 11}V${tiefe - 8}Q${mx} ${tiefe + 22} 11 ${tiefe - 8}Z" class="m-filz"/>
      <path d="M22 ${tiefe - 12}Q${mx} ${tiefe + 10} ${w - 22} ${tiefe - 12}" fill="none" class="m-akzent-linie" stroke-width="1" stroke-opacity=".7"/>
      <rect x="${mx - 22}" y="10" width="44" height="12" rx="2" fill="#2b1d12"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${mx - 20 + i * 8}" y="12" width="6" height="8" rx="1" fill="${["#e5534b", "#f2c94c", "#4fb76a", "#3f6fd0", "#e8e2cc"][i]}"/>`).join("")}
      <rect x="${mx - 12}" y="28" width="11" height="15" rx="1.6" fill="#f4efe2" stroke="#999" stroke-width=".5" transform="rotate(-8 ${mx - 6} 35)"/>
      <rect x="${mx + 1}" y="28" width="11" height="15" rx="1.6" class="m-kartenruecken" stroke="#fff" stroke-width=".6" transform="rotate(6 ${mx + 6} 35)"/>
      ${[0.18, 0.39, 0.61, 0.82].map((t) => `<rect x="${(w * t - 8).toFixed(1)}" y="${tiefe - 14 + Math.sin(t * Math.PI) * 10}" width="16" height="10" rx="3" fill="none" stroke="#e8e2cc" stroke-opacity=".5" stroke-width=".8"/>`).join("")}`;
    return { svg: svg(w, h, innen, "m-tisch"), w, h, unten: 28 };
  }

  function poker(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 22;
    const mx = w / 2, my = tiefe / 2 + 4;
    const innen = `
      <ellipse cx="${mx}" cy="${tiefe + 13}" rx="${w / 2 - 6}" ry="6" fill="#000" opacity=".22"/>
      <rect x="2" y="4" width="${w - 4}" height="${tiefe + 8}" rx="${(tiefe + 8) / 2}" fill="#4a3120"/>
      <rect x="2" y="2" width="${w - 4}" height="${tiefe + 2}" rx="${(tiefe + 2) / 2}" fill="#5a3d27"/>
      <rect x="9" y="8" width="${w - 18}" height="${tiefe - 10}" rx="${(tiefe - 10) / 2}" class="m-filz"/>
      <rect x="9" y="8" width="${w - 18}" height="${tiefe - 10}" rx="${(tiefe - 10) / 2}" fill="none" class="m-akzent-linie" stroke-opacity=".5"/>
      ${[-2, -1, 0, 1, 2].map((i) => `<rect x="${mx - 5 + i * 12}" y="${my - 8}" width="10" height="14" rx="1.5" fill="#f4efe2" stroke="#999" stroke-width=".5"/>`).join("")}
      <circle cx="${mx - 38}" cy="${my + 4}" r="4" fill="#e5534b" stroke="#fff" stroke-width="1"/><circle cx="${mx - 34}" cy="${my + 1}" r="4" fill="#3f6fd0" stroke="#fff" stroke-width="1"/>
      <circle cx="${mx + 38}" cy="${my + 3}" r="4" fill="#1a1a1a" stroke="#fff" stroke-width="1"/>`;
    return { svg: svg(w, h, innen, "m-tisch"), w, h, unten: 12 };
  }

  function sofa(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 26;
    const innen = `
      <rect x="4" y="${h - 8}" width="${w - 6}" height="7" rx="3" fill="#000" opacity=".22"/>
      <rect x="0" y="6" width="${w}" height="${h - 12}" rx="9" class="m-samt-dunkel"/>
      <rect x="0" y="6" width="16" height="${h - 12}" rx="7" class="m-samt"/>
      <rect x="14" y="20" width="${w - 16}" height="${tiefe / 2 - 6}" rx="6" class="m-samt-hell"/>
      <rect x="14" y="${tiefe / 2 + 18}" width="${w - 16}" height="${tiefe / 2 - 6}" rx="6" class="m-samt-hell"/>
      <rect x="2" y="0" width="${w - 2}" height="18" rx="8" class="m-samt"/>
      <rect x="2" y="${h - 22}" width="${w - 2}" height="18" rx="8" class="m-samt"/>`;
    return { svg: svg(w, h, innen, "m-sofa"), w, h };
  }

  function couchtisch() {
    const w = 44, h = 50;
    const innen = `
      <ellipse cx="22" cy="46" rx="18" ry="4" fill="#000" opacity=".2"/>
      <rect x="18" y="22" width="8" height="24" fill="#3a2718"/>
      <ellipse cx="22" cy="20" rx="20" ry="13" fill="#5a3d27"/>
      <ellipse cx="22" cy="18" rx="18" ry="11" class="m-holz-hell"/>
      <path d="M15 14h6l-1 7h-4z" fill="#e8e2cc" opacity=".8"/><path d="M16 15h4v3h-4z" fill="#e5534b" opacity=".7"/>
      <circle cx="28" cy="18" r="3" class="m-gold"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function sessel() {
    const w = 54, h = 62;
    const innen = `
      <ellipse cx="27" cy="58" rx="22" ry="4" fill="#000" opacity=".2"/>
      <rect x="4" y="18" width="46" height="40" rx="9" class="m-samt-dunkel"/>
      <rect x="0" y="22" width="12" height="34" rx="6" class="m-samt"/>
      <rect x="42" y="22" width="12" height="34" rx="6" class="m-samt"/>
      <rect x="8" y="2" width="38" height="46" rx="12" class="m-samt"/>
      <path d="M16 12h22M16 24h22M16 36h22" stroke="#000" stroke-opacity=".15" stroke-width="2"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  /* Barhocker an den Kartentischen. Der Sitz ist rund und flach, damit
     eine Figur, die darauf sitzt, ihn von hinten fast ganz verdeckt. */
  /* ---------- Shisha-Ecke (Terrasse) ---------- */

  /* Die Pfeife: Glasbauch mit Wasser, Rauchsäule, Kopf mit Kohle und ein
     Schlauch. Blubbert, wenn jemand zieht (Klasse von welt.js), und die
     Kohle glüht stärker, je mehr Leute drumherum sitzen. */
  function shisha() {
    // Größer gezeichnet als die viewBox (46 × 92): sie soll über den Köpfen am Teppich sichtbar bleiben.
    const w = 62, h = 124;
    const innen = `<g transform="scale(1.35)"><ellipse cx="23" cy="88" rx="16" ry="3.4" fill="#000" opacity=".3"/>
      <path d="M11 86Q8 70 16 62H30Q38 70 35 86Z" fill="#3a7bd5" fill-opacity=".55" stroke="#9fd3ea" stroke-width="1"/>
      <path d="M12 78Q23 74 34 78V86H12Z" fill="#2a5aa0" fill-opacity=".7"/>
      <g class="m-shisha-blasen"><circle cx="20" cy="80" r="1.4" fill="#cfefff"/><circle cx="25" cy="82" r="1" fill="#cfefff"/><circle cx="22" cy="76" r="1.2" fill="#cfefff"/></g>
      <path d="M14 66Q23 70 32 66" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>
      <rect x="21" y="26" width="4" height="36" fill="#c0c6cc" stroke="#6b7078" stroke-width=".5"/>
      <rect x="17" y="44" width="12" height="3" rx="1.5" fill="#e2b656"/>
      <path d="M15 24L31 24L28 14H18Z" fill="#8a4a22" stroke="#4a2410" stroke-width=".8"/>
      <rect x="15" y="11" width="16" height="3" rx="1" fill="#c0c6cc"/>
      <g class="m-shisha-kohle"><rect x="18" y="8" width="4" height="3" rx="1" fill="#ff6a2a"/><rect x="24" y="8" width="4" height="3" rx="1" fill="#ff8a3d"/></g>
      <path d="M29 48Q42 50 40 64Q38 74 30 72" fill="none" stroke="#2a2d33" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M29 48Q42 50 40 64Q38 74 30 72" fill="none" stroke="#6b4bb0" stroke-width="1" stroke-linecap="round" stroke-dasharray="2 2"/>
      <rect x="27" y="70" width="5" height="3" rx="1" fill="#e2b656"/>
      <g class="m-shisha-rauch" fill="#e8ecf2"><circle cx="23" cy="2" r="2.6" opacity=".5"/><circle cx="26" cy="-4" r="3.2" opacity=".35"/></g></g>`;
    return { svg: svg(w, h, innen, "m-shisha"), w, h };
  }

  function sitzkissen(ding) {
    const w = 40, h = 26;
    const [c, d] = { rot: ["#c8243a", "#7a1022"], blau: ["#3f6fd0", "#1d3a7a"], gold: ["#e2b656", "#8e6931"], gruen: ["#2e9e6a", "#1a5a3c"] }[ding.farbe] || ["#c8243a", "#7a1022"];
    const innen = `<ellipse cx="20" cy="22" rx="17" ry="3.4" fill="#000" opacity=".25"/>
      <path d="M3 16Q3 8 20 8Q37 8 37 16Q37 22 20 22Q3 22 3 16Z" fill="${c}" stroke="${d}" stroke-width="1"/>
      <path d="M8 14Q20 10 32 14" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.4"/>
      <circle cx="20" cy="15" r="1.6" fill="#e2b656"/>`;
    return { svg: svg(w, h, innen), w, h, unten: 6 };
  }

  /* ---------- Ladenstraße ---------- */

  /* Eine Ladenfassade. Gemeinsam: Mauer, Markise, Schild, Schaufenster,
     Tür. Was im Fenster liegt, zeigt, was es drinnen gibt. */
  function ladenfront(ding) {
    /* `front` ist die gezeichnete Breite, wenn der Block kürzer ist (beim
       Modehaus endet er vor der Tür, damit man hineingehen kann). */
    const [x1, , x2] = ding.front || ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 164;
    const art = ding.laden;
    const F = {
      zoo:      { wand: "#d9e8c9", rand: "#8fb07a", streifen: ["#3f9a5a", "#f4f1ea"], schild: "#2f6e43", text: "ZOOHANDLUNG", schrift: "#fff6d8" },
      autohaus: { wand: "#2a2f38", rand: "#11151b", streifen: null, schild: "#1f5fbf", text: "AUTOHAUS", schrift: "#ffffff" },
      kiosk:    { wand: "#f2d24a", rand: "#b8901c", streifen: ["#d6402f", "#f4f1ea"], schild: "#d6402f", text: "KIOSK", schrift: "#fff6d8" },
      modehaus: { wand: "#2a2230", rand: "#b8923e", streifen: ["#1d1d23", "#f4f1ea"], schild: "#141217", text: "MODEHAUS", schrift: "#f2d27a" },
    }[art] || {};
    const mx = w / 2;
    const fensterX = 12, fensterB = w - 24 - (art === "kiosk" ? 0 : 46), fensterY = 66, fensterH = 66;
    let innen = `<rect x="2" y="${h - 6}" width="${w - 4}" height="6" fill="#000" opacity=".25"/>
      <rect x="3" y="18" width="${w - 6}" height="${h - 22}" fill="${F.wand}" stroke="${F.rand}" stroke-width="1.4"/>
      <rect x="3" y="${h - 14}" width="${w - 6}" height="10" fill="${F.rand}" opacity=".55"/>`;
    // Dach und Schild
    innen += `<rect x="0" y="10" width="${w}" height="10" rx="2" fill="${F.rand}"/>
      <rect x="${mx - Math.min(90, w / 2 - 10)}" y="20" width="${Math.min(180, w - 20)}" height="22" rx="4" fill="${F.schild}" stroke="${F.rand}" stroke-width="1"/>
      <text class="${art === "autohaus" ? "m-neon-text" : ""}" x="${mx}" y="36" text-anchor="middle" font-size="${art === "kiosk" ? 14 : 13}" font-weight="900" letter-spacing="2" fill="${F.schrift}" font-family="ui-rounded, system-ui">${F.text}</text>`;
    // Markise
    if (F.streifen) {
      const n = Math.max(6, Math.round(w / 18));
      const bw = (w - 8) / n;
      innen += Array.from({ length: n }, (_, i) => `<path d="M${4 + i * bw} 46H${4 + (i + 1) * bw}L${4 + (i + 1) * bw + 2} 60Q${4 + (i + 0.5) * bw + 1} 66 ${4 + i * bw + 2} 60Z" fill="${F.streifen[i % 2]}" stroke="${F.rand}" stroke-width=".5"/>`).join("");
    } else {
      // Autohaus: Wimpelkette statt Markise.
      const n = Math.round(w / 16);
      innen += `<path d="M2 48Q${mx} 58 ${w - 2} 48" fill="none" stroke="#c0c6cc" stroke-width=".8"/><g class="m-wimpel">${Array.from({ length: n }, (_, i) => { const x = 6 + i * ((w - 12) / n); const y = 48 + Math.sin((i / (n - 1)) * Math.PI) * 9; return `<path d="M${x} ${y}l6 0l-3 7z" fill="${["#e5534b", "#f2c94c", "#3f6fd0", "#4fb76a"][i % 4]}"/>`; }).join("")}</g>`;
    }
    // Schaufenster
    innen += `<rect x="${fensterX}" y="${fensterY}" width="${fensterB}" height="${fensterH}" rx="3" fill="#123044" stroke="${F.rand}" stroke-width="2"/>`;
    if (art === "zoo") {
      const aq = { x: fensterX + 8, y: fensterY + 22, b: Math.min(96, fensterB * 0.5), h: 36 };
      innen += `<rect x="${aq.x}" y="${aq.y}" width="${aq.b}" height="${aq.h}" rx="2" fill="#2aa3c9" fill-opacity=".55" stroke="#9fd3ea"/>
        <path d="M${aq.x} ${aq.y + aq.h - 6}q10-4 20 0t20 0t20 0t20 0t20 0V${aq.y + aq.h}H${aq.x}Z" fill="#c9a46a"/>
        <path d="M${aq.x + 14} ${aq.y + aq.h - 6}q-3-12 2-20M${aq.x + 18} ${aq.y + aq.h - 6}q4-10-1-16" fill="none" stroke="#3f9a5a" stroke-width="1.6"/>
        <g class="m-fisch"><path d="M${aq.x + 30} ${aq.y + 14}q6-5 12 0q-6 5-12 0zM${aq.x + 30} ${aq.y + 14}l-4-3v6z" fill="#f0a23b"/></g>
        <g class="m-fisch b"><path d="M${aq.x + 60} ${aq.y + 24}q5-4 10 0q-5 4-10 0zM${aq.x + 70} ${aq.y + 24}l4-3v6z" fill="#e5534b"/></g>
        <circle class="m-blase" cx="${aq.x + 50}" cy="${aq.y + 28}" r="1.2" fill="#e8f6ff"/>`;
      const kx = fensterX + fensterB - 40;
      innen += `<path d="M${kx} ${fensterY + 56}V${fensterY + 24}Q${kx + 15} ${fensterY + 6} ${kx + 30} ${fensterY + 24}V${fensterY + 56}Z" fill="none" stroke="#e2b656" stroke-width="1.2"/>
        ${[6, 12, 18, 24].map((dx) => `<path d="M${kx + dx} ${fensterY + 18}V${fensterY + 56}" stroke="#e2b656" stroke-width=".6"/>`).join("")}
        <path d="M${kx + 4} ${fensterY + 40}H${kx + 26}" stroke="#8a5a2b" stroke-width="1.4"/>
        <g class="m-papagei"><path d="M${kx + 12} ${fensterY + 40}q-2-10 5-12q6 2 3 12z" fill="#3fb34f"/><path d="M${kx + 14} ${fensterY + 30}q4-4 8 0q-3 3-8 0z" fill="#e5534b"/><circle cx="${kx + 19}" cy="${fensterY + 29}" r=".8" fill="#1d1d23"/></g>`;
      innen += `<path d="M${fensterX + 10} ${fensterY + 14}q4-6 8 0q-4 3-8 0" fill="#fff" opacity=".7"/><text x="${fensterX + fensterB / 2 - 10}" y="${fensterY + 14}" text-anchor="middle" font-size="8" font-weight="800" fill="#fff6d8">Frische Lieferung!</text>`;
    } else if (art === "autohaus") {
      innen += `<path class="m-spot" d="M${fensterX + fensterB / 2 - 10} ${fensterY}L${fensterX + 14} ${fensterY + fensterH}H${fensterX + fensterB - 14}L${fensterX + fensterB / 2 + 10} ${fensterY}Z" fill="#fff6c8" opacity=".14"/>
        <ellipse cx="${fensterX + fensterB / 2}" cy="${fensterY + fensterH - 8}" rx="${fensterB * 0.38}" ry="5" fill="#3a3f47"/>
        <g transform="translate(${fensterX + fensterB / 2 - 48} ${fensterY + 20})">
          <path d="M2 34Q1 26 6 24L16 22L24 12Q27 9 32 9H58Q63 9 67 13L76 22L88 25Q94 27 94 34Z" fill="#c8243a" stroke="#6b1018" stroke-width="1"/>
          <path d="M28 13Q30 11 33 11H44V22H22ZM47 11H57Q61 11 64 14L71 22H47Z" fill="#9fd3ea" fill-opacity=".55"/>
          <circle cx="20" cy="35" r="7" fill="#1d1d23"/><circle cx="20" cy="35" r="3.4" fill="#c0c6cc"/><circle cx="76" cy="35" r="7" fill="#1d1d23"/><circle cx="76" cy="35" r="3.4" fill="#c0c6cc"/>
          <path class="fg-schimmer" d="M30 16l6 14" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/></g>
        <rect x="${fensterX + 6}" y="${fensterY + 6}" width="44" height="14" rx="3" fill="#f2c94c"/><text x="${fensterX + 28}" y="${fensterY + 16}" text-anchor="middle" font-size="8" font-weight="900" fill="#1d1d23">AB LEVEL 3</text>`;
    } else if (art === "kiosk") {
      innen += `<rect x="${fensterX + 4}" y="${fensterY + 4}" width="${fensterB - 8}" height="${fensterH - 26}" fill="#1a3d52"/>
        ${[0, 1].map((r) => `<path d="M${fensterX + 4} ${fensterY + 22 + r * 18}H${fensterX + fensterB - 4}" stroke="#c9a46a" stroke-width="1.6"/>`).join("")}
        ${Array.from({ length: 9 }, (_, i) => { const x = fensterX + 10 + i * ((fensterB - 20) / 9); const f = ["#e8812b", "#4a2410", "#3dffa0", "#e5534b", "#f2c94c", "#7ec8e3", "#4a2410", "#e8812b", "#c86bd6"][i]; return `<rect x="${x}" y="${fensterY + 10}" width="5" height="11" rx="1.6" fill="${f}"/><rect x="${x}" y="${fensterY + 28}" width="7" height="11" rx="1" fill="${["#f2c94c", "#e5534b", "#3f6fd0"][i % 3]}"/>`; }).join("")}
        <rect x="${fensterX}" y="${fensterY + fensterH - 18}" width="${fensterB}" height="18" fill="#8a5a2b" stroke="${F.rand}"/>
        <rect class="m-kuehl" x="${fensterX + 6}" y="${fensterY + fensterH - 15}" width="${fensterB - 12}" height="4" rx="1" fill="#9fe7ff" opacity=".6"/>
        <rect x="${w - 30}" y="${h - 46}" width="22" height="30" rx="2" fill="#f4f1ea" stroke="#999"/><text x="${w - 19}" y="${h - 34}" text-anchor="middle" font-size="5.4" font-weight="900" fill="#d6402f">SPEZI</text><text x="${w - 19}" y="${h - 27}" text-anchor="middle" font-size="5" font-weight="800" fill="#1d1d23">KALT!</text>`;
    } else if (art === "modehaus") {
      /* Zwei Puppen im warmen Licht, rechts eine Stange mit Bügeln. */
      const fx = fensterX, fy = fensterY, fb = fensterB, fh = fensterH;
      innen += `<rect x="${fx + 3}" y="${fy + 3}" width="${fb - 6}" height="${fh - 6}" fill="#3b2b36"/>
        <path class="m-spot" d="M${fx + fb * 0.3} ${fy + 3}L${fx + 6} ${fy + fh - 3}H${fx + fb * 0.66}L${fx + fb * 0.42} ${fy + 3}Z" fill="#ffe7b0" opacity=".16"/>
        <rect x="${fx + 3}" y="${fy + fh - 9}" width="${fb - 6}" height="6" fill="#5a4048"/>`;
      const puppe = (px, kleid, oben) => `<g class="m-puppe">
        <path d="M${px} ${fy + fh - 9}V${fy + fh - 16}" stroke="#c9b9a8" stroke-width="1.4"/><ellipse cx="${px}" cy="${fy + fh - 9}" rx="6" ry="1.6" fill="#c9b9a8"/>
        <circle cx="${px}" cy="${fy + 13}" r="4.6" fill="#ece4d8"/><path d="M${px - 1.6} ${fy + 17}h3.2v3h-3.2z" fill="#ece4d8"/>
        <path d="M${px - 8} ${fy + 22}Q${px} ${fy + 18} ${px + 8} ${fy + 22}L${px + 7} ${fy + 34}L${px + 12} ${fy + fh - 17}H${px - 12}L${px - 7} ${fy + 34}Z" fill="${kleid}" stroke="#1d1d23" stroke-width=".6"/>
        ${oben ? `<path d="M${px - 8} ${fy + 22}Q${px} ${fy + 18} ${px + 8} ${fy + 22}L${px + 7} ${fy + 35}H${px - 7}Z" fill="${oben}" stroke="#1d1d23" stroke-width=".6"/><path d="M${px} ${fy + 21}V${fy + 35}" stroke="#1d1d23" stroke-width=".5"/>` : ""}</g>`;
      innen += puppe(fx + fb * 0.2, "#c8243a", null) + puppe(fx + fb * 0.45, "#2b3a55", "#e2b656");
      const sx1 = fx + fb * 0.62, sx2 = fx + fb - 7;
      innen += `<path d="M${sx1} ${fy + 14}H${sx2}M${sx1 + 2} ${fy + 14}V${fy + fh - 9}M${sx2 - 2} ${fy + 14}V${fy + fh - 9}" stroke="#d8c08a" stroke-width="1.4"/>`
        + [0, 1, 2, 3].map((i) => {
          const hx = sx1 + 8 + i * ((sx2 - sx1 - 14) / 3);
          const f = ["#f4f1ea", "#3f9a5a", "#c86bd6", "#e8812b"][i];
          return `<path d="M${hx} ${fy + 14}v3l-5 3h10l-5-3" fill="none" stroke="#d8c08a" stroke-width=".7"/><rect x="${hx - 5}" y="${fy + 20}" width="10" height="${18 + (i % 2) * 6}" rx="1.5" fill="${f}" stroke="#1d1d23" stroke-width=".5"/>`;
        }).join("");
      innen += `<text x="${fx + fb / 2}" y="${fy + fh - 13}" text-anchor="middle" font-size="6.5" font-weight="900" letter-spacing="1.2" fill="#f2d27a">NEUE AUSLAGE</text>`;
    }
    innen += `<path d="M${fensterX + 4} ${fensterY + 6}L${fensterX + 18} ${fensterY + 6}L${fensterX + 6} ${fensterY + 26}Z" fill="#fff" opacity=".12"/>`;
    // Tür
    if (art !== "kiosk") {
      const tx = w - 46;
      innen += `<rect x="${tx}" y="${fensterY - 4}" width="34" height="${h - fensterY - 10}" rx="2" fill="${art === "autohaus" ? "#9fd3ea" : art === "modehaus" ? "#141217" : "#6b4423"}" fill-opacity="${art === "autohaus" ? 0.35 : 1}" stroke="${F.rand}" stroke-width="2"/>
        <rect x="${tx + 5}" y="${fensterY + 4}" width="24" height="30" rx="2" fill="#9fd3ea" fill-opacity=".45"/>
        <circle cx="${tx + 28}" cy="${fensterY + 44}" r="1.8" fill="#e2b656"/>
        <text x="${tx + 17}" y="${fensterY + 22}" text-anchor="middle" font-size="6" font-weight="900" fill="#1d1d23">OFFEN</text>`;
    }
    return { svg: svg(w, h, innen, "m-ladenfront m-laden-" + art), w, h, unten: 6 };
  }

  /* Ein altes Garagentor aus Wellblech, mit Rost und einem Kreidekritzeln
     unten in der Ecke, das man leicht übersieht: ein Mond und „tüt“. */
  function garagentor() {
    const w = 82, h = 150;
    const innen = `<rect x="2" y="${h - 6}" width="${w - 4}" height="6" fill="#000" opacity=".25"/>
      <rect x="2" y="16" width="${w - 4}" height="${h - 20}" fill="#7a3d2a" stroke="#4a2418" stroke-width="1.2"/>
      ${Array.from({ length: 12 }, (_, z) => Array.from({ length: 4 }, (_, i) => `<rect x="${2 + i * 20 + (z % 2 ? 10 : 0)}" y="${16 + z * 11}" width="20" height="11" fill="none" stroke="#5a2a1c" stroke-width=".6"/>`).join("")).join("")}
      <rect x="10" y="40" width="${w - 20}" height="${h - 48}" fill="#1a1a1e"/>
      <g class="m-tor"><rect x="10" y="40" width="${w - 20}" height="${h - 48}" fill="#8c939b" stroke="#55595f"/>
        ${Array.from({ length: 13 }, (_, i) => `<path d="M10 ${46 + i * 7.6}H${w - 10}" stroke="#6b7078" stroke-width="1.2"/>`).join("")}
        <circle cx="22" cy="70" r="4" fill="#8a4a22" opacity=".55"/><circle cx="60" cy="112" r="5" fill="#8a4a22" opacity=".5"/><path d="M14 132q8-3 14 1" stroke="#8a4a22" stroke-width="2" opacity=".5" fill="none"/>
        <rect x="${w / 2 - 6}" y="${h - 22}" width="12" height="4" rx="2" fill="#3a3f47"/>
        <g class="m-kritzel" opacity=".42"><path d="M${w - 26} ${h - 30}a4 4 0 1 0 4 -5a3 3 0 1 1 -4 5z" fill="none" stroke="#f4f1ea" stroke-width=".7"/><text x="${w - 30}" y="${h - 17}" font-size="5.5" fill="#f4f1ea" font-family="Comic Sans MS, cursive" transform="rotate(-8 ${w - 30} ${h - 17})">tüt</text></g></g>
      <rect x="6" y="36" width="${w - 12}" height="5" fill="#4a2418"/>`;
    return { svg: svg(w, h, innen, "m-garagentor"), w, h, unten: 4 };
  }

  /* Litfaßsäule mit Plakaten aus dem Haus. */
  function litfass() {
    const w = 46, h = 110;
    const innen = `<ellipse cx="23" cy="106" rx="18" ry="4" fill="#000" opacity=".25"/>
      <rect x="6" y="20" width="34" height="84" rx="4" fill="#3a4a3e"/>
      <rect x="8" y="26" width="30" height="34" fill="#f2c94c"/><text x="23" y="38" text-anchor="middle" font-size="6" font-weight="900" fill="#1d1d23">LIEFERUNG</text><text x="23" y="47" text-anchor="middle" font-size="5" font-weight="800" fill="#1d1d23">MO + DO</text><path d="M14 52q4-4 9 0q4 3 9 0" fill="none" stroke="#3f9a5a" stroke-width="1.4"/>
      <rect x="8" y="62" width="30" height="38" fill="#e5534b"/><text x="23" y="76" text-anchor="middle" font-size="5.6" font-weight="900" fill="#fff6d8">FAKE</text><text x="23" y="84" text-anchor="middle" font-size="5.6" font-weight="900" fill="#fff6d8">CASINO</text><circle cx="23" cy="92" r="3" fill="#f2c94c"/>
      <path d="M4 20Q23 6 42 20Z" fill="#2a3a2e"/><circle cx="23" cy="9" r="3" fill="#2a3a2e"/>
      <path d="M6 20v84M40 20v84" stroke="#000" stroke-opacity=".2"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  /* Ein Auto unter einer grauen Plane. Man sieht nur die Form. */
  function planenauto(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 10, tiefe = Math.round((y2 - y1) * T), h = tiefe + 70;
    const innen = `<ellipse cx="${w / 2}" cy="${h - 8}" rx="${w / 2 - 6}" ry="7" fill="#000" opacity=".35"/>
      <path d="M8 ${h - 10}Q4 ${h - 40} 20 ${h - 46}L44 ${h - 52}Q60 ${h - 78} 90 ${h - 78}H130Q156 ${h - 76} 172 ${h - 52}L${w - 10} ${h - 44}Q${w - 2} ${h - 34} ${w - 6} ${h - 10}Z" fill="#7d8288" stroke="#4a4e54" stroke-width="1.4"/>
      <path d="M40 ${h - 50}Q70 ${h - 30} 60 ${h - 10}M120 ${h - 76}Q112 ${h - 40} 130 ${h - 10}M168 ${h - 50}Q150 ${h - 30} 172 ${h - 12}" fill="none" stroke="#5f646a" stroke-width="1.2"/>
      <path d="M8 ${h - 10}q20 4 40 0t40 0t40 0t40 0t${w - 174} 0" fill="none" stroke="#5f646a" stroke-width="1.6"/>
      <rect x="${w - 38}" y="${h - 22}" width="16" height="8" rx="2" fill="#2a2d33"/><circle cx="34" cy="${h - 12}" r="7" fill="#1d1d23"/><circle cx="${w - 40}" cy="${h - 12}" r="7" fill="#1d1d23"/>
      <ellipse cx="30" cy="${h - 4}" rx="14" ry="3" fill="#1a1a1e" opacity=".6"/>`;
    return { svg: svg(w, h, innen, "m-planenauto"), w, h, unten: 6 };
  }

  function werkbank(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 96;
    const innen = `<rect x="4" y="${h - 6}" width="${w - 8}" height="5" fill="#000" opacity=".25"/>
      <rect x="4" y="6" width="${w - 8}" height="42" fill="#6b5a45" stroke="#3a2a1a"/>
      ${[[10, 14, "#c0c6cc"], [20, 12, "#e5534b"], [32, 16, "#c0c6cc"], [44, 13, "#f2c94c"], [56, 15, "#c0c6cc"]].map(([x, l, c]) => `<rect x="${x}" y="12" width="3" height="${l}" rx="1" fill="${c}"/>`).join("")}
      <rect x="0" y="50" width="${w}" height="8" fill="#8a6a45" stroke="#3a2a1a"/>
      <rect x="6" y="58" width="6" height="${h - 64}" fill="#4a3a28"/><rect x="${w - 12}" y="58" width="6" height="${h - 64}" fill="#4a3a28"/>
      <rect x="18" y="40" width="22" height="10" rx="2" fill="#c8243a"/><rect x="${w - 30}" y="44" width="14" height="6" rx="1" fill="#3a3f47"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function reifenstapel() {
    const w = 50, h = 66;
    const reifen = (y) => `<ellipse cx="25" cy="${y}" rx="21" ry="7" fill="#1d1d23" stroke="#3a3a42"/><ellipse cx="25" cy="${y - 1}" rx="10" ry="3" fill="#2a2a32"/>`;
    const innen = `<ellipse cx="25" cy="62" rx="22" ry="4" fill="#000" opacity=".3"/>${[56, 44, 32, 20].map(reifen).join("")}`;
    return { svg: svg(w, h, innen), w, h };
  }

  /* ---------- Spielhalle ---------- */

  /* Der Torbogen in der Casino-Rückwand: ein Tunnel in Neon, durch den man
     in die Spielhalle sieht. Die Tür selbst liegt davor (raeume.js). */
  function torbogen() {
    const w = 132, h = 140;
    const linien = [0.2, 0.4, 0.6, 0.8].map((t) => `<path d="M${66 - 48 * t} ${140 - 60 * t}L${66 - 22 * t} ${86 + 6 * t}" stroke="#2ad4ff" stroke-opacity="${0.5 - t * 0.3}" stroke-width="1"/><path d="M${66 + 48 * t} ${140 - 60 * t}L${66 + 22 * t} ${86 + 6 * t}" stroke="#2ad4ff" stroke-opacity="${0.5 - t * 0.3}" stroke-width="1"/>`).join("");
    const innen = `<defs><linearGradient id="m-tunnel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0d33"/><stop offset=".6" stop-color="#0a0614"/><stop offset="1" stop-color="#2a0f3d"/></linearGradient>
        <radialGradient id="m-tunnel-licht" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#ff4fd8" stop-opacity=".55"/><stop offset="1" stop-color="#ff4fd8" stop-opacity="0"/></radialGradient></defs>
      <path d="M14 140V60Q14 18 66 18Q118 18 118 60V140Z" fill="url(#m-tunnel)"/>
      <ellipse cx="66" cy="96" rx="34" ry="26" fill="url(#m-tunnel-licht)"/>
      ${linien}
      <rect x="44" y="78" width="44" height="22" rx="3" fill="#120a24" stroke="#ff4fd8" stroke-width="1"/>
      <path d="M50 94h6l4-8 4 12 4-6h14" fill="none" stroke="#2ad4ff" stroke-width="1.2"/>
      <path class="m-neonroehre" d="M10 140V60Q10 12 66 12Q122 12 122 60V140" fill="none" stroke="#ff4fd8" stroke-width="4" stroke-linecap="round"/>
      <path class="m-neonroehre m-neon-b" d="M18 140V62Q18 24 66 24Q114 24 114 62V140" fill="none" stroke="#2ad4ff" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="30" y="0" width="72" height="16" rx="4" fill="#0c0718" stroke="#ff4fd8" stroke-width="1.2"/>
      <text class="m-neon-text" x="66" y="12" text-anchor="middle" font-size="9.5" font-weight="900" letter-spacing="2.4" fill="#ffe1f7" font-family="ui-rounded, system-ui">SPIELHALLE</text>`;
    return { svg: svg(w, h, innen, "m-torbogen"), w, h };
  }

  /* Spielautomaten: Gehäuse in Neonfarbe, oben der Name, im Bildschirm ein
     kleines Bild des Spiels, darunter Steuerknüppel und Knöpfe. */
  const ARCADE = {
    crash:  { farbe: "#ff4d6d", bild: (x, y) => `<path d="M${x + 3} ${y + 30}Q${x + 20} ${y + 28} ${x + 28} ${y + 18}T${x + 40} ${y + 4}" fill="none" stroke="#3dffa0" stroke-width="2"/><g class="m-rakete"><path d="M${x + 38} ${y + 6}l6-4-1 7z" fill="#ffd34d"/><circle cx="${x + 37}" cy="${y + 8}" r="1.6" fill="#ff7a3d"/></g><text x="${x + 6}" y="${y + 11}" font-size="7" font-weight="900" fill="#3dffa0" font-family="ui-monospace, monospace">2.47×</text>` },
    mines:  { farbe: "#2ee6a6", bild: (x, y) => Array.from({ length: 16 }, (_, i) => { const cx = x + 4 + (i % 4) * 10, cy = y + 2 + Math.floor(i / 4) * 8; const art = i === 6 ? "bombe" : [1, 4, 9, 11, 14].includes(i) ? "stein" : "zu"; return `<rect x="${cx}" y="${cy}" width="8.6" height="6.8" rx="1.4" fill="${art === "zu" ? "#24324a" : "#0e1a24"}"/>` + (art === "stein" ? `<path d="M${cx + 4.3} ${cy + 1}l2.6 2.4-2.6 2.6-2.6-2.6z" fill="#3dffd0"/>` : art === "bombe" ? `<circle cx="${cx + 4.3}" cy="${cy + 3.6}" r="2.4" fill="#ff4d6d"/>` : ""); }).join("") },
    towers: { farbe: "#ffb02e", bild: (x, y) => Array.from({ length: 5 }, (_, r) => Array.from({ length: 3 }, (_, c) => { const lit = (r + c) % 3 === 1; return `<rect x="${x + 8 + c * 11}" y="${y + 26 - r * 6}" width="9.4" height="4.6" rx="1" fill="${lit ? "#ffb02e" : "#3a2a12"}"/>`; }).join("")).join("") + `<path d="M${x + 13} ${y + 1}l2 3h-4z" fill="#ffd34d"/>` },
  };
  function arcade(ding) {
    const a = ARCADE[ding.spiel] || ARCADE.crash;
    const w = 62, h = 128, c = a.farbe;
    const innen = `
      <rect x="6" y="122" width="50" height="5" rx="2" fill="#000" opacity=".35"/>
      <path d="M8 124V36L14 14H48L54 36V124Z" fill="#14101f" stroke="${c}" stroke-width="1.6"/>
      <path class="m-neonroehre" color="${c}" d="M8 124V36L14 14H48L54 36V124" fill="none" stroke="${c}" stroke-width="1" stroke-opacity=".9"/>
      <rect x="12" y="4" width="38" height="14" rx="3" fill="#0c0818" stroke="${c}" stroke-width="1.4"/>
      <text class="m-neon-text" x="31" y="14" text-anchor="middle" font-size="7.6" font-weight="900" letter-spacing="1" fill="${c}" font-family="ui-rounded, system-ui"${ding.label.length > 7 ? ' textLength="32" lengthAdjust="spacingAndGlyphs"' : ""}>${esc(ding.label.toUpperCase())}</text>
      <rect x="11" y="24" width="40" height="38" rx="3" fill="#05070c" stroke="#2a3146" stroke-width="1"/>
      <g class="m-arcade-bild">${a.bild(11, 26)}</g>
      <rect x="11" y="24" width="40" height="38" rx="3" fill="url(#m-glas-${esc(ding.id)})"/>
      <defs><linearGradient id="m-glas-${esc(ding.id)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path d="M8 70L54 70L58 82L4 82Z" fill="#1d1730" stroke="${c}" stroke-width="1"/>
      <path d="M18 76V70" stroke="#c0c6cc" stroke-width="1.6"/><circle cx="18" cy="69" r="2.6" fill="${c}"/>
      <circle cx="34" cy="76" r="2.4" fill="#ff4fd8"/><circle cx="41" cy="74.6" r="2.4" fill="#2ad4ff"/><circle cx="48" cy="76" r="2.4" fill="#ffd34d"/>
      <rect x="22" y="96" width="18" height="16" rx="2" fill="#0c0818" stroke="${c}" stroke-opacity=".6"/>
      <rect x="29" y="100" width="4" height="7" rx="1" fill="${c}" opacity=".8"/>`;
    return { svg: svg(w, h, innen, "m-arcade"), w, h };
  }

  /* Das Neonschild über der Spielhalle, mit Flackern. */
  function neonschild() {
    const w = 170, h = 64;
    const innen = `<rect x="4" y="8" width="162" height="44" rx="10" fill="#0c0718" opacity=".7"/>
      <text class="m-neon-text m-flacker" x="85" y="38" text-anchor="middle" font-size="22" font-weight="900" letter-spacing="3" fill="#ffe1f7" font-family="ui-rounded, system-ui">SPIELHALLE</text>
      <path class="m-neonroehre m-neon-b" d="M22 46H148" stroke="#2ad4ff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M30 14l-6 -10M140 14l6 -10" stroke="#555" stroke-width="1"/>`;
    return { svg: svg(w, h, innen, "m-neonschild"), w, h, unten: -40 };
  }

  /* Pinco Ball: ein breiter Automat mit Stiften, Fächern unten und einer
     Kugel, die immer wieder durchfällt. */
  function pinco() {
    const w = 106, h = 136;
    const stifte = [];
    for (let r = 0; r < 7; r++) for (let c = 0; c <= r; c++) stifte.push([53 - r * 5.6 + c * 11.2, 30 + r * 8.4]);
    const faecher = ["#ff4d6d", "#ffb02e", "#2ee6a6", "#2ad4ff", "#2ee6a6", "#ffb02e", "#ff4d6d"];
    const innen = `
      <rect x="6" y="130" width="94" height="5" rx="2" fill="#000" opacity=".35"/>
      <path d="M6 132V24Q6 6 24 6H82Q100 6 100 24V132Z" fill="#160f28" stroke="#b26bff" stroke-width="1.8"/>
      <path class="m-neonroehre" color="#b26bff" d="M6 132V24Q6 6 24 6H82Q100 6 100 24V132" fill="none" stroke="#b26bff" stroke-width="1"/>
      <text class="m-neon-text" x="53" y="19" text-anchor="middle" font-size="9" font-weight="900" letter-spacing="1.6" fill="#e0c4ff" font-family="ui-rounded, system-ui">PINCO BALL</text>
      <rect x="14" y="24" width="78" height="80" rx="4" fill="#07050f" stroke="#3a2a5a"/>
      ${stifte.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" fill="#cfd6df"/>`).join("")}
      ${faecher.map((f, i) => `<rect x="${16 + i * 10.6}" y="94" width="9.4" height="8" rx="1.2" fill="${f}" opacity=".85"/>`).join("")}
      <circle class="m-pinco-kugel" cx="53" cy="26" r="2.6" fill="#fff6c8"/>
      <rect x="14" y="110" width="78" height="14" rx="3" fill="#1d1730" stroke="#b26bff" stroke-opacity=".7"/>
      <circle cx="53" cy="117" r="4" fill="#b26bff"/>`;
    return { svg: svg(w, h, innen, "m-pinco"), w, h };
  }

  function greifautomat() {
    const w = 62, h = 128;
    const pluesch = [[18, 88, "#ff6b9a"], [30, 92, "#ffd34d"], [42, 88, "#2ad4ff"], [24, 80, "#9b6bff"], [38, 80, "#3dffa0"]];
    const innen = `
      <rect x="6" y="122" width="50" height="5" rx="2" fill="#000" opacity=".35"/>
      <rect x="8" y="10" width="46" height="114" rx="4" fill="#1a1230" stroke="#ff4fd8" stroke-width="1.4"/>
      <rect x="12" y="20" width="38" height="78" rx="2" fill="#2ad4ff" fill-opacity=".1" stroke="#2ad4ff" stroke-opacity=".5"/>
      <g class="m-greifer"><path d="M31 20V42" stroke="#c0c6cc" stroke-width="1.2"/><path d="M26 46l5-4 5 4M26 46l-1 4M36 46l1 4" fill="none" stroke="#c0c6cc" stroke-width="1.4"/></g>
      ${pluesch.map(([x, y, f]) => `<circle cx="${x}" cy="${y}" r="5" fill="${f}"/><circle cx="${x - 1.6}" cy="${y - 1}" r=".8" fill="#1d1d23"/><circle cx="${x + 1.6}" cy="${y - 1}" r=".8" fill="#1d1d23"/>`).join("")}
      <rect x="12" y="102" width="38" height="16" rx="2" fill="#0c0818"/><circle cx="22" cy="110" r="3" fill="#ff4fd8"/><path d="M38 114V106" stroke="#c0c6cc" stroke-width="1.6"/><circle cx="38" cy="105" r="2.4" fill="#2ad4ff"/>
      <text class="m-neon-text" x="31" y="17" text-anchor="middle" font-size="6.4" font-weight="900" fill="#ffe1f7" font-family="ui-rounded, system-ui">GREIFER</text>`;
    return { svg: svg(w, h, innen, "m-greifautomat"), w, h };
  }

  /* Tische in der Spielhalle, mit Neonkante statt Holz und Gold. */
  function hallentisch(ding, inhalt, filz) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 20, mx = w / 2;
    const innen = `
      <ellipse cx="${mx}" cy="${tiefe + 12}" rx="${w / 2 - 6}" ry="6" fill="#000" opacity=".35"/>
      <rect x="2" y="2" width="${w - 4}" height="${tiefe + 4}" rx="14" fill="#1a1230"/>
      <rect x="2" y="2" width="${w - 4}" height="${tiefe + 4}" rx="14" fill="none" class="m-neonroehre" stroke="#2ad4ff" stroke-width="1.4"/>
      <rect x="9" y="8" width="${w - 18}" height="${tiefe - 8}" rx="9" fill="${filz}"/>
      ${inhalt(mx, tiefe)}`;
    return { svg: svg(w, h, innen, "m-tisch"), w, h, unten: 10 };
  }
  function wuerfeltisch(ding) {
    const auge = (cx, cy, n) => {
      const p = { 1: [[0, 0]], 2: [[-1.6, -1.6], [1.6, 1.6]], 3: [[-1.8, -1.8], [0, 0], [1.8, 1.8]], 4: [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]], 5: [[-1.8, -1.8], [1.8, -1.8], [0, 0], [-1.8, 1.8], [1.8, 1.8]], 6: [[-1.6, -2], [1.6, -2], [-1.6, 0], [1.6, 0], [-1.6, 2], [1.6, 2]] }[n];
      return `<rect x="${cx - 4.4}" y="${cy - 4.4}" width="8.8" height="8.8" rx="1.8" fill="#f4f1ea" stroke="#9aa0a6" stroke-width=".5"/>` + p.map(([dx, dy]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r=".9" fill="#1d1d23"/>`).join("");
    };
    return hallentisch(ding, (mx, t) => `${[[mx - 26, t / 2 - 2, 6], [mx - 13, t / 2 + 4, 6], [mx, t / 2 - 3, 6], [mx + 13, t / 2 + 3, 2], [mx + 26, t / 2 - 2, 5]].map(([x, y, n]) => auge(x, y, n)).join("")}
      <path d="M${mx + 40} ${t / 2 - 8}l6 0 2 14h-10z" fill="#7a3cf0" stroke="#2ad4ff" stroke-width=".6"/>`, "#3a1d5a");
  }
  function kartentisch_hilo(ding) {
    return hallentisch(ding, (mx, t) => `
      <rect x="${mx - 20}" y="${t / 2 - 10}" width="15" height="21" rx="2" fill="#f4efe2" stroke="#999" stroke-width=".5"/>
      <text x="${mx - 12.5}" y="${t / 2 + 2}" text-anchor="middle" font-size="9" font-weight="900" fill="#c8243a" font-family="Georgia, serif">Q</text>
      <text x="${mx - 12.5}" y="${t / 2 + 9}" text-anchor="middle" font-size="6" fill="#c8243a">♥</text>
      <rect x="${mx + 5}" y="${t / 2 - 10}" width="15" height="21" rx="2" class="m-kartenruecken" stroke="#fff" stroke-width=".6"/>
      <path d="M${mx + 30} ${t / 2 - 4}l5-6 5 6z" fill="#3dffa0"/><path d="M${mx + 30} ${t / 2 + 2}l5 6 5-6z" fill="#ff4d6d"/>`, "#13324a");
  }
  /* Hocker mit Leuchtring für die Tische der Spielhalle. */
  function neonhocker(ding) {
    const w = 26, h = 30, c = ding.farbe || "#2ad4ff";
    const innen = `<ellipse cx="13" cy="27" rx="9" ry="2.4" fill="#000" opacity=".35"/>
      <rect x="11.5" y="10" width="3" height="16" fill="#3a3550"/><ellipse cx="13" cy="26" rx="6" ry="1.6" fill="#3a3550"/>
      <ellipse cx="13" cy="9" rx="10" ry="4" fill="#1a1230"/><ellipse class="m-neonroehre" color="${c}" cx="13" cy="9" rx="10" ry="4" fill="none" stroke="${c}" stroke-width="1.4"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  /* Die Jukebox: nur zum Ansehen, aber ohne sie wäre die Halle still. */
  function jukebox() {
    const w = 60, h = 96;
    const innen = `<rect x="6" y="90" width="48" height="5" rx="2" fill="#000" opacity=".35"/>
      <path d="M6 92V34Q6 6 30 6Q54 6 54 34V92Z" fill="#2a1638" stroke="#ffb02e" stroke-width="1.4"/>
      <path class="m-neonroehre m-juke" color="#ff4fd8" d="M11 90V36Q11 12 30 12Q49 12 49 36V90" fill="none" stroke="#ff4fd8" stroke-width="2.6"/>
      <rect x="17" y="30" width="26" height="18" rx="3" fill="#0c0818" stroke="#ffb02e" stroke-opacity=".7"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M${20 + i * 6} 44V${36 - (i % 2) * 3}" class="m-eq" style="--i:${i}" stroke="#3dffa0" stroke-width="3.4"/>`).join("")}
      <rect x="17" y="54" width="26" height="28" rx="2" fill="#1a1230"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M19 ${58 + i * 6}H41" stroke="#ffb02e" stroke-opacity=".5"/>`).join("")}
      <g class="m-noten"><text x="44" y="22" font-size="9" fill="#2ad4ff">♪</text><text x="10" y="26" font-size="8" fill="#ff4fd8">♫</text></g>`;
    return { svg: svg(w, h, innen, "m-jukebox"), w, h };
  }

  /* Getränkeautomat mit Spezi im Fenster. */
  function getraenkeautomat() {
    const w = 58, h = 122;
    const flaschen = Array.from({ length: 12 }, (_, i) => {
      const x = 14 + (i % 4) * 8, y = 30 + Math.floor(i / 4) * 20;
      const f = ["#e8812b", "#7a3a1c", "#3dffa0", "#e8812b"][i % 4];
      return `<rect x="${x}" y="${y}" width="5" height="13" rx="2" fill="${f}"/><rect x="${x + 1.3}" y="${y - 3}" width="2.4" height="4" fill="#d8d8d8"/>`;
    }).join("");
    const innen = `<rect x="4" y="116" width="50" height="5" rx="2" fill="#000" opacity=".35"/>
      <rect x="5" y="8" width="48" height="110" rx="4" fill="#d43a2a" stroke="#7a1a12" stroke-width="1.2"/>
      <rect x="10" y="20" width="38" height="64" rx="2" fill="#120d1c" stroke="#fff" stroke-opacity=".25"/>
      ${flaschen}
      <rect x="10" y="20" width="38" height="64" rx="2" fill="#fff" fill-opacity=".06"/>
      <text x="29" y="17" text-anchor="middle" font-size="8" font-weight="900" font-style="italic" fill="#fff6c8" font-family="ui-rounded, system-ui">Spezi</text>
      <rect x="12" y="90" width="22" height="10" rx="2" fill="#2a2a32"/><rect x="38" y="88" width="8" height="16" rx="1.5" fill="#2a2a32"/><circle cx="42" cy="92" r="1.4" class="m-birne" fill="#3dffa0"/>
      <rect x="12" y="104" width="34" height="8" rx="2" fill="#1a1a22"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function sitzsack(ding) {
    const w = 60, h = 52;
    const [c, d] = ding.farbe === "tuerkis" ? ["#2ad4ff", "#147a96"] : ["#ff6bb8", "#a12d6c"];
    const innen = `<ellipse cx="30" cy="48" rx="26" ry="4" fill="#000" opacity=".3"/>
      <path d="M6 44Q2 22 18 14Q30 6 42 14Q58 22 54 44Q30 52 6 44Z" fill="${c}" stroke="${d}" stroke-width="1.2"/>
      <path d="M16 22Q30 16 44 22" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  /* Zeitungsständer: ein Drahtgestell mit dem aufgeschlagenen Casino-Kurier. */
  function zeitungsstaender() {
    const w = 40, h = 64;
    const innen = `<ellipse cx="20" cy="61" rx="15" ry="3" fill="#000" opacity=".25"/>
      <path d="M8 60L11 26M32 60L29 26M10 44H30" stroke="#3a3f47" stroke-width="2" stroke-linecap="round"/>
      <g transform="rotate(-4 20 20)">
        <rect x="5" y="4" width="30" height="34" rx="1.5" fill="#f3ecdc" stroke="#b9b09a" stroke-width=".8"/>
        <rect x="8" y="7" width="24" height="5" fill="#1f1b16"/>
        <text x="20" y="11" text-anchor="middle" font-size="3.6" font-weight="900" font-family="Georgia, serif" fill="#f3ecdc">KURIER</text>
        <rect x="8" y="14" width="13" height="9" fill="#9a8f78"/>
        <path d="M23 15H32M23 18H32M23 21H30M8 26H32M8 29H32M8 32H28M8 35H31" stroke="#6b6355" stroke-width=".9"/>
      </g>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function hocker() {
    const w = 26, h = 26;
    const innen = `
      <ellipse cx="13" cy="23.6" rx="9" ry="2.2" fill="#000" opacity=".22"/>
      <path d="M7.6 12L6 23M18.4 12L20 23M13 13v10" stroke="#3a2718" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M7.4 18.4h11.2" stroke="#8a929c" stroke-width="1.1"/>
      <ellipse cx="13" cy="11.4" rx="9.6" ry="4.4" fill="#5a3d27"/>
      <ellipse cx="13" cy="10.2" rx="8.6" ry="3.6" class="m-samt"/>
      <ellipse cx="11.4" cy="9.4" rx="3.4" ry="1.2" fill="#fff" opacity=".18"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function spieltisch(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 26;
    const feld = Array.from({ length: 16 }, (_, i) => `<rect x="${w / 2 - 16 + (i % 4) * 8}" y="${8 + Math.floor(i / 4) * 5}" width="8" height="5" fill="${(i + Math.floor(i / 4)) % 2 ? "#3a2718" : "#e8dcc0"}"/>`).join("");
    const innen = `
      <rect x="6" y="${h - 8}" width="${w - 12}" height="6" rx="3" fill="#000" opacity=".2"/>
      <rect x="6" y="${tiefe}" width="5" height="${h - tiefe - 6}" fill="#3a2718"/><rect x="${w - 11}" y="${tiefe}" width="5" height="${h - tiefe - 6}" fill="#3a2718"/>
      <rect x="0" y="2" width="${w}" height="${tiefe}" rx="4" fill="#5a3d27"/>
      <rect x="0" y="${tiefe - 2}" width="${w}" height="8" rx="3" fill="#4a3120"/>
      <rect x="4" y="5" width="${w - 8}" height="${tiefe - 8}" rx="3" class="m-holz-hell"/>
      ${feld}
      <rect x="${w - 22}" y="12" width="7" height="7" rx="1.5" fill="#fff" stroke="#555" stroke-width=".6"/><circle cx="${w - 18.5}" cy="15.5" r="1" fill="#222"/>
      <rect x="10" y="14" width="9" height="12" rx="1.4" class="m-kartenruecken"/>`;
    return { svg: svg(w, h, innen), w, h, unten: 10 };
  }

  function kisten() {
    const w = 80, h = 70;
    const kiste = (x, y, s, leuchtet) => `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="0" y="10" width="34" height="26" rx="2" fill="#8a5a2b" stroke="#4a2e14" stroke-width="1.2"/>
      <rect x="0" y="4" width="34" height="8" rx="2" fill="#a36b35" stroke="#4a2e14" stroke-width="1.2" ${leuchtet ? 'transform="rotate(-8 0 12)"' : ""}/>
      <path d="M0 22h34" stroke="#4a2e14" stroke-width="1"/>
      <rect x="14" y="4" width="6" height="32" class="m-gold"/>
      ${leuchtet ? '<path class="m-schein" d="M3 10L-4 -8L38 -8L31 10Z" fill="#ffe27a" opacity=".35"/>' : ""}</g>`;
    const innen = `<ellipse cx="40" cy="66" rx="36" ry="4" fill="#000" opacity=".22"/>`
      + kiste(4, 28, 1, false) + kiste(40, 30, 1, false) + kiste(20, 0, 1, true);
    return { svg: svg(w, h, innen, "m-kisten"), w, h };
  }

  function pflanze() {
    const w = 40, h = 64;
    const innen = `
      <ellipse cx="20" cy="61" rx="13" ry="3" fill="#000" opacity=".22"/>
      <path d="M9 44H31L28 61H12Z" fill="#b9793f" stroke="#6d4520" stroke-width="1"/>
      <rect x="8" y="42" width="24" height="5" rx="2" fill="#c98a4f"/>
      <g class="m-blaetter" style="transform-origin:20px 44px">
        <path d="M20 44Q8 34 4 16Q16 24 20 44Z" fill="#3f8a4a"/>
        <path d="M20 44Q32 34 36 14Q24 24 20 44Z" fill="#4c9c56"/>
        <path d="M20 44Q16 22 22 2Q28 22 20 44Z" fill="#5fb368"/>
        <path d="M20 44Q10 40 2 34Q14 32 20 44Z" fill="#357a40"/>
      </g>`;
    return { svg: svg(w, h, innen, "m-pflanze"), w, h };
  }

  /* Das Modehaus von innen. Die Umkleide steht an der Rückwand: zwei
     Kabinen mit Samtvorhang, dazwischen der große Spiegel mit Glühbirnen. */
  function umkleide(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 158;
    const kb = Math.round(w * 0.3), mx = w / 2;
    const vorhang = (x, b) => `<rect x="${x}" y="30" width="${b}" height="${h - 38}" fill="#3a2430" stroke="#1d1218" stroke-width="1.2"/>
      <path d="M${x - 2} 30H${x + b + 2}" stroke="#c9a24a" stroke-width="3" stroke-linecap="round"/>
      ${Array.from({ length: Math.round(b / 7) }, (_, i) => `<path d="M${x + 3 + i * 7} 33Q${x + 6 + i * 7} ${h / 2 + 10} ${x + 3 + i * 7 + (i % 2 ? 2 : -1)} ${h - 10}" stroke="${i % 2 ? "#a3283c" : "#7a1b2a"}" stroke-width="7" fill="none"/>`).join("")}
      <path d="M${x} ${h - 10}H${x + b}" stroke="#4a0f18" stroke-width="3"/>`;
    const birnen = Array.from({ length: 5 }, (_, i) => {
      const y = 46 + i * 20;
      return `<circle cx="${mx - 34}" cy="${y}" r="3.4" fill="#fff1c4" stroke="#e2b656" stroke-width=".8"/><circle cx="${mx + 34}" cy="${y}" r="3.4" fill="#fff1c4" stroke="#e2b656" stroke-width=".8"/>`;
    }).join("");
    const innen = `<rect x="2" y="${h - 6}" width="${w - 4}" height="6" fill="#000" opacity=".25"/>
      <rect x="3" y="12" width="${w - 6}" height="20" rx="3" fill="#141217" stroke="#b8923e" stroke-width="1.2"/>
      <text x="${mx}" y="26" text-anchor="middle" font-size="11" font-weight="900" letter-spacing="3" fill="#f2d27a" font-family="ui-rounded, system-ui">UMKLEIDE</text>
      ${vorhang(6, kb)}${vorhang(w - 6 - kb, kb)}
      <path d="M${mx - 30} ${h - 10}V60Q${mx - 30} 36 ${mx} 36Q${mx + 30} 36 ${mx + 30} 60V${h - 10}Z" fill="#b8923e" stroke="#6e5520" stroke-width="1.4"/>
      <path d="M${mx - 25} ${h - 14}V62Q${mx - 25} 42 ${mx} 42Q${mx + 25} 42 ${mx + 25} 62V${h - 14}Z" fill="#2c4a52"/>
      <path class="m-spiegelschein" d="M${mx - 18} 58L${mx - 6} 52L${mx - 22} ${h - 40}L${mx - 25} ${h - 52}Z" fill="#fff" opacity=".22"/>
      ${birnen}
      <rect x="${mx - 36}" y="${h - 12}" width="72" height="5" rx="2" fill="#6e5520"/>`;
    return { svg: svg(w, h, innen, "m-umkleide"), w, h, unten: 6 };
  }

  /* Drei Schaufensterpuppen auf einem runden Podest, jede in einem
     anderen Kleid. */
  function puppen(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 132;
    const puppe = (px, kleid, oben, hut) => `<g>
      <path d="M${px} ${h - 18}V${h - 28}" stroke="#c9b9a8" stroke-width="2"/>
      <circle cx="${px}" cy="30" r="8" fill="#ece4d8" stroke="#b9ab98" stroke-width=".8"/>
      ${hut ? `<path d="M${px - 13} 26H${px + 13}M${px - 7} 26Q${px - 7} 14 ${px} 14Q${px + 7} 14 ${px + 7} 26" fill="${hut}" stroke="#1d1d23" stroke-width="1.4"/>` : ""}
      <rect x="${px - 2.5}" y="37" width="5" height="5" fill="#ece4d8"/>
      <path d="M${px - 14} 46Q${px} 40 ${px + 14} 46L${px + 12} 66L${px + 20} ${h - 28}H${px - 20}L${px - 12} 66Z" fill="${kleid}" stroke="#1d1d23" stroke-width="1"/>
      ${oben ? `<path d="M${px - 14} 46Q${px} 40 ${px + 14} 46L${px + 13} 70H${px - 13}Z" fill="${oben}" stroke="#1d1d23" stroke-width="1"/><path d="M${px} 44V70" stroke="#1d1d23" stroke-width=".8"/>` : ""}
      <path d="M${px - 14} 47L${px - 19} 72M${px + 14} 47L${px + 19} 72" stroke="#ece4d8" stroke-width="4" stroke-linecap="round"/></g>`;
    const mx = w / 2, ab = Math.min(52, w / 3.2);
    const innen = `<ellipse cx="${mx}" cy="${h - 10}" rx="${w / 2 - 6}" ry="9" fill="#000" opacity=".25"/>
      <path class="m-spot" d="M${mx - 18} 0L${8} ${h - 14}H${w - 8}L${mx + 18} 0Z" fill="#ffe7b0" opacity=".12"/>
      <ellipse cx="${mx}" cy="${h - 16}" rx="${w / 2 - 8}" ry="10" fill="#2a2230" stroke="#b8923e" stroke-width="2"/>
      <ellipse cx="${mx}" cy="${h - 19}" rx="${w / 2 - 14}" ry="7" fill="#3b2b36"/>
      ${puppe(mx - ab, "#c8243a", null, null)}${puppe(mx, "#2b3a55", "#e2b656", "#1d1d23")}${puppe(mx + ab, "#3f9a5a", null, "#f4f1ea")}`;
    return { svg: svg(w, h, innen, "m-puppen"), w, h, unten: 8 };
  }

  /* Eine Kleiderstange auf Rollen, voll behängt. */
  function kleiderstange(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 104;
    const farben = ding.farben || ["#f4f1ea", "#3f6fd0", "#c86bd6", "#e8812b", "#2a2f38", "#d6402f", "#4fb76a"];
    const n = Math.max(4, Math.round((w - 24) / 15));
    const teile = Array.from({ length: n }, (_, i) => {
      const x = 14 + i * ((w - 28) / (n - 1));
      const f = farben[i % farben.length];
      const lang = i % 3 === 1 ? 46 : 34;
      return `<path d="M${x} 20v4l-7 5h14l-7-5" fill="none" stroke="#c0c6cc" stroke-width=".9"/>
        <path d="M${x - 8} 29H${x + 8}L${x + 9} ${29 + lang}H${x - 9}Z" fill="${f}" stroke="#1d1d23" stroke-width=".8"/>
        <path d="M${x - 3} 29l3 5 3-5" fill="none" stroke="#1d1d23" stroke-width=".6" opacity=".6"/>`;
    }).join("");
    const innen = `<ellipse cx="${w / 2}" cy="${h - 4}" rx="${w / 2 - 6}" ry="4" fill="#000" opacity=".22"/>
      <path d="M8 18V${h - 10}M${w - 8} 18V${h - 10}M4 18H${w - 4}" stroke="#c0c6cc" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M2 ${h - 10}H16M${w - 16} ${h - 10}H${w - 2}" stroke="#8a9198" stroke-width="3" stroke-linecap="round"/>
      <circle cx="4" cy="${h - 6}" r="3" fill="#23262b"/><circle cx="14" cy="${h - 6}" r="3" fill="#23262b"/><circle cx="${w - 14}" cy="${h - 6}" r="3" fill="#23262b"/><circle cx="${w - 4}" cy="${h - 6}" r="3" fill="#23262b"/>
      ${teile}`;
    return { svg: svg(w, h, innen, "m-kleiderstange"), w, h, unten: 2 };
  }

  /* Die Kasse: Tresen mit Marmorplatte, Kasse, Tütenstapel und Blumen. */
  function theke(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 86;
    const innen = `<rect x="2" y="${h - 6}" width="${w - 4}" height="6" fill="#000" opacity=".25"/>
      <rect x="4" y="34" width="${w - 8}" height="${h - 40}" rx="3" fill="#2a2230" stroke="#141217" stroke-width="1.2"/>
      ${[0.25, 0.5, 0.75].map((f) => `<path d="M${w * f} 40V${h - 10}" stroke="#b8923e" stroke-width="1" opacity=".6"/>`).join("")}
      <rect x="0" y="28" width="${w}" height="9" rx="3" fill="#efe9df" stroke="#b9ab98" stroke-width="1"/>
      <path d="M8 31q20 4 40 0t40 2" stroke="#cfc6b8" stroke-width=".8" fill="none"/>
      <rect x="${w - 46}" y="10" width="30" height="20" rx="3" fill="#3a3f47" stroke="#1d1d23" stroke-width="1"/><rect x="${w - 42}" y="13" width="22" height="8" rx="1" fill="#7ee0b0" class="m-kasse"/>
      <rect x="${w - 48}" y="24" width="34" height="5" rx="1" fill="#23262b"/>
      <path d="M14 28V12h16v16" fill="#f4f1ea" stroke="#1d1d23" stroke-width=".8"/><path d="M18 12q4-6 8 0" fill="none" stroke="#b8923e" stroke-width="1.2"/>
      <text x="22" y="23" text-anchor="middle" font-size="5" font-weight="900" fill="#2a2230">MH</text>
      <path d="M34 28V16h12v12" fill="#c8243a" stroke="#1d1d23" stroke-width=".8"/><path d="M37 16q3-5 6 0" fill="none" stroke="#1d1d23" stroke-width="1"/>
      <rect x="${w / 2 - 4}" y="16" width="8" height="12" rx="2" fill="#bcd3dc" opacity=".8"/>
      <circle cx="${w / 2 - 3}" cy="12" r="3" fill="#e5534b"/><circle cx="${w / 2 + 3}" cy="11" r="3" fill="#f2c94c"/><circle cx="${w / 2}" cy="7" r="3" fill="#c86bd6"/>`;
    return { svg: svg(w, h, innen, "m-theke"), w, h, unten: 2 };
  }

  /* Eine Glasvitrine auf einem Sockel, darin eine Tasche und Sneaker. */
  function taschenvitrine() {
    const w = 58, h = 92;
    const innen = `<ellipse cx="29" cy="${h - 4}" rx="24" ry="4" fill="#000" opacity=".25"/>
      <rect x="10" y="52" width="38" height="${h - 58}" fill="#2a2230" stroke="#b8923e" stroke-width="1.2"/>
      <rect x="6" y="48" width="46" height="6" rx="1" fill="#b8923e"/>
      <rect x="8" y="8" width="42" height="42" fill="#bcd3dc" fill-opacity=".18" stroke="#d8e6ea" stroke-width="1.2"/>
      <path d="M22 26q7-10 14 0" fill="none" stroke="#e2b656" stroke-width="2"/>
      <rect x="18" y="26" width="22" height="16" rx="3" fill="#c8243a" stroke="#1d1d23" stroke-width=".8"/><rect x="26" y="30" width="6" height="3" rx="1" fill="#e2b656"/>
      <path d="M14 47h12q4 0 4-3h-7l-3-4h-6z" fill="#f4f1ea" stroke="#1d1d23" stroke-width=".6"/>
      <path d="M32 47h12q4 0 4-3h-7l-3-4h-6z" fill="#f4f1ea" stroke="#1d1d23" stroke-width=".6"/>
      <path class="m-glanz" d="M12 12L20 12L12 26Z" fill="#fff" opacity=".35"/>`;
    return { svg: svg(w, h, innen, "m-taschenvitrine"), w, h, unten: 2 };
  }

  function garderobe() {
    const w = 100, h = 118;
    const jacke = (x, farbe) => `<path d="M${x} 44l-9 5v26h18v-26z" fill="${farbe}" stroke="#16241f" stroke-width="1"/><path d="M${x - 3} 44l3 5 3-5" fill="none" stroke="#e8e2cc" stroke-width=".8"/><path d="M${x} 38v6" stroke="#9aa0a6" stroke-width="1.2"/>`;
    const innen = `
      <rect x="2" y="112" width="96" height="5" rx="2" fill="#000" opacity=".22"/>
      <ellipse cx="22" cy="54" rx="17" ry="40" class="m-gold"/>
      <ellipse cx="22" cy="54" rx="13" ry="36" fill="#bcd3dc"/>
      <path d="M13 30Q18 22 24 26L14 60Q11 46 13 30Z" fill="#fff" opacity=".45"/>
      <path d="M22 94V110M12 112H32" stroke="#5a3d27" stroke-width="4" stroke-linecap="round"/>
      <path d="M48 110V30M96 110V30M44 30H100" stroke="#6b4a2e" stroke-width="4" stroke-linecap="round"/>
      <path d="M44 110H56M88 110H100" stroke="#6b4a2e" stroke-width="4" stroke-linecap="round"/>
      ${jacke(60, "#5a9d91")}${jacke(73, "#c8453c")}${jacke(86, "#3f6fd0")}
      <path d="M64 30Q72 16 80 30Z" fill="#d94c45" stroke="#6d2320" stroke-width="1"/><path d="M60 30h24" stroke="#6d2320" stroke-width="2"/>`;
    return { svg: svg(w, h, innen, "m-garderobe"), w, h };
  }

  function boerse() {
    const w = 212, h = 110;
    const zeilen = [["PORTA", "+3,2", 1], ["WESER", "-1,4", 0], ["CHIPS", "+0,8", 1], ["KISTE", "-2,1", 0]];
    const innen = `
      <rect x="4" y="6" width="204" height="96" rx="6" fill="#0c1016" stroke="#3a4250" stroke-width="3"/>
      <rect x="4" y="6" width="204" height="14" rx="4" fill="#1a212c"/>
      <text x="14" y="17" font-size="8.5" font-weight="800" letter-spacing="3" class="m-akzent-text">BÖRSE</text>
      <circle class="m-live" cx="196" cy="13" r="3" fill="#e5534b"/>
      ${zeilen.map(([n, v, auf], i) => `<text x="14" y="${36 + i * 15}" font-size="9" fill="#cfd6df" font-family="ui-monospace, monospace">${n}</text><text x="92" y="${36 + i * 15}" font-size="9" text-anchor="end" fill="${auf ? "#4ade80" : "#ff7a6e"}" font-family="ui-monospace, monospace">${v}</text>`).join("")}
      <path d="M106 90L120 76L132 82L146 60L158 68L172 44L186 52L200 30" fill="none" stroke="#4ade80" stroke-width="2" class="m-kurve"/>
      <path d="M106 94H202M106 94V26" stroke="#3a4250" stroke-width="1"/>
      <rect x="4" y="96" width="204" height="10" fill="#1a212c"/>
      <svg x="6" y="96" width="200" height="10"><text class="m-laufband" x="4" y="8" font-size="7" fill="#9fb0c4" font-family="ui-monospace, monospace">PORTA +3,2 · WESER -1,4 · CHIPS +0,8 · KISTE -2,1 · PORTA +3,2 · WESER -1,4 · CHIPS +0,8</text></svg>`;
    /* Darüber legt welt.js die echten Kurse, sobald sie da sind. */
    return { svg: svg(w, h, innen, "m-boerse"), w, h,
      html: `<div class="welt-anzeige welt-kurse" data-anzeige="kurse" style="left:6px;top:21px;width:200px;height:74px"></div>` };
  }

  function bank(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T), h = 110;
    const fenster = [0.18, 0.5, 0.82].map((t) => {
      const x = w * t;
      return `<rect x="${x - 26}" y="20" width="52" height="44" rx="3" fill="#bcd3dc" opacity=".35" stroke="#9fb1b8" stroke-width="1.5"/><rect x="${x - 10}" y="54" width="20" height="10" fill="#0c1016" opacity=".5"/>`;
    }).join("");
    const innen = `
      <rect x="0" y="4" width="${w}" height="14" rx="3" class="m-holz-dunkel"/>
      <text x="${w / 2}" y="15" text-anchor="middle" font-size="9" letter-spacing="5" font-weight="800" class="m-akzent-text">BANK</text>
      ${fenster}
      <rect x="0" y="64" width="${w}" height="10" rx="2" class="m-holz-hell"/>
      <rect x="2" y="74" width="${w - 4}" height="34" fill="#4a3120"/>
      ${[0.18, 0.5, 0.82].map((t) => `<rect x="${w * t - 22}" y="80" width="44" height="22" rx="2" fill="#5a3d27" stroke="#3a2718" stroke-width="1"/>`).join("")}
      <circle cx="${w * 0.5 + 16}" cy="62" r="4" class="m-gold"/><rect x="${w * 0.5 + 15}" y="56" width="2" height="3" fill="#6b4b16"/>`;
    return { svg: svg(w, h, innen, "m-bank"), w, h };
  }

  function kartentisch(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 30;
    const innen = `
      <rect x="10" y="${h - 9}" width="${w - 20}" height="8" rx="4" fill="#000" opacity=".22"/>
      <rect x="10" y="${tiefe}" width="8" height="${h - tiefe - 6}" fill="#3a2718"/><rect x="${w - 18}" y="${tiefe}" width="8" height="${h - tiefe - 6}" fill="#3a2718"/>
      <rect x="0" y="2" width="${w}" height="${tiefe + 4}" rx="6" fill="#5a3d27"/>
      <rect x="0" y="${tiefe - 4}" width="${w}" height="12" rx="4" fill="#4a3120"/>
      <rect x="8" y="8" width="${w - 16}" height="${tiefe - 14}" rx="3" fill="#e9dfc2"/>
      <g class="m-karte">
        <path d="M20 ${tiefe - 20}Q40 60 70 70Q100 76 118 52Q140 26 190 30Q208 30 ${w - 20} 20" fill="none" stroke="#5aa6d8" stroke-width="7" stroke-linecap="round"/>
        <path d="M30 18L80 14L96 44L60 60L24 50Z" fill="#b8d49a" stroke="#6f8f55" stroke-width="1.2"/>
        <path d="M96 44L150 38L160 72L112 84Z" fill="#cfe0a8" stroke="#6f8f55" stroke-width="1.2"/>
        <path d="M150 38L196 46L${w - 22} 70L170 ${tiefe - 22}L160 72Z" fill="#a9c98a" stroke="#6f8f55" stroke-width="1.2"/>
        <path d="M24 50L60 60L70 ${tiefe - 20}L20 ${tiefe - 20}Z" fill="#d7e6b8" stroke="#6f8f55" stroke-width="1.2"/>
        ${[[52, 34, "#c8453c"], [120, 58, "#3f6fd0"], [182, 64, "#d6a93a"], [42, 72, "#8d5bd6"], [140, 50, "#c8453c"]].map(([x, y, c]) => `<g class="m-nadel" transform="translate(${x} ${y})"><path d="M0 0V-9" stroke="#555" stroke-width="1"/><circle cx="0" cy="-10" r="3" fill="${c}" stroke="#fff" stroke-width=".8"/></g>`).join("")}
        <text x="${w - 28}" y="${tiefe - 16}" text-anchor="end" font-size="7" fill="#6d5a3a" font-family="Georgia, serif" font-style="italic">Porta Westfalica</text>
      </g>`;
    /* Darüber legt welt.js die echte Stadt, sobald die Daten da sind. */
    return { svg: svg(w, h, innen, "m-kartentisch"), w, h, unten: 26,
      html: `<div class="welt-anzeige welt-karte" data-anzeige="stadt" style="left:8px;top:8px;width:${w - 16}px;height:${tiefe - 14}px"></div>` };
  }

  function schreibtisch(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 46;
    const innen = `
      <rect x="6" y="${h - 7}" width="${w - 12}" height="6" rx="3" fill="#000" opacity=".2"/>
      <rect x="0" y="${tiefe + 10}" width="${w}" height="${h - tiefe - 16}" fill="#4a3120"/>
      <rect x="0" y="22" width="${w}" height="${tiefe - 8}" rx="3" fill="#6b4a2e"/>
      <rect x="0" y="${tiefe + 8}" width="${w}" height="6" fill="#5a3d27"/>
      <rect x="${w / 2 - 20}" y="6" width="40" height="26" rx="2" fill="#2a2f38"/><rect x="${w / 2 - 17}" y="9" width="34" height="19" fill="#6fb6d9"/>
      <rect x="${w / 2 - 24}" y="30" width="48" height="4" rx="1" fill="#3a3f48"/>
      <path d="M14 34V10L22 4" stroke="#333" stroke-width="2" fill="none"/><path d="M16 2L28 2L24 10Z" fill="#f2c94c"/>
      <rect x="${w - 34}" y="26" width="22" height="14" fill="#f4efe2" transform="rotate(-6 ${w - 23} 33)"/>`;
    return { svg: svg(w, h, innen), w, h, unten: 6 };
  }

  function markt(ding) {
    const [x1, y1, x2, y2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 8, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 76;
    const streifen = Array.from({ length: 8 }, (_, i) => `<path d="M${4 + i * (w - 8) / 8} 8H${4 + (i + 1) * (w - 8) / 8}V30Q${4 + (i + 0.5) * (w - 8) / 8} 38 ${4 + i * (w - 8) / 8} 30Z" fill="${i % 2 ? "#f4efe2" : "#c8453c"}"/>`).join("");
    const innen = `
      <rect x="6" y="${h - 7}" width="${w - 12}" height="6" rx="3" fill="#000" opacity=".2"/>
      <path d="M8 30V${h - 8}M${w - 8} 30V${h - 8}" stroke="#5a3d27" stroke-width="4"/>
      ${streifen}
      <rect x="2" y="${h - tiefe - 26}" width="${w - 4}" height="${tiefe + 16}" rx="3" fill="#6b4a2e"/>
      <rect x="2" y="${h - tiefe - 26}" width="${w - 4}" height="8" rx="3" class="m-holz-hell"/>
      <circle cx="30" cy="${h - tiefe - 32}" r="7" fill="#5ec8f2" stroke="#1e6d8f" stroke-width="1"/>
      <path d="M52 ${h - tiefe - 26}l8 -14 8 14z" class="m-gold"/>
      <rect x="78" y="${h - tiefe - 38}" width="16" height="12" rx="2" fill="#8d5bd6"/>
      <text x="${w / 2}" y="${h - 14}" text-anchor="middle" font-size="9" font-weight="800" letter-spacing="3" class="m-akzent-text">MARKT</text>`;
    return { svg: svg(w, h, innen, "m-markt"), w, h };
  }

  function pult() {
    const w = 46, h = 70;
    const innen = `
      <ellipse cx="23" cy="66" rx="18" ry="4" fill="#000" opacity=".2"/>
      <path d="M10 30H36L32 66H14Z" fill="#5a3d27" stroke="#3a2718" stroke-width="1"/>
      <path d="M4 20H42L38 32H8Z" class="m-holz-hell" stroke="#3a2718" stroke-width="1"/>
      <path d="M18 44h10" class="m-akzent-linie" stroke-width="2"/>
      <g class="m-hammer" style="transform-origin:32px 22px"><rect x="22" y="8" width="14" height="7" rx="2" fill="#6b4a2e" stroke="#3a2718" stroke-width=".8"/><path d="M29 15L34 24" stroke="#6b4a2e" stroke-width="2.4" stroke-linecap="round"/></g>`;
    return { svg: svg(w, h, innen, "m-pult"), w, h };
  }

  function regal() {
    const w = 70, h = 100;
    const buecher = (y) => [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${8 + i * 9}" y="${y - 16 + (i % 3)}" width="7" height="${16 - (i % 3)}" fill="${["#c8453c", "#3f6fd0", "#d6a93a", "#4fb76a", "#8d5bd6", "#5a9d91"][i]}"/>`).join("");
    const innen = `
      <rect x="2" y="2" width="66" height="96" rx="3" fill="#4a3120"/>
      <rect x="6" y="6" width="58" height="88" fill="#2b1d12"/>
      ${[30, 58, 86].map((y) => `<rect x="4" y="${y}" width="62" height="4" fill="#6b4a2e"/>${buecher(y)}`).join("")}
      <rect x="44" y="40" width="7" height="18" fill="#2e7d4f" transform="rotate(-8 47 58)"/>`;
    return { svg: svg(w, h, innen), w, h };
  }


  /* Anzeigen: das Gehäuse steht hier, den Inhalt schreibt welt.js live
     hinein (Feed, Bestenliste, Rekorde). `html` ist ein leerer Platz dafür. */
  function laufschrift(d) {
    const w = Math.round((d.breite || 12) * T), h = 30;
    const innen = `<rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="#0b0d10" stroke="#3a3e44" stroke-width="2"/>
      <rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="4" fill="none" class="m-akzent-linie" stroke-opacity=".45"/>
      <circle cx="12" cy="15" r="4" fill="#e5534b" class="m-live"/>`;
    return { svg: svg(w, h, innen, "m-laufschrift"), w, h, html: `<div class="welt-anzeige welt-lauf" data-anzeige="feed-lauf"><div class="welt-lauf-band"></div></div>` };
  }

  function podest() {
    const w = 210, h = 176;
    const stufe = (x, breite, hoehe, farbe, nr) => `<rect x="${x}" y="${h - hoehe}" width="${breite}" height="${hoehe}" rx="3" fill="${farbe}" stroke="#2a1d0e" stroke-width="1.5"/><rect x="${x}" y="${h - hoehe}" width="${breite}" height="6" rx="2" fill="#fff" opacity=".25"/><text x="${x + breite / 2}" y="${h - hoehe / 2 + 8}" text-anchor="middle" font-size="22" font-weight="900" fill="#2a1d0e" opacity=".6" font-family="Georgia, serif">${nr}</text>`;
    const innen = `<ellipse cx="${w / 2}" cy="${h - 2}" rx="${w / 2 - 4}" ry="5" fill="#000" opacity=".25"/>`
      + stufe(4, 66, 40, "#c0c6cc", 2) + stufe(72, 66, 58, "#e2b656", 1) + stufe(140, 66, 28, "#c98a4f", 3);
    return { svg: svg(w, h, innen, "m-podest"), w, h, html: `<div class="welt-anzeige welt-podest" data-anzeige="podest"></div>` };
  }

  function wandtafel(d, titel, anzeige) {
    const w = Math.round((d.breite || 3) * T), h = 104;
    const innen = `<rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="#4a3120" stroke="#2b1d12" stroke-width="2"/>
      <rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="3" fill="#10161a"/>
      <rect x="6" y="6" width="${w - 12}" height="16" rx="3" fill="#1c252b"/>
      <text x="${w / 2}" y="18" text-anchor="middle" font-size="9" font-weight="800" letter-spacing="2" class="m-akzent-text">${titel}</text>`;
    return { svg: svg(w, h, innen, "m-wandtafel"), w, h, html: `<div class="welt-anzeige welt-tafel" data-anzeige="${anzeige}"></div>` };
  }
  const rekordtafel = (d) => wandtafel(d, "WOCHENREKORDE", "rekorde");

  /* Der Warteraum (game/einlass.js). Die große Tür zum Casino ist zu, davor
     hängt eine rote Kordel, darüber läuft der Countdown. Bei der Öffnung
     bekommt das Ding die Klasse „auf“: Flügel schwingen auf, die Kordel
     fällt. */
  function einlasstuer() {
    const w = 150, h = 160;
    const innen = `
      <rect x="10" y="4" width="130" height="28" rx="5" fill="#0d0a06" stroke="#e2b656" stroke-width="1.6"/>
      <path d="M18 160V52Q18 38 32 38H118Q132 38 132 52V160Z" fill="#2b1a0c" stroke="#e2b656" stroke-width="3"/>
      <path d="M26 160V56Q26 46 36 46H114Q124 46 124 56V160Z" fill="#14100a"/>
      <g class="m-fluegel l"><path d="M26 160V56Q26 46 36 46H75V160Z" fill="#5a3418" stroke="#2b1a0c" stroke-width="1"/><rect x="34" y="60" width="32" height="38" rx="3" fill="none" stroke="#e2b656" stroke-width="1.2" opacity=".8"/><rect x="34" y="108" width="32" height="40" rx="3" fill="none" stroke="#e2b656" stroke-width="1.2" opacity=".8"/><circle cx="69" cy="104" r="2.6" fill="#e2b656"/></g>
      <g class="m-fluegel r"><path d="M75 160V46H114Q124 46 124 56V160Z" fill="#5a3418" stroke="#2b1a0c" stroke-width="1"/><rect x="84" y="60" width="32" height="38" rx="3" fill="none" stroke="#e2b656" stroke-width="1.2" opacity=".8"/><rect x="84" y="108" width="32" height="40" rx="3" fill="none" stroke="#e2b656" stroke-width="1.2" opacity=".8"/><circle cx="81" cy="104" r="2.6" fill="#e2b656"/></g>
      <rect class="m-tuerlicht" x="73" y="46" width="4" height="114" fill="#ffe7a8" opacity=".0"/>
      <g class="m-kordel">
        <rect x="8" y="122" width="6" height="36" rx="2" fill="#c9a24a" stroke="#7a5c1c" stroke-width=".8"/><circle cx="11" cy="121" r="4.4" fill="#e2b656"/>
        <rect x="136" y="122" width="6" height="36" rx="2" fill="#c9a24a" stroke="#7a5c1c" stroke-width=".8"/><circle cx="139" cy="121" r="4.4" fill="#e2b656"/>
        <path d="M13 126Q75 156 137 126" fill="none" stroke="#9e1b2c" stroke-width="5" stroke-linecap="round"/><path d="M13 125Q75 154 137 125" fill="none" stroke="#e24a5c" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>
      </g>`;
    return { svg: svg(w, h, innen, "m-einlasstuer"), w, h, unten: 2,
      html: `<div class="welt-anzeige welt-einlassuhr" data-anzeige="einlass-uhr" style="left:12px;top:6px;width:126px;height:24px"></div>` };
  }
  const teasertafel = (d) => wandtafel(d, "WAS HINTER DER TÜR WARTET", "einlass-teaser");
  function gaestewand(d) {
    const z = wandtafel(d, "GÄSTEBUCH", "einlass-wand");
    z.svg = z.svg.replace('fill="#10161a"', 'fill="#b8875a"').replace('fill="#1c252b"', 'fill="#7a5233"');
    return z;
  }
  function schaetzglas() {
    /* Ein bauchiges Bonbonglas mit Messingdeckel, voller Spielchips. Die
       Chips liegen nicht im Raster, sondern als Haufen: jede Reihe leicht
       versetzt, gekippt und unterschiedlich weit gedreht, oben ein
       unebener Rand. Fester Zufall, damit das Glas bei allen gleich aussieht. */
    const w = 80, h = 136;
    let saat = 46;
    const zz = () => { saat = (saat * 9301 + 49297) % 233280; return saat / 233280; };
    const farben = [["#c8243a", "#8e1526"], ["#1d1d23", "#000"], ["#2f62c4", "#1c3e86"], ["#3a9a5a", "#226640"], ["#e2b656", "#9a7a1c"], ["#f4efe2", "#b9b3a2"], ["#8d5bd6", "#5a3594"]];
    let chips = "";
    for (let r = 0; r < 12; r++) {
      const y = 108 - r * 5.2;
      const breite = r < 2 ? 22 : 25;
      const anzahl = r === 11 ? 3 : 6;
      for (let i = 0; i < anzahl; i++) {
        const x = 40 - breite + ((i + 0.5) / 6) * breite * 2 + (zz() - 0.5) * 4 + (r % 2 ? 2 : -2);
        const yy = y + (zz() - 0.5) * 2.4 - (r === 11 ? zz() * 2 : 0);
        const kipp = 1.2 + zz() * 1.4, dreh = Math.round((zz() - 0.5) * 50);
        const [f, d] = farben[Math.floor(zz() * farben.length)];
        chips += `<g transform="translate(${x.toFixed(1)} ${yy.toFixed(1)}) rotate(${dreh})"><ellipse cy="1" rx="4.4" ry="${kipp.toFixed(1)}" fill="${d}"/><ellipse rx="4.4" ry="${kipp.toFixed(1)}" fill="${f}"/><ellipse rx="2.6" ry="${(kipp * 0.55).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".7" stroke-dasharray="1.2 1.2"/></g>`;
      }
    }
    const glas = "M22 30Q22 24 28 24H52Q58 24 58 30Q70 36 70 54V104Q70 116 58 116H22Q10 116 10 104V54Q10 36 22 30Z";
    const innen = `
      <defs><clipPath id="m-glas-innen"><path d="${glas}"/></clipPath>
        <linearGradient id="m-glas-schein" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".25" stop-color="#fff" stop-opacity=".05"/><stop offset=".8" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
        <linearGradient id="m-glas-holz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4527"/><stop offset="1" stop-color="#3a2414"/></linearGradient></defs>
      <ellipse cx="40" cy="132" rx="30" ry="4" fill="#000" opacity=".3"/>
      <path d="M8 120H72L68 132H12Z" fill="url(#m-glas-holz)" stroke="#24160c" stroke-width=".8"/>
      <rect x="6" y="114" width="68" height="7" rx="2.4" fill="#7a5233" stroke="#24160c" stroke-width=".8"/>
      <rect x="22" y="123" width="36" height="7" rx="1.4" fill="#e2b656" stroke="#7a5c1c" stroke-width=".6"/>
      <text x="40" y="128.6" text-anchor="middle" font-size="4.6" font-weight="900" letter-spacing=".4" fill="#4a3412" font-family="ui-rounded, system-ui">WIE VIELE?</text>
      <path d="${glas}" fill="#d8f0f7" fill-opacity=".12"/>
      <g clip-path="url(#m-glas-innen)">${chips}</g>
      <path d="${glas}" fill="url(#m-glas-schein)" stroke="#eaf7fb" stroke-opacity=".75" stroke-width="1.4"/>
      <path d="M15 58Q15 44 22 38" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M15 66V100" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
      <path d="M64 70V96" stroke="#fff" stroke-opacity=".2" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="24" y="16" width="32" height="9" rx="2.4" fill="#c9a24a" stroke="#7a5c1c" stroke-width=".8"/>
      <path d="M27 18v5M31 18v5M35 18v5M39 18v5M43 18v5M47 18v5M51 18v5" stroke="#9a7a1c" stroke-width=".6"/>
      <rect x="30" y="11" width="20" height="6" rx="2" fill="#e2b656" stroke="#7a5c1c" stroke-width=".7"/>
      <path d="M54 21Q60 22 62 28" fill="none" stroke="#9a7a1c" stroke-width=".7"/>`;
    return { svg: svg(w, h, innen, "m-schaetzglas"), w, h, unten: 4,
      html: `<div class="welt-anzeige welt-glaszahl" data-anzeige="einlass-glas" style="left:54px;top:27px;width:34px;height:13px"></div>` };
  }

  function fernseher(d) {
    const z = wandtafel(d, "LIVE", "feed-tv");
    z.svg = z.svg.replace('fill="#4a3120"', 'fill="#1d1f24"').replace('stroke="#2b1d12"', 'stroke="#0c0d10"');
    return z;
  }

  function statistikpult(d) {
    const [x1, y1, x2, y2] = d.block;
    const w = Math.round((x2 - x1) * T) + 6, tiefe = Math.round((y2 - y1) * T);
    const h = tiefe + 60;
    const innen = `<rect x="4" y="${h - 6}" width="${w - 8}" height="5" rx="2" fill="#000" opacity=".22"/>
      <path d="M8 ${h - 6}V40H${w - 8}V${h - 6}" fill="#4a3120" stroke="#2b1d12" stroke-width="1.2"/>
      <path d="M2 40L10 10H${w - 10}L${w - 2} 40Z" fill="#6b4a2e" stroke="#2b1d12" stroke-width="1.2"/>
      <path d="M14 34L18 16H${w - 18}L${w - 14} 34Z" fill="#10161a"/>
      <path d="M20 30L28 24L36 27L46 18L56 22L66 17" fill="none" stroke="#4ade80" stroke-width="1.6"/>
      ${[20, 30, 40, 50].map((x, i) => `<rect x="${x}" y="${30 - [4, 7, 5, 9][i]}" width="6" height="${[4, 7, 5, 9][i]}" fill="#5ea8e0" opacity=".5"/>`).join("")}`;
    return { svg: svg(w, h, innen), w, h };
  }

  function seasonbanner() {
    const w = 52, h = 104;
    const innen = `<rect x="10" y="${h - 6}" width="32" height="5" rx="2" fill="#000" opacity=".25"/>
      <path d="M24 ${h - 6}V6M28 ${h - 6}V6" stroke="#6b7078" stroke-width="2"/>
      <rect x="4" y="4" width="44" height="80" rx="2" fill="#2a1f5c" stroke="#e2b656" stroke-width="1.5"/>
      <text x="26" y="36" text-anchor="middle" font-size="22" font-weight="900" fill="#f4d782" font-family="Georgia, serif">S2</text>
      <text x="26" y="50" text-anchor="middle" font-size="6" letter-spacing="1.5" fill="#e6d3a3" font-weight="700">SEASON</text>
      ${[[14, 64], [26, 70], [38, 64]].map(([x, y]) => `<path d="M${x} ${y - 4}l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" fill="#f4d782"/>`).join("")}
      <rect x="6" y="${h - 12}" width="40" height="6" rx="2" fill="#3a3e44"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function auftragsbrett() {
    const w = 92, h = 100;
    const zettel = [[10, 18, "#fff4c9", -4], [36, 14, "#d7ecff", 3], [62, 20, "#ffd9e0", -2], [16, 46, "#e2f5d0", 2], [44, 44, "#fff4c9", -3]];
    const innen = `<rect x="14" y="${h - 6}" width="64" height="5" rx="2" fill="#000" opacity=".22"/>
      <path d="M16 ${h - 6}V70M76 ${h - 6}V70" stroke="#4a3120" stroke-width="4"/>
      <rect x="2" y="4" width="88" height="70" rx="3" fill="#b58755" stroke="#5a3d27" stroke-width="3"/>
      ${zettel.map(([x, y, c, r]) => `<g transform="rotate(${r} ${x + 11} ${y + 11})"><rect x="${x}" y="${y}" width="22" height="22" fill="${c}"/><path d="M${x + 4} ${y + 8}h14M${x + 4} ${y + 12}h10M${x + 4} ${y + 16}h12" stroke="#6b5a45" stroke-width=".9"/><circle cx="${x + 11}" cy="${y + 2}" r="1.8" fill="#d24a3c"/></g>`).join("")}`;
    return { svg: svg(w, h, innen), w, h };
  }

  function kalender() {
    const w = 44, h = 54;
    const innen = `<rect x="2" y="6" width="40" height="46" rx="3" fill="#f4efe2" stroke="#6b5a45" stroke-width="1"/>
      <rect x="2" y="6" width="40" height="12" rx="3" fill="#d24a3c"/>
      <circle cx="12" cy="6" r="2" fill="#6b7078"/><circle cx="32" cy="6" r="2" fill="#6b7078"/>
      ${Array.from({ length: 12 }, (_, i) => `<rect x="${6 + (i % 4) * 9}" y="${22 + Math.floor(i / 4) * 9}" width="6" height="6" fill="${i === 9 ? "#e2b656" : "#d9d1bc"}"/>`).join("")}`;
    return { svg: svg(w, h, innen), w, h, unten: -40 };
  }

  function vitrine() {
    const w = 80, h = 108;
    const innen = `<rect x="4" y="${h - 6}" width="72" height="5" rx="2" fill="#000" opacity=".22"/>
      <rect x="4" y="6" width="72" height="${h - 12}" rx="3" fill="#4a3120"/>
      <rect x="9" y="11" width="62" height="${h - 30}" fill="#bcd3dc" opacity=".25" stroke="#9fb1b8"/>
      <path d="M9 48h62" stroke="#9fb1b8" stroke-width="1.4"/>
      <g class="m-gold"><path d="M24 44h12v-3h-3v-4q6-2 6-12h-18q0 10 6 12v4h-3z"/><path d="M52 44h10v-3h-2v-3q4-1 4-9h-14q0 8 4 9v3h-2z"/><path d="M36 76h12v-3h-3v-4q5-2 5-10h-16q0 8 5 10v4h-3z"/></g>
      <path d="M14 16l8 26" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function rennbahn(d) {
    const [x1, , x2] = d.block;
    const w = Math.round((x2 - x1) * T), h = 110;
    const innen = `<rect x="0" y="62" width="${w}" height="44" fill="#3f8a4a"/>
      <path d="M0 74H${w}M0 96H${w}" stroke="#f4efe2" stroke-width="3"/>
      ${Array.from({ length: Math.floor(w / 18) }, (_, i) => `<rect x="${i * 18 + 4}" y="66" width="4" height="36" fill="#f4efe2"/>`).join("")}
      <rect x="${w / 2 - 60}" y="4" width="120" height="54" rx="4" fill="#1a1d24" stroke="#555c66" stroke-width="2"/>
      <rect x="${w / 2 - 55}" y="9" width="110" height="44" rx="2" fill="#6fb6d9"/>
      <rect x="${w / 2 - 55}" y="38" width="110" height="15" fill="#3f8a4a"/>
      <g class="m-pferd"><path d="M${w / 2 - 20} 40q4-8 12-6l6-5 2 3-3 3q4 2 4 6l-2 6h-3l1-5h-10l-2 5h-3z" fill="#6b3c1a"/><circle cx="${w / 2 - 6}" cy="30" r="2.4" fill="#d24a3c"/></g>
      <text x="${w / 2}" y="20" text-anchor="middle" font-size="8" font-weight="800" letter-spacing="2" fill="#fff">RENNBAHN</text>`;
    /* Darüber zeigt welt.js das laufende Rennen: jede Bahn ein Pferd. */
    return { svg: svg(w, h, innen, "m-rennbahn"), w, h,
      html: `<div class="welt-anzeige welt-rennen" data-anzeige="rennen" style="left:${w / 2 - 55}px;top:9px;width:110px;height:44px"></div>` };
  }

  function lotteriebude(d) {
    const [x1, , x2] = d.block;
    const w = Math.round((x2 - x1) * T), h = 120;
    const streifen = Array.from({ length: 8 }, (_, i) => `<path d="M${i * w / 8} 20H${(i + 1) * w / 8}V42Q${(i + 0.5) * w / 8} 50 ${i * w / 8} 42Z" fill="${i % 2 ? "#f4efe2" : "#3f6fd0"}"/>`).join("");
    const innen = `<rect x="6" y="40" width="${w - 12}" height="76" fill="#6b4a2e" stroke="#3a2718" stroke-width="1.5"/>
      ${streifen}
      <rect x="0" y="4" width="${w}" height="18" rx="3" fill="#1d2a6e"/>
      <text x="${w / 2}" y="17" text-anchor="middle" font-size="11" font-weight="900" letter-spacing="3" fill="#f2c94c">LOTTERIE</text>
      <rect x="18" y="52" width="${w - 36}" height="30" fill="#10161a"/>
      ${[0, 1, 2, 3].map((i) => `<circle class="m-kugel" cx="${34 + i * 22}" cy="67" r="8" fill="${["#e5534b", "#f2c94c", "#4fb76a", "#4a8fe0"][i]}"/><text x="${34 + i * 22}" y="70" text-anchor="middle" font-size="8" font-weight="900" fill="#fff">${[4, 9, 12, 16][i]}</text>`).join("")}
      <rect x="4" y="86" width="${w - 8}" height="8" rx="2" class="m-holz-hell"/>`;
    /* Darüber zeigt welt.js die zuletzt gezogenen Zahlen und den Jackpot. */
    return { svg: svg(w, h, innen), w, h,
      html: `<div class="welt-anzeige welt-lotto" data-anzeige="lotto" style="left:18px;top:52px;width:${w - 36}px;height:30px"></div>`
        + `<div class="welt-anzeige welt-lotto-jackpot" data-anzeige="lotto-jackpot" style="left:6px;top:97px;width:${w - 12}px;height:15px"></div>` };
  }

  function fahnenmast() {
    const w = 60, h = 150;
    const innen = `<ellipse cx="14" cy="${h - 3}" rx="10" ry="3" fill="#000" opacity=".25"/>
      <path d="M14 ${h - 4}V6" stroke="#c0c6cc" stroke-width="3"/><circle cx="14" cy="5" r="3" class="m-gold"/>
      <g class="m-flagge" style="transform-origin:14px 12px"><path d="M15 10Q35 4 56 12V44Q35 36 15 42Z" fill="#8e1f2b" stroke="#4a0f16" stroke-width="1"/><path d="M28 20l6 6-6 6-6-6z" class="m-gold"/></g>`;
    return { svg: svg(w, h, innen), w, h, unten: 0 };
  }

  function feuerschale() {
    const w = 54, h = 62;
    const innen = `<ellipse cx="27" cy="58" rx="22" ry="4" fill="#000" opacity=".3"/>
      <circle cx="27" cy="44" r="30" fill="#ff9d3a" opacity=".12" class="m-schein"/>
      <path d="M12 58l6-12h18l6 12" stroke="#2a2d33" stroke-width="3" fill="none"/>
      <path d="M6 40Q27 58 48 40Z" fill="#3a3e44" stroke="#1d1f24" stroke-width="1.2"/>
      <g class="m-flammen"><path d="M16 40Q14 26 22 20Q21 30 27 32Q26 18 33 12Q33 26 38 30Q41 26 40 22Q46 32 38 40Z" fill="#ff8a3d"/><path d="M21 40Q21 32 26 28Q27 34 30 35Q31 28 34 26Q36 34 33 40Z" fill="#ffd25e"/></g>`;
    return { svg: svg(w, h, innen, "m-feuer"), w, h };
  }

  function parkbank(d) {
    const [x1, , x2] = d.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 54;
    const innen = `<rect x="6" y="${h - 5}" width="${w - 12}" height="4" rx="2" fill="#000" opacity=".22"/>
      <path d="M10 ${h - 4}V24M${w - 10} ${h - 4}V24" stroke="#2a2d33" stroke-width="4"/>
      <rect x="2" y="6" width="${w - 4}" height="8" rx="2" fill="#8a6242" stroke="#4a3120" stroke-width="1"/>
      <rect x="2" y="17" width="${w - 4}" height="8" rx="2" fill="#8a6242" stroke="#4a3120" stroke-width="1"/>
      <rect x="2" y="28" width="${w - 4}" height="6" rx="2" fill="#6b4a2e" stroke="#4a3120" stroke-width="1"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function laterne() {
    const w = 30, h = 120;
    const innen = `<circle cx="15" cy="18" r="26" fill="#ffe7a0" opacity=".14" class="m-schein"/>
      <ellipse cx="15" cy="${h - 3}" rx="8" ry="2.4" fill="#000" opacity=".25"/>
      <path d="M15 ${h - 4}V26" stroke="#2a2d33" stroke-width="3"/>
      <path d="M7 14H23L20 28H10Z" class="m-glas" fill="#fff3c4" stroke="#2a2d33" stroke-width="1.5"/><path d="M5 14L15 6L25 14Z" fill="#2a2d33"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function busch() {
    const w = 62, h = 48;
    const innen = `<ellipse cx="31" cy="45" rx="26" ry="3.4" fill="#000" opacity=".25"/>
      <circle cx="18" cy="30" r="14" fill="#2f6b3a"/><circle cx="44" cy="30" r="14" fill="#2f6b3a"/><circle cx="31" cy="20" r="16" fill="#3f8a4a"/>
      <circle cx="26" cy="16" r="3" fill="#e5534b"/><circle cx="40" cy="26" r="2.6" fill="#e5534b"/>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function kleeblatt() {
    const w = 16, h = 14;
    const innen = [[5, 5], [9, 3.4], [11, 7], [7, 8.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#3b7d3f"/>`).join("") + `<path d="M8 7Q7 11 8 13" stroke="#2e6a33" stroke-width="1" fill="none"/>`;
    return { svg: svg(w, h, innen, "m-kleeblatt"), w, h };
  }

  function tresortuer() {
    const w = 140, h = 132;
    const innen = `<circle cx="70" cy="66" r="62" fill="#4a4f57" stroke="#23262b" stroke-width="3"/>
      <circle cx="70" cy="66" r="50" fill="#6b7078" stroke="#3a3e44" stroke-width="2"/>
      ${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(70 + Math.cos(a) * 56).toFixed(1)}" cy="${(66 + Math.sin(a) * 56).toFixed(1)}" r="3" fill="#c0c6cc"/>`; }).join("")}
      <g class="m-rad-drehung" style="transform-origin:70px 66px"><circle cx="70" cy="66" r="18" fill="#c9a14a" stroke="#6e5420" stroke-width="2"/><path d="M70 40v52M44 66h52M52 48l36 36M88 48l-36 36" stroke="#8e6931" stroke-width="4" stroke-linecap="round"/></g>
      <circle cx="70" cy="66" r="6" fill="#23262b"/>`;
    return { svg: svg(w, h, innen), w, h, unten: -6 };
  }

  function goldstapel(d) {
    const [x1, , x2] = d.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 46;
    const barren = (x, y) => `<path d="M${x} ${y + 10}L${x + 4} ${y}H${x + 20}L${x + 24} ${y + 10}Z" fill="#e2b656" stroke="#8e6931" stroke-width="1"/><path d="M${x + 4} ${y}L${x + 7} ${y + 4}H${x + 17}L${x + 20} ${y}" fill="#f4d782"/>`;
    const innen = `<ellipse cx="${w / 2}" cy="${h - 3}" rx="${w / 2 - 4}" ry="3" fill="#000" opacity=".25"/>`
      + barren(4, 32) + barren(28, 32) + barren(52, 32) + barren(16, 22) + barren(40, 22) + barren(28, 12);
    return { svg: svg(w, h, innen, "m-gold-stapel"), w, h };
  }

  function katzenkissen() {
    const w = 66, h = 44;
    const innen = `<ellipse cx="33" cy="40" rx="30" ry="4" fill="#000" opacity=".25"/>
      <ellipse cx="33" cy="32" rx="30" ry="9" fill="#8e1f2b" stroke="#4a0f16" stroke-width="1"/>
      <ellipse cx="33" cy="30" rx="26" ry="6" fill="#b3263a"/>
      <g class="m-katze-atmen"><ellipse cx="33" cy="24" rx="17" ry="9" fill="#7d8591" stroke="#434852" stroke-width="1"/>
      <circle cx="46" cy="21" r="7" fill="#7d8591" stroke="#434852" stroke-width="1"/>
      <path d="M42 16l1-5 4 3zM48 15l3-4 1 5z" fill="#7d8591" stroke="#434852" stroke-width=".8"/>
      <path d="M43 22q2 1 4 0M47 22q2 1 4 0" stroke="#2a2d33" stroke-width=".9" fill="none"/>
      <path d="M17 26q-6 4 2 6q10 1 16-2" fill="none" stroke="#7d8591" stroke-width="4" stroke-linecap="round"/>
      <path d="M40 27q6 1 9-2" stroke="#1d2a6e" stroke-width="2" fill="none"/><circle cx="44" cy="28" r="1.4" class="m-gold"/></g>
      <text class="m-zzz" x="54" y="10" font-size="9" font-weight="800" fill="#d7e2ff">z</text>`;
    return { svg: svg(w, h, innen), w, h };
  }

  function notiz() {
    const w = 34, h = 38;
    const innen = `<g transform="rotate(-6 17 19)"><rect x="4" y="4" width="26" height="30" fill="#f4efe2" stroke="#b9b3a2" stroke-width=".8"/>
      <path d="M8 12h18M8 16h14M8 20h17M8 24h12" stroke="#6b5a45" stroke-width=".9"/><circle cx="17" cy="5" r="2" fill="#d24a3c"/></g>`;
    return { svg: svg(w, h, innen), w, h, unten: -38 };
  }

  /* Eine Messingstange mit Samtkordel am Eingang zum Modehaus: zwei
     Pfosten hintereinander, die Kordel hängt dazwischen durch. Das Ding
     steht mit dem vorderen Pfosten auf dem Boden, der hintere liegt eine
     gute Kachel weiter oben im Raum. */
  function kordel() {
    const w = 30, tief = 55, hoch = 34, h = tief + hoch + 8;
    const pfosten = (y) => `<ellipse cx="15" cy="${y}" rx="7" ry="2.4" fill="#8e6931"/><rect x="13.4" y="${y - hoch}" width="3.2" height="${hoch}" fill="#e2b656" stroke="#8e6931" stroke-width=".6"/><circle cx="15" cy="${y - hoch - 2}" r="3.6" fill="#f4d782" stroke="#8e6931" stroke-width=".6"/>`;
    const unten = h - 4, oben = unten - tief;
    const innen = `<ellipse cx="15" cy="${unten + 1}" rx="9" ry="2.6" fill="#000" opacity=".25"/>
      ${pfosten(oben)}
      <path d="M15 ${oben - hoch + 2}Q27 ${(oben + unten) / 2 - hoch + 14} 15 ${unten - hoch + 2}" fill="none" stroke="#7a1022" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M15 ${oben - hoch + 2}Q25 ${(oben + unten) / 2 - hoch + 12} 15 ${unten - hoch + 2}" fill="none" stroke="#c8243a" stroke-width="1.4" stroke-linecap="round"/>
      ${pfosten(unten)}`;
    return { svg: svg(w, h, innen, "m-kordel"), w, h, unten: -4 };
  }

  /* Die Prägepresse im Atelier: gusseiserne Spindel mit Schwungrad, unten
     der Amboss mit einer frisch geprägten Marke. */
  function praegepresse(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 140, mx = w / 2;
    const innen = `<ellipse cx="${mx}" cy="${h - 4}" rx="${w / 2 - 4}" ry="4" fill="#000" opacity=".25"/>
      <rect x="${mx - 30}" y="${h - 30}" width="60" height="26" rx="3" fill="#3a3e44" stroke="#1d1f23" stroke-width="1.2"/>
      <path d="M${mx - 26} 46V${h - 30}M${mx + 26} 46V${h - 30}" stroke="#4a4f57" stroke-width="9" stroke-linecap="round"/>
      <rect x="${mx - 34}" y="38" width="68" height="14" rx="4" fill="#4a4f57" stroke="#1d1f23" stroke-width="1.2"/>
      <path d="M${mx} 24V${h - 52}" stroke="#8b929c" stroke-width="6"/>
      <path d="M${mx} 24V${h - 52}" stroke="#c0c6cc" stroke-width="1.4" stroke-dasharray="2 3"/>
      <rect x="${mx - 12}" y="${h - 54}" width="24" height="8" rx="2" fill="#6b7078"/>
      <g class="m-praegerad" style="transform-origin:${mx}px 24px"><ellipse cx="${mx}" cy="24" rx="42" ry="8" fill="none" stroke="#c9a14a" stroke-width="4"/>
        <path d="M${mx - 42} 24H${mx + 42}" stroke="#8e6931" stroke-width="2"/><circle cx="${mx - 42}" cy="24" r="4.4" fill="#e2b656"/><circle cx="${mx + 42}" cy="24" r="4.4" fill="#e2b656"/></g>
      <rect x="${mx - 18}" y="${h - 40}" width="36" height="10" rx="2" fill="#23262b"/>
      <g class="m-praegemarke"><ellipse cx="${mx}" cy="${h - 41}" rx="9" ry="3.2" fill="#e2b656" stroke="#8e6931" stroke-width=".8"/><path d="M${mx - 3} ${h - 42}l3-1.4 3 1.4" fill="none" stroke="#8e6931" stroke-width=".7"/></g>
      <text x="${mx}" y="${h - 13}" text-anchor="middle" font-size="7.5" font-weight="900" letter-spacing="1.4" fill="#e2b656" font-family="ui-rounded, system-ui">PRÄGEATELIER</text>`;
    return { svg: svg(w, h, innen, "m-praegepresse"), w, h, unten: 2 };
  }

  /* Ein alter Schrank, der so aussieht wie jeder andere. Nur die rechte Tür
     steht einen Spalt offen, ein Ärmel hängt heraus, und dahinter ist es
     heller, als es in einem Schrank sein dürfte. */
  function kleiderschrank(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 152, mx = w / 2;
    const innen = `<rect x="3" y="${h - 6}" width="${w - 6}" height="6" fill="#000" opacity=".25"/>
      <path d="M2 14Q${mx} 2 ${w - 2} 14V20H2Z" fill="#5a3d27" stroke="#2b1d12" stroke-width="1.2"/>
      <rect x="4" y="18" width="${w - 8}" height="${h - 28}" fill="#6b4a2e" stroke="#2b1d12" stroke-width="1.4"/>
      <rect x="9" y="24" width="${mx - 12}" height="${h - 42}" rx="2" fill="#5a3d27" stroke="#2b1d12" stroke-width="1"/>
      <rect x="15" y="34" width="${mx - 24}" height="${h - 64}" rx="2" fill="none" stroke="#3a2718" stroke-width="1"/>
      <path class="m-schrankspalt" d="M${mx + 1} 24V${h - 18}" stroke="#fff1c4" stroke-width="2.4" opacity=".7"/>
      <g transform="skewY(-3)"><rect x="${mx + 3}" y="${27}" width="${mx - 12}" height="${h - 42}" rx="2" fill="#5a3d27" stroke="#2b1d12" stroke-width="1"/>
        <rect x="${mx + 9}" y="37" width="${mx - 24}" height="${h - 64}" rx="2" fill="none" stroke="#3a2718" stroke-width="1"/></g>
      <circle cx="${mx - 6}" cy="${h / 2 + 4}" r="2.2" fill="#c9a14a"/><circle cx="${mx + 8}" cy="${h / 2 + 2}" r="2.2" fill="#c9a14a"/>
      <path d="M${mx + 2} ${h / 2 + 18}q-6 10-2 26q4 6 8 2l-2-26z" fill="#7a2230" stroke="#3a0f16" stroke-width=".8"/>
      <rect x="4" y="${h - 12}" width="${w - 8}" height="6" fill="#3a2718"/>
      <path d="M10 ${h - 6}v4M${w - 10} ${h - 6}v4" stroke="#2b1d12" stroke-width="3"/>`;
    return { svg: svg(w, h, innen, "m-kleiderschrank"), w, h, unten: 2 };
  }

  /* Eine Schneiderpuppe auf drei Beinen, um den Hals ein Maßband. */
  function schneiderpuppe() {
    const w = 46, h = 104;
    const innen = `<ellipse cx="23" cy="${h - 4}" rx="16" ry="3.6" fill="#000" opacity=".25"/>
      <path d="M23 ${h - 26}V${h - 8}M23 ${h - 10}L10 ${h - 3}M23 ${h - 10}L36 ${h - 3}M23 ${h - 10}V${h - 2}" stroke="#4a3120" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M21 14h4v8h-4z" fill="#4a3120"/><circle cx="23" cy="12" r="4" fill="#c9a14a"/>
      <path d="M8 26Q23 18 38 26Q40 40 34 52Q38 64 34 ${h - 28}H12Q8 64 12 52Q6 40 8 26Z" fill="#e8dcc4" stroke="#a8916a" stroke-width="1.2"/>
      <path d="M23 22V${h - 28}" stroke="#a8916a" stroke-width=".8" stroke-dasharray="2 2"/>
      <path d="M12 52Q23 56 34 52" fill="none" stroke="#a8916a" stroke-width=".8"/>
      <path d="M12 24Q16 40 15 58M34 24Q30 40 31 58" fill="none" stroke="#f2d24a" stroke-width="2.2"/>
      ${[30, 36, 42, 48, 54].map((y) => `<path d="M14 ${y}h2M30 ${y}h2" stroke="#1d1d23" stroke-width=".5"/>`).join("")}
      <circle cx="31" cy="36" r="1.4" fill="#c8243a"/><circle cx="28" cy="40" r="1.4" fill="#3f6fd0"/>`;
    return { svg: svg(w, h, innen, "m-schneiderpuppe"), w, h, unten: 2 };
  }

  /* Der Nähtisch mit einer alten schwarzen Maschine und Garnrollen. */
  function naehtisch(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 92;
    const innen = `<rect x="4" y="${h - 6}" width="${w - 8}" height="5" rx="2" fill="#000" opacity=".22"/>
      <path d="M12 52V${h - 4}M${w - 12} 52V${h - 4}" stroke="#2b2f36" stroke-width="4"/>
      <path d="M12 ${h - 22}H${w - 12}" stroke="#2b2f36" stroke-width="2"/>
      <circle cx="${w - 30}" cy="${h - 22}" r="9" fill="none" stroke="#2b2f36" stroke-width="2.4"/>
      <rect x="2" y="44" width="${w - 4}" height="10" rx="2" class="m-holz-hell" stroke="#3a2718" stroke-width="1"/>
      <g class="m-naehmaschine"><path d="M${w / 2 - 34} 44V22Q${w / 2 - 34} 12 ${w / 2 - 22} 12H${w / 2 + 22}Q${w / 2 + 30} 12 ${w / 2 + 30} 22V30H${w / 2 - 22}V44Z" fill="#17181c" stroke="#000" stroke-width="1"/>
        <path d="M${w / 2 - 28} 18H${w / 2 + 24}" stroke="#c9a14a" stroke-width="1.4"/>
        <text x="${w / 2}" y="26" text-anchor="middle" font-size="6" font-weight="900" fill="#c9a14a" font-family="ui-serif, Georgia, serif">Porta</text>
        <circle cx="${w / 2 + 30}" cy="22" r="6" fill="#8b929c" stroke="#23262b"/>
        <path d="M${w / 2 - 22} 30V40" stroke="#c0c6cc" stroke-width="1.6"/></g>
      <path d="M${w / 2 - 30} 44H${w / 2 + 8}" stroke="#c8243a" stroke-width="3"/>
      ${[["#3f6fd0", 10], ["#e2b656", 18], ["#3f9a5a", 26]].map(([c, x]) => `<rect x="${x}" y="36" width="6" height="8" rx="1" fill="${c}" stroke="#1d1d23" stroke-width=".5"/>`).join("")}`;
    return { svg: svg(w, h, innen, "m-naehtisch"), w, h, unten: 2 };
  }

  /* Der Zuschnitttisch: eine Stoffbahn, eine große Schere, Schnittmuster. */
  function zuschnitt(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 70;
    const innen = `<rect x="4" y="${h - 6}" width="${w - 8}" height="5" rx="2" fill="#000" opacity=".22"/>
      <path d="M10 34V${h - 4}M${w - 10} 34V${h - 4}" stroke="#3a2718" stroke-width="4"/>
      <rect x="2" y="24" width="${w - 4}" height="12" rx="2" class="m-holz-hell" stroke="#3a2718" stroke-width="1"/>
      <path d="M10 26H${w * 0.6}L${w * 0.6 + 8} 34H6Z" fill="#2b3a55" stroke="#1d1d23" stroke-width=".7"/>
      <path d="M14 30H${w * 0.55}" stroke="#f4f1ea" stroke-width=".7" stroke-dasharray="3 2"/>
      <rect x="${w * 0.62}" y="16" width="${w * 0.3}" height="10" rx="4" fill="#c8243a" stroke="#6b1018" stroke-width=".8"/>
      <path d="M${w * 0.64} 21H${w * 0.9}" stroke="#a51b2f" stroke-width=".7"/>
      <g transform="translate(${w * 0.28} 18) rotate(-12)"><circle cx="0" cy="6" r="3" fill="none" stroke="#e5534b" stroke-width="1.6"/><circle cx="7" cy="6" r="3" fill="none" stroke="#e5534b" stroke-width="1.6"/><path d="M2 4L22 0M5 4L22 2" stroke="#c0c6cc" stroke-width="1.6"/></g>`;
    return { svg: svg(w, h, innen, "m-zuschnitt"), w, h, unten: 2 };
  }

  /* Ein Regal voller Stoffballen. */
  function stoffregal(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 120;
    const farben = ["#c8243a", "#2b3a55", "#e2b656", "#3f9a5a", "#c86bd6", "#f4f1ea", "#e8812b", "#7ec8e3", "#2a2f38", "#f06a8a"];
    const fach = (y, n0) => Array.from({ length: Math.floor((w - 16) / 15) }, (_, i) => {
      const f = farben[(i + n0) % farben.length];
      return `<rect x="${9 + i * 15}" y="${y - 22}" width="13" height="22" rx="3" fill="${f}" stroke="#1d1d23" stroke-width=".6"/><ellipse cx="${15.5 + i * 15}" cy="${y - 22}" rx="6.5" ry="2" fill="${f}" stroke="#1d1d23" stroke-width=".5"/>`;
    }).join("");
    const innen = `<rect x="2" y="4" width="${w - 4}" height="${h - 8}" rx="3" fill="#4a3120"/>
      <rect x="6" y="8" width="${w - 12}" height="${h - 16}" fill="#2b1d12"/>
      ${[42, 76, 110].map((y, i) => `${fach(y, i * 3)}<rect x="4" y="${y}" width="${w - 8}" height="4" fill="#6b4a2e"/>`).join("")}`;
    return { svg: svg(w, h, innen, "m-stoffregal"), w, h };
  }

  /* Eine alte Truhe mit Eisenbändern im Fundus. */
  function truhe(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 62;
    const innen = `<ellipse cx="${w / 2}" cy="${h - 3}" rx="${w / 2 - 3}" ry="3.4" fill="#000" opacity=".25"/>
      <rect x="4" y="26" width="${w - 8}" height="${h - 30}" rx="3" fill="#6b4423" stroke="#2b1d12" stroke-width="1.2"/>
      <path d="M4 26Q${w / 2} 4 ${w - 4} 26Z" fill="#7d5230" stroke="#2b1d12" stroke-width="1.2"/>
      <path d="M16 12V${h - 4}M${w - 16} 12V${h - 4}" stroke="#3a3e44" stroke-width="4"/>
      <path d="M4 27H${w - 4}" stroke="#3a3e44" stroke-width="3"/>
      <rect x="${w / 2 - 6}" y="24" width="12" height="12" rx="2" fill="#c9a14a" stroke="#6e5420"/>
      <path d="M${w / 2} 28v4" stroke="#2b1d12" stroke-width="1.6"/>
      <path class="m-truhenschein" d="M8 26Q${w / 2} 20 ${w - 8} 26" stroke="#fff1c4" stroke-width="1" opacity=".0" fill="none"/>`;
    return { svg: svg(w, h, innen, "m-truhe"), w, h };
  }

  /* Der Schminkspiegel im Fundus, mit Glühbirnen rundherum, von denen
     zwei nicht mehr gehen. */
  function schminkspiegel() {
    const w = 104, h = 92;
    const birnen = [];
    for (let i = 0; i < 6; i++) birnen.push([10 + i * 16.8, 8]);
    for (let i = 1; i < 5; i++) { birnen.push([6, 8 + i * 17]); birnen.push([w - 6, 8 + i * 17]); }
    const innen = `<rect x="4" y="4" width="${w - 8}" height="${h - 14}" rx="6" fill="#2a2230" stroke="#b8923e" stroke-width="2"/>
      <rect x="14" y="16" width="${w - 28}" height="${h - 38}" rx="3" fill="#3b4a52"/>
      <path d="M22 22L38 22L24 46Z" fill="#fff" opacity=".18"/>
      ${birnen.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${i === 3 || i === 9 ? "#6e6650" : "#fff1c4"}" stroke="#b8923e" stroke-width=".6"${i === 3 || i === 9 ? "" : ' class="m-birne"'}/>`).join("")}
      <rect x="10" y="${h - 14}" width="${w - 20}" height="8" rx="2" fill="#6b4a2e"/>
      <circle cx="26" cy="${h - 16}" r="3" fill="#c8243a"/><rect x="40" y="${h - 22}" width="5" height="8" rx="1" fill="#e2b656"/><path d="M60 ${h - 15}h16" stroke="#f4f1ea" stroke-width="2"/>`;
    return { svg: svg(w, h, innen, "m-schminkspiegel"), w, h, unten: -10 };
  }

  /* Die Vitrine für die eigene Sammlung: drei Fächer mit Hut, Brille und
     einem Stein, die gerade Licht abbekommen. */
  function sammelvitrine(ding) {
    /* Niedriger als die Pokalvitrine in der Ruhmeshalle: dahinter hängt
       das Wandregal mit Schuhen und Taschen, und das soll sichtbar bleiben. */
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 98, mx = w / 2;
    const innen = `<ellipse cx="${mx}" cy="${h - 3}" rx="${w / 2 - 4}" ry="3.4" fill="#000" opacity=".25"/>
      <rect x="4" y="${h - 24}" width="${w - 8}" height="20" fill="#2a2230" stroke="#b8923e" stroke-width="1.2"/>
      <rect x="2" y="${h - 28}" width="${w - 4}" height="6" rx="1" fill="#b8923e"/>
      <rect x="7" y="8" width="${w - 14}" height="${h - 36}" fill="#bcd3dc" fill-opacity=".16" stroke="#d8e6ea" stroke-width="1.2"/>
      <rect x="4" y="4" width="${w - 8}" height="6" rx="2" fill="#b8923e"/>
      <path d="M7 38H${w - 7}" stroke="#d8e6ea" stroke-width="1"/>
      <path d="M${mx - 26} 34H${mx - 4}M${mx - 21} 34Q${mx - 21} 20 ${mx - 15} 20Q${mx - 9} 20 ${mx - 9} 34" fill="#1d1b22" stroke="#000" stroke-width="1"/><path d="M${mx - 21} 31H${mx - 9}" stroke="#c8243a" stroke-width="2"/>
      <path class="m-glitzer" d="M${mx + 15} 20l7 6-7 10-7-10z" fill="#b6ff4d" stroke="#5c8a20" stroke-width=".8"/>
      <path d="M${mx - 18} 54h12v3q-6 4-12 0zM${mx + 6} 54h12v3q-6 4-12 0z" fill="#111317" stroke="#e2b656" stroke-width=".8"/><path d="M${mx - 6} 55h12" stroke="#e2b656" stroke-width="1"/>
      <path class="m-glanz" d="M11 12L19 12L11 26Z" fill="#fff" opacity=".35"/>
      <text x="${mx}" y="${h - 10}" text-anchor="middle" font-size="6.5" font-weight="900" letter-spacing="1" fill="#f2d27a" font-family="ui-rounded, system-ui">SAMMLUNG</text>`;
    return { svg: svg(w, h, innen, "m-sammelvitrine"), w, h, unten: 2 };
  }

  /* Die Dachbar: ein Tresen aus dunklem Holz unter einer gestreiften
     Markise, dahinter ein Regal mit Flaschen und eine kleine Leuchtschrift. */
  function dachbar(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 6, h = 150;
    const flaschen = Array.from({ length: Math.floor((w - 40) / 13) }, (_, i) => {
      const f = ["#3f9a5a", "#c8243a", "#e2b656", "#7ec8e3", "#8d5bd6", "#e8812b", "#f4f1ea"][i % 7];
      const x = 20 + i * 13, hoch = 18 + (i % 3) * 4;
      return `<rect x="${x}" y="${62 - hoch}" width="7" height="${hoch}" rx="2" fill="${f}" fill-opacity=".85" stroke="#1d1d23" stroke-width=".5"/><rect x="${x + 2}" y="${58 - hoch}" width="3" height="5" fill="${f}"/>`;
    }).join("");
    const n = Math.round(w / 22), bw = (w - 8) / n;
    const markise = Array.from({ length: n }, (_, i) => `<path d="M${4 + i * bw} 8H${4 + (i + 1) * bw}L${4 + (i + 1) * bw} 22Q${4 + (i + 0.5) * bw} 28 ${4 + i * bw} 22Z" fill="${i % 2 ? "#f4f1ea" : "#2b3a55"}" stroke="#1d1d23" stroke-width=".5"/>`).join("");
    const innen = `<rect x="2" y="${h - 6}" width="${w - 4}" height="6" fill="#000" opacity=".25"/>
      <rect x="6" y="24" width="${w - 12}" height="66" fill="#241820"/>
      <rect x="10" y="62" width="${w - 20}" height="4" fill="#6b4a2e"/><rect x="10" y="38" width="${w - 20}" height="3" fill="#6b4a2e" opacity=".6"/>
      ${flaschen}
      <text class="m-bar-schrift" x="${w / 2}" y="84" text-anchor="middle" font-size="12" font-weight="900" letter-spacing="4" font-family="ui-rounded, system-ui">DACHBAR</text>
      <path d="M6 24V${h - 10}M${w - 6} 24V${h - 10}" stroke="#3a2718" stroke-width="3"/>
      ${markise}
      <rect x="0" y="92" width="${w}" height="12" rx="3" fill="#8a5a2b" stroke="#3a2718" stroke-width="1"/>
      <rect x="4" y="104" width="${w - 8}" height="${h - 110}" fill="#5a3d27" stroke="#2b1d12" stroke-width="1"/>
      ${[0.2, 0.4, 0.6, 0.8].map((f) => `<path d="M${w * f} 106V${h - 8}" stroke="#3a2718" stroke-width="1.4"/>`).join("")}
      <path d="M${w * 0.3} 92v-8h10v8M${w * 0.62} 92l2 -12h6l2 12" fill="#bcd3dc" fill-opacity=".5" stroke="#d8e6ea" stroke-width=".8"/>
      <circle cx="${w * 0.8}" cy="86" r="4" fill="#f2d24a" stroke="#b8901c" stroke-width=".6"/>`;
    return { svg: svg(w, h, innen, "m-dachbar"), w, h, unten: 2 };
  }

  /* Eine Kreidetafel auf einem Ständer, wie vor jeder Kneipe. */
  function kreidetafel() {
    const w = 36, h = 64;
    const innen = `<ellipse cx="18" cy="${h - 3}" rx="14" ry="3" fill="#000" opacity=".22"/>
      <path d="M6 ${h - 4}L12 6M30 ${h - 4}L24 6" stroke="#6b4a2e" stroke-width="2.6"/>
      <rect x="4" y="8" width="28" height="36" rx="2" fill="#1f2a24" stroke="#8a5a2b" stroke-width="2"/>
      <path d="M9 16h14M9 22h18M9 28h12M9 34h16" stroke="#f4f1ea" stroke-width="1" opacity=".75"/>
      <path d="M9 39h8" stroke="#f2c94c" stroke-width="1.2"/>`;
    return { svg: svg(w, h, innen, "m-kreidetafel"), w, h };
  }

  /* Ein Schornstein aus Klinker. Wer genauer hinsieht, findet unten eine
     kleine Klappe mit einem Schlüsselloch. */
  function schornstein(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 140;
    const ziegel = Array.from({ length: 14 }, (_, z) => `<path d="M4 ${16 + z * 9}H${w - 4}" stroke="#5a2a1c" stroke-width=".8"/>`
      + Array.from({ length: Math.ceil(w / 16) }, (_, i) => `<path d="M${4 + i * 16 + (z % 2 ? 8 : 0)} ${16 + z * 9}v9" stroke="#5a2a1c" stroke-width=".8"/>`).join("")).join("");
    const innen = `<rect x="3" y="${h - 5}" width="${w - 6}" height="5" fill="#000" opacity=".25"/>
      <rect x="4" y="10" width="${w - 8}" height="${h - 14}" fill="#9a4a32" stroke="#4a2418" stroke-width="1.2"/>${ziegel}
      <rect x="0" y="4" width="${w}" height="10" rx="1" fill="#6b3a28" stroke="#3a1c12" stroke-width="1"/>
      <path class="m-rauch" d="M${w / 2} 2q-6 -8 2 -14q8 -6 0 -14" fill="none" stroke="#c0c6cc" stroke-width="3" stroke-linecap="round" opacity=".35"/>
      <rect x="${w / 2 - 8}" y="${h - 30}" width="16" height="16" rx="1" fill="#3a3e44" stroke="#1d1f23" stroke-width="1"/>
      <circle cx="${w / 2}" cy="${h - 23}" r="1.6" fill="#c9a14a"/><path d="M${w / 2} ${h - 22}v3" stroke="#c9a14a" stroke-width="1"/>`;
    return { svg: svg(w, h, innen, "m-schornstein"), w, h, unten: 2 };
  }

  /* Eine alte Dachluke im Aufbau, mit Vorhängeschloss aus Messing und
     vier Zahlenrädern. Daneben Kreide. */
  function dachluke(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 96;
    const innen = `<rect x="3" y="${h - 5}" width="${w - 6}" height="5" fill="#000" opacity=".25"/>
      <path d="M2 30L${w / 2} 6L${w - 2} 30Z" fill="#4a4f57" stroke="#23262b" stroke-width="1.2"/>
      <rect x="6" y="28" width="${w - 12}" height="${h - 32}" fill="#5c646d" stroke="#23262b" stroke-width="1.2"/>
      <rect x="14" y="36" width="${w - 28}" height="${h - 46}" rx="2" fill="#3a3e44" stroke="#1d1f23" stroke-width="1"/>
      ${[0, 1, 2].map((i) => `<path d="M14 ${46 + i * 12}H${w - 14}" stroke="#2b2f36" stroke-width="1.2"/>`).join("")}
      <g transform="translate(${w / 2 - 12} ${h / 2 + 2})"><path d="M6 0V-6Q12 -12 18 -6V0" fill="none" stroke="#c0c6cc" stroke-width="2.2"/>
        <rect x="0" y="0" width="24" height="16" rx="2" fill="#c9a14a" stroke="#6e5420" stroke-width="1"/>
        ${[0, 1, 2, 3].map((i) => `<rect x="${2.4 + i * 5}" y="5" width="4" height="7" rx=".8" fill="#2a2d33"/><path d="M${3.4 + i * 5} 8.4h2" stroke="#f4f1ea" stroke-width=".7"/>`).join("")}</g>
      <path d="M${w - 12} ${h - 10}l4 -6M${w - 9} ${h - 10}l3 -4" stroke="#f4f1ea" stroke-width=".8" opacity=".7"/>`;
    return { svg: svg(w, h, innen, "m-dachluke"), w, h, unten: 2 };
  }

  /* Ein Taubenschlag auf Stelzen, mit zwei Tauben davor. */
  function taubenschlag(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 4, h = 130, mx = w / 2;
    const taube = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0q6 -6 12 0q-2 4 -8 4z" fill="#9aa3b1" stroke="#16241f" stroke-width=".5"/><circle cx="11" cy="-1" r="2.2" fill="#8c95a3"/><path d="M13 -1l2 .6-2 .6z" fill="#e2a144"/></g>`;
    const innen = `<rect x="3" y="${h - 5}" width="${w - 6}" height="5" fill="#000" opacity=".25"/>
      <path d="M12 70V${h - 4}M${w - 12} 70V${h - 4}" stroke="#5a3d27" stroke-width="4"/>
      <path d="M4 34L${mx} 10L${w - 4} 34Z" fill="#7a2230" stroke="#3a0f16" stroke-width="1"/>
      <rect x="8" y="32" width="${w - 16}" height="40" fill="#c9a46a" stroke="#6b4a2e" stroke-width="1"/>
      ${[0, 1, 2].map((i) => `<path d="M${16 + i * ((w - 32) / 2)} 60V48a6 6 0 0 1 12 0V60Z" fill="#2b1d12"/>`).join("")}
      <rect x="4" y="70" width="${w - 8}" height="4" fill="#6b4a2e"/>
      ${taube(10, 68, 0.9)}${taube(w - 26, 68)}`;
    return { svg: svg(w, h, innen, "m-taubenschlag"), w, h, unten: 2 };
  }

  /* Ein Messingfernrohr auf drei Beinen, schräg zum Himmel. */
  function teleskop() {
    const w = 60, h = 92;
    const innen = `<ellipse cx="30" cy="${h - 3}" rx="18" ry="3" fill="#000" opacity=".25"/>
      <path d="M30 56L14 ${h - 4}M30 56L46 ${h - 4}M30 56V${h - 2}" stroke="#3a2718" stroke-width="2.6" stroke-linecap="round"/>
      <g transform="rotate(-32 30 50)"><rect x="6" y="44" width="50" height="11" rx="3" fill="#c9a14a" stroke="#6e5420" stroke-width="1"/>
        <rect x="50" y="42" width="8" height="15" rx="2" fill="#e2b656" stroke="#6e5420" stroke-width="1"/>
        <rect x="2" y="46" width="6" height="7" rx="1" fill="#8e6931"/><path d="M14 46H48" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/></g>
      <circle cx="30" cy="54" r="3.4" fill="#6e5420"/>`;
    return { svg: svg(w, h, innen, "m-teleskop"), w, h };
  }

  /* Das große Fernrohr in der Sternwarte, und darauf sitzt manchmal ein Rabe. */
  function sternrohr(ding) {
    const [x1, , x2] = ding.block;
    const w = Math.round((x2 - x1) * T) + 30, h = 150, mx = w / 2;
    const innen = `<ellipse cx="${mx}" cy="${h - 4}" rx="${w / 2 - 10}" ry="5" fill="#000" opacity=".25"/>
      <path d="M${mx - 28} ${h - 6}H${mx + 28}L${mx + 16} ${h - 40}H${mx - 16}Z" fill="#3a3e44" stroke="#1d1f23" stroke-width="1.2"/>
      <circle cx="${mx}" cy="${h - 44}" r="9" fill="#6b7078" stroke="#23262b" stroke-width="1.2"/>
      <g transform="rotate(-38 ${mx} ${h - 44})"><rect x="${mx - 40}" y="${h - 56}" width="92" height="22" rx="5" fill="#c9a14a" stroke="#6e5420" stroke-width="1.2"/>
        <rect x="${mx + 46}" y="${h - 60}" width="12" height="30" rx="3" fill="#e2b656" stroke="#6e5420" stroke-width="1.2"/>
        <path d="M${mx - 30} ${h - 52}H${mx + 40}" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></g>`;
    return { svg: svg(w, h, innen, "m-sternrohr"), w, h, unten: 2 };
  }

  /* Die Ehrentafel: dunkles Holz, Goldrand, oben ein Stern. Die Namen
     selbst stehen nicht hier, sondern im Dialog: wer sie lesen will, tritt
     davor. */
  function ehrentafel() {
    const w = 96, h = 112;
    const innen = `<rect x="6" y="14" width="${w - 12}" height="${h - 22}" rx="4" fill="#2b1d12" stroke="#c9a14a" stroke-width="2.4"/>
      <path class="m-glitzer" d="M${w / 2} 2l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#f2d27a" stroke="#8e6931" stroke-width=".6"/>
      <text x="${w / 2}" y="34" text-anchor="middle" font-size="7.5" font-weight="900" letter-spacing="1.6" fill="#e2b656" font-family="ui-serif, Georgia, serif">WESERLICHT</text>
      ${Array.from({ length: 6 }, (_, i) => `<path d="M16 ${46 + i * 10}H${w - 16 - (i % 3) * 8}" stroke="#c9a14a" stroke-width="1" opacity="${0.6 - i * 0.08}"/>`).join("")}`;
    return { svg: svg(w, h, innen, "m-ehrentafel"), w, h, unten: -6 };
  }

  /* Ein vergilbtes Programmheft, aufgeschlagen auf dem Boden. */
  function programmheft() {
    const w = 34, h = 16;
    const innen = `<path d="M2 12L16 8L32 12L18 15Z" fill="#000" opacity=".2"/>
      <path d="M2 10L16 4L17 12L3 14Z" fill="#efe2c2" stroke="#a8916a" stroke-width=".6"/>
      <path d="M17 12L16 4L31 8L30 13Z" fill="#e8d8b0" stroke="#a8916a" stroke-width=".6"/>
      <path d="M5 10l8 -3M6 12l8 -3M20 9l8 2M20 11l7 2" stroke="#7a2230" stroke-width=".5"/>`;
    return { svg: svg(w, h, innen, "m-programmheft"), w, h };
  }

  /* Ein Lesepult mit einem dicken Buch, für das Logbuch der Geheimnisse. */
  function buchpult() {
    const w = 46, h = 76;
    const innen = `<ellipse cx="23" cy="${h - 3}" rx="14" ry="3" fill="#000" opacity=".22"/>
      <path d="M17 34H29L27 ${h - 4}H19Z" fill="#5a3d27" stroke="#2b1d12" stroke-width="1"/>
      <path d="M4 24L42 18L40 34L6 38Z" class="m-holz-hell" stroke="#3a2718" stroke-width="1"/>
      <path d="M8 26L22 22L23 31L9 34Z" fill="#f4efe2" stroke="#b9b3a2" stroke-width=".6"/><path d="M23 31L22 22L38 20L37 29Z" fill="#ece4d0" stroke="#b9b3a2" stroke-width=".6"/>
      <path d="M11 27l9 -2M11 30l8 -2M25 24l10 -1.4M25 27l9 -1.2" stroke="#6b5a45" stroke-width=".5"/>
      <path class="m-glitzer" d="M30 9l1.6 3.2 3.4.4-2.6 2.2.8 3.4-3.2-1.8-3.2 1.8.8-3.4-2.6-2.2 3.4-.4z" fill="#f2d27a"/>`;
    return { svg: svg(w, h, innen, "m-buchpult"), w, h };
  }

  const ARTEN = {
    slot: automat, rad, schild, spielhalle, wettschalter, roulette, blackjack, poker, sofa, couchtisch,
    sessel, hocker, zeitungsstaender, spieltisch, kisten, torbogen, arcade, neonschild, pinco, greifautomat,
    wuerfeltisch, kartentisch_hilo, sitzsack, neonhocker, jukebox, getraenkeautomat, shisha, sitzkissen, ladenfront, garagentor, litfass, planenauto, werkbank, reifenstapel, pflanze, garderobe, boerse, bank, kartentisch, schreibtisch, markt, pult, regal,
    laufschrift, podest, rekordtafel, fernseher, statistikpult, seasonbanner, auftragsbrett, kalender, vitrine,
    einlasstuer, teasertafel, gaestewand, schaetzglas,
    rennbahn, lotteriebude, fahnenmast, feuerschale, parkbank, laterne, busch, kleeblatt, tresortuer, goldstapel,
    katzenkissen, notiz, umkleide, puppen, kleiderstange, theke, taschenvitrine,
    dachbar, kreidetafel, schornstein, dachluke, taubenschlag, teleskop, sternrohr, ehrentafel, programmheft, buchpult,
    kordel, praegepresse, kleiderschrank, schneiderpuppe, naehtisch, zuschnitt, stoffregal, truhe, schminkspiegel, sammelvitrine,
  };

  /** Ein Ding als Weltrechteck: wo es steht, wie groß es ist, wie es aussieht. */
  function ding(d) {
    const f = ARTEN[d.art];
    if (!f) return null;
    const z = f(d);
    const links = Math.round(d.x * T - z.w / 2);
    const oben = Math.round(d.y * T - z.h + (z.unten || 0));
    return { ...z, links, oben };
  }

  /* Der Raum selbst: Rückwand, Boden, Seitenwände und Türen. Ein einziges
     SVG, das beim Betreten einmal gebaut wird. */
  function bodenMuster(r) {
    const id = `wb-boden-${r.id}`;
    switch (r.boden || (r.id === "casino" ? "teppich" : "dielen")) {
      case "teppich":
        return { id, defs: `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" class="wb-boden"/><path d="M24 4L44 24L24 44L4 24Z" class="wb-boden-muster"/><circle cx="24" cy="24" r="3" class="wb-boden-punkt"/><circle cx="0" cy="0" r="2" class="wb-boden-punkt"/><circle cx="48" cy="48" r="2" class="wb-boden-punkt"/><circle cx="0" cy="48" r="2" class="wb-boden-punkt"/><circle cx="48" cy="0" r="2" class="wb-boden-punkt"/></pattern>` };
      case "marmor":
        return { id, defs: `<pattern id="${id}" width="96" height="96" patternUnits="userSpaceOnUse"><rect width="96" height="96" class="wb-marmor"/><rect width="48" height="48" class="wb-marmor-dunkel"/><rect x="48" y="48" width="48" height="48" class="wb-marmor-dunkel"/><path d="M4 30q14-10 26 2t22 6M54 80q12-6 20 4t18-2" class="wb-ader"/><path d="M0 0H96V96" class="wb-fuge"/></pattern>` };
      case "wiese":
        return { id, defs: `<pattern id="${id}" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" class="wb-gras"/>${[[6, 10], [22, 30], [40, 8], [52, 44], [14, 52], [34, 58], [58, 22], [28, 18]].map(([x, y]) => `<path d="M${x} ${y}l2-5M${x + 3} ${y}l1-6M${x + 6} ${y}l-1-4" class="wb-halm"/>`).join("")}</pattern>` };
      case "pflaster":
        return { id, defs: `<pattern id="${id}" width="40" height="24" patternUnits="userSpaceOnUse"><rect width="40" height="24" class="wb-pflaster"/><path d="M0 .5H40M0 12.5H40M10 0V12M30 0V12M0 12V24M20 12V24" class="wb-pflaster-fuge"/></pattern>` };
      case "neon":
        return { id, defs: `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" class="wb-neonboden"/><path d="M0 .5H48M.5 0V48" class="wb-neonraster"/><circle cx="0" cy="0" r="1.6" class="wb-neonpunkt"/><circle cx="24" cy="24" r=".8" class="wb-neonpunkt b"/></pattern>` };
      case "fischgrat":
        /* Parkett im Fischgrät: zwei Dielen je Kachel, die eine nach links,
           die andere nach rechts geneigt, darunter dieselbe noch einmal. */
        return { id, defs: `<pattern id="${id}" width="48" height="32" patternUnits="userSpaceOnUse"><rect width="48" height="32" class="wb-fg-a"/><path d="M24 16L48 0V16L24 32Z" class="wb-fg-b"/><path d="M0 0L24 16V32M48 0L24 16M0 16L24 32L48 16" class="wb-fg-fuge"/></pattern>` };
      case "stein":
        return { id, defs: `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" class="wb-stein"/><path d="M0 24H48M24 0V24M12 24V48M36 24V48" class="wb-fuge-stein"/></pattern>` };
      default:
        return { id, defs: `<pattern id="${id}" width="96" height="24" patternUnits="userSpaceOnUse"><rect width="96" height="24" class="wb-dielen"/><path d="M0 23.5H96M60 0V24" class="wb-fuge"/></pattern>` };
    }
  }

  /* Eine Lichterkette quer über den Himmel. Kurze Zeichen sind runde
     Birnen, lange sind längliche; zwischen zwei Gruppen bleibt eine
     größere Lücke. Steht genau so in `r.lichterkette`. Absichtlich ohne
     Blinken: wer Bewegung reduziert hat, soll dasselbe sehen. */
  function lichterkette(r, W) {
    if (!r.lichterkette) return "";
    const kette = r.lichterkette.split("");
    const breite = (z) => (z === "." ? 9 : z === "-" ? 17 : z === " " ? 18 : 0);
    const gesamt = kette.reduce((n, z) => n + breite(z), 0);
    let x = Math.max(30, (W - gesamt) / 2);
    /* Ganz oben am Himmel, über Bar und Schornstein: hinge sie tiefer,
       verdeckten die Möbel davor einen Teil der Birnen. */
    const durchhang = (px) => 5 + Math.sin(((px - 10) / (W - 20)) * Math.PI) * 8;
    let birnen = "";
    for (const z of kette) {
      if (z === "." || z === "-") {
        const y = durchhang(x + 4);
        birnen += `<path d="M${(x + 4).toFixed(1)} ${(y - 3).toFixed(1)}v3" stroke="#3a3e44" stroke-width=".8"/>`
          + (z === "." ? `<circle class="wb-birne" cx="${(x + 4).toFixed(1)}" cy="${(y + 3).toFixed(1)}" r="3"/>`
            : `<rect class="wb-birne" x="${(x - 1).toFixed(1)}" y="${y.toFixed(1)}" width="13" height="6" rx="3"/>`);
      }
      x += breite(z);
    }
    return `<path d="M10 2Q${W / 2} 18 ${W - 10} 2" class="wb-kabel"/>${birnen}`;
  }

  function rueckwand(r, W, wand) {
    if (r.himmel) {
      /* Draußen: Nachthimmel über Porta, mit den Bergen an der Weser und dem
         Denkmal auf dem Wittekindsberg. */
      const sterne = Array.from({ length: 34 }, (_, i) => `<circle class="wb-stern${i % 3 ? "" : " blinkt"}" cx="${(i * 97) % W}" cy="${8 + ((i * 53) % (wand - 60))}" r="${i % 4 ? 1 : 1.6}"/>`).join("");
      const hx = W * 0.62;
      return `<defs><linearGradient id="wb-himmel-${r.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="wb-himmel-oben"/><stop offset="1" class="wb-himmel-unten"/></linearGradient></defs>
        <rect x="0" y="0" width="${W}" height="${wand}" fill="url(#wb-himmel-${r.id})"/><g class="wb-sterne">${sterne}</g>
        <g class="wb-mond-g"><circle cx="${W * 0.14}" cy="34" r="16" class="wb-mond"/><circle cx="${W * 0.14 + 6}" cy="30" r="14" fill="url(#wb-himmel-${r.id})"/></g>
        <g class="wb-sonne" style="transform-origin:${(W * 0.8).toFixed(0)}px 40px"><circle cx="${W * 0.8}" cy="40" r="30" class="wb-sonne-schein"/><circle cx="${W * 0.8}" cy="40" r="15" class="wb-sonne-kern"/></g>
        <path d="M0 ${wand - 30}Q${W * 0.2} ${wand - 70} ${W * 0.42} ${wand - 44}Q${W * 0.55} ${wand - 92} ${W * 0.72} ${wand - 70}Q${W * 0.86} ${wand - 50} ${W} ${wand - 64}V${wand}H0Z" class="wb-huegel"/>
        <g class="wb-denkmal"><rect x="${hx - 16}" y="${wand - 100}" width="32" height="12"/><rect x="${hx - 11}" y="${wand - 118}" width="22" height="18"/><path d="M${hx - 12} ${wand - 118}Q${hx} ${wand - 136} ${hx + 12} ${wand - 118}Z"/><rect x="${hx - 1.5}" y="${wand - 141}" width="3" height="7"/></g>
        <path d="M0 ${wand - 26}Q${W / 2} ${wand - 16} ${W} ${wand - 28}" fill="none" class="wb-weser"/>
        <rect x="0" y="${wand - 16}" width="${W}" height="16" class="wb-hecke"/>
        ${Array.from({ length: Math.ceil(W / 24) }, (_, i) => `<rect x="${i * 24 + 2}" y="${wand - 30}" width="4" height="26" class="wb-zaun"/>`).join("")}
        <rect x="0" y="${wand - 26}" width="${W}" height="3" class="wb-zaun"/>${lichterkette(r, W)}`;
    }
    /* Das Modehaus: Streifentapete, goldener Schriftzug, zwei gerahmte
       Modeplakate und ein Wandregal mit Schuhen und Taschen. Wo die Dinge
       stehen, steht in raeume.js; die Wand lässt ihnen den Platz. */
    if (r.wandStil === "boutique") {
      const plakat = (xt, farbe, hut) => {
        const x = xt * T;
        return `<g class="wb-plakat"><rect x="${x - 19}" y="58" width="38" height="54" class="wb-gold"/><rect x="${x - 16}" y="61" width="32" height="48" fill="#efe6d6"/>
          <circle cx="${x}" cy="74" r="4.5" fill="#2a2230"/>${hut ? `<path d="M${x - 8} 71H${x + 8}M${x - 4} 71V66H${x + 4}V71" stroke="#2a2230" stroke-width="2" fill="#2a2230"/>` : ""}
          <path d="M${x - 7} 80Q${x} 77 ${x + 7} 80L${x + 5} 90L${x + 10} 104H${x - 10}L${x - 5} 90Z" fill="${farbe}"/>
          <path d="M${x - 12} 106H${x + 12}" stroke="#2a2230" stroke-width=".8"/></g>`;
      };
      const regalX = 14.1 * T, regalB = 1.7 * T;
      const schuh = (x, y, f) => `<path d="M${x} ${y}h10q4 0 4 -3h-6l-3 -4h-5z" fill="${f}" stroke="#1d1d23" stroke-width=".6"/>`;
      const tasche = (x, y, f) => `<path d="M${x + 2} ${y - 9}q4 -6 8 0" fill="none" stroke="${f}" stroke-width="1.4"/><rect x="${x}" y="${y - 9}" width="12" height="9" rx="1.5" fill="${f}" stroke="#1d1d23" stroke-width=".6"/>`;
      const streifen = Array.from({ length: Math.ceil(W / 24) }, (_, i) => `<rect x="${i * 24}" y="16" width="11" height="${wand - 62}" class="wb-boutique-streifen"/>`).join("");
      return `<rect x="0" y="0" width="${W}" height="${wand}" class="wb-boutique-wand"/>${streifen}
        <rect x="0" y="0" width="${W}" height="10" class="wb-gold"/>
        <rect x="0" y="10" width="${W}" height="6" class="wb-wand-dunkel"/>
        <path d="M${W / 2 - 150} 34H${W / 2 - 112}M${W / 2 + 112} 34H${W / 2 + 150}" class="wb-boutique-linie"/>
        <text x="${W / 2}" y="43" text-anchor="middle" class="wb-boutique-schrift">MODEHAUS</text>
        ${plakat(6.0, "#c8243a", false)}${plakat(10.35, "#2b3a55", true)}
        <g class="wb-wandregal">
          <rect x="${regalX}" y="58" width="${regalB}" height="4" class="wb-gold"/><rect x="${regalX}" y="92" width="${regalB}" height="4" class="wb-gold"/>
          ${schuh(regalX + 6, 58, "#f4f1ea")}${schuh(regalX + 26, 58, "#c8243a")}${schuh(regalX + 50, 58, "#2a2f38")}
          ${tasche(regalX + 8, 92, "#e2b656")}${tasche(regalX + 30, 92, "#8d5bd6")}${tasche(regalX + 52, 92, "#3f9a5a")}
        </g>
        <g class="wb-leuchte"><ellipse cx="${0.65 * T}" cy="${wand - 92}" rx="22" ry="30" class="wb-lichtkegel"/><path d="M${0.65 * T - 7} ${wand - 108}h14l-3 11h-8z" class="wb-gold"/></g>
        <rect x="0" y="${wand - 46}" width="${W}" height="2" class="wb-gold"/>
        <rect x="0" y="${wand - 44}" width="${W}" height="32" class="wb-boutique-sockel"/>
        <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-sockel"/>`;
    }
    /* Das Atelier: helle Ziegel, ein Schriftzug aus Draht, eine Lochwand
       mit Scheren und Garn, und Stoffproben an einer Leine. */
    if (r.wandStil === "atelier") {
      const ziegel = Array.from({ length: Math.ceil(wand / 16) }, (_, z) => `<path d="M0 ${z * 16}H${W}" class="wb-atelier-fuge"/>` + Array.from({ length: Math.ceil(W / 36) }, (_, i) => `<path d="M${i * 36 + (z % 2 ? 18 : 0)} ${z * 16}v16" class="wb-atelier-fuge"/>`).join("")).join("");
      const proben = Array.from({ length: 9 }, (_, i) => { const x = 4.6 * T + i * 26; const f = ["#c8243a", "#2b3a55", "#e2b656", "#3f9a5a", "#c86bd6", "#f4f1ea", "#e8812b", "#7ec8e3", "#f06a8a"][i]; return `<path d="M${x} ${62 + (i % 2) * 3}v-4" stroke="#8a5a2b" stroke-width="1"/><path d="M${x - 8} ${63 + (i % 2) * 3}h16v20l-4-3-4 3-4-3-4 3z" fill="${f}" stroke="#1d1d23" stroke-width=".5"/>`; }).join("");
      const lochX = 8.6 * T, lochB = 1.5 * T;
      return `<rect x="0" y="0" width="${W}" height="${wand}" class="wb-atelier-wand"/>${ziegel}
        <rect x="0" y="0" width="${W}" height="8" class="wb-wand-dunkel"/>
        <text x="${W / 2}" y="40" text-anchor="middle" class="wb-atelier-schrift">Atelier</text>
        <path d="M${4.2 * T} 58Q${6.6 * T} 64 ${9.0 * T} 58" fill="none" stroke="#8a5a2b" stroke-width="1"/>${proben}
        <g class="wb-lochwand"><rect x="${lochX}" y="54" width="${lochB}" height="56" rx="2" fill="#c9a46a" stroke="#8a5a2b"/>
          ${Array.from({ length: 24 }, (_, i) => `<circle cx="${lochX + 7 + (i % 8) * 8.6}" cy="${60 + Math.floor(i / 8) * 16}" r="1" fill="#8a5a2b"/>`).join("")}
          <g transform="translate(${lochX + 12} 70) rotate(40)"><circle cx="0" cy="6" r="3" fill="none" stroke="#3f6fd0" stroke-width="1.6"/><circle cx="7" cy="6" r="3" fill="none" stroke="#3f6fd0" stroke-width="1.6"/><path d="M2 4L18 0M5 4L18 2" stroke="#c0c6cc" stroke-width="1.6"/></g>
          ${[["#c8243a", 40], ["#e2b656", 50], ["#3f9a5a", 60]].map(([c, x]) => `<rect x="${lochX + x}" y="84" width="6" height="10" rx="1" fill="${c}" stroke="#1d1d23" stroke-width=".5"/>`).join("")}
          <path d="M${lochX + 12} 96q14 8 40 0" fill="none" stroke="#f2d24a" stroke-width="2"/></g>
        <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-sockel"/>`;
    }
    /* Die Sternwarte: dunkelblaue Kuppel mit einem offenen Spalt, durch den
       man den Himmel sieht, und eine Sternkarte an der Wand. */
    if (r.wandStil === "sternwarte") {
      const sterne = Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 71) % W}" cy="${8 + ((i * 37) % (wand - 40))}" r="${i % 5 ? 0.9 : 1.6}" class="wb-stern${i % 4 ? "" : " blinkt"}"/>`).join("");
      const orion = [[0.18, 0.28], [0.3, 0.26], [0.22, 0.5], [0.24, 0.52], [0.26, 0.54], [0.17, 0.78], [0.31, 0.76]];
      const kx = W * 0.05, ky = 20, kb = W * 0.13, kh = wand - 50;
      const p = orion.map(([a, b]) => [kx + a * kb * 2, ky + b * kh]);
      return `<rect x="0" y="0" width="${W}" height="${wand}" class="wb-sternwarte-wand"/>${sterne}
        <path d="M${W * 0.36} 0H${W * 0.52}V${wand - 30}H${W * 0.36}Z" class="wb-kuppelspalt"/>
        <rect x="${kx - 6}" y="${ky - 6}" width="${kb + 12}" height="${kh + 12}" rx="3" class="wb-sternkarte"/>
        <path d="M${p[0][0]} ${p[0][1]}L${p[2][0]} ${p[2][1]}L${p[3][0]} ${p[3][1]}L${p[4][0]} ${p[4][1]}L${p[1][0]} ${p[1][1]}M${p[2][0]} ${p[2][1]}L${p[5][0]} ${p[5][1]}M${p[4][0]} ${p[4][1]}L${p[6][0]} ${p[6][1]}" class="wb-sternbild"/>
        ${p.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 3 : 2}" class="${i === 0 ? "wb-sternbild-rot" : "wb-sternbild-punkt"}"/>`).join("")}
        <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-sockel"/>`;
    }
    /* Der Fundus: dunkle Bretter, ein schräger Dachbalken und Spinnweben in
       den Ecken. Licht kommt nur vom Schminkspiegel. */
    if (r.wandStil === "fundus") {
      const bretter = Array.from({ length: Math.ceil(W / 30) }, (_, i) => `<rect x="${i * 30}" y="0" width="29" height="${wand}" class="${i % 2 ? "wb-fundus-brett" : "wb-fundus-brett b"}"/>`).join("");
      const netz = (x, s) => `<path d="M${x} 0L${x + s * 34} 0M${x} 0L${x} 34M${x} 0L${x + s * 26} 26M${x + s * 12} 0Q${x + s * 10} 10 ${x} 12M${x + s * 24} 0Q${x + s * 20} 20 ${x} 24" class="wb-spinnweben"/>`;
      return `${bretter}
        <path d="M0 ${wand * 0.55}L${W} ${wand * 0.18}" class="wb-fundus-balken"/>
        ${netz(0, 1)}${netz(W, -1)}
        <ellipse cx="${W / 2}" cy="${wand - 40}" rx="${W * 0.22}" ry="50" class="wb-fundus-licht"/>
        <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-sockel"/>`;
    }
    /* Die Spielhalle: dunkle Wand mit Leuchtröhren statt Gold und Lampen. */
    if (r.neon) {
      return `<rect x="0" y="0" width="${W}" height="${wand}" class="wb-neonwand"/>
        ${Array.from({ length: Math.ceil(W / 60) }, (_, i) => `<rect x="${i * 60 + 6}" y="22" width="48" height="${wand - 46}" rx="4" class="wb-neonpaneel"/>`).join("")}
        <path class="m-neonroehre" d="M0 14H${W}" stroke="#ff4fd8" stroke-width="3"/>
        <path class="m-neonroehre m-neon-b" d="M0 ${wand - 18}H${W}" stroke="#2ad4ff" stroke-width="2.4"/>
        <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-neonsockel"/>`;
    }
    const stein = r.boden === "stein";
    const paneele = stein ? "" : Array.from({ length: Math.floor(r.w / 2) }, (_, i) => `<rect x="${i * 2 * T + 10}" y="${wand - 58}" width="${2 * T - 20}" height="44" rx="3" class="wb-paneel"/>`).join("");
    /* Keine Leuchte hinter einer Tafel, einem Fernseher oder einem hohen
       Möbel an der Wand: dort sah sie aus, als klebe sie am Bildschirm. */
    const verdeckt = (x) => r.dinge.some((d) => {
      const z = ding(d);
      return z && z.oben < wand - 40 && x > z.links - 34 && x < z.links + z.w + 34;
    });
    const leuchten = Array.from({ length: Math.floor(r.w / 4) }, (_, i) => {
      /* Lieber ein Stück zur Seite rücken als ganz weglassen. */
      const x = [0, -24, 24, -48, 48, -72, 72].map((d) => (i * 4 + 2) * T + d).find((k) => k > 20 && k < W - 20 && !verdeckt(k));
      if (x == null) return "";
      return `<g class="wb-leuchte"><ellipse cx="${x}" cy="${wand - 92}" rx="30" ry="36" class="wb-lichtkegel"/><path d="M${x - 8} ${wand - 110}h16l-3 12h-10z" class="wb-gold"/></g>`;
    }).join("");
    const ziegel = stein ? Array.from({ length: Math.ceil(wand / 18) }, (_, z) => `<path d="M0 ${z * 18}H${W}" class="wb-fuge-stein"/>` + Array.from({ length: Math.ceil(W / 40) }, (_, i) => `<path d="M${i * 40 + (z % 2 ? 20 : 0)} ${z * 18}v18" class="wb-fuge-stein"/>`).join("")).join("") : "";
    return `<rect x="0" y="0" width="${W}" height="${wand}" class="${stein ? "wb-stein-wand" : "wb-wand"}"/>${ziegel}
      <rect x="0" y="0" width="${W}" height="10" class="wb-gold"/>
      <rect x="0" y="10" width="${W}" height="6" class="wb-wand-dunkel"/>
      ${stein ? "" : leuchten}${paneele}
      <rect x="0" y="${wand - 12}" width="${W}" height="12" class="wb-sockel"/>`;
  }

  function tuerSeite(r, t) {
    if (t.x2 <= 0.5) return "links";
    if (t.x1 >= r.w - 0.5) return "rechts";
    if (t.y1 >= r.h - 0.5) return "unten";
    return "oben";
  }

  function raum(r) {
    const W = r.w * T, H = r.h * T, wand = r.wand * T;
    const muster = bodenMuster(r);
    const tueren = r.tueren.filter((t) => !t.versteckt).map((t) => {
      const seite = tuerSeite(r, t);
      // Eine Tür in der Rückwand zeichnet ihr Ding selbst (der Torbogen).
      if (seite === "oben") return "";
      if (seite === "unten" && t.stil === "boutique") {
        /* Der Eingang zum Modehaus: ein roter Läufer bis in die Lounge,
           ein Rahmen in Roségold und ein warmer Schein auf dem Boden. Die
           Kordeln daneben sind eigene Dinge (raeume.js). */
        const x1 = t.x1 * T, x2 = t.x2 * T, lang = 1.7 * T;
        return `<rect x="${x1 + 6}" y="${H - 14 - lang}" width="${x2 - x1 - 12}" height="${lang + 14}" class="wb-roter-teppich"/>
          <path d="M${x1 + 10} ${H - 14 - lang}V${H}M${x2 - 10} ${H - 14 - lang}V${H}" class="wb-laeufer-kante"/>
          <ellipse cx="${(x1 + x2) / 2}" cy="${H - 20}" rx="${(x2 - x1) / 2 + 14}" ry="26" class="wb-boutique-schein"/>
          <rect x="${x1 - 4}" y="${H - 14}" width="${x2 - x1 + 8}" height="14" class="wb-tuer"/>
          <rect x="${x1 - 10}" y="${H - 22}" width="6" height="22" rx="1" class="wb-rosegold"/><rect x="${x2 + 4}" y="${H - 22}" width="6" height="22" rx="1" class="wb-rosegold"/>
          <circle cx="${x1 - 7}" cy="${H - 24}" r="4" class="wb-rosegold"/><circle cx="${x2 + 7}" cy="${H - 24}" r="4" class="wb-rosegold"/>
          <rect x="${x1 + 4}" y="${H - 56}" width="${x2 - x1 - 8}" height="42" class="wb-tuer-licht wb-tuer-licht-boutique"/>`;
      }
      if (seite === "unten") {
        const x1 = t.x1 * T, x2 = t.x2 * T;
        return `<rect x="${x1 - 4}" y="${H - 14}" width="${x2 - x1 + 8}" height="14" class="wb-tuer"/>
          <rect x="${x1 - 8}" y="${H - 18}" width="4" height="18" class="wb-gold"/><rect x="${x2 + 4}" y="${H - 18}" width="4" height="18" class="wb-gold"/>
          <rect x="${x1 + 4}" y="${H - 56}" width="${x2 - x1 - 8}" height="42" class="wb-tuer-licht"/>`;
      }
      const rechts = seite === "rechts";
      const y1 = t.y1 * T, y2 = t.y2 * T;
      const x = rechts ? W - 14 : 0;
      return `<rect x="${x}" y="${y1 - 4}" width="14" height="${y2 - y1 + 8}" class="wb-tuer"/>
        <rect x="${rechts ? W - 18 : 14}" y="${y1 - 8}" width="4" height="${y2 - y1 + 16}" class="wb-gold"/>
        <rect x="${rechts ? W - 56 : 14}" y="${y1 + 4}" width="42" height="${y2 - y1 - 8}" class="wb-tuer-licht"/>`;
    }).join("");
    const extras = {
      casino: `<rect x="${2.1 * T}" y="${6.8 * T}" width="${2.6 * T}" height="${3 * T}" rx="18" class="wb-teppich-lounge"/><rect x="${2.1 * T + 6}" y="${6.8 * T + 6}" width="${2.6 * T - 12}" height="${3 * T - 12}" rx="14" class="wb-teppich-rand"/>
        <rect x="${8.6 * T}" y="${11.4 * T}" width="${2.8 * T}" height="${1.2 * T}" rx="10" class="wb-matte"/><text x="${10 * T}" y="${12.15 * T}" text-anchor="middle" class="wb-matte-text">WILLKOMMEN</text>`,
      /* Ein Laufsteg von der Tür bis zu den Puppen, mit Lichtern an beiden
         Kanten, und ein runder Teppich vor dem Sofa. */
      modehaus: `<rect x="${7.0 * T}" y="${5.0 * T}" width="${2.0 * T}" height="${6.0 * T}" class="wb-laufsteg"/>
        <path d="M${7.0 * T + 3} ${5.0 * T}V${11 * T}M${9.0 * T - 3} ${5.0 * T}V${11 * T}" class="wb-laufsteg-kante"/>
        ${Array.from({ length: 10 }, (_, i) => { const y = (5.35 + i * 0.58) * T; return `<circle cx="${7.0 * T + 9}" cy="${y}" r="2.6" class="wb-laufsteg-licht"/><circle cx="${9.0 * T - 9}" cy="${y}" r="2.6" class="wb-laufsteg-licht"/>`; }).join("")}
        <ellipse cx="${3.3 * T}" cy="${8.15 * T}" rx="${1.55 * T}" ry="${1.35 * T}" class="wb-boutique-teppich"/>
        <ellipse cx="${3.3 * T}" cy="${8.15 * T}" rx="${1.55 * T - 8}" ry="${1.35 * T - 8}" class="wb-teppich-rand"/>`,
      kontor: `<rect x="${4.8 * T}" y="${5.2 * T}" width="${6.4 * T}" height="${3.8 * T}" rx="16" class="wb-teppich-lounge"/><rect x="${4.8 * T + 7}" y="${5.2 * T + 7}" width="${6.4 * T - 14}" height="${3.8 * T - 14}" rx="12" class="wb-teppich-rand"/>`,
      ruhm: `<rect x="${5.6 * T}" y="${5.2 * T}" width="${2.8 * T}" height="${5.3 * T}" class="wb-roter-teppich"/><rect x="${5.6 * T + 6}" y="${5.2 * T}" width="${2.8 * T - 12}" height="${5.3 * T}" class="wb-teppich-rand"/><rect x="${8.4 * T}" y="${5.1 * T}" width="${5.6 * T}" height="${1.1 * T}" class="wb-roter-teppich"/>`,
      hof: `<path d="M0 ${6.1 * T}H${4 * T}Q${6 * T} ${6.1 * T} ${7 * T} ${7.8 * T}T${9 * T} ${9 * T}" fill="none" stroke-width="${1.1 * T}" class="wb-weg"/><circle cx="${8.1 * T}" cy="${6.6 * T}" r="${1.4 * T}" class="wb-weg-platz"/>
        <ellipse cx="${11.6 * T}" cy="${7.9 * T}" rx="${1.5 * T}" ry="${1.15 * T}" class="wb-teppich-shisha"/><ellipse cx="${11.6 * T}" cy="${7.9 * T}" rx="${1.3 * T}" ry="${0.98 * T}" class="wb-teppich-shisha-rand"/>`,
      tresor: "",
      /* Im Atelier ein Webteppich unter der Puppe und Kreidestriche auf
         den Dielen, wo jemand einen Schnitt angezeichnet hat. */
      atelier: `<ellipse cx="${8.6 * T}" cy="${6.6 * T}" rx="${1.6 * T}" ry="${1.1 * T}" class="wb-atelier-teppich"/>
        <ellipse cx="${8.6 * T}" cy="${6.6 * T}" rx="${1.6 * T - 7}" ry="${1.1 * T - 7}" class="wb-teppich-rand"/>
        <path d="M${10 * T} ${8.9 * T}l40 -6l30 10M${10.4 * T} ${9.1 * T}h70" class="wb-kreide"/>`,
      fundus: `<ellipse cx="${5 * T}" cy="${4.2 * T}" rx="${2.4 * T}" ry="${0.9 * T}" class="wb-fundus-licht"/>
        <path d="M${1.4 * T} ${6.4 * T}q20 -6 40 0M${7.6 * T} ${6.8 * T}q14 -4 30 2" class="wb-staub"/>`,
      /* Die Spielhalle: eine Tanzfläche aus Leuchtkacheln in der Mitte und
         ein Lichtband von der Tür dorthin. */
      spielhalle: `<rect x="${7.35 * T}" y="${8.4 * T}" width="${1.3 * T}" height="${2.6 * T}" class="wb-lichtband"/>
        ${Array.from({ length: 20 }, (_, i) => `<rect x="${(5.9 + (i % 5) * 0.84) * T}" y="${(4.7 + Math.floor(i / 5) * 0.84) * T}" width="${0.78 * T}" height="${0.78 * T}" rx="4" class="wb-tanzkachel k${(i % 5 + 3 * Math.floor(i / 5)) % 4}"/>`).join("")}`,
    }[r.id] || "";
    return `<svg class="welt-hintergrund" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">
      <defs>${muster.defs}</defs>
      ${rueckwand(r, W, wand)}
      <rect x="0" y="${wand}" width="${W}" height="${H - wand}" fill="url(#${muster.id})"/>
      <rect x="0" y="${wand}" width="${W}" height="18" class="wb-wandschatten"/>
      ${extras}
      <rect x="0" y="${wand}" width="14" height="${H - wand}" class="${r.himmel ? "wb-hecke" : "wb-seitenwand"}"/>
      <rect x="${W - 14}" y="${wand}" width="14" height="${H - wand}" class="${r.himmel ? "wb-hecke" : "wb-seitenwand"}"/>
      <rect x="0" y="${H - 14}" width="${W}" height="14" class="${r.himmel ? "wb-hecke" : "wb-vorderkante"}"/>
      ${tueren}
    </svg>`;
  }

  Casino.weltMoebel = { ding, raum, KACHEL: T, TABLEAU };
})();
