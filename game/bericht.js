"use strict";

/**
 * Tagesbericht: was war, waehrend du weg warst.
 *
 * Das Casino wird in Schueben gespielt: selten sind zwei Leute gleichzeitig da,
 * und wer drei Tage nicht reinschaut, verpasst alles. Rekorde fallen, Gebaeude
 * wechseln den Besitzer, die Lotterie zieht, und niemand erfaehrt es, weil der
 * Chat weggerollt ist und der Live-Feed nach jedem Deploy leer anfaengt.
 *
 * Der Bericht beantwortet beim Reinkommen drei Fragen in dieser Reihenfolge:
 *   1. Was liegt fuer mich bereit (Kalender, Rad, Season, Geschenk)?
 *   2. Was ist passiert, seit ich zuletzt hier war?
 *   3. Wie steht es gerade (Jackpot, Krone, Goldene Strasse, mein Platz)?
 *
 * Quelle fuer (2) ist die Chronik (game/chronik.js), nicht der Live-Feed.
 * Der Merker, bis wann berichtet wurde, steht als `berichtAt` am Konto, nicht
 * im localStorage: Safari wirft den nach sieben Tagen weg, und genau nach so
 * einer Pause ist der Bericht am wichtigsten.
 */

const chronik = require("./chronik");

const TAG_MS = 86400000;
const tagNr = (ts) => Math.floor(ts / TAG_MS);

/* Wie weit zurueck ein erster Bericht schaut. Ohne Deckel stuenden bei einem
   frischen Konto zwei Wochen Chronik in einer Liste. */
const ERSTBLICK_MS = 2 * TAG_MS;

const ICON = {
  rekord: "krone", stadt: "businesses", woche: "stern", event: "blitz",
  gewinn: "chip", verlust: "schlag", season: "season", horses: "horses",
  level: "level",
};

/* Wie viele Zeilen eine Gruppe hoechstens bekommt. Ein Renntag erzeugt zwei
   Dutzend Pferde-Meldungen; die wuerden alles andere nach unten druecken. */
const GRENZE = { rekord: 5, stadt: 4, event: 5, woche: 3, horses: 3, gewinn: 3 };

const REIHE = ["woche", "rekord", "stadt", "event", "gewinn", "horses"];

const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

/** Alles, was gerade abzuholen ist. Auch die Marke am Menue lebt davon. */
/* Welcher Bildschirm zu welchem Duellspiel gehoert. Ohne die Zuordnung
   haette die Marke keine Adresse, und das ist die eine Regel, die fuer
   jede Marke am Menue gilt. */
/* Das Kisten-Duell steht bewusst NICHT drin: es laeuft live, man kann es
   nicht liegen lassen und spaeter abholen. Eine Marke dafuer waere schon
   veraltet, bevor man das Menue aufmacht. */
const DUELL_SCHIRM = { sudoku: "sudoku" };
const DUELL_ICON = { sudoku: "sudoku" };
const DUELL_NAME = { sudoku: "Sudoku-Duell" };

function marken(accounts, key) {
  const acc = accounts.get(key);
  if (!acc) return { season: 0, geschenk: 0, kalender: 0, rad: 0, stadt: 0, duell: 0, duellOrte: {}, kiste: 0, bank: 0, kacheln: {}, gesamt: 0 };
  let season = 0, geschenk = 0, kalender = 0, rad = 0, stadt = 0, duell = 0, kiste = 0;
  try { season = require("./season").offeneStufen(acc); } catch {}
  try {
    const cb = require("./comeback").publicState(key);
    geschenk = cb && cb.geschenkOffen && !cb.geholt ? 1 : 0;
  } catch {}
  try { kalender = accounts.calendarState(key)?.canClaim ? 1 : 0; } catch {}
  try { rad = require("./gluecksrad").zustand(key)?.canSpin ? 1 : 0; } catch {}
  /* Die Gratiskiste zaehlt wie der Gratis-Dreh: einmal in zwanzig Stunden,
     und ohne Hinweis merkt es niemand. Der Stunden-Bonus steht bewusst
     nicht im Zaehler, weil es ihn fast immer gibt. */
  try { kiste = require("./kisten").gratisFrei(acc) ? 1 : 0; } catch {}
  /* Das Sparkonto am Deckel: dort hoert der Zins auf, und das merkt sonst
     niemand. Die einzige Sache in der Bank, die auf einen wartet. */
  let bank = 0;
  try { bank = require("./bank").sparVoll(acc) ? 1 : 0; } catch {}
  /* Ein offenes Stadt-Ereignis steht im Bericht, aber NICHT im goldenen
     Zaehler am Menue. Die Regel dafuer ist "jede Marke am Menue braucht eine
     Adresse im Menue", und die Stadt hat dort keine Zeile, sie haengt als
     Kachel in der Lobby. Eine Zahl am Menue, hinter der man das Gemeinte
     nicht findet, ist schlimmer als keine Zahl. */
  try { stadt = require("./city").ereignisVon(key) ? 1 : 0; } catch {}
  /* Ein angenommenes Duell, das man noch nicht gespielt hat: der Einsatz ist
     weg, das Ergebnis fehlt. Das zaehlt mit, anders als das Stadt-Ereignis:
     es gibt fuer beide Duellspiele eine Zeile im Menue, also hat die Marke
     eine Adresse. */
  let duellOrte = {};
  try {
    for (const z of require("./asyncDuell").offeneZuege(key)) {
      const schirm = DUELL_SCHIRM[z.spiel];
      if (!schirm) continue;               // ohne Adresse im Menue keine Marke
      duellOrte[schirm] = (duellOrte[schirm] || 0) + 1;
      duell++;
    }
  } catch {}
  /* Die Auktion zaehlt nicht mit: sie ist nichts zum Abholen, sondern etwas,
     das man verpassen kann. Deshalb eine eigene, rote Marke statt einer Zahl
     im goldenen Zaehler. */
  let auktion = { neu: false, ueberboten: false, an: false };
  try { auktion = require("./auktion").menueMarke(key); } catch {}
  return {
    season, geschenk, kalender, rad, stadt, duell, duellOrte, kiste, bank,
    /*
     * Im goldenen Zaehler steht nur, was auch im MENUE zu finden ist.
     * Stadt und Bank haben dort keine Zeile, sie sind Lobby-Kacheln — ihre
     * Marke sitzt auf der Kachel und hat dort ihre Adresse. Eine Zahl am
     * Menue, hinter der man das Gemeinte nicht findet, ist schlimmer als
     * keine Zahl.
     */
    gesamt: season + geschenk + kalender + rad + duell + kiste,
    /* Marken, die auf einer Lobby-Kachel sitzen. Kennung = Screen-Name. */
    kacheln: { businesses: stadt, bank, kiste, ...duellOrte },
    auktion,
  };
}

/**
 * Die Marken als anklickbare Zeilen.
 *
 * Bewusst nicht der Stunden-Bonus: den gibt es fast immer, er stuende dauerhaft
 * hier und im Menue eine dauerhafte 1. Eine Marke, die immer leuchtet, sagt
 * nichts mehr. Er hat seinen eigenen grossen Knopf in der Lobby.
 */
function abholListe(accounts, key, m) {
  const out = [];
  if (m.kalender) {
    const cal = accounts.calendarState(key);
    const tag = (cal.current || 0) + 1;
    out.push({ nav: "calendar", icon: "kalender", titel: "Kalender", text: `Tag ${tag}: ${de(cal.rewards[cal.current])} Chips liegen bereit.` });
  }
  if (m.rad) out.push({ nav: "wheel", icon: "gluecksrad", titel: "Glücksrad", text: "Dein Gratis-Dreh ist wieder frei." });
  if (m.kiste) out.push({ nav: "kiste", icon: "geschenk", titel: "Tageskiste", text: "Die Gratiskiste ist wieder offen." });
  if (m.season) out.push({ nav: "season", icon: "season", titel: "Season-Pass", text: m.season === 1 ? "Eine freigeschaltete Stufe wartet." : `${m.season} freigeschaltete Stufen warten.` });
  if (m.geschenk) out.push({ tun: "paket", icon: "geschenk", titel: "Willkommens-Paket", text: "Noch nicht abgeholt." });
  if (m.stadt) {
    let ev = null;
    try { ev = require("./city").ereignisVon(key); } catch {}
    if (ev) out.push({ nav: "businesses", icon: "businesses", titel: ev.titel, text: `${ev.haus} in ${ev.district}. Du musst entscheiden.` });
  }
  if (m.duell) {
    let zuege = [];
    try { zuege = require("./asyncDuell").offeneZuege(key); } catch {}
    for (const z of zuege) {
      out.push({
        nav: DUELL_SCHIRM[z.spiel] || "lobby",
        icon: DUELL_ICON[z.spiel] || "krieg",
        titel: DUELL_NAME[z.spiel] || "Duell",
        text: `Gegen ${z.gegen || "einen offenen Gegner"}. Dein Einsatz von ${de(z.einsatz)} liegt drin, gespielt hast du noch nicht.`,
      });
    }
  }
  return out;
}

/** Chronik-Eintraege zu Zeilen, gruppiert und gedeckelt. */
/*
 * Wie jemand aussieht, zu einem Namen aus der Chronik.
 *
 * Die Chronik speichert fertige Saetze und den NAMEN, nicht den Schluessel:
 * sie soll Jahre spaeter lesbar sein. Fuer die Anzeige braucht es aber das
 * Aussehen, und das haengt am Konto. Aufgeloest wird ueber den Alias-Index,
 * damit auch ein alter Name noch zum richtigen Konto fuehrt.
 *
 * Und warum ueberhaupt: der Tagesbericht ist die einzige Flaeche, die in
 * dieser Runde wirklich jeder liest, auch Tage spaeter. Alles andere
 * (Online-Liste, Pokertisch, Aura) verlangt, dass zwei gleichzeitig da sind,
 * und genau das passiert fast nie. Wer etwas Seltenes hat, wird hier gesehen
 * oder nirgends.
 */
function lookVon(accounts, name) {
  if (!name) return null;
  try {
    const key = accounts.kanonisch(name);
    const acc = key ? accounts.get(key) : null;
    if (!acc) return null;
    const l = require("./cosmetics").publicLook(acc);
    return {
      name: acc.name, avatar: l.avatar, nameColor: l.nameColor, nameStyle: l.nameStyle,
      frame: l.frame, aura: l.aura, zeichen: l.zeichen, prunk: l.prunk,
    };
  } catch { return null; }
}

function punkteAus(eintraege, accounts) {
  const gruppen = new Map();
  for (const e of eintraege) {
    if (!gruppen.has(e.art)) gruppen.set(e.art, []);
    gruppen.get(e.art).push(e);
  }
  const out = [];
  const arten = [...REIHE, ...[...gruppen.keys()].filter((a) => !REIHE.includes(a) && a !== "verlust")];
  for (const art of arten) {
    const liste = gruppen.get(art);
    if (!liste || !liste.length) continue;
    /* Gewinne nach Hoehe, alles andere nach Zeit. Der zweitgroesste Gewinn der
       Woche ist interessanter als der neueste. */
    if (art === "gewinn") liste.sort((a, b) => (b.wert || 0) - (a.wert || 0));
    const max = GRENZE[art] || 4;
    for (const e of liste.slice(0, max)) {
      out.push({ art, icon: ICON[art] || "feed", text: e.text, ts: e.ts, look: lookVon(accounts, e.user) });
    }
    if (liste.length > max) {
      const rest = liste.length - max;
      out.push({ art, icon: ICON[art] || "feed", leise: true, text: `… und ${rest} ${rest === 1 ? "weitere Meldung" : "weitere Meldungen"} dieser Art.` });
    }
  }
  // Verluste einzeln aufzuzaehlen waere Nachtreten. Der haerteste Abend als
  // eine Zeile ist Teil der Geschichte, zehn Zeilen sind eine Abrechnung.
  const verluste = gruppen.get("verlust") || [];
  if (verluste.length) {
    const schlimm = verluste.slice().sort((a, b) => (b.wert || 0) - (a.wert || 0))[0];
    out.push({ art: "verlust", icon: ICON.verlust, leise: true, text: schlimm.text, ts: schlimm.ts, look: lookVon(accounts, schlimm.user) });
  }
  return out;
}

/** Stand jetzt: Zahlen, die unabhaengig von der Abwesenheit interessieren. */
function zahlenAus(accounts, key, seit) {
  const out = [];
  const acc = accounts.get(key);

  try {
    const lo = require("./lotterie").oeffentlich(key);
    const meine = (lo.meineLose || []).length;
    out.push({
      icon: "lotterie", label: "Lotterie-Jackpot", wert: `${de(lo.jackpot)} Chips`,
      sub: meine ? `Du hast ${meine} ${meine === 1 ? "Los" : "Lose"} im Topf.` : "Du bist noch nicht dabei.",
      nav: "lotterie",
    });
  } catch {}

  try {
    const a = require("./auktion").oeffentlich(key);
    if (a.los) {
      out.push({
        icon: "auktion", label: `Unter dem Hammer: ${a.los.art}`,
        wert: a.los.label,
        sub: a.los.gebot
          ? `${de(a.los.gebot)} Chips von ${a.los.bieterName}${a.los.binIch ? " (das bist du)" : ""}.`
          : `Noch kein Gebot. Start bei ${de(a.startGebot)} Chips.`,
        nav: "auktion",
      });
    }
  } catch {}

  try {
    const weekly = require("./weekly");
    const w = weekly.lastWinner && weekly.lastWinner();
    if (w && w.name) out.push({ icon: "krone", label: "Spieler der Woche", wert: w.name, sub: `+${de(w.net)} Chips netto`, nav: "leaderboard" });
  } catch {}

  try {
    const g = require("./city").goldenStreet();
    if (g) out.push({ icon: "stern", label: "Goldene Straße", wert: `${g.st}`, sub: `${g.districtName} zahlt diese Woche doppelten Tribut.`, nav: "businesses" });
  } catch {}

  if (acc) {
    const alle = accounts.rawAll();
    const reicher = alle.filter((a) => (a.chips || 0) > (acc.chips || 0)).length;
    out.push({
      icon: "bestenliste", label: "Dein Platz (Chips)", wert: `${reicher + 1}. von ${alle.length}`,
      sub: `${de(acc.chips)} Chips auf der Hand`, nav: "leaderboard",
    });

    /* Wer war da, seit du weg bist. Fuer eine Freundesrunde ist das die
       naheliegendste Information ueberhaupt, und lastSeen steht schon am Konto. */
    const da = alle
      .filter((a) => a !== acc && (a.lastSeen || 0) > seit)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (da.length) {
      const namen = da.slice(0, 4).map((a) => a.name);
      out.push({
        icon: "gruppe", label: "Seitdem hier gewesen", wert: `${da.length} ${da.length === 1 ? "Spieler" : "Spieler"}`,
        sub: namen.join(", ") + (da.length > namen.length ? ` und ${da.length - namen.length} weitere` : ""),
      });
    }
  }
  return out;
}

function bauen(accounts, key) {
  const acc = accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  const jetzt = Date.now();
  const seit = Math.max(Number(acc.berichtAt) || 0, jetzt - ERSTBLICK_MS);
  const m = marken(accounts, key);
  const abholbar = abholListe(accounts, key, m);
  const punkte = punkteAus(chronik.seit(seit), accounts);
  const zahlen = zahlenAus(accounts, key, seit);

  /* Von selbst aufgehen soll er nur einmal am Tag, und nur wenn drin etwas
     steht, das nicht sowieso jeden Tag drinsteht. Die Zahlen allein sind kein
     Grund, jemandem beim Reinkommen ein Fenster vorzusetzen. */
  const heuteSchon = tagNr(Number(acc.berichtAt) || 0) === tagNr(jetzt);
  const lohnt = punkte.length > 0 || m.gesamt > 0;

  return {
    ok: true,
    seit,
    jetzt,
    stunden: Math.round((jetzt - seit) / 3600000),
    erstesMal: !acc.berichtAt,
    neu: !heuteSchon && lohnt,
    marken: m,
    abholbar,
    punkte,
    zahlen,
    leer: punkte.length === 0 && abholbar.length === 0,
  };
}

function setupBericht(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("bericht:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(bauen(accounts, socket.data.account));
    });

    /* Nur die Marken, fuer die Zahl am Menue-Knopf. Vorher hat der Client dafuer
       zwei eigene Runden gedreht (season:state und comeback:state) und deren
       Antworten selbst zusammengezaehlt. */
    socket.on("bericht:marken", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...marken(accounts, socket.data.account) });
    });

    socket.on("bericht:gelesen", (ack) => {
      const key = socket.data.account;
      if (!key) return typeof ack === "function" && ack({ ok: false });
      const acc = accounts.get(key);
      if (acc) { acc.berichtAt = Date.now(); accounts.save(); }
      if (typeof ack === "function") ack({ ok: true });
    });
  });
}

module.exports = { setupBericht, marken, bauen };
