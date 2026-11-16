"use strict";

/**
 * Casino-Season mit Pass.
 *
 * Fortschritt gibt es fürs echte Spielen und für erledigte Aufträge, mit einem
 * Tagesdeckel für XP, damit man mit Mini-Einsätzen nicht endlos Gratiswert
 * abgreift. Belohnungen holt man selbst ab, Chips gehen durch die normale
 * Vermögensbremse.
 */

const hauszeit = require("./hauszeit");

/** Mitternacht deutscher Zeit an einem Kalendertag (game/hauszeit.js). */
const tag = (jahr, monat, t) => hauszeit.ausWandzeit(Date.UTC(jahr, monat - 1, t));

/*
 * Alle Seasons, der Reihe nach.
 *
 * Vorher stand hier genau eine. Als sie am 1. November 2026 endete, stand
 * auf dem Bildschirm "beendet", und daran änderte sich nichts mehr, bis
 * jemand den Code anfasste. Jetzt wird die Season über das Datum gewählt
 * (`aktuelle`): die laufende, sonst die nächste, die kommt, sonst die letzte.
 * Eine neue Season ist ein Eintrag hier unten, mit ihren vier besonderen
 * Stufen. XP-Schwellen und Chips stehen in STUFEN und gelten für alle.
 *
 * `kosmetik` nennt je besonderer Stufe die Stücke. Sie müssen im Katalog
 * (game/cosmetics.js) mit `season: "<id>"` stehen, sonst gelten sie dort
 * als verdienbar und nicht als Season-Stück.
 */
const SEASONS = [
  {
    id: "porta-herbst-2",
    kurz: "Season 2",
    name: "Porta-Herbst",
    subtitle: "Acht Wochen, zwanzig Stufen. Spiel einfach, der Rest läuft nebenbei mit.",
    startsAt: Date.UTC(2026, 8, 6, 0, 0, 0),   // 6. September 2026
    endsAt: Date.UTC(2026, 10, 1, 0, 0, 0),    // 1. November 2026, also acht Wochen
    kosmetik: {
      5: [{ type: "avatar", id: "s2_joker" }],
      10: [{ type: "style", id: "s2_bernstein" }],
      15: [{ type: "avatar", id: "s2_wolf" }, { type: "frame", id: "s2_wolf" }],
      20: [{ type: "avatar", id: "s2_phoenix" }, { type: "style", id: "s2_phoenix" }, { type: "title", id: "s2_phoenix" }],
    },
  },
  {
    id: "porta-winter-3",
    kurz: "Season 3",
    name: "Porta-Winter",
    subtitle: "Neun Wochen, zwanzig Stufen, über die Feiertage bis in den Januar.",
    startsAt: tag(2026, 11, 16),   // Montag, 16. November 2026, 0 Uhr
    endsAt: tag(2027, 1, 18),      // Montag, 18. Januar 2027, 0 Uhr
    kosmetik: {
      5: [{ type: "avatar", id: "s3_schneemann" }],
      10: [{ type: "style", id: "s3_raureif" }],
      15: [{ type: "avatar", id: "s3_eule" }, { type: "frame", id: "s3_eiskristall" }],
      20: [{ type: "avatar", id: "s3_hirsch" }, { type: "style", id: "s3_nordstern" }, { type: "title", id: "s3_nordstern" }],
    },
  },
];

/** Die Season, um die es gerade geht: die laufende, sonst die nächste, sonst die letzte. */
function aktuelle(jetzt = Date.now()) {
  return SEASONS.find((s) => jetzt >= s.startsAt && jetzt < s.endsAt)
    || SEASONS.find((s) => jetzt < s.startsAt)
    || SEASONS[SEASONS.length - 1];
}
const laeuft = (season, jetzt = Date.now()) => jetzt >= season.startsAt && jetzt < season.endsAt;

const PLAY_XP_DAILY_CAP = 700;
const QUEST_XP_DAILY_CAP = 280;

/*
 * Was das Grinden traegt.
 *
 * Season 1 gab stumpf 2 XP pro Runde, egal was man spielte, gedeckelt bei
 * 500 am Tag. Damit war jeder Abend gleich und ab dem Deckel egal. Drei
 * Zutaten aendern das:
 *
 *   Tagesfokus   Ein Spiel gibt heute doppelte XP. Es wechselt taeglich und
 *                 ist fuer alle dasselbe, damit man darueber reden kann.
 *   Tagesserie    Wer an aufeinanderfolgenden Tagen spielt, sammelt schneller
 *                 (+5 % je Tag, hoechstens +50 %). Der Grund, morgen wieder
 *                 reinzuschauen.
 *   Clanbonus    Der Clan-Fortschritt gibt allen Mitgliedern bis zu +25 %.
 *
 * Alle drei wirken vor dem Tagesdeckel. Der Deckel bleibt die harte Grenze,
 * die Boni entscheiden nur, wie schnell man ihn erreicht.
 */
const FOKUS_FAKTOR = 2;
const SERIE_PRO_TAG = 0.05;
const SERIE_MAX = 0.50;

// Reihenfolge ist fest, damit der Fokus vorhersehbar durchrotiert.
const FOKUS_SPIELE = [
  { id: "slots",     label: "Slots",        icon: "🎰" },
  { id: "blackjack", label: "Blackjack",    icon: "♠️" },
  { id: "roulette",  label: "Roulette",     icon: "🎡" },
  { id: "crash",     label: "Crash",        icon: "🚀" },
  { id: "mines",     label: "Mines",        icon: "💣" },
  { id: "towers",    label: "Towers",       icon: "🗼" },
  { id: "pinco",     label: "Pinco Ball",   icon: "🟢" },
  // Verbucht wird das Spiel in accounts.recordHand als `sportwetten`. Der
  // sichtbare Bildschirm heisst weiterhin `sports`, deshalb ist das Ziel zum
  // Oeffnen getrennt vom Statistiknamen.
  { id: "sportwetten", nav: "sports", label: "Sportwetten", icon: "⚽" },
  { id: "horses",    label: "Rennbahn",     icon: "🐎" },
  { id: "poker",     label: "Poker",        icon: "🃏" },
];

const dayNow = () => Math.floor(Date.now() / 86400000);

/** Das Fokus-Spiel des Tages. Fuer alle gleich, weil es aus dem Datum faellt. */
function fokusHeute() {
  return FOKUS_SPIELE[dayNow() % FOKUS_SPIELE.length];
}

const STUFEN = [
  { level: 1,  xp: 120,    chips: 2500 },
  { level: 2,  xp: 280,    chips: 4000 },
  { level: 3,  xp: 480,    chips: 6000 },
  { level: 4,  xp: 720,    chips: 8000 },
  { level: 5,  xp: 1000,   chips: 0 },
  { level: 6,  xp: 1330,   chips: 11000 },
  { level: 7,  xp: 1710,   chips: 13000 },
  { level: 8,  xp: 2140,   chips: 16000 },
  { level: 9,  xp: 2620,   chips: 19000 },
  { level: 10, xp: 3150,   chips: 24000 },
  { level: 11, xp: 3740,   chips: 27000 },
  { level: 12, xp: 4390,   chips: 30000 },
  { level: 13, xp: 5100,   chips: 34000 },
  { level: 14, xp: 5880,   chips: 38000 },
  { level: 15, xp: 6730,   chips: 45000 },
  { level: 16, xp: 7650,   chips: 48000 },
  { level: 17, xp: 8650,   chips: 53000 },
  { level: 18, xp: 9730,   chips: 58000 },
  { level: 19, xp: 10890,  chips: 64000 },
  { level: 20, xp: 12140,  chips: 80000 },
];

/** Die zwanzig Stufen einer Season: überall dieselben Schwellen, je Season eigene Stücke. */
function stufenVon(season) {
  return STUFEN.map((r) => {
    const stuecke = season.kosmetik && season.kosmetik[r.level];
    return stuecke ? { ...r, kosmetik: stuecke } : { ...r };
  });
}

let _io = null;
let _accounts = null;

/**
 * Was jemand in der vorigen Season freigeschaltet und nie abgeholt hat.
 *
 * Beim Wechsel wird der Stand am Konto geleert. Ohne diesen Schritt wäre
 * damit auch alles weg, was noch zum Abholen bereitlag: wer in der letzten
 * Woche Stufe 20 erreicht und den Knopf nicht mehr gedrückt hat, hätte den
 * Phönix nie bekommen. Ausgezahlt wird wie beim Abholen von Hand, Chips
 * also durch die Vermögensbremse.
 */
function nachreichen(acc) {
  const alt = acc.season;
  const season = alt && SEASONS.find((x) => x.id === alt.id);
  if (!season || !_accounts) return null;
  const key = _accounts.schluesselVon(acc);
  const faktor = _accounts.faucetFactor(key);
  const geholt = alt.claimed || {};
  let chips = 0;
  const stuecke = [];
  for (const r of stufenVon(season)) {
    if ((alt.xp || 0) < r.xp || geholt[r.level]) continue;
    chips += Math.round((r.chips || 0) * faktor);
    for (const k of r.kosmetik || []) {
      try {
        const cos = require("./cosmetics");
        if (cos.grant(acc, k.type, k.id, key)) stuecke.push(cos.label(k.type, k.id));
      } catch {}
    }
  }
  if (!chips && !stuecke.length) return null;
  if (chips) _accounts.adjustChips(key, chips);
  return { season: season.name, chips, stuecke };
}

function ensure(acc) {
  const season = aktuelle();
  acc.season = acc.season || {};
  if (acc.season.id !== season.id) {
    const alt = acc.season;
    const nachgereicht = nachreichen(acc);
    /* Tag, Tagesdeckel und Serie gehören dem Menschen, nicht der Season:
       wer am Tag des Wechsels schon gespielt hat, fängt nicht bei null an. */
    acc.season = {
      id: season.id, xp: 0, claimed: {},
      day: alt.day != null ? alt.day : dayNow(),
      playDayXp: alt.playDayXp || 0, questDayXp: alt.questDayXp || 0, serie: alt.serie || 0,
    };
    if (nachgereicht) {
      acc.season.nachgereicht = { ...nachgereicht, am: Date.now() };
      _accounts.save();
      /* Die Buchung passiert ohne Zutun: Stand nachziehen und Bescheid sagen. */
      const key = _accounts.schluesselVon(acc);
      _accounts.meldeStand(_io, key);
      const was = [
        nachgereicht.chips ? `${nachgereicht.chips.toLocaleString("de-DE")} Chips` : "",
        ...nachgereicht.stuecke,
      ].filter(Boolean).join(", ");
      if (_io) for (const sock of _io.of("/").sockets.values()) {
        if (sock.data && sock.data.account === key) sock.emit("notice", { text: `Aus ${nachgereicht.season} nachgereicht: ${was}.` });
      }
    }
  }
  const s = acc.season;
  s.claimed = s.claimed || {};
  if (typeof s.serie !== "number") s.serie = 0;

  const heute = dayNow();
  if (s.day !== heute) {
    // Die Serie zaehlt nur bei lueckenlosen Tagen weiter. Ein ausgelassener
    // Tag setzt sie zurueck, sonst waere sie keine Serie.
    s.serie = s.day === heute - 1 ? Math.min(999, (s.serie || 0) + 1) : 1;
    s.day = heute;
    s.playDayXp = 0;
    s.questDayXp = 0;
  }
  if (!s.serie) s.serie = 1;
  return s;
}

/** Serienbonus als Faktor: Tag 1 = 1,0 · Tag 5 = 1,20 · ab Tag 11 = 1,50. */
function serienFaktor(s) {
  return 1 + Math.min(SERIE_MAX, Math.max(0, (s.serie || 1) - 1) * SERIE_PRO_TAG);
}

/** Clan-Bonus als Faktor. Kommt aus der Clan-Season, siehe game/clans.js. */
function clanFaktor(key) {
  try { return require("./clans").seasonBonusFor(key); } catch { return 1; }
}

function publicState(acc) {
  const SEASON = aktuelle();
  const LEVELS = stufenVon(SEASON);
  const s = ensure(acc);
  const xp = Math.floor(s.xp || 0);
  const unlocked = LEVELS.filter((r) => xp >= r.xp).length;
  const next = LEVELS.find((r) => xp < r.xp) || null;
  const jetzt = Date.now();
  const fokus = fokusHeute();
  // Der Schlüssel, nicht der Name: nach einer Umbenennung fände der Name den Clan nicht mehr.
  const key = _accounts ? _accounts.schluesselVon(acc) : String(acc.name || "").trim().toLowerCase();
  // Drei Zustaende, nicht zwei: vor dem Start, laufend, vorbei. Ohne die
  // Unterscheidung stand vor dem Start "beendet" am Screen.
  const phase = jetzt < SEASON.startsAt ? "vor" : jetzt < SEASON.endsAt ? "laeuft" : "vorbei";
  const faktor = _accounts ? _accounts.faucetFactor(key) : 1;
  return {
    ok: true,
    season: { id: SEASON.id, kurz: SEASON.kurz, name: SEASON.name, subtitle: SEASON.subtitle, startsAt: SEASON.startsAt, endsAt: SEASON.endsAt },
    // Was beim Wechsel aus der vorigen Season von selbst ausgezahlt wurde.
    // Eine Woche lang, danach ist es alte Nachricht.
    nachgereicht: s.nachgereicht && jetzt - (s.nachgereicht.am || 0) < 7 * 86400000 ? s.nachgereicht : null,
    phase,
    laeuft: phase === "laeuft",
    msLeft: Math.max(0, SEASON.endsAt - jetzt),
    msToStart: Math.max(0, SEASON.startsAt - jetzt),
    xp,
    level: unlocked,
    nextXp: next ? next.xp : LEVELS[LEVELS.length - 1].xp,
    playCap: { used: Math.floor(s.playDayXp || 0), max: PLAY_XP_DAILY_CAP },
    questCap: { used: Math.floor(s.questDayXp || 0), max: QUEST_XP_DAILY_CAP },
    fokus: { ...fokus, faktor: FOKUS_FAKTOR },
    serie: { tage: s.serie || 1, faktor: serienFaktor(s), max: 1 + SERIE_MAX },
    clanBonus: clanFaktor(key),
    rewards: LEVELS.map((r) => ({
      ...r,
      // Beschriftung kommt vom Server aus den echten Werten. Vorher stand sie
      // als fester Text daneben ("200.000 Chips") und war nach der ersten
      // Zahlenaenderung falsch.
      label: belohnungsText(r, faktor),
      chipsFuerDich: Math.round((r.chips || 0) * faktor),
      /* Die Kosmetik-Namen getrennt, damit der Client die Zeile selbst bauen
         und die Chips mit dem Zeichen statt mit dem Wort schreiben kann.
         `label` bleibt fuer alles, wo nur Text durchgeht (Chat, Push). */
      stuecke: (r.kosmetik || []).map((k) => {
        try { return require("./cosmetics").label(k.type, k.id); } catch { return k.id; }
      }),
      unlocked: xp >= r.xp,
      claimed: !!s.claimed[r.level],
    })),
    // Prozent der vollen Auszahlung. Unter 100 wird es im Screen erklaert.
    faucet: Math.round(faktor * 100),
  };
}

function emitState(name) {
  if (!_io || !_accounts) return;
  const key = String(name || "").trim().toLowerCase();
  const acc = _accounts.get(key);
  if (!acc) return;
  for (const s of _io.of("/").sockets.values()) {
    if (s.data && s.data.account === key) s.emit("season:update", publicState(acc));
  }
}

/**
 * XP gutschreiben.
 *
 * Reihenfolge: Grundwert × Fokus × Serie × Clan, danach am Tagesdeckel
 * abschneiden. Die Boni entscheiden also, wie schnell man den Deckel
 * erreicht, nicht wie hoch er liegt, sonst waere er keiner.
 */
function addXp(name, amount, kind = "play", spiel = null) {
  if (!_accounts) return 0;
  const acc = _accounts.get(name);
  if (!acc) return 0;
  /* Der Schlüssel kommt vom Konto, nicht aus dem Namen: nach einer
     Umbenennung führte der kleingeschriebene Name ins Leere oder über den
     Alias, und Clan und Anzeige liefen dann auf verschiedene Schlüssel. */
  const key = _accounts.schluesselVon(acc);
  const s = ensure(acc);
  /* Vor dem Start und nach dem Ende wächst der Pass nicht. Vorher lief die
     XP nach dem Ende einfach weiter, und wer Stufe 20 verpasst hatte, konnte
     sie Wochen später noch nachholen. Der Clan bekommt seine XP trotzdem
     (unten): Wochenliga und Clan-Krieg laufen auch zwischen zwei Seasons. */
  const imPass = laeuft(aktuelle());

  let roh = Math.max(0, Math.floor(amount) || 0);
  if (!roh) return 0;
  if (kind === "play" && spiel && spiel === fokusHeute().id) roh *= FOKUS_FAKTOR;
  // Waehrend der Eroeffnungsgala zaehlt jede Runde doppelt. Der Tagesdeckel
  // unten bleibt: die Gala macht schneller, nicht unbegrenzt.
  let gala = 1;
  try { gala = require("./comeback").xpFaktor(); } catch {}
  roh = Math.floor(roh * serienFaktor(s) * clanFaktor(key) * gala);

  /*
   * "geschenk" geht am Tagesdeckel vorbei, in beide Richtungen: es wird nicht
   * abgeschnitten und es verbraucht nichts vom Deckel. Der Deckel begrenzt,
   * wie viel man an einem Tag erspielen kann; ein Geschenk ist nichts
   * Erspieltes. Ohne diese Ausnahme haette das Glücksrad an einem Abend, an
   * dem man ohnehin schon gespielt hat, gar nichts gebracht.
   */
  const geschenk = kind === "geschenk";
  // Ein Geschenk ohne laufende Season gibt es nicht; das Rad zahlt dann Chips.
  if (geschenk && !imPass) return 0;
  const capKey = kind === "quest" ? "questDayXp" : "playDayXp";
  const cap = kind === "quest" ? QUEST_XP_DAILY_CAP : PLAY_XP_DAILY_CAP;
  const room = geschenk ? roh : Math.max(0, cap - (s[capKey] || 0));
  const gain = Math.max(0, Math.min(room, roh));
  if (!gain) return 0;
  if (!geschenk) s[capKey] = (s[capKey] || 0) + gain;
  if (imPass) s.xp = (s.xp || 0) + gain;
  _accounts.save();

  // Dieselbe XP zaehlt auch fuer den Clan. Das ist der Grund, warum ein Clan
  // mehr sein soll als ein Kuerzel neben dem Namen: was einer spielt, bringt
  // die ganze Gruppe voran.
  try { require("./clans").addSeasonXp(key, gain); } catch {}

  emitState(key);
  return imPass ? gain : 0;
}

/**
 * Was eine Stufe gibt, als Satz. Einzige Quelle fuer die Beschriftung.
 *
 * `faktor` ist die Vermoegensbremse des Spielers. Ohne sie stand auf der
 * Leiter "24.000 Chips", ausgezahlt wurden aber 16.043, und niemand konnte
 * sehen warum. Jetzt steht die Zahl da, die wirklich ankommt.
 */
function belohnungsText(r, faktor = 1) {
  const teile = [];
  const chips = Math.round((r.chips || 0) * faktor);
  if (chips > 0) teile.push(`${chips.toLocaleString("de-DE")} Chips`);
  for (const k of r.kosmetik || []) {
    try { teile.push(require("./cosmetics").label(k.type, k.id)); } catch { teile.push(k.id); }
  }
  return teile.join(" + ") || "-";
}

function setupSeason(io, accounts) {
  _io = io;
  _accounts = accounts;

  accounts.onHand((name, winnings, house, game, meta) => {
    if (meta && meta.free) return;
    const xp = 2 + (winnings > 0 ? 1 : 0);
    addXp(name, xp, "play", game);
  });

  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    socket.on("season:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack(publicState(acc));
    });

    socket.on("season:claim", ({ level } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct();
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const lvl = Math.floor(Number(level));
      // Erst ensure: ein Wechsel der Season muss durch sein, bevor die Stufen gelesen werden.
      const s = ensure(acc);
      const reward = stufenVon(aktuelle()).find((r) => r.level === lvl);
      if (!reward) return ack({ ok: false, error: "Unbekannte Stufe." });
      if ((s.xp || 0) < reward.xp) return ack({ ok: false, error: "Noch nicht freigeschaltet." });
      if (s.claimed[lvl]) return ack({ ok: false, error: "Schon abgeholt." });
      const key = socket.data.account;
      const chips = Math.round((reward.chips || 0) * accounts.faucetFactor(key));
      s.claimed[lvl] = true;
      if (chips > 0) accounts.adjustChips(key, chips);
      // Eine Stufe kann mehrere Stuecke geben: Stufe 20 etwa Avatar, Namensstil
      // und Titel zusammen. Das ist der Abschluss von acht Wochen, da darf es
      // mehr sein als ein Emoji.
      const erhalten = [];
      for (const k of reward.kosmetik || []) {
        try {
          const cos = require("./cosmetics");
          if (cos.grant(acc, k.type, k.id, key)) erhalten.push(cos.label(k.type, k.id));
        } catch {}
      }
      const kosmetik = erhalten.length ? erhalten.join(" + ") : null;
      accounts.save();
      const state = publicState(acc);
      const account = accounts.publicAccount(acc);
      const was = kosmetik
        ? (chips > 0 ? `${chips.toLocaleString("de-DE")} Chips und ${kosmetik}` : String(kosmetik))
        : `${chips.toLocaleString("de-DE")} Chips`;
      try { require("./feed").add("season", `${acc.name} holt Season-Stufe ${lvl}: ${was}.`, { user: acc.name, level: lvl, chips }); } catch {}
      socket.emit("account:update", { account });
      ack({ ok: true, chips, kosmetik, account, ...state });
    });
  });
}

/** Welche Stufe entspricht dieser XP-Zahl? Fuer das Season-Achievement. */
function levelVonXp(xp) {
  let lv = 0;
  for (const l of STUFEN) { if ((xp || 0) >= l.xp) lv = l.level; else break; }
  return lv;
}

/**
 * Wie viele freigeschaltete Stufen noch nicht abgeholt sind.
 *
 * Der Client konnte das schon aus publicState() rechnen, der Tagesbericht und
 * die Marke am Menue brauchen es aber auch, und die sollen dafuer nicht den
 * ganzen Season-Zustand ziehen muessen.
 */
function offeneStufen(acc) {
  if (!acc) return 0;
  const st = publicState(acc);
  if (!st) return 0;
  // Absichtlich ohne Pruefung auf "Season laeuft": abholen kann man auch nach
  // dem Ende, also muss die Marke es auch nach dem Ende noch sagen.
  return st.rewards.filter((r) => r.unlocked && !r.claimed).length;
}

/**
 * Season-XP von Hand verschieben, für den Admin-Bildschirm.
 *
 * Ohne Fokus, Serie, Clan und Tagesdeckel: das ist keine erspielte XP,
 * sondern eine Korrektur, und sie soll genau so ankommen, wie sie getippt
 * wurde. Der Clan bekommt bewusst nichts mit, sonst verschöbe jede Korrektur
 * auch den Clan-Krieg. Schon abgeholte Stufen bleiben abgeholt, auch wenn
 * die XP danach darunter fällt; zurückbuchen ließe sich die Belohnung ohnehin
 * nicht sauber.
 */
function adminXp(name, delta) {
  if (!_accounts) return null;
  const key = String(name || "").trim().toLowerCase();
  const acc = _accounts.get(key);
  if (!acc) return null;
  const s = ensure(acc);
  s.xp = Math.max(0, (s.xp || 0) + Math.trunc(Number(delta) || 0));
  _accounts.save();
  emitState(key);
  return { xp: s.xp, stufe: levelVonXp(s.xp) };
}

/** Für die Sammlung: zu jeder Season Name, Ende und ob ihre Stücke noch zu holen sind. */
function uebersicht(jetzt = Date.now()) {
  return Object.fromEntries(SEASONS.map((x) => [x.id, { kurz: x.kurz, name: x.name, endsAt: x.endsAt, vorbei: jetzt >= x.endsAt }]));
}

module.exports = { setupSeason, addXp, adminXp, fokusHeute, levelVonXp, offeneStufen, SEASONS, aktuelle, stufenVon, uebersicht };
/* `SEASON` bleibt für alle, die nur die gerade gültige brauchen. Als Getter,
   damit ein Server, der über den Wechsel hinweg läuft, die neue liefert. */
Object.defineProperty(module.exports, "SEASON", { enumerable: true, get: () => aktuelle() });
