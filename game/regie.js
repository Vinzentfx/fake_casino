"use strict";

/**
 * Regie: das naechste Ergebnis von Hand setzen.
 *
 * Es gab das schon, aber nur an einer Stelle und nur in einer Richtung: ein
 * Knopf stellte den naechsten Slot-Dreh des Besitzers auf den Maximalgewinn,
 * damit man die Animation zeigen kann. Genau das braucht man aber auch, wenn
 * jemand beweisen will, dass es sein Lieblingsspiel gar nicht auszahlt, wenn
 * ein Gewinn falsch verbucht wurde und man die Runde nachstellen muss, oder
 * wenn man jemandem zum Geburtstag die grosse Zahl zuschieben will.
 *
 * Eine Regie-Anweisung gilt genau EINMAL. Sie wird beim Ziehen verbraucht, wie
 * ein hingelegter Zettel, den der Croupier danach wegwirft. Das ist die
 * wichtigste Eigenschaft: eine Anweisung, die bleibt, waere ein manipuliertes
 * Spiel, und wer sie setzt, vergisst sie garantiert.
 *
 * Nichts davon wird gespeichert. Ein Serverneustart raeumt alle Anweisungen
 * weg, und das ist richtig so: nach einem Neustart soll niemand in ein
 * Ergebnis laufen, das vor Stunden jemand gesetzt hat.
 *
 * Runden, die allen gemeinsam gehoeren (Crash), gehen ueber den Schluessel
 * `*`: dort gibt es keinen einzelnen Spieler, dessen Dreh man biegen koennte.
 */

const GLOBAL = "*";

/**
 * Was sich setzen laesst.
 *   wahl  feste Auswahl, `wert` ist einer der Schluessel
 *   zahl  Zahl in Grenzen
 * `global` heisst: gilt fuer die naechste Runde aller, nicht fuer eine Person.
 */
const ZIELE = {
  slots: {
    name: "Slots: nächster Dreh",
    art: "wahl",
    optionen: { max: "Maximalgewinn (volles Raster)", niete: "Nullrunde (mit Beinahe-Treffern)" },
    was: "Gilt für den nächsten Dreh im Grundspiel.",
  },
  rad: {
    name: "Glücksrad: nächstes Feld",
    art: "feld",
    was: "Das Rad landet beim nächsten Dreh auf diesem Feld. Der Tagesabstand gilt weiter.",
  },
  roulette: {
    name: "Roulette: nächste Zahl",
    art: "zahl",
    min: 0, max: 36, vorgabe: 0,
    was: "Die Kugel landet beim nächsten Solo-Dreh auf dieser Zahl.",
  },
  crash: {
    name: "Crash: nächster Crashpunkt",
    art: "zahl",
    min: 1, max: 120, vorgabe: 10, global: true, schritt: 0.5,
    was: "Gilt für die nächste Runde und damit für alle, die mitspielen.",
  },
};

const zettel = new Map();   // "key|ziel" -> { wert, seit }

const norm = (key) => (key === GLOBAL ? GLOBAL : String(key || "").toLowerCase());
const id = (key, ziel) => `${norm(key)}|${ziel}`;

/** Anweisung hinlegen. Ersetzt eine bestehende fuer dasselbe Ziel. */
function setze(key, ziel, wert) {
  const z = ZIELE[ziel];
  if (!z) return { ok: false, error: "Unbekanntes Ziel." };
  const wer = z.global ? GLOBAL : norm(key);
  if (!wer) return { ok: false, error: "Kein Spieler angegeben." };

  let w = wert;
  if (z.art === "wahl") {
    if (!z.optionen[String(wert)]) return { ok: false, error: "Ungültige Auswahl." };
    w = String(wert);
  } else {
    w = Number(wert);
    if (!Number.isFinite(w)) return { ok: false, error: "Keine Zahl." };
    if (z.art === "zahl") {
      if (w < z.min || w > z.max) return { ok: false, error: `${z.min} bis ${z.max}.` };
      w = z.schritt ? Math.round(w * 100) / 100 : Math.floor(w);
    } else {
      w = Math.floor(w);
      if (w < 0) return { ok: false, error: "Ungültiges Feld." };
    }
  }
  zettel.set(id(wer, ziel), { wert: w, seit: Date.now() });
  return { ok: true, ziel, wer, wert: w };
}

/**
 * Anweisung holen UND verbrauchen. Gibt `undefined` zurueck, wenn keine da
 * ist; die Spielmodule wuerfeln dann normal.
 */
function nimm(key, ziel) {
  const z = ZIELE[ziel];
  const k = id(z && z.global ? GLOBAL : key, ziel);
  const s = zettel.get(k);
  if (!s) return undefined;
  zettel.delete(k);
  return s.wert;
}

function loesche(key, ziel) {
  const z = ZIELE[ziel];
  return zettel.delete(id(z && z.global ? GLOBAL : key, ziel));
}

/** Was liegt gerade? Fuer den Admin-Bildschirm. */
function liste() {
  const out = [];
  for (const [k, s] of zettel) {
    const [wer, ziel] = k.split("|");
    const z = ZIELE[ziel] || {};
    out.push({
      wer, ziel, wert: s.wert, seit: s.seit,
      name: z.name || ziel,
      text: z.art === "wahl" ? (z.optionen[s.wert] || s.wert) : String(s.wert),
    });
  }
  return out.sort((a, b) => b.seit - a.seit);
}

module.exports = { ZIELE, GLOBAL, setze, nimm, loesche, liste };
