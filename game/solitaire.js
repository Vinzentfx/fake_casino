"use strict";

/**
 * Solitaire (Klondike) — two modes over the shared engine (solitaireEngine.js):
 *
 *  • Solo vs. house ("sol:*"): pay a stake, play a HARD deal (draw-3, limited
 *    recycles). Clear the board → payout stake × WIN_MULT. Give up / disconnect
 *    → lose the stake. Low max bet + hard deal keep RTP < 100% and cap abuse.
 *    House game → recordHand feeds weekly net / quests like Mines.
 *
 *  • PvP race ("solrace:*"): both players get the SAME deal and race. First to
 *    clear wins the pot (both buy-ins) minus rake; on the time limit the higher
 *    foundation count wins, a tie refunds. Chips only move between players
 *    (rake is the sink) → not farmable. Mirrors memory.js / sudoku.js.
 */

const E = require("./solitaireEngine");
const lobby = require("./lobby");

// Solo (vs house)
const SOLO_MIN_BET = 20;
const SOLO_MAX_BET = 500;   // deliberately LOW — skill game, keep exposure small
const WIN_MULT = 3;         // clear the board → stake × 3 (hard deal → house edge holds)
const SOLO_DRAW = 3;
const SOLO_RECYCLES = 2;    // only 2 waste recycles → hard

// PvP race
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAKE = 0.10;
const RACE_MIN_BUYIN = 50;
const RACE_MAX_BUYIN = 1_000_000;
const RACE_TIME_MS = 12 * 60 * 1000;
const RACE_DRAW = 1;        // draw-1 → winnable races

/** Apply one move to an engine state. Returns { ok, error? }. */
function applyMove(state, m = {}) {
  switch (m.type) {
    case "draw": return E.drawStock(state);
    case "wf": return E.wasteToFoundation(state);
    case "wt": return E.wasteToTableau(state, m.col | 0);
    case "tf": return E.tableauToFoundation(state, m.col | 0);
    case "tt": return E.tableauToTableau(state, m.from | 0, m.to | 0, m.count | 0);
    case "ft": return E.foundationToTableau(state, m.s | 0, m.to | 0);
    case "auto": return E.autoComplete(state);
    default: return { ok: false, error: "Unbekannter Zug." };
  }
}

function setupSolitaire(io, accounts) {
  const acc = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  // ───────────────────────── Solo (vs house + free) ─────────────────
  function soloView(g, extra = {}) {
    return { ok: true, mode: "solo", free: !!g.free, bet: g.bet, over: g.over, winMult: g.free ? 0 : WIN_MULT, ...E.publicView(g.state), ...extra };
  }

  // ───────────────────────── PvP race ──────────────────────────────
  const matches = new Map();
  function makeCode() {
    let code;
    do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
    while (matches.has(code));
    return code;
  }
  const currentMatch = (socket) => { const c = socket.data.solraceCode; return c ? matches.get(c) : null; };

  function raceState(match, viewerKey) {
    const players = [...match.players.values()];
    const me = match.players.get(viewerKey);
    const opp = players.find((p) => p.id !== viewerKey);
    const pub = (p) => p && { name: p.name, foundations: p.state ? E.foundationCount(p.state) : 0, won: p.state ? E.isWon(p.state) : false };
    return {
      mode: "race", code: match.code, state: match.state, public: !!match.public,
      buyIn: match.buyIn, pot: match.pot,
      board: me && me.state && match.state === "playing" ? E.publicView(me.state) : null,
      timeLeft: match.state === "playing" ? Math.max(0, match.endsAt - Date.now()) : (match.state === "done" ? 0 : RACE_TIME_MS),
      playerCount: match.players.size, isHost: match.host === viewerKey,
      you: pub(me), opponent: pub(opp), result: match.result,
      rematch: (() => {
        const connected = [...match.players.values()].filter((p) => p.socket);
        const want = match.rematchWant || [];
        return {
          canRematch: match.state === "done" && connected.length === 2,
          youWant: want.includes(viewerKey),
          oppWants: connected.some((p) => p.id !== viewerKey && want.includes(p.id)),
        };
      })(),
    };
  }
  function raceBroadcast(code) {
    const match = matches.get(code);
    if (!match) return;
    for (const p of match.players.values()) if (p.socket) p.socket.emit("solrace:state", raceState(match, p.id));
  }
  function describe(match) {
    const host = match.players.get(match.host);
    return {
      code: match.code, game: "solrace", label: "🃏 Solitär-Race",
      host: host ? host.name : "?", players: [...match.players.values()].filter((p) => p.socket).length,
      max: 2, buyIn: match.buyIn, joinable: match.state === "waiting" && match.players.size < 2,
    };
  }
  const registerLobby = (code) => lobby.add(code, () => (matches.has(code) ? describe(matches.get(code)) : null));

  function raceLeave(socket) {
    const match = currentMatch(socket);
    if (!match) return;
    const wasPlaying = match.state === "playing";
    match.players.delete(socket.data.account);
    socket.leave(match.code);
    socket.data.solraceCode = null;
    const humansLeft = [...match.players.values()].some((p) => p.socket);
    if (!humansLeft) {
      if (match.timer) { clearTimeout(match.timer); match.timer = null; }
      matches.delete(match.code); lobby.remove(match.code); return;
    }
    if (wasPlaying && match.players.size === 1) raceSettle(match, { winner: [...match.players.values()][0], walkover: true });
    else { raceBroadcast(match.code); lobby.changed(); }
  }

  function raceSettle(match, opts = {}) {
    if (match.state === "done") return;
    match.state = "done";
    if (match.timer) { clearTimeout(match.timer); match.timer = null; }
    const players = [...match.players.values()];
    const walkover = !!opts.walkover;
    let winner = opts.winner || null;
    if (!winner && players.length === 2) {
      const [a, b] = players;
      const ca = E.foundationCount(a.state), cb = E.foundationCount(b.state);
      if (ca > cb) winner = a; else if (cb > ca) winner = b;
    }
    let rake = 0, payout = 0;
    if (winner) {
      rake = walkover ? 0 : Math.floor(match.pot * RAKE); payout = match.pot - rake; accounts.adjustChips(winner.id, payout);
      if (!walkover) { try { require("./clans").recordPvpWin(winner.id, "solitaire"); } catch {} }
    } else players.forEach((p) => accounts.adjustChips(p.id, match.buyIn));
    match.result = {
      winner: winner ? winner.name : null, tie: !winner, pot: match.pot, rake, payout, walkover,
      players: players.map((p) => ({ name: p.name, foundations: E.foundationCount(p.state) })),
    };
    for (const p of players) if (p.socket) { const a = accounts.get(p.id); if (a) p.socket.emit("account:update", { account: accounts.publicAccount(a) }); }
    raceBroadcast(match.code);
  }

  function raceStart(match) {
    const deck = E.makeDeck();
    match.rematchWant = [];
    match.pot = 0;
    for (const p of match.players.values()) {
      accounts.adjustChips(p.id, -match.buyIn);
      match.pot += match.buyIn;
      p.state = E.deal({ deck, draw: RACE_DRAW }); // identical deal for both
      if (p.socket) { const a = accounts.get(p.id); p.socket.emit("account:update", { account: accounts.publicAccount(a) }); }
    }
    match.state = "playing";
    match.result = null;
    match.endsAt = Date.now() + RACE_TIME_MS;
    match.timer = setTimeout(() => raceSettle(match), RACE_TIME_MS);
    raceBroadcast(match.code);
    lobby.changed();
  }

  io.on("connection", (socket) => {
    // ── Solo vs house ──
    socket.on("sol:start", ({ bet, free } = {}, ack) => {
      if (typeof ack !== "function") return;
      const a = acc(socket);
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (free) {
        // Free solo: no stake, easy deal (draw-1), UNLIMITED recycles → winnable.
        socket.data.solitaire = { state: E.deal({ draw: 1, recycles: Infinity }), bet: 0, free: true, over: false };
        return ack({ ...soloView(socket.data.solitaire) });
      }
      bet = Math.floor(Number(bet));
      if (!Number.isFinite(bet) || bet < SOLO_MIN_BET) return ack({ ok: false, error: `Mindesteinsatz ${SOLO_MIN_BET} 🪙.` });
      if (bet > SOLO_MAX_BET) return ack({ ok: false, error: `Maximaleinsatz ${SOLO_MAX_BET} 🪙 (schwer!).` });
      if (a.chips < bet) return ack({ ok: false, error: "Nicht genug Chips." });
      const r = accounts.adjustChips(socket.data.account, -bet);
      if (!r.ok) return ack({ ok: false, error: r.error });
      socket.data.solitaire = { state: E.deal({ draw: SOLO_DRAW, recycles: SOLO_RECYCLES }), bet, free: false, over: false };
      ack({ ...soloView(socket.data.solitaire), account: r.account });
    });

    socket.on("sol:move", (m, ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.solitaire;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      const res = applyMove(g.state, m);
      if (!res.ok) return ack({ ...soloView(g), moveError: res.error });
      if (E.isWon(g.state)) {
        g.over = true;
        const wacc = accounts.get(socket.data.account); if (wacc) wacc.solitaireClears = (wacc.solitaireClears || 0) + 1;
        if (g.free) {
          accounts.recordHand(socket.data.account, 0, true, "solitaire"); // stats/achievements, no payout
          return ack({ ...soloView(g, { won: true, payout: 0 }) });
        }
        const payout = g.bet * WIN_MULT;
        const r = accounts.adjustChips(socket.data.account, payout);
        accounts.recordHand(socket.data.account, payout - g.bet, true, "solitaire"); // → onHand → achievements.check
        return ack({ ...soloView(g, { won: true, payout }), account: r.account });
      }
      ack(soloView(g));
    });

    socket.on("sol:giveup", (ack) => {
      if (typeof ack !== "function") return;
      const g = socket.data.solitaire;
      if (!g || g.over) return ack({ ok: false, error: "Kein aktives Spiel." });
      g.over = true;
      if (!g.free) accounts.recordHand(socket.data.account, -g.bet, true, "solitaire"); // forfeit → loss (paid only)
      ack({ ...soloView(g, { gaveUp: true }) });
    });

    // ── PvP race ──
    socket.on("solrace:create", ({ buyIn, isPublic = true } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < RACE_MIN_BUYIN || buyIn > RACE_MAX_BUYIN)
        return ack && ack({ ok: false, error: `Buy-in ${RACE_MIN_BUYIN}–${RACE_MAX_BUYIN.toLocaleString("de-DE")} 🪙.` });
      const a = acc(socket);
      if (!a || a.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });
      raceLeave(socket);
      const code = makeCode();
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic,
        host: socket.data.account, players: new Map(), endsAt: 0, timer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, state: null });
      matches.set(code, match);
      socket.join(code); socket.data.solraceCode = code;
      if (match.public) registerLobby(code);
      ack && ack({ ok: true, code, public: match.public });
      raceBroadcast(code);
    });

    socket.on("solrace:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const match = matches.get(code);
      if (!match) return ack && ack({ ok: false, error: "Match nicht gefunden." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Match läuft bereits." });
      if (match.players.size >= 2 && !match.players.has(socket.data.account)) return ack && ack({ ok: false, error: "Match ist voll." });
      const a = acc(socket);
      if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });
      raceLeave(socket);
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, state: null });
      socket.join(code); socket.data.solraceCode = code;
      ack && ack({ ok: true, code });
      raceBroadcast(code); lobby.changed();
    });

    socket.on("solrace:start", (ack) => {
      const match = currentMatch(socket);
      if (!match) return ack && ack({ ok: false, error: "Kein Match." });
      if (match.host !== socket.data.account) return ack && ack({ ok: false, error: "Nur der Host startet." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Läuft bereits." });
      if (match.players.size !== 2) return ack && ack({ ok: false, error: "Warte auf 2 Spieler." });
      for (const p of match.players.values()) { const a = accounts.get(p.id); if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` }); }
      ack && ack({ ok: true });
      raceStart(match);
    });

    socket.on("solrace:move", (m, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack && ack({ ok: false, error: "Kein laufendes Match." });
      const me = match.players.get(socket.data.account);
      if (!me || !me.state) return ack && ack({ ok: false, error: "Nicht im Match." });
      const res = applyMove(me.state, m);
      if (!res.ok) return ack && ack({ ok: true, board: E.publicView(me.state), moveError: res.error });
      ack && ack({ ok: true, board: E.publicView(me.state) });
      raceBroadcast(match.code);
      if (E.isWon(me.state)) raceSettle(match, { winner: me });
    });

    socket.on("solrace:rematch", (ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "done") return ack && ack({ ok: false, error: "Kein beendetes Spiel." });
      const connected = [...match.players.values()].filter((p) => p.socket);
      if (connected.length !== 2) return ack && ack({ ok: false, error: "Gegner ist nicht mehr da." });
      for (const p of connected) { const a = accounts.get(p.id); if (!a || a.chips < match.buyIn) return ack && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` }); }
      match.rematchWant = match.rematchWant || [];
      if (!match.rematchWant.includes(socket.data.account)) match.rematchWant.push(socket.data.account);
      ack && ack({ ok: true });
      if (connected.every((p) => match.rematchWant.includes(p.id))) { match.rematchWant = []; raceStart(match); }
      else raceBroadcast(match.code);
    });

    socket.on("solrace:leave", () => raceLeave(socket));
    socket.on("disconnect", () => raceLeave(socket));
  });
}

module.exports = { setupSolitaire, SOLO_MIN_BET, SOLO_MAX_BET, WIN_MULT, SOLRACE_RAKE: RAKE };
