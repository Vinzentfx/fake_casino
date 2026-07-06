"use strict";

/**
 * Schach-Duell — PvP wager chess with a Blitz clock.
 *
 * Two players stake a buy-in; the winner takes the pot minus rake. Move legality,
 * check, checkmate, stalemate and draws are decided by chess.js (server-side, so
 * the client needs no chess logic). Each player has a running clock; flagging on
 * time loses. Resign / leaving / disconnect → opponent wins (walkover, no rake).
 * A draw refunds both buy-ins.
 *
 * Ranked: every decisive result updates both players' chess Elo + W/L/D on their
 * account, which feeds the chess leaderboard and the Clan-Liga (see chessLeague).
 *
 * Match/lobby lifecycle mirrors memory.js / sudoku.js.
 */

const { Chess } = require("chess.js");
const lobby = require("./lobby");
const chat = require("./chat");
const clans = require("./clans");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAKE = 0.10;
const MIN_BUYIN = 50;
const MAX_BUYIN = 1_000_000;

// Time controls: base minutes + increment seconds.
const TIME_CONTROLS = {
  "3+2": { base: 180_000, inc: 2_000 },
  "5+0": { base: 300_000, inc: 0 },
  "10+5": { base: 600_000, inc: 5_000 },
};
const DEFAULT_TC = "5+0";

// ── Elo ────────────────────────────────────────────────────
const K = 24;
function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function eloUpdate(ra, rb, scoreA) {
  const ea = expected(ra, rb);
  return [Math.round(ra + K * (scoreA - ea)), Math.round(rb + K * ((1 - scoreA) - (1 - ea)))];
}

function ensureChessStats(acc) {
  if (typeof acc.chessRating !== "number") acc.chessRating = 1000;
  if (typeof acc.chessWins !== "number") acc.chessWins = 0;
  if (typeof acc.chessLosses !== "number") acc.chessLosses = 0;
  if (typeof acc.chessDraws !== "number") acc.chessDraws = 0;
}

function setupChess(io, accounts) {
  const matches = new Map();
  const acc = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  function makeCode() {
    let code;
    do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
    while (matches.has(code));
    return code;
  }
  const currentMatch = (socket) => { const c = socket.data.chessCode; return c ? matches.get(c) : null; };

  // Live clock: remaining time for the side to move, accounting for elapsed think time.
  function liveClocks(match) {
    const c = { ...match.clocks };
    if (match.state === "playing" && match.turnStart) {
      const turn = match.game.turn(); // 'w' | 'b'
      c[turn] = Math.max(0, c[turn] - (Date.now() - match.turnStart));
    }
    return c;
  }

  function boardArray(game) {
    // 8x8 (rank 8 → 1) of null | { t, c }
    return game.board().map((row) => row.map((sq) => (sq ? { t: sq.type, c: sq.color } : null)));
  }

  function stateFor(match, viewerKey) {
    const players = [...match.players.values()];
    const me = match.players.get(viewerKey);
    const opp = players.find((p) => p.id !== viewerKey);
    const pub = (p) => p && { name: p.name, color: p.color, rating: p.rating };
    const playing = match.state === "playing";
    return {
      code: match.code, state: match.state, public: !!match.public,
      buyIn: match.buyIn, pot: match.pot, tc: match.tc,
      board: playing || match.state === "done" ? boardArray(match.game) : null,
      turn: playing ? match.game.turn() : null,
      yourColor: me ? me.color : null,
      clocks: playing ? liveClocks(match) : (match.state === "done" ? match.clocks : null),
      check: playing ? match.game.inCheck() : false,
      lastMove: match.lastMove || null,
      historySan: match.game ? match.game.history() : [],
      playerCount: match.players.size, isHost: match.host === viewerKey,
      you: pub(me), opponent: pub(opp), result: match.result,
    };
  }
  function broadcast(code) {
    const match = matches.get(code);
    if (!match) return;
    for (const p of match.players.values()) if (p.socket) p.socket.emit("chess:state", stateFor(match, p.id));
  }
  function describe(match) {
    const host = match.players.get(match.host);
    return {
      code: match.code, game: "chess", label: `♟️ Schach-Duell (${match.tc})`,
      host: host ? host.name : "?", players: [...match.players.values()].filter((p) => p.socket).length,
      max: 2, buyIn: match.buyIn, joinable: match.state === "waiting" && match.players.size < 2,
    };
  }
  const registerLobby = (code) => lobby.add(code, () => (matches.has(code) ? describe(matches.get(code)) : null));

  function leaveCurrent(socket) {
    const match = currentMatch(socket);
    if (!match) return;
    const wasPlaying = match.state === "playing";
    match.players.delete(socket.data.account);
    socket.leave(match.code);
    socket.data.chessCode = null;
    const humansLeft = [...match.players.values()].some((p) => p.socket);
    if (!humansLeft) {
      if (match.clockTimer) { clearInterval(match.clockTimer); match.clockTimer = null; }
      matches.delete(match.code); lobby.remove(match.code); return;
    }
    if (wasPlaying && match.players.size === 1) finish(match, { winner: [...match.players.values()][0], reason: "walkover" });
    else { broadcast(match.code); lobby.changed(); }
  }

  // Apply the ranked Elo/stat update for a decisive or drawn game.
  function applyRating(match, winnerId, draw) {
    const players = [...match.players.values()];
    if (players.length !== 2) return null;
    const [a, b] = players;
    const ra = accounts.get(a.id), rb = accounts.get(b.id);
    if (!ra || !rb) return null;
    ensureChessStats(ra); ensureChessStats(rb);
    const before = { [a.id]: ra.chessRating, [b.id]: rb.chessRating };
    let scoreA;
    if (draw) { scoreA = 0.5; ra.chessDraws++; rb.chessDraws++; }
    else if (winnerId === a.id) { scoreA = 1; ra.chessWins++; rb.chessLosses++; }
    else { scoreA = 0; ra.chessLosses++; rb.chessWins++; }
    const [na, nb] = eloUpdate(ra.chessRating, rb.chessRating, scoreA);
    ra.chessRating = na; rb.chessRating = nb;
    accounts.save();
    return { before, after: { [a.id]: na, [b.id]: nb } };
  }

  function finish(match, { winner, draw, reason }) {
    if (match.state === "done") return;
    match.state = "done";
    if (match.clockTimer) { clearInterval(match.clockTimer); match.clockTimer = null; }
    match.clocks = liveClocks(match); // freeze
    const players = [...match.players.values()];
    const walkover = reason === "walkover";

    let rake = 0, payout = 0, ratingChange = null;
    if (draw) {
      players.forEach((p) => accounts.adjustChips(p.id, match.buyIn)); // refund
      ratingChange = applyRating(match, null, true);
    } else if (winner) {
      rake = walkover ? 0 : Math.floor(match.pot * RAKE);
      payout = match.pot - rake;
      accounts.adjustChips(winner.id, payout);
      // Walkover still counts as a ranked win (opponent abandoned).
      ratingChange = applyRating(match, winner.id, false);
    }

    match.result = {
      winner: winner ? winner.name : null, draw: !!draw, reason, walkover,
      pot: match.pot, rake, payout,
      players: players.map((p) => {
        const a = accounts.get(p.id);
        return { name: p.name, color: p.color, rating: a ? a.chessRating : p.rating };
      }),
    };
    for (const p of players) if (p.socket) { const a = accounts.get(p.id); if (a) p.socket.emit("account:update", { account: accounts.publicAccount(a) }); }
    broadcast(match.code);
  }

  function startGame(match) {
    match.game = new Chess();
    match.pot = 0;
    const players = [...match.players.values()];
    // Random colors.
    const whiteFirst = Math.random() < 0.5;
    players[0].color = whiteFirst ? "w" : "b";
    players[1].color = whiteFirst ? "b" : "w";
    for (const p of players) {
      accounts.adjustChips(p.id, -match.buyIn);
      match.pot += match.buyIn;
      const a = accounts.get(p.id); ensureChessStats(a); p.rating = a.chessRating;
      if (p.socket) p.socket.emit("account:update", { account: accounts.publicAccount(a) });
    }
    const tc = TIME_CONTROLS[match.tc] || TIME_CONTROLS[DEFAULT_TC];
    match.clocks = { w: tc.base, b: tc.base };
    match.inc = tc.inc;
    match.turnStart = Date.now();
    match.lastMove = null;
    match.state = "playing";
    match.result = null;
    // Clock ticker: flag the side that runs out of time.
    match.clockTimer = setInterval(() => {
      if (match.state !== "playing") return;
      const c = liveClocks(match);
      const turn = match.game.turn();
      if (c[turn] <= 0) {
        const loser = turn;
        const winnerP = players.find((p) => p.color !== loser);
        finish(match, { winner: winnerP, reason: "timeout" });
      }
    }, 1000);
    broadcast(match.code);
    lobby.changed();
  }

  io.on("connection", (socket) => {
    socket.on("chess:create", ({ buyIn, isPublic = true, tc = DEFAULT_TC } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN)
        return ack && ack({ ok: false, error: `Buy-in ${MIN_BUYIN}–${MAX_BUYIN.toLocaleString("de-DE")} 🪙.` });
      if (!TIME_CONTROLS[tc]) tc = DEFAULT_TC;
      const a = acc(socket);
      if (!a || a.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });
      leaveCurrent(socket);
      const code = makeCode();
      ensureChessStats(a);
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic, tc,
        host: socket.data.account, players: new Map(),
        game: null, clocks: null, turnStart: 0, inc: 0, lastMove: null, clockTimer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, color: null, rating: a.chessRating });
      matches.set(code, match);
      socket.join(code); socket.data.chessCode = code;
      if (match.public) registerLobby(code);
      ack && ack({ ok: true, code, public: match.public });
      broadcast(code);
    });

    socket.on("chess:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const match = matches.get(code);
      if (!match) return ack && ack({ ok: false, error: "Match nicht gefunden." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Match läuft bereits." });
      if (match.players.size >= 2 && !match.players.has(socket.data.account)) return ack && ack({ ok: false, error: "Match ist voll." });
      const a = acc(socket);
      if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });
      leaveCurrent(socket);
      ensureChessStats(a);
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, color: null, rating: a.chessRating });
      socket.join(code); socket.data.chessCode = code;
      ack && ack({ ok: true, code });
      broadcast(code); lobby.changed();
    });

    socket.on("chess:start", (ack) => {
      const match = currentMatch(socket);
      if (!match) return ack && ack({ ok: false, error: "Kein Match." });
      if (match.host !== socket.data.account) return ack && ack({ ok: false, error: "Nur der Host startet." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Läuft bereits." });
      if (match.players.size !== 2) return ack && ack({ ok: false, error: "Warte auf 2 Spieler." });
      for (const p of match.players.values()) { const a = accounts.get(p.id); if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` }); }
      ack && ack({ ok: true });
      startGame(match);
    });

    // Legal target squares for a piece (for client highlighting).
    socket.on("chess:legal", ({ square } = {}, ack) => {
      if (typeof ack !== "function") return;
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack({ ok: false });
      const me = match.players.get(socket.data.account);
      if (!me || me.color !== match.game.turn()) return ack({ ok: true, targets: [] });
      try {
        const moves = match.game.moves({ square, verbose: true });
        ack({ ok: true, targets: moves.map((m) => m.to) });
      } catch { ack({ ok: true, targets: [] }); }
    });

    socket.on("chess:move", ({ from, to, promotion } = {}, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack && ack({ ok: false, error: "Kein laufendes Spiel." });
      const me = match.players.get(socket.data.account);
      if (!me) return ack && ack({ ok: false, error: "Nicht im Match." });
      if (me.color !== match.game.turn()) return ack && ack({ ok: false, error: "Nicht am Zug." });
      // Deduct elapsed think time first; flag if it ran out.
      const now = Date.now();
      const turn = match.game.turn();
      match.clocks[turn] = Math.max(0, match.clocks[turn] - (now - match.turnStart));
      if (match.clocks[turn] <= 0) {
        const winnerP = [...match.players.values()].find((p) => p.color !== turn);
        finish(match, { winner: winnerP, reason: "timeout" });
        return ack && ack({ ok: false, error: "Zeit abgelaufen." });
      }
      let mv;
      try { mv = match.game.move({ from, to, promotion: promotion || "q" }); }
      catch { mv = null; }
      if (!mv) return ack && ack({ ok: false, error: "Ungültiger Zug." });
      match.clocks[turn] += match.inc; // increment
      match.turnStart = now;
      match.lastMove = { from: mv.from, to: mv.to };
      ack && ack({ ok: true });

      // Game over?
      if (match.game.isCheckmate()) {
        finish(match, { winner: me, reason: "checkmate" });
      } else if (match.game.isStalemate()) {
        finish(match, { draw: true, reason: "stalemate" });
      } else if (match.game.isDraw() || match.game.isThreefoldRepetition() || match.game.isInsufficientMaterial()) {
        finish(match, { draw: true, reason: "draw" });
      } else {
        broadcast(match.code);
      }
    });

    socket.on("chess:resign", (ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack && ack({ ok: false, error: "Kein laufendes Spiel." });
      const me = match.players.get(socket.data.account);
      const opp = [...match.players.values()].find((p) => p.id !== socket.data.account);
      if (me && opp) finish(match, { winner: opp, reason: "resign" });
      ack && ack({ ok: true });
    });

    socket.on("chess:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });

  // ── Leaderboards / Clan-Liga ─────────────────────────────
  function allWithChess() {
    const out = [];
    const raw = accounts.rawAll ? accounts.rawAll() : []; // rawAll() → array of account objects
    for (const a of raw) {
      if (!a || typeof a.chessRating !== "number") continue;
      const games = (a.chessWins || 0) + (a.chessLosses || 0) + (a.chessDraws || 0);
      if (games === 0) continue;
      // clans.tagOf/clanColorOf take an account key but normalize their arg, so the display name resolves.
      out.push({ name: a.name, rating: a.chessRating, wins: a.chessWins || 0, losses: a.chessLosses || 0, draws: a.chessDraws || 0, games, clan: a.clan || null });
    }
    return out;
  }
  function playerLeaderboard(limit = 15) {
    return allWithChess().sort((a, b) => b.rating - a.rating).slice(0, limit)
      .map((p) => ({ name: p.name, rating: p.rating, wins: p.wins, losses: p.losses, draws: p.draws, tag: clans.tagOf(p.name) }));
  }
  function clanLeague(limit = 15) {
    const byClan = new Map();
    for (const p of allWithChess()) {
      if (!p.clan) continue;
      const c = byClan.get(p.clan) || { id: p.clan, tag: clans.tagOf(p.name), color: clans.clanColorOf(p.name), wins: 0, rating: 0, members: 0 };
      c.wins += p.wins; c.rating += p.rating; c.members += 1;
      byClan.set(p.clan, c);
    }
    return [...byClan.values()]
      .map((c) => ({ ...c, avgRating: Math.round(c.rating / c.members) }))
      .sort((a, b) => b.wins - a.wins || b.avgRating - a.avgRating)
      .slice(0, limit);
  }

  io.on("connection", (socket) => {
    socket.on("chess:leaderboards", (ack) => {
      if (typeof ack !== "function") return;
      const a = socket.data.account && accounts.get(socket.data.account);
      if (a) ensureChessStats(a);
      ack({
        ok: true,
        players: playerLeaderboard(),
        clans: clanLeague(),
        me: a ? { rating: a.chessRating, wins: a.chessWins || 0, losses: a.chessLosses || 0, draws: a.chessDraws || 0 } : null,
      });
    });
  });
}

module.exports = { setupChess, CHESS_RAKE: RAKE, CHESS_TIME_CONTROLS: TIME_CONTROLS };
