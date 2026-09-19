"use strict";

/**
 * Auktionshaus, die einzige Stelle, an der es die seltenen Stuecke gibt.
 *
 * Der Laden verkauft zu festen Preisen, der Season-Pass verteilt nach
 * Fortschritt, das Glueckrad nach Glueck. Hier entscheidet, wer am meisten
 * dafuer uebrig hat. Ein Los zur Zeit, und was geboten wird, verbrennt: es
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
 * EINGELIEFERTE LOSE. Seit es den Kosmetik-Markt gibt, koennen Spieler auch
 * selbst etwas unter den Hammer bringen. Der Markt ist der stille Weg (fester
 * Preis, steht da, bis jemand zugreift), das Auktionshaus der laute: ein Los
 * am Tag, Ansage im Chat, Zuschlag um halb neun, und alle sehen zu.
 *
 * Das kostet mehr, und das ist der Punkt. Die Einliefergebuehr faellt sofort
 * an und ist weg, auch wenn niemand bietet — sonst stellt jeder alles ein,
 * was er doppelt hat, und die Warteschlange ist auf Wochen voll. Dazu kommt
 * eine Provision vom Zuschlag, hoeher als die Gebuehr im Markt: fuer die
 * Aufmerksamkeit zahlt man.
 *
 * Eingeliefertes und Haus-Lose wechseln sich ab. Die Haus-Stuecke sind
 * endlich und selten; ohne Abwechslung waeren sie nie wieder drangekommen,
 * sobald drei Leute etwas einliefern.
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
 * Nach einem Zuschlag setzt man ein Los aus, nicht eine Woche.
 *
 * Die Wochensperre sollte verhindern, dass die zwei groessten Konten alles
 * abraeumen. Sie hat aber auch verhindert, dass ueberhaupt jemand zweimal
 * mitbietet: bei neun Losen und einem Los alle ein bis zwei Tage war ein
 * Gewinner fuer die halbe Sammlung raus. Ein Los auszusetzen reicht, damit
 * nicht derselbe zweimal hintereinander zuschlaegt, und laesst danach jeden
 * wieder ran.
 *
 * Gemerkt wird die Nummer des gewonnenen Loses, nicht die Uhrzeit: die Lose
 * wechseln nach Zeitplan, und "ein Los aussetzen" ist damit unabhaengig davon,
 * wie lange ein Los lief.
 */
const VERLAUF_MAX = 12;
const ARCHIV_MAX = 20;

/* Einlieferung durch Spieler.
   Die Gebuehr faellt beim Einliefern an und verbrennt, auch wenn das Stueck
   danach niemand will. Ohne sie waere die Warteschlange voll mit allem, was
   irgendwer doppelt hat. Die Provision ist hoeher als die zehn Prozent im
   Markt, weil das Auktionshaus mehr Aufmerksamkeit bringt: ein Los am Tag,
   Ansage im Chat, Zuschlag zur festen Uhrzeit. */
const EINLIEFER_GEBUEHR = 25_000;
const EINLIEFER_PROVISION = 0.15;
const EINLIEFER_MAX_JE_SPIELER = 1;   // sonst blockiert einer die Schlange
const EINLIEFER_MAX = 8;

/* Welche Arten ueberhaupt versteigert werden. Ein Los ist immer ein Stueck aus
   game/cosmetics.js mit limitiert: "auktion". Hier steht nur, in welchen
   Toepfen gesucht wird. */
const ARTEN = ["style", "frame", "title", "effect", "banner", "schild", "aura", "karte"];

let io = null, accounts = null;
let state = { v: 1, nr: 0, los: null, vergeben: {}, archiv: [], schlange: [], letztesVomHaus: false };

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
      schlange: Array.isArray(roh.schlange) ? roh.schlange : [],
      letztesVomHaus: !!roh.letztesVomHaus,
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
function gesperrtFuer(acc, los, key) {
  if (!acc || !los) return false;
  /* Auf das eigene Los bietet niemand. Sonst treibt man den Preis hoch und
     zahlt am Ende nur die Provision dafuer, dass das Stueck bei einem
     selbst bleibt. */
  if (los.von && key && los.von === key) return true;
  const gewonnen = Number(acc.auktionSiegLos) || 0;
  return gewonnen > 0 && los.nr === gewonnen + 1;
}

/** Der Mindestbetrag fuer das naechste Gebot. */
function mindestGebot(los) {
  if (!los) return START_GEBOT;
  if (!los.gebot) return los.mindest || START_GEBOT;
  return los.gebot + Math.max(SCHRITT_MIN, Math.ceil(los.gebot * SCHRITT_ANTEIL / 1000) * 1000);
}

/* ------------------------------------------------------------------
   Einlieferung durch Spieler
   ------------------------------------------------------------------ */

const praegung = require("./praegung");

/** Liegt dieses Exemplar hier in Verwahrung? Fuer den Markt, damit dort
    nicht angeboten wird, was schon unter dem Hammer steht. */
function istHinterlegt(uid) {
  if (state.los && state.los.uid === uid) return true;
  return state.schlange.some((e) => e.uid === uid);
}

/**
 * Was `key` einliefern koennte: gepraegt, handelbar, frei.
 *
 * "Frei" heisst auch: nicht gerade im Schaufenster des Marktes. Die Praegung
 * sagt weiter, dass es ihm gehoert — hinterlegt wird ueber `cosOwned`, und
 * das sieht man hier nicht. Ohne diese Zeile stuende ein Stueck, das schon
 * im Markt liegt, hier zur Einlieferung bereit, und der Knopf wuerde nur
 * einen Fehler ausspucken.
 */
/* Ab welcher Stufe das Haus etwas annimmt. Die Rechnung steht bei
   `einliefern`; kurz: die feste Gebuehr frisst ein billiges Stueck auf.
   ACHTUNG bei den Kennungen: `cosmetics.stufeKennung` nennt das
   Einzelstueck "einzel", die Stufentabelle in `kisten.js` nennt dieselbe
   Stufe "kiste". Wer hier "kiste" schreibt, sperrt ausgerechnet das
   Seltenste aus — genau das hatte ich erst stehen. "haus" fehlt
   absichtlich: Haus-Stuecke sind ohnehin nicht handelbar. */
const AUKTION_AB = new Set(["episch", "legendaer", "mythisch", "einzel"]);

function einlieferbar(acc, key) {
  const drin = new Set(state.schlange.filter((e) => e.key === key).map((e) => e.uid));
  let imMarkt = () => false;
  try { imMarkt = require("./market").istHinterlegt; } catch {}
  const out = [];
  for (const st of Object.values(praegung.alleVon(key))) {
    if (!cosmetics.handelbar(st.art, st.id)) continue;
    if (!AUKTION_AB.has(cosmetics.stufeVonStueck(st.art, st.id))) continue;
    if (drin.has(st.uid)) continue;
    if (imMarkt(st.uid)) continue;
    out.push({
      uid: st.uid, art: st.art, stueckId: st.id,
      label: cosmetics.label(st.art, st.id),
      look: cosmetics.vorschauDaten(st.art, st.id),
      nr: st.nr, bestand: praegung.bestand(st.art, st.id),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function einliefern(key, uid, mindest) {
  const acc = accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  if (strafen.aktiv(acc, "keineAuktion")) return { ok: false, error: "Du darfst gerade nichts einliefern." };
  const st = praegung.stueck(uid);
  if (!st || st.besitzer !== key) return { ok: false, error: "Das Stück gehört dir nicht." };
  if (!cosmetics.handelbar(st.art, st.id)) return { ok: false, error: "Dieses Stück lässt sich nicht handeln." };
  /*
   * Erst ab Episch, und das ist kein Geschmacksurteil, sondern Rechnen.
   *
   * Die Gebuehr ist ein FESTER Betrag und faellt auch an, wenn niemand
   * bietet. Bei einem Stueck fuer 50.000 sind das die Haelfte: der Markt
   * zahlt 45.000 aus, das Auktionshaus 17.500, und damit muesste der
   * Hammer auf 64.000 steigen, nur um gleichzuziehen. Wer so etwas
   * einliefert, verliert fast sicher — und die Warteschlange, die
   * ohnehin nur ein Los am Tag abarbeitet, waere mit Kleinkram voll.
   *
   * Dieselbe Schwelle benutzt der Markt fuer seine Chat-Ansage und die
   * Ruhmestafel: ab Episch ist etwas der Rede wert.
   */
  const stufe = cosmetics.stufeVonStueck(st.art, st.id);
  if (!AUKTION_AB.has(stufe)) {
    return { ok: false, error: "Das Auktionshaus nimmt erst ab Episch. Kleineres verkaufst du besser auf dem Markt." };
  }
  if (state.schlange.some((e) => e.uid === uid)) return { ok: false, error: "Steht schon in der Warteschlange." };
  if (state.los && state.los.uid === uid) return { ok: false, error: "Das Stück ist gerade unter dem Hammer." };
  const meine = state.schlange.filter((e) => e.key === key).length;
  if (meine >= EINLIEFER_MAX_JE_SPIELER) return { ok: false, error: "Du hast schon etwas in der Warteschlange." };
  if (state.schlange.length >= EINLIEFER_MAX) return { ok: false, error: "Die Warteschlange ist voll. Versuch es morgen wieder." };
  if ((acc.chips || 0) < EINLIEFER_GEBUEHR) return { ok: false, error: `Die Einliefergebühr von ${de(EINLIEFER_GEBUEHR)} Chips fehlt dir.` };

  const m = Math.max(START_GEBOT, Math.round(Number(mindest) || 0));
  /* Aus der Hand geben, genau wie im Markt: sonst traegt man weiter, was
     unter dem Hammer steht. */
  if (!cosmetics.besitzNehmen(acc, st.art, st.id)) return { ok: false, error: "Das Stück gehört dir nicht." };
  accounts.adjustChips(key, -EINLIEFER_GEBUEHR);
  accounts.save();

  state.schlange.push({
    uid, key, name: acc.name,
    art: st.art, id: st.id,
    label: cosmetics.label(st.art, st.id),
    nr: st.nr,
    mindest: m,
    seit: Date.now(),
  });
  save();
  sende();
  return {
    ok: true,
    label: cosmetics.label(st.art, st.id), nr: st.nr,
    platz: state.schlange.filter((e) => e.key === key).length,
    account: accounts.publicAccount(acc),
  };
}

/** Aus der Warteschlange zurueckholen. Die Gebuehr bleibt weg. */
function zuruecknehmen(key, uid) {
  const i = state.schlange.findIndex((e) => e.uid === uid && e.key === key);
  if (i < 0) return { ok: false, error: "Das steht nicht in deiner Warteschlange." };
  const e = state.schlange[i];
  const acc = accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  cosmetics.besitzGeben(acc, e.art, e.id);
  accounts.save();
  state.schlange.splice(i, 1);
  save();
  sende();
  return { ok: true, label: e.label, account: accounts.publicAccount(acc) };
}

/**
 * Das naechste Los aufmachen.
 *
 * Haus und Spieler wechseln sich ab. Die Haus-Stuecke sind endlich und
 * selten; ohne die Abwechslung waeren sie nie wieder drangekommen, sobald
 * drei Leute etwas einliefern. Ist eine Seite leer, kommt die andere.
 */
function starteLos() {
  const eingeliefert = state.schlange.length > 0;
  const hausOffen = offeneStuecke().length > 0;
  const nimmEingeliefert = eingeliefert && (state.letztesVomHaus || !hausOffen);
  if (nimmEingeliefert) return starteEingeliefertes();

  const offen = offeneStuecke();
  if (!offen.length) {
    if (eingeliefert) return starteEingeliefertes();
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
    vomHaus: true,
  };
  state.letztesVomHaus = true;
  save();
  try {
    chat.announce(io, `Auktionshaus: ${ART_NAME[s.type]} „${s.label}“ kommt unter den Hammer. Startgebot ${de(START_GEBOT)} Chips, Zuschlag ${endeText(state.los.endet)}.`);
  } catch {}
  try { require("./chronik").notiere("event", `Neu im Auktionshaus: ${ART_NAME[s.type]} „${s.label}“. Startgebot ${de(START_GEBOT)} Chips.`); } catch {}
  sende();
  return state.los;
}

/** Das aelteste eingelieferte Stueck unter den Hammer bringen. */
function starteEingeliefertes() {
  const e = state.schlange.shift();
  if (!e) return null;
  state.nr += 1;
  state.los = {
    nr: state.nr,
    type: e.art, id: e.id,
    label: e.label,
    art: ART_NAME[e.art] || cosmetics.ART_NAME[e.art] || e.art,
    start: Date.now(),
    endet: naechstesEnde(),
    gebot: 0,
    bieter: null,
    bieterName: null,
    verlauf: [],
    /* Das Kennzeichen eines eingelieferten Loses: es haengt an einem
       Exemplar (uid) und hat einen Verkaeufer. Ein Haus-Los hat beides
       nicht — dort entsteht das Stueck erst beim Zuschlag. */
    uid: e.uid,
    von: e.key, vonName: e.name,
    stueckNr: e.nr,
    mindest: e.mindest,
    vomHaus: false,
  };
  state.letztesVomHaus = false;
  save();
  try {
    chat.announce(io, `Auktionshaus: ${e.name} bringt ${ART_NAME[e.art] || e.art} „${e.label}“ Nr. ${e.nr} unter den Hammer. `
      + `Startgebot ${de(e.mindest)} Chips, Zuschlag ${endeText(state.los.endet)}.`);
  } catch {}
  try {
    require("./chronik").notiere("event", `${e.name} versteigert „${e.label}“ Nr. ${e.nr}. Startgebot ${de(e.mindest)} Chips.`, { user: e.name });
  } catch {}
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
    if (los.von) {
      /* Eingeliefert und niemand wollte es: zurueck an den Einlieferer. Die
         Gebuehr bleibt weg — sie hat den Platz unter dem Hammer bezahlt,
         nicht den Verkauf. */
      const vAcc = accounts.get(los.von);
      if (vAcc) { cosmetics.besitzGeben(vAcc, los.type, los.id); accounts.save(); }
      try { chat.announce(io, `Keine Gebote für „${los.label}“ Nr. ${los.stueckNr}. Es geht zurück an ${los.vonName}.`); } catch {}
    } else {
      // Haus-Los: das Stueck wandert zurueck in den Topf und kommt spaeter
      // wieder, weggeworfen wird hier nichts.
      try { chat.announce(io, `Keine Gebote für „${los.label}“. Das Stück kommt später noch einmal.`); } catch {}
    }
    state.los = null;
    save();
    starteLos();
    return;
  }

  const acc = accounts.get(los.bieter);
  const stuecke = [];
  let anVerkaeufer = 0, provision = 0;

  if (los.von) {
    /*
     * Eingeliefertes Los: hier wechselt ein EXEMPLAR den Besitzer, es
     * entsteht keins. Deshalb praegung.uebertragen und nicht grant — sonst
     * haette der Kaeufer ein frisch gepraegtes Stueck mit neuer Nummer und
     * der Verkaeufer sein altes noch in der Kette.
     */
    provision = Math.round(los.gebot * EINLIEFER_PROVISION);
    anVerkaeufer = los.gebot - provision;
    if (acc) {
      cosmetics.besitzGeben(acc, los.type, los.id);
      stuecke.push(los.label);
      acc.auktionSieg = Date.now();
      acc.auktionSiegLos = los.nr;
    }
    const vAcc = accounts.get(los.von);
    if (vAcc) accounts.adjustChips(los.von, anVerkaeufer);
    accounts.save();
    praegung.uebertragen(los.uid, los.bieter, acc ? acc.name : los.bieterName, los.gebot);
    /* Der Verkaeufer bekommt Chips, ohne etwas gedrueckt zu haben. Ohne diese
       Zeile steht in seiner Topbar weiter der alte Stand. */
    if (vAcc) {
      for (const sock of io.of("/").sockets.values()) {
        if (sock.data && sock.data.account === los.von) {
          sock.emit("account:update", { account: accounts.publicAccount(vAcc) });
          sock.emit("auktion:verkauft", { label: los.label, nr: los.stueckNr, betrag: los.gebot, erloes: anVerkaeufer, an: los.bieterName });
          break;
        }
      }
    }
  } else {
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
  }
  state.archiv.unshift({
    nr: los.nr, art: los.art, label: los.label,
    name: los.bieterName, betrag: los.gebot, ts: Date.now(),
    von: los.vonName || null, stueckNr: los.stueckNr || null,
  });
  if (state.archiv.length > ARCHIV_MAX) state.archiv.length = ARCHIV_MAX;

  const satz = los.von
    ? `Zuschlag: ${los.bieterName} ersteigert ${los.art} „${los.label}“ Nr. ${los.stueckNr} von ${los.vonName} für ${de(los.gebot)} Chips.`
    : `Zuschlag: ${los.bieterName} ersteigert ${los.art} „${los.label}“ für ${de(los.gebot)} Chips.`;
  try { chat.announce(io, satz); } catch {}
  try {
    require("./chronik").notiere("event", satz, { user: los.bieterName, wert: los.gebot });
  } catch {}
  if (acc) {
    for (const s of io.of("/").sockets.values()) {
      if (s.data && s.data.account === los.bieter) {
        s.emit("auktion:zuschlag", { art: los.art, label: los.label, betrag: los.gebot, stuecke, nr: los.stueckNr || null, von: los.vonName || null });
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
  if (los.von && los.von === key) {
    return { ok: false, error: "Das ist dein eigenes Los." };
  }
  if (gesperrtFuer(acc, los, key)) {
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
  const gesperrt = !!(acc && los && gesperrtFuer(acc, los, key));
  return {
    los: los ? {
      nr: los.nr, art: los.art, label: los.label, type: los.type, id: los.id,
      start: los.start, endet: los.endet, gebot: los.gebot,
      bieterName: los.bieterName,
      /* Wer eingeliefert hat, und welches Exemplar. Bei einem Haus-Los steht
         hier nichts: dort entsteht das Stueck erst beim Zuschlag, es hat
         also weder Nummer noch Vorbesitzer. */
      vonName: los.vonName || null,
      meins: !!(key && los.von === key),
      stueckNr: los.stueckNr || null,
      look: cosmetics.vorschauDaten(los.type, los.id),
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
    /* Einlieferung */
    einliefern: {
      gebuehr: EINLIEFER_GEBUEHR,
      provision: EINLIEFER_PROVISION,
      maxJeSpieler: EINLIEFER_MAX_JE_SPIELER,
      voll: state.schlange.length >= EINLIEFER_MAX,
      schlange: state.schlange.map((e, i) => ({
        uid: e.uid, label: e.label, nr: e.nr, name: e.name,
        look: cosmetics.vorschauDaten(e.art, e.id),
        mindest: e.mindest, platz: i + 1, meins: !!(key && e.key === key),
      })),
      meine: acc ? einlieferbar(acc, key) : [],
    },
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

    socket.on("auktion:einliefern", ({ uid, mindest } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = einliefern(key, String(uid || ""), mindest);
      ack(r.ok ? { ...r, ...oeffentlich(key) } : r);
    });

    socket.on("auktion:zurueck", ({ uid } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = zuruecknehmen(key, String(uid || ""));
      ack(r.ok ? { ...r, ...oeffentlich(key) } : r);
    });
  });
}

/**
 * Ein Bieter heisst jetzt anders.
 *
 * Das laufende Los, die Gebotsliste und die Liste der vergebenen Stuecke
 * halten den Namen als Kopie. Das Archiv haelt nur den Namen und keinen
 * Schluessel, dort wird deshalb ueber den alten Namen gesucht.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  const los = state.los;
  if (los) {
    if (los.bieter === key) { los.bieterName = neu; n++; }
    for (const g of los.verlauf || []) if (g.key === key) { g.name = neu; n++; }
  }
  for (const v of Object.values(state.vergeben || {})) {
    if (v && v.key === key) { v.name = neu; n++; }
  }
  for (const a of state.archiv || []) {
    if (a && String(a.name || "").toLowerCase() === String(alt || "").toLowerCase()) { a.name = neu; n++; }
    if (a && String(a.von || "").toLowerCase() === String(alt || "").toLowerCase()) { a.von = neu; n++; }
  }
  // Der Einlieferer steht am laufenden Los und an allem in der Schlange.
  if (los && los.von === key) { los.vonName = neu; n++; }
  for (const e of state.schlange || []) if (e.key === key) { e.name = neu; n++; }
  if (n) save();
  return n;
}

module.exports = { setupAuktion, oeffentlich, menueMarke, umbenennen, istHinterlegt, START_GEBOT, EINLIEFER_GEBUEHR, EINLIEFER_PROVISION };
