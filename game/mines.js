"use strict";

/**
 * Mines — single-player, server-authoritative.
 *
 * A 5×5 grid hides `mines` bombs. Reveal safe tiles one by one; each one raises
 * your multiplier. Hit a bomb and you lose the bet. Cash out any time (after ≥1
 * safe tile) to bank bet × current multiplier.
 *
 * Fair multiplier after k safe reveals on n tiles with m mines:
 *   mult(k) = (1 − edge) · Π_{i=0..k-1} (n − i) / (n − m − i)
 * so cashing out is worth exactly (1 − edge) in EV → house edge = HOUSE_EDGE.
 *
 * Mine positions are decided at start (crypto RNG) and never sent to the client
 * until the game ends.
 */

const crypto = require("crypto");

const TILES = 25;
const HOUSE_EDGE = 0.02; // 98% RTP
/* Die Obergrenze stand seit dem ersten Tag bei 10.000, was zu wenig war. Ich
 * hatte sie daraufhin auf 250.000 gesetzt — nach den Testdaten auf meinem
 * Rechner, in denen Konten mit Milliarden herumliegen. Der echte Spielstand
 * sieht voellig anders aus: 8,6 Millionen Chips insgesamt, mittleres Guthaben
 * 25.000, groesstes 1,7 Millionen. 250.000 waeren also das Zehnfache dessen
 * gewesen, was ein durchschnittlicher Spieler ueberhaupt besitzt.
 *
 * 50.000 ist der Kompromiss: das Doppelte des mittleren Guthabens, drei
 * Prozent vom groessten Konto. Der Hausvorteil bleibt bei 2 %. */
const MIN_BET = 50, MAX_BET = 50_000;

/* Deckel je Runde.
 *
 * Der hoehere Einsatz hat ein Problem sichtbar gemacht, das vorher schon da
 * war: bei 15 Minen zahlt das Leerraeumen aller zehn sicheren Felder rund
 * 3,2 Millionen mal den Einsatz. Mit 50.000 waeren das 160 Milliarden Chips
 * — ein einziger Treffer wuerde die ganze Wirtschaft erledigen. Die Chance
 * liegt bei etwa 1 zu 3,3 Millionen, das passiert also praktisch nie; aber
 * "praktisch nie" mal "zerstoert alles" ist trotzdem ein schlechtes Geschaeft.
 *
 * Deshalb ein Deckel auf die Auszahlung statt eines kleinen Einsatzlimits.
 * Er greift ausschliesslich in Zweigen, die ohnehin niemand erreicht, und
 * steht sichtbar in der Oberflaeche, damit niemand ueberrascht wird.
 *
 * Die Hoehe ist an der echten Wirtschaft gemessen: 8,6 Millionen Chips sind
 * insgesamt im Umlauf, der groesste je erzielte Einzelgewinn lag bei einer
 * Million. Zwei Millionen aus einer Runde sind damit die legendaerste Runde
 * der Casino-Geschichte und trotzdem nichts, was alles umwirft. */
const MAX_WIN = 2_000_000;

function multiplier(mines, safe) {
  if (safe <= 0) return 1;
  let p = 1;
  for (let i = 0; i < safe; i++) p *= (TILES - i) / (TILES - mines - i);
  return Math.max(1, Math.floor(p * (1 - HOUSE_EDGE) * 100) / 100);
}

/**
 * Was die naechsten Schritte bringen wuerden — fuer die Vorschau, bevor
 * ueberhaupt ein Einsatz steht.
 *
 * Bisher tippte man eine Minenzahl ein, ohne zu wissen, was sie zahlt. Zwei
 * Minen und zwanzig Minen sahen im Formular gleich aus.
 */
function paytable(mines) {
  const stufen = [1, 2, 3, 5, 10];
  const max = TILES - mines;
  return stufen.filter((k) => k <= max).map((k) => ({ safe: k, mult: multiplier(mines, k) }));
}

function pickMines(m) {
  const idx = [...Array(TILES).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, m));
}

// Shadowban ("Pechvogel"): outcomes are decided per reveal, ignoring the real
// mine layout — the player hits bombs far more often, may uncover 1–2 diamonds
// (the tease), but never more than 2 before a guaranteed bomb.
const SHADOW_BOMB_CHANCE = 65; // % chance each reveal is a bomb (≈5× häufiger als normal)
const SHADOW_MAX_GEMS = 2;      // hard cap: never more than 2 diamonds before a bomb
/** Build a believable bomb layout for a shadowban bust (clicked tile + fill). */
function fakeMineSet(g, tile) {
  const set = new Set([tile]);
  const free = [...Array(TILES).keys()].filter((i) => i !== tile && !g.revealed.includes(i));
  for (let i = free.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [free[i], free[j]] = [free[j], free[i]]; }
  for (const t of free) { if (set.size >= g.mines) break; set.add(t); }
  return [...set];
}

const IDLE_SETTLE_MS = 30 * 60_000; // verlassene Spiele nach 30 Min auto-abrechnen

function setupMines(io, accounts) {
  // Spiele am ACCOUNT statt am Socket — Reload/Abriss kostet keinen Einsatz
  // mehr; der Client nimmt das laufende Spiel per mines:state wieder auf.
  const games = new Map(); // accountKey → game

  // Verlassene Spiele: ≥1 Feld aufgedeckt → Auto-Cashout, sonst Einsatz zurück.
  setInterval(() => {
    const now = Date.now();
    for (const [key, g] of games) {
      if (g.over) { games.delete(key); continue; }
      if (now - g.lastAt < IDLE_SETTLE_MS) continue;
      g.over = true;
      games.delete(key);
      if (g.revealed.length > 0) {
        const payout = Math.floor(g.bet * multiplier(g.mines, g.revealed.length));
        accounts.adjustChips(key, payout);
        accounts.recordHand(key, payout - g.bet, true, "mines", { einsatz: g.bet });
      } else {
        accounts.adjustChips(key, g.bet);
      }
    }
  }, 60_000).unref();

  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function view(g, extra = {}) {
      const safe = g.revealed.length;
      return {
        ok: true, bet: g.bet, mines: g.mines,
        revealed: g.revealed, over: g.over,
        multiplier: multiplier(g.mines, safe),
        nextMultiplier: g.over ? null : multiplier(g.mines, safe + 1),
        cashout: safe > 0 ? Math.min(MAX_WIN, Math.floor(g.bet * multiplier(g.mines, safe))) : 0,
        paytable: paytable(g.mines), maxWin: MAX_WIN,
        ...extra,
      };
    }

    // Grenzen und Auszahlungen kommen vom Server: fest ins HTML getippt
    // laufen sie auseinander, sobald hier eine Zahl geaendert wird.
    socket.on("mines:config", ({ mines } = {}, ack) => {
      if (typeof ack !== "function") return;
      const m = Math.min(24, Math.max(1, Math.floor(Number(mines)) || 3));
      ack({ ok: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN, tiles: TILES, mines: m, paytable: paytable(m) });
    });

    // Laufendes Spiel nach Reload/Reconnect wieder aufnehmen.
    socket.on("mines:state", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: true, none: true, minBet: MIN_BET, maxBet: MAX_BET });
      g.lastAt = Date.now();
      ack(view(g));
    });

    socket.on("mines:start", ({ bet, mines } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = acct();
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      const running = games.get(socket.data.account);
      if (running && !running.over) return ack({ ok: false, error: "Beende erst dein laufendes Spiel." });
      bet = Math.floor(Number(bet));
      mines = Math.floor(Number(mines));
      if (!Number.isFinite(bet) || bet < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} Chips.` });
      if (bet > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} Chips.` });
      if (!Number.isFinite(mines) || mines < 1 || mines > 24) return ack({ ok: false, error: "1–24 Minen." });
      if (a.chips < bet) return ack({ ok: false, error: "Nicht genug Chips." });
      const res = accounts.adjustChips(socket.data.account, -bet);
      if (!res.ok) return ack({ ok: false, error: res.error });
      const g = { bet, mines, mineSet: pickMines(mines), revealed: [], over: false, lastAt: Date.now() };
      games.set(socket.data.account, g);
      ack({ ...view(g), account: res.account });
    });

    /**
     * Ein Feld aufdecken. Steht als eigene Funktion da, weil es zwei Wege
     * hierher gibt: der Tipp auf eine Kachel und der Zufalls-Knopf. Zwei
     * Kopien derselben Regel waeren genau die Sorte Fehler, bei der eine
     * Variante irgendwann anders auszahlt als die andere.
     */
    function doReveal(g, tile, ack) {
      g.lastAt = Date.now();
      tile = Math.floor(Number(tile));
      if (!Number.isFinite(tile) || tile < 0 || tile >= TILES) return ack({ ok: false, error: "Ungültiges Feld." });
      if (g.revealed.includes(tile)) return ack({ ok: false, error: "Schon aufgedeckt." });

      // Pechvogel: bomb far more often + hard cap of 2 uncovered diamonds.
      const shadow = accounts.isShadowbanned(socket.data.account);
      const hitBomb = shadow
        ? (g.revealed.length >= SHADOW_MAX_GEMS || crypto.randomInt(100) < SHADOW_BOMB_CHANCE)
        : g.mineSet.has(tile);

      if (hitBomb) {
        g.over = true;
        accounts.recordHand(socket.data.account, -g.bet, true, "mines");
        const mineSet = shadow ? fakeMineSet(g, tile) : [...g.mineSet];
        return ack({ ...view(g, { bust: true, tile, mineSet }) });
      }
      g.revealed.push(tile);
      // Cleared the whole board → auto cash-out at the max multiplier.
      if (g.revealed.length >= TILES - g.mines) {
        const payout = Math.min(MAX_WIN, Math.floor(g.bet * multiplier(g.mines, g.revealed.length)));
        g.over = true;
        const r = accounts.adjustChips(socket.data.account, payout);
        accounts.recordHand(socket.data.account, payout - g.bet, true, "mines", { einsatz: g.bet });
        return ack({ ...view(g, { tile, cleared: true, payout, mineSet: [...g.mineSet] }), account: r.account });
      }
      ack({ ...view(g, { tile }) });
    }

    socket.on("mines:reveal", ({ tile } = {}, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      doReveal(g, tile, ack);
    });

    // Ein zufaelliges noch verdecktes Feld aufdecken. Auf dem iPad trifft man
    // die kleinen Kacheln schlecht, und beim Aufdecken gibt es ohnehin nichts
    // zu koennen — jedes verdeckte Feld ist gleich wahrscheinlich.
    socket.on("mines:revealRandom", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      const frei = [];
      for (let i = 0; i < TILES; i++) if (!g.revealed.includes(i)) frei.push(i);
      if (!frei.length) return ack({ ok: false, error: "Nichts mehr übrig." });
      const tile = frei[crypto.randomInt(frei.length)];
      doReveal(g, tile, ack);
    });

    socket.on("mines:cashout", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      if (!g.revealed.length) return ack({ ok: false, error: "Erst mind. ein Feld aufdecken." });
      const mult = multiplier(g.mines, g.revealed.length);
      const payout = Math.min(MAX_WIN, Math.floor(g.bet * mult));
      g.over = true;
      const r = accounts.adjustChips(socket.data.account, payout);
      accounts.recordHand(socket.data.account, payout - g.bet, true, "mines", { einsatz: g.bet });
      ack({ ...view(g, { cashedOut: true, payout, mult, mineSet: [...g.mineSet] }), account: r.account });
    });
  });
}

module.exports = { setupMines };
