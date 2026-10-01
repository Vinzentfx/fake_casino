"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../public/js/welt/raeume.js");
const { pruefeZug, saubereGrundform } = require("../game/welt");

/* Alle Punkte, die man vom Eingang aus zu Fuß erreicht, auf einem feinen
   Raster. Damit fällt auf, wenn ein neues Möbelstück einen Durchgang
   zustellt oder ein Automat nur noch von innerhalb der Wand erreichbar ist. */
function erreichbar(raum, von) {
  const S = 0.1;
  const key = (x, y) => `${Math.round(x / S)}:${Math.round(y / S)}`;
  const gesehen = new Set([key(von.x, von.y)]);
  const offen = [[von.x, von.y]];
  const punkte = [];
  while (offen.length) {
    const [x, y] = offen.pop();
    punkte.push([x, y]);
    for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const nx = +(x + dx).toFixed(2), ny = +(y + dy).toFixed(2);
      const k = key(nx, ny);
      if (gesehen.has(k) || !R.begehbar(raum, nx, ny)) continue;
      gesehen.add(k);
      offen.push([nx, ny]);
    }
  }
  return punkte;
}

test("jedes benutzbare Ding, jeder Sitz und jede Tür ist zu Fuß erreichbar", () => {
  for (const raum of Object.values(R.RAEUME)) {
    const punkte = erreichbar(raum, raum.start);
    // Anzeigen mit Reichweite null tippt man aus der Ferne an, zu Fuß muss man nicht hin.
    for (const d of raum.dinge.filter((x) => x.ziel && R.reichweite(x) > 0)) {
      const ok = punkte.some(([x, y]) => R.abstandZuDing(d, x, y) <= R.reichweite(d));
      assert.ok(ok, `${raum.id}/${d.id} ist nicht erreichbar`);
      // Und von dort, wo man steht, meint die Welt auch dieses Ding.
      const treffer = punkte.some(([x, y]) => R.naechstesDing(raum, x, y) === d);
      assert.ok(treffer, `${raum.id}/${d.id} wird immer von einem anderen Ding verdeckt`);
    }
    for (const t of raum.tueren.filter((x) => !x.versteckt)) {
      assert.ok(punkte.some(([x, y]) => R.inTuer(t, x, y)), `${raum.id}/${t.id} ist nicht erreichbar`);
    }
    for (const s of raum.sitze) {
      assert.ok(punkte.some(([x, y]) => Math.hypot(x - s.auf.x, y - s.auf.y) < 0.15), `${raum.id}/${s.id} ist nicht erreichbar`);
    }
  }
});

function figur(x, y, extra = {}) {
  return { raum: "casino", x, y, t: 0, budget: 0, sitzt: null, ...extra };
}

test("ein normaler Schritt geht durch, ein Sprung nicht", () => {
  assert.equal(pruefeZug(figur(10, 11), 10, 10.6, 100).ok, true);
  // Zehn Kacheln in einer Zehntelsekunde ist kein Gehen.
  assert.equal(pruefeZug(figur(10, 11), 10, 4, 100).ok, false);
});

test("gebündelt ankommende Züge dürfen aufholen, aber nur begrenzt", () => {
  const f = figur(10, 11.5);
  let t = 0;
  // 300 ms nichts, dann drei Züge im selben Augenblick.
  t += 300;
  for (const y of [11.1, 10.7, 10.3]) {
    const r = pruefeZug(f, 10, y, t);
    assert.equal(r.ok, true, `Zug nach ${y}`);
    f.y = y; f.t = t; f.budget = r.budget;
  }
  // Ein vierter ohne vergangene Zeit ist zu viel.
  assert.equal(pruefeZug(f, 10, 9.4, t).ok, false);
});

test("durch Wände und Tische führt kein Weg", () => {
  // In die Rückwand hinein.
  assert.equal(pruefeZug(figur(10, 3.5, { budget: 2 }), 10, 2.2, 0).ok, false);
  // Quer über den Rouletttisch, obwohl beide Enden frei sind.
  assert.equal(R.begehbar(R.raum("casino"), 9.8, 5.9), true);
  assert.equal(R.begehbar(R.raum("casino"), 9.8, 8.2), true);
  assert.equal(pruefeZug(figur(9.8, 5.9, { budget: 2.4, t: 0 }), 9.8, 8.2, 10).ok, false);
});

test("viele winzige Züge erzeugen kein zusätzliches Bewegungsbudget", () => {
  const f = figur(10, 11.5);
  let strecke = 0;
  for (let i = 0; i < 100; i++) {
    const r = pruefeZug(f, 10, f.y - 0.04, 0);
    f.budget = r.budget;
    if (r.ok) { f.y -= 0.04; strecke += 0.04; }
  }
  assert.ok(strecke <= 0.05, `Ohne Zeit sind ${strecke} Kacheln möglich`);
  assert.equal(pruefeZug(f, 10, f.y - 0.3, 100).ok, true, "normales Gehen füllt das Budget wieder auf");
});

test("wer sitzt, steht vor dem Sitz auf", () => {
  const sofa = R.raum("casino").sitze[0];
  const f = figur(sofa.x, sofa.y, { sitzt: sofa.id, t: 0 });
  assert.equal(pruefeZug(f, sofa.auf.x + 0.3, sofa.auf.y, 200).ok, true);
});

test("die Grundform nimmt nur ganze Zahlen im Bereich an", () => {
  assert.deepEqual(saubereGrundform({ haut: 2, haar: 99, frisur: -1, hose: "3" }), { haut: 2, haar: 0, frisur: 0, hose: 3 });
  assert.deepEqual(saubereGrundform(null), { haut: 0, haar: 0, frisur: 0, hose: 0 });
  assert.deepEqual(saubereGrundform({ haut: 1.5 }).haut, 0);
});

/* Ein kleiner Nachbau von Socket.IO, gerade genug für game/welt.js:
   Räume, except, volatile und die Liste aller Sockets. Kosmetik und
   Freigabe werden durch Attrappen ersetzt, damit der Test keine
   Spielstände aus data/ liest. */
function aufbau() {
  const pfad = (m) => require.resolve("../game/" + m);
  const alt = {};
  for (const m of ["cosmetics", "verification"]) alt[m] = require.cache[pfad(m)];
  require.cache[pfad("cosmetics")] = { id: pfad("cosmetics"), filename: pfad("cosmetics"), loaded: true,
    exports: { publicLook: (acc) => ({ avatar: "🙂", nameStyle: acc.nameStyle || null }), label: (art, id) => id, grant: () => true } };
  require.cache[pfad("verification")] = { id: pfad("verification"), filename: pfad("verification"), loaded: true,
    exports: { state: () => null } };
  delete require.cache[pfad("welt")];
  const { setupWelt } = require("../game/welt");

  const sockets = new Map();
  let verbinde = null;
  const zustellen = (raum, ausser, ev, daten) => {
    for (const s of sockets.values()) if (s.rooms.has(raum) && !ausser.includes(s.id)) s.eingang.push([ev, daten]);
  };
  const io = {
    on(ev, fn) { if (ev === "connection") verbinde = fn; },
    of() { return { sockets }; },
    to(raum) {
      const ziel = { ausser: [], except(ids) { this.ausser = ids; return this; }, emit(ev, d) { zustellen(raum, this.ausser, ev, d); } };
      return ziel;
    },
  };
  const konten = { anna: { name: "Anna" }, bert: { name: "Bert" } };
  const accounts = { get: (k) => konten[k], save() {}, publicAccount: (a) => ({ name: a.name }) };
  const welt = setupWelt(io, accounts);
  let nr = 0;
  function neuerSocket(account) {
    const s = {
      id: "s" + ++nr, data: { account }, rooms: new Set(), handler: new Map(), eingang: [],
      on(ev, fn) { (this.handler.get(ev) || this.handler.set(ev, []).get(ev)).push(fn); },
      emit(ev, d) { this.eingang.push([ev, d]); },
      join(r) { this.rooms.add(r); }, leave(r) { this.rooms.delete(r); },
      to(raum) { const self = this; const z = { emit(ev, d) { zustellen(raum, [self.id], ev, d); } }; z.volatile = z; return z; },
      rufe(ev, ...args) { for (const fn of this.handler.get(ev) || []) fn(...args); },
      frage(ev, daten) { let antwort; this.rufe(ev, daten, (r) => { antwort = r; }); return antwort; },
      trenne() { this.rufe("disconnect"); sockets.delete(this.id); },
      hat(ev) { return this.eingang.filter(([e]) => e === ev).map(([, d]) => d); },
    };
    s.rooms.add(s.id);
    sockets.set(s.id, s);
    verbinde(s);
    return s;
  }
  const aufraeumen = () => {
    for (const m of ["cosmetics", "verification"]) {
      if (alt[m]) require.cache[pfad(m)] = alt[m]; else delete require.cache[pfad(m)];
    }
    delete require.cache[pfad("welt")];
  };
  return { neuerSocket, welt, aufraeumen, kontoVon: (k) => konten[k] };
}

test("zwei Tabs, eine Figur: sichtbar bis der letzte Tab geht", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const bert = w.neuerSocket("bert");
  assert.equal(bert.frage("welt:betreten", {}).ok, true);
  const a1 = w.neuerSocket("anna");
  const a2 = w.neuerSocket("anna");
  const erst = a1.frage("welt:betreten", {});
  const zweit = a2.frage("welt:betreten", {});
  assert.equal(erst.ich, zweit.ich, "beide Tabs steuern dieselbe Figur");
  assert.equal(bert.hat("welt:rein").length, 1, "Bert sieht Anna genau einmal kommen");
  assert.equal(erst.spieler.length, 1);
  a1.trenne();
  assert.equal(bert.hat("welt:raus").length, 0, "ein Tab ist noch offen");
  a2.trenne();
  assert.equal(bert.hat("welt:raus").length, 1, "jetzt ist Anna weg");
});

test("gültige Züge gehen an die anderen, ungültige bekommen eine Korrektur", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  const fig = w.welt.figuren.get("anna");
  fig.t = Date.now() - 300;
  anna.rufe("welt:zug", { x: fig.x, y: fig.y - 0.4, d: "hoch", g: 1 });
  assert.equal(bert.hat("welt:z").length, 1);
  anna.rufe("welt:zug", { x: 9.8, y: 7.0, d: "hoch", g: 1 });   // mitten im Rouletttisch
  assert.equal(anna.hat("welt:korrektur").length, 1);
  assert.equal(bert.hat("welt:z").length, 1, "der ungültige Zug wird nicht verteilt");
});

test("benutzen geht nur aus der Nähe, und die Tür wechselt den Raum für alle Tabs", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const a1 = w.neuerSocket("anna");
  const a2 = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  a1.frage("welt:betreten", {});
  a2.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  assert.equal(a1.frage("welt:nutzen", { ding: "slot-lucky7" }).ok, false);
  const fig = w.welt.figuren.get("anna");
  fig.x = 3.9; fig.y = 4.1;
  const r = a1.frage("welt:nutzen", { ding: "slot-lucky7" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ziel, { screen: "slots", maschine: "lucky7" });
  assert.equal(a1.frage("welt:tuer", { tuer: "zum-kontor" }).ok, false, "zu weit weg");
  fig.x = 19.7; fig.y = 7.4;
  const umzug = a1.frage("welt:tuer", { tuer: "zum-kontor" });
  assert.equal(umzug.raum, "kontor");
  assert.equal(a2.hat("welt:umzug").length, 1, "der zweite Tab zieht mit");
  assert.equal(bert.hat("welt:raus").length, 1, "im Casino ist Anna weg");
});

test("Tätigkeit und Sitzplatz", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  anna.data.screen = "blackjack";
  anna.rufe("presence:screen", { screen: "blackjack" });
  assert.deepEqual(bert.hat("welt:aktiv").at(-1), { id: w.welt.figuren.get("anna").id, a: "blackjack" });
  const sofa = require("../public/js/welt/raeume.js").raum("casino").sitze[0];
  for (const k of ["anna", "bert"]) { const f = w.welt.figuren.get(k); f.x = sofa.auf.x; f.y = sofa.auf.y; }
  assert.equal(anna.frage("welt:sitzen", { platz: sofa.id }).ok, true);
  assert.equal(bert.frage("welt:sitzen", { platz: sofa.id }).ok, false, "besetzt");
});

test("am Kartentisch setzt der Server einen hin, jeden auf einen eigenen Platz", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  for (const k of ["anna", "bert"]) { const f = w.welt.figuren.get(k); f.x = 15.2; f.y = 7.0; }
  const a = anna.frage("welt:nutzen", { ding: "blackjack" });
  const b = bert.frage("welt:nutzen", { ding: "blackjack" });
  assert.equal(a.ok && b.ok, true);
  assert.ok(a.platz && b.platz, "beide sitzen");
  assert.notEqual(a.platz.s, b.platz.s, "nie zwei auf demselben Hocker");
  assert.equal(bert.hat("welt:z").some((z) => z[5] === a.platz.s), true, "Bert sieht Anna sitzen");
  // Noch einmal benutzen: sie bleibt, wo sie ist.
  assert.equal(anna.frage("welt:nutzen", { ding: "blackjack" }).platz.s, a.platz.s);
  // Und sie steht normal wieder auf: der Zug zählt ab dem Aufstehpunkt.
  const fig = w.welt.figuren.get("anna");
  const sitz = require("../public/js/welt/raeume.js").raum("casino").sitze.find((s) => s.id === a.platz.s);
  fig.t = Date.now() - 300;
  anna.rufe("welt:zug", { x: sitz.auf.x, y: sitz.auf.y + 0.4, d: "runter", g: 1 });
  assert.equal(anna.hat("welt:korrektur").length, 0);
  assert.equal(fig.sitzt, null);
  // Ohne Tischplätze (Spielautomat) setzt sich niemand.
  fig.x = 3.9; fig.y = 4.1;
  assert.equal(anna.frage("welt:nutzen", { ding: "slot-lucky7" }).platz, undefined);
});

test("ein Dreh am Glücksrad: alle im Raum sehen dasselbe Feld, von weitem dreht niemand", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const { schau } = require("../game/welt");
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  const fig = w.welt.figuren.get("anna");
  fig.x = 10.2; fig.y = 3.9;
  schau(anna, "gluecksrad", { titel: "+250 Chips", index: 7 });
  const s = bert.hat("welt:schau").at(-1);
  assert.equal(s.ding, "gluecksrad");
  assert.equal(s.index, 7, "das Rad hält bei allen auf dem gezogenen Feld");
  assert.equal(s.id, fig.id);
  fig.x = 10; fig.y = 11.6;
  schau(anna, "gluecksrad", { titel: "+250 Chips", index: 2 });
  assert.equal(bert.hat("welt:schau").length, 1, "wer nicht am Rad steht, dreht es nicht");
});

test("Stück-Gesten gehen nur mit dem Stück, und nur so oft wie erlaubt", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  assert.equal(anna.frage("welt:geste", { art: "dampfen" }).ok, false, "ohne Vape kein Dampf");
  assert.equal(anna.frage("welt:geste", { art: "rauchzeichen" }).ok, false, "unbekannte Geste");
  w.kontoVon("anna").handding = "vape";
  assert.equal(anna.frage("welt:geste", { art: "dampfen" }).ok, true);
  assert.deepEqual(bert.hat("welt:geste").at(-1), { id: w.welt.figuren.get("anna").id, art: "dampfen" });
  assert.equal(anna.frage("welt:geste", { art: "dampfen" }).ok, false, "nicht sofort wieder");
});

test("wer sich abmeldet, verschwindet sofort, auch ohne Trennung", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  anna.rufe("welt:verlassen", {});
  assert.equal(bert.hat("welt:raus").length, 1);
  // Und wer danach noch einen Zug schickt, bewegt nichts mehr.
  anna.rufe("welt:zug", { x: 10, y: 11, d: "hoch", g: 1 });
  assert.equal(bert.hat("welt:z").length, 0);
});

test("jeder Raum ist über Türen vom Casino aus erreichbar, der Tresor nur über das Regal", () => {
  const gesehen = new Set(["casino"]);
  const offen = ["casino"];
  while (offen.length) {
    const r = R.raum(offen.pop());
    const wege = [...r.tueren.filter((t) => !t.versteckt).map((t) => t.ziel),
      ...r.dinge.filter((d) => d.ziel && d.ziel.tuer).map((d) => r.tueren.find((t) => t.id === d.ziel.tuer).ziel)];
    for (const z of wege) if (!gesehen.has(z)) { gesehen.add(z); offen.push(z); }
  }
  assert.deepEqual([...gesehen].sort(), Object.keys(R.RAEUME).sort());
  const zuFuss = new Set(["casino"]);
  const offen2 = ["casino"];
  while (offen2.length) {
    for (const t of R.raum(offen2.pop()).tueren) if (!t.versteckt && !zuFuss.has(t.ziel)) { zuFuss.add(t.ziel); offen2.push(t.ziel); }
  }
  assert.equal(zuFuss.has("tresor"), false, "der Tresor darf keinen offenen Zugang haben");
});

test("Geheimnisse gibt es genau einmal, und das Regal führt in den Tresor", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  anna.frage("welt:betreten", {});
  const fig = w.welt.figuren.get("anna");
  fig.raum = "kontor"; fig.x = 8.6; fig.y = 4.1;
  const gang = anna.frage("welt:nutzen", { ding: "regal" });
  assert.equal(gang.ok, true);
  assert.equal(gang.ziel.umzug.raum, "tresor");
  const katze = R.raum("tresor").dinge.find((d) => d.id === "katze");
  fig.x = 7.6; fig.y = 5.6;
  assert.ok(R.abstandZuDing(katze, fig.x, fig.y) <= R.reichweite(katze));
  const erst = anna.frage("welt:nutzen", { ding: "katze" });
  assert.equal(erst.ziel.geheimnis.neu, true);
  const zweit = anna.frage("welt:nutzen", { ding: "katze" });
  assert.equal(zweit.ziel.geheimnis.neu, false);
});

test("das Garagentor geht nur nachts und nur nach dem Hupen auf, dahinter steht der E46, und der fährt nicht", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const welt = require("../game/welt");
  const echteUhr = welt.uhr.jetzt;
  t.after(() => { welt.uhr.jetzt = echteUhr; });
  const anna = w.neuerSocket("anna");
  const konto = w.kontoVon("anna");
  konto.fahrzeug = "bobbycar";
  anna.frage("welt:betreten", {});
  const fig = w.welt.figuren.get("anna");
  fig.raum = "strasse"; fig.x = 16.4; fig.y = 4.2;
  // Tagsüber: hupen bringt nichts, rütteln auch nicht.
  welt.uhr.jetzt = () => Date.parse("2026-10-01T12:00:00+02:00");
  assert.equal(anna.frage("welt:geste", { art: "hupen" }).ok, true);
  assert.equal(anna.hat("welt:tor").length, 0);
  assert.equal(anna.frage("welt:nutzen", { ding: "garage" }).ok, false);
  // Nachts um elf: hupen, und das Tor geht auf.
  welt.uhr.jetzt = () => Date.parse("2026-10-01T23:00:00+02:00");
  fig.gesteTs = 0;
  anna.frage("welt:geste", { art: "hupen" });
  assert.equal(anna.hat("welt:tor").length, 1);
  const rein = anna.frage("welt:nutzen", { ding: "garage" });
  assert.equal(rein.ok, true);
  assert.equal(rein.ziel.umzug.raum, "garage");
  fig.x = 4.5; fig.y = 5.4;
  const g = anna.frage("welt:nutzen", { ding: "plane" });
  assert.equal(g.ziel.geheimnis.neu, true);
  assert.equal(konto.fahrzeug, "e46");
  assert.equal(fig.steht, true);
  // Drauf sitzen heißt: kein Meter vorwärts.
  const vorher = { x: fig.x, y: fig.y };
  fig.t = Date.now() - 1000;
  anna.rufe("welt:zug", { x: vorher.x + 0.3, y: vorher.y, d: "rechts", g: 1 });
  assert.deepEqual({ x: fig.x, y: fig.y }, vorher);
  assert.ok(anna.hat("welt:korrektur").length >= 1);
  // Absteigen, und man läuft wieder.
  assert.equal(anna.frage("welt:aufsitzen", { an: false }).ok, true);
  assert.equal(fig.steht, false);
});

test("jede Stück-Geste verlangt Stücke, die es im Katalog gibt", () => {
  const R = require("../public/js/welt/raeume.js");
  const K = require("../game/kleidung.js");
  for (const g of R.STUECK_GESTEN) {
    for (const [art, ids] of Object.entries(g.braucht)) {
      const a = K.ARTEN[art];
      assert.ok(a, `${g.id}: unbekannte Art ${art}`);
      if (ids === "*") continue;
      for (const id of ids) assert.ok(a.liste.some((x) => x.id === id), `${g.id}: ${art} ${id} gibt es nicht`);
    }
  }
  // Und die Ids sind eindeutig, sonst wäre die Zifferntaste mehrdeutig.
  assert.equal(new Set(R.STUECK_GESTEN.map((g) => g.id)).size, R.STUECK_GESTEN.length);
});

test("Schnellwahl springt zum passenden Ding, nimmt freie Plätze zuerst und nie den Tresor", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const R = require("../public/js/welt/raeume.js");
  const anna = w.neuerSocket("anna");
  const bert = w.neuerSocket("bert");
  anna.frage("welt:betreten", {});
  bert.frage("welt:betreten", {});
  const a = w.welt.figuren.get("anna"), b = w.welt.figuren.get("bert");
  // Bert steht vor dem ersten Automaten.
  const erster = R.raum("casino").dinge.find((d) => d.ziel && d.ziel.screen === "slots");
  b.x = erster.nutz.x; b.y = erster.nutz.y;
  const r = anna.frage("welt:hin", { screen: "slots" });
  assert.equal(r.ok, true);
  assert.notEqual(r.ding, erster.id, "der besetzte Automat ist zweite Wahl");
  const d = R.raum("casino").dinge.find((x) => x.id === r.ding);
  assert.ok(R.abstandZuDing(d, a.x, a.y) <= R.reichweite(d), "steht in Reichweite");
  assert.ok(bert.hat("welt:sprung").some((s) => s.id === a.id), "Bert sieht den Sprung");
  // Gleich noch einmal: zu schnell, der Client öffnet dann einfach den Bildschirm.
  assert.equal(anna.frage("welt:hin", { screen: "blackjack" }).ohneOrt, true);
  a.hinTs = 0;
  const bj = anna.frage("welt:hin", { screen: "blackjack" });
  assert.ok(bj.platz && bj.platz.s.startsWith("bj-"), "am Kartentisch auf einen Hocker");
  a.hinTs = 0;
  const bank = anna.frage("welt:hin", { screen: "bank" });
  assert.equal(bank.umzug && bank.umzug.raum, "kontor", "die Bank steht im Kontor");
  a.hinTs = 0;
  assert.equal(anna.frage("welt:hin", { screen: "statistik_gibts_nicht" }).ohneOrt, true);
  for (const raum of Object.values(R.RAEUME).filter((r) => r.geheim)) {
    for (const ding of raum.dinge.filter((x) => x.ziel && x.ziel.screen)) {
      a.hinTs = 0;
      const z = anna.frage("welt:hin", { screen: ding.ziel.screen });
      assert.notEqual(z.umzug && z.umzug.raum, raum.id, "nie in einen geheimen Raum");
    }
  }
});


test("gespeicherte Rundung erzeugt keine zusätzliche Strecke", (t) => {
  const w = aufbau();
  t.after(w.aufraeumen);
  const anna = w.neuerSocket("anna");
  anna.frage("welt:betreten", {});
  const f = w.welt.figuren.get("anna");
  Object.assign(f, { x: 10, y: 11.5, budget: 0 });
  // Ein Zeitpunkt in der Zukunft friert den Budgetzuwachs zuverlässig ein.
  const jetzt = Date.now() + 60_000;
  for (let i = 0; i < 20; i++) {
    f.t = jetzt;
    anna.rufe("welt:zug", { x: 10, y: f.y - 0.0051, d: "hoch", g: 1 });
  }
  assert.ok(11.5 - f.y <= 0.050001, `Toleranz überschritten: ${11.5 - f.y}`);
});

test("ein stehendes Fahrzeug kann auch mit winzigen Schritten nicht fahren", () => {
  const f = figur(10, 11, { steht: true, budget: 2 });
  assert.equal(pruefeZug(f, 10, 11, 100).ok, true, "Umdrehen bleibt erlaubt");
  assert.equal(pruefeZug(f, 10, 10.99, 100).ok, false);
});
