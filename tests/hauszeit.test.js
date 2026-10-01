"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

/*
 * Lieferungen und Schaufenster wechseln nach deutscher Zeit, egal in
 * welcher Zeitzone der Server läuft, und auch über eine Zeitumstellung
 * hinweg zur richtigen Stunde. Jede Prüfung läuft deshalb in einem eigenen
 * Prozess mit gesetzter TZ.
 */
function rechne(tz, code) {
  const out = execFileSync(process.execPath, ["-e", `
    const h = require(${JSON.stringify(path.join(__dirname, "../game/hauszeit"))});
    const b = require(${JSON.stringify(path.join(__dirname, "../game/boutique"))});
    const l = require(${JSON.stringify(path.join(__dirname, "../game/laeden"))});
    process.stdout.write(JSON.stringify((${code})()));
  `], { env: { ...process.env, TZ: tz } });
  return JSON.parse(out);
}
const iso = (ts) => new Date(ts).toISOString();

for (const tz of ["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo"]) {
  test(`Zoo und Schaufenster wechseln in jeder Serverzeitzone zur selben Zeit (${tz})`, () => {
    const r = rechne(tz, `() => ({
      // Donnerstag 1.10.2026, 13 Uhr deutscher Zeit (Sommerzeit, UTC+2).
      zooEnde: l.lieferungEndet(Date.parse("2026-10-01T11:00:00Z")),
      wocheEnde: b.angebot(Date.parse("2026-10-01T11:00:00Z")).bis,
      nachts23: h.stunde(Date.parse("2026-10-01T21:00:00Z")),
    })`);
    // Nächste Lieferung: Montag 5.10., 0 Uhr deutscher Zeit = 4.10. 22 Uhr UTC.
    assert.equal(iso(r.zooEnde), "2026-10-04T22:00:00.000Z");
    assert.equal(iso(r.wocheEnde), "2026-10-04T22:00:00.000Z");
    assert.equal(r.nachts23, 23);
  });
}

test("Herbst: über die Umstellung am 25.10.2026 endet die Lieferung trotzdem Montag 0 Uhr", () => {
  const r = rechne("Europe/Berlin", `() => ({
    ende: l.lieferungEndet(Date.parse("2026-10-22T11:00:00Z")),   // Do 13 Uhr, Sommerzeit
    vor: l.lieferungVon(Date.parse("2026-10-25T22:59:59Z")),
    nach: l.lieferungVon(Date.parse("2026-10-25T23:00:00Z")),
  })`);
  // Montag 26.10., 0 Uhr Winterzeit (UTC+1) = 25.10. 23 Uhr UTC. Vorher
  // stand hier 22 Uhr UTC, weil der Sommerzeit-Versatz von jetzt benutzt wurde.
  assert.equal(iso(r.ende), "2026-10-25T23:00:00.000Z");
  assert.equal(r.nach, r.vor + 1, "genau dort wechselt die Lieferung");
});

test("Frühjahr: über die Umstellung am 29.3.2026 ebenso", () => {
  const r = rechne("Europe/Berlin", `() => ({
    ende: l.lieferungEndet(Date.parse("2026-03-26T12:00:00Z")),   // Do 13 Uhr, Winterzeit
    woche: b.angebot(Date.parse("2026-03-26T12:00:00Z")).bis,
    vor: l.lieferungVon(Date.parse("2026-03-29T21:59:59Z")),
    nach: l.lieferungVon(Date.parse("2026-03-29T22:00:00Z")),
  })`);
  // Montag 30.3., 0 Uhr Sommerzeit (UTC+2) = 29.3. 22 Uhr UTC.
  assert.equal(iso(r.ende), "2026-03-29T22:00:00.000Z");
  assert.equal(iso(r.woche), "2026-03-29T22:00:00.000Z");
  assert.equal(r.nach, r.vor + 1);
});

test("Donnerstag 12 Uhr deutscher Zeit ist der zweite Wechsel der Woche", () => {
  const r = rechne("UTC", `() => ({
    vor: l.lieferungVon(Date.parse("2026-10-01T09:59:59Z")),
    nach: l.lieferungVon(Date.parse("2026-10-01T10:00:00Z")),
  })`);
  assert.equal(r.nach, r.vor + 1);
});
