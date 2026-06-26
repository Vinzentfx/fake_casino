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
const { setupBlackjackLobby } = require("./game/blackjackLobby");
const { setupRoulette } = require("./game/roulette");
const { setupRouletteLobby } = require("./game/rouletteLobby");
const { setupSportsbook } = require("./game/sportsbook");
const { setupEconomy } = require("./game/economy");
const { setupBank } = require("./game/bank");
const { setupStocks } = require("./game/stocks");
const { setupMarket } = require("./game/market");
const { setupChat } = require("./game/chat");
const { setupLobby } = require("./game/lobby");

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
  res.json({
    created: result.created,
    account: result.account,
    token: result.token,
    config: { bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS },
  });
});

app.post("/api/daily-bonus", (req, res) => {
  const result = accounts.claimDailyBonus(req.body.name);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  res.json({ amount: result.amount, account: result.account });
});

app.post("/api/rescue", (req, res) => {
  const result = accounts.rescue(req.body.name);
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

app.post("/api/change-pin", (req, res) => {
  const result = accounts.changePin(req.body.name, req.body.oldPin, req.body.newPin);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Server + Socket.IO
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server);
io.sockets.setMaxListeners(50); // many game modules each add a connection listener

setupPoker(io, accounts);
setupSlots(io, accounts);
setupPvp(io, accounts);
setupAdmin(io, accounts);
setupBlackjack(io, accounts);
setupBlackjackLobby(io, accounts);
setupRoulette(io, accounts);
setupRouletteLobby(io, accounts);
setupSportsbook(io, accounts);
setupEconomy(io, accounts);
setupBank(io, accounts);
setupStocks(io, accounts);
setupMarket(io, accounts);
setupChat(io, accounts);
setupLobby(io);

// Chip-Transfer zwischen Spielern (socket-auth required)
io.on("connection", (socket) => {
  socket.on("account:transfer", ({ to, amount } = {}, ack) => {
    if (!ack) return;
    if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
    const res = accounts.transfer(socket.data.account, to, amount);
    if (!res.ok) return ack({ ok: false, error: res.error });
    // Update sender
    socket.emit("account:update", { account: res.fromAccount });
    // Notify recipient if online
    io.of("/").sockets.forEach((s) => {
      if (s.data.account === String(to).trim().toLowerCase()) {
        s.emit("account:update", { account: res.toAccount });
        s.emit("account:received", { from: socket.data.account, amount: Math.floor(Number(amount)) });
      }
    });
    ack({ ok: true, account: res.fromAccount });
  });
});

server.listen(PORT, () => {
  console.log(`🎰 Fake-Casino läuft auf http://localhost:${PORT}`);
});
