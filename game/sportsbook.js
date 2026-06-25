"use strict";

/**
 * Sportsbook — SIMULATED football betting (the always-on backbone of the hybrid
 * plan; real fixtures can be layered in later behind an API key).
 *
 * A rolling pool of matches is generated continuously. Each match has a betting
 * window, then kicks off and is simulated (a Poisson goal model derived from the
 * two teams' strengths), the live score builds over a short compressed window,
 * and bets settle. Several markets per match (1X2, Over/Under 2.5, both-to-score)
 * with odds priced off the same model + a house margin. Everyone can SEE what
 * others are backing: per-selection stake/backer aggregates plus a live bet feed.
 *
 * No lobby — it's a shared public board. Play money only; settle pays winners and
 * routes the house margin through the casino rake like the other house games.
 */

const crypto = require("crypto");

const MARGIN = 0.08;            // house overround baked into the odds
const MAX_OPEN = 5;            // keep this many matches taking bets
const BET_WINDOW_MS = 80_000;  // betting open before kickoff
const LIVE_MS = 24_000;        // compressed 90-minute match
const DONE_LINGER_MS = 20_000; // show the result this long, then drop it
const MIN_BET = 50;
const MAX_BET = 5_000_000;
const FEED_MAX = 18;

const LEAGUES = {
  bl: { name: "Bundesliga", emoji: "🇩🇪", teams: [
    ["Bayern", 92], ["Leverkusen", 86], ["Dortmund", 83], ["Leipzig", 82], ["Stuttgart", 78],
    ["Frankfurt", 75], ["Freiburg", 72], ["Bremen", 69], ["Augsburg", 66], ["Bochum", 61] ] },
  pl: { name: "Premier League", emoji: "🏴", teams: [
    ["Man City", 93], ["Arsenal", 88], ["Liverpool", 87], ["Tottenham", 80], ["Chelsea", 79],
    ["Newcastle", 77], ["Brighton", 73], ["Fulham", 69], ["Everton", 66], ["Luton", 60] ] },
  es: { name: "La Liga", emoji: "🇪🇸", teams: [
    ["Real Madrid", 92], ["Barcelona", 89], ["Girona", 82], ["Atlético", 84], ["Bilbao", 78],
    ["Sociedad", 76], ["Betis", 72], ["Valencia", 70], ["Sevilla", 71], ["Cádiz", 60] ] },
};

let nextId = 1;
const matches = new Map(); // id -> match
const feed = [];           // recent bets across the board

// ── Poisson maths (for both the simulation and the odds) ──────────────────
function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function samplePoisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function lambdas(homeStr, awayStr) {
  const ratio = homeStr / awayStr;
  const lh = Math.max(0.25, Math.min(4, 1.35 * Math.pow(ratio, 0.8) * 1.12)); // home advantage
  const la = Math.max(0.2, Math.min(4, 1.15 * Math.pow(1 / ratio, 0.8)));
  return { lh, la };
}

/** Fair market probabilities from the goal model (grid 0..8). */
function marketProbs(lh, la) {
  let pHome = 0, pDraw = 0, pAway = 0, pOver = 0, pBtts = 0;
  const ph = [], pa = [];
  for (let i = 0; i <= 8; i++) { ph[i] = poissonPmf(lh, i); pa[i] = poissonPmf(la, i); }
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    const p = ph[h] * pa[a];
    if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
    if (h + a >= 3) pOver += p;
    if (h >= 1 && a >= 1) pBtts += p;
  }
  return { pHome, pDraw, pAway, pOver, pUnder: 1 - pOver, pBtts, pNoBtts: 1 - pBtts };
}
const odds = (p) => Math.max(1.04, Math.round((1 / Math.max(p, 0.001)) / (1 + MARGIN) * 100) / 100);

function buildMarkets(lh, la) {
  const p = marketProbs(lh, la);
  return {
    "1x2":  { label: "Sieger",          sels: { home: odds(p.pHome), draw: odds(p.pDraw), away: odds(p.pAway) } },
    "ou25": { label: "Über/Unter 2,5",  sels: { over: odds(p.pOver), under: odds(p.pUnder) } },
    "btts": { label: "Beide treffen",   sels: { yes: odds(p.pBtts), no: odds(p.pNoBtts) } },
  };
}

function createMatch() {
  const lkey = pick(Object.keys(LEAGUES));
  const lg = LEAGUES[lkey];
  const [h, a] = pickTwo(lg.teams);
  const { lh, la } = lambdas(h[1], a[1]);
  const now = Date.now();
  const m = {
    id: nextId++, league: lkey, leagueName: lg.name, leagueEmoji: lg.emoji,
    home: h[0], away: a[0], homeStr: h[1], awayStr: a[1], lh, la,
    createdAt: now, kickoff: now + BET_WINDOW_MS, state: "open",
    minute: 0, score: { h: 0, a: 0 }, goals: null, doneAt: 0,
    markets: buildMarkets(lh, la), bets: [], result: null,
  };
  matches.set(m.id, m);
  return m;
}

// ── Settlement ────────────────────────────────────────────────────────────
function selWins(market, selection, score) {
  const tot = score.h + score.a;
  if (market === "1x2") return selection === (score.h > score.a ? "home" : score.h === score.a ? "draw" : "away");
  if (market === "ou25") return selection === (tot >= 3 ? "over" : "under");
  if (market === "btts") return selection === (score.h >= 1 && score.a >= 1 ? "yes" : "no");
  return false;
}

function settle(m, accounts, io) {
  const winners = new Set();
  for (const b of m.bets) {
    if (selWins(b.market, b.selection, m.score)) {
      let payout = Math.floor(b.amount * b.odds); // decimal odds include stake
      const boost = accounts.buffMult(b.user, "winBoost");
      if (boost > 1) payout = Math.round(payout * boost);
      accounts.adjustChips(b.user, payout);
      accounts.recordHand(b.user, payout - b.amount); // house game → casino rake on the margin
      b.won = true; b.payout = payout;
      winners.add(b.user);
    } else {
      accounts.recordHand(b.user, -b.amount);
      b.won = false; b.payout = 0;
    }
  }
  m.result = {
    score: { ...m.score },
    outcome: m.score.h > m.score.a ? "home" : m.score.h === m.score.a ? "draw" : "away",
  };
  // Winnings are credited server-side; push fresh balances so the topbar updates live.
  if (io && winners.size) {
    for (const s of io.of("/").sockets.values()) {
      if (winners.has(s.data.account)) {
        const acc = accounts.get(s.data.account);
        if (acc) s.emit("account:update", { account: accounts.publicAccount(acc) });
      }
    }
  }
}

// ── Tick loop ─────────────────────────────────────────────────────────────
function setupSportsbook(io, accounts) {
  while (matches.size < MAX_OPEN) staggerCreate();

  function staggerCreate() {
    const m = createMatch();
    // Stagger kickoffs so the board always has imminent and fresh matches.
    m.kickoff = Date.now() + 15_000 + Math.floor(Math.random() * BET_WINDOW_MS);
  }

  function tick() {
    const now = Date.now();
    let changed = false;
    for (const m of matches.values()) {
      if (m.state === "open" && now >= m.kickoff) {
        // Kick off: simulate the final score + goal minutes for a live reveal.
        m.state = "live";
        const fh = samplePoisson(m.lh), fa = samplePoisson(m.la);
        const goals = [];
        for (let i = 0; i < fh; i++) goals.push({ team: "h", minute: 1 + crypto.randomInt(90) });
        for (let i = 0; i < fa; i++) goals.push({ team: "a", minute: 1 + crypto.randomInt(90) });
        goals.sort((x, y) => x.minute - y.minute);
        m.goals = goals; m.finalH = fh; m.finalA = fa; m.liveStart = now;
        changed = true;
      } else if (m.state === "live") {
        const frac = Math.min(1, (now - m.liveStart) / LIVE_MS);
        const minute = Math.min(90, Math.floor(frac * 90));
        if (minute !== m.minute) {
          m.minute = minute;
          let h = 0, a = 0;
          for (const g of m.goals) { if (g.minute <= minute) { if (g.team === "h") h++; else a++; } }
          if (h !== m.score.h || a !== m.score.a) { m.score.h = h; m.score.a = a; }
          changed = true;
        }
        if (frac >= 1) {
          m.minute = 90; m.score = { h: m.finalH, a: m.finalA };
          settle(m, accounts, io);
          m.state = "done"; m.doneAt = now;
          changed = true;
        }
      } else if (m.state === "done" && now - m.doneAt > DONE_LINGER_MS) {
        matches.delete(m.id);
        changed = true;
      }
    }
    while (matches.size < MAX_OPEN) { staggerCreate(); changed = true; }
    if (changed) io.emit("sports:update");
  }
  setInterval(tick, 1000);

  io.on("connection", (socket) => {
    socket.on("sports:state", (ack) => {
      if (typeof ack === "function") ack({ ok: true, ...stateFor(socket.data.account) });
    });

    socket.on("sports:bet", ({ matchId, market, selection, amount } = {}, ack) => {
      if (!socket.data.account) return ack && ack({ ok: false, error: "Bitte zuerst einloggen." });
      const m = matches.get(Number(matchId));
      if (!m || m.state !== "open") return ack && ack({ ok: false, error: "Wetten geschlossen." });
      const mk = m.markets[market];
      if (!mk || !(selection in mk.sels)) return ack && ack({ ok: false, error: "Ungültiger Markt." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < MIN_BET) return ack && ack({ ok: false, error: `Mindesteinsatz ${MIN_BET} 🪙.` });
      if (amount > MAX_BET) return ack && ack({ ok: false, error: `Maximaleinsatz ${MAX_BET.toLocaleString("de-DE")} 🪙.` });
      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < amount) return ack && ack({ ok: false, error: "Nicht genug Chips." });

      const r = accounts.adjustChips(socket.data.account, -amount);
      const odds = mk.sels[selection];
      m.bets.push({ id: crypto.randomUUID(), user: socket.data.account, name: acc.name, market, selection, amount, odds });
      feed.unshift({ name: acc.name, match: `${m.home}–${m.away}`, sel: selLabel(market, selection, m), amount, odds });
      if (feed.length > FEED_MAX) feed.length = FEED_MAX;
      ack && ack({ ok: true, account: r.account });
      io.emit("sports:update");
    });

    socket.on("disconnect", () => {});
  });

  function stateFor(viewerKey) {
    const now = Date.now();
    const list = [...matches.values()]
      .sort((a, b) => (a.state === b.state ? a.kickoff - b.kickoff : order(a.state) - order(b.state)))
      .map((m) => publicMatch(m, viewerKey, now));
    return { matches: list, feed: feed.slice(0, FEED_MAX) };
  }
}

const order = (s) => (s === "live" ? 0 : s === "open" ? 1 : 2);

function publicMatch(m, viewerKey, now) {
  // Per-selection book: total stake + backer count, so everyone sees the action.
  const book = {};
  for (const [mk, def] of Object.entries(m.markets)) {
    book[mk] = {};
    for (const sel of Object.keys(def.sels)) book[mk][sel] = { stake: 0, backers: 0 };
  }
  const myBets = [];
  for (const b of m.bets) {
    const cell = book[b.market] && book[b.market][b.selection];
    if (cell) { cell.stake += b.amount; cell.backers += 1; }
    if (b.user === viewerKey) myBets.push({ market: b.market, selection: b.selection, amount: b.amount, odds: b.odds, won: b.won, payout: b.payout });
  }
  return {
    id: m.id, league: m.leagueName, leagueEmoji: m.leagueEmoji,
    home: m.home, away: m.away, state: m.state,
    kickoffIn: Math.max(0, Math.round((m.kickoff - now) / 1000)),
    minute: m.minute, score: m.score,
    markets: m.markets, book, myBets,
    result: m.result,
  };
}

function selLabel(market, selection, m) {
  if (market === "1x2") return selection === "home" ? m.home : selection === "away" ? m.away : "Unentschieden";
  if (market === "ou25") return selection === "over" ? "Über 2,5" : "Unter 2,5";
  if (market === "btts") return selection === "yes" ? "Beide treffen" : "Nicht beide";
  return selection;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTwo(arr) {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * arr.length);
  while (j === i) j = Math.floor(Math.random() * arr.length);
  return [arr[i], arr[j]];
}

module.exports = { setupSportsbook };
