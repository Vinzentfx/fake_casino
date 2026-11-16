"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/*
 * Die Börse darf niemanden im Schnitt reicher machen.
 *
 * Bis November 2026 tat sie genau das: jede Aktie ging mit 0,25 % je Takt
 * aus heiterem Himmel pleite, und ein Short bekam dann das Hebelfache
 * ausgezahlt. Wer alle Aktien shortete, verdoppelte seinen Einsatz im
 * Schnitt alle Viertelstunde. Diese Datei rechnet nach, dass das vorbei ist,
 * und zwar mit dem echten Modul und nicht mit einer Nachbildung.
 *
 * Der Zufall ist hier fest (gleiche Saat, gleiche Zahlen), damit ein
 * Fehlschlag etwas bedeutet und nicht Pech ist.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "casino-boerse-test-"));
fs.cpSync(path.join(__dirname, "../game"), path.join(root, "game"), { recursive: true });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fester(saat) {
  let s = saat >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = fester(20261112);

// Tausende Takte sollen nicht tausendmal auf die Platte schreiben.
require(path.join(root, "game/buchungen")).sicherSchreiben = () => {};
const boerse = require(path.join(root, "game/stocks"));
const B = boerse._intern;

test("der Kurs hat keine Richtung: im Mittel steht er nach 50 Takten, wo er war", () => {
  for (const vol of B.SCHWANKUNG) {
    let summe = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const s = { price: 100, basePrice: 100, vol };
      for (let k = 0; k < 50; k++) B.kursSchritt(s);
      summe += s.price;
    }
    assert.ok(Math.abs(summe / n - 100) < 0.2, `Schwankung ${vol}: Mittel ${summe / n}`);
  }
});

test("Ordergebühr steckt im Einstiegskurs, Grenzen je Position und je Konto", () => {
  const sym = boerse.publicStocks()[0].sym;
  assert.equal(boerse.open("grenze", sym, 1, B.MIN_MARGIN - 1, 1).ok, false);
  assert.equal(boerse.open("grenze", sym, 1, B.MAX_MARGIN + 1, 1).ok, false);

  // Long mit Hebel 5: sofort Hebel mal Gebühr im Minus, beim Short ebenso.
  assert.equal(boerse.open("lang", sym, 1, 10000, 5).ok, true);
  assert.equal(boerse.open("kurz", sym, -1, 10000, 5).ok, true);
  const lang = boerse.positionsFor("lang")[0], kurz = boerse.positionsFor("kurz")[0];
  assert.ok(Math.abs(lang.equity - 10000 * (1 - 5 * B.SPREAD / (1 + B.SPREAD))) <= 1, `Long startet bei ${lang.equity}`);
  assert.ok(Math.abs(kurz.equity - 10000 * (1 - 5 * B.SPREAD / (1 - B.SPREAD))) <= 1, `Short startet bei ${kurz.equity}`);
  assert.equal(boerse.close("lang", lang.id).ok, true);
  assert.equal(boerse.close("kurz", kurz.id).ok, true);

  for (let i = 0; i < B.MAX_OFFEN; i++) assert.equal(boerse.open("viele", sym, 1, B.MIN_MARGIN, 1).ok, true);
  assert.equal(boerse.open("viele", sym, 1, B.MIN_MARGIN, 1).ok, false, "eine Position zu viel");
  for (const p of boerse.positionsFor("viele")) boerse.close("viele", p.id);
});

test("Pleite rechnet zum letzten Kurs ab, nicht zu null", () => {
  const sym = boerse.publicStocks()[0].sym;
  const s = B.markt().stocks[sym];
  s.basePrice = 100; s.price = 50;
  assert.equal(boerse.open("pleite-short", sym, -1, 10000, 1).ok, true);
  assert.equal(boerse.open("pleite-long", sym, 1, 10000, 1).ok, true);
  // Weit unter der Grenze: auch der beste Takt hebt den Kurs nicht mehr darüber.
  s.price = 10;
  const { liquidated, bankruptcies } = boerse.tick();
  assert.deepEqual(bankruptcies, [sym]);
  const kurz = liquidated.find((e) => e.owner === "pleite-short");
  const lang = liquidated.find((e) => e.owner === "pleite-long");
  assert.ok(kurz.pleite && lang.pleite);
  /* Die alte Regel zahlte dem Short Einschuss mal (1 + Hebel) = 20.000 und
     dem Long nichts. Jetzt bekommt der Short seinen echten Gewinn (der Kurs
     fiel von 50 auf rund 10) und der Long den Rest seiner Position. */
  assert.ok(kurz.payout > 17700 && kurz.payout < 18200, `Short bekam ${kurz.payout}`);
  assert.ok(lang.payout > 1700 && lang.payout < 2200, `Long bekam ${lang.payout}`);
  // Was der eine gewinnt, verliert der andere; die Ordergebühr geht ab.
  assert.ok(kurz.payout + lang.payout < 20000);
  assert.equal(boerse.positionsFor("pleite-short").length, 0);
});

test("pleite geht nur, wer unter die Grenze gefallen ist, und kein Name steht doppelt", () => {
  const markt = B.markt();
  // Alle knapp über die Grenze setzen, damit es in dieser Prüfung auch Pleiten gibt.
  for (const s of Object.values(markt.stocks)) s.price = s.basePrice * (B.PLEITE_GRENZE + 0.02);
  // Tiefer als so kann ein Kurs in einem einzigen Takt nicht fallen.
  const tiefsterTakt = (1 - Math.max(...B.SCHWANKUNG)) * (1 - (B.NEWS_MIN + B.NEWS_SPANNE));
  let pleiten = 0;
  for (let i = 0; i < 20000; i++) {
    const vorher = Object.fromEntries(Object.values(markt.stocks).map((s) => [s.sym, s.price / s.basePrice]));
    for (const sym of boerse.tick().bankruptcies) {
      pleiten++;
      assert.ok(vorher[sym] < B.PLEITE_GRENZE / tiefsterTakt, `${sym} ging bei ${vorher[sym]} des Ausgabekurses pleite`);
    }
    const namen = Object.values(markt.stocks).map((s) => s.name);
    assert.equal(new Set(namen).size, namen.length, `doppelter Firmenname: ${namen.join(", ")}`);
  }
  assert.ok(pleiten >= 1, "in dieser Prüfung sollte mindestens eine Firma pleitegehen");
});

test("keine Spielweise gewinnt im Schnitt: long und short, Hebel 1 und 5, zwanzig Minuten gehalten", (t) => {
  const markt = B.markt();
  const klassen = {};
  const einsatz = 10000;
  for (let runde = 0; runde < 300; runde++) {
    const offen = new Map();   // Besitzer: { id, klasse }
    for (const sym of Object.keys(markt.stocks)) for (const dir of [1, -1]) for (const lev of [1, 5]) {
      const wer = `${sym}:${dir}:${lev}`;
      const r = boerse.open(wer, sym, dir, einsatz, lev);
      assert.equal(r.ok, true, r.error);
      const k = klassen[`${dir > 0 ? "long" : "short"} Hebel ${lev}`] ||= { n: 0, summe: 0 };
      k.n++;
      offen.set(wer, { id: r.id, k });
    }
    for (let t = 0; t < 200; t++) {
      for (const ev of boerse.tick().liquidated) {
        const o = offen.get(ev.owner);
        if (!o) continue;
        o.k.summe += ev.payout;
        offen.delete(ev.owner);
      }
    }
    for (const [wer, o] of offen) o.k.summe += boerse.close(wer, o.id).payout;
  }
  for (const [name, k] of Object.entries(klassen)) {
    const ev = k.summe / (k.n * einsatz);
    t.diagnostic(`${name}: Rückfluss ${(ev * 100).toFixed(1)} % über ${k.n} Positionen`);
    assert.ok(ev < 0.995, `${name}: Rückfluss ${ev.toFixed(4)} muss unter 1 liegen`);
    assert.ok(ev > 0.85, `${name}: Rückfluss ${ev.toFixed(4)} ist unerwartet niedrig`);
  }
});

test("der Sprungvorteil gehebelter Positionen bleibt unter der Ordergebühr", () => {
  /* Springt der Kurs über die Liquidation hinaus, verliert man nur den
     Einschuss. Dieser erlassene Rest ist der einzige Vorteil, den Hebeln
     noch hat. Gemessen wird er direkt: wie weit lag der Wert bei der
     Liquidation unter null, als Anteil des Positionswerts. */
  const gebuehr = B.SPREAD / (1 + B.SPREAD);
  for (const vol of B.SCHWANKUNG) for (const dir of [1, -1]) {
    const lev = 5, n = 200;
    let erlassen = 0;
    for (let i = 0; i < n; i++) {
      const s = { price: 100, basePrice: 100, vol };
      for (let t = 0; t < 14400 * 20; t++) {
        B.kursSchritt(s);
        const wert = 1 + dir * (s.price - 100) * (lev / 100);
        if (wert <= 0) { erlassen += -wert; break; }
        if (s.price < 100 * B.PLEITE_GRENZE) break;
      }
    }
    const jePositionswert = erlassen / n / lev;
    assert.ok(jePositionswert < gebuehr * 0.75,
      `Schwankung ${vol}, ${dir > 0 ? "long" : "short"}: Vorteil ${(jePositionswert * 100).toFixed(2)} % gegen Gebühr ${(gebuehr * 100).toFixed(2)} %`);
  }
});
