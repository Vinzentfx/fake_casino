"use strict";

/*
 * Die Ladenstraße: Zoohandlung, Autohaus und Kiosk (Server: game/laeden.js).
 *
 * Ein Bildschirm mit drei Läden als Reiter. Wer in der Welt vor einer
 * Fassade steht und hineingeht, landet im passenden Laden
 * (Casino._ladenWunsch). Preise, Bestand, Level und was man schon hat,
 * kommen alle vom Server; hier wird nur gezeigt und gefragt.
 */
(function () {
  const Casino = window.Casino;
  const { socket, toast, escapeHtml } = Casino;
  const $ = (s, r = document) => r.querySelector(s);
  const wurzel = document.querySelector('[data-screen="laeden"]');
  if (!wurzel) return;
  const inhalt = $(".ld-inhalt", wurzel);

  const LAEDEN = {
    zoo: { titel: "Zoohandlung", unter: "Zweimal die Woche eine Lieferung. Ein Tier je Lieferung, und es bekommt einen Namen." },
    autohaus: { titel: "Autohaus", unter: "Fester Preis, freigeschaltet über dein Level. Probefahrt kostet nichts." },
    kiosk: { titel: "Kiosk", unter: "Accessoires für die Hand. Einmal kaufen, dauerhaft besitzen und jederzeit wieder anlegen." },
  };
  const STUFE = { gewoehnlich: "Gewöhnlich", selten: "Selten", episch: "Episch", legendaer: "Legendär", mythisch: "Mythisch", einzel: "Einzelstück" };

  let laden = "zoo";
  let daten = null;
  let laedt = false;
  let ladeVersion = 0;
  let probe = null;   // Kennung des Fahrzeugs in der Probefahrt

  Casino._ladenWunsch = (id) => { if (LAEDEN[id]) laden = id; };

  const betrag = (n) => (Casino.betrag ? Casino.betrag(n) : escapeHtml(String(n)));
  const look = () => Casino.getAccount ? Casino.getAccount() || {} : {};
  const bild = (art, id) => (Casino.figur && Casino.figur.stueckVorschau ? Casino.figur.stueckVorschau(art, id, look()) : "");
  const stufe = (x) => `<span class="ld-stufe st-${escapeHtml(x.stufe || "gewoehnlich")}">${escapeHtml(STUFE[x.stufe] || "")}</span>`;

  /* Lieferungen wechseln nach deutscher Zeit (game/hauszeit.js); so steht
     es auch hier, egal wie die Uhr des Geräts eingestellt ist. */
  const DE_ZEIT = new Intl.DateTimeFormat("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  function wann(ts) {
    return DE_ZEIT.format(ts).replace(/\.,?/, "") + " Uhr";
  }
  function rest(ts) {
    const ms = Math.max(0, ts - Date.now());
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h >= 24 ? `${Math.floor(h / 24)} T ${h % 24} Std` : h ? `${h} Std ${m} Min` : `${m} Min`;
  }

  /* Oben im Fenster steht die Fassade des Ladens, dieselbe Zeichnung wie
     in der Ladenstraße. So sieht man, wo man hineingegangen ist. */
  const kopf = $(".ld-kopf", wurzel);
  let fassade = null;
  if (kopf && kopf.prepend && typeof document.createElement === "function") {
    fassade = document.createElement("div");
    fassade.className = "ld-fassade";
    fassade.setAttribute("aria-hidden", "true");
    kopf.prepend(fassade);
  }
  const BREITE = { zoo: 5.2, autohaus: 5.6, kiosk: 2.8 };
  function fassadeZeichnen() {
    if (!fassade) return;
    const M = Casino.weltMoebel;
    const z = M && M.ding ? M.ding({ id: "ld-" + laden, art: "ladenfront", laden, x: 0, y: 0, block: [0, 0, BREITE[laden], 1] }) : null;
    fassade.innerHTML = z ? z.svg : "";
    fassade.style.setProperty("--seiten", z ? (z.w / z.h).toFixed(3) : "1.6");
  }

  function reiterSetzen() {
    wurzel.dataset.laden = laden;
    fassadeZeichnen();
    $(".ld-titel", wurzel).textContent = LAEDEN[laden].titel;
    wurzel.querySelectorAll(".ld-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.laden === laden)));
  }

  function lade() {
    reiterSetzen();
    laedt = true;
    const version = ++ladeVersion;
    const angefragt = laden;
    if (!daten || daten.laden !== laden) inhalt.innerHTML = `<div class="ld-laedt">Einen Moment …</div>`;
    socket.emit("laden:state", { laden: angefragt }, (r) => {
      if (version !== ladeVersion || angefragt !== laden) return;
      laedt = false;
      if (!r || !r.ok) { inhalt.innerHTML = `<div class="ld-leer">${escapeHtml((r && r.error) || "Der Laden hat gerade zu.")}</div>`; return; }
      if (r.laden !== laden) return;
      daten = r;
      zeichne();
    });
  }

  function zeichne() {
    if (!daten) return;
    const kopf = `<p class="ld-unter">${escapeHtml(LAEDEN[laden].unter)}</p>`;
    if (laden === "zoo") inhalt.innerHTML = kopf + zoo(daten);
    else if (laden === "autohaus") inhalt.innerHTML = kopf + autohaus(daten);
    else inhalt.innerHTML = kopf + kiosk(daten);
  }

  /* ---------- Zoohandlung ---------- */
  function zoo(d) {
    const zurueck = d.zurueckgelegt ? d.alle.find((x) => x.id === d.zurueckgelegt) : null;
    const vorgemerkt = d.vorgemerkt ? d.alle.find((x) => x.id === d.vorgemerkt) : null;
    const lage = d.schonGekauft
      ? `<b>Du hast aus dieser Lieferung schon ein Tier.</b> Die nächste kommt ${escapeHtml(wann(d.bis))}.`
      : zurueck ? `<b>Für dich zurückgelegt: ${escapeHtml(zurueck.label)}.</b> In dieser Lieferung nur für dich. Danach bleibt deine Vormerkung erhalten.`
      : vorgemerkt ? `<b>Vorgemerkt: ${escapeHtml(vorgemerkt.label)}.</b> Sobald diese Tierart geliefert wird, legen wir eins für dich zurück.`
      : "Ein Tier je Lieferung, vier Tierarten zur Auswahl. Ausverkauft? Merk es dir vor. Deine Vormerkung bleibt erhalten.";
    const gehege = d.stuecke.map((x) => {
      const anteil = x.bestand ? Math.round((x.frei / x.bestand) * 100) : 0;
      let knopf;
      if (x.hat) knopf = `<span class="ld-hat">Wohnt schon bei dir${d.namen[x.id] ? ` („${escapeHtml(d.namen[x.id])}“)` : ""}</span>`;
      else if (x.frei > 0 && !d.schonGekauft) knopf = `<button type="button" class="btn-primary ld-kauf" data-kauf="${escapeHtml(x.id)}">${x.fuerDich ? "Abholen" : "Adoptieren"} · ${betrag(x.preis)}</button>`;
      else if (x.frei <= 0) knopf = `<button type="button" class="btn-secondary ld-kauf" data-vormerken="${escapeHtml(x.id)}"${d.vorgemerkt === x.id ? " disabled" : ""}>${d.vorgemerkt === x.id ? "Vorgemerkt" : "Ausverkauft · vormerken"}</button>`;
      else knopf = `<button type="button" class="btn-secondary ld-kauf" disabled>Nächste Lieferung</button>`;
      return `<article class="ld-gehege${x.fuerDich ? " fuer-dich" : ""}${x.frei <= 0 && !x.hat ? " leer" : ""}">
        <div class="ld-gehege-bild"><span class="ld-tier">${Casino.haustiere ? Casino.haustiere.tier(x.id) : ""}</span></div>
        <div class="ld-gehege-text">
          <h3>${escapeHtml(x.label)}</h3>${stufe(x)}
          <div class="ld-bestand" title=""><i style="width:${anteil}%"></i></div>
          <small>${x.fuerDich ? "Für dich zurückgelegt" : x.frei > 0 ? `${x.frei} von ${x.bestand} da` : "Alle vergeben"}</small>
        </div>
        ${knopf}
      </article>`;
    }).join("");
    const bewohner = d.alle.map((x) => `<li class="${x.heute ? "heute" : ""}${x.hat ? " hat" : ""}">
        <span class="ld-mini">${Casino.haustiere ? Casino.haustiere.tier(x.id) : ""}</span>
        <span><b>${escapeHtml(x.label)}</b><small>${x.hat ? "Hast du" : x.heute ? "In dieser Lieferung" : betrag(x.preis)}</small></span>
        ${!x.hat && !x.heute ? `<button type="button" class="chip-btn" data-vormerken="${escapeHtml(x.id)}"${d.vorgemerkt === x.id || d.zurueckgelegt ? " disabled" : ""}>${d.vorgemerkt === x.id ? "Vorgemerkt" : "Vormerken"}</button>` : ""}
      </li>`).join("");
    return `<div class="ld-lieferung">
        <div class="ld-lkw" aria-hidden="true">${lkw()}</div>
        <div><small>Diese Lieferung bis ${escapeHtml(wann(d.bis))} · noch ${escapeHtml(rest(d.bis))}</small><p>${lage}</p></div>
      </div>
      <div class="ld-gehege-raster">${gehege}</div>
      <h4 class="ld-zwischen">Alle Bewohner</h4>
      <ul class="ld-bewohner">${bewohner}</ul>`;
  }

  function lkw() {
    return `<svg viewBox="0 0 120 56"><rect x="4" y="10" width="70" height="34" rx="4" fill="#3f9a5a"/><text x="39" y="31" text-anchor="middle" font-size="10" font-weight="900" fill="#fff6d8" font-family="ui-rounded, system-ui">ZOO</text>
      <path d="M74 20h22l12 12v12H74Z" fill="#e8e4dc"/><path d="M80 24h14l8 8H80Z" fill="#9fd3ea"/><circle cx="22" cy="46" r="7" fill="#1d1d23"/><circle cx="22" cy="46" r="3" fill="#c0c6cc"/><circle cx="92" cy="46" r="7" fill="#1d1d23"/><circle cx="92" cy="46" r="3" fill="#c0c6cc"/></svg>`;
  }

  /* ---------- Autohaus ---------- */
  /* Im Schauraum steht das Fahrzeug allein, ohne Figur darauf (die blendet
     das CSS aus), und deshalb enger zugeschnitten als in der Sammlung. */
  const wagenBild = (id) => bild("fahrzeug", id).replace(/viewBox="[^"]*"/, 'viewBox="-6 46 76 50"');
  function autohaus(d) {
    const naechstes = d.stuecke.find((x) => !x.offen);
    const leiste = `<div class="ld-level"><b>Level ${d.level}</b>${naechstes ? `<span>Nächstes Fahrzeug ab Level ${naechstes.ab}: ${escapeHtml(naechstes.label)}</span>` : "<span>Du darfst alles fahren, was hier steht.</span>"}</div>`;
    const karten = d.stuecke.map((x) => {
      let knopf;
      if (x.hat) knopf = `<span class="ld-hat">${x.angelegt ? "Steht vor deiner Tür" : "Gehört dir"}</span>`;
      else if (!x.offen) knopf = `<button type="button" class="btn-secondary ld-kauf" disabled>${Casino.icons ? Casino.icons.ui("sperre") : ""} Ab Level ${x.ab}</button>`;
      else knopf = `<button type="button" class="btn-primary ld-kauf" data-kauf="${escapeHtml(x.id)}">Kaufen · ${betrag(x.preis)}</button>`;
      return `<article class="ld-wagen${x.offen ? "" : " zu"}${probe === x.id ? " probe" : ""}">
        <div class="ld-drehteller"><span class="ld-wagen-bild">${wagenBild(x.id)}</span><i class="ld-teller"></i></div>
        <div class="ld-wagen-text"><h3>${escapeHtml(x.label)}</h3>${stufe(x)}<small>Ab Level ${x.ab}</small></div>
        <div class="ld-knoepfe">
          ${x.hat ? "" : `<button type="button" class="chip-btn" data-probe="${escapeHtml(x.id)}">${probe === x.id ? "Probefahrt beenden" : "Probefahrt"}</button>`}
          ${knopf}
        </div>
      </article>`;
    }).join("");
    const probeKarte = probe ? (() => {
      const p = look();
      const figur = Casino.spieler ? Casino.spieler.figur({ ...p, kleidung: { ...(p.kleidung || {}), fahrzeug: probe } }) : "";
      const x = d.stuecke.find((s) => s.id === probe);
      return `<div class="ld-probe"><div class="ld-probe-figur">${figur}</div><div><small>Probefahrt</small><b>${escapeHtml(x ? x.label : "")}</b><p>So sähe es bei dir aus. Gekauft wird erst mit „Kaufen“.</p></div></div>`;
    })() : "";
    return leiste + probeKarte + `<div class="ld-wagen-raster">${karten}</div>`;
  }

  /* ---------- Kiosk ---------- */
  function kiosk(d) {
    const regal = d.stuecke.map((x) => `<article class="ld-ware${x.hat ? " hat" : ""}">
        <span class="ld-ware-bild">${bild("hand", x.id).replace(/viewBox="[^"]*"/, 'viewBox="29 34 32 38"')}</span>
        <b>${escapeHtml(x.label)}</b>
        ${x.hat
          ? `<span class="ld-hat">${x.angelegt ? "In der Hand" : "Hast du"}</span>`
          : `<button type="button" class="btn-primary ld-kauf" data-kauf="${escapeHtml(x.id)}">Holen · ${betrag(x.preis)}</button>`}
      </article>`).join("");
    return `<div class="ld-tresen"><div class="ld-schild-kiosk">Heute im Angebot: alles. Spezi ist kalt.</div><div class="ld-regal">${regal}</div></div>`;
  }

  /* ---------- Aktionen ---------- */
  async function kaufen(id) {
    const kaufLaden = laden;
    const x = daten && daten.laden === kaufLaden && daten.stuecke.find((s) => s.id === id);
    if (!x) return;
    let name = null;
    if (laden === "zoo") {
      name = await Casino.dialog.eingabe(`${x.label} für ${x.preis.toLocaleString("de-DE")} Chips. Wie soll es heißen? Leer lassen geht auch.`, {
        titel: "Adoptieren", platzhalter: "Name (2 bis 14 Zeichen)", okText: "Adoptieren",
      });
      if (name === null) return;
    } else if (laden === "autohaus") {
      // Der Kiosk fragt nicht nach, ein Spezi ist kein Autokauf.
      if (!await Casino.dialog.frage(`${x.label} für ${x.preis.toLocaleString("de-DE")} Chips kaufen? Du sitzt danach gleich drauf.`, { titel: "Autohaus", okText: "Kaufen" })) return;
    }
    if (laden !== kaufLaden) return;
    socket.emit("laden:kaufen", { laden: kaufLaden, id, name }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Das ging nicht."); return; }
      if (r.account) {
        Casino.applyAccount(r.account);
        // Die Figur in der Welt zieht sich um, wie nach der Garderobe.
        const tok = localStorage.getItem("casino_token");
        if (tok) socket.emit("auth", { token: tok });
      }
      Casino.sound && Casino.sound.play && Casino.sound.play("win");
      toast(kaufLaden === "zoo" ? `${r.name ? `„${r.name}“` : r.label} wohnt jetzt bei dir.` : kaufLaden === "autohaus" ? `${r.label} gehört dir. Gute Fahrt!` : `${r.label} ist in deiner Hand.`);
      if (probe === id) probe = null;
      if (laden === kaufLaden) lade();
    });
  }

  function vormerken(id) {
    socket.emit("laden:vormerken", { id }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Das ging nicht."); return; }
      toast(`${r.label} ist vorgemerkt. Sobald diese Tierart geliefert wird, legen wir eins für dich zurück.`);
      if (laden === "zoo") lade();
    });
  }

  wurzel.addEventListener("click", (e) => {
    const tab = e.target.closest(".ld-tab");
    if (tab) { if (tab.dataset.laden !== laden) { laden = tab.dataset.laden; probe = null; lade(); } return; }
    const k = e.target.closest("[data-kauf]");
    if (k && !k.disabled) { kaufen(k.dataset.kauf); return; }
    const v = e.target.closest("[data-vormerken]");
    if (v && !v.disabled) { vormerken(v.dataset.vormerken); return; }
    const p = e.target.closest("[data-probe]");
    if (p) {
      probe = probe === p.dataset.probe ? null : p.dataset.probe;
      zeichne();
      // Die Probefahrt steht oben; wer weiter unten tippt, soll sie auch sehen.
      if (probe) $(".ld-probe", wurzel)?.scrollIntoView({ behavior: document.documentElement.classList.contains("reduce-motion") ? "auto" : "smooth", block: "center" });
    }
  });

  Casino.screens.register("laeden", { onEnter: () => { probe = null; lade(); } });
  // Der Kontostand ändert sich auch anderswo; ein offener Laden zeigt dann neu.
  socket.on("account:update", () => { if (Casino.screens.current() === "laeden" && !laedt) lade(); });
  if (Casino.screens.current() === "laeden") lade();
})();
