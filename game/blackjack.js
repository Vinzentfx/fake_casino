"use strict";

/**
 * Blackjack, entschieden auf dem Server.
 *
 * Jeder Spieler hat seine eigene Sitzung (Schlitten und Hand). Der Schlitten
 * hat 6 Decks und wird neu gemischt, wenn weniger als 52 Karten übrig sind.
 *
 * Regeln:
 *   Der Dealer zieht bei Soft 17 und bleibt ab Hard 17 stehen.
 *   Blackjack zahlt 3:2.
 *   Verdoppeln auf die ersten zwei Karten (nach dem Teilen je Hand).
 *   Paare einmal teilen (kein zweites Teilen, kein Verdoppeln danach).
 *   Keine Versicherung.
 */

const crypto = require("crypto");
const { makeDeck, shuffle, SUITS } = require("./cards");
const bjLobby = require("./blackjackLobby");

const DECKS = 6;
const RESHUFFLE_THRESHOLD = 52;
const BJ_PAYOUT = 1.5; // 3:2

// ---------------------------------------------------------------------------
// Shoe
// ---------------------------------------------------------------------------

function makeShoe() {
  const cards = [];
  for (let i = 0; i < DECKS; i++) cards.push(...makeDeck());
  return shuffle(cards);
}

function ensureShoe(session) {
  if (!session.shoe || session.shoe.length < RESHUFFLE_THRESHOLD) {
    session.shoe = makeShoe();
  }
}

function deal(session) {
  ensureShoe(session);
  return session.shoe.pop();
}

// ---------------------------------------------------------------------------
// Hand value
// ---------------------------------------------------------------------------

function cardValue(card) {
  if (card.rank >= 11 && card.rank <= 13) return 10; // J Q K
  if (card.rank === 14) return 11;                    // Ass (erst mal 11)
  return card.rank;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (c.rank === 14) aces++;
  }
  // Asse von 11 auf 1 runter, solange die Hand sonst überkauft wäre
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isSoft(cards) {
  // true, wenn die Hand ein Ass enthält, das als 11 zählt
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 14) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return aces > 0 && total <= 21;
}

function isBust(cards) { return handValue(cards) > 21; }
function isBlackjack(cards) { return cards.length === 2 && handValue(cards) === 21; }

// ---------------------------------------------------------------------------
// Pechvogel-Modus: der Dealer schlägt den Spieler am Ende immer. Die Karten
// sehen echt aus, es spielt sich nur wie eine üble Pechsträhne.
// ---------------------------------------------------------------------------

/** Karte mit dem gewünschten Blackjack-Wert (2..10 = dieser Rang, 11 = Ass). */
function cardOfValue(v) {
  const suit = SUITS[crypto.randomInt(SUITS.length)];
  return { rank: v === 11 ? 14 : v, suit };
}

/** Die Hand des Dealers so legen (die offene Karte bleibt), dass sie jede
 *  nicht überkaufte Spielerhand schlägt. Gegen 21 geht nur Gleichstand, also Push. */
function rigDealerToWin(session) {
  let playerBest = -1;
  for (const h of session.playerHands) {
    const v = handValue(h.cards);
    if (v <= 21 && v > playerBest) playerBest = v;
  }
  if (playerBest < 0) return; // alle überkauft, schon verloren, der Dealer spielt unten zu Ende
  let target = Math.max(17, playerBest + 1);
  if (target > 21) target = 21; // eine harte 21 ist nicht zu schlagen, also Push
  const cards = [session.dealerCards[0]]; // die offene Karte bleibt
  let guard = 0;
  while (handValue(cards) < target && guard++ < 12) {
    let rem = target - handValue(cards);
    let c = Math.min(10, rem);
    if (rem - c === 1) c -= 1; // nie eine "1" übrig lassen, die keine Karte ist
    if (c < 2) c = 2;
    cards.push(cardOfValue(c));
  }
  session.dealerCards = cards;
}

// ---------------------------------------------------------------------------
// Zustand für den Client (die verdeckte Dealerkarte bleibt verdeckt, bis sie aufgedeckt wird)
// ---------------------------------------------------------------------------

function clientState(session, accounts) {
  const acc = accounts.get(session.name);
  const balance = acc ? acc.chips : 0;

  const dealerCards = session.dealerCards.map((c, i) =>
    (i === 1 && session.phase === "player") ? { hidden: true } : { ...c, hidden: false }
  );
  const dealerValue = session.phase === "player"
    ? handValue([session.dealerCards[0]])
    : handValue(session.dealerCards);

  const playerHands = session.playerHands.map((h, i) => {
    const val = handValue(h.cards);
    const canDouble = !h.done && !h.doubled && h.cards.length === 2 && balance >= h.bet && !session.split;
    const canSplit = !h.done && !session.split && h.cards.length === 2 &&
      cardValue(h.cards[0]) === cardValue(h.cards[1]) && balance >= h.bet;
    return { cards: h.cards, bet: h.bet, doubled: h.doubled, done: h.done,
             result: h.result, value: val, canDouble, canSplit };
  });

  return {
    phase: session.phase,
    playerHands,
    activeHand: session.activeHand,
    dealerCards,
    dealerValue,
    balance,
    message: session.message || "",
  };
}

/** Kurzer Stand der laufenden Hand für den Lobby-Tisch (die anderen sehen deine Karten). */
function handSnapshot(session) {
  if (!session.playerHands || !session.playerHands.length) return { phase: session.phase || "betting" };
  return {
    phase: session.phase,
    hands: session.playerHands.map((h) => ({ value: handValue(h.cards), result: h.result, doubled: h.doubled, cards: h.cards.map((c) => ({ r: c.rank, s: c.suit })) })),
    dealer: session.phase === "player"
      ? { up: { r: session.dealerCards[0].rank, s: session.dealerCards[0].suit } }
      : { value: handValue(session.dealerCards), cards: session.dealerCards.map((c) => ({ r: c.rank, s: c.suit })) },
  };
}

// ---------------------------------------------------------------------------
// Game logic
// ---------------------------------------------------------------------------

function startHand(session, bet, accounts) {
  const acc = accounts.get(session.name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (bet < 10 || !Number.isFinite(bet)) return { ok: false, error: "Mindesteinsatz: 10 Chips." };
  if (bet > acc.chips) return { ok: false, error: "Nicht genug Chips." };
  if (bet > 2000000) return { ok: false, error: "Maximaleinsatz: 2.000.000 Chips." };

  const r = accounts.adjustChips(session.name, -bet);
  if (!r.ok) return { ok: false, error: r.error };

  ensureShoe(session);
  session.phase = "player";
  session.split = false;
  session.activeHand = 0;
  session.message = "";
  session.lastNet = 0;
  session.reported = false;
  session.playerHands = [{ cards: [deal(session), deal(session)], bet, doubled: false, done: false, result: null }];
  session.dealerCards = [deal(session), deal(session)];

  // Pechvogel: kein natürlicher Blackjack für den Spieler (3:2 wäre ein Gewinn).
  if (accounts.isShadowbanned(session.name)) {
    let guard = 0;
    while (isBlackjack(session.playerHands[0].cards) && guard++ < 25) {
      session.playerHands[0].cards[1] = deal(session);
    }
    if (isBlackjack(session.playerHands[0].cards)) session.playerHands[0].cards[1] = cardOfValue(5);
  }

  // Check natural blackjack
  if (isBlackjack(session.playerHands[0].cards)) {
    if (isBlackjack(session.dealerCards)) {
      return resolveHand(session, accounts, "push");
    }
    return resolveHand(session, accounts, "blackjack");
  }
  // Dealer hat Blackjack (Spieler nicht)
  if (isBlackjack(session.dealerCards)) {
    return resolveHand(session, accounts, "lose_all");
  }

  return { ok: true };
}

function playerAction(session, action, accounts) {
  if (session.phase !== "player") return { ok: false, error: "Kein aktives Spiel." };

  const hand = session.playerHands[session.activeHand];
  if (!hand || hand.done) return { ok: false, error: "Hand bereits beendet." };

  const acc = accounts.get(session.name);

  if (action === "hit") {
    hand.cards.push(deal(session));
    if (isBust(hand.cards)) {
      hand.done = true;
      hand.result = "bust";
      session.message = "Bust!";
      return advanceHand(session, accounts);
    }
    if (handValue(hand.cards) === 21) {
      // Bei 21 automatisch stehen
      hand.done = true;
      return advanceHand(session, accounts);
    }
  } else if (action === "stand") {
    hand.done = true;
    return advanceHand(session, accounts);
  } else if (action === "double") {
    if (hand.cards.length !== 2) return { ok: false, error: "Double nur mit 2 Karten." };
    if (acc.chips < hand.bet) return { ok: false, error: "Nicht genug Chips." };
    accounts.adjustChips(session.name, -hand.bet);
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(deal(session));
    hand.done = true;
    if (isBust(hand.cards)) hand.result = "bust";
    return advanceHand(session, accounts);
  } else if (action === "split") {
    if (session.split) return { ok: false, error: "Nur einmal splitten." };
    if (hand.cards.length !== 2) return { ok: false, error: "Split nur mit 2 Karten." };
    if (cardValue(hand.cards[0]) !== cardValue(hand.cards[1])) return { ok: false, error: "Nur gleiche Karten splitten." };
    if (acc.chips < hand.bet) return { ok: false, error: "Nicht genug Chips für Split." };
    accounts.adjustChips(session.name, -hand.bet);
    session.split = true;
    const [c1, c2] = hand.cards;
    session.playerHands = [
      { cards: [c1, deal(session)], bet: hand.bet, doubled: false, done: false, result: null },
      { cards: [c2, deal(session)], bet: hand.bet, doubled: false, done: false, result: null },
    ];
    session.activeHand = 0;
  } else {
    return { ok: false, error: "Unbekannte Aktion." };
  }

  return { ok: true };
}

function advanceHand(session, accounts) {
  // Zur nächsten offenen Hand
  const next = session.playerHands.findIndex((h, i) => i > session.activeHand && !h.done);
  if (next !== -1) {
    session.activeHand = next;
    return { ok: true };
  }
  // Alle Hände fertig, der Dealer spielt
  return dealerPlay(session, accounts);
}

function dealerPlay(session, accounts) {
  session.phase = "dealer";
  // Pechvogel: der Dealer ist so gelegt, dass er gewinnt.
  if (accounts.isShadowbanned(session.name)) {
    rigDealerToWin(session);
    return settleAll(session, accounts);
  }
  // Dealer draws until 17+ (hits soft 17)
  while (true) {
    const val = handValue(session.dealerCards);
    const soft = isSoft(session.dealerCards);
    if (val > 17) break;
    if (val === 17 && !soft) break;
    session.dealerCards.push(deal(session));
  }
  return settleAll(session, accounts);
}

function settleAll(session, accounts) {
  const dealerVal = handValue(session.dealerCards);
  const dealerBust = dealerVal > 21;

  for (const hand of session.playerHands) {
    if (hand.result === "bust") continue; // already lost
    const pVal = handValue(hand.cards);
    if (dealerBust || pVal > dealerVal) {
      hand.result = "win";
    } else if (pVal === dealerVal) {
      hand.result = "push";
    } else {
      hand.result = "lose";
    }
  }

  // Auszahlen. Das echte Netto (gewonnen minus gesetzt) merken, damit größter Gewinn und Verlust stimmen.
  let net = 0;
  for (const hand of session.playerHands) {
    if (hand.result === "win") {
      accounts.adjustChips(session.name, hand.bet * 2);
      net += hand.bet;
    } else if (hand.result === "push") {
      accounts.adjustChips(session.name, hand.bet);
    } else {
      net -= hand.bet; // verloren oder überkauft: der Einsatz ist schon beim Geben abgezogen
    }
  }

  const gesamtEinsatz = session.playerHands.reduce((s2, h) => s2 + (h.bet || 0), 0);
  accounts.recordHand(session.name, net, true, "blackjack", { einsatz: gesamtEinsatz });

  session.lastNet = net;
  session.phase = "done";
  session.message = buildResultMessage(session.playerHands, dealerBust, dealerVal);
  return { ok: true };
}

function resolveHand(session, accounts, outcome) {
  // Bei natürlichem Blackjack oder Dealer-Blackjack, bevor der Dealer normal spielt
  session.phase = "done";
  if (outcome === "blackjack") {
    const bet = session.playerHands[0].bet;
    const payout = Math.floor(bet * BJ_PAYOUT) + bet;
    accounts.adjustChips(session.name, payout);
    session.lastNet = Math.floor(bet * BJ_PAYOUT);
    accounts.recordHand(session.name, session.lastNet, true, "blackjack", { einsatz: bet });
    session.playerHands[0].result = "blackjack";
    session.message = `🃏 Blackjack! +${Math.floor(bet * BJ_PAYOUT).toLocaleString("de-DE")} Chips`;
  } else if (outcome === "push") {
    accounts.adjustChips(session.name, session.playerHands[0].bet);
    session.lastNet = 0;
    accounts.recordHand(session.name, 0, true, "blackjack", { einsatz: session.playerHands[0].bet });
    session.playerHands[0].result = "push";
    session.message = "Unentschieden, Einsatz zurück.";
  } else if (outcome === "lose_all") {
    session.lastNet = -session.playerHands[0].bet;
    accounts.recordHand(session.name, -session.playerHands[0].bet, true, "blackjack", { einsatz: session.playerHands[0].bet });
    session.playerHands[0].result = "lose";
    session.message = "Dealer hat Blackjack.";
  }
  return { ok: true };
}

function buildResultMessage(hands, dealerBust, dealerVal) {
  if (dealerBust) return `Dealer überkauft (${dealerVal})!`;
  const wins = hands.filter(h => h.result === "win").length;
  const losses = hands.filter(h => h.result === "lose" || h.result === "bust").length;
  const pushes = hands.filter(h => h.result === "push").length;
  if (hands.length === 1) {
    if (hands[0].result === "win") return "Gewonnen!";
    if (hands[0].result === "push") return "Unentschieden, Einsatz zurück.";
    return "Verloren.";
  }
  return `Gewonnen: ${wins}  Unentschieden: ${pushes}  Verloren: ${losses}`;
}

// ---------------------------------------------------------------------------
// Socket.IO setup
// ---------------------------------------------------------------------------

function setupBlackjack(io, accounts) {
  // Sessions hängen am Account, nicht am Socket: Reload/Verbindungsabriss
  // mitten in der Hand kostet den Einsatz nicht mehr, bj:init nach dem
  // Reconnect liefert die laufende Hand einfach wieder aus.
  const sessions = new Map(); // Kontoschlüssel -> Sitzung
  const IDLE_STAND_MS = 30 * 60_000;
  const freshSession = () => ({ shoe: null, phase: "betting", playerHands: [], dealerCards: [],
                                activeHand: 0, split: false, message: "", name: null, lastAt: Date.now() });

  // Mitten in der Hand verlassen (30 Min idle): alle Hände stehen lassen,
  // Dealer spielt aus, Gewinn/Verlust wird normal verbucht.
  setInterval(() => {
    const now = Date.now();
    for (const [, s] of sessions) {
      if (s.phase !== "player" || now - (s.lastAt || 0) < IDLE_STAND_MS) continue;
      for (let i = 0; i < 8 && s.phase === "player"; i++) playerAction(s, "stand", accounts);
      s.reported = true; // keine verspätete Lobby-Meldung ohne Socket
    }
  }, 60_000).unref();

  io.on("connection", (socket) => {
    function getSession() {
      const key = socket.data.account;
      if (key) {
        let s = sessions.get(key);
        if (!s) { s = freshSession(); sessions.set(key, s); }
        s.lastAt = Date.now();
        return s;
      }
      // Nicht eingeloggt (kann eh nicht setzen) → wegwerfbare Socket-Session.
      if (!socket.data.bj) socket.data.bj = freshSession();
      return socket.data.bj;
    }

    function push() {
      const session = getSession();
      socket.emit("bj:state", clientState(session, accounts));
      // Die laufende Hand an den Lobby-Tisch geben (alle sehen die Karten aller).
      bjLobby.reportHand(socket, handSnapshot(session));
      // Das Netto einer fertigen Hand an die Blackjack-Lobby melden (falls man in
      // einer sitzt), damit der Tisch sieht, wer wie viel gewonnen hat. Einmal je Hand.
      if (session.phase === "done" && !session.reported) {
        session.reported = true;
        bjLobby.report(socket, session.lastNet || 0);
      }
    }

    socket.on("bj:init", () => {
      const session = getSession();
      if (socket.data.account) session.name = socket.data.account;
      push();
    });

    socket.on("bj:deal", ({ bet } = {}, cb) => {
      const session = getSession();
      if (socket.data.account) session.name = socket.data.account;
      if (!session.name) return cb && cb({ ok: false, error: "Nicht eingeloggt." });
      const betN = Math.round(Number(bet));
      const result = startHand(session, betN, accounts);
      push();
      cb && cb(result);
    });

    socket.on("bj:action", ({ action } = {}, cb) => {
      const session = getSession();
      if (socket.data.account) session.name = socket.data.account;
      if (!session.name) return cb && cb({ ok: false, error: "Nicht eingeloggt." });
      const result = playerAction(session, action, accounts);
      push();
      cb && cb(result);
    });
  });
}

module.exports = { setupBlackjack };
