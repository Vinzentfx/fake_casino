"use strict";

/**
 * Cosmetics shop — a pure chip SINK for status (helps against inflation).
 *
 * Buy avatars (the emoji next to your name) and name colours with chips; own
 * them forever, equip one of each. Nothing gameplay-affecting — just flex.
 *
 * State on the account: acc.avatar (emoji), acc.nameColor (hex|null),
 * acc.cosOwned = { avatars:[ids], colors:[ids] }. Equipped values are stored
 * resolved so they flow to the leaderboard/chat without catalog lookups.
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
  // Nur ueber den Season-Pass. cost: null heisst "nicht kaeuflich" — genau
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

/* ── Namens-Stile ─────────────────────────────────────────────────────────
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
  // Nicht kaeuflich: kommt, wenn man in der Stadt Boss eines Ortsteils wird.
  { id: "krone",    label: "Krone",         cost: null, via: "Boss eines Ortsteils werden", preview: ["#fff1b8", "#d4a017"], motion: true },
  // Season 2. Die alte Belohnung auf Stufe 10 war eine flache orange Farbe —
  // dasselbe, was man sich fuer 20.000 Chips kaufen kann. Etwas, wofuer man
  // acht Wochen spielt, muss anders aussehen als alles Kaufbare.
  { id: "s2_bernstein", label: "Bernstein", cost: null, via: "Season 2, Stufe 10", season: "porta-herbst-2", preview: ["#ffb347", "#7a3d00"], motion: true },
  { id: "s2_phoenix",   label: "Glut",      cost: null, via: "Season 2, Stufe 20", season: "porta-herbst-2", preview: ["#fff3b0", "#ff2d00"], motion: true },
];

/* ── Rahmen ums Bild ──────────────────────────────────────────────────────
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
];

/* ── Titel ────────────────────────────────────────────────────────────────
 * Eine kurze Zeile unter dem Namen. Das ist die einzige Kosmetik, mit der man
 * etwas ueber sich SAGEN kann, statt nur bunt zu sein.
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
];

const avaById = Object.fromEntries(AVATARS.map((a) => [a.id, a]));
const colById = Object.fromEntries(COLORS.map((c) => [c.id, c]));
const styById = Object.fromEntries(STYLES.map((x) => [x.id, x]));
const frmById = Object.fromEntries(FRAMES.map((x) => [x.id, x]));
const titById = Object.fromEntries(TITLES.map((x) => [x.id, x]));

// Ein Topf je Art. Alte Accounts haben nur avatars/colors, der Rest kommt
// beim ersten Zugriff dazu.
const TOPF = { avatar: "avatars", color: "colors", style: "styles", frame: "frames", title: "titles" };
const KATALOG = { avatar: avaById, color: colById, style: styById, frame: frmById, title: titById };

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
      // Achtung: cost === 0 ist "gratis fuer alle", cost === null ist
      // "nicht kaeuflich, nur ueber Season oder Stadt". Die beiden duerfen
      // nicht in denselben Topf, sonst gehoerte alles jedem.
      const hat = (art, id) => KATALOG[art][id].cost === 0 || owned[TOPF[art]].includes(id);
      const eqAva = acc.avatar || "🙂", eqCol = acc.nameColor || null;
      return {
        chips: acc.chips,
        avatars: AVATARS.map((a) => ({ ...a, owned: hat("avatar", a.id), equipped: a.emoji === eqAva })),
        colors: COLORS.map((c) => ({ ...c, owned: hat("color", c.id), equipped: (c.color || null) === eqCol })),
        styles: STYLES.map((x) => ({ ...x, owned: hat("style", x.id), equipped: (acc.nameStyle || "standard") === x.id })),
        frames: FRAMES.map((x) => ({ ...x, owned: hat("frame", x.id), equipped: (acc.frame || "keiner") === x.id })),
        titles: TITLES.map((x) => ({ ...x, owned: hat("title", x.id), equipped: (acc.title || "keiner") === x.id })),
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

/** Anzeigename fuer Belohnungslisten. */
function label(type, id) {
  const item = KATALOG[type] ? KATALOG[type][id] : null;
  if (!item) return id;
  // Ein nacktes Emoji als Belohnungstext liest sich wie ein Tippfehler
  // ("Stufe 5: 🃏"). Wo es einen Namen gibt, steht er dabei.
  if (type === "avatar") return item.label ? `${item.emoji} ${item.label}` : item.emoji;
  if (type === "color") return item.color;
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
  };
}

module.exports = { setupCosmetics, grant, label, publicLook, AVATARS, COLORS, STYLES, FRAMES, TITLES };
