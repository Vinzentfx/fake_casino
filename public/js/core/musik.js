"use strict";

/**
 * Musik und Raumklang für die Welt, synthetisch und ohne Audiodateien.
 *
 * Jeder Raum hat seine Stimmung: Lounge im Casino, Synthwave in der
 * Spielhalle, Vögel oder Grillen auf der Terrasse, Verkehr in der
 * Ladenstraße. In der Spielhalle wählt die Jukebox das Lied, und das hören
 * alle, die dort stehen (der Server schickt die Wahl an den Raum).
 *
 * Gespielt wird nur, wenn die Welt VORN liegt. Liegt ein Spiel darüber,
 * blendet alles aus: die Spiele haben ihre eigenen Klänge, und zwei
 * Tonspuren übereinander sind Lärm. Ebenso bei verstecktem Tab.
 *
 * Läuft über denselben AudioContext und denselben Master wie core/sound.js;
 * der Schalter „Soundeffekte“ und die Lautstärke wirken also auch hier.
 * Dazu ein eigener Schalter „Musik“ mit eigener Lautstärke.
 *
 * Der Takt kommt aus einem Planer, der eine Viertelsekunde vorausplant
 * (setInterval, nicht requestAnimationFrame: der steht im Hintergrund und
 * im Vorschaufenster still).
 */
(function () {
  const S = window.Casino && window.Casino.sound;
  if (!S || !S._kontext) return;

  let an = true;
  let lautstaerke = 0.55;
  try {
    an = localStorage.getItem("casino_musik") !== "off";
    const v = parseInt(localStorage.getItem("casino_musik_vol"), 10);
    if (Number.isFinite(v)) lautstaerke = Math.min(1, Math.max(0, v / 100));
  } catch {}

  /* Noten als MIDI-Nummern; 60 ist das mittlere C. */
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* Die Stile. Ein Takt hat 16 Schritte. `akkorde` geht Takt für Takt,
     `bass` und `arp` sind Muster über 16 Schritte (Ziffer = Ton im Akkord,
     Punkt = Pause), `melodie` läuft über die ganze Schleife (Ziffern sind
     Akkordtöne eine Oktave höher, so passt sie zu jedem Akkord). */
  const STILE = {
    lounge: {
      bpm: 84, swing: 0.22, laut: 0.8,
      akkorde: [[50, 53, 57, 60, 64], [43, 53, 59, 64], [48, 52, 55, 59, 62], [45, 55, 61, 64]],
      pad: { welle: "sine", gain: 0.022, tremolo: 4.5, filter: 1600 },
      bass: { muster: "0...2...1...3...", welle: "triangle", gain: 0.07, oktave: -12 },
      drums: { kick: "x.......x.......", besen: "....x.......x...", ride: "x..x.x..x..x.x.." },
      melodie: { muster: "....4...3.2.....1.....2...3.....4...5.4.......3.2...1.....0.....", welle: "triangle", gain: 0.022 },
    },
    synthwave: {
      bpm: 100, swing: 0, laut: 0.75,
      akkorde: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
      pad: { welle: "sawtooth", gain: 0.012, filter: 1100, schwebung: 7 },
      bass: { muster: "0.0.0.0.0.0.0.0.", welle: "sawtooth", gain: 0.05, oktave: -24, filter: 500 },
      arp: { muster: "0121012101210121", welle: "square", gain: 0.012, oktave: 12, filter: 2400 },
      drums: { kick: "x.......x.......", snare: "....x.......x...", hat: "..x...x...x...x." },
    },
    chiptune: {
      bpm: 140, swing: 0, laut: 0.6, hall: 0.1,
      akkorde: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
      bass: { muster: "0.2.0.2.0.2.0.2.", welle: "triangle", gain: 0.07, oktave: -12 },
      arp: { muster: "0120120120120120", welle: "square", gain: 0.01, oktave: 0 },
      drums: { chipkick: "x...x...x...x...", chiphat: "..x...x...x...x.", chipsnare: "....x.......x..x" },
      melodie: { muster: "2.2.1.0...3.2...1.1.0.2...1.0...0.2.4.3.2.1...0.1.2.0.1.2.4.....", welle: "square", gain: 0.016 },
    },
    disco: {
      bpm: 118, swing: 0, laut: 0.75,
      akkorde: [[57, 60, 64], [62, 65, 69], [55, 59, 62], [60, 64, 67]],
      bass: { muster: "0.0.0.0.0.0.0.0.", welle: "sawtooth", gain: 0.045, oktave: -24, filter: 700, oktavsprung: true },
      stab: { muster: "..x...x...x...x.", welle: "sawtooth", gain: 0.01, filter: 2600 },
      drums: { kick: "x...x...x...x...", clap: "....x.......x...", offen: "..x...x...x...x.", hat: "x.x.x.x.x.x.x.x." },
      melodie: { muster: "....2.2.3.2.....1.1.2.1.........2.2.3.4.3.2.....1.2.1.0.........", welle: "square", gain: 0.012, filter: 3000 },
    },
    house: {
      bpm: 124, swing: 0, laut: 0.7,
      akkorde: [[57, 60, 64, 67], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]],
      bass: { muster: "..0...0...0...0.", welle: "sine", gain: 0.08, oktave: -24 },
      stab: { muster: "..x..x....x..x..", welle: "square", gain: 0.009, filter: 1800 },
      drums: { kick: "x...x...x...x...", clap: "....x.......x...", offen: "..x...x...x...x.", hat: ".x.x.x.x.x.x.x.x" },
    },
    swing: {
      bpm: 120, swing: 0.3, laut: 0.75,
      akkorde: [[48, 52, 55, 58], [53, 57, 60, 63], [48, 52, 55, 58], [55, 59, 62, 65]],
      pad: { welle: "triangle", gain: 0.012, filter: 1800, kurz: true, muster: "....x.......x..." },
      bass: { muster: "0...1...2...3...", welle: "triangle", gain: 0.07, oktave: -12 },
      drums: { kick: "x.......x.......", besen: "....x.......x...", ride: "x..xx..xx..xx..x" },
      melodie: { muster: "0.1.2...3.2.1...2.3.4...3.......0.1.2...3.2.1...2.1.0...........", welle: "triangle", gain: 0.02 },
    },
    polka: {
      bpm: 128, swing: 0, laut: 0.7,
      akkorde: [[55, 59, 62], [50, 54, 57, 60], [55, 59, 62], [50, 54, 57, 60]],
      bass: { muster: "0.......2.......", welle: "triangle", gain: 0.08, oktave: -12 },
      stab: { muster: "....x.......x...", welle: "sawtooth", gain: 0.012, filter: 1600, vibrato: 6 },
      drums: { kick: "x.......x.......", hat: "....x.......x..." },
      melodie: { muster: "0.1.2.2.2...1.2.3.3.3...2.3.4.3.2.1.0...1.2.1.0.1.2.3...2.1.0...", welle: "sawtooth", gain: 0.014, filter: 2000, vibrato: 6 },
    },
    // Fahrstuhlmusik für den Warteraum: Bossa, sanft, ein bisschen zu fröhlich.
    fahrstuhl: {
      bpm: 104, swing: 0.12, laut: 0.75,
      akkorde: [[48, 52, 55, 59, 62], [45, 48, 52, 55, 60], [50, 53, 57, 60, 64], [43, 47, 50, 53, 57]],
      pad: { welle: "sine", gain: 0.014, filter: 1800, kurz: true, muster: "x..x..x...x..x.." },
      bass: { muster: "0..2..0.1..2..0.", welle: "triangle", gain: 0.07, oktave: -12 },
      drums: { besen: "..x...x...x...x.", ride: "x.xx.x.xx.xx.x.x" },
      melodie: { muster: "4...3.2...1.2.3.4.......2.......3...2.1...0.1.2.3.......4.......", welle: "sine", gain: 0.022 },
    },
    ruhm: {
      bpm: 60, swing: 0, laut: 0.8, hall: 0.6,
      akkorde: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]],
      pad: { welle: "sawtooth", gain: 0.009, filter: 900, schwebung: 5, an: 1.2 },
      bass: { muster: "0...............", welle: "sine", gain: 0.05, oktave: -12, lang: true },
      melodie: { muster: "....3...........4.......3.......2...............1.......0.......", welle: "sine", gain: 0.02 },
    },
  };

  /* Welcher Raum welche Stimmung hat. `atmo` sind Geräusche ohne Takt. */
  const RAUM = {
    casino: { stil: "lounge" },
    kontor: { stil: "lounge", leiser: 0.55 },
    ruhm: { stil: "ruhm" },
    spielhalle: { stil: "synthwave" },
    modehaus: { stil: "lounge", leiser: 0.7 },
    atelier: { stil: "swing", leiser: 0.5 },
    fundus: { atmo: "tresor" },
    dachgarten: { stil: "house", leiser: 0.5 },
    sternwarte: { atmo: "tresor" },
    hof: { atmo: "draussen" },
    strasse: { atmo: "stadt" },
    garage: { atmo: "garage" },
    tresor: { atmo: "tresor" },
    foyer: { stil: "fahrstuhl" },
  };

  let ctx = null, bus = null, hallEin = null;
  let raumId = null, nacht = false;
  let jukebox = null;            // { stil, bis }
  let vorn = false;
  let stil = null, schritt = 0, naechste = 0, planer = null;
  let atmo = null, atmoTimer = null, dauerTon = [];

  function aufbauen() {
    const c = S._kontext();
    if (!c) return null;
    if (ctx === c && bus) return c;
    ctx = c;
    bus = c.createGain();
    bus.gain.value = 0.0001;
    bus.connect(S._master());
    // Ein kleiner Hall aus abklingendem Rauschen; ohne ihn klingt alles trocken nach Telefon.
    const len = Math.floor(c.sampleRate * 1.8);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let k = 0; k < 2; k++) {
      const d = ir.getChannelData(k);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const hall = c.createConvolver();
    hall.buffer = ir;
    hallEin = c.createGain();
    hallEin.gain.value = 0.3;
    hallEin.connect(hall).connect(bus);
    return c;
  }

  const darf = () => an && S.isEnabled() && vorn && !document.hidden;

  /* Eine Stimme: Oszillator, Filter, Hüllkurve, trocken und in den Hall. */
  function stimme(freq, t, dur, o) {
    const osc = ctx.createOscillator();
    osc.type = o.welle || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.verstimmt) osc.detune.value = o.verstimmt;
    if (o.vibrato) {
      const lfo = ctx.createOscillator(), tiefe = ctx.createGain();
      lfo.frequency.value = o.vibrato; tiefe.gain.value = freq * 0.006;
      lfo.connect(tiefe).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    let kette = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = o.filter; f.Q.value = 0.7;
      kette = kette.connect(f);
    }
    const g = ctx.createGain();
    const gain = Math.max(0.0002, o.gain);
    const anl = Math.min(o.an || 0.01, dur * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + anl);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * (o.halten == null ? 0.5 : o.halten)), t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (o.tremolo) {
      const lfo = ctx.createOscillator(), tiefe = ctx.createGain(), tr = ctx.createGain();
      lfo.frequency.value = o.tremolo; tiefe.gain.value = 0.35; tr.gain.value = 0.65;
      lfo.connect(tiefe).connect(tr.gain);
      lfo.start(t); lfo.stop(t + dur + 0.1);
      kette = kette.connect(tr);
    }
    kette.connect(g);
    g.connect(bus);
    if (hallEin) g.connect(hallEin);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  let rausch = null;
  function puffer() {
    if (!rausch) {
      const len = ctx.sampleRate;
      rausch = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = rausch.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return rausch;
  }
  function rauschStoss(t, dur, gain, typ, freq, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = puffer(); src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = typ; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
  }

  const TROMMEL = {
    kick: (t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.25);
    },
    snare: (t) => { rauschStoss(t, 0.16, 0.06, "bandpass", 1900, 0.8); stimme(190, t, 0.08, { welle: "triangle", gain: 0.03 }); },
    clap: (t) => { for (const d of [0, 0.012, 0.026]) rauschStoss(t + d, 0.1, 0.05, "bandpass", 1300, 1.2); },
    hat: (t) => rauschStoss(t, 0.035, 0.022, "highpass", 8000, 0.7),
    offen: (t) => rauschStoss(t, 0.18, 0.02, "highpass", 7000, 0.7),
    ride: (t) => { rauschStoss(t, 0.25, 0.012, "bandpass", 6500, 2); stimme(3200, t, 0.2, { welle: "sine", gain: 0.003 }); },
    besen: (t) => rauschStoss(t, 0.22, 0.018, "bandpass", 3500, 0.6),
    chipkick: (t) => stimme(110, t, 0.09, { welle: "square", gain: 0.03, halten: 0.2 }),
    chiphat: (t) => rauschStoss(t, 0.03, 0.015, "highpass", 6000, 1),
    chipsnare: (t) => rauschStoss(t, 0.09, 0.03, "bandpass", 2500, 0.8),
  };

  /* Einen Schritt planen. */
  function planeSchritt(st, n, t) {
    const sechzehntel = 60 / st.bpm / 4;
    const takt = Math.floor(n / 16) % st.akkorde.length;
    const i = n % 16;
    const akkord = st.akkorde[takt];
    if (st.drums) for (const [art, m] of Object.entries(st.drums)) if (m[i] === "x" && TROMMEL[art]) TROMMEL[art](t);
    if (st.pad) {
      const p = st.pad;
      if (p.muster ? p.muster[i] === "x" : i === 0) {
        const dur = p.kurz ? sechzehntel * 3 : sechzehntel * 16 + 0.1;
        for (const m of akkord) {
          stimme(hz(m), t, dur, { welle: p.welle, gain: p.gain, filter: p.filter, an: p.an || (p.kurz ? 0.01 : 0.15), halten: 0.8, tremolo: p.tremolo });
          if (p.schwebung) stimme(hz(m), t, dur, { welle: p.welle, gain: p.gain * 0.7, filter: p.filter, an: p.an || 0.15, halten: 0.8, verstimmt: p.schwebung });
        }
      }
    }
    if (st.bass) {
      const b = st.bass, z = b.muster[i];
      if (z !== ".") {
        let m = akkord[Math.min(akkord.length - 1, Number(z))] + b.oktave;
        if (b.oktavsprung && i % 4 === 2) m += 12;
        const dur = b.lang ? sechzehntel * 16 : sechzehntel * (b.muster[i + 1] === "." ? 2 : 1) * 0.95;
        stimme(hz(m), t, dur, { welle: b.welle, gain: b.gain, filter: b.filter, halten: 0.7 });
      }
    }
    if (st.arp) {
      const a = st.arp, z = a.muster[i];
      if (z !== ".") stimme(hz(akkord[Number(z) % akkord.length] + a.oktave), t, sechzehntel * 0.9, { welle: a.welle, gain: a.gain, filter: a.filter, halten: 0.3 });
    }
    if (st.stab && st.stab.muster[i] === "x") {
      for (const m of akkord) stimme(hz(m + 12), t, sechzehntel * 1.2, { welle: st.stab.welle, gain: st.stab.gain, filter: st.stab.filter, halten: 0.3, vibrato: st.stab.vibrato });
    }
    if (st.melodie) {
      const mm = st.melodie.muster;
      const z = mm[n % mm.length];
      if (z !== "." && z != null) {
        let lang = 1;
        while (lang < 8 && mm[(n + lang) % mm.length] === ".") lang++;
        const k = Number(z);
        const m = akkord[k % akkord.length] + 12 * (1 + Math.floor(k / akkord.length));
        stimme(hz(m), t, sechzehntel * lang * 0.95, { welle: st.melodie.welle, gain: st.melodie.gain, filter: st.melodie.filter || 3500, halten: 0.6, vibrato: st.melodie.vibrato, an: 0.02 });
      }
    }
  }

  function planen() {
    if (!ctx || !stil) return;
    const st = STILE[stil];
    const sechzehntel = 60 / st.bpm / 4;
    while (naechste < ctx.currentTime + 0.3) {
      // Swing: jeder zweite Sechzehntel kommt etwas später.
      const t = naechste + (schritt % 2 ? sechzehntel * st.swing : 0);
      if (t > ctx.currentTime - 0.02) planeSchritt(st, schritt, t);
      schritt++;
      naechste += sechzehntel;
    }
  }

  /* Raumklang ohne Takt: Vögel am Tag, Grillen in der Nacht, Verkehr,
     Tropfen. Zufällige Abstände, damit es nicht nach Schleife klingt. */
  const ATMO = {
    draussen: () => {
      if (nacht) {
        for (let k = 0; k < 2; k++) {
          const t0 = ctx.currentTime + Math.random() * 0.6;
          const f = 4300 + Math.random() * 500;
          for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) stimme(f, t0 + i * 0.06, 0.04, { welle: "square", gain: 0.0035, filter: 6000, halten: 0.3 });
        }
        return 0.6 + Math.random() * 1.2;
      }
      const t0 = ctx.currentTime + 0.05;
      const f = 2400 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) vogel(t0 + i * (0.09 + Math.random() * 0.05), f * (0.9 + Math.random() * 0.25));
      return 1.5 + Math.random() * 4;
    },
    stadt: () => {
      vorbeifahren();
      if (!nacht && Math.random() < 0.4) vogel(ctx.currentTime + 1, 3000);
      return 4 + Math.random() * 7;
    },
    garage: () => {
      const t = ctx.currentTime + 0.05;
      const f = 900 + Math.random() * 500;
      stimme(f, t, 0.08, { welle: "sine", gain: 0.02, halten: 0.2 });
      stimme(f * 0.6, t + 0.25, 0.08, { welle: "sine", gain: 0.006, halten: 0.2 });
      return 2.5 + Math.random() * 4;
    },
    tresor: () => {
      stimme(55, ctx.currentTime + 0.05, 6, { welle: "sine", gain: 0.02, an: 2, halten: 0.9 });
      return 5;
    },
  };
  function vogel(t, f) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.2 + Math.random() * 0.4), t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.008, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); g.connect(bus); if (hallEin) g.connect(hallEin);
    o.start(t); o.stop(t + 0.1);
  }
  function vorbeifahren() {
    const t = ctx.currentTime + 0.05, dur = 3 + Math.random() * 2;
    const src = ctx.createBufferSource();
    src.buffer = puffer(); src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 0.6;
    f.frequency.setValueAtTime(250, t);
    f.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let kette = src.connect(f).connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(), r = Math.random() < 0.5 ? 1 : -1;
      p.pan.setValueAtTime(-0.8 * r, t); p.pan.linearRampToValueAtTime(0.8 * r, t + dur);
      kette = kette.connect(p);
    }
    kette.connect(bus);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  /* Dauertöne je Raum, die unter allem liegen: Wind draußen, das Summen
     der Leuchtröhre in der Garage. */
  function dauerAn(art) {
    if (art === "draussen" || art === "stadt") {
      const src = ctx.createBufferSource(); src.buffer = puffer(); src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = art === "stadt" ? 180 : 400; f.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = art === "stadt" ? 0.03 : 0.012;
      src.connect(f).connect(g).connect(bus); src.start();
      dauerTon.push(src);
    }
    if (art === "garage") {
      for (const [fr, gn] of [[100, 0.006], [200, 0.003]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = fr; g.gain.value = gn;
        o.connect(g).connect(bus); o.start();
        dauerTon.push(o);
      }
    }
  }
  function dauerAus() {
    for (const n of dauerTon) { try { n.stop(); } catch {} }
    dauerTon = [];
  }

  function zielStil() {
    const r = RAUM[raumId];
    if (!r) return null;
    if ((raumId === "spielhalle" || raumId === "foyer") && jukebox && jukebox.bis > Date.now() && STILE[jukebox.stil]) return jukebox.stil;
    return r.stil || null;
  }

  function busLautstaerke() {
    const r = RAUM[raumId] || {};
    const st = stil ? STILE[stil] : null;
    return lautstaerke * (r.leiser || 1) * (st ? st.laut : 1) * 1.5;
  }

  /** Alles neu abgleichen: was soll laufen, und läuft es? */
  function abgleichen() {
    if (!darf()) return ausblenden();
    const c = aufbauen();
    if (!c) return;
    const sollStil = zielStil();
    const sollAtmo = (RAUM[raumId] || {}).atmo || null;
    const neu = sollStil !== stil || sollAtmo !== atmo;
    if (neu) {
      stoppen();
      stil = sollStil;
      atmo = sollAtmo;
      schritt = 0;
      naechste = ctx.currentTime + 0.12;
      if (stil) { hallEin.gain.value = STILE[stil].hall == null ? 0.3 : STILE[stil].hall; planer = setInterval(planen, 60); planen(); }
      if (atmo) { hallEin.gain.value = 0.25; dauerAn(atmo); atmoLauf(); }
    }
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(Math.max(0.0001, busLautstaerke()), ctx.currentTime, neu ? 0.4 : 0.25);
  }
  function atmoLauf() {
    if (!atmo || !ATMO[atmo]) return;
    const pause = ATMO[atmo]();
    atmoTimer = setTimeout(atmoLauf, pause * 1000);
  }
  function stoppen() {
    clearInterval(planer); planer = null;
    clearTimeout(atmoTimer); atmoTimer = null;
    dauerAus();
    stil = null; atmo = null;
  }
  let ausTimer = null;
  function ausblenden() {
    if (!bus || !ctx) return stoppen();
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    clearTimeout(ausTimer);
    // Erst nach dem Ausblenden wirklich anhalten; kommt man sofort zurück, läuft es weiter.
    ausTimer = setTimeout(() => { if (!darf()) stoppen(); }, 1500);
  }

  document.addEventListener("visibilitychange", abgleichen);
  document.addEventListener("casino:ton", abgleichen);
  // Ohne Berührung gibt iOS keinen Ton frei; danach sofort loslegen.
  window.addEventListener("pointerdown", () => setTimeout(abgleichen, 50), { once: true, passive: true });
  window.addEventListener("keydown", () => setTimeout(abgleichen, 50), { once: true });
  // Ein abgelaufenes Jukebox-Lied geht von selbst zurück zur Raummusik.
  setInterval(() => { if (jukebox && jukebox.bis <= Date.now()) { jukebox = null; abgleichen(); } }, 5000);

  window.Casino.musik = {
    STILE: Object.keys(STILE),
    /** Die Welt meldet Raum und Tageszeit. */
    raum(id, o = {}) { raumId = id || null; nacht = !!o.nacht; abgleichen(); },
    /** Liegt die Welt vorn (bedienbar) oder ein Spiel darüber? */
    vorn(v) { vorn = !!v; abgleichen(); },
    /** Die Jukebox der Spielhalle: Stil und wie lange. */
    jukebox(st, ms) { jukebox = st && STILE[st] ? { stil: st, bis: Date.now() + (ms || 180000) } : null; abgleichen(); },
    istAn: () => an,
    setAn(v) {
      an = !!v;
      try { localStorage.setItem("casino_musik", an ? "on" : "off"); } catch {}
      abgleichen();
    },
    getLautstaerke: () => lautstaerke,
    setLautstaerke(v) {
      lautstaerke = Math.min(1, Math.max(0, Number(v) || 0));
      try { localStorage.setItem("casino_musik_vol", String(Math.round(lautstaerke * 100))); } catch {}
      if (bus && ctx && stil) bus.gain.setTargetAtTime(Math.max(0.0001, busLautstaerke()), ctx.currentTime, 0.1);
    },
    zustand: () => ({ an, vorn, raum: raumId, stil, atmo, jukebox, ctx: ctx && ctx.state }),
  };
})();
