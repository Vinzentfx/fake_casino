"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/*
 * Backup und Einspielen. Ein eingespieltes Backup darf vom alten Prozess
 * nicht mehr überschrieben werden, ein halbes Backup nie den Stand
 * ersetzen, und das Sichern vergisst weder Bilder noch gebündelt
 * Geschriebenes.
 */
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-sicherung-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const DATA = path.join(root, "data");
const ds = require(path.join(root, "game/datensicherung"));
const lies = (n) => fs.readFileSync(path.join(DATA, n), "utf8");

function frischerStand() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(DATA, "bilder"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "accounts.json"), JSON.stringify({ anna: { name: "Anna", chips: 1 } }));
  fs.writeFileSync(path.join(DATA, "city.json"), "{}");
  fs.writeFileSync(path.join(DATA, "neu-seit-backup.json"), "{}");
  fs.writeFileSync(path.join(DATA, "moderation-audit.jsonl"), "neu\n");
  fs.writeFileSync(path.join(DATA, "accounts.json.123.tmp"), "halb");
  fs.writeFileSync(path.join(DATA, ".secret"), "geheim");
  fs.writeFileSync(path.join(DATA, "bilder", "clan-a.webp"), Buffer.from([1, 2, 3]));
}
const backup = {
  files: { "accounts.json": JSON.stringify({ anna: { name: "Anna", chips: 999 } }), "city.json": '{"alt":true}', "moderation-audit.jsonl": "alt\n", ".secret": "geheim" },
  binaer: { "bilder/clan-b.webp": Buffer.from([9]).toString("base64") },
};

test("das Sichern nimmt alle Dateien und Bilder mit, aber keine halben Kopien", () => {
  frischerStand();
  const b = ds.sichern();
  assert.deepEqual(Object.keys(b.files).sort(), [".secret", "accounts.json", "city.json", "moderation-audit.jsonl", "neu-seit-backup.json"]);
  assert.deepEqual(Object.keys(b.binaer), ["bilder/clan-a.webp"]);
});

test("das Sichern schreibt vorher die gebündelte Chronik auf die Platte", () => {
  frischerStand();
  const chronik = require(path.join(root, "game/chronik"));
  chronik.notiere("info", "Gerade eben passiert");
  const b = ds.sichern();
  assert.match(b.files["chronik.json"] || "", /Gerade eben passiert/);
});

test("ein eingespieltes Backup gewinnt, auch wenn der alte Prozess danach noch speichert", () => {
  frischerStand();
  ds.einspielenVorbereiten(backup.files, backup.binaer, { erzwingen: true });
  // Der alte Prozess läuft noch und speichert seinen Stand drüber.
  fs.writeFileSync(path.join(DATA, "accounts.json"), JSON.stringify({ anna: { name: "Anna", chips: 1 } }));
  ds.ausstehendeEinspielen();
  assert.equal(JSON.parse(lies("accounts.json")).anna.chips, 999);
  assert.equal(lies("city.json"), '{"alt":true}');
  assert.equal(fs.existsSync(path.join(DATA, "neu-seit-backup.json")), false, "Schnappschuss, kein Zusammenmischen");
  assert.equal(lies("moderation-audit.jsonl"), "neu\n", "das Protokoll wird nie zurückgedreht");
  assert.deepEqual(fs.readdirSync(path.join(DATA, "bilder")), ["clan-b.webp"]);
  assert.equal(fs.existsSync(ds.WARTE), false);
});

test("ein unvollständiger Wartebereich wird verworfen, der Stand bleibt", () => {
  frischerStand();
  ds.einspielenVorbereiten(backup.files, backup.binaer, { erzwingen: true });
  fs.unlinkSync(path.join(ds.WARTE, "LISTE.json"));
  ds.ausstehendeEinspielen();
  assert.equal(JSON.parse(lies("accounts.json")).anna.chips, 1);
  assert.equal(fs.existsSync(ds.WARTE), false);
});

test("bricht der Tausch ab, macht der nächste Start dort weiter", () => {
  frischerStand();
  ds.einspielenVorbereiten(backup.files, backup.binaer, { erzwingen: true });
  // Die erste Datei ist schon getauscht, dann endete der Prozess.
  fs.renameSync(path.join(ds.WARTE, "accounts.json"), path.join(DATA, "accounts.json"));
  ds.ausstehendeEinspielen();
  assert.equal(JSON.parse(lies("accounts.json")).anna.chips, 999);
  assert.equal(lies("city.json"), '{"alt":true}');
});

test("eine kaputte Datei im Backup ändert gar nichts", () => {
  frischerStand();
  assert.throws(() => ds.einspielenVorbereiten({ ...backup.files, "city.json": "{kaputt" }, null));
  assert.equal(fs.existsSync(ds.WARTE), false);
  assert.throws(() => ds.einspielenVorbereiten({ "city.json": "{}" }, null), /accounts.json fehlt/);
});

test("eine Kontodatei mit null oder ohne echte Konten wird nicht eingespielt", () => {
  frischerStand();
  for (const kaputt of ["null", "[]", "{}", JSON.stringify({ anna: null }), JSON.stringify({ anna: { name: "Anna", chips: -5 } })]) {
    assert.throws(() => ds.einspielenVorbereiten({ ...backup.files, "accounts.json": kaputt }, {}, { erzwingen: true }), /unbrauchbar/);
  }
  assert.equal(fs.existsSync(ds.WARTE), false, "nichts liegt im Wartebereich");
});

test("fehlen im Backup Dateien, die es jetzt gibt, braucht es eine ausdrückliche Bestätigung", () => {
  frischerStand();
  assert.throws(() => ds.einspielenVorbereiten(backup.files, backup.binaer), (e) => e.code === "UNVOLLSTAENDIG" && e.fehlen.includes("neu-seit-backup.json"));
  assert.equal(fs.existsSync(ds.WARTE), false);
  assert.equal(ds.vorschau(backup.files).konten, 1);
});

test("passt eine Datei im Wartebereich nicht zur Prüfsumme, bleibt der alte Stand ganz", () => {
  frischerStand();
  ds.einspielenVorbereiten(backup.files, backup.binaer, { erzwingen: true });
  // Die vorgemerkte Kontodatei verschwindet, die Liste bleibt.
  fs.unlinkSync(path.join(ds.WARTE, "accounts.json"));
  const r = ds.ausstehendeEinspielen();
  assert.equal(r.verworfen, true);
  assert.equal(JSON.parse(lies("accounts.json")).anna.chips, 1, "der alte Kontostand bleibt");
  assert.equal(fs.existsSync(path.join(DATA, "neu-seit-backup.json")), true, "und nichts wurde gelöscht");
  assert.equal(fs.existsSync(ds.WARTE), false);
});

test("scheitert das Speichern vor dem Sichern, gibt es kein Backup", () => {
  frischerStand();
  const accounts = require(path.join(root, "game/accounts"));
  const echt = accounts.saveJetzt;
  accounts.saveJetzt = () => { throw new Error("Platte voll"); };
  try {
    assert.throws(() => ds.sichern(), /Konten ließen sich vorher nicht speichern/);
  } finally { accounts.saveJetzt = echt; }
});
