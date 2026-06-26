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

// Master strength ratings (0–100). Sim teams come from LEAGUES; the extras below
// cover clubs/nations that real fixtures (football-data.org) may bring in, so we
// can price odds for them too. Unknown teams fall back to STRENGTH_DEFAULT.
const STRENGTH_DEFAULT = 70;
const TEAM_STRENGTHS = {};
for (const lg of Object.values(LEAGUES)) for (const [n, s] of lg.teams) TEAM_STRENGTHS[n] = s;
Object.assign(TEAM_STRENGTHS, {
  // More top clubs (UCL / other leagues)
  "Inter": 86, "Milan": 81, "Juventus": 82, "Napoli": 82, "Roma": 78, "Atalanta": 80,
  "PSG": 89, "Monaco": 76, "Marseille": 74, "Porto": 78, "Benfica": 79, "Sporting": 79,
  "Ajax": 75, "PSV": 77, "Feyenoord": 76, "Celtic": 72, "Galatasaray": 74,
  "Union Berlin": 70, "Mönchengladbach": 71, "Wolfsburg": 72, "Hoffenheim": 70, "Mainz": 67, "Köln": 66, "Heidenheim": 64, "Darmstadt": 60,
  "Aston Villa": 80, "West Ham": 74, "Man United": 81, "Brentford": 71, "Crystal Palace": 70, "Wolves": 69, "Nottingham": 66, "Bournemouth": 68, "Burnley": 61, "Sheffield United": 59,
  "Villarreal": 74, "Osasuna": 70, "Mallorca": 68, "Getafe": 68, "Celta": 66, "Granada": 61, "Almería": 60, "Las Palmas": 67, "Rayo": 67, "Alavés": 65,
  // National teams (for World Cup / Euro)
  "Deutschland": 86, "Frankreich": 91, "Spanien": 89, "England": 88, "Brasilien": 90,
  "Argentinien": 91, "Portugal": 87, "Niederlande": 85, "Italien": 84, "Belgien": 83,
  "Kroatien": 82, "Marokko": 80, "Japan": 78, "Schweiz": 78,
  // WC 2026 squads — football-data.org returns ENGLISH shortNames, so key on those.
  "France": 91, "Argentina": 91, "Brazil": 90, "Spain": 89, "England": 88, "Portugal": 87,
  "Germany": 86, "Netherlands": 85, "Belgium": 84, "Croatia": 82, "Uruguay": 82, "Colombia": 80,
  "Morocco": 80, "Senegal": 79, "Switzerland": 78, "Austria": 78, "Norway": 78, "Japan": 78,
  "Mexico": 77, "USA": 77, "Turkey": 77, "Ecuador": 77, "Korea Republic": 76, "Sweden": 75,
  "Bosnia-H.": 75, "Egypt": 75, "Ivory Coast": 75, "Algeria": 74, "Iran": 73, "Czechia": 74,
  "Scotland": 73, "Canada": 73, "Ghana": 73, "Paraguay": 72, "Tunisia": 72, "Congo DR": 72,
  "Australia": 72, "South Africa": 71, "Saudi Arabia": 70, "Panama": 70, "Qatar": 69,
  "Uzbekistan": 68, "Iraq": 68, "Jordan": 67, "Cape Verde": 67, "New Zealand": 66,
  "Haiti": 64, "Curaçao": 63,
});
// Aliases map the long names some APIs use onto our canonical keys.
const TEAM_ALIASES = {
  "FC Bayern München": "Bayern", "Bayer 04 Leverkusen": "Leverkusen", "Borussia Dortmund": "Dortmund",
  "RB Leipzig": "Leipzig", "VfB Stuttgart": "Stuttgart", "Eintracht Frankfurt": "Frankfurt",
  "SC Freiburg": "Freiburg", "SV Werder Bremen": "Bremen", "FC Augsburg": "Augsburg", "VfL Bochum 1848": "Bochum",
  "Manchester City FC": "Man City", "Arsenal FC": "Arsenal", "Liverpool FC": "Liverpool",
  "Tottenham Hotspur FC": "Tottenham", "Chelsea FC": "Chelsea", "Newcastle United FC": "Newcastle",
  "Manchester United FC": "Man United", "Aston Villa FC": "Aston Villa", "West Ham United FC": "West Ham",
  "Real Madrid CF": "Real Madrid", "FC Barcelona": "Barcelona", "Girona FC": "Girona",
  "Club Atlético de Madrid": "Atlético", "Athletic Club": "Bilbao", "Real Sociedad de Fútbol": "Sociedad",
  "Real Betis Balompié": "Betis", "Valencia CF": "Valencia", "Sevilla FC": "Sevilla",
};
function normName(s) { return String(s || "").replace(/\s+(FC|CF|SC|SV|AFC|AC)\b/gi, "").trim(); }
function strengthOf(name) {
  if (!name) return STRENGTH_DEFAULT;
  if (TEAM_STRENGTHS[name] != null) return TEAM_STRENGTHS[name];
  if (TEAM_ALIASES[name] && TEAM_STRENGTHS[TEAM_ALIASES[name]] != null) return TEAM_STRENGTHS[TEAM_ALIASES[name]];
  const n = normName(name);
  if (TEAM_STRENGTHS[n] != null) return TEAM_STRENGTHS[n];
  for (const k of Object.keys(TEAM_STRENGTHS)) if (name.includes(k) || n.includes(k)) return TEAM_STRENGTHS[k];
  return STRENGTH_DEFAULT;
}

// ── Real fixtures (football-data.org) — activates only when a token is set ──
const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";
const FD_COMPS = (process.env.FOOTBALL_DATA_COMPS || "WC").split(",").map((s) => s.trim()).filter(Boolean);
const FD_POLL_MS = 3 * 60 * 1000;              // refresh fixtures every 3 min (free tier = 10 req/min)
const REAL_ID_BASE = 1_000_000_000;            // keep real match ids in a separate numeric space
const COMP_META = {
  BL1: { name: "Bundesliga", emoji: "🇩🇪" }, PL: { name: "Premier League", emoji: "🏴" },
  PD: { name: "La Liga", emoji: "🇪🇸" }, SA: { name: "Serie A", emoji: "🇮🇹" },
  FL1: { name: "Ligue 1", emoji: "🇫🇷" }, CL: { name: "Champions League", emoji: "🏆" },
  WC: { name: "WM", emoji: "🌍" }, EC: { name: "EM", emoji: "🇪🇺" },
};
const NEUTRAL_COMPS = new Set(["WC", "EC", "CL"]); // played at neutral venues → no home edge

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

function lambdas(homeStr, awayStr, neutral = false) {
  const BASE = 1.32;                 // average goals per side
  const K = 1.25;                    // strength sensitivity (higher → clearer favourites)
  const ratio = homeStr / awayStr;
  const homeAdv = neutral ? 1.0 : 1.12;  // no venue edge at neutral tournaments (World Cup)
  const awayAdv = neutral ? 1.0 : 0.90;
  const lh = Math.max(0.2, Math.min(4.5, BASE * Math.pow(ratio, K) * homeAdv));
  const la = Math.max(0.2, Math.min(4.5, BASE * Math.pow(1 / ratio, K) * awayAdv));
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

// Simulated filler games can be turned off (SPORTS_SIM=off) to show ONLY real
// fixtures (e.g. World-Cup-only). On by default.
const SIM_ENABLED = process.env.SPORTS_SIM !== "off";

// ── Tick loop ─────────────────────────────────────────────────────────────
function setupSportsbook(io, accounts) {
  if (SIM_ENABLED) while (matches.size < MAX_OPEN) staggerCreate();

  function staggerCreate() {
    const m = createMatch();
    // Stagger kickoffs so the board always has imminent and fresh matches.
    m.kickoff = Date.now() + 15_000 + Math.floor(Math.random() * BET_WINDOW_MS);
  }

  const simCount = () => [...matches.values()].filter((m) => !m.real).length;

  function tick() {
    const now = Date.now();
    let changed = false;
    for (const m of matches.values()) {
      if (m.real) {
        // Real fixtures are driven by the poller; here we just lock betting at
        // the real kickoff and reap long-finished ones.
        if (m.state === "open" && now >= m.kickoff) { m.state = "live"; changed = true; }
        else if (m.state === "done" && now - m.doneAt > 6 * 60 * 60 * 1000) { matches.delete(m.id); changed = true; }
        continue;
      }
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
    while (SIM_ENABLED && simCount() < MAX_OPEN) { staggerCreate(); changed = true; }
    if (changed) io.emit("sports:update");
  }
  setInterval(tick, 1000);

  // ── Real fixtures poller (football-data.org) ──────────────────────────────
  async function pollReal() {
    if (!FD_TOKEN) return;
    const today = new Date();
    const dateFrom = new Date(today.getTime() - 2 * 864e5).toISOString().slice(0, 10);
    const dateTo = new Date(today.getTime() + 10 * 864e5).toISOString().slice(0, 10);
    for (const code of FD_COMPS) {
      try {
        const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
          { headers: { "X-Auth-Token": FD_TOKEN } });
        if (!res.ok) { console.warn(`[sports] ${code} fixtures HTTP ${res.status}`); continue; }
        const data = await res.json();
        for (const am of data.matches || []) upsertReal(am, code);
      } catch (e) { console.warn(`[sports] poll ${code} failed:`, e.message); }
      await new Promise((r) => setTimeout(r, 6500)); // space calls (free tier: 10/min)
    }
    io.emit("sports:update");
  }

  function upsertReal(am, code) {
    const id = REAL_ID_BASE + am.id;
    const home = am.homeTeam && (am.homeTeam.shortName || am.homeTeam.name);
    const away = am.awayTeam && (am.awayTeam.shortName || am.awayTeam.name);
    if (!home || !away) return;
    const st = am.status;
    const ft = (am.score && am.score.fullTime) || {};
    const score = { h: ft.home ?? 0, a: ft.away ?? 0 };
    let m = matches.get(id);
    if (!m) {
      const homeStr = strengthOf(home), awayStr = strengthOf(away);
      const { lh, la } = lambdas(homeStr, awayStr, NEUTRAL_COMPS.has(code)); // WC/EC/CL = neutral venue
      const meta = COMP_META[code] || { name: code, emoji: "⚽" };
      m = {
        id, real: true, league: meta.name, leagueEmoji: meta.emoji, competition: meta.name,
        home, away, homeStr, awayStr, lh, la,
        kickoff: new Date(am.utcDate).getTime(), kickoffAt: am.utcDate,
        state: "open", minute: 0, score: { h: 0, a: 0 }, doneAt: 0,
        markets: buildMarkets(lh, la), bets: [], result: null, settled: false, apiStatus: st,
      };
      matches.set(id, m);
    }
    m.apiStatus = st;
    if (st === "IN_PLAY" || st === "PAUSED") { m.state = "live"; m.score = score; m.minute = am.minute || 0; }
    else if (st === "FINISHED") {
      m.score = score;
      if (!m.settled) { m.settled = true; settle(m, accounts, io); m.state = "done"; m.doneAt = Date.now(); }
    } else if (Date.now() < m.kickoff) m.state = "open"; // SCHEDULED / TIMED
  }

  if (FD_TOKEN) {
    console.log(`[sports] real fixtures ON (${FD_COMPS.join(",")})`);
    pollReal();
    setInterval(pollReal, FD_POLL_MS);
  }

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
      .sort((a, b) => {
        if (!!a.real !== !!b.real) return a.real ? -1 : 1;       // real (WC) highlights first
        if (a.state !== b.state) return order(a.state) - order(b.state); // live, then open, then done
        return a.kickoff - b.kickoff;
      })
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
    id: m.id, league: m.leagueName || m.league, leagueEmoji: m.leagueEmoji,
    real: !!m.real, kickoffAt: m.kickoffAt || null,
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

/** For tooling/tests: a team's outcome chances + fair home odds vs an opponent. */
function teamChances(strength, oppStrength = 75) {
  const { lh, la } = lambdas(strength, oppStrength);
  const p = marketProbs(lh, la);
  return { win: p.pHome, draw: p.pDraw, loss: p.pAway, homeOdds: odds(p.pHome) };
}

module.exports = { setupSportsbook, TEAM_STRENGTHS, LEAGUES, teamChances, strengthOf };
