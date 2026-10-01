"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("../public/js/welt/raeume.js");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-greifer-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.cpSync(path.join(__dirname, "../public/js/welt"), path.join(root, "public/js/welt"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const accounts = require(path.join(root, "game/accounts"));
const welt = require(path.join(root, "game/welt"));
const greifer = require(path.join(root, "game/greifer"));

function aufbau(key) {
  const handler = new Map();
  const socket = { data: { account: key }, on(e, f) { handler.set(e, f); } };
  const io = { on(e, f) { if (e === "connection") f(socket); }, emit() {}, to() { return { emit() {} }; } };
  greifer.setupGreifer(io, accounts);
  const frage = (e, d) => { let a; handler.get(e)(d, (r) => { a = r; }); return a; };
  return { frage };
}

test("Zielen zählt: über einem Ball trifft man, in einer Lücke nicht", () => {
  const g = R.GREIFER;
  for (const [i, b] of g.baelle.entries()) {
    assert.ok(b.x >= g.links && b.x <= g.rechts, `Ball ${i} liegt außerhalb der Fahrbahn`);
    assert.equal(greifer.trifft(b.x), i);
  }
  assert.equal(greifer.trifft(g.links), null, "über dem Schacht liegt nichts");
  assert.equal(greifer.trifft(92), null, "zwischen zwei Bällen");
});

test("der Automat ist kein Geschäft: ein Versuch bringt im Mittel weit weniger, als er kostet", () => {
  assert.ok(greifer.CHANCE * greifer.TROST < greifer.PREIS / 10);
  for (let i = 0; i < 2000; i++) {
    const r = greifer.rutschStelle();
    assert.ok(r > 0 && r < 1);
  }
});

test("greifen kostet, braucht Nähe und Pause, und ein Treffer gibt das Huhn genau einmal", () => {
  accounts.login("Greifer", "Passwort2026");
  const acc = accounts.get("greifer");
  const d = R.raum("spielhalle").dinge.find((x) => x.id === "greifer");
  let pos = { raum: "casino", x: 5, y: 5 };
  welt.figurVon = () => pos;
  welt.schau = () => {};
  const w = aufbau("greifer");
  const ball = R.GREIFER.baelle[0];
  assert.equal(w.frage("greifer:greifen", { x: ball.x }).ok, false, "aus der Ferne");
  pos = { raum: "spielhalle", x: d.nutz.x, y: d.nutz.y };
  const vorher = acc.chips;
  const r1 = w.frage("greifer:greifen", { x: ball.x });
  assert.equal(r1.ok, true, r1.error);
  assert.equal(acc.chips, vorher - greifer.PREIS);
  assert.equal(r1.treffer, 0);
  assert.equal(w.frage("greifer:greifen", { x: ball.x }).ok, false, "Pause nach einem Versuch");

  // Den seltenen Treffer erzwingen und die Pause über die Uhr überspringen.
  const echt = Math.random, jetzt = Date.now;
  let uhr = jetzt() + 10_000;
  Date.now = () => uhr;
  Math.random = () => 0;
  try {
    const r2 = w.frage("greifer:greifen", { x: ball.x });
    assert.equal(r2.gewonnen, true);
    assert.equal(r2.neu, true);
    assert.ok(acc.cosOwned.handdinge.includes("gummihuhn"));
    uhr += 10_000;
    const davor = acc.chips;
    const r3 = w.frage("greifer:greifen", { x: ball.x });
    assert.equal(r3.neu, false, "das Huhn gibt es nur einmal je Konto");
    assert.equal(acc.chips, davor - greifer.PREIS + greifer.TROST);
    uhr += 10_000;
    const r4 = w.frage("greifer:greifen", { x: 92 });
    assert.equal(r4.gewonnen, false, "wer nichts greift, gewinnt nichts");
  } finally {
    Math.random = echt; Date.now = jetzt;
  }
});
