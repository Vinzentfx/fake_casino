"use strict";

/**
 * Fake-Casino server.
 *
 * Serves the static frontend (public/), exposes the play-money account API,
 * and runs the real-time poker tables over Socket.IO.
 *
 * Play money only — see game/accounts.js for the storage/security note.
 */

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const accounts = require("./game/accounts");
const { setupPoker } = require("./game/tableManager");
const { setupSlots } = require("./game/slots");
const { setupPvp } = require("./game/slotsPvp");
const { setupAdmin } = require("./game/admin");
const { setupBlackjack } = require("./game/blackjack");

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// HTTP / account API
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", (req, res) => {
  const result = accounts.login(req.body.name, req.body.pin);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ created: result.created, account: result.account });
});

app.post("/api/daily-bonus", (req, res) => {
  const result = accounts.claimDailyBonus(req.body.name);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  res.json({ amount: result.amount, account: result.account });
});

app.get("/api/account/:name", (req, res) => {
  const acc = accounts.get(req.params.name);
  if (!acc) return res.status(404).json({ error: "Account nicht gefunden." });
  res.json({ account: accounts.publicAccount(acc) });
});

app.get("/api/leaderboard", (_req, res) => {
  res.json({ leaderboard: accounts.leaderboard(10) });
});

// ---------------------------------------------------------------------------
// Server + Socket.IO (poker)
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server);

setupPoker(io, accounts);
setupSlots(io, accounts);
setupPvp(io, accounts);
setupAdmin(io, accounts);
setupBlackjack(io, accounts);

server.listen(PORT, () => {
  console.log(`🎰 Fake-Casino läuft auf http://localhost:${PORT}`);
});
