"use strict";

const OWNER = "vincent";
const city = require("./city");
const slots = require("./slots");

function setupAdmin(io, accounts) {
  io.on("connection", (socket) => {
    function isOwner() {
      return socket.data.account === OWNER;
    }

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

module.exports = { setupAdmin };
