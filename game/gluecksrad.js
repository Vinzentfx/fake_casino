"use strict";

/**
 * Glücksrad, einmal am Tag gratis.
 *
 * Vorher war es ein reiner Chip-Spender: acht Felder, alle mit einer Zahl
 * drauf. Damit war es die dritte tägliche Gratis-Quelle neben Stunden-Bonus
 * und Kalender, brachte aber nur rund ein Zehntel davon, ein Pflichtklick
 * ohne eigenen Grund.
 *
 * Jetzt verschenkt es Sachen, die man für Chips nicht bekommt: Lose für die
 * Lotterie, Season-XP, einen Glückstag für den Kalender. Und auf einem Feld
 * steht Fortuna. Davon gibt es sieben im ganzen Casino, danach nie wieder;
 * das Feld zahlt dann Chips. Wer eins hat, trägt einen Ring aus zwölf
 * Goldsegmenten um sein Bild, einen Namen, in dem sich ein Rad dreht, und den
 * Titel "Glückspilz".
 *
 * Die Chip-Ausbeute ist dabei absichtlich gefallen (von rund 3.150 auf 1.600
 * je Dreh): das Rad soll interessanter werden, nicht ergiebiger.
 *
 * Chips laufen wie überall durch die Vermögensbremse (faucetFactor). Lose,
 * XP und Kosmetik nicht, die sind für ein grosses Konto nicht mehr wert als
 * für ein kleines.
 */

const crypto = require("crypto");
const regie = require("./regie");
const strafen = require("./strafen");
const chat = require("./chat");
const cosmetics = require("./cosmetics");

const ABSTAND_MS = 20 * 60 * 60 * 1000;

/* Wenn Fortuna vergeben ist (oder man es schon hat), zahlt das Feld das hier.
   Bewusst der alte Jackpot-Wert: das Feld bleibt das beste am Rad. */
const FORTUNA_ERSATZ = 50000;

/**
 * Die zwölf Felder, im Uhrzeigersinn ab oben.
 *
 * Absichtlich abwechselnd Chips und Sonderfeld, damit auf dem Rad keine zwei
 * gleichen Farben nebeneinander liegen und beim Drehen etwas zu sehen ist.
 * `stufe` steuert nur das Aussehen (siehe public/css/styles.css).
 */
const FELDER = [
  { art: "chips",      wert: 250,   gewicht: 14, stufe: "klein",   label: "250" },
  { art: "los",        wert: 1,     gewicht: 11, stufe: "sonder",  label: "Gratis-Los" },
  { art: "chips",      wert: 1000,  gewicht: 14, stufe: "klein",   label: "1.000" },
  { art: "xp",         wert: 200,   gewicht: 10, stufe: "sonder",  label: "200 XP" },
  { art: "chips",      wert: 2500,  gewicht: 12, stufe: "mittel",  label: "2.500" },
  { art: "glueckstag", wert: 1,     gewicht: 8,  stufe: "sonder",  label: "Glückstag" },
  { art: "chips",      wert: 500,   gewicht: 13, stufe: "klein",   label: "500" },
  { art: "los",        wert: 2,     gewicht: 7,  stufe: "sonder",  label: "2 Lose" },
  { art: "chips",      wert: 5000,  gewicht: 8,  stufe: "mittel",  label: "5.000" },
  { art: "xp",         wert: 400,   gewicht: 5,  stufe: "sonder",  label: "400 XP" },
  { art: "chips",      wert: 25000, gewicht: 3,  stufe: "gross",   label: "25.000" },
  { art: "fortuna",    wert: 0,     gewicht: 1,  stufe: "fortuna", label: "FORTUNA" },
];

const GEWICHT_SUMME = FELDER.reduce((s, f) => s + f.gewicht, 0);
const de = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

let _io = null;
let _accounts = null;

/** Wie viele Fortuna-Stücke noch im Rad sind. */
function fortunaRest() {
  if (!_accounts) return cosmetics.FORTUNA_MAX;
  return Math.max(0, cosmetics.FORTUNA_MAX - cosmetics.fortunaVergeben(_accounts));
}

/** Zahlt das Fortuna-Feld für diesen Spieler noch Kosmetik, oder schon Chips? */
const fortunaOffen = (acc) => fortunaRest() > 0 && !cosmetics.hatFortuna(acc);

/**
 * Die Felder, wie dieser Spieler sie sieht.
 *
 * Zwei Dinge sind persönlich: die Chip-Beträge tragen schon seine
 * Vermögensbremse (sonst stünde 25.000 drauf und es kämen 16.000 an), und auf
 * dem Fortuna-Feld steht eine Zahl, wenn es für ihn keine Kosmetik mehr gibt.
 */
function felderFuer(acc, faktor) {
  const offen = fortunaOffen(acc);
  return FELDER.map((f) => {
    if (f.art === "fortuna" && !offen) {
      return { label: de(Math.round(FORTUNA_ERSATZ * faktor)), stufe: "gross" };
    }
    if (f.art === "chips") return { label: de(Math.round(f.wert * faktor)), stufe: f.stufe };
    return { label: f.label, stufe: f.stufe };
  });
}

function zustand(key) {
  const acc = _accounts && _accounts.get(key);
  if (!acc) return null;
  const seit = Date.now() - (acc.lastWheelAt || 0);
  const faktor = _accounts.faucetFactor(acc.name);
  return {
    segments: felderFuer(acc, faktor),
    canSpin: seit >= ABSTAND_MS,
    msLeft: Math.max(0, ABSTAND_MS - seit),
    faucet: Math.round(faktor * 100),
    fortuna: { rest: fortunaRest(), max: cosmetics.FORTUNA_MAX, hat: cosmetics.hatFortuna(acc) },
  };
}

function ziehe() {
  let r = crypto.randomInt(GEWICHT_SUMME);
  for (let i = 0; i < FELDER.length; i++) {
    if (r < FELDER[i].gewicht) return i;
    r -= FELDER[i].gewicht;
  }
  return 0;
}

function drehe(key) {
  const acc = _accounts && _accounts.get(key);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  const ohne = strafen.aktiv(acc, "keinBonus");
  if (ohne) return { ok: false, error: `Für dich gerade keine Geschenke (${strafen.restText(ohne)})${ohne.grund ? `: ${ohne.grund}` : "."}` };
  const seit = Date.now() - (acc.lastWheelAt || 0);
  if (seit < ABSTAND_MS) return { ok: false, error: "Heute schon gedreht, morgen wieder.", msLeft: ABSTAND_MS - seit };

  /* Regie: ein von Hand gesetztes Feld gilt genau einmal. Der Tagesabstand
     gilt weiter, sonst waere der Zettel ein zweiter Dreh. */
  const gesetzt = regie.nimm(key, "rad");
  const idx = gesetzt != null && FELDER[gesetzt] ? gesetzt : ziehe();
  const feld = FELDER[idx];
  const faktor = _accounts.faucetFactor(acc.name);
  acc.lastWheelAt = Date.now();

  // Was am Ende auf der Karte steht, entsteht hier, an einer Stelle, damit
  // Ergebnis und Anzeige nicht auseinanderlaufen koennen.
  const out = { ok: true, index: idx, art: feld.art, chips: 0, titel: "", text: "" };

  const zahleChips = (betrag, titel, text) => {
    const chips = Math.round(betrag * faktor);
    acc.chips += chips;
    out.art = "chips";
    out.chips = chips;
    out.titel = titel || `+${de(chips)} Chips`;
    out.text = text || "";
  };

  switch (feld.art) {
    case "chips":
      zahleChips(feld.wert, `+${de(Math.round(feld.wert * faktor))} Chips`, "Direkt auf dein Guthaben.");
      break;

    case "los": {
      let r = { ok: false };
      try { r = require("./lotterie").schenkeLos(key, feld.wert); } catch {}
      if (r.ok) {
        const n = r.tipps.length;
        out.titel = n === 1 ? "Ein Gratis-Los" : `${n} Gratis-Lose`;
        out.text = `${r.tipps.map((t) => t.join(" · ")).join("   |   ")}. Gezogen wird um 20 Uhr.`;
        out.tipps = r.tipps;
      } else {
        // Wer schon voll ist, geht nicht leer aus.
        zahleChips(2000 * feld.wert, `+${de(Math.round(2000 * feld.wert * faktor))} Chips`,
          "Deine Lotterie-Lose sind schon voll, deshalb der Gegenwert in Chips.");
      }
      break;
    }

    case "xp": {
      let gab = 0;
      try { gab = require("./season").addXp(key, feld.wert, "geschenk") || 0; } catch {}
      if (gab > 0) {
        out.titel = `+${de(gab)} Season-XP`;
        out.text = "Zählt nicht gegen dein Tageslimit.";
        out.xp = gab;
      } else {
        zahleChips(feld.wert * 20, null, "Season läuft gerade nicht, deshalb Chips.");
      }
      break;
    }

    case "glueckstag":
      acc.glueckstag = true;
      out.titel = "Glückstag";
      out.text = "Deine nächste Kalender-Abholung zählt doppelt.";
      break;

    case "fortuna": {
      if (!fortunaOffen(acc)) {
        zahleChips(FORTUNA_ERSATZ, `+${de(Math.round(FORTUNA_ERSATZ * faktor))} Chips`,
          cosmetics.hatFortuna(acc) ? "Fortuna hast du schon, dafür das Beste, was das Rad sonst hergibt."
                                    : "Alle sieben Fortuna sind vergeben, dafür das Beste, was das Rad sonst hergibt.");
        break;
      }
      const stuecke = cosmetics.gibFortuna(acc);
      const rest = Math.max(0, cosmetics.FORTUNA_MAX - cosmetics.fortunaVergeben(_accounts));
      out.art = "fortuna";
      out.titel = "FORTUNA";
      out.text = rest > 0
        ? `Noch ${rest} von ${cosmetics.FORTUNA_MAX} sind im Rad.`
        : "Das war das letzte. Es wird nie wieder eins geben.";
      out.stuecke = stuecke;
      out.rest = rest;
      try {
        chat.announce(_io, `Fortuna! ${acc.name} dreht eines der sieben Stücke. ${rest > 0 ? `Noch ${rest} im Rad.` : "Das war das letzte."}`);
      } catch {}
      try {
        require("./chronik").notiere("event", `${acc.name} gewinnt Fortuna am Glücksrad. ${rest > 0 ? `Noch ${rest} von ${cosmetics.FORTUNA_MAX} im Rad.` : "Es war das letzte."}`, { user: acc.name });
      } catch {}
      break;
    }
  }

  _accounts.save();
  out.account = _accounts.publicAccount(acc);
  out.fortunaRest = fortunaRest();
  return out;
}

function setup(io, accounts) {
  _io = io;
  _accounts = accounts;

  io.on("connection", (socket) => {
    socket.on("wheel:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const z = zustand(socket.data.account);
      ack(z ? { ok: true, ...z } : { ok: false, error: "Account nicht gefunden." });
    });

    socket.on("wheel:spin", (ack) => {
      if (typeof ack !== "function") return;
      if (!socket.data.account) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = drehe(socket.data.account);
      ack(r);
      // Ein neues Fortuna aendert das Rad fuer alle (ein Stueck weniger).
      if (r.ok && r.art === "fortuna") io.emit("wheel:fortuna", { rest: r.rest });
    });
  });
}

module.exports = { setup, zustand, drehe, FELDER, FORTUNA_ERSATZ };
