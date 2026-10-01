"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/*
 * Ein Kauf ist eine Buchung über drei Dateien (Konto, Prägeregister,
 * Zoo). Geprüft wird, dass nach einem Schreibfehler oder einem Absturz
 * zwischen zwei Schritten nie ein halber Kauf stehen bleibt: entweder hat
 * das Konto bezahlt und alles stimmt, oder es ist gar nichts passiert.
 */
// realpath: der Modul-Cache führt echte Pfade, unter macOS liegt /var in /private/var.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-buchung-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const spielModule = () => Object.keys(require.cache).filter((k) => k.startsWith(path.join(root, "game")));
/** Der Prozess endet und startet neu: alles aus der Platte, nichts aus dem Speicher. */
function neustart() {
  for (const k of spielModule()) delete require.cache[k];
  const m = {
    accounts: require(path.join(root, "game/accounts")),
    cosmetics: require(path.join(root, "game/cosmetics")),
    praegung: require(path.join(root, "game/praegung")),
    buchungen: require(path.join(root, "game/buchungen")),
    laeden: require(path.join(root, "game/laeden")),
  };
  m.laeden.setupLaeden({ on() {} }, m.accounts);
  return m;
}

let zaehler = 0;
function kaeufer(m, chips = 1_000_000) {
  const name = "Kunde" + ++zaehler;
  m.accounts.login(name, "Passwort2026");
  const key = name.toLowerCase();
  const acc = m.accounts.get(key);
  acc.chips = chips;
  m.accounts.save();
  return { key, acc };
}
function zooTier(m) {
  const z = m.laeden._zoo();
  return z.angebot.find((a) => a.bestand - (z.verkauft[a.id] || 0) > 1).id;
}
/** Der Zustand eines Kaufs, so wie er auf der Platte steht. */
function stand(m, key, id) {
  const acc = m.accounts.get(key);
  const z = m.laeden._store().zoo;
  return {
    chips: acc.chips,
    hat: ((acc.cosOwned || {}).haustiere || []).includes(id),
    exemplar: !!m.praegung.stueckVon(key, "haustier", id),
    verkauft: z.verkauft[id] || 0,
    limit: z.kaeufer[key] === z.lieferung,
    offen: Object.keys(m.buchungen._offen()).length,
  };
}

test("ein gelungener Kauf steht vollständig auf der Platte, das Journal ist danach leer", () => {
  let m = neustart();
  const { key } = kaeufer(m);
  const id = zooTier(m);
  const preis = m.cosmetics.KATALOG.haustier[id].cost;
  const vorher = m.laeden._store().zoo.verkauft[id] || 0;
  const r = m.laeden.kaufen(m.accounts, "zoo", m.accounts.get(key), key, { id, name: "Flocke" });
  assert.equal(r.ok, true, r.error);
  m = neustart();
  assert.deepEqual(stand(m, key, id), { chips: 1_000_000 - preis, hat: true, exemplar: true, verkauft: vorher + 1, limit: true, offen: 0 });
  assert.equal(m.accounts.get(key).tierNamen[id], "Flocke");
});

for (const [was, datei] of [["Journal", "buchungen.json"], ["Zoo", "laeden.json"], ["Konto", "accounts.json"]]) {
  test(`Schreibfehler beim ${was}: kein Erfolg, nichts abgebucht, nichts vergeben`, () => {
    let m = neustart();
    const { key } = kaeufer(m);
    const id = zooTier(m);
    const vorher = stand(m, key, id);
    const echt = m.buchungen._pruefung.schreiben;
    const echtSave = m.accounts.save;
    if (datei === "accounts.json") m.accounts.save = () => { throw new Error("Platte voll"); };
    else m.buchungen._pruefung.schreiben = (d, inhalt) => { if (d.endsWith(datei)) throw new Error("Platte voll"); return echt(d, inhalt); };
    const r = m.laeden.kaufen(m.accounts, "zoo", m.accounts.get(key), key, { id });
    m.buchungen._pruefung.schreiben = echt;
    m.accounts.save = echtSave;
    assert.equal(r.ok, false);
    assert.match(r.error, /nichts abgebucht|Chips sind zurück/);
    // Im Speicher: alles wie vorher.
    const jetzt = stand(m, key, id);
    assert.deepEqual({ ...jetzt, offen: 0 }, { ...vorher, offen: 0 });
    // Und nach einem Neustart erst recht.
    m = neustart();
    assert.deepEqual(stand(m, key, id), { ...vorher, offen: 0 });
  });
}

for (const nach of ["journal", "praegung", "zusatz", "konto"]) {
  test(`Absturz nach Schritt „${nach}“: der nächste Start bringt die Buchung ganz oder gar nicht zu Ende`, () => {
    let m = neustart();
    const { key } = kaeufer(m);
    const id = zooTier(m);
    const preis = m.cosmetics.KATALOG.haustier[id].cost;
    const vorher = stand(m, key, id);
    m.buchungen._pruefung.abbruchNach = nach;
    assert.throws(() => m.laeden.kaufen(m.accounts, "zoo", m.accounts.get(key), key, { id }), m.buchungen.Abbruch);
    m.buchungen._pruefung.abbruchNach = null;
    m = neustart();
    const s = stand(m, key, id);
    assert.equal(s.offen, 0, "keine Buchung bleibt offen");
    if (nach === "konto") {
      // Das Konto war gesichert: der Kauf gilt, und zwar genau einmal.
      assert.deepEqual(s, { chips: vorher.chips - preis, hat: true, exemplar: true, verkauft: vorher.verkauft + 1, limit: true, offen: 0 });
    } else {
      assert.deepEqual(s, { ...vorher, offen: 0 });
    }
  });
}

test("auch das Schaufenster bucht über das Journal", () => {
  let m = neustart();
  const { key } = kaeufer(m);
  const stueck = require(path.join(root, "game/boutique")).angebot().stuecke[0];
  m.buchungen._pruefung.abbruchNach = "praegung";
  assert.throws(() => m.buchungen.buche({ accounts: m.accounts, cosmetics: m.cosmetics, praegung: m.praegung, key, acc: m.accounts.get(key), quelle: "boutique", art: stueck.art, id: stueck.id, preis: stueck.preis }), m.buchungen.Abbruch);
  m.buchungen._pruefung.abbruchNach = null;
  m = neustart();
  const acc = m.accounts.get(key);
  assert.equal(acc.chips, 1_000_000);
  assert.equal(((acc.cosOwned || {})[m.cosmetics.TOPF[stueck.art]] || []).includes(stueck.id), false);
  assert.equal(m.praegung.stueckVon(key, stueck.art, stueck.id), null);
  assert.equal(Object.keys(m.buchungen._offen()).length, 0);
});
