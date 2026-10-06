"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

/* Versteckte Achievements verlassen den Server nur als Fragezeichen, und
   der Greifautomat zählt Versuche aus der Statistik, Treffer am Konto. */
function mitKonto(acc) {
  const ach = require("../game/achievements");
  const freigeschaltet = [];
  const accounts = {
    get: () => acc, save() {}, onHand() {},
    adjustChips: (k, n) => { acc.chips = (acc.chips || 0) + n; return { ok: true }; },
  };
  const io = { on() {}, emit: (ev, d) => { if (ev === "ach:unlocked") freigeschaltet.push(d.id); } };
  ach.setupAchievements(io, accounts);
  return { ach, freigeschaltet };
}

test("ein verstecktes Achievement zeigt vor dem Freischalten nichts, danach seinen Namen", () => {
  const acc = { name: "Anna", chips: 0 };
  const { ach, freigeschaltet } = mitKonto(acc);
  const zu = ach.listFor("anna").find((a) => a.id === "geheim_kreidemond");
  assert.equal(zu.label, "???");
  assert.equal(zu.desc, "???");
  assert.equal(zu.reward, null);
  assert.equal(JSON.stringify(ach.listFor("anna")).includes("E46"), false);
  acc.geheimnisse = { e46: Date.now() };
  ach.check("anna");
  assert.ok(freigeschaltet.includes("geheim_kreidemond"));
  const auf = ach.listFor("anna").find((a) => a.id === "geheim_kreidemond");
  assert.equal(auf.label, "Kreidemond");
  assert.equal(/auto|bmw|e46|wagen/i.test(auf.label + auf.desc), false, "auch danach verrät es nichts");
});

test("die Greifer-Achievements zählen Versuche, knappe Fehlgriffe und den einen Treffer", () => {
  const acc = { name: "Bert", chips: 0, stats: { perGame: { greifer: { plays: 999 } } }, greifer: { knapp: 24 } };
  const { ach, freigeschaltet } = mitKonto(acc);
  ach.check("bert");
  assert.ok(freigeschaltet.includes("greifer_100"));
  assert.equal(freigeschaltet.includes("greifer_1000"), false);
  acc.stats.perGame.greifer.plays = 1000;
  acc.greifer.knapp = 25;
  ach.check("bert");
  assert.ok(freigeschaltet.includes("greifer_1000"));
  assert.ok(freigeschaltet.includes("greifer_knapp"));
  assert.equal(freigeschaltet.includes("greifer_halt"), false);
  // Wer das Huhn schon vor diesen Zeilen gefangen hat, bekommt es auch.
  acc.cosOwned = { hand: ["gummihuhn"] };
  ach.check("bert");
  assert.ok(freigeschaltet.includes("greifer_halt"));
});

test("die Hinweise zum großen Rätsel kommen montags, einer je Woche, und nie im Voraus", () => {
  const r = require("../game/raetsel");
  const t = (s) => Date.parse(s);
  assert.equal(r.hinweiseFrei(t("2026-10-04T23:00:00+02:00")), 0, "vor dem Start keiner");
  assert.equal(r.hinweiseFrei(t("2026-10-06T12:00:00+02:00")), 1);
  assert.equal(r.hinweiseFrei(t("2026-10-11T23:59:00+02:00")), 1, "Sonntagnacht noch derselbe");
  assert.equal(r.hinweiseFrei(t("2026-10-12T00:30:00+02:00")), 2, "Montag kommt der nächste");
  assert.equal(r.hinweiseFrei(t("2027-06-01T12:00:00+02:00")), r.HINWEISE.length, "irgendwann sind alle da");
  const h = r.hinweise(t("2026-10-06T12:00:00+02:00"));
  assert.equal(h.liste.length, 1);
  assert.ok(h.naechster > t("2026-10-11T23:00:00+02:00") && h.naechster <= t("2026-10-12T00:00:00+02:00"));
  // Kein Hinweis verrät eine Antwort im Klartext.
  const alle = r.HINWEISE.join(" ").toLowerCase();
  for (const geheim of ["nachteule", "1896", "beteigeuze", "betelgeuse", "wittekind", "zylinder"]) assert.equal(alle.includes(geheim), false, geheim);
});

test("wer auf der richtigen Stufe ohne Hut ins Leere greift, bekommt einen leisen Wink", () => {
  const r = require("../game/raetsel");
  const acc = { weserlicht: { stufe: 3 } };
  const ohne = r.greifer(acc, null);
  assert.equal(ohne.leise, true);
  assert.equal(acc.weserlicht.stufe, 3, "der Wink hebt keine Stufe");
  assert.equal(r.greifer(acc, 1), null, "mit einem Ball passiert nichts");
  acc.kopf = "zylinder";
  assert.match(r.greifer(acc, null).satz, /Schornstein/);
  assert.equal(acc.weserlicht.stufe, 4);
});
