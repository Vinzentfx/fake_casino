"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupRoulette } = require("../game/roulette");
const { setupRouletteLobby } = require("../game/rouletteLobby");

function fixture(setup) {
  const handlers = new Map();
  const account = { name: "Alice", chips: 1000 };
  const socket = {
    data: { account: "alice" },
    on(event, fn) { handlers.set(event, fn); },
    emit() {}, join() {}, leave() {},
  };
  const io = { on(event, fn) { if (event === "connection") fn(socket); }, emit() {} };
  const accounts = {
    get() { return account; },
    pechTrifft() { return false; },
    publicAccount() { return account; },
    recordHand() {},
    adjustChips(_key, delta) {
      account.chips += delta;
      return { ok: true, account };
    },
  };
  setup(io, accounts);
  function call(event, payload) {
    let response;
    const ack = (r) => { response = r; };
    if (payload === undefined) handlers.get(event)(ack);
    else handlers.get(event)(payload, ack);
    return response;
  }
  return { call, account };
}

test("solo roulette rejects impossible numbered bets without taking chips", () => {
  const { call, account } = fixture(setupRoulette);
  const invalid = [
    { type: "number", amount: 50 },
    { type: "number", amount: 50, value: null },
    { type: "number", amount: 50, value: " " },
    { type: "number", amount: 50, value: "not-a-number" },
    { type: "number", amount: 50, value: 1.5 },
    { type: "dozen", amount: 50, value: NaN },
    { type: "column", amount: 50, value: true },
    null,
  ];
  for (const bet of invalid) {
    assert.equal(call("roulette:spin", { bets: [bet] }).ok, false);
    assert.equal(account.chips, 1000);
  }
});

test("roulette lobby rejects the same invalid bets and still accepts zero", () => {
  const { call, account } = fixture(setupRouletteLobby);
  assert.equal(call("rlobby:create").ok, true);
  const invalid = [
    { type: "number", amount: 50 },
    { type: "number", amount: 50, value: null },
    { type: "number", amount: 50, value: " " },
    { type: "number", amount: 50, value: "not-a-number" },
    { type: "dozen", amount: 50, value: NaN },
    { type: "column", amount: 50, value: 1.5 },
    null,
  ];
  for (const bet of invalid) {
    assert.equal(call("rlobby:bet", bet).ok, false);
    assert.equal(account.chips, 1000);
  }
  assert.equal(call("rlobby:bet", { type: "number", amount: 50, value: 0 }).ok, true);
  assert.equal(account.chips, 950);
  assert.equal(call("rlobby:clear").ok, true);
  assert.equal(account.chips, 1000);
});
