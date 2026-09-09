"use strict";

/**
 * Higher/Lower — Einzelspieler, serverseitig entschieden.
 *
 * Eine Karte liegt offen. Ist die naechste hoeher oder tiefer? Jeder Treffer
 * multipliziert, aussteigen geht jederzeit. Danebengelegen kostet den Einsatz.
 *
 * Die Multiplikatoren sind KEINE Tabelle, sondern werden aus dem echten
 * Restdeck gerechnet:
 *
 *   Schritt = (hoeher + tiefer) / richtige Seite · (1 − HOUSE_EDGE)
 *
 * Damit ist jeder einzelne Schritt exakt fair bis auf den Hausvorteil, egal
 * wie das Deck gerade aussieht. Bei einem Koenig kostet "hoeher" fast nichts
 * und bringt viel, bei einer Sieben ist beides fast gleich. Das ist der Reiz:
 * man sieht der Karte an, was sie wert ist.
 *
 * Gleicher Rang ist ein PUSH: die Karte wandert weg, der Multiplikator bleibt.
 * Deshalb steht im Zaehler (hoeher + tiefer) und nicht 51 — Gleichstaende sind
 * aus der Rechnung raus, weil sie weder gewinnen noch verlieren.
 *
 * Das Deck wird beim Start gemischt (crypto) und liegt NUR auf dem Server.
 */

const crypto = require("crypto");

const HOUSE_EDGE = 0.02;                 // 98 % je Schritt
const MIN_BET = 50, MAX_BET = 50_000;    // wie Mines/Towers, am echten Spielstand gemessen
/*
 * Deckel je Runde, gleiche Begruendung wie bei Mines und Towers: die Kette
 * kann theoretisch sehr weit laufen (jeder Schritt multipliziert), und ein
 * einziger Extremfall wuerde die Wirtschaft umwerfen. Der Deckel steht
 * sichtbar in der Oberflaeche.
 */
const MAX_WIN = 2_000_000;
const IDLE_SETTLE_MS = 10 * 60 * 1000;   // verlassene Runde: automatisch auszahlen

const RANK_NAMEN = { 11: "B", 12: "D", 13: "K", 14: "A" };
const FARBEN = ["♠", "♥", "♦", "♣"];

/** Frisches, gemischtes 52er-Deck (Fisher-Yates mit crypto). */
function neuesDeck() {
  const d = [];
  for (let f = 0; f < 4; f++) for (let r = 2; r <= 14; r++) d.push({ r, f });
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const kartenText = (k) => (RANK_NAMEN[k.r] || String(k.r)) + FARBEN[k.f];

/** Wie viele Karten im Restdeck sind hoeher, tiefer, gleich? */
function verteilung(deck, karte) {
  let hoch = 0, tief = 0, gleich = 0;
  for (const k of deck) {
    if (k.r > karte.r) hoch++;
    else if (k.r < karte.r) tief++;
    else gleich++;
  }
  return { hoch, tief, gleich };
}

/**
 * Fairer Schrittmultiplikator, oder null wenn die Richtung unmoeglich ist
 * (bei einem Ass kann nichts hoeher sein).
 */
function schritt(deck, karte, richtung) {
  const { hoch, tief } = verteilung(deck, karte);
  const gut = richtung === "hoch" ? hoch : tief;
  if (!gut) return null;
  const fair = ((hoch + tief) / gut) * (1 - HOUSE_EDGE);
  /*
   * Nie unter 1.
   *
   * Bei einer Zwei kann keine Karte tiefer sein: "hoeher" ist damit
   * risikolos, und der rechnerisch faire Faktor waere 0,98 — der
   * Hausvorteil auf eine Wette, die man gar nicht verlieren kann. Im Spiel
   * sah das so aus: richtig getippt, und der Multiplikator FIEL von 1,06
   * auf 1,04. Das ist zwar korrekt gerechnet, aber niemand akzeptiert es,
   * und zu Recht.
   *
   * Unter 1 faellt der Wert ausschliesslich dann, wenn eine Seite gar nicht
   * vorkommt (sonst waere der Anteil der Gewinnseite ueber 98 %, was bei 48
   * entschiedenen Karten nur bei 48 zu 0 geht). Die Untergrenze verschenkt
   * also nichts: sie betrifft nur Wetten, die ohnehin nicht verlieren
   * koennen, und macht sie zu einem Nullsummen-Schritt statt zu einer Strafe.
   */
  return Math.max(1, Math.floor(fair * 100) / 100);
}

function setupHilo(io, accounts) {
  // Am ACCOUNT statt am Socket: ein Neuladen darf keine Runde kosten.
  const spiele = new Map();

  /** Verlassene Runden abrechnen, damit kein Einsatz haengen bleibt. */
  setInterval(() => {
    const jetzt = Date.now();
    for (const [key, g] of spiele) {
      if (g.over) { spiele.delete(key); continue; }
      if (jetzt - g.lastAt < IDLE_SETTLE_MS) continue;
      g.over = true;
      spiele.delete(key);
      if (g.treffer > 0) {
        const payout = Math.min(MAX_WIN, Math.floor(g.bet * g.mult));
        accounts.adjustChips(key, payout);
        accounts.recordHand(key, payout - g.bet, true, "hilo", { einsatz: g.bet });
      } else {
        accounts.adjustChips(key, g.bet); // noch nichts geraten → Einsatz zurück
      }
    }
  }, 60_000).unref();

  io.on("connection", (socket) => {
    const konto = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function sicht(g, extra = {}) {
      const v = verteilung(g.deck, g.karte);
      const auszahlung = g.treffer > 0 ? Math.min(MAX_WIN, Math.floor(g.bet * g.mult)) : 0;
      return {
        ok: true,
        bet: g.bet,
        karte: { ...g.karte, text: kartenText(g.karte) },
        mult: Math.round(g.mult * 100) / 100,
        treffer: g.treffer,
        rest: g.deck.length,
        // Was die naechste Entscheidung wert waere — der Client zeigt es auf
        // den Knoepfen, damit man vor dem Tippen weiss, worauf man sich einlaesst.
        hoch: schritt(g.deck, g.karte, "hoch"),
        tief: schritt(g.deck, g.karte, "tief"),
        chancen: v,
        cashout: auszahlung,
        gedeckelt: g.treffer > 0 && Math.floor(g.bet * g.mult) > MAX_WIN,
        over: g.over,
        maxWin: MAX_WIN,
        ...extra,
      };
    }

    socket.on("hilo:config", (ack) => {
      if (typeof ack === "function") ack({ ok: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN, edge: HOUSE_EDGE });
    });

    // Laufende Runde nach Neuladen wieder aufnehmen.
    socket.on("hilo:state", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? spiele.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: true, none: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN });
      g.lastAt = Date.now();
      ack(sicht(g));
    });

    socket.on("hilo:start", ({ bet } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = konto();
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      if (spiele.has(key) && !spiele.get(key).over) return ack({ ok: false, error: "Du hast noch eine Runde offen." });

      const einsatz = Math.floor(Number(bet));
      if (!Number.isFinite(einsatz) || einsatz < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} Chips.` });
      if (einsatz > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} Chips.` });
      if (a.chips < einsatz) return ack({ ok: false, error: "Nicht genug Chips." });

      const abzug = accounts.adjustChips(key, -einsatz);
      if (!abzug.ok) return ack({ ok: false, error: abzug.error });

      const deck = neuesDeck();
      const g = { deck, karte: deck.pop(), bet: einsatz, mult: 1, treffer: 0, over: false, lastAt: Date.now() };
      spiele.set(key, g);
      ack(sicht(g, { account: abzug.account }));
    });

    socket.on("hilo:tipp", ({ richtung } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const g = key ? spiele.get(key) : null;
      if (!g || g.over) return ack({ ok: false, error: "Keine Runde offen." });
      if (richtung !== "hoch" && richtung !== "tief") return ack({ ok: false, error: "Höher oder tiefer?" });
      g.lastAt = Date.now();

      const s = schritt(g.deck, g.karte, richtung);
      if (s == null) return ack({ ok: false, error: "In diese Richtung geht nichts mehr." });

      const neu = g.deck.pop();
      const alt = g.karte;
      g.karte = neu;

      // Gleicher Rang: Push. Karte weg, Multiplikator bleibt, weiter geht's.
      if (neu.r === alt.r) {
        return ack(sicht(g, { ergebnis: "push", alt: { ...alt, text: kartenText(alt) } }));
      }

      const richtig = richtung === "hoch" ? neu.r > alt.r : neu.r < alt.r;
      if (!richtig) {
        g.over = true;
        spiele.delete(key);
        accounts.recordHand(key, -g.bet, true, "hilo", { einsatz: g.bet });
        return ack(sicht(g, {
          ergebnis: "verloren", alt: { ...alt, text: kartenText(alt) },
          account: accounts.publicAccount(accounts.get(key)),
        }));
      }

      g.mult = Math.round(g.mult * s * 100) / 100;
      g.treffer += 1;

      // Deck leer oder Deckel erreicht: von selbst auszahlen statt ins Leere laufen.
      const amDeckel = Math.floor(g.bet * g.mult) >= MAX_WIN;
      if (!g.deck.length || amDeckel) {
        const payout = Math.min(MAX_WIN, Math.floor(g.bet * g.mult));
        g.over = true;
        spiele.delete(key);
        accounts.adjustChips(key, payout);
        accounts.recordHand(key, payout - g.bet, true, "hilo", { einsatz: g.bet });
        try { require("./records").melde(key, "hilo", g.bet, payout); } catch {}
        return ack(sicht(g, {
          ergebnis: "auto", grund: amDeckel ? "deckel" : "deckLeer", payout, schrittMult: s,
          alt: { ...alt, text: kartenText(alt) },
          account: accounts.publicAccount(accounts.get(key)),
        }));
      }

      ack(sicht(g, { ergebnis: "treffer", schrittMult: s, alt: { ...alt, text: kartenText(alt) } }));
    });

    socket.on("hilo:cashout", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const g = key ? spiele.get(key) : null;
      if (!g || g.over) return ack({ ok: false, error: "Keine Runde offen." });
      if (g.treffer < 1) return ack({ ok: false, error: "Erst einmal richtig tippen." });

      const payout = Math.min(MAX_WIN, Math.floor(g.bet * g.mult));
      g.over = true;
      spiele.delete(key);
      accounts.adjustChips(key, payout);
      accounts.recordHand(key, payout - g.bet, true, "hilo", { einsatz: g.bet });
      try { require("./records").melde(key, "hilo", g.bet, payout); } catch {}
      ack({ ok: true, payout, mult: g.mult, treffer: g.treffer, account: accounts.publicAccount(accounts.get(key)) });
    });
  });
}

module.exports = { setupHilo, _intern: { neuesDeck, schritt, verteilung, MIN_BET, MAX_BET, MAX_WIN, HOUSE_EDGE } };
