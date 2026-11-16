"use strict";
/*
 * Das Wochenend-Derby (game/eventCalendar.js).
 *
 * Geprüft wird, was an einem Wochenende schiefgehen kann: Teams werden
 * schief, Clans landen auseinander, der Tagesdeckel hält nicht, die
 * Abrechnung zahlt doppelt oder gar nicht, und die Welt zeigt ein Team
 * nach dem Ende weiter an.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-derby-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
const cosmetics = require(path.join(root, "game/cosmetics"));
const derby = require(path.join(root, "game/eventCalendar"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

// Freitag, 20. November 2026, 19 Uhr in Berlin: das Derby läuft.
let jetzt = derby.berlinToUtc(2026, 11, 20, 19);
const uhr = () => jetzt;

const io = { on() {}, emit() {}, of() { return { sockets: new Map() }; }, to() { return { emit() {} }; } };
let runde = null;
const echtOnHand = accounts.onHand;
accounts.onHand = (fn) => { runde = fn; };
derby._setState({ version: 2, eventId: "alt", abgerechnet: true, gestartet: true, punkte: [0, 0], players: {}, fuehrung: -1, letzteAnsage: 0, letztes: null });
const ec = derby.setupEventCalendar(io, accounts, { now: uhr });
accounts.onHand = echtOnHand;

for (const n of ["Rotkehl", "Blaumeise", "Clanfreund", "Kurzbesuch"]) accounts.login(n, "Passwort2026");
const spiele = (name, n = 1) => { for (let i = 0; i < n; i++) runde(name, 0, true, "slots", {}); };

test("die Paarung wechselt jede Woche und ist vorher bekannt", () => {
  const a = derby.paarungVon("2026-11-16").map((t) => t.name);
  const b = derby.paarungVon("2026-11-23").map((t) => t.name);
  assert.notDeepEqual(a, b);
  assert.equal(ec.publicState("rotkehl").teams.length, 2);
});

test("vor Freitag 18 Uhr zählt nichts", () => {
  const merk = jetzt;
  jetzt = derby.berlinToUtc(2026, 11, 20, 17, 59);
  spiele("Rotkehl");
  assert.equal(ec.getState().players.rotkehl, undefined);
  jetzt = merk;
});

test("Teams bleiben gleich groß, Clans spielen zusammen", () => {
  accounts.get("rotkehl").clan = "Weserbande";
  accounts.get("clanfreund").clan = "Weserbande";
  spiele("Rotkehl");
  spiele("Blaumeise");
  const s = ec.getState();
  assert.notEqual(s.players.rotkehl.team, s.players.blaumeise.team, "die ersten beiden landen auseinander");
  spiele("Clanfreund");
  assert.equal(s.players.clanfreund.team, s.players.rotkehl.team, "der Clan bleibt zusammen");
  assert.equal(derby.teamVon("rotkehl", jetzt), s.players.rotkehl.team, "die Welt kennt das Team");
});

test("Antreten bringt fünf, danach höchstens 25 am Tag", () => {
  const s = ec.getState();
  assert.equal(s.players.blaumeise.punkte, 6, "erste Runde: fünf fürs Antreten und eine");
  spiele("Blaumeise", 40);
  assert.equal(s.players.blaumeise.punkte, 30, "der Tagesdeckel hält");
  jetzt = derby.berlinToUtc(2026, 11, 21, 11);   // Samstag
  spiele("Blaumeise");
  assert.equal(s.players.blaumeise.punkte, 36, "ein neuer Tag, ein neuer Antritt");
  const summe = Object.values(s.players).filter((p) => p.team === s.players.blaumeise.team).reduce((n, p) => n + p.punkte, 0);
  assert.equal(s.punkte[s.players.blaumeise.team], summe, "der Teamstand ist die Summe");
});

test("abgerechnet wird genau einmal, und nur ab zehn Punkten", () => {
  spiele("Kurzbesuch");                          // sechs Punkte, zu wenig
  spiele("Rotkehl", 30);
  const s = ec.getState();
  // Sonntag: noch ein Antritt, damit es sicher keinen Gleichstand gibt.
  jetzt = derby.berlinToUtc(2026, 11, 22, 21);
  if (s.punkte[0] === s.punkte[1]) spiele("Rotkehl");
  assert.notEqual(s.punkte[0], s.punkte[1]);
  const sieger = s.punkte[0] > s.punkte[1] ? 0 : 1;
  const keys = ["rotkehl", "blaumeise", "clanfreund", "kurzbesuch"];
  const vorher = Object.fromEntries(keys.map((k) => [k, accounts.get(k).chips]));
  const faktor = Object.fromEntries(keys.map((k) => [k, accounts.faucetFactor(k)]));
  const team = Object.fromEntries(keys.map((k) => [k, s.players[k].team]));
  const punkte = Object.fromEntries(keys.map((k) => [k, s.players[k].punkte]));

  jetzt = derby.berlinToUtc(2026, 11, 23, 0, 30);   // Montag nach Mitternacht
  ec.ensureWeek();
  for (const k of keys) {
    const soll = punkte[k] < derby.MIN_BEITRAG ? 0
      : Math.round((team[k] === sieger ? derby.LOHN.sieg : derby.LOHN.niederlage) * faktor[k]);
    assert.equal(accounts.get(k).chips - vorher[k], soll, `${k} bekommt ${soll}`);
    assert.equal(accounts.get(k).derby.teilnahmen, 1);
  }
  const gewinner = keys.find((k) => team[k] === sieger && punkte[k] >= derby.MIN_BEITRAG);
  assert.ok(cosmetics.hatStueck(accounts.get(gewinner), "accessoire", "siegerschal"), "der erste Sieg bringt den Schal");
  assert.equal(derby.teamVon(gewinner, jetzt), null, "nach dem Ende kein Team mehr in der Welt");

  const danach = Object.fromEntries(keys.map((k) => [k, accounts.get(k).chips]));
  ec.ensureWeek();
  ec.publicState("rotkehl");
  for (const k of keys) assert.equal(accounts.get(k).chips, danach[k], "kein zweites Mal");

  const st = ec.publicState(gewinner);
  assert.equal(st.letztes.sieger, sieger, "das letzte Ergebnis steht die Woche über da");
  assert.ok(st.letztes.meins && st.letztes.meins.art === "sieg");
  assert.equal(Object.keys(ec.getState().players).length, 0, "die neue Woche fängt leer an");
});
