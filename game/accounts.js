"use strict";

/**
 * Kontenverwaltung für das Spielgeld. Die HTTP-API (server.js) und die
 * Pokertische (Buy-in, Auszahlung) gehen beide hierüber, damit es nur einen
 * Kontostand gibt und nicht zwei, die auseinanderlaufen.
 *
 * Gespeichert in data/accounts.json, Passwörter als gesalzene scrypt-Hashes.
 * Ist Spielgeld unter Freunden, kein Hochsicherheitstrakt.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const strafen = require("./strafen");

const DATA_DIR = path.join(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SECRET_FILE = path.join(DATA_DIR, ".secret");

const STARTING_CHIPS = 5000; // ein erster Abend Spielgeld, weit unter jedem Hauspreis
// Harte Obergrenze gegen Cheats: kein Konto darf mehr haben. Wird bei jeder
// Buchung geprüft und regelmäßig abgefegt (startChipCapSweep), damit alte
// ausgenutzte Stände (die Billionen aus dem Bot-Fehler) dauerhaft gekappt bleiben.
const MAX_CHIPS = 100_000_000_000; // 100 Mrd., weit über jedem ehrlichen Stand
// Stunden-Bonus, sozusagen das Gehalt. Stündlich statt täglich, damit man
// schneller vorankommt (war ein Wunsch aus der Runde): ein Abend reicht für
// ein Haus, die Spiele selbst bleiben unter 100 % RTP. Die Exporte heißen aus
// Kompatibilität weiter DAILY_.
const DAILY_BONUS = 1000;                    // je Abholung (1× pro Stunde)
const DAILY_BONUS_COOLDOWN_MS = 60 * 60 * 1000; // 1h

// Serie: jede Abholung in Folge (innerhalb der Frist) gibt STREAK_STEP drauf,
// höchstens STREAK_MAX mal, also maximal +2.500.
const STREAK_STEP = 250;
const STREAK_MAX = 10;
// Frist für die Serie: mindestens einmal in ~26 h abholen. (Hing früher am
// 20-h-Cooldown und war nach der Umstellung auf stündlich nur noch 2 h lang,
// die Serie riss also jede Nacht.)
const STREAK_GRACE_HOURS = 26;

// Straßen-Tribut: jede komplette Straße gibt etwas auf jeden Stunden-Bonus.
// Die Goldene Straße der Woche zählt doppelt.
const STREET_TRIBUTE = 2000;
const STREET_TRIBUTE_CAP = 10; // höchstens 10 Straßen zahlen (max. +20.000/h)

// Haus-Miete: jedes Gebäude wirft mit dem Stunden-Bonus einen Anteil seines
// Werts ab, und darauf liegt die Grundsteuer. Beides rechnet die Stadt
// (city.mieteVon), hier wird nur abgeholt. Den alten harten Deckel bei
// hundert Häusern gibt es nicht mehr: er hat dafür gesorgt, dass Spenders
// Häuser 101 bis 232 exakt nichts brachten, während sie ihn in der
// Vermögensbremse trotzdem nach unten zogen.

// Cashback wie beim Treueprogramm echter Casinos: ein Teil der Verluste an
// Hausspielen seit der letzten Abholung kommt mit dem nächsten Bonus zurück.
// Kann nie mehr sein als tatsächlich verloren wurde, lässt sich also nicht
// farmen. Die Kirche (Trophäe) hebt beide Werte an ("Segen").
const CASHBACK_RATE = 0.10;
const CASHBACK_CAP = 25000;          // je Abholung
const CASHBACK_RATE_BLESSED = 0.15;  // Kirche
const CASHBACK_CAP_BLESSED = 50000;  // Kirche
const STREAK_GRACE_MS = STREAK_GRACE_HOURS * 60 * 60 * 1000; // Frist verpasst, Serie weg

// Pleite-Schutz: wer blank ist, soll nicht auf den Bonus warten müssen.
/*
 * Soforthilfe, der Boden, auf dem man wieder aufstehen kann.
 *
 * Sie griff unter 50 Chips und fuellte auf 150 auf. Der kleinste Einsatz im
 * Haus sind 50: das reichte fuer drei Slot-Drehungen, und danach stand man
 * wieder da. Der Stunden-Bonus allein bringt das Siebenfache.
 *
 * Jetzt so viel, dass man eine Runde spielen kann statt einer Drehung. Das
 * Bankguthaben zählt mit, sonst holt sich jemand mit 1,5 Millionen auf der
 * Bank und 1.702 Chips auf der Hand jede halbe Stunde Almosen ab.
 */
const RESCUE_THRESHOLD = 2000;     // nur, wenn Chips und Bank darunter liegen
const RESCUE_TO = 2000;            // fuellt bis hierhin auf
const RESCUE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min, deckelt das Nachfassen

// Schutz gegen Passwort-Raten. Steht am Konto (die alte Map im Speicher war
// nach jedem Deploy leer) und wird schärfer: 5 Fehlversuche = 15 min Sperre,
// jede weitere Sperre doppelt so lang (höchstens 24 h). Derselbe Zähler
// schützt auch das Passwort-Ändern, das vorher ungebremst war. failSince
// bekommt der Besitzer nach dem Login angezeigt.
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_BASE_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
const PASS_MIN_NEW = 6, PASS_MAX = 24; // neue Passwörter; alte 4-stellige PINs bleiben gültig

function secOf(acc) {
  acc.sec = acc.sec || { fails: 0, lockUntil: 0, lockCount: 0, failSince: 0 };
  return acc.sec;
}
function lockedMinutes(acc) {
  const s = secOf(acc);
  return s.lockUntil > Date.now() ? Math.ceil((s.lockUntil - Date.now()) / 60000) : 0;
}
/** Falsches Passwort. Gibt die Sperrminuten zurück, falls dieser Versuch gesperrt hat. */
function recordAuthFail(acc) {
  const s = secOf(acc);
  s.fails += 1;
  s.failSince += 1;
  if (s.fails >= LOGIN_MAX_FAILS) {
    s.fails = 0;
    s.lockCount = (s.lockCount || 0) + 1;
    const ms = Math.min(LOGIN_LOCK_MAX_MS, LOGIN_LOCK_BASE_MS * Math.pow(2, s.lockCount - 1));
    s.lockUntil = Date.now() + ms;
    save();
    return Math.ceil(ms / 60000);
  }
  save();
  return 0;
}
/** Anmeldung geklappt: Zähler zurücksetzen und sagen, wie viele Fehlversuche es seit dem letzten Erfolg gab. */
function recordAuthSuccess(acc) {
  const s = secOf(acc);
  const warn = s.failSince || 0;
  s.fails = 0; s.failSince = 0; s.lockCount = 0; s.lockUntil = 0;
  save();
  return warn;
}

let accounts = load();
startChipCapSweep(); // permanent anti-cheat chip ceiling

// Geheimnis zum Signieren der Tokens. Liegt im Datenordner, damit Tokens einen
// Deploy überleben; wird beim ersten Start erzeugt.
const SECRET = loadSecret();

function loadSecret() {
  try {
    const s = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (s) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  } catch {}
  return s;
}

// So lange gilt ein Token. Lang genug, dass ein Schul-iPad, das den Tab
// wegwirft, nie einen Login kostet, kurz genug, dass ein vergessenes Token auf
// einem fremden Gerät irgendwann stirbt. Jedes Resume stellt ein neues aus,
// wer spielt, schiebt die Frist also immer weiter.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Signiertes Token für einen Kontonamen ausstellen, ohne Zustand auf dem Server. */
function issueToken(name) {
  const payload = `${normalizeName(name)}|${Date.now()}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64") + "." + sig;
}

/**
 * Der Kontoname aus einem Token, ohne zu pruefen, ob das Konto gerade spielen
 * darf. Nur fuer Fehlermeldungen: wer wegen einer Zeitsperre nicht reinkommt,
 * soll das lesen und nicht "Sitzung abgelaufen".
 */
function _keyRoh(token) {
  return verifyToken(token, { ohneStrafe: true });
}

/** Text fuer eine Zeitsperre, mit Restzeit und Grund. */
function sperrText(s) {
  return `Du bist gesperrt (${strafen.restText(s)})${s.grund ? `: ${s.grund}` : "."}`;
}

/**
 * Token prüfen. Gibt den normalisierten Kontonamen zurück, oder null, wenn das
 * Token fehlt, kaputt oder gefälscht ist, das Konto nicht mehr existiert oder
 * eine Zeitsperre laeuft.
 */
function verifyToken(token, { ohneStrafe = false } = {}) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  let payload;
  try {
    payload = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig || "", "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  const [roh, issuedAt] = payload.split("|");
  // Alte Tokens tragen noch den Anzeigenamen; kanonisch() faengt beides ab.
  const key = kanonisch(roh);
  if (!key || accounts[key].banned) return null;
  // Eine laufende Zeitsperre gilt auch fuer ein gueltiges Token, sonst kaeme
  // jeder mit gespeicherter Sitzung weiter rein.
  if (!ohneStrafe && strafen.aktiv(accounts[key], "sperre")) return null;
  // Die Signatur allein reicht nicht, das Token muss auch frisch sein. Ohne das
  // war der Zeitstempel darin nur Deko und Tokens galten ewig.
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > TOKEN_TTL_MS) return null;
  return key;
}

/**
 * Sitzung aus einem gespeicherten Token fortsetzen. Gleicher Nachweis wie beim
 * Login, nur ohne Passwort. Gibt ein neues Token zurück, damit niemand beim
 * Weiterspielen an die Ablaufzeit stößt.
 */
function resumeSession(token) {
  const key = verifyToken(token);
  if (!key) {
    const roh = _keyRoh(token);
    const gesperrt = roh && accounts[roh] && strafen.aktiv(accounts[roh], "sperre");
    if (gesperrt) return { ok: false, error: sperrText(gesperrt) };
    return { ok: false, error: "Sitzung abgelaufen." };
  }
  const acc = accounts[key];
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.lastSeen = Date.now();
  return { ok: true, account: publicAccount(acc), token: issueToken(key) };
}

/*
 * Konten laden.
 *
 * Die alte Fassung fing jeden Fehler ab und gab ein leeres Objekt zurueck.
 * Fehlt die Datei, ist das richtig: frisches Haus. Ist sie aber da und laesst
 * sich nicht lesen, waeren damit alle Konten weg, und der naechste save()
 * haette die kaputte Datei mit dem leeren Stand ueberschrieben. Aus einem
 * Lesefehler waere so ein endgueltiger Datenverlust geworden.
 *
 * Aufgefallen ist das, weil eine spaeter ergaenzte Aufraeumfunktion hier eine
 * Konstante benutzte, die zu diesem Zeitpunkt noch nicht existierte: der
 * Fehler verschwand still im catch, und das Haus startete mit null Konten.
 */
function load() {
  let roh;
  try {
    roh = fs.readFileSync(ACCOUNTS_FILE, "utf8");
  } catch {
    return {};   // noch keine Datei: neues Haus
  }
  try {
    return raeumeStatistik(JSON.parse(roh));
  } catch (e) {
    console.error("[accounts] accounts.json ist vorhanden, aber unlesbar:", e.message);
    console.error("[accounts] Start abgebrochen, damit der Stand nicht ueberschrieben wird.");
    process.exit(1);
  }
}

/*
 * Einmalige Bereinigung kaputter Spielstatistiken.
 *
 * In einem Konto stand bei Poker ein Netto von 5,07 Milliarden und bei Slots
 * 274 Millionen. Im ganzen Haus sind keine zehn Millionen Chips im Umlauf, und
 * eine Pokerhand ist durch den Einkaufsdeckel von 100.000 je Platz nach oben
 * begrenzt: ueber 127 Haende liegt das rechnerische Maximum bei rund 114
 * Millionen. Der Wert war also vierzigmal hoeher als ueberhaupt moeglich.
 *
 * Die Ursache liegt in der Zeit, als es Poker-Bots gab, deren Stapel das Haus
 * bezahlt hat (siehe game/tableManager.js). Die Bots sind lange raus, die Zahl
 * stand aber weiter im Statistik-Bildschirm und hat die ganze Seite entwertet.
 *
 * Geloescht wird nur der Geldwert. Runden und Siege bleiben stehen: die sind
 * glaubwuerdig, und "127 Haende, 73 gewonnen" ist mehr wert als gar nichts.
 */
function raeumeStatistik(roh) {
  /* Steht bewusst in der Funktion: als const weiter unten waere sie beim
     Aufruf aus load() heraus noch nicht initialisiert gewesen. */
  const STAT_UNMOEGLICH = 50_000_000;
  let bereinigt = 0;
  for (const acc of Object.values(roh || {})) {
    const pg = acc && acc.stats && acc.stats.perGame;
    if (!pg) continue;
    for (const eintrag of Object.values(pg)) {
      if (eintrag && Math.abs(Number(eintrag.net) || 0) > STAT_UNMOEGLICH) {
        eintrag.net = 0;
        bereinigt++;
      }
    }
  }
  if (bereinigt) console.log(`[accounts] ${bereinigt} unmoegliche Spielstatistik(en) auf 0 gesetzt.`);
  return roh;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

/* Strafen haengen am Konto, gespeichert wird hier. Das Strafen-Modul darf
   accounts nicht selbst holen (Kreis beim require), deshalb bekommt es die
   Speicherfunktion gereicht. */
strafen.setSpeichern(save);


// Läuft immer: alle paar Minuten jedes Konto über der Obergrenze kappen
// (fängt direkte Buchungen wie den Rake ab und räumt alte ausgenutzte Stände
// auch bei Spielern auf, die gerade offline sind).
function startChipCapSweep() {
  setInterval(() => {
    let changed = false;
    for (const acc of Object.values(accounts)) {
      if (acc && typeof acc.chips === "number" && acc.chips > MAX_CHIPS) { acc.chips = MAX_CHIPS; changed = true; }
    }
    if (changed) save();
  }, 3 * 60 * 1000).unref();
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

/* Umbenennen

   Ein Konto haengt an seinem Namen: der normalisierte Name ist der
   Schluessel, und dieser Schluessel steht als Besitzer an Grundstuecken, als
   Mitglied in Clans, an Pferden, Wetten, Geboten, Aktien und Rekorden. Wer
   den Schluessel aendert, muesste all das mit umziehen, und was dabei
   vergessen wird, gehoert danach niemandem mehr.

   Deshalb bleibt der Schluessel, wo er ist, und nur der angezeigte Name
   aendert sich (`acc.name`). Damit bleibt jede Verknuepfung heil.

   Zwei Dinge braucht es dafuer. Erstens muss man das Konto auch unter dem
   neuen Namen finden: dafuer gibt es den Alias-Index, und er ist der Grund,
   warum sich der alte Name weiter anmelden kann, wie gewuenscht. Zweitens
   muessen die Stellen nachgezogen werden, die den Namen als Kopie gespeichert
   haben (Stadt, Auktion, Rekorde, Chronik, Feed), sonst stuende der alte
   Name genau dort weiter, wo ihn alle sehen. */
const aliase = new Map();   // je normalisiertem Namen: Schluessel des Kontos

/*
 * Jedes Konto weiss, unter welchem Schluessel es liegt.
 *
 * Aus dem Anzeigenamen laesst sich der Schluessel nach einer Umbenennung
 * nicht mehr ableiten, und genau das haben ein Dutzend Stellen getan
 * (`normalizeName(acc.name)`), um in Stadt, Clan oder Depot nachzusehen. Die
 * haetten danach beim falschen Menschen nachgeschlagen und nichts gefunden.
 *
 * Nicht aufzaehlbar, damit der Schluessel nicht in der gespeicherten Datei
 * landet: dort ist er schon, er ist der Feldname.
 */
function merkeSchluessel(acc, key) {
  Object.defineProperty(acc, "_key", { value: key, enumerable: false, writable: true, configurable: true });
}
const schluesselVon = (acc) => (acc && acc._key) || normalizeName(acc && acc.name);

function baueAliasIndex() {
  aliase.clear();
  for (const [key, acc] of Object.entries(accounts)) {
    if (!acc) continue;
    merkeSchluessel(acc, key);
    const jetzt = normalizeName(acc.name);
    if (jetzt && jetzt !== key) aliase.set(jetzt, key);
    for (const alt of acc.fruehereNamen || []) {
      const n = normalizeName(alt);
      if (n && n !== key) aliase.set(n, key);
    }
  }
}

function get(name) {
  const n = normalizeName(name);
  if (accounts[n]) return accounts[n];
  const key = aliase.get(n);
  return (key && accounts[key]) || null;
}

/**
 * Der echte Schluessel zu einem Namen, egal ob jemand den aktuellen, einen
 * frueheren oder gar keinen erwischt hat. null, wenn es das Konto nicht gibt.
 *
 * Das ist die wichtigste Funktion an der ganzen Umbenennung. Alles, was einen
 * Besitzer speichert (Stadt, Clan, Pferd, Aktie), speichert den Schluessel.
 * Gaebe ein Login unter dem neuen Namen einen anderen Schluessel zurueck als
 * ein Login unter dem alten, haette derselbe Mensch zwei Identitaeten, und
 * seine Haeuser gehoerten der einen und seine Chips der anderen.
 */
function kanonisch(name) {
  const n = normalizeName(name);
  if (accounts[n]) return n;
  const k = aliase.get(n);
  return k && accounts[k] ? k : null;
}

/** Ist dieser Name schon vergeben (als Schluessel, aktueller Name oder Alias)? */
function nameVergeben(name) {
  const n = normalizeName(name);
  return !!(accounts[n] || aliase.get(n));
}

const NAME_WECHSEL_MS = 30 * 24 * 60 * 60 * 1000;   // Spieler: einmal im Monat

/**
 * Anzeigenamen aendern. Der alte Name fuehrt weiter zum Konto (Anmeldung,
 * Ueberweisung, Suche), er ist nur nirgends mehr zu sehen.
 *
 * @param {string} wer        aktueller oder frueherer Name.
 * @param {string} neu        gewuenschter Name.
 * @param {object} o
 * @param {boolean} o.vonAdmin  Admin: ohne Wartezeit und ohne Wortfilter-Veto.
 */
function rename(wer, neu, { vonAdmin = false } = {}) {
  const acc = get(wer);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  const key = kanonisch(wer);
  const alt = acc.name;

  neu = String(neu || "").trim().replace(/\s+/g, " ");
  if (neu.length < 2 || neu.length > 16) return { ok: false, error: "Name muss 2 bis 16 Zeichen lang sein." };
  if (normalizeName(neu) === normalizeName(alt)) return { ok: false, error: "Das ist schon sein Name." };

  /* Vergeben heisst auch: frueher mal vergeben. Sonst nimmt jemand den
     abgelegten Namen an und bekommt dessen Anmeldungen ab. */
  const belegt = accounts[normalizeName(neu)] || (aliase.get(normalizeName(neu)) && accounts[aliase.get(normalizeName(neu))]);
  if (belegt && belegt !== acc) return { ok: false, error: "Diesen Namen gibt es schon." };

  if (!vonAdmin) {
    const wf = require("./wortfilter").pruefe(neu, "Der Name");
    if (!wf.ok) return { ok: false, error: "Dieser Name geht hier nicht. Such dir einen anderen aus." };
    const seit = Date.now() - (acc.nameGeaendertAm || 0);
    if (acc.nameGeaendertAm && seit < NAME_WECHSEL_MS) {
      const tage = Math.ceil((NAME_WECHSEL_MS - seit) / 864e5);
      return { ok: false, error: `Einmal im Monat. Noch ${tage} ${tage === 1 ? "Tag" : "Tage"}.` };
    }
  }

  acc.fruehereNamen = Array.isArray(acc.fruehereNamen) ? acc.fruehereNamen : [];
  if (!acc.fruehereNamen.some((n) => normalizeName(n) === normalizeName(alt))) acc.fruehereNamen.push(alt);
  acc.name = neu;
  /* Die Wartezeit gehoert dem Spieler. Benennt der Admin jemanden um (weil
     der Name aus dem Schaufenster soll), soll der Betroffene sich danach
     trotzdem noch selbst einen aussuchen duerfen: sonst bestraft ihn die
     Sperrfrist fuer etwas, das er gar nicht getan hat. */
  if (!vonAdmin) acc.nameGeaendertAm = Date.now();
  baueAliasIndex();
  save();

  /* Die Kopien nachziehen. Jede einzeln abgesichert: wenn ein Modul nicht
     bereit ist, soll die Umbenennung trotzdem gelten und nicht auf halber
     Strecke haengenbleiben. */
  const nachgezogen = {};
  for (const [modul, fn] of [
    ["city", (m) => m.umbenennen(key, alt, neu)],
    ["auktion", (m) => m.umbenennen(key, alt, neu)],
    ["stocks", (m) => m.umbenennen(key, alt, neu)],
    ["records", (m) => m.umbenennen(key, alt, neu)],
    ["chronik", (m) => m.umbenennen(alt, neu)],
    ["feed", (m) => m.umbenennen(alt, neu)],
    // Die Praegung haelt Erstbesitzer und Besitzerkette als Namenskopie: der
    // Verlauf soll Jahre spaeter lesbar sein, auch wenn es das Konto nicht
    // mehr gibt. Genau deshalb muss er hier mit.
    ["praegung", (m) => m.umbenennen(key, alt, neu)],
    ["ruhm", (m) => m.umbenennen(key, alt, neu)],
    ["kistenDuell", (m) => m.umbenennen(key, alt, neu)],
    // Ein versetztes Duell wartet bis zu 48 Stunden auf seinen Gegner und
    // traegt beide Namen als Kopie. Ohne diese Zeile steht der alte Name
    // genau dort weiter, wo der Gegner ihn als Naechstes liest.
    ["asyncDuell", (m) => m.umbenennen(key, alt, neu)],
    // Der Verkäufername steht als Kopie am Angebot, damit die Marktliste
    // ohne Kontozugriff lesbar ist.
    ["market", (m) => m.umbenennen(key, alt, neu)],
  ]) {
    try { nachgezogen[modul] = fn(require(`./${modul}`)) || 0; } catch { nachgezogen[modul] = "?"; }
  }

  return { ok: true, alt, neu, key, nachgezogen, account: publicAccount(acc) };
}

// Vermögen = Chips plus alles, was man in der Stadt besitzt.
const city = require("./city");
const stocks = require("./stocks");

/**
 * Was jemand insgesamt hat. Nur zum Anzeigen.
 *
 * Das Bankguthaben fehlte hier. Bei einem Konto mit 1.702 Chips auf der Hand
 * und 1,5 Millionen auf der Bank stand als Vermögen nur der Immobilienwert,
 * und der Spieler galt als arm.
 */
function _netWorth(acc) {
  const key = schluesselVon(acc);
  return (acc.chips || 0) + _bank(acc) + city.ownerValue(key) + stocks.portfolioValue(key);
}

const _bank = (acc) => Math.floor((acc && acc.savings && acc.savings.amount) || 0);

/*
 * Womit die Vermoegensbremse rechnet. Ausdrücklich nicht
 * dasselbe wie das angezeigte Vermoegen.
 *
 * Vorher zaehlten Immobilien voll und die Bank gar nicht. Damit traf die
 * Bremse genau die Falschen: wer seine Chips in Gebaeude gesteckt hatte, galt
 * als reich und bekam ein Viertel, obwohl er nichts mehr zum Spielen hatte.
 * Im Spielstand vom 10.9. stand Spender bei 25 Prozent mit 10.062 Chips und
 * CharlieEpstein bei 38 Prozent mit 814, waehrend jemand mit 780.000 Chips
 * bar auf der Hand bei 96 Prozent lief.
 *
 * Jetzt zaehlt, was man ausgeben kann: Chips und Bank voll, Aktien voll (die
 * lassen sich sofort verkaufen), Immobilien zu einem Viertel. Ein Gebaeude ist
 * Vermoegen, aber keins, mit dem man an den Tisch geht, und der Tribut, den
 * es abwirft, ist genau die Einnahme, die die Bremse sonst wegkuerzt.
 */
const IMMOBILIEN_GEWICHT = 0.25;
function _bremsWert(acc) {
  const key = schluesselVon(acc);
  return (acc.chips || 0) + _bank(acc) + stocks.portfolioValue(key)
    + city.ownerValue(key) * IMMOBILIEN_GEWICHT;
}

// Gegen Inflation: garantierte Gratis-Einnahmen (Stunden-Bonus, Aufträge,
// Kalender) gibt es voll, solange man noch aufbaut, danach werden sie für die
// Reichen weniger. Sonst prägen Milliardäre weiter Gratis-Chips, mit denen sie
// nichts mehr anfangen. Wer unter FAUCET_FULL liegt, merkt davon nichts.
/*
 * Die Schwellen stammten aus einer Wirtschaft, die es nie gab: die Bremse
 * begann bei zehn Millionen Vermoegen und wirkte voll erst bei einer
 * Milliarde. Im echten Spielstand liegt das groesste Vermoegen bei 5,7
 * Millionen. Die Bremse griff damit bei exakt niemandem, und alle
 * Gratis-Einnahmen liefen bei jedem zu hundert Prozent.
 *
 * Neu gemessen am tatsaechlichen Spielstand: mittleres Vermoegen 25.000,
 * neunzigstes Perzentil 210.000, Spitze 5,7 Millionen. Unter einer Million
 * aendert sich damit fuer rund sechzig der einundsiebzig Konten gar nichts;
 * gebremst werden nur die, die ohnehin vorne liegen.
 */
const FAUCET_FULL = 1_000_000;       // bis 1 Mio Vermögen 100 %
const FAUCET_MIN_NW = 6_000_000;     // ab 6 Mio Vermögen FAUCET_FLOOR
const FAUCET_FLOOR = 0.25;
function faucetFactor(name) {
  const acc = get(name);
  if (!acc) return 1;
  const nw = _bremsWert(acc);
  if (nw <= FAUCET_FULL) return 1;
  if (nw >= FAUCET_MIN_NW) return FAUCET_FLOOR;
  const t = (nw - FAUCET_FULL) / (FAUCET_MIN_NW - FAUCET_FULL);
  return 1 - (1 - FAUCET_FLOOR) * t;
}

// Spieler-Level / XP
// XP gibt es fürs Spielen, nicht fürs Reichsein. Der Rang zeigt Erfahrung.
// Level L braucht insgesamt 100·(L-1)² XP, also level = floor(√(xp/100)) + 1.
const XP_PER_HAND = 8;   // je abgerechneter Hand …
const XP_PER_WIN = 4;    // … und das bei einem Sieg dazu
const levelFromXp = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
const xpForLevel = (L) => 100 * (L - 1) * (L - 1);

/*
 * Rangstufen. `rang` ist die Kennung, aus der der Client seine gezeichnete
 * Stufe holt; `emoji` bleibt fuer die Stellen, an denen nur Text durchgeht
 * (Push-Nachricht, Chat-Ansage). Farben und Titel wie gehabt.
 */
const LEVEL_TIERS = [
  { min: 50, title: "Casino-Ikone", rang: "ikone",     emoji: "👑", color: "#f4d782" },
  { min: 35, title: "Legende",      rang: "legende",   emoji: "🌟", color: "#c86bd6" },
  { min: 20, title: "Hai",          rang: "hai",       emoji: "🦈", color: "#5ea8e0" },
  { min: 10, title: "Profi",        rang: "profi",     emoji: "🎯", color: "#66c07a" },
  { min: 5,  title: "Stammgast",    rang: "stammgast", emoji: "🎲", color: "#d1a35e" },
  { min: 1,  title: "Neuling",      rang: "neuling",   emoji: "🌱", color: "#8ea0a8" },
];
const tierFor = (lvl) => LEVEL_TIERS.find((t) => lvl >= t.min) || LEVEL_TIERS[LEVEL_TIERS.length - 1];

function levelInfo(acc) {
  const xp = acc.xp || 0;
  const level = levelFromXp(xp);
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  const t = tierFor(level);
  return {
    level, xp, title: t.title, rang: t.rang, emoji: t.emoji, color: t.color,
    xpInLevel: xp - cur, xpForNext: next - cur,
  };
}

function addXp(name, amount) {
  const acc = get(name);
  if (!acc) return null;
  const xp = Math.max(0, Math.floor(Number(amount) || 0));
  if (!xp) return publicAccount(acc);
  const lvlBefore = levelFromXp(acc.xp || 0);
  acc.xp = (acc.xp || 0) + xp;
  const lvlAfter = levelFromXp(acc.xp);
  if (lvlAfter > lvlBefore) acc._justLeveled = lvlAfter;
  save();
  return publicAccount(acc);
}

// Boni (aus Firmenprodukten)
/** Aktive Boni eines Kontos, abgelaufene fliegen raus. { type: {until, mult} } */
function activeBuffs(acc) {
  if (!acc || !acc.buffs) return {};
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(acc.buffs)) {
    if (acc.buffs[k].until <= now) { delete acc.buffs[k]; changed = true; }
  }
  if (changed) save();
  return acc.buffs;
}

function grantBuff(name, type, mins, mult) {
  const acc = get(name);
  if (!acc) return;
  acc.buffs = acc.buffs || {};
  const until = Date.now() + mins * 60000;
  // Verlängern: der stärkere Faktor und das spätere Ende gewinnen.
  const cur = acc.buffs[type];
  acc.buffs[type] = { until: Math.max(until, cur ? cur.until : 0), mult: Math.max(mult || 1, cur ? cur.mult || 1 : 1) };
  save();
}

/** Faktor für einen alten zeitlichen Bonus (1, wenn keiner läuft). Besitz gibt
 *  keine Boni mehr, die Vorteile in der Stadt kommen von den Trophäen-Gebäuden
 *  (city.hasTrophy) und werden direkt dort eingerechnet, wo sie wirken. */
function buffMult(name, type) {
  const acc = get(name);
  const b = acc && acc.buffs && acc.buffs[type];
  return b && b.until > Date.now() ? (b.mult || 1) : 1;
}
/** Ob ein (alter, zeitlicher) Bonus gerade läuft. */
function hasBuff(name, type) {
  return buffMult(name, type) > 1;
}

// Inventar (Produkte zum Benutzen oder Weiterverkaufen)
function getInventory(name) {
  const acc = get(name);
  return (acc && acc.inventory) || {};
}
function addItem(name, key, n = 1) {
  const acc = get(name);
  if (!acc) return;
  acc.inventory = acc.inventory || {};
  acc.inventory[key] = (acc.inventory[key] || 0) + n;
  save();
}
function removeItem(name, key, n = 1) {
  const acc = get(name);
  if (!acc || !acc.inventory || (acc.inventory[key] || 0) < n) return false;
  acc.inventory[key] -= n;
  if (acc.inventory[key] <= 0) delete acc.inventory[key];
  save();
  return true;
}

function publicAccount(acc) {
  if (!acc) return null;
  return {
    name: acc.name,
    rolle: acc.rolle === "mod" ? "mod" : null,
    chips: acc.chips,
    createdAt: acc.createdAt,
    lastBonusAt: acc.lastBonusAt,
    bonusStreak: acc.bonusStreak || 0,
    stats: acc.stats,
    horseWins: acc.horseWins || 0,
    horsePodiums: acc.horsePodiums || 0,
    unlocked: acc.unlocked || ["lucky7"],
    netWorth: _netWorth(acc),
    buffs: acc.buffs ? activeBuffs(acc) : {},
    residence: acc.residence != null ? { id: acc.residence, ...city.bldInfo(acc.residence) } : null,
    level: levelInfo(acc),
    // Aussehen (Bild, Namensstil, Rahmen, Titel) kommt gesammelt aus der
    // Kosmetik, damit alle Anzeigestellen dieselbe Quelle haben.
    ...require("./cosmetics").publicLook(acc),
    prefs: require("./prefs").get(acc),
    lastSeen: acc.lastSeen || null,
  };
}

/**
 * Merkt, wann jemand zuletzt da war.
 *
 * Bis jetzt hat das niemand aufgeschrieben, man konnte nicht sehen, wer heute
 * schon gespielt hat oder wer seit Wochen weg ist. Fuer eine Freundesrunde ist
 * das die naheliegendste Information ueberhaupt.
 *
 * Wird beim Anmelden und bei jeder gewerteten Runde aufgefrischt, aber
 * hoechstens einmal pro Minute geschrieben: sonst schreibt jede Slot-Drehung
 * die Datei neu.
 */
const SEEN_MIN_ABSTAND = 60 * 1000;
function touchSeen(name) {
  const acc = get(name);
  if (!acc) return;
  const now = Date.now();
  if (acc.lastSeen && now - acc.lastSeen < SEEN_MIN_ABSTAND) return;
  acc.lastSeen = now;
}

function bonusAvailable(acc) {
  return Date.now() - (acc.lastBonusAt || 0) >= DAILY_BONUS_COOLDOWN_MS;
}

/** Anlegen oder anmelden. Gibt { ok, created, account, token } oder { ok:false, error } zurück. */
function login(name, pin) {
  name = String(name || "").trim();
  pin = String(pin || "").trim();
  /* Nicht der getippte Name, sondern der Schluessel dahinter: wer sich mit
     einem frueheren Namen anmeldet, landet in seinem Konto und nicht in einem
     frisch angelegten zweiten. */
  const key = kanonisch(name) || normalizeName(name);

  if (!key || name.length < 2 || name.length > 16) {
    return { ok: false, error: "Name muss 2 bis 16 Zeichen lang sein." };
  }
  /* Nur bei neuen Konten. Wer schon da ist, behält seinen Namen, sonst
     sperrt eine spaeter ergaenzte Wortliste jemanden aus seinem eigenen
     Account aus. Bestehende Namen listet der Admin-Bildschirm auf. */
  if (!accounts[key]) {
    const wf = require("./wortfilter").pruefe(name, "Der Name");
    if (!wf.ok) return { ok: false, error: "Dieser Name geht hier nicht. Such dir einen anderen aus." };
  }
  if (pin.length < 4 || pin.length > PASS_MAX) {
    return { ok: false, error: `Passwort muss 4 bis ${PASS_MAX} Zeichen haben.` };
  }

  let acc = accounts[key];
  if (!acc) {
    // Neue Accounts brauchen ein richtiges Passwort, die Namen sind öffentlich
    // (Bestenliste), eine 4-stellige PIN wäre in Tagen durchprobiert.
    if (pin.length < PASS_MIN_NEW) {
      return { ok: false, error: `Neues Konto: Passwort braucht mindestens ${PASS_MIN_NEW} Zeichen (gern Wörter statt Zahlen).` };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    acc = {
      name,
      salt,
      pinHash: hashPin(pin, salt),
      chips: STARTING_CHIPS,
      createdAt: Date.now(),
      lastBonusAt: 0,
      stats: { gamesPlayed: 0, handsWon: 0, biggestWin: 0 },
      unlocked: ["lucky7"],
      /* Nur neue Konten bekommen den Starter-Pass. Alte Konten sollen nach
         einem Update nicht ploetzlich wieder als Anfaenger begruesst werden. */
      onboarding: { startedAt: Date.now(), steps: {}, claimedAt: 0 },
    };
    accounts[key] = acc;
    merkeSchluessel(acc, key);
    save();
    return { ok: true, created: true, account: publicAccount(acc), token: issueToken(key) };
  }

  if (acc.banned) return { ok: false, error: "Dein Account wurde gesperrt." };
  const zeitsperre = strafen.aktiv(acc, "sperre");
  if (zeitsperre) return { ok: false, error: sperrText(zeitsperre) };
  const lockMin = lockedMinutes(acc);
  if (lockMin) return { ok: false, error: `Zu viele Fehlversuche. Account für ${lockMin} Min gesperrt.` };
  if (acc.pinHash !== hashPin(pin, acc.salt)) {
    const lockedFor = recordAuthFail(acc);
    if (lockedFor) return { ok: false, error: `Zu viele Fehlversuche. Account für ${lockedFor} Min gesperrt.` };
    return { ok: false, error: "Falsches Passwort für diesen Namen." };
  }
  const warnFails = recordAuthSuccess(acc);
  acc.lastSeen = Date.now();
  /* Das Token traegt den Schluessel, nicht den Anzeigenamen. Nach einer
     Umbenennung wuerde ein Token auf den neuen Namen sonst ins Leere zeigen. */
  return { ok: true, created: false, account: publicAccount(acc), token: issueToken(key), warnFails };
}

/** Stunden-Bonus abholen. Gibt { ok, amount, streak, account } oder { ok:false, error, msLeft } zurück. */
function claimDailyBonus(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  const ohne = strafen.aktiv(acc, "keinBonus");
  if (ohne) return { ok: false, error: geschenkText(ohne) };
  if (!bonusAvailable(acc)) {
    return {
      ok: false,
      error: "Bonus noch nicht verfügbar.",
      msLeft: DAILY_BONUS_COOLDOWN_MS - (Date.now() - acc.lastBonusAt),
    };
  }
  const now = Date.now();
  const key = schluesselVon(acc);
  // Schulleiter (Trophäe): Bildung bleibt. Die Serie verfällt nie und jeder
  // Schritt zählt doppelt.
  const schule = city.hasTrophy(key, "schule");
  const onTime = schule || (acc.lastBonusAt && now - acc.lastBonusAt <= STREAK_GRACE_MS);
  acc.bonusStreak = onTime ? (acc.bonusStreak || 1) + 1 : 1;
  const streakBonus = Math.min(acc.bonusStreak - 1, STREAK_MAX) * STREAK_STEP * (schule ? 2 : 1);
  // Bahnhofs-Baron (Trophäe): Pendler bringen Geld, Stunden-Bonus ×1,5.
  const pendler = city.hasTrophy(key, "bahnhof") ? 1.5 : 1;
  const base = Math.round((DAILY_BONUS + streakBonus) * pendler);
  // Straßen-Tribut: komplette Straßen zahlen, wenn man vorbeikommt. Die
  // Goldene Straße der Woche zahlt doppelt.
  const streets = Math.min(city.streetCount(key), STREET_TRIBUTE_CAP);
  const golden = city.ownsGolden(key) ? STREET_TRIBUTE : 0;
  const tribute = streets * STREET_TRIBUTE + golden;
  // Haus-Miete abzüglich Grundsteuer, beides aus der Stadt.
  const stadt = city.mieteVon(key);
  const housesOwned = stadt.haeuser;
  // Sammel-Sets (Stadtbekannt, Kaffee-Kartell …).
  const setList = city.setsOf(key);
  const sets = setList.reduce((s, x) => s + x.tribute, 0);
  // Cashback seit der letzten Abholung, wer den Segen der Kirche hat, bekommt mehr.
  const blessed = city.hasTrophy(key, "kirche");
  const cashback = Math.min(
    blessed ? CASHBACK_CAP_BLESSED : CASHBACK_CAP,
    Math.floor((acc.lossSince || 0) * (blessed ? CASHBACK_RATE_BLESSED : CASHBACK_RATE))
  );
  acc.lossSince = 0;
  // Bremse für die Reichen (ohne Cashback, das ist durch die eigenen Verluste
  // begrenzt und kein Gratisgeld).
  /*
   * Die Bremse trifft das geschenkte Geld, nicht die Rendite.
   *
   * Grundbetrag, Serie, Straßen-Tribut und Sets sind Gratis-Einnahmen und
   * werden weiter gebremst. Die Haus-Miete nicht: dafür hat jemand Chips
   * ausgegeben, und die Grundsteuer bremst sie bereits selbst. Vorher lief
   * beides zusammen, und damit stand Vincent mit 86 Häusern bei einem
   * Viertel seiner eigenen Mieteinnahmen, während ein Konto ohne einen
   * einzigen Stein den vollen Satz bekam. Das war genau die Stelle, an der
   * sich Spielen wie eine Strafe anfühlte.
   */
  const f = faucetFactor(acc.name);
  const tBase = Math.round(base * f), tTribute = Math.round(tribute * f);
  const tHouses = stadt.netto, tSets = Math.round(sets * f);
  const amount = tBase + tTribute + tHouses + tSets + cashback;
  acc.chips += amount;
  acc.lastBonusAt = now;
  save();
  return {
    ok: true, amount, base: tBase, tribute: tTribute, streets, golden,
    houses: tHouses, housesOwned, stadt, sets: tSets, setList, cashback,
    streak: acc.bonusStreak, taper: Math.round(f * 100), account: publicAccount(acc),
  };
}

/**
 * Pleite-Schutz: einen fast leeren Stand wieder auffüllen, damit man
 * weiterspielen kann statt auf den Bonus zu warten. Mit Wartezeit gegen
 * Ausnutzen. Gibt { ok, amount, account } oder { ok:false, error, msLeft } zurück.
 */
function rescue(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  const ohne = strafen.aktiv(acc, "keinBonus");
  if (ohne) return { ok: false, error: geschenkText(ohne) };
  if (acc.chips + _bank(acc) >= RESCUE_THRESHOLD)
    return { ok: false, error: "Du hast noch genug Chips." };
  // Kirche (Trophäe): Segen, doppelte Hilfe, halbe Wartezeit.
  const blessed = city.hasTrophy(schluesselVon(acc), "kirche");
  const cooldown = blessed ? RESCUE_COOLDOWN_MS / 2 : RESCUE_COOLDOWN_MS;
  const since = Date.now() - (acc.lastRescueAt || 0);
  if (since < cooldown)
    return { ok: false, error: "Soforthilfe gerade erst genutzt.", msLeft: cooldown - since };
  const target = Math.round(RESCUE_TO * (blessed ? 2 : 1));
  const amount = target - acc.chips;
  acc.chips = target;
  acc.lastRescueAt = Date.now();
  save();
  return { ok: true, amount, account: publicAccount(acc) };
}

/**
 * `delta` Chips auf ein Konto buchen (negativ zum Abziehen, z. B. Buy-in).
 * Gibt { ok, account } oder { ok:false, error } zurück. Nie unter 0.
 */
function adjustChips(name, delta) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  /* Hier laeuft JEDE Chip-Bewegung durch, also steht hier auch die letzte
     Sperre. Ohne sie reicht ein einziger Aufrufer, der eine Zahl nicht
     prueft: `chips + NaN < 0` ist falsch, die Pruefung darueber laesst es
     durch, und danach ist der Kontostand NaN — dauerhaft, denn jede
     weitere Rechnung darauf bleibt NaN. Alle heutigen Aufrufer rechnen
     sauber; die Zeile ist fuer den naechsten. */
  if (!Number.isFinite(delta)) return { ok: false, error: "Ungültiger Betrag." };
  if (acc.chips + delta < 0) return { ok: false, error: "Nicht genug Chips." };
  acc.chips += delta;
  if (acc.chips > MAX_CHIPS) acc.chips = MAX_CHIPS; // Obergrenze gegen Cheats
  save();
  return { ok: true, account: publicAccount(acc) };
}

const CASINO_RAKE = 0.05; // 5 % der Verluste an Hausspielen gehen an den Casino-Besitzer

/**
 * Ergebnis einer Runde für die Statistik verbuchen (winnings = Netto dieser
 * Runde). Bei Hausspielen (Slots, Roulette, Blackjack, `house` true) gehen 5 %
 * jedes Verlusts an den, dem in der Stadt das Casino gehört. Spiele gegen
 * andere Spieler (Poker, PvP-Slots) übergeben house=false und bleiben
 * Nullsummenspiele.
 */
// Wird nach jeder verbuchten Runde aufgerufen (Achievements usw.). Anmeldung
// über onHand(), sonst gibt es einen Kreis beim require.
const handListeners = [];
const onHand = (cb) => handListeners.push(cb);

function recordHand(name, winnings, house = true, game = null, meta = null) {
  const acc = get(name);
  if (!acc) return;
  touchSeen(name);
  acc.stats = acc.stats || { gamesPlayed: 0, handsWon: 0, biggestWin: 0, biggestLoss: 0 };
  if (acc.stats.biggestLoss === undefined) acc.stats.biggestLoss = 0;
  acc.stats.gamesPlayed += 1;
  acc.weeklyNet = (acc.weeklyNet || 0) + winnings; // Spieler-der-Woche race (weekly.js resets)
  // XP fürs Spielen (Aufstieg heißt Erfahrung, nicht Reichtum).
  const lvlBefore = levelFromXp(acc.xp || 0);
  acc.xp = (acc.xp || 0) + XP_PER_HAND + (winnings > 0 ? XP_PER_WIN : 0);
  const lvlAfter = levelFromXp(acc.xp);
  if (lvlAfter > lvlBefore) acc._justLeveled = lvlAfter; // holt setupLevel ab
  // Aufschlüsselung je Spiel (Runden, Siege, Netto) für die Statistik.
  if (game) {
    acc.stats.perGame = acc.stats.perGame || {};
    const g = acc.stats.perGame[game] || (acc.stats.perGame[game] = { plays: 0, wins: 0, net: 0 });
    g.plays += 1; g.net += winnings; if (winnings > 0) g.wins += 1;
  }
  if (winnings > 0) {
    acc.stats.handsWon += 1;
    if (winnings > acc.stats.biggestWin) acc.stats.biggestWin = winnings;
  } else if (winnings < 0) {
    const loss = -winnings;
    if (loss > acc.stats.biggestLoss) acc.stats.biggestLoss = loss;
    if (house) {
      acc.lossSince = (acc.lossSince || 0) + loss; // daraus wird das Cashback
      // Hausvorteil für den Casino-Besitzer: ein Teil des Verlusts wird sein Einkommen.
      const owner = city.casinoOwner();
      if (owner && owner !== normalizeName(name)) {
        const rake = Math.floor(loss * CASINO_RAKE);
        const o = accounts[owner];
        if (rake > 0 && o) o.chips += rake; // save() weiter unten speichert es
      }
    }
  }
  save();
  for (const cb of handListeners) { try { cb(name, winnings, house, game, meta); } catch {} }
}

const LEADERBOARD_CATS = {
  rich:    { sort: (a) => a.chips,                    label: "Reichste", icon: "chip" },
  level:   { sort: (a) => levelFromXp(a.xp || 0),      label: "Höchstes Level", icon: "level" },
  week:    { sort: (a) => a.weeklyNet || 0,           label: "Spieler der Woche", icon: "season" },
  estate:  { sort: (a) => city.ownerValue(schluesselVon(a)), label: "Immobilien-Mogul", icon: "businesses" },
  streets: { sort: (a) => city.streetCount(schluesselVon(a)), label: "Straßenkönig", icon: "krone" },
  bigwin:  { sort: (a) => (a.stats && a.stats.biggestWin) || 0,  label: "Größter Einzelgewinn", icon: "slots" },
  bigloss: { sort: (a) => (a.stats && a.stats.biggestLoss) || 0, label: "Größter Einzelverlust", icon: "auszahlen" },
  games:   { sort: (a) => (a.stats && a.stats.gamesPlayed) || 0, label: "Aktivste", icon: "wuerfel" },
  horses:  { sort: (a) => a.horseWins || 0,           label: "Renn-Champion", icon: "horses" },
};

/** Renn-Ergebnis eines eigenen Pferds verbuchen (Gesamt- + Wochen-Zähler). */
function recordHorseResult(name, pos) {
  const acc = get(name);
  if (!acc) return;
  if (pos === 1) {
    acc.horseWins = (acc.horseWins || 0) + 1;
    acc.dailyHorseWins = (acc.dailyHorseWins || 0) + 1; // Renn-Champion des Tages
  }
  if (pos <= 3) acc.horsePodiums = (acc.horsePodiums || 0) + 1;
  save();
}

/** Eine Rangliste für eine Kategorie. */
function leaderboardBy(cat, limit = 10) {
  const c = LEADERBOARD_CATS[cat];
  if (!c) return [];
  // Späte requires: achievements kennt das Titel-Emoji, weekly die Krone.
  const achievements = require("./achievements");
  const weekly = require("./weekly");
  const champ = weekly.champName();
  return Object.values(accounts)
    .map((a) => ({
      name: a.name, value: c.sort(a), chips: a.chips,
      badge: a.badge ? achievements.emojiOf(a.badge) : null,
      champ: champ != null && schluesselVon(a) === champ,
      level: levelFromXp(a.xp || 0),
      clan: require("./clans").tagOf(schluesselVon(a)),
      ...require("./cosmetics").publicLook(a),
    }))
    .filter((x) => x.value > 0 || cat === "rich")
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Die rohen Kontoobjekte (weekly.js braucht das weeklyNet von allen). */
function rawAll() {
  return Object.values(accounts);
}

/** Alle Bestenlisten auf einmal (eine Abfrage, der Client wechselt nur die Reiter). */
function leaderboard(limit = 10) {
  const out = {};
  for (const cat of Object.keys(LEADERBOARD_CATS)) {
    // `icon` ist eine Kennung, keine Zeichnung: der Client holt sich das
    // Symbol aus core/icons.js. So schleppen alte Antworten keine Bilder mit.
    out[cat] = {
      label: LEADERBOARD_CATS[cat].label,
      icon: LEADERBOARD_CATS[cat].icon || null,
      entries: leaderboardBy(cat, limit),
    };
  }
  return out;
}

function changePin(name, oldPin, newPin) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  // Gleiche Fehlversuchs-Sperre wie beim Login, dieser Endpoint war sonst
  // eine ungebremste Hintertür zum Passwort-Raten.
  const lockMin = lockedMinutes(acc);
  if (lockMin) return { ok: false, error: `Zu viele Fehlversuche. Account für ${lockMin} Min gesperrt.` };
  if (acc.pinHash !== hashPin(String(oldPin), acc.salt)) {
    const lockedFor = recordAuthFail(acc);
    if (lockedFor) return { ok: false, error: `Zu viele Fehlversuche. Account für ${lockedFor} Min gesperrt.` };
    return { ok: false, error: "Altes Passwort falsch." };
  }
  recordAuthSuccess(acc);
  const next = String(newPin || "").trim();
  if (next.length < PASS_MIN_NEW || next.length > PASS_MAX)
    return { ok: false, error: `Neues Passwort: ${PASS_MIN_NEW} bis ${PASS_MAX} Zeichen.` };
  acc.pinHash = hashPin(next, acc.salt);
  save();
  return { ok: true };
}

/* Pechvogel
   Wohnt seit dem Strafen-Umbau in game/strafen.js und hat dort eine Staerke
   und eine Ablaufzeit. Die beiden Funktionen hier bleiben, weil fuenf
   Spielmodule sie rufen, und weil der alte Ja/Nein-Schalter an alten Konten
   weiterhin gilt (strafen.aktiv kennt ihn).

   Unterschied, auf den es ankommt: `isShadowbanned` sagt, dass jemand
   Pechvogel ist (fuer Anzeige und Listen), `pechTrifft` wuerfelt, ob es
   diese Runde zuschlaegt. Bei 100 Prozent ist beides dasselbe. */
function setShadowban(name, on, opts = {}) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (!on) { strafen.hebeAuf(acc, "pech"); return { ok: true, shadowban: false }; }
  const r = strafen.setze(acc, "pech", {
    minuten: opts.minuten || 0,
    wert: opts.wert || 100,
    grund: opts.grund || "",
  });
  return r.ok ? { ok: true, shadowban: true } : r;
}
function isShadowbanned(name) {
  const acc = get(name);
  return !!(acc && strafen.aktiv(acc, "pech"));
}
/** Wuerfelt, ob der Pechvogel diese Runde zuschlaegt (Staerke in Prozent). */
function pechTrifft(name) {
  const acc = get(name);
  return !!(acc && strafen.pechTrifft(acc));
}

/** Text fuer eine Geschenk-Sperre. */
function geschenkText(s) {
  return `Für dich gerade keine Geschenke (${strafen.restText(s)})${s.grund ? `: ${s.grund}` : "."}`;
}

function ban(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.banned = true;
  save();
  return { ok: true };
}

function unban(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.banned = false;
  save();
  return { ok: true };
}

const TRANSFER_MIN_AGE_MS = 24 * 60 * 60 * 1000; // Konto muss 24 h alt sein, um zu senden
const TRANSFER_MIN_GAMES = 25;    // Absender muss echt gespielt haben, blockt Faucet-Mules
const TRANSFER_DAILY_CAP = 100_000; // max. gesendete Chips pro Absender & Tag

function transfer(fromName, toName, amount) {
  /* Ueber kanonisch, damit eine Ueberweisung auch dann ankommt, wenn jemand
     den frueheren Namen des Empfaengers eintippt: der steht noch in genug
     Koepfen und in jeder aelteren Nachricht. */
  const fromKey = kanonisch(fromName) || normalizeName(fromName);
  const toKey = kanonisch(toName) || normalizeName(toName);
  if (!fromKey || !toKey) return { ok: false, error: "Ungültiger Name." };
  if (fromKey === toKey) return { ok: false, error: "Kannst nicht an dich selbst senden." };
  const from = accounts[fromKey];
  const to = accounts[toKey];
  if (!from) return { ok: false, error: "Absender nicht gefunden." };
  if (!to) return { ok: false, error: `Spieler "${toName}" nicht gefunden.` };
  if (Date.now() - (from.createdAt || 0) < TRANSFER_MIN_AGE_MS)
    return { ok: false, error: "Dein Account muss mindestens 24 Stunden alt sein um Chips zu senden." };
  // Anti-Mule: frisch angelegte Accounts könnten sonst nur Boni/Faucets
  // abgreifen und alles an den Hauptaccount weiterleiten.
  const played = (from.stats && from.stats.gamesPlayed) || 0;
  if (played < TRANSFER_MIN_GAMES)
    return { ok: false, error: `Erst ab ${TRANSFER_MIN_GAMES} gespielten Runden kannst du Chips senden (du hast ${played}).` };
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Ungültiger Betrag." };
  const day = new Date().toDateString();
  if (from.transferDay !== day) { from.transferDay = day; from.transferSent = 0; }
  const left = TRANSFER_DAILY_CAP - (from.transferSent || 0);
  if (amount > left)
    return { ok: false, error: `Tageslimit ${TRANSFER_DAILY_CAP.toLocaleString("de-DE")} Chips, heute kannst du noch ${Math.max(0, left).toLocaleString("de-DE")} senden.` };
  if (from.chips < amount) return { ok: false, error: "Nicht genug Chips." };
  from.chips -= amount;
  to.chips = Math.min(MAX_CHIPS, to.chips + amount);
  from.transferSent = (from.transferSent || 0) + amount;
  save();
  return { ok: true, fromAccount: publicAccount(from), toAccount: publicAccount(to) };
}

function deleteAccount(name) {
  const key = normalizeName(name);
  if (!accounts[key]) return { ok: false, error: "Account nicht gefunden." };
  let cityRemoved = 0;
  let clanChanged = false;
  try {
    const res = city.adminRemoveOwner(key);
    cityRemoved = res && res.removed ? res.removed : 0;
  } catch {}
  try {
    const res = require("./clans").adminRemoveMember(key);
    clanChanged = !!(res && res.changed);
  } catch {}
  delete accounts[key];
  save();
  return { ok: true, cityRemoved, clanChanged };
}

function listAll() {
  return Object.values(accounts).map((a) => ({
    name: a.name,
    rolle: a.rolle === "mod" ? "mod" : null,
    chips: a.chips,
    savings: Math.floor((a.savings && a.savings.amount) || 0),
    netWorth: _netWorth(a),
    weeklyNet: Math.floor(a.weeklyNet || 0),
    gamesPlayed: Math.floor((a.stats && a.stats.gamesPlayed) || 0),
    biggestWin: Math.floor((a.stats && a.stats.biggestWin) || 0),
    biggestLoss: Math.floor((a.stats && a.stats.biggestLoss) || 0),
    banned: !!a.banned,
    shadowban: !!strafen.aktiv(a, "pech"),
    strafen: strafen.marken(a),
    lastSeen: Math.floor(a.lastSeen || 0),
  }));
}

/* Das Gluecksrad wohnt seit dem Umbau in game/gluecksrad.js: es verteilt
   nicht mehr nur Chips, sondern auch Lose, Season-XP und Kosmetik, und dafuer
   braucht es Zugriff auf halbe Casino. Am Konto bleibt nur `lastWheelAt`. */

// Rivalen / Kopfgeld
// Chips auf einen Rivalen setzen. Wer eines seiner Gebäude übernimmt,
// bekommt den ganzen Topf. Der Einsatz wird sofort einbehalten.
const MIN_BOUNTY = 1000;

function placeBounty(fromName, targetName, amount) {
  const fromKey = normalizeName(fromName), targetKey = normalizeName(targetName);
  if (!fromKey || !targetKey) return { ok: false, error: "Ungültig." };
  if (fromKey === targetKey) return { ok: false, error: "Kein Kopfgeld auf dich selbst." };
  const from = accounts[fromKey], target = accounts[targetKey];
  if (!from) return { ok: false, error: "Absender fehlt." };
  if (!target) return { ok: false, error: `Spieler "${targetName}" nicht gefunden.` };
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < MIN_BOUNTY) return { ok: false, error: `Mindest-Kopfgeld ${MIN_BOUNTY.toLocaleString("de-DE")} Chips.` };
  if (from.chips < amount) return { ok: false, error: "Nicht genug Chips." };
  from.chips -= amount;
  target.bounty = (target.bounty || 0) + amount;
  // Merken, wer wie viel eingezahlt hat, damit selbst finanzierte Kopfgelder
  // (Zweitkonto-Farming) kein "Kopfgeldjäger"-Achievement bringen.
  target.bountyBy = target.bountyBy || {};
  target.bountyBy[fromKey] = (target.bountyBy[fromKey] || 0) + amount;
  save();
  return { ok: true, bounty: target.bounty, targetName: target.name, account: publicAccount(from) };
}

/** Wer übernimmt, bekommt den ganzen Kopfgeld-Topf. Gibt den Betrag zurück. */
function claimBounty(targetName, claimantName) {
  const target = get(targetName);
  const claimantKey = normalizeName(claimantName);
  if (!target || !target.bounty) return 0;
  const amount = target.bounty;
  // Anteil, den andere eingezahlt haben (nicht der Abholer selbst).
  const selfFunded = (target.bountyBy && target.bountyBy[claimantKey]) || 0;
  const external = amount - selfFunded;
  target.bounty = 0;
  target.bountyBy = {};
  const res = adjustChips(claimantKey, amount);
  if (res.ok) {
    const c = accounts[claimantKey];
    if (c && external > 0) c.bountyClaims = (c.bountyClaims || 0) + 1; // nur "echte" Abholungen zählen
    save();
    return amount;
  }
  target.bounty = amount; // bei Fehler zurück
  return 0;
}
const bountyOn = (name) => { const a = get(name); return (a && a.bounty) || 0; };

// Login-Kalender (7-Tage-Belohnungsreihe)
// Einmal pro Kalendertag abholen. Tage in Folge steigen die Leiter hoch, ein
// verpasster Tag setzt auf Tag 1 zurück. Unabhängig vom Stunden-Bonus.
const CAL_REWARDS = [2000, 3000, 5000, 8000, 12000, 20000, 50000];
const dayIndex = () => Math.floor(Date.now() / 86400000);

function calendarState(name) {
  const acc = get(name);
  if (!acc) return null;
  const today = dayIndex();
  const cal = acc.calendar || { idx: 0, lastDay: -999 };
  const claimedToday = cal.lastDay === today;
  // Weder gestern noch heute abgeholt: zurück auf Tag 1.
  const idx = (cal.lastDay === today || cal.lastDay === today - 1) ? cal.idx : 0;
  // Ausgezahlt wird mit Vermoegensbremse, angezeigt wurde bisher der volle
  // Wert. Wer 20.000 gelesen und 13.000 bekommen hat, musste das fuer einen
  // Fehler halten.
  const f = faucetFactor(acc.name);
  return {
    rewards: CAL_REWARDS.map((r) => Math.round(r * f)),
    grundwerte: CAL_REWARDS,
    faucet: Math.round(f * 100),
    current: idx,              // ladder position claimable next (0-based)
    claimedToday,
    canClaim: !claimedToday,
    glueckstag: !!acc.glueckstag,
  };
}

function claimCalendar(name) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  const ohne = strafen.aktiv(acc, "keinBonus");
  if (ohne) return { ok: false, error: geschenkText(ohne) };
  const today = dayIndex();
  const cal = acc.calendar || { idx: 0, lastDay: -999 };
  if (cal.lastDay === today) return { ok: false, error: "Heute schon abgeholt, morgen wieder." };
  const idx = (cal.lastDay === today - 1) ? cal.idx : 0; // in Folge? sonst von vorn
  /* Glückstag vom Rad: die naechste Kalender-Abholung zaehlt doppelt. Der
     Merker wird hier verbraucht, egal auf welcher Sprosse man steht, wer ihn
     aufhebt, bis er auf Tag 7 steht, hat das verdient. */
  const glueckstag = !!acc.glueckstag;
  if (glueckstag) delete acc.glueckstag;
  const reward = Math.round(CAL_REWARDS[idx] * faucetFactor(name)) * (glueckstag ? 2 : 1);
  acc.chips += reward;
  acc.calendar = { idx: (idx + 1) % CAL_REWARDS.length, lastDay: today };
  if ((idx + 1) > (acc.calBest || 0)) acc.calBest = idx + 1; // für die Achievements
  save();
  return { ok: true, reward, day: idx + 1, glueckstag, account: publicAccount(acc) };
}

// Wohnsitz (reine Deko, kostet nichts)
function setResidence(name, buildingId) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  if (buildingId == null) { delete acc.residence; save(); return { ok: true, residence: null }; }
  if (!city.bldExists(buildingId)) return { ok: false, error: "Gebäude nicht gefunden." };
  acc.residence = Number(buildingId);
  save();
  return { ok: true, residence: acc.residence };
}

/** Je buildingId die Namen aller, die dort ihren Wohnsitz haben. */
function residentsByBuilding() {
  const out = {};
  for (const acc of Object.values(accounts)) {
    if (acc.residence == null) continue;
    (out[acc.residence] = out[acc.residence] || []).push(acc.name);
  }
  return out;
}

/** Ob ein Automat für das Konto freigeschaltet ist (lucky7 ist immer frei). */
function isUnlocked(name, machineId) {
  if (machineId === "lucky7") return true;
  const acc = get(name);
  if (!acc) return false;
  return (acc.unlocked || ["lucky7"]).includes(machineId);
}

/** Freischaltung kaufen. Gibt { ok, account } oder { ok:false, error } zurück. */
function unlock(name, machineId, cost) {
  const acc = get(name);
  if (!acc) return { ok: false, error: "Account nicht gefunden." };
  acc.unlocked = acc.unlocked || ["lucky7"];
  if (acc.unlocked.includes(machineId)) return { ok: true, account: publicAccount(acc) };
  if (acc.chips < cost) return { ok: false, error: "Nicht genug Chips zum Freischalten." };
  acc.chips -= cost;
  acc.unlocked.push(machineId);
  save();
  return { ok: true, account: publicAccount(acc) };
}

/* Frueher benutzte Namen zeigen weiter auf ihr Konto (Anmeldung, Suche,
   Ueberweisung). Der Index steht im Speicher und wird beim Start aus den
   Konten aufgebaut.

   Steht bewusst hier unten und nicht oben bei den Konten: `aliase` ist ein
   const weiter unten in der Datei, und ein Aufruf davor liefe in dieselbe
   temporale Todeszone, die schon einmal ein Haus mit null Konten gestartet
   hat. */
baueAliasIndex();

/**
 * Den Kontostand bei denen nachziehen, die gerade verbunden sind.
 *
 * Es gibt zwei Sorten Buchung. Die eine kommt auf Zuruf: jemand dreht,
 * kauft, hebt ab — die Antwort traegt den neuen Stand mit, und der Client
 * schreibt ihn in die Topbar. Die andere passiert OHNE Zutun: die
 * Lotterie zieht abends, ein Heist zahlt aus, der Clan ueberweist, ein
 * versetztes Duell rechnet ab. Da hat niemand gefragt, also kommt auch
 * keine Antwort — und in der Topbar steht weiter der alte Stand, bis man
 * zufaellig etwas anderes tut.
 *
 * Das faellt besonders haesslich auf, wenn daneben "Dein Anteil: +40.000"
 * steht und die Zahl oben sich nicht ruehrt.
 *
 * `io` wird uebergeben und nicht gemerkt: dieses Modul soll nichts vom
 * Server wissen muessen (dieselbe Trennung wie bei `strafen.js`).
 */
function meldeStand(io, ...keys) {
  if (!io) return 0;
  const offen = new Set(keys.filter(Boolean));
  if (!offen.size) return 0;
  let n = 0;
  try {
    for (const sock of io.of("/").sockets.values()) {
      const key = sock.data && sock.data.account;
      if (!key || !offen.has(key)) continue;
      const acc = get(key);
      if (acc) { sock.emit("account:update", { account: publicAccount(acc) }); n++; }
      offen.delete(key);
      if (!offen.size) break;
    }
  } catch {}
  return n;
}

module.exports = {
  meldeStand,
  STARTING_CHIPS,
  touchSeen,
  DAILY_BONUS,
  DAILY_BONUS_COOLDOWN_MS,
  RESCUE_THRESHOLD,
  save,
  get,
  publicAccount,
  login,
  verifyToken,
  resumeSession,
  TOKEN_TTL_MS,
  claimDailyBonus,
  rescue,
  adjustChips,
  recordHand,
  recordHorseResult,
  addXp,
  leaderboard,
  isUnlocked,
  unlock,
  changePin,
  ban,
  unban,
  transfer,
  deleteAccount,
  listAll,
  grantBuff,
  buffMult,
  hasBuff,
  activeBuffs,
  getInventory,
  addItem,
  removeItem,
  setResidence,
  residentsByBuilding,
  onHand,
  rawAll,
  setShadowban,
  isShadowbanned,
  pechTrifft,
  rename,
  kanonisch,
  schluesselVon,
  nameVergeben,
  NAME_WECHSEL_MS,
  calendarState,
  claimCalendar,
  levelInfo,
  faucetFactor,
  placeBounty,
  claimBounty,
  bountyOn,
};
