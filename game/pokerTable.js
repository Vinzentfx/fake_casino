"use strict";

/**
 * Ein Texas-Hold'em-Tisch (No-Limit, wie ein Cash Game).
 *
 * Weiß nichts von Konten, er verwaltet nur Plätze mit Chipstapeln. Buy-in und
 * Auszahlung (Chips zwischen Konto und Platz verschieben) macht der Aufrufer
 * (tableManager). Der Tisch gibt nur Karten, führt die Setzrunden, kümmert sich
 * um All-ins mit Nebentöpfen und wertet den Showdown aus.
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

    // Setzt der Manager: wird aufgerufen, sobald eine Hand komplett vorbei ist.
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

  /** Spieler hinsetzen. Gibt den Platz zurück oder -1, wenn voll oder schon da. */
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

  /** Spieler entfernen. Gibt die Chips zurück, die er mitnimmt (0, wenn er mitten in der Hand schon gefoldet hat). */
  stand(id) {
    const idx = this.findSeat(id);
    if (idx === -1) return 0;
    const seat = this.seats[idx];
    const chips = seat.chips;
    // Wer in einer laufenden Hand noch drin war, foldet zuerst.
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

    // Plätze zurücksetzen, nur wer Chips hat, spielt mit.
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

    // Button zum nächsten Platz, der mitspielt.
    this.buttonIndex = this.nextOccupied(this.buttonIndex, (s) => s.inHand);

    const players = this.inHandSeats();
    const hebsUp = players.length === 2;

    // Blind positions
    let sbIdx, bbIdx;
    if (hebsUp) {
      sbIdx = this.buttonIndex; // heads-up setzt der Button den Small Blind
      bbIdx = this.nextOccupied(sbIdx, (s) => s.inHand);
    } else {
      sbIdx = this.nextOccupied(this.buttonIndex, (s) => s.inHand);
      bbIdx = this.nextOccupied(sbIdx, (s) => s.inHand);
    }

    this.postBet(sbIdx, this.smallBlind);
    this.postBet(bbIdx, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;

    // Jeder bekommt zwei Karten, links vom Button angefangen.
    for (let round = 0; round < 2; round++) {
      let i = this.nextOccupied(this.buttonIndex, (s) => s.inHand);
      for (let n = 0; n < players.length; n++) {
        this.seats[i].hole.push(this.deck.pop());
        i = this.nextOccupied(i, (s) => s.inHand);
      }
    }

    this.stage = "preflop";
    this.handActive = true;
    // Preflop fängt an, wer nach dem Big Blind als Erster noch handeln muss.
    this.toAct = this.nextToAct(bbIdx);
    this.pushLog(`Neue Hand, Blinds ${this.smallBlind}/${this.bigBlind}.`);
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

  /** Ob ein Platz in dieser Setzrunde noch handeln muss. */
  needsToAct(s) {
    return s && s.inHand && !s.folded && !s.allIn && (!s.acted || s.bet < this.currentBet);
  }

  /** Ob ein Platz überhaupt noch freiwillig handeln kann. */
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
   * Aktion eines Spielers ausführen: "fold" | "check" | "call" | "raise".
   * Bei "raise" ist `amount` der Gesamtbetrag, auf den in dieser Runde erhöht wird.
   * Gibt { ok } oder { ok:false, error } zurück.
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
      // Ein kurzes All-in unter einem vollen Raise öffnet die Setzrunde nicht neu.
      if (raiseSize < this.minRaise && !isAllIn) {
        return { ok: false, error: `Mindesterhöhung auf ${this.currentBet + this.minRaise}.` };
      }
      this.postBet(idx, target - s.bet);
      const fullRaise = raiseSize >= this.minRaise;
      if (fullRaise) this.minRaise = raiseSize;
      this.currentBet = Math.max(this.currentBet, target);
      // Bei einem vollen Raise müssen alle anderen wieder handeln.
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

  /** Nach einer Aktion (oder wenn jemand geht) entscheiden, wie es weitergeht. */
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
    // Einsätze der Runde zurücksetzen.
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

    // Kann höchstens noch einer handeln, wird nicht mehr gesetzt, das Board läuft durch.
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
  // Topf auflösen
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
    // Auch die Gepassten melden, siehe alleErgebnisse().
    this.recordResults(this.alleErgebnisse({ [winner.id]: amount }));
    this.endHand();
  }

  /** (Neben-)Töpfe aus den gesetzten Chips jedes Platzes bauen. */
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
    // Chips von Spielern, die mitten in der Hand gegangen sind, liegen auf keinem
    // Platz mehr, die Töpfe oben ergeben also weniger als this.pot. Dieses "tote
    // Geld" kommt in den Haupttopf, damit es trotzdem vergeben wird.
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
      // Beste Hand (oder Hände) unter den Berechtigten dieses Topfs.
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
      // Anteil vergeben, übrige Chips gehen an den ersten Gewinner links vom Button.
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
    this.pushLog(`Showdown: ${summary}.`);

    this.recordResults(this.alleErgebnisse(winningsById));
    this.endHand();
  }

  /** Plätze nach Position sortieren, links vom Button angefangen. */
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

  /*
   * Ergebnis jedes Spielers, der Chips in der Hand hatte.
   *
   * Vorher gingen nur die Spieler in die Wertung, die es bis zum Showdown
   * geschafft haben (oder als Einziger uebrig blieben). Wer gepasst hat,
   * verlor seinen Einsatz still: kein Eintrag in der Statistik, kein XP fuer
   * die Hand, und im Wochen-Netto fehlte der Verlust. Dadurch sah Poker in
   * der Bilanz dauerhaft profitabler aus, als es ist, bei einem Spiel, bei
   * dem Passen der haeufigste Ausgang ueberhaupt ist.
   *
   * @param {Record<string, number>} gewinne Auszahlung je Spieler-id
   */
  alleErgebnisse(gewinne) {
    return this.seats
      .filter((s) => s && s.committed > 0)
      .map((s) => ({ id: s.id, amount: (gewinne[s.id] || 0) - s.committed }));
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

  /** Öffentlicher Stand aus Sicht eines Zuschauers (nur seine eigenen Karten). */
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

    // Mögliche Aktionen, wenn der Betrachter dran ist.
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
