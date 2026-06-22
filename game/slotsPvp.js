"use strict";

/**
 * Slots PvP — two players, equal starting match-chips, each spins their own
 * allotment with their own luck; whoever has more match-chips at the end wins
 * the pot (both buy-ins). Match-chips are separate from the account balance;
 * only the buy-in (at start) and the pot (at end) touch real account chips.
 */

const { evaluateSpin, MACHINE_BY_ID, MACHINES, BET_LEVELS } = require("./slots");

const MACHINE_IDS = MACHINES.map((m) => m.id);
function randomMachineId() {
  return MACHINE_IDS[Math.floor(Math.random() * MACHINE_IDS.length)];
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const START_CHIPS = 1000; // match-chips each player starts with
const SPINS = 20; // paid spins each (free spins don't count)
const MIN_BUYIN = 10; // free-form buy-in, this is just the floor
const RAKE = 0.15; // 15% of the pot is removed (economy sink); winner gets the rest
const MIN_BET = BET_LEVELS[0];

function setupPvp(io, accounts) {
  const matches = new Map(); // code -> match

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    } while (matches.has(code));
    return code;
  }

  function stateFor(match, viewerKey) {
    const players = [...match.players.values()];
    const me = match.players.get(viewerKey);
    const opp = players.find((p) => p.id !== viewerKey);
    const pub = (p) => p && { name: p.name, chips: p.chips, spinsLeft: p.spinsLeft, done: p.done };
    return {
      code: match.code,
      state: match.state,
      buyIn: match.buyIn,
      pot: match.pot,
      vsBot: !!match.vsBot,
      machineId: match.machineId || null,
      machineName: match.machineId ? MACHINE_BY_ID[match.machineId].name : null,
      bet: match.bet || null,
      startChips: match.startChips || START_CHIPS,
      spins: SPINS,
      playerCount: match.players.size,
      isHost: match.host === viewerKey,
      you: pub(me),
      opponent: pub(opp),
      result: match.result,
    };
  }

  function broadcast(code) {
    const match = matches.get(code);
    if (!match) return;
    for (const p of match.players.values()) {
      if (p.socket) p.socket.emit("pvp:state", stateFor(match, p.id));
    }
  }

  function currentMatch(socket) {
    const code = socket.data.pvpCode;
    return code ? matches.get(code) : null;
  }

  function leaveCurrent(socket) {
    const match = currentMatch(socket);
    if (!match) return;
    const key = socket.data.account;
    const wasPlaying = match.state === "playing";
    match.players.delete(key);
    socket.leave(match.code);
    socket.data.pvpCode = null;

    // Tear the match down once no human (socket-bearing) player remains. This
    // also reaps finished bot matches, whose socketless bot would otherwise
    // keep players.size > 0 and leak the match object forever.
    const humansLeft = [...match.players.values()].some((p) => p.socket);
    if (!humansLeft) {
      matches.delete(match.code);
      return;
    }
    // Walkover: someone left mid-match → remaining player wins the pot.
    if (wasPlaying && match.players.size === 1) {
      settle(match);
    } else {
      broadcast(match.code);
    }
  }

  function settle(match) {
    if (match.state === "done") return;
    match.state = "done";
    const players = [...match.players.values()];
    let winner = null;
    if (players.length === 1) {
      winner = players[0]; // walkover
    } else {
      const [a, b] = players;
      if (a.chips > b.chips) winner = a;
      else if (b.chips > a.chips) winner = b;
    }

    // 15% of the pot is raked (removed from circulation); winner gets the rest.
    // Bot duels are house-funded and rake-free (see pvp:createBot).
    let rake = 0;
    let payout = 0;
    if (winner) {
      rake = match.vsBot ? 0 : Math.floor(match.pot * RAKE);
      payout = match.pot - rake;
      accounts.adjustChips(winner.id, payout);
    } else {
      // tie → refund buy-ins, no rake
      players.forEach((p) => accounts.adjustChips(p.id, match.buyIn));
    }

    match.result = {
      winner: winner ? winner.name : null,
      tie: !winner,
      pot: match.pot,
      rake,
      payout,
      walkover: players.length === 1,
      players: players.map((p) => ({ name: p.name, chips: p.chips })),
    };

    for (const p of players) {
      if (p.socket) {
        const acc = accounts.get(p.id);
        if (acc) p.socket.emit("account:update", { account: accounts.publicAccount(acc) });
      }
    }
    broadcast(match.code);
  }

  io.on("connection", (socket) => {
    socket.on("pvp:create", ({ buyIn } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN) return ack && ack({ ok: false, error: `Mindest-Buy-in ${MIN_BUYIN} 🪙.` });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      const match = {
        code,
        buyIn,
        pot: 0,
        state: "waiting",
        host: socket.data.account,
        players: new Map(),
        result: null,
      };
      match.players.set(socket.data.account, {
        id: socket.data.account, name: acc.name, socket,
        chips: 0, spinsLeft: 0, session: null, done: false,
      });
      matches.set(code, match);
      socket.join(code);
      socket.data.pvpCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
    });

    // Play a duel against a bot — no rake, bot is slightly handicapped.
    // Bot spins are pre-simulated but revealed one at a time (800ms after
    // each player spin) so the duel feels live rather than instant.
    socket.on("pvp:createBot", ({ buyIn } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      buyIn = Math.floor(Number(buyIn));
      if (!Number.isFinite(buyIn) || buyIn < MIN_BUYIN) return ack && ack({ ok: false, error: `Mindest-Buy-in ${MIN_BUYIN} 🪙.` });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      const code = makeCode();
      // Random machine (regardless of unlocks); fixed bet = its minimum.
      const machineId = randomMachineId();
      const m = MACHINE_BY_ID[machineId];
      const bet = m.bets[0];
      const startChips = bet * SPINS;

      // Pre-simulate bot's 20 paid spins; store chip count after each paid spin
      // (including any free spins that spin triggered, so the bot plays free spins
      // just like a real player would — they just happen instantly in the simulation).
      const botSimSpins = [];
      let simChips = startChips;
      let botFreeSession = null;
      for (let i = 0; i < SPINS; i++) {
        if (simChips < bet) break;
        simChips -= bet;
        const { result, session: s1 } = evaluateSpin(m, bet, null);
        botFreeSession = s1;
        simChips += Math.floor(result.totalWin * 0.88);
        // Play out any earned free spins immediately (no chip cost).
        while (botFreeSession && botFreeSession.remaining > 0) {
          const { result: fr, session: s2 } = evaluateSpin(m, bet, botFreeSession);
          botFreeSession = s2;
          simChips += Math.floor(fr.totalWin * 0.88);
        }
        botSimSpins.push(simChips);
      }

      const match = {
        code, buyIn, pot: buyIn * 2, state: "playing", vsBot: true,
        machineId, bet, startChips,
        host: socket.data.account, players: new Map(), result: null,
      };
      // Human pays the buy-in; bot's stake is house-funded.
      accounts.adjustChips(socket.data.account, -buyIn);
      socket.emit("account:update", { account: accounts.publicAccount(accounts.get(socket.data.account)) });
      match.players.set(socket.data.account, {
        id: socket.data.account, name: acc.name, socket,
        chips: startChips, spinsLeft: SPINS, session: null, done: false,
      });
      // Bot starts with full chips; reveals one spin per player spin.
      const bot = {
        id: "bot", name: "🤖 Bot", socket: null,
        chips: startChips, spinsLeft: SPINS,
        simSpins: botSimSpins, revealedSpins: 0,
        session: null, done: false,
      };
      match.players.set("bot", bot);
      matches.set(code, match);
      socket.join(code);
      socket.data.pvpCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
    });

    socket.on("pvp:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const match = matches.get(code);
      if (!match) return ack && ack({ ok: false, error: "Match nicht gefunden." });
      if (match.state !== "waiting") return ack && ack({ ok: false, error: "Match läuft bereits." });
      if (match.players.size >= 2 && !match.players.has(socket.data.account))
        return ack && ack({ ok: false, error: "Match ist voll." });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < match.buyIn) return ack && ack({ ok: false, error: "Nicht genug Chips für den Buy-in." });

      leaveCurrent(socket);
      match.players.set(socket.data.account, {
        id: socket.data.account, name: acc.name, socket,
        chips: 0, spinsLeft: 0, session: null, done: false,
      });
      socket.join(code);
      socket.data.pvpCode = code;
      ack && ack({ ok: true, code });
      broadcast(code);
    });

    socket.on("pvp:start", (ack) => {
      const match = currentMatch(socket);
      if (!match) return ack && ack && ack({ ok: false, error: "Kein Match." });
      if (match.host !== socket.data.account) return ack && ack && ack({ ok: false, error: "Nur der Host startet." });
      if (match.state !== "waiting") return;
      if (match.players.size !== 2) return ack && ack && ack({ ok: false, error: "Warte auf 2 Spieler." });

      // Both must afford the buy-in; deduct into the pot.
      const players = [...match.players.values()];
      for (const p of players) {
        const acc = accounts.get(p.id);
        if (!acc || acc.chips < match.buyIn) return ack && ack && ack({ ok: false, error: `${p.name} hat nicht genug Chips.` });
      }
      // Random machine for both (regardless of unlocks); fixed bet = its minimum.
      match.machineId = randomMachineId();
      match.bet = MACHINE_BY_ID[match.machineId].bets[0];
      match.startChips = match.bet * SPINS;

      match.pot = 0;
      for (const p of players) {
        accounts.adjustChips(p.id, -match.buyIn);
        match.pot += match.buyIn;
        p.chips = match.startChips;
        p.spinsLeft = SPINS;
        p.session = null;
        p.done = false;
        if (p.socket) {
          const acc = accounts.get(p.id);
          p.socket.emit("account:update", { account: accounts.publicAccount(acc) });
        }
      }
      match.state = "playing";
      match.result = null;
      ack && ack && ack({ ok: true });
      broadcast(match.code);
    });

    socket.on("pvp:spin", (_payload, ack) => {
      if (!ack) return;
      const match = currentMatch(socket);
      if (!match || match.state !== "playing") return ack({ ok: false, error: "Kein laufendes Match." });
      const player = match.players.get(socket.data.account);
      if (!player || player.done) return ack({ ok: false, error: "Du bist fertig." });

      // Machine & bet are fixed by the match (randomly assigned) — client choice is ignored.
      const machine = MACHINE_BY_ID[match.machineId];
      const bet = match.bet;

      const session = player.session && player.session.machineId === match.machineId && player.session.remaining > 0
        ? player.session : null;
      const inFree = !!session;
      if (!inFree) {
        if (player.chips < bet) return ack({ ok: false, error: "Nicht genug Match-Chips." });
        player.chips -= bet;
        player.spinsLeft -= 1;
      }

      const { result, session: newSession, totalWin } = evaluateSpin(machine, bet, session);
      player.session = newSession;
      player.chips += totalWin;

      const stillFree = player.session && player.session.remaining > 0;
      if (!stillFree && (player.spinsLeft <= 0 || player.chips < bet)) player.done = true;

      ack({ ...result, chips: player.chips, spinsLeft: player.spinsLeft, done: player.done });
      broadcast(match.code);

      // For bot matches: reveal the next bot spin 800 ms after the player's PAID
      // spin only — free spins don't count toward the bot's reveal cadence.
      if (match.vsBot && !inFree) {
        const bot = match.players.get("bot");
        if (bot && !bot.done) {
          setTimeout(() => {
            if (match.state !== "playing") return;
            if (bot.revealedSpins < bot.simSpins.length) {
              bot.revealedSpins++;
              bot.chips = bot.simSpins[bot.revealedSpins - 1];
              bot.spinsLeft = Math.max(0, SPINS - bot.revealedSpins);
            }
            if (bot.revealedSpins >= bot.simSpins.length || bot.chips < match.bet) bot.done = true;
            broadcast(match.code);
            if ([...match.players.values()].every((p) => p.done)) settle(match);
          }, 800);
        }
      }

      if ([...match.players.values()].every((p) => p.done)) settle(match);
    });

    socket.on("pvp:leave", () => leaveCurrent(socket));
    socket.on("disconnect", () => leaveCurrent(socket));
  });
}

module.exports = { setupPvp, PVP_MIN_BUYIN: MIN_BUYIN, PVP_RAKE: RAKE, PVP_START_CHIPS: START_CHIPS, PVP_SPINS: SPINS };
