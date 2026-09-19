"use strict";

/**
 * Kosmetik-Markt: geprägte Stücke zwischen Spielern.
 *
 * Hier stand vorher ein Marktplatz für Firmenprodukte aus der Stadt. Die
 * Produkte gibt es seit dem Umbau der Stadt nicht mehr, der Katalog war leer,
 * und im Spielstand vom 18.9. stand ein einziges leeres Angebotsbuch. Der
 * Screen existierte nur noch.
 *
 * Jetzt gehandelt wird das, was game/praegung.js zu einem Gegenstand macht:
 * Exemplare mit einer laufenden Nummer und einer Besitzerkette.
 *
 * Die Regeln und warum sie so sind:
 *
 *   FESTPREIS statt Versteigerung. Das Auktionshaus gibt es schon, und es
 *   löst den einen großen Termin am Abend. Ein Dutzend gleichzeitig laufender
 *   Auktionen würde von einer Runde, in der selten zwei Leute zur selben Zeit
 *   online sind, verlangen, dass alle zwölf Enden jemand mitbekommt.
 *
 *   HINTERLEGT wie bei der Auktion die Chips. Wer etwas anbietet, gibt es aus
 *   der Hand: es verschwindet aus `cosOwned` und wird abgelegt, wenn es
 *   angelegt war. Sonst trüge man weiter das, was im Schaufenster steht.
 *   Zurücknehmen geht jederzeit und kostet nichts.
 *
 *   GEBÜHR beim Verkauf, und sie verbrennt. Der Handel selbst schiebt Chips
 *   nur hin und her und hilft dem Casino also gar nicht; die Gebühr ist der
 *   Grund, warum der Markt dem Haus überhaupt etwas bringt.
 *
 *   NUR HANDELBARES, und das ist seit dem Ende des Ladens fast alles:
 *   solange man ein Stück nachkaufen konnte, wäre ein Markt dafür nur ein
 *   zweiter Preis für dieselbe Sache gewesen. Draußen bleiben die
 *   Haus-Stücke, die Sammlungs-Belohnungen und das Verdienbare (Krone,
 *   Straßenherr) — die Begründungen stehen bei `cosmetics.handelbar`.
 *
 *   ANSAGEN AB EPISCH. Wer fünf Stücke hintereinander einstellt, hätte sonst
 *   fünf Zeilen im Chat geschrieben, und die schieben alles weg, was sonst
 *   dort steht. Dieselbe Schwelle wie bei der Ruhmestafel, damit im ganzen
 *   Haus dasselbe als „erwähnenswert“ gilt. In die Chronik geht trotzdem
 *   jedes Angebot: wer drei Tage weg war, soll nichts verpasst haben.
 *
 * Angebote liegen in data/market.json.
 */

const path = require("path");
const fs = require("fs");
const cosmetics = require("./cosmetics");
const praegung = require("./praegung");
const chat = require("./chat");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "market.json");

const GEBUEHR = 0.10;          // Anteil des Preises, der beim Verkauf verbrennt
const MIN_PREIS = 1000;
const MAX_PREIS = 100_000_000; // gegen den vertippten Preis, nicht gegen Absicht
const MAX_JE_SPIELER = 5;      // so viele Angebote darf einer gleichzeitig haben

function load() {
  try {
    const m = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (m && m.angebote) return m;
    // Der alte Produktmarkt. Seine Angebote beschreiben Gegenstände, die es
    // nicht mehr gibt; sie werden nicht übernommen, sondern fallen weg.
    if (m && m.offers) return { v: 2, angebote: {}, next: 1 };
  } catch {}
  return { v: 2, angebote: {}, next: 1 };
}

let store = load();
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store));
  } catch {}
}

const err = (error) => ({ ok: false, error });
const de = (n) => Math.round(n).toLocaleString("de-DE");

/**
 * Ein Angebot, fertig zum Anzeigen.
 *
 * Die Besitzerkette kommt mit: sie ist der Grund, warum ein Exemplar mehr
 * wert sein kann als das andere, und sie gehört deshalb an das Angebot und
 * nicht hinter einen zweiten Aufruf.
 */
function publicAngebot(id, a, viewerKey) {
  const st = praegung.stueck(a.uid);
  if (!st) return null;
  return {
    id,
    art: st.art, stueckId: st.id,
    label: cosmetics.label(st.art, st.id),
    // Damit der Markt das Stück zeigen kann und nicht nur seinen Namen.
    look: cosmetics.vorschauDaten(st.art, st.id),
    nr: st.nr, bestand: praegung.bestand(st.art, st.id),
    gepraegtAm: st.gepraegtAm, gepraegtFuer: st.fuerName,
    haende: st.kette.length,
    // Nur die Verkäufe, nicht die Prägung: ein Preis von 0 ist kein Preis.
    verlauf: st.kette.filter((k) => k.preis > 0).map((k) => ({ name: k.name, at: k.at, preis: k.preis })),
    preis: a.preis,
    verkaeufer: a.verkaeufer, verkaeuferName: a.verkaeuferName,
    meins: a.verkaeufer === viewerKey,
    seit: a.seit,
  };
}

/** Liegt dieses Exemplar hier im Schaufenster? Fuer das Auktionshaus. */
function istHinterlegt(uid) {
  return Object.values(store.angebote).some((a) => a.uid === uid);
}

/**
 * Was `key` gerade anbieten könnte.
 *
 * Nicht dabei: was schon im Schaufenster liegt, und was im Auktionshaus
 * eingeliefert ist. Die Praegung sagt in beiden Faellen weiter, dass es ihm
 * gehoert — hinterlegt wird ueber `cosOwned`, und das sieht man hier nicht.
 */
function anbietbar(acc, key) {
  const out = [];
  const owned = acc.cosOwned || {};
  const imSchaufenster = new Set(
    Object.values(store.angebote).filter((a) => a.verkaeufer === key).map((a) => a.uid)
  );
  let imHaus = () => false;
  try { imHaus = require("./auktion").istHinterlegt; } catch {}
  for (const st of Object.values(praegung.alleVon(key))) {
    if (!cosmetics.handelbar(st.art, st.id)) continue;
    if (imSchaufenster.has(st.uid)) continue;
    if (imHaus(st.uid)) continue;
    out.push({
      uid: st.uid, art: st.art, stueckId: st.id,
      label: cosmetics.label(st.art, st.id),
      look: cosmetics.vorschauDaten(st.art, st.id),
      nr: st.nr, bestand: praegung.bestand(st.art, st.id),
      haende: st.kette.length,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function oeffentlich(accounts, key) {
  const acc = key ? accounts.get(key) : null;
  const angebote = [];
  for (const [id, a] of Object.entries(store.angebote)) {
    const p = publicAngebot(id, a, key);
    if (p) angebote.push(p);
  }
  angebote.sort((a, b) => a.preis - b.preis);
  return {
    angebote,
    meine: acc ? anbietbar(acc, key) : [],
    offen: Object.values(store.angebote).filter((a) => a.verkaeufer === key).length,
    maxJeSpieler: MAX_JE_SPIELER,
    gebuehr: GEBUEHR, minPreis: MIN_PREIS, maxPreis: MAX_PREIS,
  };
}

function anbieten(accounts, key, uid, preis) {
  const acc = accounts.get(key);
  if (!acc) return err("Nicht eingeloggt.");
  const st = praegung.stueck(uid);
  if (!st || st.besitzer !== key) return err("Das Stück gehört dir nicht.");
  if (!cosmetics.handelbar(st.art, st.id)) return err("Dieses Stück lässt sich nicht handeln.");
  if (Object.values(store.angebote).some((a) => a.uid === uid)) return err("Steht schon im Schaufenster.");
  const offen = Object.values(store.angebote).filter((a) => a.verkaeufer === key).length;
  if (offen >= MAX_JE_SPIELER) return err(`Höchstens ${MAX_JE_SPIELER} Angebote gleichzeitig.`);
  const p = Math.round(Number(preis) || 0);
  if (!Number.isFinite(p) || p < MIN_PREIS) return err(`Mindestens ${de(MIN_PREIS)} Chips.`);
  if (p > MAX_PREIS) return err(`Höchstens ${de(MAX_PREIS)} Chips.`);
  // Aus der Hand geben: erst jetzt, nachdem alles geprüft ist.
  if (!cosmetics.besitzNehmen(acc, st.art, st.id)) return err("Das Stück gehört dir nicht.");
  accounts.save();
  const id = String(store.next++);
  store.angebote[id] = { uid, preis: p, verkaeufer: key, verkaeuferName: acc.name, seit: Date.now() };
  save();
  return { ok: true, id, art: st.art, stueckId: st.id, nr: st.nr, label: cosmetics.label(st.art, st.id), preis: p };
}

function zuruecknehmen(accounts, key, id) {
  const a = store.angebote[id];
  if (!a) return err("Das Angebot gibt es nicht mehr.");
  if (a.verkaeufer !== key) return err("Das ist nicht dein Angebot.");
  const acc = accounts.get(key);
  const st = praegung.stueck(a.uid);
  if (!acc || !st) return err("Geht gerade nicht.");
  cosmetics.besitzGeben(acc, st.art, st.id);
  accounts.save();
  delete store.angebote[id];
  save();
  return { ok: true, label: cosmetics.label(st.art, st.id) };
}

function kaufen(accounts, key, id) {
  const a = store.angebote[id];
  if (!a) return err("Das Angebot gibt es nicht mehr.");
  if (a.verkaeufer === key) return err("Das ist dein eigenes Angebot.");
  const acc = accounts.get(key);
  const verk = accounts.get(a.verkaeufer);
  const st = praegung.stueck(a.uid);
  if (!acc || !st) return err("Geht gerade nicht.");
  if ((acc.chips || 0) < a.preis) return err("Nicht genug Chips.");
  /* Wer das Stück schon hat, kann kein zweites davon tragen: `cosOwned` ist
     eine Liste ohne Doppelte, das zweite Exemplar wäre unsichtbar und für
     immer weg. */
  const owned = (acc.cosOwned || {})[TOPF_VON[st.art]] || [];
  if (owned.includes(st.id)) return err("Du hast dieses Stück schon.");

  const gebuehr = Math.round(a.preis * GEBUEHR);
  const anVerkaeufer = a.preis - gebuehr;
  accounts.adjustChips(key, -a.preis);
  if (verk) accounts.adjustChips(a.verkaeufer, anVerkaeufer);
  cosmetics.besitzGeben(acc, st.art, st.id);
  accounts.save();
  praegung.uebertragen(a.uid, key, acc.name, a.preis);
  delete store.angebote[id];
  save();
  return {
    ok: true,
    // Die uid mit zurück: der Client will genau diese Kachel hervorheben,
    // und sie über den angezeigten Text zu suchen ist zu wackelig.
    uid: a.uid,
    label: cosmetics.label(st.art, st.id), nr: st.nr,
    preis: a.preis, gebuehr, anVerkaeufer,
    verkaeufer: a.verkaeufer, verkaeuferName: verk ? verk.name : a.verkaeuferName,
  };
}

/* Welcher Topf am Konto zu welcher Art gehört. Steht auch in cosmetics.js;
   dort ist er nicht exportiert, und ihn dafür zu exportieren hieße, ein
   Detail des Kontoformats nach außen zu geben. Eine Zeile Kopie ist hier das
   kleinere Übel, und falsch werden kann sie nur, wenn eine neue Art dazukommt
   — dann fehlt hier ein Eintrag und das Stück lässt sich schlicht nicht
   kaufen, statt still im Nichts zu landen. */
const TOPF_VON = { avatar: "avatars", color: "colors", style: "styles", frame: "frames",
  title: "titles", effect: "effects", spruch: "sprueche", banner: "banner",
  schild: "schilder", aura: "auren", karte: "karten", zeichen: "zeichen" };

/**
 * Der Verkäufer heißt jetzt anders.
 *
 * Der Name steht als Kopie am Angebot, damit die Liste ohne Kontozugriff
 * lesbar ist. Genau deshalb muss er hier mitgezogen werden.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  for (const a of Object.values(store.angebote)) {
    if (a.verkaeufer === key && a.verkaeuferName !== neu) { a.verkaeuferName = neu; n++; }
  }
  if (n) save();
  return n;
}

/* Ab wann ein Angebot im Chat steht. Dieselbe Schwelle wie auf der
   Ruhmestafel (game/ruhm.js), damit „selten genug, um es zu sagen“ im
   ganzen Haus dasselbe heisst. */
function erwaehnenswert(art, id) {
  try {
    return require("./ruhm").TAFEL_AB.has(cosmetics.stufeVonStueck(art, id));
  } catch { return true; }
}

function setupMarket(io, accounts) {
  io.on("connection", (socket) => {
    const key = () => socket.data.account || null;

    socket.on("market:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: true, ...oeffentlich(accounts, key()) });
    });

    socket.on("market:anbieten", ({ uid, preis } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      const r = anbieten(accounts, key(), uid, preis);
      if (!r.ok) return ack(r);
      ack({ ok: true, ...oeffentlich(accounts, key()), account: accounts.publicAccount(accounts.get(key())) });
      io.emit("market:update");
      const satz = `${accounts.get(key()).name} bietet „${r.label}“ Nr. ${r.nr} für ${de(r.preis)} Chips an.`;
      if (erwaehnenswert(r.art, r.stueckId)) chat.announce(io, satz);
      try { require("./chronik").notiere("stadt", satz, { user: accounts.get(key()).name, wert: r.preis }); } catch {}
    });

    socket.on("market:zurueck", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      const r = zuruecknehmen(accounts, key(), id);
      if (!r.ok) return ack(r);
      ack({ ok: true, ...oeffentlich(accounts, key()), account: accounts.publicAccount(accounts.get(key())) });
      io.emit("market:update");
    });

    socket.on("market:buy", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack(err("Nicht eingeloggt."));
      const r = kaufen(accounts, key(), id);
      if (!r.ok) return ack(r);
      const acc = accounts.get(key());
      const fertig = cosmetics.sammlungAnsage(io, accounts, key());
      ack({ ok: true, ...oeffentlich(accounts, key()), account: accounts.publicAccount(acc), gekauft: r, sammlung: fertig });
      io.emit("market:update");
      chat.announce(io, `${acc.name} kauft „${r.label}“ Nr. ${r.nr} von ${r.verkaeuferName} für ${de(r.preis)} Chips.`);
      try {
        require("./chronik").notiere("stadt", `${acc.name} kauft „${r.label}“ Nr. ${r.nr} von ${r.verkaeuferName} für ${de(r.preis)} Chips.`, { user: acc.name, wert: r.preis });
      } catch {}
      /* Der Verkäufer bekommt Chips, ohne etwas gedrückt zu haben. Ohne diese
         Zeile steht in seiner Topbar weiter der alte Stand, genau wie beim
         Auktions-Zuschlag. */
      const verkAcc = accounts.get(r.verkaeufer);
      for (const s of io.of("/").sockets.values()) {
        if (s.data && s.data.account === r.verkaeufer) {
          if (verkAcc) s.emit("account:update", { account: accounts.publicAccount(verkAcc) });
          s.emit("market:verkauft", { label: r.label, nr: r.nr, preis: r.preis, erloes: r.anVerkaeufer, an: acc.name });
          break;
        }
      }
    });
  });
}

module.exports = { setupMarket, oeffentlich, umbenennen, istHinterlegt, GEBUEHR };
