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
const CLICK_BASE = 1;          // chips per click at level 0
const MAX_CLICK_LEVEL = 5;     // a few upgrades, then it's maxed out
const clickUpgradeCost = (lvl) => 200 * (lvl + 1); // lvl 0→200, 1→400, … 4→1000

function ensureEconomy(acc) {
  if (!acc.economy) acc.economy = {};
  const e = acc.economy;
  if (typeof e.clickLevel !== "number") {
    e.clickLevel = e.clickPower ? Math.min(MAX_CLICK_LEVEL, e.clickPower - 1) : 0;
  }
  return e;
}

const clickPower = (e) => CLICK_BASE + e.clickLevel;

function setupEconomy(io, accounts) {
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
      const HOUR = 3600000, CLICK_EARN_CAP = 10000;
      if (!e.clickHourAt || now - e.clickHourAt >= HOUR) { e.clickHourAt = now; e.clickEarned = 0; }
      if ((e.clickEarned || 0) >= CLICK_EARN_CAP)
        return ack({ ok: false, error: "Feierabend! Der Klick-Job ist für diese Stunde ausgeschöpft." });
      // Schulleiter trophy: education pays — clicks ×3.
      const schule = city.hasTrophy(key, "schule") ? 3 : 1;
      const earned = Math.round(clickPower(e) * schule);
      e.clickEarned = (e.clickEarned || 0) + earned;
      const res = accounts.adjustChips(key, earned);
      ack({ ok: res.ok, account: res.account, earned });
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

    socket.on("economy:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(socket);
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const e = ensureEconomy(acc);
      const maxed = e.clickLevel >= MAX_CLICK_LEVEL;
      ack({
        ok: true,
        clickPower: clickPower(e),
        clickLevel: e.clickLevel,
        maxClickLevel: MAX_CLICK_LEVEL,
        upgradeCost: maxed ? null : clickUpgradeCost(e.clickLevel),
        maxed,
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
