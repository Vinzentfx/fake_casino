"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupCrash } = require("../game/crash");
const regie = require("../game/regie");

test("Crash closes betting at the deadline and never pays at the crash point", () => {
  const actualNow = Date.now;
  const actualInterval = global.setInterval;
  let now = 1_000_000;
  let tick;
  Date.now = () => now;
  global.setInterval = (fn) => { tick = fn; return { unref() {} }; };
  const balances = { alice: 1000, bob: 1000, charlie: 1000, dave: 1000 };
  const hands = [];
  const accounts = {
    get(key) { return balances[key] == null ? null : { name: key, chips: balances[key] }; },
    publicAccount(acc) { return acc; },
    adjustChips(key, delta) {
      balances[key] += delta;
      return { ok: true, account: this.get(key) };
    },
    recordHand(key, net) { hands.push({ key, net }); },
  };
  const connect = [];
  const sockets = new Map();
  const io = {
    on(event, fn) { if (event === "connection") connect.push(fn); },
    emit() {},
    of() { return { sockets }; },
  };
  try {
    setupCrash(io, accounts);
    function player(key) {
      const handlers = new Map();
      const socket = { data: { account: key }, on(event, fn) { handlers.set(event, fn); }, emit() {} };
      sockets.set(key, socket);
      connect[0](socket);
      return (event, payload) => {
        let answer;
        const ack = (value) => { answer = value; };
        if (payload === undefined) handlers.get(event)(ack);
        else handlers.get(event)(payload, ack);
        return answer;
      };
    }
    const alice = player("alice");
    const bob = player("bob");
    const charlie = player("charlie");
    const dave = player("dave");
    assert.equal(dave("crash:bet", { amount: 100, target: 120 }).ok, false);
    assert.equal(balances.dave, 1000);
    assert.equal(alice("crash:bet", { amount: 100, target: 2 }).ok, true);
    assert.equal(bob("crash:bet", { amount: 100, target: 1.5 }).ok, true);
    assert.equal(charlie("crash:bet", { amount: 100 }).ok, true);

    now += 7000; // Der Takt hat die Phase noch nicht umgeschaltet.
    assert.equal(dave("crash:bet", { amount: 100 }).ok, false);
    assert.equal(balances.dave, 1000);

    assert.equal(regie.setze(regie.GLOBAL, "crash", 2).ok, true);
    tick(); // Flug beginnt jetzt.
    const flightStart = now;
    now = flightStart + Math.ceil(Math.log(1.5) / 0.00013) + 1;
    tick();
    assert.ok(balances.bob > 900, "ein Ziel vor dem Crashpunkt wird ausgezahlt");

    now = flightStart + Math.ceil(Math.log(2) / 0.00013);
    assert.equal(charlie("crash:cashout").ok, false, "manuelle Auszahlung am Crashpunkt ist zu spät");
    tick();
    assert.equal(alice("crash:state").phase, "crashed");
    assert.equal(balances.alice, 900, "Auto-Auszahlung genau am Crashpunkt verliert");
    assert.ok(hands.some((h) => h.key === "alice" && h.net === -100));
    assert.ok(hands.some((h) => h.key === "charlie" && h.net === -100));
  } finally {
    regie.loesche(regie.GLOBAL, "crash");
    Date.now = actualNow;
    global.setInterval = actualInterval;
  }
});
