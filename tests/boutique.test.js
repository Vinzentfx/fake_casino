"use strict";
const test = require("node:test");
const assert = require("node:assert");
const boutique = require("../game/boutique");
const cosmetics = require("../game/cosmetics");

test("das Schaufenster: vier Stücke, nie legendär oder mythisch, Preis über dem Wert", () => {
  const a = boutique.angebot(Date.UTC(2026, 9, 1, 12));
  assert.equal(a.stuecke.length, 4);
  // Gewöhnliches hängt dauerhaft an der Stange, das Fenster zeigt das Besondere.
  assert.deepEqual(a.stuecke.map((x) => x.stufe), ["selten", "selten", "episch", "episch"]);
  for (const x of a.stuecke) {
    const item = cosmetics.KATALOG[x.art][x.id];
    assert.equal(item.nur, "kleider", "nur Kleidung");
    assert.ok(x.preis >= item.cost, "nie unter dem Wert");
    assert.equal(x.preis, Math.round((item.cost * boutique.AUFPREIS) / 1000) * 1000);
  }
  assert.ok(a.bis > Date.UTC(2026, 9, 1, 12), "endet in der Zukunft");
});

test("das Schaufenster ist eine Woche lang für alle dasselbe und wechselt danach", () => {
  const mo = Date.UTC(2026, 9, 6, 10), fr = Date.UTC(2026, 9, 9, 18), naechste = Date.UTC(2026, 9, 13, 10);
  const ids = (t) => boutique.angebot(t).stuecke.map((x) => x.art + ":" + x.id).join(",");
  assert.equal(ids(mo), ids(fr));
  assert.notEqual(ids(mo), ids(naechste));
});

test("die Kleiderstange: alles Gewöhnliche, dauerhaft, deutlich unter dem Wert", () => {
  const s = boutique.stange();
  const kisten = require("../game/kisten");
  const gewoehnlich = [];
  for (const [art, liste] of Object.entries(cosmetics.KATALOG)) {
    for (const x of Object.values(liste)) if (x.nur === "kleider" && x.cost && kisten.stufeVon(x.cost).id === "gewoehnlich") gewoehnlich.push(art + ":" + x.id);
  }
  assert.deepEqual(s.map((x) => x.art + ":" + x.id).sort(), gewoehnlich.sort());
  for (const x of s) {
    assert.ok(x.preis < x.cost, `${x.id} unter dem Wert`);
    assert.ok(x.preis >= 1000 && x.preis % 500 === 0);
  }
});
