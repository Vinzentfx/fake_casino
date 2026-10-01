"use strict";

/*
 * Die Räume der Welt und die Regeln, wo man stehen darf.
 *
 * Diese Datei liest der Browser UND der Server (game/welt.js holt sie per
 * require). Das ist Absicht: die Kollision muss auf beiden Seiten gleich
 * rechnen. Der Browser bewegt die eigene Figur sofort, der Server prüft
 * danach nach denselben Regeln nach. Stünden die Tische in zwei Dateien,
 * käme irgendwann jemand im Browser an einem Tisch vorbei, den der Server
 * noch an der alten Stelle sieht, und würde bei jedem Schritt zurückgesetzt.
 *
 * Alle Maße sind Kacheln. Eine Kachel ist im Browser 48 Pixel breit, bevor
 * die Kamera skaliert. y wächst nach unten, die Rückwand liegt oben.
 *
 * Ein Ding hat:
 *   art     wie es gezeichnet wird (public/js/welt/welt.js kennt die Arten)
 *   x, y    Mitte der Grundlinie, dort steht es auf dem Boden
 *   block   Rechteck [x1, y1, x2, y2], durch das niemand läuft
 *   nutz    wo man stehen muss: ein Punkt {x, y, r} oder "rand" (Abstand
 *           zum Block, für Tische, an die man von allen Seiten tritt)
 *   ziel    was sich öffnet: { screen } oder { auswahl: [screens] }
 *   fokus   wohin die Kamera beim Öffnen fährt, und wie nah
 */
(function (wurzel) {
  const KACHEL = 48;
  const FUSS = 0.28;          // Radius der Füße, gegen Wände und Möbel
  const TEMPO = 4.2;          // Kacheln je Sekunde
  /* Auf einem Fahrzeug geht es etwas schneller. Nur im Raum, am Spiel
     ändert das nichts. */
  const FAHRZEUG_FAKTOR = 1.35;
  const RAND_REICHWEITE = 0.95;

  /* Wie viele Möglichkeiten die kostenlose Grundform je Feld hat. Die
     Farben selbst stehen in public/js/welt/figur.js; der Server prüft nur,
     dass die Zahl im Bereich liegt. */
  const GRUNDFORM = { haut: 6, haar: 7, frisur: 5, hose: 5 };

  const RAEUME = {
    casino: {
      id: "casino",
      name: "Casino",
      w: 20, h: 13,
      wand: 3,                 // so tief reicht die Rückwand in den Raum
      /* Begehbare Flächen. Die Nische der Tür ragt absichtlich ein ganzes
         Stück in den Hauptraum hinein: beide Flächen werden um den Fuß
         verkleinert, und ohne Überlappung bliebe an der Naht ein Streifen,
         in dem man hängen bleibt. */
      flaechen: [
        [0.7, 3.0, 19.3, 12.4],
        [18.0, 6.6, 20.0, 8.3],
        [0.0, 4.3, 2.0, 5.9],
        [16.4, 11.4, 18.0, 13.0],
      ],
      start: { x: 10, y: 11.6, d: "hoch" },
      tueren: [
        { id: "zum-kontor", x1: 19.6, y1: 6.6, x2: 20.0, y2: 8.3, ziel: "kontor", ankunft: { x: 1.4, y: 7.1, d: "rechts" },
          label: "Zum Kontor", schild: { x: 19.1, y: 6.0 } },
        { id: "zur-ruhmeshalle", x1: 0.0, y1: 4.3, x2: 0.4, y2: 5.9, ziel: "ruhm", ankunft: { x: 12.6, y: 5.6, d: "links" },
          label: "Ruhmeshalle", schild: { x: 1.1, y: 3.95 } },
        { id: "zur-terrasse", x1: 16.4, y1: 12.6, x2: 18.0, y2: 13.0, ziel: "hof", ankunft: { x: 1.4, y: 6.4, d: "rechts" },
          label: "Terrasse", schild: { x: 17.2, y: 12.2 } },
        { id: "zur-spielhalle", x1: 14.0, y1: 2.95, x2: 16.2, y2: 3.32, ziel: "spielhalle", ankunft: { x: 8.0, y: 9.7, d: "hoch" },
          label: "Spielhalle", schild: { x: 15.1, y: 3.75 } },
      ],
      sitze: [
        { id: "sofa-1", x: 1.25, y: 7.55, d: "rechts", auf: { x: 2.15, y: 7.55 } },
        { id: "sofa-2", x: 1.25, y: 8.75, d: "rechts", auf: { x: 2.15, y: 8.75 } },
        { id: "sessel", x: 4.45, y: 11.35, d: "hoch", auf: { x: 4.45, y: 10.45 } },
        /* Plätze an den Spieltischen. Man setzt sich nicht von Hand, sondern
           der Server setzt einen hin, wenn man den Tisch benutzt: dann sieht
           der ganze Raum, wer gerade Karten spielt. `tisch` sagt, zu welchem
           Ding der Platz gehört. Blackjack sitzt man auf den vier Feldern der
           Rundung, beim Poker auch gegenüber, von vorn hinter dem Tisch. */
        { id: "bj-1", tisch: "blackjack", x: 14.25, y: 6.5, d: "hoch", auf: { x: 14.25, y: 7.1 } },
        { id: "bj-2", tisch: "blackjack", x: 14.88, y: 6.62, d: "hoch", auf: { x: 14.88, y: 7.2 } },
        { id: "bj-3", tisch: "blackjack", x: 15.53, y: 6.62, d: "hoch", auf: { x: 15.53, y: 7.2 } },
        { id: "bj-4", tisch: "blackjack", x: 16.15, y: 6.5, d: "hoch", auf: { x: 16.15, y: 7.1 } },
        { id: "poker-1", tisch: "poker", x: 14.4, y: 10.5, d: "hoch", auf: { x: 14.4, y: 11.1 } },
        { id: "poker-2", tisch: "poker", x: 15.2, y: 10.55, d: "hoch", auf: { x: 15.2, y: 11.15 } },
        { id: "poker-3", tisch: "poker", x: 16.0, y: 10.5, d: "hoch", auf: { x: 16.0, y: 11.1 } },
        { id: "poker-4", tisch: "poker", x: 14.6, y: 8.9, d: "runter", auf: { x: 14.6, y: 8.35 } },
        { id: "poker-5", tisch: "poker", x: 15.8, y: 8.9, d: "runter", auf: { x: 15.8, y: 8.35 } },
      ],
      dinge: [
        { id: "garderobe", art: "garderobe", x: 1.7, y: 3.35, block: [0.7, 2.4, 2.75, 3.45],
          nutz: { x: 1.7, y: 4.05, r: 1.25 }, label: "Garderobe", verb: "Umziehen",
          ziel: { screen: "cosmetics" }, fokus: { x: 1.7, y: 2.6, zoom: 2.1 } },
        { id: "slot-lucky7", art: "slot", farbe: "rot", x: 3.9, y: 3.4, block: [3.35, 2.4, 4.45, 3.45],
          nutz: { x: 3.9, y: 4.1, r: 0.95 }, label: "Lucky 7s", verb: "Spielen",
          ziel: { screen: "slots", maschine: "lucky7" }, fokus: { x: 3.9, y: 2.7, zoom: 2.6 } },
        { id: "slot-gemstorm", art: "slot", farbe: "blau", x: 5.2, y: 3.4, block: [4.65, 2.4, 5.75, 3.45],
          nutz: { x: 5.2, y: 4.1, r: 0.95 }, label: "Gem Storm", verb: "Spielen",
          ziel: { screen: "slots", maschine: "gemstorm" }, fokus: { x: 5.2, y: 2.7, zoom: 2.6 } },
        { id: "slot-algae", art: "slot", farbe: "tuerkis", x: 6.5, y: 3.4, block: [5.95, 2.4, 7.05, 3.45],
          nutz: { x: 6.5, y: 4.1, r: 0.95 }, label: "Algen Abyss", verb: "Spielen",
          ziel: { screen: "slots", maschine: "algae" }, fokus: { x: 6.5, y: 2.7, zoom: 2.6 } },
        { id: "slot-pharaoh", art: "slot", farbe: "gold", x: 7.8, y: 3.4, block: [7.25, 2.4, 8.35, 3.45],
          nutz: { x: 7.8, y: 4.1, r: 0.95 }, label: "Book of Rah", verb: "Spielen",
          ziel: { screen: "slots", maschine: "pharaoh" }, fokus: { x: 7.8, y: 2.7, zoom: 2.6 } },
        { id: "gluecksrad", art: "rad", x: 9.95, y: 3.3, block: null,
          nutz: { x: 9.95, y: 3.9, r: 1.2 }, label: "Glücksrad", verb: "Drehen",
          ziel: { screen: "wheel", rad: true }, fokus: { x: 9.95, y: 2.0, zoom: 2.3 } },
        { id: "schild", art: "schild", x: 12.5, y: 3.0, block: null },
        /* Die Laufschrift oben an der Rückwand zeigt den Live-Feed. Wer
           darauf tippt, landet in der Übersicht beim Feed. */
        { id: "laufschrift", art: "laufschrift", x: 4.4, y: 1.05, block: null, breite: 7.6,
          nutz: { x: 4.4, y: 3.9, r: 0 }, label: "Live-Feed", verb: "Ansehen", ziel: { ansicht: "feed" } },
        /* Der Torbogen in der Rückwand führt in die Spielhalle. Vorher stand
           hier ein Automat, der eine Liste aufmachte; jetzt hat jedes der
           kleinen Spiele dahinter seinen eigenen Platz. */
        { id: "torbogen", art: "torbogen", x: 15.1, y: 3.0, block: null },
        { id: "wettschalter", art: "wettschalter", x: 18.3, y: 3.45, block: [17.3, 2.4, 19.3, 3.5],
          nutz: { x: 18.3, y: 4.2, r: 1.4 }, label: "Wettschalter", verb: "Wetten",
          /* Nur Sportwetten: Rennbahn und Lotterie stehen auf der Terrasse, und
             zwei Wege zum selben Spiel im selben Haus machen den Raum unklar. */
          ziel: { screen: "sports" }, fokus: { x: 18.3, y: 2.6, zoom: 2.2 } },
        { id: "roulette", art: "roulette", x: 9.8, y: 7.8, block: [8.2, 6.3, 11.4, 7.8],
          nutz: "rand", label: "Roulette", verb: "Setzen",
          ziel: { screen: "roulette", tisch: "roulette" }, fokus: { x: 9.8, y: 7.4, zoom: 2.6 } },
        { id: "blackjack", art: "blackjack", x: 15.2, y: 6.2, block: [13.8, 5.1, 16.6, 6.2],
          nutz: "rand", label: "Blackjack", verb: "Hinsetzen",
          ziel: { screen: "blackjack" }, fokus: { x: 15.2, y: 5.6, zoom: 2.3 } },
        { id: "poker", art: "poker", x: 15.2, y: 10.2, block: [13.8, 9.0, 16.6, 10.2],
          nutz: "rand", label: "Poker", verb: "Platz nehmen",
          ziel: { screen: "poker" }, fokus: { x: 15.2, y: 9.6, zoom: 2.3 } },
        // Hocker ohne Block: wer am Tisch steht, soll nicht an ihnen hängen bleiben.
        ...[["bj-1", 14.25, 6.5], ["bj-2", 14.88, 6.62], ["bj-3", 15.53, 6.62], ["bj-4", 16.15, 6.5],
          ["poker-1", 14.4, 10.5], ["poker-2", 15.2, 10.55], ["poker-3", 16.0, 10.5]]
          .map(([id, x, y]) => ({ id: "hocker-" + id, art: "hocker", x, y: y - 0.02, block: null })),
        { id: "sofa", art: "sofa", x: 1.2, y: 9.4, block: [0.7, 6.9, 1.75, 9.4] },
        { id: "couchtisch", art: "couchtisch", x: 3.15, y: 8.6, block: [2.75, 7.7, 3.55, 8.6] },
        { id: "sessel", art: "sessel", x: 4.45, y: 11.8, block: [3.95, 10.85, 4.95, 11.8] },
        { id: "spieltisch", art: "spieltisch", x: 6.6, y: 10.7, block: [5.9, 9.9, 7.3, 10.7],
          nutz: "rand", label: "Spieltisch", verb: "Duell wählen",
          ziel: { auswahl: ["chess", "memory", "sudoku", "kniffel", "solitaire"] }, fokus: { x: 6.6, y: 10.2, zoom: 2.3 } },
        { id: "kisten", art: "kisten", x: 1.5, y: 12.4, block: [0.7, 11.4, 2.3, 12.4],
          nutz: { x: 2.2, y: 11.0, r: 1.35 }, label: "Kisten", verb: "Öffnen",
          ziel: { screen: "kiste" }, fokus: { x: 1.5, y: 11.6, zoom: 2.3 } },
        /* Der Tagesbericht als Zeitung, gleich neben der Tür: wer reinkommt,
           steht davor. Er öffnet dieselbe Zeitung wie das Menü. */
        { id: "zeitung", art: "zeitungsstaender", x: 8.05, y: 12.4, block: [7.75, 12.0, 8.35, 12.4],
          nutz: { x: 8.05, y: 11.55, r: 1.2 }, label: "Casino-Kurier", verb: "Lesen", ziel: { bericht: true } },
        { id: "pflanze-1", art: "pflanze", x: 12.0, y: 12.4, block: [11.65, 11.95, 12.35, 12.4] },
        { id: "pflanze-2", art: "pflanze", x: 19.0, y: 12.4, block: [18.65, 11.95, 19.3, 12.4] },
        { id: "pflanze-3", art: "pflanze", x: 12.3, y: 3.45, block: [11.95, 3.0, 12.65, 3.45] },
      ],
    },

    kontor: {
      id: "kontor",
      name: "Kontor",
      w: 16, h: 12,
      wand: 3,
      flaechen: [
        [0.7, 3.0, 15.3, 11.4],
        [0.0, 6.3, 2.0, 7.9],
      ],
      start: { x: 1.4, y: 7.1, d: "rechts" },
      tueren: [
        { id: "zum-casino", x1: 0.0, y1: 6.3, x2: 0.4, y2: 7.9, ziel: "casino", ankunft: { x: 18.6, y: 7.45, d: "links" },
          label: "Zum Casino", schild: { x: 0.9, y: 5.7 } },
        /* Versteckt: nicht zu Fuß zu erreichen, nur über das Regal. */
        { id: "geheimgang", versteckt: true, x1: 7.9, y1: 2.4, x2: 9.3, y2: 3.45, ziel: "tresor", ankunft: { x: 5, y: 7.4, d: "hoch" } },
      ],
      sitze: [],
      dinge: [
        { id: "boersentafel", art: "boerse", x: 4.6, y: 3.0, block: null,
          nutz: { x: 4.6, y: 3.8, r: 1.9 }, label: "Börsentafel", verb: "Handeln",
          ziel: { screen: "stocks" }, fokus: { x: 4.6, y: 1.8, zoom: 2.0 } },
        { id: "bank", art: "bank", x: 12.9, y: 3.6, block: [10.6, 2.4, 15.3, 3.6],
          nutz: { x: 12.9, y: 4.3, r: 1.7 }, label: "Bankschalter", verb: "Zum Schalter",
          ziel: { screen: "bank" }, fokus: { x: 12.9, y: 2.8, zoom: 2.0 } },
        { id: "stadtkarte", art: "kartentisch", x: 8.0, y: 8.3, block: [5.6, 5.9, 10.4, 8.3],
          nutz: "rand", label: "Stadtkarte", verb: "Karte ansehen",
          ziel: { screen: "businesses" }, fokus: { x: 8.0, y: 7.0, zoom: 2.4 } },
        { id: "arbeit", art: "schreibtisch", x: 13.5, y: 9.9, block: [12.4, 9.0, 14.6, 9.9],
          nutz: "rand", label: "Schreibtisch", verb: "Arbeiten",
          ziel: { screen: "work" }, fokus: { x: 13.5, y: 9.3, zoom: 2.4 } },
        { id: "markt", art: "markt", x: 2.6, y: 10.4, block: [1.4, 9.5, 3.8, 10.4],
          nutz: "rand", label: "Markt", verb: "Stöbern",
          ziel: { screen: "market" }, fokus: { x: 2.6, y: 9.8, zoom: 2.4 } },
        { id: "auktion", art: "pult", x: 8.0, y: 11.2, block: [7.55, 10.6, 8.45, 11.2],
          nutz: { x: 8.0, y: 10.0, r: 1.2 }, label: "Auktionspult", verb: "Bieten",
          ziel: { screen: "auktion" }, fokus: { x: 8.0, y: 10.6, zoom: 2.5 } },
        /* Sieht aus wie jedes Regal. Ein Buch steht etwas vor. */
        { id: "regal", art: "regal", x: 8.6, y: 3.45, block: [7.9, 2.4, 9.3, 3.45], geheim: true,
          nutz: { x: 8.6, y: 4.1, r: 0.8 }, label: "Bücherregal", verb: "Buch ziehen",
          ziel: { tuer: "geheimgang" }, fokus: { x: 8.6, y: 2.6, zoom: 2.4 } },
        { id: "k-pflanze-1", art: "pflanze", x: 15.0, y: 11.4, block: [14.65, 10.95, 15.3, 11.4] },
        { id: "k-pflanze-2", art: "pflanze", x: 1.0, y: 3.45, block: [0.7, 3.0, 1.35, 3.45] },
      ],
    },
  };

  /* Die Ruhmeshalle: Bestenliste als Podest mit den echten Figuren der drei
     Reichsten, Rekorde, Statistik, Season, Aufträge und Kalender. Alles,
     was vorher nur im Menü stand. */
  RAEUME.ruhm = {
    id: "ruhm", name: "Ruhmeshalle", w: 14, h: 11, wand: 3, boden: "marmor",
    flaechen: [[0.7, 3.0, 13.3, 10.4], [12.0, 4.8, 14.0, 6.4]],
    start: { x: 12.6, y: 5.6, d: "links" },
    tueren: [
      { id: "zum-casino", x1: 13.6, y1: 4.8, x2: 14.0, y2: 6.4, ziel: "casino", ankunft: { x: 1.4, y: 5.1, d: "rechts" },
        label: "Zum Casino", schild: { x: 13.1, y: 4.3 } },
    ],
    sitze: [],
    dinge: [
      { id: "podest", art: "podest", x: 7, y: 5.2, block: [4.9, 4.0, 9.1, 5.2],
        nutz: "rand", label: "Bestenliste", verb: "Ansehen", ziel: { screen: "leaderboard" }, fokus: { x: 7, y: 3.6, zoom: 2 } },
      { id: "rekordtafel", art: "rekordtafel", x: 2.6, y: 3.0, block: null, breite: 3.4,
        nutz: { x: 2.6, y: 3.8, r: 1.5 }, label: "Wochenrekorde", verb: "Ansehen", ziel: { ansicht: "rekorde" }, fokus: { x: 2.6, y: 1.8, zoom: 2.2 } },
      { id: "tv", art: "fernseher", x: 11.2, y: 3.0, block: null, breite: 3.2,
        nutz: { x: 11.2, y: 3.8, r: 1.5 }, label: "Live-Feed", verb: "Ansehen", ziel: { ansicht: "feed" }, fokus: { x: 11.2, y: 1.8, zoom: 2.2 } },
      { id: "statistik", art: "statistikpult", x: 2.2, y: 8.9, block: [1.4, 8.3, 3.0, 8.9],
        nutz: "rand", label: "Statistik", verb: "Nachsehen", ziel: { screen: "stats" }, fokus: { x: 2.2, y: 8.4, zoom: 2.4 } },
      { id: "season", art: "seasonbanner", x: 5.4, y: 9.6, block: [4.9, 9.2, 5.9, 9.6],
        nutz: { x: 5.4, y: 8.6, r: 1.1 }, label: "Season-Pass", verb: "Ansehen", ziel: { screen: "season" }, fokus: { x: 5.4, y: 8.4, zoom: 2.4 } },
      { id: "auftraege", art: "auftragsbrett", x: 8.8, y: 9.6, block: [7.9, 9.2, 9.7, 9.6],
        nutz: { x: 8.8, y: 8.6, r: 1.2 }, label: "Aufträge", verb: "Ansehen", ziel: { screen: "quests" }, fokus: { x: 8.8, y: 8.4, zoom: 2.4 } },
      { id: "kalender", art: "kalender", x: 5.3, y: 3.0, block: null,
        nutz: { x: 5.3, y: 3.7, r: 0 }, label: "Eventkalender", verb: "Ansehen", ziel: { screen: "calendar" } },
      { id: "vitrine", art: "vitrine", x: 12, y: 10.2, block: [11.2, 9.5, 12.8, 10.2] },
      { id: "r-pflanze", art: "pflanze", x: 1.0, y: 3.45, block: [0.7, 3.0, 1.35, 3.45] },
    ],
  };

  /* Die Terrasse: draußen, Nachthimmel über Porta, Rennbahn und
     Lotteriebude. Irgendwo im Gras liegt etwas. */
  RAEUME.hof = {
    id: "hof", name: "Terrasse", w: 16, h: 11, wand: 3, boden: "wiese", himmel: true,
    flaechen: [[0.7, 3.0, 15.3, 10.4], [0.0, 5.6, 2.0, 7.2], [14.0, 5.6, 16.0, 7.2]],
    start: { x: 1.4, y: 6.4, d: "rechts" },
    tueren: [
      { id: "zum-casino", x1: 0.0, y1: 5.6, x2: 0.4, y2: 7.2, ziel: "casino", ankunft: { x: 17.2, y: 11.6, d: "hoch" },
        label: "Zum Casino", schild: { x: 1.0, y: 5.1 } },
      { id: "zur-strasse", x1: 15.6, y1: 5.6, x2: 16.0, y2: 7.2, ziel: "strasse", ankunft: { x: 1.4, y: 6.6, d: "rechts" },
        label: "Ladenstraße", schild: { x: 14.9, y: 5.1 } },
    ],
    sitze: [
      { id: "bank-1", x: 7.4, y: 9.8, d: "hoch", auf: { x: 7.4, y: 8.95 } },
      { id: "bank-2", x: 8.8, y: 9.8, d: "hoch", auf: { x: 8.8, y: 8.95 } },
      /* Die Shisha-Ecke: vier Kissen um eine Pfeife. Man setzt sich über die
         Pfeife selbst (wie am Kartentisch), nicht über ein einzelnes Kissen. */
      { id: "shisha-1", tisch: "shisha", x: 10.4, y: 7.95, d: "rechts", auf: { x: 10.4, y: 8.6 } },
      { id: "shisha-2", tisch: "shisha", x: 12.8, y: 7.95, d: "links", auf: { x: 12.8, y: 8.6 } },
      { id: "shisha-3", tisch: "shisha", x: 11.6, y: 6.85, d: "runter", auf: { x: 10.9, y: 6.6 } },
      { id: "shisha-4", tisch: "shisha", x: 11.6, y: 9.05, d: "hoch", auf: { x: 11.6, y: 9.6 } },
    ],
    dinge: [
      { id: "rennbahn", art: "rennbahn", x: 5.2, y: 3.5, block: [2.4, 2.4, 8.0, 3.5],
        nutz: { x: 5.2, y: 4.2, r: 1.9 }, label: "Rennbahn", verb: "Wetten", ziel: { screen: "horses", rennen: true }, fokus: { x: 5.2, y: 2.6, zoom: 2 } },
      { id: "lotterie", art: "lotteriebude", x: 12.6, y: 3.6, block: [11.0, 2.4, 14.2, 3.6],
        nutz: { x: 12.6, y: 4.3, r: 1.6 }, label: "Lotteriebude", verb: "Tippen", ziel: { screen: "lotterie", lotto: true }, fokus: { x: 12.6, y: 2.6, zoom: 2.1 } },
      { id: "fahne", art: "fahnenmast", x: 14.4, y: 8.2, block: [14.1, 7.9, 14.7, 8.2],
        nutz: { x: 14.0, y: 8.7, r: 1.1 }, label: "Clans", verb: "Banner ansehen", ziel: { screen: "clans" }, fokus: { x: 14.4, y: 6.6, zoom: 2.2 } },
      { id: "feuer", art: "feuerschale", x: 8.1, y: 6.9, block: [7.6, 6.4, 8.6, 6.9] },
      { id: "shisha", art: "shisha", x: 11.6, y: 7.95, block: [11.35, 7.6, 11.85, 7.95],
        nutz: "rand", label: "Shisha", verb: "Hinsetzen", ziel: { shisha: true }, fokus: { x: 11.6, y: 7.4, zoom: 2.4 } },
      ...[["kissen-1", 10.4, 8.05, "rot"], ["kissen-2", 12.8, 8.05, "blau"], ["kissen-3", 11.6, 6.95, "gold"], ["kissen-4", 11.6, 9.15, "gruen"]]
        .map(([id, x, y, farbe]) => ({ id, art: "sitzkissen", farbe, x, y, block: null })),
      { id: "parkbank", art: "parkbank", x: 8.1, y: 10.4, block: [6.7, 9.5, 9.5, 10.4] },
      { id: "laterne-1", art: "laterne", x: 3.0, y: 9.9, block: [2.8, 9.7, 3.2, 9.9] },
      { id: "laterne-2", art: "laterne", x: 13.5, y: 9.9, block: [13.3, 9.7, 13.7, 9.9] },
      { id: "busch-1", art: "busch", x: 1.4, y: 10.3, block: [0.8, 9.8, 2.0, 10.3] },
      { id: "busch-2", art: "busch", x: 14.6, y: 10.3, block: [14.0, 9.8, 15.2, 10.3] },
      /* Klein, dunkel, ohne Leuchten. Der Hinweis erscheint erst, wenn man
         praktisch darauf steht. */
      { id: "kleeblatt", art: "kleeblatt", x: 4.3, y: 9.35, block: null, geheim: true,
        nutz: { x: 4.3, y: 9.35, r: 0.55 }, label: "Etwas im Gras", verb: "Aufheben", ziel: { geheimnis: "kleeblatt" } },
    ],
  };

  /*
   * Die Ladenstraße hinter der Terrasse: Zoohandlung, Autohaus und Kiosk,
   * jeder mit eigener Fassade (game/laeden.js). Ganz hinten rechts ein
   * altes Garagentor, das nach nichts aussieht.
   */
  RAEUME.strasse = {
    id: "strasse", name: "Ladenstraße", w: 18, h: 11, wand: 3, boden: "pflaster", himmel: true,
    flaechen: [[0.7, 3.0, 17.3, 10.4], [0.0, 5.8, 2.0, 7.4]],
    start: { x: 1.4, y: 6.6, d: "rechts" },
    tueren: [
      { id: "zur-terrasse", x1: 0.0, y1: 5.8, x2: 0.4, y2: 7.4, ziel: "hof", ankunft: { x: 14.8, y: 6.4, d: "links" },
        label: "Zur Terrasse", schild: { x: 1.0, y: 5.3 } },
      /* Hinter dem Garagentor. Zu Fuß kommt man nie hinein: das Tor
         selbst ist der Weg, und es ist abgeschlossen, bis man weiß wie. */
      { id: "zur-garage", versteckt: true, verschlossen: true, x1: 15.6, y1: 2.4, x2: 17.2, y2: 3.5, ziel: "garage", ankunft: { x: 4.5, y: 5.7, d: "hoch" } },
    ],
    sitze: [
      { id: "strassenbank-1", x: 2.6, y: 9.8, d: "hoch", auf: { x: 2.6, y: 8.95 } },
      { id: "strassenbank-2", x: 4.0, y: 9.8, d: "hoch", auf: { x: 4.0, y: 8.95 } },
    ],
    dinge: [
      { id: "zoo", art: "ladenfront", laden: "zoo", x: 3.6, y: 3.5, block: [1.0, 2.4, 6.2, 3.5],
        nutz: { x: 3.6, y: 4.3, r: 1.7 }, label: "Zoohandlung", verb: "Reingehen", ziel: { screen: "laeden", laden: "zoo" }, fokus: { x: 3.6, y: 2.4, zoom: 1.9 } },
      { id: "autohaus", art: "ladenfront", laden: "autohaus", x: 9.4, y: 3.5, block: [6.6, 2.4, 12.2, 3.5],
        nutz: { x: 9.4, y: 4.3, r: 1.8 }, label: "Autohaus", verb: "Reingehen", ziel: { screen: "laeden", laden: "autohaus" }, fokus: { x: 9.4, y: 2.4, zoom: 1.9 } },
      { id: "kiosk", art: "ladenfront", laden: "kiosk", x: 14.0, y: 3.5, block: [12.6, 2.4, 15.4, 3.5],
        nutz: { x: 14.0, y: 4.3, r: 1.3 }, label: "Kiosk", verb: "Was holen", ziel: { screen: "laeden", laden: "kiosk" }, fokus: { x: 14.0, y: 2.5, zoom: 2.2 } },
      /* Klein, ohne Leuchten, der Hinweis erst ganz nah. Wer rüttelt, hört
         nichts; auf das Kritzeln am Tor muss man selbst kommen. */
      { id: "garage", art: "garagentor", x: 16.4, y: 3.5, block: [15.6, 2.4, 17.2, 3.5], geheim: true,
        nutz: { x: 16.4, y: 4.2, r: 0.75 }, label: "Altes Garagentor", verb: "Rütteln", ziel: { tuer: "zur-garage" } },
      { id: "litfass", art: "litfass", x: 9.4, y: 7.5, block: [9.0, 7.0, 9.8, 7.5] },
      { id: "strassenbank", art: "parkbank", x: 3.3, y: 10.4, block: [1.9, 9.5, 4.7, 10.4] },
      { id: "laterne-s1", art: "laterne", x: 6.4, y: 9.9, block: [6.2, 9.7, 6.6, 9.9] },
      { id: "laterne-s2", art: "laterne", x: 12.6, y: 9.9, block: [12.4, 9.7, 12.8, 9.9] },
      { id: "busch-s1", art: "busch", x: 16.6, y: 10.3, block: [16.0, 9.8, 17.2, 10.3] },
      { id: "kuebel-1", art: "pflanze", x: 6.4, y: 4.0, block: [6.2, 3.7, 6.6, 4.0] },
      { id: "kuebel-2", art: "pflanze", x: 12.4, y: 4.0, block: [12.25, 3.7, 12.55, 4.0] },
    ],
  };

  /* Die Garage hinter dem alten Tor. Darin steht unter einer Plane, was
     seit Jahren nicht mehr angesprungen ist. */
  RAEUME.garage = {
    id: "garage", name: "Garage", w: 9, h: 7, wand: 3, boden: "stein", geheim: true,
    flaechen: [[0.7, 3.0, 8.3, 6.4], [3.7, 5.6, 5.3, 7.0]],
    start: { x: 4.5, y: 5.7, d: "hoch" },
    tueren: [
      { id: "raus", x1: 3.7, y1: 6.6, x2: 5.3, y2: 7.0, ziel: "strasse", ankunft: { x: 16.4, y: 4.3, d: "runter" },
        label: "Raus", schild: { x: 4.5, y: 6.2 } },
    ],
    sitze: [],
    dinge: [
      { id: "plane", art: "planenauto", x: 4.5, y: 4.7, block: [2.4, 3.6, 6.6, 4.7],
        nutz: "rand", label: "Etwas unter einer Plane", verb: "Plane lüften", ziel: { geheimnis: "e46" }, fokus: { x: 4.5, y: 3.9, zoom: 2.4 } },
      { id: "werkbank", art: "werkbank", x: 1.6, y: 3.45, block: [0.8, 2.4, 2.4, 3.45] },
      { id: "reifen", art: "reifenstapel", x: 7.6, y: 3.5, block: [7.1, 2.9, 8.1, 3.5] },
    ],
  };

  /*
   * Die Spielhalle hinter dem Torbogen: die kleinen Spiele, jedes mit
   * eigenem Automaten oder Tisch. Neon statt Gold, damit man sofort merkt,
   * dass hier ein anderer Ton herrscht als im Casino davor.
   */
  RAEUME.spielhalle = {
    id: "spielhalle", name: "Spielhalle", w: 16, h: 11, wand: 3, boden: "neon", neon: true,
    flaechen: [
      [0.7, 3.0, 15.3, 10.4],
      [7.2, 9.6, 8.8, 11.0],
    ],
    start: { x: 8.0, y: 9.7, d: "hoch" },
    tueren: [
      { id: "zum-casino", x1: 7.2, y1: 10.6, x2: 8.8, y2: 11.0, ziel: "casino", ankunft: { x: 15.1, y: 4.1, d: "runter" },
        label: "Zum Casino", schild: { x: 8.0, y: 10.2 } },
    ],
    sitze: [
      { id: "sitzsack-1", x: 1.7, y: 9.4, d: "rechts", auf: { x: 2.5, y: 9.4 } },
      { id: "sitzsack-2", x: 14.3, y: 9.4, d: "links", auf: { x: 13.5, y: 9.4 } },
      // An den Tischen sitzt man auf den Leuchthockern; der Tisch setzt einen hin.
      { id: "wuerfel-1", tisch: "wuerfel", x: 2.75, y: 8.2, d: "hoch", auf: { x: 2.75, y: 8.75 } },
      { id: "wuerfel-2", tisch: "wuerfel", x: 4.25, y: 8.2, d: "hoch", auf: { x: 4.25, y: 8.75 } },
      { id: "hilo-1", tisch: "hilo", x: 11.75, y: 8.2, d: "hoch", auf: { x: 11.75, y: 8.75 } },
      { id: "hilo-2", tisch: "hilo", x: 13.25, y: 8.2, d: "hoch", auf: { x: 13.25, y: 8.75 } },
    ],
    dinge: [
      { id: "crash", art: "arcade", spiel: "crash", x: 2.0, y: 3.45, block: [1.38, 2.4, 2.62, 3.45],
        nutz: { x: 2.0, y: 4.15, r: 0.95 }, label: "Crash", verb: "Spielen", ziel: { screen: "crash" }, fokus: { x: 2.0, y: 2.5, zoom: 2.4 } },
      { id: "mines", art: "arcade", spiel: "mines", x: 3.7, y: 3.45, block: [3.08, 2.4, 4.32, 3.45],
        nutz: { x: 3.7, y: 4.15, r: 0.95 }, label: "Mines", verb: "Spielen", ziel: { screen: "mines" }, fokus: { x: 3.7, y: 2.5, zoom: 2.4 } },
      { id: "towers", art: "arcade", spiel: "towers", x: 5.4, y: 3.45, block: [4.78, 2.4, 6.02, 3.45],
        nutz: { x: 5.4, y: 4.15, r: 0.95 }, label: "Towers", verb: "Spielen", ziel: { screen: "towers" }, fokus: { x: 5.4, y: 2.5, zoom: 2.4 } },
      { id: "neonschild", art: "neonschild", x: 8.2, y: 2.6, block: null },
      { id: "pinco", art: "pinco", x: 11.3, y: 3.45, block: [10.25, 2.4, 12.35, 3.45],
        nutz: { x: 11.3, y: 4.2, r: 1.25 }, label: "Pinco Ball", verb: "Spielen", ziel: { screen: "pinco" }, fokus: { x: 11.3, y: 2.4, zoom: 2.2 } },
      { id: "greifer", art: "greifautomat", x: 13.9, y: 3.45, block: [13.3, 2.4, 14.5, 3.45],
        nutz: { x: 13.9, y: 4.15, r: 0.95 }, label: "Greifautomat", verb: "Greifen", ziel: { greifer: true }, fokus: { x: 13.9, y: 2.5, zoom: 2.4 } },
      { id: "wuerfel", art: "wuerfeltisch", x: 3.5, y: 7.6, block: [2.3, 6.6, 4.7, 7.6],
        nutz: "rand", label: "Würfelpoker", verb: "Würfeln", ziel: { screen: "wuerfel" }, fokus: { x: 3.5, y: 7.0, zoom: 2.4 } },
      { id: "hilo", art: "kartentisch_hilo", x: 12.5, y: 7.6, block: [11.3, 6.6, 13.7, 7.6],
        nutz: "rand", label: "Higher/Lower", verb: "Tippen", ziel: { screen: "hilo" }, fokus: { x: 12.5, y: 7.0, zoom: 2.4 } },
      // Hocker ohne Block, wie im Casino: wer am Tisch steht, bleibt nicht hängen.
      ...[[2.75, "#ff4fd8"], [4.25, "#2ad4ff"], [11.75, "#ffb02e"], [13.25, "#3dffa0"]]
        .map(([x, farbe], i) => ({ id: "neonhocker-" + (i + 1), art: "neonhocker", farbe, x, y: 8.25, block: null })),
      { id: "jukebox", art: "jukebox", x: 1.35, y: 5.6, block: [0.75, 4.9, 1.95, 5.6],
        nutz: { x: 2.3, y: 5.3, r: 0.9 }, label: "Jukebox", verb: "Lied wählen", ziel: { jukebox: true } },
      { id: "spezi-automat", art: "getraenkeautomat", x: 14.65, y: 5.6, block: [14.1, 4.9, 15.25, 5.6] },
      { id: "sitzsack-l", art: "sitzsack", farbe: "pink", x: 1.3, y: 9.9, block: [0.75, 8.9, 1.9, 9.9] },
      { id: "sitzsack-r", art: "sitzsack", farbe: "tuerkis", x: 14.7, y: 9.9, block: [14.1, 8.9, 15.25, 9.9] },
    ],
  };

  /* Das Foyer: der Warteraum vor einer Öffnung (game/einlass.js). Geheim,
     also nie in der Schnellwahl, und ohne Türen: hinaus geht es nur, wenn
     der Server bei der Öffnung alle ins Casino setzt. Die große Tür ist ein
     Ding, an das man klopfen kann. */
  RAEUME.foyer = {
    id: "foyer", name: "Foyer", w: 14, h: 10, wand: 3, boden: "marmor", geheim: true,
    flaechen: [[0.7, 3.0, 13.3, 9.4]],
    start: { x: 7.0, y: 8.2, d: "hoch" },
    tueren: [],
    sitze: [
      { id: "sofa-1", x: 1.25, y: 6.75, d: "rechts", auf: { x: 2.15, y: 6.75 } },
      { id: "sofa-2", x: 1.25, y: 7.95, d: "rechts", auf: { x: 2.15, y: 7.95 } },
      { id: "sessel", x: 12.6, y: 8.85, d: "hoch", auf: { x: 12.6, y: 7.95 } },
    ],
    dinge: [
      { id: "einlasstuer", art: "einlasstuer", x: 7.0, y: 3.05, block: [5.5, 2.4, 8.5, 3.05],
        nutz: { x: 7.0, y: 3.8, r: 1.0 }, label: "Zum Casino", verb: "Klopfen", ziel: { einlass: "tuer" }, fokus: { x: 7.0, y: 2.0, zoom: 2.0 } },
      { id: "teaser", art: "teasertafel", x: 2.9, y: 3.0, block: null, breite: 3.4,
        nutz: { x: 2.9, y: 3.8, r: 1.5 }, label: "Was kommt", verb: "Lesen", ziel: { einlass: "teaser" }, fokus: { x: 2.9, y: 1.8, zoom: 2.2 } },
      { id: "gaestebuch", art: "gaestewand", x: 11.1, y: 3.0, block: null, breite: 3.4,
        nutz: { x: 11.1, y: 3.8, r: 1.5 }, label: "Gästebuch", verb: "Schreiben", ziel: { einlass: "wand" }, fokus: { x: 11.1, y: 1.8, zoom: 2.2 } },
      { id: "schaetzglas", art: "schaetzglas", x: 4.6, y: 6.6, block: [4.15, 6.1, 5.05, 6.6],
        nutz: { x: 4.6, y: 7.3, r: 0.95 }, label: "Schätzglas", verb: "Schätzen", ziel: { einlass: "glas" }, fokus: { x: 4.6, y: 5.6, zoom: 2.4 } },
      { id: "jukebox", art: "jukebox", x: 12.65, y: 6.0, block: [12.05, 5.3, 13.25, 6.0],
        nutz: { x: 11.7, y: 5.7, r: 0.9 }, label: "Jukebox", verb: "Lied wählen", ziel: { jukebox: true } },
      { id: "f-sofa", art: "sofa", x: 1.2, y: 8.6, block: [0.7, 6.1, 1.75, 8.6] },
      { id: "f-sessel", art: "sessel", x: 12.6, y: 9.3, block: [12.1, 8.35, 13.1, 9.3] },
      { id: "f-pflanze-l", art: "pflanze", x: 1.0, y: 3.45, block: [0.7, 3.0, 1.35, 3.45] },
      { id: "f-pflanze-r", art: "pflanze", x: 13.0, y: 3.45, block: [12.65, 3.0, 13.3, 3.45] },
    ],
  };

  /* Hinter dem Regal im Kontor. Nicht in der Schnellwahl, nicht auf den
     Türschildern: wer hier steht, hat ihn gefunden. */
  RAEUME.tresor = {
    id: "tresor", name: "Tresorraum", w: 10, h: 9, wand: 3, boden: "stein", geheim: true,
    flaechen: [[0.7, 3.0, 9.3, 8.4], [4.2, 7.4, 5.8, 9.0]],
    start: { x: 5, y: 7.4, d: "hoch" },
    tueren: [
      { id: "zurueck", x1: 4.2, y1: 8.6, x2: 5.8, y2: 9.0, ziel: "kontor", ankunft: { x: 8.6, y: 4.3, d: "runter" },
        label: "Zurück", schild: { x: 5, y: 8.2 } },
    ],
    sitze: [],
    dinge: [
      { id: "tresortuer", art: "tresortuer", x: 5, y: 3.0, block: null },
      { id: "gold", art: "goldstapel", x: 1.9, y: 4.4, block: [1.0, 3.6, 2.8, 4.4] },
      { id: "gold-2", art: "goldstapel", x: 8.2, y: 4.2, block: [7.4, 3.5, 9.0, 4.2] },
      { id: "katze", art: "katzenkissen", x: 7.6, y: 6.6, block: [7.0, 6.0, 8.2, 6.6],
        nutz: "rand", label: "Schlafende Katze", verb: "Streicheln", ziel: { geheimnis: "tresorkatze" } },
      { id: "notiz", art: "notiz", x: 2.4, y: 3.0, block: null,
        nutz: { x: 2.4, y: 3.7, r: 1.0 }, label: "Zettel", verb: "Lesen",
        ziel: { hinweis: "Wer im Spiegel der Garderobe winkt, bekommt eine Antwort. Und draußen, links vor der Bank, wächst etwas, das Glück bringt." } },
    ],
  };

  function raum(id) { return RAEUME[id] || null; }

  /** Steht ein Fuß hier auf freiem Boden? */
  function begehbar(r, x, y) {
    if (!r || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const drin = r.flaechen.some((f) => x >= f[0] + FUSS && x <= f[2] - FUSS && y >= f[1] + FUSS && y <= f[3] - FUSS);
    if (!drin) return false;
    for (const d of r.dinge) {
      const b = d.block;
      if (b && x > b[0] - FUSS && x < b[2] + FUSS && y > b[1] - FUSS && y < b[3] + FUSS) return false;
    }
    return true;
  }

  /** Kein Schritt durch eine Wand: der Weg wird in kurzen Stücken abgetastet. */
  function wegFrei(r, ax, ay, bx, by) {
    const dist = Math.hypot(bx - ax, by - ay);
    const schritte = Math.max(1, Math.ceil(dist / 0.12));
    for (let i = 1; i <= schritte; i++) {
      const t = i / schritte;
      if (!begehbar(r, ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  function abstandZumRechteck(b, x, y) {
    const dx = Math.max(b[0] - x, 0, x - b[2]);
    const dy = Math.max(b[1] - y, 0, y - b[3]);
    return Math.hypot(dx, dy);
  }

  /** Wie weit ist jemand vom Punkt entfernt, an dem man ein Ding benutzt? */
  function abstandZuDing(d, x, y) {
    if (!d || !d.nutz) return Infinity;
    if (d.nutz === "rand") return d.block ? abstandZumRechteck(d.block, x, y) : Infinity;
    return Math.hypot(d.nutz.x - x, d.nutz.y - y);
  }

  function reichweite(d) {
    if (!d || !d.nutz) return 0;
    return d.nutz === "rand" ? RAND_REICHWEITE : (d.nutz.r == null ? 1.2 : d.nutz.r);
  }

  /** Das nächste benutzbare Ding in Reichweite, oder null. */
  function naechstesDing(r, x, y) {
    let best = null;
    let bestWert = Infinity;
    for (const d of (r && r.dinge) || []) {
      if (!d.ziel || reichweite(d) <= 0) continue;
      const a = abstandZuDing(d, x, y);
      if (a > reichweite(d)) continue;
      /* Verglichen wird der Anteil an der Reichweite, nicht der rohe
         Abstand: vor dem Spielautomaten ist man 0,6 vom Automaten weg und
         zugleich 0,6 vom Rand des Rouletttischs, gemeint ist trotzdem der
         Automat, vor dem man steht. */
      const wert = a / reichweite(d);
      if (wert < bestWert) { best = d; bestWert = wert; }
    }
    return best;
  }

  /** Grundform aus einer Nachricht oder vom Konto: nur ganze Zahlen im Bereich. */
  function grundform(roh) {
    const g = {};
    for (const [feld, anzahl] of Object.entries(GRUNDFORM)) {
      const n = Number(roh && roh[feld]);
      g[feld] = Number.isInteger(n) && n >= 0 && n < anzahl ? n : 0;
    }
    return g;
  }

  function inTuer(t, x, y) {
    if (t.versteckt) return false;
    return x >= t.x1 - 0.05 && x <= t.x2 + 0.05 && y >= t.y1 - 0.05 && y <= t.y2 + 0.05;
  }

  /* Gesten, die an einem angelegten Stück hängen. Die Liste steht hier,
     weil Server und Browser beide dieselbe Frage stellen: darf diese Figur
     das gerade? Der Server prüft es bei jeder Geste gegen die Kleidung am
     Konto, der Browser zeigt im Menü nur, was zum eigenen Outfit passt.
     `braucht` nennt je Art die Stücke, "*" heißt: irgendeins davon. */
  const STUECK_GESTEN = [
    { id: "dampfen", name: "Dampfen", braucht: { hand: ["vape"] } },
    { id: "schlecken", name: "Schlecken", braucht: { hand: ["lutscher", "eis"] } },
    { id: "schluerfen", name: "Schlürfen", braucht: { hand: ["kaffee", "energy", "bubble_tea", "spezi"] } },
    { id: "selfie", name: "Selfie", braucht: { hand: ["handy", "kamera"] } },
    { id: "geldregen", name: "Geldregen", braucht: { hand: ["chipstapel", "goldbarren"] } },
    { id: "kickflip", name: "Kickflip", braucht: { fahrzeug: ["skateboard"] } },
    { id: "wheelie", name: "Wheelie", braucht: { fahrzeug: ["e_roller", "simme"] } },
    { id: "quietschen", name: "Quietschen", braucht: { hand: ["gummihuhn"] } },
    { id: "hupen", name: "Hupen", braucht: { fahrzeug: ["e_roller", "bobbycar", "mopedauto", "goldmoped", "aufsitzmaeher", "simme"] } },
    { id: "ankicken", name: "Ankicken", braucht: { fahrzeug: ["simme"] } },
    { id: "qualmen", name: "Anlassen", braucht: { fahrzeug: ["e46"] } },
    { id: "kunststueck", name: "Kunststück", braucht: { haustier: "*" } },
    { id: "flattern", name: "Flattern", braucht: { accessoire: ["fluegel"] } },
    { id: "troete", name: "Tröte", braucht: { kopf: ["partyhut"] } },
    { id: "abgehen", name: "Abgehen", braucht: { kopf: ["kopfhoerer"] } },
  ];
  const LEER = new Set(["", "keins", "keine"]);

  /* Der Greifautomat (game/greifer.js), in Einheiten der großen Zeichnung
     (240 breit). Der Server entscheidet anhand dieser Bälle, ob der Greifer
     etwas zu fassen bekommt; der Browser zeichnet dieselben. Zwischen den
     Bällen sind Lücken, das Zielen zählt also. */
  const GREIFER = {
    links: 36, rechts: 212, start: 36, oben: 34, fangweite: 7,
    baelle: [
      { x: 80, y: 170 }, { x: 104, y: 170 }, { x: 140, y: 170 }, { x: 176, y: 170 }, { x: 206, y: 170 },
      { x: 122, y: 154 }, { x: 158, y: 154 },
    ],
  };

  /** Welche Stück-Gesten zu dieser Kleidung passen, in fester Reihenfolge. */
  function gestenFuer(kleidung) {
    const k = kleidung || {};
    return STUECK_GESTEN.filter((g) => Object.entries(g.braucht).some(([art, ids]) => {
      const id = typeof k[art] === "string" ? k[art] : "";
      if (LEER.has(id)) return false;
      return ids === "*" || ids.includes(id);
    }));
  }

  const api = {
    KACHEL, FUSS, TEMPO, FAHRZEUG_FAKTOR, RAEUME, GRUNDFORM, STUECK_GESTEN, GREIFER,
    raum, begehbar, wegFrei, abstandZuDing, reichweite, naechstesDing, inTuer, grundform, gestenFuer,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    wurzel.Casino = wurzel.Casino || {};
    wurzel.Casino.weltRaeume = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
