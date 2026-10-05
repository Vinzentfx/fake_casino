"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-runden-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.cpSync(path.join(__dirname, "../public/js/welt"), path.join(root, "public/js/welt"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/* Ein Neustart: alle Spielmodule frisch laden, so wie ein neuer Prozess. */
function neustart() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(root, "game"))) delete require.cache[k];
  return { accounts: require(path.join(root, "game/accounts")), r: (n) => require(path.join(root, "game", n)) };
}

function tisch(setup, accounts, key) {
  const handler = new Map();
  const socket = { data: { account: key }, on(e, f) { handler.set(e, f); }, emit() {} };
  setup({ on(e, f) { if (e === "connection") f(socket); }, emit() {}, to() { return { emit() {} }; } }, accounts);
  return (e, d) => { let a; const h = handler.get(e); if (d === undefined) h((x) => { a = x; }); else h(d, (x) => { a = x; }); return a; };
}

test("eine Mines-Runde übersteht den Neustart: Einsatz bleibt weg, Felder bleiben aufgedeckt, Auszahlen geht", () => {
  let m = neustart();
  m.accounts.login("Minerin", "Passwort2026");
  let spiel = tisch(m.r("mines").setupMines, m.accounts, "minerin");
  const vorher = m.accounts.get("minerin").chips;
  const start = spiel("mines:start", { bet: 500, mines: 1 });
  assert.equal(start.ok, true, start.error);
  // Ein sicheres Feld suchen: bei einer Mine sind 24 von 25 frei, notfalls das nächste.
  let auf = null;
  for (let t = 0; t < 25 && !auf; t++) { const r = spiel("mines:reveal", { tile: t }); if (r.ok && !r.bust) auf = r; else if (r.bust) break; }
  if (!auf) return; // seltener Fall: die erste Kachel war die Mine, dann gibt es nichts fortzusetzen
  m.accounts.saveJetzt();

  m = neustart();
  spiel = tisch(m.r("mines").setupMines, m.accounts, "minerin");
  assert.equal(m.accounts.get("minerin").chips, vorher - 500, "der Einsatz ist nach dem Neustart noch abgebucht");
  const stand = spiel("mines:state");
  assert.equal(stand.none, undefined, "die Runde ist wieder da");
  assert.deepEqual(stand.revealed, auf.revealed);
  const aus = spiel("mines:cashout");
  assert.equal(aus.ok, true, aus.error);
  assert.ok(m.accounts.get("minerin").chips > vorher - 500, "ausgezahlt");

  // Und ausgezahlt ist ausgezahlt: nach einem weiteren Neustart gibt es nichts mehr.
  m.accounts.saveJetzt();
  m = neustart();
  spiel = tisch(m.r("mines").setupMines, m.accounts, "minerin");
  assert.equal(spiel("mines:state").none, true);
});

test("Higher/Lower und Würfelpoker kommen nach dem Neustart wieder", () => {
  let m = neustart();
  m.accounts.login("Tipper", "Passwort2026");
  let hilo = tisch(m.r("hilo").setupHilo, m.accounts, "tipper");
  let wuerfel = tisch(m.r("wuerfel").setupWuerfel, m.accounts, "tipper");
  assert.equal(hilo("hilo:start", { bet: 100 }).ok, true);
  const w = wuerfel("wuerfel:start", { bet: 100 });
  assert.equal(w.ok, true, w.error);
  m.accounts.saveJetzt();

  m = neustart();
  hilo = tisch(m.r("hilo").setupHilo, m.accounts, "tipper");
  wuerfel = tisch(m.r("wuerfel").setupWuerfel, m.accounts, "tipper");
  assert.notEqual(hilo("hilo:state").none, true, "Higher/Lower ist noch offen");
  const ws = wuerfel("wuerfel:state");
  assert.notEqual(ws.none, true, "Würfelpoker ist noch offen");
  assert.deepEqual(ws.wuerfel, w.wuerfel, "dieselben Würfel");
  assert.equal(wuerfel("wuerfel:stehen").over, true, "und lässt sich abrechnen");
});

test("beim Herunterfahren bekommt jeder in einer laufenden Kniffel-Partie seinen Einsatz zurück, genau einmal", () => {
  const m = neustart();
  m.accounts.login("Wuerfler", "Passwort2026");
  m.accounts.login("Gegner", "Passwort2026");
  const handler = new Map();
  const sockets = ["wuerfler", "gegner"].map((key) => {
    const h = new Map();
    handler.set(key, h);
    return { data: { account: key }, on(e, f) { h.set(e, f); }, emit() {}, join() {}, leave() {} };
  });
  const io = { on(e, f) { if (e === "connection") sockets.forEach(f); }, emit() {}, to() { return { emit() {} }; } };
  m.r("kniffel").setupKniffel(io, m.accounts);
  const frage = (key, e, d) => { let a; handler.get(key).get(e)(d, (x) => { a = x; }); return a; };
  const vorher = { wuerfler: m.accounts.get("wuerfler").chips, gegner: m.accounts.get("gegner").chips };
  const p = frage("wuerfler", "kniffel:create", { bet: 1000, oeffentlich: false });
  assert.equal(p.ok, true, p.error);
  assert.equal(frage("gegner", "kniffel:join", { code: p.code }).ok, true);
  assert.equal(m.accounts.get("wuerfler").chips, vorher.wuerfler - 1000);

  const fahren = m.r("herunterfahren");
  assert.ok(fahren.alleAbschliessen().some((z) => z.startsWith("Kniffel: 2")));
  assert.equal(m.accounts.get("wuerfler").chips, vorher.wuerfler);
  assert.equal(m.accounts.get("gegner").chips, vorher.gegner);
  fahren.alleAbschliessen();
  assert.equal(m.accounts.get("wuerfler").chips, vorher.wuerfler, "kein zweites Mal");
});
