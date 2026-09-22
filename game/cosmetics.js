"use strict";

/**
 * Kosmetik-Laden. Schluckt Chips für Status und hilft so gegen Inflation.
 *
 * Avatare (das Emoji neben dem Namen), Namensfarben und alles Weitere kauft man
 * mit Chips, behält es für immer und legt je Art eins an. Nichts davon ändert
 * etwas am Spiel, es geht nur ums Angeben.
 *
 * Am Konto: acc.avatar (Emoji), acc.nameColor (Hex oder null),
 * acc.cosOwned = { avatars:[ids], colors:[ids] }. Angelegtes wird aufgelöst
 * gespeichert, damit Bestenliste und Chat ohne Katalog auskommen.
 */

const praegung = require("./praegung");
const sammlungen = require("./sammlungen");

/* Die Namen braucht es wirklich: ohne sie steht in jeder Liste, die nicht
   das Emoji zeichnen kann, die rohe Kennung ("clown Nr. 2"). */
const AVATARS = [
  { id: "smile",  label: "Lächeln",   emoji: "🙂", cost: 0 },
  { id: "cool",   label: "Sonnenbrille", emoji: "😎", cost: 5000 },
  { id: "cowboy", label: "Cowboy",    emoji: "🤠", cost: 10000 },
  { id: "clown",  label: "Clown",     emoji: "🤡", cost: 15000 },
  { id: "tophat", label: "Zylinder",  emoji: "🎩", cost: 20000 },
  { id: "shark",  label: "Hai",       emoji: "🦈", cost: 25000 },
  { id: "alien",  label: "Außerirdischer", emoji: "👽", cost: 30000 },
  { id: "robot",  label: "Roboter",   emoji: "🤖", cost: 40000 },
  { id: "gem",    label: "Diamant",   emoji: "💎", cost: 75000 },
  { id: "crown",  label: "Krone",     emoji: "👑", cost: 100000 },
  { id: "dragon", label: "Drache",    emoji: "🐉", cost: 150000 },
  { id: "money",  label: "Geldgesicht", emoji: "🤑", cost: 250000 },
  // Nur ueber den Season-Pass. cost: null heisst "nicht kaeuflich". Genau
  // das macht sie zum Statussymbol: man sieht, dass jemand die Season
  // durchgespielt hat, und kann es sich nicht einfach kaufen.
  { id: "s2_joker",  emoji: "🃏", label: "Joker",  cost: null, season: "porta-herbst-2" },
  { id: "s2_wolf",   emoji: "🐺", label: "Wolf",   cost: null, season: "porta-herbst-2" },
  { id: "s2_phoenix", emoji: "🔥", label: "Phönix", cost: null, season: "porta-herbst-2" },
  /* Gala. Alles mit `nur: "gala"` gibt es AUSSCHLIESSLICH aus der Gala-Kiste
     und in keinem anderen Topf; siehe game/kisten.js. */
  { id: "gala_sekt", emoji: "🥂", label: "Anstoßen", cost: 28000, nur: "gala" },
];
/* Die Namen sind nicht schmueckendes Beiwerk, sondern noetig: label() gab
   fuer eine Farbe den Hex-Wert zurueck, und in einer Ziehung stand dann
   "bestes: #c86bd6". */
/*
 * Namensfarbe: die flache Farbe.
 *
 * `nichtInKisten` nimmt sie aus dem Ziehtopf, und dafuer gibt es einen
 * harten Grund: JEDER Namensstil ueberschreibt sie. Wer einen Stil anlegt,
 * sieht von seiner Farbe nichts mehr (siehe `name()` in
 * public/js/core/player.js, die Inline-Farbe kommt nur, wenn kein Stil
 * gesetzt ist). Ein Stueck, das ein anderes unsichtbar macht, ist als
 * Ziehung eine Niete.
 *
 * Im Stand vom 18.9. war das auch messbar: von 80 Konten besitzen DREI
 * ueberhaupt eine Farbe, und drei tragen eine. Sieben von achtzehn
 * gewoehnlichen Stuecken waren damit Fuellmaterial, das jede billige
 * Ziehung verwaessert hat.
 *
 * Geloescht wird trotzdem nichts: die drei Exemplare, die es gibt, bleiben
 * geprägt und handelbar. Sie sind ab jetzt das Einzige im Haus, das nicht
 * mehr entstehen kann.
 */
const COLORS = [
  { id: "white",  label: "Weiß",   color: null,      cost: 0 },
  { id: "gold",   label: "Gold",   color: "#f4d782", cost: 20000, nichtInKisten: true },
  { id: "red",    label: "Rot",    color: "#e0705e", cost: 15000, nichtInKisten: true },
  { id: "blue",   label: "Blau",   color: "#5ea8e0", cost: 15000, nichtInKisten: true },
  { id: "green",  label: "Grün",   color: "#66c07a", cost: 15000, nichtInKisten: true },
  { id: "purple", label: "Violett", color: "#c86bd6", cost: 25000, nichtInKisten: true },
  { id: "cyan",   label: "Türkis", color: "#4fc7c0", cost: 20000, nichtInKisten: true },
  { id: "pink",   label: "Pink",   color: "#f07ab0", cost: 20000, nichtInKisten: true },
  { id: "s2_amber", label: "Bernstein", color: "#ff9f43", cost: null, season: "porta-herbst-2" },
];

/* Namens-Stile
 *
 * Der eigentliche Grund fuer diesen Umbau. Bisher gab es genau zwei Regler:
 * ein Emoji und eine flache Schriftfarbe. Beides sieht bei allen gleich aus
 * und war nach zwei Wochen niemandem mehr eine Anzeige wert.
 *
 * Ein Stil faerbt den Namen mit einem Verlauf und kann ihn bewegen. Er
 * ersetzt die flache Farbe, sobald einer angelegt ist; wer keinen hat,
 * behaelt genau das, was er vorher hatte. Der Client kennt zu jeder id eine
 * CSS-Klasse `nm-<id>`, hier stehen nur Name, Preis und die Vorschaufarben.
 *
 * `motion: true` heisst: bewegt sich. Wer in den Einstellungen "Bewegung
 * reduzieren" anhat, sieht dieselben Farben ohne Animation, damit niemand
 * gezwungen ist, sich das anzusehen.
 */
const STYLES = [
  { id: "standard", label: "Ohne",          cost: 0,       preview: ["#eef4ef", "#eef4ef"] },
  { id: "sonne",    label: "Sonnenaufgang", cost: 60000,   preview: ["#ffd76e", "#ff8a3d"] },
  { id: "eis",      label: "Eis",           cost: 60000,   preview: ["#9ddcff", "#5e7bff"] },
  { id: "gift",     label: "Gift",          cost: 60000,   preview: ["#a8ff60", "#17c964"] },
  { id: "beere",    label: "Beere",         cost: 60000,   preview: ["#ff8ad4", "#8b5cf6"] },
  { id: "puls",     label: "Puls",          cost: 200000,  preview: ["#ffe9a8", "#ffb347"], motion: true },
  { id: "schimmer", label: "Goldschimmer",  cost: 250000,  preview: ["#f7dc8c", "#fff6d8"], motion: true },
  { id: "neon",     label: "Neon",          cost: 300000,  preview: ["#7ef9ff", "#22d3ee"], motion: true },
  { id: "regenbogen", label: "Regenbogen",  cost: 500000,  preview: ["#ff6b6b", "#4ecdc4"], motion: true },
  { id: "feuer",    label: "Feuer",         cost: 750000,  preview: ["#ffdd55", "#ff4d1c"], motion: true },
  { id: "glitch",   label: "Glitch",        cost: 1200000, preview: ["#ff2e88", "#00e5ff"], motion: true },
  // Die Spitze des Ladens. Beide sind bewusst keine weiteren Verlaeufe:
  // Vantablack faerbt gar nicht, sondern nimmt die Farbe weg, und Splitter
  // zerlegt den Namen in wandernde Scherben.
  { id: "vanta",    label: "Vantablack",    cost: 1500000, preview: ["#0a0a0c", "#e8e8ef"], motion: true },
  { id: "splitter", label: "Splitter",      cost: 1800000, preview: ["#9be7ff", "#ffffff"], motion: true },
  // Nicht kaeuflich: kommt, wenn man in der Stadt Boss eines Ortsteils wird.
  { id: "krone",    label: "Krone",         cost: null, via: "Boss eines Ortsteils werden", preview: ["#fff1b8", "#d4a017"], motion: true },
  // Season 2. Die alte Belohnung auf Stufe 10 war eine flache orange Farbe,
  // dasselbe, was man sich fuer 20.000 Chips kaufen kann. Etwas, wofuer man
  // acht Wochen spielt, muss anders aussehen als alles Kaufbare.
  { id: "s2_bernstein", label: "Bernstein", cost: null, via: "Season 2, Stufe 10", season: "porta-herbst-2", preview: ["#ffb347", "#7a3d00"], motion: true },
  { id: "s2_phoenix",   label: "Glut",      cost: null, via: "Season 2, Stufe 20", season: "porta-herbst-2", preview: ["#fff3b0", "#ff2d00"], motion: true },
  /*
   * Fortuna. Sieben Stueck, mehr wird es nie geben, und es gibt sie nur am
   * Glueckrad. Kein weiterer Streifenverlauf: im Namen dreht sich ein Rad aus
   * zwoelf Goldsegmenten, genau wie das Glueckrad zwoelf Felder hat.
   */
  { id: "rad_fortuna", label: "Fortuna", cost: null, via: "Am Glücksrad gewonnen", limitiert: "rad", preview: ["#fff3c4", "#a97c1a"], motion: true },
  /* Auktionsware. Kein Verlauf, der wandert, sondern ein Bild, das flimmert:
     die Farbkanten laufen auseinander wie bei einem schlechten Beamer, und
     waagerechte Zeilen ziehen durch die Schrift. */
  { id: "auk_hologramm", label: "Hologramm", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", preview: ["#7ef9ff", "#ff5ecb"], motion: true },
  /* Aus der Kiste. Kein weiterer Verlauf: die Schrift ist lackiert, und ein
     Glanzstreifen wandert schraeg darueber, wie Licht ueber einen frisch
     polierten Kotfluegel. */
  { id: "kiste_lack", label: "Lackiert", cost: null, via: "Nur aus einer Kiste", limitiert: "kiste", preview: ["#d7e3ee", "#5b6b7d"], motion: true },
  /* Nur vom Haus vergeben. Der Name liegt unter einem schwarzen Balken, der
     alle paar Sekunden kurz wegrutscht und ihn freigibt. Das Einzige im
     Laden, das die Schrift VERSTECKT, statt sie zu faerben. */
  { id: "adm_zensiert", label: "Zensiert", cost: null, via: "Wird vom Haus vergeben", limitiert: "haus", preview: ["#101014", "#e9e9ef"], motion: true },
  /* Belohnung fuer die Kollektion "Feuer". Gibt es nur dafuer: nicht aus
     Kisten, nicht auf dem Markt, nicht vom Haus. Die Schrift glueht von
     innen und zieht dabei Hitzeschlieren nach oben. */
  { id: "sml_glutkern", label: "Glutkern", cost: null, via: "Kollektion „Feuer“ vollständig", limitiert: "sammlung", preview: ["#fff0a8", "#c21807"], motion: true },
  /*
   * Zwei neue Spitzenstuecke, und beide bewegen sich in eine Richtung, in
   * die hier vorher nichts ging.
   *
   * Jeder Stil im Haus schiebt seinen Verlauf WAAGERECHT durch die Schrift
   * — das ist `pl-sweep`, und nach dem zwoelften Mal sieht man den
   * Unterschied nicht mehr. Polarlicht zieht senkrecht, in weichen
   * Vorhaengen, und Hochspannung bewegt gar keinen Verlauf: dort schlaegt
   * alle paar Sekunden ein Blitz quer durch den Namen.
   */
  { id: "aurora", label: "Polarlicht", cost: 900000, preview: ["#6ef2c0", "#6a5acd"], motion: true },
  { id: "hochspannung", label: "Hochspannung", cost: 1400000, preview: ["#bff0ff", "#1b6fe0"], motion: true },
  /*
   * Gala, mythisch. Kein Verlauf, der wandert, sondern ein RELIEF: die
   * Schrift ist in Gold gegossen, hat eine helle obere und eine dunkle
   * untere Kante, und ein harter Lichtstreifen faehrt darueber. Der
   * Unterschied zu Goldschimmer ist genau das Relief — dort wandert Farbe,
   * hier wandert Licht ueber etwas, das eine Form hat.
   */
  { id: "gala_gravur", label: "Gravur", cost: 1600000, nur: "gala", preview: ["#fff3c4", "#8a6a12"], motion: true },
  /*
   * Das Einzelstueck der Gala-Kiste, und das aufwendigste Stueck im ganzen
   * Haus. Die Schrift steht im Dunkeln, ein Scheinwerferkegel faehrt
   * langsam darueber und laesst sie aufleuchten, waehrend der Rest fast
   * schwarz bleibt; hinterher rieselt Konfetti durch das Licht. Kein
   * anderer Stil arbeitet mit Licht UND Schatten, alle anderen faerben nur.
   */
  { id: "gala_rampenlicht", label: "Rampenlicht", cost: null, via: "Nur aus der Gala-Kiste", limitiert: "kiste", nur: "gala", preview: ["#fff6d8", "#2a2418"], motion: true },
  /* Exklusiv im Prägeatelier. Quecksilber ist kein weiterer bunter Verlauf:
     ein schmaler, fast weißer Reflex läuft durch dunkles flüssiges Metall. */
  { id: "staub_quecksilber", label: "Quecksilber", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "episch", preview: ["#f5f0ff", "#625477"], motion: true },
];

/* Rahmen ums Bild
 * Das Emoji bleibt, bekommt aber einen Ring. Kostet keinen Platz und wirkt
 * ueberall dort, wo Spieler nebeneinander stehen (Online-Liste, Bestenliste,
 * Pokertisch).
 */
const FRAMES = [
  { id: "keiner",    label: "Ohne",        cost: 0 },
  { id: "silber",    label: "Silber",      cost: 40000 },
  { id: "gold",      label: "Gold",        cost: 80000 },
  { id: "neon",      label: "Neon",        cost: 150000 },
  { id: "rotierend", label: "Kreisel",     cost: 400000, motion: true },
  { id: "flamme",    label: "Flamme",      cost: 600000, motion: true },
  { id: "sterne",    label: "Sternenring", cost: 900000, motion: true },
  { id: "s2_wolf",   label: "Wolfsring",   cost: null, via: "Season 2, Stufe 15", season: "porta-herbst-2", motion: true },
  { id: "rad_fortuna", label: "Fortunas Rad", cost: null, via: "Am Glücksrad gewonnen", limitiert: "rad", motion: true },
  /* Nur vom Haus vergeben. Kein Ring, sondern zwei Koerper auf zwei Bahnen:
     einer laeuft aussen herum, einer kippt dagegen. Von allen Rahmen der
     einzige, der nicht um das Bild LIEGT, sondern es umkreist. */
  { id: "adm_orbit", label: "Orbit", cost: null, via: "Wird vom Haus vergeben", limitiert: "haus", motion: true },
  /* Zwei Ringe statt einem, gegenlaeufig und gestrichelt: der erste Rahmen,
     der nach Mechanik aussieht und nicht nach Leuchten. */
  { id: "uhrwerk", label: "Uhrwerk", cost: 850000, motion: true },
  /* Einzelstueck aus der Kiste. Der Ring ist in drei Boegen zerbrochen; sie
     treiben auseinander und schnappen wieder zusammen. */
  { id: "kiste_sprung", label: "Sprung", cost: null, via: "Nur aus einer Kiste", limitiert: "kiste", motion: true },
  /* Gala, episch. Kein Ring, sondern zwei Lorbeerzweige, die sich unten
     treffen und oben offen bleiben — wie auf der Kiste. */
  { id: "gala_kranz", label: "Lorbeerkranz", cost: 390000, nur: "gala", motion: true },
  /* Ein gezahnter, gegenläufiger Doppelring – exklusiv im Atelier. */
  { id: "staub_zahnkranz", label: "Zahnkranz", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "episch", motion: true },
];

/* Titel
 * Eine kurze Zeile unter dem Namen. Das ist die einzige Kosmetik, mit der man
 * etwas ueber sich sagen kann, statt nur bunt zu sein.
 */
const TITLES = [
  { id: "keiner",     text: null,                  cost: 0 },
  { id: "stammgast",  text: "Stammgast",           cost: 25000 },
  { id: "nachtschicht", text: "Nachtschicht",      cost: 25000 },
  { id: "pechvogel",  text: "Pechvogel",           cost: 25000 },
  { id: "bankrotteur", text: "Der Bankrotteur",    cost: 50000 },
  { id: "croupier",   text: "Croupier a. D.",      cost: 75000 },
  { id: "hochroller", text: "Hochroller",          cost: 100000 },
  { id: "tischherr",  text: "Tischherr",           cost: 100000 },
  { id: "zaehler",    text: "Kartenzähler",        cost: 150000 },
  { id: "hausherr",   text: "Hausherr von Porta",  cost: 200000 },
  { id: "legende",    text: "Legende von Porta",   cost: 1000000 },
  // Nicht kaeuflich: kommt mit dem ersten kompletten Strassen-Monopol.
  { id: "strassenkoenig", text: "Straßenherr", cost: null, via: "Eine Straße komplett besitzen" },
  { id: "s2_phoenix",     text: "Phönix von Porta", cost: null, via: "Season 2, Stufe 20", season: "porta-herbst-2" },
  /*
   * Nur fuer die, die zur Wiedereroeffnung da waren. Danach gibt es ihn nie
   * wieder, weder zu kaufen noch zu verdienen. Genau das macht ihn wertvoll:
   * er sagt nichts ueber Koennen oder Kontostand, sondern nur, dass man dabei
   * war, als das Casino wieder aufmachte.
   */
  { id: "rueckkehrer",    text: "Rückkehrer", cost: null, via: "Zur Wiedereröffnung dabei gewesen", limitiert: "comeback" },
  { id: "rad_fortuna",    text: "Glückspilz", cost: null, via: "Am Glücksrad gewonnen", limitiert: "rad" },
  /* Zwei Insider aus der Runde. Standen erst bei 6,7 und 2,5 Millionen. Das
     waren 71 Prozent des gesamten fluessigen Geldes im Haus, und genau drei
     Konten lagen ueberhaupt ueber einer Million. Ein Preis, den niemand je
     zahlen kann, ist kein Statussymbol, sondern eine Zahl zum Angucken.
     Jetzt: 67.676 (die Zahl ist der Witz) und 250.000. */
  { id: "sechssieben",    text: "67",                        cost: 67676 },
  { id: "seiten25",       text: "25 pages on november 26th", cost: 250000 },
  { id: "auk_meistbietend", text: "Meistbietend", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion" },
  /* Gala. Zwei Stufen derselben Geschichte: erst eingeladen, dann
     nominiert. */
  { id: "gala_gast",      text: "Ehrengast", cost: 22000,  nur: "gala" },
  { id: "gala_nominiert", text: "Nominiert", cost: 85000,  nur: "gala" },
];

/* Gewinn-Effekt
 * Was auf dem Bildschirm passiert, wenn du gross gewinnst. Bisher sah das bei
 * allen gleich aus. Der Effekt gehoert zu den Sachen, die man am haeufigsten
 * von seiner eigenen Kosmetik sieht, jedes Mal, wenn es sich gelohnt hat.
 */
const EFFEKTE = [
  { id: "konfetti", label: "Konfetti",   cost: 0 },
  { id: "muenzen",  label: "Münzflut",   cost: 90000 },
  { id: "gold",     label: "Goldregen",  cost: 180000 },
  { id: "feuerwerk", label: "Feuerwerk", cost: 350000 },
  { id: "blitz",    label: "Blitzschlag", cost: 550000 },
  { id: "sterne",   label: "Sternenfall", cost: 800000 },
  /*
   * Nur aus dem Wiedereroeffnungs-Paket. Vorher lag dort das Feuerwerk, das
   * man sich auch fuer 350.000 kaufen kann, ein Geschenk, das im Laden steht,
   * ist kein besonderes Geschenk. Der Salut ist ausschliesslich darueber zu
   * bekommen und danach nie wieder.
   */
  { id: "salut",    label: "Salut",       cost: null, via: "Zur Wiedereröffnung dabei gewesen", limitiert: "comeback", motion: true },
  // Auktionsware: kein Regen von oben, sondern eine Druckwelle aus der Mitte.
  { id: "auk_tresor", label: "Tresorsprengung", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  /*
   * Gala, legendaer. Der einzige Effekt ohne Teilchen: keine Bahn, kein
   * Fallen, kein Fliegen. Ringsum gehen Blitze los wie bei einer Reihe
   * Pressefotografen, ein paar Dutzend Mal in anderthalb Sekunden. Genau
   * deshalb ist er drin: alles andere im Haus wirft etwas.
   */
  { id: "gala_blitzlicht", label: "Blitzlichtgewitter", cost: 620000, nur: "gala", motion: true },
];

/* Eintritts-Spruch
 * Eine Zeile im Chat, wenn du reinkommst. Das ist die einzige Kosmetik, die
 * die anderen sehen, ohne dich anzutippen, und in einer Runde, die versetzt
 * spielt, ist "wer ist gerade aufgetaucht" die interessanteste Nachricht
 * ueberhaupt.
 */
const SPRUECHE = [
  { id: "keiner",   text: null,                                   cost: 0 },
  { id: "da",       text: "{name} ist da.",                       cost: 30000 },
  { id: "betritt",  text: "{name} betritt das Casino.",           cost: 60000 },
  { id: "tuer",     text: "Die Tür geht auf: {name}.",            cost: 90000 },
  { id: "haus",     text: "Das Haus grüßt {name}.",               cost: 150000 },
  { id: "warnung",  text: "Vorsicht, {name} ist wieder im Spiel.", cost: 250000 },
  { id: "legende",  text: "Eine Legende betritt den Raum: {name}.", cost: 600000 },
  /*
   * Selbst geschrieben. Teuerstes Stueck im Laden, und mit Absicht so gebaut,
   * dass daraus kein Aerger werden kann: der eigene Name steht immer vorne
   * und laesst sich nicht wegschreiben, der Rest ist auf 60 Zeichen begrenzt
   * und wird beim Anzeigen escaped. Man kann sich also einen Satz ausdenken,
   * aber niemandem etwas in den Mund legen.
   */
  { id: "eigen", text: "{name} …", eigen: true, cost: 900000 },
  /* Gala, episch. */
  { id: "gala_auftritt", text: "{name} betritt den roten Teppich.", cost: 280000, nur: "gala" },
];

const SPRUCH_MAX = 60;

/* Profil-Banner
 * Der Streifen hinter deinem Namen im Profil. Reine Flaeche, aber es ist das
 * Erste, was jemand sieht, der dich antippt.
 */
const BANNER = [
  { id: "keiner",  label: "Ohne",        cost: 0 },
  { id: "filz",    label: "Filztisch",   cost: 50000 },
  { id: "nacht",   label: "Mitternacht", cost: 50000 },
  { id: "sonne",   label: "Abendrot",    cost: 120000 },
  { id: "welle",   label: "Weserwelle",  cost: 200000 },
  { id: "gold",    label: "Blattgold",   cost: 400000 },
  { id: "nordlicht", label: "Nordlicht", cost: 700000, motion: true },
  { id: "auk_gewitter", label: "Gewitter", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  /* Gala, selten. Ein roter Laeufer mit Goldkante, der schraeg nach hinten
     laeuft — Flaeche, aber mit Richtung. */
  { id: "gala_teppich", label: "Roter Teppich", cost: 55000, nur: "gala" },
  /* Blaupause: feine Konstruktionslinien plus wandernder Prüfstrahl. */
  { id: "staub_blaupause", label: "Blaupause", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "selten", motion: true },
];

/* Namensschild
 * Der Hintergrund der Zeile, in der du in der Online-Liste und in der
 * Bestenliste stehst. Der Rahmen ums Bild war nur ein Ring um ein Emoji; das
 * Schild faerbt die ganze Plakette und faellt deshalb viel staerker auf.
 */
const SCHILDER = [
  { id: "keins",   label: "Ohne",       cost: 0 },
  { id: "messing", label: "Messing",    cost: 70000 },
  { id: "jade",    label: "Jade",       cost: 70000 },
  { id: "rubin",   label: "Rubin",      cost: 120000 },
  { id: "karo",    label: "Karo",       cost: 220000 },
  { id: "neon",    label: "Neonschild", cost: 380000 },
  { id: "puls",    label: "Herzschlag", cost: 650000, motion: true },
  { id: "prisma",  label: "Prisma",     cost: 950000, motion: true },
  // Auktionsware: als Einziges kein Farbverlauf, sondern Metall.
  { id: "auk_tresor", label: "Tresortür", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  /* Belohnung fuer die Kollektion "Porta". Gebuerstetes Messing mit einer
     Welle darin, die langsam durchlaeuft. */
  { id: "sml_wesergold", label: "Wesergold", cost: null, via: "Kollektion „Porta“ vollständig", limitiert: "sammlung", motion: true },
  /* Das teuerste Schild. Kein Verlauf, der wandert, sondern ein Pegel: das
     Wasser laeuft von unten in die Plakette und faellt wieder ab. */
  { id: "gezeiten", label: "Gezeiten", cost: 1300000, motion: true },
  /* Gala, episch. Bordeauxfarbener Samt mit einer goldenen Kordel am Rand,
     wie die Absperrung vor dem Eingang. */
  { id: "gala_samt", label: "Samtkordel", cost: 190000, nur: "gala" },
  /* Flüssiges Metall mit einem glühenden Kern, exklusiv im Atelier. */
  { id: "staub_schmelzkern", label: "Schmelzkern", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "legendaer", motion: true },
];

/* Aura
 *
 * Neue Art. Der Rahmen ist ein Ring am Bild, der Gewinn-Effekt passiert einmal
 * und ist wieder weg. Die Aura ist das, was um dich herum immer läuft:
 * in der Online-Liste, in der Bestenliste, am Pokertisch, im Chat. Damit ist
 * sie die einzige Kosmetik, die man auch dann sieht, wenn gerade nichts
 * passiert, und deshalb gehört sie ins Auktionshaus und nicht in den Laden.
 */
const AUREN = [
  { id: "keine", label: "Ohne", cost: 0 },
  { id: "auk_goldstaub", label: "Goldstaub", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  { id: "auk_leere",     label: "Schwarzes Loch", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  /* Aus der Kiste. Goldstaub schwebt, das hier schiesst: kurze Funken, die
     geradlinig wegfliegen und verloeschen. */
  { id: "kiste_funken",  label: "Funkenflug", cost: null, via: "Nur aus einer Kiste", limitiert: "kiste", motion: true },
  /* Nur vom Haus vergeben. Eine schwarze Scheibe verdeckt das Bild fast
     ganz, aussen herum steht eine goldene Korona, die langsam wandert. */
  { id: "adm_eklipse",   label: "Eklipse", cost: null, via: "Wird vom Haus vergeben", limitiert: "haus", motion: true },
  /* Belohnung fuer die Kollektion "Mitternacht". Kein Leuchten und kein
     Sog, sondern Bewegung: kleine dunkle Koerper kreisen dicht um das Bild
     und blitzen nur auf, wenn sie vorne durchziehen. */
  { id: "sml_nachtschwarm", label: "Nachtschwarm", cost: null, via: "Kollektion „Mitternacht“ vollständig", limitiert: "sammlung", motion: true },
  /* Einzelstueck aus der Kiste. Alle anderen Auren liegen UM das Bild;
     dieser Ring liegt schraeg DURCH es hindurch, wie bei einem Planeten,
     und dreht sich langsam. */
  { id: "kiste_ringsystem", label: "Ringsystem", cost: null, via: "Nur aus einer Kiste", limitiert: "kiste", motion: true },
  /* Gala, legendaer. Die anderen Auren schweben, schiessen, kreisen oder
     liegen. Diese FAELLT: Konfetti rieselt am Bild vorbei nach unten. */
  { id: "gala_konfetti", label: "Konfettiregen", cost: 950000, nur: "gala", motion: true },
  /* Eine kleine Sternenschmiede: Ring, Funken und violette Korona. */
  { id: "staub_sternenschmiede", label: "Sternenschmiede", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "legendaer", motion: true },
];

/* Kartenrücken
 *
 * Neue Art. Das Blatt, mit dem DU spielst: die verdeckten Karten in Poker,
 * Blackjack, Solitär und Memory. Vier Spiele haben dafür bisher vier
 * verschiedene Rückseiten fest eingebaut gehabt; wer hier etwas anlegt,
 * überschreibt alle vier auf seinem eigenen Bildschirm.
 *
 * Absichtlich nur auf dem eigenen Bildschirm. Das Blatt der anderen mit
 * fremden Rücken zu zeigen hiesse, in jeder Kartenrunde zu jeder Karte den
 * Besitzer mitzuschicken, für ein Aussehen ist das zu viel Umbau.
 */
/* Chat-Zeichen
 *
 * Die neue Art, und sie loest das eigentliche Problem mit Kosmetik in diesem
 * Haus: fast nichts davon sieht jemand. Ein Kartenruecken wirkt nur auf dem
 * eigenen Bildschirm, eine Aura nur, solange zwei gleichzeitig online sind,
 * ein Banner erst, wenn dich jemand antippt. Der Chat ist die einzige
 * Flaeche, die jeder liest, auch Stunden spaeter, und dort steht bisher nur
 * ein Name.
 *
 * `zeichen` ist deshalb bewusst klein: ein einzelnes Symbol vor jeder
 * Nachricht. Es soll nicht die Zeile uebernehmen, es soll dastehen.
 *
 * Gezeichnete Symbole aus core/icons.js, keine Emoji: die bringen ihre
 * eigene Farbe mit und passen in keinem der drei Designs.
 */
const ZEICHEN = [
  { id: "keins",   label: "Ohne",        icon: null,            cost: 0 },
  { id: "stern",   label: "Stern",       icon: "stern-voll",    cost: 20000 },
  { id: "flagge",  label: "Flagge",      icon: "flagge",        cost: 35000 },
  { id: "ziel",    label: "Zielscheibe", icon: "ziel",          cost: 60000 },
  { id: "blitz",   label: "Blitz",       icon: "blitz",         cost: 110000 },
  { id: "edelstein", label: "Edelstein", icon: "edelstein",     cost: 200000 },
  { id: "krone",   label: "Krone",       icon: "krone",         cost: 380000 },
  { id: "bombe",   label: "Bombe",       icon: "bombe",         cost: 550000 },
  { id: "totenkopf", label: "Totenkopf", icon: "totenkopf",     cost: 900000 },
  // Auktionsware: das einzige Zeichen, das sich bewegt.
  { id: "auk_marke", label: "Hausmarke", icon: "marke", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
  /* Drei Nachzuegler, damit die Art nicht nach oben hin duenn wird: unter
     einer Million stand bisher nur der Totenkopf. */
  { id: "hai",     label: "Hai",      icon: "hai",          cost: 150000 },
  { id: "klingen", label: "Klingen",  icon: "krieg",        cost: 300000 },
  { id: "tresor",  label: "Tresor",   icon: "schatzkammer", cost: 700000 },
  /* Gala, gewoehnlich und selten. */
  { id: "gala_konfetti", label: "Konfetti",  icon: "konfetti",   cost: 15000,  nur: "gala" },
  { id: "gala_stern",    label: "Goldstern", icon: "gala-stern", cost: 115000, nur: "gala" },
  /* Das kleine Siegel ist absichtlich im Chat sichtbar: Atelierstücke
     sollen auch auffallen, wenn niemand gleichzeitig online ist. */
  { id: "staub_siegel", label: "Prägesiegel", icon: "marke", cost: null, via: "Nur im Prägeatelier", limitiert: "staub", nur: "staub", staubTier: "selten", motion: true },
];

const KARTEN = [
  { id: "haus", label: "Haus-Standard", cost: 0 },
  { id: "auk_schwarzeshaus", label: "Schwarzes Haus", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion" },
  { id: "auk_spiegel",       label: "Spiegel", cost: null, via: "Nur im Auktionshaus zu ersteigern", limitiert: "auktion", motion: true },
];

const avaById = Object.fromEntries(AVATARS.map((a) => [a.id, a]));
const colById = Object.fromEntries(COLORS.map((c) => [c.id, c]));
const styById = Object.fromEntries(STYLES.map((x) => [x.id, x]));
const frmById = Object.fromEntries(FRAMES.map((x) => [x.id, x]));
const titById = Object.fromEntries(TITLES.map((x) => [x.id, x]));
const effById = Object.fromEntries(EFFEKTE.map((x) => [x.id, x]));
const sprById = Object.fromEntries(SPRUECHE.map((x) => [x.id, x]));
const banById = Object.fromEntries(BANNER.map((x) => [x.id, x]));
const schById = Object.fromEntries(SCHILDER.map((x) => [x.id, x]));
const aurById = Object.fromEntries(AUREN.map((x) => [x.id, x]));
const karById = Object.fromEntries(KARTEN.map((x) => [x.id, x]));
const zeiById = Object.fromEntries(ZEICHEN.map((x) => [x.id, x]));

// Ein Topf je Art. Alte Accounts haben nur avatars/colors, der Rest kommt
// beim ersten Zugriff dazu.
const TOPF = { avatar: "avatars", color: "colors", style: "styles", frame: "frames", title: "titles",
  effect: "effects", spruch: "sprueche", banner: "banner", schild: "schilder", aura: "auren", karte: "karten",
  zeichen: "zeichen" };
const KATALOG = { avatar: avaById, color: colById, style: styById, frame: frmById, title: titById,
  effect: effById, spruch: sprById, banner: banById, schild: schById, aura: aurById, karte: karById,
  zeichen: zeiById };

/* Was eine Nummer bekommt und was gehandelt werden darf
 *
 * Beides faellt aus dem Katalog, nichts muss doppelt gepflegt werden.
 *
 * GEPRAEGT wird alles, was man nicht kaufen kann (`cost: null`). Ladenware
 * bleibt ohne Nummer: "Nr. 4312 von unendlich" waere keine Auszeichnung.
 *
 * GEHANDELT werden darf fast alles davon, und das ist eine Folge davon, dass
 * es den Laden nicht mehr gibt: solange man ein Stueck nachkaufen konnte,
 * waere ein Markt dafuer nur ein zweiter Preis fuer dieselbe Sache gewesen.
 * Jetzt entsteht jedes Exemplar erst in dem Moment, in dem es jemand aus
 * einer Kiste zieht, und damit ist es echte Ware.
 *
 * Drei Sorten bleiben aussen vor, jede aus einem eigenen Grund:
 * die Haus-Stuecke (der Besitzer vergibt sie persoenlich; kaufbar waeren sie
 * genau nicht mehr das, wofuer sie gedacht sind), die Sammlungs-Belohnungen
 * (kaufen waere die Abkuerzung um das herum, wofuer es sie gibt) und die
 * verdienbaren Stuecke wie Krone und Strassenherr (die bleiben fuer jeden
 * erreichbar, wer sie will, holt sie sich selbst).
 *
 * Dass Rueckkehrer und Salut handelbar sind, ist eine bewusste Entscheidung:
 * die Praegung sagt die Wahrheit ueber sie. Auf dem Stueck steht, fuer wen es
 * gepraegt wurde, und wer es gekauft hat, sieht das genauso wie alle anderen.
 * Es luegt also nichts, und der Markt hat von Tag eins rund neunzig Exemplare
 * statt elf.
 */
function praegbar(art, id) {
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  /* Alles ausser den Gratis-Stuecken. Seit es den Laden nicht mehr gibt,
     entsteht jedes Stueck erst in dem Moment, in dem es jemand aus einer
     Kiste zieht; damit ist auch bei der frueheren Ladenware eine zufaellige
     Serienpraegung etwas wert. */
  return !!item && item.cost !== 0;
}
function handelbar(art, id) {
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  if (!item || item.cost === 0) return false;
  /* `haus` sind die Stuecke, die der Besitzer persoenlich vergibt.
     Handelbar waeren sie nur sehr seltene Ware, die sich der naechste
     Reiche einfach kauft, und damit genau nicht mehr das, wofuer sie
     gedacht sind. Sie bleiben bei dem, der sie bekommen hat. */
  if (item.limitiert === "haus") return false;
  /* Sammlungs-Belohnungen auch nicht. Sie kaufen zu koennen waere die
     Abkuerzung um genau das herum, wofuer es sie gibt. */
  if (item.limitiert === "sammlung") return false;
  /* Atelierstücke sind persönliche Wochenpreise. Handel würde den ganzen
     Prägestaub-Weg abkürzen und sie wieder zu normaler Marktware machen. */
  if (item.limitiert === "staub") return false;
  /* Verdienbares auch nicht: Krone fuer den Ortsteil-Boss, Strassenherr fuer
     die erste komplette Strasse. Die bleiben fuer jeden erreichbar, wer sie
     will, holt sie sich selbst, und ein Markt dafuer waere nur eine
     Abkuerzung um das Spiel herum. Erkennbar daran, dass sie weder einen
     Preis noch eine Begrenzung noch eine Season haben. */
  if (item.cost == null && !item.limitiert && !item.season) return false;
  return true;
}

/** Einmalig beim Start: vorhandene Bestaende nachtraeglich praegen. */
function praegungNachtragen(accounts) {
  try {
    return praegung.nachtragen(accounts, praegbar, TOPF);
  } catch (e) {
    console.error("praegung: Nachtrag fehlgeschlagen.", e.message);
    return 0;
  }
}

/**
 * Wie ein Exemplar beschriftet wird.
 *
 * Steht bewusst hier und nicht im Register: das Register kennt den Katalog
 * nicht und weiss deshalb nicht, wie viele es von einer Sorte hoechstens
 * gibt. Fortuna hat eine harte Obergrenze, die anderen nicht.
 */
function praegeText(art, id) {
  const n = praegung.bestand(art, id);
  if (art === "style" && id === "rad_fortuna") return `von ${FORTUNA_MAX}`;
  return n ? `von bisher ${n}` : "";
}

function ensureOwned(acc) {
  const o = acc.cosOwned && typeof acc.cosOwned === "object" ? acc.cosOwned : (acc.cosOwned = {});
  for (const k of Object.values(TOPF)) if (!Array.isArray(o[k])) o[k] = [];
  return o;
}

function setupCosmetics(io, accounts) {
  io.on("connection", (socket) => {
    const acct = () => (socket.data.account ? accounts.get(socket.data.account) : null);

    function state(acc) {
      const owned = ensureOwned(acc);
      // Nicht verwechseln: cost === 0 ist "gratis fuer alle", cost === null ist
      // "nicht kaeuflich, nur ueber Season oder Stadt". Die beiden duerfen
      // nicht in denselben Topf, sonst gehoerte alles jedem.
      const hat = (art, id) => KATALOG[art][id].cost === 0 || owned[TOPF[art]].includes(id);
      const eqAva = acc.avatar || "🙂", eqCol = acc.nameColor || null;
      /*
       * Es gibt drei Sorten von "nicht kaeuflich", und sie bedeuten voellig
       * Verschiedenes:
       *   season    laeuft mit der Season ab und kommt nie wieder
       *   comeback  gibt es nur, solange das Wiedereroeffnungs-Fenster offen
       *             ist, danach nie wieder
       *   verdienbar (weder noch) bleibt fuer immer erreichbar, man muss es
       *             sich nur holen (Ortsteil-Boss, komplette Strasse)
       *
       * Ohne diese Unterscheidung stand ueberall nur ein Schloss, und niemand
       * konnte sehen, wo es eilt.
       */
      let seasonEnde = 0, comebackEnde = 0;
      try { seasonEnde = require("./season").SEASON.endsAt || 0; } catch {}
      try { const cb = require("./comeback").publicState(null); comebackEnde = cb.geschenkOffen ? cb.geschenkBis : 0; } catch {}
      const radRest = Math.max(0, FORTUNA_MAX - fortunaVergeben(accounts));
      /* Woher ein Stueck kommt, in einem Wort. Seit es den Laden nicht mehr
         gibt, ist das die wichtigste Angabe an einem Stueck, das man noch
         nicht hat: der Preis stand frueher fuer "so kommst du dran", und
         diese Rolle hat jetzt die Herkunft. */
      const herkunftVon = (item) => {
        if (item.cost === 0) return "gratis";
        if (item.nichtInKisten) return "markt";
        if (item.cost != null) return "kiste";
        if (item.limitiert) return item.limitiert;   // auktion, rad, comeback, kiste, haus
        if (item.season) return "season";
        return "verdienbar";
      };
      /*
       * Die Praegung der eigenen Stuecke.
       *
       * Einmal je Aufruf als Buendel und nicht je Stueck einzeln nachgefragt:
       * das Register durchsuchen heisst ueber alle Exemplare im Haus laufen,
       * und der Laden zeigt ueber siebzig Eintraege auf einmal an.
       */
      const key = socket.data.account || "";
      const meine = praegung.alleVon(key);
      const praegeInfo = (art, id) => {
        if (!praegbar(art, id)) return null;
        let st = meine[`${art}:${id}`];
        /* Sicherheitsnetz: wer ein prägbares Stück besitzt, muss auch ein
           Exemplar davon haben. Nachgetragen wird nur einmal, und grant()
           wird von fünf Stellen gerufen; eine vergessene davon ergäbe ein
           Stück ohne Nummer, das nie eine bekommt. Hier fällt das auf und
           wird still geheilt, statt für immer zu fehlen. */
        if (!st && key && owned[TOPF[art]] && owned[TOPF[art]].includes(id)) {
          st = praegung.praegen(art, id, key, acc.name) || null;
          if (st) meine[`${art}:${id}`] = st;
        }
        return {
          bestand: praegung.bestand(art, id),
          handelbar: handelbar(art, id),
          nr: st ? st.nr : null,
          serie: st ? st.serie : null,
          altNr: st ? st.altNr || null : null,
          gepraegtAm: st ? st.gepraegtAm : null,
          fuer: st ? st.fuerName : null,
          haende: st ? st.kette.length : 0,
        };
      };
      /* Die Seltenheitsstufe kommt vom SERVER, nicht aus einer zweiten
         Tabelle im Client. Sie steht an vier Stellen im Haus (Marke am
         Namen, Kisteninhalt, Markt, Sammlung), und zwei Schwellenlisten
         laufen beim naechsten neuen Stueck garantiert auseinander. */
      const mitPraegung = (art) => (x) => {
        const p = praegeInfo(art, x.id);
        return {
          herkunft: herkunftVon(x),
          wert: x.cost || 0,
          stufe: stufeKennung(x),
          ...(p ? { praegung: p } : {}),
        };
      };
      return {
        chips: acc.chips,
        fristen: { season: seasonEnde, comeback: comebackEnde },
        fortuna: { rest: radRest, max: FORTUNA_MAX },
        serien: praegung.serienRegeln(),
        avatars: AVATARS.map((a) => ({ ...a, owned: hat("avatar", a.id), equipped: a.emoji === eqAva, ...mitPraegung("avatar")(a) })),
        colors: COLORS.map((c) => ({ ...c, owned: hat("color", c.id), equipped: (c.color || null) === eqCol, ...mitPraegung("color")(c) })),
        styles: STYLES.map((x) => ({ ...x, owned: hat("style", x.id), equipped: (acc.nameStyle || "standard") === x.id, ...mitPraegung("style")(x) })),
        frames: FRAMES.map((x) => ({ ...x, owned: hat("frame", x.id), equipped: (acc.frame || "keiner") === x.id, ...mitPraegung("frame")(x) })),
        titles: TITLES.map((x) => ({ ...x, owned: hat("title", x.id), equipped: (acc.title || "keiner") === x.id, ...mitPraegung("title")(x) })),
        effects: EFFEKTE.map((x) => ({ ...x, owned: hat("effect", x.id), equipped: (acc.winEffect || "konfetti") === x.id, ...mitPraegung("effect")(x) })),
        sprueche: SPRUECHE.map((x) => ({ ...x, owned: hat("spruch", x.id), equipped: (acc.spruch || "keiner") === x.id, ...mitPraegung("spruch")(x) })),
        banner: BANNER.map((x) => ({ ...x, owned: hat("banner", x.id), equipped: (acc.banner || "keiner") === x.id, ...mitPraegung("banner")(x) })),
        schilder: SCHILDER.map((x) => ({ ...x, owned: hat("schild", x.id), equipped: (acc.schild || "keins") === x.id, ...mitPraegung("schild")(x) })),
        auren: AUREN.map((x) => ({ ...x, owned: hat("aura", x.id), equipped: (acc.aura || "keine") === x.id, ...mitPraegung("aura")(x) })),
        karten: KARTEN.map((x) => ({ ...x, owned: hat("karte", x.id), equipped: (acc.karte || "haus") === x.id, ...mitPraegung("karte")(x) })),
        zeichen: ZEICHEN.map((x) => ({ ...x, owned: hat("zeichen", x.id), equipped: (acc.zeichen || "keins") === x.id, ...mitPraegung("zeichen")(x) })),
        prunk: acc.prunk || null,
        garnitur: garniturVon(acc),
        /* Fuer jede Familie: wie viele es gibt, wie viele man hat, wie
           viele man gerade traegt. Ohne diese drei Zahlen ist die Garnitur
           eine Marke, die irgendwann auftaucht, statt eines Ziels. */
        familien: familienStand(acc),
        garniturAb: GARNITUR_AB,
        sammlungen: sammlungen.fortschritt(acc, hatStueck).map((k) => ({
          ...k,
          teile: k.teile.map((t) => ({
            ...t,
            label: label(t.art, t.id),
            look: vorschauDaten(t.art, t.id),
            stufe: stufeVonStueck(t.art, t.id),
          })),
          belohnung: {
            ...k.belohnung,
            label: label(k.belohnung.art, k.belohnung.id),
            look: vorschauDaten(k.belohnung.art, k.belohnung.id),
            stufe: stufeVonStueck(k.belohnung.art, k.belohnung.id),
          },
        })),
        spruchText: acc.spruchText || "",
        spruchMax: SPRUCH_MAX,
      };
    }

    socket.on("cos:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...state(acc) });
    });

    /*
     * Kaufen gibt es nicht mehr.
     *
     * Der Laden war der groesste Chip-Abfluss des Hauses und wurde nicht
     * benutzt: von 80 Konten haben zusammen rund fuenfzehn Stuecke jemals
     * jemand gekauft. Einen Preis anzutippen ist keine Runde, und in einem
     * Haus, in dem alles andere eine Ziehung ist, war das der langweiligste
     * Knopf. Kosmetik kommt jetzt aus den Kisten (game/kisten.js) und vom
     * Markt (game/market.js), und beide sind Runden.
     *
     * Das Ereignis bleibt stehen und antwortet freundlich, statt zu
     * verschwinden: ein alter Client, der es noch schickt, soll erfahren,
     * warum nichts passiert, statt in eine Zeitueberschreitung zu laufen.
     */
    socket.on("cos:buy", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: false, error: "Kosmetik gibt es nur noch aus Kisten und auf dem Markt." });
    });

    // Eigener Spruchtext. Getrennt vom Anlegen, weil er sich aendern laesst,
    // ohne dass man das Stueck neu kauft.
    socket.on("cos:spruchText", ({ text } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const owned = ensureOwned(acc);
      if (!owned.sprueche.includes("eigen")) return ack({ ok: false, error: "Eigenen Spruch zuerst kaufen." });
      const spruch = saubererSpruch(text);
      // Der Spruch geht bei jedem Eintritt in den Chat, dort steht er
      // haeufiger als jeder Name.
      const wf = require("./wortfilter").pruefe(spruch, "Der Spruch");
      if (!wf.ok) return ack({ ok: false, error: wf.error });
      acc.spruchText = spruch;
      accounts.save();
      ack({ ok: true, ...state(acc) });
    });

    /* Prunkstueck festlegen. Eigenes Ereignis und nicht Teil von cos:equip:
       angelegt wird je Art eins, das Prunkstueck ist EINES fuer alles. */
    socket.on("cos:prunk", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!type || !id) { delete acc.prunk; accounts.save(); return ack({ ok: true, ...state(acc) }); }
      const item = KATALOG[type] ? KATALOG[type][id] : null;
      if (!item) return ack({ ok: false, error: "Unbekannt." });
      if (!praegbar(type, id)) return ack({ ok: false, error: "Nur Stücke mit Nummer können ein Prunkstück sein." });
      const owned = ensureOwned(acc)[TOPF[type]];
      if (!owned.includes(id)) return ack({ ok: false, error: "Gehört dir nicht." });
      acc.prunk = `${type}:${id}`;
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
    });

    socket.on("cos:equip", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const owned = ensureOwned(acc);
      const item = KATALOG[type] ? KATALOG[type][id] : null;
      if (!item) return ack({ ok: false, error: "Unbekannt." });
      if (item.cost !== 0 && !owned[TOPF[type]].includes(id)) return ack({ ok: false, error: "Nicht im Besitz." });
      if (type === "avatar") acc.avatar = item.emoji;
      else if (type === "color") acc.nameColor = item.color;
      else if (type === "style") acc.nameStyle = id === "standard" ? null : id;
      else if (type === "frame") acc.frame = id === "keiner" ? null : id;
      else if (type === "title") acc.title = id === "keiner" ? null : id;
      else if (type === "effect") acc.winEffect = id === "konfetti" ? null : id;
      else if (type === "spruch") acc.spruch = id === "keiner" ? null : id;
      else if (type === "banner") acc.banner = id === "keiner" ? null : id;
      else if (type === "schild") acc.schild = id === "keins" ? null : id;
      else if (type === "aura") acc.aura = id === "keine" ? null : id;
      else if (type === "karte") acc.karte = id === "haus" ? null : id;
      else if (type === "zeichen") acc.zeichen = id === "keins" ? null : id;
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
    });
  });
}

/**
 * Ein Stueck verschenken (Season-Belohnung). Gibt true zurueck, wenn es neu
 * dazukam, false wenn es schon im Besitz war.
 */
function grant(acc, type, id, key) {
  const item = KATALOG[type] ? KATALOG[type][id] : null;
  if (!acc || !item) return false;
  const list = ensureOwned(acc)[TOPF[type]];
  if (list.includes(id)) return false;
  list.push(id);
  /* Und die Nummer dazu. Der Schluessel kommt vom Aufrufer, wenn er ihn hat;
     sonst aus dem Namen. Das ist die eine Stelle, an der das vertretbar ist:
     grant() bekommt nur das Konto gereicht, und ein frisch vergebenes Stueck
     ohne Nummer waere schlimmer als eins mit einem Schluessel aus dem Namen.
     Nach einer Umbenennung zieht praegung.umbenennen die Kette nach. */
  if (praegbar(type, id)) {
    try { praegung.praegen(type, id, key || normKey(acc), acc.name); } catch {}
  }
  /* Und nachsehen, ob damit gerade eine Kollektion voll geworden ist. Hier
     und nicht an den fuenf Aufrufstellen von grant(): sonst fehlt die
     Pruefung genau an der sechsten, die als naechstes dazukommt. */
  try {
    const fertig = sammlungen.pruefe(acc, key || normKey(acc),
      (a, art, i) => hatStueck(a, art, i),
      (a, art, i, k) => grant(a, art, i, k));
    /* Bewusst NICHT am Konto: das wird gespeichert, und eine Meldung, die
       auf der Platte landet, kommt nach jedem Neustart wieder. */
    if (fertig.length) {
      const k = key || normKey(acc);
      offeneMeldungen.set(k, [...(offeneMeldungen.get(k) || []), ...fertig]);
    }
  } catch {}
  return true;
}

/* Vollstaendig gewordene Kollektionen, bis sie gemeldet sind. Nur im
   Speicher: eine Meldung gehoert nicht in den Spielstand. */
const offeneMeldungen = new Map();

/**
 * Abholen und ansagen, was gerade vollstaendig geworden ist.
 *
 * Wird von den Stellen gerufen, die Stuecke vergeben (Kisten, Markt, Duell).
 * Eine vollstaendige Kollektion ist der seltenste Moment im Haus, und wer
 * sie schafft, soll nicht nur ein neues Stueck in einer Liste finden.
 */
function sammlungAnsage(io, accounts, key) {
  const fertig = offeneMeldungen.get(key);
  if (!fertig || !fertig.length) return [];
  offeneMeldungen.delete(key);
  const acc = accounts.get(key);
  for (const f of fertig) {
    const satz = `${acc ? acc.name : key} hat die Kollektion „${f.kollektion}“ vollständig `
      + `und bekommt „${label(f.art, f.id)}“. Das gibt es auf keinem anderen Weg.`;
    try { require("./chat").announce(io, satz); } catch {}
    try { require("./chronik").notiere("rekord", satz, { user: acc ? acc.name : key }); } catch {}
  }
  return fertig.map((f) => ({ ...f, label: label(f.art, f.id) }));
}

/** Besitzt `acc` dieses Stueck? Gratis-Stuecke hat jeder. */
function hatStueck(acc, art, id) {
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  if (!item) return false;
  if (item.cost === 0) return true;
  return (ensureOwned(acc)[TOPF[art]] || []).includes(id);
}

/* Nur als Rueckfall in grant(): der Schluessel eines Kontos, wenn der
   Aufrufer keinen mitgibt. accounts.js hier zu requiren waere ein Kreis. */
const normKey = (acc) => String((acc && acc.name) || "").trim().toLowerCase();

/* Admin: Stuecke von Hand geben und wegnehmen

   Gebraucht als Ausgleich (etwas ist schiefgegangen), als Preis fuer etwas,
   das ausserhalb des Casinos passiert ist, und zum Zuruecknehmen, wenn ein
   Stueck durch einen Fehler bei jemandem landete.

   Wichtig beim Wegnehmen: was angelegt ist, muss auch abgelegt werden. Sonst
   traegt jemand weiter einen Rahmen, den er nicht mehr besitzt, und beim
   naechsten Speichern steht am Konto eine Kennung, die zu keinem Besitz passt. */

/** Der ganze Katalog, nach Art gruppiert, fuer die Auswahl im Admin. */
function adminKatalog() {
  const out = {};
  for (const [art, tabelle] of Object.entries(KATALOG)) {
    out[art] = Object.keys(tabelle).map((id) => ({
      id,
      label: label(art, id),
      limitiert: tabelle[id].limitiert || null,
      kaeuflich: tabelle[id].cost != null,
    }));
  }
  return out;
}

/** Welches Feld am Konto haelt die angelegte Kennung dieser Art? */
const ANGELEGT = { avatar: "avatar", color: "nameColor", style: "nameStyle", frame: "frame",
  title: "title", effect: "winEffect", spruch: "spruch", banner: "banner", schild: "schild",
  aura: "aura", karte: "karte", zeichen: "zeichen" };

/* Besitz umhaengen, ohne die Praegung anzufassen
 *
 * Fuer den Markt: dort wechselt ein Exemplar den Besitzer, es entsteht keins
 * und es verschwindet keins. `grant` praegt mit und `adminNimm` entpraegt,
 * beides waere hier falsch. Die Praegung zieht der Markt selbst nach, weil
 * nur er den Preis kennt.
 */
function besitzGeben(acc, art, id) {
  if (!KATALOG[art] || !KATALOG[art][id]) return false;
  const liste = ensureOwned(acc)[TOPF[art]];
  if (liste.includes(id)) return false;
  liste.push(id);
  return true;
}
function besitzNehmen(acc, art, id) {
  if (!KATALOG[art] || !KATALOG[art][id]) return false;
  const liste = ensureOwned(acc)[TOPF[art]];
  const i = liste.indexOf(id);
  if (i < 0) return false;
  liste.splice(i, 1);
  /* Was angelegt ist, muss auch abgelegt werden. Sonst traegt jemand weiter
     einen Rahmen, den er gerade verkauft hat, und am Konto steht eine
     Kennung ohne Besitz. Bild und Namensfarbe stehen als WERT am Konto und
     nicht als Kennung, deshalb der Sonderfall. */
  const item = KATALOG[art][id];
  const feld = ANGELEGT[art];
  const angelegt = art === "avatar" ? acc.avatar === item.emoji
    : art === "color" ? acc.nameColor === item.color
    : acc[feld] === id;
  if (feld && angelegt) delete acc[feld];
  return true;
}

function adminGib(acc, art, id) {
  if (!KATALOG[art] || !KATALOG[art][id]) return { ok: false, error: "Kein solches Stück." };
  const neu = grant(acc, art, id);
  return { ok: true, neu, label: label(art, id) };
}

function adminNimm(acc, art, id) {
  if (!KATALOG[art] || !KATALOG[art][id]) return { ok: false, error: "Kein solches Stück." };
  const liste = ensureOwned(acc)[TOPF[art]];
  const i = liste.indexOf(id);
  if (i < 0) return { ok: false, error: "Hat er nicht." };
  liste.splice(i, 1);
  // Das Exemplar verschwindet mit. Die NUMMER bleibt vergeben, sonst bekaeme
  // das naechste gepraegte Stueck dieselbe.
  try {
    const st = praegung.stueckVon(normKey(acc), art, id);
    if (st) praegung.entpraegen(st.uid);
  } catch {}
  /* Bild und Namensfarbe stehen am Konto als Wert und nicht als Kennung
     (acc.avatar ist das Emoji selbst). Ein Vergleich mit der id trifft dort
     also nie, und das angelegte Stueck waere hängengeblieben. */
  const item = KATALOG[art][id];
  const feld = ANGELEGT[art];
  const angelegt = art === "avatar" ? acc.avatar === item.emoji
    : art === "color" ? acc.nameColor === item.color
    : acc[feld] === id;
  if (feld && angelegt) delete acc[feld];
  return { ok: true, label: label(art, id) };
}

/**
 * Alles, was der Client braucht, um ein Stueck zu ZEIGEN.
 *
 * Der Laden hat den Katalog ohnehin schon komplett. Der Markt nicht: dort
 * steht nur, welches Exemplar gerade angeboten wird, und ohne diese Angaben
 * koennte er nur den Namen hinschreiben. Ein Markt, auf dem man ein Aussehen
 * kauft, ohne es zu sehen, waere sinnlos.
 */
/* Wie die Arten auf Deutsch heissen. Steht hier, weil der Katalog hier steht;
   im Client waere es eine zweite Liste, die beim naechsten neuen Typ vergessen
   wird. */
const ART_NAME = {
  avatar: "Profilbild", color: "Namensfarbe", style: "Namensstil", frame: "Rahmen",
  title: "Titel", effect: "Gewinn-Effekt", spruch: "Eintritts-Spruch",
  banner: "Profilbanner", schild: "Namensschild", aura: "Aura", karte: "Kartenrücken",
  zeichen: "Chat-Zeichen",
};

function vorschauDaten(art, id) {
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  if (!item) return null;
  return {
    art, id, artName: ART_NAME[art] || art,
    label: item.label || item.text || id,
    text: item.text || null,
    emoji: item.emoji || null,
    color: item.color || null,
    motion: !!item.motion,
  };
}

/** Anzeigename fuer Belohnungslisten. */
function label(type, id) {
  const item = KATALOG[type] ? KATALOG[type][id] : null;
  if (!item) return id;
  // Ein nacktes Emoji als Belohnungstext liest sich wie ein Tippfehler
  // ("Stufe 5: 🃏"). Wo es einen Namen gibt, steht er dabei.
  if (type === "avatar") return item.label ? `${item.emoji} ${item.label}` : item.emoji;
  if (type === "color") return item.label || item.color || id;
  if (type === "spruch") return item.text ? item.text.replace("{name}", "…") : "ohne";
  return item.label || item.text || id;
}

/* Das Prunkstueck
 *
 * Der wunde Punkt bei Kosmetik in diesem Haus ist nicht, wie schoen sie ist,
 * sondern dass sie niemand SIEHT. Ein Kartenruecken wirkt nur auf dem eigenen
 * Bildschirm, ein Banner erst, wenn dich jemand antippt, und eine Aura nur,
 * solange man gleichzeitig online ist. In einer Runde, in der das fast nie
 * passiert, ist das teuerste Stueck im Haus praktisch unsichtbar.
 *
 * Das Prunkstueck loest das ueber die FLAECHE statt ueber die Art. Man
 * bestimmt EIN gepraegtes Stueck aus der eigenen Sammlung, und das haengt
 * als kleine Marke mit seiner Nummer am Namen — ueberall, wo der Name steht:
 * Chat, Online-Liste, Bestenliste, Pokertisch, Besitzerliste der Stadt.
 * Dafuer muss niemand da sein und niemand etwas antippen.
 *
 * Es geht nur mit gepraegten Stuecken, also mit solchen, die eine Nummer
 * haben. Genau darum geht es: nicht "ich habe etwas Buntes", sondern "ich
 * habe die Nummer 3".
 */
function prunkVon(acc, key) {
  if (!acc || !acc.prunk) return null;
  const [art, id] = String(acc.prunk).split(":");
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  if (!item) return null;
  const owned = (acc.cosOwned || {})[TOPF[art]] || [];
  if (!owned.includes(id)) return null;   // verkauft oder weggenommen
  let st = null;
  try { st = praegung.stueckVon(key || normKey(acc), art, id); } catch {}
  return {
    art, id,
    label: item.label || item.text || id,
    nr: st ? st.nr : null,
    serie: st ? st.serie : null,
    /* Die Stufe als KENNUNG, nicht als Farbe. Der Client hat dafuer eine
       feste Liste von Klassen; eine Farbe aus einer alten Nachricht duerfte
       sonst irgendwann etwas ins Dokument schreiben, das niemand geprueft
       hat. Dieselbe Regel wie bei Stilen und Rahmen. */
    stufe: stufeKennung(item),
  };
}

/* Die Seltenheitsstufe eines Stuecks, als Wort. Dieselben Grenzen wie in
   game/kisten.js; sie hier noch einmal zu haben waere eine zweite Liste, die
   auseinanderlaeuft, deshalb kommt sie von dort. */
/* Dieselbe Frage, nur von aussen: welche Stufe hat das Stueck mit dieser
   Kennung? Der Markt und die Ruhmestafel brauchen das, und beide sollen
   dafuer nicht selbst in den Katalog greifen muessen. */
function stufeVonStueck(art, id) {
  const item = KATALOG[art] ? KATALOG[art][id] : null;
  return item ? stufeKennung(item) : "gewoehnlich";
}

/* Welche Herkuenfte wirklich knapp sind. Ein Einzelstueck aus der Kiste gibt
   es so oft, wie es jemand gezogen hat; eine Kollektions-Belohnung so oft,
   wie jemand die Sammlung vollbekommen hat; Fortuna sieben Mal; ein
   Auktionslos einmal. Season- und Comeback-Stuecke sind dagegen breit
   verteilt worden (Rueckkehrer gibt es 27 Mal) — die sind nicht kaeuflich,
   aber auch nicht selten, und sie als "Einzelstueck" zu zeigen waere
   geflunkert. */
const KNAPP = new Set(["kiste", "sammlung", "rad", "auktion"]);
const ATELIER_STUFEN = new Set(["selten", "episch", "legendaer"]);

function stufeKennung(item) {
  /* Atelierstücke haben keinen Chippreis, aber bewusst drei Wertigkeiten. */
  if (ATELIER_STUFEN.has(item.staubTier)) return item.staubTier;
  if (item.limitiert === "haus") return "haus";
  if (item.cost == null) {
    if (KNAPP.has(item.limitiert)) return "einzel";
    /* Nicht kaeuflich, aber verteilt: Season, Wiedereroeffnung und das
       Verdienbare (Krone, Strassenherr). Gewichtsklasse legendaer, denn
       nachkaufen kann man sie trotzdem nicht. */
    return "legendaer";
  }
  try { return require("./kisten").stufeVon(item.cost).id; } catch { return "gewoehnlich"; }
}

/* ------------------------------------------------------------------
   Die Garnitur

   Das Problem, das sie loest: man kann hundert Stuecke besitzen und
   immer nur zwoelf davon TRAGEN. Alles ausser diesen zwoelf liegt im
   Schrank, und damit ist jedes weitere Stueck nach dem ersten Dutzend
   fuer die Aussenwirkung wertlos. Genau das macht die billigen Stufen
   bedeutungslos: nicht ihre Zahl, sondern dass sie keinen Platz haben.

   Eine Garnitur dreht das um. Wer DREI Stuecke derselben Familie
   gleichzeitig traegt, bekommt eine Marke am Namen mit dem Namen der
   Familie und der Zahl. Damit lohnt es sich, von EINER Sache viel zu
   besitzen, statt von jeder eine — und genau dafuer geht man auf den
   Markt, nicht fuer das naechste zufaellige Stueck.

   Die Familie kommt aus der Kennung (`gala_lorbeer` -> `gala`), nicht aus
   einem eigenen Feld. Das kann nicht auseinanderlaufen: jedes neue Stueck
   mit dem Praefix gehoert automatisch dazu, und die Namensregel steht
   ohnehin ueberall im Katalog.
   ------------------------------------------------------------------ */
const FAMILIEN = {
  gala:  { label: "Gala",         farbe: "#e0a02e" },
  sml:   { label: "Kollektion",   farbe: "#4fc7c0" },
  auk:   { label: "Auktionshaus", farbe: "#c86bd6" },
  adm:   { label: "Haus",         farbe: "#e6b7ee" },
  s2:    { label: "Season 2",     farbe: "#ff9f43" },
  kiste: { label: "Einzelstücke", farbe: "#b6ff4d" },
  rad:   { label: "Fortuna",      farbe: "#f4d782" },
  staub: { label: "Prägeatelier", farbe: "#d8c0ff" },
};
/* Drei, nicht vier. Zwei Familien (Haus und Kollektion) haben genau drei
   Stuecke, und zwei davon sind Auren — bei vier waere die Garnitur dort
   unerreichbar, und eine Belohnung, die manche Familien gar nicht
   hergeben, ist keine. */
const GARNITUR_AB = 3;

const familieVon = (id) => {
  const i = String(id || "").indexOf("_");
  if (i < 1) return null;
  const f = id.slice(0, i);
  return FAMILIEN[f] ? f : null;
};

/**
 * Welche Garnitur `acc` gerade traegt.
 *
 * Gezaehlt wird, was ANGELEGT ist, nicht was im Schrank liegt. Der
 * Kartenruecken zaehlt mit, obwohl ihn nur der Besitzer sieht: er ist
 * trotzdem angelegt, und ein Stueck, das zum Satz gehoert, aber nicht
 * mitzaehlt, waere schwer zu erklaeren.
 */
function garniturVon(acc) {
  if (!acc) return null;
  /* Profilbild und Namensfarbe stehen am Konto als EMOJI und als Hexwert,
     nicht als Kennung — sie muessen zurueckgesucht werden, sonst zaehlt
     ausgerechnet das Bild nie mit. */
  const avaId = (AVATARS.find((a) => a.emoji === acc.avatar) || {}).id;
  const colId = (COLORS.find((c) => c.color && c.color === acc.nameColor) || {}).id;
  const angelegt = [
    acc.nameStyle, acc.frame, acc.title, acc.spruch, acc.banner,
    acc.schild, acc.aura, acc.karte, acc.zeichen, acc.winEffect, avaId, colId,
  ];
  const zahl = {};
  for (const id of angelegt) {
    const f = familieVon(id);
    if (f) zahl[f] = (zahl[f] || 0) + 1;
  }
  let beste = null;
  for (const [f, n] of Object.entries(zahl)) {
    if (n < GARNITUR_AB) continue;
    if (!beste || n > beste.teile) beste = { id: f, teile: n, ...FAMILIEN[f] };
  }
  return beste;
}

/**
 * Stand aller Familien fuer die Sammlung.
 *
 * Nur Familien, von denen man ueberhaupt etwas hat: eine Liste mit sieben
 * Nullen sagt einem Anfaenger nichts, ausser dass er nichts hat.
 */
function familienStand(acc) {
  const getragen = {};
  const g = garniturVon(acc);
  const avaId = (AVATARS.find((a) => a.emoji === acc.avatar) || {}).id;
  const colId = (COLORS.find((c) => c.color && c.color === acc.nameColor) || {}).id;
  for (const id of [acc.nameStyle, acc.frame, acc.title, acc.spruch, acc.banner,
    acc.schild, acc.aura, acc.karte, acc.zeichen, acc.winEffect, avaId, colId]) {
    const f = familieVon(id);
    if (f) getragen[f] = (getragen[f] || 0) + 1;
  }
  const out = [];
  for (const [f, info] of Object.entries(FAMILIEN)) {
    let gesamt = 0, hat = 0;
    for (const [art, topf] of Object.entries(TOPF)) {
      const liste = KATALOG[art];
      for (const id of Object.keys(liste)) {
        if (familieVon(id) !== f) continue;
        gesamt++;
        if (hatStueck(acc, art, id)) hat++;
      }
    }
    if (!gesamt || !hat) continue;
    out.push({ id: f, label: info.label, farbe: info.farbe, gesamt, hat, getragen: getragen[f] || 0 });
  }
  return out.sort((a, b) => b.getragen - a.getragen || b.hat - a.hat);
}

/** Aufloesung fuer die Anzeige: aus den ids am Account wird, was der Client braucht. */
function publicLook(acc) {
  const t = acc.title ? titById[acc.title] : null;
  return {
    // Haengt am Namen und reist deshalb ueberall mit, wo der Name hingeht.
    prunk: prunkVon(acc),
    /* Dasselbe gilt fuer die Garnitur: sie ist eine Marke am Namen und
       damit ueberall zu sehen, wo ein Name steht. */
    garnitur: garniturVon(acc),
    avatar: acc.avatar || "🙂",
    nameColor: acc.nameColor || null,
    nameStyle: acc.nameStyle || null,
    frame: acc.frame || null,
    title: t && t.text ? t.text : null,
    banner: acc.banner || null,
    schild: acc.schild || null,
    aura: acc.aura || null,
    // Der Kartenrücken wirkt nur auf dem eigenen Bildschirm, muss aber
    // mitkommen: sonst weiss der Client sein eigenes Blatt nicht.
    karte: acc.karte || null,
    // Steht vor jeder Chat-Nachricht. Die Flaeche, die jeder liest.
    zeichen: acc.zeichen || null,
    winEffect: acc.winEffect || null,
  };
}

/** Der Eintritts-Spruch, fertig mit Namen. Null, wenn keiner angelegt ist. */
function eintrittsSpruch(acc) {
  const s2 = acc && acc.spruch ? sprById[acc.spruch] : null;
  if (!s2 || !s2.text) return null;
  if (s2.eigen) {
    const eigener = saubererSpruch(acc.spruchText);
    return eigener ? `${acc.name} ${eigener}` : null;
  }
  return s2.text.replace("{name}", acc.name);
}

/** Eigener Spruchtext: eine Zeile, begrenzte Laenge, keine Steuerzeichen. */
function saubererSpruch(roh) {
  return String(roh || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPRUCH_MAX);
}

/* Fortuna: sieben Stueck, mehr nicht
 *
 * Bewusst ohne eigene Datei. Wie viele vergeben sind, steht schon in den
 * Konten: es ist die Anzahl derer, die den Stil besitzen. Ein zweiter Zaehler
 * koennte davon abweichen, und dann waere die Frage, welcher stimmt.
 */
const FORTUNA_MAX = 7;
const FORTUNA_STUECKE = [
  { type: "frame", id: "rad_fortuna" },
  { type: "style", id: "rad_fortuna" },
  { type: "title", id: "rad_fortuna" },
];

function fortunaVergeben(accounts) {
  let n = 0;
  try {
    for (const a of accounts.rawAll()) {
      const l = a.cosOwned && a.cosOwned.styles;
      if (Array.isArray(l) && l.includes("rad_fortuna")) n++;
    }
  } catch {}
  return n;
}

const hatFortuna = (acc) => !!(acc && acc.cosOwned && Array.isArray(acc.cosOwned.styles)
  && acc.cosOwned.styles.includes("rad_fortuna"));

/**
 * Alle drei Stuecke auf einmal. Gibt die Beschriftungen zurueck.
 *
 * Mit der Art davor: "Fortuna" allein sagt nicht, ob das der Rahmen, der Stil
 * oder der Titel ist, und alle drei heissen aehnlich.
 */
function gibFortuna(acc) {
  const erhalten = [];
  for (const st of FORTUNA_STUECKE) {
    if (grant(acc, st.type, st.id)) erhalten.push(`${ART_NAME[st.type] || st.type}: ${label(st.type, st.id)}`);
  }
  return erhalten;
}

module.exports = { setupCosmetics, grant, label, ZEICHEN, ART_NAME, stufeVonStueck, garniturVon, FAMILIEN, GARNITUR_AB, vorschauDaten, prunkVon, stufeKennung, hatStueck, sammlungAnsage, praegbar, handelbar, praegeText, praegungNachtragen,
  besitzGeben, besitzNehmen, adminKatalog, adminGib, adminNimm, publicLook, eintrittsSpruch, saubererSpruch, SPRUCH_MAX, AVATARS, COLORS, STYLES, FRAMES, TITLES, EFFEKTE, SPRUECHE, BANNER, SCHILDER, AUREN, KARTEN, FORTUNA_MAX, FORTUNA_STUECKE, fortunaVergeben, hatFortuna, gibFortuna };
