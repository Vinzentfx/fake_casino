"use strict";

/**
 * Sudoku-Race — real-time PvP. Both players get the SAME puzzle at the same
 * moment and race to fill it in. The first to submit a structurally VALID full
 * solution wins the pot (both buy-ins) minus a rake. If the time limit runs out
 * first, whoever has more correct cells wins; an exact tie refunds both stakes.
 *
 * PvP only (chips move between players; rake is the sink) → not farmable. The
 * server holds the solution and validates submissions; the client never sees it.
 *
 * Mirrors memory.js for match/lobby lifecycle. Difficulty = number of givens.
 */

const crypto = require("crypto");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAKE = 0.10;
const MIN_BUYIN = 50;
const MAX_BUYIN = 1_000_000;
const TIME_MS = 15 * 60 * 1000; // race time limit → tie-break by correct cells

const DIFFICULTIES = { easy: 45, medium: 34, hard: 28 }; // givens (clues) shown
const DEFAULT_DIFF = "medium";

// ── Sudoku generation ──────────────────────────────────────
const rint = (n) => crypto.randomInt(n);
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function canPlace(g, r, c, n) {
  for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === n) return false; if (g[k * 9 + c] === n) return false; }
  const br = 3 * ((r / 3) | 0), bc = 3 * ((c / 3) | 0);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + (bc + b)] === n) return false;
  return true;
}
function fill(g) {
  const i = g.indexOf(0);
  if (i === -1) return true;
  const r = (i / 9) | 0, c = i % 9;
  for (const n of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (canPlace(g, r, c, n)) { g[i] = n; if (fill(g)) return true; g[i] = 0; }
  }
  return false;
}
function makePuzzle(diff) {
  const givens = DIFFICULTIES[diff] || DIFFICULTIES[DEFAULT_DIFF];
  const solution = new Array(81).fill(0);
  fill(solution);
  const puzzle = solution.slice();
  let remove = 81 - givens;
  for (const i of shuffled([...Array(81).keys()])) {
    if (remove <= 0) break;
    puzzle[i] = 0; remove--;
  }
  return { puzzle, solution };
}
/** A grid is a winning solution iff every cell is 1–9, givens are untouched, and
 * every row/column/3×3 box is a permutation of 1–9. */
function isSolved(grid, puzzle) {
  if (!Array.isArray(grid) || grid.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (!Number.isInteger(v) || v < 1 || v > 9) return false;
    if (puzzle[i] !== 0 && grid[i] !== puzzle[i]) return false; // givens must remain
  }
  const groupsOk = (idxOf) => {
    for (let gI = 0; gI < 9; gI++) {
      const seen = new Set();
      for (let k = 0; k < 9; k++) seen.add(grid[idxOf(gI, k)]);
      if (seen.size !== 9) return false;
    }
    return true;
  };
  if (!groupsOk((r, k) => r * 9 + k)) return false;             // rows
  if (!groupsOk((c, k) => k * 9 + c)) return false;             // cols
  if (!groupsOk((bx, k) => (3 * ((bx / 3) | 0) + ((k / 3) | 0)) * 9 + (3 * (bx % 3) + (k % 3)))) return false; // boxes
  return true;
}
function correctCount(grid, solution) {
  if (!Array.isArray(grid)) return 0;
  let n = 0;
  for (let i = 0; i < 81; i++) if (grid[i] && grid[i] === solution[i]) n++;
  return n;
}

function setupSudoku(io, accounts) {
  const matches = new Map();

  function makeCode() {
    let code;
    do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
    while (matches.has(code));
    return code;
  }
  const acc = (s) => (s.data.account ? accounts.get(s.data.account) : null);
  const currentMatch = (socket) => { const code = socket.data.sudokuCode; return code ? matches.get(code) : null; };

  function stateFor(match, viewerKey) {
    const players = [...match.players.values()];
    const me = match.players.get(viewerKey);
    const opp = players.find((p) => p.id !== viewerKey);
    const pub = (p) => p && { name: p.name, correct: p.correct, finished: p.finished };
    return {
      code: match.code, state: match.state, public: !!match.public,
      difficulty: match.difficulty, buyIn: match.buyIn, pot: match.pot,
      puzzle: match.state === "playing" || match.state === "done" ? match.puzzle : null,
      timeLeft: match.state === "playing" ? Math.max(0, match.endsAt - Date.now()) : (match.state === "done" ? 0 : TIME_MS),
      playerCount: match.players.size,
      isHost: match.host === viewerKey,
      you: pub(me), opponent: pub(opp),
      result: match.result,
    };
  }
  function broadcast(code) {
    const match = matches.get(code);
    if (!match) return;
    for (const p of match.players.values()) if (p.socket) p.socket.emit("sudoku:state", stateFor(match, p.id));
  }
  function describe(match) {
    const host = match.players.get(match.host);
    const label = { easy: "leicht", medium: "mittel", hard: "schwer" }[match.difficulty] || match.difficulty;
    return {
      code: match.code, game: "sudoku", label: `🔢 Sudoku-Race (${label})`,
      host: host ? host.name : "?", players: [...match.players.values()].filter((p) => p.socket).length,
      max: 2, buyIn: match.buyIn, joinable: match.state === "waiting" && match.players.size < 2,
    };
  }
  const registerLobby = (code) => lobby.add(code, () => (matches.has(code) ? describe(matches.get(code)) : null));

  function leaveCurrent(socket) {
    const match = currentMatch(socket);
    if (!match) return;
    const key = socket.data.account;
    const wasPlaying = match.state === "playing";
    match.players.delete(key);
    socket.leave(match.code);
    socket.data.sudokuCode = null;
    const humansLeft = [...match.players.values()].some((p) => p.socket);
    if (!humansLeft) {
      if (match.timer) { clearTimeout(match.timer); match.timer = null; }
      matches.delete(match.code);
      lobby.remove(match.code);
      return;
    }
    if (wasPlaying && match.players.size === 1) settle(match, { winner: [...match.players.values()][0], walkover: true });
    else { broadcast(match.code); lobby.changed(); }
  }

  // settle(match) → decide by correct-cell count (timeout).
  // settle(match, { winner })          → that player won the race (rake applies).
  // settle(match, { winner, walkover }) → opponent left; winner takes the pot, no rake.
  function settle(match, opts = {}) {
    if (match.state === "done") return;
    match.state = "done";
    if (match.timer) { clearTimeout(match.timer); match.timer = null; }
    const players = [...match.players.values()];
    const walkover = !!opts.walkover;

    let winner = opts.winner || null;
    if (!winner && players.length === 2) {
      const [a, b] = players;
      if (a.correct > b.correct) winner = a;
      else if (b.correct > a.correct) winner = b;
    }

    let rake = 0, payout = 0;
    if (winner) {
      rake = walkover ? 0 : Math.floor(match.pot * RAKE); // rake on every real win; walkover takes full pot
      payout = match.pot - rake;
      accounts.adjustChips(winner.id, payout);
      if (!walkover) { try { require("./clans").recordPvpWin(winner.id, "sudoku"); } catch {} }
    } else {
      players.forEach((p) => accounts.adjustChips(p.id, match.buyIn)); // tie → refund
    }

    match.result = {
      winner: winner ? winner.name : null, tie: !winner,
      pot: match.pot, rake, payout, walkover,
      players: players.map((p) => ({ name: p.name, correct: p.correct, finished: p.finished })),
    };
    for (const p of players) {
      if (p.socket) { const a = accounts.get(p.id); if (a) p.socket.emit("account:update", { account: accounts.publicAccount(a) }); }
    }
    broadcast(match.code);
  }

  function startGame(match) {
    const { puzzle, solution } = makePuzzle(match.difficulty);
    match.puzzle = puzzle; match.solution = solution;
    match.pot = 0;
    for (const p of match.players.values()) {
      accounts.adjustChips(p.id, -match.buyIn);
      match.pot += match.buyIn;
      p.correct = 0; p.finished = false;
      if (p.socket) { const a = accounts.get(p.id); p.socket.emit("account:update", { account: accounts.publicAccount(a) }); }
    }
    match.state = "playing";
    match.result = null;
    match.endsAt = Date.now() + TIME_MS;
    match.timer = setTimeout(() => settle(match), TIME_MS);
    broadcast(match.code);
    lobby.changed();
  }

  io.on("connection", (socket) => {
    socket.on("sudoku:create", ({ buyIn, isPublic = true, difficulty = DEFAULT_DIFF } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN)
        return ack && ack({ ok: false, error: `Buy-in ${MIN_BUYIN}–${MAX_BUYIN.toLocaleString("de-DE")} 🪙.` });
      if (!DIFFICULTIES[difficulty]) difficulty = DEFAULT_DIFF;
      const a = acc(socket);
      if (!a || a.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic, difficulty,
        host: socket.data.account, players: new Map(),
        puzzle: null, solution: null, endsAt: 0, timer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, correct: 0, finished: false });
      matches.set(code, match);
      socket.join(code);
      socket.data.sudokuCode = code;
      if (match.public) registerLobby(code);
      ack && ack({ ok: true, code, public: match.public });
      broadcast(code);
    });

    socket.on("sudoku:join", ({ code } = {}, ack) => {
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
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, correct: 0, finished: false });
      socket.join(code);
      socket.data.sudokuCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("sudoku:start", (ack) => {
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

    // Live grid update: validate for a win, else refresh the correct-cell count.
    socket.on("sudoku:update", ({ grid } = {}, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack && ack({ ok: false, error: "Kein laufendes Match." });
      const me = match.players.get(socket.data.account);
      if (!me) return ack && ack({ ok: false, error: "Nicht im Match." });
      const g = Array.isArray(grid) ? grid.map((v) => Math.floor(Number(v)) || 0) : [];
      me.correct = correctCount(g, match.solution);
      if (isSolved(g, match.puzzle)) {
        me.finished = true;
        ack && ack({ ok: true, solved: true });
        settle(match, { winner: me }); // first valid full solution wins the race (rake applies)
        return;
      }
      ack && ack({ ok: true, correct: me.correct });
      broadcast(match.code);
    });

    socket.on("sudoku:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

module.exports = { setupSudoku, SUDOKU_RAKE: RAKE, _isSolved: isSolved, _makePuzzle: makePuzzle };
