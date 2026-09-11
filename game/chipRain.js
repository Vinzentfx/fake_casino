"use strict";

/**
 * Chip-Regen, ein Admin-Event: kurz regnet es bei allen Chips über den
 * Bildschirm, wer einen antippt, bekommt ihn (wer zuerst kommt ...). Der Topf
 * steht vorher fest und ist auf die Chips verteilt, das Event kann also nie
 * mehr auszahlen, als der Besitzer eingestellt hat.
 *
 * Alles auf dem Server: die Werte liegen nur hier, Zugriffe sind je Konto
 * gebremst und jeder Chip lässt sich genau einmal einsammeln.
 */

const chat = require("./chat");

const GRAB_MAX = 5, GRAB_WINDOW = 1000; // höchstens 5 pro Sekunde und Konto
const CHIP_TTL = 7000;                  // so lange einsammelbar (Fall ~4,5 s plus Puffer)
const GOLD_CHANCE = 0.08;               // goldene Chips zählen fünffach

function setupChipRain(io, accounts) {
  let state = null; // { endsAt, pot, chips:Map(id->{value,gold,at,taken}), collected:{key:{n,sum}} }
  let spawner = null, closer = null;
  const grabTimes = new Map();
  let nextId = 1;

  const snapshot = () => (state ? { active: true, endsAt: state.endsAt, pot: state.pot } : { active: false });

  function cleanup() {
    clearInterval(spawner); clearTimeout(closer);
    spawner = closer = null; state = null; grabTimes.clear();
  }

  function finish() {
    if (!state) return;
    const rows = Object.entries(state.collected)
      .map(([key, c]) => { const a = accounts.get(key); return { name: a ? a.name : key, sum: c.sum, n: c.n }; })
      .sort((a, b) => b.sum - a.sum);
    const total = rows.reduce((s, r) => s + r.sum, 0);
    if (rows.length) {
      chat.announce(io, `Chip-Regen vorbei, ${rows.length} Leute haben zusammen ${total.toLocaleString("de-DE")} Chips aufgelesen. Am meisten hat ${rows[0].name} (+${rows[0].sum.toLocaleString("de-DE")})!`);
    } else {
      chat.announce(io, "Chip-Regen vorbei, und keiner hat sich gebückt?");
    }
    io.emit("rain:end", { results: rows.slice(0, 8), total });
    cleanup();
  }

  function start(pot, seconds, opts = {}) {
    if (state) return { ok: false, error: "Es regnet schon." };
    pot = Math.max(1000, Math.floor(pot) || 250000);
    seconds = Math.max(10, Math.min(180, Math.floor(seconds) || 30));

    // Jeden Chip vorab auswürfeln, damit die Summe genau den Topf ergibt.
    const n = Math.max(12, Math.round(seconds * 2));
    const weights = [];
    for (let i = 0; i < n; i++) weights.push(Math.random() < GOLD_CHANCE ? 5 : 1);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const plan = weights.map((w) => ({ value: Math.max(1, Math.floor((pot * w) / wSum)), gold: w > 1 }));

    state = { endsAt: Date.now() + seconds * 1000, pot, chips: new Map(), collected: {} };
    const prefix = opts.auto ? "Zufälliger " : "";
    chat.announce(io, `${prefix}Chip-Regen! ${seconds} Sekunden lang fallen ${pot.toLocaleString("de-DE")} Chips vom Himmel, schnell antippen!`);
    io.emit("rain:start", snapshot());

    let spawned = 0;
    spawner = setInterval(() => {
      if (!state || spawned >= plan.length) { clearInterval(spawner); return; }
      const p = plan[spawned++];
      const id = nextId++;
      state.chips.set(id, { value: p.value, gold: p.gold, at: Date.now(), taken: false });
      io.emit("rain:chip", {
        id,
        x: 0.04 + Math.random() * 0.92,      // waagerechte Position (Anteil der Bildschirmbreite)
        dur: 3800 + Math.random() * 1400,     // fall duration ms
        gold: p.gold,
      });
    }, (seconds * 1000) / n);

    closer = setTimeout(finish, seconds * 1000 + CHIP_TTL);
    return { ok: true };
  }

  function stop() { if (state) finish(); }
  function active() { return !!state; }

  io.on("connection", (socket) => {
    socket.on("rain:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...snapshot() }); });

    socket.on("rain:grab", ({ id } = {}, ack) => {
      const done = (r) => { if (typeof ack === "function") ack(r); };
      if (!state || !socket.data.account) return done({ ok: false });
      const key = socket.data.account, now = Date.now();
      const times = (grabTimes.get(key) || []).filter((t) => now - t < GRAB_WINDOW);
      if (times.length >= GRAB_MAX) { grabTimes.set(key, times); return done({ ok: false, rate: true }); }
      const chip = state.chips.get(Number(id));
      if (!chip || chip.taken || now - chip.at > CHIP_TTL) return done({ ok: false, gone: true });
      times.push(now); grabTimes.set(key, times);
      chip.taken = true;
      accounts.adjustChips(key, chip.value);
      const c = (state.collected[key] = state.collected[key] || { n: 0, sum: 0 });
      c.n += 1; c.sum += chip.value;
      const acc = accounts.get(key);
      done({ ok: true, value: chip.value, mySum: c.sum, balance: acc ? acc.chips : undefined });
    });
  });

  // `zustand` gibt Restzeit und Topf nach aussen, der Admin-Bildschirm
  // zeigt damit einen Countdown statt nur "laeuft".
  return { start, stop, active, zustand: snapshot };
}

module.exports = { setupChipRain };
