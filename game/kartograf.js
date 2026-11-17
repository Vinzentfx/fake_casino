"use strict";

/**
 * Das Vermächtnis des Kartografen.
 *
 * Warum es dieses Rätsel so gibt: Das Weserlicht haben bis zum 17.11.2026
 * 36 Leute gelöst, 23 davon in elf Minuten oder weniger durch alle fünf
 * Stufen, 15 an einem einzigen Abend binnen einer halben Stunde. Die
 * Lösungen sind weitergegeben worden. Ein Rätsel, dessen Antwort für alle
 * gleich ist, hält in dieser Runde genau so lange, bis der Erste es erzählt.
 *
 * Hier hat jeder ein eigenes Haus. Der Kartograf hinterlässt jedem einen
 * eigenen Brief, der auf ein echtes Haus in Porta zeigt, gewählt aus dem
 * Schlüssel des Kontos und dem Geheimnis des Servers (`data/.secret`).
 * Wer den Quelltext liest, kann deshalb trotzdem nicht ausrechnen, welches
 * Haus es ist. Weitersagen lässt sich nur der Weg, und den muss jeder selbst
 * gehen: entschlüsseln, das Haus auf der echten Stadtkarte finden, von dort
 * aus peilen.
 *
 *   0  Brief am Kartenpult im Tresorraum: Ortsteil als Anagramm, Straße
 *      verschoben um die Länge des Ortsteils, Hausnummer römisch.
 *      Antwort am Pult: die Adresse.
 *   1  Am Pult: die Grundfläche des Hauses in Quadratmetern. Steht nur in
 *      der Stadtkarte, wenn man das Haus dort antippt.
 *   2  Am Fernrohr auf dem Dachgarten: die Himmelsrichtung (16 Teile), in
 *      der vom Haus aus das Casino-Gebäude in Hausberge liegt.
 *   3  Zurück am Pult: der Fund (Geheimnis „kartograf“, game/welt.js).
 *
 * Die Ziele sind so gewählt, dass die Richtung nicht auf der Kippe steht:
 * mindestens vier Grad von jeder Grenze zwischen zwei Richtungen weg und
 * mindestens 400 Meter vom Casino entfernt. Ein Rätsel, bei dem man richtig
 * misst und trotzdem falsch liegt, ist kein schweres, sondern ein unfaires.
 *
 * Versucht werden darf so oft wie bei allen Eingaben im Haus: zwölfmal je
 * Stunde (game/raetsel.js `darf`). Ausrechnen lässt sich keine Stufe.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STUFEN = 3;   // danach der Fund am Pult
const MIN_ABSTAND = 400;
const MIN_RAND_GRAD = 4;

/* Das Geheimnis des Servers, dasselbe, mit dem die Anmeldungen signiert
   werden. Fehlt es (Tests, frisches Haus), gibt es einen festen Ersatz. */
let geheimnis = null;
function serverGeheimnis() {
  if (geheimnis) return geheimnis;
  try { geheimnis = fs.readFileSync(path.join(__dirname, "..", "data", ".secret"), "utf8").trim(); } catch {}
  if (!geheimnis) geheimnis = "kartograf-ohne-geheimnis";
  return geheimnis;
}

/** Ein fester Zufall für dieses Konto: immer derselbe, für niemanden ausrechenbar. */
function zufallVon(key, wofuer) {
  const basis = crypto.createHmac("sha256", serverGeheimnis()).update(`kartograf:${wofuer}:${key}`).digest("hex");
  let n = 0;
  // Jeder Aufruf ein eigener Hash: kein Muster, das sich nach ein paar Werten wiederholt.
  return () => crypto.createHash("sha256").update(basis + ":" + n++).digest().readUInt32BE(0) / 0x100000000;
}

const RICHTUNGEN = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const RICHTUNG_NAME = {
  N: "Nord", NNO: "Nordnordost", NO: "Nordost", ONO: "Ostnordost", O: "Ost", OSO: "Ostsüdost", SO: "Südost", SSO: "Südsüdost",
  S: "Süd", SSW: "Südsüdwest", SW: "Südwest", WSW: "Westsüdwest", W: "West", WNW: "Westnordwest", NW: "Nordwest", NNW: "Nordnordwest",
};

/** Peilung in Grad, von Norden im Uhrzeigersinn. Die Karte rechnet y nach Süden. */
function peilung(von, nach) {
  const ost = nach[0] - von[0], nord = von[1] - nach[1];
  return (Math.atan2(ost, nord) * 180 / Math.PI + 360) % 360;
}
const richtungVon = (grad) => RICHTUNGEN[Math.round(grad / 22.5) % 16];
const randAbstand = (grad) => { const r = (grad + 11.25) % 22.5; return Math.min(r, 22.5 - r); };

/** Alle Häuser, die als Ziel taugen, einmal gerechnet. */
let tauglich = null;
function ziele() {
  if (tauglich) return tauglich;
  const city = require("./city");
  const casino = city.casinoMitte();
  tauglich = [];
  if (!casino) return tauglich;
  for (const h of city.kartografHaeuser()) {
    if (Math.hypot(casino[0] - h.c[0], casino[1] - h.c[1]) < MIN_ABSTAND) continue;
    const grad = peilung(h.c, casino);
    if (randAbstand(grad) < MIN_RAND_GRAD) continue;
    tauglich.push({ ...h, richtung: richtungVon(grad) });
  }
  return tauglich;
}

/** Das Haus des Kartografen für dieses Konto. */
function hausVon(key) {
  const liste = ziele();
  if (!liste.length) return null;
  return liste[Math.floor(zufallVon(key, "haus")() * liste.length)];
}

/* Der Brief. Alles in Großbuchstaben ohne Umlaute, damit die Verschiebung
   eindeutig ist: Ä wird AE, ß wird SS, wie überall im Haus (`norm`). */
const ascii = (s) => String(s).toUpperCase()
  .replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ß/g, "SS");
function verschieben(text, um) {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(65 + ((c.charCodeAt(0) - 65 + um) % 26)));
}
function roemisch(n) {
  const T = [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [w, z] of T) while (n >= w) { out += z; n -= w; }
  return out;
}
function anagramm(wort, key) {
  const z = zufallVon(key, "anagramm");
  const b = ascii(wort).split("");
  for (let versuch = 0; versuch < 20; versuch++) {
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(z() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    if (b.join("") !== ascii(wort)) break;
  }
  return b.join("");
}

function brief(key) {
  const h = hausVon(key);
  if (!h) return null;
  const laenge = ascii(h.ortsteil).replace(/[^A-Z]/g, "").length;
  return [
    "Wer das hier liest, hat den Tresor gefunden. Dann findest du auch mein Haus.",
    "",
    "Es steht in einem Ortsteil, der sich versteckt hat:",
    `    ${anagramm(h.ortsteil, key)}`,
    "",
    "Den Namen der Straße habe ich verschoben, jeden Buchstaben um so viele Stellen im Alphabet nach vorn, wie mein Ortsteil Buchstaben hat. Wer zurückzählt, findet sie:",
    `    ${verschieben(ascii(h.strasse), laenge)}`,
    "",
    "Die Hausnummer schrieben schon die Römer:",
    `    ${roemisch(h.nr)}`,
    "",
    "Schreib mir die Adresse auf, Straße und Hausnummer.",
    "",
    "Der Kartograf",
  ].join("\n");
}

const TEXT = {
  vermessen: "Das Papier wird warm unter deiner Hand. Unter dem Brief erscheint eine zweite Zeile, als hätte sie die ganze Zeit dort gestanden:\n\n„Richtig, das ist mein Haus. Ich habe es damals ausgemessen, Schritt für Schritt, und die Zahl in den Türrahmen geritzt. Geh hin und miss nach: Wie viele Quadratmeter Grundfläche hat es? Die Stadtkarte im Kontor kennt jedes Haus in Porta.“",
  peilen: "Die Zahl stimmt. Auf dem Pult zeichnet sich ein Kompass ab, in sechzehn Teile geteilt, und daneben eine letzte Zeile:\n\n„Von meinem Haus aus habe ich jeden Abend zu dem großen Haus in Hausberge hinübergesehen, in dem heute dieses Casino steht. Steig aufs Dach und richte das Fernrohr in die Himmelsrichtung, in der es von meinem Haus aus liegt.“",
  angepeilt: "Durch das Fernrohr siehst du über die Dächer von Porta, genau in die Richtung, die er beschrieben hat. Für einen Moment blitzt im Glas ein Zeichen auf: ein Kompass mit einem Schlüssel darin.\n\nDas Pult im Tresorraum wartet auf dich.",
  falschAdresse: "Du schreibst die Adresse an den Rand. Die Tinte bleibt einen Moment stehen und verläuft dann. Das ist nicht sein Haus.",
  falschFlaeche: "Du ritzt die Zahl ins Holz. Sie füllt sich mit Staub. Daneben steht schon eine andere, die du nicht lesen kannst.",
  wartet: "Auf dem Pult liegt nur noch der Kompass. Er zeigt nicht nach Norden, sondern zum Dach.",
};

/** Was jemand eintippt, ohne Umlaute und Sonderzeichen; „Straße“ und „Str.“ gelten gleich. */
function norm(s) {
  /* Erst alles außer Buchstaben und Ziffern weg, dann „strasse“ zu „str“.
     In dieser Reihenfolge gilt auch „Raiffeisenstrasse85“ ohne Leerzeichen,
     und weil Lösung und Eingabe genau gleich behandelt werden, trifft das
     Kürzen nie etwas, das nur auf einer Seite steht. */
  return String(s == null ? "" : s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "")
    .replace(/strasse/g, "str");
}

/*
 * Versuche je Tag für Fläche und Richtung.
 *
 * Das allgemeine Limit (zwölf je Stunde) reicht hier nicht: sechzehn
 * Himmelsrichtungen sind in gut einer Stunde durchprobiert, die üblichen
 * Grundflächen an einem Tag, und dann hätte man das Haus nie gesucht. Drei
 * je Tag und Stufe machen das Raten zur Woche und das Suchen zur Stunde.
 * Gezählt wird nur, was eine Antwort sein könnte (eine Zahl, eine
 * Richtung); ein Tippfehler im Wort kostet nichts.
 */
const VERSUCHE_TAG = 3;
const hauszeit = require("./hauszeit");
const tagNr = (jetzt = Date.now()) => Math.floor(hauszeit.wandzeit(jetzt) / 86400000);
function versuch(acc) {
  const k = zustand(acc);
  const heute = tagNr();
  if (!k.versuche || k.versuche.tag !== heute || k.versuche.stufe !== k.stufe) k.versuche = { tag: heute, stufe: k.stufe, n: 0 };
  if (k.versuche.n >= VERSUCHE_TAG) return { ok: false };
  k.versuche.n += 1;
  return { ok: true, rest: VERSUCHE_TAG - k.versuche.n };
}
const restText = (rest) => rest ? ` Heute ${rest === 1 ? "noch ein Versuch" : `noch ${rest} Versuche`}.` : " Für heute war das der letzte Versuch.";
const MORGEN = "Für heute hast du genug probiert. Der Kartograf war geduldig, sei es auch: morgen wieder.";

/* Eine Himmelsrichtung lesen: „Nordnordost“, „Nord-Nord-Ost“, „NNO“, „nne“
   und „Norden“ meinen dasselbe. Gibt das Kürzel zurück, oder null. */
const TEILE = [["norden", "N"], ["nord", "N"], ["osten", "O"], ["ost", "O"], ["sueden", "S"], ["sued", "S"], ["sud", "S"], ["westen", "W"], ["west", "W"],
  ["n", "N"], ["o", "O"], ["e", "O"], ["s", "S"], ["w", "W"]];
function richtungLesen(text) {
  let rest = String(text || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/[^a-z]/g, "");
  let out = "";
  while (rest) {
    const t = TEILE.find(([w]) => rest.startsWith(w));
    if (!t) return null;
    out += t[1];
    rest = rest.slice(t[0].length);
  }
  return RICHTUNGEN.includes(out) ? out : null;
}

function zustand(acc) {
  const k = acc.kartograf && typeof acc.kartograf === "object" ? acc.kartograf : (acc.kartograf = { stufe: 0 });
  if (!Number.isInteger(k.stufe)) k.stufe = 0;
  return k;
}
const stufe = (acc) => (acc && acc.kartograf && Number.isInteger(acc.kartograf.stufe) ? acc.kartograf.stufe : 0);
function hebe(acc, auf) {
  const k = zustand(acc);
  if (k.stufe !== auf - 1) return false;
  k.stufe = auf;
  k.t = k.t || {};
  k.t[auf] = Date.now();
  return true;
}

/**
 * Wer an das Pult tritt. Gibt die Frage für die Eingabe zurück, oder
 * `fund: true`, wenn alle Stufen geschafft sind und jetzt das Geheimnis
 * gefunden wird. `zeilen` heißt: der Brief steht Zeile für Zeile, damit die
 * eingerückten Rätselzeilen auf dem iPad nicht umbrechen.
 */
function pult(acc, key) {
  const s = stufe(acc);
  if (s >= STUFEN) return { fund: true };
  const b = brief(key);
  if (!b) return { text: "Das Pult ist leer.", zeilen: false };
  if (s === 0) return { text: b, zeilen: true, platzhalter: "Straße und Hausnummer" };
  /* Ab hier steht die Adresse ausgeschrieben dabei. Wer sie gelöst hat,
     soll sie nicht noch einmal entschlüsseln müssen, nur weil er ein paar
     Tage nicht da war; der Brief selbst liegt im Logbuch. */
  if (s === 1) return { text: `${gefunden(key)}\n\n${TEXT.vermessen}`, zeilen: false, platzhalter: "Quadratmeter" };
  return { text: `${gefunden(key)}\n\n${TEXT.peilen}\n\n${TEXT.wartet}`, zeilen: false, keineEingabe: true };
}
/** Die gelöste Adresse als Satz, für Pult und Logbuch. */
function gefunden(key) {
  const h = hausVon(key);
  return h ? `Sein Haus: ${h.strasse} ${h.nr} in ${h.ortsteil}.` : "";
}

/** Eine Antwort am Pult. Gibt { titel, satz } zurück; gespeichert wird vom Aufrufer. */
function eingabePult(acc, key, text) {
  const h = hausVon(key);
  const s = stufe(acc);
  if (!h) return { satz: "Das Pult ist leer." };
  if (s === 0) {
    const soll = norm(`${h.strasse} ${h.nr}`);
    /* Ortsteil und Stadt dürfen dabeistehen, vorn oder hinten. Sonst gilt
       nur die Adresse genau: mit „startsWith“ ging vorher bei Hausnummer 1
       auch „12“ durch. */
    let n = norm(text);
    const zusaetze = [norm(h.ortsteil), "portawestfalica"];
    // Hinten ist sicher: die Lösung endet mit der Hausnummer.
    for (const z of zusaetze) if (n.endsWith(z)) n = n.slice(0, -z.length);
    // Die Postleitzahl darf vorn stehen oder hinter der Hausnummer.
    n = n.replace(/^\d{5}/, "");
    if (/\d{5}$/.test(n) && n.slice(0, -5) === soll) n = soll;
    // Vorn nur, wenn die Straße nicht selbst so anfängt („Eisbergener Straße“).
    for (const z of zusaetze) if (n.startsWith(z) && !soll.startsWith(z)) n = n.slice(z.length);
    if (n === soll) {
      hebe(acc, 1);
      return { titel: "Der Brief des Kartografen", satz: TEXT.vermessen };
    }
    return { satz: TEXT.falschAdresse };
  }
  if (s === 1) {
    const zahl = Number((String(text).replace(/\./g, "").match(/\d+/) || [])[0]);
    if (!zahl) return { satz: "Er will eine Zahl: Quadratmeter Grundfläche, so wie sie die Stadtkarte zeigt." };
    const v = versuch(acc);
    if (!v.ok) return { satz: MORGEN };
    if (zahl === h.a) {
      hebe(acc, 2);
      return { titel: "Der Brief des Kartografen", satz: TEXT.peilen };
    }
    return { satz: TEXT.falschFlaeche + restText(v.rest) };
  }
  return { satz: TEXT.wartet };
}

/**
 * Am Fernrohr. Gibt null zurück, wenn der Kartograf hier nichts zu sagen
 * hat; dann entscheidet das Weserlicht (game/raetsel.js) wie bisher.
 */
function fernrohr(acc, key, text) {
  if (stufe(acc) !== 2) return null;
  const r = richtungLesen(text);
  if (!r) return null;
  const h = hausVon(key);
  if (!h) return null;
  const v = versuch(acc);
  if (!v.ok) return { satz: MORGEN };
  if (r !== h.richtung) {
    return { satz: `Du richtest das Fernrohr nach ${RICHTUNG_NAME[r]}. Dächer, Bäume, irgendwo die Weser. Von seinem Haus aus hätte er dort nichts gesehen, was ihn interessiert.${restText(v.rest)}` };
  }
  hebe(acc, 3);
  return { titel: "Die Peilung", satz: TEXT.angepeilt };
}

/**
 * Der Fund am Pult. Hebt auf die letzte Stufe, genau einmal, und vergibt
 * die laufende Nummer: der wievielte Kartograf jemand ist. `alle` sind die
 * Konten des Hauses; gezählt wird, wer schon vorher fertig war.
 */
function finden(acc, alle = []) {
  if (stufe(acc) !== STUFEN) return false;
  const vorher = alle.filter((a) => a !== acc && stufe(a) > STUFEN).length;
  const k = zustand(acc);
  k.stufe = STUFEN + 1;
  k.t[STUFEN + 1] = Date.now();
  k.nr = vorher + 1;
  return true;
}
/** Wie viele das Vermächtnis schon gelöst haben. */
const geloest = (alle = []) => alle.filter((a) => stufe(a) > STUFEN).length;

/** Was man auf dem Weg schon zu sehen bekommen hat, fürs Logbuch. */
function notizen(acc, key) {
  const s = stufe(acc);
  const n = [];
  if (!acc.kartograf) return n;
  const b = brief(key);
  if (b) n.push({ titel: "Der Brief des Kartografen", text: b, zeilen: true });
  if (s >= 1) n.push({ titel: "Die zweite Zeile", text: `${gefunden(key)}\n\n${TEXT.vermessen}` });
  if (s >= 2) n.push({ titel: "Der Kompass", text: TEXT.peilen });
  if (s >= 3) n.push({ titel: "Die Peilung", text: TEXT.angepeilt });
  return n;
}
/** Wer den Brief einmal gesehen hat, hat angefangen. */
function angefangen(acc) { zustand(acc); }

module.exports = {
  STUFEN, VERSUCHE_TAG, pult, eingabePult, fernrohr, finden, geloest, notizen, angefangen, stufe,
  // Für Tests: das persönliche Ziel und die Bausteine des Briefs.
  _intern: { hausVon, brief, ziele, peilung, richtungVon, richtungLesen, randAbstand, verschieben, roemisch, anagramm, ascii, norm,
    _geheimnis(g) { geheimnis = g; } },
};
