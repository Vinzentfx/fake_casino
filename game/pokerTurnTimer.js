"use strict";

// A broadcast only observes a turn; it must never grant extra thinking time.
function scheduleTurnTimer(entry, { duration, isPresent, onExpire, clock = globalThis }) {
  const table = entry.table;
  const seat = table.handActive && table.toAct >= 0 ? table.seats[table.toAct] : null;
  const key = seat && !seat.isBot
    ? JSON.stringify([table.turnSerial, table.toAct, table.stage, seat.id]) : null;
  if (key && entry.turnKey === key && entry.turnTimer != null) return;
  clock.clearTimeout(entry.turnTimer);
  entry.turnTimer = null;
  entry.turnKey = key;
  entry.turnDeadline = null;
  if (!key) return;
  const idx = table.toAct;
  entry.turnDeadline = clock.Date.now() + duration;
  entry.turnTimer = clock.setTimeout(() => {
    if (entry.turnKey !== key || !isPresent() || !table.handActive || table.toAct !== idx || table.seats[idx] !== seat) return;
    entry.turnTimer = null;
    entry.turnKey = null;
    entry.turnDeadline = null;
    table.act(seat.id, table.currentBet > seat.bet ? "fold" : "check", 0);
    onExpire();
  }, duration);
}

module.exports = { scheduleTurnTimer };
