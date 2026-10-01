"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupPvp } = require("../game/slotsPvp");

test("a paid slots duel cannot be replaced by another request or another tab", () => {
  let connect;
  const io = { on(event, fn) { if (event === "connection") connect = fn; } };
  const players = {
    alice: { name: "Alice", chips: 1000 },
    bob: { name: "Bob", chips: 1000 },
  };
  const accounts = {
    get(key) { return players[key]; },
    publicAccount(account) { return account; },
    adjustChips(key, delta) {
      players[key].chips += delta;
      return { ok: true, account: players[key] };
    },
  };
  setupPvp(io, accounts);

  function tab(key) {
    const handlers = new Map();
    const socket = {
      data: { account: key },
      on(event, fn) { handlers.set(event, fn); },
      emit() {}, join() {}, leave() {},
    };
    connect(socket);
    return (event, payload) => {
      let answer;
      const ack = (value) => { answer = value; };
      if (payload === undefined) handlers.get(event)(ack);
      else handlers.get(event)(payload, ack);
      return answer;
    };
  }

  const alice = tab("alice");
  const aliceOtherTab = tab("alice");
  const bob = tab("bob");
  const first = alice("pvp:createBot", { buyIn: 100 });
  assert.equal(first.ok, true);
  assert.equal(players.alice.chips, 900);

  assert.equal(alice("pvp:createBot", { buyIn: 100 }).ok, false);
  assert.equal(aliceOtherTab("pvp:createBot", { buyIn: 100 }).ok, false);
  assert.equal(alice("pvp:create", { buyIn: 100 }).ok, false);
  const waiting = bob("pvp:create", { buyIn: 100 });
  assert.equal(waiting.ok, true);
  assert.equal(aliceOtherTab("pvp:join", { code: waiting.code }).ok, false);
  assert.equal(players.alice.chips, 900);

  assert.equal(alice("pvp:spin", {}).ok, true, "die erste bezahlte Partie bleibt spielbar");
});
