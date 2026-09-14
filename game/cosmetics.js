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

const AVATARS = [
  { id: "smile",  emoji: "🙂", cost: 0 },
  { id: "cool",   emoji: "😎", cost: 5000 },
  { id: "cowboy", emoji: "🤠", cost: 10000 },
  { id: "clown",  emoji: "🤡", cost: 15000 },
  { id: "tophat", emoji: "🎩", cost: 20000 },
  { id: "shark",  emoji: "🦈", cost: 25000 },
  { id: "alien",  emoji: "👽", cost: 30000 },
  { id: "robot",  emoji: "🤖", cost: 40000 },
  { id: "gem",    emoji: "💎", cost: 75000 },
  { id: "crown",  emoji: "👑", cost: 100000 },
  { id: "dragon", emoji: "🐉", cost: 150000 },
  { id: "money",  emoji: "🤑", cost: 250000 },
  // Nur ueber den Season-Pass. cost: null heisst "nicht kaeuflich". Genau
  // das macht sie zum Statussymbol: man sieht, dass jemand die Season
  // durchgespielt hat, und kann es sich nicht einfach kaufen.
  { id: "s2_joker",  emoji: "🃏", label: "Joker",  cost: null, season: "porta-herbst-2" },
  { id: "s2_wolf",   emoji: "🐺", label: "Wolf",   cost: null, season: "porta-herbst-2" },
  { id: "s2_phoenix", emoji: "🔥", label: "Phönix", cost: null, season: "porta-herbst-2" },
];
const COLORS = [
  { id: "white",  color: null,      cost: 0 },
  { id: "gold",   color: "#f4d782", cost: 20000 },
  { id: "red",    color: "#e0705e", cost: 15000 },
  { id: "blue",   color: "#5ea8e0", cost: 15000 },
  { id: "green",  color: "#66c07a", cost: 15000 },
  { id: "purple", color: "#c86bd6", cost: 25000 },
  { id: "cyan",   color: "#4fc7c0", cost: 20000 },
  { id: "pink",   color: "#f07ab0", cost: 20000 },
  { id: "s2_amber", color: "#ff9f43", cost: null, season: "porta-herbst-2" },
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

// Ein Topf je Art. Alte Accounts haben nur avatars/colors, der Rest kommt
// beim ersten Zugriff dazu.
const TOPF = { avatar: "avatars", color: "colors", style: "styles", frame: "frames", title: "titles",
  effect: "effects", spruch: "sprueche", banner: "banner", schild: "schilder", aura: "auren", karte: "karten" };
const KATALOG = { avatar: avaById, color: colById, style: styById, frame: frmById, title: titById,
  effect: effById, spruch: sprById, banner: banById, schild: schById, aura: aurById, karte: karById };

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
      return {
        chips: acc.chips,
        fristen: { season: seasonEnde, comeback: comebackEnde },
        fortuna: { rest: radRest, max: FORTUNA_MAX },
        avatars: AVATARS.map((a) => ({ ...a, owned: hat("avatar", a.id), equipped: a.emoji === eqAva })),
        colors: COLORS.map((c) => ({ ...c, owned: hat("color", c.id), equipped: (c.color || null) === eqCol })),
        styles: STYLES.map((x) => ({ ...x, owned: hat("style", x.id), equipped: (acc.nameStyle || "standard") === x.id })),
        frames: FRAMES.map((x) => ({ ...x, owned: hat("frame", x.id), equipped: (acc.frame || "keiner") === x.id })),
        titles: TITLES.map((x) => ({ ...x, owned: hat("title", x.id), equipped: (acc.title || "keiner") === x.id })),
        effects: EFFEKTE.map((x) => ({ ...x, owned: hat("effect", x.id), equipped: (acc.winEffect || "konfetti") === x.id })),
        sprueche: SPRUECHE.map((x) => ({ ...x, owned: hat("spruch", x.id), equipped: (acc.spruch || "keiner") === x.id })),
        banner: BANNER.map((x) => ({ ...x, owned: hat("banner", x.id), equipped: (acc.banner || "keiner") === x.id })),
        schilder: SCHILDER.map((x) => ({ ...x, owned: hat("schild", x.id), equipped: (acc.schild || "keins") === x.id })),
        auren: AUREN.map((x) => ({ ...x, owned: hat("aura", x.id), equipped: (acc.aura || "keine") === x.id })),
        karten: KARTEN.map((x) => ({ ...x, owned: hat("karte", x.id), equipped: (acc.karte || "haus") === x.id })),
        spruchText: acc.spruchText || "",
        spruchMax: SPRUCH_MAX,
      };
    }

    socket.on("cos:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, ...state(acc) });
    });

    socket.on("cos:buy", ({ type, id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = acct(); if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const item = KATALOG[type] ? KATALOG[type][id] : null;
      if (!item) return ack({ ok: false, error: "Unbekannt." });
      const list = ensureOwned(acc)[TOPF[type]];
      if (item.cost === null) return ack({ ok: false, error: item.via ? `Gibt es nicht zu kaufen: ${item.via}.` : "Gibt es nur über den Season-Pass." });
      if (item.cost === 0 || list.includes(id)) return ack({ ok: false, error: "Schon im Besitz." });
      if (acc.chips < item.cost) return ack({ ok: false, error: "Nicht genug Chips." });
      accounts.adjustChips(socket.data.account, -item.cost); // pure sink
      list.push(id);
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
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
      accounts.save();
      ack({ ok: true, ...state(acc), account: accounts.publicAccount(acc) });
    });
  });
}

/**
 * Ein Stueck verschenken (Season-Belohnung). Gibt true zurueck, wenn es neu
 * dazukam, false wenn es schon im Besitz war.
 */
function grant(acc, type, id) {
  const item = KATALOG[type] ? KATALOG[type][id] : null;
  if (!acc || !item) return false;
  const list = ensureOwned(acc)[TOPF[type]];
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}

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
  aura: "aura", karte: "karte" };

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

/** Anzeigename fuer Belohnungslisten. */
function label(type, id) {
  const item = KATALOG[type] ? KATALOG[type][id] : null;
  if (!item) return id;
  // Ein nacktes Emoji als Belohnungstext liest sich wie ein Tippfehler
  // ("Stufe 5: 🃏"). Wo es einen Namen gibt, steht er dabei.
  if (type === "avatar") return item.label ? `${item.emoji} ${item.label}` : item.emoji;
  if (type === "color") return item.color;
  if (type === "spruch") return item.text ? item.text.replace("{name}", "…") : "ohne";
  return item.label || item.text || id;
}

/** Aufloesung fuer die Anzeige: aus den ids am Account wird, was der Client braucht. */
function publicLook(acc) {
  const t = acc.title ? titById[acc.title] : null;
  return {
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
const ART_NAME = { frame: "Rahmen", style: "Namensstil", title: "Titel" };
function gibFortuna(acc) {
  const erhalten = [];
  for (const st of FORTUNA_STUECKE) {
    if (grant(acc, st.type, st.id)) erhalten.push(`${ART_NAME[st.type] || st.type}: ${label(st.type, st.id)}`);
  }
  return erhalten;
}

module.exports = { setupCosmetics, grant, label, adminKatalog, adminGib, adminNimm, publicLook, eintrittsSpruch, saubererSpruch, SPRUCH_MAX, AVATARS, COLORS, STYLES, FRAMES, TITLES, EFFEKTE, SPRUECHE, BANNER, SCHILDER, AUREN, KARTEN, FORTUNA_MAX, FORTUNA_STUECKE, fortunaVergeben, hatFortuna, gibFortuna };
