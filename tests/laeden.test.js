"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-laeden-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
const cosmetics = require(path.join(root, "game/cosmetics"));
const kleidung = require(path.join(root, "game/kleidung"));
const laeden = require(path.join(root, "game/laeden"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function konto(name, chips = 5_000_000) {
  accounts.login(name, "Passwort2026");
  const key = name.toLowerCase();
  const acc = accounts.get(key);
  acc.chips = chips;
  return { key, acc };
}
const neueLieferung = () => { laeden._store().zoo.lieferung = -1; return laeden._zoo(); };

test("Läden ziehen die Gruppen aus der Kleiderkiste, Ladenware wird nicht geprägt", () => {
  for (const x of kleidung.HAUSTIERE) if (x.nur === "zoo") assert.ok(cosmetics.praegbar("haustier", x.id), x.id);
  for (const x of kleidung.FAHRZEUGE) if (x.nur === "autohaus") {
    assert.equal(cosmetics.praegbar("fahrzeug", x.id), false, x.id);
    assert.equal(cosmetics.handelbar("fahrzeug", x.id), false, x.id);
    assert.ok(Number.isInteger(x.ab) && x.ab > 0, x.id);
  }
  for (const x of kleidung.HANDDINGE) if (x.nur === "kiosk") assert.ok(x.preis > 0 && x.preis < x.cost, x.id);
  const topf = require(path.join(root, "game/kisten"));
  assert.deepEqual(topf.pruefe(), []);
});

test("Zoo: vier Arten je Lieferung, ein Tier je Person, mit Namen, angelegt", () => {
  const z = neueLieferung();
  assert.equal(z.angebot.length, 4);
  const { key, acc } = konto("ZooEins");
  const id = z.angebot[0].id;
  assert.equal(laeden.kaufen(accounts, "zoo", acc, key, { id, name: "<b>" }).ok, false, "zu kurz nach dem Säubern");
  const r = laeden.kaufen(accounts, "zoo", acc, key, { id, name: "Bello" });
  assert.equal(r.ok, true, r.error);
  assert.equal(acc.haustier, id);
  assert.equal(acc.tierNamen[id], "Bello");
  assert.ok(cosmetics.praegbar("haustier", id));
  assert.equal(laeden.kaufen(accounts, "zoo", acc, key, { id: z.angebot[1].id }).ok, false, "nur eins je Lieferung");
  const modulePath = path.join(root, "game/laeden");
  delete require.cache[require.resolve(modulePath)];
  const neuGeladen = require(modulePath);
  assert.equal(neuGeladen._store().zoo.verkauft[id], z.verkauft[id]);
  assert.equal(neuGeladen.kaufen(accounts, "zoo", acc, key, { id: z.angebot[1].id }).ok, false,
    "auch unmittelbar nach einem Neustart bleibt das Kauflimit erhalten");
});

test("Zoo: eine Vormerkung reserviert ein Exemplar der gelieferten Tierart", () => {
  const z = neueLieferung();
  const a = z.angebot[0];
  // Den Bestand von Hand leeren, als hätten andere zugegriffen.
  z.verkauft[a.id] = a.bestand;
  const { key, acc } = konto("ZooZwei");
  assert.equal(laeden.kaufen(accounts, "zoo", acc, key, { id: a.id }).ok, false);
  assert.equal(laeden.vormerken(acc, key, a.id).ok, true);
  const naechste = neueLieferung();
  assert.ok(naechste.angebot.some((x) => x.id === a.id), "die vorgemerkte Art ist dabei");
  assert.equal(naechste.reserviert[key], a.id);
  // Auch wenn alle anderen Exemplare weg sind, bleibt das zurückgelegte.
  const eintrag = naechste.angebot.find((x) => x.id === a.id);
  naechste.verkauft[a.id] = eintrag.bestand - 1;
  assert.equal(laeden.kaufen(accounts, "zoo", acc, key, { id: a.id }).ok, true);
  assert.equal(naechste.reserviert[key], undefined);
});

test("Autohaus erst ab dem Level, Kiosk immer, beides sofort angelegt", () => {
  const { key, acc } = konto("Fahrer");
  acc.xp = 0;
  assert.equal(laeden.kaufen(accounts, "autohaus", acc, key, { id: "simme" }).ok, false);
  acc.xp = 100 * 20 * 20;  // Level 21
  const r = laeden.kaufen(accounts, "autohaus", acc, key, { id: "simme" });
  assert.equal(r.ok, true, r.error);
  assert.equal(acc.fahrzeug, "simme");
  assert.equal(acc.zuFuss, false);
  const vorher = acc.chips;
  assert.equal(laeden.kaufen(accounts, "kiosk", acc, key, { id: "spezi" }).ok, true);
  assert.equal(vorher - acc.chips, kleidung.HANDDINGE.find((x) => x.id === "spezi").preis);
  assert.equal(acc.handding, "spezi");
  assert.equal(laeden.kaufen(accounts, "kiosk", acc, key, { id: "vape" }).ok, false, "die Vape gibt es nicht am Kiosk");
});

test("Absteigen nimmt das Fahrzeug aus dem Angelegten, der E46 steht", () => {
  const acc = { fahrzeug: "simme", zuFuss: true };
  assert.equal(kleidung.angelegt(acc).fahrzeug, undefined);
  assert.deepEqual(kleidung.fahrtVon(acc), { faehrt: false, steht: false });
  acc.zuFuss = false;
  assert.deepEqual(kleidung.fahrtVon(acc), { faehrt: true, steht: false });
  assert.deepEqual(kleidung.fahrtVon({ fahrzeug: "e46" }), { faehrt: false, steht: true });
  assert.deepEqual(kleidung.fahrtVon({ fahrzeug: "keins" }), { faehrt: false, steht: false });
});


test("Zoo: nicht abgeholte Reservierungen blockieren wartende Tierarten nicht", () => {
  const ids = kleidung.HAUSTIERE.filter((x) => x.nur === "zoo").slice(0, 9).map((x) => x.id);
  assert.equal(ids.length, 9);
  const z = laeden._store().zoo;
  z.reserviert = Object.fromEntries(ids.slice(0, 4).map((id, i) => [`alt${i}`, id]));
  z.vorgemerkt = ids.slice(4).map((id, i) => ({ key: `neu${i}`, id, ts: i }));
  const erste = neueLieferung();
  for (const id of ids.slice(4, 8)) assert.ok(erste.angebot.some((a) => a.id === id));
  assert.equal(erste.angebot.length, 4);
  assert.equal(Object.keys(erste.reserviert).length + erste.vorgemerkt.length, 9,
    "keine bestehende Vormerkung geht verloren");
  const zweite = neueLieferung();
  assert.equal(zweite.reserviert.neu4, ids[8], "auch die fünfte neue Art kommt dran");
  assert.equal(zweite.angebot.length, 4);
  assert.equal(Object.keys(zweite.reserviert).length + zweite.vorgemerkt.length, 9);
});
