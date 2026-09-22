"use strict";

/**
 * Freiwilliges Sitzungsbudget.
 *
 * Gezaehlt wird der Netto-Spielausgang aus recordHand. Ein Gewinn gleicht
 * fruehere Verluste derselben Sitzung also aus; Bonus, Transfers, Mieten und
 * Geschenke tauchen hier absichtlich nicht auf. Nach 90 Minuten ohne Runde
 * beginnt automatisch eine neue Sitzung.
 */

const INACTIVITY_MS = 90 * 60 * 1000;
const MIN_BUDGET = 100;
const MAX_BUDGET = 10_000_000;

function setupResponsible(io, accounts) {
  const sessions = new Map();
  const keyVon = (name) => String(name || "").trim().toLowerCase();

  function budgetVon(acc) {
    const n = Math.floor(Number(acc && acc.playLimits && acc.playLimits.sessionBudget) || 0);
    return n >= MIN_BUDGET ? Math.min(MAX_BUDGET, n) : 0;
  }

  function session(key, resetIfIdle = true) {
    const now = Date.now();
    let s = sessions.get(key);
    if (!s || (resetIfIdle && s.lastAt && now - s.lastAt >= INACTIVITY_MS)) {
      s = { net: 0, startedAt: now, lastAt: 0, warned80: false, warned100: false };
      sessions.set(key, s);
    }
    return s;
  }

  function publicState(key) {
    const acc = accounts.get(key);
    const s = session(key);
    const budget = budgetVon(acc);
    const loss = Math.max(0, -Math.floor(s.net || 0));
    return {
      ok: true, budget, loss, net: Math.floor(s.net || 0), startedAt: s.startedAt,
      lastAt: s.lastAt || 0,
      percent: budget ? Math.min(100, Math.round((100 * loss) / budget)) : 0,
      inactivityMinutes: Math.round(INACTIVITY_MS / 60000),
      min: MIN_BUDGET, max: MAX_BUDGET,
    };
  }

  function socketsFuer(key) {
    const out = [];
    for (const sock of io.of("/").sockets.values()) {
      if (sock.data && sock.data.account === key) out.push(sock);
    }
    return out;
  }

  function emitState(key) {
    const data = publicState(key);
    for (const sock of socketsFuer(key)) sock.emit("responsible:update", data);
  }

  accounts.onHand((name, winnings, _house, _game, meta) => {
    if (meta && meta.free) return;
    const key = keyVon(name);
    const acc = accounts.get(key);
    if (!acc) return;
    const s = session(key);
    s.net += Number(winnings) || 0;
    s.lastAt = Date.now();
    const budget = budgetVon(acc);
    const loss = Math.max(0, -s.net);

    let warning = null;
    if (budget && loss >= budget && !s.warned100) {
      s.warned100 = true;
      s.warned80 = true;
      warning = { level: 100, ...publicState(key) };
    } else if (budget && loss >= budget * 0.8 && !s.warned80) {
      s.warned80 = true;
      warning = { level: 80, ...publicState(key) };
    }
    for (const sock of socketsFuer(key)) {
      sock.emit("responsible:update", publicState(key));
      if (warning) sock.emit("responsible:warning", warning);
    }
  });

  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    socket.on("responsible:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!key() || !accounts.get(key())) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      ack(publicState(key()));
    });

    socket.on("responsible:set", ({ budget } = {}, ack) => {
      if (typeof ack !== "function") return;
      const k = key(), acc = k && accounts.get(k);
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      budget = Math.floor(Number(budget) || 0);
      if (budget !== 0 && (budget < MIN_BUDGET || budget > MAX_BUDGET))
        return ack({ ok: false, error: `Wähle 0 oder einen Betrag zwischen ${MIN_BUDGET.toLocaleString("de-DE")} und ${MAX_BUDGET.toLocaleString("de-DE")}.` });
      acc.playLimits = acc.playLimits || {};
      acc.playLimits.sessionBudget = budget;
      const s = session(k);
      s.warned80 = false;
      s.warned100 = false;
      accounts.save();
      emitState(k);
      ack(publicState(k));
    });
  });

  return { publicState, sessions };
}

module.exports = { setupResponsible, INACTIVITY_MS, MIN_BUDGET, MAX_BUDGET };
