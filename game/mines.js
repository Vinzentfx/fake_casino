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
const MIN_BET = 50, MAX_BET = 1_000_000;

function multiplier(mines, safe) {
  if (safe <= 0) return 1;
  let p = 1;
  for (let i = 0; i < safe; i++) p *= (TILES - i) / (TILES - mines - i);
  return Math.max(1, Math.floor(p * (1 - HOUSE_EDGE) * 100) / 100);
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

function setupMines(io, accounts) {
  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function view(g, extra = {}) {
      const safe = g.revealed.length;
      return {
        ok: true, bet: g.bet, mines: g.mines,
        revealed: g.revealed, over: g.over,
        multiplier: multiplier(g.mines, safe),
        nextMultiplier: g.over ? null : multiplier(g.mines, safe + 1),
        cashout: safe > 0 ? Math.floor(g.bet * multiplier(g.mines, safe)) : 0,
        ...extra,
      };
    }

    socket.on("mines:start", ({ bet, mines } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = acct();
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (socket.data.mines && !socket.data.mines.over) return ack({ ok: false, error: "Beende erst dein laufendes Spiel." });
      bet = Math.floor(Number(bet));
      mines = Math.floor(Number(mines));
      if (!Number.isFinite(bet) || bet < MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} 🪙.` });
      if (bet > MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} 🪙.` });
      if (!Number.isFinite(mines) || mines < 1 || mines > 24) return ack({ ok: false, error: "1–24 Minen." });
      if (a.chips < bet) return ack({ ok: false, error: "Nicht genug Chips." });
      const res = accounts.adjustChips(socket.data.account, -bet);
      if (!res.ok) return ack({ ok: false, error: res.error });
      socket.data.mines = { bet, mines, mineSet: pickMines(mines), revealed: [], over: false };
      ack({ ...view(socket.data.mines), account: res.account });
    });

    socket.on("mines:reveal", ({ tile } = {}, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.mines;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
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
        const payout = Math.floor(g.bet * multiplier(g.mines, g.revealed.length));
        g.over = true;
        const r = accounts.adjustChips(socket.data.account, payout);
        accounts.recordHand(socket.data.account, payout - g.bet, true, "mines");
        return ack({ ...view(g, { tile, cleared: true, payout, mineSet: [...g.mineSet] }), account: r.account });
      }
      ack({ ...view(g, { tile }) });
    });

    socket.on("mines:cashout", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.mines;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      if (!g.revealed.length) return ack({ ok: false, error: "Erst mind. ein Feld aufdecken." });
      const mult = multiplier(g.mines, g.revealed.length);
      const payout = Math.floor(g.bet * mult);
      g.over = true;
      const r = accounts.adjustChips(socket.data.account, payout);
      accounts.recordHand(socket.data.account, payout - g.bet, true, "mines");
      ack({ ...view(g, { cashedOut: true, payout, mult, mineSet: [...g.mineSet] }), account: r.account });
    });
  });
}

module.exports = { setupMines };
