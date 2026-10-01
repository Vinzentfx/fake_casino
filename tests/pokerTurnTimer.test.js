"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PokerTable } = require("../game/pokerTable");
const { scheduleTurnTimer } = require("../game/pokerTurnTimer");

function setup() {
  let now = 0, id = 0;
  const pending = new Map();
  const clock = { Date: { now: () => now }, setTimeout(fn, ms) { pending.set(++id, { fn, at: now + ms }); return id; }, clearTimeout(k) { pending.delete(k); } };
  const table = new PokerTable("TEST");
  table.sit("a", "Alice", 1000); table.sit("b", "Bob", 1000);
  assert.equal(table.startHand(), true);
  const entry = { table };
  const schedule = () => scheduleTurnTimer(entry, { duration: 30000, isPresent: () => true, onExpire: schedule, clock });
  const advance = ms => { now += ms; for (const [k,t] of [...pending]) if (t.at <= now) { pending.delete(k); t.fn(); } };
  return { table, entry, schedule, advance, pending };
}

test("invalid actions and repeated broadcasts cannot extend a poker turn", () => {
  const f = setup(); f.schedule(); const original = f.entry.turnDeadline;
  const actor = f.table.seats[f.table.toAct].id;
  for (let i=0; i<29; i++) {
    f.advance(1000);
    assert.equal(f.table.act(actor, "invalid", 0).ok, false);
    f.schedule(); assert.equal(f.entry.turnDeadline, original);
  }
  assert.equal(f.pending.size, 1);
  f.advance(1000);
  assert.equal(f.table.handActive, false); // Uncalled heads-up blind: automatic fold.
  assert.equal(f.entry.turnDeadline, null);
});

test("a valid action starts the next deadline and stale callbacks do not act", () => {
  const f = setup(); f.schedule(); const stale = [...f.pending.values()][0].fn;
  f.advance(5000);
  const actor = f.table.seats[f.table.toAct].id;
  assert.equal(f.table.act(actor, "call").ok, true);
  f.schedule(); assert.equal(f.entry.turnDeadline, 35000);
  const serial = f.table.turnSerial;
  stale(); assert.equal(f.table.turnSerial, serial);
  assert.equal(f.entry.turnDeadline, 35000);
  f.advance(30000);
  assert.equal(f.table.stage, "flop"); // Big blind can check for free at expiry.
  assert.equal(f.entry.turnDeadline, 65000);
});

test("a fresh hand has a new deadline even when the same seat acts", () => {
  const f = setup(); f.schedule(); const serial = f.table.turnSerial;
  f.table.act(f.table.seats[f.table.toAct].id, "fold"); f.schedule();
  f.advance(5000); assert.equal(f.table.startHand(), true); f.schedule();
  assert.ok(f.table.turnSerial > serial);
  assert.equal(f.entry.turnDeadline, 35000);
});
