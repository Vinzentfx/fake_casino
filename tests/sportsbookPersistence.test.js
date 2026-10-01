"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-sports-test-"));
  fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
  return { root, file: path.join(root, "data/sports.json"), module: path.join(root, "game/sportsbook") };
}

function setup(modulePath, account, handlers = new Map()) {
  const socket = { data: { account: "alice" }, on(event, fn) { handlers.set(event, fn); }, emit() {} };
  const io = {
    on(event, fn) { if (event === "connection") fn(socket); },
    emit() {},
    of() { return { sockets: new Map() }; },
  };
  const accounts = {
    get() { return account; },
    publicAccount(a) { return a; },
    buffMult() { return 1; },
    recordHand() {},
    adjustChips(_key, amount) {
      account.chips += amount;
      return { ok: true, account };
    },
  };
  const originalInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  try {
    delete require.cache[require.resolve(modulePath)];
    require(modulePath).setupSportsbook(io, accounts);
  } finally {
    global.setInterval = originalInterval;
  }
  function call(event, data) {
    let answer;
    handlers.get(event)(...(data === undefined ? [] : [data]), (value) => { answer = value; });
    return answer;
  }
  return { call };
}

test("restored sport bets survive another restart while refunded bets are not refunded twice", () => {
  const box = sandbox();
  const oldSim = process.env.SPORTS_SIM;
  process.env.SPORTS_SIM = "off";
  try {
    fs.mkdirSync(path.dirname(box.file), { recursive: true });
    fs.writeFileSync(box.file, JSON.stringify({
      singles: [
        { id: "sim", user: "alice", amount: 150, matchId: 1 },
        { id: "real", user: "alice", amount: 250, matchId: 1_000_000_001 },
      ],
      combos: [{ id: "orphan", user: "alice", amount: 300, settled: false, legs: [{ matchId: 2 }] }],
      matchResults: [],
    }));
    const account = { name: "Alice", chips: 1000 };
    setup(box.module, account);
    assert.equal(account.chips, 1450);
    let saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
    assert.deepEqual(saved.singles.map((b) => b.id), ["real"]);
    assert.deepEqual(saved.combos, []);

    setup(box.module, account);
    assert.equal(account.chips, 1450);
    saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
    assert.deepEqual(saved.singles.map((b) => b.id), ["real"]);
  } finally {
    if (oldSim === undefined) delete process.env.SPORTS_SIM;
    else process.env.SPORTS_SIM = oldSim;
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

test("placing and cashing out a sport bet updates the recovery snapshot immediately", () => {
  const box = sandbox();
  const oldSim = process.env.SPORTS_SIM;
  delete process.env.SPORTS_SIM;
  try {
    const account = { name: "Alice", chips: 1000 };
    const { call } = setup(box.module, account);
    const match = call("sports:state").matches.find((m) => m.state === "open");
    assert.ok(match);
    const other = call("sports:state").matches.find((m) => m.id !== match.id && m.state === "open");
    assert.ok(other);
    for (const invalid of [
      { market: "1x2", selection: "toString" },
      { market: "1x2", selection: "__proto__" },
      { market: "__proto__", selection: "home" },
    ]) {
      assert.equal(call("sports:bet", { matchId: match.id, ...invalid, amount: 100 }).ok, false);
      assert.equal(account.chips, 1000);
    }
    assert.equal(call("sports:combo", { legs: [
      { matchId: match.id, market: "1x2", selection: "constructor" },
      { matchId: other.id, market: "1x2", selection: "home" },
    ], amount: 100 }).ok, false);
    assert.equal(account.chips, 1000);
    assert.equal(call("sports:bet", { matchId: match.id, market: "1x2", selection: "home", amount: 100 }).ok, true);
    let saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
    assert.equal(saved.singles.length, 1);
    const betId = saved.singles[0].id;

    assert.equal(call("sports:cashout", { matchId: match.id, betId }).ok, true);
    saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
    assert.equal(saved.singles.length, 0);

    assert.equal(call("sports:bet", { matchId: match.id, market: "1x2", selection: "home", amount: 100 }).ok, true);
    saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
    assert.equal(saved.singles.length, 1);
    const lateBetId = saved.singles[0].id;

    // Der 1-Sekunden-Takt wurde im Test angehalten: der angezeigte Zustand ist
    // noch "open", obwohl die Uhr schon hinter dem Anpfiff liegt.
    const now = Date.now;
    Date.now = () => now() + 200_000;
    try {
      const before = account.chips;
      assert.equal(call("sports:bet", { matchId: match.id, market: "1x2", selection: "home", amount: 100 }).ok, false);
      assert.equal(call("sports:combo", { legs: [
        { matchId: match.id, market: "1x2", selection: "home" },
        { matchId: other.id, market: "1x2", selection: "home" },
      ], amount: 100 }).ok, false);
      assert.equal(call("sports:cashout", { matchId: match.id, betId: lateBetId }).ok, false);
      assert.equal(account.chips, before);
      saved = JSON.parse(fs.readFileSync(box.file, "utf8"));
      assert.deepEqual(saved.singles.map((bet) => bet.id), [lateBetId]);
    } finally {
      Date.now = now;
    }
  } finally {
    if (oldSim === undefined) delete process.env.SPORTS_SIM;
    else process.env.SPORTS_SIM = oldSim;
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});

test("an invalid football-data token is diagnosed without showing the token", async () => {
  const box = sandbox();
  const oldSim = process.env.SPORTS_SIM;
  const oldComps = process.env.FOOTBALL_DATA_COMPS;
  const oldToken = process.env.FOOTBALL_DATA_TOKEN;
  const originalFetch = global.fetch;
  const originalTimeout = global.setTimeout;
  process.env.SPORTS_SIM = "off";
  process.env.FOOTBALL_DATA_COMPS = "BL1";
  delete process.env.FOOTBALL_DATA_TOKEN;
  try {
    fs.mkdirSync(path.dirname(box.file), { recursive: true });
    fs.writeFileSync(path.join(box.root, "data/sport-zugang.json"), JSON.stringify({ token: "invalid-test-token" }));
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: "Your API token is invalid." }) });
    global.setTimeout = (fn) => { queueMicrotask(fn); return { unref() {} }; };
    setup(box.module, { name: "Alice", chips: 1000 });
    await new Promise((resolve) => originalTimeout(resolve, 20));
    const status = require(box.module).diagnose();
    assert.equal(status.proWettbewerb.BL1.status, 400);
    assert.match(status.fehler, /Schlüssel ist ungültig/);
    assert.doesNotMatch(JSON.stringify(status), /invalid-test-token/);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
    if (oldSim === undefined) delete process.env.SPORTS_SIM; else process.env.SPORTS_SIM = oldSim;
    if (oldComps === undefined) delete process.env.FOOTBALL_DATA_COMPS; else process.env.FOOTBALL_DATA_COMPS = oldComps;
    if (oldToken === undefined) delete process.env.FOOTBALL_DATA_TOKEN; else process.env.FOOTBALL_DATA_TOKEN = oldToken;
    fs.rmSync(box.root, { recursive: true, force: true });
  }
});
