"use strict";

/**
 * Die Ruhmestafel: wer gerade etwas Seltenes gezogen hat.
 *
 * Eine Kiste aufzumachen ist der einzige Moment im Haus, in dem etwas
 * entsteht, das es vorher nicht gab. Bisher stand davon nur eine Zeile im
 * Chat, und der rollt weg — wer zwei Stunden spaeter kommt, sieht nichts
 * mehr. Genau das ist hier das Problem: die Runde spielt versetzt, und die
 * Ziehung des Abends findet fast immer allein statt.
 *
 * Die Tafel haelt deshalb die letzten zwoelf grossen Ziehungen fest und
 * zeigt sie jedem, der die Kisten aufmacht. Das ist kein Feed und kein Chat,
 * sondern ein Schaufenster: hier haengt, was im Haus zu holen ist, mit dem
 * Namen dessen, der es hat.
 *
 * Sie liegt auf der PLATTE und nicht nur im Speicher. Der Feed darf nach
 * einem Deploy leer sein, er zeigt Minuten; eine Tafel, die nach jedem
 * Neustart leer ist, sagt dagegen "hier ist nie etwas passiert", und das ist
 * das Gegenteil von dem, wofuer sie da ist.
 *
 * Gespeichert wird der SCHLUESSEL, nicht das Aussehen. Wer sich danach ein
 * neues Bild kauft, steht auch auf der Tafel mit dem neuen — sonst waere
 * das hier die einzige Stelle im Haus, an der jemand alt aussieht.
 */

const fs = require("fs");
const path = require("path");

const DATEI = path.join(__dirname, "..", "data", "ruhm.json");
const MAX = 12;

/* Ab welcher Stufe etwas auf die Tafel kommt. Gewoehnlich und selten nicht:
   die zieht jeder taeglich, und eine Tafel, auf der alles steht, sagt
   nichts. */
const TAFEL_AB = new Set(["episch", "legendaer", "mythisch", "kiste"]);
/* Ab welcher Stufe es allen, die gerade da sind, quer ueber den Bildschirm
   gesagt wird. Bewusst zwei Stufen hoeher als die Tafel: ein Banner, das
   dreimal am Abend kommt, ist nach einer Woche Tapete. */
const BANNER_AB = new Set(["mythisch", "kiste"]);

let eintraege = [];
let io = null;
let accounts = null;

function laden() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    if (Array.isArray(roh)) eintraege = roh.slice(0, MAX);
  } catch { /* Datei fehlt beim ersten Start, das ist der Normalfall. */ }
}

function speichern() {
  try {
    fs.mkdirSync(path.dirname(DATEI), { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify(eintraege));
  } catch (e) {
    console.error("ruhm: konnte nicht speichern —", e.message);
  }
}

/**
 * Einen Eintrag fertig machen, wie der Client ihn braucht.
 *
 * Name und Aussehen kommen JETZT aus dem Konto und nicht aus dem Eintrag:
 * ein Prunkstueck, ein neuer Rahmen oder eine Umbenennung sollen auch hier
 * ankommen.
 */
function fuellen(e) {
  const cosmetics = require("./cosmetics");
  const kisten = require("./kisten");
  const acc = accounts ? accounts.get(e.key) : null;
  const stufe = kisten.STUFEN.find((s) => s.id === e.stufe) || kisten.STUFEN[0];
  return {
    ts: e.ts,
    name: acc ? acc.name : e.name,
    look: acc ? cosmetics.publicLook(acc) : null,
    label: e.label,
    artName: cosmetics.ART_NAME[e.art] || e.art,
    look2: cosmetics.vorschauDaten(e.art, e.id),
    stufe: { id: stufe.id, label: stufe.label, farbe: stufe.farbe },
    nr: e.nr || null,
    kiste: e.kiste || null,
    duell: !!e.duell,
  };
}

/** Die Tafel, wie der Client sie braucht. Neueste zuerst. */
function tafel() {
  return eintraege.map(fuellen);
}

/**
 * Etwas Gezogenes melden.
 *
 * `treffer` ist, was game/kisten.js liefert (art, id, label, stufe, nr).
 * Alles unterhalb der Schwelle faellt hier still weg, damit die Aufrufer
 * nicht jeder fuer sich entscheiden muessen, was selten genug ist.
 */
function melde(key, treffer, opts = {}) {
  if (!treffer || !treffer.stufe || !TAFEL_AB.has(treffer.stufe.id)) return null;
  const acc = accounts ? accounts.get(key) : null;
  const e = {
    ts: Date.now(),
    key,
    name: acc ? acc.name : String(key || "?"),
    art: treffer.art,
    id: treffer.id,
    label: treffer.label,
    stufe: treffer.stufe.id,
    nr: treffer.nr || null,
    kiste: opts.kisteLabel || treffer.kisteLabel || null,
    duell: !!opts.duell,
  };
  eintraege.unshift(e);
  if (eintraege.length > MAX) eintraege.length = MAX;
  speichern();

  const fertig = fuellen(e);
  if (io) {
    io.emit("ruhm:neu", { eintrag: fertig, banner: BANNER_AB.has(treffer.stufe.id) });
  }
  return fertig;
}

function setupRuhm(_io, _accounts) {
  io = _io;
  accounts = _accounts;
  laden();
  io.on("connection", (socket) => {
    socket.on("ruhm:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: true, tafel: tafel() });
    });
  });
}

/* Namen stehen hier nur als Rueckfall fuer geloeschte Konten; der Schluessel
   ist die Wahrheit. Trotzdem mitziehen, sonst steht bei einem geloeschten
   Konto fuer immer der alte Name. */
function umbenennen(key, alt, neu) {
  let geaendert = false;
  for (const e of eintraege) {
    if (e.key === key && e.name !== neu) { e.name = neu; geaendert = true; }
  }
  if (geaendert) speichern();
}

module.exports = { setupRuhm, melde, tafel, umbenennen, TAFEL_AB, BANNER_AB };
