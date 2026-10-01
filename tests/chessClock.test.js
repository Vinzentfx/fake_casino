"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupChess } = require("../game/chess");

test("invalid chess moves do not spend time twice and timeout freezes the displayed clock", () => {
  const original = { now: Date.now, interval: global.setInterval, clear: global.clearInterval };
  let now = 1_000_000_000;
  let clockTick;
  Date.now = () => now;
  global.setInterval = (fn) => { clockTick = fn; return 1; };
  global.clearInterval = () => {};
  try {
    const players = { alice: { name: "Alice", chips: 1000 }, bob: { name: "Bob", chips: 1000 } };
    const accounts = {
      get: (key) => players[key], publicAccount: (account) => account, save() {},
      adjustChips(key, amount) {
        players[key].chips += amount;
        return { ok: true, account: players[key] };
      },
    };
    const connections = [];
    setupChess({ on(event, fn) { if (event === "connection") connections.push(fn); }, emit() {} }, accounts);
    function player(key) {
      const events = new Map();
      let latestState;
      const socket = { data: { account: key }, on(event, fn) { events.set(event, fn); },
        emit(event, payload) { if (event === "chess:state") latestState = payload; }, join() {}, leave() {} };
      for (const connect of connections) connect(socket);
      const call = (event, data) => {
        let result;
        if (data === undefined) events.get(event)((answer) => { result = answer; });
        else events.get(event)(data, (answer) => { result = answer; });
        return result;
      };
      call.state = () => latestState;
      return call;
    }
    const alice = player("alice"), bob = player("bob");
    const created = alice("chess:create", { buyIn: 50, isPublic: false, tc: "5+0" });
    assert.equal(created.ok, true);
    assert.equal(bob("chess:join", { code: created.code }).ok, true);
    assert.equal(alice("chess:start").ok, true);
    const white = alice.state().yourColor === "w" ? alice : bob;
    const winnerKey = white === alice ? "alice" : "bob";
    const loserKey = white === alice ? "bob" : "alice";
    now += 10_000;
    assert.equal(white("chess:move", { from: "a1", to: "a8" }).ok, false);
    now += 10_000;
    assert.equal(white("chess:move", { from: "a1", to: "a8" }).ok, false);
    assert.equal(white("chess:move", { from: "e2", to: "e4" }).ok, true);
    assert.equal(white.state().clocks.w, 280_000);
    now += 300_001;
    clockTick();
    const finished = white.state();
    assert.equal(finished.state, "done");
    assert.equal(finished.result.reason, "timeout");
    assert.equal(finished.clocks.b, 0);
    assert.equal(players[winnerKey].chips, 1040);
    assert.equal(players[loserKey].chips, 950);
    clockTick();
    assert.equal(players[winnerKey].chips, 1040);

    assert.equal(alice("chess:rematch").ok, true);
    assert.equal(bob("chess:rematch").ok, true);
    const black = alice.state().yourColor === "b" ? alice : bob;
    const blackKey = black === alice ? "alice" : "bob";
    const beforeResign = players[blackKey].chips;
    now += 300_001;
    assert.equal(black("chess:resign").ok, false);
    assert.equal(black.state().result.reason, "timeout");
    assert.equal(black.state().result.winner, players[blackKey].name);
    assert.equal(players[blackKey].chips, beforeResign + 90);
  } finally {
    Date.now = original.now;
    global.setInterval = original.interval;
    global.clearInterval = original.clear;
  }
});
