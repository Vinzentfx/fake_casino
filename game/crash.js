"use strict";

/**
 * Crash / Aviator — one SHARED round for everyone.
 *
 * Round loop: BETTING (place your bet + optional auto-cashout) → FLYING (a
 * rocket climbs, the multiplier grows exponentially) → CRASH (at a provably-
 * fair random point the rocket explodes). Cash out before the crash to win
 * bet × multiplier; if you're still in when it blows, you lose the bet.
 *
 * Server-authoritative: the crash point is fixed when the flight starts and
 * cashouts are resolved against the server clock. House game → casino rake +
 * quests + weekly net via accounts.recordHand.
 *
 * Fairness: P(crash ≥ x) = (1 − edge) / x  → house edge = `HOUSE_EDGE`.
 */

const crypto = require("crypto");

const BET_MS = 7000;        // betting window
const PAUSE_MS = 4500;      // after a crash before the next round
const TICK_MS = 100;        // multiplier broadcast cadence
const GROWTH = 0.00013;     // exp growth/ms → ~2× at 5.3s, ~10× at 17.7s
const HOUSE_EDGE = 0.03;    // 97% RTP
const MAX_CRASH = 120;      // cap so a round can't run forever (~37s)
const MIN_BET = 50, MAX_BET = 1_000_000;
const HISTORY = 15;

const mAt = (elapsedMs) => Math.max(1, Math.floor(Math.exp(GROWTH * elapsedMs) * 100) / 100);
const crashTimeMs = (m) => Math.log(m) / GROWTH;

function nextCrashPoint() {
  // P(crash ≥ x) = (1 − edge) / x  → house edge exactly `HOUSE_EDGE`. Values
  // below 1 (prob = edge) are an instant bust (everyone loses).
  const u = crypto.randomInt(1_000_000_000) / 1_000_000_000; // [0,1)
  const c = (1 - HOUSE_EDGE) / (1 - u);
  return c < 1 ? 1.00 : Math.min(MAX_CRASH, Math.floor(c * 100) / 100);
}

function setupCrash(io, accounts) {
  const state = {
    phase: "betting",     // betting | flying | crashed
    roundId: 1,
    endsAt: Date.now() + BET_MS, // when the current phase ends (betting/pause)
    startAt: 0,           // flight start
    crashPoint: 0,
    bets: {},             // key → { name, amount, target, cashedAt }
    history: [],
  };

  const acc = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  function publicBets() {
    return Object.entries(state.bets).map(([key, b]) => ({
      name: b.name, amount: b.amount,
      cashedAt: b.cashedAt || null,
      won: b.cashedAt ? Math.round(b.amount * b.cashedAt) : null,
    }));
  }
  function snapshot() {
    const now = Date.now();
    return {
      phase: state.phase,
      roundId: state.roundId,
      multiplier: state.phase === "flying" ? mAt(now - state.startAt) : (state.phase === "crashed" ? state.crashPoint : 1),
      msLeft: state.phase !== "flying" ? Math.max(0, state.endsAt - now) : 0,
      crashPoint: state.phase === "crashed" ? state.crashPoint : null,
      bets: publicBets(),
      history: state.history,
    };
  }
  const broadcast = (ev, extra) => io.emit(ev, { ...snapshot(), ...extra });

  // ── Round state machine ─────────────────────────────────────────────────
  function startBetting() {
    state.phase = "betting";
    state.roundId += 1;
    state.bets = {};
    state.crashPoint = 0;
    state.endsAt = Date.now() + BET_MS;
    broadcast("crash:round");
  }
  function startFlight() {
    state.phase = "flying";
    state.startAt = Date.now();
    state.crashPoint = nextCrashPoint();
    broadcast("crash:flying");
  }
  function crash() {
    state.phase = "crashed";
    state.endsAt = Date.now() + PAUSE_MS;
    // Anyone still in loses (bet already deducted). Record every settled bet.
    for (const [key, b] of Object.entries(state.bets)) {
      if (b.cashedAt) continue; // already paid on cashout
      accounts.recordHand(key, -b.amount, true, "crash");
    }
    state.history.unshift(state.crashPoint);
    if (state.history.length > HISTORY) state.history.pop();
    broadcast("crash:end", { crashPoint: state.crashPoint });
  }

  function cashOut(key, mult) {
    const b = state.bets[key];
    if (!b || b.cashedAt) return null;
    b.cashedAt = mult;
    const payout = Math.round(b.amount * mult);
    accounts.adjustChips(key, payout);
    accounts.recordHand(key, payout - b.amount, true, "crash");
    return payout;
  }

  setInterval(() => {
    const now = Date.now();
    if (state.phase === "betting") {
      if (now >= state.endsAt) startFlight();
    } else if (state.phase === "flying") {
      const elapsed = now - state.startAt;
      const m = mAt(elapsed);
      // Auto-cashouts that have reached their target.
      for (const [key, b] of Object.entries(state.bets)) {
        if (!b.cashedAt && b.target && m >= b.target && b.target <= state.crashPoint) {
          const payout = cashOut(key, b.target);
          const s = onlineSocket(key);
          if (s && payout != null) s.emit("crash:cashed", { mult: b.target, payout, auto: true });
        }
      }
      if (elapsed >= crashTimeMs(state.crashPoint)) crash();
      else io.emit("crash:tick", { multiplier: m });
    } else if (state.phase === "crashed") {
      if (now >= state.endsAt) startBetting();
    }
  }, TICK_MS).unref();

  function onlineSocket(key) {
    for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === key) return s;
    return null;
  }

  io.on("connection", (socket) => {
    socket.on("crash:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...snapshot() }); });

    socket.on("crash:bet", ({ amount, target } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = acc(socket);
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (state.phase !== "betting") return ack({ ok: false, error: "Gerade kein Einsatz möglich — warte auf die nächste Runde." });
      const key = socket.data.account;
      if (state.bets[key]) return ack({ ok: false, error: "Du hast diese Runde schon gesetzt." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} 🪙.` });
      if (amount > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} 🪙.` });
      if (a.chips < amount) return ack({ ok: false, error: "Nicht genug Chips." });
      let tgt = target != null ? Math.floor(Number(target) * 100) / 100 : null;
      if (tgt != null && (!Number.isFinite(tgt) || tgt < 1.01)) tgt = null;
      const res = accounts.adjustChips(key, -amount);
      if (!res.ok) return ack({ ok: false, error: res.error });
      state.bets[key] = { name: a.name, amount, target: tgt, cashedAt: null };
      ack({ ok: true, account: res.account });
      broadcast("crash:round");
    });

    socket.on("crash:cashout", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (state.phase !== "flying") return ack({ ok: false, error: "Zu spät." });
      const key = socket.data.account;
      const b = state.bets[key];
      if (!b || b.cashedAt) return ack({ ok: false, error: "Nichts zum Auszahlen." });
      const m = mAt(Date.now() - state.startAt);
      if (m > state.crashPoint) return ack({ ok: false, error: "Zu spät — geplatzt!" });
      const payout = cashOut(key, m);
      ack({ ok: true, mult: m, payout, account: accounts.publicAccount(accounts.get(key)) });
      broadcast("crash:round");
    });
  });
}

module.exports = { setupCrash };
