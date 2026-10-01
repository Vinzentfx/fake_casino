"use strict";

/**
 * Die Ladenstraße: Zoohandlung, Autohaus und Kiosk.
 *
 * Vorher kam alles, was die Figur trägt, aus der Kleiderkiste. Das ist gut
 * für die Überraschung und schlecht für alles, was man gezielt will: ein
 * bestimmtes Tier kostete im Schnitt Dutzende Ziehungen, und billige
 * Snacks verwässerten jede einzelne. Jetzt hat jede dieser Gruppen genau
 * eine Quelle, die zu ihr passt (Katalog: `nur` in game/kleidung.js).
 *
 * Zoohandlung: zweimal die Woche eine Lieferung, vier Tierarten mit wenigen
 * Exemplaren, ein Tier je Person und Lieferung. Tiere werden geprägt und
 * sind handelbar, die Knappheit macht sie auf dem Markt etwas wert. Wer
 * zu spät kommt, merkt sich ein Tier vor und bekommt bei Lieferung dieser
 * Art ein reserviertes Exemplar: die Runde spielt versetzt, ein Wettrennen um die
 * Lieferzeit würde genau die bestrafen, die selten da sind. Vormerken
 * kostet nichts, und eine Vormerkung, die man nicht einlöst, wandert mit
 * in die nächste Lieferung.
 *
 * Autohaus: fester Preis, freigeschaltet über das Level. Damit hat die XP
 * einen Zweck, den man sieht.
 *
 * Kiosk: billig, immer da, nicht geprägt, nicht handelbar.
 *
 * Alle drei verbrennen Chips. Gekauftes wird sofort angelegt.
 */

const fs = require("fs");
const path = require("path");
const cosmetics = require("./cosmetics");
const kleidung = require("./kleidung");
const praegung = require("./praegung");
const buchungen = require("./buchungen");

const DATEI = path.join(__dirname, "..", "data", "laeden.json");
const ZOO_PLAETZE = 4;
/* Wie viele Exemplare je Lieferung, nach Seltenheit. Teure Tiere sind
   knapper, sonst wäre der Markt für sie sofort satt. */
const ZOO_BESTAND = { gewoehnlich: 6, selten: 4, episch: 3, legendaer: 2, mythisch: 1 };
const NAME_MIN = 2, NAME_MAX = 14;

let store = { zoo: { lieferung: null, angebot: [], verkauft: {}, kaeufer: {}, vorgemerkt: [], reserviert: {} } };
try {
  const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  if (roh && roh.zoo) store = { ...store, ...roh, zoo: { ...store.zoo, ...roh.zoo } };
} catch {}
/* Bestände und das Limit je Lieferung müssen vor der Antwort auf der
   Platte stehen; ein Neustart direkt nach dem Kauf darf sie nicht
   zurücksetzen. `speichernStreng` wirft, damit eine Buchung oder eine
   Vormerkung den Fehler sieht und nicht „erledigt“ meldet. */
function speichernStreng() {
  buchungen.schreiben(DATEI, JSON.stringify(store));
}
function speichern() {
  try { speichernStreng(); } catch (e) { console.error("[laeden] speichern:", e.message); }
}

const stufeVon = (cost) => require("./kisten").stufeVon(cost).id;
const liste = (nur) => Object.values(cosmetics.KATALOG[nur === kleidung.ZOO ? "haustier" : nur === kleidung.AUTOHAUS ? "fahrzeug" : "hand"] || {})
  .filter((x) => x.nur === nur);
const ART = { zoo: "haustier", autohaus: "fahrzeug", kiosk: "hand" };

/* Lieferungen kommen Montag um 0 Uhr und Donnerstag um 12 Uhr, deutsche
   Zeit, egal wo der Server steht (game/hauszeit.js). */
const hauszeit = require("./hauszeit");
const lieferungVon = (jetzt = Date.now()) => hauszeit.abschnittVon(jetzt, 3.5);
const lieferungEndet = (jetzt = Date.now()) => hauszeit.abschnittEndet(jetzt, 3.5);

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

/**
 * Die laufende Lieferung, beim ersten Lesen nach dem Wechsel neu gepackt.
 * Vorgemerkte Tierarten kommen zuerst in den Wagen, je Vormerkung ein
 * zurückgelegtes Exemplar obendrauf; der Rest wird ausgelost.
 */
function zoo(jetzt = Date.now()) {
  const z = store.zoo;
  const n = lieferungVon(jetzt);
  if (z.lieferung === n && z.angebot.length) return z;
  /* Nie zurück zu einer früheren Lieferung. Das kann nur beim Wechsel der
     Zeitrechnung passieren (vorher Serverzeit, jetzt deutsche Zeit) und
     hieße: dieselbe Lieferung ein zweites Mal, mit frischem Limit. */
  if (Number.isInteger(z.lieferung) && n < z.lieferung && z.angebot.length) return z;
  // Noch nicht belieferte Vormerkungen haben Vorrang. Nicht abgeholte
  // Reservierungen bleiben erhalten, reihen sich aber hinten wieder ein.
  const offen = Object.entries(z.reserviert || {}).map(([key, id]) => ({ key, id, ts: 0 }));
  const warte = [...(z.vorgemerkt || []), ...offen];
  const pool = liste(kleidung.ZOO);
  const arten = [];
  for (const v of warte) if (!arten.includes(v.id) && arten.length < ZOO_PLAETZE && pool.some((x) => x.id === v.id)) arten.push(v.id);
  const zieh = zufall(n * 2654435761);
  const rest = pool.filter((x) => !arten.includes(x.id)).sort((a, b) => a.id.localeCompare(b.id));
  while (arten.length < ZOO_PLAETZE && rest.length) arten.push(rest.splice(Math.floor(zieh() * rest.length), 1)[0].id);
  const reserviert = {};
  const extra = {};
  const nochWarten = [];
  for (const v of warte) {
    if (reserviert[v.key]) continue;
    if (arten.includes(v.id)) { reserviert[v.key] = v.id; extra[v.id] = (extra[v.id] || 0) + 1; }
    else nochWarten.push(v);
  }
  z.lieferung = n;
  z.angebot = arten.map((id) => {
    const x = cosmetics.KATALOG.haustier[id];
    return { id, bestand: (ZOO_BESTAND[stufeVon(x.cost)] || 2) + (extra[id] || 0) };
  });
  z.verkauft = {};
  z.kaeufer = {};
  z.buchungen = {};
  z.reserviert = reserviert;
  z.vorgemerkt = nochWarten;
  speichern();
  return z;
}

/* Was ein Zookauf außerhalb des Kontos ändert, als Haken für das Journal
   (game/buchungen.js). Jede Buchung merkt sich ihre Kennung in
   `z.buchungen`, damit die Wiederaufnahme weiß, ob sie schon im Bestand
   steht. Gilt nur für die Lieferung, in der gekauft wurde: ist die vorbei,
   gibt es dort nichts mehr nachzuziehen oder zurückzunehmen. */
const zooHaken = {
  angewendet(e) {
    const z = store.zoo;
    return z.lieferung === e.lieferung && !!(z.buchungen && z.buchungen[e.bid]);
  },
  anwenden(e) {
    const z = store.zoo;
    if (z.lieferung !== e.lieferung || (z.buchungen && z.buchungen[e.bid])) return;
    z.buchungen = z.buchungen || {};
    z.verkauft[e.id] = (z.verkauft[e.id] || 0) + 1;
    z.kaeufer[e.key] = z.lieferung;
    if (z.reserviert[e.key] === e.id) delete z.reserviert[e.key];
    z.vorgemerkt = z.vorgemerkt.filter((v) => !(v.key === e.key && v.id === e.id));
    z.buchungen[e.bid] = true;
  },
  zurueck(e) {
    const z = store.zoo;
    if (z.lieferung !== e.lieferung || !(z.buchungen && z.buchungen[e.bid])) return;
    z.verkauft[e.id] = Math.max(0, (z.verkauft[e.id] || 0) - 1);
    if (z.kaeufer[e.key] === z.lieferung) delete z.kaeufer[e.key];
    if (e.reserviertWar) z.reserviert[e.key] = e.id;
    for (const v of e.vorgemerkt || []) if (!z.vorgemerkt.some((w) => w.key === v.key && w.id === v.id)) z.vorgemerkt.push(v);
    delete z.buchungen[e.bid];
  },
  speichern: speichernStreng,
};

/** Wie viele Exemplare `key` von `id` noch kaufen könnte. */
function frei(z, id, key) {
  const a = z.angebot.find((x) => x.id === id);
  if (!a) return 0;
  const fuerAndere = Object.entries(z.reserviert).filter(([k, rid]) => rid === id && k !== key).length;
  return Math.max(0, a.bestand - (z.verkauft[id] || 0) - fuerAndere);
}

function hat(acc, art, id) {
  const l = acc && acc.cosOwned && acc.cosOwned[cosmetics.TOPF[art]];
  return Array.isArray(l) && l.includes(id);
}

function levelVon(accounts, acc) {
  const l = accounts.publicAccount(acc).level;
  return l && typeof l === "object" ? l.level : Number(l) || 1;
}

function stueckInfo(art, x) {
  return { id: x.id, label: x.label, stufe: cosmetics.stufeKennung(x), wert: x.cost };
}

/** Der Zustand eines Ladens für `acc`. */
function zustand(accounts, laden, acc, key) {
  if (laden === "zoo") {
    const z = zoo();
    const meine = z.reserviert[key] || null;
    return {
      laden, bis: lieferungEndet(), schonGekauft: z.kaeufer[key] === z.lieferung,
      vorgemerkt: (z.vorgemerkt.find((v) => v.key === key) || {}).id || null, zurueckgelegt: meine,
      stuecke: z.angebot.map((a) => {
        const x = cosmetics.KATALOG.haustier[a.id];
        return { ...stueckInfo("haustier", x), preis: x.cost, bestand: a.bestand, frei: frei(z, a.id, key), hat: hat(acc, "haustier", a.id), fuerDich: meine === a.id };
      }),
      // Was sonst im Zoo wohnt, damit man weiß, worauf man warten kann.
      alle: liste(kleidung.ZOO).map((x) => ({ ...stueckInfo("haustier", x), preis: x.cost, hat: hat(acc, "haustier", x.id), heute: z.angebot.some((a) => a.id === x.id) })),
      namen: acc.tierNamen || {},
    };
  }
  if (laden === "autohaus") {
    const level = levelVon(accounts, acc);
    return {
      laden, level,
      stuecke: liste(kleidung.AUTOHAUS).sort((a, b) => a.ab - b.ab).map((x) => ({ ...stueckInfo("fahrzeug", x), preis: x.cost, ab: x.ab, offen: level >= x.ab, hat: hat(acc, "fahrzeug", x.id), angelegt: acc.fahrzeug === x.id })),
    };
  }
  if (laden === "kiosk") {
    return {
      laden,
      stuecke: liste(kleidung.KIOSK).sort((a, b) => a.preis - b.preis).map((x) => ({ ...stueckInfo("hand", x), preis: x.preis, hat: hat(acc, "hand", x.id), angelegt: acc.handding === x.id })),
    };
  }
  return null;
}

/** Ein Tiername: kurz, eine Zeile, ohne Steuerzeichen, durch den Wortfilter. */
function tierName(roh) {
  const n = String(roh || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  if (!n) return { ok: true, name: null };
  if (n.length < NAME_MIN || n.length > NAME_MAX) return { ok: false, error: `Ein Name hat ${NAME_MIN} bis ${NAME_MAX} Zeichen.` };
  try {
    const p = require("./wortfilter").pruefe(n, "Der Name");
    if (!p.ok) return { ok: false, error: p.error };
  } catch {}
  return { ok: true, name: n };
}

function kaufen(accounts, laden, acc, key, { id, name } = {}) {
  id = String(id || "");
  const art = ART[laden];
  if (!art) return { ok: false, error: "Diesen Laden gibt es nicht." };
  const x = cosmetics.KATALOG[art] && cosmetics.KATALOG[art][id];
  if (!x || x.nur !== laden) return { ok: false, error: "Das gibt es hier nicht." };
  if (hat(acc, art, id)) return { ok: false, error: "Das hast du schon." };
  let preis = x.cost;
  let z = null, n = null;
  if (laden === "zoo") {
    z = zoo();
    if (!z.angebot.some((a) => a.id === id)) return { ok: false, error: "Das ist in dieser Lieferung nicht dabei. Merk es dir vor." };
    if (z.kaeufer[key] === z.lieferung) return { ok: false, error: "Ein Tier je Lieferung. Die nächste kommt bald." };
    if (frei(z, id, key) <= 0) return { ok: false, error: "Ausverkauft. Du kannst dieses Tier vormerken." };
    const nm = tierName(name);
    if (!nm.ok) return nm;
    n = nm.name;
  } else if (laden === "autohaus") {
    const level = levelVon(accounts, acc);
    if (level < x.ab) return { ok: false, error: `Das gibt es ab Level ${x.ab}. Du bist Level ${level}.` };
  } else {
    preis = x.preis;
  }
  if ((acc.chips || 0) < preis) return { ok: false, error: "Nicht genug Chips." };
  const feld = kleidung.ARTEN[art].feld;
  const r = buchungen.buche({
    accounts, cosmetics, praegung, key, acc, quelle: laden, art, id, preis,
    meta: laden === "zoo" ? {
      lieferung: z.lieferung, reserviertWar: z.reserviert[key] === id,
      vorgemerkt: z.vorgemerkt.filter((v) => v.key === key && v.id === id),
    } : null,
    zusatz: laden === "zoo" ? zooHaken : null,
    // Gleich anlegen: wer im Laden etwas kauft, will es jetzt sehen.
    konto(a) {
      const vorher = { wert: a[feld], zuFuss: a.zuFuss, tierNamen: a.tierNamen };
      a[feld] = id;
      if (art === "fahrzeug") a.zuFuss = false;
      if (n) a.tierNamen = { ...(a.tierNamen || {}), [id]: n };
      return () => {
        if (vorher.wert === undefined) delete a[feld]; else a[feld] = vorher.wert;
        if (vorher.zuFuss === undefined) delete a.zuFuss; else a.zuFuss = vorher.zuFuss;
        if (vorher.tierNamen === undefined) delete a.tierNamen; else a.tierNamen = vorher.tierNamen;
      };
    },
  });
  if (!r.ok) return r;
  return { ok: true, label: x.label, name: n, preis };
}

function vormerken(acc, key, id) {
  const z = zoo();
  id = String(id || "");
  const x = cosmetics.KATALOG.haustier[id];
  if (!x || x.nur !== kleidung.ZOO) return { ok: false, error: "Dieses Tier gibt es im Zoo nicht." };
  if (hat(acc, "haustier", id)) return { ok: false, error: "Das hast du schon." };
  if (z.reserviert[key]) return { ok: false, error: "Für dich ist schon ein Tier zurückgelegt." };
  if (z.angebot.some((a) => a.id === id) && frei(z, id, key) > 0 && z.kaeufer[key] !== z.lieferung) return { ok: false, error: "Das ist gerade da. Du kannst es direkt nehmen." };
  // Eine Vormerkung je Person; eine neue ersetzt die alte.
  const vorher = z.vorgemerkt;
  z.vorgemerkt = z.vorgemerkt.filter((v) => v.key !== key);
  z.vorgemerkt.push({ key, id, ts: Date.now() });
  try { speichernStreng(); } catch (e) {
    z.vorgemerkt = vorher;
    console.error("[laeden] Vormerkung nicht gesichert:", e.message);
    return { ok: false, error: "Das ließ sich gerade nicht sichern. Versuch es gleich noch einmal." };
  }
  return { ok: true, label: x.label };
}

function setupLaeden(io, accounts) {
  // Erst offene Buchungen zu Ende bringen, dann die Lieferung prüfen: ein
  // Lieferwechsel davor würde den Zoo-Zustand der Buchung wegräumen.
  buchungen.wiederaufnehmen({ accounts, cosmetics, praegung, zusatz: { zoo: zooHaken } });
  zoo();
  io.on("connection", (socket) => {
    const wer = () => {
      const key = socket.data.account;
      const acc = key ? accounts.get(key) : null;
      return acc ? { key, acc } : null;
    };
    socket.on("laden:state", ({ laden } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      const st = zustand(accounts, String(laden || ""), w.acc, w.key);
      ack(st ? { ok: true, chips: w.acc.chips, ...st } : { ok: false, error: "Diesen Laden gibt es nicht." });
    });
    socket.on("laden:kaufen", ({ laden, id, name } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      laden = String(laden || "");
      const r = kaufen(accounts, laden, w.acc, w.key, { id, name });
      if (!r.ok) return ack(r);
      const pub = accounts.publicAccount(w.acc);
      // Die anderen Tabs ziehen mit, und die Figur in der Welt zieht sich um.
      for (const s of io.of("/").sockets.values()) {
        if (s.data && s.data.account === w.key && s !== socket) s.emit("account:update", { account: pub });
      }
      ack({ ...r, account: pub, ...zustand(accounts, laden, w.acc, w.key) });
    });
    socket.on("laden:vormerken", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const w = wer();
      if (!w) return ack({ ok: false, error: "Nicht eingeloggt." });
      const r = vormerken(w.acc, w.key, id);
      ack(r.ok ? { ...r, ...zustand(accounts, "zoo", w.acc, w.key) } : r);
    });
  });
}

module.exports = { setupLaeden, lieferungVon, lieferungEndet, kaufen, vormerken, zustand, tierName, zooHaken, _store: () => store, _zoo: zoo };
