"use strict";

/**
 * Strafen und Grenzen.
 *
 * Vorher gab es genau zwei Stufen: nichts, oder Konto gesperrt. Dazwischen lag
 * alles, was man unter Freunden tatsaechlich braucht: einer spammt den Chat,
 * einer setzt aus Uebermut 800.000 auf eine Zahl, einer soll drei Tage nicht an
 * die Slots, einer hat sich einen Bonus erschlichen. Fuer alles davon war die
 * einzige Antwort "Konto gesperrt, komm morgen wieder" oder gar nichts.
 *
 * Jede Strafe hier hat drei Dinge, die eine Dauersperre nicht hat: eine
 * Ablaufzeit, einen Grund und eine Spur im Verlauf. Das ist kein Beiwerk. Eine
 * Strafe ohne Ablauf muss jemand von Hand zuruecknehmen und bleibt sonst
 * ewig; eine ohne Grund erklaert dem Bestraften nicht, was er anders machen
 * soll; und ohne Verlauf weiss nach zwei Wochen niemand mehr, warum jemand
 * einen Deckel hat.
 *
 * Die Strafen haengen am Konto (`acc.strafen`) und nicht in einer eigenen
 * Datei. Damit wandern sie automatisch ins Backup, verschwinden mit dem Konto
 * und koennen nicht auf ein geloeschtes Konto verwaisen.
 *
 * Dieses Modul kennt bewusst kein accounts: es rechnet nur auf Konto-Objekten,
 * die es uebergeben bekommt. Sonst gaebe es einen Kreis beim require, denn
 * accounts fragt beim Login nach der Zeitsperre.
 */

const crypto = require("crypto");

/* Gespeichert wird ueber accounts. Abgelaufene Strafen raeumt dieses Modul
   beim Lesen weg, und dafuer muss es Bescheid geben koennen. */
let _speichern = () => {};
function setSpeichern(fn) { if (typeof fn === "function") _speichern = fn; }

/* Die Strafen */
const ARTEN = {
  sperre: {
    name: "Zeitsperre",
    kurz: "gesperrt",
    was: "Kommt bis zum Ablauf nicht mehr rein. Wer gerade online ist, fliegt raus.",
    hart: true,
  },
  stumm: {
    name: "Maulkorb",
    kurz: "stumm",
    was: "Darf spielen, aber nicht schreiben. Eigene Nachrichten werden abgelehnt, alte bleiben stehen.",
  },
  deckel: {
    name: "Einsatzdeckel",
    kurz: "Deckel",
    was: "Höchster Einsatz je Runde, in jedem Spiel. Gegen Übermut mit dem ganzen Vermögen.",
    wert: { label: "Höchster Einsatz", vorgabe: 5000, min: 1, max: 10_000_000 },
  },
  pech: {
    name: "Pechvogel",
    kurz: "Pechvogel",
    was: "Der Zufall arbeitet gegen ihn: Slots, Roulette, Blackjack, Mines und Towers. Sieht aus wie Pech, nicht wie eine Strafe.",
    wert: { label: "Stärke in Prozent", vorgabe: 100, min: 1, max: 100 },
  },
  spielsperre: {
    name: "Spielverbot",
    kurz: "Spielverbot",
    was: "Einzelne Spiele sind zu. Ansehen geht, mitspielen nicht.",
    spiele: true,
  },
  keinBonus: {
    name: "Keine Geschenke",
    kurz: "ohne Geschenke",
    was: "Kein Stunden-Bonus, keine Soforthilfe, kein Glücksrad, kein Kalender.",
  },
  keineAuktion: {
    name: "Auktionsverbot",
    kurz: "ohne Auktion",
    was: "Darf im Auktionshaus nicht mitbieten.",
  },
};

/* Spiele und ihre Ereignisse

   Das Spielverbot und der Einsatzdeckel greifen an einer Stelle (der Bremse
   unten) und nicht in zwanzig Spielmodulen. Dafuer braucht es die Zuordnung
   von Ereignis-Vorsilbe zu Spiel und das Feld, in dem der Einsatz steht.

   Neues Spiel? Eine Zeile hier, sonst laesst sich es nicht sperren und der
   Deckel gilt dort nicht. */
const SPIELE = {
  slots:     { name: "Slots",         vor: ["slots:"],              einsatz: { "slots:spin": "bet", "slots:buyBonus": "bet" } },
  crash:     { name: "Crash",         vor: ["crash:"],              einsatz: { "crash:bet": "amount" } },
  roulette:  { name: "Roulette",      vor: ["roulette:", "rlobby:"], einsatz: { "roulette:spin": "@bets" } },
  blackjack: { name: "Blackjack",     vor: ["bj:", "bjlobby:"],     einsatz: { "bj:deal": "bet" } },
  mines:     { name: "Mines",         vor: ["mines:"],              einsatz: { "mines:start": "bet" } },
  towers:    { name: "Towers",        vor: ["towers:"],             einsatz: { "towers:start": "bet" } },
  pinco:     { name: "Pinco",         vor: ["pinco:"],              einsatz: { "pinco:drop": "bet" } },
  hilo:      { name: "Higher/Lower",  vor: ["hilo:"],               einsatz: { "hilo:start": "bet" } },
  wuerfel:   { name: "Würfelpoker",   vor: ["wuerfel:"],            einsatz: { "wuerfel:start": "bet" } },
  horses:    { name: "Pferderennen",  vor: ["horses:"],             einsatz: { "horses:bet": "amount" } },
  sports:    { name: "Sportwetten",   vor: ["sports:"],             einsatz: { "sports:bet": "amount", "sports:combo": "amount" } },
  poker:     { name: "Poker",         vor: ["poker:"],              einsatz: { "poker:sit": "buyIn" } },
  pvp:       { name: "Slots-Duell",   vor: ["pvp:"],                einsatz: { "pvp:create": "buyIn", "pvp:createBot": "buyIn" } },
  duell:     { name: "Duelle",        vor: ["duell:"],              einsatz: { "duell:create": "einsatz" } },
  kniffel:   { name: "Kniffel",       vor: ["kniffel:"],            einsatz: { "kniffel:create": "bet" } },
  memory:    { name: "Memory",        vor: ["memory:"],             einsatz: { "memory:create": "buyIn" } },
  solitaire: { name: "Solitär",       vor: ["sol:", "solrace:"],    einsatz: { "sol:start": "bet", "solrace:create": "buyIn" } },
  chess:     { name: "Schach",        vor: ["chess:"],              einsatz: { "chess:create": "buyIn" } },
  sudoku:    { name: "Sudoku",        vor: ["sudoku:"] },
  /* Kisten und Kisten-Duell haben lange gefehlt, und das waren ausgerechnet
     die teuersten Knoepfe im Haus: eine Kiste kostet bis 250.000, ein Duell
     setzt bis zu einer Million. Ohne Eintrag liess sich beides weder sperren
     noch deckeln. Die Kiste hat keinen Einsatz IM Ereignis — der Preis haengt
     an der Kiste, nicht an der Nachricht — deshalb dort nur die Sperre. */
  kiste:     { name: "Kisten",        vor: ["kiste:"] },
  kdl:       { name: "Kisten-Duell",  vor: ["kdl:"],                einsatz: { "kdl:erstelle": "einsatz" } },
  lotterie:  { name: "Lotterie",      vor: ["lotterie:"] },
  stocks:    { name: "Börse",         vor: ["stocks:"],             einsatz: { "stocks:open": "margin" } },
  city:      { name: "Stadt",         vor: ["city:"] },
  market:    { name: "Markt",         vor: ["market:", "item:"] },
  clans:     { name: "Clans",         vor: ["clan:"] },
  /* Das Auktionshaus steht bewusst ohne Einsatzfeld hier: ein Gebot ist kein
     Einsatz, und ein Deckel von 1.000 haette jemanden stillschweigend vom
     ganzen Haus ausgeschlossen, weil das Startgebot darueber liegt. Wer
     jemanden von der Auktion fernhalten will, nimmt das Auktionsverbot. */
  auktion:   { name: "Auktionshaus",  vor: ["auktion:"] },
  bank:      { name: "Bank",          vor: ["bank:", "savings:"] },
  arbeit:    { name: "Arbeit",        vor: ["work:"] },
  wheel:     { name: "Glücksrad",     vor: ["wheel:"] },
};

/* Lesende Ereignisse bleiben immer offen. Ein gesperrtes Spiel soll sich
   oeffnen und "gesperrt" sagen koennen; wer auch den Zustand nicht mehr
   bekommt, sieht einen leeren Bildschirm ohne Erklaerung und meldet einen
   Fehler. */
const NUR_LESEN = /:(state|config|machines|init|history|legal|leaderboards|list|zufall|inhalt)$/;

const spielVon = new Map();   // je Vorsilbe: Spiel-id
for (const [id, s] of Object.entries(SPIELE)) for (const v of s.vor) spielVon.set(v, id);

/** Zu welchem Spiel gehoert dieses Socket-Ereignis? null, wenn zu keinem. */
function spielZuEvent(ev) {
  const i = String(ev || "").indexOf(":");
  if (i < 0) return null;
  return spielVon.get(String(ev).slice(0, i + 1)) || null;
}

/* Lesen und setzen */
function topf(acc) {
  if (!acc) return {};
  if (!acc.strafen || typeof acc.strafen !== "object") acc.strafen = {};
  return acc.strafen;
}

/**
 * Eine Strafe, wenn sie gilt, sonst null. Abgelaufene werden hier entfernt:
 * es gibt keinen Aufraeum-Timer, und es braucht auch keinen, weil jede Stelle,
 * die eine Strafe beachtet, durch diese Funktion geht.
 */
function aktiv(acc, art) {
  if (!acc || !ARTEN[art]) return null;
  const t = topf(acc);
  const s = t[art];

  /* Der alte Pechvogel war ein einfaches Ja/Nein am Konto. Wer ihn hat,
     behaelt ihn, bis er aufgehoben oder neu gesetzt wird: 100 Prozent,
     unbefristet, wie vorher. */
  if (!s && art === "pech" && acc.shadowban) return { bis: 0, wert: 100, grund: "", seit: 0, alt: true };
  if (!s) return null;

  if (s.bis && s.bis <= Date.now()) {
    delete t[art];
    _speichern();
    return null;
  }
  return s;
}

/** Alle geltenden Strafen eines Kontos, als { art: strafe }. */
function alle(acc) {
  const out = {};
  for (const art of Object.keys(ARTEN)) {
    const s = aktiv(acc, art);
    if (s) out[art] = s;
  }
  return out;
}

const MAX_MINUTEN = 60 * 24 * 365;   // ein Jahr, danach ist es keine Strafe mehr sondern Loeschen

/**
 * Strafe setzen oder verlaengern.
 *
 * @param {object} acc      Konto-Objekt.
 * @param {string} art      Schluessel aus ARTEN.
 * @param {object} o
 * @param {number} o.minuten Dauer, 0 heisst unbefristet.
 * @param {number} o.wert    Deckelhoehe bzw. Pech-Stärke.
 * @param {string[]} o.spiele Welche Spiele (nur beim Spielverbot).
 * @param {string} o.grund   Wird dem Bestraften gezeigt.
 */
function setze(acc, art, { minuten = 0, wert = 0, spiele = null, grund = "" } = {}) {
  const def = ARTEN[art];
  if (!acc) return { ok: false, error: "Konto nicht gefunden." };
  if (!def) return { ok: false, error: "Unbekannte Strafe." };

  const min = Math.max(0, Math.min(MAX_MINUTEN, Math.floor(Number(minuten) || 0)));
  const s = { seit: Date.now(), bis: min ? Date.now() + min * 60_000 : 0, grund: String(grund || "").slice(0, 120) };

  if (def.wert) {
    const n = Math.floor(Number(wert));
    if (!Number.isFinite(n) || n < def.wert.min || n > def.wert.max)
      return { ok: false, error: `${def.wert.label}: ${def.wert.min} bis ${def.wert.max}.` };
    s.wert = n;
  }
  if (def.spiele) {
    const liste = (Array.isArray(spiele) ? spiele : []).filter((id) => SPIELE[id]);
    if (!liste.length) return { ok: false, error: "Mindestens ein Spiel auswählen." };
    s.spiele = liste;
  }

  topf(acc)[art] = s;
  // Der alte Schalter darf nicht neben der neuen Strafe weiterleben.
  if (art === "pech") delete acc.shadowban;
  verlauf(acc, { art, ...s });
  _speichern();
  return { ok: true, strafe: s };
}

function hebeAuf(acc, art) {
  if (!acc) return { ok: false, error: "Konto nicht gefunden." };
  const t = topf(acc);
  const gab = !!t[art] || (art === "pech" && !!acc.shadowban);
  delete t[art];
  if (art === "pech") delete acc.shadowban;
  if (gab) verlauf(acc, { art, aufgehoben: true, seit: Date.now() });
  _speichern();
  return { ok: gab, error: gab ? undefined : "Diese Strafe war nicht gesetzt." };
}

/** Alles aufheben. Nach einer Aussprache will man nicht sieben Knoepfe druecken. */
function alleAufheben(acc) {
  if (!acc) return { ok: false, error: "Konto nicht gefunden." };
  const hatte = Object.keys(alle(acc));
  if (!hatte.length) return { ok: false, error: "Keine Strafen offen." };
  acc.strafen = {};
  delete acc.shadowban;
  verlauf(acc, { art: hatte.join(", "), aufgehoben: true, seit: Date.now() });
  _speichern();
  return { ok: true, aufgehoben: hatte };
}

const VERLAUF_MAX = 12;
function verlauf(acc, eintrag) {
  if (!Array.isArray(acc.strafenLog)) acc.strafenLog = [];
  acc.strafenLog.unshift(eintrag);
  if (acc.strafenLog.length > VERLAUF_MAX) acc.strafenLog.length = VERLAUF_MAX;
}

/* Abfragen fuer die Spielmodule */

/** Wie lange noch, als Text fuer den Spieler. */
function restText(s) {
  if (!s || !s.bis) return "unbefristet";
  const ms = s.bis - Date.now();
  if (ms <= 0) return "abgelaufen";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `noch ${min} min`;
  const std = Math.round(min / 60);
  if (std < 48) return `noch ${std} h`;
  return `noch ${Math.round(std / 24)} Tage`;
}

/** Satz fuer den Bestraften: was gilt, warum, wie lange. */
function satz(art, s) {
  const def = ARTEN[art] || { name: art };
  let t = def.name;
  if (art === "deckel") t += ` ${Number(s.wert || 0).toLocaleString("de-DE")} Chips`;
  return `${t} (${restText(s)})${s.grund ? `: ${s.grund}` : ""}`;
}

/** Trifft den Pechvogel diese Runde? Bei 100 Prozent immer, sonst gewuerfelt. */
function pechTrifft(acc) {
  const s = aktiv(acc, "pech");
  if (!s) return false;
  const stufe = Math.max(1, Math.min(100, Number(s.wert) || 100));
  return stufe >= 100 || crypto.randomInt(100) < stufe;
}

/** Hoechster erlaubter Einsatz, oder 0 wenn es keinen Deckel gibt. */
function deckel(acc) {
  const s = aktiv(acc, "deckel");
  return s ? Math.max(1, Math.floor(s.wert || 1)) : 0;
}

/** Ist dieses Spiel fuer dieses Konto gesperrt? Gibt die Strafe zurueck. */
function spielGesperrt(acc, spielId) {
  const s = aktiv(acc, "spielsperre");
  if (!s || !Array.isArray(s.spiele) || !s.spiele.includes(spielId)) return null;
  return s;
}

/* Die Bremse

   Spielverbot und Einsatzdeckel muessten sonst in jedem einzelnen Spielmodul
   stehen, zwanzig Mal dieselben drei Zeilen, und beim einundzwanzigsten Spiel
   fehlen sie. Socket.IO laesst aber jedes eingehende Ereignis durch eine
   Zwischenschicht laufen, bevor der Handler dran ist. Genau eine Stelle also,
   und neue Spiele sind automatisch mit drin, sobald sie in SPIELE stehen.

   Geantwortet wird ueber den ack des Aufrufers, nicht mit einem Fehler auf dem
   Socket: die Spiele zeigen ihre ack-Fehler schon als Hinweis an, ein
   Socket-Fehler waere dagegen stumm. */
function bremse(io, accounts) {
  io.on("connection", (socket) => {
    socket.use((packet, next) => {
      /* Diese Zwischenschicht sieht jedes eingehende Ereignis. Ein Fehler
         darin traefe also nicht ein Spiel, sondern alle auf einmal: lieber
         durchlassen als alles anhalten. */
      try {
        return pruefe(packet, next);
      } catch (e) {
        console.error("[strafen] Bremse uebersprungen:", e && e.message);
        return next();
      }
    });

    function pruefe(packet, next) {
      const ev = String(packet[0] || "");
      if (!socket.data || !socket.data.account) return next();
      if (ev.startsWith("admin:") || NUR_LESEN.test(ev)) return next();

      const spiel = spielZuEvent(ev);
      if (!spiel) return next();

      const acc = accounts.get(socket.data.account);
      if (!acc) return next();

      const ack = typeof packet[packet.length - 1] === "function" ? packet[packet.length - 1] : null;
      const stop = (error) => (ack ? ack({ ok: false, error }) : undefined);

      const sperre = spielGesperrt(acc, spiel);
      if (sperre) {
        return stop(`${SPIELE[spiel].name} ist für dich gesperrt (${restText(sperre)})${sperre.grund ? `: ${sperre.grund}` : "."}`);
      }

      const max = deckel(acc);
      if (max) {
        const feld = (SPIELE[spiel].einsatz || {})[ev];
        if (feld) {
          const daten = packet[1] && typeof packet[1] === "object" ? packet[1] : {};
          /* Roulette setzt mehrere Wetten auf einmal: gedeckelt ist der
             Gesamteinsatz einer Runde, nicht die einzelne Wette. Sonst waere
             der Deckel mit fuenfzig kleinen Wetten umgangen. */
          const betrag = feld === "@bets"
            ? (Array.isArray(daten.bets) ? daten.bets.reduce((s, b) => s + Math.floor(Number(b && b.amount) || 0), 0) : 0)
            : Math.floor(Number(daten[feld]) || 0);
          if (betrag > max) {
            return stop(`Dein Einsatz ist auf ${max.toLocaleString("de-DE")} Chips gedeckelt.`);
          }
        }
      }
      next();
    }
  });
}

/** Kurzform fuer Listen im Admin: welche Marken hat dieses Konto? */
function marken(acc) {
  return Object.entries(alle(acc)).map(([art, s]) => ({
    art, kurz: ARTEN[art].kurz, bis: s.bis || 0, wert: s.wert || 0, grund: s.grund || "",
    spiele: s.spiele || null,
  }));
}

module.exports = {
  ARTEN, SPIELE,
  setSpeichern, aktiv, alle, setze, hebeAuf, alleAufheben,
  restText, satz, pechTrifft, deckel, spielGesperrt, spielZuEvent, marken, bremse,
};
