"use strict";

/**
 * Simulierte Börse, für alle dieselbe.
 *
 * Eine Handvoll ausgedachter Firmen, deren Kurse sich bei jedem Takt zufällig
 * bewegen, ab und zu mit Nachrichten-Schocks. Fällt ein Kurs unter 12 % seines
 * Ausgabekurses, ist die Firma pleite: alle Positionen darin werden zum
 * letzten Kurs abgerechnet, und eine neue Firma rückt nach.
 *
 * Man eröffnet Long oder Short Positionen mit Einschuss und Hebel (Daytrading
 * oder halten). Wert = Einschuss + Richtung × (Kurs − Einstieg) × Stückzahl.
 * Fällt der Wert auf 0, wird die Position liquidiert (Einschuss weg). Gewinn
 * und Verlust entstehen gegen den Markt, wie bei den Casinospielen. Gespeichert
 * in data/stocks.json.
 *
 * DER KURS HAT KEINE RICHTUNG. Das ist die eine Regel, an der alles hängt.
 * Im Mittel steht er nach jedem Takt da, wo er vorher stand; dann gibt es
 * keine Spielweise (long, short, früh raus, lange halten), die im Schnitt
 * gewinnt. Vorher hatte er zwei eingebaute Richtungen, die nicht
 * zueinander passten: einen Drift nach oben und eine Pleite aus heiterem
 * Himmel (0,25 % je Takt, also rund 35 Mal am Tag je Aktie). Wer short
 * ging, bekam bei jeder dieser Pleiten das Hebelfache ausgezahlt und
 * verdoppelte seinen Einsatz im Schnitt alle Viertelstunde.
 *
 * Ein Rest bleibt, und den deckt die Ordergebühr (SPREAD): springt der Kurs
 * über die Liquidation hinaus, verliert man trotzdem nur den Einschuss,
 * während ein Sprung in die andere Richtung voll zählt. Gemessen ist dieser
 * Vorteil höchstens 0,76 % des Positionswerts. tests/boerse.test.js rechnet
 * beides nach; wer hier eine Zahl ändert, sieht dort, ob es noch hält.
 */

const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "stocks.json");

const MAX_LEVERAGE = 5;
const HISTORY_LEN = 40;

/* Grenzen je Position. Vorher gab es nur die Untergrenze: wer wollte, legte
   Millionen in eine einzige Wette. 100.000 ist derselbe Deckel wie bei Pinco
   und beim Gesamteinsatz je Pferderennen. */
const MIN_MARGIN = 1000;
const MAX_MARGIN = 100_000;
// So viele Positionen darf ein Konto gleichzeitig offen haben. Ohne die Zahl
// wäre der Deckel je Position mit zwanzig kleinen Positionen umgangen.
const MAX_OFFEN = 5;
/* Deckel auf die Auszahlung einer Position, wie bei Mines, Towers und
   Higher/Lower. Ein Kurs kann sich ohne Grenze nach oben vervielfachen, und
   mit Hebel 5 wäre ein einziger Ausreißer mehr, als im Haus im Umlauf ist. */
const MAX_WIN = 2_000_000;
/* Ordergebühr: man steigt um diesen Anteil schlechter ein, als der Kurs
   steht. Auf den Einschuss gerechnet kostet das Hebel mal 1,5 %. Sie muss
   über dem Sprungvorteil liegen (siehe Kopf der Datei), sonst lohnt sich
   Hebeln wieder im Schnitt. */
const SPREAD = 0.015;
// Unter diesem Anteil des Ausgabekurses ist eine Firma pleite.
const PLEITE_GRENZE = 0.12;
/* Wie stark sich ein Kurs je Takt (6 Sekunden) höchstens bewegt, je Klasse:
   ruhig, mittel, wild. Vorher 2,5 / 4,5 / 9 %: damit war jede gehebelte
   Position nach Minuten liquidiert und jede Aktie nach Stunden pleite. In
   einer Runde, die versetzt spielt, soll man eine Position auch über Nacht
   halten können. Jetzt lebt eine Aktie im Mittel fünf bis zwanzig Tage. */
const SCHWANKUNG = [0.004, 0.007, 0.012];
const SCHWANKUNG_IPO = 0.007;
/* Nachrichten: wie oft je Takt und Aktie, und wie groß der Sprung ist
   (NEWS_MIN bis NEWS_MIN + NEWS_SPANNE). Vorher 4 % je Takt und 5 bis 23 %;
   die großen Sprünge sind es, die den Sprungvorteil treiben. */
const NEWS_CHANCE = 0.005;
const NEWS_MIN = 0.02, NEWS_SPANNE = 0.04;
/* Gespeicherte Aktien tragen noch die alte Schwankung. Beim Laden wird sie
   einmal auf die neue Klasse umgeschrieben. */
const ALTE_SCHWANKUNG = { 0.025: SCHWANKUNG[0], 0.045: SCHWANKUNG[1], 0.09: SCHWANKUNG[2], 0.05: SCHWANKUNG_IPO };

const COMPANY_NAMES = [
  "LuckyDip Casinos", "MoonCoin", "ChipWorks", "FizzPop Drinks", "RockSolid Mining",
  "ByteForge Tech", "AeroNova", "GreenLeaf Farms", "Vortex Motors", "Solaris Energy",
  "PixelPlay Games", "IronClad Steel", "NimbusCloud", "DeepBlue Foods", "QuantumLeap",
];

/* `vergeben` sind die Namen, die schon an der Tafel stehen. Vorher wurde
   blind gezogen, und zwei Kürzel konnten dieselbe Firma heißen. */
function newCompany(sym, seed, vergeben = new Set()) {
  const tiers = [
    { vol: SCHWANKUNG[0], price: [60, 220] },   // ruhig
    { vol: SCHWANKUNG[1], price: [80, 320] },   // mittel
    { vol: SCHWANKUNG[2], price: [30, 120] },   // wild
  ];
  const t = tiers[seed % tiers.length];
  const price = Math.round(t.price[0] + Math.random() * (t.price[1] - t.price[0]));
  const frei = COMPANY_NAMES.filter((n) => !vergeben.has(n));
  const namen = frei.length ? frei : COMPANY_NAMES;
  return {
    sym,
    name: namen[Math.floor(Math.random() * namen.length)],
    price, basePrice: price, vol: t.vol,
    history: [price], bankrupt: false,
  };
}

let market = load();

/* Fehlt die Datei, ist ein neuer Markt richtig. Ist sie da und kaputt,
   bricht der Start ab: sonst ersetzte der nächste save() alle offenen
   Positionen still durch einen leeren Markt, samt den Chips darin. */
function load() {
  let roh;
  try {
    roh = fs.readFileSync(FILE, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return generate();
    throw new Error(`[stocks] ${FILE} ist nicht lesbar: ${e.message}`);
  }
  let m;
  try { m = JSON.parse(roh); } catch (e) { throw new Error(`[stocks] ${FILE} ist beschädigt: ${e.message}`); }
  if (!m || typeof m !== "object" || !m.stocks || !m.positions) throw new Error(`[stocks] ${FILE} hat keine Kurse oder Positionen.`);
  for (const s of Object.values(m.stocks)) {
    if (ALTE_SCHWANKUNG[s.vol]) s.vol = ALTE_SCHWANKUNG[s.vol];
    delete s.drift;
  }
  return m;
}

/* Über eine Kopie und Umbenennen (buchungen.sicherSchreiben): ein Abbruch
   mitten im Schreiben lässt die alte Datei ganz, statt sie halb zu
   überschreiben. Ein Fehler wird gemeldet, nicht verschluckt. */
function save() {
  try {
    require("./buchungen").sicherSchreiben(FILE, JSON.stringify(market));
  } catch (e) {
    console.error("[stocks] speichern fehlgeschlagen:", e.message);
  }
}

function generate() {
  const syms = ["LUCK", "MOON", "CHIP", "FIZZ", "ROCK", "BYTE"];
  const stocks = {};
  const vergeben = new Set();
  syms.forEach((s, i) => {
    stocks[s] = newCompany(s, i, vergeben);
    vergeben.add(stocks[s].name);
  });
  return { stocks, positions: {}, nextId: 1, news: [] };
}

// Trading helpers
function priceOf(sym) {
  const s = market.stocks[sym];
  return s ? s.price : 0;
}

/** Wert einer Position zum aktuellen Kurs (was man zurückbekäme). */
function equity(pos) {
  const price = priceOf(pos.sym);
  const pnl = pos.dir * (price - pos.entry) * pos.shares;
  return pos.margin + pnl;
}

/** Was eine Position jetzt auszahlen würde: nie unter null, nie über dem Deckel. */
function wert(pos) {
  return Math.min(MAX_WIN, Math.max(0, equity(pos)));
}

/**
 * Ein Takt für eine Aktie. Beide Bewegungen sind im Mittel null: die
 * Schwankung ist nach oben und unten gleich groß, und eine Nachricht geht
 * mit derselben Wahrscheinlichkeit um denselben Anteil rauf wie runter.
 * Gibt die Nachricht zurück, falls es eine gab.
 */
function kursSchritt(s) {
  const shock = (Math.random() * 2 - 1) * s.vol;
  s.price = Math.max(0.01, s.price * (1 + shock));
  if (Math.random() >= NEWS_CHANCE) return null;
  const up = Math.random() < 0.5;
  const mag = NEWS_MIN + Math.random() * NEWS_SPANNE;
  s.price = Math.max(0.01, s.price * (up ? 1 + mag : 1 - mag));
  return { up, mag };
}

function pushNews(text) {
  market.news.unshift({ text, at: Date.now() });
  if (market.news.length > 8) market.news.pop();
}

// Markttakt
// Gibt { liquidated: [{owner, sym, margin}], bankruptcies: [sym] } zurück,
// damit der Aufrufer die Spieler benachrichtigen kann.
function tick() {
  const liquidated = [];
  const bankruptcies = [];

  for (const sym of Object.keys(market.stocks)) {
    const s = market.stocks[sym];
    const nachricht = kursSchritt(s);
    if (nachricht) {
      const { up, mag } = nachricht;
      pushNews(`${up ? "▲" : "▼"}${s.name} (${sym}) ${up ? "+" : "−"}${Math.round(mag * 100)} %`);
    }

    /* Pleite nur noch über den Kursverfall. Der Kurs bleibt dabei stehen,
       wo er ist: zu genau diesem Kurs werden unten alle Positionen
       abgerechnet. Vorher sprang er auf null, und dieser Sprung war
       geschenktes Geld für jeden, der kurz vor der Grenze short ging. */
    if (!s.bankrupt && s.price < s.basePrice * PLEITE_GRENZE) {
      s.bankrupt = true;
      pushNews(`${s.name} (${sym}) ist pleite.`);
      bankruptcies.push(sym);
    }
    s.history.push(Math.round(s.price * 100) / 100);
    if (s.history.length > HISTORY_LEN) s.history.shift();
  }

  // Positionen auflösen: bei Pleite oder Wert <= 0 liquidieren.
  for (const id of Object.keys(market.positions)) {
    const pos = market.positions[id];
    const s = market.stocks[pos.sym];
    if (!s) { delete market.positions[id]; continue; }
    if (s.bankrupt) {
      // Long wie Short bekommen, was die Position zum letzten Kurs wert ist.
      // Für einen Long ist das wenig oder nichts, für einen Short sein Gewinn.
      liquidated.push({ owner: pos.owner, sym: pos.sym, payout: Math.round(wert(pos)), margin: pos.margin, pleite: true });
      delete market.positions[id];
      continue;
    }
    if (equity(pos) <= 0) {
      liquidated.push({ owner: pos.owner, sym: pos.sym, payout: 0, margin: pos.margin });
      delete market.positions[id];
    }
  }

  // Nach einer Pleite: ausgedachte Firmen neu listen, Börsengänge von Spielern streichen.
  for (const sym of bankruptcies) {
    if (market.stocks[sym] && market.stocks[sym].ipo) delete market.stocks[sym];
    else {
      const seed = Object.keys(market.stocks).indexOf(sym);
      const vergeben = new Set(Object.values(market.stocks).map((x) => x.name));
      market.stocks[sym] = newCompany(sym, seed < 0 ? 0 : seed, vergeben);
    }
  }

  save();
  return { liquidated, bankruptcies };
}

// Public views
function publicStocks() {
  return Object.values(market.stocks).map((s) => {
    const prev = s.history.length > 1 ? s.history[s.history.length - 2] : s.price;
    const changePct = prev > 0 ? ((s.price - prev) / prev) * 100 : 0;
    return {
      sym: s.sym, name: s.name,
      price: Math.round(s.price * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      vol: s.vol, history: s.history.slice(-30), bankrupt: s.bankrupt,
    };
  });
}

function positionsFor(key) {
  return Object.entries(market.positions)
    .filter(([, p]) => p.owner === key)
    .map(([id, p]) => ({
      id, sym: p.sym, dir: p.dir, lev: p.lev, margin: p.margin,
      entry: Math.round(p.entry * 100) / 100,
      price: Math.round(priceOf(p.sym) * 100) / 100,
      shares: Math.round(p.shares * 1000) / 1000,
      equity: Math.round(wert(p)),
      pnl: Math.round(wert(p) - p.margin),
      // Am Deckel bringt Warten nichts mehr; der Client sagt das dazu.
      gedeckelt: equity(p) >= MAX_WIN,
    }));
}

/** Wie viele Chips in den offenen Positionen eines Spielers stecken (fürs Vermögen). */
function portfolioValue(key) {
  let v = 0;
  for (const p of Object.values(market.positions)) if (p.owner === key) v += wert(p);
  return Math.round(v);
}

// Mutations
function open(key, sym, dir, margin, lev) {
  const s = market.stocks[sym];
  if (!s || s.bankrupt) return { ok: false, error: "Aktie nicht handelbar." };
  margin = Math.floor(Number(margin));
  lev = Math.floor(Number(lev));
  if (!Number.isFinite(margin) || margin < MIN_MARGIN) return { ok: false, error: `Mindest-Einsatz ${MIN_MARGIN.toLocaleString("de-DE")} Chips.` };
  if (margin > MAX_MARGIN) return { ok: false, error: `Höchstens ${MAX_MARGIN.toLocaleString("de-DE")} Chips je Position.` };
  if (!Number.isFinite(lev) || lev < 1 || lev > MAX_LEVERAGE) return { ok: false, error: `Hebel zwischen 1 und ${MAX_LEVERAGE}.` };
  const offen = Object.values(market.positions).filter((p) => p.owner === key).length;
  if (offen >= MAX_OFFEN) return { ok: false, error: `Höchstens ${MAX_OFFEN} offene Positionen. Schließ erst eine.` };
  dir = dir < 0 ? -1 : 1;
  // Die Ordergebühr: ein Long kauft über dem Kurs, ein Short verkauft darunter.
  const entry = s.price * (1 + dir * SPREAD);
  const shares = (margin * lev) / entry;
  const id = String(market.nextId++);
  market.positions[id] = { owner: key, sym, dir, entry, shares, margin, lev, openedAt: Date.now() };
  save();
  return { ok: true, cost: margin, id };
}

function close(key, id) {
  const pos = market.positions[id];
  if (!pos) return { ok: false, error: "Position nicht gefunden." };
  if (pos.owner !== key) return { ok: false, error: "Nicht deine Position." };
  const payout = Math.round(wert(pos));
  delete market.positions[id];
  save();
  return { ok: true, payout, margin: pos.margin };
}

// Socket wiring
function setupStocks(io, accounts) {
  function snapshot(key) {
    return {
      stocks: publicStocks(), positions: positionsFor(key), news: market.news.slice(0, 6), maxLeverage: MAX_LEVERAGE,
      // Grenzen und Gebühr kommen von hier; der Client zeigt und prüft nur damit.
      regeln: { minMargin: MIN_MARGIN, maxMargin: MAX_MARGIN, maxOffen: MAX_OFFEN, maxWin: MAX_WIN, spread: SPREAD, pleiteGrenze: PLEITE_GRENZE },
    };
  }

  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    socket.on("stocks:state", (ack) => {
      if (typeof ack !== "function") return;
      ack({ ok: true, ...snapshot(key() || null) });
    });

    socket.on("stocks:open", ({ sym, dir, margin, lev } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = key() && accounts.get(key());
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      const cost = Math.floor(Number(margin));
      if (!Number.isFinite(cost) || cost < 1000) return ack({ ok: false, error: "Ungültiger Einsatz." });
      if (cost > acc.chips) return ack({ ok: false, error: "Nicht genug Chips." });
      /* Erst abbuchen und das Konto SOFORT sichern, dann die Position anlegen.
         Vorher lag die Position sofort auf der Platte, die Abbuchung erst mit
         dem gebündelten Speichern bis zu 250 ms später: ein Neustart in diesem
         Fenster schenkte die Position. So kann ein Abbruch höchstens kosten,
         nie drucken. */
      const res = accounts.adjustChips(key(), -cost);
      if (!res.ok) return ack({ ok: false, error: res.error });
      try { accounts.saveJetzt(); } catch {}
      const r = open(key(), sym, dir, cost, lev);
      if (!r.ok) {
        const zurueck = accounts.adjustChips(key(), cost);
        try { accounts.saveJetzt(); } catch {}
        return ack({ ...r, account: zurueck.account });
      }
      ack({ ok: true, account: res.account, ...snapshot(key()) });
    });

    socket.on("stocks:close", ({ id } = {}, ack) => {
      if (typeof ack !== "function") return;
      const acc = key() && accounts.get(key());
      if (!acc) return ack({ ok: false, error: "Nicht eingeloggt." });
      // Die Position ist schon weg (close speichert sofort); die Auszahlung jetzt auch sofort sichern.
      const r = close(key(), id);
      if (!r.ok) return ack(r);
      const res = accounts.adjustChips(key(), r.payout);
      try { accounts.saveJetzt(); } catch {}
      ack({ ok: true, payout: r.payout, margin: r.margin, account: res.account, ...snapshot(key()) });
    });
  });

  // Der Markt lebt: Kurse bewegen, bei einer Pleite zum letzten Kurs abrechnen,
  // Liquidierte benachrichtigen und allen den neuen Stand schicken.
  setInterval(() => {
    const { liquidated } = tick();
    let gezahlt = false;
    for (const ev of liquidated) {
      if (ev.payout > 0) { accounts.adjustChips(ev.owner, ev.payout); gezahlt = true; } // Abrechnung nach einer Pleite
    }
    // Die Positionen sind schon aus der Datei; die Auszahlungen dazu gleich sichern.
    if (gezahlt) { try { accounts.saveJetzt(); } catch {} }
    for (const s of io.of("/").sockets.values()) {
      const k = s.data && s.data.account;
      const mine = liquidated.filter((e) => e.owner === k);
      if (mine.length) {
        const lost = mine.filter((e) => e.payout === 0).reduce((a, e) => a + e.margin, 0);
        const won = mine.filter((e) => e.payout > 0).reduce((a, e) => a + e.payout, 0);
        s.emit("stocks:liquidated", { lost, won, account: accounts.publicAccount(accounts.get(k)) });
      }
      s.emit("stocks:update");
    }
  }, 6000);
}

/** Firma eines Spielers an die Börse bringen. Gibt { ok, sym } zurück. */
function ipo(key, name, seedPrice) {
  const base = (name || "CO").replace(/[^A-Za-z]/g, "").toUpperCase();
  let sym = (base.slice(0, 4) || "CO");
  let n = 1;
  while (market.stocks[sym]) sym = (base.slice(0, 3) || "CO") + (n++);
  const price = Math.max(20, Math.round(seedPrice || 100));
  market.stocks[sym] = {
    sym, name, price, basePrice: price,
    vol: SCHWANKUNG_IPO, history: [price], bankrupt: false,
    ipo: true, founder: key,
  };
  pushNews(`${name} (${sym}) ist an die Börse gegangen.`);
  save();
  return { ok: true, sym };
}

/**
 * Eine boersennotierte Firma traegt den Namen ihres Gruenders ("X Kiosk AG").
 * Das Kuerzel bleibt, wie es ist: daran haengen die Depots aller anderen.
 */
function umbenennen(key, alt, neu) {
  let n = 0;
  const a = String(alt || "").trim();
  if (!a) return 0;
  for (const s of Object.values(market.stocks || {})) {
    if (s && s.ipo && s.founder === key && typeof s.name === "string" && s.name.startsWith(a)) {
      s.name = neu + s.name.slice(a.length);
      n++;
    }
  }
  if (n) save();
  return n;
}

module.exports = {
  umbenennen,
  MAX_LEVERAGE, tick, publicStocks, positionsFor, portfolioValue, open, close, ipo, setupStocks,
  // Für tests/boerse.test.js.
  _intern: { kursSchritt, wert, markt: () => market, MIN_MARGIN, MAX_MARGIN, MAX_OFFEN, MAX_WIN, SPREAD, PLEITE_GRENZE, SCHWANKUNG, NEWS_MIN, NEWS_SPANNE },
};
