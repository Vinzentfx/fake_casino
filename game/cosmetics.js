"use strict";

/**
 * Cosmetics shop — a pure chip SINK for status (helps against inflation).
 *
 * Buy avatars (the emoji next to your name) and name colours with chips; own
 * them forever, equip one of each. Nothing gameplay-affecting — just flex.
 *
 * State on the account: acc.avatar (emoji), acc.nameColor (hex|null),
 * acc.cosOwned = { avatars:[ids], colors:[ids] }. Equipped values are stored
 * resolved so they flow to the leaderboard/chat without catalog lookups.
 */

const AVATARS = [
  { id: "smile",  emoji: "🙂", cost: 0 },
  { id: "cool",   emoji: "😎", cost: 5000 },
  { id: "cowboy", emoji: "🤠", cost: 10000 },
  { id: "clown",  emoji: "🤡", cost: 15000 },
  { id: "tophat", emoji: "🎩", cost: 20000 },
  { id: "shark",  emoji: "🦈", cost: 25000 },
  { id: "alien",  emoji: "👽", cost: 30000 },
  { id: "robot",  emoji: "🤖", cost: 40000 },
  { id: "gem",    emoji: "💎", cost: 75000 },
  { id: "crown",  emoji: "👑", cost: 100000 },
  { id: "dragon", emoji: "🐉", cost: 150000 },
  { id: "money",  emoji: "🤑", cost: 250000 },
];
const COLORS = [
  { id: "white",  color: null,      cost: 0 },
  { id: "gold",   color: "#f4d782", cost: 20000 },
  { id: "red",    color: "#e0705e", cost: 15000 },
  { id: "blue",   color: "#5ea8e0", cost: 15000 },
  { id: "green",  color: "#66c07a", cost: 15000 },
  { id: "purple", color: "#c86bd6", cost: 25000 },
  { id: "cyan",   color: "#4fc7c0", cost: 20000 },
  { id: "pink",   color: "#f07ab0", cost: 20000 },
];

const avaById = Object.fromEntries(AVATARS.map((a) => [a.id, a]));
const colById = Object.fromEntries(COLORS.map((c) => [c.id, c]));

function setupCosmetics(io, accounts) {
  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function state(acc) {
      const owned = acc.cosOwned || { avatars: [], colors: [] };
      const ownsAva = (id) => avaById[id].cost === 0 || (owned.avatars || []).includes(id);
      const ownsCol = (id) => colById[id].cost === 0 || (owned.colors || []).includes(id);
      const eqAva = acc.avatar || "🙂", eqCol = acc.nameColor || null;
      return {
        chips: acc.chips,
        avatars: AVATARS.map((a) => ({ ...a, owned: ownsAva(a.id), equipped: a.emoji === eqAva })),
        colors: COLORS.map((c) => ({ ...c, owned: ownsCol(c.id), equipped: (c.color || null) === eqCol })),
      };
    }

    socket.on("cos:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...state(acc) });
    });

    socket.on("cos:buy", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const item = type === "avatar" ? avaById[id] : type === "color" ? colById[id] : null;
      if (!item) return ack({ ok: false, error: "Unbekannt." });
      acc.cosOwned = acc.cosOwned || { avatars: [], colors: [] };
      const list = type === "avatar" ? acc.cosOwned.avatars : acc.cosOwned.colors;
      if (item.cost === 0 || list.includes(id)) return ack({ ok: false, error: "Schon im Besitz." });
      if (acc.chips < item.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      accounts.adjustChips(socket.data.account, -item.cost); // pure sink
      list.push(id);
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
    });

    socket.on("cos:equip", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const owned = acc.cosOwned || { avatars: [], colors: [] };
      if (type === "avatar") {
        const a = avaById[id]; if (!a) return ack({ ok: false, error: "Unbekannt." });
        if (a.cost !== 0 && !owned.avatars.includes(id)) return ack({ ok: false, error: "Nicht im Besitz." });
        acc.avatar = a.emoji;
      } else if (type === "color") {
        const c = colById[id]; if (!c) return ack({ ok: false, error: "Unbekannt." });
        if (c.cost !== 0 && !owned.colors.includes(id)) return ack({ ok: false, error: "Nicht im Besitz." });
        acc.nameColor = c.color;
      } else return ack({ ok: false, error: "Unbekannt." });
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
    });
  });
}

module.exports = { setupCosmetics };
