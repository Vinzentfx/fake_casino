"use strict";

/**
 * Weitere fertige Klänge, alle synthetisch, keine Audiodateien.
 *
 * core/sound.js hält die Grundausstattung der Spiele (Chip, Gewinn, Karte).
 * Hier kommt dazu, was die Welt und die bisher stummen Spiele brauchen:
 * Fahrzeuge, Vapes und Getränke, Tiere, Türen, Würfel, Pferde. Gerufen wird
 * alles über `Casino.sound.play(name)`, mit `{ laut, pan }` aus der Welt.
 *
 * Jeder Klang legt seine Knoten synchron an, die Zeitpunkte laufen über die
 * Uhr des AudioContext. Nur so landet ein Klang aus der Welt geschlossen im
 * Regler für Abstand und Richtung, den play() für ihn dazwischenhängt.
 */
(function () {
  const S = window.Casino && window.Casino.sound;
  if (!S || !S.def) return;
  const { tone, noise, rauschen } = S;
  const zufall = (a, b) => a + Math.random() * (b - a);

  /** Ein Oszillator mit Vibrato und Filter, für Hupen, Tröte und Tiere. */
  function osz(freq, dur, o = {}) {
    const c = S._kontext();
    if (!c) return;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    osc.type = o.welle || "sawtooth";
    osc.frequency.setValueAtTime(freq, t);
    if (o.ueber) for (const [f, k] of o.ueber) osc.frequency.linearRampToValueAtTime(f, t + dur * k);
    else if (o.bis) osc.frequency.exponentialRampToValueAtTime(o.bis, t + dur);
    if (o.vibrato) {
      const lfo = c.createOscillator();
      const tiefe = c.createGain();
      lfo.frequency.value = o.vibrato[0];
      tiefe.gain.value = o.vibrato[1];
      lfo.connect(tiefe).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    let kette = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter[0];
      f.frequency.value = o.filter[1];
      f.Q.value = o.filter[2] == null ? 1 : o.filter[2];
      kette = kette.connect(f);
    }
    const g = c.createGain();
    const gain = Math.max(0.0002, o.gain || 0.04);
    const an = o.an || 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + an);
    g.gain.setValueAtTime(gain, t + Math.max(an, dur - (o.ab || 0.06)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    kette.connect(g).connect(S._aus());
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  const klack = (delay = 0, freq = 1800, gain = 0.05) => {
    noise(0.03, gain, delay, freq, 4);
    tone(freq / 2, 0.04, "triangle", gain * 0.5, delay);
  };

  const K = {
    /* Welt */
    tuer: () => {
      rauschen(0.45, 0.03, 0, { freq: 500, bis: 1800, q: 0.7, an: 0.15 });
      klack(0.36, 1400, 0.03);
    },
    geheimnis: () => {
      [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.35, "triangle", 0.035, i * 0.07));
      tone(2637, 1.1, "sine", 0.02, 0.4);
      rauschen(1.2, 0.012, 0.3, { typ: "highpass", freq: 6000, q: 0.5, an: 0.3 });
    },
    marke: () => { tone(988, 0.08, "square", 0.025); tone(1319, 0.28, "square", 0.025, 0.07); tone(2637, 0.3, "sine", 0.015, 0.1); },
    explosion: () => {
      tone(110, 0.8, "sine", 0.14, 0, 32);
      rauschen(1.4, 0.13, 0, { typ: "lowpass", freq: 2400, bis: 90, q: 0.4, an: 0.004 });
      for (let i = 0; i < 6; i++) noise(0.03, 0.03, 0.25 + Math.random() * 0.7, zufall(1500, 4000), 3);
    },
    aufsteigen: () => tone(150, 0.09, "sine", 0.05, 0, 90),
    jukebox: () => {
      klack(0, 2400, 0.04);
      tone(1200, 0.06, "triangle", 0.02, 0.12);
      rauschen(0.5, 0.03, 0.2, { freq: 3000, bis: 400, q: 2, an: 0.05 });
    },
    tanz: () => { tone(60, 0.12, "sine", 0.06, 0, 40); noise(0.03, 0.02, 0.25, 8000, 1); },

    /* Fahrzeuge. Jede Hupe klingt nach dem, was sie ist. */
    hupe_auto: () => {
      for (const d of [0, 0.42]) {
        osz(392, 0.3, { welle: "square", gain: 0.025, delay: d, filter: ["lowpass", 1800] });
        osz(494, 0.3, { welle: "square", gain: 0.025, delay: d, filter: ["lowpass", 1800] });
      }
    },
    hupe_gold: () => {
      [440, 554, 659].forEach((f) => osz(f, 1.1, { welle: "sawtooth", gain: 0.02, filter: ["lowpass", 2200], vibrato: [5, 4], an: 0.05 }));
    },
    hupe_simme: () => {
      osz(330, 1.2, { welle: "sawtooth", gain: 0.03, filter: ["bandpass", 900, 2], ueber: [[318, 1]] });
      osz(415, 1.2, { welle: "square", gain: 0.015, filter: ["lowpass", 1400] });
    },
    klingel: () => {
      for (const d of [0, 0.2]) {
        tone(2350, 0.6, "sine", 0.04, d);
        tone(3530, 0.4, "sine", 0.018, d);
        tone(5100, 0.2, "sine", 0.008, d);
      }
    },
    hupe_bobby: () => {
      for (const d of [0, 0.24]) {
        osz(620, 0.16, { welle: "triangle", gain: 0.04, delay: d, bis: 520 });
        rauschen(0.12, 0.015, d, { freq: 1800, q: 1 });
      }
    },
    hupe_maeher: () => {
      for (const d of [0, 0.5]) osz(55, 0.42, { welle: "sawtooth", gain: 0.05, delay: d, ueber: [[95, 0.4], [70, 1]], filter: ["lowpass", 500] });
    },
    // Zweitakter: erst der Tritt, dann immer schneller werdendes Knattern.
    ankicken: () => {
      klack(0, 600, 0.05);
      let t = 0.35;
      for (let i = 0; i < 30; i++) {
        const abstand = Math.max(0.045, 0.13 - i * 0.006);
        tone(70 + i, 0.05, "square", 0.025, t);
        noise(0.04, 0.035, t, 500, 1.2);
        t += abstand;
      }
    },
    // Der E46 orgelt und springt nicht an.
    anlassen_fehl: () => {
      for (let i = 0; i < 9; i++) {
        const t = i * 0.13;
        osz(95 - i * 2, 0.11, { welle: "sawtooth", gain: 0.035, delay: t, filter: ["lowpass", 700], an: 0.02 });
        noise(0.06, 0.02, t, 300, 1);
      }
      rauschen(0.3, 0.06, 1.3, { typ: "lowpass", freq: 600, q: 0.6, an: 0.01 });
      rauschen(1.0, 0.025, 1.6, { typ: "highpass", freq: 2000, q: 0.4, an: 0.1 });
    },
    motor_an: () => {
      osz(60, 0.9, { welle: "sawtooth", gain: 0.045, ueber: [[140, 0.35], [85, 1]], filter: ["lowpass", 900] });
      rauschen(0.9, 0.02, 0, { typ: "lowpass", freq: 400, q: 0.5 });
    },
    elektro_an: () => osz(300, 0.6, { welle: "sine", gain: 0.03, bis: 1100 }),
    rollen: () => rauschen(0.5, 0.03, 0, { typ: "lowpass", freq: 350, q: 0.5, an: 0.1 }),
    schweben: () => { osz(180, 0.8, { welle: "sine", gain: 0.03, bis: 260, vibrato: [7, 6] }); rauschen(0.8, 0.012, 0, { freq: 3000, q: 0.5, an: 0.2 }); },
    // Kickflip: Pop, das Brett zischt durch die Drehung, Landung mit Rollen.
    kickflip: () => {
      klack(0.12, 2000, 0.06);
      rauschen(0.3, 0.02, 0.22, { freq: 3200, bis: 1200, q: 1.5, an: 0.08 });
      klack(0.76, 1500, 0.06);
      klack(0.8, 1300, 0.04);
      rauschen(0.5, 0.03, 0.8, { typ: "lowpass", freq: 320, q: 0.5, an: 0.02 });
    },

    // Wheelie: Motor dreht hoch, das Vorderrad steht, dann setzt es mit einem Klack auf.
    wheelie: () => {
      osz(380, 0.5, { welle: "sawtooth", gain: 0.022, bis: 1300, filter: ["lowpass", 2600] });
      osz(1300, 1.6, { welle: "sine", gain: 0.018, delay: 0.45, vibrato: [5, 40] });
      rauschen(0.3, 0.025, 0.05, { freq: 2500, bis: 900, q: 2, an: 0.03 });
      klack(2.3, 900, 0.06);
      rauschen(0.4, 0.03, 2.3, { typ: "lowpass", freq: 300, q: 0.5 });
    },
    wheelie_simme: () => {
      for (let i = 0; i < 26; i++) { const t = i * 0.075; tone(80 + Math.min(i, 8) * 9, 0.05, "square", 0.025, t); noise(0.035, 0.03, t, 520, 1.2); }
      klack(2.3, 800, 0.07);
    },

    /* Gesten mit Stücken */
    dampfen: () => {
      rauschen(0.9, 0.018, 0, { typ: "highpass", freq: 3500, q: 0.3, an: 0.35 });
      for (let i = 0; i < 6; i++) noise(0.01, 0.012, 0.15 + Math.random() * 0.6, 5000, 3);
      rauschen(1.3, 0.035, 0.95, { freq: 900, bis: 350, q: 0.6, an: 0.08 });
    },
    shisha: () => {
      for (let i = 0; i < 16; i++) osz(zufall(160, 320), 0.07, { welle: "sine", gain: 0.03, delay: 0.05 + i * 0.07 + Math.random() * 0.03, bis: zufall(380, 600) });
      rauschen(1.4, 0.035, 1.4, { freq: 800, bis: 300, q: 0.6, an: 0.1 });
    },
    schlecken: () => { for (const d of [0.45, 0.8]) rauschen(0.14, 0.03, d, { freq: 2600, bis: 1100, q: 2, an: 0.02 }); },
    schluerfen: () => {
      rauschen(0.6, 0.04, 0.45, { freq: 600, bis: 2400, q: 3, an: 0.1 });
      tone(190, 0.1, "sine", 0.05, 1.12, 120);
    },
    selfie: () => {
      tone(1800, 0.06, "square", 0.015, 0.4);
      noise(0.025, 0.06, 0.6, 3000, 1);
      noise(0.03, 0.05, 0.66, 1800, 1);
    },
    geldregen: () => {
      for (let i = 0; i < 10; i++) {
        const d = 0.35 + i * 0.06 + Math.random() * 0.04;
        tone(zufall(2400, 4200), 0.12, "sine", 0.025, d);
        tone(zufall(5000, 6500), 0.06, "triangle", 0.01, d);
      }
    },
    jubeln: () => {
      [523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.03, i * 0.08));
      for (let i = 0; i < 4; i++) noise(0.04, 0.04, 0.3 + i * 0.16, 1500, 0.8);
    },
    winken: () => rauschen(0.25, 0.012, 0, { freq: 1200, bis: 2400, q: 0.8, an: 0.08 }),
    troete: () => {
      osz(520, 0.9, { welle: "sawtooth", gain: 0.03, filter: ["bandpass", 1200, 1.5], vibrato: [11, 25], ueber: [[560, 0.2], [500, 1]], an: 0.04 });
      rauschen(0.9, 0.01, 0, { freq: 2000, q: 1 });
    },
    abgehen: () => {
      // Aus dem Kopfhörer: dünn und blechern, ein paar Takte.
      for (let i = 0; i < 8; i++) {
        const t = i * 0.25;
        if (i % 2 === 0) osz(110, 0.09, { welle: "sine", gain: 0.03, delay: t, bis: 50 });
        else noise(0.03, 0.02, t, 7000, 1);
        if (i % 4 === 2) noise(0.06, 0.018, t, 1800, 1);
      }
    },
    flattern: () => { for (let i = 0; i < 5; i++) rauschen(0.18, 0.04, 0.2 + i * 0.32, { typ: "lowpass", freq: 700, q: 0.7, an: 0.05 }); },
    kunststueck: () => {
      tone(523, 0.14, "triangle", 0.035, 0.3);
      tone(784, 0.3, "triangle", 0.035, 0.45);
      tone(2093, 0.4, "sine", 0.012, 0.6);
    },

    // Das Königliche Gummihuhn: ein langes, kehliges Quietschen mit Luft.
    gummihuhn: () => {
      osz(700, 0.95, { welle: "sawtooth", gain: 0.045, ueber: [[1250, 0.15], [1050, 0.45], [1350, 0.7], [600, 1]], filter: ["bandpass", 1500, 1.6], vibrato: [17, 60], an: 0.03, ab: 0.2 });
      osz(1400, 0.95, { welle: "square", gain: 0.012, ueber: [[2500, 0.15], [2100, 0.45], [2700, 0.7], [1200, 1]], filter: ["bandpass", 2600, 3], vibrato: [17, 90], an: 0.03 });
      rauschen(1.0, 0.025, 0, { freq: 3000, q: 1.2, an: 0.05 });
    },
    ruelpsen: () => {
      osz(95, 0.65, { welle: "sawtooth", gain: 0.07, ueber: [[120, 0.2], [80, 1]], filter: ["bandpass", 420, 2.5], vibrato: [28, 18], an: 0.04 });
      rauschen(0.6, 0.02, 0, { typ: "lowpass", freq: 600, q: 0.7 });
    },
    zap: () => { for (let i = 0; i < 4; i++) osz(zufall(900, 1800), 0.08, { welle: "square", gain: 0.02, delay: i * 0.07, bis: zufall(3000, 5000), filter: ["highpass", 800] }); },

    /* Greifautomat */
    greifer_fahrt: () => osz(150, 0.35, { welle: "sawtooth", gain: 0.015, filter: ["lowpass", 700], vibrato: [40, 8] }),
    greifer_runter: () => osz(180, 0.9, { welle: "sawtooth", gain: 0.016, bis: 110, filter: ["lowpass", 600], vibrato: [40, 6] }),
    greifer_zu: () => { klack(0, 1600, 0.05); klack(0.05, 1200, 0.03); },
    greifer_rutscht: () => { rauschen(0.18, 0.03, 0, { freq: 2600, bis: 900, q: 2 }); tone(500, 0.25, "triangle", 0.025, 0.02, 220); },
    plumps: () => { tone(130, 0.14, "sine", 0.06, 0, 70); noise(0.05, 0.03, 0, 500, 1); },

    /* Tiere */
    tier_dackel: () => {
      for (const d of [0, 0.28]) {
        osz(420, 0.13, { welle: "sawtooth", gain: 0.04, delay: d, bis: 190, filter: ["bandpass", 900, 1.2] });
        rauschen(0.1, 0.02, d, { freq: 1200, q: 1 });
      }
    },
    tier_tresorkatze: () => osz(600, 0.55, { welle: "triangle", gain: 0.04, ueber: [[920, 0.35], [520, 1]], filter: ["lowpass", 2400], vibrato: [6, 8], an: 0.04 }),
    tier_fauchen: () => rauschen(0.6, 0.04, 0, { typ: "highpass", freq: 2600, q: 0.4, an: 0.03 }),
    tier_frosch: () => { for (const d of [0, 0.18]) osz(280, 0.12, { welle: "square", gain: 0.03, delay: d, bis: 140, filter: ["bandpass", 700, 3] }); },
    tier_gluecksschwein: () => { for (const d of [0, 0.22]) { osz(320, 0.16, { welle: "sawtooth", gain: 0.035, delay: d, bis: 210, filter: ["lowpass", 1100] }); rauschen(0.15, 0.015, d, { typ: "lowpass", freq: 500 }); } },
    tier_taube: () => { [320, 300, 340].forEach((f, i) => osz(f, 0.12, { welle: "sine", gain: 0.035, delay: i * 0.12, vibrato: [22, 18] })); },
    tier_hamster: () => { for (const d of [0, 0.1]) osz(2200, 0.06, { welle: "sine", gain: 0.03, delay: d, bis: 2800 }); },
    tier_waschbaer: () => { for (const d of [0, 0.14]) osz(1500, 0.09, { welle: "triangle", gain: 0.03, delay: d, bis: 2100 }); },
    tier_minidrache: () => {
      rauschen(0.6, 0.04, 0, { freq: 500, bis: 2200, q: 0.8, an: 0.05 });
      osz(110, 0.5, { welle: "sawtooth", gain: 0.03, ueber: [[150, 0.5], [90, 1]], filter: ["lowpass", 600], vibrato: [30, 12] });
    },
    tier_igel: () => { for (let i = 0; i < 3; i++) rauschen(0.07, 0.025, i * 0.11, { typ: "highpass", freq: 4000, q: 0.5 }); },
    tier_hase: () => { for (const d of [0, 0.14]) tone(90, 0.07, "sine", 0.06, d, 60); },
    tier_schildkroete: () => tone(140, 0.2, "sine", 0.02),
    tier_pinguin: () => osz(480, 0.35, { welle: "sawtooth", gain: 0.03, ueber: [[720, 0.4], [430, 1]], filter: ["bandpass", 1100, 2] }),
    tier_papagei: () => {
      osz(900, 0.12, { welle: "square", gain: 0.02, bis: 1250, filter: ["bandpass", 1500, 2] });
      osz(760, 0.16, { welle: "square", gain: 0.02, delay: 0.15, bis: 620, filter: ["bandpass", 1300, 2] });
    },
    tier_herz: () => { tone(660, 0.18, "sine", 0.03); tone(880, 0.3, "sine", 0.03, 0.14); },

    /* Spiele, die bisher stumm waren */
    wuerfel: () => {
      for (let i = 0; i < 9; i++) noise(0.025, 0.04, i * 0.05 + Math.random() * 0.03, zufall(1800, 3200), 4);
      klack(0.55, 1600, 0.04);
      klack(0.68, 1500, 0.03);
    },
    schach: () => { noise(0.035, 0.06, 0, 1100, 5); tone(320, 0.05, "triangle", 0.03); },
    schlagen: () => { noise(0.035, 0.07, 0, 1100, 5); noise(0.035, 0.05, 0.07, 900, 5); tone(240, 0.08, "triangle", 0.03, 0.07); },
    schach_matt: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.35, "triangle", 0.04, i * 0.2)); },
    startschuss: () => { noise(0.06, 0.12, 0, 3000, 0.6); rauschen(0.7, 0.05, 0.02, { typ: "lowpass", freq: 1200, bis: 150, q: 0.4, an: 0.005 }); },
    galopp: () => {
      // Ein Galoppsprung: drei Hufe kurz hintereinander, dann Pause.
      for (let n = 0; n < 4; n++) for (const d of [0, 0.08, 0.16]) {
        const t = n * 0.38 + d;
        tone(zufall(85, 110), 0.06, "sine", 0.05, t, 60);
        noise(0.03, 0.02, t, 700, 1);
      }
    },
    glocke: () => { for (const [f, g] of [[880, 0.04], [1760, 0.02], [2640, 0.012], [1180, 0.01]]) tone(f, 1.4, "sine", g); },
    kugel: () => {
      tone(1500, 0.05, "triangle", 0.03);
      [0.12, 0.22, 0.29, 0.34].forEach((d, i) => noise(0.02, 0.03 - i * 0.005, d, 2600, 4));
    },
    richtig: () => { tone(880, 0.12, "sine", 0.04); tone(1320, 0.25, "sine", 0.04, 0.1); },
    falsch: () => osz(150, 0.4, { welle: "sawtooth", gain: 0.035, filter: ["lowpass", 800] }),
    alarm: () => { for (let i = 0; i < 4; i++) osz(i % 2 ? 950 : 700, 0.3, { welle: "square", gain: 0.02, delay: i * 0.3, filter: ["lowpass", 2000] }); },
    rad_tick: () => { noise(0.012, 0.04, 0, 2200, 5); tone(900, 0.02, "triangle", 0.015); },
    paar: () => { tone(1047, 0.12, "sine", 0.035); tone(1319, 0.22, "sine", 0.035, 0.09); },
    karte_ab: () => { noise(0.05, 0.04, 0, 2400, 1.2); noise(0.02, 0.03, 0.05, 900, 3); },
    mischen: () => { for (let i = 0; i < 12; i++) noise(0.02, 0.025, i * 0.035, zufall(2500, 4000), 1.5); },
    tresor: () => { for (let i = 0; i < 5; i++) klack(i * 0.12, 2600 - i * 100, 0.03); klack(0.75, 700, 0.07); },
    regen: () => { for (let i = 0; i < 14; i++) tone(zufall(2600, 4600), 0.1, "sine", 0.02, i * 0.07 + Math.random() * 0.05); },
  };

  for (const [name, fn] of Object.entries(K)) S.def(name, fn);
})();
