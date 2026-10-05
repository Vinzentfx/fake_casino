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
 * Exemplare mit einer zufaelligen Seriennummer und einer Besitzerkette.
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

/* Fehlt die Datei, ist ein leerer Markt richtig. Ist sie da und kaputt,
   bricht der Start ab: sonst ersetzte der nächste save() alle Angebote still
   durch einen leeren Markt, und die hinterlegten Stücke hingen im Nichts. */
function load() {
  let roh;
  try {
    roh = fs.readFileSync(FILE, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { v: 2, angebote: {}, next: 1 };
    throw new Error(`[market] ${FILE} ist nicht lesbar: ${e.message}`);
  }
  let m;
  try { m = JSON.parse(roh); } catch (e) { throw new Error(`[market] ${FILE} ist beschädigt: ${e.message}`); }
  if (m && m.angebote) return m;
  // Der alte Produktmarkt. Seine Angebote beschreiben Gegenstände, die es
  // nicht mehr gibt; sie werden nicht übernommen, sondern fallen weg.
  if (m && m.offers) return { v: 2, angebote: {}, next: 1 };
  throw new Error(`[market] ${FILE} hat keine Angebotsliste.`);
}

const buchungen = require("./buchungen");
let store = load();
/* Über eine Kopie und Umbenennen; ein Fehler wirft, damit eine Buchung
   (unten) nicht „erledigt“ sagt, was gar nicht auf der Platte steht. */
function save() {
  require("./buchungen").sicherSchreiben(FILE, JSON.stringify(store));
}

const err = (error) => ({ ok: false, error });
const de = (n) => Math.round(n).toLocaleString("de-DE");
const serienText = (nr, serie) => nr
  ? `#${(serie && serie.code) || String(nr).padStart(4, "0")}${serie && serie.kurz ? ` ${serie.kurz}` : ""}`
  : "";

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
    nr: st.nr, serie: st.serie, bestand: praegung.bestand(st.art, st.id),
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
      nr: st.nr, serie: st.serie, bestand: praegung.bestand(st.art, st.id),
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
  /* Aus der Hand geben, als Buchung (game/buchungen.js): erst das Konto
     sichern (Stück weg), dann das Angebot. Bricht es dazwischen ab, gibt der
     nächste Start das Stück zurück, statt es im Nichts hängen zu lassen. */
  const id = String(store.next++);
  const angebot = { uid, preis: p, verkaeufer: key, verkaeuferName: acc.name, seit: Date.now() };
  let bid;
  try { bid = buchungen.vormerken({ quelle: "markt", schritt: "angebot", key, art: st.art, id: st.id, angebot: id, daten: angebot }); }
  catch { return err("Gerade lässt sich nichts einstellen. Es hat sich nichts geändert."); }
  if (!cosmetics.besitzNehmen(acc, st.art, st.id)) { buchungen.erledigt(bid); return err("Das Stück gehört dir nicht."); }
  try {
    accounts.saveJetzt();
    store.angebote[id] = angebot;
    save();
  } catch (e) {
    console.error("[market] Angebot nicht gesichert:", e.message);
    delete store.angebote[id];
    cosmetics.besitzGeben(acc, st.art, st.id);
    try { accounts.saveJetzt(); buchungen.erledigt(bid); } catch {}
    return err("Das ließ sich gerade nicht sichern. Das Stück ist wieder bei dir.");
  }
  buchungen.erledigt(bid);
  return { ok: true, id, art: st.art, stueckId: st.id, nr: st.nr, serie: st.serie, label: cosmetics.label(st.art, st.id), preis: p };
}

function zuruecknehmen(accounts, key, id) {
  const a = store.angebote[id];
  if (!a) return err("Das Angebot gibt es nicht mehr.");
  if (a.verkaeufer !== key) return err("Das ist nicht dein Angebot.");
  const acc = accounts.get(key);
  const st = praegung.stueck(a.uid);
  if (!acc || !st || st.besitzer !== a.verkaeufer) return err("Das Angebot ist nicht mehr gültig.");
  /* Umgekehrt zum Einstellen: erst das Angebot weg, dann das Stück zurück
     ans Konto. Andersherum stünde es nach einem Abbruch zugleich am Konto
     und im Schaufenster, und ein Käufer bekäme ein zweites Exemplar. */
  let bid;
  try { bid = buchungen.vormerken({ quelle: "markt", schritt: "rueck", key, art: st.art, id: st.id, angebot: id, daten: a }); }
  catch { return err("Gerade lässt sich nichts zurücknehmen. Es hat sich nichts geändert."); }
  try {
    delete store.angebote[id];
    save();
    cosmetics.besitzGeben(acc, st.art, st.id);
    accounts.saveJetzt();
  } catch (e) {
    console.error("[market] Rücknahme nicht gesichert:", e.message);
    // Die Buchung bleibt im Journal; der nächste Start bringt sie zu Ende.
    return err("Das ließ sich gerade nicht sichern. Es wird beim nächsten Start nachgeholt.");
  }
  buchungen.erledigt(bid);
  return { ok: true, label: cosmetics.label(st.art, st.id) };
}

function kaufen(accounts, key, id) {
  const a = store.angebote[id];
  if (!a) return err("Das Angebot gibt es nicht mehr.");
  if (a.verkaeufer === key) return err("Das ist dein eigenes Angebot.");
  const acc = accounts.get(key);
  const verk = accounts.get(a.verkaeufer);
  const st = praegung.stueck(a.uid);
  if (!acc || !st || st.besitzer !== a.verkaeufer) return err("Das Angebot ist nicht mehr gültig.");
  /* Ohne auflösbares Verkäuferkonto (alter Schlüssel, gelöschtes Konto)
     ginge der Erlös ins Leere, der Käufer hätte aber bezahlt. Solche
     Angebote ruhen, bis der Besitzer von Hand geklärt ist. */
  if (!verk) return err("Der Verkäufer lässt sich gerade nicht zuordnen. Das Angebot ruht, bis das geklärt ist.");
  if ((acc.chips || 0) < a.preis) return err("Nicht genug Chips.");
  /* Wer das Stück schon hat, kann kein zweites davon tragen: `cosOwned` ist
     eine Liste ohne Doppelte, das zweite Exemplar wäre unsichtbar und für
     immer weg. */
  const owned = (acc.cosOwned || {})[TOPF_VON[st.art]] || [];
  if (owned.includes(st.id) || praegung.stueckVon(key, st.art, st.id)) return err("Du besitzt dieses Stück schon, möglicherweise als Angebot.");

  const gebuehr = Math.round(a.preis * GEBUEHR);
  const anVerkaeufer = a.preis - gebuehr;
  /* Ein Kauf ändert drei Dateien (Konten, Prägeregister, Markt) und ist
     deshalb eine Buchung (game/buchungen.js). Käufer und Verkäufer stehen
     beide im Konto, das zuerst und sofort gesichert wird: es entscheidet
     beim nächsten Start, ob der Kauf gilt. Danach Exemplar und Angebot. */
  let bid;
  try { bid = buchungen.vormerken({ quelle: "markt", schritt: "kauf", key, name: acc.name, verkaeufer: a.verkaeufer, art: st.art, id: st.id, uid: a.uid, angebot: id, preis: a.preis }); }
  catch { return err("Gerade lässt sich nichts kaufen. Es wurde nichts abgebucht."); }
  const vorher = { kaeufer: acc.chips, verkaeufer: verk.chips };
  acc.chips = (acc.chips || 0) - a.preis;
  verk.chips = (verk.chips || 0) + anVerkaeufer;
  cosmetics.besitzGeben(acc, st.art, st.id);
  try {
    accounts.saveJetzt();
  } catch (e) {
    console.error("[market] Kauf nicht gesichert:", e.message);
    acc.chips = vorher.kaeufer;
    verk.chips = vorher.verkaeufer;
    cosmetics.besitzNehmen(acc, st.art, st.id);
    try { accounts.saveJetzt(); buchungen.erledigt(bid); } catch {}
    return err("Das ließ sich gerade nicht sichern. Es wurde nichts abgebucht.");
  }
  // Ab hier gilt der Kauf; was jetzt noch scheitert, zieht der nächste Start nach.
  try {
    praegung.uebertragen(a.uid, key, acc.name, a.preis);
    delete store.angebote[id];
    save();
    buchungen.erledigt(bid);
  } catch (e) { console.error("[market] Kauf nachzuziehen beim nächsten Start:", e.message); }
  return {
    ok: true,
    // Die uid mit zurück: der Client will genau diese Kachel hervorheben,
    // und sie über den angezeigten Text zu suchen ist zu wackelig.
    uid: a.uid,
    label: cosmetics.label(st.art, st.id), nr: st.nr, serie: st.serie,
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
/* Seit der Kleidung kommt die Liste aus dem Katalog selbst: neun neue Arten
   auf einmal hier nachzutragen ist genau der Fall, vor dem der Kommentar
   oben warnt. */
const TOPF_VON = require("./cosmetics").TOPF;

/*
 * Eine abgebrochene Marktbuchung beim Start zu Ende bringen. Das Konto auf
 * der Platte entscheidet, wie bei den Läden:
 *   angebot  Stück nicht mehr am Konto: das Angebot muss stehen, sonst kommt
 *            das Stück zurück. Noch am Konto: es gibt kein Angebot.
 *   rueck    Angebot noch da: nichts passiert. Angebot weg: das Stück gehört
 *            wieder ans Konto.
 *   kauf     Käufer hat das Stück: Exemplar umschreiben, Angebot weg.
 *            Sonst ist nichts passiert, das Angebot bleibt.
 */
buchungen.beiOffenerBuchung("markt", (e) => {
  const accounts = require("./accounts");
  const acc = accounts.get(e.key);
  if (!acc) return "ohne Konto liegen gelassen";
  const hat = ((acc.cosOwned || {})[TOPF_VON[e.art]] || []).includes(e.id);
  const da = !!store.angebote[e.angebot];
  if (e.schritt === "angebot") {
    if (!hat && !da) { cosmetics.besitzGeben(acc, e.art, e.id); accounts.saveJetzt(); return "Stück zurück"; }
    if (hat && da) { delete store.angebote[e.angebot]; save(); return "Angebot entfernt"; }
    return "abgeschlossen";
  }
  if (e.schritt === "rueck") {
    if (!da && !hat) { cosmetics.besitzGeben(acc, e.art, e.id); accounts.saveJetzt(); return "Stück zurück"; }
    return "abgeschlossen";
  }
  if (e.schritt === "kauf") {
    if (!hat) return "nicht gekauft";
    const st = praegung.stueck(e.uid);
    if (st && st.besitzer !== e.key) praegung.uebertragen(e.uid, e.key, e.name || acc.name, e.preis);
    if (da) { delete store.angebote[e.angebot]; save(); }
    return "Kauf nachgezogen";
  }
  return "unbekannt";
});

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
  if (n) { try { save(); } catch (e) { console.error("[market] Umbenennung nicht gesichert:", e.message); } }
  return n;
}

/* Ab wann ein Angebot im Chat steht. Dieselbe Schwelle wie auf der
   Ruhmestafel (game/ruhm.js), damit „selten genug, um es zu sagen“ im
   ganzen Haus dasselbe heisst. */
function erwaehnenswert(art, id, serie) {
  try {
    return require("./ruhm").TAFEL_AB.has(cosmetics.stufeVonStueck(art, id))
      || (serie && (serie.id === "gold" || serie.id === "jackpot"));
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
      const satz = `${accounts.get(key()).name} bietet „${r.label}“ ${serienText(r.nr, r.serie)} für ${de(r.preis)} Chips an.`;
      if (erwaehnenswert(r.art, r.stueckId, r.serie)) chat.announce(io, satz);
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
      chat.announce(io, `${acc.name} kauft „${r.label}“ ${serienText(r.nr, r.serie)} von ${r.verkaeuferName} für ${de(r.preis)} Chips.`);
      try {
        require("./chronik").notiere("stadt", `${acc.name} kauft „${r.label}“ ${serienText(r.nr, r.serie)} von ${r.verkaeuferName} für ${de(r.preis)} Chips.`, { user: acc.name, wert: r.preis });
      } catch {}
      /* Der Verkäufer bekommt Chips, ohne etwas gedrückt zu haben. Ohne diese
         Zeile steht in seiner Topbar weiter der alte Stand, genau wie beim
         Auktions-Zuschlag. */
      const verkAcc = accounts.get(r.verkaeufer);
      for (const s of io.of("/").sockets.values()) {
        if (s.data && s.data.account === r.verkaeufer) {
          if (verkAcc) s.emit("account:update", { account: accounts.publicAccount(verkAcc) });
          s.emit("market:verkauft", { label: r.label, nr: r.nr, serie: r.serie, preis: r.preis, erloes: r.anVerkaeufer, an: acc.name });
          break;
        }
      }
    });
  });
}

module.exports = { setupMarket, oeffentlich, umbenennen, istHinterlegt, GEBUEHR, _intern: { anbieten, kaufen, zuruecknehmen, store: () => store } };
