"use strict";

const crypto = require("crypto");

const RED_NUMS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_SEQ = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

function numColor(n) {
  if (n === 0) return "green";
  return RED_NUMS.has(n) ? "red" : "black";
}

// Returns total payout factor: 0 = lose stake, >0 = receive factor × bet back
function payoutFactor(type, value, number) {
  if (type === "number") return number === value ? 36 : 0;
  if (number === 0) return 0; // green pocket — all outside bets lose
  if (type === "red")    return RED_NUMS.has(number) ? 2 : 0;
  if (type === "black")  return !RED_NUMS.has(number) ? 2 : 0;
  if (type === "odd")    return number % 2 === 1 ? 2 : 0;
  if (type === "even")   return number % 2 === 0 ? 2 : 0;
  if (type === "low")    return number <= 18 ? 2 : 0;
  if (type === "high")   return number >= 19 ? 2 : 0;
  if (type === "dozen")  return Math.ceil(number / 12) === value ? 3 : 0;
  if (type === "column") return ((number - 1) % 3 + 1) === value ? 3 : 0;
  return 0;
}

const VALID_TYPES = new Set(["number","red","black","odd","even","low","high","dozen","column"]);
const MIN_BET = 50;
const MAX_TOTAL = 100000000;

function setupRoulette(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("roulette:spin", ({ bets } = {}, ack) => {
      if (!ack) return;
      if (!socket.data.account) return ack({ ok: false, error: "Bitte zuerst einloggen." });
      if (!Array.isArray(bets) || !bets.length) return ack({ ok: false, error: "Keine Wetten gesetzt." });
      if (bets.length > 50) return ack({ ok: false, error: "Zu viele Wetten." });

      let totalBet = 0;
      const clean = [];
      for (const b of bets) {
        const amount = Math.floor(Number(b.amount));
        if (!VALID_TYPES.has(b.type) || !Number.isFinite(amount) || amount < MIN_BET)
          return ack({ ok: false, error: "Ungültige Wette." });
        if (b.type === "number") {
          const v = Math.floor(Number(b.value));
          if (v < 0 || v > 36) return ack({ ok: false, error: "Zahl 0–36." });
          clean.push({ type: "number", value: v, amount });
        } else if (b.type === "dozen" || b.type === "column") {
          const v = Math.floor(Number(b.value));
          if (v < 1 || v > 3) return ack({ ok: false, error: "Wert 1–3." });
          clean.push({ type: b.type, value: v, amount });
        } else {
          clean.push({ type: b.type, amount });
        }
        totalBet += amount;
      }
      if (totalBet > MAX_TOTAL) return ack({ ok: false, error: "Gesamteinsatz zu hoch." });

      const acc = accounts.get(socket.data.account);
      if (!acc || acc.chips < totalBet) return ack({ ok: false, error: "Nicht genug Chips." });

      accounts.adjustChips(socket.data.account, -totalBet);

      const number = crypto.randomInt(37);
      const color  = numColor(number);
      const wheelIdx = WHEEL_SEQ.indexOf(number);

      let totalReturn = 0;
      const betResults = clean.map((b) => {
        const factor = payoutFactor(b.type, b.value, number);
        const ret = Math.floor(b.amount * factor);
        totalReturn += ret;
        return { ...b, factor, ret };
      });

      // Glücksklee / Goldbarren: boost winnings on a win.
      const boost = accounts.buffMult(socket.data.account, "winBoost");
      if (boost > 1 && totalReturn > 0) totalReturn = Math.round(totalReturn * boost);

      if (totalReturn > 0) {
        accounts.adjustChips(socket.data.account, totalReturn);
      }
      // Record every spin (win or loss) so gamesPlayed stays accurate.
      accounts.recordHand(socket.data.account, totalReturn - totalBet);

      ack({
        ok: true,
        number,
        color,
        wheelIdx,
        totalBet,
        totalReturn,
        netWin: totalReturn - totalBet,
        balance: accounts.get(socket.data.account).chips,
        betResults,
      });
    });
  });
}

module.exports = { setupRoulette, WHEEL_SEQ, RED_NUMS: [...RED_NUMS] };
