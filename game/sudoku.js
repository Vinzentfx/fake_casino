"use strict";

/**
 * Sudoku-Race, live gegeneinander. Beide bekommen im selben Moment dasselbe
 * Rätsel und füllen um die Wette. Wer zuerst eine GÜLTIGE volle Lösung abgibt,
 * bekommt den Topf (beide Buy-ins) minus Rake. Läuft vorher die Zeit ab,
 * gewinnt, wer mehr richtige Felder hat, bei genau gleich vielen gibt es die
 * Einsätze zurück.
 *
 * Nur gegeneinander (Chips wandern zwischen den Spielern, der Rake
 * verschwindet), also nicht farmbar. Die Lösung liegt auf dem Server und prüft
 * die Abgaben, der Client sieht sie nie.
 *
 * Match und Lobby wie in memory.js. Schwierigkeit = Anzahl vorgegebener Zahlen.
 */

const crypto = require("crypto");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAKE = 0.10;
const MIN_BUYIN = 50;
const MAX_BUYIN = 1_000_000;
const TIME_MS = 15 * 60 * 1000; // Zeitlimit, danach entscheiden die richtigen Felder

const DIFFICULTIES = { easy: 45, medium: 34, hard: 28 }; // givens (clues) shown
const DEFAULT_DIFF = "medium";

// --- Sudoku generation ---
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
/** Ein Raster ist gelöst, wenn jedes Feld 1 bis 9 ist, die Vorgaben unverändert sind
 * und jede Zeile, Spalte und jeder 3×3-Block jede Zahl genau einmal hat. */
function isSolved(grid, puzzle) {
  if (!Array.isArray(grid) || grid.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (!Number.isInteger(v) || v < 1 || v > 9) return false;
    if (puzzle[i] !== 0 && grid[i] !== puzzle[i]) return false; // Vorgaben bleiben
  }
  const groupsOk = (idxOf) => {
    for (let gI = 0; gI < 9; gI++) {
      const seen = new Set();
      for (let k = 0; k < 9; k++) seen.add(grid[idxOf(gI, k)]);
      if (seen.size !== 9) return false;
    }
    return true;
  };
  if (!groupsOk((r, k) => r * 9 + k)) return false;             // Zeilen
  if (!groupsOk((c, k) => k * 9 + c)) return false;             // Spalten
  if (!groupsOk((bx, k) => (3 * ((bx / 3) | 0) + ((k / 3) | 0)) * 9 + (3 * (bx % 3) + (k % 3)))) return false; // Blöcke
  return true;
}
function correctCount(grid, solution) {
  if (!Array.isArray(grid)) return 0;
  let n = 0;
  for (let i = 0; i < 81; i++) if (grid[i] && grid[i] === solution[i]) n++;
  return n;
}
function filledCount(grid, puzzle) {
  if (!Array.isArray(grid) || !Array.isArray(puzzle)) return 0;
  let n = 0;
  for (let i = 0; i < 81; i++) {
    const v = Math.floor(Number(grid[i])) || 0;
    if (puzzle[i] !== 0 || (v >= 1 && v <= 9)) n++;
  }
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
    const pub = (p) => p && { name: p.name, progress: p.filled || 0, finished: p.finished };
    return {
      code: match.code, state: match.state, public: !!match.public,
      difficulty: match.difficulty, buyIn: match.buyIn, pot: match.pot,
      puzzle: match.state === "playing" || match.state === "done" ? match.puzzle : null,
      timeLeft: match.state === "playing" ? Math.max(0, match.endsAt - Date.now()) : (match.state === "done" ? 0 : TIME_MS),
      playerCount: match.players.size,
      isHost: match.host === viewerKey,
      you: pub(me), opponent: pub(opp),
      result: match.result,
      rematch: rematchInfo(match, viewerKey),
    };
  }
  function rematchInfo(match, viewerKey) {
    const connected = [...match.players.values()].filter((p) => p.socket);
    const want = match.rematchWant || [];
    return {
      canRematch: match.state === "done" && connected.length === 2,
      youWant: want.includes(viewerKey),
      oppWants: connected.some((p) => p.id !== viewerKey && want.includes(p.id)),
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
      code: match.code, game: "sudoku", label: `Sudoku-Race (${label})`,
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

  // settle(match)                    : Zeit abgelaufen, die richtigen Felder entscheiden.
  // settle(match, { winner })          : dieser Spieler hat gewonnen (mit Rake).
  // settle(match, { winner, walkover }) : der Gegner ist weg, ganzer Topf ohne Rake.
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
      rake = walkover ? 0 : Math.floor(match.pot * RAKE); // Rake bei jedem echten Sieg, kampflos gibt es den ganzen Topf
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
    match.rematchWant = [];
    match.pot = 0;
    for (const p of match.players.values()) {
      accounts.adjustChips(p.id, -match.buyIn);
      match.pot += match.buyIn;
      p.correct = 0; p.filled = filledCount(puzzle, puzzle); p.finished = false;
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
    // --- Solo (ohne Uhr, ohne Einsatz, zählt für Statistik und Achievements) ---
    socket.on("sudoku:soloStart", ({ difficulty = DEFAULT_DIFF } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!DIFFICULTIES[difficulty]) difficulty = DEFAULT_DIFF;
      const { puzzle, solution } = makePuzzle(difficulty);
      socket.data.sudokuSolo = { puzzle, solution, difficulty, done: false };
      ack({ ok: true, puzzle, difficulty });
    });

    socket.on("sudoku:soloUpdate", ({ grid } = {}, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.sudokuSolo;
      if (!g || g.done) return ack({ ok: false, error: "Kein aktives Solo-Spiel." });
      const arr = Array.isArray(grid) ? grid.map((v) => Math.floor(Number(v)) || 0) : [];
      if (isSolved(arr, g.puzzle)) {
        g.done = true;
        const a = accounts.get(socket.data.account);
        if (a) a.sudokuSolved = (a.sudokuSolved || 0) + 1;
        accounts.recordHand(socket.data.account, 0, true, "sudoku"); // → onHand → achievements/stats
        return ack({ ok: true, solved: true });
      }
      ack({ ok: true, progress: filledCount(arr, g.puzzle) });
    });

    socket.on("sudoku:soloLeave", () => { delete socket.data.sudokuSolo; });

    socket.on("sudoku:create", ({ buyIn, isPublic = true, difficulty = DEFAULT_DIFF } = {}, ack) => {
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN)
        return typeof ack === "function" && ack({ ok: false, error: `Buy-in zwischen ${MIN_BUYIN} und ${MAX_BUYIN.toLocaleString("de-DE")} Chips.` });
      if (!DIFFICULTIES[difficulty]) difficulty = DEFAULT_DIFF;
      const a = acc(socket);
      if (!a || a.chips < buyIn) return typeof ack === "function" && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic, difficulty,
        host: socket.data.account, players: new Map(),
        puzzle: null, solution: null, endsAt: 0, timer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, correct: 0, filled: 0, finished: false });
      matches.set(code, match);
      socket.join(code);
      socket.data.sudokuCode = code;
      if (match.public) registerLobby(code);
      typeof ack === "function" && ack({ ok: true, code, public: match.public });
      broadcast(code);
    });

    socket.on("sudoku:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const match = matches.get(code);
      if (!match) return typeof ack === "function" && ack({ ok: false, error: "Match nicht gefunden." });
      if (match.state !== "waiting") return typeof ack === "function" && ack({ ok: false, error: "Match läuft bereits." });
      if (match.players.size >= 2 && !match.players.has(socket.data.account))
        return typeof ack === "function" && ack({ ok: false, error: "Match ist voll." });
      const a = acc(socket);
      if (!a || a.chips < match.buyIn) return typeof ack === "function" && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, correct: 0, filled: 0, finished: false });
      socket.join(code);
      socket.data.sudokuCode = code;
      typeof ack === "function" && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("sudoku:start", (ack) => {
      const match = currentMatch(socket);
      if (!match) return typeof ack === "function" && ack({ ok: false, error: "Kein Match." });
      if (match.host !== socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Nur der Host startet." });
      if (match.state !== "waiting") return typeof ack === "function" && ack({ ok: false, error: "Läuft bereits." });
      if (match.players.size !== 2) return typeof ack === "function" && ack({ ok: false, error: "Warte auf 2 Spieler." });
      for (const p of match.players.values()) {
        const a = accounts.get(p.id);
        if (!a || a.chips < match.buyIn) return typeof ack === "function" && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` });
      }
      typeof ack === "function" && ack({ ok: true });
      startGame(match);
    });

    // Live-Stand: auf Sieg prüfen, sonst die versteckte Punktzahl für den Gleichstand aktualisieren.
    socket.on("sudoku:update", ({ grid } = {}, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return typeof ack === "function" && ack({ ok: false, error: "Kein laufendes Match." });
      const me = match.players.get(socket.data.account);
      if (!me) return typeof ack === "function" && ack({ ok: false, error: "Nicht im Match." });
      const g = Array.isArray(grid) ? grid.map((v) => Math.floor(Number(v)) || 0) : [];
      me.correct = correctCount(g, match.solution);
      me.filled = filledCount(g, match.puzzle);
      if (isSolved(g, match.puzzle)) {
        me.finished = true;
        typeof ack === "function" && ack({ ok: true, solved: true });
        settle(match, { winner: me }); // die erste gültige volle Lösung gewinnt (mit Rake)
        return;
      }
      typeof ack === "function" && ack({ ok: true, progress: me.filled });
      broadcast(match.code);
    });

    socket.on("sudoku:rematch", (ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "done") return typeof ack === "function" && ack({ ok: false, error: "Kein beendetes Spiel." });
      const connected = [...match.players.values()].filter((p) => p.socket);
      if (connected.length !== 2) return typeof ack === "function" && ack({ ok: false, error: "Gegner ist nicht mehr da." });
      for (const p of connected) { const a = accounts.get(p.id); if (!a || a.chips < match.buyIn) return typeof ack === "function" && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` }); }
      match.rematchWant = match.rematchWant || [];
      if (!match.rematchWant.includes(socket.data.account)) match.rematchWant.push(socket.data.account);
      typeof ack === "function" && ack({ ok: true });
      if (connected.every((p) => match.rematchWant.includes(p.id))) { match.rematchWant = []; startGame(match); }
      else broadcast(match.code);
    });

    socket.on("sudoku:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

/**
 * Dasselbe Sudoku als Duell, das nicht gleichzeitig gespielt werden muss.
 *
 * Der Race-Modus verlangt, dass zwei Leute im selben Moment da sind. Genau das
 * passiert in dieser Runde fast nie, weshalb er praktisch tot war. Fuer die
 * Aufgabe selbst ist Gleichzeitigkeit aber voellig egal: beide bekommen
 * dasselbe Raetsel, am Ende werden zwei Ergebnisse verglichen. Also laeuft es
 * jetzt zusaetzlich versetzt ueber game/asyncDuell.js.
 *
 * Gewertet wird erst die Zahl richtiger Felder, dann die Zeit. Wer loest,
 * gewinnt also gegen jeden, der nicht geloest hat, egal wie schnell der war.
 */
function zeitText(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

require("./asyncDuell").registriere({
  id: "sudoku",
  label: "Sudoku",
  erzeuge({ difficulty } = {}) {
    const diff = DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFF;
    const { puzzle, solution } = makePuzzle(diff);
    return {
      aufgabe: { puzzle, difficulty: diff },
      geheim: { puzzle, solution },
      label: { easy: "Leicht", medium: "Mittel", hard: "Schwer" }[diff] || diff,
    };
  },
  bewerte(geheim, einsendung, ms) {
    const grid = Array.isArray(einsendung) ? einsendung.map((v) => Math.floor(Number(v)) || 0) : [];
    const korrekt = correctCount(grid, geheim.solution);
    const geloest = isSolved(grid, geheim.puzzle);
    return {
      punkte: korrekt,
      ms,
      text: geloest ? `Gelöst in ${zeitText(ms)}` : `${korrekt} von 81 richtig, ${zeitText(ms)}`,
    };
  },
});

module.exports = { setupSudoku, SUDOKU_RAKE: RAKE, _isSolved: isSolved, _makePuzzle: makePuzzle };
