"use strict";

/**
 * Der Einlass: das Haus ist offen, aber nur der Warteraum.
 *
 * Die Wartung sperrt aus; der Einlass lässt rein, in genau einen Raum (das
 * Foyer in raeume.js), mit einem Countdown bis zur Öffnung. Gedacht für ein
 * großes Update, das zu einer festen Uhrzeit für alle gleichzeitig aufgeht,
 * auch wenn der Besitzer dann gar nicht da ist: der Server öffnet selbst,
 * auch nach einem Neustart (liegt die Uhrzeit schon zurück, sofort).
 *
 * Gesperrt wird auf dem SERVER, an einer Stelle (`bremse`, eine
 * Zwischenschicht am Socket wie bei den Strafen): solange zu ist, gehen nur
 * Anmeldung, Chat, Einstellungen, reine Leseabfragen, die Welt im Foyer und
 * die Dinge im Foyer durch. Spiele, Kisten, Markt, Stadt, Bank und die
 * Schnellwahl antworten mit dem Einlass-Text. Die Bonus-Routen per HTTP
 * fragt server.js über `gesperrt` ab. Der Browser blendet nur aus, die
 * Sperre selbst sitzt hier.
 *
 * Wer darf trotzdem rein: der Besitzer und die Testliste der Wartung.
 *
 * Im Foyer, alles so, dass es auch versetzt geht:
 *   Schätzglas   eine Schätzung je Konto, aufgelöst bei der Öffnung
 *   Gästebuch    eine Zeile je Konto an der Wand
 *   Teaser       die Neuerungen decken sich nach und nach auf; was noch
 *                verdeckt ist, verlässt den Server nicht
 *   Klopfen      dreimal schnell an die Tür, und es gibt etwas
 * Wer vor der Öffnung irgendwann da war, wird „Premierengast“. Belohnt wird
 * Vorfreude, nicht Pünktlichkeit.
 *
 * Bei der Öffnung: alle aus dem Foyer ins Casino, Schätzglas auflösen,
 * Schnitzeljagd starten, Push an alle. Danach 48 Stunden lang ein
 * Eröffnungspaket je Konto (Gratisgeld, läuft durch die Vermögensbremse).
 */

const fs = require("fs");
const path = require("path");
const hauszeit = require("./hauszeit");

const DATEI = path.join(__dirname, "..", "data", "einlass.json");
const OWNER = "vincent";
const PAKET_CHIPS = 25000;
const PAKET_MS = 48 * 3600 * 1000;
const SCHAETZ_PREIS = 50000;
const JAGD_TAGE = 3;
const WAND_MAX = 80;
const UMZUG_MS = 4000;

/* Die Öffnung, die dieses Update mitbringt. Ohne Datei und vor diesem
   Zeitpunkt geht das Haus beim Start von selbst zu; danach steht die Datei
   da (offen), und es passiert nie wieder. So ist der Deploy selbst der
   Schalter, und niemand muss nachts noch etwas drücken. */
const GEPLANT = { bis: hauszeit.ausWandzeit(Date.UTC(2026, 9, 2, 9, 25)), titel: "Das große Herbst-Update" };
/* Zuerst stand 9:20 da, und der Server hatte seine Datei damit schon
   angelegt. Eine Datei, die noch auf die alte Zeit wartet, rückt nach. */
const FRUEHER = [hauszeit.ausWandzeit(Date.UTC(2026, 9, 2, 9, 20))];

/* Was hinter der Tür wartet, als Rätsel. Jede Zeile deckt sich so viele
   Minuten vor der Öffnung auf. */
const TEASER = [
  { vor: 600, titel: "Es wird laut.", text: "Jeder Raum bekommt seine eigene Stimmung, und an einer Maschine darfst du sie für alle aussuchen." },
  { vor: 420, titel: "Hupen, Knattern, Rülpsen.", text: "Fahrzeuge, Getränke und Tiere machen ab heute Geräusche. Manche davon sind nicht stolz drauf." },
  { vor: 240, titel: "Ganz in Schwarz, auf einem Rad.", text: "Einer der Roller sieht nicht mehr aus wie früher, und er kann jetzt etwas, das man nicht nachmachen sollte." },
  { vor: 100, titel: "Eine Maschine, die lügt.", text: "Sie verspricht dir alles und hält fast nie. Aber eben nur fast." },
  { vor: 20, titel: "Ein Huhn mit Krone.", text: "Irgendwo im Haus wartet es. Fast niemand wird es je in der Hand halten." },
];

let state = null;
try {
  const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  if (roh && typeof roh === "object") state = roh;
} catch {}
if (state && state.an && FRUEHER.includes(state.bis)) state.bis = GEPLANT.bis;
if (!state) {
  state = Date.now() < GEPLANT.bis
    ? neuerZustand(GEPLANT.bis, GEPLANT.titel)
    : { an: false, bis: 0, offenSeit: 0, glas: 0, schaetz: {}, wand: [], premiere: {}, paket: {}, karte: {}, ergebnis: null };
}
function neuerZustand(bis, titel) {
  return {
    an: true, bis, titel, offenSeit: 0,
    glas: 1500 + Math.floor(Math.random() * 3000),
    schaetz: {}, wand: [], premiere: {}, paket: {}, karte: {}, ergebnis: null,
  };
}
function speichern() {
  try { require("./buchungen").sicherSchreiben(DATEI, JSON.stringify(state)); } catch (e) { console.error("[einlass] speichern:", e.message); }
}
/* Erst wenn server.js das Modul einrichtet, sperrt es. Tests, die die Welt
   ohne Server laden, sollen nicht im Warteraum landen. */
let eingerichtet = false;
const zu = () => eingerichtet && !!state.an;
const frei = (key) => {
  const k = String(key || "").toLowerCase();
  if (k === OWNER) return true;
  try { return require("./wartung").hatZugang(k); } catch { return false; }
};
/** Ist das Haus für dieses Konto gerade nur der Warteraum? */
const gesperrt = (key) => zu() && !frei(key);
const TEXT = () => `Noch ist Einlass. Um ${new Date(hauszeit.wandzeit(state.bis)).toISOString().slice(11, 16)} Uhr geht die Tür auf.`;

/* Was im Warteraum erlaubt ist. Alles andere antwortet mit dem Einlass-Text. */
const ERLAUBT = /^(auth|app:version|einlass:|chat:|push:|prefs|presence|admin:|verify|verification)/;
const NUR_LESEN = /:(state|config|init|history|list|marken|leaderboards|legal|inhalt|machines)$/;
const WELT_GESPERRT = new Set(["welt:hin", "welt:tuer"]);

function bremse(io) {
  io.on("connection", (socket) => {
    socket.use((packet, next) => {
      const ev = String(packet[0] || "");
      const key = socket.data && socket.data.account;
      if (!key || !gesperrt(key)) return next();
      if (ev.startsWith("welt:")) return WELT_GESPERRT.has(ev) ? stop(packet) : next();
      if (ERLAUBT.test(ev) || NUR_LESEN.test(ev)) return next();
      stop(packet);
    });
  });
  function stop(packet) {
    const ack = typeof packet[packet.length - 1] === "function" ? packet[packet.length - 1] : null;
    if (ack) ack({ ok: false, error: TEXT(), einlass: true });
  }
}

function teaserStand(jetzt = Date.now()) {
  const rest = state.bis - jetzt;
  return TEASER.map((t, i) => {
    const auf = !zu() || rest <= t.vor * 60000;
    return auf ? { i, auf: true, titel: t.titel, text: t.text } : { i, auf: false, in: rest - t.vor * 60000 };
  });
}

function stand(key, acc) {
  const k = String(key || "").toLowerCase();
  const offen = !zu() && state.offenSeit > 0;
  return {
    ok: true,
    zu: zu(),
    frei: frei(k),
    titel: state.titel || "",
    rest: zu() ? Math.max(0, state.bis - Date.now()) : 0,
    bis: state.bis,
    text: zu() ? TEXT() : "",
    teaser: teaserStand(),
    glas: { schaetzungen: Object.keys(state.schaetz || {}).length, meine: (state.schaetz[k] || {}).zahl || null, preis: SCHAETZ_PREIS },
    wand: (state.wand || []).slice(-WAND_MAX).map(({ name, text, t }) => ({ name, text, t })),
    meineZeile: ((state.wand || []).find((w) => w.key === k) || {}).text || "",
    ergebnis: state.ergebnis ? { ...state.ergebnis, meine: (state.schaetz[k] || {}).zahl || null } : null,
    paket: offen && Date.now() < state.offenSeit + PAKET_MS && !state.paket[k] && acc && paketBerechtigt(acc)
      ? { chips: Math.round(PAKET_CHIPS * (acc ? faktor(acc) : 1)), bis: state.offenSeit + PAKET_MS } : null,
  };
}
/* Das Paket ist für die, die schon da waren, nicht für Konten von morgen:
   sonst holt sich ein Zweitkonto 25.000 Chips und schickt sie nach einem
   Tag weiter (Überweisen geht ab 24 Stunden Kontoalter). */
const paketBerechtigt = (acc) => Number(acc.createdAt || 0) < state.offenSeit;
let _accounts = null;
const faktor = (acc) => (_accounts && typeof _accounts.faucetFactor === "function" ? _accounts.faucetFactor(acc.name) : 1);

/* Haken, die server.js setzt: die Welt (Figuren ins Foyer und wieder
   heraus) und die Schnitzeljagd. */
let welt = null, jagd = null;
const setWelt = (w) => { welt = w; };
const setJagd = (j) => { jagd = j; };

const zuletztGeschrieben = new Map();
function setupEinlass(io, accounts) {
  _accounts = accounts;
  eingerichtet = true;
  speichern();
  const chat = () => { try { return require("./chat"); } catch { return null; } };
  const cosmetics = () => require("./cosmetics");

  function premiere(key) {
    const k = String(key || "").toLowerCase();
    const acc = accounts.get(k);
    if (!acc || !zu() || state.premiere[k]) return;
    state.premiere[k] = Date.now();
    cosmetics().grant(acc, "title", "premierengast", k);
    accounts.save();
    speichern();
  }

  function oeffnen() {
    if (!zu()) return;
    state.an = false;
    state.offenSeit = Date.now();
    // Schätzglas auflösen: am nächsten dran gewinnt, bei Gleichstand wer zuerst geschätzt hat.
    const tipps = Object.entries(state.schaetz || {}).map(([key, s]) => ({ key, ...s, abstand: Math.abs(s.zahl - state.glas) }));
    tipps.sort((a, b) => a.abstand - b.abstand || a.t - b.t);
    const sieger = tipps[0];
    state.ergebnis = { glas: state.glas, schaetzungen: tipps.length, sieger: null };
    if (sieger) {
      const acc = accounts.get(sieger.key);
      if (acc) {
        const chips = Math.round(SCHAETZ_PREIS * faktor(acc));
        accounts.adjustChips(sieger.key, chips);
        cosmetics().grant(acc, "title", "augenmass", sieger.key);
        state.ergebnis.sieger = { name: acc.name, zahl: sieger.zahl, chips };
        try { accounts.meldeStand(io, sieger.key); } catch {}
      }
    }
    speichern();
    /* Erst das Signal, dann der Umzug: die Browser spielen vier Sekunden
       lang die Öffnung (Tür, Kordel, Konfetti), danach setzt der Server
       alle ins Casino. Andersherum säße man schon drin, bevor die Tür
       aufgeht. Die Sperre ist ab jetzt schon weg. */
    io.emit("einlass:auf", { ergebnis: state.ergebnis, titel: state.titel || "", umzugIn: UMZUG_MS });
    // Läuft schon eine, bleibt sie: ein neuer Start löscht alle bisherigen Funde.
    try { if (jagd && !require("./schnitzeljagd").laeuft()) jagd.starten(JAGD_TAGE); } catch (e) { console.error("[einlass] Schnitzeljagd:", e.message); }
    const umzug = setTimeout(() => {
      try { if (welt) welt.allesAusDemFoyer(); } catch (e) { console.error("[einlass] Foyer leeren:", e.message); }
    }, UMZUG_MS);
    if (umzug.unref) umzug.unref();
    const c = chat();
    if (c) {
      c.announce(io, `Die Tür ist auf! ${state.titel || "Das Update"} ist da. Willkommen zurück im Casino.`);
      if (state.ergebnis.sieger) c.announce(io, `Im Schätzglas waren ${state.glas.toLocaleString("de-DE")} Chips. ${state.ergebnis.sieger.name} lag mit ${state.ergebnis.sieger.zahl.toLocaleString("de-DE")} am nächsten und gewinnt.`);
    }
    try { require("./push").anAlle("live", { title: "Die Tür ist auf", body: `${state.titel || "Das Update"} ist da. Komm rein.`, url: "/" }); } catch {}
  }

  function schliessen(bis, titel) {
    state = neuerZustand(bis, titel || state.titel || GEPLANT.titel);
    speichern();
    try { if (welt) welt.allesInsFoyer(); } catch {}
    io.emit("einlass:update", {});
  }

  // Die Uhr: grob alle paar Sekunden, und genau zum Zeitpunkt.
  let wecker = null;
  function stellen() {
    clearTimeout(wecker);
    if (!zu()) return;
    const rest = state.bis - Date.now();
    if (rest <= 0) return oeffnen();
    wecker = setTimeout(() => { if (zu() && Date.now() >= state.bis - 50) oeffnen(); else stellen(); }, Math.min(rest, 60000));
    if (wecker.unref) wecker.unref();
  }
  stellen();
  const nachsehen = setInterval(() => { if (zu() && Date.now() >= state.bis) oeffnen(); }, 5000);
  if (nachsehen.unref) nachsehen.unref();

  io.on("connection", (socket) => {
    const wer = () => {
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      return acc ? { key, acc } : null;
    };

    socket.on("einlass:state", (ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false });
      if (zu()) premiere(w.key);
      ack(stand(w.key, w.acc));
    });

    socket.on("einlass:schaetzen", ({ zahl } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!zu()) return ack({ ok: false, error: "Das Glas ist schon aufgelöst." });
      const n = Math.round(Number(zahl));
      if (!Number.isFinite(n) || n < 1 || n > 100000) return ack({ ok: false, error: "Eine Zahl zwischen 1 und 100.000, bitte." });
      if (state.schaetz[w.key]) return ack({ ok: false, error: "Du hast schon geschätzt." });
      state.schaetz[w.key] = { zahl: n, t: Date.now() };
      speichern();
      ack(stand(w.key, w.acc));
    });

    socket.on("einlass:schreiben", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!zu()) return ack({ ok: false, error: "Die Wand ist schon abgehängt." });
      // Jede Zeile geht an alle; ohne Pause ließe sich die Wand im Sekundentakt umschreiben.
      if (Date.now() - (zuletztGeschrieben.get(w.key) || 0) < 10000) return ack({ ok: false, error: "Kurz warten, dann kannst du wieder ändern." });
      zuletztGeschrieben.set(w.key, Date.now());
      const t = String(text || "").replace(/\s+/g, " ").trim();
      if (t.length < 2 || t.length > 60) return ack({ ok: false, error: "Zwischen 2 und 60 Zeichen." });
      const wf = require("./wortfilter").pruefe(t, "Der Eintrag");
      if (wf && wf.ok === false) return ack({ ok: false, error: wf.error || "Das schreiben wir hier nicht hin." });
      state.wand = (state.wand || []).filter((x) => x.key !== w.key);
      state.wand.push({ key: w.key, name: w.acc.name, text: t, t: Date.now() });
      if (state.wand.length > WAND_MAX) state.wand = state.wand.slice(-WAND_MAX);
      speichern();
      io.emit("einlass:wand", { wand: state.wand.map(({ name, text: x, t: z }) => ({ name, text: x, t: z })) });
      ack(stand(w.key, w.acc));
    });

    socket.on("einlass:paket", (ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (zu() || !state.offenSeit) return ack({ ok: false, error: "Erst nach der Öffnung." });
      if (Date.now() >= state.offenSeit + PAKET_MS) return ack({ ok: false, error: "Das Eröffnungspaket ist schon abgelaufen." });
      if (state.paket[w.key]) return ack({ ok: false, error: "Dein Paket hast du schon." });
      if (!paketBerechtigt(w.acc)) return ack({ ok: false, error: "Das Eröffnungspaket gibt es für Konten, die vor der Öffnung schon da waren." });
      const chips = Math.round(PAKET_CHIPS * faktor(w.acc));
      state.paket[w.key] = Date.now();
      speichern();
      const r = accounts.adjustChips(w.key, chips);
      ack({ ok: true, chips, account: r.ok ? r.account : accounts.publicAccount(w.acc) });
    });

    // Wer frei ist, kann sich den Warteraum ansehen und wieder gehen.
    socket.on("einlass:ansehen", ({ rein } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w || !frei(w.key)) return ack({ ok: false, error: "Nur für Besitzer und Testliste." });
      if (rein && !zu()) return ack({ ok: false, error: "Gerade ist kein Einlass." });
      ack({ ok: !!(welt && welt.ansehen(w.key, !!rein)) });
    });

    // Die Verwaltung: zumachen bis, sofort öffnen, verschieben.
    socket.on("admin:einlass", (daten, ack) => {
      if (typeof ack !== "function") return;
      if (String(socket.data.account || "").toLowerCase() !== OWNER) return ack({ ok: false, error: "Nur der Besitzer." });
      const a = daten && daten.aktion;
      if (a === "oeffnen") { oeffnen(); stellen(); return ack({ ok: true, zu: zu() }); }
      const bis = Number(daten && daten.bis);
      if (!Number.isFinite(bis) || bis <= Date.now()) return ack({ ok: false, error: "Der Zeitpunkt muss in der Zukunft liegen." });
      if (a === "verschieben" && zu()) { state.bis = bis; speichern(); stellen(); io.emit("einlass:update", {}); return ack({ ok: true, zu: true, bis }); }
      if (a === "schliessen") { schliessen(bis, daten.titel); stellen(); return ack({ ok: true, zu: true, bis }); }
      ack({ ok: false, error: "Unbekannte Aktion." });
    });
  });

  return { oeffnen, schliessen, stand, premiere };
}

/** Das Foyer-Ding „Tür“: dreimal schnell klopfen gibt die goldene Eintrittskarte. */
function klopfen(key, accounts) {
  const k = String(key || "").toLowerCase();
  const jetzt = Date.now();
  const z = state.karte[k];
  const zaehler = z && typeof z === "object" && jetzt - z.t < 3000 ? { n: z.n + 1, t: jetzt } : { n: 1, t: jetzt };
  if (z === true) return { satz: "Hinter der Tür wird es still. Du hast deine Karte schon." };
  state.karte[k] = zaehler;
  if (zaehler.n < 3) return { satz: zaehler.n === 1 ? "Klopf klopf. Von drinnen ruft jemand: „Noch nicht!“" : "Klopf klopf klopf. „Geduld!“" };
  state.karte[k] = true;
  speichern();
  const acc = accounts.get(k);
  if (acc) { require("./cosmetics").grant(acc, "hand", "eintrittskarte", k); accounts.save(); }
  return { neu: true, satz: "Die Tür öffnet sich einen Spalt, eine Hand schiebt dir eine goldene Eintrittskarte zu, und zu ist sie wieder. Die gehört jetzt dir." };
}

module.exports = { setupEinlass, bremse, gesperrt, zu, frei, klopfen, setWelt, setJagd, stand, TEXT, GEPLANT, _state: () => state };
