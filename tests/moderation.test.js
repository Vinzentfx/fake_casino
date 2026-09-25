"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const moderation = require("../game/moderation");
const { setupVerification } = require("../game/verification");

function fixture() {
  const players = new Map([
    ["vincent", { name: "Vincent" }],
    ["helper", { name: "Helper", rolle: "mod", modLevel: 1 }],
    ["mod", { name: "Mod", rolle: "mod" }], // legacy moderator
    ["lead", { name: "Lead", rolle: "mod", modLevel: 3 }],
    ["guest", { name: "Guest" }],
  ]);
  const sockets = new Map();
  const connectionHandlers = [];
  const io = { on(name, fn) { if (name === "connection") connectionHandlers.push(fn); }, of() { return { sockets }; } };
  const accounts = {
    get: (key) => players.get(String(key || "").toLowerCase()) || null,
    kanonisch: (key) => players.has(String(key || "").toLowerCase()) ? String(key).toLowerCase() : null,
    rawAll: () => [...players.values()],
    publicAccount: (a) => ({ name: a.name, verification: a.verification || null }),
    save() {},
  };
  setupVerification(io, accounts);
  function connect(key) {
    const handlers = new Map();
    const middleware = [];
    const emitted = [];
    const socket = { data: { account: key }, on: (event, fn) => handlers.set(event, fn), use: (fn) => middleware.push(fn), emit: (...args) => emitted.push(args) };
    sockets.set(key, socket);
    for (const fn of connectionHandlers) fn(socket);
    return {
      emitted,
      call(event, payload = {}) {
        let response;
        const packet = [event, payload, (r) => { response = r; }];
        let allowed = false;
        middleware[0](packet, () => { allowed = true; });
        if (allowed) handlers.get(event)?.(packet[1], packet[2]);
        return { allowed, response };
      },
    };
  }
  return { players, connect };
}

test("legacy mods retain level 2 and ranks are bounded", () => {
  assert.equal(moderation.level({ rolle: "mod" }, "mod"), 2);
  assert.equal(moderation.level({ rolle: "mod", modLevel: 1 }, "helper"), 1);
  assert.equal(moderation.level({ rolle: "mod", modLevel: 3 }, "lead"), 3);
  assert.equal(moderation.level({}, "vincent"), 4);
  assert.equal(moderation.level({ modLevel: 99 }, "other"), 0);
});

test("helper can classify but cannot hold or approve; team accounts are protected", () => {
  const { connect, players } = fixture();
  const helper = connect("helper");
  assert.equal(helper.call("admin:identitySet", { target: "guest", known: false }).response.ok, true);
  assert.equal(helper.call("admin:identityHold", { target: "guest" }).response.ok, false);
  assert.equal(helper.call("admin:identitySet", { target: "mod", known: false }).response.ok, false);
  assert.equal(players.get("guest").identity.known, false);
});

test("hold blocks game packets, submission waits for review, approval restores access", () => {
  const originalRecord = moderation.record;
  moderation.record = () => {};
  try {
    const { connect, players } = fixture();
    const mod = connect("mod"), guest = connect("guest");
    assert.equal(mod.call("admin:identityHold", { target: "guest" }).response.ok, true);
    assert.equal(mod.call("admin:identityReview", { target: "guest", action: "approve" }).response.ok, false);
    assert.equal(guest.call("game:spin").allowed, false);
    assert.equal(guest.call("auth").allowed, true);
    assert.equal(guest.call("verification:submit", { realName: "Alex Test", grade: "10b" }).response.ok, true);
    assert.equal(players.get("guest").verification.status, "pending");
    assert.equal(guest.call("verification:submit", { realName: "Someone Else", grade: "12" }).response.ok, false);
    assert.equal(mod.call("admin:identityReview", { target: "guest", action: "reject" }).response.ok, true);
    assert.equal(mod.call("admin:identityReview", { target: "guest", action: "approve" }).response.ok, false);
    assert.equal(guest.call("verification:submit", { realName: "Alex Test", grade: "10b" }).response.ok, true);
    assert.equal(mod.call("admin:identityReview", { target: "guest", action: "approve" }).response.ok, true);
    assert.equal(players.get("guest").identity.known, true);
    assert.equal(guest.call("game:spin").allowed, true);
  } finally { moderation.record = originalRecord; }
});

test("only lead or owner can choose browser ban", () => {
  const { connect } = fixture();
  const mod = connect("mod"), lead = connect("lead");
  mod.call("admin:identityHold", { target: "guest" });
  assert.match(mod.call("admin:identityReview", { target: "guest", action: "banDevice" }).response.error, /Leitmoderation/);
  assert.match(lead.call("admin:identityReview", { target: "guest", action: "banDevice" }).response.error, /kein Browser-Gerät/);
});

test("audit logs only successful changes, without private identity values", () => {
  const originalRecord = moderation.record;
  const entries = [];
  moderation.record = (entry) => entries.push(entry);
  try {
    const socket = { data: { account: "mod" }, use(fn) { this.middleware = fn; } };
    moderation.auditSocket(socket, { get: () => ({ name: "Mod" }) });
    const call = (event, payload, result) => {
      let response;
      const packet = [event, payload, (r) => { response = r; }];
      socket.middleware(packet, () => {});
      packet[2](result);
      return response;
    };
    call("admin:listAccounts", {}, { ok: true });
    call("admin:identitySet", { target: "guest", realName: "Private Person", grade: "10b", known: true }, { ok: false });
    assert.equal(entries.length, 0);
    call("admin:identitySet", { target: "guest", realName: "Private Person", grade: "10b", known: true }, { ok: true });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actor, "Mod");
    assert.equal(entries[0].target, "guest");
    assert.doesNotMatch(JSON.stringify(entries[0]), /Private Person|10b/);
  } finally { moderation.record = originalRecord; }
});
