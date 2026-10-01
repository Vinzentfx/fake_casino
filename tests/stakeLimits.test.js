"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { einsatzFehler, bremse } = require("../game/strafen");
const { setupSlots } = require("../game/slots");
const { setupBlackjack } = require("../game/blackjack");
const { setupRouletteLobby } = require("../game/rouletteLobby");
const { setupSolitaire } = require("../game/solitaire");

function fixture() {
  const handlers = new Map();
  const emitted = [];
  const socket = { data: { account: "alice" }, on(event, fn) { handlers.set(event, fn); }, emit(...args) { emitted.push(args); } };
  const io = { on(event, fn) { if (event === "connection") fn(socket); } };
  const account = { name: "alice", chips: 100_000, strafen: { deckel: { wert: 150, bis: 0 } } };
  const accounts = {
    get: () => account,
    isUnlocked: () => true,
    publicAccount: () => account,
    pechTrifft: () => false,
    recordHand() {},
    adjustChips(key, amount) { account.chips += amount; return { ok: true, account }; },
  };
  function call(event, data) {
    let response;
    const ack = (result) => { response = result; };
    handlers.get(event)(...(data === undefined ? [] : [data]), ack);
    return response;
  }
  return { io, socket, account, call, emitted, accounts };
}

test("stake limit compares the full paid obligation", () => {
  const acc = { strafen: { deckel: { wert: 150, bis: 0 } } };
  assert.equal(einsatzFehler(acc, 150), null);
  assert.match(einsatzFehler(acc, 151), /150 Chips/);
  assert.equal(einsatzFehler({}, 999_999), null);
});

test("a failed central restriction check blocks the packet", () => {
  let middleware;
  const socket = { data: { account: "alice" }, use(fn) { middleware = fn; } };
  bremse({ on(event, fn) { if (event === "connection") fn(socket); } }, {
    get() { throw new Error("unavailable"); },
  });
  let passed = false;
  let response;
  const originalError = console.error;
  console.error = () => {};
  try {
    middleware(["slots:spin", { bet: 100 }, (result) => { response = result; }], () => { passed = true; });
  } finally { console.error = originalError; }
  assert.equal(passed, false);
  assert.equal(response.ok, false);
});

test("a game ban allows paid-round settlement but no new stake", () => {
  let middleware;
  const acc = {
    strafen: { spielsperre: { spiele: ["blackjack", "slots", "mines", "roulette"], bis: 0 }, deckel: { wert: 50, bis: 0 } },
    slotBonus: { machineId: "gemstorm", bet: 100, remaining: 3 },
  };
  const socket = { data: { account: "alice" }, use(fn) { middleware = fn; } };
  bremse({ on(event, fn) { if (event === "connection") fn(socket); } }, { get: () => acc });
  function permitted(event, payload = {}) {
    let nextCalled = false;
    let response;
    middleware([event, payload, (r) => { response = r; }], () => { nextCalled = true; });
    return { nextCalled, response };
  }
  assert.equal(permitted("bj:action", { action: "stand" }).nextCalled, true);
  assert.equal(permitted("bj:action", { action: "double" }).nextCalled, false);
  assert.equal(permitted("bj:deal", { bet: 10 }).nextCalled, false);
  assert.equal(permitted("mines:cashout").nextCalled, true);
  assert.equal(permitted("rlobby:clear").nextCalled, true);
  assert.equal(permitted("roulette:spin", { bets: [{ amount: 10 }] }).nextCalled, false);
  assert.equal(permitted("slots:spin", { machineId: "gemstorm", bet: 100, expectedFree: true }).nextCalled, true);
  assert.equal(permitted("slots:spin", { machineId: "lucky7", bet: 10, expectedFree: true }).nextCalled, false);
  assert.equal(permitted("slots:spin", { machineId: "gemstorm", bet: 100, expectedFree: false }).nextCalled, false);
  acc.slotBonus.remaining = 0;
  assert.equal(permitted("slots:spin", { machineId: "gemstorm", bet: 100, expectedFree: true }).nextCalled, false);
});

test("bonus purchase checks its 18x price before charging or granting spins", () => {
  const f = fixture();
  setupSlots(f.io, f.accounts);
  const before = f.account.chips;
  const response = f.call("slots:buyBonus", { machineId: "gemstorm", bet: 100 });
  assert.equal(response.ok, false);
  assert.match(response.error, /gedeckelt/);
  assert.equal(f.account.chips, before);
  assert.equal(f.account.slotBonus, undefined);
});

test("blackjack double checks the total stake and leaves the hand playable", () => {
  const f = fixture();
  setupBlackjack(f.io, f.accounts);
  let active = false;
  for (let attempt = 0; attempt < 12 && !active; attempt++) {
    assert.equal(f.call("bj:deal", { bet: 100 }).ok, true);
    active = f.emitted.at(-1)?.[1]?.phase === "player";
  }
  assert.equal(active, true);
  const before = f.account.chips;
  const repeatedDeal = f.call("bj:deal", { bet: 100 });
  assert.equal(repeatedDeal.ok, false);
  assert.match(repeatedDeal.error, /laufende Hand/);
  assert.equal(f.account.chips, before);
  const response = f.call("bj:action", { action: "double" });
  assert.equal(response.ok, false);
  assert.match(response.error, /gedeckelt/);
  assert.equal(f.account.chips, before);
  assert.equal(f.call("bj:action", { action: "stand" }).ok, true);
});

test("a paid solitaire round cannot be replaced by a new or free game", () => {
  const f = fixture();
  setupSolitaire(f.io, f.accounts);
  const first = f.call("sol:start", { bet: 100, free: false });
  assert.equal(first.ok, true);
  const before = f.account.chips;
  const state = f.socket.data.solitaire;
  assert.equal(f.call("sol:start", { bet: 100, free: false }).ok, false);
  assert.equal(f.call("sol:start", { free: true }).ok, false);
  assert.equal(f.account.chips, before);
  assert.equal(f.socket.data.solitaire, state);
  assert.equal(f.call("sol:giveup").ok, true);
  assert.equal(f.call("sol:start", { free: true }).ok, true);
});

test("roulette lobby caps the sum and still refunds an existing stake", () => {
  const f = fixture();
  f.account.strafen.deckel.wert = 75;
  f.socket.join = () => {};
  f.socket.leave = () => {};
  setupRouletteLobby(f.io, f.accounts);
  assert.equal(f.call("rlobby:create").ok, true);
  const before = f.account.chips;
  assert.equal(f.call("rlobby:bet", { type: "red", amount: 50 }).ok, true);
  const second = f.call("rlobby:bet", { type: "black", amount: 50 });
  assert.equal(second.ok, false);
  assert.match(second.error, /gedeckelt/);
  assert.equal(f.account.chips, before - 50);
  assert.equal(f.call("rlobby:clear").ok, true);
  assert.equal(f.account.chips, before);
  f.call("rlobby:leave");
});
