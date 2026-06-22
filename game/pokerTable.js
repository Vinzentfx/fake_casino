"use strict";

/**
 * A single Texas Hold'em table (No-Limit, cash-game style).
 *
 * Knows nothing about accounts — it manages seats that each hold a chip stack.
 * Buy-in / cash-out (moving chips between an account and a seat) is the
 * caller's job (tableManager). The table only deals cards, runs betting rounds,
 * handles all-ins with side pots, and resolves showdowns.
 */

const { makeDeck, shuffle, cardStr } = require("./cards");
const { evaluateBest7, compareValue } = require("./handEvaluator");

const MAX_SEATS = 6;

class PokerTable {
  constructor(code, { smallBlind = 10, bigBlind = 20 } = {}) {
    this.code = code;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;

    this.seats = new Array(MAX_SEATS).fill(null);
    this.buttonIndex = -1;
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.stage = "waiting"; // waiting | preflop | flop | turn | river | showdown
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.toAct = -1;
    this.handActive = false;
    this.log = [];
    this.lastResult = null; // { board, reveals:[{seat,name,hole,handName}], winners:[{name,amount}] }

    // Hook set by manager: called whenever a hand fully ends.
    this.onHandComplete = null;
  }

  // ----------------------------------------------------------------------
  // Seating
  // ----------------------------------------------------------------------

  seatedPlayers() {
    return this.seats.filter(Boolean);
  }

  findSeat(id) {
    return this.seats.findIndex((s) => s && s.id === id);
  }

  /** Seat a player. Returns seat index or -1 if full / already seated. */
  sit(id, name, chips) {
    if (this.findSeat(id) !== -1) return this.findSeat(id);
    const idx = this.seats.findIndex((s) => s === null);
    if (idx === -1) return -1;
    this.seats[idx] = {
      id,
      name,
      chips,
      hole: [],
      folded: false,
      allIn: false,
      bet: 0,
      committed: 0,
      inHand: false,
      acted: false,
      sittingOut: false,
    };
    this.pushLog(`${name} setzt sich an den Tisch.`);
    return idx;
  }

  /** Remove a player. Returns the chips they take with them (0 if mid-hand & folded already counted). */
  stand(id) {
    const idx = this.findSeat(id);
    if (idx === -1) return 0;
    const seat = this.seats[idx];
    const chips = seat.chips;
    // If they were active in a live hand, treat as fold first.
    if (this.handActive && seat.inHand && !seat.folded) {
      seat.folded = true;
      seat.inHand = false;
    }
    this.seats[idx] = null;
    this.pushLog(`${seat.name} verlässt den Tisch.`);
    if (this.handActive) this.checkHandProgress(idx);
    return chips;
  }

  // ----------------------------------------------------------------------
  // Hand lifecycle
  // ----------------------------------------------------------------------

  eligibleToPlay() {
    return this.seats.filter((s) => s && s.chips > 0 && !s.sittingOut);
  }

  canStart() {
    return !this.handActive && this.eligibleToPlay().length >= 2;
  }

  startHand() {
    if (!this.canStart()) return false;

    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastResult = null;
    this.deck = shuffle(makeDeck());

    // Reset seats; only players with chips join the hand.
    for (const s of this.seats) {
      if (!s) continue;
      s.hole = [];
      s.bet = 0;
      s.committed = 0;
      s.folded = false;
      s.allIn = false;
      s.acted = false;
      s.inHand = s.chips > 0 && !s.sittingOut;
    }

    // Move button to next eligible seat.
    this.buttonIndex = this.nextOccupied(this.buttonIndex, (s) => s.inHand);

    const players = this.inHandSeats();
    const hebsUp = players.length === 2;

    // Blind positions
    let sbIdx, bbIdx;
    if (hebsUp) {
      sbIdx = this.buttonIndex; // button posts SB heads-up
      bbIdx = this.nextOccupied(sbIdx, (s) => s.inHand);
    } else {
      sbIdx = this.nextOccupied(this.buttonIndex, (s) => s.inHand);
      bbIdx = this.nextOccupied(sbIdx, (s) => s.inHand);
    }

    this.postBet(sbIdx, this.smallBlind);
    this.postBet(bbIdx, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;

    // Deal two hole cards each, starting left of button.
    for (let round = 0; round < 2; round++) {
      let i = this.nextOccupied(this.buttonIndex, (s) => s.inHand);
      for (let n = 0; n < players.length; n++) {
        this.seats[i].hole.push(this.deck.pop());
        i = this.nextOccupied(i, (s) => s.inHand);
      }
    }

    this.stage = "preflop";
    this.handActive = true;
    // First to act preflop = first who still needs to act after the big blind.
    this.toAct = this.nextToAct(bbIdx);
    this.pushLog(`Neue Hand — Blinds ${this.smallBlind}/${this.bigBlind}.`);
    return true;
  }

  // ----------------------------------------------------------------------
  // Betting
  // ----------------------------------------------------------------------

  postBet(seatIndex, amount) {
    const s = this.seats[seatIndex];
    const pay = Math.min(amount, s.chips);
    s.chips -= pay;
    s.bet += pay;
    s.committed += pay;
    this.pot += pay;
    if (s.chips === 0) s.allIn = true;
    return pay;
  }

  /** Whether a seat still needs to act in this betting round. */
  needsToAct(s) {
    return s && s.inHand && !s.folded && !s.allIn && (!s.acted || s.bet < this.currentBet);
  }

  /** Whether a seat is able to voluntarily act at all. */
  canAct(s) {
    return s && s.inHand && !s.folded && !s.allIn;
  }

  nextToAct(fromIndex) {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (fromIndex + i) % MAX_SEATS;
      if (this.needsToAct(this.seats[idx])) return idx;
    }
    return -1;
  }

  nextOccupied(fromIndex, pred = () => true) {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (fromIndex + i) % MAX_SEATS;
      const s = this.seats[idx];
      if (s && pred(s)) return idx;
    }
    return fromIndex;
  }

  inHandSeats() {
    return this.seats.filter((s) => s && s.inHand);
  }
  contenders() {
    return this.seats.filter((s) => s && s.inHand && !s.folded);
  }
  countCanAct() {
    return this.seats.filter((s) => this.canAct(s)).length;
  }

  /**
   * Apply a player action. action ∈ "fold" | "check" | "call" | "raise".
   * For "raise", `amount` is the total bet-to value for this round.
   * Returns { ok } or { ok:false, error }.
   */
  act(id, action, amount) {
    if (!this.handActive) return { ok: false, error: "Keine aktive Hand." };
    const idx = this.findSeat(id);
    if (idx === -1 || idx !== this.toAct) return { ok: false, error: "Du bist nicht am Zug." };
    const s = this.seats[idx];

    const toCall = this.currentBet - s.bet;

    if (action === "fold") {
      s.folded = true;
      s.acted = true;
      this.pushLog(`${s.name} passt.`);
    } else if (action === "check") {
      if (toCall > 0) return { ok: false, error: "Du kannst nicht checken." };
      s.acted = true;
      this.pushLog(`${s.name} checkt.`);
    } else if (action === "call") {
      if (toCall <= 0) return { ok: false, error: "Nichts zu callen." };
      const paid = this.postBet(idx, toCall);
      s.acted = true;
      this.pushLog(`${s.name} callt ${paid}${s.allIn ? " (All-In)" : ""}.`);
    } else if (action === "raise" || action === "bet") {
      const target = Math.floor(Number(amount));
      const maxTo = s.bet + s.chips;
      if (!Number.isFinite(target) || target <= this.currentBet) {
        return { ok: false, error: "Erhöhung zu niedrig." };
      }
      if (target > maxTo) return { ok: false, error: "So viele Chips hast du nicht." };
      const isAllIn = target === maxTo;
      const raiseSize = target - this.currentBet;
      // A short all-in that is smaller than a full raise does not reopen betting.
      if (raiseSize < this.minRaise && !isAllIn) {
        return { ok: false, error: `Mindesterhöhung auf ${this.currentBet + this.minRaise}.` };
      }
      this.postBet(idx, target - s.bet);
      const fullRaise = raiseSize >= this.minRaise;
      if (fullRaise) this.minRaise = raiseSize;
      this.currentBet = Math.max(this.currentBet, target);
      // Re-open action for everyone else on a full raise.
      if (fullRaise) {
        for (const other of this.seats) {
          if (other && other !== s && this.canAct(other)) other.acted = false;
        }
      }
      s.acted = true;
      const verb = toCall > 0 ? "erhöht auf" : "setzt";
      this.pushLog(`${s.name} ${verb} ${target}${s.allIn ? " (All-In)" : ""}.`);
    } else {
      return { ok: false, error: "Unbekannte Aktion." };
    }

    this.checkHandProgress(idx);
    return { ok: true };
  }

  /** After an action (or a player leaving), decide what happens next. */
  checkHandProgress(fromIndex) {
    if (this.contenders().length === 1) {
      this.awardUncontested();
      return;
    }
    const next = this.nextToAct(fromIndex);
    if (next === -1) this.closeBettingRound();
    else this.toAct = next;
  }

  closeBettingRound() {
    this.advanceStage();
  }

  advanceStage() {
    // Reset per-round betting state.
    for (const s of this.seats) {
      if (s) {
        s.bet = 0;
        s.acted = false;
      }
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    if (this.stage === "preflop") {
      this.stage = "flop";
      this.dealBoard(3);
    } else if (this.stage === "flop") {
      this.stage = "turn";
      this.dealBoard(1);
    } else if (this.stage === "turn") {
      this.stage = "river";
      this.dealBoard(1);
    } else if (this.stage === "river") {
      this.showdown();
      return;
    }

    // If at most one player can still act, no more betting — run out the board.
    if (this.countCanAct() <= 1) {
      this.advanceStage();
      return;
    }

    this.toAct = this.nextOccupied(this.buttonIndex, (s) => this.canAct(s));
  }

  dealBoard(n) {
    for (let i = 0; i < n; i++) this.board.push(this.deck.pop());
    this.pushLog(`${this.stageLabel()}: ${this.board.map(cardStr).join(" ")}`);
  }

  // ----------------------------------------------------------------------
  // Resolving the pot
  // ----------------------------------------------------------------------

  awardUncontested() {
    const winner = this.contenders()[0];
    const amount = this.pot;
    winner.chips += amount;
    this.lastResult = {
      board: this.board.slice(),
      reveals: [],
      winners: [{ name: winner.name, amount }],
      uncontested: true,
    };
    this.pushLog(`${winner.name} gewinnt ${amount} (alle anderen gepasst).`);
    this.recordResults([{ id: winner.id, amount: amount - winner.committed }]);
    this.endHand();
  }

  /** Build (side) pots from each seat's committed chips. */
  buildPots() {
    const players = this.seats
      .filter((s) => s && s.committed > 0)
      .map((s) => ({ s, rem: s.committed }));
    const pots = [];
    while (players.some((x) => x.rem > 0)) {
      const min = Math.min(...players.filter((x) => x.rem > 0).map((x) => x.rem));
      let amount = 0;
      const eligible = [];
      for (const x of players) {
        if (x.rem > 0) {
          x.rem -= min;
          amount += min;
          if (!x.s.folded) eligible.push(x.s);
        }
      }
      const prev = pots[pots.length - 1];
      if (prev && sameSeatSet(prev.eligible, eligible)) prev.amount += amount;
      else pots.push({ amount, eligible });
    }
    // Chips committed by players who left mid-hand are no longer on any seat,
    // so the layered pots above sum to less than this.pot. Fold that orphaned
    // "dead money" into the main pot so it's still awarded (chip conservation).
    const built = pots.reduce((sum, p) => sum + p.amount, 0);
    const orphan = this.pot - built;
    if (orphan > 0 && pots.length) pots[0].amount += orphan;
    return pots;
  }

  showdown() {
    this.stage = "showdown";
    const contenders = this.contenders();

    // Evaluate everyone's best hand once.
    const evals = new Map();
    for (const s of contenders) {
      evals.set(s, evaluateBest7([...s.hole, ...this.board]));
    }

    const pots = this.buildPots();
    const winningsById = {};
    const winnersDisplay = [];

    for (const pot of pots) {
      // Best hand(s) among this pot's eligible contenders.
      let best = null;
      let winners = [];
      for (const s of pot.eligible) {
        const ev = evals.get(s);
        if (!best || compareValue(ev.value, best) > 0) {
          best = ev.value;
          winners = [s];
        } else if (compareValue(ev.value, best) === 0) {
          winners.push(s);
        }
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // Award share; odd chip(s) go to the earliest winner left of the button.
      const ordered = this.orderFromButton(winners);
      for (const s of ordered) {
        let won = share;
        if (remainder > 0) {
          won += 1;
          remainder -= 1;
        }
        s.chips += won;
        winningsById[s.id] = (winningsById[s.id] || 0) + won;
      }
    }

    for (const id of Object.keys(winningsById)) {
      const seat = this.seats[this.findSeat(id)];
      winnersDisplay.push({ name: seat.name, amount: winningsById[id] });
    }

    this.lastResult = {
      board: this.board.slice(),
      reveals: contenders.map((s) => ({
        name: s.name,
        hole: s.hole.slice(),
        handName: evals.get(s).name,
      })),
      winners: winnersDisplay,
      uncontested: false,
    };
    const summary = winnersDisplay.map((w) => `${w.name} +${w.amount}`).join(", ");
    this.pushLog(`Showdown — ${summary}.`);

    this.recordResults(
      contenders.map((s) => ({ id: s.id, amount: (winningsById[s.id] || 0) - s.committed }))
    );
    this.endHand();
  }

  /** Order seats by position starting left of the button. */
  orderFromButton(seatList) {
    const order = [];
    let i = this.buttonIndex;
    for (let n = 0; n < MAX_SEATS; n++) {
      i = (i + 1) % MAX_SEATS;
      const seat = this.seats[i];
      if (seat && seatList.includes(seat)) order.push(seat);
    }
    return order;
  }

  recordResults(results) {
    if (typeof this.onResults === "function") this.onResults(results);
  }

  endHand() {
    this.handActive = false;
    this.toAct = -1;
    if (typeof this.onHandComplete === "function") this.onHandComplete();
  }

  // ----------------------------------------------------------------------
  // Serialization
  // ----------------------------------------------------------------------

  stageLabel() {
    return { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown" }[
      this.stage
    ] || this.stage;
  }

  pushLog(msg) {
    this.log.push(msg);
    if (this.log.length > 30) this.log.shift();
  }

  /** Public state from one viewer's perspective (only their hole cards). */
  getStateFor(viewerId) {
    const yourSeat = this.findSeat(viewerId);
    const seats = this.seats.map((s, i) => {
      if (!s) return null;
      const revealHole = this.stage === "showdown" && s.inHand && !s.folded;
      return {
        index: i,
        id: s.id,
        name: s.name,
        chips: s.chips,
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        inHand: s.inHand,
        sittingOut: s.sittingOut,
        isBot: !!s.isBot,
        isButton: i === this.buttonIndex,
        isTurn: i === this.toAct,
        hasCards: s.inHand && s.hole.length > 0,
        hole: i === yourSeat || revealHole ? s.hole : null,
      };
    });

    const state = {
      code: this.code,
      stage: this.stage,
      stageLabel: this.stageLabel(),
      board: this.board,
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      buttonIndex: this.buttonIndex,
      toAct: this.toAct,
      handActive: this.handActive,
      maxSeats: MAX_SEATS,
      seats,
      yourSeat,
      canStart: this.canStart(),
      lastResult: this.lastResult,
      log: this.log.slice(-12),
    };

    // Action options when it's the viewer's turn.
    if (yourSeat !== -1 && yourSeat === this.toAct) {
      const s = this.seats[yourSeat];
      const toCall = this.currentBet - s.bet;
      const maxTo = s.bet + s.chips;
      state.options = {
        canCheck: toCall <= 0,
        callAmount: Math.min(toCall, s.chips),
        toCall,
        minRaiseTo: Math.min(this.currentBet + this.minRaise, maxTo),
        maxRaiseTo: maxTo,
        isBet: this.currentBet === 0,
      };
    }

    return state;
  }
}

function sameSeatSet(a, b) {
  if (a.length !== b.length) return false;
  return a.every((s) => b.includes(s));
}

module.exports = { PokerTable, MAX_SEATS };
