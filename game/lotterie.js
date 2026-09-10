"use strict";

/**
 * Lotterie — vier Zahlen aus sechzehn, eine Ziehung am Tag.
 *
 * Das ist bewusst KEIN Spiel gegen das Haus, sondern eine SENKE. Die Stadt
 * war bisher die einzige Stelle, an der Chips wirklich verschwinden, und bei
 * den aktiven Spielern ist sie fast ausgereizt. Hier fliesst ein Teil jedes
 * Loses in den Topf, ein Teil geht als feste Gewinne zurueck, und der Rest
 * verlaesst die Wirtschaft.
 *
 * Und sie passt zur Runde: niemand muss gleichzeitig online sein. Los kaufen
 * wann man will, abends wird gezogen, am naechsten Tag schaut man nach.
 *
 * ── Die Zahlen ──────────────────────────────────────────────────────────
 * 4 aus 16 → C(16,4) = 1.820 Moeglichkeiten.
 *
 *   4 richtig   1 zu 1820   (0,055 %)  → Jackpot
 *   3 richtig   48 zu 1820  (2,64 %)   → 10× Lospreis
 *   2 richtig   396 zu 1820 (21,8 %)   → 1× Lospreis (Einsatz zurueck)
 *
 * Kosten je Los: 0,218·1 + 0,0264·10 = 0,481 Lospreise fuer die festen
 * Gewinne. 40 % wandern in den Jackpot. Bleiben rund 12 % als Senke.
 *
 * Der Jackpot faellt im Schnitt alle 1.820 Lose. Bei 40 % Zufluss steht er
 * dann bei etwa 1,46 Mio — eine Zahl, die sich lohnt, ohne die Wirtschaft
 * umzuwerfen (im Umlauf sind rund 6,4 Mio).
 *
 * Deckel je Spieler: 10 Lose pro Ziehung. Nicht wegen der Kosten, sondern
 * damit die Ziehung nicht dem gehoert, der am meisten Chips hat.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATEI = path.join(DATA_DIR, "lotterie.json");

const ZAHLEN_BIS = 16;      // Zahlenraum 1..16
const TIPPS = 4;            // so viele Zahlen kreuzt man an
const LOSPREIS = 2000;
const MAX_LOSE = 10;        // je Spieler und Ziehung
const JACKPOT_ANTEIL = 0.40;
const JACKPOT_START = 250_000;
/*
 * Obergrenze fuer den Topf.
 *
 * Ohne Deckel wuchs er in der Simulation auf ueber 6 Mio — so viel, wie im
 * ganzen Casino an Chips existiert. Ein einzelner Treffer wuerde damit die
 * Rangliste umschreiben. Ab hier fliesst der Anteil nicht mehr in den Topf,
 * sondern verlaesst die Wirtschaft, die Lotterie wird also nur noch strenger
 * zur Senke.
 */
const JACKPOT_MAX = 3_000_000;
const GEWINN_3 = 10;        // Vielfaches des Lospreises
const GEWINN_2 = 1;
const ZIEHUNG_STUNDE = 20;  // jeden Abend um 20 Uhr

let io = null, accounts = null;
let state = { jackpot: JACKPOT_START, lose: {}, letzte: null, naechste: 0, nr: 1 };

function naechsteZiehung(ab = Date.now()) {
  const d = new Date(ab);
  d.setHours(ZIEHUNG_STUNDE, 0, 0, 0);
  if (d.getTime() <= ab) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function load() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    state = {
      jackpot: Number(roh.jackpot) || JACKPOT_START,
      lose: roh.lose && typeof roh.lose === "object" ? roh.lose : {},
      letzte: roh.letzte || null,
      naechste: Number(roh.naechste) || 0,
      nr: Number(roh.nr) || 1,
    };
  } catch { /* erste Ziehung */ }
  if (!state.naechste || state.naechste < Date.now() - 7 * 86400000) state.naechste = naechsteZiehung();
  save();
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify(state, null, 2));
  } catch {}
}

/** Vier verschiedene Zahlen, aufsteigend. */
function ziehe() {
  const topf = Array.from({ length: ZAHLEN_BIS }, (_, i) => i + 1);
  for (let i = topf.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [topf[i], topf[j]] = [topf[j], topf[i]];
  }
  return topf.slice(0, TIPPS).sort((a, b) => a - b);
}

/** Prueft und normalisiert einen Tipp. */
function pruefeTipp(zahlen) {
  if (!Array.isArray(zahlen)) return null;
  const s = new Set();
  for (const z of zahlen) {
    const n = Math.floor(Number(z));
    if (!Number.isFinite(n) || n < 1 || n > ZAHLEN_BIS) return null;
    s.add(n);
  }
  if (s.size !== TIPPS) return null;
  return [...s].sort((a, b) => a - b);
}

const treffer = (tipp, gezogen) => tipp.filter((z) => gezogen.includes(z)).length;

/** Zufaelliger gueltiger Tipp — fuer den "Zufall"-Knopf. */
function zufallsTipp() {
  return ziehe();
}

function ziehungDurchfuehren() {
  const gezogen = ziehe();
  const gewinner = { 4: [], 3: [], 2: [] };
  let verkauft = 0;

  for (const [key, lose] of Object.entries(state.lose)) {
    for (const tipp of lose) {
      verkauft++;
      const t = treffer(tipp, gezogen);
      if (t >= 2) gewinner[t].push({ key, tipp, t });
    }
  }

  // Feste Gewinne zuerst, dann der Jackpot.
  const auszahlungen = {};
  const gib = (key, betrag) => { auszahlungen[key] = (auszahlungen[key] || 0) + betrag; };
  for (const g of gewinner[2]) gib(g.key, LOSPREIS * GEWINN_2);
  for (const g of gewinner[3]) gib(g.key, LOSPREIS * GEWINN_3);

  let jackpotAus = 0;
  if (gewinner[4].length) {
    // Mehrere Volltreffer teilen sich den Topf.
    jackpotAus = Math.floor(state.jackpot / gewinner[4].length);
    for (const g of gewinner[4]) gib(g.key, jackpotAus);
    /*
     * Danach faengt der Topf bei NULL an, nicht wieder bei JACKPOT_START.
     * Sonst waeren die 250.000 bei jedem Treffer frisch erzeugtes Geld, und
     * aus der Senke wuerde eine Quelle: in der Simulation stieg die
     * Rueckzahlquote dadurch von 88 auf 94 %. Der Startbetrag ist ein
     * einmaliges Geschenk zur Eroeffnung, kein Dauerauftrag.
     */
    state.jackpot = 0;
  }

  for (const [key, betrag] of Object.entries(auszahlungen)) {
    if (betrag > 0 && accounts) accounts.adjustChips(key, betrag);
  }
  // Zaehler fuer die Achievements "Drei Richtige" und "Der Jackpot".
  if (accounts) {
    const merke = (key, feld) => {
      const acc = accounts.get(key);
      if (!acc) return;
      acc.lotto = acc.lotto || {};
      acc.lotto[feld] = (acc.lotto[feld] || 0) + 1;
    };
    for (const g of gewinner[3]) merke(g.key, "drei");
    for (const g of gewinner[4]) merke(g.key, "jackpot");
    if (gewinner[3].length || gewinner[4].length) accounts.save();
  }

  const namen = (liste) => liste.map((g) => {
    const a = accounts && accounts.get(g.key);
    return (a && a.name) || g.key;
  });

  state.letzte = {
    nr: state.nr, at: Date.now(), gezogen, verkauft,
    jackpotAus, jackpotWar: jackpotAus ? jackpotAus * gewinner[4].length : state.jackpot,
    gewinner: {
      4: namen(gewinner[4]),
      3: namen(gewinner[3]),
      2: gewinner[2].length,
    },
  };
  state.nr += 1;
  state.lose = {};
  state.naechste = naechsteZiehung();
  save();

  if (io) {
    const zahlenText = gezogen.join(" · ");
    let text = `🎟️ LOTTERIE, Ziehung ${state.letzte.nr}: ${zahlenText}`;
    if (gewinner[4].length) {
      text += ` — JACKPOT! ${namen(gewinner[4]).join(", ")} ${gewinner[4].length > 1 ? "teilen sich" : "gewinnt"} ${jackpotAus.toLocaleString("de-DE")} Chips!`;
    } else if (gewinner[3].length) {
      text += ` — 3 Richtige für ${namen(gewinner[3]).join(", ")}. Jackpot wächst auf ${state.jackpot.toLocaleString("de-DE")}.`;
    } else {
      text += ` — kein großer Treffer. Jackpot steht bei ${state.jackpot.toLocaleString("de-DE")}.`;
    }
    try { require("./chat").announce(io, text); } catch {}
    try { require("./feed").add("event", text.replace("🎟️ ", "")); } catch {}
    try {
      require("./push").anAlle("live", {
        title: gewinner[4].length ? "🎟️ Der Lotterie-Jackpot ist gefallen!" : "🎟️ Lotterie gezogen",
        body: `Zahlen: ${zahlenText}. Schau nach, ob du dabei warst.`,
        url: "/",
      });
    } catch {}
    io.emit("lotterie:update", oeffentlich(null));
  }
}

function oeffentlich(key) {
  const meine = (key && state.lose[key]) || [];
  return {
    ok: true,
    jackpot: state.jackpot,
    jackpotMax: JACKPOT_MAX,
    naechste: state.naechste,
    nr: state.nr,
    lospreis: LOSPREIS,
    zahlenBis: ZAHLEN_BIS,
    tipps: TIPPS,
    maxLose: MAX_LOSE,
    gewinn3: LOSPREIS * GEWINN_3,
    gewinn2: LOSPREIS * GEWINN_2,
    meineLose: meine.map((t) => t.slice()),
    verkauft: Object.values(state.lose).reduce((s, l) => s + l.length, 0),
    mitspieler: Object.keys(state.lose).length,
    letzte: state.letzte,
  };
}

/**
 * Ein geschenktes Los (Glücksrad).
 *
 * Laeuft absichtlich wie ein normaler Kauf, nur ohne Abbuchung: der Anteil
 * fuer den Jackpot wandert trotzdem in den Topf, bezahlt vom Haus. Sonst
 * wuerde ein Gratis-Los aus dem Topf gewinnen, ohne je etwas eingezahlt zu
 * haben, und die Ziehung waere fuer alle anderen schlechter.
 *
 * Der Tipp wird gewuerfelt. Selbst aussuchen waere schoener, hiesse aber, das
 * Rad muesste mitten im Drehen ein Formular aufmachen.
 */
function schenkeLos(key, anzahl = 1) {
  if (!key) return { ok: false, tipps: [] };
  const meine = state.lose[key] || [];
  const tipps = [];
  for (let i = 0; i < anzahl; i++) {
    if (meine.length + tipps.length >= MAX_LOSE) break;
    let t = null;
    // Doppelte Tipps sind erlaubt, aber sinnlos: dann lieber neu wuerfeln.
    for (let versuch = 0; versuch < 20; versuch++) {
      const kandidat = zufallsTipp();
      const schon = meine.concat(tipps).some((x) => x.join() === kandidat.join());
      if (!schon) { t = kandidat; break; }
    }
    if (!t) break;
    tipps.push(t);
    state.jackpot = Math.min(JACKPOT_MAX, state.jackpot + Math.floor(LOSPREIS * JACKPOT_ANTEIL));
  }
  if (!tipps.length) return { ok: false, tipps: [], voll: true };
  state.lose[key] = meine.concat(tipps);
  save();
  if (io) io.emit("lotterie:update", oeffentlich(null));
  return { ok: true, tipps, naechste: state.naechste };
}

function setupLotterie(_io, _accounts) {
  io = _io; accounts = _accounts;
  load();

  // Minuetlich prueft der Server, ob die Ziehung faellig ist. Ein Neustart
  // mitten in der Nacht holt sie damit beim naechsten Tick nach, statt sie
  // ganz ausfallen zu lassen.
  setInterval(() => {
    if (Date.now() >= state.naechste) ziehungDurchfuehren();
  }, 60_000).unref();

  io.on("connection", (socket) => {
    socket.on("lotterie:state", (ack) => {
      if (typeof ack === "function") ack(oeffentlich(socket.data.account || null));
    });

    socket.on("lotterie:zufall", (ack) => {
      if (typeof ack === "function") ack({ ok: true, tipp: zufallsTipp() });
    });

    socket.on("lotterie:kaufen", ({ zahlen } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key) return ack({ ok: false, error: "Nicht eingeloggt." });
      const a = accounts.get(key);
      if (!a) return ack({ ok: false, error: "Nicht eingeloggt." });

      const tipp = pruefeTipp(zahlen);
      if (!tipp) return ack({ ok: false, error: `Genau ${TIPPS} verschiedene Zahlen von 1 bis ${ZAHLEN_BIS}.` });

      const meine = state.lose[key] || [];
      if (meine.length >= MAX_LOSE) return ack({ ok: false, error: `Höchstens ${MAX_LOSE} Lose pro Ziehung.` });
      // Denselben Tipp zweimal zu kaufen ist erlaubt, aber selten gewollt.
      if (meine.some((t) => t.join() === tipp.join())) return ack({ ok: false, error: "Diesen Tipp hast du schon." });
      if (a.chips < LOSPREIS) return ack({ ok: false, error: "Nicht genug Chips." });

      const abzug = accounts.adjustChips(key, -LOSPREIS);
      if (!abzug.ok) return ack({ ok: false, error: abzug.error });

      state.jackpot = Math.min(JACKPOT_MAX, state.jackpot + Math.floor(LOSPREIS * JACKPOT_ANTEIL));
      state.lose[key] = meine.concat([tipp]);
      save();

      ack({ ok: true, tipp, account: abzug.account, ...oeffentlich(key) });
      io.emit("lotterie:update", oeffentlich(null));
    });
  });
}

module.exports = {
  setupLotterie,
  // Der Tagesbericht zeigt Jackpot, naechste Ziehung und ob man Lose hat.
  oeffentlich,
  schenkeLos,
  _intern: { ziehe, pruefeTipp, treffer, naechsteZiehung, LOSPREIS, ZAHLEN_BIS, TIPPS, MAX_LOSE, JACKPOT_ANTEIL, JACKPOT_MAX, GEWINN_3, GEWINN_2 },
};
