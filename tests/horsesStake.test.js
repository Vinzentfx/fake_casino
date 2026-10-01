"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Die Rennbahn speichert Daten beim Start; der Test verwendet nur eine Kopie.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-horses-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
const { setupHorses, _internals } = require(path.join(root, "game/horses"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("horse race enforces cumulative stakes and the betting deadline", () => {
  const handlers = new Map();
  const socket = { data: { account: "alice" }, on(event, fn) { handlers.set(event, fn); }, emit() {} };
  const io = { on(event, fn) { if (event === "connection") fn(socket); }, emit() {}, of() { return { sockets: new Map() }; } };
  const account = { name: "Alice", chips: 100_000, strafen: { deckel: { wert: 75, bis: 0 } } };
  const accounts = {
    get: () => account,
    rawAll: () => [account],
    publicAccount: () => account,
    recordHand() {},
    adjustChips(key, amount) {
      if (account.chips + amount < 0) return { ok: false, error: "Nicht genug Chips." };
      account.chips += amount;
      return { ok: true, account };
    },
  };
  let startRound;
  const originalTimeout = global.setTimeout, originalInterval = global.setInterval;
  global.setTimeout = (fn, delay) => { if (delay === 2500) startRound = fn; return { unref() {} }; };
  global.setInterval = () => ({ unref() {} });
  try {
    setupHorses(io, accounts);
    startRound();
  } finally {
    global.setTimeout = originalTimeout;
    global.setInterval = originalInterval;
  }
  function call(event, data) {
    let answer;
    const ack = (result) => { answer = result; };
    handlers.get(event)(...(data === undefined ? [] : [data]), ack);
    return answer;
  }
  const state = call("horses:state");
  assert.ok(state.field.length >= 2);
  const before = account.chips;
  assert.equal(call("horses:bet", { lane: 0, type: "win", amount: 50 }).ok, true);
  const second = call("horses:bet", { lane: 1, type: "place", amount: 50 });
  assert.equal(second.ok, false);
  assert.match(second.error, /gedeckelt/);
  assert.equal(account.chips, before - 50);
  assert.equal(call("horses:state").myBets.length, 1);

  const actualNow = Date.now;
  const chipsBeforeClosedBet = account.chips;
  Date.now = () => actualNow() + 1_000_000;
  try {
    const lateBet = call("horses:bet", { lane: 0, type: "win", amount: 50 });
    assert.equal(lateBet.ok, false);
    assert.match(lateBet.error, /Wetten sind zu/);
    assert.equal(account.chips, chipsBeforeClosedBet);
  } finally {
    Date.now = actualNow;
  }

  account.strafen.deckel.wert = 3000;
  const firstHorse = _internals.newHorse(0.5), secondHorse = _internals.newHorse(0.5);
  firstHorse.owner = "alice"; secondHorse.owner = "alice";
  const afterBet = account.chips;
  assert.equal(call("horses:enter", { horseId: firstHorse.id, tactic: "stayer" }).ok, true);
  const secondEntry = call("horses:enter", { horseId: secondHorse.id, tactic: "stayer" });
  assert.equal(secondEntry.ok, false);
  assert.match(secondEntry.error, /gedeckelt/);
  assert.equal(account.chips, afterBet - 2000);
});
