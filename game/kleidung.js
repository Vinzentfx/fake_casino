"use strict";

/**
 * Kleidung für die Figur: was man in der Welt an ihr sieht.
 *
 * Neun Arten, jede mit einem Platz am Körper. Anders als Rahmen, Stil und
 * Zeichen, die erst nachträglich auf die Figur übersetzt wurden, ist hier
 * jedes Stück von Anfang an als Kleidungsstück gedacht: eine Form, die man
 * auf drei Meter erkennt, nicht sechs Varianten desselben Leuchtens.
 *
 * Besitz, Prägung, Markt und Kisten laufen über game/cosmetics.js wie bei
 * allen anderen Arten; diese Datei ist nur der Katalog. Wie die Stücke
 * AUSSEHEN, steht in public/js/welt/figur.js. Wer hier ein Stück ergänzt,
 * zeichnet es dort, sonst trägt die Figur davon nichts.
 *
 * `cost` ist wie überall der Wert und damit die Seltenheit (game/kisten.js,
 * `stufeVon`). `nur: "kleider"` heißt: gibt es ausschließlich aus der
 * Kleiderkiste, im allgemeinen Topf taucht es nicht auf. Gratis-Stücke
 * (`cost: 0`) hat jeder von Anfang an, damit eine Figur schon am ersten
 * Abend nach jemandem aussieht.
 */

const K = "kleider";
/* Drei Läden in der Ladenstraße (game/laeden.js). Was dort steht, kommt
   nicht aus der Kleiderkiste: Haustiere aus dem Zoo (geprägt, knapp,
   handelbar), Fahrzeuge aus dem Autohaus (ab einem Level, fester Preis),
   Essen und Trinken vom Kiosk (billig, immer da). Autohaus und Kiosk sind
   Ladenware: nicht geprägt und nicht handelbar, „Nr. 4312 von unendlich“
   wäre ein Witz. */
const ZOO = "zoo", AUTOHAUS = "autohaus", KIOSK = "kiosk";
const LADENWARE = new Set([AUTOHAUS, KIOSK]);
/* Kioskpreise (Stand 1.10.): 500 bis 2.500 Chips. Mit 4.000 bis 12.000
   kostete ein Spezi rund 40 % des Medianguthabens der aktiven Runde; jetzt
   können gut drei Viertel sofort zugreifen. Ein Kiosk ist der Einstieg. */

const FRISUREN = [
  { id: "standard",      label: "Grundform",          cost: 0 },
  { id: "undercut",      label: "Undercut",           cost: 20_000, nur: K },
  { id: "mittelscheitel", label: "Mittelscheitel",    cost: 25_000, nur: K },
  { id: "dutt",          label: "Dutt",               cost: 35_000, nur: K },
  { id: "vokuhila",      label: "Vokuhila",           cost: 45_000, nur: K },
  { id: "zoepfe",        label: "Zöpfe",              cost: 60_000, nur: K },
  { id: "glatze",        label: "Glatze mit Glanz",   cost: 70_000, nur: K },
  { id: "irokese",       label: "Irokese",            cost: 90_000, nur: K },
  { id: "afro",          label: "Afro",               cost: 110_000, nur: K },
  { id: "tolle",         label: "Elvis-Tolle",        cost: 160_000, nur: K },
  { id: "regenbogen_iro", label: "Regenbogen-Irokese", cost: 650_000, nur: K, motion: true },
  { id: "sternenhaar",   label: "Sternenhaar",        cost: 1_300_000, nur: K, motion: true },
  { id: "pferdeschwanz", label: "Hoher Pferdeschwanz", cost: 22_000, nur: K },
  { id: "bob",           label: "Bob",                cost: 28_000, nur: K },
  { id: "wellen",        label: "Lange Wellen",       cost: 48_000, nur: K },
  { id: "space_buns",    label: "Space Buns",         cost: 75_000, nur: K },
  { id: "meerjungfrau",  label: "Meerjungfrauenhaar", cost: 720_000, nur: K, motion: true },
];

/* Kopfbedeckungen. Ohne eine davon trägt die Figur weiter, was ihr Rahmen
   hergibt (Krone, Propeller, Kranz); mit einer davon zählt nur noch sie. */
const KOPF = [
  { id: "keine",         label: "Ohne",               cost: 0 },
  { id: "basecap",       label: "Basecap",            cost: 0 },
  { id: "stirnband",     label: "Stirnband",          cost: 12_000, nur: K },
  { id: "beanie",        label: "Beanie",             cost: 18_000, nur: K },
  { id: "fischerhut",    label: "Fischerhut",         cost: 24_000, nur: K },
  { id: "partyhut",      label: "Partyhütchen",       cost: 28_000, nur: K },
  { id: "bauhelm",       label: "Bauhelm",            cost: 40_000, nur: K },
  { id: "kopfhoerer",    label: "Headset",            cost: 55_000, nur: K },
  { id: "blumenkranz",   label: "Blumenkranz",        cost: 70_000, nur: K },
  { id: "kochmuetze",    label: "Kochmütze",          cost: 85_000, nur: K },
  { id: "cowboyhut",     label: "Cowboyhut",          cost: 150_000, nur: K },
  { id: "piratenhut",    label: "Piratenhut",         cost: 220_000, nur: K },
  { id: "wikingerhelm",  label: "Wikingerhelm",       cost: 600_000, nur: K },
  { id: "haarreif",      label: "Haarreif mit Schleife", cost: 16_000, nur: K },
  { id: "baskenmuetze",  label: "Baskenmütze",        cost: 26_000, nur: K },
  { id: "sonnenhut",     label: "Sonnenhut",          cost: 42_000, nur: K },
  { id: "diadem",        label: "Diadem",             cost: 680_000, nur: K, motion: true },
  { id: "schalenhelm",   label: "Schalenhelm",        cost: 24_000, nur: K },
];

const OBERTEILE = [
  { id: "standard",      label: "Clubjacke",          cost: 0 },
  { id: "tshirt",        label: "Weißes Shirt",       cost: 0 },
  { id: "hoodie",        label: "Grauer Hoodie",      cost: 0 },
  { id: "trainingsjacke", label: "Trainingsjacke",    cost: 28_000, nur: K },
  { id: "skatehoodie",   label: "Skater-Hoodie",      cost: 40_000, nur: K },
  { id: "trikot",        label: "Trikot",             cost: 55_000, nur: K },
  { id: "hawaiihemd",    label: "Hawaiihemd",         cost: 65_000, nur: K },
  { id: "windbreaker",   label: "Neon-Windbreaker",   cost: 90_000, nur: K },
  { id: "weste",         label: "Croupier-Weste",     cost: 120_000, nur: K },
  { id: "lederjacke",    label: "Lederjacke",         cost: 150_000, nur: K },
  { id: "sakko",         label: "Sakko mit Krawatte", cost: 180_000, nur: K },
  { id: "warnweste",     label: "Warnweste",          cost: 20_000, nur: K },
  { id: "strickjacke",   label: "Strickjacke",        cost: 32_000, nur: K },
  { id: "kochjacke",     label: "Kochjacke",          cost: 75_000, nur: K },
  { id: "pelzmantel",    label: "Kunstpelzmantel",    cost: 800_000, nur: K },
  { id: "goldanzug",     label: "Goldanzug",          cost: 1_600_000, nur: K, motion: true },
  { id: "croptop",       label: "Crop-Top",           cost: 18_000, nur: K },
  { id: "bluse",         label: "Rüschenbluse",       cost: 30_000, nur: K },
  { id: "sommerkleid",   label: "Sommerkleid",        cost: 52_000, nur: K },
  { id: "glitzerkleid",  label: "Glitzerkleid",       cost: 760_000, nur: K, motion: true },
  { id: "ballonseide",   label: "Ballonseidenjacke",  cost: 36_000, nur: K },
];

const HOSEN = [
  { id: "standard",      label: "Grundform",          cost: 0 },
  { id: "jeans",         label: "Jeans",              cost: 0 },
  { id: "jogger",        label: "Graue Jogginghose",  cost: 0 },
  { id: "shorts",        label: "Shorts",             cost: 18_000, nur: K },
  { id: "jogger_schwarz", label: "Schwarze Jogger",   cost: 22_000, nur: K },
  { id: "cargo",         label: "Cargohose",          cost: 30_000, nur: K },
  { id: "anzughose",     label: "Anzughose",          cost: 60_000, nur: K },
  { id: "faltenrock",    label: "Faltenrock",         cost: 26_000, nur: K },
  { id: "latzhose",      label: "Latzhose",           cost: 34_000, nur: K },
  { id: "karohose",      label: "Karohose",           cost: 80_000, nur: K },
  { id: "lederhose",     label: "Lederhose",          cost: 140_000, nur: K },
  { id: "glitzerhose",   label: "Glitzerhose",        cost: 500_000, nur: K, motion: true },
  { id: "leggings",      label: "Leggings",           cost: 14_000, nur: K },
  { id: "jeansrock",     label: "Jeansrock",          cost: 24_000, nur: K },
  { id: "schlaghose",    label: "Schlaghose",         cost: 36_000, nur: K },
];

const SCHUHE = [
  { id: "standard",      label: "Sneaker",            cost: 0 },
  { id: "badelatschen",  label: "Badelatschen",       cost: 0 },
  { id: "socken_sandalen", label: "Socken in Sandalen", cost: 15_000, nur: K },
  { id: "skaterschuhe",  label: "Skaterschuhe",       cost: 26_000, nur: K },
  { id: "stiefel",       label: "Stiefel",            cost: 35_000, nur: K },
  { id: "airsneaker",    label: "Air-Sneaker",        cost: 45_000, nur: K },
  { id: "clogs",         label: "Gummiclogs",         cost: 50_000, nur: K },
  { id: "lackschuhe",    label: "Lackschuhe",         cost: 90_000, nur: K },
  { id: "goldsneaker",   label: "Goldene Sneaker",    cost: 700_000, nur: K },
  { id: "raketenstiefel", label: "Raketenstiefel",    cost: 1_200_000, nur: K, motion: true },
  { id: "ballerinas",    label: "Ballerinas",         cost: 16_000, nur: K },
  { id: "plateau",       label: "Plateau-Sneaker",    cost: 32_000, nur: K },
  { id: "pumps",         label: "Rote Pumps",         cost: 58_000, nur: K },
  { id: "overknees",     label: "Overknee-Stiefel",   cost: 135_000, nur: K },
  { id: "glitzerheels",  label: "Glitzer-Heels",      cost: 540_000, nur: K, motion: true },
];

const BRILLEN = [
  { id: "keine",         label: "Ohne",               cost: 0 },
  { id: "hornbrille",    label: "Hornbrille",         cost: 16_000, nur: K },
  { id: "sonnenbrille",  label: "Sonnenbrille",       cost: 20_000, nur: K },
  { id: "herzbrille",    label: "Herzbrille",         cost: 55_000, nur: K },
  { id: "pilot",         label: "Pilotenbrille",      cost: 70_000, nur: K },
  { id: "skibrille",     label: "Skibrille",          cost: 110_000, nur: K },
  { id: "monokel",       label: "Monokel",            cost: 250_000, nur: K },
  { id: "augenklappe",   label: "Augenklappe",        cost: 40_000, nur: K },
  { id: "laservisier",   label: "Laser-Visier",       cost: 900_000, nur: K, motion: true },
  { id: "cateye",        label: "Cat-Eye-Brille",     cost: 34_000, nur: K },
  { id: "spiegelbrille", label: "Spiegelbrille",      cost: null, via: "Irgendwo im Haus versteckt" },
];

const ACCESSOIRES = [
  { id: "keins",         label: "Ohne",               cost: 0 },
  { id: "schal",         label: "Schal",              cost: 14_000, nur: K },
  { id: "fliege",        label: "Fliege",             cost: 18_000, nur: K },
  { id: "rucksack",      label: "Rucksack",           cost: 24_000, nur: K },
  { id: "bauchtasche",   label: "Bauchtasche",        cost: 30_000, nur: K },
  { id: "goldkette",     label: "Goldkette",          cost: 85_000, nur: K },
  { id: "handtasche",    label: "Handtasche",         cost: 38_000, nur: K },
  { id: "creolen",       label: "Creolen",            cost: 20_000, nur: K },
  { id: "perlenkette",   label: "Perlenkette",        cost: 64_000, nur: K },
  { id: "clutch",        label: "Glitzer-Clutch",     cost: 125_000, nur: K },
  { id: "umhang",        label: "Umhang",             cost: 320_000, nur: K, motion: true },
  { id: "fluegel",       label: "Flügel",             cost: 1_250_000, nur: K, motion: true },
];

const HANDDINGE = [
  { id: "keins",         label: "Chat-Zeichen",       cost: 0 },
  { id: "kaffee",        label: "Kaffee to go",       cost: 0 },
  { id: "lutscher",      label: "Lutscher",           cost: 12_000, nur: KIOSK, preis: 500 },
  { id: "energy",        label: "Energydrink",        cost: 16_000, nur: KIOSK, preis: 1_000 },
  { id: "eis",           label: "Eistüte",            cost: 22_000, nur: KIOSK, preis: 1_200 },
  { id: "vape",          label: "Vape",               cost: 26_000, nur: K, motion: true },
  { id: "handy",         label: "Handy",              cost: 35_000, nur: K },
  { id: "doener",        label: "Döner",              cost: 40_000, nur: KIOSK, preis: 2_500 },
  { id: "rose",          label: "Rose",               cost: 45_000, nur: K },
  { id: "kamera",        label: "Kamera",             cost: 60_000, nur: K },
  { id: "luftballon",    label: "Luftballon",         cost: 75_000, nur: K, motion: true },
  { id: "chipstapel",    label: "Chipstapel",         cost: 100_000, nur: K },
  { id: "zollstock",     label: "Zollstock",          cost: 14_000, nur: K },
  { id: "kuchen",        label: "Stück Kuchen",       cost: 18_000, nur: KIOSK, preis: 1_500 },
  { id: "pfanne",        label: "Pfanne",             cost: 30_000, nur: K },
  { id: "lasso",         label: "Lasso",              cost: 65_000, nur: K },
  { id: "goldbarren",    label: "Goldbarren",         cost: 450_000, nur: K },
  { id: "bubble_tea",    label: "Bubble Tea",         cost: 20_000, nur: KIOSK, preis: 2_000 },
  { id: "faecher",       label: "Fächer",             cost: 42_000, nur: K },
  { id: "blumenstrauss", label: "Blumenstrauß",       cost: 56_000, nur: K },
  { id: "spezi",         label: "Spezi",              cost: 12_000, nur: KIOSK, preis: 800 },
  { id: "kleeblatt",     label: "Vierblättriges Kleeblatt", cost: null, via: "Irgendwo im Haus versteckt" },
];

/* Fahrzeuge. Man steht oder sitzt darauf und rollt etwas schneller als zu
   Fuß (raeume.TEMPO_FAHRZEUG); am Spiel ändert das nichts. */
const FAHRZEUGE = [
  { id: "keins",         label: "Zu Fuß",             cost: 0 },
  { id: "skateboard",    label: "Skateboard",         cost: 60_000, nur: AUTOHAUS, ab: 3 },
  { id: "bobbycar",      label: "Bobbycar",           cost: 95_000, nur: AUTOHAUS, ab: 5 },
  { id: "e_roller",      label: "E-Roller",           cost: 140_000, nur: AUTOHAUS, ab: 8 },
  { id: "hoverboard",    label: "Hoverboard",         cost: 260_000, nur: K, motion: true },
  { id: "mopedauto",     label: "45er-Auto",          cost: 750_000, nur: AUTOHAUS, ab: 25 },
  { id: "aufsitzmaeher", label: "Aufsitzmäher",       cost: 900_000, nur: AUTOHAUS, ab: 30 },
  { id: "simme",         label: "Simme",              cost: 380_000, nur: AUTOHAUS, ab: 15 },
  { id: "goldmoped",     label: "Goldenes 45er-Auto", cost: 1_800_000, nur: K, motion: true },
  /* Der alte Dreier. Steht irgendwo, wo man nicht hinsieht, und springt
     nicht an: wer aufsteigt, kommt keinen Meter weit, es qualmt nur. */
  { id: "e46",           label: "BMW E46",            cost: null, via: "Irgendwo im Haus versteckt", springtNichtAn: true },
];

/* Haustiere laufen hinter der Figur her. Das eine aus dem Geheimraum hat
   keinen Preis und keinen Markt: wer es will, muss es finden. */
const HAUSTIERE = [
  { id: "keins",         label: "Ohne",               cost: 0 },
  { id: "taube",         label: "Stadttaube",         cost: 20_000, nur: ZOO },
  { id: "hamster",       label: "Hamster",            cost: 28_000, nur: ZOO },
  { id: "frosch",        label: "Frosch",             cost: 45_000, nur: ZOO },
  { id: "katze",         label: "Katze",              cost: 110_000, nur: ZOO },
  { id: "dackel",        label: "Dackel",             cost: 130_000, nur: ZOO },
  { id: "waschbaer",     label: "Waschbär",           cost: 280_000, nur: ZOO },
  { id: "gluecksschwein", label: "Glücksschwein",     cost: 480_000, nur: ZOO },
  { id: "papagei",       label: "Papagei",            cost: 320_000, nur: ZOO, motion: true },
  { id: "igel",          label: "Igel",               cost: 24_000, nur: ZOO },
  { id: "hase",          label: "Zwergkaninchen",     cost: 34_000, nur: ZOO },
  { id: "schildkroete",  label: "Schildkröte",        cost: 70_000, nur: ZOO },
  { id: "pinguin",       label: "Pinguin",            cost: 190_000, nur: ZOO },
  { id: "minidrache",    label: "Mini-Drache",        cost: 1_500_000, nur: K, motion: true },
  { id: "tresorkatze",   label: "Tresorkatze",        cost: null, via: "Irgendwo im Haus versteckt" },
];

/* Die Arten, wie game/cosmetics.js sie braucht: Topf am Konto, angelegtes
   Feld, deutscher Name und die Kennung für "nichts angelegt". */
const ARTEN = {
  kopf:       { topf: "koepfe",      feld: "kopf",       name: "Kopfbedeckung", leer: "keine",  liste: KOPF },
  frisur:     { topf: "frisuren",    feld: "frisur",     name: "Frisur",      leer: "standard", liste: FRISUREN },
  oberteil:   { topf: "oberteile",   feld: "oberteil",   name: "Oberteil",    leer: "standard", liste: OBERTEILE },
  hose:       { topf: "hosen",       feld: "hose",       name: "Hose",        leer: "standard", liste: HOSEN },
  schuhe:     { topf: "schuhe",      feld: "schuhe",     name: "Schuhe",      leer: "standard", liste: SCHUHE },
  brille:     { topf: "brillen",     feld: "brille",     name: "Brille",      leer: "keine",    liste: BRILLEN },
  accessoire: { topf: "accessoires", feld: "accessoire", name: "Accessoire",  leer: "keins",    liste: ACCESSOIRES },
  hand:       { topf: "handdinge",   feld: "handding",   name: "In der Hand", leer: "keins",    liste: HANDDINGE },
  fahrzeug:   { topf: "fahrzeuge",   feld: "fahrzeug",   name: "Fahrzeug",    leer: "keins",    liste: FAHRZEUGE },
  haustier:   { topf: "haustiere",   feld: "haustier",   name: "Haustier",    leer: "keins",    liste: HAUSTIERE },
};

/*
 * Style-Sets. Wer alle Teile eines Sets gleichzeitig trägt, hat den Look
 * komplett: die Figur trägt dann den Namen des Sets über dem Kopf, und die
 * Spielerkarte sagt es in Worten. Kein Bonus im Spiel, nur Wiedererkennung.
 *
 * Ein Stück darf in mehreren Sets stecken (die Anzughose gehört dem
 * Croupier und dem Börsenhai). Trägt jemand zwei vollständige Sets, zählt
 * das mit mehr Teilen.
 */
const SETS = [
  { id: "talahon", label: "Talahon", text: "Bauchtasche, Vape, E-Roller. Mehr braucht es nicht.",
    teile: [["accessoire", "bauchtasche"], ["hand", "vape"], ["fahrzeug", "e_roller"]] },
  { id: "skater", label: "Skater", text: "Board unterm Arm, Hose zu weit, Schuhe durchgelaufen.",
    teile: [["fahrzeug", "skateboard"], ["oberteil", "skatehoodie"], ["hose", "cargo"], ["schuhe", "skaterschuhe"]] },
  { id: "mallorca", label: "Mallorca", text: "Hemd offen, Sonne im Gesicht, Socken in den Sandalen.",
    teile: [["oberteil", "hawaiihemd"], ["brille", "sonnenbrille"], ["schuhe", "socken_sandalen"], ["hand", "kamera"]] },
  { id: "boersenhai", label: "Börsenhai", text: "Sakko, Lackschuhe und das Handy nie aus der Hand.",
    teile: [["oberteil", "sakko"], ["hose", "anzughose"], ["schuhe", "lackschuhe"], ["hand", "handy"]] },
  { id: "dorfjugend", label: "Dorfjugend", text: "Mit dem 45er zur Tanke, Energy in der Hand, Vokuhila im Wind.",
    teile: [["fahrzeug", "mopedauto"], ["hand", "energy"], ["oberteil", "trainingsjacke"], ["frisur", "vokuhila"]] },
  { id: "croupier", label: "Croupier", text: "Weste, Fliege, Chips. Das Haus gewinnt immer.",
    teile: [["oberteil", "weste"], ["accessoire", "fliege"], ["hose", "anzughose"], ["hand", "chipstapel"]] },
  { id: "rapper", label: "Rapper", text: "Pelz, Gold und eine Brille, durch die niemand hineinsieht.",
    teile: [["oberteil", "pelzmantel"], ["accessoire", "goldkette"], ["brille", "pilot"], ["schuhe", "goldsneaker"]] },
  { id: "gamer", label: "Gamer", text: "Headset auf, Jogginghose an. Nur noch eine Runde, dann wirklich.",
    teile: [["kopf", "kopfhoerer"], ["oberteil", "hoodie"], ["hose", "jogger"], ["hand", "energy"]] },
  { id: "baustelle", label: "Baustelle", text: "Helm auf, Weste an, Zollstock in der Hand. Frühstückspause ist um neun.",
    teile: [["kopf", "bauhelm"], ["oberteil", "warnweste"], ["hose", "latzhose"], ["hand", "zollstock"]] },
  { id: "oma", label: "Oma am Sonntag", text: "Strickjacke, Handtasche, ein Stück Kuchen. Und immer ein Taschentuch im Ärmel.",
    teile: [["oberteil", "strickjacke"], ["hose", "faltenrock"], ["accessoire", "handtasche"], ["hand", "kuchen"]] },
  { id: "festival", label: "Festival", text: "Fischerhut, Windbreaker, drei Tage kein Netz. Das Zelt steht irgendwo.",
    teile: [["kopf", "fischerhut"], ["oberteil", "windbreaker"], ["accessoire", "bauchtasche"], ["schuhe", "clogs"]] },
  { id: "cowboy", label: "Cowboy", text: "Hut tief im Gesicht, Lasso am Gürtel. In Porta ist die Weser der Wilde Westen.",
    teile: [["kopf", "cowboyhut"], ["oberteil", "lederjacke"], ["schuhe", "stiefel"], ["hand", "lasso"]] },
  { id: "chefkoch", label: "Chefkoch", text: "Mütze hoch, Karohose an. Heute gibt es, was die Pfanne hergibt.",
    teile: [["kopf", "kochmuetze"], ["oberteil", "kochjacke"], ["hose", "karohose"], ["hand", "pfanne"]] },
  { id: "pirat", label: "Pirat", text: "Augenklappe, Hut und ein Papagei, der alles weitererzählt.",
    teile: [["kopf", "piratenhut"], ["brille", "augenklappe"], ["accessoire", "umhang"], ["haustier", "papagei"]] },
  { id: "party", label: "Party", text: "Hütchen auf, Ballon in der Hand. Wessen Geburtstag, ist egal.",
    teile: [["kopf", "partyhut"], ["hand", "luftballon"], ["hose", "glitzerhose"], ["schuhe", "goldsneaker"]] },
  { id: "glamour", label: "Glamour", text: "Glitzer bis zum Boden, Perlen am Hals. Der rote Teppich liegt in der Ruhmeshalle.",
    teile: [["oberteil", "glitzerkleid"], ["schuhe", "glitzerheels"], ["accessoire", "perlenkette"], ["frisur", "wellen"]] },
  { id: "y2k", label: "Y2K", text: "Crop-Top, Jeansrock, Plateau. Das Handy hat noch Tasten, die Brille ist trotzdem neu.",
    teile: [["oberteil", "croptop"], ["hose", "jeansrock"], ["schuhe", "plateau"], ["brille", "cateye"]] },
  { id: "sommerfest", label: "Sommerfest", text: "Kleid, Hut und ein Strauß vom Markt. Die Sonne kommt von selbst.",
    teile: [["oberteil", "sommerkleid"], ["kopf", "sonnenhut"], ["schuhe", "ballerinas"], ["hand", "blumenstrauss"]] },
  { id: "ossi", label: "Ossi", text: "Die Simme läuft sechzig, das Spezi ist warm, die Ballonseide knistert. Ab zum Konsum.",
    teile: [["fahrzeug", "simme"], ["hand", "spezi"], ["oberteil", "ballonseide"], ["kopf", "schalenhelm"]] },
];

/** Welches Set trägt `acc` gerade vollständig? Null, wenn keins. */
function setVon(acc) {
  if (!acc) return null;
  let beste = null;
  for (const s of SETS) {
    const komplett = s.teile.every(([art, id]) => acc[ARTEN[art].feld] === id);
    if (komplett && (!beste || s.teile.length > beste.teile.length)) beste = s;
  }
  return beste ? { id: beste.id, label: beste.label } : null;
}

/** Was von der Kleidung angelegt ist, nur die Felder mit einem Stück.
    Ein Fahrzeug, von dem man abgestiegen ist (`acc.zuFuss`), zählt hier
    nicht: die Figur läuft dann, und hupen kann sie auch nicht. */
function angelegt(acc) {
  const out = {};
  for (const [art, a] of Object.entries(ARTEN)) {
    const id = acc && acc[a.feld];
    if (id && id !== a.leer) out[art] = id;
  }
  if (out.fahrzeug && acc.zuFuss) delete out.fahrzeug;
  return out;
}

/** Das angelegte Fahrzeug, auch wenn man gerade daneben läuft. Null ohne. */
function fahrzeugVon(acc) {
  const id = acc && typeof acc.fahrzeug === "string" ? acc.fahrzeug : "";
  return id && id !== "keins" && FAHRZEUGE.some((f) => f.id === id) ? id : null;
}

/** Wie die Figur gerade unterwegs ist: zu Fuß, fahrend, oder auf einem
    Fahrzeug, das nicht anspringt (steht). */
function fahrtVon(acc) {
  const id = fahrzeugVon(acc);
  if (!id || acc.zuFuss) return { faehrt: false, steht: false };
  const f = FAHRZEUGE.find((x) => x.id === id);
  return f && f.springtNichtAn ? { faehrt: false, steht: true } : { faehrt: true, steht: false };
}

/** Ladenware ist nicht geprägt und nicht handelbar (Autohaus, Kiosk). */
const istLadenware = (item) => !!item && LADENWARE.has(item.nur);

module.exports = { ZOO, AUTOHAUS, KIOSK, istLadenware, ARTEN, SETS, setVon, angelegt, fahrzeugVon, fahrtVon, KOPF, FRISUREN, OBERTEILE, HOSEN, SCHUHE, BRILLEN, ACCESSOIRES, HANDDINGE, FAHRZEUGE, HAUSTIERE };
