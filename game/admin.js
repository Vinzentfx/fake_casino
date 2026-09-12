"use strict";

const OWNER = "vincent";
const city = require("./city");
const slots = require("./slots");
const liveops = require("./liveops");
const ipbans = require("./ipbans");
const chat = require("./chat");
const wortfilter = require("./wortfilter");
const bilder = require("./bilder");
const strafen = require("./strafen");
const regie = require("./regie");
const wartung = require("./wartung");
const cosmetics = require("./cosmetics");
let _heist = null;
function setHeist(h) { _heist = h; }
let _events = {}; // { rain, quiz, vault }, die Admin-Events aus server.js
function setEvents(e) { _events = e || {}; }

/* ---------------------------------------------------------------------------
   ANGEKUENDIGTE EVENTS

   Heist, Chip-Regen, Tresorkampf und Quiz dauern unter zwei Minuten. Genau
   deshalb loesen sie bewusst keine Benachrichtigung aus: die Nachricht kaeme
   spaeter als das Ende. Umgekehrt heisst das aber, dass sie nur die
   erreichen, die zufaellig gerade offen haben: bei einem Haus, in dem sich
   ein paar Freunde abends verabreden, sind das meistens null.

   Ein Vorlauf loest beides: das Event wird angekuendigt, die Benachrichtigung
   geht sofort raus ("in fuenf Minuten"), und gestartet wird erst, wenn die
   Zeit um ist. Dann ist die Nachricht alt genug, dass jemand sie gelesen und
   die Seite geoeffnet haben kann, und kurz genug, dass niemand vergisst,
   worauf er wartet.

   Gespeichert wird nichts: ein Serverneustart im Vorlauf laesst die
   Ankuendigung fallen, und das ist richtig so: niemand soll nach einem
   Neustart von einem Event ueberrascht werden, das jemand vor Stunden
   angesetzt hat.
--------------------------------------------------------------------------- */
const geplant = new Map();   // id -> { startetUm, timer, name, starte, beschreibung }

function planPublic() {
  const out = {};
  for (const [id, g] of geplant) out[id] = { geplant: true, startetUm: g.startetUm };
  return out;
}

function planAbbrechen(id) {
  const g = geplant.get(id);
  if (!g) return false;
  clearTimeout(g.timer);
  geplant.delete(id);
  return true;
}

/**
 * Ein Event ankuendigen und nach `minuten` starten.
 *
 * @param {object} o
 * @param {string} o.id         "heist", "rain", …
 * @param {string} o.name       Wie es im Chat heisst.
 * @param {number} o.minuten    Vorlauf, 1 bis 60.
 * @param {string} o.text       Was in Chat und Benachrichtigung steht.
 * @param {function} o.starte   Wird nach dem Vorlauf gerufen.
 */
function planeEvent(io, { id, name, minuten, text, starte }) {
  if (geplant.has(id)) return { ok: false, error: `${name} ist schon angekündigt.` };
  const min = Math.max(1, Math.min(60, Math.floor(Number(minuten) || 5)));
  const startetUm = Date.now() + min * 60 * 1000;

  try {
    chat.announce(io, `${text}, es geht in ${min} ${min === 1 ? "Minute" : "Minuten"} los!`);
  } catch {}

  /* Die Benachrichtigung geht ueber "live": es ist ein Live-Event, nur eben
     eins mit Vorlauf. Wer Live-Events abgeschaltet hat, will auch hierueber
     nicht geweckt werden. */
  (async () => {
    try {
      const push = require("./push");
      await push.anAlle("live", {
        title: "Gleich geht's los",
        body: `${text}, in ${min} ${min === 1 ? "Minute" : "Minuten"}.`,
        url: "/",
      });
    } catch {}
  })();

  const timer = setTimeout(() => {
    geplant.delete(id);
    try { starte(); } catch {}
    try { io.emit("admin:planUpdate", planPublic()); } catch {}
  }, min * 60 * 1000);
  // Der Vorlauf darf den Server nicht am Beenden hindern.
  if (typeof timer.unref === "function") timer.unref();

  geplant.set(id, { startetUm, timer, name });
  io.emit("admin:planUpdate", planPublic());
  return { ok: true, startetUm };
}

/** Wer hat offene Strafen? Kurzform fuer Uebersicht und Strafen-Reiter. */
function strafenUebersicht(accounts) {
  const out = [];
  for (const a of accounts.rawAll()) {
    const m = strafen.marken(a);
    if (m.length) out.push({ name: a.name, strafen: m });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/** Alle Sockets eines Kontos. */
function socketsVon(io, key) {
  const k = String(key || "").toLowerCase();
  return Array.from(io.of("/").sockets.values()).filter((s) => s.data && s.data.account === k);
}

/** Zustand eines Event-Moduls, oder { active: false }, wenn es ihn nicht gibt. */
function eventZustand(mod) {
  if (!mod) return { active: false };
  try {
    if (typeof mod.zustand === "function") return mod.zustand();
    if (typeof mod.active === "function") return { active: !!mod.active() };
  } catch {}
  return { active: false };
}

function setupAdmin(io, accounts) {
  io.on("connection", (socket) => {
    function isOwner() {
      return socket.data.account === OWNER;
    }

    socket.on("admin:dashboard", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const all = accounts.listAll();
      const onlineMap = new Map();
      for (const s of io.of("/").sockets.values()) {
        if (!s.data || !s.data.account) continue;
        const key = String(s.data.account).toLowerCase();
        const cur = onlineMap.get(key) || { name: key, sockets: 0 };
        cur.sockets += 1;
        onlineMap.set(key, cur);
      }
      const onlineAccounts = Array.from(onlineMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      const topWinners = all
        .filter((a) => (a.weeklyNet || 0) > 0)
        .sort((a, b) => (b.weeklyNet || 0) - (a.weeklyNet || 0))
        .slice(0, 5);
      const topLosers = all
        .filter((a) => (a.weeklyNet || 0) < 0)
        .sort((a, b) => (a.weeklyNet || 0) - (b.weeklyNet || 0))
        .slice(0, 5);
      const alerts = all
        .filter((a) => (a.biggestWin || 0) >= 1_000_000 || (a.biggestLoss || 0) >= 1_000_000)
        .sort((a, b) => Math.max(b.biggestWin || 0, b.biggestLoss || 0) - Math.max(a.biggestWin || 0, a.biggestLoss || 0))
        .slice(0, 6);
      ack({
        ok: true,
        dashboard: {
          generatedAt: Date.now(),
          online: {
            sockets: Array.from(io.of("/").sockets.values()).filter((s) => s.data && s.data.account).length,
            accounts: onlineAccounts.length,
            players: onlineAccounts,
          },
          totals: {
            accounts: all.length,
            chips: all.reduce((sum, a) => sum + (a.chips || 0), 0),
            bank: all.reduce((sum, a) => sum + (a.savings || 0), 0),
          },
          /* Der Zustand jedes Events, nicht nur ein Ja/Nein. Vorher stand
             im Bildschirm "Heist: aktiv", ohne zu sagen, wie lange noch
             und um wie viel. Wer nachsehen wollte, musste selbst mitspielen.

             `zustand` liefert jedes Modul seit dieser Runde; `active` bleibt
             als Rueckfall, falls ein Modul es einmal nicht kann. */
          events: {
            liveops: typeof liveops.publicState === "function" ? liveops.publicState() : null,
            geplant: planPublic(),
            heist: eventZustand(_heist),
            rain: eventZustand(_events.rain),
            quiz: eventZustand(_events.quiz),
            vault: eventZustand(_events.vault),
            // Die alten Felder bleiben, damit nichts bricht, was sie liest.
            heistActive: !!(_heist && typeof _heist.active === "function" && _heist.active()),
            rainActive: !!(_events.rain && _events.rain.active()),
            quizActive: !!(_events.quiz && _events.quiz.active()),
            vaultActive: !!(_events.vault && _events.vault.active()),
          },
          topWinners,
          topLosers,
          alerts,
          /* Wartung, offene Strafen und liegende Regie-Zettel gehoeren in die
             Uebersicht und nicht nur in ihren Reiter: es sind genau die drei
             Zustaende, die man versehentlich anlaesst. */
          wartung: wartung.state(),
          strafen: strafenUebersicht(accounts),
          regie: regie.liste(),
        },
      });
    });

    /* --- Wortfilter ---
       Was in einer Runde als schlimm gilt, entscheidet die Runde. Die
       Basisliste im Modul deckt das Grobe ab, alles Weitere kommt hier
       dazu, und Ausnahmen fuer Woerter, die zu Unrecht haengenbleiben. */
    socket.on("admin:filterState", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, ...wortfilter.listeState() });
    });

    socket.on("admin:filterAdd", ({ wort, art } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(art === "ausnahme" ? wortfilter.ergaenzeAusnahme(wort) : wortfilter.ergaenze(wort));
    });

    socket.on("admin:filterRemove", ({ wort, art } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(art === "ausnahme" ? wortfilter.entferneAusnahme(wort) : wortfilter.entferne(wort));
    });

    /* --- Bilder ---
       Ein Wortfilter hilft hier nicht: was auf einem Bild zu sehen ist,
       kann nur ein Mensch beurteilen. Der Admin sieht alle hochgeladenen
       Wappen und die Meldungen dazu. */
    socket.on("admin:bilder", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      let meldungen = [];
      try { meldungen = require("./clans").meldungen(); } catch {}
      ack({ ok: true, bilder: bilder.alle(), meldungen });
    });

    socket.on("admin:bildWeg", ({ art, id, meldungErledigen } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const weg = bilder.loesche(String(art || ""), String(id || ""));
      if (meldungErledigen && art === "clan") {
        try { require("./clans").meldungErledigen(String(id), false); } catch {}
      }
      ack({ ok: weg, error: weg ? undefined : "Bild gibt es nicht (mehr)." });
    });

    /* Meldung abhaken, ohne das Bild zu entfernen, wenn sie unbegruendet war. */
    socket.on("admin:meldungOk", ({ clanId } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      try { ack(require("./clans").meldungErledigen(String(clanId || ""), false)); }
      catch { ack({ ok: false, error: "Fehler." }); }
    });

    /* Ausprobieren, ohne dass jemand es sieht. Laeuft bewusst im Server:
       der Filter ist dort, eine zweite Fassung im Browser waere eine zweite
       Wahrheit. Und genau die wuerde man beim Pflegen der Liste nicht
       merken. */
    socket.on("admin:filterProbe", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const roh = String(text || "").slice(0, 200);
      const t = wortfilter.treffer(roh);
      ack({
        ok: true,
        entschaerft: wortfilter.entschaerfe(roh).text,
        treffer: [...new Set(t.map((x) => x.wort))],
      });
    });

    /* Bestandsnamen. Der Filter greift nur bei neuen Konten, sonst sperrt
       eine spaeter ergaenzte Wortliste jemanden aus seinem eigenen Account
       aus. Was schon da ist, listen wir hier auf; umbenennen oder stehen
       lassen entscheidet der Besitzer je Fall. */
    socket.on("admin:filterPruefeBestand", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const treffer = [];
      for (const a of accounts.listAll()) {
        const t = wortfilter.treffer(a.name);
        if (t.length) treffer.push({ name: a.name, woerter: [...new Set(t.map((x) => x.wort))] });
      }
      // Clans und Pferde stehen genauso oeffentlich in Listen.
      let clanTreffer = [];
      try {
        const clans = require("./clans");
        if (typeof clans.alleNamen === "function") {
          clanTreffer = clans.alleNamen()
            .map((c) => ({ ...c, woerter: [...new Set(wortfilter.treffer(c.name + " " + (c.motto || "")).map((x) => x.wort))] }))
            .filter((c) => c.woerter.length);
        }
      } catch {}
      ack({ ok: true, accounts: treffer, clans: clanTreffer, geprueft: accounts.listAll().length });
    });

    socket.on("admin:listAccounts", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, accounts: accounts.listAll() });
    });

    socket.on("admin:setChips", ({ target, amount } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(target);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      amount = Math.floor(Number(amount));
      if (!Number.isFinite(amount) || amount < 0) return ack({ ok: false, error: "Ungültiger Betrag." });
      const delta = amount - acc.chips;
      const res = accounts.adjustChips(String(target).toLowerCase(), delta);
      if (!res.ok) return ack({ ok: false, error: res.error });
      // Das Ziel benachrichtigen, falls online
      io.of("/").sockets.forEach((s) => {
        if (s.data.account === String(target).toLowerCase()) {
          s.emit("account:update", { account: res.account });
        }
      });
      ack({ ok: true, account: res.account });
    });

    socket.on("admin:ban", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const res = accounts.ban(String(target).toLowerCase());
      if (res.ok) {
        io.of("/").sockets.forEach((s) => {
          if (s.data.account === String(target).toLowerCase()) {
            s.emit("admin:kicked", { reason: "Dein Account wurde gesperrt." });
            s.disconnect(true);
          }
        });
      }
      ack(res);
    });

    socket.on("admin:unban", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(accounts.unban(String(target).toLowerCase()));
    });

    // IP-Bann: sperrt die IP eines Spielers (per Name → letzte bekannte IP)
    // oder eine direkt angegebene IP; trennt alle Sockets dieser IP sofort.
    socket.on("admin:ipban", ({ target, ip } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      let addr = ip ? ipbans.normIp(ip) : "";
      if (!addr && target) {
        const acc = accounts.get(String(target).toLowerCase());
        addr = acc && acc.lastIp ? ipbans.normIp(acc.lastIp) : "";
        if (!addr) return ack({ ok: false, error: "Keine IP für diesen Spieler bekannt (muss erst online gewesen sein)." });
      }
      if (!addr) return ack({ ok: false, error: "Spielername oder IP angeben." });
      ipbans.ban(addr);
      let kicked = 0;
      io.of("/").sockets.forEach((s) => {
        if (s.data && ipbans.normIp(s.data.ip) === addr) {
          s.emit("ipbanned");
          s.disconnect(true);
          kicked++;
        }
      });
      ack({ ok: true, ip: addr, kicked });
    });

    socket.on("admin:ipunban", ({ ip } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const ok = ipbans.unban(String(ip || ""));
      ack({ ok, ip: ipbans.normIp(ip) });
    });

    socket.on("admin:ipbanList", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const all = accounts.rawAll();
      const bans = ipbans.list().map((ip) => ({
        ip,
        accounts: all.filter((a) => a.lastIp && ipbans.normIp(a.lastIp) === ipbans.normIp(ip)).map((a) => a.name),
      }));
      ack({ ok: true, bans });
    });

    /* Pechvogel als Ja/Nein. Der Bildschirm setzt ihn seit dem Strafen-Umbau
       über admin:strafeSetzen (mit Stärke und Ablaufzeit); dieses Ereignis
       bleibt, weil ein alter, offener Tab es noch schicken kann, und landet
       über setShadowban in derselben Strafe. */
    socket.on("admin:shadowban", ({ target, on } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack(accounts.setShadowban(String(target).toLowerCase(), !!on, { grund: "ohne Angabe" }));
    });

    socket.on("admin:deleteAccount", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target).toLowerCase();
      // Rauswerfen, falls online
      io.of("/").sockets.forEach((s) => {
        if (s.data.account === key) {
          s.emit("admin:kicked", { reason: "Dein Account wurde gelöscht." });
          s.disconnect(true);
        }
      });
      ack(accounts.deleteAccount(key));
    });

    socket.on("admin:clearBank", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target || "").toLowerCase();
      const acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const cleared = Math.floor((acc.savings && acc.savings.amount) || 0);
      acc.savings = { amount: 0, since: Date.now() };
      accounts.save();
      ack({ ok: true, cleared });
    });

    // Einen Spieler aus einer Bestenliste nehmen, indem der Wert dahinter auf null geht.
    socket.on("admin:resetStat", ({ target, stat } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target).toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      acc.stats = acc.stats || { gamesPlayed: 0, handsWon: 0, biggestWin: 0, biggestLoss: 0 };
      if (stat === "bigwin") acc.stats.biggestWin = 0;
      else if (stat === "bigloss") acc.stats.biggestLoss = 0;
      else if (stat === "games") { acc.stats.gamesPlayed = 0; acc.stats.handsWon = 0; acc.stats.perGame = {}; }
      else return ack({ ok: false, error: "Unbekannte Kategorie." });
      accounts.save();
      ack({ ok: true });
    });

    // Alle vergebenen Grundstücke auflisten (für "Gebäude freigeben" im Admin).
    socket.on("admin:cityLots", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, lots: city.ownedLots() });
    });

    // Einem Besitzer ein Gebäude wegnehmen (zurück an niemanden). Allen Bescheid geben,
    // damit offene Stadt-Screens neu laden.
    socket.on("admin:clearLot", ({ plotId } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const res = city.adminClearLot(plotId);
      if (res.ok) io.emit("city:update");
      ack(res);
    });

    // Die ganze Stadt auf Anfang zurücksetzen (nach einer Preis-Umstellung).
    socket.on("admin:resetCity", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      city.resetCity();
      io.emit("city:update");
      ack({ ok: true });
    });

    // --- Test-Werkzeuge (nur Besitzer) ---

    // Einmaligen MAXIMALGEWINN für den nächsten Slot-Dreh des Besitzers scharf stellen (zum Vorführen).
    socket.on("admin:slotsForceWin", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      slots.armForceWin(socket.data.account);
      ack({ ok: true });
    });

    /*
     * Wiedereroeffnung. Loest das Willkommens-Paket fuer alle aus und startet
     * die Gala. Bewusst von Hand: ein Fest, das von selbst losgeht, waehrend
     * niemand hinschaut, ist kein Fest.
     */
    socket.on("admin:comeback", ({ on, minutes, pot } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const cb = require("./comeback");
      if (on) return ack(cb.starte({ galaMinuten: minutes, topf: pot }));
      ack(cb.stoppeGala());
    });

    // --- Live-Ops (nur Besitzer) ---
    socket.on("admin:happyHour", ({ on, minutes } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (on) liveops.startHappy(minutes || 60); else liveops.stopHappy();
      ack({ ok: true });
    });

    socket.on("admin:tourney", ({ on, minutes, prize } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (on) { const r = liveops.startTourney(minutes || 10, prize || 100000); return ack(r); }
      liveops.stopTourney();
      ack({ ok: true });
    });

    socket.on("admin:heist", ({ on, loot, seconds, vorlauf } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (!_heist) return ack({ ok: false, error: "Heist nicht bereit." });
      if (on) {
        if (vorlauf > 0) {
          return ack(planeEvent(io, {
            id: "heist", name: "Casino-Heist", minuten: vorlauf,
            text: `Gleich wird der Tresor geknackt, ${Number(loot || 500000).toLocaleString("de-DE")} Chips Beute`,
            starte: () => _heist.start(loot || 500000, seconds || 60),
          }));
        }
        return ack(_heist.start(loot || 500000, seconds || 60));
      }
      if (planAbbrechen("heist")) { io.emit("admin:planUpdate", planPublic()); return ack({ ok: true, abgesagt: true }); }
      _heist.stop();
      ack({ ok: true });
    });

    socket.on("admin:rain", ({ on, pot, seconds, vorlauf } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (!_events.rain) return ack({ ok: false, error: "Chip-Regen nicht bereit." });
      if (on) {
        if (vorlauf > 0) {
          return ack(planeEvent(io, {
            id: "rain", name: "Chip-Regen", minuten: vorlauf,
            text: `Gleich regnet es Chips, ${Number(pot || 250000).toLocaleString("de-DE")} im Topf`,
            starte: () => _events.rain.start(pot || 250000, seconds || 30),
          }));
        }
        return ack(_events.rain.start(pot || 250000, seconds || 30));
      }
      if (planAbbrechen("rain")) { io.emit("admin:planUpdate", planPublic()); return ack({ ok: true, abgesagt: true }); }
      _events.rain.stop();
      ack({ ok: true });
    });

    socket.on("admin:quiz", ({ on, rounds, prize, vorlauf } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (!_events.quiz) return ack({ ok: false, error: "Quiz nicht bereit." });
      if (on) {
        if (vorlauf > 0) {
          return ack(planeEvent(io, {
            id: "quiz", name: "Blitz-Quiz", minuten: vorlauf,
            text: `Gleich läuft ein Blitz-Quiz, ${Number(prize || 20000).toLocaleString("de-DE")} Chips je Frage`,
            starte: () => _events.quiz.start(rounds || 5, prize || 20000),
          }));
        }
        return ack(_events.quiz.start(rounds || 5, prize || 20000));
      }
      if (planAbbrechen("quiz")) { io.emit("admin:planUpdate", planPublic()); return ack({ ok: true, abgesagt: true }); }
      _events.quiz.stop();
      ack({ ok: true });
    });

    socket.on("admin:teamvault", ({ on, pot, seconds, vorlauf } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      if (!_events.vault) return ack({ ok: false, error: "Tresorkampf nicht bereit." });
      if (on) {
        if (vorlauf > 0) {
          return ack(planeEvent(io, {
            id: "vault", name: "Tresorkampf", minuten: vorlauf,
            text: `Gleich wird um den Tresor gekämpft, ${Number(pot || 500000).toLocaleString("de-DE")} im Topf`,
            starte: () => _events.vault.start(pot || 500000, seconds || 90),
          }));
        }
        return ack(_events.vault.start(pot || 500000, seconds || 90));
      }
      if (planAbbrechen("vault")) { io.emit("admin:planUpdate", planPublic()); return ack({ ok: true, abgesagt: true }); }
      _events.vault.stop();
      ack({ ok: true });
    });

    // Jetzt eine Stadtnachricht auslösen (zufälliger Ortsteil, wenn keiner angegeben ist).
    socket.on("admin:cityEvent", ({ districtId } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const event = city.fireEvent(districtId || null);
      if (!event) return ack({ ok: false, error: "Kein Event möglich (Karte leer)." });
      io.emit("city:update");
      io.emit("city:news", event);
      ack({ ok: true, event });
    });

    // Reset a player's daily-bonus & rescue cooldowns (faucet testing).
    socket.on("admin:resetBonus", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      /* Auch Rad und Kalender: die drei stehen im Menue nebeneinander, und
         "Bonus wieder frei" hat vorher nur einen davon freigegeben. Wer die
         Geschenk-Kette testen wollte, kam bis zum Rad und blieb dort stehen. */
      acc.lastBonusAt = 0;
      acc.lastRescueAt = 0;
      acc.lastWheelAt = 0;
      if (acc.calendar) acc.calendar.lastDay = -999;
      accounts.save();
      ack({ ok: true });
    });

    // Force the weekly rollover NOW (Spieler der Woche + neue Goldene Straße).
    socket.on("admin:newWeek", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      require("./weekly").forceRollover(io, accounts);
      ack({ ok: true });
    });

    /* =====================================================================
       STRAFEN

       Vorher war die einzige Antwort auf alles "Konto gesperrt". Jetzt gibt es
       sieben Stufen mit Ablaufzeit und Grund (game/strafen.js). Der Grund ist
       nicht Deko: er steht in der Meldung, die der Bestrafte liest.
       ===================================================================== */
    socket.on("admin:strafen", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({
        ok: true,
        arten: strafen.ARTEN,
        spiele: Object.fromEntries(Object.entries(strafen.SPIELE).map(([id, s]) => [id, s.name])),
        offen: strafenUebersicht(accounts),
      });
    });

    socket.on("admin:strafeSetzen", ({ target, art, minuten, wert, spiele, grund } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target || "").toLowerCase();
      const acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      if (key === OWNER) return ack({ ok: false, error: "Dich selbst bestrafen geht nicht." });

      const res = strafen.setze(acc, art, { minuten, wert, spiele, grund });
      if (!res.ok) return ack(res);

      /* Eine Zeitsperre wirkt erst, wenn sie auch die offene Sitzung trifft.
         Ohne das spielt der Gesperrte weiter, bis er von selbst neu laedt. */
      let getrennt = 0;
      if (art === "sperre") {
        for (const s of socketsVon(io, key)) {
          s.emit("admin:kicked", { reason: `Gesperrt (${strafen.restText(res.strafe)})${res.strafe.grund ? `: ${res.strafe.grund}` : "."}` });
          s.disconnect(true);
          getrennt++;
        }
      } else {
        // Die anderen Strafen merkt man erst beim naechsten Versuch. Ein Hinweis
        // sagt sofort, was gilt, und beantwortet das "warum geht das nicht".
        for (const s of socketsVon(io, key)) {
          s.emit("admin:nachricht", { titel: "Vom Casino", text: strafen.satz(art, res.strafe) });
        }
      }
      ack({ ok: true, strafe: res.strafe, getrennt, offen: strafen.marken(acc) });
    });

    socket.on("admin:strafeAufheben", ({ target, art } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const res = art === "*" ? strafen.alleAufheben(acc) : strafen.hebeAuf(acc, art);
      if (res.ok) {
        for (const s of socketsVon(io, acc.name)) {
          s.emit("admin:nachricht", { titel: "Vom Casino", text: art === "*" ? "Alle Strafen sind aufgehoben." : `Aufgehoben: ${(strafen.ARTEN[art] || {}).name || art}.` });
        }
      }
      ack({ ...res, offen: strafen.marken(acc) });
    });

    /* =====================================================================
       REGIE: das naechste Ergebnis von Hand setzen (game/regie.js)
       ===================================================================== */
    socket.on("admin:regie", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      let felder = [];
      try {
        felder = require("./gluecksrad").FELDER.map((f, i) => ({ i, label: f.label, art: f.art }));
      } catch {}
      ack({ ok: true, ziele: regie.ZIELE, liegt: regie.liste(), radFelder: felder });
    });

    socket.on("admin:regieSetzen", ({ target, ziel, wert } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const z = regie.ZIELE[ziel];
      if (!z) return ack({ ok: false, error: "Unbekanntes Ziel." });
      let key = regie.GLOBAL;
      if (!z.global) {
        key = String(target || "").toLowerCase();
        if (!accounts.get(key)) return ack({ ok: false, error: "Account nicht gefunden." });
      }
      ack(regie.setze(key, ziel, wert));
    });

    socket.on("admin:regieLoeschen", ({ target, ziel } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const weg = regie.loesche(target || regie.GLOBAL, ziel);
      ack({ ok: weg, error: weg ? undefined : "Da lag nichts." });
    });

    /* =====================================================================
       WARTUNG: das Haus zumachen, ohne den Server zu beenden
       ===================================================================== */
    socket.on("admin:wartung", ({ on, text } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const res = wartung.setze(!!on, text);
      let getrennt = 0;
      if (on) {
        // Zumachen heisst zumachen: wer drin ist, geht raus, sonst spielt eine
        // halbe Runde weiter, waehrend man an den Zahlen schraubt.
        for (const s of io.of("/").sockets.values()) {
          if (!s.data || !s.data.account || s.data.account === OWNER) continue;
          s.emit("admin:kicked", { reason: wartung.text() });
          s.disconnect(true);
          getrennt++;
        }
      } else {
        try { chat.announce(io, "Das Casino ist wieder offen."); } catch {}
      }
      io.emit("wartung:state", wartung.state());
      ack({ ok: true, ...res, getrennt });
    });

    /* =====================================================================
       WERKZEUGE: rauswerfen, anschreiben, Kosmetik geben, Chat leeren
       ===================================================================== */

    // Trennen ohne Sperre. Fuer den Fall, dass jemand in einer kaputten Runde
    // haengt oder eine Ansage verpasst hat: er kann sofort wieder rein.
    socket.on("admin:kick", ({ target, grund } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target || "").toLowerCase();
      if (!accounts.get(key)) return ack({ ok: false, error: "Account nicht gefunden." });
      const text = String(grund || "").slice(0, 140) || "Du wurdest vom Casino getrennt. Du kannst sofort wieder rein.";
      let getrennt = 0;
      for (const s of socketsVon(io, key)) { s.emit("admin:kicked", { reason: text }); s.disconnect(true); getrennt++; }
      ack({ ok: true, getrennt });
    });

    /* Eine Nachricht an genau einen Spieler. Es gab nur die Ansage an alle,
       und die benutzt niemand fuer "du hast deinen Einsatz doppelt gebucht,
       ich habe es geradegezogen". Wer offline ist, bekommt sie als
       Benachrichtigung, sonst waere sie weg. */
    socket.on("admin:nachricht", ({ target, text, auchPush } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const key = String(target || "").toLowerCase();
      const acc = accounts.get(key);
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const t = String(text || "").trim().slice(0, 400);
      if (!t) return ack({ ok: false, error: "Kein Text." });
      const sockets = socketsVon(io, key);
      for (const s of sockets) s.emit("admin:nachricht", { titel: "Nachricht vom Casino", text: t });
      if (auchPush && !sockets.length) {
        (async () => {
          try { await require("./push").an(key, "live", { title: "Nachricht vom Casino", body: t, url: "/" }); } catch {}
        })();
      }
      ack({ ok: true, gesehen: sockets.length });
    });

    /* Kosmetik von Hand geben oder wegnehmen. Gebraucht wird beides: als
       Ausgleich, wenn etwas schiefging, als Preis fuer etwas, das ausserhalb
       des Casinos passiert ist, und zum Zuruecknehmen, wenn ein Stueck durch
       einen Fehler bei jemandem landete. */
    socket.on("admin:kosmetikKatalog", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({ ok: true, katalog: cosmetics.adminKatalog() });
    });

    socket.on("admin:kosmetik", ({ target, art, id, weg } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      const res = weg ? cosmetics.adminNimm(acc, art, id) : cosmetics.adminGib(acc, art, id);
      if (res.ok) {
        accounts.save();
        for (const s of socketsVon(io, acc.name)) {
          s.emit("account:update", { account: accounts.publicAccount(acc) });
          if (!weg) s.emit("admin:nachricht", { titel: "Geschenk vom Casino", text: `Du hast ${res.label} bekommen. Anlegen kannst du es im Aussehen.` });
        }
      }
      ack(res);
    });

    // Den allgemeinen Chat leeren. Bei einem Streit oder einem Bild, das
    // niemand mehr lesen soll, ist Nachricht-fuer-Nachricht keine Option:
    // der Verlauf liegt nur im Speicher und ist nach einem Neustart ohnehin weg.
    socket.on("admin:chatLeeren", (ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      chat.clearRoom("global");
      io.emit("chat:geleert", { room: "global" });
      ack({ ok: true });
    });

    /* =====================================================================
       ZWEI NEUE EVENTS

       Verlosung und Kassensturz sind beide einmalig: sie laufen nicht, sie
       passieren. Deshalb haben sie keinen Zustand und keinen Abbrechen-Knopf.
       ===================================================================== */

    // Sofort-Verlosung unter allen, die gerade online sind. Das kuerzeste
    // Event, das es gibt: ein Knopf, ein Gewinner, eine Zeile im Chat.
    socket.on("admin:verlosung", ({ pot } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const topf = Math.max(1, Math.min(50_000_000, Math.floor(Number(pot) || 100000)));
      const drin = [...new Set(Array.from(io.of("/").sockets.values())
        .map((s) => s.data && s.data.account).filter(Boolean))];
      if (!drin.length) return ack({ ok: false, error: "Gerade ist niemand online." });
      const gewinner = drin[Math.floor(Math.random() * drin.length)];
      const res = accounts.adjustChips(gewinner, topf);
      if (!res.ok) return ack({ ok: false, error: res.error });
      const acc = accounts.get(gewinner);
      for (const s of socketsVon(io, gewinner)) {
        s.emit("account:update", { account: res.account });
        s.emit("admin:nachricht", { titel: "Gewonnen!", text: `Die Verlosung geht an dich: ${topf.toLocaleString("de-DE")} Chips.` });
      }
      try { chat.announce(io, `Verlosung! ${(acc && acc.name) || gewinner} zieht ${topf.toLocaleString("de-DE")} Chips unter ${drin.length} Anwesenden.`); } catch {}
      try { require("./chronik").notiere("event", `Verlosung: ${(acc && acc.name) || gewinner} bekommt ${topf.toLocaleString("de-DE")} Chips.`, { user: (acc && acc.name) || gewinner, wert: topf }); } catch {}
      ack({ ok: true, gewinner: (acc && acc.name) || gewinner, topf, teilnehmer: drin.length });
    });

    /*
     * Kassensturz: eine Abgabe auf alles, was bar auf der Hand liegt.
     *
     * Das einzige Event, das Chips WEGNIMMT statt sie auszuschuetten. Genau
     * deshalb gibt es es: alle anderen Knoepfe hier drucken Geld, und wenn
     * zwei Jahre lang nur gedruckt wird, kostet ein Haus irgendwann nichts
     * mehr. Die Bank bleibt aussen vor (sonst waere Sparen bestraft) und
     * kleine Konten auch: unter der Freigrenze zahlt niemand.
     */
    socket.on("admin:steuer", ({ prozent, freigrenze, grund } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const satz = Math.max(1, Math.min(25, Math.floor(Number(prozent) || 5)));
      const frei = Math.max(0, Math.floor(Number(freigrenze) || 50000));
      let summe = 0, betroffen = 0;
      for (const a of accounts.rawAll()) {
        const bar = Math.floor(a.chips || 0);
        if (bar <= frei) continue;
        const ab = Math.floor(((bar - frei) * satz) / 100);
        if (ab <= 0) continue;
        const res = accounts.adjustChips(String(a.name).toLowerCase(), -ab);
        if (!res.ok) continue;
        summe += ab; betroffen++;
        for (const s of socketsVon(io, a.name)) {
          s.emit("account:update", { account: res.account });
          s.emit("admin:nachricht", {
            titel: "Kassensturz",
            text: `${satz} % von allem über ${frei.toLocaleString("de-DE")} Chips auf der Hand: ${ab.toLocaleString("de-DE")} Chips.${grund ? ` ${String(grund).slice(0, 140)}` : ""}`,
          });
        }
      }
      if (!betroffen) return ack({ ok: false, error: "Niemand liegt über der Freigrenze." });
      const text = `Kassensturz: ${satz} % auf Bargeld über ${frei.toLocaleString("de-DE")} Chips. ${summe.toLocaleString("de-DE")} Chips aus ${betroffen} Konten sind aus dem Spiel.`;
      try { chat.announce(io, text); } catch {}
      try { require("./chronik").notiere("event", text, { wert: summe }); } catch {}
      ack({ ok: true, summe, betroffen, satz, freigrenze: frei });
    });

    // Achievements eines Spielers löschen (zum Testen, ausgezahlte Belohnungen bleiben).
    socket.on("admin:resetAchievements", ({ target } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!isOwner()) return ack({ ok: false, error: "Kein Zugriff." });
      const acc = accounts.get(String(target || "").toLowerCase());
      if (!acc) return ack({ ok: false, error: "Account nicht gefunden." });
      acc.ach = {};
      accounts.save();
      ack({ ok: true });
    });
  });
}

module.exports = { setupAdmin, setHeist, setEvents };
