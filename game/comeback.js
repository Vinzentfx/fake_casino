"use strict";

/**
 * Wiedereroeffnung.
 *
 * Das Casino war zwei Monate weg, weil die Seite lag — nicht, weil jemand
 * aufgehoert hat. Alle einundsiebzig Konten kommen also gleichzeitig zurueck,
 * in ein Spiel, das inzwischen fast ueberall anders aussieht.
 *
 * Dieses Modul macht daraus einen Moment statt eines stillen Neustarts:
 *
 *   GESCHENK  Ein einmaliges Paket je Konto, abholbar solange das Fenster
 *             offen ist. Chips laufen durch die Vermoegensbremse — es ist
 *             Gratisgeld, und der Median liegt bei 25.000, waehrend die
 *             Spitze das Siebzigfache hat. Dazu zwei Kosmetik-Stuecke, die
 *             es danach nie wieder gibt: nur wer zur Wiedereroeffnung da war,
 *             traegt den Titel.
 *
 *   GALA      Ein Zeitfenster, in dem doppelte Season-XP laufen und am Ende
 *             ein Topf unter allen verlost wird, die dabei mitgespielt haben,
 *             gewichtet nach Runden. Das ist der Grund, JETZT zu kommen und
 *             nicht irgendwann.
 *
 * Beides startet der Besitzer von Hand. Ein Fest, das von selbst losgeht,
 * waehrend niemand hinschaut, ist kein Fest.
 *
 * Stand in data/comeback.json.
 */

const path = require("path");
const fs = require("fs");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "comeback.json");

// Wie lange das Geschenk abholbar bleibt. Lang genug, dass auch jemand, der
// erst am naechsten Wochenende reinschaut, es noch bekommt.
const GESCHENK_TAGE = 14;
/*
 * 150.000. Das ist bewusst viel: der Median liegt bei 25.000, das Paket ist
 * also fuer die meisten das Sechsfache ihres Guthabens. Genau das ist der
 * Zweck — es soll ein Ereignis sein, kein Trostpflaster.
 *
 * Wirkung auf die Wirtschaft: rund 8 Mio neu bei 8,6 Mio im Umlauf. Weil es
 * ALLE bekommen und die Vermoegensbremse die Spitze kuerzt, verschiebt es die
 * Rangfolge kaum, drueckt aber den Abstand zwischen Mitte und Spitze deutlich
 * zusammen — ein weicher Neuanfang, ohne jemandem etwas wegzunehmen.
 */
const GESCHENK_CHIPS = 150000;
const GESCHENK_XP = 250;

// Gala: Dauer und Topf werden beim Start gesetzt, das hier sind die Grenzen.
const GALA_MIN_MINUTEN = 15, GALA_MAX_MINUTEN = 480;
const GALA_MIN_TOPF = 1000, GALA_MAX_TOPF = 2_000_000;
const GALA_XP_FAKTOR = 2;

let _io = null, _accounts = null;
let state = load();

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (s && typeof s === "object") {
      return {
        geschenkBis: s.geschenkBis || 0,
        gala: s.gala || null,          // { endsAt, topf, runden: { key: n } }
        gestartetAt: s.gestartetAt || 0,
      };
    }
  } catch {}
  return { geschenkBis: 0, gala: null, gestartetAt: 0 };
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}

const geschenkOffen = () => state.geschenkBis > Date.now();
const galaLaeuft = () => !!(state.gala && state.gala.endsAt > Date.now());

/** Faktor auf Season-XP, solange die Gala laeuft. season.js fragt das ab. */
const xpFaktor = () => (galaLaeuft() ? GALA_XP_FAKTOR : 1);

/**
 * Runden waehrend der Gala mitzaehlen. Gewichtet die Verlosung: wer mehr
 * gespielt hat, hat mehr Lose — aber jeder, der ueberhaupt da war, hat eine
 * Chance. Reine Anwesenheit reicht nicht, reines Vermoegen zaehlt gar nicht.
 */
function zaehleRunde(key) {
  if (!galaLaeuft() || !key) return;
  state.gala.runden = state.gala.runden || {};
  state.gala.runden[key] = (state.gala.runden[key] || 0) + 1;
  speichereBald();
}

/*
 * Die Lose lagen nur im Speicher: ein Neustart waehrend der Gala haette alle
 * gespielten Runden geloescht und den Topf an niemanden verlost. Gespeichert
 * wird gebuendelt, weil sonst jede einzelne Runde eine Datei schreibt.
 */
let sparTimer = null;
function speichereBald() {
  if (sparTimer) return;
  sparTimer = setTimeout(() => { sparTimer = null; save(); }, 5000);
  if (sparTimer.unref) sparTimer.unref();
}

/*
 * Was im Paket steckt, an EINER Stelle.
 *
 * Zweimal gebraucht: die Lobby-Karte nennt es vor dem Abholen (sonst kauft
 * niemand eine Katze im Sack), die Auspack-Animation zeigt jedes Stueck
 * danach als eigene Karte. Dafuer reicht ein Name nicht, es braucht Icon
 * und einen Satz dazu, wo das Stueck hingehoert.
 */
function paketStuecke() {
  const cos = require("./cosmetics");
  return [
    { art: "title", id: "rueckkehrer", icon: "🏷️", label: cos.label("title", "rueckkehrer"),
      text: "Titel unter deinem Namen, überall wo du auftauchst." },
    { art: "effect", id: "salut", icon: "🎆", label: cos.label("effect", "salut"),
      text: "Gewinn-Effekt: Konfettikanonen von beiden Seiten." },
  ];
}

/** Das Paket fuer einen Spieler abholen. */
function holeGeschenk(key) {
  if (!geschenkOffen()) return { ok: false, error: "Das Fenster ist zu." };
  const acc = _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  if (acc.comebackGeholt) return { ok: false, error: "Schon abgeholt." };

  const faktor = _accounts.faucetFactor(acc.name);
  const chips = Math.round(GESCHENK_CHIPS * faktor);
  acc.comebackGeholt = Date.now();
  _accounts.adjustChips(key, chips);

  const cos = require("./cosmetics");
  cos.grant(acc, "title", "rueckkehrer");
  cos.grant(acc, "effect", "salut");
  const stuecke = paketStuecke();

  let xp = 0;
  try { xp = require("./season").addXp(key, GESCHENK_XP, "quest") || GESCHENK_XP; } catch {}
  _accounts.save();

  if (_io) {
    try { chat.announce(_io, `🎉 ${acc.name} ist zurück im Casino!`); } catch {}
  }
  return { ok: true, chips, xp: GESCHENK_XP, stuecke, account: _accounts.publicAccount(acc) };
}

/** Was der Client zum Anzeigen braucht. */
function publicState(key) {
  const acc = key && _accounts ? _accounts.get(key) : null;
  return {
    ok: true,
    geschenkOffen: geschenkOffen(),
    geschenkBis: state.geschenkBis,
    geholt: !!(acc && acc.comebackGeholt),
    chips: acc ? Math.round(GESCHENK_CHIPS * _accounts.faucetFactor(acc.name)) : GESCHENK_CHIPS,
    xp: GESCHENK_XP,
    paket: paketStuecke(),
    gala: galaLaeuft()
      ? {
          endsAt: state.gala.endsAt,
          topf: state.gala.topf,
          xpFaktor: GALA_XP_FAKTOR,
          meineRunden: acc ? (state.gala.runden || {})[key] || 0 : 0,
          spieler: Object.keys(state.gala.runden || {}).length,
        }
      : null,
  };
}

function sende() {
  if (_io) _io.emit("comeback:update");
}

/** Die Wiedereroeffnung ausrufen. Nur der Besitzer, nur von Hand. */
function starte({ galaMinuten, topf } = {}) {
  const min = Math.max(GALA_MIN_MINUTEN, Math.min(GALA_MAX_MINUTEN, Math.floor(galaMinuten) || 120));
  const pot = Math.max(GALA_MIN_TOPF, Math.min(GALA_MAX_TOPF, Math.floor(topf) || 250000));
  state.geschenkBis = Date.now() + GESCHENK_TAGE * 86400000;
  state.gala = { endsAt: Date.now() + min * 60000, topf: pot, runden: {} };
  state.gestartetAt = Date.now();
  save();

  if (_io) {
    try {
      chat.announce(_io, `🎊 WIEDERERÖFFNUNG! Das Casino ist zurück. Holt euch euer Willkommens-Paket, und für die nächsten ${min} Minuten läuft die Eröffnungsgala: doppelte Season-XP und am Ende werden ${pot.toLocaleString("de-DE")} 🪙 unter allen verlost, die mitgespielt haben.`);
    } catch {}
    try {
      require("./push").anAlle("live", {
        title: "🎊 Das Casino hat wieder auf",
        body: `Wiedereröffnung: Willkommens-Paket abholen, ${min} Minuten Gala mit doppelter Season-XP und ${pot.toLocaleString("de-DE")} 🪙 im Topf.`,
        url: "/",
      });
    } catch {}
    try { require("./feed").add("event", `Wiedereröffnung! Gala läuft ${min} Minuten, ${pot.toLocaleString("de-DE")} 🪙 im Topf.`); } catch {}
  }
  sende();
  return { ok: true, minuten: min, topf: pot };
}

/** Gala vorzeitig beenden (und damit sofort abrechnen). */
function stoppeGala() {
  if (!state.gala) return { ok: false, error: "Es läuft keine Gala." };
  rechneGalaAb();
  return { ok: true };
}

/**
 * Verlosung. Lose nach Runden, aber gedeckelt: sonst gewinnt zwangslaeufig,
 * wer am schnellsten klicken kann, und aus einem Fest wird eine Klickorgie.
 */
const MAX_LOSE = 40;
function rechneGalaAb() {
  const g = state.gala;
  state.gala = null;
  if (sparTimer) { clearTimeout(sparTimer); sparTimer = null; }
  save();
  if (!g) return;

  const lose = [];
  for (const [key, n] of Object.entries(g.runden || {})) {
    const anzahl = Math.min(MAX_LOSE, Math.max(1, n));
    for (let i = 0; i < anzahl; i++) lose.push(key);
  }
  if (!lose.length) {
    if (_io) chat.announce(_io, "🎊 Eröffnungsgala vorbei — es hat niemand mitgespielt, der Topf bleibt im Haus.");
    sende();
    return;
  }
  const gewinner = lose[Math.floor(Math.random() * lose.length)];
  const acc = _accounts.get(gewinner);
  _accounts.adjustChips(gewinner, g.topf);
  const teilnehmer = Object.keys(g.runden).length;
  if (_io) {
    try {
      chat.announce(_io, `🎊 Eröffnungsgala vorbei! ${teilnehmer} ${teilnehmer === 1 ? "Spieler war" : "Spieler waren"} dabei, gewonnen hat ${acc ? acc.name : gewinner} und nimmt ${g.topf.toLocaleString("de-DE")} 🪙 mit.`);
    } catch {}
    try { require("./feed").add("event", `${acc ? acc.name : gewinner} gewinnt die Eröffnungs-Verlosung: ${g.topf.toLocaleString("de-DE")} 🪙.`); } catch {}
    try {
      require("./push").an(gewinner, "live", {
        title: "🎊 Du hast die Eröffnungs-Verlosung gewonnen",
        body: `${g.topf.toLocaleString("de-DE")} 🪙 sind auf deinem Konto.`,
        url: "/",
      });
    } catch {}
  }
  sende();
}

function setup(io, accounts) {
  _io = io;
  _accounts = accounts;

  // Jede abgerechnete Runde zaehlt fuer die Verlosung.
  accounts.onHand((name) => {
    try { zaehleRunde(String(name).trim().toLowerCase()); } catch {}
  });

  setInterval(() => {
    if (state.gala && state.gala.endsAt <= Date.now()) rechneGalaAb();
  }, 15000).unref();

  io.on("connection", (socket) => {
    socket.on("comeback:state", (ack) => {
      if (typeof ack !== "function") return;
      ack(publicState(socket.data.account || null));
    });

    socket.on("comeback:claim", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = holeGeschenk(socket.data.account);
      if (r.ok) sende();
      ack(r);
    });
  });
}

module.exports = { setup, starte, stoppeGala, publicState, xpFaktor, geschenkOffen, galaLaeuft };
