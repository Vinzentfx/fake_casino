"use strict";

/*
 * Die begehbare Welt im Browser.
 *
 * Sie liegt als feste Ebene hinter allen Bildschirmen. In der Lobby ist sie
 * vorn und bedienbar; öffnet man ein Spiel, bleibt sie gedimmt dahinter
 * stehen, und beim Schließen steht man wieder genau dort, wo man war. Der
 * bisherige Vollbildhintergrund verschwindet damit hinter dem Raum.
 *
 * Die eigene Figur bewegt sich sofort, der Server prüft nach (game/welt.js).
 * Andere Figuren laufen gut hundert Millisekunden hinter ihren Meldungen
 * her und werden dazwischen weich überblendet; so ruckeln sie nicht, wenn
 * das Netz mal zwei Meldungen auf einmal liefert.
 *
 * Bewusst NICHT: automatisch etwas öffnen, nur weil man daran vorbeiläuft.
 * Ein Hinweis erscheint, geöffnet wird mit E, dem großen Knopf oder einem
 * Tipp direkt auf das Ding.
 */
(function () {
  const Casino = window.Casino;
  if (!Casino || !Casino.socket || !Casino.weltRaeume || !Casino.weltMoebel || !Casino.figur) return;
  const R = Casino.weltRaeume;
  const M = Casino.weltMoebel;
  const F = Casino.figur;
  const socket = Casino.socket;
  const T = R.KACHEL;
  const esc = (s) => Casino.escapeHtml ? Casino.escapeHtml(s) : String(s);

  // Die Figur wird kleiner gezeichnet als ihr viewBox: 64 x 96 auf 58 x 87.
  // Etwas größer als früher (58 × 87): die Kleidung ist der Grund, warum
  // man Figuren ansieht, und sie ging neben Rad und Laufschrift unter.
  const FIG_B = 64, FIG_H = 96, FIG_FUSS = 88;
  const SENDE_MS = 100;
  const PUFFER_MS = 110;
  const ANSICHT_KEY = "casino_lobby_ansicht";

  let ansicht = "welt";
  try { if (localStorage.getItem(ANSICHT_KEY) === "liste") ansicht = "liste"; } catch {}

  let raum = null;
  let ich = null;               // die eigene Figur
  const andere = new Map();     // id: Figur
  let drin = false;
  let betrittGerade = false;
  let meinName = null;
  let wechselt = false;         // eine Tür ist unterwegs
  let vorn = false;             // Welt ist bedienbar
  let fokus = null;             // Kamera fährt gerade auf ein Ding
  let ziel = null;              // Hingehen per Tipp: { pfad: [[x, y]], danach }
  let naechstes = null;         // was man jetzt benutzen könnte
  let zuletztGesendet = { x: 0, y: 0, d: "", g: 0, t: 0 };
  let fremdGesteuertBis = 0;
  let begehbarRaster = null;

  const reduziert = () => document.documentElement.classList.contains("reduce-motion")
    || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const beruehrung = () => window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* Aufbau. Die Ebene hängt direkt am body, vor #app: sie muss auch dann
     stehen bleiben, wenn der Lobby-Bildschirm ausgeblendet ist. */
  const el = document.createElement("div");
  el.className = "welt";
  el.id = "welt";
  el.setAttribute("aria-label", "Casino-Welt");
  el.innerHTML = `
    <div class="welt-buehne" tabindex="-1">
      <div class="welt-kamera"><div class="welt-raum"></div></div>
    </div>
    <div class="welt-schleier" aria-hidden="true"></div>
    <div class="welt-hud">
      <div class="welt-ort" aria-live="polite"><b></b><small></small></div>
      <div class="welt-knoepfe">
        <button type="button" class="welt-knopf welt-starter hidden" data-welt="starter">${Casino.icons ? Casino.icons.ui("marke") : ""}<span>Starter-Pass</span></button>
        <button type="button" class="welt-knopf" data-welt="orte" aria-haspopup="dialog">${symbolRaster()}<span>Schnellwahl</span></button>
        <span class="welt-gesten-huelle">
          <button type="button" class="welt-knopf" data-welt="gesten" aria-haspopup="menu" aria-expanded="false">${symbolHand()}<span>Gesten</span></button>
          <span class="welt-gesten hidden" role="menu">
            <button type="button" role="menuitem" data-geste="winken">Winken<kbd>1</kbd></button>
            <button type="button" role="menuitem" data-geste="jubeln">Jubeln<kbd>2</kbd></button>
          </span>
        </span>
        <button type="button" class="welt-knopf welt-fahrt-knopf hidden" data-welt="fahrt" aria-pressed="false">${symbolRad()}<span>Aufsteigen</span><kbd>M</kbd></button>
        <span class="welt-mehr-huelle">
          <button type="button" class="welt-knopf welt-mehr-knopf" data-welt="mehr" aria-haspopup="menu" aria-expanded="false"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg><span>Mehr</span></button>
          <span class="welt-mehr hidden" role="menu"></span>
        </span>
        <button type="button" class="welt-knopf welt-musik-knopf" data-welt="musik" aria-haspopup="dialog" aria-expanded="false" aria-label="Musik"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg></button>
        <button type="button" class="welt-knopf" data-welt="liste">${Casino.icons ? Casino.icons.ui("feed") : ""}<span>Übersicht</span></button>
      </div>
      <div class="welt-musik hidden" role="dialog" aria-label="Musik">
        <label class="welt-musik-zeile"><span>Musik</span><input type="checkbox" data-musik="an"></label>
        <label class="welt-musik-zeile"><span>Lautstärke</span><input type="range" min="0" max="100" data-musik="vol"></label>
        <small class="welt-musik-jetzt"></small>
      </div>
      <button type="button" class="welt-aktion hidden"><b></b><small></small></button>
      <div class="welt-stick hidden" aria-hidden="true"><i></i></div>
      <section class="welt-tisch hidden" aria-label="Roulette am Tisch"></section>
      <p class="welt-tipp"></p>
    </div>
    <div class="welt-auswahl hidden" role="dialog" aria-modal="true" aria-labelledby="welt-auswahl-titel">
      <div class="welt-auswahl-karte">
        <div class="welt-auswahl-kopf"><div><small class="welt-auswahl-kicker"></small><h2 id="welt-auswahl-titel"></h2></div><button type="button" class="welt-auswahl-zu" aria-label="Schließen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></div>
        <div class="welt-auswahl-liste"></div>
      </div>
    </div>`;
  document.body.insertBefore(el, document.getElementById("app"));

  const $ = (sel) => el.querySelector(sel);
  const buehne = $(".welt-buehne");
  const kamera = $(".welt-kamera");
  const raumEl = $(".welt-raum");
  const aktionKnopf = $(".welt-aktion");
  const stickEl = $(".welt-stick");
  const auswahlEl = $(".welt-auswahl");
  // Die Auswahl muss über allem liegen, auch über #app; die Welt selbst
  // liegt ganz unten.
  document.body.appendChild(auswahlEl);

  // Zurück aus der Liste in die Welt: ein Knopf oben in der alten Lobby.
  const zurueckKnopf = document.createElement("button");
  zurueckKnopf.type = "button";
  zurueckKnopf.className = "welt-zurueck";
  zurueckKnopf.innerHTML = `<span>Zurück in den Raum</span><small>Laufen, Leute sehen, Tische benutzen</small>`;
  zurueckKnopf.addEventListener("click", () => setzeAnsicht("welt"));
  const lobbyInnen = document.querySelector('[data-screen="lobby"] .lobby-inner');
  if (lobbyInnen) lobbyInnen.prepend(zurueckKnopf);

  /* Über der Welt liegen Bildschirme in einem Fenster. Zu geht es über
     einen festen Knopf oben, der beim Scrollen mitkommt; der alte
     "‹ Zurück"-Knopf am Anfang jedes Bildschirms ist dann doppelt und
     wird im Fenster ausgeblendet. */
  const fensterZu = document.createElement("button");
  fensterZu.type = "button";
  fensterZu.className = "welt-fenster-zu";
  fensterZu.innerHTML = `<span aria-hidden="true">‹</span> In den Raum`;
  fensterZu.addEventListener("click", () => Casino.showScreen("lobby"));
  document.body.appendChild(fensterZu);

  /* "‹ Lobby" führt jetzt zurück an den Platz im Raum. Die Beschriftung
     sagt das, das Ziel bleibt dasselbe. */
  document.querySelectorAll('.back-btn[data-nav="lobby"]').forEach((b) => {
    if (b.textContent.trim() === "‹ Lobby") b.textContent = "‹ Zurück";
  });

  function symbolHand() {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor"><path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.9-2.6L3.8 14a1.5 1.5 0 0 1 2.4-1.8L8 14"/><path d="M19 3.5l1.5-1M20 7h2"/></svg>`;
  }
  function symbolRad() {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l-1.5-3H6M15 9l1-3h2.5"/></svg>`;
  }
  function symbolRaster() {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>`;
  }

  /* Raum bauen. Einmal je Betreten, nicht je Bild. */
  let dingEls = new Map();      // id: Element
  let hinweisEl = null;
  let schilderEbene = null;
  let dingeEbene = null;

  /* Draußen gilt die Uhr des Geräts: morgens Morgenrot, tagsüber blauer
     Himmel und die Laternen aus, abends Sonnenuntergang, nachts Mond und
     Sterne. Nur die Terrasse hat Himmel; drinnen ändert die Klasse nichts. */
  function tageszeit(jetzt = new Date()) {
    const h = jetzt.getHours();
    return h >= 6 && h < 10 ? "morgen" : h >= 10 && h < 17 ? "tag" : h >= 17 && h < 21 ? "abend" : "nacht";
  }
  setInterval(() => {
    if (raumEl) raumEl.dataset.tageszeit = tageszeit();
    if (raum && Casino.musik) Casino.musik.raum(raum.id, { nacht: tageszeit() === "nacht" });
  }, 5 * 60 * 1000);

  function baueRaum(r) {
    /* Eine offene Tafel gehört zu einem Ding im alten Raum. Zieht die Figur
       um (etwa weil ein zweiter Tab durch eine Tür ging), wäre sie sonst
       weiter offen, und die Kamera hinge auf einer Stelle, die es hier nicht
       gibt. Aufgerufen wird das nur aus Socket-Antworten, also nach dem
       Laden der ganzen Datei. */
    if (tisch) { tisch = null; tischEl.classList.add("hidden"); }
    fokus = null;
    raum = r;
    begehbarRaster = null;
    dingEls = new Map();
    raumEl.style.width = r.w * T + "px";
    raumEl.style.height = r.h * T + "px";
    raumEl.dataset.raum = r.id;
    // Die Fenster über der Welt nehmen den Ton dieses Raums an (welt.css).
    document.documentElement.dataset.weltRaum = r.id;
    if (Casino.musik) Casino.musik.raum(r.id, { nacht: tageszeit() === "nacht" });
    raumEl.dataset.tageszeit = tageszeit();
    const dinge = r.dinge.map((d) => {
      const z = M.ding(d);
      if (!z) return "";
      const benutzbar = !!d.ziel;
      const tag = benutzbar ? "button" : "div";
      const attr = benutzbar
        ? ` type="button" data-ding="${d.id}" aria-label="${esc(d.label)}: ${esc(d.verb)}"`
        : ` aria-hidden="true"`;
      const zIndex = d.block ? Math.round(d.block[3] * 100) : Math.round(d.y * 100);
      return `<${tag} class="welt-ding m-${d.art}${benutzbar ? " benutzbar" : ""}${d.geheim ? " geheim" : ""}"${attr} style="left:${z.links}px;top:${z.oben}px;width:${z.w}px;height:${z.h}px;z-index:${zIndex}">${z.svg}${z.html || ""}</${tag}>`;
    }).join("");
    const tuerSchilder = r.tueren.filter((t) => !t.versteckt && t.schild).map((t) => `<button type="button" class="welt-tuerschild" data-tuer="${t.id}" data-ziel-raum="${t.ziel}" style="left:${t.schild.x * T}px;top:${t.schild.y * T}px">${esc(t.label)} <small></small><b aria-hidden="true">›</b></button>`).join("");
    raumEl.innerHTML = M.raum(r)
      + `<div class="welt-ebene welt-dinge">${dinge}</div>`
      + `<div class="welt-ebene welt-schilder">${tuerSchilder}<div class="welt-hinweis hidden" aria-hidden="true"></div></div>`;
    dingeEbene = raumEl.querySelector(".welt-dinge");
    schilderEbene = raumEl.querySelector(".welt-schilder");
    hinweisEl = raumEl.querySelector(".welt-hinweis");
    raumEl.querySelectorAll("[data-ding]").forEach((b) => dingEls.set(b.dataset.ding, b));
    $(".welt-ort b").textContent = r.name;
    zeigeOrtZeile();
    for (const f of andere.values()) { f.el.remove(); if (f.tier) f.tier.el.remove(); }
    andere.clear();
    anzeigenFuellen();
    if (ich) { ich.el.remove(); ich.schild.remove(); if (ich.tier) ich.tier.el.remove(); ich = null; }
    naechstes = null;
    ziel = null;
  }

  function zeigeOrtZeile() {
    const zahl = andere.size;
    $(".welt-ort small").textContent = zahl === 0 ? "Gerade niemand sonst hier" : zahl === 1 ? "1 weitere Person hier" : `${zahl} weitere Personen hier`;
  }

  /* Anzeigen im Raum: Laufschrift und Fernseher zeigen den Live-Feed, die
     Rekordtafel die Wochenrekorde, das Podest die drei Reichsten als ihre
     echten Figuren. Die Daten kommen aus denselben Quellen wie die Listen
     in der Übersicht; die Welt rechnet nichts davon selbst. */
  let feed = [];
  let rekorde = null;
  let podest = null;
  let podestZeit = 0;
  let stadt = null;
  let stadtZeit = 0;
  let ortsteilWunsch = null, aktieWunsch = null;
  let kurse = null;
  let kurseZeit = 0;
  let rennen = null;   // { phase, bis, feld: { lane: fortschritt } }

  /* Die Rennbahn auf der Terrasse zeigt das echte Rennen: in der Wettphase
     die Zeit bis zum Start, danach laufen die Pferde, wie der Server sie
     meldet. */
  /* Dieselben Farben in derselben Reihenfolge wie SILKS in public/js/horses.js,
     und wie dort nach der Seide des Pferdes (`silk`), nicht nach der Bahn.
     Vorher trug dasselbe Pferd hier eine andere Farbe als im Rennen. */
  const SEIDE = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22", "#1abc9c", "#ec8ecf"];
  function rennenZeichnen() {
    const box = raumEl.querySelector('[data-anzeige="rennen"]');
    if (!box || !rennen) return;
    const bahnen = Object.keys(rennen.feld).map(Number).sort((a, b) => a - b);
    const rest = Math.max(0, Math.ceil((rennen.bis - Date.now()) / 1000));
    const kopf = rennen.phase === "betting" ? `Start in ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}`
      : rennen.phase === "running" ? "Rennen läuft" : "Im Ziel";
    const hoehe = bahnen.length ? Math.min(4.2, 30 / bahnen.length) : 4;
    if (!box.firstChild) box.innerHTML = `<b></b><div class="welt-rennen-bahnen"></div>`;
    box.querySelector("b").textContent = kopf;
    box.querySelector(".welt-rennen-bahnen").innerHTML = bahnen.map((l, i) =>
      `<i style="top:${(i * hoehe).toFixed(1)}px;left:${(2 + rennen.feld[l] * 96).toFixed(1)}px;background:${rennen.seide[l] || SEIDE[l % SEIDE.length]}"></i>`).join("");
  }
  function rennenAus(st) {
    if (!st || !Array.isArray(st.field)) return;
    const feld = {}, seide = {};
    for (const f of st.field) { feld[f.lane] = f.progress || 0; seide[f.lane] = seideVon(f); }
    rennen = { phase: st.phase, bis: Date.now() + (st.msLeft || 0), feld, seide };
    rennenZeichnen();
  }
  socket.on("horses:round", (st) => {
    if (raum && raum.id === "hof") rennenAus(st); else rennen = null;
    // Neue Runde oder Zieleinlauf: die offene Tafel übernimmt Feld, Quoten und Ergebnis.
    if (tisch && tisch.art === "rennen" && st && Array.isArray(st.field)) {
      const meine = tisch.st && tisch.st.myBets;
      tisch.st = { ...(tisch.st || {}), ...st, myBets: st.phase === "betting" && (!tisch.st || st.no !== tisch.st.no) ? [] : meine || [] };
      if (st.phase !== "betting") tisch.wahl = null;
      tisch.info = "";
      zeichneTisch();
    }
  });
  socket.on("horses:tick", ({ field } = {}) => {
    if (!rennen || !raum || raum.id !== "hof" || !Array.isArray(field)) return;
    rennen.phase = "running";
    for (const f of field) rennen.feld[f.lane] = f.p || 0;
    rennenZeichnen();
  });
  setInterval(() => {
    if (!vorn || !rennen || !raum || raum.id !== "hof" || rennen.phase !== "betting") return;
    rennenZeichnen();
    // Nur die Uhr auf der Tafel, nicht die Knöpfe: sonst ginge ein Tipp mitten im Neuzeichnen verloren.
    const uhr = tisch && tisch.art === "rennen" && tischEl.querySelector(".welt-renn-stand");
    if (uhr) uhr.textContent = rennStand();
  }, 1000);

  /* Die Börsentafel zeigt die echten Kurse, mit einer Kurve für den
     Wert, der sich gerade am stärksten bewegt. */
  function kurseZeichnen() {
    const box = raumEl.querySelector('[data-anzeige="kurse"]');
    if (!box || !kurse || !kurse.length) return;
    const zeilen = kurse.slice(0, 4).map((k) => {
      const auf = k.changePct >= 0;
      return `<p data-aktie="${esc(k.sym)}"><b>${esc(k.sym)}</b><span>${esc(k.price.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span><small class="${auf ? "auf" : "ab"}">${auf ? "+" : ""}${esc(k.changePct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))} %</small></p>`;
    }).join("");
    const top = [...kurse].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
    const h = (top && top.history) || [];
    let kurve = "";
    if (h.length > 1) {
      const min = Math.min(...h), max = Math.max(...h), r = max - min || 1;
      const pts = h.map((v, i) => `${((i / (h.length - 1)) * 90).toFixed(1)},${(48 - ((v - min) / r) * 44).toFixed(1)}`).join(" ");
      const auf = h[h.length - 1] >= h[0];
      kurve = `<svg viewBox="0 0 90 50" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${auf ? "#4ade80" : "#ff7a6e"}" stroke-width="1.8"/></svg><em>${esc(top.sym)}</em>`;
    }
    box.innerHTML = `<div class="welt-kurse-liste">${zeilen}</div><div class="welt-kurse-kurve">${kurve}</div>`;
  }

  /* Der Kartentisch zeigt die echte Stadt: jeder Ortsteil in der Farbe
     seines Bosses, eine Nadel, wo einem selbst etwas gehört. Ein Tipp auf
     einen Ortsteil öffnet genau den. */
  function stadtZeichnen() {
    const box = raumEl.querySelector('[data-anzeige="stadt"]');
    if (!box || !stadt || !Array.isArray(stadt.districts)) return;
    const ringe = stadt.districts.filter((d) => Array.isArray(d.ring) && d.ring.length > 2);
    if (!ringe.length) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const d of ringe) for (const [x, y] of d.ring) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    const pad = Math.max(x2 - x1, y2 - y1) * 0.04;
    const fs = Math.max(x2 - x1, y2 - y1) / 16;
    const farbe = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : null);
    const teile = ringe.map((d) => {
      const pfad = "M" + d.ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
      let cx = 0, cy = 0;
      for (const [x, y] of d.ring) { cx += x; cy += y; }
      cx /= d.ring.length; cy /= d.ring.length;
      const boss = d.boss && farbe(d.boss.color);
      return `<g class="welt-ortsteil" data-ortsteil="${esc(d.id)}"><title>${esc(d.name)}${d.boss ? ": " + esc(d.boss.name) : ""}</title>`
        + `<path d="${pfad}" fill="${boss || "#cfe0a8"}" fill-opacity="${boss ? 0.62 : 0.9}" stroke="#5f7a48" stroke-width="${fs / 10}"/>`
        + (d.mine > 0 ? `<g transform="translate(${cx.toFixed(1)} ${(cy - fs * 0.6).toFixed(1)})"><path d="M0 0V${(-fs).toFixed(1)}" stroke="#333" stroke-width="${fs / 12}"/><circle cy="${(-fs * 1.1).toFixed(1)}" r="${(fs * 0.34).toFixed(1)}" fill="#d24a3c" stroke="#fff" stroke-width="${fs / 14}"/></g>` : "")
        + `<text x="${cx.toFixed(1)}" y="${(cy + fs * 0.35).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.75).toFixed(1)}" font-weight="800" fill="#2e3a24" stroke="#f4efe2" stroke-width="${(fs / 9).toFixed(1)}" paint-order="stroke">${esc(d.name)}</text></g>`;
    }).join("");
    box.innerHTML = `<svg viewBox="${(x1 - pad).toFixed(1)} ${(y1 - pad).toFixed(1)} ${(x2 - x1 + 2 * pad).toFixed(1)} ${(y2 - y1 + 2 * pad).toFixed(1)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${teile}</svg>`;
  }

  function anzeigenFuellen() {
    if (!raum) return;
    const lauf = raumEl.querySelector('[data-anzeige="feed-lauf"] .welt-lauf-band');
    if (lauf) {
      const text = feed.slice(0, 8).map((x) => x.text).join("   ·   ") || "Noch nichts los heute. Das ändert sich mit der ersten Runde.";
      if (lauf.textContent !== text) {
        lauf.textContent = text;
        lauf.style.setProperty("--lauf-dauer", Math.max(20, Math.round(text.length / 5)) + "s");
      }
    }
    const tv = raumEl.querySelector('[data-anzeige="feed-tv"]');
    if (tv) tv.innerHTML = feed.length
      ? feed.slice(0, 6).map((x) => `<p><b>${esc(x.text)}</b><small>${esc(wann(x.ts))}</small></p>`).join("")
      : `<p class="leer">Gerade ist es still.</p>`;
    const tafel = raumEl.querySelector('[data-anzeige="rekorde"]');
    if (tafel) {
      const zeilen = rekorde && Array.isArray(rekorde.zeilen) ? rekorde.zeilen : [];
      tafel.innerHTML = zeilen.length
        ? zeilen.slice(0, 6).map((z) => `<p><b>${esc(z.label)}</b>${esc(z.best ? z.best.name : "frei")}<small>${esc(z.best ? z.best.text : "")}</small></p>`).join("")
        : `<p class="leer">Diese Woche noch kein Rekord.</p>`;
    }
    stadtZeichnen();
    kurseZeichnen();
    const pod = raumEl.querySelector('[data-anzeige="podest"]');
    if (pod) {
      // Füße genau auf der Stufe: Oberkante der Stufe minus Figurhöhe (75).
      const platz = [[0, 76, 43], [1, 8, 61], [2, 144, 73]];
      pod.innerHTML = (podest || []).length
        ? platz.filter(([i]) => podest[i]).map(([i, x, y]) => {
          const p = podest[i];
          return `<span class="welt-podest-platz" style="left:${x}px;top:${y}px"><b>${esc(p.name)}</b>${Casino.spieler ? Casino.spieler.figur(p) : ""}</span>`;
        }).join("")
        : "";
    }
  }

  function wann(ts) {
    const min = Math.floor((Date.now() - (ts || 0)) / 60000);
    if (min < 1) return "gerade";
    if (min < 60) return `${min} Min`;
    const std = Math.floor(min / 60);
    return std < 24 ? `${std} Std` : `${Math.floor(std / 24)} T`;
  }

  /* Marken an den Dingen. Was auf einen wartet (Gratis-Dreh, Tageskiste,
     Kalender, Season, volle Bank, offenes Stadt-Ereignis, ein Duell), stand
     bisher nur als Zahl am Menü. In der Welt ist die Adresse das Ding selbst.
     Die Zahlen kommen aus derselben Antwort wie die Zahl am Menü
     (bericht:marken), damit Menü und Raum nie Verschiedenes behaupten. */
  let letzteMarken = {};
  function markenLaden() {
    if (!raum || !dingEls.size) return;
    socket.emit("bericht:marken", (m) => {
      if (!m || !m.ok) return;
      const je = { wheel: m.rad || 0, calendar: m.kalender || 0, season: m.season || 0, ...(m.kacheln || {}) };
      letzteMarken = je;
      for (const [id, b] of dingEls) {
        const d = raum.dinge.find((x) => x.id === id);
        const z = d && d.ziel;
        const screens = !z ? [] : z.screen ? [z.screen] : z.auswahl || [];
        const n = screens.reduce((s, sc) => s + (Number(je[sc]) || 0), 0);
        let marke = b.querySelector(":scope > .welt-marke");
        if (!n) { if (marke) marke.remove(); continue; }
        if (!marke) {
          marke = document.createElement("span");
          marke.className = "welt-marke";
          marke.setAttribute("aria-hidden", "true");
          b.appendChild(marke);
        }
        marke.textContent = n > 9 ? "9+" : String(n);
      }
      /* Und die Tür dorthin: der Kalender hängt in der Ruhmeshalle, und wer
         im Casino steht, soll sehen, durch welche Tür es geht. */
      raumEl.querySelectorAll(".welt-tuerschild[data-ziel-raum]").forEach((schild) => {
        const ziel = R.raum(schild.dataset.zielRaum);
        const n = ziel ? ziel.dinge.reduce((s, d) => {
          const z = d.ziel;
          const screens = !z ? [] : z.screen ? [z.screen] : z.auswahl || [];
          return s + screens.reduce((t, sc) => t + (Number(je[sc]) || 0), 0);
        }, 0) : 0;
        let marke = schild.querySelector(".welt-marke");
        if (!n) { if (marke) marke.remove(); return; }
        if (!marke) {
          marke = document.createElement("span");
          marke.className = "welt-marke";
          marke.setAttribute("aria-hidden", "true");
          schild.appendChild(marke);
        }
        marke.textContent = n > 9 ? "9+" : String(n);
      });
    });
  }

  function anzeigenLaden() {
    markenLaden();
    if (raumEl.querySelector('[data-anzeige="lotto"]')) {
      socket.emit("lotterie:state", (res) => { if (res && res.ok) { lotto = res; lottoZeichnen(); } });
    }
    if (dingEls.has("gluecksrad")) {
      socket.emit("wheel:state", (res) => { if (res && res.ok) radFelderFaerben(res.segments); });
    }
    socket.emit("feed:list", (res) => {
      if (res && res.ok) { feed = res.items || []; anzeigenFuellen(); }
    });
    socket.emit("records:state", (res) => {
      if (res && res.ok) { rekorde = res; anzeigenFuellen(); }
    });
    if (raumEl.querySelector('[data-anzeige="rennen"]')) socket.emit("horses:state", (res) => { if (res && res.ok) rennenAus(res); });
    if (raumEl.querySelector('[data-anzeige="kurse"]') && Date.now() - kurseZeit > 15000) {
      kurseZeit = Date.now();
      socket.emit("stocks:state", (res) => { if (res && res.ok) { kurse = res.stocks || []; kurseZeichnen(); } });
    }
    if (raumEl.querySelector('[data-anzeige="stadt"]') && Date.now() - stadtZeit > 30000) {
      stadtZeit = Date.now();
      socket.emit("city:state", (res) => { if (res && res.ok && res.overview) { stadt = res.overview; stadtZeichnen(); } });
    }
    if (Date.now() - podestZeit > 60000) {
      podestZeit = Date.now();
      fetch("/api/leaderboard").then((r) => r.json()).then((d) => {
        const liste = d && d.leaderboard && d.leaderboard.rich && d.leaderboard.rich.entries;
        podest = Array.isArray(liste) ? liste.slice(0, 3) : [];
        anzeigenFuellen();
      }).catch(() => {});
    }
  }
  /* Kurse und Stadt ändern sich, während man davor steht. Nur dann: liegt
     ein Spiel über dem Raum, sieht die Tafeln niemand, und die Stadt
     kostet den Server bei jeder Abfrage rund 50 ms. */
  setInterval(() => { if (drin && vorn && raum && raum.id === "kontor" && !document.hidden) anzeigenLaden(); }, 20000);

  socket.on("feed:update", (item) => {
    if (!item) return;
    feed.unshift(item);
    if (feed.length > 30) feed.length = 30;
    anzeigenFuellen();
  });
  socket.on("records:update", () => socket.emit("records:state", (res) => { if (res && res.ok) { rekorde = res; anzeigenFuellen(); } }));

  /* Figuren */
  function neueFigur(daten, eigen) {
    const f = {
      id: daten.id, look: daten.look || {}, eigen,
      x: daten.x, y: daten.y, d: daten.d || "runter", g: !!daten.g, s: daten.s || 0, a: daten.a || null,
      puffer: [], blaseTimer: null, gesteTimer: null,
    };
    f.el = document.createElement("div");
    f.el.className = "wf" + (eigen ? " wf-ich" : "");
    f.el.dataset.fig = String(f.id);
    f.schild = document.createElement("div");
    f.schild.className = "wf-schild" + (eigen ? " wf-ich" : "");
    zeichneFigur(f);
    dingeEbene.appendChild(f.el);
    schilderEbene.appendChild(f.schild);
    setzeZustand(f);
    platziere(f);
    return f;
  }

  /* Welche Sets die Welt kennt. Nur für die Klasse am Umschlag (das
     Leuchten am E-Roller zum Beispiel), deshalb eine feste Liste: eine
     Kennung aus einer Nachricht wird nie ungeprüft zur Klasse. */
  const SETS = new Set(["glamour", "y2k", "sommerfest", "ossi", "talahon", "skater", "mallorca", "boersenhai", "dorfjugend", "croupier", "rapper",
    "gamer", "baustelle", "oma", "festival", "cowboy", "chefkoch", "pirat", "party"]);
  const SITZ_FAHRZEUGE = new Set(["bobbycar", "mopedauto", "aufsitzmaeher", "goldmoped", "simme", "e46"]);

  function zeichneFigur(f) {
    const aura = f.look.aura && F.AUREN.has(f.look.aura) ? ` data-aura="${esc(f.look.aura)}"` : "";
    f.el.innerHTML = `<div class="wf-aura"${aura}></div><div class="wf-koerper">${F.ansichten(f.look)}</div>`;
    const k = f.look.kleidung || {};
    const fz = typeof k.fahrzeug === "string" && k.fahrzeug !== "keins" ? k.fahrzeug : null;
    f.el.classList.toggle("reitet", !!fz);
    f.el.classList.toggle("im-sitz", !!fz && SITZ_FAHRZEUGE.has(fz));
    for (const c of [...f.el.classList]) if (c.startsWith("set-") || c.startsWith("fz-")) f.el.classList.remove(c);
    if (fz && /^[a-z_]+$/.test(fz)) f.el.classList.add("fz-" + fz);
    const set = f.look.stilSet && SETS.has(f.look.stilSet.id) ? f.look.stilSet : null;
    if (set) f.el.classList.add("set-" + set.id);
    haustierSetzen(f, typeof k.haustier === "string" ? k.haustier : null);
    const name = Casino.spieler ? Casino.spieler.name(f.look, { tag: "b" }) : `<b>${esc(f.look.name)}</b>`;
    f.schild.innerHTML = `<div class="wf-oben"><span class="wf-blase hidden"></span><span class="wf-aktiv hidden"></span></div>`
      + (set ? `<span class="wf-set">${esc(set.label)}</span>` : "")
      + `<button type="button" class="wf-name" data-profil="${esc(f.look.name || "")}" aria-label="${esc(f.look.name || "")} ansehen">${name}</button>`;
    f.el.setAttribute("role", "img");
    f.el.setAttribute("aria-label", f.look.name || "Figur");
    zeigeAktiv(f);
    // Das Gestenmenü folgt dem, was man gerade trägt.
    if (f.eigen) gestenMenueBauen(f.look);
  }

  /* Haustiere laufen einen halben Schritt hinter ihrem Menschen her. Jeder
     Browser rechnet das selbst aus; der Server weiß nur, welches Tier. */
  function haustierSetzen(f, id) {
    const hat = id && Casino.haustiere && Casino.haustiere.hat(id);
    const name = (f.look && typeof f.look.tierName === "string" && f.look.tierName) || "";
    if (f.tier && (!hat || f.tier.id !== id || f.tier.name !== name)) { f.tier.el.remove(); f.tier = null; }
    if (!hat || f.tier) return;
    const el = document.createElement("div");
    el.className = "wt";
    el.dataset.tier = id;
    // Der Name aus dem Zoo steht klein unter dem Tier.
    el.innerHTML = Casino.haustiere.tier(id) + (name ? `<span class="wt-name">${esc(name)}</span>` : "");
    dingeEbene.appendChild(el);
    f.tier = { id, el, name, x: f.x - 0.7, y: f.y + 0.1, links: false, geht: false, lage: "" };
  }

  const TIER_ABSTAND = { runter: [0.55, -0.45], hoch: [-0.55, 0.45], links: [0.8, 0.12], rechts: [-0.8, 0.12] };
  function tierFolgt(f, dt) {
    const t = f.tier;
    if (!t) return;
    const off = TIER_ABSTAND[f.d] || [0.6, 0];
    const zx = f.x + off[0], zy = f.y + off[1];
    const dx = zx - t.x, dy = zy - t.y, l = Math.hypot(dx, dy);
    let geht = false;
    if (l > 5) { t.x = zx; t.y = zy; }
    else if (l > 0.1) {
      const tempo = R.TEMPO * (l > 1 ? 1.7 : 1.05);
      const v = Math.min(l, tempo * dt);
      t.x += (dx / l) * v; t.y += (dy / l) * v;
      geht = true;
      if (Math.abs(dx) > 0.04) t.links = dx < 0;
    }
    if (geht !== t.geht) { t.geht = geht; t.el.classList.toggle("geht", geht); }
    t.el.classList.toggle("links", t.links);
    const lage = `${(t.x * T - 19).toFixed(1)},${(t.y * T - 29).toFixed(1)}`;
    if (lage !== t.lage) {
      t.lage = lage;
      t.el.style.transform = `translate3d(${(t.x * T - 19).toFixed(1)}px, ${(t.y * T - 29).toFixed(1)}px, 0)`;
      t.el.style.zIndex = Math.round(t.y * 100);
    }
  }

  function setzeZustand(f) {
    const k = f.el.classList;
    for (const r of ["runter", "hoch", "links", "rechts"]) k.toggle("r-" + r, f.d === r);
    k.toggle("geht", !!f.g && !f.s);
    k.toggle("sitzt", !!f.s);
    k.toggle("beschaeftigt", !!f.a);
  }

  function platziere(f) {
    const px = f.x * T, py = f.y * T;
    // Nur schreiben, was sich geändert hat: wer steht, kostet dann nichts.
    const lage = `${px.toFixed(1)},${py.toFixed(1)}`;
    if (f.lage !== lage) {
      f.lage = lage;
      f.el.style.transform = `translate3d(${(px - FIG_B / 2).toFixed(1)}px, ${(py - FIG_FUSS).toFixed(1)}px, 0)`;
      f.schild.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    }
    const sitz = f.s && raum ? raum.sitze.find((s) => s.id === f.s) : null;
    /* Auf Sofa und Sessel liegt die Figur vor dem Polster. Hinter einem
       Spieltisch (Blick nach unten) steht der Tisch vor ihr. */
    const vorPolster = sitz && sitz.d !== "hoch" && !sitz.tisch;
    const z = vorPolster ? Math.round((f.y + 2) * 100) : Math.round(f.y * 100) + 1;
    if (f.z !== z) { f.el.style.zIndex = z; f.z = z; }
  }

  function zeigeAktiv(f) {
    const box = f.schild.querySelector(".wf-aktiv");
    if (!box) return;
    if (!f.a) { box.classList.add("hidden"); box.innerHTML = ""; setzeZustand(f); return; }
    const spiel = (Casino._games || []).find((g) => g.id === f.a);
    const text = spiel ? spiel.name : ({ profile: "Profil", settings: "Einstellungen", cosmetics: "Garderobe", leaderboard: "Bestenliste", stats: "Statistik", quests: "Aufträge", season: "Season-Pass", calendar: "Kalender", wheel: "Glücksrad", clans: "Clans", transfer: "Chips senden", suggest: "Vorschläge", spickzettel: "Spickzettel", updates: "Updates" })[f.a] || "beschäftigt";
    const sym = Casino.icons ? (Casino.icons.icon(spiel && spiel.sym ? spiel.sym : f.a) || Casino.icons.ui("uhr")) : "";
    box.innerHTML = `${sym || ""}<span>${esc(text)}</span>`;
    box.classList.remove("hidden");
    setzeZustand(f);
  }

  function sprechblase(f, text) {
    const b = f.schild.querySelector(".wf-blase");
    if (!b) return;
    const kurz = String(text || "").length > 90 ? String(text).slice(0, 88) + "…" : String(text || "");
    b.textContent = kurz;
    b.classList.remove("hidden");
    clearTimeout(f.blaseTimer);
    f.blaseTimer = setTimeout(() => b.classList.add("hidden"), 6500);
  }

  /* Gesten. Winken und Jubeln kann jeder; dazu kommen Gesten, die an einem
     angelegten Stück hängen (Liste in raeume.js, der Server prüft den Besitz).
     Eine Kennung aus einer Nachricht wird nur zur Klasse, wenn sie bekannt ist. */
  const GRUND_GESTEN = [{ id: "winken", name: "Winken" }, { id: "jubeln", name: "Jubeln" }];
  const GESTEN_BEKANNT = new Set([...GRUND_GESTEN.map((g) => g.id), ...R.STUECK_GESTEN.map((g) => g.id), "shisha"]);
  const GESTE_MS = { winken: 1700, jubeln: 1700, kunststueck: 1900, hupen: 1800, ankicken: 2200, qualmen: 2400, kickflip: 1000, wheelie: 2600, quietschen: 1500 };
  const HUPE = { e_roller: "Kling kling!", bobbycar: "Möp möp!", mopedauto: "Tüt tüt!", goldmoped: "Tüüüt!", aufsitzmaeher: "Brumm brumm!", simme: "Mööööp!" };
  const KONFETTI = ["#e5534b", "#f2c94c", "#3f6fd0", "#4fb76a", "#c86bd6", "#f0a23b"];

  /* Ein Klang aus der Welt. Von der eigenen Figur voll; von anderen leiser,
     je weiter weg, und aus der Richtung, in der sie stehen. Liegt ein Spiel
     über der Welt, bleibt sie still. */
  function klang(name, f) {
    const snd = Casino.sound;
    if (!snd || !snd.play || !vorn) return;
    if (!f || !ich || f === ich) return snd.play(name);
    const dx = f.x - ich.x, d = Math.hypot(dx, f.y - ich.y);
    if (d > 14) return;
    snd.play(name, { laut: Math.max(0.12, 1 - d / 12), pan: dx / 9 });
  }
  const HUPE_KLANG = { e_roller: "klingel", bobbycar: "hupe_bobby", mopedauto: "hupe_auto", goldmoped: "hupe_gold", aufsitzmaeher: "hupe_maeher", simme: "hupe_simme" };
  const GESTE_KLANG = { qualmen: "anlassen_fehl", quietschen: "gummihuhn" };
  function gesteKlang(f, art) {
    if (art === "hupen") return klang(HUPE_KLANG[(f.look.kleidung || {}).fahrzeug] || "hupe_auto", f);
    if (art === "wheelie" && (f.look.kleidung || {}).fahrzeug === "simme") return klang("wheelie_simme", f);
    if (art === "schluerfen") {
      const nach = { spezi: "ruelpsen", energy: "zap" }[(f.look.kleidung || {}).hand];
      if (nach) setTimeout(() => klang(nach, f), 1800);
    }
    klang(GESTE_KLANG[art] || art, f);
  }

  function geste(f, art) {
    if (!GESTEN_BEKANNT.has(art)) return;
    gesteKlang(f, art);
    const k = "g-" + art;
    for (const c of [...f.el.classList]) if (c.startsWith("g-")) f.el.classList.remove(c);
    void f.el.offsetWidth;
    f.el.classList.add(k);
    clearTimeout(f.gesteTimer);
    f.gesteTimer = setTimeout(() => f.el.classList.remove(k), GESTE_MS[art] || 2600);
    gesteEffekt(f, art);
  }

  /* Der Punkt, von dem ein Effekt ausgeht, in Pixeln der Figur (58 × 87,
     ViewBox 64 × 96). Von der Seite liegt der Mund vorn am Gesicht, von
     hinten steigt alles über dem Kopf auf. */
  function figurPunkt(f, was) {
    const s = FIG_B / 64;
    if (was === "hand") return f.d === "links" ? [9 * s, 30 * s] : f.d === "hoch" ? [13 * s, 30 * s] : [55 * s, 30 * s];
    if (was === "kopf") return [32 * s, 8 * s];
    if (f.d === "hoch") return [32 * s, 14 * s];
    if (f.d === "rechts") return [43 * s, 37 * s];
    if (f.d === "links") return [21 * s, 37 * s];
    return [32 * s, 37 * s];
  }

  function teilchen(box, klasse, x, y, extra = {}) {
    const i = document.createElement("i");
    i.className = klasse;
    i.style.left = x.toFixed(1) + "px";
    i.style.top = y.toFixed(1) + "px";
    for (const [k, v] of Object.entries(extra)) {
      if (k === "text") i.textContent = v; else i.style.setProperty(k, v);
    }
    box.appendChild(i);
    return i;
  }

  /* Ein Ruf über dem Kopf, in der Schildebene über Set und Namen: die
     Schilder zeichnen über allen Figuren, ein Ruf darunter läge dahinter. */
  function rufen(f, text, ms = 1800) {
    const oben = f.schild.querySelector(".wf-oben");
    if (!oben) return;
    const ruf = document.createElement("span");
    ruf.className = "wf-ruf";
    ruf.textContent = text;
    oben.appendChild(ruf);
    setTimeout(() => ruf.remove(), ms);
  }

  function gesteEffekt(f, art) {
    // Bei „Bewegung reduzieren“ nur, was man lesen muss: Hupe und Ankicken.
    if (art === "ankicken") rufen(f, "Ring-ding-ding-ding!", 2200);
    if (art === "qualmen") rufen(f, ["Rrr… rrr… *hust*", "Springt nicht an.", "Orgel, orgel… nichts.", "Pfffff."][Math.floor(Math.random() * 4)], 2400);
    if (art === "quietschen") rufen(f, ["BWAAAAAK!", "AAAAAAAAH!", "IIIIIIIIIH!", "KRÄÄÄÄÄH!", "QUIIIIIEK!"][Math.floor(Math.random() * 5)], 1600);
    if (reduziert() && art !== "hupen") return;
    const box = document.createElement("div");
    box.className = "wf-fx";
    const seitwaerts = f.d === "rechts" ? 1 : f.d === "links" ? -1 : 0;
    const [mx, my] = figurPunkt(f, "mund");
    const [hx, hy] = figurPunkt(f, "hand");
    const [kx, ky] = figurPunkt(f, "kopf");
    const r = (a, b) => a + Math.random() * (b - a);
    if (art === "shisha") {
      /* Ziehen an der Shisha: Ringe wie bei der Vape, dazu blubbert die
         Pfeife selbst für alle im Raum. */
      teilchen(box, "fx-wolke", mx, my, { "--dx": seitwaerts * 6 + "px" });
      for (let n = 0; n < 4; n++) teilchen(box, "fx-ring", mx, my, { "animation-delay": (0.5 + n * 0.38) + "s", "--dx": (seitwaerts * 10 + r(-4, 4)).toFixed(1) + "px" });
      const sh = dingEls.get("shisha");
      if (sh) { sh.classList.remove("blubbert"); void sh.offsetWidth; sh.classList.add("blubbert"); setTimeout(() => sh.classList.remove("blubbert"), 2200); }
    } else if (art === "dampfen") {
      teilchen(box, "fx-wolke", mx, my, { "--dx": seitwaerts * 6 + "px" });
      for (let n = 0; n < 3; n++) {
        teilchen(box, "fx-ring", mx, my, { "animation-delay": (0.55 + n * 0.42) + "s", "--dx": (seitwaerts * 10 + r(-3, 3)).toFixed(1) + "px" });
      }
    } else if (art === "schlecken") {
      for (let n = 0; n < 4; n++) teilchen(box, "fx-funke", mx + r(-12, 12), my + r(-10, 4), { text: "✦", "animation-delay": (0.45 + n * 0.18) + "s" });
    } else if (art === "schluerfen") {
      /* Trinken, nicht dampfen: Becher an den Mund, Kopf in den Nacken, es
         gluckert, und danach wirkt das Getränk. Vorher stieg hier Dampf auf,
         und das sah genauso aus wie die Vape. */
      const was = (f.look.kleidung || {}).hand;
      ["gluck", "gluck", "gluck"].forEach((t, n) => teilchen(box, "fx-gluck", mx + seitwaerts * 6 + (n - 1) * 6, my - 6, { text: t, "animation-delay": (0.55 + n * 0.3).toFixed(2) + "s" }));
      if (was === "energy") {
        for (let n = 0; n < 7; n++) teilchen(box, "fx-zack", kx + r(-20, 20), ky + r(-8, 16), { text: "✦", "animation-delay": (1.7 + n * 0.08).toFixed(2) + "s" });
        setTimeout(() => { f.el.classList.add("zappelt"); setTimeout(() => f.el.classList.remove("zappelt"), 1300); rufen(f, "WOOOOH!", 1500); }, 1700);
      } else if (was === "spezi") {
        for (let n = 0; n < 6; n++) teilchen(box, "fx-blase", mx + seitwaerts * 4 + r(-5, 5), my, { "animation-delay": (1.5 + n * 0.1).toFixed(2) + "s", "--dx": r(-8, 8).toFixed(1) + "px" });
        setTimeout(() => rufen(f, "*Rüüülps*", 1600), 1800);
      } else if (was === "bubble_tea") {
        for (let n = 0; n < 5; n++) teilchen(box, "fx-perle", hx + seitwaerts * 3, hy - 14, { "animation-delay": (0.6 + n * 0.16).toFixed(2) + "s", "--dx": r(-6, 6).toFixed(1) + "px" });
        setTimeout(() => rufen(f, "Mmh, Perlen.", 1500), 1900);
      } else {
        setTimeout(() => rufen(f, "Ahh.", 1300), 1900);
      }
    } else if (art === "quietschen") {
      /* Das Königliche Gummihuhn: zusammendrücken, schreien, Federn. */
      const h = f.el.querySelectorAll(".fg-huhn");
      h.forEach((x) => { x.classList.remove("quetscht"); void x.getBoundingClientRect(); x.classList.add("quetscht"); });
      setTimeout(() => h.forEach((x) => x.classList.remove("quetscht")), 1300);
      for (let n = 0; n < 6; n++) teilchen(box, "fx-feder", hx + r(-6, 6), hy - 10 + r(-6, 4), { "animation-delay": (0.15 + n * 0.07).toFixed(2) + "s", "--dx": r(-26, 26).toFixed(1) + "px" });
    } else if (art === "selfie") {
      teilchen(box, "fx-blitz", hx, hy - 4, { "animation-delay": "0.6s" });
    } else if (art === "geldregen") {
      for (let n = 0; n < 8; n++) {
        teilchen(box, "fx-muenze", hx, hy, { "animation-delay": (0.35 + n * 0.06).toFixed(2) + "s", "--dx": r(-34, 34).toFixed(1) + "px", "--dy": r(-46, -24).toFixed(1) + "px" });
      }
    } else if (art === "qualmen") {
      /* Schwarzer Qualm unter der Motorhaube und hinten aus dem Auspuff. */
      const s = FIG_B / 64;
      const haube = f.d === "rechts" ? [56 * s, 68 * s] : f.d === "links" ? [8 * s, 68 * s] : f.d === "hoch" ? [32 * s, 50 * s] : [32 * s, 62 * s];
      const auspuff = f.d === "rechts" ? [2 * s, 84 * s] : f.d === "links" ? [62 * s, 84 * s] : f.d === "hoch" ? [42 * s, 86 * s] : [44 * s, 84 * s];
      for (let n = 0; n < 7; n++) {
        const [px, py] = n % 3 === 2 ? auspuff : haube;
        teilchen(box, "fx-qualm", px + r(-6, 6), py, { "animation-delay": (n * 0.16).toFixed(2) + "s", "--dx": (r(-16, 16) - seitwaerts * 8).toFixed(1) + "px", "--dy": r(-46, -26).toFixed(1) + "px" });
      }
    } else if (art === "wheelie") {
      // Am Hinterrad spritzt ein bisschen Staub, solange das Vorderrad oben ist.
      const s = FIG_B / 64;
      const hx = f.d === "rechts" ? 14 * s : f.d === "links" ? 50 * s : 32 * s;
      for (let n = 0; n < 5; n++) teilchen(box, "fx-staub", hx, 90 * s, { "animation-delay": (0.25 + n * 0.3).toFixed(2) + "s", "--dx": (f.d === "links" ? 1 : f.d === "rechts" ? -1 : r(-1, 1)) * r(10, 18) + "px" });
    } else if (art === "kickflip") {
      // Landung: zwei Staubwolken links und rechts der Füße.
      const s = FIG_B / 64;
      for (const dx of [-1, 1]) teilchen(box, "fx-staub", 32 * s + dx * 10, 88 * s, { "animation-delay": "0.78s", "--dx": dx * 14 + "px" });
    } else if (art === "hupen") {
      rufen(f, HUPE[(f.look.kleidung || {}).fahrzeug] || "Tüt tüt!");
    } else if (art === "ankicken") {
      /* Die blaue Wolke kommt hinten aus dem Auspuff, und der liegt je nach
         Blickrichtung woanders: von der Seite am Heck, von hinten rechts. */
      const s = FIG_B / 64;
      const [ax, ay] = f.d === "rechts" ? [6 * s, 82 * s] : f.d === "links" ? [58 * s, 82 * s] : f.d === "hoch" ? [44 * s, 84 * s] : [46 * s, 80 * s];
      for (let n = 0; n < 6; n++) {
        teilchen(box, "fx-zweitakt", ax, ay, { "animation-delay": (0.25 + n * 0.22).toFixed(2) + "s", "--dx": (-seitwaerts * r(14, 26) + (seitwaerts ? 0 : r(-10, 10))).toFixed(1) + "px", "--dy": r(-16, -6).toFixed(1) + "px" });
      }
    } else if (art === "troete") {
      for (let n = 0; n < 14; n++) {
        teilchen(box, "fx-konfetti", kx, ky, { "--dx": r(-38, 38).toFixed(1) + "px", "--dy": r(-40, -16).toFixed(1) + "px",
          "--rot": r(-540, 540).toFixed(0) + "deg", background: KONFETTI[n % KONFETTI.length], "animation-delay": (n * 0.02).toFixed(2) + "s" });
      }
    } else if (art === "abgehen") {
      ["♪", "♫", "♪", "♬"].forEach((t, n) => teilchen(box, "fx-note", kx + (n % 2 ? 12 : -12), ky + 6, { text: t, "animation-delay": (n * 0.35) + "s", "--dx": (n % 2 ? 14 : -14) + "px" }));
    } else if (art === "flattern") {
      for (let n = 0; n < 3; n++) teilchen(box, "fx-feder", r(14, 44), r(40, 60), { "animation-delay": (0.3 + n * 0.3) + "s", "--dx": r(-16, 16).toFixed(1) + "px" });
    } else if (art === "kunststueck" && f.tier && f.tier.el) {
      const t = f.tier.el;
      t.classList.remove("trick"); void t.offsetWidth; t.classList.add("trick");
      setTimeout(() => t.classList.remove("trick"), 1200);
      const herzen = document.createElement("div");
      herzen.className = "wf-fx";
      for (let n = 0; n < 3; n++) teilchen(herzen, "fx-herz", 19 + (n - 1) * 9, 4, { text: "♥", "animation-delay": (0.5 + n * 0.2) + "s" });
      t.appendChild(herzen);
      setTimeout(() => herzen.remove(), 2600);
    }
    if (!box.childNodes.length) return;
    f.el.appendChild(box);
    setTimeout(() => box.remove(), 3400);
  }

  let gestenListe = GRUND_GESTEN;
  function gestenMenueBauen(look) {
    const eigene = R.gestenFuer((look && look.kleidung) || {});
    gestenListe = [...GRUND_GESTEN, ...eigene].slice(0, 9);
    const menue = el.querySelector(".welt-gesten");
    if (!menue) return;
    menue.innerHTML = gestenListe.map((g, i) =>
      `<button type="button" role="menuitem" data-geste="${g.id}"${i >= GRUND_GESTEN.length ? ' class="stueck"' : ""}>${esc(g.name)}<kbd>${i + 1}</kbd></button>`).join("")
      + (eigene.length ? "" : `<small class="welt-gesten-tipp">Mehr Gesten gibt es mit Stücken aus der Kleiderkiste: Vape, Skateboard, Haustier und mehr.</small>`);
  }

  function entferneFigur(id) {
    const f = andere.get(id);
    if (!f) return;
    f.el.remove(); f.schild.remove();
    if (f.tier) f.tier.el.remove();
    clearTimeout(f.blaseTimer); clearTimeout(f.gesteTimer);
    andere.delete(id);
    zeigeOrtZeile();
  }

  /* Server */
  function betreten() {
    const acc = Casino.getAccount && Casino.getAccount();
    if (betrittGerade || !acc || acc.verification) return;
    betrittGerade = true;
    socket.emit("welt:betreten", {}, (res) => {
      betrittGerade = false;
      if (!res || !res.ok) { drin = false; return; }
      uebernehmen(res);
    });
  }

  function uebernehmen(res) {
    const r = R.raum(res.raum);
    if (!r) return;
    drin = true;
    meinName = res.look && res.look.name;
    baueRaum(r);
    zeigeBelegung();
    ich = neueFigur({ id: res.ich, look: res.look, x: res.pos.x, y: res.pos.y, d: res.pos.d, s: res.pos.s, g: 0 }, true);
    if (res.fahrt) fahrtSetzen(res.fahrt);
    for (const p of res.spieler || []) andere.set(p.id, neueFigur(p, false));
    zeigeOrtZeile();
    zuletztGesendet = { x: ich.x, y: ich.y, d: ich.d, g: 0, t: 0 };
    kameraSofort = true;
    anzeigenLaden();
    jagdLaden();
    if (Casino.musik) Casino.musik.jukebox(res.musik && res.musik.stil, res.musik && res.musik.rest);
  }

  /* Die Jukebox in der Spielhalle: jemand anderes hat ein Lied gewählt. */
  socket.on("welt:musik", (m) => {
    if (!m || !raum || !Casino.musik) return;
    Casino.musik.jukebox(m.stil, m.rest);
    const f = andere.get(m.von);
    klang("jukebox", f);
    if (m.titel) Casino.toast(`♪ ${f && f.look ? f.look.name + " legt auf: " : "Die Jukebox spielt "}${m.titel}`);
  });

  socket.on("welt:rein", (p) => {
    if (!drin || !p || (ich && p.id === ich.id)) return;
    entferneFigur(p.id);
    const f = neueFigur(p, false);
    f.el.classList.add("kommt");
    setTimeout(() => f.el.classList.remove("kommt"), 450);
    andere.set(p.id, f);
    zeigeOrtZeile();
  });
  socket.on("welt:raus", ({ id } = {}) => {
    const f = andere.get(id);
    if (!f || reduziert()) return entferneFigur(id);
    // Erst ausblenden, dann weg. Die Figur zählt schon nicht mehr mit.
    andere.delete(id);
    zeigeOrtZeile();
    f.el.classList.add("geht-weg");
    f.schild.classList.add("geht-weg");
    if (f.tier) f.tier.el.classList.add("geht-weg");
    setTimeout(() => { f.el.remove(); f.schild.remove(); if (f.tier) f.tier.el.remove(); }, 320);
  });
  socket.on("welt:z", (z) => {
    if (!drin || !Array.isArray(z)) return;
    const [id, x, y, d, g, s] = z;
    if (ich && id === ich.id) {
      // Ein anderer Tab desselben Kontos bewegt die Figur.
      ich.x = x; ich.y = y; ich.d = d; ich.g = !!g; ich.s = s || 0;
      fremdGesteuertBis = performance.now() + 400;
      zuletztGesendet = { x, y, d, g: g ? 1 : 0, t: performance.now() };
      setzeZustand(ich); platziere(ich);
      return;
    }
    const f = andere.get(id);
    if (!f) return;
    const jetzt = performance.now();
    const letzte = f.puffer[f.puffer.length - 1] || f;
    if (Math.hypot(letzte.x - x, letzte.y - y) > 3) f.puffer = [];
    f.puffer.push({ t: jetzt, x, y, d, g: !!g, s: s || 0 });
    if (f.puffer.length > 30) f.puffer.splice(0, f.puffer.length - 30);
  });
  let belegung = {};
  function zeigeBelegung() {
    raumEl.querySelectorAll("[data-ziel-raum]").forEach((b) => {
      const n = belegung[b.dataset.zielRaum] || 0;
      b.querySelector("small").textContent = n ? `${n} dort` : "";
      b.classList.toggle("belebt", n > 0);
    });
  }
  socket.on("welt:belegung", (zahl) => {
    if (!zahl || typeof zahl !== "object") return;
    belegung = zahl;
    zeigeBelegung();
  });

  socket.on("welt:korrektur", (k) => {
    if (!ich || !k || !raum || k.raum !== raum.id) return;
    ich.x = k.x; ich.y = k.y; ich.d = k.d; ich.s = k.s || 0; ich.g = false;
    ziel = null;
    zuletztGesendet = { x: k.x, y: k.y, d: k.d, g: 0, t: performance.now() };
    setzeZustand(ich); platziere(ich);
  });
  socket.on("welt:umzug", (res) => { if (res && res.ok) uebernehmen(res); });
  socket.on("welt:aussehen", (p) => {
    if (!p) return;
    const f = ich && p.id === ich.id ? ich : andere.get(p.id);
    if (!f) return;
    f.look = p.look || f.look;
    if (f === ich) meinName = f.look.name;
    zeichneFigur(f);
    setzeZustand(f);
  });
  socket.on("welt:aktiv", ({ id, a } = {}) => {
    const f = ich && id === ich.id ? ich : andere.get(id);
    if (!f) return;
    f.a = a || null;
    zeigeAktiv(f);
  });
  socket.on("welt:geste", ({ id, art } = {}) => {
    const f = ich && id === ich.id ? ich : andere.get(id);
    if (f) geste(f, art);
  });

  /* Sprechblasen kommen nur aus dem allgemeinen Chat, den ohnehin jeder
     liest. Lobby-Kanäle und alles Private laufen über andere Räume und
     tauchen hier nie auf. */
  socket.on("chat:msg", ({ room, msg } = {}) => {
    if (room !== "global" || !msg || msg.system || !drin) return;
    const alle = ich ? [ich, ...andere.values()] : [...andere.values()];
    const f = alle.find((x) => x.look && x.look.name === msg.name);
    if (f) sprechblase(f, msg.text);
  });

  socket.on("connect", () => {
    drin = false;
    if (Casino.getAccount && Casino.getAccount()) betreten();
  });
  socket.on("disconnect", () => {
    // Wer nicht mehr verbunden ist, sieht auch niemanden mehr. Keine
    // Figuren, die nur noch so aussehen, als wären sie da.
    drin = false;
    for (const id of [...andere.keys()]) entferneFigur(id);
  });

  /* Eingabe */
  const tasten = new Set();
  const TASTE = {
    ArrowUp: "hoch", KeyW: "hoch", ArrowDown: "runter", KeyS: "runter",
    ArrowLeft: "links", KeyA: "links", ArrowRight: "rechts", KeyD: "rechts",
  };
  function schreibtGerade(e) {
    const ist = (x) => x && (x.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName));
    return ist(e && e.target) || ist(document.activeElement);
  }
  function fensterOffen() {
    if (document.body.classList.contains("sheet-open")) return true;
    if (!auswahlEl.classList.contains("hidden")) return true;
    return !!document.querySelector(".dlg-overlay, .update-modal:not(.hidden), #player-profile-modal:not(.hidden), .heist-overlay:not(.hidden)");
  }
  const bedienbar = () => vorn && drin && !wechselt && !fokus && !tisch && !fensterOffen();

  document.addEventListener("keydown", (e) => {
    if (!auswahlEl.classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); schliesseAuswahl(); return; }
      if (e.key === "Tab") {
        const knoepfe = [...auswahlEl.querySelectorAll("button:not(:disabled), a[href], [tabindex='0']")]
          .filter((el) => el.getClientRects().length);
        const erster = knoepfe[0], letzter = knoepfe[knoepfe.length - 1];
        const aktiv = document.activeElement;
        if (erster && (!auswahlEl.contains(aktiv) || (e.shiftKey ? aktiv === erster : aktiv === letzter))) {
          e.preventDefault();
          (e.shiftKey ? letzter : erster).focus({ preventScroll: true });
        }
      }
      return;
    }
    if (e.key === "Escape" && tisch && !schreibtGerade(e)) { tischZu(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || schreibtGerade(e) || !bedienbar()) return;
    const richtung = TASTE[e.code] || TASTE[e.key];
    if (richtung) {
      tasten.add(richtung);
      ziel = null;
      e.preventDefault();
      return;
    }
    if ((e.code === "KeyM" || e.key === "m" || e.key === "M") && !e.repeat && fahrt.fahrzeug) { aufsitzen(); return; }
    const ziffer = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
    if (ziffer && ziffer <= gestenListe.length && !e.repeat) {
      gesteSenden(gestenListe[ziffer - 1].id);
      return;
    }
    if ((e.code === "KeyE" || e.key === "e" || e.key === "E" || e.key === "Enter") && !e.repeat) {
      if (e.key === "Enter" && e.target && e.target.closest && e.target.closest("button, a")) return;
      if (naechstes) { e.preventDefault(); aktion(); }
    }
  });
  document.addEventListener("keyup", (e) => {
    const richtung = TASTE[e.code] || TASTE[e.key];
    if (richtung) tasten.delete(richtung);
  });
  const allesLoslassen = () => { tasten.clear(); stickLos(); ziel = null; };
  window.addEventListener("blur", allesLoslassen);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) allesLoslassen();
    else if (!drin && Casino.getAccount && Casino.getAccount()) betreten();
  });

  /* Gestenrad: langer Druck auf die eigene Figur. Auf dem iPad ist das
     schneller als das Menü oben, und die Hand ist ohnehin schon dort. Mit
     gedrücktem Finger zur Geste wischen und loslassen, oder loslassen und
     danach antippen. Ein Tipp daneben schließt das Rad. */
  const radEl = document.createElement("div");
  radEl.className = "welt-gestenrad hidden";
  radEl.setAttribute("role", "menu");
  radEl.setAttribute("aria-label", "Gesten");
  el.appendChild(radEl);
  let gestenRad = null;   // { mx, my, wahl }
  const RAD_LANG_MS = 420, RAD_RADIUS = 82;

  function gestenRadAuf() {
    if (!ich || !ich.el) return;
    const b = ich.el.getBoundingClientRect(), h = el.getBoundingClientRect();
    const mx = b.left + b.width / 2 - h.left, my = b.top + b.height * 0.42 - h.top;
    const n = gestenListe.length;
    radEl.innerHTML = `<span class="welt-gestenrad-mitte" aria-hidden="true"></span>` + gestenListe.map((g, i) => {
      const w = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return `<button type="button" role="menuitem" data-rad-geste="${g.id}" style="left:${(Math.cos(w) * RAD_RADIUS).toFixed(1)}px;top:${(Math.sin(w) * RAD_RADIUS).toFixed(1)}px">${esc(g.name)}</button>`;
    }).join("");
    // Am Rand des Bildes nicht abschneiden: der Mittelpunkt rückt nach innen.
    const rand = RAD_RADIUS + 44;
    const x = Math.min(Math.max(mx, rand), h.width - rand), y = Math.min(Math.max(my, rand), h.height - rand);
    radEl.style.left = x + "px"; radEl.style.top = y + "px";
    radEl.classList.remove("hidden");
    gestenRad = { mx: x + h.left, my: y + h.top, wahl: null };
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
  }
  function gestenRadZu() {
    gestenRad = null;
    radEl.classList.add("hidden");
  }
  function gestenRadWahl(cx, cy) {
    if (!gestenRad) return;
    const dx = cx - gestenRad.mx, dy = cy - gestenRad.my;
    let wahl = null;
    if (Math.hypot(dx, dy) > 30) {
      const n = gestenListe.length;
      const w = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      wahl = gestenListe[Math.round(w / (Math.PI * 2 / n)) % n].id;
    }
    gestenRad.wahl = wahl;
    radEl.querySelectorAll("[data-rad-geste]").forEach((b) => b.classList.toggle("an", b.dataset.radGeste === wahl));
  }
  radEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rad-geste]");
    if (b) gesteSenden(b.dataset.radGeste);
    gestenRadZu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (gestenRad && !gestenRad.halten && !radEl.contains(e.target)) {
      gestenRadZu();
      // Der Tipp daneben schließt nur; die Figur soll nicht auch noch dorthin laufen.
      e.stopPropagation();
    }
  }, true);

  /* Der Stick erscheint dort, wo der Finger aufsetzt. Ein fester Platz
     unten links läge genau auf dem Chat-Knopf. Tippen ohne Ziehen ist ein
     Tipp: auf eine Figur, ein Ding oder eine freie Stelle zum Hingehen. */
  let zeiger = null;             // { id, x0, y0, stick, ziel }
  let stick = { x: 0, y: 0 };
  const STICK_RADIUS = 56;
  buehne.addEventListener("pointerdown", (e) => {
    if (!bedienbar() || zeiger || (e.pointerType === "mouse" && e.button !== 0)) return;
    zeiger = { id: e.pointerId, x0: e.clientX, y0: e.clientY, stick: false, element: e.target };
    try { buehne.setPointerCapture(e.pointerId); } catch {}
    // Langer Druck auf die eigene Figur öffnet das Gestenrad.
    if (e.target.closest && e.target.closest(".wf.wf-ich")) {
      const z = zeiger;
      z.lang = setTimeout(() => { if (zeiger === z && !z.stick) { z.rad = true; gestenRadAuf(); if (gestenRad) gestenRad.halten = true; } }, RAD_LANG_MS);
    }
  });
  buehne.addEventListener("pointermove", (e) => {
    if (!zeiger || e.pointerId !== zeiger.id) return;
    if (zeiger.rad) { gestenRadWahl(e.clientX, e.clientY); return; }
    const dx = e.clientX - zeiger.x0, dy = e.clientY - zeiger.y0;
    if (zeiger.lang && Math.hypot(dx, dy) > 12) { clearTimeout(zeiger.lang); zeiger.lang = null; }
    if (!zeiger.stick && Math.hypot(dx, dy) > 12) {
      zeiger.stick = true;
      ziel = null;
      const b = el.getBoundingClientRect();
      stickEl.style.left = zeiger.x0 - b.left + "px";
      stickEl.style.top = zeiger.y0 - b.top + "px";
      stickEl.classList.remove("hidden");
    }
    if (zeiger.stick) {
      const l = Math.hypot(dx, dy);
      const k = l > STICK_RADIUS ? STICK_RADIUS / l : 1;
      stick = { x: (dx * k) / STICK_RADIUS, y: (dy * k) / STICK_RADIUS };
      stickEl.querySelector("i").style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  });
  function stickLos() {
    stick = { x: 0, y: 0 };
    stickEl.classList.add("hidden");
    stickEl.querySelector("i").style.transform = "";
  }
  function zeigerEnde(e) {
    if (!zeiger || e.pointerId !== zeiger.id) return;
    const war = zeiger;
    zeiger = null;
    try { buehne.releasePointerCapture(e.pointerId); } catch {}
    clearTimeout(war.lang);
    if (war.rad) {
      // Gewischt: die Geste gilt. Nicht gewischt: das Rad bleibt zum Antippen offen.
      if (gestenRad && gestenRad.wahl && e.type === "pointerup") { gesteSenden(gestenRad.wahl); gestenRadZu(); }
      else if (gestenRad) gestenRad.halten = false;
      return;
    }
    if (war.stick) { stickLos(); return; }
    if (e.type === "pointerup") tippen(war.element, e.clientX, e.clientY);
  }
  buehne.addEventListener("pointerup", zeigerEnde);
  buehne.addEventListener("pointercancel", zeigerEnde);
  /* Wechselt der Bildschirm mitten im Tipp, kommt das Loslassen nie an.
     Ohne diese Zeile hinge der alte Tipp fest und würde beim nächsten
     Loslassen nachgeholt, also womöglich an einem ganz anderen Ding. */
  buehne.addEventListener("lostpointercapture", () => { if (zeiger && zeiger.stick) stickLos(); if (zeiger) clearTimeout(zeiger.lang); zeiger = null; });
  buehne.addEventListener("contextmenu", (e) => e.preventDefault());

  function tippen(element, cx, cy) {
    if (!bedienbar()) return;
    const name = element && element.closest && element.closest("[data-profil]");
    if (name) { Casino.openPlayerProfile(name.dataset.profil); return; }
    // Eine Figur trifft man auch am Körper, nicht nur am Namen.
    const figEl = element && element.closest && element.closest(".wf");
    if (figEl) {
      const id = Number(figEl.dataset.fig);
      const f = ich && id === ich.id ? ich : andere.get(id);
      if (f && f.look && f.look.name) { Casino.openPlayerProfile(f.look.name); return; }
    }
    const ortsteil = element && element.closest && element.closest("[data-ortsteil]");
    ortsteilWunsch = ortsteil ? ortsteil.dataset.ortsteil : null;
    // Genauso eine Zeile auf der Kurstafel: die Börse öffnet bei dieser Aktie.
    const aktie = element && element.closest && element.closest("[data-aktie]");
    aktieWunsch = aktie ? aktie.dataset.aktie : null;
    const dingEl = element && element.closest && element.closest("[data-ding]");
    if (dingEl) { hingehenZuDing(dingEl.dataset.ding); return; }
    const schild = element && element.closest && element.closest("[data-tuer]");
    if (schild) { hingehenZurTuer(raum.tueren.find((t) => t.id === schild.dataset.tuer)); return; }
    const p = bildschirmZuWelt(cx, cy);
    if (!p) return;
    // Wer auf eine Tür tippt, will hindurch und nicht nur davor stehen.
    const tuer = raum.tueren.find((t) => !t.versteckt && p.x >= t.x1 - 1.5 && p.x <= t.x2 + 1.5 && p.y >= t.y1 - 0.4 && p.y <= t.y2 + 0.4);
    if (tuer) hingehenZurTuer(tuer);
    else hingehen(p.x, p.y, null);
  }

  /* Wo man vor einer Tür steht und in welche Richtung es hindurchgeht.
     Türen liegen links, rechts oder unten am Rand. */
  function tuerWeg(t) {
    const mx = (t.x1 + t.x2) / 2, my = (t.y1 + t.y2) / 2;
    if (t.x2 <= 0.5) return { vor: [0.6, my], rein: [0, my] };
    if (t.x1 >= raum.w - 0.5) return { vor: [raum.w - 0.6, my], rein: [raum.w, my] };
    if (t.y1 >= raum.h - 0.5) return { vor: [mx, raum.h - 0.6], rein: [mx, raum.h], senkrecht: true };
    // In der Rückwand (der Torbogen zur Spielhalle): davor stehen, dann hinein.
    return { vor: [mx, t.y2 + 0.5], rein: [mx, t.y1 + 0.1], senkrecht: true };
  }
  function hingehenZurTuer(t) {
    if (!t) return;
    const w = tuerWeg(t);
    hingehen(w.vor[0], w.vor[1], { tuer: t });
  }

  // Tastatur und Vorleser: ein fokussiertes Ding lässt sich mit Enter nutzen.
  raumEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ding]");
    if (b && e.detail === 0 && bedienbar()) hingehenZuDing(b.dataset.ding);
    const n = e.target.closest("[data-profil]");
    if (n && e.detail === 0) Casino.openPlayerProfile(n.dataset.profil);
    const t = e.target.closest("[data-tuer]");
    if (t && e.detail === 0 && bedienbar()) hingehenZurTuer(raum.tueren.find((x) => x.id === t.dataset.tuer));
  });

  aktionKnopf.addEventListener("click", () => { if (bedienbar()) aktion(); });

  /* Auf sehr schmalen Bildschirmen passen nicht alle Knöpfe in die Leiste.
     Schnellwahl bleibt, der Rest liegt dann beschriftet unter „Mehr“
     (welt.css blendet je nach Breite um). Die Einträge lösen dieselben
     Aktionen aus wie die Knöpfe selbst; Gesten öffnen das Gestenrad, weil
     das Gestenmenü an seinem ausgeblendeten Knopf hängt. */
  const mehrMenue = el.querySelector(".welt-mehr");
  const mehrKnopf = el.querySelector('[data-welt="mehr"]');
  function mehrAuf(auf) {
    if (auf) {
      const eintraege = [];
      if (!el.querySelector('[data-welt="starter"]').classList.contains("hidden")) eintraege.push(["starter", "Starter-Pass"]);
      eintraege.push(["gesten", "Gesten"]);
      if (fahrt.fahrzeug) eintraege.push(["fahrt", fahrt.auf ? "Absteigen" : "Aufsteigen"]);
      eintraege.push(["musik", "Musik"]);
      eintraege.push(["liste", "Übersicht"]);
      mehrMenue.innerHTML = eintraege.map(([was, text]) => `<button type="button" role="menuitem" data-mehr="${was}">${esc(text)}</button>`).join("");
    }
    mehrMenue.classList.toggle("hidden", !auf);
    mehrKnopf.setAttribute("aria-expanded", String(auf));
    if (auf) mehrMenue.querySelector("button")?.focus();
  }
  mehrMenue.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mehr]");
    if (!b) return;
    e.stopPropagation();
    mehrAuf(false);
    const was = b.dataset.mehr;
    if (was === "gesten") gestenRadAuf();
    else if (was === "musik") musikAuf(true);
    else el.querySelector(`[data-welt="${was}"]`)?.click();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!mehrMenue.classList.contains("hidden") && !e.target.closest(".welt-mehr-huelle")) mehrAuf(false);
  });
  mehrMenue.addEventListener("keydown", (e) => { if (e.key === "Escape") { mehrAuf(false); mehrKnopf.focus(); } });

  /* Musik direkt in der Welt: an, aus und lauter, ohne erst in die
     Einstellungen zu wechseln. Dieselben Werte wie dort, und gespeichert
     wird am Konto wie dort. */
  const musikFeld = el.querySelector(".welt-musik");
  const musikKnopf = el.querySelector('[data-welt="musik"]');
  const STIL_NAME = { lounge: "Lounge", synthwave: "Synthwave", chiptune: "Chiptune", disco: "Disco", house: "House", swing: "Swing", polka: "Polka", ruhm: "Fanfaren" };
  function musikAuf(auf) {
    const m = Casino.musik;
    if (!m) return;
    if (auf) {
      musikFeld.querySelector('[data-musik="an"]').checked = m.istAn();
      musikFeld.querySelector('[data-musik="vol"]').value = String(Math.round(m.getLautstaerke() * 100));
      const z = m.zustand();
      musikFeld.querySelector(".welt-musik-jetzt").textContent = !Casino.sound.isEnabled() ? "Der Ton ist in den Einstellungen aus."
        : z.stil ? `Läuft: ${STIL_NAME[z.stil] || z.stil}${z.jukebox ? " (Jukebox)" : ""}` : z.atmo ? "Hier draußen hörst du nur die Umgebung." : "";
    }
    musikFeld.classList.toggle("hidden", !auf);
    musikKnopf.setAttribute("aria-expanded", String(auf));
  }
  musikFeld.addEventListener("change", (e) => {
    const m = Casino.musik;
    if (!m) return;
    if (e.target.dataset.musik === "an") { m.setAn(e.target.checked); Casino.savePrefs && Casino.savePrefs({ musik: e.target.checked }); }
    if (e.target.dataset.musik === "vol") Casino.savePrefs && Casino.savePrefs({ musikVol: m.getLautstaerke() });
    const box = document.getElementById("set-musik"), sl = document.getElementById("set-musik-vol");
    if (box) box.checked = m.istAn();
    if (sl) sl.value = String(Math.round(m.getLautstaerke() * 100));
  });
  musikFeld.addEventListener("input", (e) => {
    if (e.target.dataset.musik === "vol" && Casino.musik) Casino.musik.setLautstaerke(e.target.value / 100);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!musikFeld.classList.contains("hidden") && !e.target.closest(".welt-musik, .welt-musik-knopf, .welt-mehr-huelle")) musikAuf(false);
  });

  const gestenMenue = el.querySelector(".welt-gesten");
  const gestenKnopf = el.querySelector('[data-welt="gesten"]');
  function gestenAuf(auf) {
    gestenMenue.classList.toggle("hidden", !auf);
    gestenKnopf.setAttribute("aria-expanded", String(auf));
  }
  document.addEventListener("pointerdown", (e) => {
    if (!gestenMenue.classList.contains("hidden") && !e.target.closest(".welt-gesten-huelle")) gestenAuf(false);
  });

  el.querySelector(".welt-knoepfe").addEventListener("click", (e) => {
    const g = e.target.closest("[data-geste]");
    if (g) { gestenAuf(false); gesteSenden(g.dataset.geste); return; }
    const b = e.target.closest("[data-welt]");
    if (!b) return;
    const was = b.dataset.welt;
    if (was === "orte") zeigeSchnellwahl();
    else if (was === "liste") setzeAnsicht("liste");
    else if (was === "gesten") gestenAuf(gestenMenue.classList.contains("hidden"));
    else if (was === "fahrt") aufsitzen();
    else if (was === "mehr") mehrAuf(mehrMenue.classList.contains("hidden"));
    else if (was === "musik") musikAuf(musikFeld.classList.contains("hidden"));
    else if (was === "starter") {
      setzeAnsicht("liste");
      setTimeout(() => document.getElementById("starter-pass")?.scrollIntoView({ behavior: reduziert() ? "auto" : "smooth", block: "center" }), 60);
    }
  });

  /* Auf- und absteigen. Das Fahrzeug bleibt angelegt; der Knopf erscheint
     nur, wenn eins da ist, und M auf der Tastatur macht dasselbe. */
  let fahrt = { fahrzeug: null, auf: false, steht: false };
  const fahrtKnopf = el.querySelector('[data-welt="fahrt"]');
  function fahrtSetzen(z) {
    fahrt = { fahrzeug: (z && z.fahrzeug) || null, auf: !!(z && z.auf), steht: !!(z && z.steht) };
    fahrtKnopf.classList.toggle("hidden", !fahrt.fahrzeug);
    fahrtKnopf.classList.toggle("an", fahrt.auf);
    fahrtKnopf.setAttribute("aria-pressed", String(fahrt.auf));
    fahrtKnopf.querySelector("span").textContent = fahrt.auf ? "Absteigen" : "Aufsteigen";
  }
  const FAHRT_KLANG = { mopedauto: "motor_an", goldmoped: "motor_an", aufsitzmaeher: "motor_an", e_roller: "elektro_an", skateboard: "rollen", hoverboard: "schweben", bobbycar: "rollen" };
  function aufsitzen() {
    if (!drin || !fahrt.fahrzeug) return;
    socket.emit("welt:aufsitzen", { an: !fahrt.auf }, (res) => {
      if (!res || !res.ok) { if (res && res.error && res.error !== "Langsam.") Casino.toast(res.error); return; }
      fahrtSetzen(res);
      if (ich && !reduziert()) sprungZeigen(ich);
      klang(fahrt.auf ? (FAHRT_KLANG[fahrt.fahrzeug] || "aufsteigen") : "aufsteigen");
    });
  }
  socket.on("welt:fahrt", fahrtSetzen);

  /* Die Schnitzeljagd (game/schnitzeljagd.js): goldene Marken im Raum. Wer
     drüberläuft, hebt sie auf; ein Tipp auf eine Marke läuft hin. Ob man nah
     genug ist, entscheidet der Server an der Figur. */
  let jagd = { aktiv: false, marken: [], gefunden: 0, gesamt: 0, bis: 0 };
  const jagdHud = document.createElement("div");
  jagdHud.className = "welt-jagd hidden";
  el.querySelector(".welt-hud").appendChild(jagdHud);
  let jagdHolt = null;
  function jagdLaden() {
    if (!drin || !raum) return;
    const raumId = raum.id;
    socket.emit("jagd:state", { raum: raumId }, (r) => {
      if (!r || !r.ok || !raum || raum.id !== raumId) return;
      jagd = { aktiv: r.aktiv, marken: r.marken || [], gefunden: r.gefunden, gesamt: r.gesamt, bis: r.bis };
      jagdZeichnen();
    });
  }
  function jagdZeichnen() {
    dingeEbene.querySelectorAll(".welt-jagdmarke").forEach((m) => m.remove());
    for (const m of jagd.marken) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "welt-jagdmarke";
      b.dataset.jagd = m.id;
      b.setAttribute("aria-label", "Goldene Marke aufheben");
      b.style.transform = `translate3d(${(m.x * T - 13).toFixed(1)}px, ${(m.y * T - 26).toFixed(1)}px, 0)`;
      b.style.zIndex = Math.round(m.y * 100);
      dingeEbene.appendChild(b);
    }
    const tage = Math.max(0, Math.ceil((jagd.bis - Date.now()) / 86400000));
    jagdHud.classList.toggle("hidden", !jagd.aktiv);
    jagdHud.innerHTML = jagd.aktiv ? `<b>Schnitzeljagd</b><span>${jagd.gefunden} von ${jagd.gesamt}${tage ? ` · noch ${tage} ${tage === 1 ? "Tag" : "Tage"}` : ""}</span><small>${jagd.marken.length ? `${jagd.marken.length} hier im Raum` : "hier nichts mehr"}</small>` : "";
  }
  function jagdNah() {
    if (!ich || jagdHolt) return;
    const m = jagd.marken.find((x) => Math.hypot(x.x - ich.x, x.y - ich.y) < 0.75);
    if (!m) return;
    jagdHolt = m.id;
    sendeZug(false);
    socket.emit("jagd:finden", { id: m.id }, (r) => {
      jagdHolt = null;
      if (!r || !r.ok) return;
      jagd.marken = jagd.marken.filter((x) => x.id !== m.id);
      jagd.gefunden = r.gefunden;
      const knopf = dingeEbene.querySelector(`[data-jagd="${m.id}"]`);
      if (knopf) { knopf.classList.add("weg"); setTimeout(() => knopf.remove(), 600); }
      if (r.account && Casino.applyAccount) Casino.applyAccount(r.account);
      Casino.sound && Casino.sound.play && Casino.sound.play(r.fertig ? "bigwin" : "marke");
      if (r.fertig) Casino.dialog.hinweis(`Alle ${r.gesamt} goldenen Marken gefunden! Dazu gibt es ${r.chips.toLocaleString("de-DE")} Chips und den Titel „Schatzsucher“.`, { titel: "Schatz gehoben" });
      else Casino.toast(`Goldene Marke! +${r.chips.toLocaleString("de-DE")} Chips · ${r.gefunden} von ${r.gesamt}`);
      jagdZeichnen();
    });
  }
  socket.on("jagd:update", () => jagdLaden());
  dingeEbeneKlick();
  function dingeEbeneKlick() {
    el.addEventListener("click", (e) => {
      const m = e.target.closest && e.target.closest(".welt-jagdmarke");
      if (!m || !bedienbar()) return;
      const marke = jagd.marken.find((x) => x.id === m.dataset.jagd);
      if (marke) hingehen(marke.x, marke.y, null);
    });
  }

  /* Die Shisha glüht stärker, sobald zwei oder mehr daran sitzen. Billig
     genug, um es alle anderthalb Sekunden nachzusehen. */
  setInterval(() => {
    if (!drin || !raum || raum.id !== "hof") return;
    const sh = dingEls.get("shisha");
    if (!sh) return;
    const sitzen = [ich, ...andere.values()].filter((f) => f && String(f.s || "").startsWith("shisha-")).length;
    sh.classList.toggle("runde", sitzen >= 2);
  }, 1500);

  /* Die Stadt über der Welt: die Tafeln neben der Karte („Dein Imperium“,
     „Wem gehört Porta“) starten zugeklappt und gehen per Tipp auf. Das CSS
     greift nur im Fenster über der Welt; in der Übersicht bleibt alles offen. */
  document.querySelectorAll('[data-screen="businesses"] .biz-collect-panel').forEach((p) => {
    const kopf = p.querySelector(".cd-sub");
    if (!kopf) return;
    p.classList.add("klappbar", "zu");
    kopf.setAttribute("role", "button");
    kopf.setAttribute("tabindex", "0");
    kopf.setAttribute("aria-expanded", "false");
    const umschalten = () => { const zu = p.classList.toggle("zu"); kopf.setAttribute("aria-expanded", String(!zu)); };
    kopf.addEventListener("click", umschalten);
    kopf.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); umschalten(); } });
  });

  /* Der alte Dreier springt nicht an. Wer auf ihm losfahren will, bekommt
     eine Qualmwolke, und zwar für alle sichtbar: dieselbe Geste wie im Menü. */
  let qualmTs = 0;
  function qualmen() {
    const jetzt = performance.now();
    if (jetzt - qualmTs < 3400) return;
    qualmTs = jetzt;
    gesteSenden("qualmen");
  }

  function gesteSenden(art) {
    if (!drin) return;
    socket.emit("welt:geste", { art }, (res) => {
      if (res && !res.ok && res.error) Casino.toast(res.error);
    });
  }

  /* Wege. Für das Hingehen per Tipp: ein Raster über den Raum und die
     kürzeste Folge freier Felder dorthin. */
  const RASTER = 0.25;
  function raster() {
    if (begehbarRaster && begehbarRaster.raum === raum) return begehbarRaster;
    const sp = Math.ceil(raum.w / RASTER) + 1, ze = Math.ceil(raum.h / RASTER) + 1;
    const frei = new Uint8Array(sp * ze);
    for (let j = 0; j < ze; j++) for (let i = 0; i < sp; i++) frei[j * sp + i] = R.begehbar(raum, i * RASTER, j * RASTER) ? 1 : 0;
    begehbarRaster = { raum, sp, ze, frei };
    return begehbarRaster;
  }

  function naechsteFreieZelle(g, x, y) {
    let best = -1, bestD = Infinity;
    const ci = Math.round(x / RASTER), cj = Math.round(y / RASTER);
    for (let j = cj - 4; j <= cj + 4; j++) for (let i = ci - 4; i <= ci + 4; i++) {
      if (i < 0 || j < 0 || i >= g.sp || j >= g.ze || !g.frei[j * g.sp + i]) continue;
      const d = Math.hypot(i * RASTER - x, j * RASTER - y);
      if (d < bestD) { bestD = d; best = j * g.sp + i; }
    }
    return best;
  }

  function wegSuchen(zx, zy) {
    const g = raster();
    const start = naechsteFreieZelle(g, ich.x, ich.y);
    const zielZ = naechsteFreieZelle(g, zx, zy);
    if (start < 0 || zielZ < 0) return null;
    const kosten = new Float32Array(g.sp * g.ze).fill(Infinity);
    const von = new Int32Array(g.sp * g.ze).fill(-1);
    const zu = new Uint8Array(g.sp * g.ze);
    const zi = zielZ % g.sp, zj = (zielZ / g.sp) | 0;
    // Oktil-Abstand: passt genau zu Schritten von 1 und 1,4142, schätzt also nie zu hoch.
    const h = (k) => {
      const dx = Math.abs((k % g.sp) - zi), dy = Math.abs(((k / g.sp) | 0) - zj);
      return dx + dy - 0.5858 * Math.min(dx, dy);
    };
    /* Offene Felder liegen in einem Heap. Vorher wurde bei jedem Schritt
       die ganze Liste nach dem besten Feld abgesucht; über den Casinoraum
       kostete das bis 7 ms, mit Heap ist es unter einer, bei gleichen Wegen. */
    const offen = [], prio = [];
    const rein = (k, p) => {
      let i = offen.length;
      offen.push(k); prio.push(p);
      while (i > 0) {
        const e = (i - 1) >> 1;
        if (prio[e] <= p) break;
        offen[i] = offen[e]; prio[i] = prio[e]; i = e;
      }
      offen[i] = k; prio[i] = p;
    };
    const raus = () => {
      const oben = offen[0], k = offen.pop(), p = prio.pop(), m = offen.length;
      if (m) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= m) break;
          if (c + 1 < m && prio[c + 1] < prio[c]) c++;
          if (prio[c] >= p) break;
          offen[i] = offen[c]; prio[i] = prio[c]; i = c;
        }
        offen[i] = k; prio[i] = p;
      }
      return oben;
    };
    kosten[start] = 0;
    rein(start, h(start));
    while (offen.length) {
      const k = raus();
      if (k === zielZ) break;
      if (zu[k]) continue;
      zu[k] = 1;
      const ci = k % g.sp, cj = Math.floor(k / g.sp);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= g.sp || nj >= g.ze) continue;
        const n = nj * g.sp + ni;
        if (!g.frei[n] || zu[n]) continue;
        if (di && dj && (!g.frei[cj * g.sp + ni] || !g.frei[nj * g.sp + ci])) continue;
        const nk = kosten[k] + (di && dj ? 1.4142 : 1);
        if (nk < kosten[n]) { kosten[n] = nk; von[n] = k; rein(n, nk + h(n)); }
      }
    }
    if (kosten[zielZ] === Infinity) return null;
    const punkte = [];
    for (let k = zielZ; k !== -1 && k !== start; k = von[k]) punkte.unshift([(k % g.sp) * RASTER, Math.floor(k / g.sp) * RASTER]);
    // Glätten: von jedem Punkt so weit springen, wie man freie Sicht hat.
    const glatt = [];
    let ax = ich.x, ay = ich.y, i = 0;
    while (i < punkte.length) {
      let j = punkte.length - 1;
      while (j > i && !R.wegFrei(raum, ax, ay, punkte[j][0], punkte[j][1])) j--;
      glatt.push(punkte[j]);
      [ax, ay] = punkte[j];
      i = j + 1;
    }
    return glatt;
  }

  function hingehen(x, y, danach) {
    const pfad = wegSuchen(x, y);
    if (!pfad) return;
    if (ich.s) aufstehenLokal();
    ziel = { pfad, danach };
    letzterWeg = { x, y, pfad: pfad.map((p) => p.slice()), danach: danach && (danach.id || (danach.tuer && danach.tuer.id)) };
    zielMarke(x, y);
  }
  let letzterWeg = null;

  let markeEl = null;
  function zielMarke(x, y) {
    if (!schilderEbene) return;
    if (!markeEl || !markeEl.isConnected) {
      markeEl = document.createElement("span");
      markeEl.className = "welt-zielmarke";
      schilderEbene.appendChild(markeEl);
    }
    markeEl.style.transform = `translate3d(${x * T}px, ${y * T}px, 0)`;
    markeEl.classList.remove("an");
    void markeEl.offsetWidth;
    markeEl.classList.add("an");
  }

  function hingehenZuDing(id) {
    const d = raum && raum.dinge.find((x) => x.id === id);
    if (!d || !d.ziel) return;
    // Anzeigen an der Wand liest man aus dem ganzen Raum.
    if (R.reichweite(d) <= 0) { benutze(d); return; }
    if (R.abstandZuDing(d, ich.x, ich.y) <= R.reichweite(d) - 0.05 && R.naechstesDing(raum, ich.x, ich.y) === d) {
      benutze(d);
      return;
    }
    // Der freie Punkt in Reichweite, der am nächsten liegt.
    const g = raster();
    let best = null, bestD = Infinity;
    for (let j = 0; j < g.ze; j++) for (let i = 0; i < g.sp; i++) {
      if (!g.frei[j * g.sp + i]) continue;
      const x = i * RASTER, y = j * RASTER;
      if (R.abstandZuDing(d, x, y) > R.reichweite(d) * 0.8) continue;
      if (R.naechstesDing(raum, x, y) !== d) continue;
      const dd = Math.hypot(x - ich.x, y - ich.y);
      if (dd < bestD) { bestD = dd; best = [x, y]; }
    }
    if (best) hingehen(best[0], best[1], d);
  }

  /* Benutzen */
  function aktion() {
    if (!naechstes) return;
    if (naechstes.sitz) return hinsetzen(naechstes.sitz);
    benutze(naechstes.ding);
  }

  function sendeZug(g) {
    if (!ich || !drin) return;
    socket.emit("welt:zug", { x: +ich.x.toFixed(2), y: +ich.y.toFixed(2), d: ich.d, g: g ? 1 : 0 });
    zuletztGesendet = { x: ich.x, y: ich.y, d: ich.d, g: g ? 1 : 0, t: performance.now() };
  }

  let benutztGerade = false;
  function benutze(d) {
    if (!d || benutztGerade || !drin) return;
    // Wer schon an der Shisha sitzt, zieht, statt sich noch einmal zu setzen.
    if (d.ziel && d.ziel.shisha && ich && String(ich.s || "").startsWith("shisha-")) { gesteSenden("shisha"); return; }
    benutztGerade = true;
    ziel = null;
    tasten.clear();
    ich.g = false;
    setzeZustand(ich);
    sendeZug(false);
    socket.emit("welt:nutzen", { ding: d.id }, (res) => {
      benutztGerade = false;
      if (!res || !res.ok) { Casino.toast((res && res.error) || "Das geht gerade nicht."); return; }
      const z = res.ziel || {};
      // Am Kartentisch hat der Server einen hingesetzt; alle im Raum sehen es.
      if (res.platz) {
        const p = res.platz;
        ich.x = p.x; ich.y = p.y; ich.d = p.d; ich.s = p.s; ich.g = false;
        zuletztGesendet = { x: ich.x, y: ich.y, d: ich.d, g: 0, t: performance.now() };
        setzeZustand(ich); platziere(ich);
      }
      if (z.tisch === "roulette" && z.regeln) tischAuf(d, z.regeln);
      else if (z.rad) radAuf(d);
      else if (z.rennen) rennAuf(d);
      else if (z.lotto) lottoAuf(d);
      else if (z.greifer) greiferAuf(d);
      else if (z.bericht) { if (Casino._berichtZeigen) Casino._berichtZeigen(); }
      else if (z.auswahl) zeigeAuswahl(d, z.auswahl);
      else if (z.umzug) geheimgang(d, z.umzug);
      else if (z.geheimnis) geheimnisZeigen(z.geheimnis);
      else if (z.jukebox) {
        Casino.toast(`♪ Die Jukebox spielt ${z.jukebox.lied}`);
        klang("jukebox");
        if (Casino.musik && z.jukebox.musik) Casino.musik.jukebox(z.jukebox.musik.stil, z.jukebox.musik.rest);
        const jb = dingEls.get(d.id);
        if (jb) { jb.classList.remove("spielt"); void jb.offsetWidth; jb.classList.add("spielt"); }
      }
      else if (z.shisha && res.platz) Casino.toast("Du sitzt an der Shisha. Tipp sie noch einmal an, um zu ziehen.");
      else if (z.shisha) Casino.toast("Gerade sind alle Kissen besetzt.");
      else if (z.hinweis) Casino.dialog.hinweis(z.hinweis, { titel: d.label });
      else if (z.ansicht) zeigeInUebersicht(z.ansicht);
      else oeffne(d, z);
    });
  }

  function oeffne(d, zielDaten) {
    if (!Casino.screens.exists(zielDaten.screen)) return;
    fahreZu(d.fokus || { x: d.x, y: d.y - 1, zoom: 2 });
    const los = () => {
      if (zielDaten.maschine && Casino._slotsWunsch) Casino._slotsWunsch(zielDaten.maschine);
      if (zielDaten.laden && Casino._ladenWunsch) Casino._ladenWunsch(zielDaten.laden);
      if (zielDaten.screen === "businesses" && ortsteilWunsch && Casino._stadtOrtsteil) Casino._stadtOrtsteil(ortsteilWunsch);
      if (zielDaten.screen === "stocks" && aktieWunsch && Casino._aktieWunsch) Casino._aktieWunsch(aktieWunsch);
      ortsteilWunsch = null; aktieWunsch = null;
      Casino.showScreen(zielDaten.screen);
    };
    if (reduziert()) los();
    else setTimeout(los, 430);
  }

  /*
   * Roulette am Tisch, ohne den Raum zu verlassen.
   *
   * Die Kamera fährt an den Tisch, unten erscheint ein kleines Tableau.
   * Gesetzt wird mit denselben Wetten wie im großen Roulette, gedreht über
   * dasselbe Ereignis (`roulette:spin`); Zahl, Auszahlung und Grenzen kommen
   * vom Server. Die Welt zeigt nur: die Chips auf dem Filz, und das Rad, das
   * sich dreht, sobald der Server das Ergebnis an alle im Raum schickt.
   */
  const tischEl = $(".welt-tisch");
  let tisch = null;
  let letzteWetten = null;
  const CHIPS = [50, 100, 500, 1000, 5000];
  const deZahl = (n) => Math.floor(n).toLocaleString("de-DE");
  const WETTEN = [
    { type: "red", label: "Rot", q: "einfach", klasse: "rot" },
    { type: "black", label: "Schwarz", q: "einfach", klasse: "schwarz" },
    { type: "even", label: "Gerade", q: "einfach" },
    { type: "odd", label: "Ungerade", q: "einfach" },
    { type: "low", label: "1 bis 18", q: "einfach" },
    { type: "high", label: "19 bis 36", q: "einfach" },
    { type: "dozen", value: 1, label: "1. Dutzend", q: "dutzend" },
    { type: "dozen", value: 2, label: "2. Dutzend", q: "dutzend" },
    { type: "dozen", value: 3, label: "3. Dutzend", q: "dutzend" },
  ];
  const wettName = (w) => w.type === "number" ? `Zahl ${w.value}` : (WETTEN.find((x) => x.type === w.type && x.value === w.value) || {}).label || w.type;

  function tischAuf(d, regeln) {
    tisch = { d, regeln, einsaetze: [], letzte: letzteWetten, chip: CHIPS.find((c) => c >= regeln.min * 2) || regeln.min, zahlen: false, dreht: false, info: "" };
    ziel = null; tasten.clear();
    // Der Tisch steht oben im Bild, darunter liegt das Tableau.
    fahreZu({ ...(d.fokus || { x: d.x, y: d.y - 1 }), zoom: 1.9, oben: 0.24 });
    tischEl.classList.remove("hidden");
    zeichneTisch();
  }

  function tischZu() {
    if (!tisch || tisch.dreht) return;
    tisch = null;
    radWischbar();
    tischEl.classList.add("hidden");
    chipsAufFilz();
    fahreZurueck();
  }

  const summe = () => (tisch ? tisch.einsaetze.reduce((a, b) => a + b.amount, 0) : 0);

  function zeichneTisch() {
    if (!tisch) return;
    radWischbar();
    if (tisch.art === "rad") return zeichneRadTafel();
    if (tisch.art === "rennen") return zeichneRennTafel();
    if (tisch.art === "lotto") return zeichneLottoTafel();
    if (tisch.art === "greifer") return zeichneGreiferTafel();
    const q = tisch.regeln.quoten || {};
    const faktor = (k) => (q[k] ? String(q[k]).replace(".", ",") + "×" : "");
    const rot = new Set(tisch.regeln.rot || []);
    const acc = Casino.getAccount() || {};
    tischEl.innerHTML = `
      <header><div><b>Roulette</b><small>Einsatz ${deZahl(summe())} von höchstens ${deZahl(tisch.regeln.max)} · Guthaben ${deZahl(acc.chips || 0)}</small></div>
        <button type="button" class="welt-tisch-zu" data-tisch="zu" aria-label="Vom Tisch aufstehen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>
      <div class="welt-tisch-chips" role="radiogroup" aria-label="Chipwert">${CHIPS.filter((c) => c >= tisch.regeln.min).map((c) => `<button type="button" role="radio" aria-checked="${c === tisch.chip}" class="${c === tisch.chip ? "an" : ""}" data-chip="${c}">${c >= 1000 ? c / 1000 + "k" : c}</button>`).join("")}</div>
      <div class="welt-tisch-felder">${WETTEN.map((w) => {
        const drauf = tisch.einsaetze.find((e) => e.type === w.type && e.value === w.value);
        return `<button type="button" class="${w.klasse || ""}" data-wette="${w.type}" data-wert="${w.value || ""}"><b>${esc(w.label)}</b><small>${faktor(w.q)}</small>${drauf ? `<i>${deZahl(drauf.amount)}</i>` : ""}</button>`;
      }).join("")}
        <button type="button" class="zahl${tisch.zahlen ? " an" : ""}" data-tisch="zahlen"><b>Einzelne Zahl</b><small>${faktor("zahl")}</small></button></div>
      ${tisch.zahlen ? `<div class="welt-tisch-zahlen">${Array.from({ length: 37 }, (_, n) => {
        const drauf = tisch.einsaetze.find((e) => e.type === "number" && e.value === n);
        return `<button type="button" class="${n === 0 ? "gruen" : rot.has(n) ? "rot" : "schwarz"}${drauf ? " belegt" : ""}" data-wette="number" data-wert="${n}">${n}</button>`;
      }).join("")}</div>` : ""}
      <div class="welt-tisch-aktionen">
        <button type="button" class="welt-tisch-drehen" data-tisch="drehen" ${tisch.dreht || !tisch.einsaetze.length ? "disabled" : ""}>${tisch.dreht ? "Die Kugel rollt…" : "Drehen"}</button>
        <button type="button" data-tisch="nochmal" ${tisch.dreht || !tisch.letzte || tisch.einsaetze.length ? "disabled" : ""}>Nochmal</button>
        <button type="button" data-tisch="loeschen" ${tisch.dreht || !tisch.einsaetze.length ? "disabled" : ""}>Abräumen</button>
        <button type="button" data-tisch="gross" ${tisch.dreht ? "disabled" : ""}>Großer Tisch</button>
      </div>
      <p class="welt-tisch-info" aria-live="polite">${esc(tisch.info || "Chip wählen, auf ein Feld tippen, drehen.")}</p>`;
    chipsAufFilz();
  }

  /* Die eigenen Einsätze als Stapel auf dem Welt-Tisch. */
  const CHIP_FARBE = { red: "#c8243a", black: "#1d1d23", even: "#3f6fd0", odd: "#8d5bd6", low: "#23a197", high: "#e2873a", dozen: "#e2b656", number: "#f4efe2" };
  /* Wo ein Einsatz auf dem kleinen Tableau liegt, in Pixeln des Tischs.
     Die Maße stehen in moebel.js (TABLEAU), dieselben, mit denen der Filz
     gezeichnet ist. Vorher lagen alle Chips der Reihe nach über den Zahlen,
     egal worauf man gesetzt hatte. */
  function chipOrt(e) {
    const L = M.TABLEAU;
    if (!L) return null;
    if (e.type === "number") {
      if (e.value === 0) return [L.x - L.zw / 2, L.y + L.zh];
      // Das echte Tableau hat 12 Spalten zu 3 Reihen, das kleine 6 zu 2.
      const spalte = Math.floor((e.value - 1) / 3), reihe = (e.value - 1) % 3;
      const x = L.x + Math.floor(spalte / 2) * L.zw + L.zw / 2 + (spalte % 2 ? 2 : -2);
      const y = L.y + (reihe === 2 ? 0 : 1) * L.zh + L.zh / 2 + (reihe === 1 ? -2 : 2);
      return [x, y];
    }
    if (e.type === "dozen") return [L.x + (e.value - 1) * L.zw * 2 + L.zw, L.dy + L.rh / 2];
    const i = ["low", "even", "red", "black", "odd", "high"].indexOf(e.type);
    return i < 0 ? null : [L.x + i * L.zw + L.zw / 2, L.ay + L.rh / 2];
  }

  function chipsAufFilz() {
    const box = raumEl.querySelector('[data-anzeige="roulette-chips"]');
    if (!box) return;
    const liste = tisch && tisch.einsaetze ? tisch.einsaetze : [];
    box.innerHTML = liste.map((e) => {
      const ort = chipOrt(e);
      if (!ort) return "";
      // Je mehr gesetzt ist, desto höher der Stapel, höchstens fünf Chips.
      const hoehe = Math.min(5, 1 + Math.floor(Math.log10(Math.max(1, e.amount / 50)) * 1.6));
      const farbe = CHIP_FARBE[e.type] || "#e2b656";
      return `<span class="welt-chipstapel" style="left:${(ort[0] - 4.5).toFixed(1)}px;top:${(ort[1] - 10).toFixed(1)}px">${Array.from({ length: hoehe }, (_, k) => `<i style="bottom:${(k * 1.8).toFixed(1)}px;background:${farbe}"></i>`).join("")}</span>`;
    }).join("");
  }

  tischEl.addEventListener("click", (e) => {
    if (!tisch) return;
    const chip = e.target.closest("[data-chip]");
    if (chip) { tisch.chip = Number(chip.dataset.chip); zeichneTisch(); return; }
    const w = e.target.closest("[data-wette]");
    if (w && !tisch.dreht) {
      const type = w.dataset.wette;
      const value = w.dataset.wert === "" ? undefined : Number(w.dataset.wert);
      if (summe() + tisch.chip > tisch.regeln.max) { tisch.info = `Mehr als ${deZahl(tisch.regeln.max)} Chips gehen an diesem Tisch nicht.`; zeichneTisch(); return; }
      const da = tisch.einsaetze.find((x) => x.type === type && x.value === value);
      if (da) da.amount += tisch.chip; else tisch.einsaetze.push({ type, value, amount: tisch.chip });
      tisch.info = "";
      Casino.sound && Casino.sound.play && Casino.sound.play("chip");
      zeichneTisch();
      return;
    }
    const lz = e.target.closest("[data-lotto-zahl]");
    if (lz && tisch.art === "lotto") {
      const n = Number(lz.dataset.lottoZahl);
      const max = (tisch.st && tisch.st.tipps) || 4;
      if (tisch.wahl.includes(n)) tisch.wahl = tisch.wahl.filter((x) => x !== n);
      else if (tisch.wahl.length < max) tisch.wahl.push(n);
      tisch.info = "";
      zeichneTisch();
      return;
    }
    const rw = e.target.closest("[data-renn]");
    if (rw && tisch.art === "rennen") {
      tisch.wahl = { lane: Number(rw.dataset.bahn), type: rw.dataset.renn };
      tisch.info = "";
      zeichneTisch();
      return;
    }
    const a = e.target.closest("[data-tisch]");
    if (!a) return;
    const was = a.dataset.tisch;
    if (was === "zu") tischZu();
    else if (was === "zahlen") { tisch.zahlen = !tisch.zahlen; zeichneTisch(); }
    else if (was === "loeschen") { tisch.einsaetze = []; tisch.info = ""; zeichneTisch(); }
    else if (was === "nochmal" && tisch.letzte) { tisch.einsaetze = tisch.letzte.map((x) => ({ ...x })); zeichneTisch(); }
    else if (was === "gross") { const d = tisch.d; tisch.dreht = false; tischZu(); oeffne(d, { screen: "roulette" }); }
    else if (was === "drehen") drehen();
    else if (was === "rad-drehen") radDreh();
    else if (was === "renn-wetten") rennWetten();
    else if (was === "lotto-kaufen") lottoKaufen();
    else if (was === "greifen") greifen();
    else if (was === "lotto-zufall") {
      socket.emit("lotterie:zufall", (r) => {
        if (!r || !r.ok || !tisch || tisch.art !== "lotto") return;
        tisch.wahl = r.tipp.slice(); tisch.info = "";
        zeichneTisch();
      });
    }
    else if (was === "lotto-gross") { const d = tisch.d; tischZu(); oeffne(d, { screen: "lotterie" }); }
    else if (was === "renn-gross") { const d = tisch.d; tischZu(); oeffne(d, { screen: "horses" }); }
    else if (was === "rad-gross") { const d = tisch.d; tischZu(); oeffne(d, { screen: "wheel" }); }
  });

  /* Glücksrad in der Welt.
     Gezogen wird wie immer auf dem Server (wheel:spin), die Welt dreht nur
     das Rad auf das Feld, das zurückkommt. Den Satz auf der Tafel formuliert
     der Server; hier steht keine zweite Beschreibung der Felder. */
  const RAD_MS = 4200;
  const RAD_STUFEN = new Set(["klein", "mittel", "gross", "sonder", "fortuna"]);
  let radDrehung = 0, radElement = null, radSegmente = [];

  function radFelderFaerben(segmente) {
    if (!Array.isArray(segmente)) return;
    radSegmente = segmente;
    const b = dingEls.get("gluecksrad");
    if (!b) return;
    b.querySelectorAll("[data-feld]").forEach((p) => {
      const s = segmente[Number(p.dataset.feld)];
      p.setAttribute("class", "m-radfeld rs-" + (s && RAD_STUFEN.has(s.stufe) ? s.stufe : "klein"));
    });
    // Die Felder tragen ihren Gewinn, wie auf einem echten Rad.
    b.querySelectorAll("[data-feld-text]").forEach((t) => {
      const s = segmente[Number(t.dataset.feldText)];
      t.textContent = s ? String(s.label).replace("Gratis-Los", "Los") : "";
    });
  }

  /* Die Zunge klappert an jeder Feldgrenze. Gemessen wird am echten Winkel
     des Rads, nicht an einer nachgerechneten Kurve: dann passt der Tick
     auch, wenn sich die Animation einmal ändert. */
  function radKlappern(g) {
    clearInterval(g._klapper);
    if (reduziert()) return;
    const weite = 360 / (radSegmente.length || 12);
    const winkel = () => {
      const m = getComputedStyle(g).transform;
      const w = /matrix\(([^,]+),\s*([^,]+)/.exec(m || "");
      return w ? (Math.atan2(Number(w[2]), Number(w[1])) * 180 / Math.PI + 360) % 360 : 0;
    };
    let vorher = winkel(), seit = performance.now();
    g._klapper = setInterval(() => {
      const jetzt = winkel();
      let delta = (jetzt - vorher + 360) % 360;
      if (delta > 180) delta -= 360;
      if (Math.floor(jetzt / weite) !== Math.floor(vorher / weite) && Math.abs(delta) > 0.01) klang("rad_tick", dingFigur("gluecksrad"));
      vorher = jetzt;
      if (performance.now() - seit > RAD_MS + 200) clearInterval(g._klapper);
    }, 25);
  }
  /* Ein Ding als Klangquelle: dieselbe Rechnung wie für eine Figur. */
  function dingFigur(id) {
    const d = raum && raum.dinge.find((x) => x.id === id);
    return d ? { x: d.x, y: d.y } : null;
  }

  function radDrehen(index) {
    const b = dingEls.get("gluecksrad");
    const g = b && b.querySelector(".m-rad-drehung");
    if (!g) return;
    // Neuer Raum, neues Element: die Drehung fängt dort wieder bei null an.
    if (radElement !== g) { radElement = g; radDrehung = 0; }
    const weite = 360 / (radSegmente.length || 12);
    radDrehung = radDrehung - (radDrehung % 360) + 360 * 5 + (360 - (index * weite + weite / 2));
    g.style.transition = reduziert() ? "none" : `transform ${RAD_MS}ms cubic-bezier(.15, .6, .2, 1)`;
    g.style.transform = `rotate(${radDrehung}deg)`;
    /* Während es läuft, rennen die Lichter und die Zunge klappert; danach
       leuchtet das getroffene Feld ein paar Mal auf. */
    b.querySelectorAll(".m-radfeld.treffer").forEach((x) => x.classList.remove("treffer"));
    b.classList.add("dreht");
    radKlappern(g);
    clearTimeout(b._radUhr);
    b._radUhr = setTimeout(() => {
      b.classList.remove("dreht");
      const feld = b.querySelector(`.m-radfeld[data-feld="${index}"]`);
      if (feld) { feld.classList.add("treffer"); setTimeout(() => feld.classList.remove("treffer"), 3200); }
    }, reduziert() ? 150 : RAD_MS);
  }

  /* Am Rad selbst drehen: ist die Tafel offen und der Dreh frei, reicht ein
     Wisch oder ein Tipp aufs Rad. Fühlt sich mehr nach Glücksrad an als ein
     Knopf in einer Tafel. */
  function radWischbar() {
    const rb = dingEls.get("gluecksrad");
    if (rb) rb.classList.toggle("wischbar", !!(tisch && tisch.art === "rad" && tisch.zustand && tisch.zustand.canSpin && !tisch.dreht));
  }
  let radGriff = null;
  raumEl.addEventListener("pointerdown", (e) => {
    const rb = e.target.closest && e.target.closest(".welt-ding.m-rad.wischbar");
    if (!rb) return;
    e.stopPropagation(); e.preventDefault();
    radGriff = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener("pointerup", (e) => {
    if (!radGriff) return;
    const weit = Math.hypot(e.clientX - radGriff.x, e.clientY - radGriff.y);
    radGriff = null;
    // Ein Wisch oder ein Tipp: beides dreht. Nur ein langes Ziehen ins Leere nicht.
    if (weit < 400) radDreh();
  }, true);

  function radAuf(d) {
    tisch = { art: "rad", d, einsaetze: [], dreht: false, info: "", zustand: null, ergebnis: null, treffer: -1 };
    ziel = null; tasten.clear();
    fahreZu({ ...(d.fokus || { x: d.x, y: d.y - 1 }), zoom: 1.9, oben: 0.3 });
    tischEl.classList.remove("hidden");
    zeichneTisch();
    radStandLaden();
  }

  function radStandLaden() {
    socket.emit("wheel:state", (res) => {
      if (!tisch || tisch.art !== "rad") return;
      if (res && res.ok) { tisch.zustand = res; radFelderFaerben(res.segments); }
      else tisch.info = (res && res.error) || "Das Rad antwortet gerade nicht.";
      zeichneTisch();
    });
  }

  function wartezeit(ms) {
    const min = Math.max(1, Math.ceil(ms / 60000));
    const std = Math.floor(min / 60);
    return std ? `${std} Std ${min % 60} Min` : `${min} Min`;
  }

  function zeichneRadTafel() {
    const z = tisch.zustand;
    const frei = !!(z && z.canSpin);
    const stand = !z ? "Einen Moment …"
      : tisch.dreht ? "Das Rad läuft …"
        : frei ? "Einmal am Tag, gratis. Wisch am Rad oder tipp auf Drehen."
          : `Heute schon gedreht. Wieder frei in ${wartezeit(z.msLeft)}.`;
    const felder = z ? z.segments : [];
    tischEl.innerHTML = `
      <header><div><b>Glücksrad</b><small>${esc(stand)}</small></div>
        <button type="button" class="welt-tisch-zu" data-tisch="zu" aria-label="Vom Rad weggehen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>
      ${tisch.ergebnis ? `<div class="welt-rad-ergebnis" aria-live="polite"><b>${esc(tisch.ergebnis.titel || "")}</b>${tisch.ergebnis.text ? `<small>${esc(tisch.ergebnis.text)}</small>` : ""}</div>` : ""}
      ${felder.length ? `<div class="welt-rad-felder" aria-label="Felder auf dem Rad">${felder.map((f, i) => `<span class="rs-${RAD_STUFEN.has(f.stufe) ? f.stufe : "klein"}${i === tisch.treffer ? " an" : ""}">${esc(f.label)}</span>`).join("")}</div>` : ""}
      <div class="welt-tisch-aktionen">
        <button type="button" class="welt-tisch-drehen" data-tisch="rad-drehen" ${!frei || tisch.dreht ? "disabled" : ""}>${tisch.dreht ? "Das Rad läuft …" : "Drehen"}</button>
        <button type="button" data-tisch="rad-gross" ${tisch.dreht ? "disabled" : ""}>Großes Rad</button>
      </div>
      ${tisch.info ? `<p class="welt-tisch-info" aria-live="polite">${esc(tisch.info)}</p>` : ""}`;
  }

  /* Rennbahn in der Welt: das Starterfeld mit Quoten, gesetzt wird über
     dasselbe horses:bet wie im großen Rennen. Grenzen, Quoten und Abbuchung
     kommen vom Server; die Tafel merkt sich nur, was man angetippt hat.
     Erst „Wetten“ bucht, ein Tipp auf eine Quote kostet noch nichts. */
  const PFERD_CHIPS = [100, 500, 1000, 5000, 10000, 25000];
  const seideVon = (f) => SEIDE[(Number.isInteger(f.silk) ? f.silk : f.lane) % SEIDE.length];
  const quote = (q) => Number(q).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function rennAuf(d) {
    tisch = { art: "rennen", d, einsaetze: [], chip: 500, wahl: null, info: "", st: null, sendet: false };
    ziel = null; tasten.clear();
    fahreZu({ ...(d.fokus || { x: d.x, y: d.y - 1 }), zoom: 1.8, oben: 0.26 });
    tischEl.classList.remove("hidden");
    zeichneTisch();
    socket.emit("horses:state", (s) => {
      if (!tisch || tisch.art !== "rennen") return;
      if (s && s.ok) {
        tisch.st = s;
        const cfg = s.config || {};
        const moeglich = PFERD_CHIPS.filter((c) => c >= (cfg.minBet || 0) && c <= (cfg.maxBet || Infinity));
        tisch.chip = moeglich.includes(500) ? 500 : moeglich[0] || cfg.minBet || 100;
        rennenAus(s);
      } else tisch.info = (s && s.error) || "Die Rennbahn antwortet gerade nicht.";
      zeichneTisch();
    });
  }

  function rennStand() {
    const s = tisch && tisch.st;
    if (!s) return "Einen Moment …";
    if (s.phase === "betting") {
      const rest = Math.max(0, Math.ceil((((rennen && rennen.bis) || Date.now()) - Date.now()) / 1000));
      return `Rennen ${s.no || ""} · ${s.distance ? s.distance + " m · " : ""}Start in ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}`;
    }
    return s.phase === "running" ? "Das Rennen läuft. Schau auf die Tafel." : "Im Ziel. Das nächste Rennen kommt gleich.";
  }

  function zeichneRennTafel() {
    const s = tisch.st;
    const cfg = (s && s.config) || {};
    const wetten = !!(s && s.phase === "betting");
    const meine = (s && s.myBets) || [];
    const platz = {};
    for (const r of (s && s.result) || []) platz[r.lane] = r.pos;
    // Im Ziel steht der Sieger oben, vorher gilt die Reihenfolge der Bahnen.
    const feld = s && Array.isArray(s.field) ? [...s.field].sort((x, y) => (platz[x.lane] || 99) - (platz[y.lane] || 99) || x.lane - y.lane) : [];
    const zeilen = feld.length ? feld.map((f) => {
      const tags = meine.filter((b) => b.lane === f.lane).map((b) => `<em>${b.type === "win" ? "Sieg" : "Platz"} ${deZahl(b.amount)}</em>`).join("");
      const gewaehlt = (typ) => tisch.wahl && tisch.wahl.lane === f.lane && tisch.wahl.type === typ ? " an" : "";
      return `<div class="welt-renn-zeile">
        <i style="background:${seideVon(f)}"></i>
        <span><b>${platz[f.lane] ? platz[f.lane] + ". " : ""}${esc(f.horse && f.horse.name)}</b>${tags ? `<small>${tags}</small>` : ""}</span>
        ${f.odds ? `<button type="button" class="${gewaehlt("win")}" data-renn="win" data-bahn="${f.lane}" ${wetten ? "" : "disabled"}>Sieg <b>${quote(f.odds.win)}</b></button>
        <button type="button" class="${gewaehlt("place")}" data-renn="place" data-bahn="${f.lane}" ${wetten ? "" : "disabled"}>Platz <b>${quote(f.odds.place)}</b></button>` : ""}
      </div>`;
    }).join("") : "";
    const chips = wetten ? PFERD_CHIPS.filter((c) => c >= (cfg.minBet || 0) && c <= (cfg.maxBet || Infinity)) : [];
    const acc = Casino.getAccount() || {};
    let info = tisch.info;
    if (!info && s) {
      if (wetten && tisch.wahl) {
        const f = s.field.find((x) => x.lane === tisch.wahl.lane);
        const q = f && f.odds ? (tisch.wahl.type === "win" ? f.odds.win : f.odds.place) : 0;
        info = `${tisch.wahl.type === "win" ? "Sieg" : "Platz"} auf ${f ? f.horse.name : "?"}: ${deZahl(tisch.chip)} Chips zur Quote ${quote(q)}. Trifft es, gibt es ${deZahl(Math.round(tisch.chip * q))} zurück.`;
      } else if (wetten) info = "Chip wählen, eine Quote antippen, wetten. Sieg heißt Erster, Platz heißt unter den Ersten.";
      else if (s.phase === "done" && s.result) {
        const name = (acc.name || "").toLowerCase();
        const mir = (s.bets || []).filter((b) => (b.name || "").toLowerCase() === name);
        const zurueck = mir.filter((b) => b.won).reduce((a, b) => a + Math.round(b.amount * b.odds), 0);
        info = mir.length ? (zurueck ? `Getroffen: ${deZahl(zurueck)} Chips zurück.` : "Diesmal nichts getroffen.") : "Du hattest in diesem Rennen nichts gesetzt.";
      }
    }
    tischEl.innerHTML = `
      <header><div><b>Rennbahn</b><small class="welt-renn-stand">${esc(rennStand())}</small></div>
        <button type="button" class="welt-tisch-zu" data-tisch="zu" aria-label="Von der Rennbahn weggehen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>
      ${chips.length ? `<div class="welt-tisch-chips" role="radiogroup" aria-label="Einsatz">${chips.map((c) => `<button type="button" role="radio" aria-checked="${c === tisch.chip}" class="${c === tisch.chip ? "an" : ""}" data-chip="${c}">${c >= 1000 ? c / 1000 + "k" : c}</button>`).join("")}</div>` : ""}
      <div class="welt-renn-feld">${zeilen}</div>
      <div class="welt-tisch-aktionen">
        <button type="button" class="welt-tisch-drehen" data-tisch="renn-wetten" ${!wetten || !tisch.wahl || tisch.sendet ? "disabled" : ""}>${tisch.sendet ? "Wird gesetzt …" : "Wetten"}</button>
        <button type="button" data-tisch="renn-gross">Große Rennbahn</button>
      </div>
      <p class="welt-tisch-info" aria-live="polite">${esc(info || "")}${acc.chips != null ? ` <small>Guthaben ${deZahl(acc.chips)}</small>` : ""}</p>`;
  }

  function rennWetten() {
    if (!tisch || tisch.art !== "rennen" || !tisch.wahl || tisch.sendet) return;
    const { lane, type } = tisch.wahl;
    const amount = tisch.chip;
    tisch.sendet = true; tisch.info = "";
    zeichneTisch();
    socket.emit("horses:bet", { lane, type, amount }, (r) => {
      if (!tisch || tisch.art !== "rennen") { if (r && r.ok && r.account) Casino.applyAccount(r.account); return; }
      tisch.sendet = false;
      if (!r || !r.ok) { tisch.info = (r && r.error) || "Die Wette ging nicht durch."; zeichneTisch(); return; }
      if (r.account) Casino.applyAccount(r.account);
      Casino.sound && Casino.sound.play && Casino.sound.play("chip");
      if (tisch.st) tisch.st.myBets = [...(tisch.st.myBets || []), r.bet];
      const f = tisch.st && tisch.st.field.find((x) => x.lane === lane);
      tisch.info = `Gesetzt: ${type === "win" ? "Sieg" : "Platz"} auf ${f ? f.horse.name : "?"}, ${deZahl(amount)} Chips zur Quote ${quote(r.bet.odds)}.`;
      tisch.wahl = null;
      zeichneTisch();
    });
  }

  /* Lotteriebude in der Welt. Gekauft wird über dasselbe lotterie:kaufen wie
     am großen Schalter; Preis, Zahlenraum, Grenze und Gewinne kommen vom
     Server (lotterie:state), die Tafel merkt sich nur die angekreuzten Zahlen. */
  let lotto = null;
  const lottoUhr = (ts) => {
    if (!ts) return "";
    const d = new Date(ts), heute = new Date();
    const zeit = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === heute.toDateString() ? `heute um ${zeit}` : `morgen um ${zeit}`;
  };

  function lottoZeichnen() {
    const kugeln = raumEl.querySelector('[data-anzeige="lotto"]');
    const topf = raumEl.querySelector('[data-anzeige="lotto-jackpot"]');
    if (!lotto) return;
    const gezogen = (lotto.letzte && Array.isArray(lotto.letzte.gezogen)) ? lotto.letzte.gezogen : [];
    const FARBE = ["#e5534b", "#f2c94c", "#4fb76a", "#4a8fe0"];
    if (kugeln) kugeln.innerHTML = gezogen.length
      ? gezogen.slice(0, 4).map((n, i) => `<i style="background:${FARBE[i % 4]}">${esc(String(n))}</i>`).join("")
      : `<small>Noch keine Ziehung</small>`;
    if (topf) topf.textContent = `Jackpot ${deZahl(lotto.jackpot || 0)}`;
  }
  socket.on("lotterie:update", (st) => {
    if (!st || !raum) return;
    lotto = { ...(lotto || {}), ...st, meineLose: (lotto && lotto.meineLose) || [] };
    lottoZeichnen();
    if (tisch && tisch.art === "lotto") { tisch.st = lotto; zeichneTisch(); }
  });

  function lottoAuf(d) {
    tisch = { art: "lotto", d, einsaetze: [], wahl: [], info: "", st: lotto, sendet: false };
    ziel = null; tasten.clear();
    fahreZu({ ...(d.fokus || { x: d.x, y: d.y - 1 }), zoom: 1.9, oben: 0.26 });
    tischEl.classList.remove("hidden");
    zeichneTisch();
    socket.emit("lotterie:state", (s) => {
      if (!s || !s.ok) { if (tisch && tisch.art === "lotto") { tisch.info = "Die Lotterie antwortet gerade nicht."; zeichneTisch(); } return; }
      lotto = s; lottoZeichnen();
      if (tisch && tisch.art === "lotto") { tisch.st = s; zeichneTisch(); }
    });
  }

  function zeichneLottoTafel() {
    const s = tisch.st;
    const tipps = (s && s.tipps) || 4, bis = (s && s.zahlenBis) || 16;
    const meine = (s && s.meineLose) || [];
    const voll = s && meine.length >= s.maxLose;
    const gewaehlt = new Set(tisch.wahl);
    const fertig = tisch.wahl.length === tipps;
    const stand = !s ? "Einen Moment …" : `Ziehung ${s.nr || ""} ${lottoUhr(s.naechste)} · Jackpot ${deZahl(s.jackpot || 0)}`;
    const acc = Casino.getAccount() || {};
    tischEl.innerHTML = `
      <header><div><b>Lotterie</b><small>${esc(stand)}</small></div>
        <button type="button" class="welt-tisch-zu" data-tisch="zu" aria-label="Von der Bude weggehen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>
      <div class="welt-lotto-zahlen" role="group" aria-label="Zahlen ankreuzen">${Array.from({ length: bis }, (_, i) => i + 1).map((n) =>
        `<button type="button" data-lotto-zahl="${n}" aria-pressed="${gewaehlt.has(n)}" ${!gewaehlt.has(n) && fertig ? "disabled" : ""}>${n}</button>`).join("")}</div>
      <div class="welt-tisch-aktionen">
        <button type="button" class="welt-tisch-drehen" data-tisch="lotto-kaufen" ${!s || !fertig || voll || tisch.sendet ? "disabled" : ""}>${tisch.sendet ? "Wird gekauft …" : `Los kaufen · ${deZahl((s && s.lospreis) || 0)}`}</button>
        <button type="button" data-tisch="lotto-zufall" ${!s || voll ? "disabled" : ""}>Zufall</button>
        <button type="button" data-tisch="lotto-gross">Großer Schalter</button>
      </div>
      ${meine.length ? `<div class="welt-lotto-lose"><small>Deine Lose (${meine.length} von ${s.maxLose})</small>${meine.map((t) => `<span>${t.map((n) => esc(String(n))).join(" · ")}</span>`).join("")}</div>` : ""}
      <p class="welt-tisch-info" aria-live="polite">${esc(tisch.info || (s ? (voll
        ? `Mehr als ${s.maxLose} Lose gibt es für diese Ziehung nicht.`
        : `${tipps} Zahlen ankreuzen. 4 Richtige: Jackpot · 3 Richtige: ${deZahl(s.gewinn3)} · 2 Richtige: ${deZahl(s.gewinn2)}`) : ""))}${acc.chips != null ? ` <small>Guthaben ${deZahl(acc.chips)}</small>` : ""}</p>`;
  }

  function lottoKaufen() {
    if (!tisch || tisch.art !== "lotto" || tisch.sendet) return;
    const zahlen = tisch.wahl.slice().sort((a, b) => a - b);
    tisch.sendet = true; tisch.info = "";
    zeichneTisch();
    socket.emit("lotterie:kaufen", { zahlen }, (r) => {
      if (r && r.ok && r.account) Casino.applyAccount(r.account);
      if (r && r.ok) { lotto = r; lottoZeichnen(); }
      if (!tisch || tisch.art !== "lotto") return;
      tisch.sendet = false;
      if (!r || !r.ok) { tisch.info = (r && r.error) || "Das Los ging nicht durch."; zeichneTisch(); return; }
      Casino.sound && Casino.sound.play && Casino.sound.play("chip");
      tisch.st = r; tisch.wahl = [];
      tisch.info = `Los gekauft: ${r.tipp.join(" · ")}. Gezogen wird ${lottoUhr(r.naechste)}.`;
      zeichneTisch();
    });
  }

  function radDreh() {
    if (!tisch || tisch.art !== "rad" || tisch.dreht) return;
    tisch.dreht = true; tisch.ergebnis = null; tisch.treffer = -1; tisch.info = "";
    zeichneTisch();
    socket.emit("wheel:spin", (r) => {
      if (!r || !r.ok) {
        if (tisch && tisch.art === "rad") {
          tisch.dreht = false;
          tisch.info = (r && r.error) || "Das ging gerade nicht.";
          if (r && r.msLeft && tisch.zustand) { tisch.zustand.canSpin = false; tisch.zustand.msLeft = r.msLeft; }
          zeichneTisch();
        }
        return;
      }
      radDrehen(r.index);
      setTimeout(() => {
        // Das Konto gilt auch, wenn die Tafel inzwischen zu ist.
        if (r.account && Casino.applyAccount) Casino.applyAccount(r.account);
        Casino.renderAbholBadge && Casino.renderAbholBadge();
        markenLaden();
        if (r.art === "fortuna") Casino.dialog.hinweis(`${r.titel || ""}\n\n${r.text || ""}`.trim(), { titel: "FORTUNA!" });
        else if (r.chips >= 25000 && Casino.fx && Casino.fx.bigWin) Casino.fx.bigWin(r.chips, { label: "Am Glücksrad" });
        else if (Casino.sound && Casino.sound.play) Casino.sound.play("win");
        if (!tisch || tisch.art !== "rad") return;
        tisch.dreht = false;
        tisch.treffer = r.index;
        tisch.ergebnis = { titel: r.titel, text: r.text };
        zeichneTisch();
        radStandLaden();
      }, reduziert() ? 200 : RAD_MS);
    });
  }

  function drehen() {
    if (!tisch || tisch.dreht || !tisch.einsaetze.length) return;
    const wetten = tisch.einsaetze.map((x) => ({ ...x }));
    // Dieselbe Tafel, nicht irgendeine: inzwischen kann das Glücksrad offen sein.
    const meinTisch = tisch;
    tisch.dreht = true;
    tisch.info = "";
    zeichneTisch();
    socket.emit("roulette:spin", { bets: wetten }, (res) => {
      // Der Kontostand zieht immer nach, auch wenn der Tisch schon zu ist.
      if (res && res.ok && Casino.setChips) Casino.setChips(res.balance);
      if (tisch !== meinTisch) return;
      if (!res || !res.ok) {
        tisch.dreht = false;
        tisch.info = (res && res.error) || "Das ging gerade nicht.";
        zeichneTisch();
        return;
      }
      tisch.letzte = wetten;
      letzteWetten = wetten;
      // Das Ergebnis erst, wenn das Rad in der Welt steht.
      setTimeout(() => {
        if (tisch !== meinTisch) return;
        tisch.dreht = false;
        tisch.einsaetze = [];
        const farbe = res.color === "red" ? "Rot" : res.color === "black" ? "Schwarz" : "Grün";
        tisch.info = res.netWin > 0
          ? `${res.number} ${farbe}. Gewonnen: ${deZahl(res.totalReturn)} Chips zurück, ${deZahl(res.netWin)} mehr als gesetzt.`
          : res.totalReturn > 0
            ? `${res.number} ${farbe}. ${deZahl(res.totalReturn)} Chips zurück.`
            : `${res.number} ${farbe}. Diesmal nichts.`;
        if (res.netWin > 0) Casino.sound && Casino.sound.play && Casino.sound.play("win");
        zeichneTisch();
      }, reduziert() ? 200 : 3200);
    });
  }

  /* Ein Ergebnis am Tisch, für alle im Raum. */
  /* Der Greifautomat (game/greifer.js). Die Tafel zeigt den Automaten groß:
     Greifer mit den Pfeilen oder durch Tippen ins Glas über einen Ball
     fahren, greifen, zusehen. Was passiert, sagt der Server; hier läuft nur
     die Szene ab. Die Bälle stehen in raeume.js (GREIFER), dieselben, mit
     denen der Server rechnet. */
  const GR = R.GREIFER;
  const BALL_FARBE = ["#ff6b9a", "#ffd34d", "#2ad4ff", "#9b6bff", "#3dffa0", "#ff8a3d", "#f4f1ea"];
  let greiferPreis = 50;
  function greiferAuf(d) {
    tisch = { art: "greifer", d, x: GR.start, info: "", dreht: false };
    ziel = null; tasten.clear();
    fahreZu({ ...(d.fokus || { x: d.x, y: d.y - 1 }), zoom: 1.9, oben: 0.2 });
    tischEl.classList.remove("hidden");
    zeichneTisch();
    socket.emit("greifer:state", (r) => { if (r && r.ok) { greiferPreis = r.preis; if (tisch && tisch.art === "greifer") greiferKnopf(); } });
  }
  function greiferBild() {
    const baelle = GR.baelle.map((b, i) => {
      const c = BALL_FARBE[i % BALL_FARBE.length];
      return `<g class="gr-ball" data-i="${i}" style="transform:translate(${b.x}px,${b.y}px)"><circle r="9" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width="1"/><circle cx="-3" cy="-3.6" r="2.6" fill="#fff" opacity=".45"/><circle cx="-3" cy="-1" r="1.1" fill="#1d1d23"/><circle cx="3" cy="-1" r="1.1" fill="#1d1d23"/><path d="M-2.6 2.4q2.6 2.4 5.2 0" fill="none" stroke="#1d1d23" stroke-width="1" stroke-linecap="round"/></g>`;
    }).join("");
    return `<svg viewBox="0 0 240 200" role="img" aria-label="Greifautomat von innen">
      <defs><clipPath id="gr-glas"><rect x="12" y="14" width="216" height="178" rx="4"/></clipPath></defs>
      <rect x="4" y="4" width="232" height="192" rx="10" fill="#140d26" stroke="#ff4fd8" stroke-width="2"/>
      <rect x="12" y="14" width="216" height="178" rx="4" fill="#2ad4ff" fill-opacity=".07"/>
      <g class="gr-grund">${Array.from({ length: 12 }, (_, i) => `<path d="M${20 + i * 18} 14V192" stroke="#2ad4ff" stroke-opacity=".05"/>`).join("")}</g>
      <rect x="14" y="112" width="44" height="80" fill="#0c0818" stroke="#2ad4ff" stroke-opacity=".6"/>
      <path d="M14 112h44" stroke="#ffd34d" stroke-width="2"/>
      <text x="36" y="160" text-anchor="middle" font-size="7" font-weight="900" fill="#ffd34d" opacity=".75" font-family="ui-rounded, system-ui">AUSGABE</text>
      <rect x="58" y="179" width="168" height="13" fill="#24163f"/>
      <g clip-path="url(#gr-glas)">${baelle}
        <g class="gr-klaue" style="transform:translate(${tisch.x}px,${GR.oben}px)">
          <path d="M0 -6V-220" stroke="#c0c6cc" stroke-width="1.4"/>
          <rect x="-8" y="-8" width="16" height="7" rx="2" fill="#8a929c" stroke="#3a3f47" stroke-width=".8"/>
          <g class="gr-finger l"><path d="M-3 -1L-11 9L-7 17" fill="none" stroke="#d6dbe0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
          <g class="gr-finger m"><path d="M0 -1V15" fill="none" stroke="#b8bec4" stroke-width="2.2" stroke-linecap="round"/></g>
          <g class="gr-finger r"><path d="M3 -1L11 9L7 17" fill="none" stroke="#d6dbe0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
          <circle r="3.4" cy="-4" fill="#ff4fd8"/>
        </g>
      </g>
      <rect x="14" y="20" width="212" height="5" rx="2" fill="#3a3f47"/>
      <text x="120" y="12" text-anchor="middle" font-size="8" font-weight="900" fill="#ffe1f7" font-family="ui-rounded, system-ui" class="m-neon-text">GREIFER</text>
    </svg>`;
  }
  const PFEIL = (r) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${r ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function zeichneGreiferTafel() {
    const acc = Casino.getAccount() || {};
    tischEl.innerHTML = `
      <header><div><b>Greifautomat</b><small>Guthaben ${deZahl(acc.chips || 0)}</small></div>
        <button type="button" class="welt-tisch-zu" data-tisch="zu" aria-label="Vom Automaten weggehen">${Casino.icons ? Casino.icons.ui("schliessen") : "×"}</button></header>
      <div class="welt-greifer">${greiferBild()}</div>
      <div class="welt-greifer-steuer">
        <button type="button" data-greifer="-1" aria-label="Greifer nach links">${PFEIL(false)}</button>
        <button type="button" class="welt-tisch-drehen" data-tisch="greifen"></button>
        <button type="button" data-greifer="1" aria-label="Greifer nach rechts">${PFEIL(true)}</button>
      </div>
      <p class="welt-tisch-info" aria-live="polite"></p>`;
    greiferKnopf();
  }
  function greiferKnopf() {
    if (!tisch || tisch.art !== "greifer") return;
    const k = tischEl.querySelector('[data-tisch="greifen"]');
    if (k) { k.disabled = tisch.dreht; k.textContent = tisch.dreht ? "Der Greifer fährt …" : `Greifen · ${deZahl(greiferPreis)}`; }
    tischEl.querySelectorAll("[data-greifer]").forEach((b) => { b.disabled = tisch.dreht; });
    const info = tischEl.querySelector(".welt-tisch-info");
    if (info) info.textContent = tisch.info || "Fahr den Greifer über einen Ball und greif zu. Fast immer rutscht er wieder raus, aber ganz selten hält der Griff.";
  }
  const grSetzen = (el, x, y, ms, kurve = "ease-in-out") => {
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${kurve}` : "none";
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  function greiferFahren(richtung) {
    if (!tisch || tisch.art !== "greifer" || tisch.dreht) return;
    tisch.x = Math.max(GR.links, Math.min(GR.rechts, tisch.x + richtung * 3));
    grSetzen(tischEl.querySelector(".gr-klaue"), tisch.x, GR.oben, 60, "linear");
  }
  let greiferHalten = null;
  tischEl.addEventListener("pointerdown", (e) => {
    if (!tisch || tisch.art !== "greifer" || tisch.dreht) return;
    const b = e.target.closest("[data-greifer]");
    if (b) {
      const r = Number(b.dataset.greifer);
      greiferFahren(r);
      clearInterval(greiferHalten);
      greiferHalten = setInterval(() => greiferFahren(r), 30);
      if (Casino.sound) Casino.sound.play("greifer_fahrt");
      return;
    }
    // Ins Glas tippen: dorthin fahren.
    const svg = e.target.closest(".welt-greifer svg");
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 240;
    tisch.x = Math.max(GR.links, Math.min(GR.rechts, x));
    grSetzen(tischEl.querySelector(".gr-klaue"), tisch.x, GR.oben, 350, "ease-out");
    if (Casino.sound) Casino.sound.play("greifer_fahrt");
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) tischEl.addEventListener(ev, () => { clearInterval(greiferHalten); greiferHalten = null; });

  function greifen() {
    if (!tisch || tisch.art !== "greifer" || tisch.dreht) return;
    tisch.dreht = true; tisch.info = "";
    greiferKnopf();
    socket.emit("greifer:greifen", { x: tisch.x }, (r) => {
      if (!tisch || tisch.art !== "greifer") return;
      if (!r || !r.ok) { tisch.dreht = false; tisch.info = (r && r.error) || "Der Automat klemmt."; greiferKnopf(); return; }
      if (r.account) Casino.applyAccount(r.account);
      greiferSzene(r, () => {
        if (!tisch || tisch.art !== "greifer") return;
        tisch.dreht = false;
        tisch.info = r.gewonnen ? (r.neu ? "Der Griff hat gehalten!" : `Gehalten! Das Huhn hast du schon, dafür ${deZahl(r.trost)} Chips.`)
          : r.treffer == null ? "Daneben. Da lag nichts." : ["Rausgerutscht.", "Fast!", "So knapp.", "Der Griff war zu schwach.", "Natürlich."][Math.floor(Math.random() * 5)];
        greiferKnopf();
        const head = tischEl.querySelector("header small"), acc = Casino.getAccount() || {};
        if (head) head.textContent = `Guthaben ${deZahl(acc.chips || 0)}`;
        if (r.gewonnen && r.neu) {
          Casino.sound && Casino.sound.play("jackpot");
          setTimeout(() => Casino.sound && Casino.sound.play("gummihuhn"), 500);
          Casino.dialog.hinweis("Der Griff hält, der Ball fällt in den Schacht, und darin liegt: das Königliche Gummihuhn. Es gibt kaum eins davon im Haus.\n\nNimm es in der Garderobe in die Hand. Unter Gesten kannst du es dann quietschen lassen, und zwar so, dass es der ganze Raum hört.", { titel: "Gefangen!" });
        } else if (r.gewonnen) Casino.sound && Casino.sound.play("cash");
      });
    });
  }

  /* Die Szene im großen Automaten. Der Ball hängt am Greifer, bis er
     rutscht: dann wird seine Lage in diesem Moment abgelesen und er fällt
     von dort zurück auf seinen Platz. */
  function greiferSzene(sz, fertig) {
    const svg = tischEl.querySelector(".welt-greifer svg");
    if (!svg) return fertig();
    const klaue = svg.querySelector(".gr-klaue");
    const ball = sz.treffer != null ? svg.querySelector(`.gr-ball[data-i="${sz.treffer}"]`) : null;
    const b = ball ? GR.baelle[sz.treffer] : null;
    const tiefe = b ? b.y - 15 : 168;
    const oben = GR.oben, haken = 15;
    const uhr = [];
    const spaeter = (ms, f) => uhr.push(setTimeout(f, ms));
    let haengt = !!ball;
    const rutschen = () => {
      if (!haengt || !ball) return;
      haengt = false;
      const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(ball).transform || "");
      const w = m ? m[1].split(",").map(Number) : [1, 0, 0, 1, b.x, b.y];
      grSetzen(ball, w[4], w[5], 0);
      void ball.getBoundingClientRect();
      klaue.classList.add("wackelt");
      setTimeout(() => klaue.classList.remove("wackelt"), 500);
      klang("greifer_rutscht");
      grSetzen(ball, b.x, b.y, 700, "cubic-bezier(.45, 0, .75, .4)");
      setTimeout(() => {
        ball.animate([{ transform: `translate(${b.x}px, ${b.y}px)` }, { transform: `translate(${b.x}px, ${b.y - 6}px)` }, { transform: `translate(${b.x}px, ${b.y}px)` }], { duration: 260, easing: "ease-out" });
        klang("plumps");
      }, 700);
    };
    klang("greifer_runter");
    grSetzen(klaue, sz.x, tiefe, 950);
    spaeter(1000, () => { klaue.classList.add("zu"); klang("greifer_zu"); });
    spaeter(1400, () => {
      grSetzen(klaue, sz.x, oben, 900);
      if (haengt) grSetzen(ball, sz.x, oben + haken, 900);
      klang("greifer_fahrt");
    });
    if (sz.rutscht != null && sz.rutscht < 0.5) spaeter(1400 + (sz.rutscht / 0.5) * 900, rutschen);
    spaeter(2350, () => {
      grSetzen(klaue, GR.start, oben, 1300);
      if (haengt) grSetzen(ball, GR.start, oben + haken, 1300);
      klang("greifer_fahrt");
    });
    if (sz.rutscht != null && sz.rutscht >= 0.5) spaeter(2350 + ((sz.rutscht - 0.5) / 0.5) * 1300, rutschen);
    spaeter(3700, () => {
      klaue.classList.remove("zu");
      if (haengt && ball) {
        // Gewonnen: der Ball fällt in den Schacht und taucht später wieder auf seinem Platz auf.
        grSetzen(ball, GR.start, 186, 450, "cubic-bezier(.5, 0, 1, .6)");
        setTimeout(() => {
          ball.style.opacity = "0";
          svg.classList.add("gewonnen");
          setTimeout(() => { svg.classList.remove("gewonnen"); grSetzen(ball, b.x, b.y, 0); ball.style.opacity = ""; }, 2400);
        }, 460);
      }
    });
    spaeter(4300, () => fertig());
  }

  /* Der kleine Automat im Raum zeigt, was jemand gerade greift: alle sehen
     den Greifer fahren, nur das Ende sieht man nicht so genau. */
  function kleinerGreifer(b, sz) {
    const g = b.querySelector(".m-greifer");
    if (!g) return;
    const dx = 16 + ((sz.x - GR.links) / (GR.rechts - GR.links)) * 30 - 31;
    const setz = (x, y, ms) => { g.style.transition = `transform ${ms}ms ease-in-out`; g.style.transform = `translate(${x.toFixed(1)}px, ${y}px)`; };
    setz(dx, 0, 300);
    setTimeout(() => setz(dx, 26, 800), 300);
    setTimeout(() => setz(dx, 0, 800), 1500);
    setTimeout(() => setz(-15, 0, 1100), 2400);
    setTimeout(() => setz(0, 0, 700), 3900);
    if (sz.gewonnen) setTimeout(() => { b.classList.remove("greifer-gewinn"); void b.offsetWidth; b.classList.add("greifer-gewinn"); setTimeout(() => b.classList.remove("greifer-gewinn"), 3000); }, 3600);
  }

  function zeigeSchau(sch) {
    if (!sch || !raum) return;
    const b = dingEls.get(sch.ding);
    if (!b) return;
    if (sch.ding === "greifer" && sch.greifer) { kleinerGreifer(b, sch.greifer, sch.id); return; }
    if (sch.gross && (/^slot-/.test(sch.ding) || sch.spielhalle)) { explosion(b, sch); return; }
    if (sch.spielhalle) { gewinnZeigen(b, sch); return; }
    if (sch.ding === "gluecksrad") {
      // Den eigenen Dreh fährt die Tafel selbst, sonst liefe das Rad zweimal.
      if (ich && sch.id === ich.id) return;
      if (!Number.isInteger(sch.index) || (tisch && tisch.art === "rad" && tisch.dreht)) return;
      radDrehen(sch.index);
      if (!sch.titel) return;
      const d = raum.dinge.find((x) => x.id === sch.ding);
      setTimeout(() => {
        if (!d || !raum || !raum.dinge.includes(d)) return;
        const z = M.ding(d);
        const titel = document.createElement("div");
        titel.className = "welt-radtitel";
        titel.textContent = sch.titel;
        titel.style.transform = `translate3d(${d.x * T}px, ${z.oben - 6}px, 0)`;
        schilderEbene.appendChild(titel);
        setTimeout(() => titel.remove(), 4300);
      }, reduziert() ? 150 : RAD_MS);
      return;
    }
    if (sch.ding === "roulette") {
      b.classList.remove("dreht");
      void b.offsetWidth;
      b.classList.add("dreht");
      const dauer = reduziert() ? 150 : 3000;
      setTimeout(() => {
        b.classList.remove("dreht");
        const d = raum.dinge.find((x) => x.id === sch.ding);
        if (!d) return;
        const z = M.ding(d);
        const zahl = document.createElement("div");
        zahl.className = `welt-tischzahl ${sch.farbe === "red" ? "rot" : sch.farbe === "black" ? "schwarz" : "gruen"}`;
        zahl.textContent = String(sch.zahl);
        zahl.style.transform = `translate3d(${d.x * T}px, ${z.oben - 6}px, 0)`;
        schilderEbene.appendChild(zahl);
        setTimeout(() => zahl.remove(), 4200);
        const f = ich && sch.id === ich.id ? ich : andere.get(sch.id);
        if (f && sch.gewinn > 0) {
          const plus = document.createElement("span");
          plus.className = "wf-plus";
          plus.textContent = "+" + deZahl(sch.gewinn);
          f.schild.appendChild(plus);
          setTimeout(() => plus.remove(), 2400);
        }
      }, dauer);
    }
  }
  socket.on("welt:schau", zeigeSchau);

  /* Ein großer Gewinn an einem Automaten: Blitz, Druckwelle, Funken und
     Münzen, der Raum bebt kurz, und über dem Automaten steht, wer was
     gewonnen hat. Die Funken fliegen in einem Bogen: höchster Punkt
     bei --dy, danach fallen sie unter den Start, damit sie sichtbar
     ankommen und nicht im Nichts verschwinden. */
  /* Ein kleiner Gewinn an einem Spielhallen-Automaten: die Zahl steigt über
     ihm auf, der Automat blitzt kurz, ein paar Münzen springen. */
  function gewinnZeigen(b, sch) {
    const d = raum.dinge.find((x) => x.id === sch.ding);
    if (!d) return;
    const z = M.ding(d);
    const el2 = document.createElement("div");
    el2.className = "welt-gewinn";
    el2.style.transform = `translate3d(${d.x * T}px, ${z.oben + 6}px, 0)`;
    el2.innerHTML = `<b>+${(Number(sch.betrag) || 0).toLocaleString("de-DE")}</b><small>×${String(sch.vielfach).replace(".", ",")}</small>`
      + (reduziert() ? "" : Array.from({ length: 5 }, (_, i) => `<i class="ex-muenze" style="--dx:${(i - 2) * 14}px;--dy:${-30 - (i % 2) * 14}px;--fall:30px;--rot:${(i - 2) * 160}deg;animation-delay:${i * 0.05}s"></i>`).join(""));
    schilderEbene.appendChild(el2);
    b.classList.remove("blitzt"); void b.offsetWidth; b.classList.add("blitzt");
    setTimeout(() => { el2.remove(); b.classList.remove("blitzt"); }, 2600);
  }

  function explosion(b, sch) {
    const d = raum.dinge.find((x) => x.id === sch.ding);
    if (!d) return;
    const z = M.ding(d);
    const f = ich && sch.id === ich.id ? ich : andere.get(sch.id);
    const name = f && f.look ? f.look.name : "";
    klang("explosion", f || null);
    const box = document.createElement("div");
    box.className = "welt-explosion";
    box.style.transform = `translate3d(${d.x * T}px, ${z.oben + z.h * 0.42}px, 0)`;
    const r = (a, c) => a + Math.random() * (c - a);
    let teile = '<i class="ex-blitz"></i><i class="ex-welle"></i><i class="ex-welle w2"></i>';
    if (!reduziert()) {
      for (let n = 0; n < 26; n++) {
        const muenze = n % 3 === 0;
        teile += `<i class="${muenze ? "ex-muenze" : "ex-funke"}" style="--dx:${r(-150, 150).toFixed(0)}px;--dy:${r(-130, -50).toFixed(0)}px;--fall:${r(40, 90).toFixed(0)}px;--rot:${r(-720, 720).toFixed(0)}deg;animation-delay:${r(0, 0.12).toFixed(2)}s"></i>`;
      }
      for (let n = 0; n < 5; n++) teile += `<i class="ex-rauch" style="--dx:${r(-40, 40).toFixed(0)}px;animation-delay:${(0.1 + n * 0.08).toFixed(2)}s"></i>`;
    }
    const titel = sch.jackpot ? "JACKPOT" : sch.vielfach >= 100 ? "MEGA-GEWINN" : "GROSSER GEWINN";
    box.innerHTML = teile;
    schilderEbene.appendChild(box);
    /* Das Schild steht oben in der Bildmitte und nicht am Automaten: der
       steht am Rand des Raums, und dort ragte es aus dem Bild. */
    const schild = document.createElement("div");
    schild.className = "ex-schild";
    schild.innerHTML = `<b>${titel}</b><span>${esc(name)} · ${esc(d.label)} · ×${Number(sch.vielfach) || 0} · +${(Number(sch.betrag) || 0).toLocaleString("de-DE")} Chips</span>`;
    el.appendChild(schild);
    setTimeout(() => schild.remove(), 4200);
    b.classList.remove("explodiert"); void b.offsetWidth; b.classList.add("explodiert");
    // Der Raum bebt, nicht die Kamera: deren transform setzt der Takt in jedem Bild.
    if (!reduziert()) { raumEl.classList.remove("bebt"); void raumEl.offsetWidth; raumEl.classList.add("bebt"); }
    if (vorn && Casino.sound && Casino.sound.play) Casino.sound.play("bigwin");
    setTimeout(() => { box.remove(); b.classList.remove("explodiert"); raumEl.classList.remove("bebt"); }, 4200);
  }

  /* Das Regal im Kontor: die Kamera fährt heran, dann Schnitt in den
     Tresorraum. Dieselbe Blende wie bei einer Tür. */
  function geheimgang(d, umzug) {
    if (!umzug || !umzug.ok) return;
    wechselt = true;
    if (d.fokus) fahreZu(d.fokus);
    setTimeout(() => {
      el.classList.add("welt-blende");
      setTimeout(() => {
        fokus = null;
        kamera.classList.remove("faehrt");
        uebernehmen(umzug);
        requestAnimationFrame(() => { wechselt = false; el.classList.remove("welt-blende"); });
      }, reduziert() ? 0 : 220);
    }, reduziert() ? 0 : 420);
  }

  function geheimnisZeigen(g) {
    if (!g) return;
    Casino.sound && Casino.sound.play && Casino.sound.play(g.neu ? "geheimnis" : "tick");
    const text = g.neu ? `${g.satz}\n\nNeu in deiner Sammlung: ${g.label}. Geheimnis ${g.zahl} von ${g.von}.` : g.satz;
    Casino.dialog.hinweis(text, { titel: g.neu ? "Gefunden!" : "Schon entdeckt" });
  }
  socket.on("welt:geheimnis", (g) => geheimnisZeigen(g));

  /* Das alte Garagentor geht auf, nur für den, der davor gehupt hat. */
  socket.on("welt:tor", (t) => {
    if (!t || !drin) return;
    const b = dingEls.get(t.ding);
    if (b) {
      b.classList.add("offen");
      setTimeout(() => b.classList.remove("offen"), Math.min(Number(t.bis) || 60000, 120000));
    }
    if (t.satz) Casino.dialog.hinweis(t.satz, { titel: "Nanu?" });
  });

  /* Was nur in der Übersicht steht (Rekorde, Feed), öffnet die Übersicht
     genau an der Stelle. */
  function zeigeInUebersicht(was) {
    setzeAnsicht("liste");
    const ziel = was === "rekorde" ? "lobby-records" : "global-feed-list";
    setTimeout(() => document.getElementById(ziel)?.scrollIntoView({ behavior: reduziert() ? "auto" : "smooth", block: "center" }), 80);
  }

  function hinsetzen(sitz) {
    if (!drin) return;
    ziel = null;
    sendeZug(false);
    socket.emit("welt:sitzen", { platz: sitz.id }, (res) => {
      if (!res || !res.ok) { Casino.toast((res && res.error) || "Das geht gerade nicht."); return; }
      ich.x = res.pos.x; ich.y = res.pos.y; ich.d = res.pos.d; ich.s = res.pos.s; ich.g = false;
      zuletztGesendet = { x: ich.x, y: ich.y, d: ich.d, g: 0, t: performance.now() };
      setzeZustand(ich); platziere(ich);
    });
  }

  function aufstehenLokal() {
    const sitz = raum.sitze.find((s) => s.id === ich.s);
    if (sitz) { ich.x = sitz.auf.x; ich.y = sitz.auf.y; }
    ich.s = 0;
    setzeZustand(ich);
  }

  /* Auswahl: Spielhalle, Wettschalter, Spieltisch, und die Schnellwahl */
  function zeigeAuswahl(d, ids) {
    const spiele = (Casino._games || []).filter((g) => ids.includes(g.id));
    auswahlEl.querySelector(".welt-auswahl-kicker").textContent = d.label.toUpperCase();
    auswahlEl.querySelector("h2").textContent = "Was möchtest du spielen?";
    auswahlEl.querySelector(".welt-auswahl-liste").innerHTML = spiele.map((g) => eintrag(g.id, g.name, g.sub, g.sym || g.id)).join("");
    auswahlEl.dataset.ding = d.id;
    auswahlEl.classList.remove("breit");
    oeffneAuswahl();
  }

  function eintrag(screen, titel, unter, sym) {
    const bild = Casino.icons ? (Casino.icons.icon(sym) || Casino.icons.icon(screen) || "") : "";
    // Dieselbe Marke wie am Ding im Raum, damit die Schnellwahl nichts verschweigt.
    const n = Number(letzteMarken[screen]) || 0;
    return `<button type="button" class="welt-eintrag" data-ziel="${esc(screen)}"><span class="welt-eintrag-bild">${bild}</span><span><b>${esc(titel)}</b><small>${esc(unter || "")}</small></span>${n ? `<span class="welt-marke" aria-label="${n} wartet">${n > 9 ? "9+" : n}</span>` : ""}</button>`;
  }

  function zeigeSchnellwahl() {
    const games = Casino._games || [];
    const gruppen = [["casino", "Gegen das Haus"], ["pvp", "Gegeneinander"], ["wirtschaft", "Wirtschaft"], ["sammeln", "Sammeln"]];
    auswahlEl.querySelector(".welt-auswahl-kicker").textContent = "DIREKT HIN";
    auswahlEl.querySelector("h2").textContent = "Schnellwahl";
    auswahlEl.querySelector(".welt-auswahl-liste").innerHTML = gruppen.map(([cat, titel]) => {
      const liste = games.filter((g) => g.cat === cat);
      if (!liste.length) return "";
      return `<h3 class="welt-auswahl-gruppe">${esc(titel)}</h3>` + liste.map((g) => eintrag(g.id, g.name, g.sub, g.sym || g.id)).join("");
    }).join("");
    delete auswahlEl.dataset.ding;
    auswahlEl.classList.add("breit");
    oeffneAuswahl();
  }

  let vorAuswahlFokus = null;
  function oeffneAuswahl() {
    allesLoslassen();
    vorAuswahlFokus = document.activeElement;
    auswahlEl.classList.remove("hidden");
    const erster = auswahlEl.querySelector(".welt-eintrag");
    if (erster) erster.focus({ preventScroll: true });
  }
  function schliesseAuswahl() {
    auswahlEl.classList.add("hidden");
    if (vorAuswahlFokus && vorAuswahlFokus.focus) vorAuswahlFokus.focus({ preventScroll: true });
  }
  auswahlEl.addEventListener("click", (e) => {
    if (e.target === auswahlEl || e.target.closest(".welt-auswahl-zu")) { schliesseAuswahl(); return; }
    const b = e.target.closest("[data-ziel]");
    if (!b) return;
    const screen = b.dataset.ziel;
    const d = auswahlEl.dataset.ding && raum ? raum.dinge.find((x) => x.id === auswahlEl.dataset.ding) : null;
    schliesseAuswahl();
    if (d) oeffne(d, { screen });
    else hinUndOeffnen(screen);
  });

  /* Schnellwahl: erst hinspringen, dann öffnen. Der Server sucht das Ding
     und setzt die Figur davor (welt:hin); alle im Raum sehen, wo man spielt.
     Ohne Ding im Haus, oder wenn etwas schiefgeht, öffnet sich der
     Bildschirm wie früher, man soll nie vor einem toten Knopf stehen. */
  function hinUndOeffnen(screen) {
    if (!drin) { Casino.showScreen(screen); return; }
    ziel = null; tasten.clear();
    socket.emit("welt:hin", { screen }, (res) => {
      if (!res || !res.ok || res.ohneOrt || !res.ding) { Casino.showScreen(screen); return; }
      if (res.umzug && res.umzug.ok) uebernehmen(res.umzug);
      const p = res.platz || res.pos;
      if (p && ich) {
        ich.x = p.x; ich.y = p.y; ich.d = p.d; ich.s = p.s || 0; ich.g = false;
        zuletztGesendet = { x: ich.x, y: ich.y, d: ich.d, g: 0, t: performance.now() };
        setzeZustand(ich); platziere(ich); sprungZeigen(ich);
        kameraSofort = true;
      }
      const d = raum && raum.dinge.find((x) => x.id === res.ding);
      if (d) oeffne(d, { ...d.ziel, screen });
      else Casino.showScreen(screen);
    });
  }

  function sprungZeigen(f) {
    if (reduziert() || !f.el) return;
    f.el.classList.remove("springt"); void f.el.offsetWidth; f.el.classList.add("springt");
    setTimeout(() => f.el.classList.remove("springt"), 650);
  }
  socket.on("welt:sprung", (z) => {
    if (!drin || !z) return;
    const f = ich && z.id === ich.id ? ich : andere.get(z.id);
    if (!f) return;
    f.x = z.x; f.y = z.y; f.d = z.d || f.d; f.s = 0; f.g = false;
    // Kein Gleiten quer durch den Raum: ein einziger Eintrag in der Vergangenheit rastet sofort ein.
    if (f !== ich) f.puffer = [{ t: performance.now() - PUFFER_MS - 1, x: z.x, y: z.y, d: f.d, g: false, s: 0 }];
    else { zuletztGesendet = { x: f.x, y: f.y, d: f.d, g: 0, t: performance.now() }; fremdGesteuertBis = performance.now() + 400; }
    setzeZustand(f); platziere(f); sprungZeigen(f);
  });

  /* Türen */
  function tuerDurch(t) {
    if (wechselt || !drin) return;
    wechselt = true;
    ziel = null;
    tasten.clear();
    sendeZug(false);
    el.classList.add("welt-blende");
    klang("tuer");
    socket.emit("welt:tuer", { tuer: t.id }, (res) => {
      const fertig = () => { wechselt = false; el.classList.remove("welt-blende"); };
      if (!res || !res.ok) {
        fertig();
        // Einen Schritt zurück in den Raum, sonst steht man in der Tür fest.
        ich.x += t.x1 > raum.w / 2 ? -0.5 : 0.5;
        sendeZug(false);
        Casino.toast((res && res.error) || "Die Tür klemmt.");
        return;
      }
      setTimeout(() => { uebernehmen(res); requestAnimationFrame(fertig); }, reduziert() ? 0 : 180);
    });
  }

  /* Kamera */
  let breite = 0, hoehe = 0, OBEN = 64;
  let kameraSofort = true;
  let kameraAlt = "";
  function misse() {
    breite = buehne.clientWidth;
    hoehe = buehne.clientHeight;
    const oben = buehne.getBoundingClientRect().top;
    OBEN = Math.max(64, ...[".welt-ort", ".welt-knoepfe"].map((sel) => $(sel).getBoundingClientRect().bottom - oben + 12));
  }
  if (window.ResizeObserver) {
    const beobachter = new ResizeObserver(() => { misse(); kameraSofort = true; });
    beobachter.observe(buehne);
    beobachter.observe($(".welt-knoepfe"));
    beobachter.observe($(".welt-ort"));
  }
  window.addEventListener("resize", () => { misse(); kameraSofort = true; });
  misse();

  /* Oben liegt die Leiste mit Raumname und Knöpfen. Der Raum beginnt
     darunter, sonst verschwindet genau die Wand mit der Laufschrift. */
  function grundmassstab() {
    if (!raum) return 1;
    const passt = Math.min(breite / (raum.w * T), (hoehe - OBEN) / (raum.h * T));
    /* Auf dem Telefon im Hochformat wäre der ganze Raum ein schmaler
       Streifen mit leerem Rand darüber und darunter. Dort füllt er die
       Höhe, und die Kamera folgt seitlich. */
    if (breite < 600) return Math.max(0.72, Math.min(1, (hoehe - OBEN) / (raum.h * T)));
    /* Das iPad im Hochformat hatte dasselbe Problem eine Nummer größer:
       an der Breite ausgerichtet blieb oben und unten je ein Viertel
       leer. Dort darf der Raum bis 40 % größer werden, als er in die
       Breite passt; den Rest holt die Kamera seitlich nach. */
    if (hoehe > breite * 1.1) {
      const fuellt = (hoehe - OBEN) / (raum.h * T);
      return Math.min(1.5, Math.max(passt, Math.min(fuellt, passt * 1.4)));
    }
    // Nie so klein, dass eine Kachel unter 34 Pixel fällt: dann folgt die
    // Kamera der Figur, statt den ganzen Raum winzig zu zeigen.
    return Math.min(1.5, Math.max(passt, 0.72));
  }

  let kam = { x: 0, y: 0, s: 1 };
  function kameraZiel() {
    const s0 = grundmassstab();
    if (fokus) {
      // Nah genug, dass man sieht, wo man steht, aber nicht so nah, dass
      // hinter dem Bildschirm nur noch ein verschwommener Arm liegt.
      const s = Math.min(s0 * fokus.zoom, 2.3);
      return { s, x: fokus.x * T * s - breite / 2, y: fokus.y * T * s - hoehe * (fokus.oben || 0.42) };
    }
    const rw = raum.w * T * s0, rh = raum.h * T * s0;
    const px = ich ? ich.x * T * s0 : rw / 2, py = ich ? (ich.y - 0.8) * T * s0 : rh / 2;
    const x = rw <= breite ? (rw - breite) / 2 : Math.max(0, Math.min(rw - breite, px - breite / 2));
    const frei = hoehe - OBEN;
    const y = rh <= frei ? (rh - frei) / 2 - OBEN : Math.max(-OBEN, Math.min(rh - hoehe, py - hoehe / 2));
    return { s: s0, x, y };
  }

  function fahreZu(f) {
    fokus = f;
    tasten.clear();
    stickLos();
    kamera.classList.toggle("faehrt", !reduziert());
  }
  function fahreZurueck() {
    if (!fokus) return;
    fokus = null;
    kamera.classList.toggle("faehrt", !reduziert());
    setTimeout(() => kamera.classList.remove("faehrt"), 700);
  }

  function setzeKamera() {
    if (!raum) return;
    const z = kameraZiel();
    if (fokus || kameraSofort || kamera.classList.contains("faehrt")) {
      kam = z;
      kameraSofort = false;
    } else {
      // Weich nachziehen, damit die Kamera beim Anlaufen nicht ruckt.
      const k = 0.18;
      kam = { s: z.s, x: kam.x + (z.x - kam.x) * k, y: kam.y + (z.y - kam.y) * k };
      if (Math.abs(z.x - kam.x) < 0.3) kam.x = z.x;
      if (Math.abs(z.y - kam.y) < 0.3) kam.y = z.y;
    }
    const t = `translate3d(${(-kam.x).toFixed(1)}px, ${(-kam.y).toFixed(1)}px, 0) scale(${kam.s.toFixed(4)})`;
    if (t !== kameraAlt) { kamera.style.transform = t; kameraAlt = t; }
  }

  function bildschirmZuWelt(cx, cy) {
    if (!raum) return null;
    const b = buehne.getBoundingClientRect();
    return { x: (cx - b.left + kam.x) / kam.s / T, y: (cy - b.top + kam.y) / kam.s / T };
  }

  /* Takt */
  let letzt = performance.now();
  /* Liegt ein Spiel über dem Raum, ist die Welt weichgezeichnet, und jedes
     Bild zwingt das iPad, den ganzen Hintergrund neu unscharf zu rechnen,
     während vorn Slots laufen. Dahinter reichen drei Bilder je Sekunde:
     andere Figuren gehen weiter, nur in gröberen Schritten. */
  let letzterHinten = 0;
  function takt(jetzt) {
    if (vorn || jetzt - letzterHinten > 330) {
      if (!vorn) letzterHinten = jetzt;
      schritt(jetzt);
    }
    requestAnimationFrame(takt);
  }
  function schritt(jetzt) {
    const dt = Math.min(0.05, Math.max(0, (jetzt - letzt) / 1000));
    letzt = jetzt;
    if (raum && ich) {
      bewegeMich(dt, jetzt);
      for (const f of andere.values()) bewegeAndere(f, jetzt);
      tierFolgt(ich, dt);
      for (const f of andere.values()) tierFolgt(f, dt);
      pruefeNaehe();
      if (vorn && jetzt - letzteRunde > 400) {
        letzteRunde = jetzt;
        tanzflaeche();
        tiereBegegnen(jetzt);
      }
    }
    setzeKamera();
  }

  /* Die Tanzfläche in der Spielhalle, dieselben Maße wie die Leuchtkacheln
     in moebel.js. Wer darauf steht und nichts tut, tanzt; die Kachel unter
     ihm leuchtet auf. Reine Anzeige, jeder Browser rechnet selbst. */
  const TANZ = { raum: "spielhalle", x: 5.9, y: 4.7, schritt: 0.84, spalten: 5, reihen: 4 };
  let letzteRunde = 0;
  function tanzflaeche() {
    const hier = raum.id === TANZ.raum;
    const an = new Set();
    for (const f of [ich, ...andere.values()]) {
      const sx = Math.floor((f.x - TANZ.x) / TANZ.schritt), sy = Math.floor((f.y - TANZ.y) / TANZ.schritt);
      const drauf = hier && sx >= 0 && sx < TANZ.spalten && sy >= 0 && sy < TANZ.reihen;
      const tanzt = drauf && !f.g && !f.s && !f.a && !f.el.classList.contains("reitet");
      if (drauf) an.add(sx + sy * TANZ.spalten);
      if (tanzt !== f.el.classList.contains("tanzt")) f.el.classList.toggle("tanzt", tanzt);
    }
    if (!hier) return;
    raumEl.querySelectorAll(".wb-tanzkachel").forEach((k, i) => k.classList.toggle("unter", an.has(i)));
  }

  /* Haustiere bemerken einander. Stehen zwei Tiere still nah beieinander,
     drehen sie sich zueinander und sagen etwas; gleiche Arten mögen sich,
     Hund und Katze nicht, der Papagei plappert nach. Danach ist eine Weile
     Ruhe, sonst redet ein Rudel am Tisch ununterbrochen. */
  const LAUT = { taube: "Gurr!", hamster: "Piep!", frosch: "Quak!", dackel: "Wuff!", waschbaer: "Fiep!", gluecksschwein: "Oink!",
    minidrache: "Fauch!", tresorkatze: "Miau!", igel: "Schnüff!", hase: "Mümmel!", schildkroete: "…", pinguin: "Kwääk!", papagei: "Hallo!" };
  const TIER_RUHE = 25000;
  function tierLaut(t, text, warte = 0, klasse = "begegnet", ton = null) {
    setTimeout(() => {
      if (!t.el.isConnected) return;
      klang(ton || (text === "♥" ? "tier_herz" : "tier_" + t.id), t);
      const b = document.createElement("span");
      b.className = "wt-laut";
      b.textContent = text;
      t.el.appendChild(b);
      // Die Blase muss über den Figuren liegen, das Tier steht oft halb dahinter.
      t.el.style.zIndex = 100000;
      t.el.classList.remove(klasse); void t.el.offsetWidth; t.el.classList.add(klasse);
      setTimeout(() => { b.remove(); t.el.classList.remove(klasse); t.lage = ""; }, 1700);
    }, warte);
  }
  function tiereBegegnen(jetzt) {
    const tiere = [ich, ...andere.values()].map((f) => f.tier).filter((t) => t && !t.geht && !(t.ruhe > jetzt));
    for (let i = 0; i < tiere.length; i++) {
      for (let j = i + 1; j < tiere.length; j++) {
        const a = tiere[i], b = tiere[j];
        if (a.ruhe > jetzt || b.ruhe > jetzt || Math.hypot(a.x - b.x, a.y - b.y) > 1.4) continue;
        a.ruhe = b.ruhe = jetzt + TIER_RUHE + Math.random() * 10000;
        a.links = b.x < a.x; b.links = a.x < b.x;
        const art = new Set([a.id, b.id]);
        if (a.id === b.id) {
          tierLaut(a, "♥"); tierLaut(b, "♥", 350);
        } else if (art.has("dackel") && art.has("tresorkatze")) {
          const hund = a.id === "dackel" ? a : b, katze = hund === a ? b : a;
          tierLaut(hund, "Wuff! Wuff!");
          tierLaut(katze, "Fauch!", 450, "erschrickt", "tier_fauchen");
        } else if (art.has("papagei")) {
          const vogel = a.id === "papagei" ? a : b, anderes = vogel === a ? b : a;
          tierLaut(anderes, LAUT[anderes.id] || "…");
          tierLaut(vogel, LAUT[anderes.id] || "Hallo!", 700, "begegnet", "tier_" + anderes.id);
        } else {
          tierLaut(a, LAUT[a.id] || "…");
          tierLaut(b, LAUT[b.id] || "…", 450);
        }
      }
    }
  }

  function eingabeVektor() {
    let x = 0, y = 0;
    if (tasten.has("links")) x -= 1;
    if (tasten.has("rechts")) x += 1;
    if (tasten.has("hoch")) y -= 1;
    if (tasten.has("runter")) y += 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l, staerke: 1 }; }
    const l = Math.hypot(stick.x, stick.y);
    if (l > 0.18) return { x: stick.x / l, y: stick.y / l, staerke: Math.min(1, (l - 0.18) / 0.62 + 0.35) };
    return null;
  }

  function bewegeMich(dt, jetzt) {
    if (!bedienbar()) {
      if (ich.g) { ich.g = false; setzeZustand(ich); sendeZug(false); }
      return;
    }
    let v = eingabeVektor();
    if (v) ziel = null;
    if (!v && ziel) {
      /* Ein leerer Weg heißt: man steht schon da (etwa direkt vor der Tür).
         Dann gilt man sofort als angekommen. */
      const [zx, zy] = ziel.pfad[0] || [ich.x, ich.y];
      const l = Math.hypot(zx - ich.x, zy - ich.y);
      if (l < 0.08) {
        ziel.pfad.shift();
        if (!ziel.pfad.length) {
          const danach = ziel.danach;
          ziel = null;
          if (danach && danach.tuer) {
            const w = tuerWeg(danach.tuer);
            const senkrecht = !!w.senkrecht;
            ziel = { pfad: [senkrecht ? [ich.x, w.rein[1]] : [w.rein[0], ich.y]], danach: null };
          }
          else if (danach) benutze(danach);
        }
      } else {
        v = { x: (zx - ich.x) / l, y: (zy - ich.y) / l, staerke: 1, rest: l };
      }
    }
    const warGehend = ich.g;
    if (v && fahrt.auf && fahrt.steht) {
      // Er springt nicht an: umdrehen geht, losfahren nicht.
      ich.d = Math.abs(v.x) > Math.abs(v.y) * 1.05 ? (v.x < 0 ? "links" : "rechts") : (v.y < 0 ? "hoch" : "runter");
      ziel = null;
      qualmen();
      v = null;
      setzeZustand(ich);
    }
    if (v) {
      if (ich.s) aufstehenLokal();
      const faehrt = !!(ich.look.kleidung && ich.look.kleidung.fahrzeug);
      let schritt = R.TEMPO * (faehrt ? R.FAHRZEUG_FAKTOR : 1) * v.staerke * dt;
      if (v.rest != null) schritt = Math.min(schritt, v.rest);
      const nx = ich.x + v.x * schritt, ny = ich.y + v.y * schritt;
      if (R.begehbar(raum, nx, ny)) { ich.x = nx; ich.y = ny; }
      else if (R.begehbar(raum, nx, ich.y) && Math.abs(v.x) > 0.05) ich.x = nx;
      else if (R.begehbar(raum, ich.x, ny) && Math.abs(v.y) > 0.05) ich.y = ny;
      else if (ziel) ziel = null;
      ich.d = Math.abs(v.x) > Math.abs(v.y) * 1.05 ? (v.x < 0 ? "links" : "rechts") : (v.y < 0 ? "hoch" : "runter");
      ich.g = true;
      for (const t of raum.tueren) if (R.inTuer(t, ich.x, ich.y)) { tuerDurch(t); break; }
    } else {
      ich.g = false;
    }
    if (ich.g !== warGehend || v) setzeZustand(ich);
    platziere(ich);
    if (jagd.marken.length) jagdNah();

    if (jetzt < fremdGesteuertBis && !v) return;
    const geaendert = Math.abs(ich.x - zuletztGesendet.x) > 0.005 || Math.abs(ich.y - zuletztGesendet.y) > 0.005 || ich.d !== zuletztGesendet.d;
    if (warGehend && !ich.g) sendeZug(false);
    else if (geaendert && jetzt - zuletztGesendet.t >= SENDE_MS) sendeZug(ich.g);
  }

  function bewegeAndere(f, jetzt) {
    const p = f.puffer;
    if (!p.length) return;
    const zeit = jetzt - PUFFER_MS;
    while (p.length >= 2 && p[1].t <= zeit) p.shift();
    let x, y, d, g, s;
    if (p.length >= 2 && p[0].t <= zeit) {
      const a = p[0], b = p[1];
      const k = Math.min(1, (zeit - a.t) / Math.max(1, b.t - a.t));
      x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k;
      d = b.d; g = true; s = b.s;
    } else {
      const a = p[0];
      if (a.t > zeit && p.length === 1 && Math.hypot(a.x - f.x, a.y - f.y) > 0.01) {
        // Nur eine Meldung da: dorthin gleiten statt zu springen.
        const k = Math.min(1, 1 - (a.t - zeit) / PUFFER_MS);
        x = f.x + (a.x - f.x) * Math.max(0.12, k); y = f.y + (a.y - f.y) * Math.max(0.12, k);
        d = a.d; g = a.g; s = a.s;
      } else {
        x = a.x; y = a.y; d = a.d; g = a.g && jetzt - a.t < 400; s = a.s;
      }
    }
    const wechsel = d !== f.d || !!g !== !!f.g || (s || 0) !== (f.s || 0);
    f.x = x; f.y = y; f.d = d; f.g = g; f.s = s || 0;
    if (wechsel) setzeZustand(f);
    platziere(f);
  }

  /* Was ist in Reichweite? */
  function pruefeNaehe() {
    let neu = null;
    const amTisch = ich.s && (raum.sitze.find((s) => s.id === ich.s) || {}).tisch;
    if (bedienbar() && amTisch) {
      // Wer am Tisch sitzt, spielt mit E weiter, ohne erst aufzustehen.
      const d = raum.dinge.find((x) => x.id === amTisch);
      if (d) neu = { ding: d, amTisch: true };
    } else if (bedienbar() && !ich.s) {
      const d = R.naechstesDing(raum, ich.x, ich.y);
      if (d) neu = { ding: d };
      else {
        // Tischplätze vergibt der Tisch selbst, dafür gibt es keinen eigenen Hinweis.
        const sitz = raum.sitze.find((s) => !s.tisch && Math.hypot(s.auf.x - ich.x, s.auf.y - ich.y) < 0.8
          && ![...andere.values()].some((f) => f.s === s.id));
        if (sitz) neu = { sitz };
      }
    }
    const kennung = (n) => n ? (n.ding ? "d:" + n.ding.id + (n.amTisch ? ":sitzt" : "") : "s:" + n.sitz.id) : "";
    const schluessel = kennung(neu), alt = kennung(naechstes);
    if (schluessel === alt) return;
    naechstes = neu;
    for (const [id, b] of dingEls) b.classList.toggle("nah", !!(neu && neu.ding && neu.ding.id === id));
    if (!neu) {
      hinweisEl.classList.add("hidden");
      aktionKnopf.classList.add("hidden");
      return;
    }
    const verb = neu.ding ? (neu.amTisch ? (neu.ding.ziel && neu.ding.ziel.shisha ? "Ziehen" : "Weiterspielen") : neu.ding.verb) : "Hinsetzen";
    const label = neu.ding ? neu.ding.label : (neu.sitz.id.startsWith("sofa") ? "Sofa" : "Sessel");
    let hx, hy;
    if (neu.amTisch) {
      // Über dem eigenen Kopf: an der Tischkante läge er auf dem eigenen Namen.
      hx = ich.x * T; hy = (ich.y - 1.6) * T;
    } else if (neu.ding) {
      const z = M.ding(neu.ding);
      hx = neu.ding.x * T;
      // Hohe Dinge an der Wand reichen bis unter die Kopfleiste. Dort
      // steht der Hinweis auf ihrer Front, sonst über der Oberkante.
      hy = z.h > 1.6 * T ? z.oben + Math.min(z.h * 0.42, 50) : Math.max(z.oben - 4, 18);
    } else {
      hx = neu.sitz.x * T; hy = (neu.sitz.y - 1.2) * T;
    }
    // Nicht über den Rand hinaus: am Sofa ganz links wäre die Hälfte weg.
    hx = Math.max(90, Math.min(raum.w * T - 90, hx));
    const taste = beruehrung() ? "" : `<kbd>E</kbd>`;
    hinweisEl.innerHTML = `${taste}<b>${esc(verb)}</b><small>${esc(label)}</small>`;
    hinweisEl.style.transform = `translate3d(${hx}px, ${hy}px, 0)`;
    hinweisEl.classList.remove("hidden");
    aktionKnopf.querySelector("b").textContent = verb;
    aktionKnopf.querySelector("small").textContent = label;
    aktionKnopf.classList.remove("hidden");
  }

  /* Modus: vorn, dahinter, oder aus */
  function setzeAnsicht(a) {
    ansicht = a === "liste" ? "liste" : "welt";
    try { localStorage.setItem(ANSICHT_KEY, ansicht); } catch {}
    modus(Casino.screens.current());
    if (ansicht === "welt") { window.scrollTo(0, 0); buehne.focus({ preventScroll: true }); }
  }

  function modus(screen) {
    const html = document.documentElement;
    const aus = !screen || screen === "login" || screen === "verification";
    const istLobby = screen === "lobby";
    const warVorn = vorn;
    vorn = !aus && istLobby && ansicht === "welt";
    if (Casino.musik) Casino.musik.vorn(vorn);
    // Zurück aus einem Spiel: Tafeln und Kurse sofort frisch, nicht erst beim nächsten Takt.
    if (vorn && !warVorn && drin && raum) anzeigenLaden();
    html.classList.toggle("welt-an", !aus);
    html.classList.toggle("welt-vorn", vorn);
    html.classList.toggle("welt-hinter", !aus && !vorn);
    html.classList.toggle("welt-liste", !aus && istLobby && ansicht === "liste");
    html.classList.toggle("welt-fenster", !aus && !istLobby);
    if (vorn) fahreZurueck();
    if (!vorn) { tasten.clear(); stickLos(); ziel = null; zeiger = null; gestenRadZu(); }
    if (!vorn && tisch) { tisch = null; tischEl.classList.add("hidden"); chipsAufFilz(); }
    if (aus && drin) {
      socket.emit("welt:verlassen", {});
      drin = false;
      for (const id of [...andere.keys()]) entferneFigur(id);
    }
    if (!aus && !drin && !betrittGerade) betreten();
    const acc = Casino.getAccount && Casino.getAccount();
    if (drin && acc && meinName && acc.name !== meinName) betreten();
    starterKnopf();
  }

  function starterKnopf() {
    const sp = document.getElementById("starter-pass");
    const zeigen = !!sp && !sp.classList.contains("hidden");
    el.querySelector(".welt-starter").classList.toggle("hidden", !zeigen);
  }
  const sp = document.getElementById("starter-pass");
  if (sp && window.MutationObserver) new MutationObserver(starterKnopf).observe(sp, { attributes: true, attributeFilter: ["class"] });

  $(".welt-tipp").textContent = beruehrung()
    ? "Ziehen zum Laufen, Tippen zum Hingehen."
    : "WASD oder Pfeiltasten zum Laufen, E zum Benutzen. Klick auf ein Ding geht hin.";

  document.addEventListener("casino:screen", (e) => modus(e.detail.screen));
  modus(Casino.screens.current());
  requestAnimationFrame(takt);

  Casino.welt = {
    setzeAnsicht,
    /* Für Tests in einem verdeckten Fenster, in dem requestAnimationFrame
       ruht: höchstens n Bilder von je 1/60 Sekunde nachrechnen, aber nie
       mehr, als seit dem letzten Bild wirklich vergangen ist. Vorher kam
       zur echten Pause noch jedes Bild obendrauf, die Figur lief fast
       doppelt so schnell, und der Server hat sie zu Recht zurückgesetzt. */
    _ticken(n = 60) {
      const bild = 1000 / 60;
      const k = Math.min(n, Math.floor((performance.now() - letzt) / bild));
      for (let i = 0; i < k; i++) schritt(letzt + bild);
    },
    /* Zum Ansehen einer Geste ohne das Stück: nur auf dem eigenen Bildschirm,
       es geht nichts an den Server und niemand sonst sieht es. */
    _geste(art) { if (ich) geste(ich, art); },
    // Zum Ansehen: eine Gewinn-Explosion an einem Automaten, nur lokal.
    _explosion(ding = "slot-lucky7", vielfach = 120) { if (ich) zeigeSchau({ id: ich.id, ding, gross: true, vielfach, betrag: vielfach * 1000 }); },
    /** Zum Nachsehen in der Konsole, wenn sich etwas nicht bewegt. */
    zustand: () => ({ drin, vorn, wechselt, fokus: !!fokus, fenster: fensterOffen(), raum: raum && raum.id,
      ich: ich && { x: ich.x, y: ich.y, d: ich.d, s: ich.s }, ziel: ziel && ziel.pfad.length, weg: letzterWeg, naechstes: naechstes && (naechstes.ding ? naechstes.ding.id : naechstes.sitz.id) }),
    ansicht: () => ansicht,
    /** Für die Garderobe: das eigene Aussehen sofort übernehmen. */
    eigeneFigurNeu(look) { if (ich) { ich.look = { ...ich.look, ...look }; zeichneFigur(ich); setzeZustand(ich); } },
  };
})();
