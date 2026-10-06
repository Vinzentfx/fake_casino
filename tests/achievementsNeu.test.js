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
