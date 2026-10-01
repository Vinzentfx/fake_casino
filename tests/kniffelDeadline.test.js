"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupKniffel } = require("../game/kniffel");

test("Kniffel rejects late actions and stale turn timers", () => {
  const original = { now: Date.now, timeout: global.setTimeout, clear: global.clearTimeout, interval: global.setInterval };
  let now = 1_000_000;
  const timers = [];
  Date.now = () => now;
  global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  global.clearTimeout = () => {};
  global.setInterval = () => ({ unref() {} });
  try {
    const handlers = new Map();
    const balances = new Map([["alice", { name: "Alice", chips: 1000 }], ["bob", { name: "Bob", chips: 1000 }]]);
    const accounts = {
      get: (key) => balances.get(key),
      publicAccount: (account) => account,
      save() {}, recordHand() {},
      adjustChips(key, amount) {
        const account = balances.get(key);
        account.chips += amount;
        return { ok: true, account };
      },
    };
    const io = { on(event, fn) { handlers.set(event, fn); }, emit() {} };
    setupKniffel(io, accounts);
    function player(key) {
      const events = new Map();
      const socket = { data: { account: key }, on(event, fn) { events.set(event, fn); }, emit() {}, join() {} };
      handlers.get("connection")(socket);
      return (event, data) => {
        let result;
        const fn = events.get(event);
        if (data === undefined) fn((answer) => { result = answer; });
        else fn(data, (answer) => { result = answer; });
        return result;
      };
    }
    const alice = player("alice"), bob = player("bob");
    const created = alice("kniffel:create", { bet: 50, oeffentlich: false });
    assert.equal(created.ok, true);
    assert.equal(bob("kniffel:join", { code: created.code }).ok, true);
    const first = alice("kniffel:state");
    const oldTimer = timers[0];
    now = first.zugBis;

    assert.equal(alice("kniffel:halten", { index: 0 }).ok, false);
    assert.equal(alice("kniffel:wurf").ok, false);
    assert.equal(alice("kniffel:eintragen", { feld: "chance" }).ok, false);
    assert.deepEqual(alice("kniffel:state").spieler[0].blatt, {});

    oldTimer();
    assert.equal(alice("kniffel:state").dran, "bob");
    const oldBobTimer = timers[1];
    const bobDeadline = bob("kniffel:state").zugBis;
    assert.equal(bob("kniffel:eintragen", { feld: "chance" }).ok, true);
    const next = alice("kniffel:state");
    assert.equal(next.dran, "alice");
    assert.notEqual(next.zugBis, first.zugBis);
    const sheet = { ...next.spieler[0].blatt };
    oldTimer();
    assert.deepEqual(alice("kniffel:state").spieler[0].blatt, sheet);
    assert.equal(alice("kniffel:eintragen", { feld: "chance" }).ok, true);
    const bobAgain = bob("kniffel:state");
    assert.equal(bobAgain.zugBis, bobDeadline);
    const bobSheet = { ...bobAgain.spieler[1].blatt };
    oldBobTimer();
    assert.deepEqual(bob("kniffel:state").spieler[1].blatt, bobSheet);
  } finally {
    Date.now = original.now;
    global.setTimeout = original.timeout;
    global.clearTimeout = original.clear;
    global.setInterval = original.interval;
  }
});
