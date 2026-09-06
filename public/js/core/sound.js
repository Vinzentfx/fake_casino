"use strict";

/**
 * Gemeinsame Ton-Engine.
 *
 * Vorher hatten Slots, Roulette und Blackjack je eine eigene, fast wortgleiche
 * Kopie von ac(), tone() und noise() — und die uebrigen gut zwanzig Spiele gar
 * keinen Ton. Der Schalter "Soundeffekte" in den Einstellungen wirkte deshalb
 * auf drei von fuenfundzwanzig Spielen.
 *
 * Hier steht das einmal:
 *   - ein einziger AudioContext statt drei
 *   - ein Master-Regler, ueber den die Lautstaerke sofort greift, statt sie in
 *     jeden einzelnen Aufruf hineinzumultiplizieren
 *   - die Freischaltung durch die erste Berührung (iOS laesst Ton sonst nicht
 *     zu, und genau daran scheiterte er auf dem iPad immer wieder beim ersten
 *     Spiel nach dem Laden)
 *   - eine kleine Sammlung fertiger Klaenge, damit ein Gewinn in Mines genauso
 *     klingt wie einer in Towers
 *
 * Die Signaturen von tone(), noise() und click() sind absichtlich dieselben
 * wie in den alten Kopien, damit die Spiele ohne Umschreiben umziehen konnten.
 */
(function () {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.8;
  let unlocked = false;

  try {
    enabled = localStorage.getItem("casino_sound") !== "off";
    const v = parseInt(localStorage.getItem("casino_vol"), 10);
    if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v / 100));
  } catch {}

  function ensureCtx() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  // iOS gibt Ton erst nach einer echten Nutzeraktion frei. Einmal anstupsen
  // reicht, danach laeuft alles.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  }
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  /** Ein Ton. Signatur wie bisher in slots.js und roulette.js. */
  function tone(freq, dur, type = "sine", gain = 0.05, delay = 0, to = null) {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Gefiltertes Rauschen, fuer alles Mechanische: Kugel, Karten, Klicks. */
  function noise(dur, gain = 0.05, delay = 0, freq = 1000, q = 1) {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(master);
    src.start(t);
  }

  function click(freq = 2600, gain = 0.03) {
    noise(0.012, gain, 0, freq, 6);
  }

  /**
   * Fertige Klaenge. Wer ein Spiel vertont, greift hierauf zurueck statt
   * eigene Frequenzen zu erfinden — dann klingt das ganze Haus nach einem Haus.
   */
  const CUES = {
    tick:    () => click(2400, 0.025),
    chip:    () => { click(3000, 0.05); tone(180, 0.05, "sine", 0.03, 0.005); },
    deal:    () => noise(0.09, 0.05, 0, 2200, 1.4),
    flip:    () => noise(0.06, 0.04, 0, 3200, 2),
    select:  () => tone(660, 0.06, "triangle", 0.035),
    win:     () => { tone(660, 0.1, "triangle", 0.05); tone(880, 0.14, "triangle", 0.05, 0.09); },
    bigwin:  () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "triangle", 0.055, i * 0.09));
      tone(1568, 0.5, "sine", 0.04, 0.38);
    },
    jackpot: () => {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.26, "square", 0.045, i * 0.075));
      noise(0.7, 0.03, 0.45, 4000, 0.7);
    },
    lose:    () => { tone(300, 0.16, "sine", 0.045); tone(200, 0.24, "sine", 0.045, 0.13); },
    bust:    () => tone(220, 0.4, "sawtooth", 0.05, 0, 90),
    error:   () => tone(180, 0.16, "square", 0.04),
    cash:    () => { [880, 1175, 1568].forEach((f, i) => tone(f, 0.12, "sine", 0.045, i * 0.06)); },
    countUp: () => click(3400, 0.018),
  };

  function play(name) {
    const cue = CUES[name];
    if (cue) cue();
  }

  window.Casino = window.Casino || {};
  window.Casino.sound = {
    tone, noise, click, play,
    cues: () => Object.keys(CUES),
    isEnabled: () => enabled,
    setEnabled(on) {
      enabled = !!on;
      try { localStorage.setItem("casino_sound", enabled ? "on" : "off"); } catch {}
      if (!enabled && ctx) { try { ctx.suspend(); } catch {} }
      if (enabled) ensureCtx();
    },
    getVolume: () => volume,
    setVolume(v) {
      volume = Math.min(1, Math.max(0, Number(v) || 0));
      if (master) master.gain.value = volume;
      try { localStorage.setItem("casino_vol", String(Math.round(volume * 100))); } catch {}
    },
  };

  // Alter Zugriffsweg. Die Spiele multiplizierten ihre Verstaerkung selbst mit
  // Casino.vol; das macht jetzt der Master-Regler. Der Wert bleibt lesbar,
  // damit noch nicht umgezogener Code nicht mit undefined rechnet.
  Object.defineProperty(window.Casino, "vol", {
    get: () => 1,
    set: (v) => window.Casino.sound.setVolume(v),
    configurable: true,
  });
})();
