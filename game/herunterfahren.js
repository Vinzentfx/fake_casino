"use strict";

/**
 * Was beim geordneten Herunterfahren (Deploy, SIGTERM) zurückgebucht wird.
 *
 * Live-Partien (Schach, Memory, Sudoku, Solitär-Rennen, Slot-Duell, Kniffel,
 * Roulette-Lobby, Poker) halten Einsätze nur im Speicher. Fortsetzen geht
 * dort nicht sinnvoll, beide Seiten müssten gleichzeitig wieder da sein.
 * Also gilt die Regel des Kisten-Duells: lieber eine abgebrochene Partie als
 * ein verschwundener Einsatz. Jedes Modul meldet hier an, was es beim Ende
 * zurückbucht, und setzt seine Partien dabei auf beendet.
 *
 * Bewusst beim Herunterfahren und nicht über eine Datei, die beim Start
 * erstattet: in diesem Moment weiß jedes Spiel genau, was offen ist. Eine
 * zweite Wahrheit auf der Platte müsste jeden Ausgang einer Partie kennen,
 * und ein einziger übersehener Ausgang hätte beim nächsten Start doppelt
 * gezahlt. Ein harter Absturz ist damit nicht abgedeckt, ein Deploy schon.
 */

const aufgaben = [];

/** `fn` bucht zurück und gibt die Zahl der Erstattungen zurück. */
function anmelden(name, fn) {
  aufgaben.push({ name, fn });
}

function alleAbschliessen() {
  const bericht = [];
  for (const { name, fn } of aufgaben) {
    try {
      const n = fn() || 0;
      if (n) bericht.push(`${name}: ${n}`);
    } catch (e) {
      console.error(`[herunterfahren] ${name}:`, e.message);
    }
  }
  return bericht;
}

module.exports = { anmelden, alleAbschliessen };
