"use strict";

/**
 * Kisten: Kosmetik als Ziehung.
 *
 * Der Laden ist der größte Chip-Abfluss, den das Casino hat, und im Stand vom
 * 18.9. wurde er nicht benutzt: von 80 Konten haben insgesamt rund fünfzehn
 * Stücke jemals jemand gekauft. Ein Grund dafür ist, dass Kaufen keine Runde
 * ist. Man tippt auf einen Preis und hat danach ein Stück. In einem Haus, in
 * dem alles andere eine Ziehung ist, ist das der langweiligste Knopf.
 *
 * Eine Kiste ist dieselbe Ausgabe mit einer Runde davor.
 *
 * Wie die Stufen zustande kommen: NICHT als eigene Liste, sondern aus dem
 * Preis im Laden (`STUFEN`). Der Katalog hat 73 käufliche Stücke und eine
 * gewachsene Preisstaffel von 5.000 bis 1,8 Millionen; die ist die
 * Seltenheit, sie war nur nie beschriftet. Eine zweite, handgepflegte Liste
 * würde beim nächsten neuen Stück vergessen.
 *
 * Was NICHT in eine Kiste kann: alles, was `cost: null` hat. Season-Stücke,
 * Auktionsware, Fortuna, die Wiedereröffnung, die Haus-Stücke. Die haben
 * ihren eigenen Weg, und wenn eine Kiste sie ausspuckt, ist keiner davon mehr
 * etwas wert. Einzige Ausnahme sind die Stücke, die es NUR aus der Kiste
 * gibt (`limitiert: "kiste"`), und die stehen unten einzeln.
 *
 * Doppeltes: `cosOwned` ist eine Liste ohne Doppelte, ein zweites Exemplar
 * wäre unsichtbar und für immer weg. Wer ein Stück schon hat, bekommt
 * stattdessen Chips, und zwar deutlich weniger als seinen Ladenwert. Das ist
 * wichtig, damit eine Kiste für jemanden, der schon alles hat, kein
 * Geldautomat wird: der Rückkauf liegt bei jeder Kiste unter dem Kaufpreis,
 * auch wenn man ALLES besitzt (nachgerechnet in `pruefe()`).
 *
 * Gezogen wird auf dem Server, immer. Der Client bekommt das Ergebnis und
 * zeigt die Ziehung danach als Animation — er würfelt nichts.
 */

const cosmetics = require("./cosmetics");
const praegung = require("./praegung");
const chat = require("./chat");
const ruhm = require("./ruhm");

/* Seltenheit aus dem Ladenpreis. Die Grenzen sind an der echten Preisstaffel
   abgelesen, nicht gesetzt: es gibt 17 Stücke bis 30.000, 23 bis 120.000,
   18 bis 400.000, 12 bis eine Million und 3 darüber. */
const STUFEN = [
  { id: "gewoehnlich", label: "Gewöhnlich", bis: 30_000,    farbe: "#9aa4ae" },
  { id: "selten",      label: "Selten",     bis: 120_000,   farbe: "#5ea8e0" },
  { id: "episch",      label: "Episch",     bis: 400_000,   farbe: "#c86bd6" },
  { id: "legendaer",   label: "Legendär",   bis: 1_000_000, farbe: "#f4d782" },
  { id: "mythisch",    label: "Mythisch",   bis: Infinity,  farbe: "#e0705e" },
  // Nicht über den Preis erreichbar: es gibt sie nur aus einer Kiste.
  /* Limette, und das ist gerechnet: Tuerkis lag dem Blau von "Selten"
     zu nah, und in der Neon-Palette war es praktisch die Akzentfarbe
     selbst (Abstand 20 im Lab-Raum — die Stufe verschwand im Thema).
     Limette hat zu JEDER anderen Stufe mindestens 55 Abstand, mehr als
     jeder andere Kandidat, und ist als einzige Stufe ausserhalb der
     Reihe Blau-Lila-Gold-Rot. Genau das soll sie sagen: die hier steht
     nicht auf der Skala. */
  { id: "kiste",       label: "Einzelstück", bis: null,     farbe: "#b6ff4d" },
];
const stufeVon = (cost) => STUFEN.find((s) => s.bis !== null && cost <= s.bis) || STUFEN[0];

/* Die Kisten. `chancen` sind Prozent und müssen 100 ergeben, das prüft
   pruefe() beim Start. */
const KISTEN = {
  /*
   * Die Tageskiste kostet nichts und geht einmal am Tag.
   *
   * Ohne sie gaebe es fuer einen Anfaenger gar keinen Weg zu Kosmetik: er
   * startet mit 5.000 Chips, die billigste Kiste kostet 30.000, und den
   * Laden gibt es nicht mehr. Sie ist bewusst duenn (fast nur Gewoehnliches)
   * und druckt nichts: sie kostet nichts, also kann auch nichts schiefgehen
   * ausser dem Rueckkauf bei Doppeltem, und der ist hier gedeckelt.
   */
  tag: {
    id: "tag", label: "Tageskiste", preis: 0, frei: true, pauseMs: 20 * 3600 * 1000,
    text: "Kostet nichts, einmal am Tag. Meistens Kleinkram, aber es ist ein Anfang.",
    chancen: { gewoehnlich: 82, selten: 16, episch: 2 },
  },
  holz: {
    id: "holz", label: "Holzkiste", preis: 30_000,
    text: "Die Kiste vom Dachboden. Meistens Kleinkram, ab und zu etwas Gutes.",
    chancen: { gewoehnlich: 65, selten: 25, episch: 8, legendaer: 2 },
  },
  messing: {
    id: "messing", label: "Messingkiste", preis: 150_000,
    text: "Schwerer, besser sortiert. Hier fängt es an, sich zu lohnen.",
    chancen: { gewoehnlich: 30, selten: 42, episch: 21, legendaer: 6, mythisch: 1 },
  },
  schwarz: {
    id: "schwarz", label: "Schwarze Kiste", preis: 600_000,
    text: "Nichts Gewöhnliches drin. Die einzige Kiste mit den Einzelstücken.",
    chancen: { selten: 20, episch: 38, legendaer: 30, mythisch: 9, kiste: 3 },
  },
  /*
   * Die Gala-Kiste: die erste LIMITIERTE.
   *
   * Zwei Dinge unterscheiden sie von allen anderen, und beide zusammen
   * machen sie erst zu etwas.
   *
   *   EIGENER TOPF. Sie zieht kein einziges Stueck aus dem allgemeinen
   *   Katalog, sondern nur aus dreizehn Stuecken, die es ausschliesslich
   *   hier gibt — ein eigener Satz fuer JEDE Seltenheit, vom Konfetti-
   *   Zeichen bis zum Rampenlicht. Eine limitierte Kiste, die dasselbe
   *   ausspuckt wie die Messingkiste, waere nur eine Messingkiste mit
   *   Ablaufdatum.
   *
   *   ABLAUFDATUM. Danach ist sie weg, und die dreizehn Stuecke entstehen
   *   nie wieder. Was dann noch existiert, ist genau das, was in diesen
   *   Wochen gezogen wurde — und der einzige Weg dorthin ist danach der
   *   Markt. Das ist der Punkt: eine Zahl, die nicht mehr waechst, ist das
   *   Einzige, was einen Preis wirklich traegt.
   *
   * Der Preis liegt bei rund neunzig Prozent des Erwartungswerts, also
   * genauso wie bei der Schwarzen Kiste. Das Limitierte ist der Reiz, nicht
   * ein schlechterer Kurs.
   */
  gala: {
    id: "gala", label: "Gala-Kiste", preis: 250_000,
    text: "Roter Teppich, Blitzlicht, Konfetti. Dreizehn Stücke, die es nur hier gibt — und nur bis zum Stichtag.",
    limitiert: true,
    /* Bis wann sie steht. Danach verschwindet sie von selbst, es muss
       niemand etwas abschalten. Zum Verlaengern nur diese Zeile aendern. */
    bis: new Date("2026-10-12T20:30:00+02:00").getTime(),
    eigenerTopf: "gala",
    chancen: { gewoehnlich: 34, selten: 30, episch: 24, legendaer: 9, mythisch: 2, kiste: 1 },
  },
};

/* Anteil des Ladenwerts, den man für ein Doppeltes zurückbekommt. Bewusst
   niedrig: siehe pruefe(). */
const DOPPELT_ANTEIL = 0.25;
/*
 * Was eine GRATIS-Kiste für Doppeltes zahlt.
 *
 * Erst stand hier eine Null, mit der Begruendung, jeder Rueckkauf an einer
 * Gratiskiste sei ein Chip-Drucker. Das stimmt fuer einen ANTEIL am Wert:
 * wer alles besitzt, haette sich damit jeden Tag ein paar Prozent von
 * 1,8 Millionen abgeholt.
 *
 * Es stimmt aber nicht fuer einen festen kleinen Betrag, und die Null hatte
 * einen Preis, den ich beim Nachrechnen gefunden habe: wer alle 18
 * gewoehnlichen und alle 26 seltenen Stuecke hat, bekommt aus der Tageskiste
 * mit 98 Prozent Wahrscheinlichkeit GAR NICHTS. Ein taeglicher Gratis-Knopf,
 * der nichts tut, ist schlimmer als keiner — und genau die Leute, die am
 * laengsten dabei sind, laufen als Erste hinein.
 *
 * Also ein fester Trostbetrag, unabhaengig vom Wert des Stuecks, und durch
 * die Vermoegensbremse wie jedes andere Gratisgeld. Fuer ein grosses Konto
 * bleibt davon ein Viertel, und mehr als einmal am Tag geht es nicht.
 */
const DOPPELT_FREI_CHIPS = 3_000;
/* Was ein Einzelstück wert ist, wenn man es doppelt zieht. Es hat keinen
   Ladenpreis, also braucht es eine Zahl; sie liegt über allem anderen, weil
   das Stück sonst der billigste Ausgang der teuersten Kiste wäre. */
const KISTENSTUECK_WERT = 2_000_000;
/* So viel darf eine Gratiskiste hoechstens fuer ein Doppeltes zahlen. Der
   Kalender gibt an Tag eins 2.000, der Stunden-Bonus liegt in derselben
   Groessenordnung; eine taegliche Quelle darueber waere keine Kleinigkeit
   mehr, sondern Einkommen. */
const GRATIS_DECKEL = 5_000;

/*
 * Wie lange die Ziehung im Browser dauert.
 *
 * Die Zahlen stehen HIER und nicht im Client, obwohl sie dort ablaufen, und
 * zwar aus einem Grund: der Server sagt im Chat an, wenn jemand etwas
 * Seltenes zieht — und er tat das in dem Moment, in dem er gezogen hat. Wer
 * gerade zusah, las die Ansage also, waehrend die Bahn noch lief, und wusste
 * sein eigenes Ergebnis aus dem Chat, bevor die Kiste aufging.
 *
 * Deshalb wartet die Ansage genau so lange, wie die Schau dauert. Damit die
 * beiden Zahlen nicht auseinanderlaufen, gibt es sie nur einmal: der Client
 * bekommt sie mitgeschickt und richtet seine Animation danach.
 */
const SCHAU = {
  aufbau: 1250,
  platzen: 260,
  /* Die Fahrt geht ueber das Ziel hinaus, und danach rollt die Bahn
     zurueck, bis der Treffer GENAU unter der Marke steht. Deshalb zwei
     Zahlen: das Auslaufen und das Zurueckrollen. */
  bahn: 4900,
  rollen: 950,
  /* Die Pause zwischen Stillstand und Ergebnis. Die teuerste halbe Sekunde
     der ganzen Schau: die Bahn steht, der Treffer liegt unter der Marke, und
     eine Sekunde lang passiert nichts. Vorher sprang die Karte sofort auf
     und nahm sich damit ihren eigenen Moment weg. */
  halten: 620,
  landung: 300,
};
const SCHAU_MS = SCHAU.aufbau + SCHAU.platzen + SCHAU.bahn + SCHAU.rollen + SCHAU.halten + SCHAU.landung;

const LISTEN = () => ({
  avatar: cosmetics.AVATARS, color: cosmetics.COLORS, style: cosmetics.STYLES,
  frame: cosmetics.FRAMES, title: cosmetics.TITLES, effect: cosmetics.EFFEKTE,
  spruch: cosmetics.SPRUECHE, banner: cosmetics.BANNER, schild: cosmetics.SCHILDER,
  aura: cosmetics.AUREN, karte: cosmetics.KARTEN, zeichen: cosmetics.ZEICHEN,
});

/**
 * Alle ziehbaren Stücke, nach Stufe sortiert. Einmal beim Start gebaut.
 *
 * `nur` grenzt ab: ein Stück mit `nur: "gala"` gehört ausschließlich in den
 * Topf der Gala-Kiste und darf im allgemeinen nicht auftauchen. Ohne diese
 * eine Zeile wäre eine limitierte Kiste sinnlos — ihre Stücke lägen
 * gleichzeitig im Dauerangebot.
 */
function baueTopf(nur = null) {
  const topf = {};
  for (const s of STUFEN) topf[s.id] = [];
  for (const [art, liste] of Object.entries(LISTEN())) {
    for (const x of liste) {
      if ((x.nur || null) !== nur) continue;
      /* `nichtInKisten` heisst: gibt es, aber nicht mehr als Ziehung. Das
         betrifft die Namensfarben — jeder Stil ueberschreibt sie, sie waeren
         als Treffer eine Niete. Begruendung steht am Katalog. */
      if (x.nichtInKisten) continue;
      if (x.limitiert === "kiste") { topf.kiste.push({ art, id: x.id, wert: KISTENSTUECK_WERT }); continue; }
      /* Gratis-Stücke fliegen raus (jeder hat sie ohnehin), und alles, was
         nicht käuflich ist, hat seinen eigenen Weg ins Haus. */
      if (!x.cost) continue;
      topf[stufeVon(x.cost).id].push({ art, id: x.id, wert: x.cost });
    }
  }
  return topf;
}
const TOEPFE = {};
const topf = (nur = null) => (TOEPFE[nur || "-"] || (TOEPFE[nur || "-"] = baueTopf(nur)));
/** Aus welchem Topf diese Kiste zieht. */
const topfVon = (kiste) => topf(kiste && kiste.eigenerTopf ? kiste.eigenerTopf : null);

/** Läuft die Kiste noch? Eine ohne Stichtag läuft immer. */
const laeuft = (kiste) => !kiste || !kiste.bis || Date.now() < kiste.bis;

/**
 * Gegenprobe beim Start.
 *
 * Zwei Dinge dürfen nicht passieren, und beide fallen sonst erst auf, wenn
 * jemand hundert Kisten aufgemacht hat: eine Stufe ohne Inhalt (die Ziehung
 * liefe ins Leere) und eine Kiste, die für jemanden mit voller Sammlung mehr
 * Chips ausspuckt, als sie kostet.
 */
function pruefe() {
  const meldungen = [];
  for (const k of Object.values(KISTEN)) {
    const t = topfVon(k);
    const summe = Object.values(k.chancen).reduce((a, b) => a + b, 0);
    if (Math.round(summe) !== 100) meldungen.push(`${k.label}: Chancen ergeben ${summe} statt 100.`);
    let erwarteterWert = 0;
    for (const [stufe, pct] of Object.entries(k.chancen)) {
      if (!t[stufe] || !t[stufe].length) { meldungen.push(`${k.label}: Stufe „${stufe}“ ist leer.`); continue; }
      /* Bei einer limitierten Kiste ist das die wichtigste Probe: sie zieht
         aus einem eigenen, kleinen Topf, und eine vergessene Stufe faellt
         sonst erst beim ersten Zug auf. */
      const schnitt = t[stufe].reduce((s, x) => s + x.wert, 0) / t[stufe].length;
      erwarteterWert += (pct / 100) * schnitt;
    }
    const beiVollerSammlung = erwarteterWert * DOPPELT_ANTEIL;
    /* Bei einer Gratiskiste ist jeder Rückkauf über null ein Chip-Drucker.
       Deshalb zahlt sie für Doppeltes gar nichts (siehe oeffne), und hier
       wird sie nur daraufhin geprüft. */
    if (k.frei) {
      /* Die Gratiskiste zahlt einen festen Trostbetrag statt eines Anteils.
         Geprueft wird deshalb nicht auf null, sondern darauf, dass der
         Betrag klein bleibt: er kommt einmal am Tag und ist damit eine
         Quelle wie der Kalender, nicht wie ein Spiel. */
      if (DOPPELT_FREI_CHIPS > GRATIS_DECKEL) {
        meldungen.push(`${k.label}: Trostbetrag ${DOPPELT_FREI_CHIPS} liegt über dem Deckel von ${GRATIS_DECKEL}.`);
      }
    } else if (beiVollerSammlung >= k.preis) {
      meldungen.push(`${k.label}: druckt Chips. Rückkauf bei voller Sammlung ${Math.round(beiVollerSammlung)} >= Preis ${k.preis}.`);
    }
  }
  for (const m of meldungen) console.error("kisten:", m);
  return meldungen;
}

/**
 * Steht die Gratiskiste bereit?
 *
 * Fuer die Marke am Menue und auf der Lobby-Kachel. Sie zaehlt wie der
 * Gratis-Dreh am Glueckrad: einmal am Tag, und ohne Hinweis merkt es
 * niemand. Der Stunden-Bonus steht bewusst nicht im Zaehler, weil es ihn
 * fast immer gibt — das hier gibt es einmal in zwanzig Stunden.
 */
function gratisFrei(acc) {
  for (const k of Object.values(KISTEN)) {
    if (!k.frei || !laeuft(k)) continue;
    const zuletzt = (acc && acc.kisten && acc.kisten[k.id]) || 0;
    if (zuletzt + k.pauseMs <= Date.now()) return true;
  }
  return false;
}

/** Die Kisten, wie der Client sie braucht (mit den Chancen, offen ausgewiesen). */
function oeffentlich(acc) {
  const t = topf();
  return {
    stufen: STUFEN.filter((s) => t[s.id] && t[s.id].length).map((s) => ({ id: s.id, label: s.label, farbe: s.farbe, anzahl: t[s.id].length })),
    serien: praegung.serienRegeln(),
    doppeltAnteil: DOPPELT_ANTEIL,
    doppeltFrei: DOPPELT_FREI_CHIPS,
    /* Abgelaufene Kisten fallen raus, und zwar hier und nicht im Client:
       eine Kiste, die man noch sieht und nicht mehr aufmachen kann, ist ein
       Knopf, der nur Fehler ausspuckt. */
    kisten: Object.values(KISTEN).filter(laeuft).map((k) => ({
      id: k.id, label: k.label, preis: k.preis, text: k.text, frei: !!k.frei,
      limitiert: !!k.limitiert, bis: k.bis || 0,
      /* Wann die Gratiskiste wieder geht. Ohne die Zahl drückt man und
         bekommt eine Absage, ohne zu wissen, wie lange noch. */
      wiederAb: k.frei && acc && acc.kisten && acc.kisten[k.id] ? acc.kisten[k.id] + k.pauseMs : 0,
      /* Die Chancen stehen offen dabei. In einem Haus ohne echtes Geld gibt
         es keinen Grund, sie zu verstecken, und eine Kiste, deren Chancen man
         nicht kennt, ist keine Entscheidung. */
      chancen: STUFEN.filter((s) => k.chancen[s.id]).map((s) => ({ id: s.id, label: s.label, farbe: s.farbe, pct: k.chancen[s.id] })),
      /* Wie viele Stücke die Kiste überhaupt kennt. Bei der limitierten ist
         das die halbe Botschaft: dreizehn Stücke, sonst nirgends. */
      stueckzahl: Object.values(topfVon(k)).reduce((n, l) => n + l.length, 0),
    })),
  };
}

/**
 * Was in einer Kiste stecken kann, Stueck fuer Stueck.
 *
 * Die Chancen standen bisher nur als Stufen an der Kiste ("21 % episch"),
 * und das beantwortet die eigentliche Frage nicht: WAS ist episch? Wer
 * gezielt etwas sucht — fuer eine Kollektion, oder weil ihm genau ein
 * Stueck fehlt — muss sehen koennen, in welcher Kiste es ueberhaupt
 * drin ist.
 *
 * `hat` kommt mit, weil daraus die zweite Frage folgt: was fehlt mir hier
 * noch? Ohne die Markierung muesste man die Sammlung daneben aufmachen und
 * zwei Listen vergleichen.
 */
function inhalt(acc, kistenId) {
  const kiste = KISTEN[kistenId];
  if (!kiste) return null;
  const t = topfVon(kiste);
  const stufen = STUFEN.filter((s) => kiste.chancen[s.id]).map((s) => {
    const liste = t[s.id] || [];
    return {
      id: s.id, label: s.label, farbe: s.farbe,
      pct: kiste.chancen[s.id],
      /* Die Chance auf EIN bestimmtes Stueck. Ohne sie liest sich "21 %
         episch" so, als waere jedes einzelne Stueck zu 21 % drin. */
      jeStueck: liste.length ? kiste.chancen[s.id] / liste.length : 0,
      stuecke: liste.map((x) => ({
        art: x.art, id: x.id,
        label: cosmetics.label(x.art, x.id),
        look: cosmetics.vorschauDaten(x.art, x.id),
        wert: x.wert,
        hat: acc ? cosmetics.hatStueck(acc, x.art, x.id) : false,
      })).sort((a, b) => b.wert - a.wert || a.label.localeCompare(b.label)),
    };
  });
  return {
    id: kiste.id, label: kiste.label, text: kiste.text,
    preis: kiste.preis, frei: !!kiste.frei,
    limitiert: !!kiste.limitiert, bis: kiste.bis || 0,
    doppeltAnteil: DOPPELT_ANTEIL, doppeltFrei: DOPPELT_FREI_CHIPS,
    stufen,
  };
}

const wuerfel = (n) => Math.floor(Math.random() * n);

/** Eine Stufe nach den Chancen der Kiste ziehen. */
function zieheStufe(kiste) {
  let r = Math.random() * 100;
  for (const s of STUFEN) {
    const p = kiste.chancen[s.id] || 0;
    if (!p) continue;
    if (r < p) return s;
    r -= p;
  }
  // Rundungsrest: die letzte belegte Stufe.
  const belegt = STUFEN.filter((s) => kiste.chancen[s.id]);
  return belegt[belegt.length - 1];
}

/**
 * Nur ziehen. Bucht nichts ab und schreibt nichts gut.
 *
 * Gebraucht vom Kisten-Duell (game/kistenDuell.js): dort ist längst bezahlt
 * (der Einsatz IST das Budget), und gehören tut das Stück noch niemandem,
 * solange nicht feststeht, wer gewinnt. `oeffne` kann beides nicht trennen,
 * also steht der reine Zug hier.
 */
function ziehe(kistenId) {
  const kiste = KISTEN[kistenId];
  if (!kiste || !laeuft(kiste)) return null;
  const t = topfVon(kiste);
  const stufe = zieheStufe(kiste);
  const liste = t[stufe.id];
  if (!liste || !liste.length) return null;
  const treffer = liste[wuerfel(liste.length)];
  return {
    art: treffer.art, id: treffer.id, wert: treffer.wert,
    label: cosmetics.label(treffer.art, treffer.id),
    look: cosmetics.vorschauDaten(treffer.art, treffer.id),
    stufe: { id: stufe.id, label: stufe.label, farbe: stufe.farbe },
    kiste: kiste.id, kisteLabel: kiste.label,
  };
}

/**
 * Eine Kiste öffnen.
 *
 * Gibt zurück, was drin war, ob es neu ist, und wenn nicht, wie viele Chips
 * es stattdessen gab. Die Chips bewegt der Aufrufer, hier wird nur gezogen
 * und der Besitz gesetzt.
 */
function oeffne(accounts, key, kistenId) {
  const kiste = KISTEN[kistenId];
  if (!kiste) return { ok: false, error: "Diese Kiste gibt es nicht." };
  if (!laeuft(kiste)) return { ok: false, error: `Die ${kiste.label} ist vorbei. Was daraus noch da ist, gibt es nur noch auf dem Markt.` };
  const acc = accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  if (kiste.frei) {
    const zuletzt = (acc.kisten && acc.kisten[kiste.id]) || 0;
    const rest = zuletzt + kiste.pauseMs - Date.now();
    if (rest > 0) return { ok: false, error: `Die ${kiste.label} gibt es wieder in ${Math.ceil(rest / 3600000)} Stunden.`, msLeft: rest };
  } else if ((acc.chips || 0) < kiste.preis) {
    return { ok: false, error: "Nicht genug Chips." };
  }

  const t = topfVon(kiste);
  const stufe = zieheStufe(kiste);
  const liste = t[stufe.id];
  if (!liste || !liste.length) return { ok: false, error: "Die Kiste ist leer, das ist ein Fehler im Haus." };
  const treffer = liste[wuerfel(liste.length)];

  if (kiste.preis) accounts.adjustChips(key, -kiste.preis);
  if (kiste.frei) {
    acc.kisten = acc.kisten || {};
    acc.kisten[kiste.id] = Date.now();
  }
  const neu = cosmetics.grant(acc, treffer.art, treffer.id, key);
  let zurueck = 0;
  if (!neu) {
    // Schon im Besitz: Chips statt eines zweiten, unsichtbaren Exemplars.
    zurueck = kiste.frei
      ? Math.round(DOPPELT_FREI_CHIPS * accounts.faucetFactor(acc.name))
      : Math.round(treffer.wert * DOPPELT_ANTEIL);
    if (zurueck) accounts.adjustChips(key, zurueck);
  }
  accounts.save();

  const st = neu ? praegung.stueckVon(key, treffer.art, treffer.id) : null;
  return {
    ok: true,
    kiste: { id: kiste.id, label: kiste.label, preis: kiste.preis, frei: !!kiste.frei },
    stufe: { id: stufe.id, label: stufe.label, farbe: stufe.farbe },
    treffer: {
      art: treffer.art, id: treffer.id,
      label: cosmetics.label(treffer.art, treffer.id),
      look: cosmetics.vorschauDaten(treffer.art, treffer.id),
      wert: treffer.wert,
      nr: st ? st.nr : null,
      serie: st ? st.serie : null,
    },
    neu, zurueck,
    account: accounts.publicAccount(acc),
  };
}

/*
 * Wie viele Felder die Rolle hat.
 *
 * Vierundvierzig, Treffer auf Platz 38. Ich hatte das zwischendurch auf 28
 * gekuerzt, weil eine Messung nach sekundenlangem Aufbau aussah — das war
 * falsch gemessen: das Vorschaufenster drosselt requestAnimationFrame auf
 * einen Takt alle sechs Sekunden, der Aufbau selbst kostet ein bis drei
 * Millisekunden. Die Laenge ist also frei waehlbar, und lang ist besser:
 * mehr Felder heissen mehr Weg in derselben Zeit, also mehr Tempo am
 * Anfang und ein laengerer Auslauf.
 */
const ROLLE_LAENGE = 44;
const ROLLE_TREFFER = 38;

/**
 * Die Rolle für die Animation.
 *
 * Der Client könnte sie selbst füllen, aber dann müsste er den ganzen Katalog
 * kennen, und die Stufe jedes Füllstücks stünde noch einmal bei ihm. Der
 * Server schickt die fertige Rolle mit, der Treffer steht auf einem festen
 * Platz weit hinten. Alles davor ist Deko und bewegt nichts.
 */
function rolle(kiste, treffer, laenge = ROLLE_LAENGE, trefferIndex = ROLLE_TREFFER) {
  const t = topfVon(kiste);
  const moeglich = [];
  for (const [stufe, pct] of Object.entries(kiste.chancen)) {
    for (const x of t[stufe] || []) moeglich.push({ ...x, stufe });
  }
  const out = [];
  for (let i = 0; i < laenge; i++) {
    if (i === trefferIndex) { out.push({ ...treffer, treffer: true }); continue; }
    const x = moeglich[wuerfel(moeglich.length)];
    const s = STUFEN.find((y) => y.id === x.stufe) || STUFEN[0];
    out.push({
      art: x.art, id: x.id,
      label: cosmetics.label(x.art, x.id),
      look: cosmetics.vorschauDaten(x.art, x.id),
      stufe: { id: s.id, label: s.label, farbe: s.farbe },
    });
  }
  return { felder: out, trefferIndex };
}

/* Dem Spieler selbst zusaetzlich Bescheid geben: der Chat rollt weg. */
function ack2(socket, fertig) {
  socket.emit("kiste:sammlung", { fertig });
}

/* Ziehungen, deren Ansage noch aussteht. Schluessel ist der Zug, Wert die
   Funktion, die ansagt — sie laeuft genau einmal, egal ob der Client sich
   meldet oder der Rueckfall-Timer zuschlaegt. */
const offeneZuege = new Map();
/* Wie viel Luft der Rueckfall ueber die gerechnete Dauer hinaus bekommt.
   Er soll nur greifen, wenn der Client GAR NICHT antwortet, nicht wenn er
   ein bisschen langsamer ist als gedacht. */
const RUECKFALL_MS = 6000;

function setupKisten(io, accounts) {
  pruefe();
  io.on("connection", (socket) => {
    socket.on("kiste:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account ? accounts.get(socket.data.account) : null;
      ack({ ok: true, ...oeffentlich(acc), chips: acc ? acc.chips : 0, ruhm: ruhm.tafel() });
    });

    socket.on("kiste:inhalt", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account ? accounts.get(socket.data.account) : null;
      const i = inhalt(acc, id);
      ack(i ? { ok: true, kiste: i } : { ok: false, error: "Diese Kiste gibt es nicht." });
    });

    socket.on("kiste:oeffne", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = oeffne(accounts, key, id);
      if (!r.ok) return ack(r);
      const kiste = KISTEN[id];
      ack({
        ok: true, ...r,
        rolle: rolle(kiste, { ...r.treffer, stufe: r.stufe }),
        schau: SCHAU,
      });
      /* Nur die oberen Stufen kommen in den Chat. Eine Holzkiste mit einem
         20.000er Avatar interessiert niemanden, und bei drei Leuten, die
         Kisten aufmachen, wäre der Chat sonst nur noch das. */
      /* Und falls damit gerade eine Kollektion voll geworden ist: das ist der
         seltenste Moment im Haus und gehoert in den Chat, egal aus welcher
         Kiste es kam. */
      /*
       * Alles, was andere erfahren, erst NACH der Schau.
       *
       * Wann die vorbei ist, RAET der Server nicht mehr. Er hat es
       * gerechnet (`SCHAU_MS`), und auf einem langsamen Geraet war die
       * Bahn danach immer noch unterwegs — die Ansage stand dann wieder
       * im Chat, bevor die Kiste offen war. Jetzt sagt der Client
       * Bescheid, und der Timer ist nur noch der Rueckfall fuer den Fall,
       * dass er es nicht tut (Tab zu, Verbindung weg). Was zuerst kommt,
       * gewinnt; `offen` sorgt dafuer, dass es genau einmal passiert.
       */
      const zug = { id: `${key}-${Date.now()}`, offen: true };
      const ansagen = () => {
        if (!zug.offen) return;
        zug.offen = false;
        offeneZuege.delete(zug.id);
        nachDerSchau(io, accounts, socket, key, kiste, r);
      };
      offeneZuege.set(zug.id, ansagen);
      zug.timer = setTimeout(ansagen, SCHAU_MS + RUECKFALL_MS);
      socket.emit("kiste:zug", { zugId: zug.id });
    });

    /* Der Browser ist mit der Schau durch. */
    socket.on("kiste:fertig", ({ zugId } = {}) => {
      const fn = offeneZuege.get(String(zugId || ""));
      if (fn) fn();
    });
  });
}

/* Was passiert, wenn die Kiste im Browser aufgegangen ist: Kollektion
   ansagen, auf die Ruhmestafel, in den Chat. */
function nachDerSchau(io, accounts, socket, key, kiste, r) {
  try {
    if (r.neu) ruhm.melde(key, { ...r.treffer, stufe: r.stufe, kisteLabel: kiste.label });
    const fertig = cosmetics.sammlungAnsage(io, accounts, key);
    if (fertig.length) ack2(socket, fertig);
    const serienRang = r.treffer.serie && r.treffer.serie.id;
    if (r.neu && (r.stufe.id === "legendaer" || r.stufe.id === "mythisch" || r.stufe.id === "kiste"
      || serienRang === "gold" || serienRang === "jackpot")) {
      const acc = accounts.get(key);
      if (acc) {
        /* "aus der Schwarze Kiste" war falsch. Mit "öffnet die …" stimmt der
           Fall bei allen drei Kisten, ohne dass irgendwo ein Artikel
           mitgepflegt werden muss. */
        /* Die Art gehoert dazu. "zieht Krone" ist zweideutig: es gibt einen
           Namensstil und ein Chat-Zeichen mit demselben Namen, und im Chat
           steht sonst eine Meldung, die niemand einordnen kann. */
        const art = cosmetics.ART_NAME[r.treffer.art] || "";
        const serie = r.treffer.serie;
        const serienText = serie && serie.id !== "standard"
          ? ` mit ${serie.label} #${serie.code}` : "";
        const satz = `${acc.name} öffnet die ${kiste.label} und zieht „${r.treffer.label}“`
          + `${art ? ` (${art}, ${r.stufe.label})` : ` (${r.stufe.label})`}${serienText}.`;
        chat.announce(io, satz);
        try { require("./chronik").notiere("event", satz, { user: acc.name, wert: r.treffer.wert }); } catch {}
      }
    }
  } catch (e) {
    console.error("kisten: Ansage nach der Ziehung ging schief —", e.message);
  }
}

module.exports = { setupKisten, oeffentlich, inhalt, oeffne, ziehe, rolle, laeuft, gratisFrei, KISTEN, STUFEN, stufeVon, pruefe, SCHAU, SCHAU_MS };
