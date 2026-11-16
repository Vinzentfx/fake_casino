"use strict";
/*
 * Season 3 und die Winterkiste.
 *
 * Geprüft wird, was beim Wechsel einer Season schiefgehen kann: die falsche
 * Season ist aktiv, freigeschaltete Belohnungen verschwinden mit dem alten
 * Stand, XP läuft nach dem Ende weiter, oder ein Stück der Winterkiste
 * taucht in einer anderen Kiste auf.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Eine frische Kopie des Spiels, nie das echte data/.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-winter-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
const accounts = require(path.join(root, "game/accounts"));
const cosmetics = require(path.join(root, "game/cosmetics"));
const season = require(path.join(root, "game/season"));
const kisten = require(path.join(root, "game/kisten"));
const clans = require(path.join(root, "game/clans"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const echtJetzt = Date.now;
/** Die Uhr für die Dauer von `fn` auf einen festen Zeitpunkt stellen. */
function um(ts, fn) {
  Date.now = () => ts;
  try { return fn(); } finally { Date.now = echtJetzt; }
}

const io = { on() {}, emit() {}, of() { return { sockets: new Map() }; }, to() { return { emit() {} }; } };
season.setupSeason(io, accounts);

function verbinde(key) {
  const handlers = new Map();
  const socket = { data: { account: key }, rooms: new Set(), on(e, f) { handlers.set(e, f); return this; }, use() {}, emit() {} };
  season.setupSeason({ ...io, on(e, f) { if (e === "connection") f(socket); } }, accounts);
  return (e, payload) => {
    let antwort;
    const ack = (r) => { antwort = r; };
    if (payload === undefined) handlers.get(e)(ack); else handlers.get(e)(payload, ack);
    return antwort;
  };
}

const WINTER = season.SEASONS.find((s) => s.id === "porta-winter-3");
const HERBST = season.SEASONS.find((s) => s.id === "porta-herbst-2");
const MITTEN_IM_WINTER = Date.UTC(2026, 11, 1, 12);
const NACH_DEM_WINTER = Date.UTC(2027, 1, 1, 12);

test("die Winter-Season beginnt und endet um Mitternacht deutscher Zeit", () => {
  assert.equal(WINTER.startsAt, Date.UTC(2026, 10, 15, 23));   // 16.11. 0 Uhr MEZ
  assert.equal(WINTER.endsAt, Date.UTC(2027, 0, 17, 23));      // 18.1.  0 Uhr MEZ
  assert.ok(HERBST.endsAt <= WINTER.startsAt, "Seasons überlappen nicht");
});

test("aktuelle Season: laufende, sonst die nächste, sonst die letzte", () => {
  assert.equal(season.aktuelle(Date.UTC(2026, 9, 1)).id, "porta-herbst-2");
  assert.equal(season.aktuelle(Date.UTC(2026, 10, 10)).id, "porta-winter-3", "zwischen zwei Seasons zählt die kommende");
  assert.equal(season.aktuelle(MITTEN_IM_WINTER).id, "porta-winter-3");
  assert.equal(season.aktuelle(NACH_DEM_WINTER).id, "porta-winter-3", "nach der letzten bleibt sie stehen");
  assert.equal(um(MITTEN_IM_WINTER, () => season.SEASON.id), "porta-winter-3", "SEASON folgt der Uhr");
});

test("jedes Season-Stück steht im Katalog und trägt seine Season", () => {
  for (const s of season.SEASONS) {
    const stufen = season.stufenVon(s);
    assert.equal(stufen.length, 20);
    for (const r of stufen) {
      for (const k of r.kosmetik || []) {
        const item = cosmetics.KATALOG[k.type] && cosmetics.KATALOG[k.type][k.id];
        assert.ok(item, `${k.type} ${k.id} fehlt im Katalog`);
        assert.equal(item.season, s.id, `${k.id} gehört zu ${s.id}`);
        assert.equal(item.cost, null, `${k.id} ist nicht käuflich`);
      }
    }
  }
});

test("beim Wechsel wird Freigeschaltetes, nie Abgeholtes nachgereicht", () => {
  accounts.login("Winterkind", "Passwort2026");
  const acc = accounts.get("winterkind");
  // Stufe 1 bis 19 abgeholt, Stufe 20 erreicht und liegen gelassen.
  const claimed = {};
  for (let i = 1; i <= 19; i++) claimed[i] = true;
  // Gestern zuletzt gespielt, also läuft die Serie heute weiter.
  const gestern = Math.floor(MITTEN_IM_WINTER / 86400000) - 1;
  acc.season = { id: HERBST.id, xp: 12140, claimed, day: gestern, playDayXp: 40, questDayXp: 0, serie: 4 };
  const vorher = acc.chips;
  const faktor = accounts.faucetFactor("winterkind");
  const frage = verbinde("winterkind");

  const st = um(MITTEN_IM_WINTER, () => frage("season:state"));
  assert.equal(st.season.id, WINTER.id);
  assert.equal(st.xp, 0);
  assert.equal(acc.chips - vorher, Math.round(80000 * faktor), "nur Stufe 20 kommt dazu");
  for (const [type, id] of [["avatar", "s2_phoenix"], ["style", "s2_phoenix"], ["title", "s2_phoenix"]]) {
    assert.ok(cosmetics.hatStueck(acc, type, id), `${type} ${id} nachgereicht`);
  }
  assert.ok(!cosmetics.hatStueck(acc, "avatar", "s2_wolf"), "Stufe 15 war abgeholt und kommt nicht doppelt");
  assert.equal(st.nachgereicht.season, "Porta-Herbst");
  assert.equal(acc.season.serie, 5, "die Serie gehört dem Menschen und läuft über den Wechsel weiter");

  // Ein zweiter Aufruf zahlt nichts mehr.
  const danach = acc.chips;
  um(MITTEN_IM_WINTER, () => frage("season:state"));
  assert.equal(acc.chips, danach);
});

test("XP wächst nur, solange die Season läuft, der Clan zählt immer mit", () => {
  accounts.login("Frostbeule", "Passwort2026");
  const acc = accounts.get("frostbeule");
  const clanXp = [];
  const original = clans.addSeasonXp;
  clans.addSeasonXp = (key, n) => { clanXp.push([key, n]); };
  try {
    const drin = um(MITTEN_IM_WINTER, () => season.addXp("Frostbeule", 3, "play"));
    assert.ok(drin > 0);
    assert.equal(acc.season.xp, drin);

    const draussen = um(NACH_DEM_WINTER, () => season.addXp("Frostbeule", 3, "play"));
    assert.equal(draussen, 0, "nach dem Ende nichts mehr für den Pass");
    assert.equal(acc.season.xp, drin);
    assert.equal(clanXp.length, 2, "der Clan bekommt beide Male etwas");

    assert.equal(um(NACH_DEM_WINTER, () => season.addXp("Frostbeule", 50, "geschenk")), 0,
      "ohne Season gibt das Glücksrad keine XP, sondern Chips");
  } finally {
    clans.addSeasonXp = original;
  }
});

test("Winterkiste: jede Stufe gefüllt, die Stücke nur in diesem Topf", () => {
  const leer = { name: "x", cosOwned: {} };
  const winter = kisten.inhalt(leer, "winter");
  assert.ok(winter, "Winterkiste existiert");
  for (const s of winter.stufen) assert.ok(s.stuecke.length > 0, `Stufe ${s.id} hat Inhalt`);
  const summe = winter.stufen.reduce((n, s) => n + s.pct, 0);
  assert.equal(summe, 100);
  const inWinter = new Set(winter.stufen.flatMap((s) => s.stuecke.map((x) => x.id)));
  // Dreizehn für den Namen, dazu die Schneestapfen für die Figur.
  assert.equal(inWinter.size, 14);
  for (const id of Object.keys(kisten.KISTEN)) {
    if (id === "winter") continue;
    const inh = kisten.inhalt(leer, id);
    for (const s of inh.stufen) {
      for (const x of s.stuecke) assert.ok(!x.id.startsWith("winter_"), `${x.id} liegt auch in ${id}`);
    }
  }
  assert.deepEqual(kisten.pruefe(), []);
});

test("Winterkiste läuft am Dreikönigstag um halb neun ab", () => {
  const k = kisten.KISTEN.winter;
  assert.equal(k.bis, Date.UTC(2027, 0, 6, 19, 30));
  assert.ok(k.bis < WINTER.endsAt, "die Kiste endet vor der Season");
  assert.equal(um(k.bis - 1, () => kisten.laeuft(k)), true);
  assert.equal(um(k.bis, () => kisten.laeuft(k)), false);
  const liste = um(k.bis + 1, () => kisten.oeffentlich({ name: "x", cosOwned: {} }).kisten);
  assert.ok(!liste.some((x) => x.id === "winter"), "abgelaufen steht sie nicht mehr da");
});
