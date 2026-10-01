"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Antworten absichtlich vertauschen, ohne Browser oder echte Kontodaten.
function ladenUi() {
  const anfragen = [], ereignisse = {}, meldungen = [];
  const inhalt = { innerHTML: "" }, titel = { textContent: "" };
  const wurzel = {
    dataset: {},
    querySelector: (s) => s === ".ld-inhalt" ? inhalt : titel,
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { ereignisse[name] = fn; },
  };
  let screen;
  const Casino = {
    socket: { emit: (name, daten, antwort) => anfragen.push({ name, daten, antwort }), on() {} },
    toast: (text) => meldungen.push(text), escapeHtml: (v) => String(v),
    screens: { register: (_name, s) => { screen = s; }, current: () => "lobby" },
    getAccount: () => ({}),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/laeden.js"), "utf8"), {
    window: { Casino }, document: { querySelector: () => wurzel },
  });
  function klicke(selector, dataset) {
    ereignisse.click({ target: { closest: (s) => s === selector ? { dataset } : null } });
  }
  return { anfragen, inhalt, meldungen, start: () => screen.onEnter(),
    wechseln: (laden) => klicke(".ld-tab", { laden }),
    vormerken: (id) => klicke("[data-vormerken]", { vormerken: id }),
    kaufen: (id) => klicke("[data-kauf]", { kauf: id }) };
}

const zoo = { ok: true, laden: "zoo", bis: Date.now() + 100000, stuecke: [], alle: [], namen: {} };
const kiosk = { ok: true, laden: "kiosk", stuecke: [] };

test("verspätete Ladenfehler überschreiben keinen neu geöffneten Laden", () => {
  const ui = ladenUi();
  ui.start();
  const alt = ui.anfragen.at(-1);
  ui.wechseln("kiosk");
  ui.anfragen.at(-1).antwort(kiosk);
  const vorher = ui.inhalt.innerHTML;
  alt.antwort({ ok: false, error: "Alte Anfrage" });
  assert.equal(ui.inhalt.innerHTML, vorher);
  assert.match(vorher, /Spezi ist kalt/);
});

test("auch beim Zurückwechseln gewinnt der neueste Ladenaufruf", () => {
  const ui = ladenUi();
  ui.start();
  const alt = ui.anfragen.at(-1);
  ui.wechseln("kiosk");
  ui.wechseln("zoo");
  ui.anfragen.at(-1).antwort(zoo);
  const vorher = ui.inhalt.innerHTML;
  alt.antwort({ ok: false, error: "Veralteter Zoo" });
  assert.equal(ui.inhalt.innerHTML, vorher);
});

test("Zoo-Vormerkung im Hintergrund ersetzt nicht den Kiosk", () => {
  const ui = ladenUi();
  ui.start();
  ui.anfragen.at(-1).antwort(zoo);
  ui.vormerken("taube");
  const vormerkung = ui.anfragen.at(-1);
  ui.wechseln("kiosk");
  ui.anfragen.at(-1).antwort(kiosk);
  const vorher = ui.inhalt.innerHTML;
  vormerkung.antwort({ ...zoo, label: "Stadttaube", vorgemerkt: "taube" });
  assert.equal(ui.inhalt.innerHTML, vorher);
  assert.match(ui.meldungen.at(-1), /Stadttaube ist vorgemerkt/);
});

test("Kaufantwort nach Ladenwechsel zeichnet keine fremden Waren", async () => {
  const ui = ladenUi();
  ui.start();
  ui.wechseln("kiosk");
  ui.anfragen.at(-1).antwort({ ...kiosk, stuecke: [{ id: "spezi", label: "Spezi", preis: 5000 }] });
  ui.kaufen("spezi");
  const kauf = ui.anfragen.at(-1);
  assert.equal(kauf.name, "laden:kaufen");
  ui.wechseln("zoo");
  ui.anfragen.at(-1).antwort(zoo);
  const vorher = ui.inhalt.innerHTML;
  kauf.antwort({ ...kiosk, label: "Spezi" });
  assert.equal(ui.inhalt.innerHTML, vorher);
  assert.equal(ui.meldungen.at(-1), "Spezi ist in deiner Hand.");
});
