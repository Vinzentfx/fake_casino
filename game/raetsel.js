"use strict";

/**
 * Die Rätsel auf dem Dach, und das Weserlicht.
 *
 * Alles, was man hier eingeben kann (an der Bar bestellen, in den Spiegel
 * schreiben, das Fernrohr richten, am Schloss drehen), läuft über
 * `eingabe` und wird nur hier entschieden. Die richtigen Antworten stehen
 * nicht im Klartext im Haus, sondern als Prüfsumme (`PRUEF`). Wer den
 * Quelltext liest, sieht also, DASS der Spiegel auf etwas wartet, aber
 * nicht, worauf.
 *
 * Das Weserlicht ist eine Kette aus fünf Stufen, die nur in dieser
 * Reihenfolge zählen. Jede Stufe steht am Konto (`acc.weserlicht.stufe`),
 * und erst mit der vorigen nimmt die nächste Stelle überhaupt eine Antwort
 * an. Wer eine Lösung weitererzählt bekommt, kommt damit nicht weiter, wenn
 * ihm die Stufe davor fehlt.
 *
 *   1  an der Bar das bestellen, was die Lichterkette über dem Dach sagt
 *   2  in den Spiegel im Fundus schreiben, was der Bierdeckel verschlüsselt
 *   3  das Fernrohr auf das richten, was der Spiegel aus dem Programmheft holt
 *   4  am Greifautomaten tun, was der Stern zählt
 *   5  durch den Schornstein in die Sternwarte und an der Tafel eintragen
 *
 * Wer eingetragen ist, steht mit Nummer und Datum in `data/weserlicht.json`.
 * Gespeichert wird der Schlüssel, nicht der Name: wer sich umbenennt, steht
 * mit dem neuen Namen an der Tafel.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const kleidung = require("./kleidung");

let DATEI = path.join(__dirname, "..", "data", "weserlicht.json");
const STUFEN = 5;
const SALZ = "porta-dach-7:";

/** Was jemand eintippt, auf das Wesentliche gebracht: klein, ohne Umlaute, nur Buchstaben und Ziffern. */
function norm(s) {
  return String(s == null ? "" : s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "").slice(0, 40);
}
const pruefsumme = (s) => crypto.createHash("sha256").update(SALZ + norm(s)).digest("hex").slice(0, 24);

/* Die Antworten, nur als Prüfsumme. Beim Fernrohr gehen mehrere
   Schreibweisen desselben Sterns. */
const PRUEF = {
  bar: ["ffe0702625122cb6fe234328"],
  spiegel: ["0052b08855acc2ddb3bee1e2"],
  teleskop: ["60ac0e75d6baf49de33969a5", "fe8effb57077c3fa68a4c378", "04e0e70f7a99de9be7997fd1", "a2b761a7b548ad2b2de0a2d1"],
  luke: ["21542945e3b3ac2193208ae5"],
};
const stimmt = (art, text) => !!norm(text) && (PRUEF[art] || []).includes(pruefsumme(text));

/* Was die Stufen zeigen. Das IST das Rätsel; es steht im Browser ohnehin
   vor dem, der es sich verdient hat. */
const TEXT = {
  bierdeckel: "Der Wirt sieht dich lange an. Dann schiebt er dir wortlos einen Bierdeckel über den Tresen. Auf der Rückseite steht in winziger Schrift:\n\nEU OXVLWEJWOIE YLQXZIV APKJFMS JWA CTLB QA GWN HVX GIBLIB IHI VFR SKNO DTQ\n\nUnd darunter: „Blaise lässt grüßen. Der Schlüssel ist der Berg, auf dem der Kaiser steht.“",
  spiegel: "Du schreibst die Zahl ins Glas. Sie verläuft, und darunter erscheinen andere Zahlen, als hätte jemand von innen geschrieben:\n\n7·3   5·12   4·6   4·7   7·4   7·9   7·10   7·11\n\nGanz unten, kaum zu lesen: „Das Heft liegt noch da, wo es immer lag.“",
  fernrohr: "Du findest ihn. Der Stern ist rot und pulsiert, und zwischen den Pulsen zählst du mit:\n\n20 9 22 18 21 / 18 13 8 / 15 22 22 9 22 / 14 18 7 / 23 22 14 / 26 15 7 22 13 / 19 6 7\n\nDer Stern zählt nicht von vorn.",
  schluessel: "Der Greifer fasst ins Leere, ganz wie du wolltest. Trotzdem kommt er mit etwas zurück: ein kleiner Messingschlüssel, in den ein Schornstein graviert ist.",
};

/* Der Wirt sagt jedes Mal etwas anderes. Drei der Sätze sind Hinweise, der
   Rest ist Kneipe. */
const WIRT = [
  "Der Wirt poliert ein Glas. „Was darf's sein?“",
  "„Manche hier oben reden nur mit Licht“, sagt der Wirt und nickt zum Himmel. „Lang und kurz, die ganze Nacht.“",
  "„Zeig mir was, das älter ist als dieses Haus“, sagt der Wirt, „und ich mix dir was, das auf keiner Tafel steht.“",
  "„Die Luke da drüben? Der alte Hausmeister hat sich den Code nie aufgeschrieben. Er hat ihn gezählt.“",
  "„Früher war unter uns ein Varieté. Das Programm von damals liegt bestimmt noch irgendwo herum.“",
  "„Ruhiger Abend heute“, sagt der Wirt. „Was darf's sein?“",
  "Der Wirt schiebt dir einen Untersetzer hin. „Bestell ruhig, was nicht auf der Tafel steht. Ich kenne mehr, als draufpasst.“",
];

/* Was der Wirt auf eine gewöhnliche Bestellung sagt. */
const BESTELLUNG = {
  bier: "Ein Pils, frisch gezapft. Prost!", pils: "Ein Pils, frisch gezapft. Prost!", radler: "Ein Radler, halb und halb.",
  wasser: "Ein Glas Leitungswasser. Geht aufs Haus.", cola: "Eine Cola mit viel Eis.", kaffee: "Um diese Uhrzeit? Na gut.",
  spezi: "Spezi gibt's am Kiosk unten in der Ladenstraße. Ich mach hier nur Cocktails und Bier.",
  weserwelle: "Blau wie die Weser bei Nacht. Na ja, blauer.", rotelaterne: "Süß und gefährlich, wie der Name.",
  goldenespielmarke: "Ingwer, Honig, Whisky. Schmeckt nach Gewinnen.", nachtfalter: "Der hält wach. Länger als dir lieb ist.",
  hebelrunter: "Tequila mit Grenadine. Der Name ist eine Warnung.", blauestunde: "Die gibt's nicht für jeden.",
  whisky: "Pur, ohne Eis. Wie es sich gehört.", sekt: "Sekt? Gibt's nur, wenn jemand den Jackpot knackt.",
  limo: "Eine Zitronenlimo, selbst gemacht.", tee: "Pfefferminz. Hat noch nie jemand bestellt, aber bitte.",
};
const UNBEKANNT = [
  "„Kenn ich nicht“, sagt der Wirt. „Steht das auf der Tafel?“",
  "Der Wirt runzelt die Stirn. „Das hat mich noch keiner gefragt.“",
  "„Klingt ausgedacht“, sagt der Wirt und poliert weiter.",
];

/* Das Fernrohr zeigt für das Bekannte etwas, damit es kein Knopf ist, der
   nur auf ein einziges Wort wartet. */
const HIMMEL = {
  mond: "Krater, Meere aus Staub, und am Rand ein bisschen Porta-Nebel.",
  mars: "Ein rostroter Punkt. Rot, ja. Aber nicht das Rot, das du suchst.",
  venus: "Hell wie eine Laterne, aber sie blinkt nicht.",
  jupiter: "Vier kleine Monde in einer Reihe, wie Perlen.",
  saturn: "Die Ringe! Für einen Moment vergisst du, wo du bist.",
  polarstern: "Er steht still, während sich alles um ihn dreht.",
  orion: "Drei Sterne in einer Reihe als Gürtel. Der Jäger steht ganz am Himmel, oben eine rote und unten eine blaue Ecke.",
  sirius: "Der hellste von allen. Er funkelt in allen Farben.",
  grosserwagen: "Sieben Sterne, und keiner davon interessiert sich für dich.",
  andromeda: "Ein milchiger Fleck, zweieinhalb Millionen Jahre alt.",
  sonne: "Nachts? Du siehst nur Schwarz.",
  kaiser: "Auf dem Berg gegenüber steht der Kaiser unter seiner Kuppel. Er sieht nicht zurück.",
  denkmal: "Auf dem Berg gegenüber steht der Kaiser unter seiner Kuppel. Er sieht nicht zurück.",
  weser: "Unten glitzert der Fluss. Ein Schiff fährt nach Minden.",
};

/* Die Luke am Rand des Dachs: vier Zahlen, die man im Haus abzählen muss. */
const LUKE_SATZ = "Die Räder rasten ein, das Schloss springt auf. Unter der Luke liegt in einer Blechkiste ein altes Fernglas, daneben ein Zettel: „Für den, der zählen kann.“";

/*
 * Hinweise der Woche. Jeden Montag (deutsche Zeit, game/hauszeit.js) wird
 * einer mehr sichtbar, im Buch der Geheimnisse und einmal in der Zeitung.
 * Sie werden langsam deutlicher, verraten aber nie eine Antwort: wer alle
 * gelesen hat, muss trotzdem noch jede Stufe selbst lösen. Der erste gilt
 * ab der Woche, in der das Rätsel ins Haus kam.
 *
 * An den Browser geht nur, was schon freigegeben ist.
 */
const HINWEISE = [
  "Wer nachts auf dem Dach steht, sollte nach oben sehen. Nicht alle Lichter dort sind gleich lang.",
  "Der Wirt kennt mehr Drinks, als auf seiner Tafel stehen. Einer davon hängt über seinem Kopf.",
  "Den Bierdeckel hat ein Diplomat aus dem 16. Jahrhundert verschlüsselt. Sein Schlüssel ist kein Wort aus dem Wörterbuch, sondern ein Berg in Porta.",
  "Was verborgen ist, liegt hinter Mänteln. Und das Jahr, in dem der Kaiser auf den Berg kam, steht in jeder Chronik der Stadt.",
  "Zahlenpaare sind Adressen: erst die Zeile, dann das Wort. Das Heft dazu liegt seit 1987 am selben Fleck.",
  "Der Jäger am Winterhimmel hat zwei helle Ecken, eine blaue und eine rote. Gesucht ist die rote.",
  "Wenn ein Stern rückwärts zählt, ist das Z die Eins.",
  "Ins Leere greifen heißt: dorthin, wo kein Ball liegt. Und ein Hut gehört auf den Kopf, nicht in den Schrank.",
  "Ein Schlüssel mit einem Schornstein darauf passt dorthin, wo es raucht.",
];
const hauszeit = require("./hauszeit");
// Die Woche, in der das Rätsel ins Haus kam (Montag, 5. Oktober 2026).
const START_WOCHE = hauszeit.abschnittVon(Date.parse("2026-10-07T12:00:00+02:00"), 7);
function hinweiseFrei(jetzt = Date.now()) {
  return Math.max(0, Math.min(HINWEISE.length, hauszeit.abschnittVon(jetzt, 7) - START_WOCHE + 1));
}
function hinweise(jetzt = Date.now()) {
  const n = hinweiseFrei(jetzt);
  return { liste: HINWEISE.slice(0, n), naechster: n < HINWEISE.length ? hauszeit.abschnittEndet(jetzt, 7) : null, von: HINWEISE.length };
}

/* Wie oft man es versuchen darf. Gilt für alle Eingaben zusammen, damit
   sich das Zahlenschloss nicht durchprobieren lässt: zehntausend
   Möglichkeiten bei zwölf Versuchen je Stunde sind gut zwei Monate. */
const PAUSE_MS = 2000;
const JE_STUNDE = 12;
const versuche = new Map();
function darf(key, jetzt = Date.now()) {
  const v = (versuche.get(key) || []).filter((t) => jetzt - t < 3600000);
  if (v.length && jetzt - v[v.length - 1] < PAUSE_MS) return { ok: false, error: "Langsam. Einmal durchatmen." };
  if (v.length >= JE_STUNDE) return { ok: false, error: "Für diese Stunde hast du genug probiert. Komm später wieder." };
  v.push(jetzt);
  versuche.set(key, v);
  return { ok: true };
}

let eingetragen = null;
function liste() {
  if (eingetragen) return eingetragen;
  try { eingetragen = JSON.parse(fs.readFileSync(DATEI, "utf8")); } catch { eingetragen = []; }
  if (!Array.isArray(eingetragen)) eingetragen = [];
  return eingetragen;
}
/* Sofort und über eine Kopie geschrieben: eine Nummer an der Tafel darf
   nicht verloren gehen, sonst stünde der Nächste auf demselben Platz. */
function schreiben() {
  const tmp = DATEI + ".tmp";
  fs.mkdirSync(path.dirname(DATEI), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(liste(), null, 1));
  fs.renameSync(tmp, DATEI);
}

function zustand(acc) {
  const w = acc.weserlicht && typeof acc.weserlicht === "object" ? acc.weserlicht : (acc.weserlicht = { stufe: 0 });
  if (!Number.isInteger(w.stufe)) w.stufe = 0;
  return w;
}
const stufe = (acc) => (acc && acc.weserlicht && Number.isInteger(acc.weserlicht.stufe) ? acc.weserlicht.stufe : 0);
function hebe(acc, auf) {
  const w = zustand(acc);
  if (w.stufe !== auf - 1) return false;
  w.stufe = auf;
  w.t = w.t || {};
  w.t[auf] = Date.now();
  return true;
}

/** Wer an die Bar kommt. Hält er die alte Schallplatte, gibt es die Blaue Stunde. */
function barBesuch(acc, geruechte = []) {
  const an = kleidung.angelegt(acc) || {};
  if (an.hand === "schallplatte") return { geheimnis: "blauestunde" };
  if (an.kopf === "zylinder") return { spruch: "Der Wirt mustert deinen Hut. „Schön. Aber der ist jünger als ich. Was darf's sein?“" };
  const frei = hinweiseFrei();
  if (frei && Math.random() < 0.25) return { spruch: `Der Wirt beugt sich vor. „Man erzählt sich hier oben: ${HINWEISE[frei - 1]}“ Dann lauter: „Was darf's sein?“` };
  /* Sonst oft ein Gerücht zu etwas, das man selbst noch nicht gefunden hat.
     Der Wirt hört viel; so gibt es zu jedem Geheimnis auch in der Welt
     einen Weg, und nicht nur im Buch. */
  if (geruechte.length && Math.random() < 0.45) {
    const g = geruechte[Math.floor(Math.random() * geruechte.length)];
    return { spruch: `Der Wirt wischt über den Tresen. „Hab gehört: ${g}“ Er zwinkert. „Was darf's sein?“` };
  }
  return { spruch: WIRT[Math.floor(Math.random() * WIRT.length)] };
}

/**
 * Eine Eingabe an einem Ding. Gibt { titel, satz } zurück, und wenn dabei
 * etwas gefunden wurde, `geheimnis` mit der Kennung. Gespeichert wird
 * vom Aufrufer.
 */
function eingabe(acc, art, text) {
  const n = norm(text);
  if (!n) return { satz: "Du überlegst es dir noch mal." };
  if (art === "bar") {
    if (stimmt("bar", text)) {
      hebe(acc, 1);
      if (stufe(acc) >= 1) return { titel: "Ein Bierdeckel", satz: TEXT.bierdeckel, weiter: true };
    }
    if (BESTELLUNG[n]) return { satz: BESTELLUNG[n] };
    return { satz: UNBEKANNT[Math.floor(Math.random() * UNBEKANNT.length)] };
  }
  if (art === "spiegel") {
    if (stufe(acc) >= 1 && stimmt("spiegel", text)) {
      hebe(acc, 2);
      return { titel: "Im Spiegel", satz: TEXT.spiegel, weiter: true };
    }
    return { satz: "Du schreibst es ins Glas. Die Buchstaben verlaufen, und der Spiegel beschlägt wieder." };
  }
  if (art === "teleskop") {
    if (stufe(acc) >= 2 && stimmt("teleskop", text)) {
      hebe(acc, 3);
      return { titel: "Durch das Fernrohr", satz: TEXT.fernrohr, weiter: true };
    }
    return { satz: HIMMEL[n] || "Du suchst eine Weile. Da oben ist viel Himmel, und das hier findest du nicht." };
  }
  if (art === "luke") {
    if (!/^\d{4}$/.test(n)) return { satz: "Das Schloss hat vier Räder mit Ziffern. Nur Ziffern." };
    if (stimmt("luke", text)) return { titel: "Die Luke", satz: LUKE_SATZ, geheimnis: "dachluke" };
    return { satz: "Die Räder klicken. Das Schloss bleibt zu." };
  }
  return { satz: "Hier passiert nichts." };
}

/** Am Greifautomaten, nach jedem Griff: ins Leere, mit dem alten Hut, auf Stufe 3. */
function greifer(acc, treffer) {
  if (treffer != null || stufe(acc) !== 3) return null;
  const an = kleidung.angelegt(acc) || {};
  /* Richtig gegriffen, aber falsch angezogen. Ohne diese Zeile sähe es aus
     wie jeder andere Fehlgriff, und man hielte den ganzen Gedanken für
     falsch. Leise: es steht nur am Automaten, kein Fenster. */
  if (an.kopf !== "zylinder") return { leise: true, satz: "Der Greifer kratzt über den leeren Boden, als suche er etwas. Du hast das Gefühl, nicht passend angezogen zu sein." };
  hebe(acc, 4);
  return { titel: "Ein kleiner Schlüssel", satz: TEXT.schluessel };
}

/** Darf diese Tür auf? Nur der Schornstein hat bisher einen Schlüssel. */
function tuerOffen(acc, schluessel) {
  if (schluessel === "weserlicht") return stufe(acc) >= 4;
  return false;
}

/** Die Ehrentafel in der Sternwarte. Wer zum ersten Mal davorsteht, wird eingetragen. */
function tafel(acc, key, nameVon) {
  const l = liste();
  let neu = false;
  if (stufe(acc) >= 4 && !l.some((e) => e.key === key)) {
    hebe(acc, 5);
    l.push({ key, t: Date.now() });
    schreiben();
    zustand(acc).nr = l.length;
    neu = true;
  }
  const zeilen = l.map((e, i) => `${i + 1}. ${nameVon(e.key)}, ${new Date(e.t).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`);
  const kopf = neu
    ? "Du trägst deinen Namen in die Tafel ein, unter die, die vor dir hier waren. Als du aufsiehst, sitzt ein Rabe auf dem Fernrohr. Er bleibt bei dir. Neben der Tafel hängt eine Laterne, in der ein Stern zu brennen scheint. Auch die gehört jetzt dir."
    : "In die Tafel aus dunklem Holz sind Namen geschnitzt:";
  return { neu, nr: zustand(acc).nr || null, satz: `${kopf}\n\n${zeilen.join("\n") || "Noch steht hier niemand."}` };
}

/** Was jemand auf dem Weg schon zu sehen bekommen hat, fürs Logbuch. */
function notizen(acc) {
  const s = stufe(acc);
  const n = [];
  if (s >= 1) n.push({ titel: "Der Bierdeckel", text: TEXT.bierdeckel });
  if (s >= 2) {
    n.push({ titel: "Die Schrift im Spiegel", text: TEXT.spiegel });
    /* Das Heft gleich daneben, eine Zeile je Absatz: wer auf dem iPad
       zwischen zwei Fenstern hin und her musste, hat die Zeilen verzählt. */
    const heft = programmheft();
    if (heft) n.push({ titel: "Das Programmheft aus dem Fundus", text: heft, zeilen: true });
  }
  if (s >= 3) n.push({ titel: "Was der Stern zählt", text: TEXT.fernrohr });
  if (s >= 4) n.push({ titel: "Der Messingschlüssel", text: TEXT.schluessel });
  return n;
}

/* Der Text des Programmhefts steht genau einmal, am Ding in raeume.js. */
function programmheft() {
  try {
    const d = require("../public/js/welt/raeume.js").raum("fundus").dinge.find((x) => x.id === "heft");
    return d && d.ziel && d.ziel.hinweis || null;
  } catch { return null; }
}

const anzahlEingetragen = () => liste().length;
// Für Tests: Liste und Versuche zurücksetzen, ohne die Datei anzufassen.
function _zuruecksetzen(datei) { eingetragen = []; versuche.clear(); if (datei) DATEI = datei; }

module.exports = { HINWEISE, hinweise, hinweiseFrei, norm, pruefsumme, stimmt, eingabe, barBesuch, greifer, tuerOffen, tafel, notizen, stufe, darf, anzahlEingetragen, STUFEN, _zuruecksetzen };
