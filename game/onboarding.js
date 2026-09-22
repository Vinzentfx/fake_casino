"use strict";

/* Starter-Pass für wirklich neue Konten. Vier echte Handlungen führen einmal
   durch den Kern des Hauses; Zustand und Belohnung bleiben serverseitig. */

const REWARD = 7500;
const CLIENT_STEPS = new Set(["quests", "city"]);

function state(acc) {
  const ob = acc && acc.onboarding;
  if (!ob || typeof ob !== "object") return { ok: true, eligible: false };
  const steps = ob.steps && typeof ob.steps === "object" ? ob.steps : {};
  const done = {
    bonus: Number(acc.lastBonusAt) > 0,
    quests: !!steps.quests,
    play: Number(acc.stats && acc.stats.gamesPlayed) > 0,
    city: !!steps.city,
  };
  const count = Object.values(done).filter(Boolean).length;
  return { ok: true, eligible: true, done, count, total: 4, complete: count === 4,
    claimed: !!ob.claimedAt, reward: REWARD };
}

function setupOnboarding(io, accounts) {
  function emit(key) {
    const acc = accounts.get(key);
    if (!acc || !acc.onboarding) return;
    for (const socket of io.of("/").sockets.values()) {
      if (socket.data && socket.data.account === key) socket.emit("onboarding:update", state(acc));
    }
  }

  accounts.onHand((name) => {
    const key = accounts.kanonisch(name);
    const acc = key && accounts.get(key);
    if (acc && acc.onboarding && Number(acc.stats && acc.stats.gamesPlayed) === 1) emit(key);
  });

  io.on("connection", (socket) => {
    const account = () => socket.data.account && accounts.get(socket.data.account);

    socket.on("onboarding:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = account();
      ack(acc ? state(acc) : { ok: false, error: "Bitte zuerst einloggen." });
    });

    socket.on("onboarding:visit", ({ step } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = account();
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (!acc.onboarding) return ack(state(acc));
      if (!CLIENT_STEPS.has(step)) return ack({ ok: false, error: "Unbekannter Schritt." });
      if (!acc.onboarding.steps || typeof acc.onboarding.steps !== "object") acc.onboarding.steps = {};
      acc.onboarding.steps[step] = Date.now();
      accounts.save();
      const out = state(acc);
      ack(out);
      socket.emit("onboarding:update", out);
    });

    socket.on("onboarding:claim", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key && accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      const before = state(acc);
      if (!before.eligible) return ack({ ok: false, error: "Kein Starter-Pass für dieses Konto." });
      if (before.claimed) return ack({ ok: false, error: "Schon abgeholt." });
      if (!before.complete) return ack({ ok: false, error: "Erledige erst alle vier Schritte." });

      /* Erst markieren, dann buchen: eine verlorene Browser-Antwort kann so
         keinen doppelten Startbonus erzeugen. */
      acc.onboarding.claimedAt = Date.now();
      const booked = accounts.adjustChips(key, REWARD);
      if (!booked || !booked.ok) {
        acc.onboarding.claimedAt = 0;
        accounts.save();
        return ack({ ok: false, error: "Belohnung konnte nicht gebucht werden." });
      }
      ack({ ...state(acc), account: booked.account });
    });
  });
}

module.exports = { setupOnboarding, state, REWARD };
