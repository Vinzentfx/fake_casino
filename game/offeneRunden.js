"use strict";

/**
 * Offene Runden überleben einen Neustart.
 *
 * Mines, Towers, Higher/Lower, Würfelpoker und Blackjack buchen den Einsatz
 * beim Start der Runde ab und hielten die Runde danach nur im Speicher.
 * Reload und Verbindungsabbruch waren damit abgedeckt (die Runde hängt am
 * Konto, nicht am Socket), ein Neustart nicht: nach einem Deploy war der
 * Einsatz weg und das Spielfeld auch.
 *
 * Jetzt steht jede offene Runde zusätzlich in data/offene-runden.json und
 * wird beim Start wieder geladen. Fortgesetzt statt erstattet: wer drei
 * Diamanten aufgedeckt hatte, behält sie. Die Spielmodule bekommen über
 * `karte(spiel)` etwas, das sich wie ihre bisherige Map benutzt; `set` und
 * `delete` schreiben sofort, und wer eine Runde ändert, ohne sie neu zu
 * setzen, ruft `merke(key)`.
 *
 * Reihenfolge, damit kein Neustart Chips druckt: beim Start erst abbuchen
 * und das Konto sofort sichern, dann die Runde merken; beim Abrechnen erst
 * die Runde vergessen, dann auszahlen. Eine Runde auf der Platte heißt also
 * immer: der Einsatz ist weg und noch nicht ausgezahlt.
 */

const fs = require("fs");
const path = require("path");

const DATEI = path.join(__dirname, "..", "data", "offene-runden.json");

let stand = {};
try {
  const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  if (roh && typeof roh === "object") stand = roh;
} catch (e) {
  if (e.code !== "ENOENT") {
    /* Unlesbar: laut melden und die Datei zur Seite legen statt den ganzen
       Start abzubrechen. Die Runden darin sind dann verloren, das Haus läuft. */
    console.error(`[offene-runden] ${DATEI} ist nicht lesbar (${e.message}), sie wird beiseitegelegt.`);
    try { fs.renameSync(DATEI, `${DATEI}.kaputt-${Date.now()}`); } catch {}
  }
}

function schreiben() {
  try {
    require("./buchungen").sicherSchreiben(DATEI, JSON.stringify(stand));
  } catch (e) {
    // Die Runde läuft im Speicher weiter; nur ein Neustart in diesem Moment kostet sie.
    console.error("[offene-runden] speichern:", e.message);
  }
}

/**
 * Die gemerkten Runden eines Spiels als Map-ähnliches Ding.
 * `ein` wandelt eine Runde für die Platte um (etwa ein Set in eine Liste),
 * `aus` beim Laden zurück.
 */
function karte(spiel, { ein = (x) => x, aus = (x) => x } = {}) {
  const roh = stand[spiel] && typeof stand[spiel] === "object" ? stand[spiel] : (stand[spiel] = {});
  const m = new Map();
  for (const [key, wert] of Object.entries(roh)) {
    try { m.set(key, aus(wert)); } catch { delete roh[key]; }
  }
  return {
    get: (key) => m.get(key),
    has: (key) => m.has(key),
    keys: () => m.keys(),
    values: () => m.values(),
    entries: () => m.entries(),
    [Symbol.iterator]: () => m.entries(),
    get size() { return m.size; },
    set(key, wert) {
      m.set(key, wert);
      roh[key] = ein(wert);
      schreiben();
      return this;
    },
    /** Eine geänderte Runde neu auf die Platte schreiben. */
    merke(key) {
      if (!m.has(key)) return;
      roh[key] = ein(m.get(key));
      schreiben();
    },
    delete(key) {
      const da = m.delete(key);
      if (Object.prototype.hasOwnProperty.call(roh, key)) { delete roh[key]; schreiben(); }
      return da;
    },
  };
}

module.exports = { karte, DATEI, _stand: () => stand };
