"use strict";

/**
 * Marktplatz für Firmenprodukte zwischen Spielern.
 *
 * Ein gekauftes Produkt (game/economy.js, city.buyProduct) landet als Gegenstand
 * im Inventar. Von dort kann man es benutzen (verbrauchen, gibt einen Bonus)
 * oder zu einem eigenen Preis anbieten. Käufer kaufen aus den Angeboten, die
 * Chips gehen an den Verkäufer. Angebote liegen in data/market.json.
 */

const path = require("path");
const fs = require("fs");
const city = require("./city");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "market.json");

// Produktdaten nach Gegenstand (aus dem Gebäudekatalog der Stadt).
const PRODUCTS = {};
// Alt: die Bonus-Produkte gibt es nicht mehr (Gebäude geben Boni jetzt direkt),
// der Katalog ist deshalb leer und nur noch da, damit alte Inventare nicht abstürzen.
for (const t of Object.values(city.BUILDING_TYPES || {}))
  if (t.products) for (const p of t.products) PRODUCTS[p.key] = p;

let store = load();
function load() {
  try {
    const m = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (m && m.offers) return m;
  } catch {}
  return { offers: {}, nextId: 1 };
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store, null, 2)); } catch {}
}

function publicOffers() {
  return Object.entries(store.offers).map(([id, o]) => {
    const p = PRODUCTS[o.key];
    return { id, key: o.key, price: o.price, seller: o.sellerName, emoji: p ? p.emoji : "❓", name: p ? p.name : o.key, desc: p ? p.desc : "" };
  }).sort((a, b) => a.price - b.price);
}

function inventoryView(name, accounts) {
  const inv = accounts.getInventory(name);
  return Object.entries(inv).map(([key, count]) => {
    const p = PRODUCTS[key];
    return { key, count, emoji: p ? p.emoji : "❓", name: p ? p.name : key, desc: p ? p.desc : "", mins: p ? p.mins : 0, suggested: p ? p.price : 0 };
  });
}

function setupMarket(io, accounts) {
  io.on("connection", (socket) => {
    const key = () => socket.data.account;

    socket.on("market:state", (ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      ack({ ok: true, inventory: inventoryView(key(), accounts), offers: publicOffers() });
    });

    socket.on("item:use", ({ itemKey } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      const p = PRODUCTS[itemKey];
      if (!p) return ack({ ok: false, error: "Unbekanntes Item." });
      if (!accounts.removeItem(key(), itemKey, 1)) return ack({ ok: false, error: "Hast du nicht." });
      accounts.grantBuff(key(), p.buff, p.mins, p.mult);
      ack({ ok: true, product: p, account: accounts.publicAccount(accounts.get(key())), inventory: inventoryView(key(), accounts) });
    });

    socket.on("item:list", ({ itemKey, price } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      if (!PRODUCTS[itemKey]) return ack({ ok: false, error: "Unbekanntes Item." });
      price = Math.floor(Number(price));
      if (!Number.isFinite(price) || price < 1) return ack({ ok: false, error: "Ungültiger Preis." });
      if (!accounts.removeItem(key(), itemKey, 1)) return ack({ ok: false, error: "Hast du nicht." });
      const id = String(store.nextId++);
      store.offers[id] = { key: itemKey, price, seller: key(), sellerName: accounts.get(key()).name };
      save();
      io.emit("market:update");
      ack({ ok: true, inventory: inventoryView(key(), accounts), offers: publicOffers() });
    });

    socket.on("item:unlist", ({ offerId } = {}, ack) => {
      if (typeof ack !== "function") return;
      const o = store.offers[offerId];
      if (!o) return ack({ ok: false, error: "Angebot weg." });
      if (o.seller !== key()) return ack({ ok: false, error: "Nicht dein Angebot." });
      accounts.addItem(key(), o.key, 1); // zurück ins Inventar
      delete store.offers[offerId];
      save();
      io.emit("market:update");
      ack({ ok: true, inventory: inventoryView(key(), accounts), offers: publicOffers() });
    });

    socket.on("market:buy", ({ offerId } = {}, ack) => {
      if (typeof ack !== "function") return;
      if (!key()) return ack({ ok: false, error: "Nicht eingeloggt." });
      const o = store.offers[offerId];
      if (!o) return ack({ ok: false, error: "Angebot nicht mehr verfügbar." });
      if (o.seller === key()) return ack({ ok: false, error: "Das ist dein eigenes Angebot." });
      const buyer = accounts.get(key());
      if (buyer.chips < o.price) return ack({ ok: false, error: "Nicht genug Chips." });
      const res = accounts.adjustChips(key(), -o.price);
      accounts.adjustChips(o.seller, o.price); // Verkäufer bezahlen
      accounts.addItem(key(), o.key, 1);
      delete store.offers[offerId];
      save();
      io.emit("market:update");
      ack({ ok: true, account: res.account, inventory: inventoryView(key(), accounts), offers: publicOffers() });
    });
  });
}

module.exports = { setupMarket };
