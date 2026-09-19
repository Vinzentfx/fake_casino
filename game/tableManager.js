"use strict";

/**
 * Verwaltet alle laufenden Pokertische und hängt sie an Socket.IO.
 *
 * Ein Socket sitzt immer nur an einem Tisch. Beim Buy-in und bei der Auszahlung
 * wandern Chips zwischen Konto (accounts.js) und Platz, solange man sitzt, gilt
 * der Stapel am Platz.
 */

const { PokerTable } = require("./pokerTable");
const { decide: botDecide, BOT_NAMES } = require("./pokerBot");
const lobby = require("./lobby");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne Zeichen, die man verwechseln kann
const NEXT_HAND_DELAY_MS = 4500;
// Obergrenzen: an Bot-Tischen zahlt das Haus die Stapel der Bots, ein Buy-in
// ohne Deckel wäre also eine Gelddruckmaschine (Bots schlagen, erfundene Chips
// einstecken). Deshalb Buy-in und Blinds deckeln, das Buy-in deckt die Blinds immer.
const MAX_BUYIN = 100000;
const MAX_BB = 2000;
const TURN_MS = 30000; // wer 30 s nichts tut, foldet automatisch

/**
 * Wer war zuletzt da, ist aber gerade nicht online.
 *
 * Das Casino sah bisher immer leer aus, wenn man allein reinkam, und man
 * konnte nicht unterscheiden zwischen "alle sind weg" und "vor zwanzig
 * Minuten war hier noch was los". Genau diese Auskunft entscheidet, ob es
 * sich lohnt, kurz zu warten oder die anderen zu rufen.
 */
function kuerzlichDa(accounts, online, grenzeTage = 7, max = 6) {
  const jetzt = Date.now();
  const grenze = grenzeTage * 86400000;
  const drin = new Set((online || []).map((p) => String(p.name || "").toLowerCase()));
  return accounts.rawAll()
    .filter((a) => a.lastSeen && jetzt - a.lastSeen < grenze && !drin.has(String(a.name || "").toLowerCase()))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, max)
    .map((a) => ({ ...require("./cosmetics").publicLook(a), name: a.name, lastSeen: a.lastSeen }));
}

/**
 * Eintritts-Spruch im Chat.
 *
 * Nur, wenn der Spieler sich einen gekauft hat, und hoechstens einmal pro
 * Stunde: sonst wird aus jedem Wackler der Mobilfunkverbindung eine Ansage.
 * Auf dem iPad passiert genau das staendig, wenn Safari den Tab wegraeumt.
 */
const EINTRITT_ABSTAND_MS = 60 * 60 * 1000;
function meldeEintritt(acc) {
  try {
    const spruch = require("./cosmetics").eintrittsSpruch(acc);
    if (!spruch) return;
    const jetzt = Date.now();
    if (jetzt - (acc.letzterEintritt || 0) < EINTRITT_ABSTAND_MS) return;
    acc.letzterEintritt = jetzt;
    require("./chat").announce(_io, `${spruch}`);
  } catch {}
}

let _io = null;

function setupPoker(io, accounts) {
  _io = io;
  /** je Code: { table, sockets:Set<Socket>, timer } */
  const tables = new Map();

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      ).join("");
    } while (tables.has(code));
    return code;
  }

  function broadcast(code) {
    const entry = tables.get(code);
    if (!entry) return;
    scheduleTurnTimer(entry); // Auto-Fold-Timer für den, der dran ist, (neu) stellen
    for (const sock of entry.sockets) {
      const viewerId = sock.data.account || null;
      const st = entry.table.getStateFor(viewerId);
      st.isHost = !entry.vsBots && entry.hostKey === viewerId;
      st.hostName = entry.hostName || null;
      st.vsBots = !!entry.vsBots;
      st.turnDeadline = entry.turnDeadline || null;
      // Der Client zeichnet daraus den Balken am Sitz. Die Dauer kommt mit,
      // damit sie nicht doppelt gepflegt werden muss.
      st.turnMs = TURN_MS;
      sock.emit("poker:state", st);
    }
  }

  // Wer trödelt, foldet automatisch, damit niemand den Tisch einfrieren kann.
  function scheduleTurnTimer(entry) {
    const { table } = entry;
    clearTimeout(entry.turnTimer);
    entry.turnDeadline = null;
    if (!table.handActive || table.toAct < 0) return;
    const idx = table.toAct;
    const seat = table.seats[idx];
    if (!seat || seat.isBot) return; // Bots handeln über scheduleBots
    entry.turnDeadline = Date.now() + TURN_MS;
    entry.turnTimer = setTimeout(() => {
      if (!tables.has(table.code) || !table.handActive || table.toAct !== idx) return;
      const toCall = table.currentBet - seat.bet;
      table.act(seat.id, toCall > 0 ? "fold" : "check", 0); // automatisch folden (oder gratis checken)
      broadcast(table.code);
      scheduleBots(entry);
    }, TURN_MS);
  }

  function destroyIfEmpty(code) {
    const entry = tables.get(code);
    if (!entry) return;
    // Kein Mensch mehr am Tisch: abbauen (Bots halten ihn nicht am Leben).
    if (entry.sockets.size === 0) {
      clearTimeout(entry.timer);
      clearTimeout(entry.botTimer);
      clearTimeout(entry.turnTimer);
      tables.delete(code);
      lobby.remove(code);
    }
  }

  // Öffentlicher Eintrag für die Lobby-Liste (nur offene Tische unter Freunden,
  // keine privaten Solo-Spiele gegen Bots).
  function describePoker(entry) {
    const { table } = entry;
    const maxSeats = table.seats.length;
    return {
      code: table.code,
      game: "poker",
      label: "Poker",
      host: entry.hostName || "?",
      players: entry.sockets.size,
      max: maxSeats,
      buyIn: `Blinds ${table.smallBlind}/${table.bigBlind}`,
      joinable: !entry.vsBots && entry.sockets.size < maxSeats,
    };
  }
  const registerLobby = (code) =>
    lobby.add(code, () => (tables.has(code) ? describePoker(tables.get(code)) : null));

  const SCREEN_LABELS = {
    lobby: "in der Lobby",
    hilo: "bei Higher/Lower",
    wuerfel: "beim Würfelpoker",
    kniffel: "beim Kniffel",
    lotterie: "bei der Lotterie",
    poker: "spielt Poker",
    slots: "an den Slots",
    blackjack: "spielt Blackjack",
    roulette: "spielt Roulette",
    sports: "bei Sportwetten",
    crash: "spielt Crash",
    mines: "spielt Mines",
    towers: "klettert im Turm",
    horses: "an der Rennbahn",
    pinco: "spielt Pinco Ball",
    memory: "spielt Memory",
    sudoku: "spielt Sudoku",
    solitaire: "spielt Solitär",
    chess: "spielt Schach",
    work: "arbeitet",
    businesses: "auf der Stadtkarte",
    bank: "in der Bank",
    stocks: "an der Börse",
    clans: "bei den Clans",
    quests: "bei Aufträgen",
    leaderboard: "in der Bestenliste",
    profile: "im Profil",
    stats: "bei Statistiken",
    cosmetics: "in der Sammlung",
    calendar: "im Kalender",
    wheel: "am Glücksrad",
    transfer: "sendet Chips",
    settings: "in Einstellungen",
    suggest: "bei Vorschlägen",
    market: "auf dem Markt",
    /* Kisten und Auktionshaus haben gefehlt, seit es sie gibt: wer dort
       sass, stand in der Anwesenheitsliste als "online". */
    kiste: "bei den Kisten",
    auktion: "im Auktionshaus",
    season: "beim Season-Pass",
  };
  // Towers und Rennbahn fehlten hier. Weil presence:screen unbekannte Namen
  // auf "lobby" zurueckfallen laesst, sah man jeden, der dort spielte, als
  // "in der Lobby", und auf den Spielkarten waeren beide dauerhaft leer.
  const GAME_SCREENS = new Set(["poker", "slots", "blackjack", "roulette", "sports", "crash", "mines", "towers", "horses", "pinco", "memory", "sudoku", "solitaire", "chess", "hilo", "wuerfel", "kniffel"]);
  function pickStatus(sockets) {
    const screens = sockets.map((s) => s.data && s.data.screen).filter(Boolean);
    const game = screens.find((name) => GAME_SCREENS.has(name));
    const screen = game || screens.find((name) => name !== "lobby") || screens[0] || "lobby";
    return { screen, label: SCREEN_LABELS[screen] || "online" };
  }

  function onlinePlayers() {
    const byAccount = new Map();
    for (const s of io.of("/").sockets.values()) {
      const key = s.data && s.data.account;
      if (!key) continue;
      const list = byAccount.get(key) || [];
      list.push(s);
      byAccount.set(key, list);
    }
    const list = [];
    for (const [key, sockets] of byAccount.entries()) {
      const acc = accounts.get(key);
      if (!acc) continue;
      const pub = accounts.publicAccount(acc);
      const status = pickStatus(sockets);
      list.push({
        name: pub.name,
        avatar: pub.avatar,
        nameColor: pub.nameColor,
        nameStyle: pub.nameStyle,
        frame: pub.frame,
        title: pub.title,
        schild: pub.schild,
        level: pub.level ? { level: pub.level.level, emoji: pub.level.emoji, color: pub.level.color } : null,
        clan: (() => { try { return require("./clans").tagOf(key); } catch { return null; } })(),
        status,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
    return list;
  }

  function broadcastPresence() {
    io.emit("presence:update", { online: onlinePlayers() });
  }

  function humanHasChips(table) {
    return table.seats.some((s) => s && !s.isBot && s.chips > 0);
  }
  function tableHasBots(table) {
    return table.seats.some((s) => s && s.isBot);
  }
  function pickBotName(table) {
    const used = new Set(table.seats.filter((s) => s && s.isBot).map((s) => s.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const pool = free.length ? free : BOT_NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Ist ein Bot dran, nach kurzer "Denkpause" spielen und weiter.
  function scheduleBots(entry) {
    const { table } = entry;
    if (!table.handActive || table.toAct < 0) return;
    const idx = table.toAct;
    const seat = table.seats[idx];
    if (!seat || !seat.isBot) return;
    clearTimeout(entry.botTimer);
    entry.botTimer = setTimeout(() => {
      if (!tables.has(table.code) || !table.handActive || table.toAct !== idx) return;
      let { action, amount } = botDecide(table, idx);
      let res = table.act(seat.id, action, amount);
      if (!res.ok) {
        const toCall = table.currentBet - seat.bet;
        res = table.act(seat.id, toCall > 0 ? "call" : "check", 0);
        if (!res.ok) table.act(seat.id, "fold", 0);
      }
      broadcast(table.code);
      scheduleBots(entry);
    }, 800 + Math.random() * 700);
  }

  function attachHooks(entry, code) {
    const { table } = entry;
    // Statistik je Hand (Netto gewonnen oder verloren) über die Kontoverwaltung.
    table.onResults = (results) => {
      for (const r of results) accounts.recordHand(r.id, r.amount, false, "poker"); // Poker ist PvP, kein Rake
    };
    // Nach einer Hand: Ergebnis zeigen, dann die nächste automatisch starten.
    table.onHandComplete = () => {
      broadcast(code);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        // Bots nicht weiter gegeneinander spielen lassen, wenn der Mensch pleite oder weg ist.
        if (tableHasBots(table) && !humanHasChips(table)) return;
        if (table.canStart()) {
          table.startHand();
          broadcast(code);
          scheduleBots(entry);
        }
      }, NEXT_HAND_DELAY_MS);
    };
  }

  function currentEntry(socket) {
    const code = socket.data.tableCode;
    return code ? tables.get(code) : null;
  }

  /** Einen Socket von seinem Tisch holen (und einen Platz dabei auszahlen). */
  function leaveCurrent(socket) {
    const entry = currentEntry(socket);
    if (!entry) return;
    const { table } = entry;
    const code = table.code;

    const seatIdx = table.findSeat(socket.data.account);
    if (seatIdx !== -1) {
      const chips = table.stand(socket.data.account);
      if (chips > 0 && socket.data.account) {
        const res = accounts.adjustChips(socket.data.account, chips);
        if (res.ok) socket.emit("account:update", { account: res.account });
      }
    }
    entry.sockets.delete(socket);
    socket.leave(code);
    socket.data.tableCode = null;
    broadcast(code);
    destroyIfEmpty(code);
    if (tables.has(code)) lobby.changed(); // Spieler weg, Tisch bleibt
  }

  io.on("connection", (socket) => {
    socket.data.account = null;
    socket.data.tableCode = null;

    socket.on("auth", ({ token } = {}) => {
      const key = accounts.verifyToken(token);
      const acc = key ? accounts.get(key) : null;
      /* Der Schluessel kommt aus dem Token, nicht aus dem Anzeigenamen.
         Solange sich Namen nicht aendern liessen, war beides dasselbe. Seit
         es Umbenennungen gibt, waere `acc.name.toLowerCase()` nach einem
         Wechsel ein anderer Schluessel als der, unter dem Haeuser, Pferde und
         Aktien dieses Menschen stehen: dieselbe Person mit zwei Identitaeten,
         und der Besitzer verliert dabei sogar seine eigenen Adminrechte. */
      const warSchonDa = acc && [...io.of("/").sockets.values()]
        .some((s2) => s2 !== socket && s2.data && s2.data.account === key);
      socket.data.account = acc ? key : null;
      socket.data.displayName = acc ? acc.name : null;
      broadcastPresence();
      if (acc && !warSchonDa) meldeEintritt(acc);
    });

    socket.on("presence:screen", ({ screen } = {}) => {
      const name = String(screen || "").trim().slice(0, 32);
      if (name && !require("./wortfilter").istSauber(name)) {
        return typeof ack === "function" && ack({ ok: false, error: "Der Tischname geht so nicht." });
      }
      socket.data.screen = SCREEN_LABELS[name] ? name : "lobby";
      broadcastPresence();
    });

    socket.on("presence:list", (ack) => {
      if (typeof ack === "function") ack({ ok: true, online: onlinePlayers(), zuletzt: kuerzlichDa(accounts, onlinePlayers()) });
    });

    socket.on("poker:create", ({ smallBlind = 10, bigBlind = 20 } = {}, ack) => {
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Bitte zuerst einloggen." });
      leaveCurrent(socket);
      const code = makeCode();
      const sb = clampInt(smallBlind, 1, MAX_BB / 2, 10);
      const bb = Math.max(clampInt(bigBlind, 2, MAX_BB, 20), sb * 2);
      const table = new PokerTable(code, { smallBlind: sb, bigBlind: bb });
      const acc = accounts.get(socket.data.account);
      const entry = {
        table, sockets: new Set(), timer: null,
        hostKey: socket.data.account, hostName: (acc && acc.name) || socket.data.displayName || "?",
      };
      tables.set(code, entry);
      attachHooks(entry, code);

      entry.sockets.add(socket);
      socket.join(code);
      socket.data.tableCode = code;
      registerLobby(code);
      typeof ack === "function" && ack({ ok: true, code });
      broadcast(code);
      // Die Benachrichtigung (Chat + Push) macht jetzt lobby.add() fuer alle
      // Spiele. Hier stand sie frueher doppelt, und nur Poker hatte sie.
    });

    // Poker-Bots sind raus: ihre Stapel bezahlte das Haus, wer sie schlug, hat
    // also Chips gedruckt. Poker gibt es jetzt nur noch Mensch gegen Mensch.

    socket.on("poker:join", ({ code } = {}, ack) => {
      if (!socket.data.account) return typeof ack === "function" && ack({ ok: false, error: "Bitte zuerst einloggen." });
      code = String(code || "").trim().toUpperCase();
      const entry = tables.get(code);
      if (!entry) return typeof ack === "function" && ack({ ok: false, error: "Tisch nicht gefunden." });
      leaveCurrent(socket);
      entry.sockets.add(socket);
      socket.join(code);
      socket.data.tableCode = code;
      typeof ack === "function" && ack({ ok: true, code });
      broadcast(code);
      lobby.changed();
    });

    socket.on("poker:sit", ({ buyIn } = {}, ack) => {
      const entry = currentEntry(socket);
      if (!entry) return typeof ack === "function" && ack({ ok: false, error: "Du bist an keinem Tisch." });
      const { table } = entry;
      if (table.findSeat(socket.data.account) !== -1)
        return typeof ack === "function" && ack({ ok: false, error: "Du sitzt bereits." });

      const acc = accounts.get(socket.data.account);
      if (!acc) return typeof ack === "function" && ack({ ok: false, error: "Account nicht gefunden." });
      const cap = Math.min(acc.chips, MAX_BUYIN);
      const amount = clampInt(buyIn, table.bigBlind, cap, Math.min(cap, table.bigBlind * 50));
      if (amount < table.bigBlind || amount > acc.chips)
        return typeof ack === "function" && ack({ ok: false, error: "Ungültiger Buy-in." });

      const deduct = accounts.adjustChips(socket.data.account, -amount);
      if (!deduct.ok) return typeof ack === "function" && ack({ ok: false, error: deduct.error });

      const idx = table.sit(socket.data.account, acc.name, amount);
      if (idx === -1) {
        accounts.adjustChips(socket.data.account, amount); // zurück, Tisch voll
        return typeof ack === "function" && ack({ ok: false, error: "Tisch ist voll." });
      }
      socket.emit("account:update", { account: deduct.account });
      typeof ack === "function" && ack({ ok: true });
      broadcast(table.code);
    });


    socket.on("poker:stand", (ack) => {
      const entry = currentEntry(socket);
      if (!entry) return ack && typeof ack === "function" && ack({ ok: false });
      const { table } = entry;
      const chips = table.stand(socket.data.account);
      if (chips > 0) {
        const res = accounts.adjustChips(socket.data.account, chips);
        if (res.ok) socket.emit("account:update", { account: res.account });
      }
      ack && typeof ack === "function" && ack({ ok: true });
      broadcast(table.code);
    });

    socket.on("poker:leave", () => leaveCurrent(socket));

    socket.on("poker:start", (ack) => {
      const entry = currentEntry(socket);
      if (!entry) return;
      // Die erste Hand darf nur der Lobby-Leiter (wer den Tisch erstellt hat) starten.
      // An Bot-Tischen gibt es diese Sperre nicht, da bestimmt der Solo-Spieler.
      if (!entry.vsBots && entry.hostKey && entry.hostKey !== socket.data.account)
        return typeof ack === "function" && ack({ ok: false, error: "Nur der Anführer kann starten." });
      if (entry.table.startHand()) {
        broadcast(entry.table.code);
        scheduleBots(entry);
      }
      typeof ack === "function" && ack({ ok: true });
    });

    socket.on("poker:action", ({ action, amount } = {}) => {
      const entry = currentEntry(socket);
      if (!entry) return;
      const res = entry.table.act(socket.data.account, action, amount);
      if (!res.ok) socket.emit("poker:error", { message: res.error });
      broadcast(entry.table.code);
      scheduleBots(entry);
    });

    socket.on("disconnect", () => {
      leaveCurrent(socket);
      setTimeout(broadcastPresence, 0);
    });
  });
}

function clampInt(v, min, max, fallback) {
  v = Math.floor(Number(v));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

module.exports = { setupPoker };
