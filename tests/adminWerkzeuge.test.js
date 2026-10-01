"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-admin-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
const cosmetics = require(path.join(root, "game/cosmetics"));
const season = require(path.join(root, "game/season"));
const { setupAdmin } = require(path.join(root, "game/admin"));
const { OWNER } = require(path.join(root, "game/moderation"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function verbinde(key) {
  const handlers = new Map(), middleware = [];
  const socket = { data: { account: key }, rooms: new Set(), on(e, f) { handlers.set(e, f); return this; }, use(f) { middleware.push(f); }, emit() {} };
  const io = { on(e, f) { if (e === "connection") f(socket); }, emit() {}, of() { return { sockets: new Map() }; }, to() { return { emit() {} }; } };
  setupAdmin(io, accounts);
  season.setupSeason(io, accounts);
  return (e, payload) => {
    let antwort;
    const ack = (r) => { antwort = r; };
    let at = 0;
    const next = () => { if (at < middleware.length) middleware[at++]([e, payload, ack], next); else handlers.get(e)?.(payload, ack); };
    next();
    return antwort;
  };
}

accounts.login(OWNER, "Besitzer2026");
accounts.login("XpTest", "Passwort2026");
const owner = verbinde(OWNER);
const spieler = verbinde("xptest");

test("Level-XP geben und nehmen, nie unter null, nur der Besitzer", () => {
  assert.equal(spieler("admin:xp", { target: "XpTest", art: "level", delta: 500 }).ok, false);
  const r = owner("admin:xp", { target: "XpTest", art: "level", delta: 2500 });
  assert.equal(r.ok, true);
  assert.equal(accounts.get("xptest").xp, 2500);
  assert.equal(r.level, accounts.publicAccount(accounts.get("xptest")).level.level);
  assert.equal(owner("admin:xp", { target: "XpTest", art: "level", delta: -99999 }).xp, 0);
  assert.equal(owner("admin:xp", { target: "XpTest", art: "level", delta: 0 }).ok, false);
  assert.equal(owner("admin:xp", { target: "XpTest", art: "irgendwas", delta: 5 }).ok, false);
});

test("Season-XP geht am Tagesdeckel vorbei und fällt nicht unter null", () => {
  const r = owner("admin:xp", { target: "XpTest", art: "season", delta: 50_000 });
  assert.equal(r.ok, true);
  assert.equal(accounts.get("xptest").season.xp, 50_000);
  assert.equal(owner("admin:xp", { target: "XpTest", art: "season", delta: -60_000 }).xp, 0);
});

test("alle Kosmetik entfernen nimmt Besitz und Angelegtes, aber nicht beim Besitzer selbst", () => {
  const acc = accounts.get("xptest");
  assert.equal(cosmetics.adminGib(acc, "fahrzeug", "simme").ok, true);
  assert.equal(cosmetics.adminGib(acc, "hand", "spezi").ok, true);
  acc.fahrzeug = "simme";
  const r = owner("admin:kosmetikAlle", { target: "XpTest" });
  assert.equal(r.ok, true);
  assert.ok(r.weg >= 2);
  const rest = Object.values(acc.cosOwned).reduce((n, l) => n + l.length, 0);
  assert.equal(rest, 0);
  assert.equal(acc.fahrzeug, undefined);
  assert.equal(owner("admin:kosmetikAlle", { target: OWNER }).ok, false);
  assert.equal(spieler("admin:kosmetikAlle", { target: "XpTest" }).ok, false);
});
