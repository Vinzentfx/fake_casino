"use strict";

/**
 * Server vom Fake Casino.
 *
 * Liefert das Frontend aus (public/), stellt die Konto-API fürs Spielgeld
 * bereit und betreibt über Socket.IO alles, was live läuft.
 *
 * Nur Spielgeld, zur Speicherung und Sicherheit siehe game/accounts.js.
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
const cosmetics = require("./game/cosmetics");
const { setupCosmetics } = cosmetics;
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
const { setupKisten } = require("./game/kisten");
const { setupRuhm } = require("./game/ruhm");
const { setupKistenDuell } = require("./game/kistenDuell");
const { setupChat } = require("./game/chat");
const { setupLobby } = require("./game/lobby");
const { setupEinladung } = require("./game/einladung");
const { setupKniffel } = require("./game/kniffel");
const { setupHilo } = require("./game/hilo");
const { setupWuerfel } = require("./game/wuerfel");
const { setupLotterie } = require("./game/lotterie");
const { setupBericht } = require("./game/bericht");
const gluecksrad = require("./game/gluecksrad");
const { setupAuktion } = require("./game/auktion");
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
const zugangsschutz = require("./game/zugangsschutz");
const strafen = require("./game/strafen");
const wartung = require("./game/wartung");
const { setupResponsible } = require("./game/responsible");

const PORT = process.env.PORT || 3000;
const build = require("./game/buildinfo");
// Fest fuer alles, was einmal gilt (Socket-Handshake, Backup-Metadaten).
/**
 * Bau-Kennung, die der Client zu sehen bekommt.
 *
 * Es gibt bewusst nur diese eine Quelle. Ein frueherer Versuch hatte den
 * Socket die Kennung vom Serverstart melden lassen und die API die aktuelle.
 * Beim Entwickeln laufen die auseinander, und der Client haelt den Unterschied
 * fuer ein Update: er laedt neu, bekommt wieder beide Werte, laedt wieder neu.
 * Im Betrieb sind beide identisch (der Dienst startet beim Deploy neu), beim
 * Entwickeln liefert current() den frischen Stand.
 */
const appVersion = () => build.current();

// HTTP und Konto-API

const app = express();
app.set("trust proxy", true); // hinter Caddy steht die echte Client-IP in x-forwarded-for
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
    // Ab wann der Soforthilfe-Knopf erscheint. Stand vorher als feste 50 im
    // Client und waere beim Anheben auf 2.000 dort haengengeblieben.
    rescueThreshold: accounts.RESCUE_THRESHOLD,
  });
});

/* Der Spickzettel liegt als Markdown im Repo. Damit ihn auch Spieler lesen
   koennen, liefert der Server ihn hier aus. */
const SPICK_FILE = path.join(__dirname, "CHEATSHEET.md");
let spickText = null;
app.get("/api/spickzettel", (_req, res) => {
  if (build.DEV || spickText === null) {
    try { spickText = fs.readFileSync(SPICK_FILE, "utf8"); } catch { spickText = ""; }
  }
  if (!spickText) return res.status(404).json({ error: "Spickzettel nicht gefunden." });
  res.type("text/plain; charset=utf-8").send(spickText);
});

app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("X-Casino-Restore", "snapshot-v2");
  res.json({ version: build.current() });
});

app.post("/api/login", (req, res) => {
  const name = req.body.name;
  const ip = req.ip || "unknown";
  const deviceId = zugangsschutz.geraet(req, res);
  if (ipbans.isBanned(ip)) return res.status(403).json({ error: "Dieses Netzwerk ist gesperrt." });
  if (zugangsschutz.istGesperrt(deviceId)) return res.status(403).json({ error: "Dieses Gerät ist gesperrt." });
  /* Wartung: das Haus ist zu, der Besitzer kommt rein. 503 und nicht 403,
     damit man auf den Blick in die Netzwerkkonsole nicht "verboten" liest:
     es ist nichts verboten, es ist nur gerade geschlossen. */
  if (!wartung.darfRein(name, OWNER_KEY)) {
    return res.status(503).json({ error: wartung.text() });
  }
  // Würde dieser Login ein neues Konto anlegen, gilt die Grenze pro IP.
  const willCreate = name && !accounts.get(name);
  if (willCreate) {
    const schutz = zugangsschutz.pruefeNeueAnmeldung(ip, deviceId);
    if (!schutz.ok) return res.status(429).json({ error: schutz.error });
  }
  const result = accounts.login(name, req.body.pin);
  if (!result.ok) return res.status(400).json({ error: result.error });
  const intern = accounts.get(name);
  if (intern) {
    intern.lastIp = ip;
    intern.lastDeviceId = deviceId;
    accounts.save();
  }
  if (result.created) zugangsschutz.merkeNeueAnmeldung(ip, deviceId);
  res.json({
    created: result.created,
    account: result.account,
    token: result.token,
    warnFails: result.warnFails || 0,
    config: { bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS },
  });
});

/**
 * Gespeicherte Sitzung fortsetzen. Der Client hält sein Token im localStorage,
 * damit ein iPad, das den Safari-Tab wegwirft, keinen neuen Login erzwingt
 * (und mit der wachsenden Sperre niemand wegen eines Tippfehlers ausgesperrt wird).
 */
app.post("/api/session", (req, res) => {
  const deviceId = zugangsschutz.geraet(req, res);
  if (ipbans.isBanned(req.ip || "unknown")) return res.status(403).json({ error: "Dieses Netzwerk ist gesperrt." });
  if (zugangsschutz.istGesperrt(deviceId)) return res.status(403).json({ error: "Dieses Gerät ist gesperrt." });
  const result = accounts.resumeSession(req.body && req.body.token);
  if (result.ok && !wartung.darfRein(result.account && result.account.name, OWNER_KEY)) {
    return res.status(503).json({ error: wartung.text() });
  }
  if (!result.ok) return res.status(401).json({ error: result.error });
  const intern = accounts.get(result.account && result.account.name);
  if (intern) {
    intern.lastIp = req.ip || "unknown";
    intern.lastDeviceId = deviceId;
    accounts.save();
  }
  res.json({
    account: result.account,
    token: result.token,
    config: { bonusCooldownMs: accounts.DAILY_BONUS_COOLDOWN_MS },
  });
});

/** Bonus und Soforthilfe wirken auf ein Konto, der Aufrufer muss also beweisen, dass es seins ist. */
/* Gibt den Schluessel zurueck, nicht den getippten Namen. Der Vergleich lief
   frueher gegen den Anzeigenamen, und nach einer Umbenennung passte der nicht
   mehr zum Token: Stunden-Bonus und Soforthilfe antworteten mit 403. */
function requireOwnAccount(req, res) {
  const key = accounts.verifyToken(req.body.token);
  if (!key || key !== accounts.kanonisch(req.body.name)) {
    res.status(403).json({ error: "Nicht autorisiert." });
    return null;
  }
  return key;
}

app.post("/api/daily-bonus", (req, res) => {
  const key = requireOwnAccount(req, res);
  if (!key) return;
  const result = accounts.claimDailyBonus(key);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  achievements.check(key); // streak/chips milestones
  quests.track(key, "claim_bonus");
  res.json({
    amount: result.amount, base: result.base, tribute: result.tribute,
    streets: result.streets, golden: result.golden, houses: result.houses,
    housesOwned: result.housesOwned, sets: result.sets, setList: result.setList,
    cashback: result.cashback, streak: result.streak, taper: result.taper,
    account: result.account,
  });
});

app.post("/api/rescue", (req, res) => {
  const key = requireOwnAccount(req, res);
  if (!key) return;
  const result = accounts.rescue(key);
  if (!result.ok) return res.status(429).json({ error: result.error, msLeft: result.msLeft });
  res.json({ amount: result.amount, account: result.account });
});

app.get("/api/account/:name", (req, res) => {
  const acc = accounts.get(req.params.name);
  if (!acc) return res.status(404).json({ error: "Account nicht gefunden." });
  // Komplette öffentliche Statistik: Konto, Stadt-Imperium, Achievements. Kann
  // jeder ansehen, ist ein Spiel unter Freunden und die Bestenliste verlinkt hierher.
  const key = req.params.name.trim().toLowerCase();
  const cityMe = city.publicOverview(key).me;
  const achList = achievements.listFor(key);
  res.json({
    account: accounts.publicAccount(acc),
    clan: (() => { try { return require("./game/clans").tagOf(key); } catch { return null; } })(),
    city: cityMe ? {
      houses: cityMe.houses, value: cityMe.value, streets: cityMe.streets,
      trophies: cityMe.trophies, bossOf: cityMe.bossOf, color: cityMe.color,
      /* Die volle Stadtrechnung: Miete, Verwaltung, Grundsteuer, was bleibt.
         Dieselben Zahlen wie in der Stadt selbst und dieselben, mit denen
         der Stunden-Bonus rechnet — sie kommen aus derselben Funktion,
         damit sie nicht auseinanderlaufen koennen. */
      rechnung: (() => { try { return city.mieteVon(key); } catch { return null; } })(),
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

// Backup für den Besitzer: der komplette data/-Ordner (Accounts, Pferde, Stadt, …) als
// ein JSON-Bundle zum Herunterladen, und als Upload zum Wiederherstellen,
// z.B. beim Umzug auf einen neuen Host, wenn der Datenordner leer startet.

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
  const binaer = {};  // Bilder als base64, seit es hochgeladene Wappen gibt
  try {
    for (const name of fs.readdirSync(DATA_DIR)) {
      const p = path.join(DATA_DIR, name);
      const st = fs.statSync(p);
      if (st.isFile()) {
        files[name] = fs.readFileSync(p, "utf8"); // JSON-Dateien + .secret (Token-Schlüssel)
        continue;
      }
      /* Ein Unterordner. Bis hierher las das Backup nur flache Dateien und
         nur als UTF-8, hochgeladene Bilder waeren also gar nicht erst
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
    // Erst alles pruefen. Sonst koennte eine kaputte JSON-Datei den laufenden
    // Stand schon halb ueberschrieben haben, bevor der Fehler auffaellt.
    for (const [name, content] of Object.entries(files)) {
      if (!/^[\w.\-]+$/.test(name) || name.includes("..") || typeof content !== "string") continue;
      if (name.endsWith(".json")) JSON.parse(content);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let written = 0;
    const wiederhergestellt = new Set();
    for (const [name, content] of Object.entries(files)) {
      // Nur flache Dateinamen, keine Pfad-Tricks ins Dateisystem.
      if (!/^[\w.\-]+$/.test(name) || name.includes("..")) continue;
      if (typeof content !== "string") continue;
      fs.writeFileSync(path.join(DATA_DIR, name), content);
      wiederhergestellt.add(name);
      written += 1;
    }

    // Ein Restore ist ein Schnappschuss, kein Zusammenmischen. Dateien aus
    // spaeteren Tests oder neueren Funktionen duerfen nicht neben dem alten
    // Stand liegen bleiben. Fehlende Dateien legen die Module beim Start mit
    // ihren sicheren Standardwerten neu an.
    for (const name of fs.readdirSync(DATA_DIR)) {
      const p = path.join(DATA_DIR, name);
      if (fs.statSync(p).isFile() && !wiederhergestellt.has(name)) fs.unlinkSync(p);
    }

    /* Bilder aus aelteren Backups fehlen einfach, dann bleibt der Ordner
       leer und die Clans stehen ohne Wappen da, statt dass das Einspielen
       scheitert. */
    const binaer = req.body.binaer;
    const bilderDir = path.join(DATA_DIR, "bilder");
    const wiederhergestellteBilder = new Set();
    if (binaer && typeof binaer === "object") {
      fs.mkdirSync(bilderDir, { recursive: true });
      for (const [pfad, b64] of Object.entries(binaer)) {
        // Genau ein Ordner, ein flacher Dateiname darin, nichts sonst.
        const m = /^bilder\/([\w.\-]+)$/.exec(String(pfad));
        if (!m || m[1].includes("..") || typeof b64 !== "string") continue;
        try {
          fs.writeFileSync(path.join(bilderDir, m[1]), Buffer.from(b64, "base64"));
          wiederhergestellteBilder.add(m[1]);
          written += 1;
        } catch {}
      }
    }
    if (fs.existsSync(bilderDir)) {
      for (const name of fs.readdirSync(bilderDir)) {
        const p = path.join(bilderDir, name);
        if (fs.statSync(p).isFile() && !wiederhergestellteBilder.has(name)) fs.unlinkSync(p);
      }
    }
    // Sobald Node die Antwort vollstaendig an den Socket uebergeben hat,
    // sofort raus. Schon ein kurzes Wartefenster reicht fuer einen Spiel-Timer,
    // der seinen alten RAM-Stand wieder ueber die restaurierten Dateien schreibt.
    res.once("finish", () => {
      console.log("Backup eingespielt, Server startet neu, um die Daten zu laden.");
      process.exit(1);
    });
    res.json({ ok: true, written, restarting: true });
  } catch (e) {
    return res.status(500).json({ error: "Wiederherstellen fehlgeschlagen: " + e.message });
  }
  // Alle Module halten ihren Zustand im RAM und wuerden die frisch geschriebenen
  // Dateien beim naechsten save() wieder ueberschreiben. Der finish-Handler oben
  // beendet deshalb sofort mit Fehlercode; Railway "On Failure" startet neu.
});

// Server und Socket.IO

const server = http.createServer(app);
const io = new Server(server);
io.sockets.setMaxListeners(50); // viele Spielmodule hängen je einen connection-Listener an
io.on("connection", (socket) => {
  socket.setMaxListeners(80);
  // IP-Bann-Gate: gesperrte IPs werden sofort getrennt.
  socket.data.ip = ipbans.ipOf(socket);
  socket.data.deviceId = zugangsschutz.idAusRequest(socket.handshake);
  if (ipbans.isBanned(socket.data.ip)) {
    socket.emit("ipbanned");
    return socket.disconnect(true);
  }
  if (zugangsschutz.istGesperrt(socket.data.deviceId)) {
    socket.emit("ipbanned", { device: true });
    return socket.disconnect(true);
  }
  socket.emit("app:version", { version: appVersion() });
  socket.on("app:version", (ack) => {
    if (typeof ack === "function") ack({ ok: true, version: appVersion() });
  });
  // Beim Auth die letzte IP am Account merken (damit der Owner per Name IP-bannen kann).
  socket.on("auth", ({ token } = {}) => {
    const key = accounts.verifyToken(token);
    if (key) {
      const acc = accounts.get(key);
      if (acc) {
        acc.lastIp = socket.data.ip;
        if (!socket.data.deviceId && acc.lastDeviceId) socket.data.deviceId = acc.lastDeviceId;
        if (zugangsschutz.istGesperrt(socket.data.deviceId)) {
          socket.emit("ipbanned", { device: true });
          return socket.disconnect(true);
        }
      }
    }
    /* Beim Verbinden steht noch kein Konto am Socket, deshalb kann das
       Wartungs-Tor erst hier zuschlagen. Wer ein gueltiges Token hat und
       nicht der Besitzer ist, geht mit derselben Meldung raus, die auch im
       Login steht. */
    if (key && !wartung.darfRein(key, OWNER_KEY)) {
      socket.emit("admin:kicked", { reason: wartung.text() });
      socket.disconnect(true);
    }
  });
});

/* Spielverbot und Einsatzdeckel greifen an einer Stelle fuer alle Spiele
   (game/strafen.js). Muss vor den Spielmodulen stehen, damit die Zwischen-
   schicht am Socket haengt, bevor irgendein Handler antwortet. */
strafen.bremse(io, accounts);

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
require("./game/admin").setUmbenennen(verteileUmbenennung);
liveops.setEvents(adminEvents); // Events spawnen auch zufällig (maybeAutoSpawn)
setupClans(io, accounts);
setupCosmetics(io, accounts);
/* Einmalig: was vor der Praegung schon jemandem gehoerte, bekommt seine
   Nummer. Muss NACH dem Laden der Konten laufen und laeuft nur beim ersten
   Mal (die Datei merkt sich, dass sie fertig ist). */
cosmetics.praegungNachtragen(accounts);
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
setupRuhm(io, accounts);
setupKisten(io, accounts);
setupKistenDuell(io, accounts);
setupChat(io, accounts);
setupLobby(io);
setupEinladung(io, accounts);
setupKniffel(io, accounts);
setupHilo(io, accounts);
setupWuerfel(io, accounts);
setupLotterie(io, accounts);
setupAnnouncements(io, accounts);
setupBericht(io, accounts);
gluecksrad.setup(io, accounts);
setupAuktion(io, accounts);
/* Jedes Modul haengt sich mit io.on("connection") ein, und es sind mehr als
   fuenfzig geworden. Node warnt dann vor einem Speicherleck, obwohl hier
   keines ist: die Zuhoerer werden einmal beim Start gesetzt, nicht je Spieler. */
io.setMaxListeners(0);
setupPrefs(io, accounts);
feed.setupFeed(io, accounts);
achievements.setupAchievements(io, accounts);
setupSeason(io, accounts);
setupRecords(io, accounts);
setupResponsible(io, accounts);
push.setupPush(io, accounts);
asyncDuell.setup(io, accounts);
comeback.setup(io, accounts);
quests.setupQuests(io, accounts);
liveops.setup(io, accounts, heist);

// Aufstieg: recordHand setzt acc._justLeveled, dann bekommt der Spieler Bescheid.
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

/**
 * Nach einer Umbenennung alle Bildschirme nachziehen.
 *
 * Den Anzeigenamen haelt jeder Socket als Kopie (`displayName`, gesetzt beim
 * Anmelden); daran haengt die Anwesenheitsliste. Ohne diesen Durchlauf hiesse
 * jemand ueberall neu und in der Liste rechts weiter alt, bis er die Seite
 * neu laedt.
 */
function verteileUmbenennung(key, alt, neu, account) {
  for (const s of io.of("/").sockets.values()) {
    if (!s.data || s.data.account !== key) continue;
    s.data.displayName = neu;
    s.emit("konto:umbenannt", { alt, neu, account });
    s.emit("account:update", { account });
  }
  // Die Anwesenheitsliste bauen alle neu, sobald der Umbenannte sich meldet.
  io.emit("presence:auffrischen");
}

// Chip-Transfer zwischen Spielern (nur mit Anmeldung am Socket)
io.on("connection", (socket) => {
  /* Namenswechsel durch den Spieler selbst. Einmal im Monat, durch den
     Wortfilter, und der alte Name fuehrt weiter zum Konto: niemand soll sich
     aus seinem eigenen Account aussperren, weil er den neuen vergisst. */
  socket.on("account:rename", ({ neu } = {}, ack) => {
    if (typeof ack !== "function") return;
    if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
    const res = accounts.rename(socket.data.account, neu);
    if (!res.ok) return ack(res);
    verteileUmbenennung(res.key, res.alt, res.neu, res.account);
    try { require("./game/chat").announce(io, `${res.alt} heißt jetzt ${res.neu}.`); } catch {}
    ack(res);
  });


  socket.on("account:transfer", ({ to, amount } = {}, ack) => {
    // Zaehler fuer das Achievement "Spendabel", hochgezaehlt wird erst, wenn
    // die Ueberweisung unten tatsaechlich geklappt hat.
    if (!ack) return;
    if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
    const res = accounts.transfer(socket.data.account, to, amount);
    if (!res.ok) return ack({ ok: false, error: res.error });
    const abs = accounts.get(socket.data.account);
    if (abs) { abs.transfersSent = (abs.transfersSent || 0) + 1; accounts.save(); }
    // Update sender
    socket.emit("account:update", { account: res.fromAccount });
    // Empfänger benachrichtigen, falls online
    // Ueber den echten Schluessel, nicht ueber das Getippte: wer jemanden
    // unter dessen altem Namen anschreibt, soll trotzdem benachrichtigt werden.
    const zielKey = accounts.kanonisch(to);
    io.of("/").sockets.forEach((s) => {
      if (zielKey && s.data.account === zielKey) {
        s.emit("account:update", { account: res.toAccount });
        s.emit("account:received", { from: socket.data.account, amount: Math.floor(Number(amount)) });
      }
    });
    ack({ ok: true, account: res.fromAccount });
  });
});

server.listen(PORT, () => {
  console.log(`Fake Casino läuft auf http://localhost:${PORT}`);
});

// Beim geordneten Herunterfahren (z. B. Deploy) offene Sportwetten sichern,
// damit kein Einsatz verloren geht, wenn der Spielstand im Speicher weg ist.
let shuttingDown = false;
function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    persistSports(); // offene Wetten und Kombis sichern, damit sie den Deploy überleben
    console.log("[shutdown] Sportwetten gesichert");
  } catch (e) { console.error("[shutdown] Sichern fehlgeschlagen:", e.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
