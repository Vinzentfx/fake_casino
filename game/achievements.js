"use strict";

/**
 * Achievements: einmalige Meilensteine mit Chip-Belohnung.
 *
 * Alles auf dem Server: der Fortschritt kommt aus Daten, die der Server ohnehin
 * hat (acc.stats, Kontostand, Besitz in der Stadt), nie vom Client. Wer eins
 * freischaltet, bekommt sofort Chips über adjustChips und eine Nachricht
 * ("ach:unlocked"), die großen (ab 100k Belohnung) stehen auch im Chat.
 *
 * Was freigeschaltet ist, steht am Konto: acc.ach = { [id]: Zeitpunkt }.
 *
 * Die Belohnungen sind so etwas wie das Karriere-Einkommen. Zusammen mit dem
 * Bonus bezahlen sie einem neuen Spieler die ersten Häuser, während die Spiele
 * selbst einen Hausvorteil behalten (unter 100 % RTP).
 */

const city = require("./city");

/* Fuer "Alles probiert": die Spiele, die als Casino-Spiel zaehlen. Kommt
   ueber die Schluessel, die recordHand benutzt. */
const CASINO_SPIELE = ["slots", "blackjack", "roulette", "crash", "mines", "towers",
  "pinco", "horses", "sportwetten", "hilo", "wuerfel"];

/*
 * Ein Achievement ist ein Ziel und ein Wert, nicht eine Ja/Nein-Pruefung.
 *
 * Vorher stand hier `check: (a) => a.stats.gamesPlayed >= 100`. Damit gab es
 * keine Moeglichkeit zu zeigen, wie weit jemand ist, man sah nur "zu" oder
 * "offen", und das ist bei "Spiele 1.000 Runden" ziemlich entmutigend.
 *
 * Jetzt liefert jede Zeile `wert(acc, key)` und `ziel`. Die Freischaltung ist
 * daraus abgeleitet (wert >= ziel), der Fortschrittsbalken benutzt dieselben
 * Zahlen. So koennen Balken und Bedingung gar nicht auseinanderlaufen.
 *
 * `ziel: 1` mit einem Wert von 0 oder 1 ist der Ja/Nein-Fall.
 */
const DEFS = [
  // Casino
  { id: "first_win",   emoji: "🎉", label: "Erster Gewinn",   desc: "Gewinne deine erste Runde",   reward: 1000,
    ziel: 1,        wert: (a) => (a.stats && a.stats.handsWon) || 0 },
  { id: "plays_100",   emoji: "🎲", label: "Stammgast",       desc: "Spiele 100 Runden",           reward: 10000,
    ziel: 100,      wert: (a) => (a.stats && a.stats.gamesPlayed) || 0 },
  { id: "plays_1000",  emoji: "🔥", label: "Dauergast",       desc: "Spiele 1.000 Runden",         reward: 100000,
    ziel: 1000,     wert: (a) => (a.stats && a.stats.gamesPlayed) || 0 },
  { id: "plays_10000", emoji: "🏛️", label: "Inventar",        desc: "Spiele 10.000 Runden",        reward: 400000,
    ziel: 10000,    wert: (a) => (a.stats && a.stats.gamesPlayed) || 0 },
  { id: "bigwin_10k",  emoji: "💥", label: "Dicker Fisch",    desc: "Einzelgewinn über 10.000",    reward: 5000,
    ziel: 10000,    wert: (a) => (a.stats && a.stats.biggestWin) || 0 },
  { id: "bigwin_100k", emoji: "🚀", label: "Jackpot-Jäger",   desc: "Einzelgewinn über 100.000",   reward: 50000,
    ziel: 100000,   wert: (a) => (a.stats && a.stats.biggestWin) || 0 },
  { id: "bigwin_1m",   emoji: "🌋", label: "Legende",         desc: "Einzelgewinn über 1 Million", reward: 250000,
    ziel: 1000000,  wert: (a) => (a.stats && a.stats.biggestWin) || 0 },
  { id: "chips_100k",  emoji: "💰", label: "Erste 100k",      desc: "Kontostand über 100.000",     reward: 10000,
    ziel: 100000,   wert: (a) => a.chips || 0 },
  { id: "chips_1m",    emoji: "💎", label: "Millionär",       desc: "Kontostand über 1 Million",   reward: 50000,
    ziel: 1000000,  wert: (a) => a.chips || 0 },
  { id: "chips_100m",  emoji: "👑", label: "Krösus",          desc: "Kontostand über 100 Millionen", reward: 500000,
    ziel: 100000000, wert: (a) => a.chips || 0 },
  { id: "streak_7",    emoji: "📅", label: "Bonus-Serie",     desc: "Hol den Stunden-Bonus 7× in Folge", reward: 25000,
    ziel: 7,        wert: (a) => a.bonusStreak || 0 },
  { id: "streak_30",   emoji: "🗓️", label: "Nie verpasst",    desc: "Hol den Stunden-Bonus 30× in Folge", reward: 100000,
    ziel: 30,       wert: (a) => a.bonusStreak || 0 },
  { id: "level_25",    emoji: "⭐", label: "Erfahren",        desc: "Erreiche Level 25",           reward: 50000,
    ziel: 25,       wert: (a) => Math.floor(Math.sqrt(Math.max(0, a.xp || 0) / 100)) + 1 },
  { id: "level_50",    emoji: "🌟", label: "Veteran",         desc: "Erreiche Level 50",           reward: 200000,
    ziel: 50,       wert: (a) => Math.floor(Math.sqrt(Math.max(0, a.xp || 0) / 100)) + 1 },

  // Die einzelnen Spiele
  { id: "alle_spiele", emoji: "🎡", label: "Alles probiert",  desc: "Spiel jedes Casino-Spiel mindestens einmal", reward: 75000,
    ziel: CASINO_SPIELE.length, wert: (a) => {
      const pg = (a.stats && a.stats.perGame) || {};
      return CASINO_SPIELE.filter((g) => (pg[g] && pg[g].plays) > 0).length;
    } },
  { id: "hilo_kette",  emoji: "🂡", label: "Kartenleser",     desc: "Acht Treffer in Folge bei Higher/Lower", reward: 40000,
    ziel: 8,        wert: (a) => (a.serien && a.serien.hiloBest) || 0 },
  { id: "wuerfel_fuenf", emoji: "🎲", label: "Fünf gleiche",  desc: "Wirf fünf gleiche beim Würfelpoker", reward: 40000,
    ziel: 1,        wert: (a) => (a.serien && a.serien.wuerfelFuenf) || 0 },
  { id: "lotto_drei",  emoji: "🎟️", label: "Drei Richtige",   desc: "Drei Richtige in der Lotterie", reward: 25000,
    ziel: 1,        wert: (a) => (a.lotto && a.lotto.drei) || 0 },
  { id: "lotto_jackpot", emoji: "🍀", label: "Der Jackpot",   desc: "Knack den Lotterie-Jackpot",  reward: 250000,
    ziel: 1,        wert: (a) => (a.lotto && a.lotto.jackpot) || 0 },
  { id: "bj_serie",    emoji: "♠️", label: "Heiße Hand",      desc: "Fünf Blackjack-Hände in Folge gewinnen", reward: 30000,
    ziel: 5,        wert: (a) => (a.serien && a.serien.blackjackBest) || 0 },
  { id: "horse_own",   emoji: "🐴", label: "Eigenes Pferd",   desc: "Kauf dir ein Rennpferd",      reward: 5000,
    ziel: 1,        wert: (a) => a.horsesOwned || 0 },
  { id: "horse_win",   emoji: "🏇", label: "Zieleinlauf",     desc: "Gewinn ein Rennen",           reward: 15000,
    ziel: 1,        wert: (a) => a.horseWins || 0 },
  { id: "horse_win_25", emoji: "🏅", label: "Rennstall",      desc: "Gewinn 25 Rennen",            reward: 120000,
    ziel: 25,       wert: (a) => a.horseWins || 0 },

  // Stadt
  { id: "first_house", emoji: "🏠", label: "Eigenheim",       desc: "Kauf dein erstes Haus",       reward: 2500,
    ziel: 1,        wert: (a, k) => cityStats(k).houses },
  { id: "houses_10",   emoji: "🏘️", label: "Häuslebauer",     desc: "Besitze 10 Häuser",           reward: 25000,
    ziel: 10,       wert: (a, k) => cityStats(k).houses },
  { id: "houses_50",   emoji: "🏗️", label: "Immobilienhai",   desc: "Besitze 50 Häuser",           reward: 100000,
    ziel: 50,       wert: (a, k) => cityStats(k).houses },
  { id: "houses_150",  emoji: "🌆", label: "Halb Porta",      desc: "Besitze 150 Häuser",          reward: 300000,
    ziel: 150,      wert: (a, k) => cityStats(k).houses },
  { id: "first_street", emoji: "👑", label: "Straßenzug",     desc: "Erstes Straßen-Monopol",      reward: 50000,
    ziel: 1,        wert: (a, k) => city.streetCount(k) },
  { id: "streets_5",   emoji: "🛣️", label: "Straßenkönig",    desc: "5 komplette Straßen",         reward: 250000,
    ziel: 5,        wert: (a, k) => city.streetCount(k) },
  { id: "first_trophy", emoji: "🏆", label: "Trophäen-Jäger", desc: "Kauf ein Trophäen-Gebäude",   reward: 100000,
    ziel: 1,        wert: (a, k) => city.trophiesOf(k).length },
  { id: "boss",        emoji: "🥇", label: "Stadtteil-Boss",  desc: "Werde Boss eines Ortsteils",  reward: 100000,
    ziel: 1,        wert: (a, k) => cityStats(k).boss },
  { id: "boss_3",      emoji: "🎖️", label: "Dreifach-Boss",   desc: "Werde Boss von drei Ortsteilen", reward: 300000,
    ziel: 3,        wert: (a, k) => cityStats(k).boss },
  { id: "bank_baron",  emoji: "🏦", label: "Bank-Baron",      desc: "Besitze die Bank",            reward: 500000,
    ziel: 1,        wert: (a, k) => (city.bankOwner() === k ? 1 : 0) },
  { id: "casino_king", emoji: "🎰", label: "Casino-König",    desc: "Besitze das Casino",          reward: 1000000,
    ziel: 1,        wert: (a, k) => (city.casinoOwner() === k ? 1 : 0) },

  // Wirtschaft
  { id: "sparer",      emoji: "🐷", label: "Sparbuch",        desc: "Leg 100.000 aufs Sparkonto",  reward: 15000,
    ziel: 100000,   wert: (a) => (a.savings && a.savings.amount) || 0 },
  { id: "sparer_gross", emoji: "🏛️", label: "Vermögensverwalter", desc: "Leg 1 Million aufs Sparkonto", reward: 80000,
    ziel: 1000000,  wert: (a) => (a.savings && a.savings.amount) || 0 },

  // Miteinander
  { id: "im_clan",     emoji: "🛡️", label: "Im Clan",         desc: "Tritt einem Clan bei",        reward: 5000,
    ziel: 1,        wert: (a) => (a.clan ? 1 : 0) },
  { id: "spendabel",   emoji: "🤝", label: "Spendabel",       desc: "Schick jemandem Chips",       reward: 5000,
    ziel: 1,        wert: (a) => a.transfersSent || 0 },
  { id: "gastgeber",   emoji: "📣", label: "Gastgeber",       desc: "Lade jemanden in deine Lobby ein", reward: 5000,
    ziel: 1,        wert: (a) => a.einladungen || 0 },

  // Aussehen
  { id: "stil_10",     emoji: "🎨", label: "Angezogen",       desc: "Besitze 10 Kosmetik-Stücke",  reward: 20000,
    ziel: 10,       wert: (a) => {
      const o = a.cosOwned || {};
      return Object.values(o).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
    } },
  { id: "stil_30",     emoji: "💅", label: "Kleiderschrank",  desc: "Besitze 30 Kosmetik-Stücke",  reward: 100000,
    ziel: 30,       wert: (a) => {
      const o = a.cosOwned || {};
      return Object.values(o).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
    } },

  // Meta / Events
  { id: "cal_week",    emoji: "📅", label: "Treuer Gast",     desc: "Hol Tag 7 im Login-Kalender", reward: 25000,
    ziel: 7,        wert: (a) => a.calBest || 0 },
  { id: "tourney_win", emoji: "🏁", label: "Turniersieger",   desc: "Gewinne ein Slot-Turnier",    reward: 50000,
    ziel: 1,        wert: (a) => a.tourneyWins || 0 },
  { id: "bounty",      emoji: "🎯", label: "Kopfgeldjäger",   desc: "Kassiere ein Kopfgeld",       reward: 50000,
    ziel: 1,        wert: (a) => a.bountyClaims || 0 },
  { id: "rekordhalter", emoji: "🥇", label: "Rekordhalter",   desc: "Halte einen Wochenrekord",    reward: 40000,
    ziel: 1,        wert: (a) => a.rekorde || 0 },
  { id: "season_20",   emoji: "🎟️", label: "Durchgespielt",   desc: "Erreiche Stufe 20 im Season-Pass", reward: 150000,
    ziel: 20,       wert: (a) => {
      try { return require("./season").levelVonXp((a.season && a.season.xp) || 0); } catch { return 0; }
    } },

  // Denkspiele (PvP-Duelle & Solitär)
  { id: "duel_win_1",  emoji: "🤝", label: "Erstes Duell",    desc: "Gewinne dein erstes PvP-Duell", reward: 2500,
    ziel: 1,        wert: (a) => a.pvpWins || 0 },
  { id: "duel_win_25", emoji: "⚔️", label: "Duellmeister",    desc: "Gewinne 25 PvP-Duelle",       reward: 50000,
    ziel: 25,       wert: (a) => a.pvpWins || 0 },
  { id: "memory_win",  emoji: "🧠", label: "Gedächtniskünstler", desc: "Gewinne ein Memory-Duell", reward: 5000,
    ziel: 1,        wert: (a) => (a.pvpWinsByGame && a.pvpWinsByGame.memory) || 0 },
  { id: "sudoku_win",  emoji: "🔢", label: "Zahlenjäger",     desc: "Löse ein Sudoku (Solo oder Race)", reward: 5000,
    ziel: 1,        wert: (a) => ((a.pvpWinsByGame && a.pvpWinsByGame.sudoku) || 0) + (a.sudokuSolved || 0) },
  { id: "chess_win_1", emoji: "♟️", label: "Schachmatt",      desc: "Gewinne ein Schach-Duell",    reward: 5000,
    ziel: 1,        wert: (a) => a.chessWins || 0 },
  { id: "chess_win_10", emoji: "♚", label: "Großmeister",     desc: "Gewinne 10 Schach-Duelle",    reward: 75000,
    ziel: 10,       wert: (a) => a.chessWins || 0 },
  { id: "sol_clear",   emoji: "🃏", label: "Patience-Profi",  desc: "Räum Solitär gegen das Haus ab", reward: 5000,
    ziel: 1,        wert: (a) => a.solitaireClears || 0 },
  { id: "kniffel_win", emoji: "🎯", label: "Kniffel-Sieger",  desc: "Gewinne ein Kniffel-Duell",   reward: 15000,
    ziel: 1,        wert: (a) => (a.pvpWinsByGame && a.pvpWinsByGame.kniffel) || 0 },
];

/** Wie weit ist jemand? Immer aus denselben Zahlen wie die Freischaltung. */
function fortschritt(d, acc, key) {
  let ist = 0;
  try { ist = Number(d.wert(acc, key)) || 0; } catch {}
  const ziel = d.ziel || 1;
  return { ist: Math.min(ist, ziel), roh: ist, ziel, anteil: Math.max(0, Math.min(1, ist / ziel)) };
}

const erreicht = (d, acc, key) => fortschritt(d, acc, key).roh >= (d.ziel || 1);

// Günstige Stadt-Zahlen für die Prüfungen oben.
function cityStats(key) {
  const ov = city.publicOverview(key);
  return { houses: ov.me ? ov.me.houses : 0, boss: ov.me ? ov.me.bossOf.length : 0 };
}

let _io = null, _accounts = null;

/** Alle Definitionen für einen Spieler prüfen, neue freischalten, auszahlen, Bescheid geben. */
function check(name) {
  if (!_accounts) return;
  const acc = _accounts.get(name);
  if (!acc) return;
  const key = String(name).trim().toLowerCase();
  acc.ach = acc.ach || {};
  for (const d of DEFS) {
    if (acc.ach[d.id]) continue;
    let hit = false;
    try { hit = erreicht(d, acc, key); } catch {}
    if (!hit) continue;
    acc.ach[d.id] = Date.now();
    _accounts.adjustChips(key, d.reward); // pays + saves (chip cap applies)
    if (_io) {
      _io.emit("ach:unlocked", { user: acc.name, id: d.id, emoji: d.emoji, label: d.label, reward: d.reward });
      if (d.reward >= 100000) {
        const chat = require("./chat");
        chat.announce(_io, `${acc.name} hat „${d.label}“ freigeschaltet.`);
      }
    }
  }
}

/** Alle Definitionen mit dem Stand des Spielers (Abzeichen im Profil). */
function listFor(name) {
  const acc = _accounts && _accounts.get(name);
  const ach = (acc && acc.ach) || {};
  const key = String(name).trim().toLowerCase();
  return DEFS.map((d) => {
    const f = acc ? fortschritt(d, acc, key) : { ist: 0, ziel: d.ziel || 1, anteil: 0 };
    return {
      id: d.id, emoji: d.emoji, label: d.label, desc: d.desc, reward: d.reward,
      unlocked: !!ach[d.id], at: ach[d.id] || null,
      ist: f.ist, ziel: f.ziel, anteil: ach[d.id] ? 1 : f.anteil,
    };
  });
}

/** Emoji eines Achievements (Abzeichen in der Bestenliste) oder null. */
function emojiOf(id) {
  const d = DEFS.find((x) => x.id === id);
  return d ? d.emoji : null;
}

function setupAchievements(io, accounts) {
  _io = io;
  _accounts = accounts;
  // Jede verbuchte Runde kann ein Casino-Achievement abschließen.
  accounts.onHand((name) => check(name));

  io.on("connection", (socket) => {
    socket.on("ach:list", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      /*
       * Erst pruefen, dann auflisten.
       *
       * Sonst steht im Profil "10 von 10" und trotzdem ein Schloss: die
       * Pruefung haengt an accounts.onHand, laeuft also erst bei der naechsten
       * gespielten Runde. Wer etwas ausserhalb der Spiele erreicht (Haeuser,
       * Kosmetik, Sparkonto), sah das Schloss bis dahin weiter.
       */
      check(socket.data.account);
      const acc = accounts.get(socket.data.account);
      ack({ ok: true, list: listFor(socket.data.account), badge: (acc && acc.badge) || null });
    });

    // ein freigeschaltetes Achievement als Abzeichen hinter dem Namen in der
    // Bestenliste wählen (id = null nimmt es wieder weg).
    socket.on("ach:setBadge", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const acc = accounts.get(socket.data.account);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      if (id == null) { delete acc.badge; accounts.save(); return ack({ ok: true, badge: null }); }
      if (!acc.ach || !acc.ach[id]) return ack({ ok: false, error: "Achievement noch nicht freigeschaltet." });
      acc.badge = id;
      accounts.save();
      ack({ ok: true, badge: id });
    });
  });
}

module.exports = { setupAchievements, check, listFor, emojiOf };
