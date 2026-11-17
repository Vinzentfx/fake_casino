"use strict";
/*
 * Zwei Spielervorschläge vom November 2026: Miete, die man nachts verpasst
 * hat, und Clans, die sich umbenennen wollen.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-qol-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
const clans = require(path.join(root, "game/clans"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const H = 3600 * 1000;

test("verpasste Miete: höchstens acht Stunden, jede nach der ersten zur Hälfte", () => {
  const jetzt = Date.UTC(2026, 10, 17, 12);
  const f = (vorStunden) => accounts.mietStunden(jetzt - vorStunden * H, jetzt);
  assert.deepEqual(accounts.mietStunden(null, jetzt), { stunden: 1, faktor: 1 }, "die erste Abholung zahlt eine Stunde");
  assert.deepEqual(f(1), { stunden: 1, faktor: 1 }, "wer stündlich abholt, bekommt dasselbe wie bisher");
  assert.deepEqual(f(1.9), { stunden: 1, faktor: 1 }, "angefangene Stunden zählen nicht");
  assert.deepEqual(f(3), { stunden: 3, faktor: 2 });
  assert.deepEqual(f(8), { stunden: 8, faktor: 4.5 });
  assert.deepEqual(f(40), { stunden: 8, faktor: 4.5 }, "mehr als acht Stunden gibt es nicht");
});

test("acht Stunden am Stück bringen weniger als acht stündliche Abholungen", () => {
  const jetzt = Date.UTC(2026, 10, 17, 12);
  const nacht = accounts.mietStunden(jetzt - 8 * H, jetzt).faktor;
  assert.ok(nacht < 8 && nacht > 1, "wer da ist, verdient mehr, wer schläft, verliert nicht alles");
});

test("ohne Häuser steht keine Nachzahlung in der Abholung", () => {
  accounts.login("Mieterlos", "Passwort2026");
  const acc = accounts.get("mieterlos");
  acc.lastBonusAt = Date.now() - 5 * H;
  const r = accounts.claimDailyBonus("Mieterlos");
  assert.equal(r.ok, true);
  assert.equal(r.houses, 0);
  assert.equal(r.mietStunden, 0);
});

test("Clan umbenennen: gleiche Regeln wie beim Gründen, einmal je Woche", () => {
  const alle = clans._clans();
  alle.alpha = { id: "alpha", name: "Alpha", tag: "ALP", members: [] };
  alle.beta = { id: "beta", name: "Beta Bande", tag: "BET", members: [] };
  const a = alle.alpha;
  const jetzt = Date.UTC(2026, 10, 17, 12);

  assert.deepEqual(clans.umbenennenPruefen(a, "Neue Alphas", "NEU", jetzt), { ok: true, name: "Neue Alphas", tag: "NEU" });
  assert.match(clans.umbenennenPruefen(a, "beta bande", "XYZ", jetzt).error, /Name schon vergeben/, "gleich geschrieben ist vergeben");
  assert.match(clans.umbenennenPruefen(a, "Beta-Bande!", "XYZ", jetzt).error, /Name schon vergeben/);
  assert.match(clans.umbenennenPruefen(a, "Ganz Neu", "BET", jetzt).error, /Tag schon vergeben/);
  assert.match(clans.umbenennenPruefen(a, "Alpha", "ALP", jetzt).error, /schon der Name/);
  assert.match(clans.umbenennenPruefen(a, "ab", "AB", jetzt).error, /3 Zeichen/);
  assert.equal(clans.umbenennenPruefen(a, "Alpha", "ALP2", jetzt).ok, true, "nur das Kürzel zu ändern geht auch");
  assert.equal(clans.umbenennenPruefen(a, "Ganz Neu", "", jetzt).tag, "ALP", "ohne Kürzel bleibt das alte");

  a.umbenanntAm = jetzt - 2 * 24 * H;
  assert.match(clans.umbenennenPruefen(a, "Ganz Neu", "GN", jetzt).error, /einmal je Woche\. Noch 5 Tage/);
  a.umbenanntAm = jetzt - clans.UMBENENNEN_PAUSE_MS;
  assert.equal(clans.umbenennenPruefen(a, "Ganz Neu", "GN", jetzt).ok, true);
});

test("mit Haus: drei Stunden weg zahlen die doppelte Miete einer Abholung", () => {
  const city = require(path.join(root, "game/city"));
  accounts.login("Hausherrin", "Passwort2026");
  const key = "hausherrin";
  const haus = city.kartografHaeuser()[0];
  const kauf = city.buyBuilding(haus.id, key, "Hausherrin");
  assert.equal(kauf.ok, true);
  kauf.commit();
  const netto = city.mieteVon(key).netto;
  assert.ok(netto > 0);
  accounts.get(key).lastBonusAt = Date.now() - 3 * H - 60000;
  const r = accounts.claimDailyBonus("Hausherrin");
  assert.equal(r.ok, true);
  assert.equal(r.mietStunden, 3);
  assert.equal(r.houses, Math.round(netto * 2));
});
