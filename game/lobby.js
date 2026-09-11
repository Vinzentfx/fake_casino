"use strict";

/**
 * Gemeinsame Lobby-Liste: eine Übersicht aller offenen Lobbys über alle Spiele,
 * damit man jede SEHEN und ihr beitreten kann, ohne Codes auszutauschen. Jedes
 * Spiel (Poker, Slots-PvP, …) meldet je offener Lobby eine `describe()`-Funktion
 * an, die Liste holt sich beim Aufbauen den aktuellen Stand.
 *
 * Ein Eintrag sieht so aus:
 *   { code, game, label, host, players, max, buyIn, joinable }
 * Angezeigt wird nur, was `joinable` ist. Gibt die Funktion null zurück (oder
 * joinable:false), verschwindet die Lobby (z. B. wenn das Match läuft oder voll ist).
 */

let ioRef = null;
const providers = new Map(); // Code -> () => Eintrag|null

function publicList() {
  const out = [];
  for (const describe of providers.values()) {
    let d;
    try { d = describe(); } catch { d = null; }
    if (d && (d.joinable || d.watchable)) out.push(d); // beitretbar oder zum Zuschauen (laufende Spiele)
  }
  // Nach Spiel gruppieren, darin ungefähr die neuesten zuerst (Einfügereihenfolge ist grob das Alter).
  return out.sort((a, b) => String(a.game).localeCompare(String(b.game)));
}

function broadcast() {
  if (ioRef) ioRef.emit("lobby:list", publicList());
}

/*
 * Eine frisch geoeffnete Lobby einmal laut sagen.
 *
 * Das Kernproblem dieser Runde ist nicht der Inhalt, sondern die Uhrzeit:
 * jemand macht einen Tisch auf, sitzt allein da und geht nach fuenf Minuten
 * wieder. Wer nicht zufaellig im selben Moment auf den Lobby-Bildschirm
 * schaut, erfaehrt nie davon.
 *
 * Bewusst hier und nicht in den neun Spielen: add() ist die eine Stelle,
 * durch die jede Lobby laeuft. Vorher hatte nur Poker eine Nachricht, die
 * anderen acht Spiele gar keine.
 *
 * Der Chat erreicht die, die da sind, der Push die, die es nicht sind
 * (anAlle ueberspringt Online-Spieler, der Gastgeber bekommt also keinen).
 */
const MELDE_ABSTAND = 10 * 60 * 1000; // je Gastgeber und Spiel
const zuletztGemeldet = new Map();

function melde(beschreibe) {
  if (!ioRef) return;
  let d = null;
  try { d = beschreibe(); } catch { return; }
  // Nur was man auch betreten kann. Laufende oder volle Tische zu melden
  // waere eine Einladung, die ins Leere fuehrt.
  if (!d || !d.joinable || !d.host) return;

  // Auf- und Zumachen im Wechsel darf den Chat nicht zumuellen.
  const schluessel = String(d.host).toLowerCase() + "|" + d.game;
  const jetzt = Date.now();
  if (jetzt - (zuletztGemeldet.get(schluessel) || 0) < MELDE_ABSTAND) return;
  zuletztGemeldet.set(schluessel, jetzt);

  /*
   * Kein Code in der Nachricht.
   *
   * Gemeldet werden ohnehin nur OEFFENTLICHE Lobbys: die privaten landen
   * gar nicht erst hier, die Spiele rufen registerLobby() nur bei
   * `match.public` auf. Oeffentliche stehen in der Liste "Offene Lobbys"
   * und werden per Antippen betreten. Der Code ist dort also ueberfluessig,
   * und in einer oeffentlichen Nachricht waere er bei einer privaten Runde
   * sogar schaedlich.
   */
  const teile = [];
  // Manche Spiele liefern einen fertigen Satz ("geteilter Kessel", "Blinds
  // 50/100"), Memory, Schach und Slots-PvP dagegen eine nackte Zahl.
  if (typeof d.buyIn === "number" && d.buyIn > 0) {
    teile.push(`Einsatz ${d.buyIn.toLocaleString("de-DE")} Chips`);
  } else if (d.buyIn) {
    teile.push(String(d.buyIn));
  }
  // Freie Plaetze statt belegter: das ist die Zahl, die zum Mitmachen einlaedt.
  if (d.max) {
    const frei = Math.max(0, d.max - (d.players || 0));
    if (frei > 0) teile.push(`noch ${frei} ${frei === 1 ? "Platz" : "Plätze"} frei`);
  }
  // Der erste Teil beginnt einen neuen Satz ("... aufgemacht. Geteilter
  // Kessel, ..."), die Spiele liefern ihn aber klein geschrieben.
  const satz = teile.join(", ");
  const zusatz = satz ? ` ${satz.charAt(0).toUpperCase()}${satz.slice(1)}.` : "";

  try {
    require("./chat").announce(ioRef, `${d.host} hat ${d.label} aufgemacht.${zusatz}`);
  } catch {}
  try {
    require("./push").anAlle("tisch", {
      title: `${d.label}: ${d.host} wartet auf Mitspieler`,
      body: (teile.length ? teile.join(", ") + ". " : "") + "Steht unter Offene Lobbys.",
      url: "/",
    });
  } catch {}
}

/** Ruft ein Spiel auf, wenn es eine Lobby aufmacht. */
function add(code, describe) {
  // Nur beim ersten Mal melden. Manche Spiele registrieren dieselbe Lobby
  // nach einer Aenderung erneut, das ist keine neue Einladung.
  const istNeu = !providers.has(code);
  providers.set(code, describe);
  broadcast();
  if (istNeu) melde(describe);
}
/** Neu melden, wenn sich etwas tut (Spieler kommt oder geht, Zustand ändert sich). */
function changed() {
  broadcast();
}
/** Ruft ein Spiel auf, wenn eine Lobby abgebaut wird. */
function remove(code) {
  if (providers.delete(code)) broadcast();
}

function setupLobby(io) {
  ioRef = io;
  io.on("connection", (socket) => {
    socket.on("lobby:list", (ack) => {
      if (typeof ack === "function") ack({ ok: true, lobbies: publicList() });
    });
  });
}

/**
 * Der Steckbrief zu einem Code, oder null.
 *
 * Nur oeffentliche Lobbys stehen hier drin; fuer private gibt es bewusst
 * keinen Eintrag, und die Einladung faellt dann auf den Spielnamen zurueck.
 */
function beschreibe(code) {
  const p = providers.get(code);
  if (!p) return null;
  try { return p(); } catch { return null; }
}

module.exports = { setupLobby, add, remove, changed, beschreibe };
