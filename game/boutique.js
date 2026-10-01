"use strict";

/**
 * Das Schaufenster der Woche: vier Kleidungsstücke zum festen Preis.
 *
 * Kleidung kommt sonst nur aus der Kleiderkiste, und bei Mode will man
 * meistens etwas BESTIMMTES. Ein bestimmtes gewöhnliches Teil braucht dort
 * im Schnitt viele Dutzend Kisten, ein ganzes Set noch viel mehr. Das
 * Schaufenster ist der planbare Weg daneben: jede Woche zwei seltene und
 * zwei epische Stücke, für alle dieselben.
 *
 * Gewöhnliches hängt dauerhaft an der KLEIDERSTANGE, zu 60 % des Werts.
 * Im Backup vom 1.10. lagen die aktiven Konten im Median bei gut 12.000
 * Chips; ein bestimmtes gewöhnliches Teil kostete über Kisten im Mittel
 * zwei Millionen. Die Stange (7.000 bis 18.000) ist für die Hälfte der
 * Runde sofort bezahlbar und für alle ein Sparziel von wenigen Tagen. Wer
 * sie leerkauft, hat Grundlooks, keine Prestigestücke: die bleiben bei
 * Kiste, Fenster und Markt.
 *
 * Warum das den Laden nicht zurückbringt, den es nicht mehr gibt:
 *   - Es sind vier Stücke, und nächste Woche andere. Wer etwas sieht, das
 *     er will, muss diese Woche zugreifen.
 *   - Der Preis liegt beim 1,3-Fachen des Katalogwerts. Für ein bestimmtes
 *     Stück ist das planbar und deutlich billiger als die Kiste (im Mittel
 *     59 bis 1.200 Ziehungen je nach Stufe). Dass die Kiste „mehr wert“
 *     sei, lässt sich daraus nicht ableiten: ihr nomineller Katalogwert
 *     (rund 79.000 je 35.000) ist keine Auszahlung. Doppelte geben nur
 *     Prägestaub, Marktpreise sind nicht garantiert. Ob Kiste oder Fenster
 *     sich lohnt, zeigen erst echte Käufe, Verkäufe und Doppelte.
 *   - Legendär und mythisch stehen nie im Fenster. Die bleiben Kiste und
 *     Markt, sonst verlöre der Markt seine teuersten Stücke.
 *
 * Gekauftes wird über cosmetics.grant vergeben und damit geprägt wie aus
 * der Kiste: ein Exemplar mit Nummer, handelbar. Für die vier Stücke der
 * Woche setzt das Fenster damit eine Obergrenze auf dem Markt, und der
 * Aufpreis verbrennt Chips, statt welche zu drucken.
 */

const cosmetics = require("./cosmetics");

const AUFPREIS = 1.3;
const PLAETZE = [["selten", 2], ["episch", 2]];
const STANGE_ANTEIL = 0.6;

/* Die Woche beginnt am Montag um 0 Uhr deutscher Zeit, egal wo der Server
   steht, und endet auch über eine Zeitumstellung hinweg zur richtigen
   Stunde (game/hauszeit.js). */
const hauszeit = require("./hauszeit");
const wocheVon = (jetzt = Date.now()) => hauszeit.abschnittVon(jetzt, 7);
const wocheEndet = (jetzt = Date.now()) => hauszeit.abschnittEndet(jetzt, 7);

// Ein fester Zufall je Woche: alle sehen dasselbe Fenster, auch nach einem Neustart.
function zufall(saat) {
  let s = saat >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stufeVon(cost) {
  // Dieselben Grenzen wie die Kisten; dort steht die einzige Liste.
  return require("./kisten").stufeVon(cost).id;
}

/** Was in dieser Woche im Fenster liegt. */
function angebot(jetzt = Date.now()) {
  const woche = wocheVon(jetzt);
  const zieh = zufall(woche * 2654435761);
  const topf = {};
  for (const [art, liste] of Object.entries(cosmetics.KATALOG)) {
    for (const x of Object.values(liste)) {
      if (x.nur !== "kleider" || !x.cost) continue;
      const s = stufeVon(x.cost);
      (topf[s] = topf[s] || []).push({ art, id: x.id, label: x.label, cost: x.cost, stufe: s });
    }
  }
  const out = [];
  for (const [stufe, anzahl] of PLAETZE) {
    const liste = (topf[stufe] || []).slice().sort((a, b) => (a.art + a.id).localeCompare(b.art + b.id));
    for (let i = 0; i < anzahl && liste.length; i++) {
      const [x] = liste.splice(Math.floor(zieh() * liste.length), 1);
      out.push({ ...x, preis: Math.round((x.cost * AUFPREIS) / 1000) * 1000 });
    }
  }
  return { woche, bis: wocheEndet(jetzt), stuecke: out };
}

/** Die Kleiderstange: alle gewöhnlichen Kleidungsstücke, immer. */
function stange() {
  const out = [];
  for (const [art, liste] of Object.entries(cosmetics.KATALOG)) {
    for (const x of Object.values(liste)) {
      if (x.nur !== "kleider" || !x.cost || stufeVon(x.cost) !== "gewoehnlich") continue;
      out.push({ art, id: x.id, label: x.label, cost: x.cost, stufe: "gewoehnlich", preis: Math.max(1000, Math.round((x.cost * STANGE_ANTEIL) / 500) * 500) });
    }
  }
  return out.sort((a, b) => a.art.localeCompare(b.art) || a.preis - b.preis);
}

function hat(acc, art, id) {
  const liste = acc && acc.cosOwned && acc.cosOwned[cosmetics.TOPF[art]];
  return Array.isArray(liste) && liste.includes(id);
}

function setupBoutique(io, accounts) {
  io.on("connection", (socket) => {
    socket.on("boutique:state", (ack) => {
      if (typeof ack !== "function") return;
      const acc = socket.data.account ? accounts.get(socket.data.account) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const a = angebot();
      const zeig = (x) => ({ art: x.art, id: x.id, label: x.label, stufe: x.stufe, preis: x.preis, hat: hat(acc, x.art, x.id) });
      ack({ ok: true, bis: a.bis, stuecke: a.stuecke.map(zeig), stange: stange().map(zeig),
        artNamen: Object.fromEntries(Object.entries(cosmetics.ART_NAME || {})) });
    });

    socket.on("boutique:kaufen", ({ art, id, quelle } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const liste = quelle === "stange" ? stange() : angebot().stuecke;
      const stueck = liste.find((x) => x.art === String(art || "") && x.id === String(id || ""));
      if (!stueck) return ack({ ok: false, error: quelle === "stange" ? "Das hängt nicht an der Stange." : "Das liegt diese Woche nicht im Schaufenster." });
      if (hat(acc, stueck.art, stueck.id)) return ack({ ok: false, error: "Das hast du schon." });
      if ((acc.chips || 0) < stueck.preis) return ack({ ok: false, error: "Nicht genug Chips." });
      /* Über das Buchungsjournal: Chips und Exemplar landen gemeinsam auf
         der Platte oder gar nicht (game/buchungen.js). Ging die Vergabe
         schief, etwa weil ein Exemplar hinterlegt auf dem Markt liegt, ist
         nichts abgebucht. */
      const r = require("./buchungen").buche({
        accounts, cosmetics, praegung: require("./praegung"), key, acc,
        quelle: "boutique", art: stueck.art, id: stueck.id, preis: stueck.preis,
      });
      if (!r.ok) return ack(r);
      ack({ ok: true, label: stueck.label, account: accounts.publicAccount(acc) });
    });
  });
}

module.exports = { setupBoutique, angebot, stange, wocheVon, AUFPREIS, STANGE_ANTEIL };
