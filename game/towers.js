"use strict";

/**
 * Towers (wie Dragon Tower), allein gegen das Haus, entschieden auf dem Server.
 *
 * Ein Turm mit 9 Ebenen. Auf jeder wählt man ein Feld aus einer Reihe, manche
 * sind sicher (Eier), eins oder mehr sind Fallen (Totenköpfe). Sicheres Feld:
 * eine Ebene höher, der Multiplikator steigt. Falle: Einsatz weg. Auszahlen
 * geht jederzeit ab dem ersten richtigen Feld, dann gibt es Einsatz × Multiplikator.
 *
 * Fünf Schwierigkeiten ändern die Breite der Reihe und wie viele Felder sicher sind:
 *   Leicht    4 Felder, 3 sicher (75 %)   Mittel   3 Felder, 2 sicher (67 %)
 *   Schwer    2 Felder, 1 sicher (50 %)   Experte  3 Felder, 1 sicher (33 %)
 *   Meister   4 Felder, 1 sicher (25 %)
 *
 * Fairer Multiplikator nach L Ebenen: (1 − edge) · (Breite/sicher)^L, jede
 * Auszahl-Ebene ist im Erwartungswert also (1 − edge) wert. Das entspricht genau
 * Dragon Tower bei Stake (z. B. Meister Ebene 9 = 256 901,12×). Wo die Fallen
 * liegen, wird beim Start mit crypto-Zufall ausgewürfelt und geht erst am Ende
 * an den Client.
 */

const crypto = require("crypto");

const ROWS = 9;
const HOUSE_EDGE = 0.02; // 98% RTP
/* Gleicher Grund und dieselbe Korrektur wie in Mines: 250.000 stammten aus
 * meinen Testdaten, nicht aus dem echten Spielstand. Dort sind 8,6 Millionen
 * Chips im Umlauf und das mittlere Guthaben liegt bei 25.000. */
const MIN_BET = 50, MAX_BET = 50_000;

const DIFFICULTIES = {
  easy:   { label: "Einfach", width: 4, safe: 3 },
  medium: { label: "Mittel",  width: 3, safe: 2 },
  hard:   { label: "Schwer",  width: 2, safe: 1 },
  expert: { label: "Experte", width: 3, safe: 1 },
  master: { label: "Meister", width: 4, safe: 1 },
};

/* Deckel je Runde.
 *
 * Der hoehere Einsatz hat ein Problem sichtbar gemacht, das vorher schon da
 * war: der Meister-Turm auf Ebene 9 zahlt rund
 * 256.901 mal den Einsatz. Mit 250.000 waeren das 64 Milliarden Chips,
 * und ein einziger Treffer wuerde die ganze Wirtschaft erledigen. Die Chance
 * liegt bei etwa 1 zu 262.000, das passiert also praktisch nie; aber
 * "praktisch nie" mal "zerstoert alles" ist trotzdem ein schlechtes Geschaeft.
 *
 * Deshalb ein Deckel auf die Auszahlung statt eines kleinen Einsatzlimits.
 * Er greift ausschliesslich in Zweigen, die ohnehin niemand erreicht, und
 * steht sichtbar in der Oberflaeche, damit niemand ueberrascht wird. */
const MAX_WIN = 2_000_000;

/** Auszahlfaktor nach `level` Ebenen (0 = noch nicht angefangen, also 1×). */
function multiplier(diff, level) {
  if (level <= 0) return 1;
  const step = diff.width / diff.safe;
  return Math.max(1, Math.floor(Math.pow(step, level) * (1 - HOUSE_EDGE) * 100) / 100);
}

/** Die ganze Leiter für die Gewinntabelle im Client (Ebenen 1..ROWS). */
function ladder(diff) {
  const out = [];
  for (let l = 1; l <= ROWS; l++) out.push(multiplier(diff, l));
  return out;
}

/** Fallen für jede Reihe auswürfeln (je Reihe Breite − sicher Fallen). */
function rollTraps(diff) {
  const traps = [];
  const bad = diff.width - diff.safe;
  for (let r = 0; r < ROWS; r++) {
    const idx = [...Array(diff.width).keys()];
    for (let i = idx.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    traps.push(new Set(idx.slice(0, bad)));
  }
  return traps;
}

const IDLE_SETTLE_MS = 30 * 60_000; // verlassene Spiele nach 30 Min auto-abrechnen

function setupTowers(io, accounts) {
  // Spiele hängen am Account, nicht am Socket: Tab-Reload/Verbindungsabriss
  // mitten im Lauf kostet nicht mehr Einsatz + aufgelaufenen Multiplikator,
  // der Client holt das laufende Spiel per towers:state zurück.
  const games = new Map(); // Kontoschlüssel -> Spiel

  // Verlassene Spiele (30 Min ohne Aktion): Ebene ≥1 → Auto-Cashout zum
  // aktuellen Multiplikator, Ebene 0 → Einsatz zurück. Kein Vorteil erzielbar
  // (Cashout-EV ist immer 1−Hausvorteil).
  setInterval(() => {
    const now = Date.now();
    for (const [key, g] of games) {
      if (g.over) { games.delete(key); continue; }
      if (now - g.lastAt < IDLE_SETTLE_MS) continue;
      g.over = true;
      games.delete(key);
      const diff = DIFFICULTIES[g.diffKey];
      if (g.level > 0) {
        const payout = Math.floor(g.bet * multiplier(diff, g.level));
        accounts.adjustChips(key, payout);
        accounts.recordHand(key, payout - g.bet, true, "towers", { einsatz: g.bet });
      } else {
        accounts.adjustChips(key, g.bet); // nichts aufgedeckt → einfach zurück
      }
    }
  }, 60_000).unref();

  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function view(g, extra = {}) {
      const diff = DIFFICULTIES[g.diffKey];
      return {
        ok: true,
        bet: g.bet,
        difficulty: g.diffKey,
        width: diff.width,
        safe: diff.safe,
        rows: ROWS,
        level: g.level,                              // climbed rows so far
        picks: g.picks,                              // gewähltes Feld je Ebene
        over: g.over,
        multiplier: multiplier(diff, g.level),
        nextMultiplier: g.over || g.level >= ROWS ? null : multiplier(diff, g.level + 1),
        cashout: g.level > 0 ? Math.min(MAX_WIN, Math.floor(g.bet * multiplier(diff, g.level))) : 0,
        ladder: ladder(diff), maxWin: MAX_WIN,
        ...extra,
      };
    }

    // Laufendes Spiel nach Reload/Reconnect wieder aufnehmen.
    socket.on("towers:state", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: true, none: true, minBet: MIN_BET, maxBet: MAX_BET, maxWin: MAX_WIN });
      g.lastAt = Date.now();
      ack({ ...view(g), minBet: MIN_BET, maxBet: MAX_BET });
    });

    socket.on("towers:start", ({ bet, difficulty } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = acct();
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      const running = games.get(socket.data.account);
      if (running && !running.over) return ack({ ok: false, error: "Beende erst dein laufendes Spiel." });
      const diffKey = String(difficulty || "easy").toLowerCase();
      const diff = DIFFICULTIES[diffKey];
      if (!diff) return ack({ ok: false, error: "Unbekannte Schwierigkeit." });
      bet = Math.floor(Number(bet));
      if (!Number.isFinite(bet) || bet < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} Chips.` });
      if (bet > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} Chips.` });
      if (a.chips < bet) return ack({ ok: false, error: "Nicht genug Chips." });
      const res = accounts.adjustChips(socket.data.account, -bet);
      if (!res.ok) return ack({ ok: false, error: res.error });
      const g = { bet, diffKey, traps: rollTraps(diff), level: 0, picks: [], over: false, lastAt: Date.now() };
      games.set(socket.data.account, g);
      ack({ ...view(g), account: res.account });
    });

    socket.on("towers:pick", ({ tile } = {}, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      g.lastAt = Date.now();
      const diff = DIFFICULTIES[g.diffKey];
      tile = Math.floor(Number(tile));
      if (!Number.isFinite(tile) || tile < 0 || tile >= diff.width) return ack({ ok: false, error: "Ungültige Kachel." });
      if (g.level >= ROWS) return ack({ ok: false, error: "Turm bereits erklommen." });

      // Pechvogel (Shadowban): jeder Zug ist eine Falle, egal wo geklickt wird.
      const shadow = accounts.pechTrifft(socket.data.account);
      const hitTrap = shadow ? true : g.traps[g.level].has(tile);

      if (hitTrap) {
        g.over = true;
        g.bustRow = g.level;
        g.bustTile = tile;
        accounts.recordHand(socket.data.account, -g.bet, true, "towers");
        // Fallen-Layout aller Reihen aufdecken (bei Shadowban die geklickte Kachel als Falle erzwingen).
        const reveal = g.traps.map((s, r) => (shadow && r === g.level ? [tile] : [...s]));
        return ack({ ...view(g, { bust: true, tile, row: g.level, trapLayout: reveal }) });
      }

      g.picks.push(tile);
      g.level += 1;

      // Ganz oben angekommen → automatischer Cash-out beim Maximal-Multiplikator.
      if (g.level >= ROWS) {
        const payout = Math.min(MAX_WIN, Math.floor(g.bet * multiplier(diff, g.level)));
        g.over = true;
        const r = accounts.adjustChips(socket.data.account, payout);
        accounts.recordHand(socket.data.account, payout - g.bet, true, "towers", { einsatz: g.bet });
        return ack({ ...view(g, { tile, row: g.level - 1, cleared: true, payout, trapLayout: g.traps.map((s) => [...s]) }), account: r.account });
      }
      ack({ ...view(g, { tile, row: g.level - 1 }) });
    });

    socket.on("towers:cashout", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      if (g.level <= 0) return ack({ ok: false, error: "Erst mind. eine Ebene erklimmen." });
      const diff = DIFFICULTIES[g.diffKey];
      const mult = multiplier(diff, g.level);
      const payout = Math.min(MAX_WIN, Math.floor(g.bet * mult));
      g.over = true;
      const r = accounts.adjustChips(socket.data.account, payout);
      accounts.recordHand(socket.data.account, payout - g.bet, true, "towers", { einsatz: g.bet });
      ack({ ...view(g, { cashedOut: true, payout, mult, trapLayout: g.traps.map((s) => [...s]) }), account: r.account });
    });
  });
}

module.exports = { setupTowers, DIFFICULTIES, multiplier, ladder };
