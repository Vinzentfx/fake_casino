"use strict";

/**
 * Hochgeladene Bilder, zurzeit nur Clan-Wappen.
 *
 * Warum das hier so wenig tut
 *
 * Bild-Upload ist der klassische Weg, sich einen Server einzutreten: eine
 * SVG-Datei mit eingebettetem Skript, ein Bild, das gleichzeitig ein gueltiges
 * HTML ist, EXIF-Daten mit dem Wohnort des Fotografen, eine 40-Megapixel-Datei,
 * die beim Verkleinern den Arbeitsspeicher sprengt.
 *
 * Gegen all das hilft ein Schritt, der hier gar nicht stattfindet: der Browser
 * zeichnet das gewaehlte Bild in ein Canvas fester Groesse und gibt es als
 * WebP wieder aus. Was dabei herauskommt, ist ein frisch erzeugtes Rasterbild
 * ohne Skript, ohne EXIF, ohne Anhaengsel, in bekannter Kantenlaenge. Die
 * Originaldatei verlaesst das Geraet nie.
 *
 * Der Server muss deshalb nur noch pruefen, dass wirklich ankam, was er
 * erwartet: die richtige Signatur am Dateianfang und eine plausible Groesse.
 * Auf ein Bild, das er selbst nicht erzeugt hat, verlaesst er sich nicht,
 * der Client koennte gefaelscht sein.
 *
 * Ausgeliefert wird ueber eine eigene Route (server.js), nicht ueber
 * express.static: der Ordner liegt in data/, und dort soll niemand stoebern.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const BILD_DIR = path.join(DATA_DIR, "bilder");

/* Der Client liefert 256x256 WebP. 300 KB sind dafuer reichlich bemessen und
   decken auch den Fall ab, dass ein Browser kein WebP kann und auf PNG
   ausweicht. */
const MAX_BYTES = 300 * 1024;

/* Erlaubte Signaturen. `test` bekommt die ersten Bytes der Datei. */
const SIGNATUREN = [
  { endung: "webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { endung: "png",  test: (b) => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG" },
  { endung: "jpg",  test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

function sicherstellen() {
  try { fs.mkdirSync(BILD_DIR, { recursive: true }); } catch {}
}

/** Nur Zeichen, die der Server selbst vergibt, kein Pfad kommt von aussen. */
const sauberesKuerzel = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);

/**
 * Ein Bild ablegen.
 *
 * @param {string} art    "clan", mehr gibt es noch nicht.
 * @param {string} id     Kennung des Besitzers, etwa die Clan-Id.
 * @param {string} datenUrl  "data:image/webp;base64,…" aus dem Canvas.
 * @returns {{ok: boolean, error?: string, url?: string, bytes?: number}}
 */
function speichere(art, id, datenUrl) {
  const a = sauberesKuerzel(art), i = sauberesKuerzel(id);
  if (!a || !i) return { ok: false, error: "Ungültiges Ziel." };

  const m = /^data:image\/(webp|png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(datenUrl || ""));
  if (!m) return { ok: false, error: "Das ist kein Bild." };

  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch { return { ok: false, error: "Bild nicht lesbar." }; }
  if (!buf.length) return { ok: false, error: "Bild ist leer." };
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: `Bild ist zu groß (${Math.round(buf.length / 1024)} KB, erlaubt sind ${Math.round(MAX_BYTES / 1024)}).` };
  }

  /* Die angegebene Art zaehlt nicht, nur was tatsaechlich in der Datei
     steht. Ein umbenanntes Skript kommt so nicht durch. */
  const sig = SIGNATUREN.find((s) => s.test(buf));
  if (!sig) return { ok: false, error: "Das ist kein PNG, JPEG oder WebP." };

  sicherstellen();
  // Ein Bild je Ziel. Altes Format mit anderer Endung vorher wegräumen.
  for (const s of SIGNATUREN) {
    if (s.endung === sig.endung) continue;
    try { fs.rmSync(path.join(BILD_DIR, `${a}-${i}.${s.endung}`), { force: true }); } catch {}
  }
  const datei = `${a}-${i}.${sig.endung}`;
  try {
    fs.writeFileSync(path.join(BILD_DIR, datei), buf);
  } catch (e) {
    return { ok: false, error: "Konnte nicht gespeichert werden." };
  }
  // Der Zeitstempel haengt hinten dran, damit der Browser das neue Bild
  // nicht aus seinem Zwischenspeicher zeigt.
  return { ok: true, url: `/bilder/${datei}?v=${Date.now().toString(36)}`, bytes: buf.length };
}

/** Datei zu einem Ziel, oder null. */
function pfad(art, id) {
  const a = sauberesKuerzel(art), i = sauberesKuerzel(id);
  if (!a || !i) return null;
  for (const s of SIGNATUREN) {
    const p = path.join(BILD_DIR, `${a}-${i}.${s.endung}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Oeffentliche Adresse, oder null. Der Zeitstempel bricht den Zwischenspeicher. */
function url(art, id) {
  const p = pfad(art, id);
  if (!p) return null;
  let stand = "";
  try { stand = "?v=" + Math.floor(fs.statSync(p).mtimeMs).toString(36); } catch {}
  return "/bilder/" + path.basename(p) + stand;
}

function loesche(art, id) {
  const p = pfad(art, id);
  if (!p) return false;
  try { fs.rmSync(p, { force: true }); return true; } catch { return false; }
}

/** Alles, was da ist, fuer die Admin-Uebersicht. */
function alle() {
  sicherstellen();
  try {
    return fs.readdirSync(BILD_DIR).map((datei) => {
      const p = path.join(BILD_DIR, datei);
      const st = fs.statSync(p);
      /* Die Art trennt der erste Bindestrich ab und darf deshalb selbst
         keinen enthalten, sonst frisst der gierige Ausdruck den ersten
         Bindestrich der Kennung mit, und aus "clan-die-haie" wird die Art
         "clan-die" und die Kennung "haie". Genau das ist passiert. */
      const m = /^([a-z0-9_]+)-(.+)\.(webp|png|jpg)$/.exec(datei);
      return {
        datei,
        art: m ? m[1] : "?",
        id: m ? m[2] : "?",
        url: "/bilder/" + datei + "?v=" + Math.floor(st.mtimeMs).toString(36),
        bytes: st.size,
        at: st.mtimeMs,
      };
    }).sort((a, b) => b.at - a.at);
  } catch { return []; }
}

module.exports = { speichere, url, pfad, loesche, alle, BILD_DIR, MAX_BYTES };
