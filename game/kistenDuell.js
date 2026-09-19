"use strict";

/**
 * Kisten-Duell: die Kisten sind der Würfel.
 *
 * Zwei Zahlen, und sie bedeuten Verschiedenes. Das ist der ganze Bau:
 *
 *   EINSATZ sind echte Chips. Sie gehen beim Aufmachen vom Konto, und wer
 *   gewinnt, bekommt beide zurück, abzüglich der Gebühr fürs Haus. Darum
 *   wird gespielt.
 *
 *   BUDGET ist nichts. Es ist die Grenze, innerhalb derer man sich
 *   zusammenstellt, was aufgemacht wird, und es kostet keinen Chip. Wer
 *   50.000 setzt und ein Budget von fünf Millionen wählt, macht acht
 *   schwarze Kisten auf und spielt trotzdem um 50.000.
 *
 * DIE STÜCKE GEHÖREN NIEMANDEM. Sie entstehen nicht, sie werden nicht
 * geprägt, sie landen in keiner Sammlung. Was zählt, ist allein ihr Wert,
 * und der ist die Augenzahl. Das ist keine Sparmaßnahme, sondern die
 * Bedingung dafür, dass das Budget frei sein kann: bekäme der Sieger die
 * Stücke, wären aus 50.000 Chips fünf Millionen Kosmetik geworden, und der
 * Markt, um den herum das halbe Haus gebaut ist, wäre in einer Woche tot.
 *
 * Jeder stellt sich SELBST zusammen, was er aufmacht. Genau darin steckt
 * die Entscheidung: viele kleine Ziehungen mit ruhigem Ergebnis, oder
 * wenige große, die alles oder nichts bringen. Beide haben dasselbe
 * Budget, also ist niemand im Vorteil.
 *
 * Gespielt wird LIVE, Runde für Runde, beide Bahnen nebeneinander. Die
 * Spannung an einer Kiste steckt nicht im Ergebnis, sondern in den Sekunden
 * davor; versetzt bliebe davon nur eine Zahl.
 *
 * Der Server treibt die Runden, nicht der Client: wer neu lädt oder das
 * iPad zuklappt, verpasst nichts.
 */

const kisten = require("./kisten");
const cosmetics = require("./cosmetics");
const chat = require("./chat");

const fs = require("fs");
const path = require("path");
const DATEI = path.join(__dirname, "..", "data", "kistenduell.json");

/* Wie viele Kisten einer höchstens aufmacht. Jede Runde dauert gut vier
   Sekunden, zehn sind also knapp eine Minute — lang genug, dass sich ein
   Rückstand noch dreht, kurz genug, dass niemand weggeht. */
const MAX_KISTEN = 10;
/* Die Bahn läuft im Duell kürzer als bei einer einzelnen Ziehung. Dort ist
   die Fahrt der ganze Moment, hier kommen zehn davon hintereinander. */
const BAHN_MS = 3200;
const RUNDE_MS = BAHN_MS + 1300;
/* Chips. Der Einsatz ist echt, deshalb gedeckelt: im Stand vom 18.9. liegen
   im ganzen Haus 32 Millionen, ein einzelnes Duell darf davon keinen
   Bruchteil verschieben, den niemand mehr aufholt. */
const MIN_EINSATZ = 1_000;
const MAX_EINSATZ = 1_000_000;
/* Was das Haus vom Topf behält. Derselbe Satz wie bei den versetzten
   Duellen: der Handel zwischen zweien bringt dem Casino sonst nichts, und
   ohne Abfluss ist ein Duell nur eine Umbuchung. */
const RAKE = 0.10;
/* So lange wartet eine offene Herausforderung. Live heißt: wer jetzt nicht
   da ist, ist zu spät — eine halbe Stunde reicht, damit jemand aus der
   Lobby kommt. */
const WARTEZEIT_MS = 30 * 60 * 1000;
const MAX_OFFEN_PRO_SPIELER = 2;

const de = (n) => Math.round(n).toLocaleString("de-DE");
const err = (error) => ({ ok: false, error });

let _io = null;
let _accounts = null;
const duelle = new Map();
let naechste = 1;

/* ------------------------------------------------------------------
   Speicher

   Auf der Platte liegt nur, wer wie viel EINSATZ hinterlegt hat. Ein Duell
   dauert eine Minute und überlebt keinen Neustart — das muss es auch nicht,
   aber die Chips müssen. Beim Start wird zurückgezahlt und die Datei
   geleert: lieber ein abgebrochenes Duell als ein verschwundener Einsatz.
   ------------------------------------------------------------------ */
function sichere() {
  try {
    const offen = [];
    for (const d of duelle.values()) {
      if (d.status === "fertig") continue;
      for (const s of d.spieler) offen.push({ key: s.key, einsatz: d.einsatz });
    }
    fs.mkdirSync(path.dirname(DATEI), { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify({ hinterlegt: offen }));
  } catch (e) {
    console.error("kistenDuell: konnte Einsätze nicht sichern —", e.message);
  }
}

function laden(accounts) {
  let roh = null;
  try { roh = JSON.parse(fs.readFileSync(DATEI, "utf8")); } catch { return; }
  const offen = (roh && roh.hinterlegt) || [];
  if (!offen.length) return;
  for (const h of offen) {
    try { accounts.adjustChips(h.key, h.einsatz); } catch {}
  }
  accounts.save();
  console.log(`kistenDuell: ${offen.length} hinterlegte Einsätze aus einem abgebrochenen Duell zurückgezahlt.`);
  try { fs.writeFileSync(DATEI, JSON.stringify({ hinterlegt: [] })); } catch {}
}

/* ------------------------------------------------------------------
   Zusammenstellen
   ------------------------------------------------------------------ */

/** Die Kisten, aus denen man wählen darf. Gratiskisten nicht. */
function waehlbar() {
  return kisten.oeffentlich(null).kisten
    .filter((k) => !k.frei)
    .map((k) => ({ id: k.id, label: k.label, preis: k.preis, chancen: k.chancen }));
}

const billigste = () => Math.min(...waehlbar().map((k) => k.preis));
/* Mehr Budget als die teuerste Zusammenstellung lässt sich gar nicht
   ausgeben. Die Obergrenze rechnet sich also selbst aus und muss nie
   nachgepflegt werden. */
const maxBudget = () => Math.max(...waehlbar().map((k) => k.preis)) * MAX_KISTEN;

/**
 * Prüft eine Zusammenstellung gegen ein Budget.
 * Gibt die geprüfte Liste zurück oder null.
 */
function pruefeAuswahl(liste, budget) {
  if (!Array.isArray(liste) || !liste.length || liste.length > MAX_KISTEN) return null;
  let summe = 0;
  for (const id of liste) {
    const k = kisten.KISTEN[id];
    if (!k || k.frei || !kisten.laeuft(k)) return null;
    summe += k.preis;
    if (summe > budget) return null;
  }
  return liste.slice();
}

function spielerAnsicht(s) {
  const acc = _accounts ? _accounts.get(s.key) : null;
  return {
    key: s.key,
    name: acc ? acc.name : s.name,
    look: acc ? cosmetics.publicLook(acc) : null,
    kisten: s.kisten.map((id) => ({ id, label: kisten.KISTEN[id].label, preis: kisten.KISTEN[id].preis })),
    ausgegeben: s.kisten.reduce((n, id) => n + kisten.KISTEN[id].preis, 0),
    gezogen: s.gezogen,
    wert: s.wert,
  };
}

function ansicht(d) {
  return {
    id: d.id,
    status: d.status,
    einsatz: d.einsatz,
    budget: d.budget,
    topf: Math.round(d.einsatz * 2 * (1 - RAKE)),
    runde: d.runde,
    runden: Math.max(...d.spieler.map((s) => s.kisten.length)),
    spieler: d.spieler.map(spielerAnsicht),
    bisAt: d.bisAt,
    sieger: d.sieger || null,
  };
}

function liste(key) {
  const out = [];
  for (const d of duelle.values()) {
    if (d.status === "fertig") continue;
    out.push({ ...ansicht(d), meins: d.spieler.some((s) => s.key === key) });
  }
  out.sort((a, b) => (a.status === b.status ? a.einsatz - b.einsatz : a.status === "offen" ? -1 : 1));
  return out;
}

function sende() { if (_io) _io.emit("kdl:update"); }

/* ------------------------------------------------------------------
   Anlegen, beitreten, abbrechen
   ------------------------------------------------------------------ */

function erstelle(key, { einsatz, budget, kisten: auswahl } = {}) {
  const acc = _accounts.get(key);
  if (!acc) return err("Nicht eingeloggt.");

  const e = Math.floor(Number(einsatz) || 0);
  if (e < MIN_EINSATZ) return err(`Mindestens ${de(MIN_EINSATZ)} Chips Einsatz.`);
  if (e > MAX_EINSATZ) return err(`Höchstens ${de(MAX_EINSATZ)} Chips Einsatz.`);
  if ((acc.chips || 0) < e) return err("Nicht genug Chips.");

  const b = Math.floor(Number(budget) || 0);
  if (b < billigste()) return err(`Das Budget muss mindestens für eine Kiste reichen: ${de(billigste())}.`);
  if (b > maxBudget()) return err(`Mehr als ${de(maxBudget())} Budget lässt sich nicht ausgeben.`);

  const gewaehlt = pruefeAuswahl(auswahl, b);
  if (!gewaehlt) return err(`Such dir zwischen einer und ${MAX_KISTEN} Kisten aus, die ins Budget passen.`);

  const meine = [...duelle.values()].filter((d) => d.status === "offen" && d.spieler[0].key === key).length;
  if (meine >= MAX_OFFEN_PRO_SPIELER) return err(`Höchstens ${MAX_OFFEN_PRO_SPIELER} offene Herausforderungen gleichzeitig.`);

  const r = _accounts.adjustChips(key, -e);
  if (!r.ok) return err(r.error);

  const id = String(naechste++);
  duelle.set(id, {
    id, status: "offen",
    einsatz: e, budget: b,
    runde: 0,
    spieler: [{ key, name: acc.name, kisten: gewaehlt, gezogen: [], wert: 0 }],
    bisAt: Date.now() + WARTEZEIT_MS,
    sieger: null,
  });
  sichere();
  sende();
  try {
    chat.announce(_io, `${acc.name} fordert heraus: Kisten-Duell um ${de(e)} Chips, ${de(b)} Budget. Wer mag?`);
  } catch {}
  return { ok: true, id, duell: ansicht(duelle.get(id)), account: r.account };
}

function beitreten(key, id, auswahl) {
  const d = duelle.get(id);
  if (!d || d.status !== "offen") return err("Diese Herausforderung gibt es nicht mehr.");
  if (d.spieler.some((s) => s.key === key)) return err("Das ist deine eigene Herausforderung.");
  const acc = _accounts.get(key);
  if (!acc) return err("Nicht eingeloggt.");
  if ((acc.chips || 0) < d.einsatz) return err("Nicht genug Chips.");

  const gewaehlt = pruefeAuswahl(auswahl, d.budget);
  if (!gewaehlt) return err(`Such dir zwischen einer und ${MAX_KISTEN} Kisten aus, die ins Budget passen.`);

  const r = _accounts.adjustChips(key, -d.einsatz);
  if (!r.ok) return err(r.error);
  d.spieler.push({ key, name: acc.name, kisten: gewaehlt, gezogen: [], wert: 0 });
  d.status = "laeuft";
  d.runde = 0;
  sichere();
  sende();
  /* Eigenes Ereignis fuer den Start, mit dem ganzen Duell darin: wer
     aufgemacht hat, steht bis hierhin allein auf dem Schirm. */
  if (_io) _io.emit("kdl:start", { id: d.id, duell: ansicht(d) });
  // Kurz Luft, damit beide Bildschirme aufbauen koennen.
  d.timer = setTimeout(() => runde(d), 1600);
  return { ok: true, id, duell: ansicht(d), account: r.account };
}

function abbrechen(key, id) {
  const d = duelle.get(id);
  if (!d) return err("Diese Herausforderung gibt es nicht mehr.");
  if (d.status !== "offen") return err("Das Duell läuft schon.");
  if (d.spieler[0].key !== key) return err("Das ist nicht deine Herausforderung.");
  const r = _accounts.adjustChips(key, d.einsatz);
  duelle.delete(id);
  sichere();
  sende();
  return { ok: true, account: r.account };
}

/* ------------------------------------------------------------------
   Die Runden
   ------------------------------------------------------------------ */

/**
 * Eine Runde: jeder macht SEINE Kiste dieser Runde auf.
 *
 * Die Listen sind verschieden lang, weil jeder sich selbst zusammenstellt.
 * Wer durch ist, hat in den restlichen Runden nichts mehr zu ziehen und
 * steht still daneben — das ist Teil der Entscheidung, die vorher gefallen
 * ist.
 *
 * Gezogen wird fuer beide im selben Moment und beides geht zusammen raus:
 * das ist der ganze Sinn, man sieht, was der andere gerade dreht.
 */
function runde(d) {
  if (d.status !== "laeuft") return;
  const runden = Math.max(...d.spieler.map((s) => s.kisten.length));
  if (d.runde >= runden) return ende(d);

  const zuege = [];
  for (const s of d.spieler) {
    const kistenId = s.kisten[d.runde];
    if (!kistenId) continue;                  // dieser Spieler ist schon durch
    const kiste = kisten.KISTEN[kistenId];
    const t = kiste ? kisten.ziehe(kistenId) : null;
    if (!t) {
      /* Kann nur passieren, wenn eine limitierte Kiste mitten im Duell
         abgelaufen ist. Dann wird abgebrochen und beide bekommen ihren
         Einsatz zurueck, statt ueber ein leeres Ergebnis zu stolpern. */
      console.error(`kistenDuell: Ziehung fehlgeschlagen (${kistenId}), Duell ${d.id} wird abgebrochen.`);
      return ende(d, true);
    }
    s.gezogen.push(t);
    s.wert += t.wert;
    zuege.push({
      key: s.key,
      kiste: { id: kiste.id, label: kiste.label },
      treffer: t,
      rolle: kisten.rolle(kiste, t),
      wert: s.wert,
    });
  }

  if (_io) {
    _io.emit("kdl:runde", {
      id: d.id,
      runde: d.runde,
      von: runden,
      zuege,
      schau: { bahn: BAHN_MS },
    });
  }

  d.runde++;
  d.timer = setTimeout(() => {
    if (d.runde >= runden) ende(d);
    else runde(d);
  }, RUNDE_MS);
}

/**
 * Abrechnen.
 *
 * Nur Chips. Die gezogenen Stuecke haben nie existiert: sie sind nicht
 * gepraegt, nicht vergeben und stehen in keiner Sammlung. Ihr Wert war die
 * Augenzahl, mehr nicht.
 */
function ende(d, abbruch = false) {
  if (d.status === "fertig") return;
  clearTimeout(d.timer);
  d.status = "fertig";

  const [a, b] = d.spieler;
  const unentschieden = abbruch || !b || a.wert === b.wert;
  const sieger = unentschieden ? null : (a.wert > b.wert ? a : b);
  d.sieger = sieger ? sieger.key : null;

  let gewinn = 0;
  if (unentschieden) {
    // Jeder bekommt seinen Einsatz zurueck. Das Haus nimmt nichts: es hat
    // auch nichts entschieden.
    for (const s of d.spieler) _accounts.adjustChips(s.key, d.einsatz);
  } else {
    const topf = d.einsatz * 2;
    gewinn = Math.round(topf * (1 - RAKE));
    /*
     * Gebucht wird der NETTO-Gewinn: der Einsatz ist beim Aufmachen schon
     * abgebucht, hier kommt dazu, was einer mehr oder weniger hat als vorher.
     *
     * `house: false`, und das ist wichtig. Bei einem Hausspiel bekommt der
     * Casino-Besitzer fuenf Prozent jedes Verlusts gutgeschrieben, und zwar
     * AUS DEM NICHTS — richtig, weil bei einem Hausspiel der ganze Verlust
     * ans Haus ging. Hier ging er an den anderen Spieler. Mit `true` haette
     * jedes Duell fuenf Prozent des Einsatzes neu gedruckt. Der Anteil des
     * Hauses ist der Rake oben, und der VERBRENNT.
     */
    const verlierer = sieger === a ? b : a;
    _accounts.adjustChips(sieger.key, gewinn);
    try {
      _accounts.recordHand(sieger.key, gewinn - d.einsatz, false, "Kisten-Duell", { einsatz: d.einsatz });
      _accounts.recordHand(verlierer.key, -d.einsatz, false, "Kisten-Duell", { einsatz: d.einsatz });
    } catch {}
  }
  _accounts.save();
  sichere();

  if (_io) {
    _io.emit("kdl:ende", {
      id: d.id,
      unentschieden,
      abbruch,
      sieger: sieger ? { key: sieger.key, name: sieger.name, wert: sieger.wert } : null,
      gewinn,
      einsatz: d.einsatz,
      stand: d.spieler.map((s) => ({ key: s.key, name: s.name, wert: s.wert })),
    });
    /* Kontostaende nachziehen: beide haben gerade Chips bekommen oder
       verloren, ohne etwas zu druecken. */
    for (const s of d.spieler) {
      const acc = _accounts.get(s.key);
      if (!acc) continue;
      for (const sock of _io.of("/").sockets.values()) {
        if (sock.data && sock.data.account === s.key) {
          sock.emit("account:update", { account: _accounts.publicAccount(acc) });
          break;
        }
      }
    }
  }

  if (sieger && !abbruch) {
    const verlierer = sieger === a ? b : a;
    const satz = `${sieger.name} gewinnt das Kisten-Duell gegen ${verlierer.name}: `
      + `${de(sieger.wert)} gegen ${de(verlierer.wert)} gezogen, ${de(gewinn)} Chips.`;
    try { chat.announce(_io, satz); } catch {}
    try { require("./chronik").notiere("event", satz, { user: sieger.name, wert: gewinn }); } catch {}
  }

  setTimeout(() => { duelle.delete(d.id); sende(); }, 2000);
  sende();
}

/** Abgelaufene Herausforderungen wegräumen und die Einsätze zurückgeben. */
function raeumeAuf() {
  const jetzt = Date.now();
  let weg = 0;
  for (const d of [...duelle.values()]) {
    if (d.status !== "offen" || d.bisAt > jetzt) continue;
    _accounts.adjustChips(d.spieler[0].key, d.einsatz);
    duelle.delete(d.id);
    weg++;
  }
  if (weg) { _accounts.save(); sichere(); sende(); }
}

function setupKistenDuell(io, accounts) {
  _io = io;
  _accounts = accounts;
  laden(accounts);
  setInterval(raeumeAuf, 60 * 1000).unref?.();

  io.on("connection", (socket) => {
    const key = () => socket.data.account || null;

    socket.on("kdl:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({
        ok: true,
        duelle: liste(key()),
        kisten: waehlbar(),
        maxKisten: MAX_KISTEN,
        minEinsatz: MIN_EINSATZ,
        maxEinsatz: MAX_EINSATZ,
        minBudget: billigste(),
        maxBudget: maxBudget(),
        rake: RAKE,
        wartezeitMs: WARTEZEIT_MS,
      });
    });

    socket.on("kdl:erstelle", (daten = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      ack(erstelle(key(), daten));
    });

    socket.on("kdl:beitreten", ({ id, kisten: auswahl } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      ack(beitreten(key(), String(id), auswahl));
    });

    socket.on("kdl:abbrechen", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      ack(abbrechen(key(), String(id)));
    });
  });
}

/* Namen stehen als Kopie am Duell, damit die Liste ohne Kontozugriff lesbar
   ist. Ein Duell lebt nur Minuten, aber eine Umbenennung genau dann wuerde
   sonst mitten im Duell den alten Namen zeigen. */
function umbenennen(key, alt, neu) {
  for (const d of duelle.values()) {
    for (const s of d.spieler) if (s.key === key) s.name = neu;
  }
  return 0;
}

module.exports = { setupKistenDuell, umbenennen, MAX_KISTEN, waehlbar, RAKE };
