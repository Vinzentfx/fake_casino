"use strict";

/**
 * Blitz-Quiz — admin event: a few multiple-choice rounds broadcast to everyone
 * online. Fastest correct answer wins the round prize. One answer per account
 * per round; the correct index never leaves the server until the round is over.
 */

const chat = require("./chat");

const ROUND_MS = 12000;   // answer window per question
const BREAK_MS = 6000;    // result display between rounds

// { q, a: [4 options], c: correct index }
const QUESTIONS = [
  // Casino-Wissen (aus dem eigenen Casino ableitbar!)
  { q: "Welche Farbe hat die 0 beim Roulette?", a: ["Rot", "Schwarz", "Grün", "Gold"], c: 2 },
  { q: "Wie viele Ebenen hat der Dragon Tower?", a: ["7", "8", "9", "10"], c: 2 },
  { q: "Wie heißt die beste Starthand beim Texas Hold'em?", a: ["Ass-König", "Ass-Ass", "König-König", "Ass-Dame suited"], c: 1 },
  { q: "Bei welcher Punktzahl steht der Blackjack-Dealer?", a: ["16", "17", "18", "21"], c: 1 },
  { q: "Wie viele Karten hat ein Standard-Pokerdeck?", a: ["48", "50", "52", "54"], c: 2 },
  { q: "Was ist ein 'Royal Flush'?", a: ["5 gleiche Farben", "10-J-Q-K-A in einer Farbe", "4 Asse", "3er + Paar"], c: 1 },
  { q: "Wie viele Felder hat ein europäisches Roulette?", a: ["36", "37", "38", "40"], c: 1 },
  { q: "Was bedeutet 'All-in' beim Poker?", a: ["Aussteigen", "Alle Chips setzen", "Karten tauschen", "Blind erhöhen"], c: 1 },
  { q: "Welches Symbol ist im Book of Rah Wild UND Scatter?", a: ["Der Pharao", "Das Buch", "Der Skarabäus", "Das Auge"], c: 1 },
  { q: "Wie viele Minen kann man bei Mines maximal wählen?", a: ["20", "22", "24", "25"], c: 2 },
  { q: "Was passiert beim Crash, wenn man NICHT rechtzeitig aussteigt?", a: ["Einsatz halbiert", "Einsatz weg", "Gewinn ×1", "Freispiel"], c: 1 },
  { q: "Wie nennt man 21 mit den ersten zwei Karten?", a: ["Full House", "Blackjack", "Snake Eyes", "Jackpot"], c: 1 },
  { q: "Welche Chips-Summe ist beim Würfelpaar 'Snake Eyes'?", a: ["2", "3", "7", "12"], c: 0 },
  { q: "Wofür steht RTP bei Slots?", a: ["Real Time Play", "Return To Player", "Roll The Prize", "Random Type Pick"], c: 1 },
  // Porta Westfalica / Casino-Stadt
  { q: "An welchem Fluss liegt Porta Westfalica?", a: ["Rhein", "Elbe", "Weser", "Ems"], c: 2 },
  { q: "Welches Denkmal steht bei Porta Westfalica?", a: ["Hermannsdenkmal", "Kaiser-Wilhelm-Denkmal", "Niederwalddenkmal", "Bismarckturm"], c: 1 },
  { q: "In welchem Bundesland liegt Porta Westfalica?", a: ["Niedersachsen", "Hessen", "NRW", "Bremen"], c: 2 },
  // Allgemeinwissen / Zahlen
  { q: "Wie viele Sekunden hat eine Stunde?", a: ["360", "600", "3600", "6000"], c: 2 },
  { q: "Was ist 15 % von 200?", a: ["15", "20", "30", "45"], c: 2 },
  { q: "Welche Zahl ist eine Primzahl?", a: ["21", "27", "31", "33"], c: 2 },
  { q: "Was ist 7 × 8?", a: ["54", "56", "63", "64"], c: 1 },
  { q: "Wie viele Nullen hat eine Million?", a: ["5", "6", "7", "9"], c: 1 },
  { q: "Was ist die Hälfte von 2⁶?", a: ["16", "24", "32", "64"], c: 2 },
  { q: "Würfel: Wie viele Augen haben zwei Würfel zusammen maximal?", a: ["10", "11", "12", "14"], c: 2 },
  { q: "Was ist das Doppelte von 1.250?", a: ["2.250", "2.400", "2.500", "3.000"], c: 2 },
  { q: "Wie viele Herz-Karten hat ein 52er-Deck?", a: ["12", "13", "14", "26"], c: 1 },
  { q: "Welcher Planet ist der Sonne am nächsten?", a: ["Venus", "Merkur", "Mars", "Erde"], c: 1 },
  { q: "Wie viele Beine hat eine Spinne?", a: ["6", "8", "10", "12"], c: 1 },
  { q: "Welches Land hat die meisten Einwohner?", a: ["USA", "China", "Indien", "Russland"], c: 2 },
  { q: "Was ist die Hauptstadt von Australien?", a: ["Sydney", "Melbourne", "Canberra", "Perth"], c: 2 },
  { q: "Wie viele Kontinente gibt es?", a: ["5", "6", "7", "8"], c: 2 },
  { q: "In welchem Jahr fiel die Berliner Mauer?", a: ["1987", "1989", "1990", "1991"], c: 1 },
  { q: "Welches Tier ist das schnellste an Land?", a: ["Löwe", "Gepard", "Antilope", "Windhund"], c: 1 },
  { q: "Wie viele Spieler stehen beim Fußball pro Team auf dem Platz?", a: ["10", "11", "12", "9"], c: 1 },
  { q: "Welche Farbe entsteht aus Blau + Gelb?", a: ["Orange", "Lila", "Grün", "Braun"], c: 2 },
  { q: "Wie heißt das größte Säugetier der Welt?", a: ["Elefant", "Blauwal", "Giraffe", "Orca"], c: 1 },
  { q: "Wie viele Minuten hat ein Fußballspiel (regulär)?", a: ["80", "90", "100", "120"], c: 1 },
  { q: "Was ist H₂O?", a: ["Sauerstoff", "Wasserstoff", "Wasser", "Salz"], c: 2 },
  { q: "Welcher Monat hat 28 oder 29 Tage?", a: ["Januar", "Februar", "März", "April"], c: 1 },
  { q: "Wie viele Bit hat ein Byte?", a: ["4", "8", "16", "32"], c: 1 },
];

function setupQuiz(io, accounts) {
  let state = null; // { round, rounds, prize, used:Set, q, answers:Map, endsAt, wins:{} }
  let timer = null;

  const publicQ = () => (state && state.q
    ? { round: state.round, rounds: state.rounds, prize: state.prize, text: state.q.q, options: state.q.a, endsAt: state.endsAt }
    : null);
  const snapshot = () => (state ? { active: true, rounds: state.rounds, prize: state.prize, question: publicQ() } : { active: false });

  function cleanup() { clearTimeout(timer); timer = null; state = null; }

  function board() {
    return Object.entries(state.wins)
      .map(([key, w]) => { const a = accounts.get(key); return { name: a ? a.name : key, wins: w }; })
      .sort((a, b) => b.wins - a.wins);
  }

  function nextRound() {
    if (!state) return;
    state.round += 1;
    let idx;
    do { idx = Math.floor(Math.random() * QUESTIONS.length); } while (state.used.has(idx) && state.used.size < QUESTIONS.length);
    state.used.add(idx);
    state.q = QUESTIONS[idx];
    state.answers = new Map();
    state.endsAt = Date.now() + ROUND_MS;
    io.emit("quiz:question", publicQ());
    timer = setTimeout(resolveRound, ROUND_MS + 300);
  }

  function resolveRound() {
    if (!state || !state.q) return;
    const correct = state.q.c;
    let winner = null;
    for (const [key, ans] of state.answers) {
      if (ans.choice !== correct) continue;
      if (!winner || ans.at < winner.at) winner = { key, at: ans.at };
    }
    let winnerRow = null;
    if (winner) {
      accounts.adjustChips(winner.key, state.prize);
      state.wins[winner.key] = (state.wins[winner.key] || 0) + 1;
      const a = accounts.get(winner.key);
      winnerRow = { name: a ? a.name : winner.key, ms: winner.at - (state.endsAt - ROUND_MS) };
    }
    io.emit("quiz:result", { round: state.round, rounds: state.rounds, correct, winner: winnerRow, prize: state.prize, board: board().slice(0, 6) });
    state.q = null;
    if (state.round >= state.rounds) { timer = setTimeout(finish, BREAK_MS); return; }
    timer = setTimeout(nextRound, BREAK_MS);
  }

  function finish() {
    if (!state) return;
    const rows = board();
    if (rows.length) chat.announce(io, `❓ Blitz-Quiz vorbei — Champion: ${rows[0].name} mit ${rows[0].wins} richtigen Antworten! 🏆`);
    else chat.announce(io, "❓ Blitz-Quiz vorbei — keine einzige richtige Antwort. Autsch.");
    io.emit("quiz:end", { board: rows.slice(0, 8) });
    cleanup();
  }

  function start(rounds, prize) {
    if (state) return { ok: false, error: "Es läuft schon ein Quiz." };
    rounds = Math.max(1, Math.min(15, Math.floor(rounds) || 5));
    prize = Math.max(500, Math.floor(prize) || 20000);
    state = { round: 0, rounds, prize, used: new Set(), q: null, answers: new Map(), endsAt: 0, wins: {} };
    chat.announce(io, `❓ BLITZ-QUIZ! ${rounds} Fragen, ${prize.toLocaleString("de-DE")} 🪙 pro Runde für die schnellste richtige Antwort. Erste Frage kommt gleich!`);
    io.emit("quiz:begin", { rounds, prize, firstAt: Date.now() + 4000 });
    timer = setTimeout(nextRound, 4000);
    return { ok: true };
  }

  function stop() {
    if (!state) return;
    chat.announce(io, "❓ Blitz-Quiz abgebrochen.");
    io.emit("quiz:end", { board: board().slice(0, 8), aborted: true });
    cleanup();
  }
  function active() { return !!state; }

  io.on("connection", (socket) => {
    socket.on("quiz:state", (ack) => { if (typeof ack === "function") ack({ ok: true, ...snapshot() }); });

    socket.on("quiz:answer", ({ choice } = {}, ack) => {
      const done = (r) => { if (typeof ack === "function") ack(r); };
      if (!state || !state.q || !socket.data.account) return done({ ok: false });
      if (Date.now() > state.endsAt) return done({ ok: false, late: true });
      const key = socket.data.account;
      if (state.answers.has(key)) return done({ ok: false, dup: true });
      choice = Math.floor(Number(choice));
      if (!(choice >= 0 && choice < 4)) return done({ ok: false });
      state.answers.set(key, { choice, at: Date.now() });
      done({ ok: true, choice });
    });
  });

  return { start, stop, active };
}

module.exports = { setupQuiz };
