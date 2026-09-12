"use strict";

/**
 * Auktionshaus, die einzige Stelle, an der es die seltenen Stuecke gibt.
 *
 * Der Laden verkauft zu festen Preisen, der Season-Pass verteilt nach
 * Fortschritt, das Glueckrad nach Glueck. Hier entscheidet, wer am meisten
 * dafuer uebrig hat. Ein Los zur Zeit, und was geboten wird, VERBRENNT: es
 * geht an niemanden. Genau das ist der Zweck, dem Casino fehlen Senken.
 *
 * Zwei Regeln machen das fuer eine Runde, die sich nie gleichzeitig trifft,
 * ueberhaupt erst fair:
 *
 *   Verlaengerung. Jedes Gebot in den letzten zwei Minuten schiebt das Ende um
 *   zwei Minuten nach hinten. Ohne das gewinnt immer, wer zufaellig in der
 *   Schlusssekunde online ist, und das ist keine Auktion, sondern eine
 *   Anwesenheitspraemie.
 *
 *   Ein Los aussetzen nach einem Zuschlag. Wer gewinnt, darf beim naechsten
 *   Los nicht mitbieten, ab dem darauf wieder. Eine ganze Woche Pause stand
 *   hier vorher und war zu viel: bei einem Los am Tag hiess das, dass ein
 *   Sieger sieben Stuecke nicht einmal anschauen durfte.
 *
 * Geboten wird mit echten Chips: der Betrag geht sofort vom Konto und kommt
 * sofort zurueck, sobald jemand ueberbietet. Ohne diese Hinterlegung bietet
 * man Geld, das man nach der naechsten Slot-Runde nicht mehr hat.
 *
 * Stand in data/auktion.json.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const chat = require("./chat");
const strafen = require("./strafen");
const cosmetics = require("./cosmetics");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATEI = path.join(DATA_DIR, "auktion.json");

const START_GEBOT = 50_000;
const SCHRITT_MIN = 5_000;
const SCHRITT_ANTEIL = 0.05;
const ENDE_STUNDE = 20, ENDE_MINUTE = 30;  // eine halbe Stunde nach der Lotterie
const MIN_LAUFZEIT_MS = 24 * 60 * 60 * 1000;
const VERLAENGERUNG_MS = 2 * 60 * 1000;
/*
 * Nach einem Zuschlag setzt man EIN Los aus, nicht eine Woche.
 *
 * Die Wochensperre sollte verhindern, dass die zwei groessten Konten alles
 * abraeumen. Sie hat aber auch verhindert, dass ueberhaupt jemand zweimal
 * mitbietet: bei neun Losen und einem Los alle ein bis zwei Tage war ein
 * Gewinner fuer die halbe Sammlung raus. Ein Los auszusetzen reicht, damit
 * nicht derselbe zweimal hintereinander zuschlaegt, und laesst danach jeden
 * wieder ran.
 *
 * Gemerkt wird die NUMMER des gewonnenen Loses, nicht die Uhrzeit: die Lose
 * wechseln nach Zeitplan, und "ein Los aussetzen" ist damit unabhaengig davon,
 * wie lange ein Los lief.
 */
const VERLAUF_MAX = 12;
const ARCHIV_MAX = 20;

/* Welche Arten ueberhaupt versteigert werden. Ein Los ist immer ein Stueck aus
   game/cosmetics.js mit limitiert: "auktion". Hier steht nur, in welchen
   Toepfen gesucht wird. */
const ARTEN = ["style", "frame", "title", "effect", "banner", "schild", "aura", "karte"];

let io = null, accounts = null;
let state = { v: 1, nr: 0, los: null, vergeben: {}, archiv: [] };

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");
const marke = (type, id) => `${type}:${id}`;

function load() {
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    state = {
      v: 1,
      nr: Number(roh.nr) || 0,
      los: roh.los || null,
      vergeben: roh.vergeben && typeof roh.vergeben === "object" ? roh.vergeben : {},
      archiv: Array.isArray(roh.archiv) ? roh.archiv : [],
    };
  } catch { /* erste Auktion */ }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATEI, JSON.stringify(state, null, 2));
  } catch {}
}

/** Das naechste 20:30, das mindestens einen Tag entfernt ist. */
function naechstesEnde(ab = Date.now()) {
  const d = new Date(ab + MIN_LAUFZEIT_MS);
  d.setHours(ENDE_STUNDE, ENDE_MINUTE, 0, 0);
  if (d.getTime() <= ab + MIN_LAUFZEIT_MS) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Alle Auktionsstuecke, die noch niemandem gehoeren. */
function offeneStuecke() {
  const out = [];
  for (const type of ARTEN) {
    const liste = {
      style: cosmetics.STYLES, frame: cosmetics.FRAMES, title: cosmetics.TITLES,
      effect: cosmetics.EFFEKTE, banner: cosmetics.BANNER, schild: cosmetics.SCHILDER,
      aura: cosmetics.AUREN, karte: cosmetics.KARTEN,
    }[type] || [];
    for (const x of liste) {
      if (x.limitiert !== "auktion") continue;
      if (state.vergeben[marke(type, x.id)]) continue;
      out.push({ type, id: x.id, label: x.label || x.text || x.id });
    }
  }
  return out;
}

const ART_NAME = {
  style: "Namensstil", frame: "Rahmen", title: "Titel", effect: "Gewinn-Effekt",
  banner: "Profil-Banner", schild: "Namensschild", aura: "Aura", karte: "Kartenrücken",
};

/** Setzt dieser Spieler das laufende Los aus? Genau das eine nach seinem Sieg. */
function gesperrtFuer(acc, los) {
  if (!acc || !los) return false;
  const gewonnen = Number(acc.auktionSiegLos) || 0;
  return gewonnen > 0 && los.nr === gewonnen + 1;
}

/** Der Mindestbetrag fuer das naechste Gebot. */
function mindestGebot(los) {
  if (!los) return START_GEBOT;
  if (!los.gebot) return START_GEBOT;
  return los.gebot + Math.max(SCHRITT_MIN, Math.ceil(los.gebot * SCHRITT_ANTEIL / 1000) * 1000);
}

function starteLos() {
  const offen = offeneStuecke();
  if (!offen.length) {
    // Alles vergeben. Auch das muss bei allen ankommen, sonst zeigt der
    // Bildschirm weiter das Los, das gerade den Hammer bekommen hat.
    state.los = null;
    save();
    sende();
    return null;
  }
  const s = offen[crypto.randomInt(offen.length)];
  state.nr += 1;
  state.los = {
    nr: state.nr,
    type: s.type,
    id: s.id,
    label: s.label,
    art: ART_NAME[s.type] || s.type,
    start: Date.now(),
    endet: naechstesEnde(),
    gebot: 0,
    bieter: null,
    bieterName: null,
    verlauf: [],
  };
  save();
  try {
    chat.announce(io, `Auktionshaus: ${ART_NAME[s.type]} „${s.label}“ kommt unter den Hammer. Startgebot ${de(START_GEBOT)} Chips, Zuschlag ${endeText(state.los.endet)}.`);
  } catch {}
  try { require("./chronik").notiere("event", `Neu im Auktionshaus: ${ART_NAME[s.type]} „${s.label}“. Startgebot ${de(START_GEBOT)} Chips.`); } catch {}
  sende();
  return state.los;
}

function endeText(ts) {
  const d = new Date(ts);
  const heute = new Date();
  const gleich = d.toDateString() === heute.toDateString();
  const morgen = new Date(heute.getTime() + 86400000).toDateString() === d.toDateString();
  const uhr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} Uhr`;
  if (gleich) return `heute um ${uhr}`;
  if (morgen) return `morgen um ${uhr}`;
  return `am ${d.toLocaleDateString("de-DE", { weekday: "long" })} um ${uhr}`;
}

/** Zuschlag: Stueck vergeben, Gebot verbrennen, neues Los aufmachen. */
function hammer() {
  const los = state.los;
  if (!los) return;

  if (!los.bieter || !los.gebot) {
    // Niemand hat geboten. Das Stueck wandert zurueck in den Topf und kommt
    // spaeter wieder, weggeworfen wird hier nichts.
    try { chat.announce(io, `Keine Gebote für „${los.label}“. Das Stück kommt später noch einmal.`); } catch {}
    state.los = null;
    save();
    starteLos();
    return;
  }

  const acc = accounts.get(los.bieter);
  const stuecke = [];
  if (acc) {
    if (cosmetics.grant(acc, los.type, los.id)) stuecke.push(los.label);
    acc.auktionSieg = Date.now();
    acc.auktionSiegLos = los.nr;
    accounts.save();
  }
  // Das Gebot ist beim Bieten abgebucht worden und wird hier nicht
  // weitergereicht: es verbrennt. Das ist der ganze Zweck des Hauses.
  state.vergeben[marke(los.type, los.id)] = {
    key: los.bieter, name: los.bieterName, betrag: los.gebot, ts: Date.now(),
  };
  state.archiv.unshift({
    nr: los.nr, art: los.art, label: los.label,
    name: los.bieterName, betrag: los.gebot, ts: Date.now(),
  });
  if (state.archiv.length > ARCHIV_MAX) state.archiv.length = ARCHIV_MAX;

  try {
    chat.announce(io, `Zuschlag: ${los.bieterName} ersteigert ${los.art} „${los.label}“ für ${de(los.gebot)} Chips.`);
  } catch {}
  try {
    require("./chronik").notiere("event", `${los.bieterName} ersteigert ${los.art} „${los.label}“ für ${de(los.gebot)} Chips.`, { user: los.bieterName, wert: los.gebot });
  } catch {}
  if (acc) {
    for (const s of io.of("/").sockets.values()) {
      if (s.data && s.data.account === los.bieter) {
        s.emit("auktion:zuschlag", { art: los.art, label: los.label, betrag: los.gebot, stuecke });
        /* Das hinterlegte Gebot ist jetzt endgueltig weg. Ohne diese Zeile
           steht in der Topbar weiter der Stand von vor dem Gebot, weil der
           Zuschlag nicht vom Client ausgeloest wurde. */
        s.emit("account:update", { account: accounts.publicAccount(acc) });
        break;
      }
    }
  }
  state.los = null;
  save();
  starteLos();
}

function bieten(key, betrag) {
  const los = state.los;
  if (!los) return { ok: false, error: "Zurzeit steht nichts unter dem Hammer." };
  const acc = accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  if (Date.now() >= los.endet) return { ok: false, error: "Zu spät, der Zuschlag ist durch." };

  const verbot = strafen.aktiv(acc, "keineAuktion");
  if (verbot) {
    return { ok: false, error: `Du darfst gerade nicht mitbieten (${strafen.restText(verbot)})${verbot.grund ? `: ${verbot.grund}` : "."}` };
  }
  if (gesperrtFuer(acc, los)) {
    return { ok: false, error: "Du hast das letzte Los gewonnen. Dieses eine setzt du aus, ab dem nächsten bist du wieder dabei." };
  }
  if (los.bieter === key) return { ok: false, error: "Du hältst das Höchstgebot bereits." };

  betrag = Math.floor(Number(betrag) || 0);
  const mind = mindestGebot(los);
  if (betrag < mind) return { ok: false, error: `Mindestens ${de(mind)} Chips.` };
  if (acc.chips < betrag) return { ok: false, error: "Nicht genug Chips." };

  // Erst dem Vorbieter zurueckgeben, dann beim neuen abbuchen. Andersherum
  // koennte bei einem Absturz dazwischen zweimal dasselbe Geld hinterlegt sein.
  const vorher = los.bieter, vorherName = los.bieterName, vorherBetrag = los.gebot;
  if (vorher && vorherBetrag > 0) accounts.adjustChips(vorher, vorherBetrag);
  const ab = accounts.adjustChips(key, -betrag);
  if (!ab.ok) {
    // Zurueckrollen: der Vorbieter haelt sein Gebot weiter.
    if (vorher && vorherBetrag > 0) accounts.adjustChips(vorher, -vorherBetrag);
    return { ok: false, error: ab.error || "Chips konnten nicht hinterlegt werden." };
  }

  los.gebot = betrag;
  los.bieter = key;
  los.bieterName = acc.name;
  los.verlauf.unshift({ key, name: acc.name, betrag, ts: Date.now() });
  if (los.verlauf.length > VERLAUF_MAX) los.verlauf.length = VERLAUF_MAX;

  /* Verlaengerung. Steht bewusst nach dem Gebot: sonst koennte man mit einem
     ungueltigen Gebot die Uhr weiterschieben. */
  let verlaengert = false;
  if (los.endet - Date.now() < VERLAENGERUNG_MS) {
    los.endet = Date.now() + VERLAENGERUNG_MS;
    verlaengert = true;
  }
  save();

  if (!vorher) {
    try { chat.announce(io, `Erstes Gebot für „${los.label}“: ${acc.name} bietet ${de(betrag)} Chips.`); } catch {}
  }

  if (vorher && vorher !== key) {
    const vorKonto = accounts.get(vorher);
    if (vorKonto) { vorKonto.auktionUeberboten = true; accounts.save(); }
    /* Auch in den Chat. In einer Runde, die versetzt spielt, ist ein
       Bietgefecht das Spannendste, was gerade passiert, und wer es erst am
       naechsten Tag erfaehrt, haette mitgeboten. Der Mindestschritt sorgt
       dafuer, dass daraus keine Maschinengewehr-Salve wird. */
    try {
      chat.announce(io, `${acc.name} überbietet ${vorherName} bei „${los.label}“: ${de(betrag)} Chips.`);
    } catch {}
    // Der Ueberbotene ist fast immer gerade nicht da, genau darum lohnt sich
    // hier eine Nachricht aufs Geraet.
    try {
      require("./push").an(vorher, "auktion", {
        title: `Überboten: ${los.label}`,
        body: `${acc.name} bietet jetzt ${de(betrag)} Chips. Deine ${de(vorherBetrag)} sind zurück auf dem Konto.`,
        url: "/#/auktion",
      });
    } catch {}
    const vorAcc = accounts.get(vorher);
    for (const s of io.of("/").sockets.values()) {
      if (s.data && s.data.account === vorher) {
        s.emit("auktion:ueberboten", { label: los.label, betrag, zurueck: vorherBetrag, von: acc.name });
        // Dasselbe von der anderen Seite: die Rueckzahlung kommt vom Server,
        // nicht auf Zuruf des Clients.
        if (vorAcc) s.emit("account:update", { account: accounts.publicAccount(vorAcc) });
        break;
      }
    }
  }
  sende();
  return { ok: true, verlaengert, account: accounts.publicAccount(acc), ...oeffentlich(key) };
}

/**
 * Was noch kommt.
 *
 * Absichtlich offen: wer sieht, dass die Aura noch aussteht, kommt wieder und
 * spart darauf hin. Eine Ueberraschung waere hier keine, weil es nur neun
 * Stuecke gibt und man sie im Laden ohnehin alle sieht.
 */
function kommendes(los) {
  return offeneStuecke()
    .filter((s) => !los || !(s.type === los.type && s.id === los.id))
    .map((s) => ({ type: s.type, id: s.id, label: s.label, art: ART_NAME[s.type] || s.type }));
}

/**
 * Die persoenliche Marke fuers Menue: rot, wenn etwas ansteht.
 *
 * Zwei Anlaesse, beide mit Frist: ein Los, das man noch nie gesehen hat, und
 * ein Gebot, das ueberboten wurde. Beides verschwindet, sobald man das
 * Auktionshaus aufmacht, deshalb steht der Merker am Konto und nicht im
 * localStorage: Safari raeumt den nach sieben Tagen weg, und wer so lange weg
 * war, soll die Marke ja gerade sehen.
 */
function menueMarke(key) {
  const acc = key ? accounts.get(key) : null;
  if (!acc) return { neu: false, ueberboten: false, an: false };
  const neu = !!(state.los && state.los.nr > (acc.auktionGesehen || 0));
  const ueberboten = !!acc.auktionUeberboten;
  return { neu, ueberboten, an: neu || ueberboten };
}

/** Merkt, dass jemand hingesehen hat. Loescht beide Anlaesse. */
function gesehen(key) {
  const acc = key ? accounts.get(key) : null;
  if (!acc) return;
  let geaendert = false;
  if (state.los && (acc.auktionGesehen || 0) !== state.los.nr) { acc.auktionGesehen = state.los.nr; geaendert = true; }
  if (acc.auktionUeberboten) { delete acc.auktionUeberboten; geaendert = true; }
  if (geaendert) accounts.save();
}

function oeffentlich(key) {
  const los = state.los;
  const acc = key ? accounts.get(key) : null;
  const gesperrt = !!(acc && los && gesperrtFuer(acc, los));
  return {
    los: los ? {
      nr: los.nr, art: los.art, label: los.label, type: los.type, id: los.id,
      start: los.start, endet: los.endet, gebot: los.gebot,
      bieterName: los.bieterName,
      binIch: !!(key && los.bieter === key),
      // Habe ich hier schon einmal geboten und wurde ueberholt?
      warIch: !!(key && los.verlauf.some((g) => g.key === key)),
      mindest: mindestGebot(los),
      verlauf: los.verlauf.slice(0, VERLAUF_MAX).map((g) => ({ ...g, ich: !!(key && g.key === key) })),
    } : null,
    kommendes: kommendes(los),
    archiv: state.archiv.slice(0, 8),
    startGebot: START_GEBOT,
    verlaengerung: VERLAENGERUNG_MS,
    gesperrt,
    meineChips: acc ? acc.chips : 0,
    marke: menueMarke(key),
  };
}

function sende() {
  if (!io) return;
  // Ohne Schluessel: der persoenliche Teil (binIch, Sperre) fehlt, den holt
  // sich jeder Client beim naechsten auktion:state selbst.
  io.emit("auktion:update");
}

function tick() {
  if (!state.los) { starteLos(); return; }
  if (Date.now() >= state.los.endet) hammer();
}

function setupAuktion(_io, _accounts) {
  io = _io;
  accounts = _accounts;
  load();

  // Beim Start: kein Los da, oder eines, dessen Zeit waehrend eines Neustarts
  // abgelaufen ist.
  if (!state.los) starteLos();
  else if (Date.now() >= state.los.endet) hammer();

  setInterval(tick, 10_000).unref();

  io.on("connection", (socket) => {
    socket.on("auktion:state", (ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account || null;
      const zustand = { ok: true, ...oeffentlich(key) };
      // Erst antworten, dann abhaken: sonst faende der Client seine eigene
      // Marke nie und wuesste nicht, warum sie eben noch rot war.
      gesehen(key);
      ack(zustand);
    });

    socket.on("auktion:bieten", ({ betrag } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(bieten(socket.data.account, betrag));
    });
  });
}

module.exports = { setupAuktion, oeffentlich, menueMarke, START_GEBOT };
