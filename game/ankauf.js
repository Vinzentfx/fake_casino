"use strict";

/**
 * Der Ankauf: das Haus nimmt Stücke zurück, die man nicht mehr will.
 *
 * Der Markt ist der Weg, ein Stück zu VERKAUFEN; dort bestimmt man den
 * Preis und wartet auf einen Käufer. Hier geht es ums LOSWERDEN: sofort,
 * zu einem festen und bewusst niedrigen Preis. Das Exemplar verschwindet
 * dabei aus dem Register, das Stück ist aus dem Spiel.
 *
 * Der Preis soll sich lohnen und darf trotzdem nie eine Schleife ergeben:
 *   - 25 % des Katalogwerts. Die Kleiderstange verkauft zu 60 %, das
 *     Schaufenster zu 130 %, Zoo und Autohaus zum vollen Wert. Bei den
 *     Kisten kippt es erst ab 45 % (Holzkiste: 30.000 Preis, im Schnitt
 *     rund 67.000 Katalogwert); bei 25 % kommen von einer Holzkiste im
 *     Schnitt rund 16.700 zurück, von einer Kleiderkiste rund 17.000.
 *     Ein Test rechnet das für jede bezahlte Kiste nach.
 *   - Kioskware zur Hälfte dessen, was sie am Kiosk kostet: ihr Katalogwert
 *     liegt weit über dem Kioskpreis und würde sonst Chips drucken.
 *   - Exemplare aus der Tageskiste (gratis gezogen, `gratis` im Register)
 *     nur zu 5 %. Sonst brächte die Tageskiste über den Ankauf im Schnitt
 *     rund 8.000 Chips am Tag, sechsmal so viel wie der Stundenbonus eines
 *     Kontos ohne Häuser.
 *   - Höchstens zehn Stücke am Tag (deutsche Zeit).
 * Nicht angekauft wird, was man nicht kaufen kann (`cost: null`), was
 * limitiert ist (Haus, Auktion, Sammlung, Einzelstück, Atelier) und Gratis-
 * Grundteile. Was auf dem Markt oder im Auktionshaus liegt, steht nicht im
 * Besitz und taucht hier gar nicht erst auf.
 */

const cosmetics = require("./cosmetics");
const praegung = require("./praegung");
const buchungen = require("./buchungen");
const kleidung = require("./kleidung");
const hauszeit = require("./hauszeit");

const ANTEIL = 0.25;
const KIOSK_ANTEIL = 0.5;
const GRATIS_ANTEIL = 0.05;
const JE_TAG = 10;

/** Was das Haus für dieses Stück zahlt; `exemplar` aus dem Register, falls geprägt. */
function preisVon(art, id, exemplar = null) {
  const x = cosmetics.KATALOG[art] && cosmetics.KATALOG[art][id];
  if (!x || typeof x.cost !== "number" || x.cost <= 0) return null;
  if (x.limitiert || x.nur === "staub") return null;
  const basis = x.nur === kleidung.KIOSK ? (x.preis || 0) * KIOSK_ANTEIL
    : x.cost * (exemplar && exemplar.gratis ? GRATIS_ANTEIL : ANTEIL);
  return Math.max(50, Math.round(basis / 50) * 50);
}

function heute(jetzt = Date.now()) {
  return new Date(hauszeit.wandzeit(jetzt)).toISOString().slice(0, 10);
}
function verbraucht(acc) {
  const a = acc.ankauf;
  return a && a.tag === heute() ? a.n || 0 : 0;
}

/** Was `acc` ans Haus geben könnte, mit Preis. */
function liste(acc, key) {
  const out = [];
  const meine = praegung.alleVon(key) || {};
  for (const [art, topf] of Object.entries(cosmetics.TOPF)) {
    for (const id of (acc.cosOwned && acc.cosOwned[topf]) || []) {
      const st = meine[`${art}:${id}`];
      const preis = preisVon(art, id, st);
      if (preis == null) continue;
      const x = cosmetics.KATALOG[art][id];
      out.push({ art, id, label: cosmetics.label(art, id), artName: (cosmetics.ART_NAME || {})[art] || art,
        stufe: cosmetics.stufeKennung(x), preis, nr: st ? st.nr : null, gratis: !!(st && st.gratis) });
    }
  }
  return out.sort((a, b) => a.artName.localeCompare(b.artName) || b.preis - a.preis);
}

function verkaufen(accounts, acc, key, { art, id } = {}) {
  art = String(art || ""); id = String(id || "");
  const preis = preisVon(art, id, praegung.stueckVon(key, art, id));
  if (preis == null) return { ok: false, error: "Das nimmt das Haus nicht an." };
  const n = verbraucht(acc);
  if (n >= JE_TAG) return { ok: false, error: `Heute hat das Haus schon ${JE_TAG} Stücke von dir genommen. Morgen wieder.` };
  const r = buchungen.verkaufe({ accounts, cosmetics, praegung, key, acc, art, id, preis });
  if (!r.ok) return r;
  // Die Tageszahl hängt am Konto; gespeichert wird sie mit der nächsten Buchung
  // oder gleich hier. Ein verlorener Zähler kostet höchstens einen Ankauf mehr.
  acc.ankauf = { tag: heute(), n: n + 1 };
  try { accounts.save(); } catch {}
  return { ok: true, preis, label: cosmetics.label(art, id), rest: JE_TAG - n - 1 };
}

function setupAnkauf(io, accounts) {
  io.on("connection", (socket) => {
    const wer = () => {
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      return acc ? { key, acc } : null;
    };
    socket.on("ankauf:liste", (ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, stuecke: liste(w.acc, w.key), rest: JE_TAG - verbraucht(w.acc), jeTag: JE_TAG });
    });
    socket.on("ankauf:verkaufen", (daten, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = verkaufen(accounts, w.acc, w.key, daten && typeof daten === "object" ? daten : {});
      if (!r.ok) return ack(r);
      const pub = accounts.publicAccount(w.acc);
      for (const s of io.of("/").sockets.values()) {
        if (s.data && s.data.account === w.key && s !== socket) s.emit("account:update", { account: pub });
      }
      ack({ ...r, account: pub, stuecke: liste(w.acc, w.key), jeTag: JE_TAG });
    });
  });
}

module.exports = { setupAnkauf, preisVon, liste, verkaufen, JE_TAG, ANTEIL, KIOSK_ANTEIL, GRATIS_ANTEIL };
