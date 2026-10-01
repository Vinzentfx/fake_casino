"use strict";

/**
 * Die begehbare Welt: wer steht wo, in welchem Raum, und was darf er dort.
 *
 * Der Browser bewegt die eigene Figur sofort und meldet etwa zehnmal in der
 * Sekunde, wo sie jetzt steht. Der Server glaubt das nicht einfach: jeder
 * Zug muss auf freiem Boden enden, darf durch keine Wand und keinen Tisch
 * führen und nicht schneller sein als Gehen. Wer das nicht einhält, bekommt
 * seinen letzten gültigen Platz zurück. Dieselben Regeln stehen in
 * public/js/welt/raeume.js, und beide Seiten lesen genau diese Datei.
 *
 * Die Figur gehört dem KONTO, nicht dem Tab. Wer zwei Tabs offen hat, steht
 * trotzdem nur einmal im Raum, und beide Tabs zeigen denselben Platz. Sie
 * verschwindet erst, wenn der letzte Tab weg ist; den Platz merkt sich der
 * Server danach noch eine Viertelstunde. Ein Wackler im Mobilfunk oder ein
 * weggeräumter Safari-Tab setzt also niemanden an den Eingang zurück.
 *
 * Gezeigt wird nur, wer wirklich verbunden ist. Keine Figur bleibt als
 * Platzhalter stehen, wenn ihr Mensch gegangen ist.
 *
 * Was sich öffnet, wenn man etwas benutzt, entscheidet ebenfalls der Server
 * (`welt:nutzen`), und nur, wenn man nah genug dran steht. Dahinter liegen
 * die bestehenden Bildschirme mit ihren eigenen Prüfungen; die Welt vergibt
 * keine Chips, keine Gegenstände und keine Rechte.
 */

const R = require("../public/js/welt/raeume.js");
const cosmetics = require("./cosmetics");
const kleidung = require("./kleidung");

const BEHALTEN_MS = 15 * 60 * 1000;
const GESTE_ABSTAND_MS = 2500;
// Die Schnellwahl springt; öfter als alle zwei Sekunden wäre nur Zappeln.
const HIN_ABSTAND_MS = 2000;

/* Wo man vor einem Ding steht: am Nutzpunkt, oder bei einem Tisch, an den
   man von allen Seiten tritt („rand“), mittig vor seiner Vorderkante. Der
   Punkt muss begehbar und in Reichweite sein, sonst sucht es ringsum. */
function standplatz(raum, d) {
  const roh = d.nutz && typeof d.nutz === "object" ? { x: d.nutz.x, y: d.nutz.y }
    : d.block ? { x: (d.block[0] + d.block[2]) / 2, y: d.block[3] + 0.55 } : { x: d.x, y: d.y + 0.6 };
  const gut = (x, y) => R.begehbar(raum, x, y) && (R.reichweite(d) <= 0 || R.abstandZuDing(d, x, y) <= R.reichweite(d));
  if (gut(roh.x, roh.y)) return { x: runde(roh.x), y: runde(roh.y) };
  for (let r = 0.25; r <= 1.5; r += 0.25) {
    for (let w = 0; w < 16; w++) {
      const x = roh.x + Math.cos((w / 16) * Math.PI * 2) * r, y = roh.y + Math.sin((w / 16) * Math.PI * 2) * r;
      if (gut(x, y)) return { x: runde(x), y: runde(y) };
    }
  }
  return null;
}
// Stück-Gesten dauern länger (Rauchringe, Salto); sie sollen nicht übereinander laufen.
const STUECK_GESTE_ABSTAND_MS = 3200;
const ZUEGE_JE_SEKUNDE = 30;
// Gebündelt ankommende Züge (das Netz hält drei zurück und liefert sie auf
// einmal) dürfen aufholen, aber nicht mehr als diese Strecke am Stück.
const BUDGET_MAX = 2.4;
// Spielraum auf das Gehtempo für schwankende Takte im Browser.
const TOLERANZ = 1.3;
const NUTZ_SPIELRAUM = 0.35;
const RICHTUNGEN = new Set(["hoch", "runter", "links", "rechts"]);

/*
 * Geheimnisse. Wer eins findet, bekommt ein Stück, das es nirgends sonst
 * gibt, und zwar genau einmal. Verraten wird im Chat nur, DASS jemand etwas
 * gefunden hat, nicht wo: sonst wäre es nach dem ersten Fund keins mehr.
 */
const GEHEIMNISSE = {
  tresorkatze: { art: "haustier", id: "tresorkatze", satz: "Die Katze blinzelt, streckt sich und läuft dir ab jetzt hinterher." },
  kleeblatt:   { art: "hand",     id: "kleeblatt",   satz: "Ein vierblättriges Kleeblatt. Du steckst es ein, es gehört jetzt dir." },
  spiegel:     { art: "brille",   id: "spiegelbrille", satz: "Dein Spiegelbild winkt zurück und reicht dir eine Brille herüber." },
  schallplatte: { art: "hand",    id: "schallplatte", satz: "Beim dritten Drücken rattert die Jukebox, ruckelt, und unten fällt eine alte Schallplatte heraus. Die gehört jetzt dir." },
  pokal:       { art: "hand",     id: "pokal",       satz: "Oben auf dem Podest jubelst du, als hättest du gewonnen. Jemand drückt dir einen goldenen Pokal in die Hand." },
  wunderkerze: { art: "hand",     id: "wunderkerze", satz: "Du winkst dem Feuer zu, und aus der Glut springt ein Funke in deine Hand. Eine Wunderkerze, die nie ausgeht." },
  e46:         { art: "fahrzeug", id: "e46",         satz: "Unter der Plane steht ein alter BMW E46 in Orientblau, auf BBS-Felgen. Der Schlüssel steckt. Er gehört jetzt dir. Anspringen wird er nie." },
};

/* Das Garagentor in der Ladenstraße geht nur nachts auf, und nur für
   jemanden, der davor hupt. Gerechnet in deutscher Zeit, egal wo der
   Server steht. */
const GARAGE_OFFEN_MS = 90 * 1000;
// Die Uhr ist austauschbar, damit sich die Nacht im Test herstellen lässt.
const uhr = { jetzt: () => Date.now() };
function nachts(jetzt = uhr.jetzt()) {
  const h = require("./hauszeit").stunde(jetzt);
  return h >= 22 || h < 5;
}
const GESTEN = new Set(["winken", "jubeln"]);
/* Was die Jukebox spielt. Erfunden, damit niemandes Lied hier steht. Der
   Stil ist der Name in public/js/core/musik.js; der Browser spielt ihn. */
const LIEDER = [
  { titel: "„Alles auf Rot“ von den Jackpot-Jungs", stil: "disco" },
  { titel: "„Hebel runter“ von Lucky 7", stil: "chiptune" },
  { titel: "„Nacht in Porta“ von DJ Weserwelle", stil: "synthwave" },
  { titel: "„Noch eine Runde“ von Die Croupiers", stil: "swing" },
  { titel: "„Goldene Spielmarke“ von Neon Royale", stil: "house" },
  { titel: "„Ring-ding-ding“ von Simson Sisters", stil: "polka" },
];
/* Ein Lied läuft drei Minuten, dann wieder die Raummusik. Gemerkt nur im
   Speicher: nach einem Neustart spielt die Halle ihre eigene Musik. */
const LIED_MS = 3 * 60 * 1000;

const runde = (n) => Math.round(n * 100) / 100;

/* Für schau(): die Spielmodule melden ein Ergebnis, und wer im Raum am
   Tisch steht, sieht es. Gesetzt in setupWelt. */
const zuschauen = { io: null, figuren: null, kanal: null };

/* Ein Ankunftspunkt mit etwas Streuung, damit zwei, die gleichzeitig
   kommen, nicht exakt aufeinander stehen und ihre Namen sich decken.
   Nur Punkte auf freiem Boden; sonst der Punkt selbst. */
function gestreut(raum, p, weite = 0.8) {
  for (let i = 0; i < 8; i++) {
    const x = runde(p.x + (Math.random() * 2 - 1) * weite);
    const y = runde(p.y + (Math.random() * 2 - 1) * weite * 0.4);
    if (R.begehbar(raum, x, y)) return { x, y };
  }
  return { x: p.x, y: p.y };
}

/**
 * Ein Zug, geprüft ohne Sockets, damit es sich testen lässt.
 * Gibt immer das neue Budget zurück, auch bei Ablehnung: die Zeit ist
 * vergangen, ob der Zug gültig war oder nicht.
 */
function pruefeZug(fig, x, y, jetzt) {
  const raum = R.raum(fig.raum);
  const dt = Math.max(0, Math.min(jetzt - fig.t, 2000)) / 1000;
  const tempo = R.TEMPO * (fig.faehrt ? R.FAHRZEUG_FAKTOR : 1);
  const budget = Math.min(BUDGET_MAX * (fig.faehrt ? R.FAHRZEUG_FAKTOR : 1), fig.budget + tempo * TOLERANZ * dt);
  if (!raum || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, budget };

  // Wer sitzt, steht vor dem Sitz auf und geht von dort los.
  let vonX = fig.x;
  let vonY = fig.y;
  if (fig.sitzt) {
    const sitz = raum.sitze.find((s) => s.id === fig.sitzt);
    if (sitz) { vonX = sitz.auf.x; vonY = sitz.auf.y; }
  }
  const weg = Math.hypot(x - vonX, y - vonY);
  // Auf einem Fahrzeug, das nicht anspringt, kommt man nicht vom Fleck. Umdrehen geht.
  if (fig.steht && weg > 0) return { ok: false, budget };
  if (weg > budget + 0.05) return { ok: false, budget };
  if (!R.begehbar(raum, x, y) || !R.wegFrei(raum, vonX, vonY, x, y)) return { ok: false, budget };
  // Die Rundungstoleranz bleibt als kleine Schuld stehen. Sonst schenkt
  // jede Nachricht erneut 0,05 Kacheln, auch wenn gar keine Zeit vergeht.
  return { ok: true, budget: budget - weg };
}

/** Grundform der Figur (Haut, Haare, Frisur, Hose). Nur ganze Zahlen im Bereich. */
const saubereGrundform = R.grundform;

function setupWelt(io, accounts) {
  const figuren = new Map();   // Kontoschlüssel: Figur
  const jukeboxen = new Map(); // Raum: { lied, bis }
  let naechsteId = 1;
  const kanal = (raumId) => "welt:" + raumId;
  const verification = require("./verification");
  Object.assign(zuschauen, { io, figuren, kanal });

  /* Die Spielhalle spielt mit: wer an einem ihrer Automaten oder Tische
     gewinnt, dessen Gewinn sehen alle im Raum dort, ab dem 25-Fachen als
     Explosion. Gemeldet wird über accounts.onHand, das jede Runde mit Spiel
     und Einsatz durchläuft; die Spielmodule müssen dafür nichts wissen. */
  const SPIEL_DING = { mines: "mines", towers: "towers", crash: "crash", pinco: "pinco", hilo: "hilo", wuerfel: "wuerfel" };
  if (typeof accounts.onHand === "function") {
    accounts.onHand((name, gewinn, _haus, spiel, meta) => {
      const dingId = SPIEL_DING[spiel];
      const einsatz = meta && Number(meta.einsatz);
      if (!dingId || !(einsatz > 0) || !(gewinn > 0)) return;
      const fig = figuren.get(String(name || "").toLowerCase());
      if (!fig || !sichtbar(fig)) return;
      const d = (R.raum(fig.raum).dinge || []).find((x) => x.id === dingId);
      if (!d || R.abstandZuDing(d, fig.x, fig.y) > R.reichweite(d) + 1.5) return;
      const auszahlung = gewinn + einsatz;
      const vielfach = Math.round((auszahlung / einsatz) * 10) / 10;
      io.to(kanal(fig.raum)).emit("welt:schau", { id: fig.id, ding: dingId, betrag: auszahlung, vielfach, gross: vielfach >= 25, spielhalle: true });
    });
  }

  function lookVon(acc) {
    const l = cosmetics.publicLook(acc);
    return {
      name: acc.name,
      avatar: l.avatar, nameColor: l.nameColor, nameStyle: l.nameStyle,
      frame: l.frame, aura: l.aura, zeichen: l.zeichen, title: l.title,
      schild: l.schild, prunk: l.prunk, garnitur: l.garnitur,
      figur: saubereGrundform(acc.figur),
      kleidung: l.kleidung || {}, stilSet: l.stilSet || null,
      // Der Name, den das Tier im Zoo bekommen hat. Geprüft beim Kauf.
      tierName: acc.haustier && acc.tierNamen && typeof acc.tierNamen[acc.haustier] === "string" ? acc.tierNamen[acc.haustier] : null,
    };
  }

  /* Was ein Tab gerade offen hat, steht seit jeher in socket.data.screen
     (tableManager.js setzt es und laesst unbekannte Namen auf "lobby"
     fallen). Die Lobby ist die Welt selbst und zaehlt nicht als Tätigkeit. */
  function aktivVon(fig) {
    for (const s of fig.sockets) {
      const sc = s.data && s.data.screen;
      if (sc && sc !== "lobby" && /^[a-zA-Z]{2,24}$/.test(sc)) return sc;
    }
    return null;
  }

  function oeffentlich(fig) {
    const acc = accounts.get(fig.key);
    return {
      id: fig.id, look: acc ? lookVon(acc) : { name: "?" },
      x: fig.x, y: fig.y, d: fig.d, g: fig.geht ? 1 : 0, s: fig.sitzt || 0, a: fig.aktiv || null,
    };
  }

  const sichtbar = (fig) => fig.sockets.size > 0;

  function zustand(fig) {
    const andere = [];
    for (const f of figuren.values()) {
      if (f !== fig && f.raum === fig.raum && sichtbar(f)) andere.push(oeffentlich(f));
    }
    return { ok: true, ich: fig.id, raum: fig.raum, pos: { x: fig.x, y: fig.y, d: fig.d, s: fig.sitzt || 0 }, look: oeffentlich(fig).look, spieler: andere, fahrt: fahrtZustand(fig), musik: musikVon(fig.raum) };
  }

  /* Was die Jukebox im Raum gerade spielt, mit Restzeit statt Uhrzeit:
     die Uhr im Browser muss nicht stimmen. */
  function musikVon(raumId) {
    const j = jukeboxen.get(raumId);
    if (!j || j.bis <= Date.now()) return null;
    return { titel: j.lied.titel, stil: j.lied.stil, rest: j.bis - Date.now() };
  }

  /* Für den eigenen Knopf: welches Fahrzeug angelegt ist und ob man drauf sitzt. */
  function fahrtZustand(fig) {
    const acc = accounts.get(fig.key);
    const fahrzeug = kleidung.fahrzeugVon(acc);
    return { fahrzeug, auf: !!fahrzeug && !acc.zuFuss, steht: !!fig.steht };
  }

  /** An alle im Raum, außer an die Tabs der Figur selbst. */
  function anAndere(fig, ereignis, daten) {
    const eigene = [...fig.sockets].map((s) => s.id);
    io.to(kanal(fig.raum)).except(eigene).emit(ereignis, daten);
  }

  /* Was die Welt für Achievements mitzählt, am Konto unter acc.welt:
     besuchte Räume, Shisha-Runde. Danach wird geprüft, ob damit etwas
     freigeschaltet ist (game/achievements.js). */
  function weltFortschritt(key, aendern) {
    const acc = accounts.get(key);
    if (!acc) return;
    const w = acc.welt && typeof acc.welt === "object" ? acc.welt : (acc.welt = {});
    const vorher = JSON.stringify(w);
    aendern(w);
    if (JSON.stringify(w) === vorher) return;
    accounts.save();
    try { require("./achievements").check(key); } catch {}
  }
  function besucht(fig) {
    if (R.raum(fig.raum) && R.raum(fig.raum).geheim) return;
    weltFortschritt(fig.key, (w) => { w.raeume = w.raeume || {}; if (!w.raeume[fig.raum]) w.raeume[fig.raum] = Date.now(); });
  }

  function geheimnisFinden(key, gid) {
    const g = GEHEIMNISSE[gid];
    const acc = accounts.get(key);
    if (!g || !acc) return null;
    const gefunden = acc.geheimnisse && typeof acc.geheimnisse === "object" ? acc.geheimnisse : (acc.geheimnisse = {});
    const label = cosmetics.label(g.art, g.id);
    if (gefunden[gid]) return { neu: false, label, satz: "Hier hast du schon gefunden, was es zu finden gab." };
    gefunden[gid] = Date.now();
    cosmetics.grant(acc, g.art, g.id, key);
    /* Die Katze läuft ab sofort mit, so wie der Satz es verspricht. Und
       wer den alten Dreier findet, sitzt gleich drin. */
    if (g.art === "haustier") acc.haustier = g.id;
    if (g.art === "fahrzeug") { acc.fahrzeug = g.id; acc.zuFuss = false; }
    accounts.save();
    const fig = figuren.get(key);
    if (fig && g.art === "fahrzeug") {
      fig.fahrzeug = kleidung.fahrzeugVon(acc);
      Object.assign(fig, kleidung.fahrtVon(acc));
      for (const s of fig.sockets) s.emit("welt:fahrt", fahrtZustand(fig));
    }
    if (fig && sichtbar(fig)) io.to(kanal(fig.raum)).emit("welt:aussehen", oeffentlich(fig));
    const zahl = Object.keys(gefunden).filter((k) => GEHEIMNISSE[k]).length;
    try { require("./achievements").check(key); } catch {}
    try { require("./chat").announce(io, `${acc.name} hat ein Geheimnis im Haus gefunden (${zahl} von ${Object.keys(GEHEIMNISSE).length}).`); } catch {}
    const pub = accounts.publicAccount(acc);
    for (const s of io.of("/").sockets.values()) {
      if (s.data && s.data.account === key) s.emit("account:update", { account: pub });
    }
    return { neu: true, label, satz: g.satz, zahl, von: Object.keys(GEHEIMNISSE).length };
  }

  function figVon(socket) {
    const key = socket.data.weltKey;
    if (!key || key !== socket.data.account) return null;
    return figuren.get(key) || null;
  }

  function aufstehen(fig) {
    if (!fig.sitzt) return;
    const sitz = (R.raum(fig.raum).sitze || []).find((s) => s.id === fig.sitzt);
    if (sitz) { fig.x = sitz.auf.x; fig.y = sitz.auf.y; }
    fig.sitzt = null;
  }

  /* Wie viele in welchem Raum sind. Steht an den Türschildern: wer allein im
     Casino steht, soll sehen, dass nebenan im Kontor jemand ist. Gebündelt,
     damit ein Schwung Anmeldungen nach einem Neustart nicht zwanzig
     Meldungen auslöst. */
  let belegungTimer = null;
  function meldeBelegung() {
    if (belegungTimer) return;
    belegungTimer = setTimeout(() => {
      belegungTimer = null;
      const zahl = {};
      for (const id of Object.keys(R.RAEUME)) zahl[id] = 0;
      for (const f of figuren.values()) if (sichtbar(f) && zahl[f.raum] != null) zahl[f.raum]++;
      for (const id of Object.keys(R.RAEUME)) io.to(kanal(id)).emit("welt:belegung", zahl);
    }, 300);
  }

  function abmelden(socket) {
    const key = socket.data.weltKey;
    if (!key) return;
    socket.data.weltKey = null;
    const fig = figuren.get(key);
    if (!fig || !fig.sockets.has(socket)) return;
    fig.sockets.delete(socket);
    socket.leave(kanal(fig.raum));
    if (fig.sockets.size === 0) {
      fig.weg = Date.now();
      fig.geht = false;
      aufstehen(fig);
      io.to(kanal(fig.raum)).emit("welt:raus", { id: fig.id });
      meldeBelegung();
    } else {
      meldeAktiv(fig);
    }
  }

  function meldeAktiv(fig) {
    const a = aktivVon(fig);
    if (a === fig.aktiv) return;
    fig.aktiv = a;
    io.to(kanal(fig.raum)).emit("welt:aktiv", { id: fig.id, a });
  }

  function umziehen(fig, zielId, ankunft, ausloeser) {
    const alt = kanal(fig.raum);
    anAndere(fig, "welt:raus", { id: fig.id });
    for (const s of fig.sockets) s.leave(alt);
    fig.raum = zielId;
    besucht(fig);
    const platz = gestreut(R.raum(zielId), ankunft, 0.35);
    fig.x = platz.x; fig.y = platz.y; fig.d = ankunft.d || "runter";
    fig.sitzt = null; fig.geht = false;
    fig.budget = 0; fig.t = Date.now();
    for (const s of fig.sockets) s.join(kanal(zielId));
    anAndere(fig, "welt:rein", oeffentlich(fig));
    const neu = zustand(fig);
    for (const s of fig.sockets) if (s !== ausloeser) s.emit("welt:umzug", neu);
    meldeBelegung();
    return neu;
  }

  // Wer länger weg ist, fängt wieder am Eingang an. Ohne Timer je Figur:
  // der wäre nach jedem Neustart ohnehin weg.
  setInterval(() => {
    const jetzt = Date.now();
    for (const [key, fig] of figuren) {
      if (!sichtbar(fig) && fig.weg && jetzt - fig.weg > BEHALTEN_MS) figuren.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  io.on("connection", (socket) => {
    socket.data.weltKey = null;
    let fensterStart = 0;
    let fensterZuege = 0;

    socket.on("welt:betreten", (_daten, ack) => {
      if (typeof _daten === "function") { ack = _daten; }
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (verification.state(acc)) return ack({ ok: false, error: "Erst nach der Freigabe." });

      if (socket.data.weltKey && socket.data.weltKey !== key) abmelden(socket);

      const jetzt = Date.now();
      let fig = figuren.get(key);
      if (fig && !sichtbar(fig) && fig.weg && jetzt - fig.weg > BEHALTEN_MS) fig = null;
      if (!fig) {
        const start = R.raum("casino").start;
        const platz = gestreut(R.raum("casino"), start);
        fig = {
          key, id: naechsteId++, raum: "casino",
          x: platz.x, y: platz.y, d: start.d, geht: false, sitzt: null,
          t: jetzt, budget: 0, sockets: new Set(), weg: null, gesteTs: 0, aktiv: null, figurTs: 0,
        };
        figuren.set(key, fig);
      }
      const warSichtbar = sichtbar(fig);
      if (!fig.sockets.has(socket)) {
        fig.sockets.add(socket);
        socket.join(kanal(fig.raum));
      }
      socket.data.weltKey = key;
      fig.weg = null;
      besucht(fig);
      Object.assign(fig, kleidung.fahrtVon(acc));
      fig.fahrzeug = kleidung.fahrzeugVon(acc);
      fig.aktiv = aktivVon(fig);
      if (!warSichtbar) {
        fig.t = jetzt; fig.budget = 0;
        anAndere(fig, "welt:rein", oeffentlich(fig));
      }
      ack(zustand(fig));
      meldeBelegung();
    });

    socket.on("welt:zug", (daten) => {
      const fig = figVon(socket);
      if (!fig || !daten || typeof daten !== "object") return;
      const jetzt = Date.now();
      if (jetzt - fensterStart > 1000) { fensterStart = jetzt; fensterZuege = 0; }
      if (++fensterZuege > ZUEGE_JE_SEKUNDE) return;

      // Genau die Strecke prüfen, die wir danach speichern. Andernfalls
      // werden Schritte von 0,0051 als 0,01 bewegt, aber nur halb bezahlt.
      const x = runde(Number(daten.x));
      const y = runde(Number(daten.y));
      const d = RICHTUNGEN.has(daten.d) ? daten.d : fig.d;
      const geht = !!daten.g;
      const r = pruefeZug(fig, x, y, jetzt);
      fig.t = jetzt;
      fig.budget = r.budget;
      if (!r.ok) {
        socket.emit("welt:korrektur", { raum: fig.raum, x: fig.x, y: fig.y, d: fig.d, s: fig.sitzt || 0 });
        return;
      }
      fig.x = runde(x); fig.y = runde(y); fig.d = d; fig.geht = geht; fig.sitzt = null;
      const zug = [fig.id, fig.x, fig.y, fig.d, geht ? 1 : 0, 0];
      /* Laufende Züge dürfen verloren gehen, der nächste kommt gleich. Der
         letzte (stehen geblieben) nicht: sonst läuft die Figur bei den
         anderen auf der Stelle weiter. */
      const ziel = socket.to(kanal(fig.raum));
      (geht ? ziel.volatile : ziel).emit("welt:z", zug);
    });

    socket.on("welt:nutzen", ({ ding } = {}, ack) => {
      if (typeof ack !== "function") return;
      const fig = figVon(socket);
      if (!fig) return ack({ ok: false, error: "Du bist gerade nicht in der Welt." });
      const raum = R.raum(fig.raum);
      const d = raum.dinge.find((x) => x.id === String(ding || ""));
      if (!d || !d.ziel) return ack({ ok: false, error: "Das gibt es hier nicht." });
      /* Reichweite null heißt: eine Anzeige an der Wand, die man aus dem
         ganzen Raum lesen kann. Die kann man auch von überall antippen. */
      if (R.reichweite(d) > 0 && R.abstandZuDing(d, fig.x, fig.y) > R.reichweite(d) + NUTZ_SPIELRAUM) {
        return ack({ ok: false, error: "Geh erst etwas näher heran." });
      }
      if (d.ziel.geheimnis) {
        const g = geheimnisFinden(fig.key, d.ziel.geheimnis);
        return ack(g ? { ok: true, ding: d.id, ziel: { geheimnis: g } } : { ok: false, error: "Da ist nichts." });
      }
      if (d.ziel.tisch === "roulette") {
        /* Die Grenzen und Quoten kommen aus dem Roulette-Modul selbst, damit
           der Tisch in der Welt nie etwas anderes verspricht als das Spiel. */
        const rl = require("./roulette");
        return ack({ ok: true, ding: d.id, ziel: { ...d.ziel, regeln: {
          min: rl.MIN_BET, max: rl.MAX_TOTAL,
          quoten: { zahl: rl.payoutFactor("number", 1, 1), einfach: rl.payoutFactor("red", 0, 1), dutzend: rl.payoutFactor("dozen", 1, 1) },
          rot: rl.RED_NUMS,
        } } });
      }
      if (d.ziel.tuer) {
        const t = raum.tueren.find((x) => x.id === d.ziel.tuer);
        if (!t || !R.raum(t.ziel)) return ack({ ok: false, error: "Da geht es nicht weiter." });
        if (t.verschlossen && !(fig.torOffenBis > Date.now())) return ack({ ok: false, error: "Abgeschlossen. Dahinter ist es ganz still." });
        return ack({ ok: true, ding: d.id, ziel: { umzug: umziehen(fig, t.ziel, t.ankunft, socket) } });
      }
      if (d.ziel.jukebox) {
        /* Dreimal kurz hintereinander drücken, und die Jukebox spuckt etwas aus. */
        const jetzt = Date.now();
        fig.jukebox = fig.jukebox && jetzt - fig.jukebox.t < 4000 ? { n: fig.jukebox.n + 1, t: jetzt } : { n: 1, t: jetzt };
        if (fig.jukebox.n >= 3) {
          fig.jukebox = null;
          const g = geheimnisFinden(fig.key, "schallplatte");
          if (g) return ack({ ok: true, ding: d.id, ziel: { geheimnis: g } });
        }
        // Nicht zweimal dasselbe hintereinander.
        const alt = jukeboxen.get(fig.raum);
        const auswahl = LIEDER.filter((l) => !alt || l !== alt.lied);
        const lied = auswahl[Math.floor(Math.random() * auswahl.length)];
        jukeboxen.set(fig.raum, { lied, bis: jetzt + LIED_MS });
        const musik = musikVon(fig.raum);
        anAndere(fig, "welt:musik", { ...musik, von: fig.id });
        return ack({ ok: true, ding: d.id, ziel: { jukebox: { lied: lied.titel, musik } } });
      }
      const platz = (d.ziel.screen || d.ziel.shisha) ? amTischSetzen(fig, raum, d) : null;
      if (d.ziel.shisha && platz) shishaRunde(fig);
      ack({ ok: true, ding: d.id, ziel: d.ziel, ...(platz ? { platz } : {}) });
    });

    /* Wer einen Kartentisch benutzt, sitzt danach daran, auf dem freien
       Platz, der ihm am nächsten ist. Sind alle besetzt, bleibt er stehen;
       das Spiel öffnet sich trotzdem. Wer schon an diesem Tisch sitzt,
       bleibt, wo er ist. */
    function amTischSetzen(fig, raum, d) {
      const plaetze = (raum.sitze || []).filter((s) => s.tisch === d.id);
      if (!plaetze.length) return null;
      let sitz = plaetze.find((s) => s.id === fig.sitzt);
      if (!sitz) {
        const belegt = new Set();
        for (const f of figuren.values()) {
          if (f !== fig && f.raum === fig.raum && f.sitzt && sichtbar(f)) belegt.add(f.sitzt);
        }
        sitz = plaetze
          .filter((s) => !belegt.has(s.id))
          .sort((a, b) => Math.hypot(a.auf.x - fig.x, a.auf.y - fig.y) - Math.hypot(b.auf.x - fig.x, b.auf.y - fig.y))[0];
        if (!sitz) return null;
      }
      fig.sitzt = sitz.id; fig.x = sitz.x; fig.y = sitz.y; fig.d = sitz.d; fig.geht = false;
      fig.budget = 0; fig.t = Date.now();
      io.to(kanal(fig.raum)).emit("welt:z", [fig.id, fig.x, fig.y, fig.d, 0, sitz.id]);
      return { x: fig.x, y: fig.y, d: fig.d, s: sitz.id };
    }

    /* Sitzen mindestens drei an der Shisha, ist das eine Runde: jeder, der
       dabei ist, bekommt sie gutgeschrieben (Achievement „Shisha-Runde“). */
    function shishaRunde(fig) {
      const dabei = [...figuren.values()].filter((f) => f.raum === fig.raum && sichtbar(f) && String(f.sitzt || "").startsWith("shisha-"));
      if (dabei.length < 3) return;
      for (const f of dabei) weltFortschritt(f.key, (w) => { w.shishaRunde = w.shishaRunde || Date.now(); });
    }

    /* Schnellwahl: hin statt nur auf. Wer im Menü „Slots“ wählt, steht danach
       vor einem Automaten, und alle im Raum sehen, wo er spielt. Gesucht wird
       das Ding, das diesen Bildschirm öffnet, zuerst im eigenen Raum, nie in
       einem geheimen; ein Platz, an dem schon jemand steht, ist zweite Wahl.
       Gibt es kein solches Ding, öffnet der Client den Bildschirm wie bisher. */
    socket.on("welt:hin", ({ screen } = {}, ack) => {
      if (typeof ack !== "function") return;
      const fig = figVon(socket);
      if (!fig) return ack({ ok: false, error: "Du bist gerade nicht in der Welt." });
      const ziel = zielFuer(String(screen || ""), fig);
      if (!ziel) return ack({ ok: true, ohneOrt: true });
      const jetzt = Date.now();
      if (jetzt - (fig.hinTs || 0) < HIN_ABSTAND_MS) return ack({ ok: true, ohneOrt: true });
      fig.hinTs = jetzt;
      let umzug = null;
      if (ziel.raumId !== fig.raum) {
        umzug = umziehen(fig, ziel.raumId, { x: ziel.punkt.x, y: ziel.punkt.y, d: "hoch" }, socket);
      } else {
        fig.x = ziel.punkt.x; fig.y = ziel.punkt.y; fig.d = "hoch";
        fig.sitzt = null; fig.geht = false; fig.budget = 0; fig.t = jetzt;
        const sprung = { id: fig.id, x: fig.x, y: fig.y, d: fig.d };
        anAndere(fig, "welt:sprung", sprung);
        for (const s of fig.sockets) if (s !== socket) s.emit("welt:sprung", sprung);
      }
      const platz = amTischSetzen(fig, R.raum(fig.raum), ziel.ding);
      ack({ ok: true, ding: ziel.ding.id, umzug, pos: { x: fig.x, y: fig.y, d: fig.d, s: fig.sitzt || 0 }, ...(platz ? { platz } : {}) });
    });

    function zielFuer(screen, fig) {
      if (!/^[a-z_]{2,24}$/.test(screen)) return null;
      const passt = (d) => d.ziel && !d.geheim && (d.ziel.screen === screen || (d.ziel.auswahl || []).includes(screen));
      const raeume = [fig.raum, ...Object.keys(R.RAEUME).filter((id) => id !== fig.raum)]
        .map((id) => R.raum(id)).filter((r) => r && !r.geheim);
      let zweite = null;
      for (const raum of raeume) {
        for (const d of raum.dinge.filter(passt)) {
          const punkt = standplatz(raum, d);
          if (!punkt) continue;
          const besetzt = [...figuren.values()].some((f) => f !== fig && f.raum === raum.id && sichtbar(f)
            && Math.hypot(f.x - punkt.x, f.y - punkt.y) < 0.6);
          if (!besetzt) return { raumId: raum.id, ding: d, punkt };
          if (!zweite) zweite = { raumId: raum.id, ding: d, punkt };
        }
      }
      return zweite;
    }

    socket.on("welt:tuer", ({ tuer } = {}, ack) => {
      if (typeof ack !== "function") return;
      const fig = figVon(socket);
      if (!fig) return ack({ ok: false, error: "Du bist gerade nicht in der Welt." });
      const raum = R.raum(fig.raum);
      const t = raum.tueren.find((x) => x.id === String(tuer || ""));
      if (!t || t.versteckt || !R.raum(t.ziel)) return ack({ ok: false, error: "Diese Tür gibt es nicht." });
      const nah = R.inTuer(t, fig.x, fig.y)
        || Math.hypot(Math.max(t.x1 - fig.x, 0, fig.x - t.x2), Math.max(t.y1 - fig.y, 0, fig.y - t.y2)) <= 0.9;
      if (!nah) return ack({ ok: false, error: "Die Tür ist zu weit weg." });
      ack(umziehen(fig, t.ziel, t.ankunft, socket));
    });

    socket.on("welt:sitzen", ({ platz } = {}, ack) => {
      if (typeof ack !== "function") return;
      const fig = figVon(socket);
      if (!fig) return ack({ ok: false, error: "Du bist gerade nicht in der Welt." });
      const raum = R.raum(fig.raum);
      const sitz = (raum.sitze || []).find((s) => s.id === String(platz || ""));
      if (!sitz) return ack({ ok: false, error: "Hier kann man nicht sitzen." });
      if (Math.hypot(sitz.auf.x - fig.x, sitz.auf.y - fig.y) > 1.3) return ack({ ok: false, error: "Geh erst etwas näher heran." });
      for (const f of figuren.values()) {
        if (f !== fig && f.raum === fig.raum && f.sitzt === sitz.id && sichtbar(f)) {
          return ack({ ok: false, error: "Da sitzt schon jemand." });
        }
      }
      fig.sitzt = sitz.id; fig.x = sitz.x; fig.y = sitz.y; fig.d = sitz.d; fig.geht = false;
      fig.budget = 0; fig.t = Date.now();
      io.to(kanal(fig.raum)).emit("welt:z", [fig.id, fig.x, fig.y, fig.d, 0, sitz.id]);
      ack({ ok: true, pos: { x: fig.x, y: fig.y, d: fig.d, s: sitz.id } });
    });

    socket.on("welt:geste", ({ art } = {}, ack) => {
      const antwort = typeof ack === "function" ? ack : () => {};
      const fig = figVon(socket);
      if (!fig) return antwort({ ok: false, error: "Du bist gerade nicht in der Welt." });
      /* Stück-Gesten nur mit dem Stück in der Hand (oder am Kopf, unter dem
         Hintern, an der Leine). Geprüft gegen das Konto, nicht gegen das, was
         der Browser meint zu tragen. */
      // An der Shisha ziehen geht nur im Sitzen, dafür braucht es kein Stück.
      if (art === "shisha" && !String(fig.sitzt || "").startsWith("shisha-")) return antwort({ ok: false, error: "Erst hinsetzen." });
      const stueck = art !== "shisha" && !GESTEN.has(art) && R.STUECK_GESTEN.some((g) => g.id === art);
      if (art !== "shisha" && !GESTEN.has(art) && !stueck) return antwort({ ok: false, error: "Unbekannte Geste." });
      if (stueck) {
        const acc = accounts.get(fig.key);
        const erlaubt = R.gestenFuer(acc ? require("./kleidung").angelegt(acc) : {}).some((g) => g.id === art);
        if (!erlaubt) return antwort({ ok: false, error: "Dafür fehlt dir das passende Stück." });
      }
      const jetzt = Date.now();
      if (jetzt - fig.gesteTs < (stueck || art === "shisha" ? STUECK_GESTE_ABSTAND_MS : GESTE_ABSTAND_MS)) return antwort({ ok: false, error: "Kurz durchatmen." });
      fig.gesteTs = jetzt;
      io.to(kanal(fig.raum)).emit("welt:geste", { id: fig.id, art });
      antwort({ ok: true });
      /* Wer nachts vor dem alten Garagentor hupt, dem macht jemand auf. */
      const tor = art === "hupen" && fig.raum === "strasse" && R.raum("strasse").dinge.find((x) => x.id === "garage");
      if (tor && R.abstandZuDing(tor, fig.x, fig.y) <= 1.8 && nachts()) {
        fig.torOffenBis = jetzt + GARAGE_OFFEN_MS;
        socket.emit("welt:tor", { ding: "garage", offen: true, bis: GARAGE_OFFEN_MS,
          satz: "Hinter dem Tor scheppert es. Dann quietscht es, und es geht ein Stück weit auf." });
      }
      /* Oben auf dem Podest der Ruhmeshalle jubeln: ein Pokal. */
      const podest = art === "jubeln" && fig.raum === "ruhm" && R.raum("ruhm").dinge.find((x) => x.id === "podest");
      if (podest && R.abstandZuDing(podest, fig.x, fig.y) <= 1.2) {
        const g = geheimnisFinden(fig.key, "pokal");
        if (g && g.neu) socket.emit("welt:geheimnis", g);
      }
      /* Nachts dem Feuer auf der Terrasse zuwinken: eine Wunderkerze. */
      const feuer = art === "winken" && fig.raum === "hof" && R.raum("hof").dinge.find((x) => x.id === "feuer");
      if (feuer && R.abstandZuDing(feuer, fig.x, fig.y) <= 1.6 && nachts()) {
        const g = geheimnisFinden(fig.key, "wunderkerze");
        if (g && g.neu) socket.emit("welt:geheimnis", g);
      }
      const spiegel = fig.raum === "casino" && R.raum("casino").dinge.find((x) => x.id === "garderobe");
      if (art === "winken" && spiegel && R.abstandZuDing(spiegel, fig.x, fig.y) <= 1.4) {
        const g = geheimnisFinden(fig.key, "spiegel");
        if (g && g.neu) socket.emit("welt:geheimnis", g);
      }
    });

    /* Auf- und absteigen. Das Fahrzeug bleibt angelegt, die Figur läuft
       nur daneben her; gemerkt am Konto, damit es nach dem Neuladen so
       bleibt. Wer sitzt, steht dabei nicht auf. */
    socket.on("welt:aufsitzen", ({ an } = {}, ack) => {
      const antwort = typeof ack === "function" ? ack : () => {};
      const fig = figVon(socket);
      const acc = fig && accounts.get(fig.key);
      if (!fig || !acc) return antwort({ ok: false, error: "Du bist gerade nicht in der Welt." });
      if (!kleidung.fahrzeugVon(acc)) return antwort({ ok: false, error: "Du hast kein Fahrzeug angelegt." });
      const jetzt = Date.now();
      if (jetzt - (fig.aufsitzTs || 0) < 600) return antwort({ ok: false, error: "Langsam." });
      fig.aufsitzTs = jetzt;
      const aufsitzen = typeof an === "boolean" ? an : !!acc.zuFuss;
      acc.zuFuss = !aufsitzen;
      Object.assign(fig, kleidung.fahrtVon(acc));
      fig.budget = 0; fig.t = jetzt;
      accounts.save();
      if (sichtbar(fig)) io.to(kanal(fig.raum)).emit("welt:aussehen", oeffentlich(fig));
      const pub = accounts.publicAccount(acc);
      for (const s of fig.sockets) s.emit("account:update", { account: pub });
      for (const s of fig.sockets) s.emit("welt:fahrt", fahrtZustand(fig));
      antwort({ ok: true, ...fahrtZustand(fig) });
    });

    /* Die Grundform kostet nichts und gehört niemandem: Haut, Haare,
       Frisur, Hose. Damit sieht jede Figur vom ersten Abend an nach
       jemandem aus, bevor die erste Kiste aufgeht. */
    socket.on("welt:figur", (daten, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const fig = figuren.get(key);
      const jetzt = Date.now();
      if (fig && jetzt - fig.figurTs < 800) return ack({ ok: false, error: "Etwas langsamer." });
      if (fig) fig.figurTs = jetzt;
      acc.figur = saubereGrundform(daten);
      accounts.save();
      if (fig && sichtbar(fig)) io.to(kanal(fig.raum)).emit("welt:aussehen", oeffentlich(fig));
      // Die anderen Tabs desselben Kontos zeichnen ihre Garderobe neu.
      const pub = accounts.publicAccount(acc);
      for (const s of io.of("/").sockets.values()) {
        if (s !== socket && s.data && s.data.account === key) s.emit("account:update", { account: pub });
      }
      ack({ ok: true, figur: acc.figur });
    });

    socket.on("presence:screen", () => {
      const fig = figVon(socket);
      if (fig) meldeAktiv(fig);
    });

    /* Ein erneutes auth kommt nach jedem Umziehen in der Garderobe und nach
       einer Umbenennung. Dann zieht die Figur mit. Meldet sich der Tab als
       jemand anderes an, verlässt die alte Figur den Raum. */
    socket.on("auth", () => {
      const vorher = socket.data.weltKey;
      if (!vorher) return;
      if (socket.data.account !== vorher) { abmelden(socket); return; }
      const fig = figuren.get(vorher);
      const acc = accounts.get(vorher);
      if (fig && acc) {
        /* Wer in der Garderobe ein anderes Fahrzeug anlegt, will darauf
           sitzen und nicht erst wieder aufsteigen. */
        const neu = kleidung.fahrzeugVon(acc);
        if (neu && neu !== fig.fahrzeug) acc.zuFuss = false;
        fig.fahrzeug = neu;
        Object.assign(fig, kleidung.fahrtVon(acc));
        for (const s of fig.sockets) s.emit("welt:fahrt", fahrtZustand(fig));
      }
      if (fig && sichtbar(fig)) io.to(kanal(fig.raum)).emit("welt:aussehen", oeffentlich(fig));
    });

    /* Abmelden trennt den Socket nicht, der Tab zeigt danach die
       Anmeldung. Die Figur soll trotzdem sofort weg sein. */
    socket.on("welt:verlassen", () => abmelden(socket));

    socket.on("disconnect", () => abmelden(socket));
  });

  return { figuren };
}

/**
 * Ein Spiel meldet ein Ergebnis. Steht der Spieler in der Welt an dem Ding,
 * zu dem das Spiel gehört, sehen alle im Raum es dort: das Rad auf dem
 * Rouletttisch dreht sich und bleibt auf der gezogenen Zahl stehen. Die
 * Zahl kommt aus dem Spiel, nicht vom Browser.
 */
/** Wo die Figur von `key` gerade steht, oder null. Für Module, die eine
    Nähe prüfen müssen (Schnitzeljagd), ohne die Welt selbst zu kennen. */
function figurVon(key) {
  const f = zuschauen.figuren && zuschauen.figuren.get(String(key || "").toLowerCase());
  return f && f.sockets && f.sockets.size ? { raum: f.raum, x: f.x, y: f.y } : null;
}

function schau(socket, dingId, daten) {
  const { io, figuren, kanal } = zuschauen;
  if (!io || !socket || !socket.data) return;
  const fig = figuren.get(socket.data.account);
  if (!fig || !fig.sockets.size) return;
  const d = (R.raum(fig.raum).dinge || []).find((x) => x.id === dingId);
  if (!d || R.abstandZuDing(d, fig.x, fig.y) > R.reichweite(d) + 1.5) return;
  io.to(kanal(fig.raum)).emit("welt:schau", { id: fig.id, ding: dingId, ...daten });
}

module.exports = { setupWelt, pruefeZug, saubereGrundform, GEHEIMNISSE, schau, nachts, uhr, figurVon };
