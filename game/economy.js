"use strict";

/**
 * Economy: the work clicker (a capped bootstrap, NOT an idle game) plus the
 * shared-city actions (buy/sell land, build, buy out & take over businesses).
 *
 * The city no longer pays passive income — owning a building grants a BUFF, and
 * buying anything is a chip SINK. Real chips come from playing the games. The
 * clicker exists only to help a broke/new player scrape together a first stake;
 * it's deliberately capped so it never competes with the games or the city.
 */

const city = require("./city");
const stocks = require("./stocks");
const chat = require("./chat");
const achievements = require("./achievements");
const quests = require("./quests");
const weekly = require("./weekly");

// ─── Work clicker (capped) ──────────────────────────────────────────────────
const MAX_CLICK_LEVEL = 5;     // a few upgrades, then it's maxed out
const CLICK_POWER_BY_LEVEL = [2, 4, 7, 11, 16, 22];
const clickUpgradeCost = (lvl) => 200 * (lvl + 1); // lvl 0→200, 1→400, … 4→1000
const HUSTLE_TARGET = 25;      // valid work clicks per bonus
const HUSTLE_MIN_GAP = 180;    // clicks faster than this don't build hustle
const HUSTLE_HOUR_CAP = 10000;
const HUSTLE_DAY_CAP = 60000;
const WORK_FACTOR_WINDOW = 15 * 60 * 1000;
const JOB_HOUR_CAP = 32000;
const JOB_DAY_CAP = 150000;
const JOBS = {
  delivery: { label: "Lieferdienst", cooldown: 28_000, base: 170, xp: 2, task: "route" },
  promo: { label: "Casino-Promo", cooldown: 50_000, base: 95, xp: 9, task: "code" },
  side: { label: "Riskanter Nebenjob", cooldown: 95_000, base: 230, xp: 4, risky: true, task: "crate" },
  shift: { label: "Schichtarbeit", duration: 75_000, cooldown: 125_000, base: 980, xp: 12, task: "switches" },
};
const dayNow = () => Math.floor(Date.now() / 86400000);
const TASK_TTL = 35_000;
const WORK_SYMBOLS = ["A", "B", "C", "D", "E", "F"];
const WORK_CRATES = ["Rot", "Blau", "Gelb"];

function shuffle(xs) {
  const arr = [...xs];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeWorkTask(id, job, now = Date.now()) {
  const type = job.task || "code";
  if (type === "route") {
    const route = shuffle(WORK_SYMBOLS).slice(0, 4);
    return {
      id, type, expiresAt: now + TASK_TTL, answer: route.join(""),
      public: { id, type, title: "Route planen", prompt: "Tippe die Stopps in der angezeigten Reihenfolge an.", route, options: shuffle(route) },
    };
  }
  if (type === "crate") {
    const safe = WORK_CRATES[Math.floor(Math.random() * WORK_CRATES.length)];
    return {
      id, type, expiresAt: now + TASK_TTL, answer: safe.toLowerCase(),
      public: { id, type, title: "Lieferkiste prüfen", prompt: `Wähle die ${safe}-markierte Kiste.`, options: shuffle(WORK_CRATES) },
    };
  }
  if (type === "switches") {
    const pattern = Array.from({ length: 5 }, () => (Math.random() < 0.5 ? "1" : "0")).join("");
    return {
      id, type, expiresAt: now + TASK_TTL + 10_000, answer: pattern,
      public: { id, type, title: "Schaltpult einstellen", prompt: "Stelle die Schalter exakt wie das Muster ein.", pattern },
    };
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  return {
    id, type: "code", expiresAt: now + TASK_TTL, answer: code,
    public: { id, type: "code", title: "Promo-Code synchronisieren", prompt: "Tippe den Code ab, bevor der Auftrag verfällt.", code },
  };
}

function normalizeTaskAnswer(answer) {
  if (Array.isArray(answer)) return answer.join("");
  return String(answer || "").trim().toLowerCase().replace(/\s+/g, "");
}

function ensureEconomy(acc) {
  if (!acc.economy) acc.economy = {};
  const e = acc.economy;
  if (typeof e.clickLevel !== "number") {
    e.clickLevel = e.clickPower ? Math.min(MAX_CLICK_LEVEL, e.clickPower - 1) : 0;
  }
  return e;
}

const clickPower = (e) => CLICK_POWER_BY_LEVEL[Math.max(0, Math.min(MAX_CLICK_LEVEL, e.clickLevel || 0))] || CLICK_POWER_BY_LEVEL[0];

function workFactorFor(nw) {
  if (nw < 50000) return 4;
  if (nw < 250000) return 2.5;
  if (nw < 1000000) return 1.5;
  if (nw < 10000000) return 0.6;
  return 0.2;
}

function workFactorState(acc, e, now) {
  const nw = Math.max(0, Math.floor((accountsPublicNetWorth(acc)) || 0));
  if (!e.workNwAt || now - e.workNwAt >= WORK_FACTOR_WINDOW) {
    e.workNwAt = now;
    e.workNwPeak = nw;
  } else {
    e.workNwPeak = Math.max(e.workNwPeak || 0, nw);
  }
  const smoothed = Math.max(nw, e.workNwPeak || 0);
  return { netWorth: nw, smoothedNetWorth: smoothed, factor: workFactorFor(smoothed) };
}

function ensureJobState(e, now = Date.now()) {
  e.jobs = e.jobs || { cooldowns: {} };
  if (!e.jobs.cooldowns) e.jobs.cooldowns = {};
  if (e.jobs.day !== dayNow()) { e.jobs.day = dayNow(); e.jobs.dayEarned = 0; }
  if (!e.jobs.hourAt || now - e.jobs.hourAt >= 3600000) { e.jobs.hourAt = now; e.jobs.hourEarned = 0; }
  if (e.jobs.activeShift && now - e.jobs.activeShift.startedAt > 6 * 3600000) delete e.jobs.activeShift;
  return e.jobs;
}

function jobRoom(jobs) {
  return Math.max(0, Math.min(JOB_HOUR_CAP - (jobs.hourEarned || 0), JOB_DAY_CAP - (jobs.dayEarned || 0)));
}

function publicJobs(acc, e, now = Date.now()) {
  const jobs = ensureJobState(e, now);
  activeTask(jobs, now);
  const factor = workFactorState(acc, e, now);
  return {
    factor,
    hourEarned: Math.floor(jobs.hourEarned || 0),
    hourCap: JOB_HOUR_CAP,
    dayEarned: Math.floor(jobs.dayEarned || 0),
    dayCap: JOB_DAY_CAP,
    activeShift: jobs.activeShift ? {
      readyAt: jobs.activeShift.readyAt,
      startedAt: jobs.activeShift.startedAt,
      label: JOBS.shift.label,
    } : null,
    activeTask: jobs.activeTask && jobs.activeTask.expiresAt > now ? jobs.activeTask.public : null,
    jobs: Object.entries(JOBS).map(([id, job]) => ({
      id,
      label: job.label,
      cooldownMs: job.cooldown || 0,
      durationMs: job.duration || 0,
      readyAt: jobs.cooldowns[id] || 0,
      payout: Math.max(1, Math.round(job.base * factor.factor)),
      xp: job.xp || 0,
      risky: !!job.risky,
    })),
  };
}

function awardJob(acc, key, e, job, now, mult = 1) {
  const jobs = ensureJobState(e, now);
  const factor = workFactorState(acc, e, now);
  const room = jobRoom(jobs);
  const raw = Math.max(1, Math.round(job.base * factor.factor * mult));
  const earned = Math.max(0, Math.min(room, raw));
  let publicAccount = accountsPublicAccount(acc);
  if (earned > 0) {
    const res = _accountsRef.adjustChips(key, earned);
    publicAccount = res.account || publicAccount;
    jobs.hourEarned = (jobs.hourEarned || 0) + earned;
    jobs.dayEarned = (jobs.dayEarned || 0) + earned;
  }
  if (job.xp) publicAccount = _accountsRef.addXp(key, job.xp) || publicAccount;
  try { quests.track(key, "work_job"); } catch {}
  return { earned, xp: job.xp || 0, account: publicAccount, capped: earned < raw, jobs: publicJobs(acc, e, now) };
}

function activeTask(jobs, now = Date.now()) {
  if (jobs.activeTask && jobs.activeTask.expiresAt <= now) delete jobs.activeTask;
  return jobs.activeTask || null;
}

function accountsPublicAccount(acc) {
  try { return _accountsRef.publicAccount(acc); } catch { return null; }
}

function accountsPublicNetWorth(acc) {
  try { return Number(_accountsRef.publicAccount(acc).netWorth) || 0; } catch { return acc.chips || 0; }
}

let _accountsRef = null;

function setupEconomy(io, accounts) {
  _accountsRef = accounts;
  const acct = (s) => (s.data.account ? accounts.get(s.data.account) : null);

  /** Tell everyone the shared city changed; clients re-pull city:state. */
  function broadcastCity() {
    io.emit("city:update");
  }

  // Per-ACCOUNT click rate limiter (~20/s) — keyed by account, not socket, so
  // opening extra tabs/sockets can't multiply the click faucet.
  const clickTimes = new Map();
  const CLICK_MAX = 20, CLICK_WINDOW = 1000;

  io.on("connection", (socket) => {
    // ── Work clicker ────────────────────────────────────────────────────────
    socket.on("work:click", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const now = Date.now();
      const key = socket.data.account;
      const times = (clickTimes.get(key) || []).filter((t) => now - t < CLICK_WINDOW);
      if (times.length >= CLICK_MAX) { clickTimes.set(key, times); return ack({ ok: false, error: "Zu schnell." }); }
      times.push(now); clickTimes.set(key, times);

      const e = ensureEconomy(acc);
      // Hourly earnings cap: with an autoclicker the 20/s rate limit alone
      // would still allow ~1M+/h — the clicker is a bootstrap, not a job.
      const HOUR = 3600000, CLICK_EARN_CAP = 35000;
      if (!e.clickHourAt || now - e.clickHourAt >= HOUR) { e.clickHourAt = now; e.clickEarned = 0; }
      if ((e.clickEarned || 0) >= CLICK_EARN_CAP)
        return ack({ ok: false, error: "Feierabend! Der Klick-Job ist für diese Stunde ausgeschöpft." });
      if (e.hustleDay !== dayNow()) { e.hustleDay = dayNow(); e.hustleDayEarned = 0; e.hustleClicks = 0; }
      if (!e.hustleHourAt || now - e.hustleHourAt >= HOUR) { e.hustleHourAt = now; e.hustleHourEarned = 0; }
      // Schulleiter trophy: education pays — clicks ×3.
      const schule = city.hasTrophy(key, "schule") ? 3 : 1;
      const factor = workFactorState(acc, e, now);
      let earned = Math.max(1, Math.round(clickPower(e) * schule * factor.factor));
      e.clickEarned = (e.clickEarned || 0) + earned;
      let hustleBonus = 0;
      const gap = now - (e.hustleLastClickAt || 0);
      e.hustleLastClickAt = now;
      const hustleEligible = gap >= HUSTLE_MIN_GAP;
      if (hustleEligible && (e.hustleDayEarned || 0) < HUSTLE_DAY_CAP && (e.hustleHourEarned || 0) < HUSTLE_HOUR_CAP) {
        e.hustleClicks = (e.hustleClicks || 0) + 1;
        if (e.hustleClicks >= HUSTLE_TARGET) {
          e.hustleClicks -= HUSTLE_TARGET;
          const rawBonus = 180 + e.clickLevel * 70;
          const room = Math.min(HUSTLE_DAY_CAP - (e.hustleDayEarned || 0), HUSTLE_HOUR_CAP - (e.hustleHourEarned || 0));
          hustleBonus = Math.max(0, Math.min(room, Math.round(rawBonus * factor.factor)));
          e.hustleDayEarned = (e.hustleDayEarned || 0) + hustleBonus;
          e.hustleHourEarned = (e.hustleHourEarned || 0) + hustleBonus;
          earned += hustleBonus;
        }
      }
      const res = accounts.adjustChips(key, earned);
      ack({
        ok: res.ok, account: res.account, earned, hustleBonus,
        jobs: publicJobs(acc, e, now),
        hustle: {
          clicks: e.hustleClicks || 0,
          target: HUSTLE_TARGET,
          hourEarned: Math.floor(e.hustleHourEarned || 0),
          hourCap: HUSTLE_HOUR_CAP,
          dayEarned: Math.floor(e.hustleDayEarned || 0),
          dayCap: HUSTLE_DAY_CAP,
          eligible: hustleEligible,
          factor: factor.factor,
          netWorth: factor.netWorth,
          smoothedNetWorth: factor.smoothedNetWorth,
        },
      });
    });

    socket.on("work:upgrade", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      if (e.clickLevel >= MAX_CLICK_LEVEL) return ack({ ok: false, error: "Schon voll ausgebaut — der Rest kommt aus den Spielen & der Stadt." });
      const cost = clickUpgradeCost(e.clickLevel);
      if (acc.chips < cost) return ack({ ok: false, error: "Nicht genug Chips." });
      e.clickLevel += 1;
      const res = accounts.adjustChips(socket.data.account, -cost);
      if (!res.ok) { e.clickLevel -= 1; return ack({ ok: false, error: res.error }); }
      ack({ ok: true, account: res.account, clickPower: clickPower(e), clickLevel: e.clickLevel, maxed: e.clickLevel >= MAX_CLICK_LEVEL });
    });

    socket.on("work:jobStart", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      const job = JOBS[id];
      if (!job) return ack({ ok: false, error: "Job nicht gefunden." });
      if (activeTask(jobs, now)) return ack({ ok: false, error: "Erledige erst deine laufende Aufgabe.", jobs: publicJobs(acc, e, now) });
      if ((jobs.cooldowns[id] || 0) > now) return ack({ ok: false, error: "Dieser Job hat noch Cooldown.", jobs: publicJobs(acc, e, now) });
      if (jobRoom(jobs) <= 0) return ack({ ok: false, error: "Feierabend! Dein Job-Cap ist aktuell ausgeschöpft.", jobs: publicJobs(acc, e, now) });

      if (id === "shift") {
        if (jobs.activeShift) return ack({ ok: false, error: "Du hast schon eine Schicht laufen.", jobs: publicJobs(acc, e, now) });
        jobs.activeShift = { startedAt: now, readyAt: now + job.duration };
        jobs.cooldowns[id] = now + job.cooldown;
        accounts.save();
        return ack({ ok: true, started: true, jobs: publicJobs(acc, e, now) });
      }

      let mult = 1, outcome = null;
      if (job.risky) {
        const roll = Math.random();
        if (roll < 0.22) { mult = 2.8; outcome = "bonus"; }
        else if (roll < 0.55) { mult = 0.35; outcome = "schwach"; }
        else outcome = "normal";
      }
      jobs.cooldowns[id] = now + job.cooldown;
      jobs.activeTask = {
        ...makeWorkTask(id, job, now),
        jobId: id,
        mult,
        outcome,
        shiftDone: false,
      };
      accounts.save();
      return ack({ ok: true, task: jobs.activeTask.public, jobs: publicJobs(acc, e, now) });
    });

    socket.on("work:shiftClaim", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      if (activeTask(jobs, now)) return ack({ ok: false, error: "Erledige erst deine laufende Aufgabe.", jobs: publicJobs(acc, e, now) });
      const shift = jobs.activeShift;
      if (!shift) return ack({ ok: false, error: "Keine aktive Schicht.", jobs: publicJobs(acc, e, now) });
      if (shift.readyAt > now) return ack({ ok: false, error: "Die Schicht läuft noch.", jobs: publicJobs(acc, e, now) });
      jobs.activeTask = {
        ...makeWorkTask("shift", JOBS.shift, now),
        jobId: "shift",
        mult: 1,
        outcome: "normal",
        shiftDone: true,
      };
      accounts.save();
      return ack({ ok: true, task: jobs.activeTask.public, jobs: publicJobs(acc, e, now) });
    });

    socket.on("work:taskComplete", ({ answer } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const now = Date.now();
      const jobs = ensureJobState(e, now);
      const task = activeTask(jobs, now);
      if (!task) return ack({ ok: false, error: "Keine aktive Aufgabe.", jobs: publicJobs(acc, e, now) });
      if (normalizeTaskAnswer(answer) !== normalizeTaskAnswer(task.answer)) {
        delete jobs.activeTask;
        accounts.save();
        return ack({ ok: false, error: "Aufgabe falsch gelöst. Auftrag fehlgeschlagen.", failed: true, jobs: publicJobs(acc, e, now) });
      }
      const job = JOBS[task.jobId];
      if (!job) { delete jobs.activeTask; accounts.save(); return ack({ ok: false, error: "Job nicht gefunden.", jobs: publicJobs(acc, e, now) }); }
      if (task.shiftDone) delete jobs.activeShift;
      delete jobs.activeTask;
      const result = awardJob(acc, socket.data.account, e, job, now, task.mult || 1);
      return ack({ ok: true, ...result, outcome: task.outcome, shiftDone: !!task.shiftDone });
    });

    socket.on("economy:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const maxed = e.clickLevel >= MAX_CLICK_LEVEL;
      const factor = workFactorState(acc, e, Date.now());
      ack({
        ok: true,
        clickPower: clickPower(e),
        clickLevel: e.clickLevel,
        maxClickLevel: MAX_CLICK_LEVEL,
        upgradeCost: maxed ? null : clickUpgradeCost(e.clickLevel),
        maxed,
        hustle: {
          clicks: e.hustleClicks || 0,
          target: HUSTLE_TARGET,
          hourEarned: Math.floor(e.hustleHourEarned || 0),
          hourCap: HUSTLE_HOUR_CAP,
          dayEarned: Math.floor(e.hustleDayEarned || 0),
          dayCap: HUSTLE_DAY_CAP,
          factor: factor.factor,
          netWorth: factor.netWorth,
          smoothedNetWorth: factor.smoothedNetWorth,
        },
        jobs: publicJobs(acc, e),
        schulleiter: city.hasTrophy(socket.data.account, "schule"), // Klicks ×3
      });
    });

    // ── Shared city (real map: districts → buildings) ─────────────────────
    socket.on("city:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      ack({ ok: true, overview: city.publicOverview(key) });
    });

    socket.on("city:district", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      const d = city.publicDistrict(id, key);
      if (!d) return ack({ ok: false, error: "Stadtteil nicht gefunden." });
      d.residents = accounts.residentsByBuilding(); // Wohnsitz flavour for the panel
      ack({ ok: true, district: d });
    });

    // Wohnsitz: free social flavour — "live" in any house on the map.
    socket.on("city:residence", ({ buildingId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.setResidence(socket.data.account, buildingId);
      if (!r.ok) return ack(r);
      ack({ ok: true, residence: r.residence, account: accounts.publicAccount(acc) });
      broadcastCity();
    });

    // Generic building action: validate, pay cost / receive gain, compensate a
    // dispossessed ex-owner (takeover), commit, broadcast. Conquests (new
    // street monopoly, boss change) are announced in the global chat, and
    // every action may complete an achievement.
    function doAction(socket, ack, make, districtId, buildingId) {
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = make(key, acc.name);
      if (!r.ok) return ack(r);
      if (r.cost && accounts.get(key).chips < r.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      const before = city.territorySnapshot();
      r.commit();
      let res;
      if (r.cost) res = accounts.adjustChips(key, -r.cost).account;
      else if (r.gain) res = accounts.adjustChips(key, r.gain).account;
      else res = accounts.publicAccount(accounts.get(key));
      // Takeover: the previous owner is compensated (premium above value burns).
      if (r.payout && r.payout.to && r.payout.to !== key && r.payout.amount > 0) {
        accounts.adjustChips(r.payout.to, r.payout.amount);
        // …and if there's a bounty on that rival, the raider collects it.
        const victim = accounts.get(r.payout.to);
        const bounty = accounts.claimBounty(r.payout.to, key);
        if (bounty > 0) {
          chat.announce(io, `🎯 KOPFGELD! ${acc.name} hat ${victim ? victim.name : "einem Rivalen"} ein Gebäude abgenommen und ${bounty.toLocaleString("de-DE")} 🪙 Kopfgeld kassiert!`);
          achievements.check(key);
        }
      }
      ack({
        ok: true, account: res, cost: r.cost || 0, gain: r.gain || 0,
        district: districtId ? city.publicDistrict(districtId, key) : null,
      });
      for (const msg of city.territoryDiff(before, city.territorySnapshot())) chat.announce(io, msg);
      // Buys & takeovers count for quests, but each building only once/day.
      if (r.cost) quests.track(key, "buy_house", 1, buildingId);
      achievements.check(key);
      broadcastCity();
    }

    const A = (fn) => ({ buildingId, districtId } = {}, ack) => {
      if (typeof ack !== "function") return;
      doAction(socket, ack, (key, name) => fn(buildingId, key, name), districtId, buildingId);
    };
    socket.on("city:buy",      A((id, key, name) => city.buyBuilding(id, key, name)));
    socket.on("city:sell",     A((id, key) => city.sellBuilding(id, key)));
    socket.on("city:takeover", A((id, key, name) => city.takeover(id, key, name)));

    // List one of your businesses on the stock market (IPO): raise capital
    // now, and it starts trading for everyone.
    socket.on("city:ipo", ({ buildingId, districtId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const key = socket.data.account;
      const r = city.listCompany(buildingId, key);
      if (!r.ok) return ack(r);
      const listed = stocks.ipo(key, r.name, r.seedPrice);
      r.commit();
      const res = accounts.adjustChips(key, r.raise);
      ack({ ok: true, raised: r.raise, sym: listed.sym, account: res.account, district: districtId ? city.publicDistrict(districtId, key) : null });
      broadcastCity();
    });

    // ── Rivalen / Kopfgeld ────────────────────────────────────────────────
    socket.on("bounty:place", ({ target, amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.placeBounty(socket.data.account, target, amount);
      if (!r.ok) return ack(r);
      chat.announce(io, `🎯 KOPFGELD ausgesetzt: ${(accounts.get(socket.data.account) || {}).name || "?"} setzt ${Math.floor(amount).toLocaleString("de-DE")} 🪙 auf ${r.targetName} — übernimm ein Gebäude von ${r.targetName}, um es zu kassieren!`);
      ack(r);
    });

    // ── Login-Kalender ────────────────────────────────────────────────────
    socket.on("calendar:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...accounts.calendarState(socket.data.account) });
    });
    socket.on("calendar:claim", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = accounts.claimCalendar(socket.data.account);
      if (r.ok) achievements.check(socket.data.account);
      ack(r);
    });

    // ── Glücksrad ─────────────────────────────────────────────────────────
    socket.on("wheel:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...accounts.wheelState(socket.data.account) });
    });
    socket.on("wheel:spin", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(accounts.spinWheel(socket.data.account));
    });

    socket.on("disconnect", () => clickTimes.delete(socket.id));
  });

  // Market life: per-district indices drift every minute; occasionally a local
  // news event shakes one district — everyone gets a toast (Spekulation!).
  // The same heartbeat drives the weekly cycle (Spieler der Woche, Goldene Straße).
  setInterval(() => {
    const event = city.tickMarket();
    io.emit("city:update");
    if (event) io.emit("city:news", event);
    weekly.tick(io, accounts);
  }, 60000).unref();
  weekly.tick(io, accounts); // seed golden street on boot
}

module.exports = { setupEconomy };
