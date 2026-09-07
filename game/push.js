"use strict";

/**
 * Push-Nachrichten (Web Push).
 *
 * Das Casino hat ein Zeitproblem, kein Inhaltsproblem: Poker, Duelle, Lobbys,
 * Clan-Kriege und saemtliche Live-Events verlangen, dass mehrere gleichzeitig
 * da sind. Genau das passiert fast nie, weil niemand weiss, wann die anderen
 * spielen. Push loest das als Einziges wirklich: das Casino meldet sich, wenn
 * es sich lohnt.
 *
 * Bewusst sehr sparsam. Vier Anlaesse, einzeln abschaltbar:
 *   live    Ein Live-Event laeuft gerade (Chip-Regen, Heist, Quiz, Tresorkampf,
 *           Turnier). Diese Events starten nur, wenn schon jemand da ist, das
 *           Signal ist also immer echt.
 *   rekord  Jemand hat deinen Wochenrekord geschlagen.
 *   tisch   Jemand macht einen Tisch auf und wartet auf Mitspieler.
 *   serie   Deine taegliche Login-Serie laeuft heute aus.
 *
 * iPad: Safari liefert Push nur, wenn die Seite ueber "Zum Home-Bildschirm"
 * installiert wurde. Das erklaert die Oberflaeche dem Spieler, statt ihn im
 * Dunkeln einen Schalter umlegen zu lassen, der nichts tut.
 *
 * Die Anmeldungen haengen am Account, nicht am Geraet-Speicher: Safari raeumt
 * localStorage nach sieben Tagen ohne Besuch weg, und genau die Leute, die
 * lange weg waren, sollen die Nachricht ja bekommen.
 */

const path = require("path");
const fs = require("fs");
const webpush = require("web-push");

const DATA_DIR = path.join(__dirname, "..", "data");
const KEY_FILE = path.join(DATA_DIR, "vapid.json");

// Anlaesse. `standard` ist, was ein frisch angemeldeter Spieler bekommt.
const TYPEN = {
  /* Ansagen des Hauses. Eigener Anlass, nicht unter "live" mitgefuehrt:
     eine Wartungsansage ist etwas anderes als ein Turnier, und wer Events
     abgeschaltet hat, will trotzdem erfahren, wenn der Server abends weg
     ist. Kommt selten, deshalb standardmaessig an. */
  ansage: { label: "Ansagen", hint: "Wenn der Hausherr etwas mitzuteilen hat", standard: true },
  live:   { label: "Live-Events", hint: "Turnier und Happy Hour, solange sie laufen", standard: true },
  rekord: { label: "Wochenrekorde", hint: "Wenn jemand deinen Rekord schlägt", standard: true },
  tisch:  { label: "Offene Tische", hint: "Wenn jemand auf Mitspieler wartet", standard: true },
  serie:  { label: "Login-Serie", hint: "Erinnerung, bevor deine Serie reißt", standard: false },
};

// Ein Geraet bekommt denselben Anlass hoechstens so oft. Ohne die Sperre wuerde
// ein Abend mit drei Events zur Belaestigung.
const MIN_ABSTAND = {
  /* Ansagen kommen von Hand und selten. Eine halbe Stunde reicht, um ein
     versehentliches doppeltes Absenden abzufangen, ohne die zweite, wirklich
     wichtige Ansage eines Abends zu verschlucken. */
  ansage: 30 * 60 * 1000,
  live: 45 * 60 * 1000,
  rekord: 10 * 60 * 1000,
  tisch: 60 * 60 * 1000,
  serie: 20 * 60 * 60 * 1000,
};

// Wer gerade offen im Casino sitzt, braucht keine Benachrichtigung: er sieht
// das Event ohnehin auf dem Bildschirm.
const _online = new Set();

let _accounts = null;
let _io = null;
let keys = null;

function ladeKeys() {
  try {
    const k = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    if (k && k.publicKey && k.privateKey) return k;
  } catch {}
  // Beim ersten Start selbst erzeugen. Damit steht kein Schluessel im Repo und
  // der Server behaelt seinen eigenen, auch wenn lokal getestet wird.
  const k = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(k));
  } catch {}
  return k;
}

function ensure(acc) {
  if (!acc.push || typeof acc.push !== "object") acc.push = {};
  if (!Array.isArray(acc.push.subs)) acc.push.subs = [];
  if (!acc.push.typen || typeof acc.push.typen !== "object") {
    acc.push.typen = Object.fromEntries(Object.entries(TYPEN).map(([id, t]) => [id, !!t.standard]));
  }
  if (!acc.push.zuletzt || typeof acc.push.zuletzt !== "object") acc.push.zuletzt = {};
  return acc.push;
}

/** Anmeldung eines Geraets ablegen. Gleicher Endpunkt = gleiches Geraet. */
function abonniere(key, sub, ua) {
  const acc = _accounts && _accounts.get(key);
  if (!acc || !sub || !sub.endpoint || !sub.keys) return { ok: false, error: "Ungültige Anmeldung." };
  const p = ensure(acc);
  p.subs = p.subs.filter((s) => s.endpoint !== sub.endpoint);
  p.subs.push({ endpoint: sub.endpoint, keys: sub.keys, at: Date.now(), ua: String(ua || "").slice(0, 120) });
  // Mehr als vier Geraete pro Person ist immer ein Rest von alten Anmeldungen.
  if (p.subs.length > 4) p.subs = p.subs.slice(-4);
  _accounts.save();
  return { ok: true, ...zustand(key) };
}

function kuendige(key, endpoint) {
  const acc = _accounts && _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  const p = ensure(acc);
  p.subs = endpoint ? p.subs.filter((s) => s.endpoint !== endpoint) : [];
  _accounts.save();
  return { ok: true, ...zustand(key) };
}

function setzeTypen(key, typen) {
  const acc = _accounts && _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  const p = ensure(acc);
  for (const [id, an] of Object.entries(typen || {})) {
    if (TYPEN[id]) p.typen[id] = !!an;
  }
  _accounts.save();
  return { ok: true, ...zustand(key) };
}

function zustand(key) {
  const acc = _accounts && _accounts.get(key);
  const p = acc ? ensure(acc) : null;
  return {
    publicKey: keys ? keys.publicKey : null,
    geraete: p ? p.subs.length : 0,
    endpunkte: p ? p.subs.map((s) => s.endpoint) : [],
    typen: p ? { ...p.typen } : {},
    katalog: Object.entries(TYPEN).map(([id, t]) => ({ id, label: t.label, hint: t.hint })),
  };
}

/** Endpunkte, die der Browser abgemeldet hat, fliegen raus statt ewig zu scheitern. */
async function anEinen(acc, typ, payload) {
  const p = ensure(acc);
  if (!p.subs.length) return 0;
  if (p.typen[typ] === false) return 0;

  const jetzt = Date.now();
  const abstand = MIN_ABSTAND[typ] || 0;
  if (jetzt - (p.zuletzt[typ] || 0) < abstand) return 0;
  p.zuletzt[typ] = jetzt;

  const body = JSON.stringify({ ...payload, typ });
  let zugestellt = 0;
  const tot = [];
  await Promise.all(p.subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 3600, urgency: "normal" });
      zugestellt++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) tot.push(s.endpoint);
    }
  }));
  if (tot.length) p.subs = p.subs.filter((s) => !tot.includes(s.endpoint));
  _accounts.save();
  return zugestellt;
}

/**
 * An alle, die gerade NICHT im Casino sind. `ausser` nimmt Account-Keys, etwa
 * den Ausloeser selbst.
 */
async function anAlle(typ, payload, { ausser = [] } = {}) {
  if (!_accounts || !keys) return 0;
  const raus = new Set([...(ausser || []).map((k) => String(k).toLowerCase()), ..._online]);
  let n = 0;
  for (const acc of _accounts.rawAll()) {
    const key = String(acc.name || "").trim().toLowerCase();
    if (!key || raus.has(key)) continue;
    if (!acc.push || !Array.isArray(acc.push.subs) || !acc.push.subs.length) continue;
    try { n += await anEinen(acc, typ, payload); } catch {}
  }
  return n;
}

/** An eine bestimmte Person, auch wenn sonst niemand betroffen ist. */
async function an(key, typ, payload) {
  if (!_accounts || !keys) return 0;
  const k = String(key || "").trim().toLowerCase();
  if (!k || _online.has(k)) return 0;
  const acc = _accounts.get(k);
  if (!acc) return 0;
  try { return await anEinen(acc, typ, payload); } catch { return 0; }
}

// ─── Mitspieler rufen ───────────────────────────────────────────────────────
// Der ehrlichste Auslöser von allen: ein echter Mensch sitzt gerade da und
// sucht Gesellschaft. Kein Automatismus schafft das. Dafuer streng begrenzt,
// sonst wird daraus eine Klingelanlage.
const RUF_PRO_SPIELER = 3 * 60 * 60 * 1000;
const RUF_GLOBAL = 45 * 60 * 1000;
let letzterRufGlobal = 0;

async function rufe(key, text) {
  const acc = _accounts && _accounts.get(key);
  if (!acc) return { ok: false, error: "Nicht eingeloggt." };
  const jetzt = Date.now();
  if (jetzt - letzterRufGlobal < RUF_GLOBAL) {
    return { ok: false, error: "Gerade hat schon jemand gerufen. Etwas später nochmal." };
  }
  const p = ensure(acc);
  if (jetzt - (p.letzterRuf || 0) < RUF_PRO_SPIELER) {
    const std = Math.ceil((RUF_PRO_SPIELER - (jetzt - (p.letzterRuf || 0))) / 3600000);
    return { ok: false, error: `Du kannst in etwa ${std} Std wieder rufen.` };
  }

  const sauber = String(text || "").trim().slice(0, 80);
  const n = await anAlle("tisch", {
    title: `🃏 ${acc.name} sucht Mitspieler`,
    body: sauber || "Ist gerade im Casino. Wer kommt dazu?",
    url: "/",
  }, { ausser: [key] });

  // Hat den Ruf niemand bekommen, wird auch keine Sperre gesetzt: sonst haette
  // man seinen einzigen Ruf an einen leeren Raum verschwendet.
  if (n <= 0) return { ok: false, error: "Niemand hat Benachrichtigungen an. Der Ruf bleibt dir erhalten." };
  p.letzterRuf = jetzt;
  letzterRufGlobal = jetzt;
  _accounts.save();
  return { ok: true, erreicht: n };
}

// ─── Serien-Erinnerung ──────────────────────────────────────────────────────
// Die Login-Serie reisst 26 Stunden nach dem letzten Abholen. Ab Tag drei tut
// das weh genug, dass eine Erinnerung willkommen ist statt laestig.
const SERIE_GRACE_MS = 26 * 60 * 60 * 1000;
const SERIE_VORLAUF_MS = 4 * 60 * 60 * 1000;
const SERIE_AB_TAG = 3;

async function pruefeSerien() {
  if (!_accounts || !keys) return;
  const jetzt = Date.now();
  for (const acc of _accounts.rawAll()) {
    if (!acc.push || !Array.isArray(acc.push.subs) || !acc.push.subs.length) continue;
    if ((acc.bonusStreak || 0) < SERIE_AB_TAG) continue;
    const rest = SERIE_GRACE_MS - (jetzt - (acc.lastBonusAt || 0));
    if (rest <= 0 || rest > SERIE_VORLAUF_MS) continue;
    const key = String(acc.name || "").trim().toLowerCase();
    if (_online.has(key)) continue;
    const std = Math.max(1, Math.round(rest / 3600000));
    try {
      await anEinen(acc, "serie", {
        title: `🔥 Serie Tag ${acc.bonusStreak}`,
        body: `In etwa ${std} Std reißt deine Serie. Einmal Bonus abholen reicht.`,
        url: "/",
      });
    } catch {}
  }
}

function setupPush(io, accounts) {
  _io = io;
  _accounts = accounts;
  keys = ladeKeys();
  webpush.setVapidDetails("mailto:casino@chipstadt.de", keys.publicKey, keys.privateKey);

  io.on("connection", (socket) => {
    const key = () => (socket.data.account ? String(socket.data.account).toLowerCase() : null);

    socket.on("push:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt.", publicKey: keys.publicKey });
      ack({ ok: true, ...zustand(key()) });
    });

    socket.on("push:subscribe", ({ sub, ua } = {}, ack) => {
      const res = key() ? abonniere(key(), sub, ua) : { ok: false, error: "Nicht eingeloggt." };
      if (typeof ack === "function") ack(res);
    });

    socket.on("push:unsubscribe", ({ endpoint } = {}, ack) => {
      const res = key() ? kuendige(key(), endpoint) : { ok: false, error: "Nicht eingeloggt." };
      if (typeof ack === "function") ack(res);
    });

    socket.on("push:types", ({ typen } = {}, ack) => {
      const res = key() ? setzeTypen(key(), typen) : { ok: false, error: "Nicht eingeloggt." };
      if (typeof ack === "function") ack(res);
    });

    // Probenachricht: ohne die weiss niemand, ob der Schalter wirklich wirkt.
    socket.on("push:test", async (ack) => {
      const k = key();
      if (!k) return typeof ack === "function" && ack({ ok: false, error: "Nicht eingeloggt." });
      const acc = _accounts.get(k);
      if (!acc) return typeof ack === "function" && ack({ ok: false, error: "Nicht eingeloggt." });
      const p = ensure(acc);
      if (!p.subs.length) return typeof ack === "function" && ack({ ok: false, error: "Auf diesem Gerät ist nichts angemeldet." });
      // Die Probe umgeht Online-Filter und Sperre, sonst prueft sie nichts.
      const gemerkt = { ...p.zuletzt };
      p.zuletzt = {};
      const n = await anEinen(acc, "live", { title: "🎰 Fake Casino", body: "Probe-Nachricht. Push funktioniert.", url: "/" });
      p.zuletzt = gemerkt;
      _accounts.save();
      if (typeof ack === "function") ack(n > 0 ? { ok: true, geraete: n } : { ok: false, error: "Kein Gerät hat die Probe angenommen." });
    });

    socket.on("push:ruf", async ({ text } = {}, ack) => {
      const k = key();
      const res = k ? await rufe(k, text) : { ok: false, error: "Nicht eingeloggt." };
      if (typeof ack === "function") ack(res);
    });

    // Wer verbunden ist, sieht alles im Bildschirm und bekommt nichts geschickt.
    socket.on("disconnect", () => {
      const k = key();
      if (!k) return;
      let nochDa = false;
      for (const s of io.of("/").sockets.values()) {
        if (s !== socket && s.data && String(s.data.account || "").toLowerCase() === k) { nochDa = true; break; }
      }
      if (!nochDa) _online.delete(k);
    });
  });

  // Login setzt den Online-Merker. Der Login laeuft nicht ueber ein eigenes
  // Ereignis, deshalb wird hier regelmaessig abgeglichen — billig und robust.
  const gleicheOnlineAb = () => {
    _online.clear();
    for (const s of io.of("/").sockets.values()) {
      if (s.data && s.data.account) _online.add(String(s.data.account).toLowerCase());
    }
  };
  gleicheOnlineAb();
  setInterval(gleicheOnlineAb, 15000).unref();

  // Halbstuendlich reicht: die Sperre in anEinen sorgt dafuer, dass niemand
  // zweimal am selben Tag erinnert wird.
  setInterval(() => { pruefeSerien().catch(() => {}); }, 30 * 60 * 1000).unref();
}

module.exports = { setupPush, an, anAlle, rufe, TYPEN, zustand };
