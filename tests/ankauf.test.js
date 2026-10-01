"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-ankauf-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function neustart() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(root, "game"))) delete require.cache[k];
  const m = {
    accounts: require(path.join(root, "game/accounts")),
    cosmetics: require(path.join(root, "game/cosmetics")),
    praegung: require(path.join(root, "game/praegung")),
    buchungen: require(path.join(root, "game/buchungen")),
    ankauf: require(path.join(root, "game/ankauf")),
    laeden: require(path.join(root, "game/laeden")),
  };
  m.laeden.setupLaeden({ on() {} }, m.accounts);
  return m;
}
let n = 0;
function konto(m) {
  const name = "Verkaeufer" + ++n;
  m.accounts.login(name, "Passwort2026");
  const key = name.toLowerCase();
  m.accounts.get(key).chips = 0;
  m.accounts.save();
  return key;
}

test("das Haus nimmt nur, was einen Wert hat und nicht limitiert ist", () => {
  const m = neustart();
  assert.equal(m.ankauf.preisVon("fahrzeug", "e46"), null, "Geheimnis");
  assert.equal(m.ankauf.preisVon("hand", "kaffee"), null, "Gratis-Grundteil");
  for (const [art, liste] of Object.entries(m.cosmetics.KATALOG)) {
    for (const x of Object.values(liste)) {
      const p = m.ankauf.preisVon(art, x.id);
      if (x.limitiert || x.cost == null || x.cost === 0) assert.equal(p, null, `${art}:${x.id}`);
      else if (p != null) assert.ok(p < (x.nur === "kiosk" ? x.preis : x.cost), `${art}:${x.id} bringt weniger, als es kostet`);
    }
  }
});

test("bei keiner bezahlten Kiste bringt der Ankauf im Schnitt mehr zurück, als sie kostet", () => {
  const m = neustart();
  const kisten = require(path.join(root, "game/kisten"));
  for (const k of Object.values(kisten.KISTEN)) {
    if (!k.preis) continue;
    const topf = {};
    for (const [art, liste] of Object.entries(m.cosmetics.KATALOG)) {
      for (const x of Object.values(liste)) {
        if ((x.nur || null) !== (k.eigenerTopf || null) || x.nichtInKisten || !x.cost || x.limitiert) continue;
        (topf[kisten.stufeVon(x.cost).id] = topf[kisten.stufeVon(x.cost).id] || []).push([art, x.id]);
      }
    }
    let zurueck = 0;
    for (const [stufe, p] of Object.entries(k.chancen)) {
      const l = topf[stufe] || [];
      if (!l.length) continue;
      zurueck += (p / 100) * l.reduce((s, [art, id]) => s + (m.ankauf.preisVon(art, id) || 0), 0) / l.length;
    }
    // Mit Abstand: Doppelte geben Staub statt eines Stücks, der echte Rückfluss liegt noch darunter.
    assert.ok(zurueck < k.preis * 0.8, `${k.id}: ${Math.round(zurueck)} von ${k.preis}`);
  }
});

test("Stücke aus der Tageskiste bringen nur den kleinen Satz", () => {
  const m = neustart();
  const key = konto(m);
  const acc = m.accounts.get(key);
  m.cosmetics.grant(acc, "haustier", "hamster", key);
  const ex = m.praegung.stueckVon(key, "haustier", "hamster");
  m.praegung.markiereGratis(ex.uid);
  const voll = m.ankauf.preisVon("haustier", "hamster");
  const gratis = m.ankauf.preisVon("haustier", "hamster", m.praegung.stueckVon(key, "haustier", "hamster"));
  assert.ok(gratis < voll / 4, `${gratis} gegen ${voll}`);
  const r = m.ankauf.verkaufen(m.accounts, acc, key, { art: "haustier", id: "hamster" });
  assert.equal(r.preis, gratis);
});

test("verkaufen: Chips gutgeschrieben, Stück weg, abgelegt, Exemplar gelöscht", () => {
  let m = neustart();
  const key = konto(m);
  const acc = m.accounts.get(key);
  m.cosmetics.grant(acc, "haustier", "dackel", key);
  acc.haustier = "dackel";
  m.accounts.save();
  const preis = m.ankauf.preisVon("haustier", "dackel");
  const r = m.ankauf.verkaufen(m.accounts, acc, key, { art: "haustier", id: "dackel" });
  assert.equal(r.ok, true, r.error);
  m = neustart();
  const nach = m.accounts.get(key);
  assert.equal(nach.chips, preis);
  assert.equal((nach.cosOwned.haustiere || []).includes("dackel"), false);
  assert.equal(nach.haustier, undefined);
  assert.equal(m.praegung.stueckVon(key, "haustier", "dackel"), null);
  // Und man kann es danach wieder bekommen, ohne an einem alten Exemplar hängenzubleiben.
  assert.equal(m.cosmetics.grant(nach, "haustier", "dackel", key), true);
});

test("höchstens zehn Stücke am Tag", () => {
  const m = neustart();
  const key = konto(m);
  const acc = m.accounts.get(key);
  const kandidaten = [];
  for (const [art, liste] of Object.entries(m.cosmetics.KATALOG)) {
    for (const x of Object.values(liste)) if (kandidaten.length < 11 && m.ankauf.preisVon(art, x.id) != null) kandidaten.push([art, x.id]);
  }
  for (const [art, id] of kandidaten) m.cosmetics.grant(acc, art, id, key);
  const ergebnisse = kandidaten.map(([art, id]) => m.ankauf.verkaufen(m.accounts, acc, key, { art, id }).ok);
  assert.deepEqual(ergebnisse, [...Array(10).fill(true), false]);
});

test("Absturz zwischen Konto und Register: der Start räumt das Exemplar nach", () => {
  let m = neustart();
  const key = konto(m);
  const acc = m.accounts.get(key);
  m.cosmetics.grant(acc, "haustier", "katze", key);
  m.accounts.save();
  m.buchungen._pruefung.abbruchNach = "konto";
  assert.throws(() => m.ankauf.verkaufen(m.accounts, acc, key, { art: "haustier", id: "katze" }), m.buchungen.Abbruch);
  m.buchungen._pruefung.abbruchNach = null;
  m = neustart();
  assert.equal((m.accounts.get(key).cosOwned.haustiere || []).includes("katze"), false);
  assert.equal(m.praegung.stueckVon(key, "haustier", "katze"), null);
  assert.equal(Object.keys(m.buchungen._offen()).length, 0);
});

test("Schreibfehler am Konto: nichts verkauft, nichts gelöscht", () => {
  const m = neustart();
  const key = konto(m);
  const acc = m.accounts.get(key);
  m.cosmetics.grant(acc, "haustier", "frosch", key);
  acc.haustier = "frosch";
  m.accounts.save();
  const echt = m.accounts.save;
  m.accounts.save = () => { throw new Error("Platte voll"); };
  const r = m.ankauf.verkaufen(m.accounts, acc, key, { art: "haustier", id: "frosch" });
  m.accounts.save = echt;
  assert.equal(r.ok, false);
  assert.equal(acc.chips, 0);
  assert.equal(acc.haustier, "frosch");
  assert.ok(acc.cosOwned.haustiere.includes("frosch"));
  assert.ok(m.praegung.stueckVon(key, "haustier", "frosch"));
});
