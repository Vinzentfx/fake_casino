"use strict";

/**
 * Towers (Dragon Tower) — single-player, server-authoritative.
 *
 * Climb a 9-level tower. On each level you pick ONE tile from a row; some tiles
 * are safe (eggs), one or more are traps (skulls). Pick a safe tile → climb one
 * level and your multiplier rises. Pick a trap → you lose the bet. Cash out any
 * time after ≥1 correct pick to bank bet × current multiplier.
 *
 * Five difficulties change the row width and how many tiles are safe:
 *   Easy   4 tiles, 3 safe (75%)   Medium 3 tiles, 2 safe (67%)
 *   Hard   2 tiles, 1 safe (50%)   Expert 3 tiles, 1 safe (33%)
 *   Master 4 tiles, 1 safe (25%)
 *
 * Fair multiplier after climbing L levels: (1 − edge) · (width/safe)^L
 * → EV of every cash-out level = (1 − edge). This matches Stake's Dragon Tower
 * exactly (e.g. Master L9 = 256 901.12×). Trap positions per row are rolled at
 * start with crypto RNG and never sent to the client until the game ends.
 */

const crypto = require("crypto");

const ROWS = 9;
const HOUSE_EDGE = 0.02; // 98% RTP
const MIN_BET = 50, MAX_BET = 50_000;

const DIFFICULTIES = {
  easy:   { label: "Einfach", width: 4, safe: 3 },
  medium: { label: "Mittel",  width: 3, safe: 2 },
  hard:   { label: "Schwer",  width: 2, safe: 1 },
  expert: { label: "Experte", width: 3, safe: 1 },
  master: { label: "Meister", width: 4, safe: 1 },
};

/** Cash-out multiplier after climbing `level` rows (0 = not started → 1×). */
function multiplier(diff, level) {
  if (level <= 0) return 1;
  const step = diff.width / diff.safe;
  return Math.max(1, Math.floor(Math.pow(step, level) * (1 - HOUSE_EDGE) * 100) / 100);
}

/** Full multiplier ladder for the client's paytable (levels 1..ROWS). */
function ladder(diff) {
  const out = [];
  for (let l = 1; l <= ROWS; l++) out.push(multiplier(diff, l));
  return out;
}

/** Roll trap tile positions for every row (each row: width − safe traps). */
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
  // Spiele hängen am ACCOUNT, nicht am Socket: Tab-Reload/Verbindungsabriss
  // mitten im Lauf kostet nicht mehr Einsatz + aufgelaufenen Multiplikator —
  // der Client holt das laufende Spiel per towers:state zurück.
  const games = new Map(); // accountKey → game

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
        accounts.recordHand(key, payout - g.bet, true, "towers");
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
        picks: g.picks,                              // chosen tile per climbed row
        over: g.over,
        multiplier: multiplier(diff, g.level),
        nextMultiplier: g.over || g.level >= ROWS ? null : multiplier(diff, g.level + 1),
        cashout: g.level > 0 ? Math.floor(g.bet * multiplier(diff, g.level)) : 0,
        ladder: ladder(diff),
        ...extra,
      };
    }

    // Laufendes Spiel nach Reload/Reconnect wieder aufnehmen.
    socket.on("towers:state", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.account ? games.get(socket.data.account) : null;
      if (!g || g.over) return ack({ ok: true, none: true });
      g.lastAt = Date.now();
      ack(view(g));
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
      if (!Number.isFinite(bet) || bet < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} 🪙.` });
      if (bet > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} 🪙.` });
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
      const shadow = accounts.isShadowbanned(socket.data.account);
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
        const payout = Math.floor(g.bet * multiplier(diff, g.level));
        g.over = true;
        const r = accounts.adjustChips(socket.data.account, payout);
        accounts.recordHand(socket.data.account, payout - g.bet, true, "towers");
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
      const payout = Math.floor(g.bet * mult);
      g.over = true;
      const r = accounts.adjustChips(socket.data.account, payout);
      accounts.recordHand(socket.data.account, payout - g.bet, true, "towers");
      ack({ ...view(g, { cashedOut: true, payout, mult, trapLayout: g.traps.map((s) => [...s]) }), account: r.account });
    });
  });
}

module.exports = { setupTowers, DIFFICULTIES, multiplier, ladder };
