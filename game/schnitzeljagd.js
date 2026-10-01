"use strict";

/**
 * Die Schnitzeljagd: ein Event zum Start, vom Besitzer im Admin-Bildschirm
 * gestartet. Ein paar Tage lang liegen zwölf goldene Marken in allen Räumen,
 * die man zu Fuß erreicht. Wer drüberläuft, hebt sie auf.
 *
 * Bewusst KEIN Wettrennen: jeder sammelt für sich, jede Marke liegt für jeden
 * da. Die Runde spielt versetzt; ein Event, bei dem gewinnt, wer zur
 * richtigen Minute online ist, bestraft genau die, die selten da sind.
 * Deshalb auch mehrere Tage Laufzeit statt einer Stunde.
 *
 * Belohnung: jede Marke 2.500 Chips, alle zwölf zusammen noch einmal 25.000
 * und der Titel „Schatzsucher“. Beides ist Gratisgeld und läuft durch die
 * Vermögensbremse. Ob jemand nah genug steht, prüft der Server an der Figur
 * in der Welt; der Browser schickt nur, welche Marke.
 */

const fs = require("fs");
const path = require("path");

const DATEI = path.join(__dirname, "..", "data", "schnitzeljagd.json");
const PRO_MARKE = 2500;
const ABSCHLUSS = 25000;
const REICHWEITE = 1.1;
const TITEL = "schatzsucher";

/* Die Verstecke. Jede Stelle ist zu Fuß erreichbar; das prüft
   tests/schnitzeljagd.test.js gegen dieselbe Kollision wie die Welt. */
const MARKEN = [
  { id: "m1", raum: "casino", x: 1.1, y: 4.0 },
  { id: "m2", raum: "casino", x: 18.8, y: 4.6 },
  { id: "m3", raum: "casino", x: 3.4, y: 11.6 },
  { id: "m4", raum: "kontor", x: 1.1, y: 9.2 },
  { id: "m5", raum: "kontor", x: 14.5, y: 4.3 },
  { id: "m6", raum: "ruhm", x: 1.2, y: 10.1 },
  { id: "m7", raum: "hof", x: 1.1, y: 9.3 },
  { id: "m8", raum: "hof", x: 15.0, y: 4.0 },
  { id: "m9", raum: "strasse", x: 16.5, y: 9.0 },
  { id: "m10", raum: "strasse", x: 6.4, y: 4.6 },
  { id: "m11", raum: "spielhalle", x: 14.9, y: 8.2 },
  { id: "m12", raum: "spielhalle", x: 8.0, y: 4.0 },
];

let state = { aktiv: false, start: 0, bis: 0, runde: 0, gefunden: {} };
try {
  const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  if (roh && typeof roh === "object") state = { ...state, ...roh };
} catch {}
function speichern() {
  try { require("./buchungen").sicherSchreiben(DATEI, JSON.stringify(state)); } catch (e) { console.error("[jagd] speichern:", e.message); }
}

const laeuft = (jetzt = Date.now()) => !!state.aktiv && jetzt < state.bis;

function zustand() {
  return { active: laeuft(), endsAt: laeuft() ? state.bis : null, marken: MARKEN.length };
}

function stand(key, raum) {
  const meine = new Set(state.gefunden[key] || []);
  return {
    aktiv: laeuft(), bis: state.bis, gesamt: MARKEN.length, gefunden: meine.size,
    // Nur die Marken im eigenen Raum, und nur die noch nicht gefundenen.
    marken: laeuft() ? MARKEN.filter((m) => m.raum === raum && !meine.has(m.id)).map(({ id, x, y }) => ({ id, x, y })) : [],
  };
}

function setupSchnitzeljagd(io, accounts) {
  const chat = () => { try { return require("./chat"); } catch { return null; } };

  function starten(tage) {
    const dauer = Math.max(1, Math.min(14, Math.round(Number(tage) || 3))) * 86400000;
    state = { aktiv: true, start: Date.now(), bis: Date.now() + dauer, runde: (state.runde || 0) + 1, gefunden: {} };
    speichern();
    io.emit("jagd:update", { aktiv: true });
    const c = chat();
    if (c) c.announce(io, `Schnitzeljagd! In allen Räumen liegen ${MARKEN.length} goldene Marken versteckt. Jeder sammelt für sich, ${Math.round(dauer / 86400000)} Tage lang.`);
    return zustand();
  }
  function beenden() {
    state.aktiv = false;
    speichern();
    io.emit("jagd:update", { aktiv: false });
    return zustand();
  }

  io.on("connection", (socket) => {
    socket.on("jagd:state", ({ raum } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      if (!key) return ack({ ok: false });
      ack({ ok: true, ...stand(key, String(raum || "")) });
    });

    socket.on("jagd:finden", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!laeuft()) return ack({ ok: false, error: "Gerade läuft keine Schnitzeljagd." });
      const m = MARKEN.find((x) => x.id === String(id || ""));
      if (!m) return ack({ ok: false, error: "Diese Marke gibt es nicht." });
      const meine = state.gefunden[key] || (state.gefunden[key] = []);
      if (meine.includes(m.id)) return ack({ ok: false, error: "Die hast du schon." });
      // Nah genug dran? Gefragt wird die Figur in der Welt, nicht der Browser.
      const fig = require("./welt").figurVon(key);
      if (!fig || fig.raum !== m.raum || Math.hypot(fig.x - m.x, fig.y - m.y) > REICHWEITE) return ack({ ok: false, error: "Geh erst hin." });
      meine.push(m.id);
      const faktor = typeof accounts.faucetFactor === "function" ? accounts.faucetFactor(acc.name) : 1;
      /* Chips nur für Konten, die schon vor dem Start da waren. Sonst holt
         sich ein frisches Zweitkonto 55.000 Chips und schickt sie nach
         einem Tag weiter. Marken und Titel gibt es trotzdem. */
      const zahlt = Number(acc.createdAt || 0) < state.start;
      let chips = zahlt ? Math.round(PRO_MARKE * faktor) : 0;
      const fertig = meine.length >= MARKEN.length;
      if (fertig) {
        if (zahlt) chips += Math.round(ABSCHLUSS * faktor);
        acc.jagd = { runde: state.runde, fertig: Date.now() };
        try { require("./cosmetics").grant(acc, "title", TITEL, key); } catch {}
      }
      speichern();
      const r = chips > 0 ? accounts.adjustChips(key, chips) : { ok: false };
      if (fertig) {
        try { require("./achievements").check(key); } catch {}
        const c = chat();
        if (c) c.announce(io, `${acc.name} hat alle ${MARKEN.length} goldenen Marken gefunden.`);
      }
      ack({ ok: true, chips, ohneChips: !zahlt, fertig, gefunden: meine.length, gesamt: MARKEN.length, account: r.ok ? r.account : accounts.publicAccount(acc) });
    });
  });

  return { starten, beenden };
}

module.exports = { setupSchnitzeljagd, zustand, stand, laeuft, MARKEN, PRO_MARKE, ABSCHLUSS, _state: () => state };
