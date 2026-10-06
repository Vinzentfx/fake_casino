"use strict";

/**
 * Der Greifautomat in der Spielhalle.
 *
 * Wie in echt: man fährt den Greifer über einen Ball, er senkt sich,
 * schließt, hebt an, und dann rutscht der Ball fast immer wieder heraus.
 * Ob der Greifer überhaupt etwas zu fassen bekommt, hängt vom Zielen ab;
 * ob er hält, entscheidet der Server. Hält er (1 zu 2.000), fällt der Ball
 * in den Schacht, und darin liegt das Königliche Gummihuhn, ein Stück, das
 * es nur hier gibt.
 *
 * Ein Versuch kostet fast nichts. Der Automat ist ein Spaß, keine
 * Einnahmequelle, und genau deshalb darf er auch keine sein: wer das Huhn
 * schon hat, bekommt bei einem Treffer nur einen kleinen Trost, und der
 * liegt im Mittel weit unter dem Preis. Die Pause zwischen zwei Versuchen ist
 * so lang wie die Animation, damit sich niemand das Huhn in einer Stunde
 * erklickt.
 *
 * Die Bälle liegen fest (`GREIFER` in raeume.js, dieselbe Liste zeichnet
 * der Browser), und wo der Ball herausrutscht, sagt ebenfalls der Server:
 * alle im Raum sehen dieselbe Szene.
 */

const R = require("../public/js/welt/raeume.js");

const PREIS = 50;
const CHANCE = 1 / 2000;
const TROST = 2500;
const PAUSE_MS = 5500;
const PREIS_ART = "hand";
const PREIS_ID = "gummihuhn";

/** Welcher Ball unter dieser Stelle liegt, oder null. */
function trifft(x) {
  const g = R.GREIFER;
  let bester = null, abstand = Infinity;
  g.baelle.forEach((b, i) => {
    const d = Math.abs(b.x - x);
    if (d < abstand) { abstand = d; bester = i; }
  });
  return abstand <= g.fangweite ? bester : null;
}

/* Wo der Ball herausrutscht, als Anteil des Wegs vom Anheben bis über den
   Schacht: die Hälfte gleich beim Anheben, ein Drittel unterwegs, und ab
   und zu kurz vor dem Schacht. Das letzte ist das gemeinste, und genau
   deshalb gehört es dazu. */
function rutschStelle(zufall = Math.random) {
  const r = zufall();
  if (r < 0.5) return 0.12 + zufall() * 0.3;
  if (r < 0.85) return 0.5 + zufall() * 0.32;
  return 0.9 + zufall() * 0.07;
}

function setupGreifer(io, accounts) {
  const zuletzt = new Map();
  const welt = () => require("./welt");

  io.on("connection", (socket) => {
    socket.on("greifer:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: true, preis: PREIS, pauseMs: PAUSE_MS });
    });

    socket.on("greifer:greifen", (daten, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      // Man muss davor stehen; der Automat steht in der Welt, nicht im Menü.
      const fig = welt().figurVon(key);
      const d = fig && (R.raum(fig.raum).dinge || []).find((x) => x.id === "greifer");
      if (!d || R.abstandZuDing(d, fig.x, fig.y) > R.reichweite(d) + 0.6) return ack({ ok: false, error: "Stell dich vor den Greifautomaten." });
      const jetzt = Date.now();
      if (jetzt - (zuletzt.get(key) || 0) < PAUSE_MS) return ack({ ok: false, error: "Der Greifer fährt noch zurück." });
      const g = R.GREIFER;
      const x = Number(daten && daten.x);
      if (!Number.isFinite(x)) return ack({ ok: false, error: "Wohin denn?" });
      const ziel = Math.max(g.links, Math.min(g.rechts, x));
      if (acc.chips < PREIS) return ack({ ok: false, error: "Nicht genug Chips." });
      const ab = accounts.adjustChips(key, -PREIS);
      if (!ab.ok) return ack({ ok: false, error: ab.error });
      zuletzt.set(key, jetzt);

      const treffer = trifft(ziel);
      const gewonnen = treffer != null && Math.random() < CHANCE;
      let account = ab.account, trost = 0, neu = false;
      if (gewonnen) {
        neu = require("./cosmetics").grant(acc, PREIS_ART, PREIS_ID, key);
        if (!neu) {
          trost = TROST;
          const r = accounts.adjustChips(key, TROST);
          if (r.ok) account = r.account;
        } else {
          accounts.save();
          account = accounts.publicAccount(acc);
        }
      }
      const szene = { x: ziel, treffer, rutscht: gewonnen ? null : rutschStelle(), gewonnen };
      /* Für die Achievements: wie oft der Greifer gehalten hat, und wie oft
         der Ball erst kurz vor dem Schacht herausgerutscht ist. Die Versuche
         selbst zählt schon recordHand (stats.perGame.greifer). Gezählt wird
         vor recordHand, denn dort läuft die Prüfung der Achievements. */
      const zaehler = acc.greifer && typeof acc.greifer === "object" ? acc.greifer : (acc.greifer = {});
      if (gewonnen) zaehler.gehalten = (zaehler.gehalten || 0) + 1;
      else if (treffer != null && szene.rutscht >= 0.9) zaehler.knapp = (zaehler.knapp || 0) + 1;
      accounts.recordHand(key, (gewonnen ? trost : 0) - PREIS, true, "greifer", { einsatz: PREIS });

      welt().schau(socket, "greifer", { greifer: szene });
      if (gewonnen && neu) {
        const text = `${acc.name} hat am Greifautomaten das Königliche Gummihuhn gefangen!`;
        try { require("./chat").announce(io, text); } catch {}
        try { require("./feed").add("event", text); } catch {}
      }
      ack({ ok: true, ...szene, neu, trost, preis: PREIS, account });
    });
  });
}

module.exports = { setupGreifer, trifft, rutschStelle, PREIS, CHANCE, TROST, PAUSE_MS };
