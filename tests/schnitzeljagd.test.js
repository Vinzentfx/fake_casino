"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("../public/js/welt/raeume.js");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-jagd-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.cpSync(path.join(__dirname, "../public/js/welt"), path.join(root, "public/js/welt"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const accounts = require(path.join(root, "game/accounts"));
const welt = require(path.join(root, "game/welt"));
const jagd = require(path.join(root, "game/schnitzeljagd"));

function erreichbar(raum, von) {
  const S = 0.1, key = (x, y) => `${Math.round(x / S)}:${Math.round(y / S)}`;
  const gesehen = new Set([key(von.x, von.y)]), offen = [[von.x, von.y]];
  while (offen.length) {
    const [x, y] = offen.pop();
    for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const nx = +(x + dx).toFixed(2), ny = +(y + dy).toFixed(2), k = key(nx, ny);
      if (gesehen.has(k) || !R.begehbar(raum, nx, ny)) continue;
      gesehen.add(k); offen.push([nx, ny]);
    }
  }
  return gesehen;
}

function aufbau() {
  const handler = new Map();
  const socket = { data: { account: "sucher" }, on(e, f) { handler.set(e, f); } };
  const io = { on(e, f) { if (e === "connection") f(socket); }, emit() {} };
  const steuerung = jagd.setupSchnitzeljagd(io, accounts);
  const frage = (e, d) => { let a; handler.get(e)(d, (r) => { a = r; }); return a; };
  return { steuerung, frage };
}

test("jedes Versteck liegt in einem offenen Raum und ist zu Fuß erreichbar", () => {
  const ids = new Set();
  for (const m of jagd.MARKEN) {
    const raum = R.raum(m.raum);
    assert.ok(raum && !raum.geheim, `${m.id}: ${m.raum}`);
    assert.ok(erreichbar(raum, raum.start).has(`${Math.round(m.x / 0.1)}:${Math.round(m.y / 0.1)}`), `${m.id} unerreichbar`);
    assert.ok(!ids.has(m.id)); ids.add(m.id);
  }
});

test("aufheben nur aus der Nähe, jede Marke einmal, alle zusammen mit Titel", () => {
  accounts.login("Sucher", "Passwort2026");
  const acc = accounts.get("sucher");
  const w = aufbau();
  let pos = null;
  welt.figurVon = () => pos;
  assert.equal(w.frage("jagd:finden", { id: "m1" }).ok, false, "läuft noch nicht");
  w.steuerung.starten(3);
  const m1 = jagd.MARKEN[0];
  pos = { raum: m1.raum, x: m1.x + 3, y: m1.y };
  assert.equal(w.frage("jagd:finden", { id: m1.id }).ok, false, "zu weit weg");
  pos = { raum: m1.raum, x: m1.x + 0.3, y: m1.y };
  const vorher = acc.chips;
  const r = w.frage("jagd:finden", { id: m1.id });
  assert.equal(r.ok, true, r.error);
  assert.ok(acc.chips > vorher);
  assert.equal(w.frage("jagd:finden", { id: m1.id }).ok, false, "nicht doppelt");
  assert.equal(w.frage("jagd:state", { raum: m1.raum }).marken.some((m) => m.id === m1.id), false);
  let letzte = null;
  for (const m of jagd.MARKEN.slice(1)) { pos = { raum: m.raum, x: m.x, y: m.y }; letzte = w.frage("jagd:finden", { id: m.id }); }
  assert.equal(letzte.fertig, true);
  assert.ok((acc.cosOwned.titles || []).includes("schatzsucher"));
  assert.ok(acc.jagd && acc.jagd.fertig);
  w.steuerung.beenden();
  assert.equal(jagd.laeuft(), false);
});
