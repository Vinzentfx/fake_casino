"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("failed puzzle creation keeps the stake and late submissions cannot change the result", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-duell-test-"));
  const originalInterval = global.setInterval;
  const originalNow = Date.now;
  let now = 1_000_000_000;
  try {
    fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
    const duelle = require(path.join(root, "game/asyncDuell"));
    const players = { alice: { name: "Alice", chips: 1000 }, bob: { name: "Bob", chips: 1000 } };
    const accounts = {
      get: (key) => players[key], publicAccount: (account) => account,
      adjustChips(key, amount) {
        players[key].chips += amount;
        return { ok: true, account: players[key] };
      },
    };
    global.setInterval = () => ({ unref() {} });
    Date.now = () => now;
    duelle.setup({ on() {}, emit() {}, of() { return { sockets: new Map() }; } }, accounts);
    duelle.registriere({ id: "test", label: "Test", erzeuge() { throw new Error("generation failed"); } });
    assert.equal(duelle.erstelle("alice", { spiel: "test", einsatz: 50 }).ok, false);
    assert.equal(players.alice.chips, 1000);
    assert.equal(duelle.publicState("alice").meine.length, 0);

    duelle.registriere({ id: "test", label: "Test", erzeuge() { return { aufgabe: {}, geheim: {} }; },
      bewerte() { return { punkte: 1, ms: 0 }; } });
    const expiredCreator = duelle.erstelle("alice", { spiel: "test", einsatz: 50 });
    assert.equal(expiredCreator.ok, true);
    now = expiredCreator.bisAt + 1;
    assert.equal(duelle.gibAb("alice", expiredCreator.id, {}).ok, false);
    assert.equal(players.alice.chips, 1000);

    const duel = duelle.erstelle("alice", { spiel: "test", einsatz: 50 });
    assert.equal(duelle.gibAb("alice", duel.id, {}).ok, true);
    const accepted = duelle.nimmAn("bob", duel.id);
    assert.equal(accepted.ok, true);
    now = accepted.bisAt + 1;
    assert.equal(duelle.gibAb("bob", duel.id, {}).ok, false);
    assert.equal(players.alice.chips, 1040);
    assert.equal(players.bob.chips, 950);
    assert.equal(duelle.gibAb("bob", duel.id, {}).ok, false);
    assert.equal(players.alice.chips, 1040);
  } finally {
    global.setInterval = originalInterval;
    Date.now = originalNow;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
