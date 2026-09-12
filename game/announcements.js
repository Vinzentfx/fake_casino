"use strict";

/**
 * Ansagen des Hauses.
 *
 * Eine Zeile, die ueber allem steht, bis der Besitzer sie wieder wegnimmt.
 *
 * Vorher konnte sie genau eines: dastehen. Kein Ton, kein Ablauf, kein
 * Verlauf. Wer sie schrieb, sah nicht, was er zuletzt geschrieben hatte,
 * und wer nicht gerade online war, erfuhr nie davon, obwohl das Haus seit
 * Monaten ein Push-System hat und genau die lange Abwesenden erreichen
 * will. Eine Wartungsansage blieb ausserdem stehen, bis jemand daran
 * dachte, sie zu loeschen; bei einer Ansage mit "ab 20 Uhr" ist das der
 * Normalfall, nicht die Ausnahme.
 *
 * Jetzt:
 *   Art      info | warnung | fest: bestimmt Farbe und Ton der Zeile.
 *   Ablauf   optional. Danach verschwindet sie von selbst.
 *   Verlauf  die letzten zehn, damit man sich nicht wiederholt.
 *   Push     optional, ueber den Anlass "ansage". Wer verbunden ist,
 *            bekommt keinen, der sieht die Zeile ja.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "announcement.json");
const OWNER = "vincent";
const MAX_TEXT = 220;
const VERLAUF_MAX = 10;

/* Die drei Toene. Mehr braucht es nicht: ein Haus, in dem alles dringend
   aussieht, hat keine Dringlichkeit mehr. `fest` ist der laute Fall und
   deshalb der einzige, der von sich aus einen Push nahelegt. */
const ARTEN = {
  info:    { label: "Info" },
  warnung: { label: "Achtung" },
  fest:    { label: "Fest" },
};
const istArt = (a) => Object.prototype.hasOwnProperty.call(ARTEN, a);

let store = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (raw && typeof raw === "object") {
      // Alte Fassung: die Datei war die Ansage.
      if (typeof raw.text === "string") return { aktuell: raw, verlauf: [] };
      return {
        aktuell: raw.aktuell && typeof raw.aktuell.text === "string" ? raw.aktuell : null,
        verlauf: Array.isArray(raw.verlauf) ? raw.verlauf.slice(0, VERLAUF_MAX) : [],
      };
    }
  } catch {}
  return { aktuell: null, verlauf: [] };
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
  } catch {}
}

/** Abgelaufene Ansage wegraeumen. Liefert true, wenn sich etwas geaendert hat. */
function aufraeumen() {
  const a = store.aktuell;
  if (a && a.bis && a.bis <= Date.now()) {
    store.aktuell = null;
    save();
    return true;
  }
  return false;
}

function publicState() {
  aufraeumen();
  return store.aktuell ? { ...store.aktuell } : null;
}

function setupAnnouncements(io) {
  /* Eine Ansage mit Ablauf muss auch dann verschwinden, wenn niemand etwas
     anklickt. Vorher gab es keinen Ablauf, also auch keinen Grund zu
     ticken. */
  setInterval(() => {
    if (aufraeumen()) io.emit("announcement:state", { announcement: null, toast: false });
  }, 30 * 1000);

  io.on("connection", (socket) => {
    socket.emit("announcement:state", { announcement: publicState() });

    socket.on("announcement:get", (ack) => {
      if (typeof ack === "function") ack({ ok: true, announcement: publicState() });
    });

    const istBesitzer = () => socket.data.account === OWNER;

    /** Was der Admin-Bildschirm braucht: Stand, Verlauf, moegliche Arten. */
    socket.on("admin:announcementState", (ack) => {
      if (typeof ack !== "function") return;
      if (!istBesitzer()) return ack({ ok: false, error: "Kein Zugriff." });
      ack({
        ok: true,
        announcement: publicState(),
        verlauf: store.verlauf.slice(0, VERLAUF_MAX),
        arten: Object.entries(ARTEN).map(([id, m]) => ({ id, label: m.label })),
        maxText: MAX_TEXT,
      });
    });

    socket.on("admin:announcement", async ({ text, art, minuten, push } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!istBesitzer()) return ack({ ok: false, error: "Kein Zugriff." });

      text = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      if (!text) return ack({ ok: false, error: "Text eingeben." });

      art = istArt(art) ? art : "info";

      /* Ablauf. 0 heisst "bis ich sie wegnehme", der bisherige und weiter
         der uebliche Fall. Nach oben eine Woche, damit ein vertippter Wert
         keine Zeile hinterlaesst, die den Sommer ueberdauert. */
      const min = Math.max(0, Math.min(7 * 24 * 60, Math.floor(Number(minuten) || 0)));
      const bis = min ? Date.now() + min * 60 * 1000 : 0;

      const eintrag = { text, art, by: OWNER, at: Date.now(), bis };
      store.aktuell = eintrag;
      store.verlauf = [{ ...eintrag }, ...store.verlauf].slice(0, VERLAUF_MAX);
      save();
      io.emit("announcement:state", { announcement: publicState(), toast: true });

      /* Push nur auf ausdruecklichen Wunsch. Eine Ansage erreicht sonst nur,
         wer gerade zufaellig da ist, und das sind genau nicht die, die man
         mit einer Ansage meint. Wer verbunden ist, bekommt keinen: `anAlle`
         laesst die Online-Liste ohnehin aus. */
      let erreicht = 0;
      if (push) {
        try {
          const p = require("./push");
          erreicht = await p.anAlle("ansage", {
            title: "Fake Casino",
            body: text,
            url: "/",
          });
        } catch { /* Push nicht eingerichtet, die Ansage steht trotzdem. */ }
      }
      ack({ ok: true, announcement: publicState(), pushErreicht: erreicht });
    });

    socket.on("admin:announcementClear", (ack) => {
      if (typeof ack !== "function") return;
      if (!istBesitzer()) return ack({ ok: false, error: "Kein Zugriff." });
      store.aktuell = null;
      save();
      io.emit("announcement:state", { announcement: null, toast: false });
      ack({ ok: true });
    });
  });
}

module.exports = { setupAnnouncements, publicState, ARTEN };
