"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-lottery-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
const lottery = require(path.join(root, "game/lotterie"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("lottery caps paid tickets per draw without counting gifted tickets", () => {
  const handlers = new Map();
  const account = { name: "Alice", chips: 100_000, strafen: { deckel: { wert: 4000, bis: 0 } } };
  const accounts = {
    get: () => account,
    adjustChips(key, amount) {
      account.chips += amount;
      return { ok: true, account };
    },
  };
  const socket = { data: { account: "alice" }, on(event, fn) { handlers.set(event, fn); } };
  lottery.setupLotterie({ on(event, fn) { if (event === "connection") fn(socket); }, emit() {} }, accounts);
  const gift = lottery.schenkeLos("alice");
  assert.equal(gift.ok, true);
  const candidates = [[1, 2, 3, 4], [1, 2, 3, 5], [1, 2, 3, 6], [1, 2, 3, 7]]
    .filter((tip) => tip.join() !== gift.tipps[0].join());
  function buy(zahlen) {
    let result;
    handlers.get("lotterie:kaufen")({ zahlen }, (value) => { result = value; });
    return result;
  }
  for (const invalid of [[1.5, 2, 3, 4], [1, 2, 3, 4, 4], ["", 2, 3, 4]]) {
    assert.equal(buy(invalid).ok, false);
    assert.equal(account.chips, 100_000);
  }
  assert.equal(buy(candidates[0]).ok, true);
  assert.equal(buy(candidates[1]).ok, true);
  const third = buy(candidates[2]);
  assert.equal(third.ok, false);
  assert.match(third.error, /gedeckelt/);
  assert.equal(account.chips, 96_000);
  const saved = JSON.parse(fs.readFileSync(path.join(root, "data/lotterie.json"), "utf8"));
  assert.equal(saved.lose.alice.length, 3);
  assert.equal(saved.gekauft.alice, 2);
  const modulePath = require.resolve(path.join(root, "game/lotterie"));
  delete require.cache[modulePath];
  require(modulePath).setupLotterie({ on(event, fn) { if (event === "connection") fn(socket); }, emit() {} }, accounts);
  assert.equal(buy(candidates[2]).ok, false);
  assert.equal(account.chips, 96_000);
});
