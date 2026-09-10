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
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const accounts = require("./game/accounts");
const { setupPoker } = require("./game/tableManager");
const { setupSlots } = require("./game/slots");
const { setupCrash } = require("./game/crash");
const { setupHorses } = require("./game/horses");
const { setupMines } = require("./game/mines");
const { setupTowers } = require("./game/towers");
const { setupPinco } = require("./game/pinco");
const { setupMemory } = require("./game/memory");
const { setupSuggestions } = require("./game/suggestions");
const { setupSudoku } = require("./game/sudoku");
const { setupSolitaire } = require("./game/solitaire");
const { setupChess } = require("./game/chess");
const { setupSocial } = require("./game/social");
const { setupHeist } = require("./game/heist");
const { setupClans } = require("./game/clans");
const { setupCosmetics } = require("./game/cosmetics");
const { setupPvp } = require("./game/slotsPvp");
const { setupAdmin } = require("./game/admin");
const { setupBlackjack } = require("./game/blackjack");
const { setupBlackjackLobby } = require("./game/blackjackLobby");
const { setupRoulette } = require("./game/roulette");
const { setupRouletteLobby } = require("./game/rouletteLobby");
const { setupSportsbook, persistSports } = require("./game/sportsbook");
const { setupEconomy } = require("./game/economy");
const { setupBank } = require("./game/bank");
const { setupStocks } = require("./game/stocks");
const { setupMarket } = require("./game/market");
const { setupChat } = require("./game/chat");
const { setupLobby } = require("./game/lobby");
const { setupEinladung } = require("./game/einladung");
const { setupKniffel } = require("./game/kniffel");
const { setupHilo } = require("./game/hilo");
const { setupWuerfel } = require("./game/wuerfel");
const { setupLotterie } = require("./game/lotterie");
const { setupBericht } = require("./game/bericht");
const { setupAnnouncements } = require("./game/announcements");
const { setupPrefs } = require("./game/prefs");
const achievements = require("./game/achievements");
const city = require("./game/city");
const quests = require("./game/quests");
const { setupSeason } = require("./game/season");
const { setupRecords } = require("./game/records");
const push = require("./game/push");
const asyncDuell = require("./game/asyncDuell");
const comeback = require("./game/comeback");
const feed = require("./game/feed");
const liveops = require("./game/liveops");
const ipbans = require("./game/ipbans");

const PORT = process.env.PORT || 3000;
const build = require("./game/buildinfo");
// Fest fuer alles, was einmal gilt (Socket-Handshake, Backup-Metadaten).
/**
 * Bau-Kennung, die der Client zu sehen bekommt.
 *
 * Es gibt bewusst nur DIESE eine Quelle. Ein frueherer Versuch hatte den
 * Socket die Kennung vom Serverstart melden lassen und die API die aktuelle.
 * Beim Entwickeln laufen die auseinander, und der Client haelt den Unterschied
 * fuer ein Update: er laedt neu, bekommt wieder beide Werte, laedt wieder neu.
 * Im Betrieb sind beide identisch (der Dienst startet beim Deploy neu), beim
 * Entwickeln liefert current() den frischen Stand.
 */
const appVersion = () => build.current();

// ---------------------------------------------------------------------------
// HTTP / account API
// ---------------------------------------------------------------------------

const app = express();
app.set("trust proxy", true); // hinter Caddy → echte Client-IP steht in x-forwarded-for
app.use(express.json({ limit: "25mb" })); // Restore-Upload = kompletter data/-Ordner als JSON

/**
 * index.html wird nicht statisch ausgeliefert, sondern einmal eingelesen und
 * mit der Bau-Kennung versehen: aus /js/app.js wird /js/app.js?v=<Kennung>.
 *
 * Damit duerfen Skripte, Styles und Bilder ein Jahr im Cache liegen, ohne dass
 * jemand nach einem Deploy auf altem Stand haengen bleibt. Vorher stand auf
 * allem no-store, also lud jeder Seitenaufruf rund 430 KB komplett neu.
 * Auf dem iPad ueber Mobilfunk ist das jedes Mal eine spuerbare Wartezeit.
 */
const INDEX_FILE = path.join(__dirname, "public", "index.html");
let indexHtml = null;
function renderIndex(version) {
  const raw = fs.readFileSync(INDEX_FILE, "utf8");
  return raw.replace(/(src|href)="(\/(?:js|css)\/[^"?]+)"/g, `$1="$2?v=${version}"`);
}
function getIndex() {
  // Im Betrieb einmal berechnet. Beim lokalen Entwickeln jedes Mal neu, sonst
  // muesste man den Server nach jeder HTML-Aenderung von Hand neu starten.
  if (!build.DEV && indexHtml) return indexHtml;
  indexHtml = renderIndex(build.current());
  return indexHtml;
}
app.get(["/", "/index.html"], (_req, res) => {
  // Die Einstiegsseite selbst bleibt ungecacht, sie traegt ja die Kennung.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.type("html").send(getIndex());
});

app.use(express.static(path.join(__dirname, "public"), {
  index: false, // die Einstiegsseite laeuft ueber den Handler oben
  setHeaders(res, filePath, _stat) {
    if (build.DEV) {
      // Beim Entwickeln nie cachen. Ein Reload soll immer den aktuellen
      // Stand zeigen, ohne dass man den Cache von Hand leert.
      res.setHeader("Cache-Control", "no-store");
      return;
    }
    if (/\.html$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      return;
    }
    // Mit Kennung in der URL ist der Inhalt eindeutig, also darf er ein Jahr
    // liegen bleiben.
    if (res.req && res.req.query && res.req.query.v === appVersion()) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    // Bilder, Schriften und Ton tragen keine Kennung, weil sie auch aus dem
    // CSS heraus geladen werden. Ein Tag Frist: waehrend einer Sitzung faellt
    // keine einzige Anfrage mehr an, und eine ausgetauschte Grafik ist
    // spaetestens am naechsten Tag von selbst wieder aktuell.
    if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|mp3|ogg|wav)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      return;
    }
    // Alles ohne Kennung sicherheitshalber jedes Mal nachfragen.
    res.setHeader("Cache-Control", "no-cache");
  },
}));

/**
 * Öffentliche Eckdaten fürs Frontend. Steht bewusst vor dem Login zur
 * Verfügung, weil die Login-Seite das Startguthaben nennt. Vorher stand
 * die Zahl im HTML und war irgendwann falsch (1.000 statt 5.000).
 */
app.get("/api/config", (_req, res) => {
  res.json({
    startingChips: accounts.STARTING_CHIPS,
    bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS,
  });
});

app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json({ version: build.current() });
});

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
    warnFails: result.warnFails || 0,
    config: { bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS },
  });
});

/**
 * Resume a stored session. The client keeps its token in localStorage so that
 * an iPad discarding the Safari tab doesn't force a re-login (and, with the
 * escalating lockout, risk locking someone out over a mistyped password).
 */
app.post("/api/session", (req, res) => {
  const result = accounts.resumeSession(req.body && req.body.token);
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.json({
    account: result.account,
    token: result.token,
    config: { bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS },
  });
});

/** Bonus/Soforthilfe act on an account → the caller must prove it's theirs. */
function requireOwnAccount(req, res) {
  const key = accounts.verifyToken(req.body.token);
  if (!key || key !== String(req.body.name || "").trim().toLowerCase()) {
    res.status(403).json({ error: "Nicht autorisiert." });
    return null;
  }
  return key;
}

app.post("/api/daily-bonus", (req, res) => {
  if (!requireOwnAccount(req, res)) return;
  const result = accounts.claimDailyBonus(req.body.name);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  achievements.check(req.body.name); // streak/chips milestones
  quests.track(req.body.name, "claim_bonus");
  res.json({
    amount: result.amount, base: result.base, tribute: result.tribute,
    streets: result.streets, golden: result.golden, houses: result.houses,
    housesOwned: result.housesOwned, sets: result.sets, setList: result.setList,
    cashback: result.cashback, streak: result.streak, taper: result.taper,
    account: result.account,
  });
});

app.post("/api/rescue", (req, res) => {
  if (!requireOwnAccount(req, res)) return;
  const result = accounts.rescue(req.body.name);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  res.json({ amount: result.amount, account: result.account });
});

app.get("/api/account/:name", (req, res) => {
  const acc = accounts.get(req.params.name);
  if (!acc) return res.status(404).json({ error: "Account nicht gefunden." });
  // Full public stats: account + city empire + achievements (viewable by anyone
  // — it's a friends game, the leaderboard links here).
  const key = req.params.name.trim().toLowerCase();
  const cityMe = city.publicOverview(key).me;
  const achList = achievements.listFor(key);
  res.json({
    account: accounts.publicAccount(acc),
    clan: (() => { try { return require("./game/clans").tagOf(key); } catch { return null; } })(),
    city: cityMe ? {
      houses: cityMe.houses, value: cityMe.value, streets: cityMe.streets,
      trophies: cityMe.trophies, bossOf: cityMe.bossOf, color: cityMe.color,
    } : null,
    ach: {
      unlocked: achList.filter((a) => a.unlocked).map((a) => ({ id: a.id, emoji: a.emoji, label: a.label })),
      total: achList.length,
      badge: acc.badge ? achievements.emojiOf(acc.badge) : null,
    },
    bounty: accounts.bountyOn(key),
  });
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
// Owner-Backup: der komplette data/-Ordner (Accounts, Pferde, Stadt, …) als
// EIN JSON-Bundle zum Herunterladen — und als Upload zum Wiederherstellen,
// z.B. beim Umzug auf einen neuen Host, wenn der Datenordner leer startet.
// ---------------------------------------------------------------------------

const OWNER_KEY = "vincent"; // muss zu OWNER in game/admin.js passen
const DATA_DIR = path.join(__dirname, "data");

function requireOwner(req, res) {
  const key = accounts.verifyToken(req.body && req.body.token);
  if (key !== OWNER_KEY) {
    res.status(403).json({ error: "Nur der Casino-Boss darf das." });
    return false;
  }
  return true;
}

/*
 * Hochgeladene Bilder ausliefern.
 *
 * Eigene Route statt express.static: der Ordner liegt in data/, und dort
 * soll niemand stoebern koennen. Hier kommt nur heraus, was genau dem
 * erwarteten Namensschema entspricht.
 */
app.get("/bilder/:datei", (req, res) => {
  const datei = String(req.params.datei || "");
  if (!/^[a-z0-9_-]+-[a-z0-9_-]+\.(webp|png|jpg)$/.test(datei)) return res.status(404).end();
  const p = path.join(DATA_DIR, "bilder", datei);
  // Doppelt genaeht: der Name ist geprueft, der aufgeloeste Pfad muss
  // trotzdem im Bilderordner liegen.
  const wurzel = path.join(DATA_DIR, "bilder");
  if (!path.resolve(p).startsWith(path.resolve(wurzel))) return res.status(404).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  const typ = datei.endsWith(".png") ? "image/png" : datei.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  res.setHeader("Content-Type", typ);
  /* Ein Jahr, aber nur weil jede Adresse einen Stand-Anhang traegt: wird
     ein Wappen ersetzt, aendert sich die Adresse und der Browser holt neu. */
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.resolve(p));
});

app.post("/api/admin/backup", (req, res) => {
  if (!requireOwner(req, res)) return;
  const files = {};   // Textdateien, wie bisher
  const binaer = {};  // Bilder, base64 — seit es hochgeladene Wappen gibt
  try {
    for (const name of fs.readdirSync(DATA_DIR)) {
      const p = path.join(DATA_DIR, name);
      const st = fs.statSync(p);
      if (st.isFile()) {
        files[name] = fs.readFileSync(p, "utf8"); // JSON-Dateien + .secret (Token-Schlüssel)
        continue;
      }
      /* Ein Unterordner. Bis hierher las das Backup nur flache Dateien und
         nur als UTF-8 — hochgeladene Bilder waeren also gar nicht erst
         mitgekommen, und nach dem ersten Wiederherstellen haetten alle
         Clans ihr Wappen verloren. Genau ein Ordner ist vorgesehen, und
         die Dateinamen darin sind vom Server selbst vergeben. */
      if (!st.isDirectory() || name !== "bilder") continue;
      for (const datei of fs.readdirSync(p)) {
        const dp = path.join(p, datei);
        try {
          if (!fs.statSync(dp).isFile()) continue;
          binaer[`bilder/${datei}`] = fs.readFileSync(dp).toString("base64");
        } catch {}
      }
    }
  } catch (e) {
    return res.status(500).json({ error: "Backup fehlgeschlagen: " + e.message });
  }
  res.json({ ok: true, kind: "fakecasino-backup", createdAt: new Date().toISOString(), version: appVersion(), files, binaer });
});

app.post("/api/admin/restore", (req, res) => {
  if (!requireOwner(req, res)) return;
  const files = req.body.files;
  if (!files || typeof files !== "object" || !files["accounts.json"]) {
    return res.status(400).json({ error: "Das ist kein Fake-Casino-Backup (accounts.json fehlt)." });
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let written = 0;
    for (const [name, content] of Object.entries(files)) {
      // Nur flache Dateinamen — keine Pfad-Tricks ins Dateisystem.
      if (!/^[\w.\-]+$/.test(name) || name.includes("..")) continue;
      if (typeof content !== "string") continue;
      fs.writeFileSync(path.join(DATA_DIR, name), content);
      written += 1;
    }
    /* Bilder aus aelteren Backups fehlen einfach — dann bleibt der Ordner
       leer und die Clans stehen ohne Wappen da, statt dass das Einspielen
       scheitert. */
    const binaer = req.body.binaer;
    if (binaer && typeof binaer === "object") {
      const bilderDir = path.join(DATA_DIR, "bilder");
      fs.mkdirSync(bilderDir, { recursive: true });
      for (const [pfad, b64] of Object.entries(binaer)) {
        // Genau ein Ordner, ein flacher Dateiname darin, nichts sonst.
        const m = /^bilder\/([\w.\-]+)$/.exec(String(pfad));
        if (!m || m[1].includes("..") || typeof b64 !== "string") continue;
        try {
          fs.writeFileSync(path.join(bilderDir, m[1]), Buffer.from(b64, "base64"));
          written += 1;
        } catch {}
      }
    }
    res.json({ ok: true, written, restarting: true });
  } catch (e) {
    return res.status(500).json({ error: "Wiederherstellen fehlgeschlagen: " + e.message });
  }
  // Alle Module halten ihren Zustand im RAM und würden die frisch geschriebenen
  // Dateien beim nächsten save() wieder überschreiben → sauber neu starten.
  // systemd (und lokal ein Prozess-Manager) startet den Server automatisch neu.
  console.log("💾 Backup eingespielt — Server startet neu, um die Daten zu laden.");
  setTimeout(() => process.exit(0), 800);
});

// ---------------------------------------------------------------------------
// Server + Socket.IO
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server);
io.sockets.setMaxListeners(50); // many game modules each add a connection listener
io.on("connection", (socket) => {
  socket.setMaxListeners(80);
  // IP-Bann-Gate: gesperrte IPs werden sofort getrennt.
  socket.data.ip = ipbans.ipOf(socket);
  if (ipbans.isBanned(socket.data.ip)) {
    socket.emit("ipbanned");
    return socket.disconnect(true);
  }
  socket.emit("app:version", { version: appVersion() });
  socket.on("app:version", (ack) => {
    if (typeof ack === "function") ack({ ok: true, version: appVersion() });
  });
  // Beim Auth die letzte IP am Account merken (damit der Owner per Name IP-bannen kann).
  socket.on("auth", ({ token } = {}) => {
    const key = accounts.verifyToken(token);
    if (key) { const acc = accounts.get(key); if (acc) { acc.lastIp = socket.data.ip; } }
  });
});

setupPoker(io, accounts);
setupSlots(io, accounts);
setupCrash(io, accounts);
setupHorses(io, accounts);
setupMines(io, accounts);
setupTowers(io, accounts);
setupPinco(io, accounts);
setupMemory(io, accounts);
setupSuggestions(io, accounts);
setupSudoku(io, accounts);
setupSolitaire(io, accounts);
setupChess(io, accounts);
setupSocial(io, accounts);
const heist = setupHeist(io, accounts);
require("./game/admin").setHeist(heist);
const adminEvents = {
  rain: require("./game/chipRain").setupChipRain(io, accounts),
  quiz: require("./game/quiz").setupQuiz(io, accounts),
  vault: require("./game/teamVault").setupTeamVault(io, accounts),
};
require("./game/admin").setEvents(adminEvents);
liveops.setEvents(adminEvents); // Events spawnen auch zufällig (maybeAutoSpawn)
setupClans(io, accounts);
setupCosmetics(io, accounts);
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
setupEinladung(io, accounts);
setupKniffel(io, accounts);
setupHilo(io, accounts);
setupWuerfel(io, accounts);
setupLotterie(io, accounts);
setupAnnouncements(io);
setupBericht(io, accounts);
/* Jedes Modul haengt sich mit io.on("connection") ein, und es sind mehr als
   fuenfzig geworden. Node warnt dann vor einem Speicherleck, obwohl hier
   keines ist: die Zuhoerer werden einmal beim Start gesetzt, nicht je Spieler. */
io.setMaxListeners(0);
setupPrefs(io, accounts);
feed.setupFeed(io, accounts);
achievements.setupAchievements(io, accounts);
setupSeason(io, accounts);
setupRecords(io, accounts);
push.setupPush(io, accounts);
asyncDuell.setup(io, accounts);
comeback.setup(io, accounts);
quests.setupQuests(io, accounts);
liveops.setup(io, accounts, heist);

// Level-ups: recordHand flags acc._justLeveled → notify the player's socket.
accounts.onHand((name) => {
  const key = String(name).trim().toLowerCase();
  const acc = accounts.get(key);
  if (!acc || !acc._justLeveled) return;
  const level = acc._justLeveled; delete acc._justLeveled;
  const info = accounts.levelInfo(acc);
  feed.add("level", `${acc.name} erreicht Level ${level} (${info.title}).`, { user: acc.name, level });
  for (const s of io.of("/").sockets.values()) {
    if (s.data && s.data.account === key) { s.emit("level:up", { level, title: info.title, emoji: info.emoji }); break; }
  }
});

// Chip-Transfer zwischen Spielern (socket-auth required)
io.on("connection", (socket) => {
  socket.on("account:transfer", ({ to, amount } = {}, ack) => {
    // Zaehler fuer das Achievement "Spendabel" — hochgezaehlt wird erst, wenn
    // die Ueberweisung unten tatsaechlich geklappt hat.
    if (!ack) return;
    if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
    const res = accounts.transfer(socket.data.account, to, amount);
    if (!res.ok) return ack({ ok: false, error: res.error });
    const abs = accounts.get(socket.data.account);
    if (abs) { abs.transfersSent = (abs.transfersSent || 0) + 1; accounts.save(); }
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

// On a graceful shutdown (e.g. a redeploy), refund open sports bets so
// no stake is lost when the in-memory match state resets.
let shuttingDown = false;
function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    persistSports(); // save open bets/combos so they survive the redeploy
    console.log("[shutdown] sports bets persisted");
  } catch (e) { console.error("[shutdown] persist failed:", e.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
