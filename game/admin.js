"use strict";

/**
 * Tiny admin/cheat hook for testing: grant or set chips on the logged-in
 * account. Gated by a shared code (change ADMIN_CODE to lock it down).
 * Play money only.
 */

const ADMIN_CODE = process.env.ADMIN_CODE || "casino-admin";

function setupAdmin(io, accounts) {
  io.on("connection", (socket) => {
    // body: { code, amount, set } — set:true sets the absolute balance,
    // otherwise amount is added. Returns the updated account.
    socket.on("admin:grant", ({ code, amount, set } = {}, ack) => {
      if (!ack) return;
      if (code !== ADMIN_CODE) return ack({ ok: false, error: "Falscher Admin-Code." });
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });

      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount)) return ack({ ok: false, error: "Ungültiger Betrag." });

      const delta = set ? amount - acc.chips : amount;
      const res = accounts.adjustChips(socket.data.account, delta);
      if (!res.ok) return ack({ ok: false, error: res.error });

      socket.emit("account:update", { account: res.account });
      ack({ ok: true, account: res.account });
    });
  });
}

module.exports = { setupAdmin, ADMIN_CODE };
