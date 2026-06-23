"use strict";

const OWNER = "vincent";
const city = require("./city");

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
  });
}

module.exports = { setupAdmin };
