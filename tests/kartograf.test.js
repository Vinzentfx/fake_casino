"use strict";
/*
 * Das Vermächtnis des Kartografen (game/kartograf.js).
 *
 * Geprüft wird, was das Rätsel ausmacht: jeder bekommt ein eigenes Haus,
 * der Brief lässt sich mit dem, was darin steht, wirklich entschlüsseln,
 * keine Richtung steht auf der Kippe, und die Stufen gehen nur der Reihe
 * nach.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const kartograf = require("../game/kartograf");
const city = require("../game/city");
const I = kartograf._intern;

const ausRoemisch = (r) => {
  const W = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < r.length; i++) n += W[r[i]] < (W[r[i + 1]] || 0) ? -W[r[i]] : W[r[i]];
  return n;
};
const zurueck = (t, um) => t.replace(/[A-Z]/g, (c) => String.fromCharCode(65 + ((c.charCodeAt(0) - 65 - um + 26 * 3) % 26)));

test("jeder bekommt ein eigenes Haus, und das hängt am Geheimnis des Servers", () => {
  const keys = Array.from({ length: 60 }, (_, i) => "spieler" + i);
  const haeuser = new Set(keys.map((k) => I.hausVon(k).id));
  assert.ok(haeuser.size >= 58, `60 Konten, ${haeuser.size} verschiedene Häuser`);
  assert.equal(I.hausVon("anna").id, I.hausVon("anna").id, "immer dasselbe für dasselbe Konto");
  const vorher = I.hausVon("anna").id;
  I._geheimnis("ein-anderes-geheimnis");
  const anders = keys.filter((k) => I.hausVon(k).id !== I.hausVon(k).id).length;
  assert.equal(anders, 0);
  assert.notEqual(I.hausVon("anna").id, vorher, "wer das Geheimnis nicht kennt, kann das Haus nicht ausrechnen");
  I._geheimnis("kartograf-ohne-geheimnis");
});

test("der Brief lässt sich mit dem entschlüsseln, was darin steht", () => {
  for (const key of ["anna", "bert", "carla", "dieter", "emil"]) {
    const h = I.hausVon(key);
    const zeilen = I.brief(key).split("\n").filter((z) => z.startsWith("    ")).map((z) => z.trim());
    const [ana, strasse, nr] = zeilen;
    const ortsteil = I.ascii(h.ortsteil);
    assert.deepEqual(ana.split("").sort(), ortsteil.split("").sort(), "das Anagramm hat genau die Buchstaben des Ortsteils");
    assert.notEqual(ana, ortsteil, "und ist nicht einfach der Ortsteil");
    assert.equal(zurueck(strasse, ortsteil.replace(/[^A-Z]/g, "").length), I.ascii(h.strasse), "zurückgezählt ergibt sich die Straße");
    assert.equal(ausRoemisch(nr), h.nr);
  }
});

test("kein Ziel steht auf der Kippe zwischen zwei Richtungen", () => {
  const casino = city.casinoMitte();
  const ziele = I.ziele();
  assert.ok(ziele.length > 1000, `${ziele.length} mögliche Häuser`);
  for (const h of ziele) {
    const grad = I.peilung(h.c, casino);
    assert.ok(I.randAbstand(grad) >= 4, `${h.strasse} ${h.nr}: ${grad.toFixed(1)}°`);
    assert.equal(I.richtungVon(grad), h.richtung);
    assert.ok(Math.hypot(casino[0] - h.c[0], casino[1] - h.c[1]) >= 400);
  }
  assert.ok(new Set(ziele.map((h) => h.richtung)).size >= 8, "die Richtungen sind gemischt");
});

test("Himmelsrichtungen werden in jeder üblichen Schreibweise verstanden", () => {
  const faelle = { "Nordnordost": "NNO", "nord-nord-ost": "NNO", "NNE": "NNO", "Westen": "W", "Süd-Südwest": "SSW", "SSW": "SSW", "ostnordost": "ONO", "Nordwesten": "NW" };
  for (const [ein, soll] of Object.entries(faelle)) assert.equal(I.richtungLesen(ein), soll, ein);
  for (const quatsch of ["", "Casino", "nordnordnord", "oben"]) assert.equal(I.richtungLesen(quatsch), null, quatsch);
});

test("die Stufen gehen nur der Reihe nach, und gefunden wird genau einmal", () => {
  const key = "karla";
  const acc = { name: "Karla" };
  const h = I.hausVon(key);
  const andere = I.ziele().find((x) => x.richtung !== h.richtung);

  assert.equal(kartograf.fernrohr(acc, key, h.richtung), null, "ohne Brief sagt das Fernrohr nichts");
  assert.match(kartograf.pult(acc, key).text, /Kartograf/);
  assert.equal(kartograf.eingabePult(acc, key, "Irgendwoweg 3").satz.includes("nicht sein Haus"), true);
  assert.equal(kartograf.stufe(acc), 0);

  // Mit Umlaut, mit „Straße“ ausgeschrieben, mit dem Ortsteil hinten dran: alles gilt.
  kartograf.eingabePult(acc, key, `${h.strasse} ${h.nr}, ${h.ortsteil}`);
  assert.equal(kartograf.stufe(acc), 1);

  kartograf.eingabePult(acc, key, String(h.a + 1));
  assert.equal(kartograf.stufe(acc), 1, "eine falsche Fläche bringt nichts");
  kartograf.eingabePult(acc, key, `${h.a.toLocaleString("de-DE")} m²`);
  assert.equal(kartograf.stufe(acc), 2);

  assert.equal(kartograf.pult(acc, key).keineEingabe, true, "jetzt geht es aufs Dach");
  assert.match(kartograf.fernrohr(acc, key, andere.richtung).satz, /nichts gesehen/);
  assert.equal(kartograf.stufe(acc), 2);
  assert.equal(kartograf.fernrohr(acc, key, "Mars"), null, "was keine Richtung ist, geht weiter ans Weserlicht");
  kartograf.fernrohr(acc, key, h.richtung.toLowerCase());
  assert.equal(kartograf.stufe(acc), 3);

  assert.equal(kartograf.pult(acc, key).fund, true);
  assert.equal(kartograf.finden(acc), true);
  assert.equal(kartograf.finden(acc), false, "nur einmal");
  assert.equal(kartograf.notizen(acc, key).length, 4, "alles steht zum Nachlesen im Logbuch");
});

test("die Adresse gilt genau, aber in jeder vernünftigen Schreibweise", () => {
  const key = "adressprobe";
  const h = I.hausVon(key);
  const probe = (text) => { const acc = { name: "x" }; kartograf.eingabePult(acc, key, text); return kartograf.stufe(acc); };
  const strasse = h.strasse;
  assert.equal(probe(`${strasse} ${h.nr}`), 1);
  assert.equal(probe(`${strasse}${h.nr}`), 1, "ohne Leerzeichen");
  assert.equal(probe(`${strasse.replace(/straße/i, "str.")} ${h.nr}`), 1, "abgekürzt");
  assert.equal(probe(`${strasse.replace(/ß/g, "ss")} ${h.nr}`), 1, "ss statt ß");
  assert.equal(probe(`${strasse} ${h.nr}, 32457 Porta Westfalica`), 1, "mit Stadt");
  assert.equal(probe(`${h.ortsteil}, ${strasse} ${h.nr}`), 1, "Ortsteil vorn");
  assert.equal(probe(`${strasse} ${h.nr}2`), 0, "eine Ziffer mehr ist ein anderes Haus");
  assert.equal(probe(`${strasse} ${h.nr + 1}`), 0);
  assert.equal(probe(`Neben${strasse.toLowerCase()} ${h.nr}`), 0, "eine andere Straße, die gleich endet");
});

test("eine Straße, die wie ihr Ortsteil anfängt, bleibt lösbar", () => {
  const h = I.ziele().find((x) => I.norm(x.strasse).startsWith(I.norm(x.ortsteil)));
  if (!h) return;   // gibt es in der Karte nicht, dann ist nichts zu prüfen
  const acc = { name: "x" };
  // Das Ziel von Hand setzen: Stufe 0 prüft gegen hausVon, also über einen Schlüssel, der dorthin zeigt.
  const key = Array.from({ length: 20000 }, (_, i) => "k" + i).find((k) => I.hausVon(k).id === h.id);
  if (!key) return;
  kartograf.eingabePult(acc, key, `${h.strasse} ${h.nr}`);
  assert.equal(kartograf.stufe(acc), 1, `${h.strasse} ${h.nr} in ${h.ortsteil}`);
});

test("Fläche und Richtung lassen sich nicht durchprobieren: drei Versuche am Tag", () => {
  const key = "rater";
  const h = I.hausVon(key);
  const acc = { name: "x", kartograf: { stufe: 1 } };
  for (let i = 0; i < kartograf.VERSUCHE_TAG; i++) kartograf.eingabePult(acc, key, String(h.a + 1000 + i));
  assert.match(kartograf.eingabePult(acc, key, String(h.a)).satz, /morgen/, "auch die richtige Zahl zählt heute nicht mehr");
  assert.equal(kartograf.stufe(acc), 1);
  assert.match(kartograf.eingabePult(acc, key, "keine Ahnung").satz, /Zahl/, "was keine Zahl ist, kostet keinen Versuch");

  // Am nächsten Tag geht es weiter.
  acc.kartograf.versuche.tag -= 1;
  kartograf.eingabePult(acc, key, String(h.a));
  assert.equal(kartograf.stufe(acc), 2);
  const falsch = I.ziele().find((x) => x.richtung !== h.richtung).richtung;
  for (let i = 0; i < kartograf.VERSUCHE_TAG; i++) kartograf.fernrohr(acc, key, falsch);
  assert.match(kartograf.fernrohr(acc, key, h.richtung).satz, /morgen/);
  assert.equal(kartograf.stufe(acc), 2);
});

test("wer fertig ist, bekommt die nächste Nummer", () => {
  const alle = [{ kartograf: { stufe: 4 } }, { kartograf: { stufe: 2 } }, { kartograf: { stufe: 4 } }];
  const ich = { kartograf: { stufe: 3, t: {} } };
  assert.equal(kartograf.finden(ich, [...alle, ich]), true);
  assert.equal(ich.kartograf.nr, 3);
  assert.equal(kartograf.geloest([...alle, ich]), 3);
});
