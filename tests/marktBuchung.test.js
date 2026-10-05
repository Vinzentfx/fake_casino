"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "casino-markt-test-")));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.cpSync(path.join(__dirname, "../public/js/welt"), path.join(root, "public/js/welt"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function neustart() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(root, "game"))) delete require.cache[k];
  const r = (n) => require(path.join(root, "game", n));
  return { accounts: r("accounts"), cosmetics: r("cosmetics"), praegung: r("praegung"), market: r("market"), buchungen: r("buchungen"), r };
}

test("ein Marktkauf, der nach dem Konto abbricht, wird beim Start vollständig nachgezogen, genau einmal", () => {
  let m = neustart();
  m.accounts.login("Haendlerin", "Passwort2026");
  m.accounts.login("Kaeuferin", "Passwort2026");
  m.accounts.login("Zweite", "Passwort2026");
  const v = m.accounts.get("haendlerin"), k = m.accounts.get("kaeuferin"), z = m.accounts.get("zweite");
  k.chips = 500000; z.chips = 500000;
  assert.ok(m.cosmetics.grant(v, "hand", "gummihuhn", "haendlerin"));
  const uid = m.praegung.stueckVon("haendlerin", "hand", "gummihuhn").uid;
  const a = m.market._intern.anbieten(m.accounts, "haendlerin", uid, 100000);
  assert.equal(a.ok, true, a.error);
  m.accounts.saveJetzt();
  const vorher = { v: v.chips, k: k.chips };

  // Absturz direkt nach dem gesicherten Konto: das Exemplar lässt sich nicht mehr umschreiben.
  const echt = m.praegung.uebertragen;
  m.praegung.uebertragen = () => { throw new Error("Absturz"); };
  m.market._intern.kaufen(m.accounts, "kaeuferin", a.id);
  m.praegung.uebertragen = echt;
  assert.equal(Object.keys(m.buchungen._offen()).length, 1, "die Buchung steht noch im Journal");

  m = neustart();
  m.buchungen.wiederaufnehmen({ accounts: m.accounts, cosmetics: m.cosmetics, praegung: m.praegung });
  assert.equal(Object.keys(m.buchungen._offen()).length, 0);
  assert.equal(m.praegung.stueck(uid).besitzer, "kaeuferin", "das Exemplar gehört der Käuferin");
  assert.equal(m.market._intern.store().angebote[a.id], undefined, "das Angebot ist weg");
  assert.equal(m.accounts.get("kaeuferin").chips, vorher.k - 100000);
  assert.equal(m.accounts.get("haendlerin").chips, vorher.v + 90000);
  assert.equal(m.market._intern.kaufen(m.accounts, "zweite", a.id).ok, false, "niemand kauft es ein zweites Mal");
});

test("ein Angebot, das nach dem Konto abbricht, gibt das Stück beim Start zurück", () => {
  let m = neustart();
  m.accounts.login("Anbieter", "Passwort2026");
  const acc = m.accounts.get("anbieter");
  assert.ok(m.cosmetics.grant(acc, "hand", "eintrittskarte", "anbieter"));
  const uid = m.praegung.stueckVon("anbieter", "hand", "eintrittskarte").uid;
  // Das Konto wird gesichert, das Angebot nicht mehr: der Markt-Speicher fällt aus.
  const fs2 = require("node:fs");
  const echt = fs2.renameSync;
  let n = 0;
  fs2.renameSync = (von, nach) => { if (String(nach).endsWith("market.json") && n++ === 0) throw Object.assign(new Error("Absturz"), { abbruch: true }); return echt(von, nach); };
  const r = m.market._intern.anbieten(m.accounts, "anbieter", uid, 5000);
  fs2.renameSync = echt;
  assert.equal(r.ok, false);
  assert.ok((m.accounts.get("anbieter").cosOwned.handdinge || []).includes("eintrittskarte"), "das Stück ist sofort wieder da");
});
