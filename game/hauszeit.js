"use strict";

/**
 * Die Uhr des Hauses: deutsche Zeit, egal wo der Server steht.
 *
 * Zoo-Lieferungen, das Schaufenster der Woche und das nächtliche
 * Garagentor richten sich nach Wanduhrzeit in Berlin. Vorher rechneten Zoo
 * und Schaufenster mit der Zeitzone des Servers und das Garagentor mit
 * Berlin; auf einem Server in UTC lagen die Wechsel damit ein bis zwei
 * Stunden neben dem, was alle in der Runde auf der Uhr haben.
 *
 * Und das Ende einer Lieferung nahm den Versatz von JETZT. Liegt dazwischen
 * eine Zeitumstellung, stand der Countdown eine Stunde daneben. Hier wird
 * der Versatz des ZIELZEITPUNKTS bestimmt.
 */

const ZONE = "Europe/Berlin";
const TAG_MS = 86400000;

const format = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Die Wanduhrzeit in Berlin als Millisekunden, als stünde sie in UTC. */
function wandzeit(ts) {
  const t = {};
  for (const p of format.formatToParts(ts)) t[p.type] = p.value;
  return Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second) + (ts % 1000 + 1000) % 1000;
}

/** Der echte Zeitpunkt zu einer Berliner Wanduhrzeit. Zweimal angenähert,
    weil der Versatz vom Ergebnis abhängt (Sommer- oder Winterzeit). */
function ausWandzeit(wand) {
  let ts = wand - (wandzeit(wand) - wand);
  ts = wand - (wandzeit(ts) - ts);
  return ts;
}

/** Stunde 0 bis 23 in Berlin. */
const stunde = (ts = Date.now()) => new Date(wandzeit(ts)).getUTCHours();

/* Der 1.1.1970 war ein Donnerstag; drei Tage Versatz legen den Wechsel auf
   Montag 0 Uhr. Eine halbe Woche (3,5 Tage) endet dann Donnerstag 12 Uhr. */
function abschnittVon(jetzt, tage) {
  return Math.floor((wandzeit(jetzt) / TAG_MS + 3) / tage);
}
function abschnittEndet(jetzt, tage) {
  const n = abschnittVon(jetzt, tage);
  return ausWandzeit(Math.round(((n + 1) * tage - 3) * TAG_MS));
}

module.exports = { ZONE, wandzeit, ausWandzeit, stunde, abschnittVon, abschnittEndet };
