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
const { setupSportsbook, refundOpenBets } = require("./game/sportsbook");
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
app.set("trust proxy", true); // Railway runs behind a proxy → real client IP in x-forwarded-for
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Anti-multi-account faucet: cap how many NEW accounts one IP can create per day
// (each new account is free start chips). Generous enough for friends sharing a
// network, tight enough to stop mass account farming.
const ACCOUNTS_PER_IP_PER_DAY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const ipCreations = new Map(); // ip -> [timestamps]
function recentCreations(ip) {
  const now = Date.now();
  const list = (ipCreations.get(ip) || []).filter((t) => now - t < DAY_MS);
  ipCreations.set(ip, list);
  return list;
}

app.post("/api/login", (req, res) => {
  const name = req.body.name;
  const ip = req.ip || "unknown";
  // If this login would CREATE a new account, enforce the per-IP creation cap.
  const willCreate = name && !accounts.get(name);
  if (willCreate && recentCreations(ip).length >= ACCOUNTS_PER_IP_PER_DAY) {
    return res.status(429).json({ error: "Zu viele neue Accounts aus diesem Netzwerk. Bitte später erneut versuchen." });
  }
  const result = accounts.login(name, req.body.pin);
  if (!result.ok) return res.status(400).json({ error: result.error });
  if (result.created) recentCreations(ip).push(Date.now());
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

// On a graceful shutdown (e.g. a Railway redeploy), refund open sports bets so
// no stake is lost when the in-memory match state resets.
let shuttingDown = false;
function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const r = refundOpenBets(accounts);
    if (r.count) console.log(`[shutdown] refunded ${r.count} open bet(s), ${r.total} 🪙`);
  } catch (e) { console.error("[shutdown] refund failed:", e.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
