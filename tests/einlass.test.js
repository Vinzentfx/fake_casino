"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-einlass-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.cpSync(path.join(__dirname, "../public/js/welt"), path.join(root, "public/js/welt"), { recursive: true });
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const accounts = require(path.join(root, "game/accounts"));
const einlass = require(path.join(root, "game/einlass"));

/* Ein Socket mit Zwischenschicht wie bei socket.io: erst `use`, dann der Handler. */
function aufbau(key) {
  const handler = new Map(), schichten = [];
  const socket = { data: { account: key }, on(e, f) { handler.set(e, f); }, use(f) { schichten.push(f); } };
  const gesendet = [];
  const io = { on(e, f) { if (e === "connection") f(socket); }, emit(e, d) { gesendet.push([e, d]); }, to() { return { emit() {} }; } };
  einlass.bremse(io);
  const steuerung = einlass.setupEinlass(io, accounts);
  const frage = (e, d) => {
    let antwort = "durchgelassen";
    const packet = d === undefined ? [e, (r) => { antwort = r; }] : [e, d, (r) => { antwort = r; }];
    let weiter = false;
    for (const s of schichten) { weiter = false; s(packet, () => { weiter = true; }); if (!weiter) return antwort; }
    const h = handler.get(e);
    if (h) d === undefined ? h(packet[1]) : h(d, packet[2]);
    return antwort;
  };
  return { frage, steuerung, gesendet };
}

test("solange Einlass ist, geht nur der Warteraum; der Besitzer kommt durch", () => {
  accounts.login("Wartender", "Passwort2026");
  Object.assign(einlass._state(), { an: true, bis: Date.now() + 3600000, schaetz: {}, wand: [], premiere: {}, paket: {}, karte: {}, ergebnis: null, glas: 2000 });
  const w = aufbau("wartender");
  for (const ev of ["slots:spin", "kiste:oeffnen", "market:buy", "greifer:greifen", "welt:hin", "welt:tuer", "cos:equip"]) {
    const r = w.frage(ev, {});
    assert.equal(r && r.einlass, true, `${ev} muss gesperrt sein`);
  }
  for (const ev of ["chat:send", "welt:zug", "welt:nutzen", "einlass:state", "wheel:state"]) {
    assert.equal(w.frage(ev, {}), "durchgelassen", `${ev} muss durchgehen`);
  }
  assert.equal(einlass.gesperrt("vincent"), false, "der Besitzer ist frei");
  assert.equal(einlass.gesperrt("wartender"), true);
});

test("Schätzglas, Gästebuch und Klopfen, dann die Öffnung mit Paket", () => {
  accounts.login("Schaetzer", "Passwort2026");
  const acc = accounts.get("schaetzer");
  Object.assign(einlass._state(), { an: true, bis: Date.now() + 3600000, schaetz: {}, wand: [], premiere: {}, paket: {}, karte: {}, ergebnis: null, glas: 2000 });
  const w = aufbau("schaetzer");
  const st = w.frage("einlass:state");
  assert.equal(st.zu, true);
  assert.ok(acc.cosOwned.titles.includes("premierengast"), "wer im Warteraum war, ist Premierengast");
  assert.ok(st.teaser.some((t) => !t.auf && !t.titel), "Verdecktes verlässt den Server nicht");
  assert.equal(w.frage("einlass:schaetzen", { zahl: 1990 }).ok, true);
  assert.equal(w.frage("einlass:schaetzen", { zahl: 2000 }).ok, false, "nur eine Schätzung");
  assert.equal(w.frage("einlass:schreiben", { text: "Bis gleich!" }).ok, true);
  assert.equal(w.frage("einlass:paket").ok, false, "das Paket gibt es erst nach der Öffnung");
  for (let i = 0; i < 3; i++) einlass.klopfen("schaetzer", accounts);
  assert.ok(acc.cosOwned.handdinge.includes("eintrittskarte"), "dreimal klopfen");

  const vorher = acc.chips;
  w.steuerung.oeffnen();
  assert.equal(einlass.zu(), false);
  assert.equal(einlass.gesperrt("schaetzer"), false);
  assert.ok(acc.cosOwned.titles.includes("augenmass"), "am nächsten dran");
  assert.ok(acc.chips > vorher, "der Preis vom Schätzglas");
  assert.ok(w.gesendet.some(([e]) => e === "einlass:auf"));
  const p = w.frage("einlass:paket");
  assert.equal(p.ok, true, p.error);
  assert.equal(w.frage("einlass:paket").ok, false, "das Paket nur einmal");
  assert.equal(w.frage("slots:spin", {}), "durchgelassen", "nach der Öffnung ist alles offen");
});

test("das Ergebnis vom Schätzglas kommt einmal, nicht bei jedem Neuladen", () => {
  accounts.login("Nochmal", "Passwort2026");
  Object.assign(einlass._state(), { an: true, bis: Date.now() + 3600000, schaetz: {}, wand: [], premiere: {}, paket: {}, karte: {}, ergebnis: null, glas: 2000 });
  const w = aufbau("nochmal");
  w.frage("einlass:state");
  w.frage("einlass:schaetzen", { zahl: 1500 });
  w.steuerung.oeffnen();
  assert.ok(w.frage("einlass:state").ergebnis, "nach der Öffnung steht das Ergebnis da");
  w.frage("einlass:ergebnisGesehen", {});
  // Neu laden heißt: ein neuer Socket fragt den Stand ab.
  const nachher = aufbau("nochmal");
  assert.equal(nachher.frage("einlass:state").ergebnis, null, "gesehen ist gesehen");
});
