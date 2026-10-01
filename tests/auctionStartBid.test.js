"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("invalid auction starting bids keep the piece and its listing fee", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-auction-test-"));
  const originalInterval = global.setInterval;
  try {
    fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
    const cosmetics = require(path.join(root, "game/cosmetics"));
    const praegung = require(path.join(root, "game/praegung"));
    const auction = require(path.join(root, "game/auktion"));
    const account = { name: "Alice", chips: 100_000 };
    assert.equal(cosmetics.grant(account, "style", "kiste_lack", "alice"), true);
    const piece = praegung.stueckVon("alice", "style", "kiste_lack");
    assert.ok(piece);
    const handlers = new Map();
    const io = { on(event, fn) { handlers.set(event, fn); }, emit() {}, of() { return { sockets: new Map() }; } };
    const accounts = {
      get: () => account, publicAccount: (a) => a, save() {},
      adjustChips(_key, amount) { account.chips += amount; return { ok: true, account }; },
    };
    global.setInterval = () => ({ unref() {} });
    auction.setupAuktion(io, accounts);
    const events = new Map();
    handlers.get("connection")({ data: { account: "alice" }, on(event, fn) { events.set(event, fn); } });
    function list(start) {
      let result;
      events.get("auktion:einliefern")({ uid: piece.uid, mindest: start }, (answer) => { result = answer; });
      return result;
    }
    for (const invalid of [NaN, Infinity, -1, 50_000.5]) {
      assert.equal(list(invalid).ok, false);
      assert.equal(account.chips, 100_000);
      assert.equal(account.cosOwned.styles.includes("kiste_lack"), true);
      assert.equal(auction.istHinterlegt(piece.uid), false);
    }
    assert.equal(list(75_000).ok, true);
    assert.equal(account.chips, 75_000);
    assert.equal(account.cosOwned.styles.includes("kiste_lack"), false);
    assert.equal(auction.istHinterlegt(piece.uid), true);
  } finally {
    global.setInterval = originalInterval;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
