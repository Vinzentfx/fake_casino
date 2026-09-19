"use strict";

/**
 * Duelle, die man nicht gleichzeitig spielen muss.
 *
 * Das Casino hat fuenf Spiele, die ausschliesslich gegeneinander laufen:
 * Sudoku-Race, Memory-Duell, Schach, Solitaer-Race und Poker. Alle verlangen,
 * dass zwei Leute im selben Moment vor dem Bildschirm sitzen. In einer
 * Freundesrunde, die in Schueben spielt, passiert das fast nie, die Spiele
 * standen deshalb monatelang still.
 *
 * Bei den Raetselspielen ist das aber gar nicht noetig. Beide bekommen
 * dieselbe Aufgabe, und am Ende werden zwei Ergebnisse verglichen. Ob das
 * gleichzeitig geschieht, ist der Aufgabe egal.
 *
 * Also: du machst eine Herausforderung auf, spielst sie sofort, und dein
 * Ergebnis wartet. Irgendwann kommt jemand vorbei, sieht "Tom hat 81 Felder in
 * 6:12 geschafft", nimmt an, spielt dieselbe Aufgabe und bekommt sofort das
 * Ergebnis. Kein Termin noetig.
 *
 * Der Einsatz beider liegt vom Moment des Annehmens an fest; der Pot wird
 * abzueglich Rake ausgezahlt. Nimmt niemand an, bekommt der Ersteller nach
 * Ablauf seinen Einsatz zurueck. Warten darf nichts kosten.
 *
 * Spielabhaengiges steckt in Adapter. Das Modul selbst kennt nur Aufgabe,
 * Ergebnis und Vergleich, damit spaeter Memory und Solitaer dazukommen
 * koennen, ohne dass es ein zweites Regelwerk gibt.
 *
 * Stand in data/duelle.json.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "duelle.json");

const RAKE = 0.10;
const MIN_EINSATZ = 50;
const MAX_EINSATZ = 1_000_000;
const LAUFZEIT_MS = 48 * 60 * 60 * 1000;   // so lange wartet eine Herausforderung
const SPIELZEIT_MS = 30 * 60 * 1000;       // so lange darf eine Partie dauern
const MAX_OFFEN_PRO_SPIELER = 3;           // sonst blockiert einer die Liste
const ARCHIV_MAX = 30;

let _io = null, _accounts = null;

/* Spiel-Adapter
 *
 * erzeuge(opts)                    gibt { aufgabe, geheim, label }
 * bewerte(geheim, einsendung, ms)  gibt { punkte, ms, text }, mehr Punkte gewinnen
 * abrechnen(d, { sieger, ausgang }) optional, siehe unten
 * keinPot: true                    optional, siehe unten
 *
 * `abrechnen` gibt es, weil nicht jedes Duell nur um Chips geht. Beim
 * Kisten-Duell wechseln GEGENSTAENDE den Besitzer: wer mehr Wert gezogen hat,
 * bekommt auch die Stuecke des anderen. Chips kann dieses Modul, Gegenstaende
 * nicht, und es soll sie auch nicht kennen — deshalb die Naht.
 *
 * Aufgerufen wird es bei jedem Ausgang, auch bei "abgelaufen" und "nicht
 * gespielt": ein Adapter, der etwas in Verwahrung hat, muss es in JEDEM Fall
 * wieder herausgeben koennen. Warten darf nichts kosten, das gilt auch fuer
 * Gegenstaende.
 *
 * `keinPot` gehoert dazu. Normalerweise wandern beide Einsaetze in einen Topf
 * und der Sieger bekommt ihn. Beim Kisten-Duell ist der Einsatz aber schon
 * ausgegeben: er IST das Budget, mit dem gezogen wurde. Wuerde der Sieger
 * zusaetzlich den Topf bekommen, haetten beide ihre Stuecke umsonst
 * bekommen und das Duell waere der billigste Weg an Kosmetik. Deshalb:
 *
 *   keinPot  Es fliessen keine Chips zwischen den beiden. Der Einsatz gilt in
 *            dem Moment als ausgegeben, in dem jemand sein Ergebnis abgibt.
 *            Wer nie abgibt, bekommt ihn zurueck, denn dann wurde auch nichts
 *            gezogen. Der Gewinn steckt ausschliesslich in dem, was der
 *            Adapter verteilt.
 */
const ADAPTER = {};

function registriere(adapter) { ADAPTER[adapter.id] = adapter; }

// Stand
let state = load();

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s === "object") return { offen: s.offen || {}, archiv: Array.isArray(s.archiv) ? s.archiv : [] };
  } catch {}
  return { offen: {}, archiv: [] };
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}

const neueId = () => crypto.randomBytes(6).toString("hex");
const nameVon = (key) => {
  const a = _accounts && _accounts.get(key);
  return a ? a.name : key;
};

/** Abgelaufene Herausforderungen erstatten. Warten darf nichts kosten. */
function raeumeAuf() {
  const jetzt = Date.now();
  let geaendert = false;
  for (const [id, d] of Object.entries(state.offen)) {
    // Der Ersteller hat seine eigene Partie nie zu Ende gespielt (Tab zu und
    // vergessen). Die Herausforderung waere damit nie annehmbar geworden, also
    // Einsatz zurueck statt ihn 48 Stunden zu binden.
    if (!d.erstellerErgebnis && jetzt > d.erstellerBisAt) {
      if (_accounts) { _accounts.adjustChips(d.ersteller, d.einsatz); meldeStand(d.ersteller); }
      rechneAb(d, { sieger: null, ausgang: "nicht gespielt" });
      // Ein Gegner kann hier noch nicht drinstehen: angenommen wird erst,
      // wenn ein Ergebnis des Erstellers vorliegt.
      archiviere({ ...d, id, aufgabe: null, geheim: null, ausgang: "nicht gespielt", beendetAt: jetzt });
      delete state.offen[id];
      geaendert = true;
      continue;
    }
    // Angenommen, aber der Gegner ist nie fertig geworden: dann gewinnt der,
    // der ein Ergebnis abgegeben hat.
    if (d.gegner && d.gegnerBisAt && jetzt > d.gegnerBisAt && !d.gegnerErgebnis) {
      entscheide(id, { aufgabe: true });
      geaendert = true;
      continue;
    }
    if (!d.gegner && jetzt > d.laeuftBisAt) {
      /* Bei keinPot ist der Einsatz beim Abgeben ausgegeben worden; der
         Ersteller bekommt stattdessen zurueck, was er gezogen hat, und das
         macht rechneAb. Ihm hier zusaetzlich die Chips zu erstatten hiesse,
         ihm die Kisten zu schenken. */
      const ohnePot = (ADAPTER[d.spiel] || {}).keinPot;
      if (_accounts && !ohnePot) { _accounts.adjustChips(d.ersteller, d.einsatz); meldeStand(d.ersteller); }
      rechneAb(d, { sieger: null, ausgang: "abgelaufen" });
      archiviere({ ...d, id, aufgabe: null, geheim: null, ausgang: "abgelaufen", beendetAt: jetzt });
      delete state.offen[id];
      geaendert = true;
    }
  }
  if (geaendert) { save(); sende(); }
}

function archiviere(eintrag) {
  state.archiv.unshift(eintrag);
  if (state.archiv.length > ARCHIV_MAX) state.archiv.length = ARCHIV_MAX;
}

/** Dem Adapter Bescheid geben, falls er etwas zu verteilen hat. */
function rechneAb(d, info) {
  const a = ADAPTER[d.spiel];
  if (!a || typeof a.abrechnen !== "function") return null;
  try { return a.abrechnen(d, info); } catch (e) {
    console.error(`asyncDuell: abrechnen(${d.spiel}) ist gescheitert.`, e.message);
    return null;
  }
}

// Ablauf
/**
 * Herausforderung aufmachen. Der Einsatz wird sofort abgebucht, damit niemand
 * eine Herausforderung stehen lassen kann, die er gar nicht bezahlen koennte.
 */
function erstelle(key, { spiel, einsatz, optionen = {} } = {}) {
  raeumeAuf();
  const adapter = ADAPTER[spiel];
  if (!adapter) return { ok: false, error: "Unbekanntes Spiel." };
  const acc = _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  einsatz = Math.floor(Number(einsatz) || 0);
  /* Manche Spiele koennen mit einem Mindesteinsatz von 50 Chips gar nichts
     anfangen: beim Kisten-Duell IST der Einsatz das Budget, und die
     billigste Kiste kostet 30.000. Ein Duell darunter haette beiden den
     Einsatz genommen und keine einzige Ziehung geliefert. Deshalb darf ein
     Spiel eine eigene Untergrenze nennen. */
  const min = Math.max(MIN_EINSATZ, Math.floor(Number(adapter.minEinsatz) || 0));
  if (einsatz < min) return { ok: false, error: `Mindesteinsatz ${min.toLocaleString("de-DE")} Chips.` };
  if (einsatz > MAX_EINSATZ) return { ok: false, error: `Maximaleinsatz ${MAX_EINSATZ.toLocaleString("de-DE")} Chips.` };
  if (acc.chips < einsatz) return { ok: false, error: "Nicht genug Chips." };

  const meine = Object.values(state.offen).filter((d) => d.ersteller === key && !d.gegner).length;
  if (meine >= MAX_OFFEN_PRO_SPIELER) {
    return { ok: false, error: `Höchstens ${MAX_OFFEN_PRO_SPIELER} offene Herausforderungen gleichzeitig.` };
  }

  const r = _accounts.adjustChips(key, -einsatz);
  if (!r.ok) return { ok: false, error: r.error };

  /* Der Einsatz geht mit in den Adapter. Beim Kisten-Duell IST er die
     Aufgabe (so viel darfst du in Kisten stecken), und ohne ihn muesste der
     Adapter ihn aus einer zweiten Quelle raten. */
  const { aufgabe, geheim, label } = adapter.erzeuge({ ...optionen, einsatz });
  const id = neueId();
  const jetzt = Date.now();
  state.offen[id] = {
    spiel, einsatz, label: label || "",
    ersteller: key, erstellerName: acc.name,
    aufgabe, geheim,
    erstellerErgebnis: null,
    erstellerBisAt: jetzt + SPIELZEIT_MS,
    gegner: null, gegnerName: null, gegnerErgebnis: null, gegnerBisAt: 0,
    erstelltAt: jetzt,
    laeuftBisAt: jetzt + LAUFZEIT_MS,
  };
  save();
  return { ok: true, id, aufgabe, einsatz, account: r.account, bisAt: state.offen[id].erstellerBisAt };
}

/** Eine offene Herausforderung annehmen und dieselbe Aufgabe bekommen. */
function nimmAn(key, id) {
  raeumeAuf();
  const d = state.offen[id];
  if (!d) return { ok: false, error: "Diese Herausforderung gibt es nicht mehr." };
  if (d.gegner) return { ok: false, error: "Da ist schon jemand dran." };
  if (!d.erstellerErgebnis) return { ok: false, error: "Der Ersteller spielt gerade noch." };
  if (d.ersteller === key) return { ok: false, error: "Deine eigene Herausforderung." };
  const acc = _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  if (acc.chips < d.einsatz) return { ok: false, error: "Nicht genug Chips." };

  const r = _accounts.adjustChips(key, -d.einsatz);
  if (!r.ok) return { ok: false, error: r.error };
  d.gegner = key;
  d.gegnerName = acc.name;
  d.gegnerBisAt = Date.now() + SPIELZEIT_MS;
  save();
  sende();
  return { ok: true, id, aufgabe: d.aufgabe, einsatz: d.einsatz, account: r.account, bisAt: d.gegnerBisAt,
    gegenName: d.erstellerName, gegenErgebnis: oeffentlichesErgebnis(d.erstellerErgebnis) };
}

/** Ergebnis abgeben. Der Server bewertet, der Client meldet nur seine Eingabe. */
function gibAb(key, id, einsendung) {
  const d = state.offen[id];
  if (!d) return { ok: false, error: "Diese Herausforderung gibt es nicht mehr." };
  const adapter = ADAPTER[d.spiel];
  if (!adapter) return { ok: false, error: "Unbekanntes Spiel." };

  const istErsteller = d.ersteller === key;
  const istGegner = d.gegner === key;
  if (!istErsteller && !istGegner) return { ok: false, error: "Du gehörst nicht zu dieser Partie." };
  if (istErsteller && d.erstellerErgebnis) return { ok: false, error: "Schon abgegeben." };
  if (istGegner && d.gegnerErgebnis) return { ok: false, error: "Schon abgegeben." };

  const start = istErsteller ? d.erstellerBisAt - SPIELZEIT_MS : d.gegnerBisAt - SPIELZEIT_MS;
  const ms = Math.max(0, Math.min(SPIELZEIT_MS, Date.now() - start));
  const ergebnis = adapter.bewerte(d.geheim, einsendung, ms);

  if (istErsteller) {
    d.erstellerErgebnis = ergebnis;
    save();
    sende();
    return { ok: true, wartet: true, ergebnis };
  }
  d.gegnerErgebnis = ergebnis;
  const aus = entscheide(id);
  // Der Kontostand hat sich beim Abrechnen gerade geaendert. Ohne ihn zeigt
  // die Kopfzeile weiter den Stand von vor der Auszahlung.
  const acc = _accounts.get(key);
  return { ok: true, wartet: false, ergebnis, ...aus, account: acc ? _accounts.publicAccount(acc) : null };
}

/**
 * Abrechnen. `opts.aufgabe` heisst: der Gegner hat die Spielzeit verstreichen
 * lassen, ohne abzugeben, dann gewinnt der andere kampflos.
 */
function entscheide(id, opts = {}) {
  const d = state.offen[id];
  if (!d) return {};
  const a = d.erstellerErgebnis, b = d.gegnerErgebnis;
  let sieger = null;   // "ersteller" | "gegner" | null (unentschieden)
  if (opts.aufgabe || !b) sieger = "ersteller";
  else if (!a) sieger = "gegner";
  else if (b.punkte !== a.punkte) sieger = b.punkte > a.punkte ? "gegner" : "ersteller";
  else if (b.ms !== a.ms) sieger = b.ms < a.ms ? "gegner" : "ersteller";

  const adapter = ADAPTER[d.spiel] || {};
  const pot = d.einsatz * 2;
  let rake = 0, auszahlung = 0;
  if (adapter.keinPot) {
    /* Kein Chip fliesst. Nur wer angenommen, aber nie abgegeben hat, bekommt
       seinen Einsatz zurueck: der hat nichts gezogen, also auch nichts
       ausgegeben. */
    if (opts.aufgabe && d.gegner && !d.gegnerErgebnis) _accounts.adjustChips(d.gegner, d.einsatz);
  } else if (sieger) {
    rake = Math.floor(pot * RAKE);
    auszahlung = pot - rake;
    _accounts.adjustChips(sieger === "ersteller" ? d.ersteller : d.gegner, auszahlung);
  } else {
    // Unentschieden: beide bekommen genau ihren Einsatz zurueck, kein Rake.
    // Ein Rake auf ein Remis waere eine Strafe fuers Gleichgutsein.
    _accounts.adjustChips(d.ersteller, d.einsatz);
    _accounts.adjustChips(d.gegner, d.einsatz);
  }

  const ausgang = opts.aufgabe ? "aufgegeben" : sieger ? "entschieden" : "unentschieden";
  const beute = rechneAb(d, { sieger, ausgang });

  const eintrag = {
    id, spiel: d.spiel, label: d.label, einsatz: d.einsatz,
    // Was der Adapter verteilt hat, fuers Archiv und die Meldung.
    beute: beute || null,
    erstellerName: d.erstellerName, gegnerName: d.gegnerName,
    erstellerErgebnis: oeffentlichesErgebnis(a), gegnerErgebnis: oeffentlichesErgebnis(b),
    ausgang,
    sieger, auszahlung, beendetAt: Date.now(),
  };
  archiviere(eintrag);
  delete state.offen[id];
  save();
  /* Beide, ohne zu unterscheiden welcher Zweig oben gegriffen hat: die
     Meldung kostet nichts und eine vergessene Seite faellt nicht auf. */
  meldeStand(d.ersteller, d.gegner);

  const siegerName = sieger === "ersteller" ? d.erstellerName : sieger === "gegner" ? d.gegnerName : null;
  if (_io) {
    try {
      const chat = require("./chat");
      const adapter = ADAPTER[d.spiel];
      const spielName = adapter ? adapter.label : d.spiel;
      chat.announce(_io, siegerName
        ? `${spielName}-Duell: ${siegerName} gewinnt gegen ${siegerName === d.erstellerName ? d.gegnerName : d.erstellerName} und holt ${auszahlung.toLocaleString("de-DE")} Chips.`
        : `${spielName}-Duell zwischen ${d.erstellerName} und ${d.gegnerName} endet unentschieden.`);
    } catch {}
    // Der Verlierer ist fast immer der, der nicht gerade davorsitzt.
    try {
      const push = require("./push");
      const verlierer = sieger === "ersteller" ? d.gegner : d.ersteller;
      const gewinner = sieger === "ersteller" ? d.ersteller : d.gegner;
      if (sieger && verlierer) {
        push.an(verlierer, "tisch", {
          title: "Dein Duell ist entschieden",
          body: `${nameVon(gewinner)} war besser. Revanche?`,
          url: "/",
        });
      }
    } catch {}
  }
  sende();
  return { eintrag, sieger, auszahlung, siegerName, beute };
}

/** Was andere von einem Ergebnis sehen duerfen. Die Loesung nie. */
function oeffentlichesErgebnis(e) {
  if (!e) return null;
  return { punkte: e.punkte, ms: e.ms, text: e.text || "" };
}

// Sicht für den Client
function publicState(key) {
  raeumeAuf();
  const offen = [], meine = [], laufend = [];
  for (const [id, d] of Object.entries(state.offen)) {
    const zeile = {
      id, spiel: d.spiel, label: d.label, einsatz: d.einsatz,
      erstellerName: d.erstellerName, gegnerName: d.gegnerName,
      erstellerErgebnis: oeffentlichesErgebnis(d.erstellerErgebnis),
      laeuftBisAt: d.laeuftBisAt,
      meine: d.ersteller === key,
    };
    if (d.ersteller === key && !d.erstellerErgebnis) laufend.push({ ...zeile, bisAt: d.erstellerBisAt, aufgabe: d.aufgabe });
    else if (d.gegner === key && !d.gegnerErgebnis) laufend.push({ ...zeile, bisAt: d.gegnerBisAt, aufgabe: d.aufgabe });
    else if (d.ersteller === key) meine.push(zeile);
    else if (!d.gegner && d.erstellerErgebnis) offen.push(zeile);
  }
  offen.sort((a, b) => a.einsatz - b.einsatz);
  meine.sort((a, b) => b.laeuftBisAt - a.laeuftBisAt);
  return {
    ok: true, offen, meine, laufend,
    archiv: state.archiv.slice(0, 10),
    minEinsatz: MIN_EINSATZ, maxEinsatz: MAX_EINSATZ, rake: RAKE,
    laufzeitMs: LAUFZEIT_MS, spielzeitMs: SPIELZEIT_MS,
  };
}

/**
 * Wo jemand am Zug ist und den Einsatz schon los ist.
 *
 * Fuer die Marke am Menue. Ein Duell, das man angenommen und nicht gespielt
 * hat, ist genau das, was der goldene Zaehler meint: bezahlt und noch nicht
 * abgeholt. Dass es irgendwann von selbst verfaellt und der Einsatz
 * zurueckkommt, macht es nicht besser — dann hat man umsonst gewartet.
 */
function offeneZuege(key) {
  return publicState(key).laufend.map((d) => ({
    id: d.id, spiel: d.spiel, einsatz: d.einsatz,
    gegen: d.meine ? d.gegnerName : d.erstellerName,
    bisAt: d.bisAt,
  }));
}

function sende() { if (_io) _io.emit("duell:update"); }

/**
 * Den Kontostand bei denen nachziehen, die gerade da sind.
 *
 * Ein versetztes Duell rechnet ab, ohne dass jemand einen Knopf gedrueckt
 * hat: der Einsatz kommt zurueck, wenn niemand annimmt, und der Sieger
 * bekommt den Topf, waehrend er vielleicht gerade Slots spielt. Ohne diese
 * Zeile steht in seiner Topbar weiter der alte Stand, bis er zufaellig
 * etwas anderes tut — und beim naechsten Blick stimmt eine Zahl nicht, die
 * er vorher gesehen hat. Dieselbe Regel wie beim Auktions-Zuschlag und im
 * Kisten-Duell.
 */
function meldeStand(...keys) {
  if (!_io || !_accounts) return;
  const offen = new Set(keys.filter(Boolean));
  if (!offen.size) return;
  for (const sock of _io.of("/").sockets.values()) {
    const key = sock.data && sock.data.account;
    if (!key || !offen.has(key)) continue;
    const acc = _accounts.get(key);
    if (acc) sock.emit("account:update", { account: _accounts.publicAccount(acc) });
    offen.delete(key);
    if (!offen.size) return;
  }
}

function setup(io, accounts) {
  _io = io;
  _accounts = accounts;
  setInterval(raeumeAuf, 60 * 1000).unref();

  io.on("connection", (socket) => {
    const key = () => socket.data.account || null;

    socket.on("duell:state", (ack) => {
      if (typeof ack !== "function") return;
      ack(publicState(key()));
    });

    socket.on("duell:create", ({ spiel, einsatz, optionen } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = erstelle(key(), { spiel, einsatz, optionen });
      if (r.ok) sende();
      ack(r);
    });

    socket.on("duell:accept", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(nimmAn(key(), String(id || "")));
    });

    socket.on("duell:submit", ({ id, einsendung } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(gibAb(key(), String(id || ""), einsendung));
    });
  });
}

/**
 * Namenskopien nachziehen.
 *
 * Am Duell steht der Name beider Seiten als Kopie, damit die Liste ohne
 * Kontozugriff lesbar ist — und ein Duell wartet bis zu 48 Stunden auf
 * seinen Gegner. Wer sich in dieser Zeit umbenennt, stuende sonst mit dem
 * alten Namen in einer Herausforderung, die noch offen ist; und der
 * haeufigste Grund fuer eine Umbenennung ist gerade, dass der alte Name
 * nicht mehr zu sehen sein soll.
 *
 * Das Archiv kommt mit: dort steht, wer gegen wen gespielt hat, und das
 * bleibt liegen.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  for (const d of Object.values(state.offen)) {
    if (d.ersteller === key && d.erstellerName !== neu) { d.erstellerName = neu; n++; }
    if (d.gegner === key && d.gegnerName !== neu) { d.gegnerName = neu; n++; }
  }
  for (const e of state.archiv) {
    if (e.erstellerName === alt) { e.erstellerName = neu; n++; }
    if (e.gegnerName === alt) { e.gegnerName = neu; n++; }
  }
  if (n) save();
  return n;
}

// erstelle/nimmAn/gibAb kommen mit heraus, damit sich ein Duell ohne
// Browser durchspielen laesst. Im Betrieb gehen sie ueber die Socket-Handler.
module.exports = { setup, registriere, publicState, erstelle, nimmAn, gibAb, umbenennen, offeneZuege, RAKE, MIN_EINSATZ, MAX_EINSATZ };
