"use strict";

/**
 * Würfelpoker: ein Startwurf und höchstens ein Nachwurf.
 * Auszahlung und Haltehilfe werden aus derselben Tabelle berechnet. Die
 * Kalibrierung wird kombinatorisch getestet statt geschätzt.
 */

const crypto = require("crypto");

const WUERFEL = 5;
const MIN_BET = 50, MAX_BET = 50_000;
const MAX_WIN = 2_000_000;
const IDLE_SETTLE_MS = 10 * 60 * 1000;

/* Auszahlung als Vielfaches des Einsatzes. Alles, was hier nicht steht, ist
 * verloren. Bewusst keine Trostpreise: sie muessten so klein sein, dass sie
 * sich wie ein Verlust anfuehlen ("du gewinnst 0,25x"). */
const TABELLE = [
  { id: "fuenf",  label: "Fünf gleiche",   zahlt: 22 },
  { id: "grosse", label: "Große Straße",   zahlt: 2.6 },
  { id: "full",   label: "Full House",     zahlt: 2.3 },
  { id: "vier",   label: "Vier gleiche",   zahlt: 2.15 },
];
const ZAHLT = Object.fromEntries(TABELLE.map((t) => [t.id, t.zahlt]));
function auszahlung(bet, kat) { return Math.min(MAX_WIN, Math.floor(bet * Math.round((ZAHLT[kat] || 0) * 100) / 100)); }

const wurf = () => 1 + crypto.randomInt(6);

function zaehle(w) { const c = [0, 0, 0, 0, 0, 0, 0]; for (const x of w) c[x]++; return c; }

/** Laengste Folge aufeinanderfolgender Augenzahlen und ihre Werte. */
function folge(c) {
  let best = 0, werte = [];
  for (let start = 1; start <= 6; start++) {
    let l = 0;
    for (let k = start; k <= 6 && c[k]; k++) l++;
    if (l > best) { best = l; werte = Array.from({ length: l }, (_, i) => start + i); }
  }
  return { laenge: best, werte };
}

/** Kategorie der fertigen Hand. Reihenfolge = Wertigkeit von oben. */
function kategorie(w) {
  const c = zaehle(w);
  const max = Math.max(...c.slice(1));
  const paare = c.slice(1).filter((x) => x === 2).length;
  const f = folge(c);
  if (max === 5) return "fuenf";
  if (f.laenge === 5) return "grosse";
  if (max === 4) return "vier";
  if (max === 3 && paare === 1) return "full";
  if (f.laenge === 4) return "kleine";
  if (max === 3) return "drei";
  if (paare === 2) return "zweiPaar";
  if (paare === 1) return "paar";
  return "nichts";
}

const NAMEN = {
  fuenf: "Fünf gleiche", grosse: "Große Straße", vier: "Vier gleiche", full: "Full House",
  kleine: "Kleine Straße", drei: "Drei gleiche", zweiPaar: "Zwei Paare", paar: "Ein Paar", nichts: "Nichts",
};

/** Erwartete Auszahlung für festgehaltene Würfel. Jeder Nachwurf ist gleich wahrscheinlich. */
function erwartung(gehalten, bet, memo) {
  const key = gehalten.join("");
  if (memo.has(key)) return memo.get(key);
  const zahl = gehalten.reduce((summe, n) => summe + n, 0);
  let wert;
  if (zahl === WUERFEL) {
    const hand = gehalten.flatMap((n, i) => Array(n).fill(i + 1));
    wert = auszahlung(bet, kategorie(hand));
  } else {
    wert = 0;
    for (let i = 0; i < 6; i++) {
      gehalten[i]++;
      wert += erwartung(gehalten, bet, memo) / 6;
      gehalten[i]--;
    }
  }
  memo.set(key, wert);
  return wert;
}

function optimaleWahl(w, bet = 100) {
  const memo = new Map();
  let besteMaske = 0, besterWert = -1, besteAnzahl = -1;
  for (let maske = 0; maske < (1 << WUERFEL); maske++) {
    const gehalten = Array(6).fill(0);
    let anzahl = 0;
    for (let i = 0; i < WUERFEL; i++) if (maske & (1 << i)) {
      gehalten[w[i] - 1]++;
      anzahl++;
    }
    const wert = erwartung(gehalten, bet, memo);
    if (wert > besterWert + 1e-9 || (Math.abs(wert - besterWert) <= 1e-9 && anzahl > besteAnzahl)) {
      besterWert = wert; besteMaske = maske; besteAnzahl = anzahl;
    }
  }
  return { halten: w.map((_, i) => !!(besteMaske & (1 << i))), wert: besterWert };
}

function vorschlag(w, bet = 100) { return optimaleWahl(w, bet).halten; }

function setupWuerfel(io, accounts) {
  // Je Konto eine Runde, auch auf der Platte (game/offeneRunden.js): ein Neustart kostet sie nicht mehr.
  const spiele = require("./offeneRunden").karte("wuerfel");

  // Wer mitten in der Runde geht: nach fester Frist abrechnen, wie sie liegt.
  setInterval(() => {
    const jetzt = Date.now();
    for (const [key, g] of spiele) {
      if (g.over) { spiele.delete(key); continue; }
      if (jetzt - g.lastAt < IDLE_SETTLE_MS) continue;
      abrechnen(key, g);
    }
  }, 60_000).unref();

  function abrechnen(key, g) {
    const kat = kategorie(g.wuerfel);
    const payout = auszahlung(g.bet, kat);
    g.over = true; g.kategorie = kat; g.payout = payout;
    spiele.delete(key);
    if (payout > 0) accounts.adjustChips(key, payout);
    accounts.recordHand(key, payout - g.bet, true, "wuerfel", { einsatz: g.bet });
    if (payout > 0) { try { require("./records").melde(key, "wuerfel", g.bet, payout); } catch {} }
    // Fuer das Achievement "Fuenf gleiche".
    if (kat === "fuenf") {
      const acc = accounts.get(key);
      if (acc) { acc.serien = acc.serien || {}; acc.serien.wuerfelFuenf = (acc.serien.wuerfelFuenf || 0) + 1; accounts.save(); }
    }
    return { kat, payout };
  }

  io.on("connection", (socket) => {
    const konto = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function sicht(g, extra = {}) {
      const kat = kategorie(g.wuerfel);
      return {
        ok: true, bet: g.bet, wuerfel: g.wuerfel.slice(), halten: g.halten.slice(),
        wurf: g.wurf, nachwuerfe: g.nachwuerfe, over: g.over,
        kategorie: kat, kategorieName: NAMEN[kat],
        zahlt: ZAHLT[kat] || 0,
        moeglich: auszahlung(g.bet, kat),
        vorschlag: g.over ? null : vorschlag(g.wuerfel, g.bet),
        tabelle: TABELLE, maxWin: MAX_WIN,
        ...extra,
      };
    }

    socket.on("wuerfel:config", (ack) => {
      if (typeof ack === "function") ack({ ok: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN, tabelle: TABELLE, wuerfel: WUERFEL });
    });

    socket.on("wuerfel:state", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? spiele.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: true, none: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN, tabelle: TABELLE });
      g.lastAt = Date.now();
      ack(sicht(g));
    });

    socket.on("wuerfel:start", ({ bet } = {}, ack) => {
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
      // Erst der Einsatz sicher auf der Platte, dann die Runde: so druckt kein Neustart Chips.
      try { accounts.saveJetzt(); } catch {}

      const g = {
        bet: einsatz, wuerfel: Array.from({ length: WUERFEL }, wurf),
        halten: Array(WUERFEL).fill(false), wurf: 1, nachwuerfe: 1,
        over: false, lastAt: Date.now(),
      };
      spiele.set(key, g);
      ack(sicht(g, { account: abzug.account }));
    });

    // Halten/Freigeben eines Wuerfels. Reine Anzeige-Entscheidung, aber sie
    // liegt trotzdem auf dem Server: sonst koennte der Client beim Nachwurf
    // behaupten, er habe etwas anderes gehalten.
    socket.on("wuerfel:halten", ({ index } = {}, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? spiele.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Keine Runde offen." });
      const i = Math.floor(Number(index));
      if (!(i >= 0 && i < WUERFEL)) return ack({ ok: false, error: "Welcher Würfel?" });
      g.halten[i] = !g.halten[i];
      g.lastAt = Date.now();
      spiele.merke(socket.data.account);
      ack(sicht(g));
    });

    socket.on("wuerfel:nachwurf", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const g = key ? spiele.get(key) : null;
      if (!g || g.over) return ack({ ok: false, error: "Keine Runde offen." });
      if (g.nachwuerfe < 1) return ack({ ok: false, error: "Kein Nachwurf mehr." });
      g.lastAt = Date.now();
      const vorher = g.wuerfel.slice();
      g.wuerfel = g.wuerfel.map((x, i) => (g.halten[i] ? x : wurf()));
      g.nachwuerfe -= 1;
      g.wurf += 1;
      // Nach dem Nachwurf ist die Runde entschieden.
      const { kat, payout } = abrechnen(key, g);
      ack({
        ...sicht(g, { vorher }),
        over: true, ergebnis: kat, ergebnisName: NAMEN[kat], payout,
        account: accounts.publicAccount(accounts.get(key)),
      });
    });

    // Sofort stehen bleiben: die Hand aus dem ersten Wurf zaehlt.
    socket.on("wuerfel:stehen", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const g = key ? spiele.get(key) : null;
      if (!g || g.over) return ack({ ok: false, error: "Keine Runde offen." });
      const { kat, payout } = abrechnen(key, g);
      ack({
        ...sicht(g), over: true, ergebnis: kat, ergebnisName: NAMEN[kat], payout,
        account: accounts.publicAccount(accounts.get(key)),
      });
    });
  });
}

module.exports = { setupWuerfel, _intern: { kategorie, vorschlag, optimaleWahl, auszahlung, TABELLE, ZAHLT, NAMEN, MIN_BET, MAX_BET, MAX_WIN } };
