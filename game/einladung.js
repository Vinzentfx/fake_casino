"use strict";

/**
 * Mitspieler in die eigene Lobby einladen.
 *
 * Zwei Luecken schliesst das. Oeffentliche Lobbys stehen zwar in der Liste
 * "Offene Lobbys", die sieht aber nur, wer gerade auf den Startbildschirm
 * schaut; wer selbst in einem Spiel sitzt, bekommt nichts mit. Und PRIVATE
 * Lobbys stehen in gar keiner Liste, dort war der einzige Weg bisher, den
 * Code muendlich durchzusagen.
 *
 * In welcher Lobby jemand sitzt, muss kein Spiel melden: alle neun stecken
 * ihren Socket per socket.join(code) in einen Raum, der genau so heisst wie
 * der Lobby-Code. Der Server liest das direkt aus socket.rooms. Deshalb
 * funktioniert das ohne einen einzigen Eingriff in die Spielmodule.
 */

const lobby = require("./lobby");

// Lobby-Codes sind vier Zeichen aus CODE_CHARS. Das grenzt sie sauber gegen
// die anderen Raeume ab, in denen ein Socket steckt: seine eigene id und
// die Clan-Raeume ("clan:17").
const CODE = /^[A-Z0-9]{4}$/;

const ABSTAND = 60 * 1000;   // dieselbe Person nicht oefter als einmal je Minute
const FENSTER = 60 * 1000;
const MAX_JE_FENSTER = 8;    // und insgesamt nicht mehr als acht pro Minute

/*
 * Fallback fuer PRIVATE Lobbys: die stehen in keiner Registrierung, also
 * gibt es dort keinen Steckbrief. Dann muss der Bildschirm herhalten, auf
 * dem der Einladende steht.
 *
 * Achtung, zwei Namen laufen auseinander: der Bildschirm heisst "solitaire"
 * und "slots", die Beitritts-Funktion im Client dagegen "solrace" und "pvp"
 * (siehe join() in public/js/lobby.js). Wer das verwechselt, verschickt eine
 * Einladung, die sich nicht annehmen laesst.
 */
const SPIEL_NAMEN = {
  poker: "Poker", roulette: "Roulette", blackjack: "Blackjack", memory: "Memory-Duell",
  sudoku: "Sudoku-Duell", solitaire: "Solitär-Rennen", chess: "Schach", pinco: "Pinco Ball", kniffel: "Kniffel-Duell",
  slots: "Slots-Duell",
};
const SCHIRM_ZU_SPIEL = {
  poker: "poker", roulette: "roulette", blackjack: "blackjack", memory: "memory",
  sudoku: "sudoku", solitaire: "solrace", chess: "chess", pinco: "pinco", slots: "pvp", kniffel: "kniffel",
};

const zuletztAn = new Map();   // "absender>empfaenger" -> Zeitpunkt
const fenster = new Map();     // absender -> { start, anzahl }

/** Der Lobby-Code, in dem dieser Socket steckt, oder null. */
function aktuelleLobby(socket) {
  for (const raum of socket.rooms) {
    if (raum === socket.id) continue;
    if (CODE.test(raum)) return raum;
  }
  return null;
}

function darfSenden(von, an) {
  const jetzt = Date.now();
  if (jetzt - (zuletztAn.get(von + ">" + an) || 0) < ABSTAND) {
    return { ok: false, error: "Den hast du gerade erst eingeladen." };
  }
  const f = fenster.get(von);
  if (!f || jetzt - f.start > FENSTER) fenster.set(von, { start: jetzt, anzahl: 1 });
  else if (f.anzahl >= MAX_JE_FENSTER) return { ok: false, error: "Zu viele Einladungen auf einmal. Warte kurz." };
  else f.anzahl += 1;
  zuletztAn.set(von + ">" + an, jetzt);
  return { ok: true };
}

function setupEinladung(io, accounts) {
  /** Alle Sockets einer Person. */
  const socketsVon = (key) => {
    const out = [];
    for (const s of io.of("/").sockets.values()) if (s.data && s.data.account === key) out.push(s);
    return out;
  };

  io.on("connection", (socket) => {
    /*
     * Kann ich gerade jemanden einladen, und wen?
     *
     * Der Client fragt das beim Bildschirmwechsel und danach im Takt, weil
     * sich der Zustand ohne Navigation aendert: eine Lobby aufmachen bringt
     * einen in einen Raum, ohne dass der Bildschirm wechselt.
     */
    socket.on("einladung:status", (arg, ack2) => {
      const ack = typeof arg === "function" ? arg : ack2;
      const schirm = typeof arg === "object" && arg ? String(arg.schirm || "").slice(0, 32) : "";
      if (typeof ack !== "function") return;
      const key = socket.data.account;
      const code = key ? aktuelleLobby(socket) : null;
      if (!code) return ack({ ok: true, aktiv: false });

      const d = lobby.beschreibe(code);
      const spiel = schirm || socket.data.screen || "";
      const label = (d && d.label) || SPIEL_NAMEN[spiel] || "eine Runde";
      const frei = d && d.max ? Math.max(0, d.max - (d.players || 0)) : null;

      // Wer ist online, ist nicht ich, und sitzt nicht schon in dieser Lobby?
      const drin = new Set();
      for (const s of io.of("/").sockets.values()) {
        if (s.data && s.data.account && s.rooms.has(code)) drin.add(s.data.account);
      }
      const kandidaten = new Map();
      for (const s of io.of("/").sockets.values()) {
        const k = s.data && s.data.account;
        if (!k || k === key || drin.has(k)) continue;
        const acc = accounts.get(k);
        if (!acc) continue;
        kandidaten.set(k, { key: k, name: acc.name, screen: s.data.screen || "lobby" });
      }
      ack({ ok: true, aktiv: true, code, label, frei, spieler: [...kandidaten.values()] });
    });

    socket.on("einladung:senden", ({ an, schirm } = {}, ack) => {
      const antwort = (r) => typeof ack === "function" && ack(r);
      const key = socket.data.account;
      if (!key) return antwort({ ok: false, error: "Bitte zuerst einloggen." });

      const code = aktuelleLobby(socket);
      if (!code) return antwort({ ok: false, error: "Du bist gerade in keiner Lobby." });

      const ziel = String(an || "").trim().toLowerCase();
      if (!ziel || ziel === key) return antwort({ ok: false, error: "Geht nicht." });

      const ziele = socketsVon(ziel);
      if (!ziele.length) return antwort({ ok: false, error: "Der ist gerade nicht da." });
      // Sitzt schon drin: dann ist die Einladung sinnlos statt falsch.
      if (ziele.some((s) => s.rooms.has(code))) return antwort({ ok: false, error: "Der ist schon dabei." });

      const erlaubt = darfSenden(key, ziel);
      if (!erlaubt.ok) return antwort(erlaubt);

      const acc = accounts.get(key);
      const d = lobby.beschreibe(code);
      // Der Client kennt seinen Bildschirm genauer als die Praesenz, die erst
      // beim Navigieren gesetzt wird. Nur als Rueckfall, nie gegen den
      // Steckbrief einer oeffentlichen Lobby.
      const schirmName = String(schirm || "").trim().slice(0, 32) || socket.data.screen || "";
      const nutzlast = {
        von: (acc && acc.name) || key,
        code,
        // `spiel` ist der Schluessel, mit dem der Client die richtige
        // Beitritts-Funktion findet (siehe join() in public/js/lobby.js).
        spiel: (d && d.game) || SCHIRM_ZU_SPIEL[schirmName] || "",
        label: (d && d.label) || SPIEL_NAMEN[schirmName] || "eine Runde",
        privat: !d,
      };
      for (const s of ziele) s.emit("einladung:neu", nutzlast);
      // Zaehler fuer das Achievement "Gastgeber".
      if (acc) { acc.einladungen = (acc.einladungen || 0) + 1; accounts.save(); }
      antwort({ ok: true });
    });
  });
}

module.exports = { setupEinladung };
