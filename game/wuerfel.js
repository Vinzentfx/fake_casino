"use strict";

/**
 * Wuerfelpoker — Einzelspieler, serverseitig entschieden.
 *
 * Fuenf Wuerfel, ein Wurf, dann darfst du beliebige Wuerfel behalten und den
 * Rest EINMAL neu werfen. Was am Ende liegt, zahlt nach fester Tabelle.
 *
 * Warum nur ein Nachwurf, und warum diese Tabelle:
 *
 * Mit zwei Nachwuerfen liegt praktisch jede Runde bei "drei gleiche oder
 * besser" — simuliert kamen "vier gleiche" in 21 % der Runden. Eine Tabelle,
 * die darauf noch etwas auszahlt, muesste so klein sein, dass vier gleiche
 * das 1,25-fache bringen. Das fuehlt sich falsch an. Mit einem Nachwurf sind
 * die Haende selten genug fuer Auszahlungen, die sich lohnen.
 *
 * Die Tabelle folgt der ECHTEN Seltenheit in diesem Spiel, nicht dem
 * Poker-Rang. Wer Wuerfel halten darf, kommt viel leichter an eine Strasse
 * als die Poker-Rangfolge vermuten laesst: gezielt gespielt faellt die grosse
 * Strasse in 8 % der Runden, vier gleiche in 12 %. Deshalb liegen sie hier
 * dicht beieinander. Die Chancen stehen in der Oberflaeche, damit niemand
 * nach Poker-Gefuehl rechnet und sich getaeuscht fuehlt.
 *
 * Kalibriert per Simulation (250.000 Runden je Strategie) gegen drei
 * Spielweisen — Gruppen jagen, Strassen jagen, gemischt. Die beste kommt auf
 * 96,7 %, naives Spiel auf rund 86 %. Dass gutes Spiel mehr bringt, ist
 * Absicht; damit der Abstand nicht an fehlender Information liegt, schlaegt
 * die Oberflaeche vor, welche Wuerfel sich zu halten lohnen.
 */

const crypto = require("crypto");

const WUERFEL = 5;
const MIN_BET = 50, MAX_BET = 50_000;
const MAX_WIN = 2_000_000;
const IDLE_SETTLE_MS = 10 * 60 * 1000;

/* Auszahlung als Vielfaches des Einsatzes. Alles, was hier nicht steht, ist
 * verloren — bewusst keine Trostpreise: sie muessten so klein sein, dass sie
 * sich wie ein Verlust anfuehlen ("du gewinnst 0,25x"). */
const TABELLE = [
  { id: "fuenf",  label: "Fünf gleiche",   zahlt: 25,  chance: "1 zu 77" },
  { id: "grosse", label: "Große Straße",   zahlt: 3,   chance: "1 zu 13" },
  { id: "full",   label: "Full House",     zahlt: 2.5, chance: "1 zu 11" },
  { id: "vier",   label: "Vier gleiche",   zahlt: 2.5, chance: "1 zu 8" },
];
const ZAHLT = Object.fromEntries(TABELLE.map((t) => [t.id, t.zahlt]));

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

/**
 * Welche Wuerfel wuerde ein vernuenftiger Spieler halten?
 *
 * Nur ein Vorschlag fuer die Oberflaeche, niemand muss ihm folgen. Er
 * existiert, damit der Abstand zwischen gutem und naivem Spiel nicht daran
 * haengt, ob jemand die Wahrscheinlichkeiten im Kopf hat.
 */
function vorschlag(w) {
  const c = zaehle(w);
  let beste = 0, augen = 0;
  for (let f = 1; f <= 6; f++) if (c[f] > beste) { beste = c[f]; augen = f; }
  const f = folge(c);
  // Vier zu einer Strasse schlaegt ein blosses Paar.
  if (f.laenge >= 4 && beste < 3) {
    const gesucht = new Set(f.werte), schon = new Set();
    return w.map((x) => { if (gesucht.has(x) && !schon.has(x)) { schon.add(x); return true; } return false; });
  }
  if (beste >= 2) return w.map((x) => x === augen);
  return w.map(() => false);
}

function setupWuerfel(io, accounts) {
  const spiele = new Map();

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
    const payout = Math.min(MAX_WIN, Math.floor(g.bet * (ZAHLT[kat] || 0)));
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
        moeglich: Math.min(MAX_WIN, Math.floor(g.bet * (ZAHLT[kat] || 0))),
        vorschlag: g.over ? null : vorschlag(g.wuerfel),
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

module.exports = { setupWuerfel, _intern: { kategorie, vorschlag, TABELLE, ZAHLT, NAMEN, MIN_BET, MAX_BET, MAX_WIN } };
