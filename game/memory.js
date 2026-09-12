"use strict";

/**
 * Memory-Duell, Paare suchen gegeneinander, abwechselnd.
 *
 * Beide spielen auf einem gemischten Brett mit verdeckten Paaren. Wer dran ist,
 * dreht zwei Karten um: ein Paar zählt und man darf noch mal, sonst werden sie
 * wieder umgedreht und der andere ist dran. Wer am Ende die meisten Paare hat,
 * bekommt den Topf (beide Buy-ins) minus Rake. Unentschieden gibt beiden das
 * Buy-in zurück.
 *
 * Nur gegen Menschen, kein Bot: Memory ist ein Geschicklichkeitsspiel, einen
 * Zufallsbot könnte man abfarmen. Chips wandern nur zwischen den beiden, der
 * Rake verschwindet. Das Brett liegt auf dem Server, Kartenseiten gehen erst
 * an den Client, wenn sie umgedreht werden.
 *
 * Match und Lobby laufen fast wie in slotsPvp.js.
 */

const crypto = require("crypto");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAKE = 0.10;            // 10 % des Topfs verschwinden, der Gewinner bekommt den Rest
const MIN_BUYIN = 50;
const MAX_BUYIN = 1_000_000;
const FLIP_BACK_MS = 1100;    // so lange bleibt ein falsches Paar offen, bevor es sich zurückdreht

// Brettgrößen (Anzahl Paare): klein 12 Karten, mittel 20, groß 30.
const SIZES = { small: 6, medium: 10, large: 15 };
const DEFAULT_SIZE = "medium";
const sizePairs = (size) => SIZES[size] || SIZES[DEFAULT_SIZE];

// Kartenmotive, ein Emoji je Paar (Index 0..pairs-1). Muss fürs größte Brett reichen.
const FACES = ["🍒", "🍋", "🔔", "⭐", "💎", "🍀", "🎲", "👑", "🚀", "🐬",
  "🦄", "🎁", "🌈", "🍉", "🦋", "🐱", "🎈", "🍩"];

function shuffledBoard(pairs) {
  const ids = [];
  for (let i = 0; i < pairs; i++) ids.push(i, i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.map((id) => ({ id, matchedBy: null }));
}

function setupMemory(io, accounts) {
  const matches = new Map(); // je Code: Match

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

  // Öffentliches Brett: nur gefundene Paare und die gerade umgedrehten Karten zeigen.
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
      size: match.size,
      buyIn: match.buyIn,
      pot: match.pot,
      pairsTotal: match.pairs,
      board: publicBoard(match),
      playerCount: match.players.size,
      isHost: match.host === viewerKey,
      yourTurn: match.state === "playing" && match.turn === viewerKey && !match.locked,
      turnName: (() => { const t = match.players.get(match.turn); return t ? t.name : null; })(),
      you: pub(me),
      opponent: pub(opp),
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
    for (const p of match.players.values()) {
      if (p.socket) p.socket.emit("memory:state", stateFor(match, p.id));
    }
  }

  function describe(match) {
    const host = match.players.get(match.host);
    return {
      code: match.code,
      game: "memory",
      label: `Memory-Duell (${match.pairs * 2} Karten)`,
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
    // Kampflos: jemand ist mitten im Match gegangen, der andere bekommt den Topf.
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
      rake = forcedWinner ? 0 : Math.floor(match.pot * RAKE); // kampflos: kein Rake, ganzer Topf
      payout = match.pot - rake;
      accounts.adjustChips(winner.id, payout);
      // Ein echter Sieg (nicht kampflos) zählt für Clan-Liga und Krieg.
      if (!forcedWinner) { try { require("./clans").recordPvpWin(winner.id, "memory"); } catch {} }
    } else {
      players.forEach((p) => accounts.adjustChips(p.id, match.buyIn)); // Unentschieden: Einsatz zurück
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
    match.board = shuffledBoard(match.pairs);
    match.flipped = [];
    match.locked = false;
    match.rematchWant = [];
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
    lobby.changed(); // läuft jetzt, fällt aus der Liste der offenen Lobbys
  }

  io.on("connection", (socket) => {
    socket.on("memory:create", ({ buyIn, isPublic = true, size = DEFAULT_SIZE } = {}, ack) => {
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN)
        return typeof ack === "function" && ack({ ok: false, error: `Buy-in zwischen ${MIN_BUYIN} und ${MAX_BUYIN.toLocaleString("de-DE")} Chips.` });
      if (!SIZES[size]) size = DEFAULT_SIZE;
      const a = acc(socket);
      if (!a || a.chips < buyIn) return typeof ack === "function" && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      const match = {
        code, buyIn, pot: 0, state: "waiting", public: !!isPublic, size, pairs: sizePairs(size),
        host: socket.data.account, players: new Map(),
        board: [], flipped: [], locked: false, turn: null, flipTimer: null, result: null,
      };
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, pairs: 0 });
      matches.set(code, match);
      socket.join(code);
      socket.data.memoryCode = code;
      // Öffentliche Matches stehen in der Lobby-Liste, private gehen nur per Code.
      if (match.public) registerLobby(code);
      typeof ack === "function" && ack({ ok: true, code, public: match.public });
      broadcast(code);
    });

    socket.on("memory:join", ({ code } = {}, ack) => {
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
      match.players.set(socket.data.account, { id: socket.data.account, name: a.name, socket, pairs: 0 });
      socket.join(code);
      socket.data.memoryCode = code;
      typeof ack === "function" && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("memory:start", (ack) => {
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

    socket.on("memory:flip", ({ index } = {}, ack) => {
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return typeof ack === "function" && ack({ ok: false, error: "Kein laufendes Match." });
      if (match.locked) return typeof ack === "function" && ack({ ok: false, error: "Kurz warten…" });
      if (match.turn !== socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Nicht dein Zug." });
      index = Math.floor(Number(index));
      if (!Number.isFinite(index) || index < 0 || index >= match.board.length)
        return typeof ack === "function" && ack({ ok: false, error: "Ungültige Karte." });
      const card = match.board[index];
      if (card.matchedBy != null || match.flipped.includes(index))
        return typeof ack === "function" && ack({ ok: false, error: "Karte schon offen." });
      if (match.flipped.length >= 2) return typeof ack === "function" && ack({ ok: false, error: "Kurz warten…" });

      match.flipped.push(index);
      typeof ack === "function" && ack({ ok: true });

      if (match.flipped.length < 2) { broadcast(match.code); return; }

      // Zweite Karte umgedreht, jetzt auswerten.
      const [i, j] = match.flipped;
      const isMatch = match.board[i].id === match.board[j].id;
      if (isMatch) {
        const me = match.players.get(match.turn);
        match.board[i].matchedBy = match.turn;
        match.board[j].matchedBy = match.turn;
        me.pairs += 1;
        match.flipped = [];
        broadcast(match.code); // wer ein Paar findet, bleibt dran
        if (match.board.every((c) => c.matchedBy != null)) settle(match);
      } else {
        // Beide zeigen, dann nach kurzer Pause zurückdrehen und abgeben.
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

    socket.on("memory:rematch", (ack) => {
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

    socket.on("memory:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

module.exports = { setupMemory, MEMORY_RAKE: RAKE, MEMORY_MIN_BUYIN: MIN_BUYIN };
