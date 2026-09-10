"use strict";

/**
 * Kniffel — zwei Spieler, abwechselnd, serverseitig entschieden.
 *
 * Sieben Kategorien statt der klassischen dreizehn: eine volle Partie dauert
 * zu zweit weit ueber eine Viertelstunde, und so lange bleibt hier niemand
 * am selben Tisch. Sieben sind in etwa fuenf Minuten durch und behalten die
 * Entscheidung, um die es geht — wo trage ich einen mittelmaessigen Wurf ein.
 *
 * Warum kein versetztes Duell (game/asyncDuell.js)? Weil man dort die ganze
 * Aufgabe auf einmal bekommt. Bei Kniffel waeren das alle kuenftigen Wuerfe,
 * und wer die kennt, spielt perfekt. Die Wuerfel muessen fallen, waehrend
 * gespielt wird.
 *
 * Kein Hausvorteil: der Einsatz beider wandert in den Topf, der Gewinner
 * nimmt ihn abzueglich RAKE. Das ist ein Spiel gegeneinander, das Haus
 * verdient nur an der Vermittlung.
 */

const crypto = require("crypto");
const lobby = require("./lobby");
const chat = require("./chat");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WUERFEL = 5;
const WUERFE_PRO_ZUG = 3;
const MIN_BET = 50, MAX_BET = 50_000;
const RAKE = 0.05;              // Vermittlungsgebuehr des Hauses
const ZUG_MS = 90_000;          // so lange darf ein Zug dauern
const TOT_MS = 20 * 60 * 1000;  // verwaiste Partie aufraeumen

/*
 * Die sieben Felder. `punkte(w)` bekommt die fuenf Augenzahlen und gibt,
 * was das Feld dafuer zahlt — 0, wenn die Bedingung nicht erfuellt ist.
 * Eingetragen werden MUSS trotzdem, genau darin liegt das Spiel.
 */
const FELDER = [
  { id: "dreier", label: "Dreierpasch", hinweis: "3 gleiche — zählt alle Augen",
    punkte: (w) => (maxGleich(w) >= 3 ? summe(w) : 0) },
  { id: "vierer", label: "Viererpasch", hinweis: "4 gleiche — zählt alle Augen",
    punkte: (w) => (maxGleich(w) >= 4 ? summe(w) : 0) },
  { id: "full",   label: "Full House",  hinweis: "3 + 2 gleiche — 25 Punkte",
    punkte: (w) => (istFull(w) ? 25 : 0) },
  { id: "kleine", label: "Kleine Straße", hinweis: "4 in Folge — 30 Punkte",
    punkte: (w) => (folgeLaenge(w) >= 4 ? 30 : 0) },
  { id: "grosse", label: "Große Straße",  hinweis: "5 in Folge — 40 Punkte",
    punkte: (w) => (folgeLaenge(w) >= 5 ? 40 : 0) },
  { id: "kniffel", label: "Kniffel",      hinweis: "5 gleiche — 50 Punkte",
    punkte: (w) => (maxGleich(w) === 5 ? 50 : 0) },
  { id: "chance", label: "Chance",        hinweis: "Zählt immer alle Augen",
    punkte: (w) => summe(w) },
];

const wurf = () => 1 + crypto.randomInt(6);
const summe = (w) => w.reduce((s, x) => s + x, 0);
function zaehle(w) { const c = [0, 0, 0, 0, 0, 0, 0]; for (const x of w) c[x]++; return c; }
const maxGleich = (w) => Math.max(...zaehle(w).slice(1));
function istFull(w) {
  const c = zaehle(w).slice(1);
  return c.includes(3) && c.includes(2);
}
function folgeLaenge(w) {
  const c = zaehle(w);
  let best = 0, lauf = 0;
  for (let i = 1; i <= 6; i++) { if (c[i]) { lauf++; best = Math.max(best, lauf); } else lauf = 0; }
  return best;
}

/** Was jedes noch freie Feld mit DIESEN Würfeln bringen würde. */
function vorschau(w, blatt) {
  const out = {};
  for (const f of FELDER) if (blatt[f.id] == null) out[f.id] = f.punkte(w);
  return out;
}

const gesamt = (blatt) => FELDER.reduce((s, f) => s + (blatt[f.id] || 0), 0);
const alleGesetzt = (blatt) => FELDER.every((f) => blatt[f.id] != null);

function setupKniffel(io, accounts) {
  const partien = new Map(); // code -> partie

  function makeCode() {
    let c;
    do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(""); }
    while (partien.has(c));
    return c;
  }

  const spielerListe = (p) => [...p.spieler.values()];

  function beschreibe(p) {
    const namen = spielerListe(p).map((s) => s.name);
    return {
      code: p.code, game: "kniffel", label: "🎯 Kniffel-Duell",
      host: namen[0] || "?", players: p.spieler.size, max: 2,
      buyIn: p.einsatz,
      joinable: p.phase === "warten" && p.spieler.size < 2,
    };
  }
  const registriere = (code) => lobby.add(code, () => (partien.has(code) ? beschreibe(partien.get(code)) : null));

  function sicht(p, fuer) {
    const liste = spielerListe(p).map((s) => ({
      key: s.key, name: s.name, blatt: s.blatt, gesamt: gesamt(s.blatt), fertig: alleGesetzt(s.blatt),
    }));
    const dran = p.dran ? p.spieler.get(p.dran) : null;
    const ichBinDran = !!(fuer && p.dran === fuer);
    return {
      ok: true, code: p.code, phase: p.phase, einsatz: p.einsatz, topf: p.topf,
      felder: FELDER.map((f) => ({ id: f.id, label: f.label, hinweis: f.hinweis })),
      spieler: liste,
      dran: p.dran, dranName: dran ? dran.name : null, ichBinDran,
      wuerfel: p.wuerfel, halten: p.halten, wuerfeUebrig: p.wuerfeUebrig,
      // Die Vorschau bekommt nur, wer dran ist — sonst rechnet der Gegner mit.
      vorschau: ichBinDran && p.wuerfel.length ? vorschau(p.wuerfel, p.spieler.get(fuer).blatt) : null,
      zugBis: p.zugBis, ergebnis: p.ergebnis || null,
    };
  }

  function sende(code) {
    const p = partien.get(code);
    if (!p) return;
    for (const s of p.spieler.values()) {
      for (const sock of s.sockets) sock.emit("kniffel:state", sicht(p, s.key));
    }
    lobby.changed();
  }

  function beende(p, grund) {
    if (p.phase === "vorbei") return;
    p.phase = "vorbei";
    clearTimeout(p.timer);
    const liste = spielerListe(p);
    const [a, b] = liste;
    let gewinner = null;
    if (a && b) {
      const ga = gesamt(a.blatt), gb = gesamt(b.blatt);
      if (ga > gb) gewinner = a; else if (gb > ga) gewinner = b;
    } else if (a) gewinner = a;

    const auszahlung = {};
    if (gewinner) {
      const abzug = Math.floor(p.topf * RAKE);
      const preis = p.topf - abzug;
      accounts.adjustChips(gewinner.key, preis);
      accounts.recordHand(gewinner.key, preis - p.einsatz, false, "kniffel", { einsatz: p.einsatz });
      const acc = accounts.get(gewinner.key);
      if (acc) {
        acc.pvpWins = (acc.pvpWins || 0) + 1;
        acc.pvpWinsByGame = acc.pvpWinsByGame || {};
        acc.pvpWinsByGame.kniffel = (acc.pvpWinsByGame.kniffel || 0) + 1;
        accounts.save();
      }
      for (const s of liste) if (s.key !== gewinner.key) accounts.recordHand(s.key, -p.einsatz, false, "kniffel", { einsatz: p.einsatz });
      auszahlung[gewinner.key] = preis;
    } else {
      // Unentschieden: jeder bekommt seinen Einsatz zurueck, das Haus nimmt nichts.
      for (const s of liste) { accounts.adjustChips(s.key, p.einsatz); auszahlung[s.key] = p.einsatz; }
    }

    p.ergebnis = {
      grund: grund || "fertig",
      gewinner: gewinner ? gewinner.name : null,
      stand: liste.map((s) => ({ name: s.name, punkte: gesamt(s.blatt) })),
      auszahlung,
    };
    sende(p.code);
    for (const s of liste) for (const sock of s.sockets) sock.emit("account:update", { account: accounts.publicAccount(accounts.get(s.key)) });
    lobby.remove(p.code);
    setTimeout(() => partien.delete(p.code), 60_000);
  }

  /** Neuen Zug beginnen: fuenf frische Wuerfel, drei Wuerfe. */
  function neuerZug(p, key) {
    p.dran = key;
    p.wuerfel = Array.from({ length: WUERFEL }, wurf);
    p.halten = Array(WUERFEL).fill(false);
    p.wuerfeUebrig = WUERFE_PRO_ZUG - 1;
    p.zugBis = Date.now() + ZUG_MS;
    clearTimeout(p.timer);
    /*
     * Wer nicht eintraegt, blockiert sonst die ganze Partie. Nach Ablauf
     * traegt der Server in das erste freie Feld ein — meist eine Null, aber
     * das Spiel laeuft weiter, und das ist wichtiger.
     */
    p.timer = setTimeout(() => {
      const s = p.spieler.get(key);
      if (!s || p.phase !== "laeuft") return;
      const frei = FELDER.find((f) => s.blatt[f.id] == null);
      if (frei) eintragen(p, key, frei.id, true);
    }, ZUG_MS + 1000);
  }

  function naechster(p, key) {
    const keys = spielerListe(p).map((s) => s.key);
    return keys[(keys.indexOf(key) + 1) % keys.length];
  }

  function eintragen(p, key, feldId, automatisch) {
    const s = p.spieler.get(key);
    const feld = FELDER.find((f) => f.id === feldId);
    if (!s || !feld || s.blatt[feldId] != null) return false;
    s.blatt[feldId] = feld.punkte(p.wuerfel);
    if (automatisch) {
      try { chat.announce(io, `⏱️ ${s.name} war zu langsam — ${feld.label} wurde mit ${s.blatt[feldId]} eingetragen.`); } catch {}
    }
    if (spielerListe(p).every((x) => alleGesetzt(x.blatt))) { beende(p, "fertig"); return true; }
    neuerZug(p, naechster(p, key));
    sende(p.code);
    return true;
  }

  // Verwaiste Partien aufraeumen.
  setInterval(() => {
    const jetzt = Date.now();
    for (const p of partien.values()) {
      if (p.phase !== "vorbei" && jetzt - p.letzteAktion > TOT_MS) beende(p, "abgelaufen");
    }
  }, 60_000).unref();

  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    /*
     * Die eigene LAUFENDE Partie.
     *
     * Beendete bleiben absichtlich noch eine Minute liegen, damit beide das
     * Ergebnis sehen koennen. Ohne die Phasen-Pruefung galt man in dieser
     * Minute aber weiter als "schon in einer Partie" — der Knopf "Neue
     * Partie" lief dann sechzig Sekunden lang ins Leere.
     */
    function meine() {
      for (const p of partien.values()) {
        if (p.spieler.has(key()) && p.phase !== "vorbei") return p;
      }
      return null;
    }

    /** Auch die gerade beendete, fuer die Ergebnisanzeige. */
    function meineAuchBeendet() {
      for (const p of partien.values()) if (p.spieler.has(key())) return p;
      return null;
    }

    socket.on("kniffel:config", (ack) => {
      if (typeof ack === "function") ack({ ok: true, minBet: MIN_BET, maxBet: MAX_BET, rake: RAKE, felder: FELDER.map((f) => ({ id: f.id, label: f.label, hinweis: f.hinweis })) });
    });

    socket.on("kniffel:state", (ack) => {
      if (typeof ack !== "function") return;
      const p = meineAuchBeendet();
      if (!p) return ack({ ok: true, none: true, minBet: MIN_BET, maxBet: MAX_BET, felder: FELDER.map((f) => ({ id: f.id, label: f.label, hinweis: f.hinweis })) });
      const s = p.spieler.get(key());
      s.sockets.add(socket);
      ack(sicht(p, key()));
    });

    socket.on("kniffel:create", ({ bet, oeffentlich = true } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (meine()) return ack({ ok: false, error: "Du bist schon in einer Partie." });
      const einsatz = Math.floor(Number(bet));
      if (!Number.isFinite(einsatz) || einsatz < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} Chips.` });
      if (einsatz > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} Chips.` });
      const abzug = accounts.adjustChips(key(), -einsatz);
      if (!abzug.ok) return ack({ ok: false, error: abzug.error });

      const acc = accounts.get(key());
      const code = makeCode();
      const p = {
        code, phase: "warten", einsatz, topf: einsatz, oeffentlich: !!oeffentlich,
        spieler: new Map([[key(), { key: key(), name: acc.name, blatt: {}, sockets: new Set([socket]) }]]),
        dran: null, wuerfel: [], halten: [], wuerfeUebrig: 0, zugBis: 0, timer: null,
        letzteAktion: Date.now(),
      };
      partien.set(code, p);
      socket.join(code);
      if (p.oeffentlich) registriere(code);
      ack({ ...sicht(p, key()), account: abzug.account });
    });

    socket.on("kniffel:join", ({ code } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (meine()) return ack({ ok: false, error: "Du bist schon in einer Partie." });
      const p = partien.get(String(code || "").toUpperCase());
      if (!p) return ack({ ok: false, error: "Diese Partie gibt es nicht." });
      if (p.phase !== "warten") return ack({ ok: false, error: "Die Partie läuft schon." });
      if (p.spieler.size >= 2) return ack({ ok: false, error: "Schon voll." });
      const abzug = accounts.adjustChips(key(), -p.einsatz);
      if (!abzug.ok) return ack({ ok: false, error: abzug.error });

      const acc = accounts.get(key());
      p.spieler.set(key(), { key: key(), name: acc.name, blatt: {}, sockets: new Set([socket]) });
      p.topf += p.einsatz;
      socket.join(p.code);
      p.phase = "laeuft";
      p.letzteAktion = Date.now();
      neuerZug(p, spielerListe(p)[0].key);
      lobby.remove(p.code);           // voll, also aus der Liste
      sende(p.code);
      ack({ ...sicht(p, key()), account: abzug.account });
    });

    socket.on("kniffel:halten", ({ index } = {}, ack) => {
      const p = meine();
      const antwort = (r) => typeof ack === "function" && ack(r);
      if (!p || p.phase !== "laeuft" || p.dran !== key()) return antwort({ ok: false, error: "Du bist nicht dran." });
      const i = Math.floor(Number(index));
      if (!(i >= 0 && i < WUERFEL)) return antwort({ ok: false, error: "Welcher Würfel?" });
      p.halten[i] = !p.halten[i];
      p.letzteAktion = Date.now();
      sende(p.code);
      antwort(sicht(p, key()));
    });

    socket.on("kniffel:wurf", (ack) => {
      const p = meine();
      const antwort = (r) => typeof ack === "function" && ack(r);
      if (!p || p.phase !== "laeuft" || p.dran !== key()) return antwort({ ok: false, error: "Du bist nicht dran." });
      if (p.wuerfeUebrig < 1) return antwort({ ok: false, error: "Keine Würfe mehr — trag ein." });
      p.wuerfel = p.wuerfel.map((x, i) => (p.halten[i] ? x : wurf()));
      p.wuerfeUebrig -= 1;
      p.letzteAktion = Date.now();
      sende(p.code);
      antwort(sicht(p, key()));
    });

    socket.on("kniffel:eintragen", ({ feld } = {}, ack) => {
      const p = meine();
      const antwort = (r) => typeof ack === "function" && ack(r);
      if (!p || p.phase !== "laeuft" || p.dran !== key()) return antwort({ ok: false, error: "Du bist nicht dran." });
      p.letzteAktion = Date.now();
      if (!eintragen(p, key(), String(feld || ""))) return antwort({ ok: false, error: "Das Feld ist schon belegt." });
      antwort({ ok: true });
    });

    socket.on("kniffel:aufgeben", (ack) => {
      const p = meine();
      if (!p) return typeof ack === "function" && ack({ ok: false, error: "Keine Partie." });
      if (p.phase === "warten") {
        // Noch niemand da: Einsatz zurueck, Warten kostet nichts.
        accounts.adjustChips(key(), p.einsatz);
        lobby.remove(p.code);
        partien.delete(p.code);
        socket.emit("account:update", { account: accounts.publicAccount(accounts.get(key())) });
        return typeof ack === "function" && ack({ ok: true, abgebrochen: true });
      }
      // Mitten im Spiel: alle eigenen Felder auf null, damit der Gegner gewinnt.
      const s = p.spieler.get(key());
      if (s) for (const f of FELDER) if (s.blatt[f.id] == null) s.blatt[f.id] = 0;
      beende(p, "aufgegeben");
      typeof ack === "function" && ack({ ok: true });
    });

    socket.on("disconnect", () => {
      for (const p of partien.values()) {
        const s = p.spieler.get(socket.data.account);
        if (s) s.sockets.delete(socket);
      }
    });
  });

  // Damit die Lobby-Liste den Beitritt weiterreichen kann.
  return { join: (socket, code) => socket.emit("kniffel:joinRequest", { code }) };
}

module.exports = { setupKniffel, _intern: { FELDER, punkteFuer: (id, w) => FELDER.find((f) => f.id === id).punkte(w), folgeLaenge, istFull, maxGleich } };
