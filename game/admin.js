"use strict";

const OWNER = "vincent";
const city = require("./city");
const slots = require("./slots");
const liveops = require("./liveops");
let _heist = null;
function setHeist(h) { _heist = h; }

function setupAdmin(io, accounts) {
  io.on("connection", (socket) => {
    function isOwner() {
      return socket.data.account === OWNER;
    }

    socket.on("admin:dashboard", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const all = accounts.listAll();
      const onlineMap = new Map();
      for (const s of io.of("/").sockets.values()) {
        if (!s.data || !s.data.account) continue;
        const key = String(s.data.account).toLowerCase();
        const cur = onlineMap.get(key) || { name: key, sockets: 0 };
        cur.sockets += 1;
        onlineMap.set(key, cur);
      }
      const onlineAccounts = Array.from(onlineMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      const topWinners = all
        .filter((a) => (a.weeklyNet || 0) > 0)
        .sort((a, b) => (b.weeklyNet || 0) - (a.weeklyNet || 0))
        .slice(0, 5);
      const topLosers = all
        .filter((a) => (a.weeklyNet || 0) < 0)
        .sort((a, b) => (a.weeklyNet || 0) - (b.weeklyNet || 0))
        .slice(0, 5);
      const alerts = all
        .filter((a) => (a.biggestWin || 0) >= 1_000_000 || (a.biggestLoss || 0) >= 1_000_000)
        .sort((a, b) => Math.max(b.biggestWin || 0, b.biggestLoss || 0) - Math.max(a.biggestWin || 0, a.biggestLoss || 0))
        .slice(0, 6);
      ack({
        ok: true,
        dashboard: {
          generatedAt: Date.now(),
          online: {
            sockets: Array.from(io.of("/").sockets.values()).filter((s) => s.data && s.data.account).length,
            accounts: onlineAccounts.length,
            players: onlineAccounts,
          },
          totals: {
            accounts: all.length,
            chips: all.reduce((sum, a) => sum + (a.chips || 0), 0),
            bank: all.reduce((sum, a) => sum + (a.savings || 0), 0),
          },
          events: {
            liveops: typeof liveops.publicState === "function" ? liveops.publicState() : null,
            heistActive: !!(_heist && typeof _heist.active === "function" && _heist.active()),
          },
          topWinners,
          topLosers,
          alerts,
        },
      });
    });

    socket.on("admin:listAccounts", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, accounts: accounts.listAll() });
    });

    socket.on("admin:setChips", ({ target, amount } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(target);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 0) return ack({ ok: false, error: "Ungültiger Betrag." });
      const delta = amount - acc.chips;
      const res = accounts.adjustChips(String(target).toLowerCase(), delta);
      if (!res.ok) return ack({ ok: false, error: res.error });
      // Notify the target if they're online
      io.of("/").sockets.forEach((s) => {
        if (s.data.account === String(target).toLowerCase()) {
          s.emit("account:update", { account: res.account });
        }
      });
      ack({ ok: true, account: res.account });
    });

    socket.on("admin:ban", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const res = accounts.ban(String(target).toLowerCase());
      if (res.ok) {
        io.of("/").sockets.forEach((s) => {
          if (s.data.account === String(target).toLowerCase()) {
            s.emit("admin:kicked", { reason: "Dein Account wurde gesperrt." });
            s.disconnect(true);
          }
        });
      }
      ack(res);
    });

    socket.on("admin:unban", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(accounts.unban(String(target).toLowerCase()));
    });

    // Shadowban ("Pechvogel"): the player silently loses every slots spin and
    // every solo roulette round — they just think they're unlucky.
    socket.on("admin:shadowban", ({ target, on } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(accounts.setShadowban(String(target).toLowerCase(), !!on));
    });

    socket.on("admin:deleteAccount", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target).toLowerCase();
      // Kick them off if online
      io.of("/").sockets.forEach((s) => {
        if (s.data.account === key) {
          s.emit("admin:kicked", { reason: "Dein Account wurde gelöscht." });
          s.disconnect(true);
        }
      });
      ack(accounts.deleteAccount(key));
    });

    socket.on("admin:clearBank", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target || "").toLowerCase();
      const acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const cleared = Math.floor((acc.savings && acc.savings.amount) || 0);
      acc.savings = { amount: 0, since: Date.now() };
      accounts.save();
      ack({ ok: true, cleared });
    });

    // Remove a player from a specific leaderboard by zeroing the stat behind it.
    socket.on("admin:resetStat", ({ target, stat } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target).toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      acc.stats = acc.stats || { gamesPlayed: 0, handsWon: 0, biggestWin: 0, biggestLoss: 0 };
      if (stat === "bigwin") acc.stats.biggestWin = 0;
      else if (stat === "bigloss") acc.stats.biggestLoss = 0;
      else if (stat === "games") { acc.stats.gamesPlayed = 0; acc.stats.handsWon = 0; acc.stats.perGame = {}; }
      else return ack({ ok: false, error: "Unbekannte Kategorie." });
      accounts.save();
      ack({ ok: true });
    });

    // List all owned city lots (for the admin "free a building" panel).
    socket.on("admin:cityLots", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, lots: city.ownedLots() });
    });

    // Strip a building/lot from its owner (back to NPC). Broadcast so all open
    // city screens refresh.
    socket.on("admin:clearLot", ({ plotId } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const res = city.adminClearLot(plotId);
      if (res.ok) io.emit("city:update");
      ack(res);
    });

    // Wipe the whole shared city back to a fresh NPC start (after a price rebalance).
    socket.on("admin:resetCity", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      city.resetCity();
      io.emit("city:update");
      ack({ ok: true });
    });

    // ── Test-Tools (owner only) ──────────────────────────────────────────

    // Arm a one-shot MAX WIN on the owner's next slot spin (animation showcase).
    socket.on("admin:slotsForceWin", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      slots.armForceWin(socket.data.account);
      ack({ ok: true });
    });

    // ── Live-Ops (owner only) ────────────────────────────────────────────
    socket.on("admin:happyHour", ({ on, minutes } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (on) liveops.startHappy(minutes || 60); else liveops.stopHappy();
      ack({ ok: true });
    });

    socket.on("admin:tourney", ({ on, minutes, prize } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (on) { const r = liveops.startTourney(minutes || 10, prize || 100000); return ack(r); }
      liveops.stopTourney();
      ack({ ok: true });
    });

    socket.on("admin:heist", ({ on, loot, seconds } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (!_heist) return ack({ ok: false, error: "Heist nicht bereit." });
      if (on) return ack(_heist.start(loot || 500000, seconds || 60));
      _heist.stop();
      ack({ ok: true });
    });

    // Fire a city news event now (random district if none given).
    socket.on("admin:cityEvent", ({ districtId } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const event = city.fireEvent(districtId || null);
      if (!event) return ack({ ok: false, error: "Kein Event möglich (Karte leer)." });
      io.emit("city:update");
      io.emit("city:news", event);
      ack({ ok: true, event });
    });

    // Reset a player's daily-bonus & rescue cooldowns (faucet testing).
    socket.on("admin:resetBonus", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      acc.lastBonusAt = 0;
      acc.lastRescueAt = 0;
      accounts.save();
      ack({ ok: true });
    });

    // Force the weekly rollover NOW (Spieler der Woche + neue Goldene Straße).
    socket.on("admin:newWeek", (ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      require("./weekly").forceRollover(io, accounts);
      ack({ ok: true });
    });

    // Wipe a player's achievements (re-test unlock flow; already paid rewards stay).
    socket.on("admin:resetAchievements", ({ target } = {}, ack) => {
      if (!ack) return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      acc.ach = {};
      accounts.save();
      ack({ ok: true });
    });
  });
}

module.exports = { setupAdmin, setHeist };
