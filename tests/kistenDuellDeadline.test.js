"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("expired crate duel cannot be joined and refunds its creator immediately", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-kdl-test-"));
  const originalInterval = global.setInterval;
  const originalNow = Date.now;
  let now = 1_000_000_000;
  try {
    fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
    const { setupKistenDuell, waehlbar } = require(path.join(root, "game/kistenDuell"));
    const accountsByKey = { alice: { name: "Alice", chips: 100_000 }, bob: { name: "Bob", chips: 100_000 } };
    const accounts = {
      get: (key) => accountsByKey[key], publicAccount: (account) => account, save() {},
      adjustChips(key, amount) {
        const account = accountsByKey[key];
        account.chips += amount;
        return { ok: true, account };
      },
    };
    const handlers = new Map();
    const connected = new Map();
    const accountUpdates = [];
    const io = { on(event, fn) { handlers.set(event, fn); }, emit() {}, of() { return { sockets: connected }; } };
    global.setInterval = () => ({ unref() {} });
    Date.now = () => now;
    setupKistenDuell(io, accounts);
    function player(key) {
      const events = new Map();
      const socket = { data: { account: key }, on(event, fn) { events.set(event, fn); },
        emit(event, payload) { if (event === "account:update") accountUpdates.push({ key, chips: payload.account.chips }); } };
      connected.set(key, socket);
      handlers.get("connection")(socket);
      return (event, data) => {
        let result;
        if (data === undefined) events.get(event)((answer) => { result = answer; });
        else events.get(event)(data, (answer) => { result = answer; });
        return result;
      };
    }
    const alice = player("alice"), bob = player("bob");
    const crate = waehlbar()[0];
    assert.ok(crate);
    const created = alice("kdl:erstelle", { einsatz: 1000, budget: crate.preis, kisten: [crate.id] });
    assert.equal(created.ok, true);
    assert.equal(accountsByKey.alice.chips, 99_000);
    now = created.duell.bisAt;
    assert.equal(bob("kdl:beitreten", { id: created.id, kisten: [crate.id] }).ok, false);
    assert.equal(accountsByKey.alice.chips, 100_000);
    assert.equal(accountsByKey.bob.chips, 100_000);
    assert.deepEqual(accountUpdates, [{ key: "alice", chips: 100_000 }]);
    assert.deepEqual(alice("kdl:state").duelle, []);
    assert.equal(bob("kdl:beitreten", { id: created.id, kisten: [crate.id] }).ok, false);
    assert.equal(accountsByKey.alice.chips, 100_000);
  } finally {
    global.setInterval = originalInterval;
    Date.now = originalNow;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
