"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/*
 * Lotterie um 20 Uhr, Zuschlag um 20:30, beides nach deutscher Uhr.
 *
 * Vorher rechneten beide mit setHours, also in der Zeitzone des Servers.
 * Beim Hoster (UTC) fiel die Ziehung damit auf 21 oder 22 Uhr. Jede Prüfung
 * läuft deshalb in einem eigenen Prozess mit gesetzter TZ, wie in
 * tests/hauszeit.test.js.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-abend-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function rechne(tz, code) {
  const out = execFileSync(process.execPath, ["-e", `
    const h = require(${JSON.stringify(path.join(root, "game/hauszeit"))});
    const l = require(${JSON.stringify(path.join(root, "game/lotterie"))})._intern;
    const a = require(${JSON.stringify(path.join(root, "game/auktion"))})._intern;
    process.stdout.write(JSON.stringify((${code})()));
  `], { env: { ...process.env, TZ: tz } });
  return JSON.parse(out);
}
const iso = (ts) => new Date(ts).toISOString();

for (const tz of ["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo"]) {
  test(`Ziehung und Zuschlag fallen in jeder Serverzeitzone auf dieselbe deutsche Uhrzeit (${tz})`, () => {
    const r = rechne(tz, `() => ({
      // Donnerstag 12.11.2026, 11 Uhr deutscher Zeit (Winterzeit, UTC+1).
      winter: l.naechsteZiehung(Date.parse("2026-11-12T10:00:00Z")),
      // Mittwoch 1.7.2026, 12 Uhr deutscher Zeit (Sommerzeit, UTC+2).
      sommer: l.naechsteZiehung(Date.parse("2026-07-01T10:00:00Z")),
      // Genau um 20 Uhr ist die Ziehung von heute vorbei, die nächste ist morgen.
      punkt: l.naechsteZiehung(Date.parse("2026-11-12T19:00:00Z")),
      // Ein Los läuft mindestens einen Tag: morgens aufgemacht endet es am Abend danach ...
      losFrueh: a.naechstesEnde(Date.parse("2026-11-12T10:00:00Z")),
      // ... und um 20:45 aufgemacht erst am übernächsten Abend.
      losSpaet: a.naechstesEnde(Date.parse("2026-11-12T19:45:00Z")),
      heute: a.endeText(Date.parse("2026-11-13T19:30:00Z"), Date.parse("2026-11-13T08:00:00Z")),
      morgen: a.endeText(Date.parse("2026-11-13T19:30:00Z"), Date.parse("2026-11-12T10:00:00Z")),
      wochentag: a.endeText(Date.parse("2026-11-13T19:30:00Z"), Date.parse("2026-11-10T10:00:00Z")),
      // Kurz nach Mitternacht deutscher Zeit ist in UTC noch der Vortag.
      nachMitternacht: a.endeText(Date.parse("2026-11-13T19:30:00Z"), Date.parse("2026-11-12T23:30:00Z")),
    })`);
    assert.equal(iso(r.winter), "2026-11-12T19:00:00.000Z");
    assert.equal(iso(r.sommer), "2026-07-01T18:00:00.000Z");
    assert.equal(iso(r.punkt), "2026-11-13T19:00:00.000Z");
    assert.equal(iso(r.losFrueh), "2026-11-13T19:30:00.000Z");
    assert.equal(iso(r.losSpaet), "2026-11-14T19:30:00.000Z");
    assert.equal(r.heute, "heute um 20:30 Uhr");
    assert.equal(r.morgen, "morgen um 20:30 Uhr");
    assert.equal(r.wochentag, "am Freitag um 20:30 Uhr");
    assert.equal(r.nachMitternacht, "heute um 20:30 Uhr");
  });
}

test("über die Zeitumstellung am 25.10.2026 bleibt die Ziehung bei 20 Uhr", () => {
  const r = rechne("UTC", `() => ({
    davor: l.naechsteZiehung(Date.parse("2026-10-24T10:00:00Z")),   // Samstag, Sommerzeit
    danach: l.naechsteZiehung(Date.parse("2026-10-25T10:00:00Z")),  // Sonntag, Winterzeit
  })`);
  assert.equal(iso(r.davor), "2026-10-24T18:00:00.000Z");
  assert.equal(iso(r.danach), "2026-10-25T19:00:00.000Z");
});
