"use strict";

/**
 * Memory-Duell — turn-based PvP memory (pairs).
 *
 * Two players share ONE shuffled board of face-down pairs. On your turn you flip
 * two cards: a match scores a pair and you go again; a miss flips them back and
 * passes the turn. Whoever has the most pairs when the board is cleared wins the
 * pot (both buy-ins) minus a rake. A tie refunds both buy-ins.
 *
 * PvP only (no bot) — memory is a skill game, so a random bot would be farmable.
 * Chips only move between the two players; the rake is the economy sink. Server-
 * authoritative: the board layout lives here and unmatched card faces are never
 * sent to the client until they're flipped.
 *
 * Closely mirrors slotsPvp.js for match/lobby lifecycle.
 */

const crypto = require("crypto");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRS = 8;              // 16 cards → 4×4 board
const RAKE = 0.10;            // 10% of the pot is removed (sink); winner gets the rest
const MIN_BUYIN = 50;
const MAX_BUYIN = 1_000_000;
const FLIP_BACK_MS = 1100;    // how long a mismatched pair stays visible before flipping back

// Card faces — one emoji per pair id (index 0..PAIRS-1).
const FACES = ["🍒", "🍋", "🔔", "⭐", "💎", "🍀", "🎲", "👑", "🚀", "🐬", "🦄", "🎁"];

function shuffledBoard() {
  const ids = [];
  for (let i = 0; i < PAIRS; i++) ids.push(i, i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.map((id) => ({ id, matchedBy: null }));
}

function setupMemory(io, accounts) {
  const matches = new Map(); // code -> match

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    } while (matches.has(code));
    return code;
  }

  const acc = (s) => (s.data.account ? accounts.get(s.data.account) : null);
  const currentMatch = (socket) => {
    const code = socket.data.memoryCode;
    return code ? matches.get(code) : null;
  };

  // Public board: reveal only matched cards and the currently flipped ones.
  function publicBoard(match) {
    const flipped = new Set(match.flipped);
    return match.board.map((c, i) => {
      const shown = c.matchedBy != null || flipped.has(i);
      return { i, up: shown, matched: c.matchedBy != null, face: shown ? FACES[c.id] : null };
    });
  }

  function stateFor(match, viewerKey) {
    const players = [...match.players.values()];
    const me = match.players.get(viewerKey);
    const opp = players.find((p) => p.id !== viewerKey);
    const pub = (p) => p && { name: p.name, pairs: p.pairs };
    return {
      code: match.code,
      state: match.state,
      public: !!match.public,
      buyIn: match.buyIn,
      pot: match.pot,
      pairsTotal: PAIRS,
      board: publicBoard(match),
      playerCount: match.players.size,
      isHost: match.host === viewerKey,
      yourTurn: match.state === "playing" && match.turn === viewerKey && !match.locked,
      turnName: (() => { const t = match.players.get(match.turn); return t ? t.name : null; })(),
      you: pub(me),
      opponent: pub(opp),
      result: match.result,
    };
  }

  function broadcast(code) {
    const match = matches.get(code);
    if (!match) return;
    for (const p of match.players.values()) {
      if (p.socket) p.socket.emit("memory:state", stateFor(match, p.id));
    }
  }

  function describe(match) {
    const host = match.players.get(match.host);
    return {
      code: match.code,
      game: "memory",
      label: "🧠 Memory-Duell",
      host: host ? host.name : "?",
      players: [...match.players.values()].filter((p) => p.socket).length,
      max: 2,
      buyIn: match.buyIn,
      joinable: match.state === "waiting" && match.players.size < 2,
    };
  }
  const registerLobby = (code) =>
    lobby.add(code, () => (matches.has(code) ? describe(matches.get(code)) : null));

  function leaveCurrent(socket) {
    const match = currentMatch(socket);
    if (!match) return;
    const key = socket.data.account;
    const wasPlaying = match.state === "playing";
    if (match.flipTimer) { clearTimeout(match.flipTimer); match.flipTimer = null; }
    match.players.delete(key);
    socket.leave(match.code);
    socket.data.memoryCode = null;

    const humansLeft = [...match.players.values()].some((p) => p.socket);
    if (!humansLeft) {
      matches.delete(match.code);
      lobby.remove(match.code);
      return;
    }
    // Walkover: someone left mid-match → remaining player wins the pot.
    if (wasPlaying && match.players.size === 1) {
      settle(match, [...match.players.values()][0]);
    } else {
      broadcast(match.code);
      lobby.changed();
    }
  }

  function settle(match, forcedWinner) {
    if (match.state === "done") return;
    match.state = "done";
    if (match.flipTimer) { clearTimeout(match.flipTimer); match.flipTimer = null; }
    const players = [...match.players.values()];

    let winner = forcedWinner || null;
    if (!winner && players.length === 2) {
      const [a, b] = players;
      if (a.pairs > b.pairs) winner = a;
      else if (b.pairs > a.pairs) winner = b;
    }

    let rake = 0, payout = 0;
    if (winner) {
      rake = forcedWinner ? 0 : Math.floor(match.pot * RAKE); // walkover: no rake, take the pot
      payout = match.pot - rake;
      accounts.adjustChips(winner.id, payout);
    } else {
      players.forEach((p) => accounts.adjustChips(p.id, match.buyIn)); // tie → refund
    }

    match.result = {
      winner: winner ? winner.name : null,
      tie: !winner,
      pot: match.pot, rake, payout,
      walkover: !!forcedWinner,
      players: players.map((p) => ({ name: p.name, pairs: p.pairs })),
    };

    for (const p of players) {
      if (p.socket) {
        const a = accounts.get(p.id);
        if (a) p.socket.emit("account:update", { account: accounts.publicAccount(a) });
      }
    }
    broadcast(match.code);
  }

  function startGame(match) {
    match.board = shuffledBoard();
    match.flipped = [];
    match.locked = false;
    match.pot = 0;
    const players = [...match.players.values()];
    for (const p of players) {
      accounts.adjustChips(p.id, -match.buyIn);
      match.pot += match.buyIn;
      p.pairs = 0;
      if (p.socket) {
        const a = accounts.get(p.id);
        p.socket.emit("account:update", { account: accounts.publicAccount(a) });
      }
    }
    match.turn = match.host;   // host goes first
    match.state = "playing";
    match.result = null;
    broadcast(match.code);
    lobby.changed(); // now playing → drops out of the open-lobby list
  }

  io.on("connection", (socket) => {
    socket.on("memory:create", ({ buyIn, isPublic = true } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN)
        return ack && ack({ ok: false, error: `Buy-in ${MIN_BUYIN}–${MAX_BUYIN.toLocaleString("de-DE")} 🪙.` });
      const a = acc(socket);
      if (!a || a.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic,
        host: socket.data.account, players: new Map(),
        board: [], flipped: [], locked: false, turn: null, flipTimer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, pairs: 0 });
      matches.set(code, match);
      socket.join(code);
      socket.data.memoryCode = code;
      // Public matches show up in the open-lobby browser; private ones are code-only.
      if (match.public) registerLobby(code);
      ack && ack({ ok: true, code, public: match.public });
      broadcast(code);
    });

    socket.on("memory:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const match = matches.get(code);
      if (!match) return ack && ack({ ok: false, error: "Match nicht gefunden." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Match läuft bereits." });
      if (match.players.size >= 2 && !match.players.has(socket.data.account))
        return ack && ack({ ok: false, error: "Match ist voll." });
      const a = acc(socket);
      if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, pairs: 0 });
      socket.join(code);
      socket.data.memoryCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("memory:start", (ack) => {
      const match = currentMatch(socket);
      if (!match) return ack && ack({ ok: false, error: "Kein Match." });
      if (match.host !== socket.data.account) return ack && ack({ ok: false, error: "Nur der Host startet." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Läuft bereits." });
      if (match.players.size !== 2) return ack && ack({ ok: false, error: "Warte auf 2 Spieler." });
      for (const p of match.players.values()) {
        const a = accounts.get(p.id);
        if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` });
      }
      ack && ack({ ok: true });
      startGame(match);
    });

    socket.on("memory:flip", ({ index } = {}, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack && ack({ ok: false, error: "Kein laufendes Match." });
      if (match.locked) return ack && ack({ ok: false, error: "Kurz warten…" });
      if (match.turn !== socket.data.account) return ack && ack({ ok: false, error: "Nicht dein Zug." });
      index = Math.floor(Number(index));
      if (!Number.isFinite(index) || index < 0 || index >= match.board.length)
        return ack && ack({ ok: false, error: "Ungültige Karte." });
      const card = match.board[index];
      if (card.matchedBy != null || match.flipped.includes(index))
        return ack && ack({ ok: false, error: "Karte schon offen." });
      if (match.flipped.length >= 2) return ack && ack({ ok: false, error: "Kurz warten…" });

      match.flipped.push(index);
      ack && ack({ ok: true });

      if (match.flipped.length < 2) { broadcast(match.code); return; }

      // Second card flipped → resolve.
      const [i, j] = match.flipped;
      const isMatch = match.board[i].id === match.board[j].id;
      if (isMatch) {
        const me = match.players.get(match.turn);
        match.board[i].matchedBy = match.turn;
        match.board[j].matchedBy = match.turn;
        me.pairs += 1;
        match.flipped = [];
        broadcast(match.code); // matcher keeps the turn
        if (match.board.every((c) => c.matchedBy != null)) settle(match);
      } else {
        // Show both, then flip back + pass turn after a beat.
        match.locked = true;
        broadcast(match.code);
        match.flipTimer = setTimeout(() => {
          match.flipTimer = null;
          if (match.state !== "playing") return;
          match.flipped = [];
          match.locked = false;
          const players = [...match.players.values()];
          const other = players.find((p) => p.id !== match.turn);
          if (other) match.turn = other.id;
          broadcast(match.code);
        }, FLIP_BACK_MS);
      }
    });

    socket.on("memory:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

module.exports = { setupMemory, MEMORY_RAKE: RAKE, MEMORY_MIN_BUYIN: MIN_BUYIN };
