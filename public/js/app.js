"use strict";

/* Frontend: Grundgerüst
   Screens, Konto und Lobby. Die Spiele hängen sich an dieses Gerüst
   und an `socket`. */

// Verbindung für spätere Echtzeit-Spiele (jetzt nur aufgebaut)
const socket = io();

// Globaler Zustand
const state = {
  account: null, // { name, chips, createdAt, lastBonusAt, stats }
  token: null,   // signiertes Token aus /api/login, weist uns gegenüber dem Socket aus
  bonusCooldownMs: 20 * 60 * 60 * 1000, // nur Rückfall, den echten Wert schickt der Server beim Login
};
let appVersion = null;
let reloadRequired = false;

const istBesitzerUI = () => !!(state.account && state.account.name.toLowerCase() === "vincent");
const istModeratorUI = () => !!(state.account && state.account.rolle === "mod");
const hatVerwaltungsrechte = () => istBesitzerUI() || istModeratorUI();

function verwaltungUI() {
  const owner = istBesitzerUI();
  const darf = hatVerwaltungsrechte();
  const item = document.querySelector("#menu-admin");
  if (item) item.style.display = darf ? "" : "none";
  const label = document.querySelector("#menu-admin-label");
  const sub = document.querySelector("#menu-admin-sub");
  const titel = document.querySelector("#admin-title");
  if (label) label.textContent = owner ? "Admin" : "Moderation";
  if (sub) sub.textContent = owner ? "Verwaltung" : "Chat und Spieler schützen";
  if (titel) titel.textContent = owner ? "Admin" : "Moderation";
  document.querySelectorAll("[data-owner-only]").forEach((el) => {
    el.classList.toggle("hidden", !owner);
  });
  const dauerPermanent = document.querySelector('#an-dauer option[value="0"]');
  if (dauerPermanent) dauerPermanent.hidden = !owner;
  document.querySelectorAll("#an-dauer option").forEach((o) => {
    if (Number(o.value) > 1440) o.hidden = !owner;
  });
  if (!owner && document.querySelector("#an-dauer")?.value === "0") document.querySelector("#an-dauer").value = "60";
  if (!darf && currentScreen === "admin") showScreen("lobby", { history: "replace" });
}

// DOM-Helfer
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Screen-Manager
// Die Mechanik (Umschalten, Verlauf, Hooks) steckt in core/screens.js.
// Hier bleibt nur, was den ganzen Bildschirm betrifft: Sperren, Topbar,
// Praesenz und Chat.

let currentScreen = "login";
const lockedScreens = new Set();

/**
 * Gesperrte Screens aus dem Menü nehmen. Ein Eintrag, der beim Antippen nur
 * "ist gerade gesperrt" sagt, ist schlechter als gar kein Eintrag.
 */
function versteckeGesperrteMenueeintraege() {
  document.querySelectorAll("#menu-sheet [data-nav]").forEach((el) => {
    if (lockedScreens.has(el.dataset.nav)) el.style.display = "none";
  });
}

// Screens, die es nur mit Account gibt. Wer einen geteilten Link oeffnet,
// ohne eingeloggt zu sein, landet auf dem Login statt in einem leeren Spiel.
const publicScreens = new Set(["login"]);

window.Casino.screens.setGuard((name) => {
  if (lockedScreens.has(name)) {
    toast("Dieses Spiel ist gerade gesperrt und kommt bald zurück.");
    return false;
  }
  if (!state.account && !publicScreens.has(name)) return false;
  if (name === "admin" && !hatVerwaltungsrechte()) {
    toast("Dafür brauchst du Moderator-Rechte.");
    return false;
  }
  return true;
});

// Screens, deren Ladefunktion hier in app.js steht oder von der Namens-
// konvention abweicht. Alle uebrigen findet core/screens.js selbst ueber
// Casino._load<Name>.
window.Casino.screens.register("leaderboard", { onEnter: () => loadLeaderboard() });
window.Casino.screens.register("profile", { onEnter: () => renderProfile() });
window.Casino.screens.register("admin", {
  onEnter: () => { verwaltungUI(); loadAdminAccounts(); ladeAnsage(); anVorschau(); adminReiter(); },
  // Die Uhr der Event-Karten muss nicht weiterlaufen, wenn niemand hinsieht.
  onLeave: () => { if (typeof evUhr !== "undefined" && evUhr) { clearInterval(evUhr); evUhr = null; } },
});

/*
 * Reiter im Admin-Bildschirm.
 *
 * Er war ueber dreitausend Pixel lang, Dashboard, Ansage, saemtliche
 * Accounts, Chips, Sperren, IP-Bann, Events, Test-Tools, Backup, Stadt,
 * alles hintereinander. Wer ein Event starten wollte, scrollte an der
 * kompletten Accountliste vorbei. Auf dem iPad war das eine Reise.
 */
function adminReiter() {
  const leiste = document.querySelector("#ad-reiter");
  if (!leiste || leiste.dataset.fertig) return;
  leiste.dataset.fertig = "1";
  leiste.querySelectorAll(".ad-reiter-knopf").forEach((b) => {
    b.addEventListener("click", () => {
      const ziel = b.dataset.ad;
      leiste.querySelectorAll(".ad-reiter-knopf").forEach((x) => {
        const an = x.dataset.ad === ziel;
        x.classList.toggle("active", an);
        x.setAttribute("aria-selected", an ? "true" : "false");
      });
      document.querySelectorAll("[data-ad-tafel]").forEach((t) => {
        t.classList.toggle("hidden", t.dataset.adTafel !== ziel);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      // Die Karten holen ihren Zustand frisch, wenn man zu ihnen wechselt.
      if (ziel === "events") loadAdminDashboard();
      if (ziel === "ansage") ladeAnsage();
      if (ziel === "filter") wfLade();
      // Die Stadt hat 1292 Grundstuecke. Die baut niemand auf Verdacht auf.
      if (ziel === "werkzeug") { loadAdminLots(); ladeRegie(); ladeKosKatalog(); ladeSport(); }
      if (ziel === "spieler") ladeStrafen();
    });
  });
}
window.Casino.screens.register("settings", { onEnter: () => {
  renderThemePicker();
  if (window.Casino._loadPush) window.Casino._loadPush();
  if (window.Casino._loadResponsible) window.Casino._loadResponsible();
} });
window.Casino.screens.register("updates", { onEnter: () => renderUpdates() });
window.Casino.screens.register("calendar", { onEnter: () => loadCalendar() });
window.Casino.screens.register("lobby", {
  onEnter: () => {
    if (window.Casino._loadLobbies) window.Casino._loadLobbies();
    if (window.Casino._loadFeed) window.Casino._loadFeed();
    if (window.Casino._loadEventCalendar) window.Casino._loadEventCalendar();
    if (window.Casino._loadOnboarding) window.Casino._loadOnboarding();
  },
});
// Der Automat soll nicht im Hintergrund weiterdrehen, wenn man weggeht.
window.Casino.screens.register("slots", {
  onLeave: () => { if (window.Casino._slotsStopAuto) window.Casino._slotsStopAuto(); },
});

function showScreen(name, opts) {
  return window.Casino.screens.show(name, opts);
}

versteckeGesperrteMenueeintraege();

// Alles, was bei jedem Wechsel passiert, unabhaengig vom Screen.
document.addEventListener("casino:screen", (e) => {
  const name = e.detail.screen;
  currentScreen = name;
  /* Haken fuers Layout: manche Screens duerfen breiter werden als die
     Standardspalte, die Lobby zum Beispiel im Querformat auf dem iPad.

     Der Name ist mit Bedacht nicht data-screen. Fuenfundzwanzig Stellen in
     den Spielmodulen fragen mit
       document.querySelector('[data-screen="crash"]')
     ab, ob ihr Screen gerade offen ist. #app steht im DOM vor den Screens,
     haette also jedes Mal den Container zurueckgegeben, und zwar genau dann,
     wenn der betreffende Screen aktiv ist. Der Container traegt nie .active,
     also hielten sich saemtliche Spiele fuer geschlossen und hoerten auf zu
     zeichnen. Crash und die Rennbahn waren dadurch komplett tot. */
  $("#app").dataset.activeScreen = name;
  socket.emit("presence:screen", { screen: name });
  $("#topbar").classList.toggle("hidden", name === "login");
  if (window.Casino.chat) window.Casino.chat.update(name);
  window.scrollTo(0, 0);
});

/**
 * Hoehe der Topbar als CSS-Variable bereitstellen.
 *
 * Alles, was beim Scrollen stehen bleiben soll (Wettschein, spaeter mehr),
 * muss unter der Leiste kleben. Eine geratene Zahl geht schief, sobald sich
 * an der Leiste etwas aendert: auf schmalen Geraeten hat sie weniger
 * Polsterung, auf dem iPhone kommt der sichere Bereich oben dazu.
 */
(function () {
  const bar = $("#topbar");
  if (!bar) return;
  const messen = () => {
    // Auf dem Login ist die Leiste ausgeblendet und misst sich als 0. Diesen
    // Wert nicht uebernehmen, sonst klebt spaeter alles unter der Leiste.
    const h = bar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty("--topbar-h", h + "px");
  };
  messen();
  if (window.ResizeObserver) new ResizeObserver(messen).observe(bar);
  document.addEventListener("casino:screen", messen);
  window.addEventListener("orientationchange", () => setTimeout(messen, 200));
})();

// Menü (alles, was kein Spiel ist)
(function () {
  const sheet = $("#menu-sheet");
  const backdrop = $("#menu-backdrop");
  const btn = $("#menu-btn");
  if (!sheet || !backdrop || !btn) return;

  function auf(offen) {
    sheet.classList.toggle("hidden", !offen);
    backdrop.classList.toggle("hidden", !offen);
    btn.setAttribute("aria-expanded", String(offen));
    // Hintergrund festhalten, sonst scrollt beim Wischen im Menü die Seite
    // darunter mit. Auf dem iPad fällt das sofort unangenehm auf.
    document.body.classList.toggle("sheet-open", offen);
    if (offen) window.Casino.sound.play("select");
  }

  btn.addEventListener("click", () => auf(sheet.classList.contains("hidden")));
  // Damit andere Module das Menue schliessen koennen, ohne dessen Innenleben
  // zu kennen (der Rundgang zum Beispiel).
  window.Casino.menuSchliessen = () => auf(false);
  backdrop.addEventListener("click", () => auf(false));
  $("#menu-close")?.addEventListener("click", () => auf(false));
  // Jede Navigation schließt das Menü, egal von wo sie kam.
  document.addEventListener("casino:screen", () => auf(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.classList.contains("hidden")) auf(false);
  });
})();

// Alle Elemente mit data-nav="screen" navigieren dorthin
document.addEventListener("click", (e) => {
  const navEl = e.target.closest("[data-nav]");
  if (navEl) {
    if (navEl.classList.contains("locked")) e.preventDefault();
    showScreen(navEl.dataset.nav);
  }
});

// Toast-Hinweise
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function requireAppReload(newVersion) {
  if (reloadRequired) return;
  reloadRequired = true;
  if (window.Casino && window.Casino._slotsStopAuto) window.Casino._slotsStopAuto();
  let modal = $("#force-reload-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "force-reload-modal";
    modal.className = "update-modal force-reload-modal";
    modal.innerHTML = `
      <div class="update-card force-reload-card">
        <h2>Update verfügbar</h2>
        <p class="muted small" style="text-align:center">Du hast noch eine alte Version offen. Lad kurz neu, sonst passen Spiele, Bank und Stadt nicht mehr zusammen.</p>
        <button class="btn-primary" id="force-reload-btn" style="width:100%;margin-top:14px">Jetzt neu laden</button>
      </div>`;
    document.body.appendChild(modal);
    $("#force-reload-btn")?.addEventListener("click", () => reloadToLatest());
  }
  modal.classList.remove("hidden");
  modal.dataset.version = newVersion || "";
  setTimeout(() => reloadToLatest(), 15000);
}

function reloadToLatest() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString(36));
  window.location.replace(url.toString());
}

function handleAppVersion(version) {
  if (!version) return;
  if (!appVersion) {
    appVersion = version;
    return;
  }
  if (version !== appVersion) requireAppReload(version);
}

async function checkAppVersion() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    handleAppVersion(data.version);
  } catch {}
}

function renderAnnouncement(announcement) {
  const strip = $("#announcement-strip");
  const textEl = $("#announcement-text");
  const metaEl = $("#announcement-meta");
  if (!strip || !textEl || !metaEl) return;
  if (!announcement || !announcement.text) {
    strip.classList.add("hidden");
    textEl.textContent = "";
    metaEl.textContent = "";
    return;
  }
  textEl.textContent = announcement.text;
  /* Der Ton faerbt die Zeile: eine Wartungsansage soll anders aussehen als
     eine Einladung zum Turnier. Unbekannte Werte fallen auf "info" zurueck,
     damit eine alte gespeicherte Ansage keine fremde Klasse ins Dokument
     schreibt. */
  const art = ["info", "warnung", "fest"].includes(announcement.art) ? announcement.art : "info";
  strip.dataset.art = art;
  const symEl = strip.querySelector(".announcement-icon");
  if (symEl) symEl.innerHTML = window.Casino.icons.ui({ info: "ansage", warnung: "alarm", fest: "geschenk" }[art]);
  const at = Number(announcement.at) || 0;
  metaEl.textContent = at
    ? `Ansage · ${new Date(at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    : "Ansage";
  strip.classList.remove("hidden");
}

// Gemeinsame Schnittstelle für die Spielmodule (poker.js, slots.js usw.).
// Steht so weit oben, weil Navigation und Fenster schon Screens wechseln
// können, bevor die Datei bis zum Startaufruf unten durchgelaufen ist.
window.Casino = Object.assign(window.Casino || {}, {
  socket,
  showScreen,
  toast,
  getAccount: () => state.account,
  escapeHtml,
  openPlayerProfile,
  setChips(n) {
    if (!state.account) return;
    state.account.chips = n;
    renderTopbar();
    if (currentScreen === "profile") renderProfile();
  },
  adjustChips(delta) {
    if (!state.account) return;
    state.account.chips = Math.max(0, state.account.chips + delta);
    renderTopbar();
  },
  applyAccount(account) {
    if (!account) return;
    state.account = { ...state.account, ...account };
    wendeKartenAn(state.account);
    verwaltungUI();
    renderTopbar();
    if (currentScreen === "profile") renderProfile();
  },
  /**
   * Einstellung am Account speichern (Theme, Ton, Favoriten …).
   * Gesammelt und verzögert geschickt: am Theme-Umschalter hängt eine
   * Vorschau, und jeder Tipp darauf soll nicht sofort ein Socket-Event
   * auslösen.
   */
  savePrefs(patch) {
    if (!patch || !state.account) return;
    pendingPrefs = { ...pendingPrefs, ...patch };
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      const send = pendingPrefs;
      pendingPrefs = {};
      socket.emit("prefs:set", send, (res) => {
        if (res && res.ok && state.account) state.account.prefs = res.prefs;
      });
    }, 400);
  },
});

let pendingPrefs = {};
let prefsTimer = null;

/**
 * Einstellungen vom Account übernehmen. Der Account gewinnt gegen den
 * localStorage, weil er geräteübergreifend gilt: wer auf dem Handy
 * Mitternacht wählt, soll es auf dem iPad auch sehen.
 */
/*
 * Der eigene Kartenrücken haengt am Dokument, nicht an jeder einzelnen Karte:
 * Poker, Blackjack, Solitär und Memory zeichnen ihre Rueckseite jeweils selbst,
 * und alle vier lesen die Farben von `html[data-karte]`. Nur der eigene
 * Bildschirm, siehe game/cosmetics.js.
 */
const KARTEN_IDS = new Set(["auk_schwarzeshaus", "auk_spiegel"]);
function wendeKartenAn(acc) {
  if (acc && acc.karte && KARTEN_IDS.has(acc.karte)) document.documentElement.dataset.karte = acc.karte;
  else delete document.documentElement.dataset.karte;
}

function applyPrefs(prefs) {
  if (!prefs) return;
  if (prefs.theme && window.Casino.theme) window.Casino.theme.adoptFromAccount(prefs.theme);

  if (typeof prefs.volume === "number") {
    window.Casino.sound.setVolume(prefs.volume);
    const slider = $("#set-volume");
    if (slider) slider.value = String(Math.round(prefs.volume * 100));
  }
  if (typeof prefs.sound === "boolean") {
    window.Casino.sound.setEnabled(prefs.sound);
    const box = $("#set-sound");
    if (box) box.checked = prefs.sound;
  }
  if (typeof prefs.reduceMotion === "boolean") {
    document.documentElement.classList.toggle("reduce-motion", prefs.reduceMotion);
    const box = $("#set-motion");
    if (box) box.checked = prefs.reduceMotion;
  }
  renderThemePicker();
}

// Account / Anzeige
// Das Token liegt im localStorage und nicht nur im Speicher: iPadOS wirft
// Safari-Tabs im Hintergrund schnell weg, und vorher landete man danach
// jedes Mal wieder auf der Anmeldung.
const TOKEN_KEY = "casino_token";

function setAccount(acc, token) {
  state.account = acc;
  if (token) state.token = token;
  try {
    localStorage.setItem("casino_name", acc.name);
    if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
  } catch {}
  if (state.token) socket.emit("auth", { token: state.token });
  applyPrefs(acc.prefs);
  wendeKartenAn(acc);
  renderTopbar();
  requestPresence();
  verwaltungUI();
  maybeShowUpdate();
  renderUpdateBadge();
}

// Update-Historie: Comeback-Fenster und Updates-Tab
const SEEN_KEY = "casino_seen_update";
// Wie viele Updates das Fenster hoechstens auf einmal zeigt. Wer ein halbes
// Jahr weg war, soll nicht durch zwoelf Bloecke scrollen muessen; der Rest
// steht im Updates-Tab.
const MAX_IM_FENSTER = 4;

/**
 * Ab welchem Stand gilt etwas als neu?
 *
 * Drei Quellen, in dieser Reihenfolge:
 *   1. der Account. Ueberlebt Safaris Aufraeumen und gilt geraeteuebergreifend.
 *   2. der localStorage. Fuer alles, was noch vor dieser Aenderung entstand.
 *   3. der Tag der Kontoeroeffnung.
 *
 * Der dritte Fall ist der wichtige: Safari loescht bei Seiten, die man laenger
 * nicht besucht hat, nach sieben Tagen allen lokalen Speicher. Wer zwei Monate
 * Pause macht, kommt also ohne Merkwert zurueck. Vorher galt das als "neuer
 * Spieler" und das Comeback-Fenster wurde stillschweigend uebersprungen,
 * genau bei den Leuten, fuer die es gedacht ist.
 */
function gesehenerStand() {
  const acc = state.account;
  if (acc && acc.prefs && acc.prefs.seenUpdate) return acc.prefs.seenUpdate;
  try {
    const lokal = localStorage.getItem(SEEN_KEY);
    if (lokal) return lokal;
  } catch {}
  if (acc && acc.createdAt) {
    // Wer heute erst angelegt wurde, hat nichts verpasst: sein Eroeffnungstag
    // ist dann >= dem neuesten Eintrag und es bleibt alles stumm.
    return new Date(acc.createdAt).toISOString().slice(0, 10);
  }
  return null;
}

function merkeStand(id) {
  try { localStorage.setItem(SEEN_KEY, id); } catch {}
  const acc = state.account;
  if (!acc) return;
  acc.prefs = { ...(acc.prefs || {}), seenUpdate: id };
  window.Casino.savePrefs({ seenUpdate: id });
}

/** Ein einzelner Punkt eines Updates. */
function punktHTML(item) {
  /* `icon` ist eine Kennung aus core/icons.js und wird gezeichnet. Steht dort
     etwas anderes (ein Emoji zum Beispiel), wird es einfach als Text gezeigt. */
  const gezeichnet = item.icon && window.Casino.icons.hatUi(item.icon)
    ? window.Casino.icons.ui(item.icon)
    : null;
  return `<div class="update-item"><span${gezeichnet ? ' class="ui-punkt"' : ""}>` +
    `${gezeichnet || escapeHtml(item.icon || "")}</span><div>` +
    `<b>${escapeHtml(item.titel)}</b><small>${escapeHtml(item.text)}</small>` +
    `</div></div>`;
}

/**
 * Fenster beim Reinkommen. Zeigt alles, was seit dem letzten Besuch dazukam,
 * nicht nur das neueste Update. Wer zwei Monate weg war, soll nicht raten
 * muessen, was sich geaendert hat.
 */
function maybeShowUpdate() {
  const cl = window.Casino.changelog;
  if (!cl) return;
  const acc = state.account;
  /* Neue Spieler brauchen den aktuellen Zustand, keinen Comeback-Roman aus
     der Zeit vor ihrer Anmeldung. Wegen bewusst hochgezaehlter Sortier-IDs
     koennen alte Eintraege formal in der Zukunft liegen; deshalb hier die
     eindeutige Alterspruefung und der neueste Stand als Ausgangspunkt. */
  if (acc && Date.now() - Number(acc.createdAt || 0) < 10 * 60 * 1000
    && Number(acc.stats && acc.stats.gamesPlayed) === 0
    && !(acc.prefs && acc.prefs.seenUpdate)) {
    merkeStand(cl.neueste);
    return;
  }
  const gesehen = gesehenerStand();
  if (!gesehen) return; // ohne Account gibt es nichts zu vergleichen

  const alleNeu = cl.neuSeit(gesehen);
  if (!alleNeu.length) return;
  /*
   * Ein Eintrag mit `soloImFenster` erzaehlt die ganze Geschichte selbst
   * (der Sammel-Eintrag zur Wiedereroeffnung). Dann steht nur er im Fenster,
   * sonst haette man ihn plus vier Einzeleintraege, die dasselbe nochmal
   * sagen. Die uebrigen bleiben als Fussnote und im Updates-Tab.
   */
  const sammel = alleNeu.find((r) => r.soloImFenster);
  const neu = sammel ? [sammel] : alleNeu.slice(0, MAX_IM_FENSTER);
  const weitere = alleNeu.length - neu.length;

  const modal = $("#update-modal");
  if (!modal) return;

  // "Comeback" nur, wenn wirklich etwas verpasst wurde: mehr als ein Update
  // oder eines, das als grosses markiert ist. Bei einer kleinen Aenderung
  // waere die Begruessung uebertrieben.
  const comeback = alleNeu.length > 1 || alleNeu.some((r) => r.gross);
  $("#update-emoji").innerHTML = window.Casino.icons.ui(comeback ? "rundgang" : "geschenk");
  $("#update-title").textContent = comeback ? "Comeback!" : "Neu im Casino";
  // Beim Sammel-Eintrag waere "18 Updates" verwirrend: sichtbar ist ja nur
  // einer. Dort zaehlt die Zeit, nicht die Zahl der Eintraege.
  $("#update-sub").textContent = sammel
    ? (sammel.intro || "Das ist passiert, seit du zuletzt hier warst:")
    : comeback
      ? `Das ist passiert, seit du zuletzt hier warst (${alleNeu.length} ${alleNeu.length === 1 ? "Update" : "Updates"}):`
      : "Frisch dabei im Fake Casino:";

  // Bei mehreren Updates die Ueberschrift je Update mit ausgeben, sonst
  // steht alles als eine lange Liste da und man sieht nicht, was zusammengehoert.
  $("#update-list").innerHTML = neu.map((r) => {
    const kopf = neu.length > 1
      ? `<div class="update-release-head"><b>${escapeHtml(r.titel)}</b><small>${escapeHtml(r.datum)}</small></div>`
      : "";
    return kopf + r.items.map(punktHTML).join("");
  }).join("") + (weitere
    ? (sammel
        ? `<p class="update-more">Jede einzelne Änderung steht im Menü unter <b>Updates</b>, dort sind es noch ${weitere} Einträge mehr.</p>`
        : `<p class="update-more">…und ${weitere} ${weitere === 1 ? "älteres Update" : "ältere Updates"}. Alles davon steht im Menü unter <b>Updates</b>.</p>`)
    : "");

  modal.classList.remove("hidden");
}

/*
 * Das Fenster schliessen.
 *
 * Es liess sich vorher ausschliesslich ueber seinen einen Knopf schliessen:
 * kein Escape, kein Tipp neben die Karte. Beides erwartet man von einem
 * Fenster, das sich beim Reinkommen ungefragt vor alles legt, und beides
 * kann der Dialog-Baustein laengst, nur dieses Fenster ist aelter.
 *
 * @param {boolean} mitRundgang Ob danach der Rundgang angeboten wird. Nur
 *   beim ausdruecklichen "Zeig mir, was neu ist"; wer wegtippt, will das
 *   Gegenteil.
 */
function updateFensterSchliessen(mitRundgang) {
  const modal = $("#update-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (window.Casino.changelog) merkeStand(window.Casino.changelog.neueste);
  renderUpdateBadge();
  // Das Fenster sagt, was neu ist. Der Rundgang zeigt, WO es ist. Direkt
  // danach ist der einzige Moment, in dem beides zusammengehoert.
  if (mitRundgang && window.Casino.tour) window.Casino.tour.vielleicht();
}

$("#update-close")?.addEventListener("click", () => updateFensterSchliessen(true));
$("#update-all")?.addEventListener("click", () => updateFensterSchliessen(false));
$("#update-modal")?.addEventListener("click", (e) => {
  // Nur der Rand, nicht die Karte darin.
  if (e.target.id === "update-modal") updateFensterSchliessen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const modal = $("#update-modal");
  if (modal && !modal.classList.contains("hidden")) {
    e.preventDefault();
    updateFensterSchliessen(false);
  }
});

/** Der Updates-Tab: die ganze Historie, das neueste aufgeklappt. */
function renderUpdates() {
  const host = $("#updates-list");
  const cl = window.Casino.changelog;
  if (!host || !cl) return;
  const gesehen = gesehenerStand();

  host.innerHTML = cl.releases.map((r, i) => {
    const offen = i === 0;
    const istNeu = gesehen && r.id > gesehen;
    return `
      <article class="cl-entry${offen ? " open" : ""}">
        <button class="cl-head" type="button" data-cl="${r.id}" aria-expanded="${offen}">
          <span class="cl-date">${escapeHtml(r.datum)}</span>
          <span class="cl-title">${escapeHtml(r.titel)}</span>
          ${r.gross ? '<span class="cl-tag">Großes Update</span>' : ""}
          ${istNeu ? '<span class="cl-tag cl-tag-new">Neu</span>' : ""}
          <span class="cl-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="cl-body">
          ${r.intro ? `<p class="cl-intro">${escapeHtml(r.intro)}</p>` : ""}
          ${r.items.map(punktHTML).join("")}
        </div>
      </article>`;
  }).join("");

  // Ansehen zaehlt als gelesen.
  merkeStand(cl.neueste);
  renderUpdateBadge();
}

$("#updates-list")?.addEventListener("click", (e) => {
  const head = e.target.closest("[data-cl]");
  if (!head) return;
  const entry = head.closest(".cl-entry");
  const offen = entry.classList.toggle("open");
  head.setAttribute("aria-expanded", String(offen));
  window.Casino.sound.play("tick");
});

/** Punkt am Menue-Knopf, solange es Ungelesenes gibt. */
/**
 * Zaehler oben rechts fuer alles, was abzuholen ist.
 *
 * Eine freigeschaltete Season-Stufe lag vorher still im Menue und wurde
 * schlicht vergessen, man sieht sie nur, wenn man den Bildschirm ohnehin
 * aufmacht. Die Marke am Menue-Knopf sagt, dass da etwas liegt, und die
 * Menue-Eintraege sagen, was.
 */
/**
 * Dieselbe Zahl noch einmal an dem Eintrag, aus dem sie kommt.
 *
 * Die Marke am Menue-Knopf sagt nur dass etwas wartet. Wer dann aufmacht,
 * stand vor zwoelf gleich aussehenden Zeilen und musste raten, welche
 * gemeint ist.
 */
function setzeSheetMarke(sel, anzahl) {
  const el = $(sel);
  if (!el) return;
  let marke = el.querySelector(".sheet-count");
  if (!anzahl) { if (marke) marke.remove(); return; }
  if (!marke) {
    marke = document.createElement("i");
    marke.className = "sheet-count";
    el.appendChild(marke);
  }
  marke.textContent = String(anzahl);
}

function renderAbholBadge() {
  const btn = $("#menu-btn");
  if (!btn || !state.account) return;

  /* Eine Runde fuer alles. Vorher fragte der Client season:state und
     comeback:state getrennt und zaehlte deren Antworten selbst zusammen. Mit
     dem Kalender und dem Rad waeren das vier Runden geworden, von denen jede
     die Zahl am Knopf einmal umschreibt. Der Server rechnet das jetzt in
     game/bericht.js. */
  socket.emit("bericht:marken", (m) => {
    if (!m || !m.ok) return;
    const gesamt = m.gesamt || 0;
    let marke = btn.querySelector(".menu-count");
    if (!gesamt) { if (marke) marke.remove(); }
    else {
      if (!marke) {
        marke = document.createElement("span");
        marke.className = "menu-count";
        btn.appendChild(marke);
      }
      marke.textContent = String(gesamt);
      marke.title = `${gesamt} ${gesamt === 1 ? "Belohnung wartet" : "Belohnungen warten"}`;
    }

    // Und dieselbe Zahl an dem Eintrag, aus dem sie kommt.
    setzeSheetMarke('[data-nav="season"]', m.season);
    setzeSheetMarke('[data-nav="calendar"]', m.kalender);
    setzeSheetMarke('[data-nav="wheel"]', m.rad);
    setzeSheetMarke("#menu-geschenk", m.geschenk);
    /* Duelle: jede Marke an dem Eintrag, unter dem das Duell auch liegt.
       Eine Zahl am Menue, hinter der man das Gemeinte nicht findet, waere
       schlimmer als keine. */
    const orte = m.duellOrte || {};
    setzeSheetMarke('[data-nav="sudoku"]', orte.sudoku || 0);
    setzeSheetMarke('[data-nav="kiste"]', m.kiste || 0);

    /* Dieselbe Zahl auch auf die Lobby-Kachel. Quelle ist diese eine
       Antwort, damit Kachel und Menue nie Verschiedenes behaupten. */
    /* Die Kachel-Marken kommen fertig vom Server: welcher Bildschirm etwas
       liegen hat, entscheidet bericht.marken und nicht der Client. */
    if (window.Casino._lobbyMarken) window.Casino._lobbyMarken(m.kacheln || {});

    const sub = $("#menu-season-sub");
    if (sub) sub.textContent = m.season ? `${m.season} ${m.season === 1 ? "Stufe wartet" : "Stufen warten"}` : "Fortschritt und Belohnungen";
    const kal = $("#menu-calendar-sub");
    if (kal) kal.textContent = m.kalender ? "Tagesbonus wartet · Wochenend-Pokal" : "Wochenend-Pokal & Tagesbonus";
    const rad = $("#menu-wheel-sub");
    if (rad) rad.textContent = m.rad ? "Gratis-Dreh ist frei" : "Heute schon gedreht";
    const eintrag = $("#menu-geschenk");
    if (eintrag) eintrag.hidden = !m.geschenk;

    /* Die Auktion bekommt eine eigene, rote Marke: sie ist nichts zum
       Abholen, sondern etwas, das ohne dich zu Ende geht. Ein neues Los
       oder ein ueberbotenes Gebot: beides verschwindet, sobald man
       hinsieht. */
    const auk = m.auktion || {};
    btn.classList.toggle("hat-auktion", !!auk.an);
    const auknav = $('[data-nav="auktion"]');
    if (auknav) {
      auknav.classList.toggle("hat-auktion", !!auk.an);
      const sub = $("#menu-auktion-sub");
      if (sub) {
        sub.textContent = auk.ueberboten ? "Du wurdest überboten"
          : auk.neu ? "Neues Los unter dem Hammer"
          : "Was es nur einmal gibt";
      }
    }
  });
}
window.Casino.renderAbholBadge = renderAbholBadge;

function renderUpdateBadge() {
  const cl = window.Casino.changelog;
  const btn = $("#menu-btn");
  const sub = $("#menu-updates-sub");
  if (!cl || !btn) return;
  const neu = cl.neuSeit(gesehenerStand());
  btn.classList.toggle("has-news", neu.length > 0);
  // Auch der Punkt am Knopf soll im Menue eine Adresse haben.
  setzeSheetMarke('[data-nav="updates"]', neu.length);
  if (sub) {
    sub.textContent = neu.length
      ? `${neu.length} ${neu.length === 1 ? "neues Update" : "neue Updates"}`
      : "Was sich zuletzt geändert hat";
  }
}

const ONBOARDING_VERSION = "2026-09-22-starter-pass";
function maybeShowOnboarding() {
  let seen = null;
  try { seen = localStorage.getItem("casino_seen_onboarding"); } catch {}
  if (seen === ONBOARDING_VERSION) return;
  const m = $("#onboarding-modal");
  if (m) m.classList.remove("hidden");
}
$("#onboarding-start")?.addEventListener("click", () => {
  $("#onboarding-modal")?.classList.add("hidden");
  try { localStorage.setItem("casino_seen_onboarding", ONBOARDING_VERSION); } catch {}
  showScreen("lobby");
  setTimeout(() => $("#starter-pass")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
});

// Nach einem Verbindungsabbruch neu anmelden: für den Server ist ein Reconnect
// ein frischer Socket ohne Identität, das Token muss also noch mal hin.
let verbindungWeg = false;
socket.on("disconnect", () => {
  verbindungWeg = true;
  toast("Verbindung weg. Solange tut kein Knopf etwas, ich versuche es weiter.");
});

socket.on("connect", () => {
  if (verbindungWeg) { verbindungWeg = false; toast("Wieder verbunden."); }
  if (state.token) socket.emit("auth", { token: state.token });
  socket.emit("presence:screen", { screen: currentScreen });
  socket.emit("app:version", (res) => {
    if (res && res.ok) handleAppVersion(res.version);
  });
  socket.emit("announcement:get", (res) => {
    if (res && res.ok) renderAnnouncement(res.announcement);
  });
});

socket.on("app:version", ({ version } = {}) => handleAppVersion(version));
checkAppVersion();
setInterval(checkAppVersion, 30000);

/* Der Vorlauf laeuft im Server, nicht im Browser: wenn er ablaeuft oder
   jemand anders absagt, muss der Admin-Bildschirm das mitbekommen. */
socket.on("admin:planUpdate", () => {
  if (window.Casino.screens.current() === "admin") loadAdminDashboard();
});

socket.on("announcement:state", ({ announcement, toast: shouldToast } = {}) => {
  renderAnnouncement(announcement);
  if (shouldToast && announcement && announcement.text) toast(announcement.text);
});

// Der Server kann einen neuen Bankstand schicken (z. B. nach Buy-in oder Auszahlung beim Poker).
/* Der eigene Name hat sich geaendert (selbst gemacht oder vom Admin).
   Der Merker im Browser muss mit, sonst steht beim naechsten Start der alte
   Name im Anmeldefeld. Und das erneute `auth` laesst den Server die
   Anwesenheitsliste bei allen neu bauen. */
socket.on("konto:umbenannt", ({ alt, neu, account } = {}) => {
  if (account) state.account = { ...state.account, ...account };
  try { localStorage.setItem("casino_name", neu); } catch {}
  const tok = (() => { try { return localStorage.getItem("casino_token"); } catch { return null; } })();
  if (tok) socket.emit("auth", { token: tok });
  renderTopbar();
  if (window.Casino.screens.current() === "profile") renderProfile();
  if (alt) toast(`Aus ${alt} wird ${neu}.`);
});

/* Jemand hat sich umbenannt: Listen mit Namen holen sich ihren Stand neu,
   sobald man sie das naechste Mal aufmacht. Offen ist hoechstens eine. */
socket.on("presence:auffrischen", () => {
  const jetzt = window.Casino.screens.current();
  if (jetzt === "leaderboard") loadLeaderboard();
  if (jetzt === "admin") loadAdminAccounts();
});

socket.on("account:update", ({ account }) => {
  if (!account) return;
  state.account = { ...state.account, ...account };
  verwaltungUI();
  renderTopbar();
  if (currentScreen === "profile") renderProfile();
});

// Nur bekannte Schilder durchlassen: ein alter Wert aus einer Nachricht darf
// keine fremde Klasse ins Dokument schreiben.
const SCHILDER = new Set(["messing", "jade", "rubin", "karo", "neon", "puls", "prisma", "auk_tresor", "sml_wesergold", "gezeiten", "gala_samt"]);
const schildKlasse = (p) => (p && SCHILDER.has(p.schild) ? " sch-" + p.schild : "");

function renderOnlinePlayers(players = []) {
  const countEl = $("#online-count");
  const listEl = $("#online-list");
  if (!countEl || !listEl) return;
  countEl.textContent = `${players.length} online`;
  if (!players.length) {
    listEl.innerHTML = '<span class="muted small">Niemand online</span>';
    return;
  }
  listEl.innerHTML = players.map((p) => {
    const level = p.level ? `<small class="rang-mini" style="color:${p.level.color || ""}">${window.Casino.icons.rangZeichen(p.level)}${p.level.level}</small>` : "";
    const clan = p.clan ? `<small class="online-clan">[${escapeHtml(p.clan)}]</small>` : "";
    const status = p.status && p.status.label ? escapeHtml(p.status.label) : "online";
    return `<button class="online-player${schildKlasse(p)}" type="button" data-player-profile="${escapeHtml(p.name || "")}" title="${escapeHtml(p.name || "?")} ansehen">` +
      window.Casino.spieler.avatar(p) + window.Casino.spieler.name(p, { tag: "b" }) + window.Casino.spieler.prunk(p) + window.Casino.spieler.garnitur(p) +
      `${clan}${level}<em>${p.title ? escapeHtml(p.title) : status}</em></button>`;
  }).join("");
}

/**
 * "Zuletzt hier" unter der Online-Liste.
 *
 * Ein leeres Casino sagte bisher nur "Niemand online" und man wusste nicht, ob
 * die anderen vor zehn Minuten oder vor zwei Wochen da waren. Mit der Zeile
 * kann man entscheiden, ob es sich lohnt zu rufen oder kurz zu warten.
 */
function renderZuletztDa(liste = []) {
  const el = $("#online-last");
  if (!el) return;
  if (!liste.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const wann = (ts) => {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 60) return `vor ${Math.max(1, min)} Min`;
    const std = Math.floor(min / 60);
    if (std < 24) return `vor ${std} Std`;
    const tage = Math.floor(std / 24);
    return tage === 1 ? "gestern" : `vor ${tage} Tagen`;
  };
  el.classList.remove("hidden");
  el.innerHTML = '<span class="muted small">Zuletzt hier:</span>' + liste.map((p) =>
    `<button class="online-player last-player${schildKlasse(p)}" type="button" data-player-profile="${escapeHtml(p.name || "")}">` +
      window.Casino.spieler.avatar(p) + window.Casino.spieler.name(p, { tag: "b" }) + window.Casino.spieler.prunk(p) + window.Casino.spieler.garnitur(p) +
      `<em>${wann(p.lastSeen)}</em></button>`).join("");
}

$("#online-last")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-player-profile]");
  if (btn) openPlayerProfile(btn.dataset.playerProfile);
});

$("#online-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-player-profile]");
  if (!btn) return;
  openPlayerProfile(btn.dataset.playerProfile);
});

function requestPresence() {
  socket.emit("presence:list", (res) => {
    if (!res || !res.ok) return;
    renderOnlinePlayers(res.online || []);
    renderZuletztDa(res.zuletzt || []);
    if (window.Casino._lobbyPresence) window.Casino._lobbyPresence(res.online || []);
  });
}

socket.on("presence:update", ({ online } = {}) => {
  renderOnlinePlayers(online || []);
  if (window.Casino._lobbyPresence) window.Casino._lobbyPresence(online || []);
});

/* Kommt vom Server (/api/config). Fest getippt lief er beim Anheben der
   Schwelle auseinander: der Knopf waere erst unter 50 Chips erschienen,
   obwohl die Hilfe schon unter 2.000 zusteht. */
let RESCUE_THRESHOLD = 2000;

// Aktive Produkt-Boni in der Kopfzeile.
/* Die vier laufen dauerhaft oben in der Kopfzeile mit, direkt neben dem
   gezeichneten Guthaben, vier bunte Emoji fielen dort am meisten auf. */
const BUFF_META = {
  fastSpins:  { icon: "blitz",  label: "2× Spins" },
  clickBoost: { icon: "vor",    label: "×5 Arbeit" },
  winBoost:   { icon: "stern-voll", label: "+Gewinn" },
  vip:        { icon: "season", label: "VIP" },
};
function renderBuffs() {
  const el = $("#buff-strip");
  if (!el) return;
  const buffs = (state.account && state.account.buffs) || {};
  const now = Date.now();
  const items = Object.entries(buffs)
    .filter(([, b]) => b.until > now)
    .map(([type, b]) => {
      const m = BUFF_META[type] || { icon: "stern-voll", label: type };
      const mins = Math.ceil((b.until - now) / 60000);
      const lbl = type === "winBoost" ? `+${Math.round((b.mult - 1) * 100)}%` : m.label;
      /* Die Beschriftung steht daneben, nicht im title: auf dem iPad gibt es
         keinen Hover, dort war "2× Spins" bisher nicht zu erfahren. */
      return `<span class="buff-chip">${window.Casino.icons.ui(m.icon)}${escapeHtml(lbl)} <small>${mins}m</small></span>`;
    });
  el.innerHTML = items.join("");
}
setInterval(renderBuffs, 5000); // Countdowns aktuell halten

/**
 * Namensstil auf ein vorhandenes Element legen.
 *
 * In Listen baut Casino.spieler.name() das HTML. Topbar und Profil haben ihr
 * Element aber fest im Dokument, deshalb werden hier nur die Klassen
 * ausgetauscht statt alles neu zu schreiben.
 */
const NAMENS_KLASSEN = ["nm-sonne", "nm-eis", "nm-gift", "nm-beere", "nm-puls", "nm-schimmer",
  "nm-neon", "nm-regenbogen", "nm-feuer", "nm-glitch", "nm-vanta", "nm-splitter", "nm-krone", "nm-s2_bernstein", "nm-s2_phoenix"];
const RAHMEN_KLASSEN = ["fr-silber", "fr-gold", "fr-neon", "fr-rotierend", "fr-flamme", "fr-sterne", "fr-s2_wolf"];

function setzeNamensStil(el, acc) {
  if (!el) return;
  el.textContent = acc.name;
  el.dataset.name = acc.name;   // fuer die versetzten Kopien in Glitch/Splitter
  el.classList.remove(...NAMENS_KLASSEN);
  const stil = acc.nameStyle && NAMENS_KLASSEN.includes("nm-" + acc.nameStyle) ? "nm-" + acc.nameStyle : null;
  if (stil) { el.classList.add(stil); el.style.color = ""; }
  else el.style.color = acc.nameColor || "";
}

function setzeRahmen(el, acc) {
  if (!el) return;
  /*
   * Bewusst nicht die Klasse pl-ava: die bringt eine eigene Groesse mit
   * (1,9 em), und dieser Kasten hat schon eine. Vorher wurde das Bild im
   * eigenen Profil dadurch von 68 auf rund 79 Pixel aufgeblasen, waehrend es
   * ueberall sonst 68 blieb. `hat-rahmen` steuert nur den Rand bei.
   */
  el.classList.remove(...RAHMEN_KLASSEN, "hat-rahmen", "pl-ava");
  if (!acc.frame) return;
  const kl = "fr-" + acc.frame;
  if (!RAHMEN_KLASSEN.includes(kl)) return;
  el.classList.add("hat-rahmen", kl);
}

function renderTopbar() {
  const acc = state.account;
  if (!acc) return;
  /* Auf schmalen Geraeten wird der Betrag gekuerzt: "1,7 Mio" statt
     "1.700.000". Fuenf Dinge nebeneinander (Marke, Bonus, Guthaben,
     Spieler, Menue) passen auf ein iPad, auf ein Telefon nicht mehr, sobald
     das Guthaben siebenstellig wird. Das groesste Konto im Haus liegt bei
     1,7 Millionen, das passiert also. In der Lobby steht der volle Betrag
     ohnehin gross unter "Dein Guthaben". */
  const eng = window.matchMedia("(max-width: 430px)").matches;
  const c = acc.chips;
  $("#balance-amount").textContent = eng && c >= 1000000
    ? (c / 1000000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " Mio"
    : eng && c >= 100000
      ? Math.round(c / 1000).toLocaleString("de-DE") + "k"
      : c.toLocaleString("de-DE");
  // Stil statt fester Farbe: die Klasse setzt den Verlauf, deshalb wird die
  // Farbe zurueckgesetzt, sonst kaempfen beide gegeneinander.
  setzeNamensStil($("#player-name"), acc);
  if (acc.avatar) $("#avatar").textContent = acc.avatar;
  setzeRahmen($("#avatar"), acc);
  const lc = $("#level-chip");
  if (lc && acc.level) {
    lc.style.display = "";
    lc.innerHTML = `${window.Casino.icons.rangZeichen(acc.level)}<span>${acc.level.level}</span>`;
    lc.style.color = acc.level.color;
    lc.title = `Level ${acc.level.level} · ${acc.level.title}`;
  }
  renderBuffs();
  // Pleite-Schutz: den Hilfe-Knopf nur zeigen, wenn fast nichts mehr da ist.
  const rescueBtn = $("#rescue-btn");
  if (rescueBtn) rescueBtn.style.display = acc.chips < RESCUE_THRESHOLD ? "" : "none";
  refreshBonusButton();
}

function refreshBonusButton() {
  const acc = state.account;
  if (!acc) return;
  updateBonusUI();
}

let achAlleZeigen = false;

function renderProfile() {
  const acc = state.account;
  if (!acc) return;
  setzeNamensStil($("#profile-name"), acc);
  if (acc.avatar) $("#profile-big").textContent = acc.avatar;
  setzeRahmen($("#profile-big"), acc);
  const titelEl = $("#profile-title");
  if (titelEl) { titelEl.textContent = acc.title || ""; titelEl.classList.toggle("hidden", !acc.title); }
  const karte = $("#profile-card");
  if (karte) {
    if (acc.banner) karte.dataset.banner = acc.banner;
    else delete karte.dataset.banner;
  }

  const renderLevel = (l) => {
    const lb = $("#profile-level");
    if (!lb || !l) return;
    const pct = l.xpForNext ? Math.min(100, Math.round((100 * l.xpInLevel) / l.xpForNext)) : 100;
    lb.innerHTML =
      `<div class="level-head"><b style="color:${l.color}">${l.emoji} Level ${l.level}</b><span class="muted small">${escapeHtml(l.title)} · ${l.xpInLevel}/${l.xpForNext} XP</span></div>` +
      `<div class="level-bar"><div class="level-fill" style="width:${pct}%;background:${l.color}"></div></div>`;
  };
  renderLevel(acc.level);

  /** Eine Kachel im Zahlenraster. */
  const kachel = (label, wert, extra = "") =>
    `<div class="pf-stat${extra ? " " + extra : ""}"><span>${label}</span><b>${wert}</b></div>`;

  const chips = acc.chips || 0;
  const stats = acc.stats || {};
  const gespielt = stats.gamesPlayed || 0;
  const groesster = stats.biggestWin || 0;
  $("#profile-stats").innerHTML =
    kachel("Guthaben", chips.toLocaleString("de-DE") + "<i class=mk></i>") +
    kachel("Netto-Vermögen", (acc.netWorth ?? chips).toLocaleString("de-DE") + "<i class=mk></i>") +
    kachel("Gespielte Runden", gespielt.toLocaleString("de-DE")) +
    kachel("Größter Gewinn", groesster.toLocaleString("de-DE") + "<i class=mk></i>") +
    kachel("Mitglied seit", acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "-");

  /* Der Rest (Stadt-Imperium, Clan, Achievements) kommt vom Server. Vorher
     wurde derselbe Aufruf nur benutzt, um das Level nachzuladen, die Daten
     zum Imperium lagen ungenutzt in der Antwort. */
  fetch("/api/account/" + encodeURIComponent(acc.name))
    .then((r) => r.json())
    .then((d) => {
      if (d.account && d.account.level) { state.account.level = d.account.level; renderLevel(d.account.level); }

      const tags = [];
      if (d.clan) tags.push(`<span class="pf-tag">${window.Casino.icons.ui("clans")}${escapeHtml(d.clan)}</span>`);
      if (d.ach && d.ach.badge) tags.push(`<span class="pf-tag">${d.ach.badge}</span>`);
      if (d.bounty) tags.push(`<span class="pf-tag pf-tag-bounty">${window.Casino.icons.ui("quests")}Kopfgeld ${window.Casino.betrag(d.bounty)}</span>`);
      $("#profile-tags").innerHTML = tags.join("");

      const c = d.city;
      const cityEl = $("#profile-city");
      if (cityEl) {
        if (c && c.houses) {
          const trophaeen = (c.trophies || []).length;
          cityEl.innerHTML =
            `<h3 class="section-title">${window.Casino.icons.ui("businesses")}Dein Imperium</h3><div class="pf-stats">` +
            kachel("Häuser", Number(c.houses).toLocaleString("de-DE")) +
            kachel("Wert", Number(c.value || 0).toLocaleString("de-DE") + "<i class=mk></i>") +
            kachel("Straßen-Monopole", Number(c.streets || 0)) +
            (trophaeen ? kachel("Trophäen", trophaeen) : "") +
            ((c.bossOf || []).length ? kachel("Stadtteil-Boss", (c.bossOf || []).join(", ")) : "") +
            `</div>`;
        } else {
          cityEl.innerHTML =
            `<h3 class="section-title">${window.Casino.icons.ui("businesses")}Dein Imperium</h3>` +
            `<p class="muted small">Noch kein Besitz. In der <b>Stadt</b> kaufst du dein erstes Haus.</p>`;
        }
      }
    })
    .catch(() => {});

  renderAchievements();
}

/**
 * Achievements. Freigeschaltete zuerst; die gesperrten bleiben eingeklappt.
 * Vorher standen alle neunundzwanzig als graue Kaesten untereinander, was den
 * Screen zu einer Wand aus Schloessern machte.
 */
function renderAchievements() {
  socket.emit("ach:list", (res) => {
    const box = $("#profile-badges");
    const zaehler = $("#profile-ach-count");
    const knopf = $("#profile-ach-toggle");
    if (!box) return;
    if (!res || !res.ok) { box.innerHTML = '<p class="muted small">-</p>'; return; }

    const offen = res.list.filter((a) => a.unlocked);
    // Gesperrte nach Fortschritt: was fast geschafft ist, steht oben. Sonst
    // sucht man das Naheliegende zwischen fuenfzig Schloessern.
    const zu = res.list.filter((a) => !a.unlocked).sort((x, y) => (y.anteil || 0) - (x.anteil || 0));
    if (zaehler) zaehler.textContent = `${offen.length} von ${res.list.length}`;

    /*
     * Die Bedingung stand nur bei den gesperrten in der Karte; bei den
     * freigeschalteten stand dort ein Haken. Wofuer man eines bekommen hat,
     * war ausschliesslich im title-Attribut zu sehen, also nur beim
     * Draufzeigen mit der Maus. Auf dem iPad gibt es kein Draufzeigen, dort
     * war die Information damit gar nicht erreichbar.
     *
     * Jetzt steht die Bedingung immer da, dazu die Belohnung und bei den
     * freigeschalteten das Datum.
     */
    const karte = (a) => {
      const sel = res.badge === a.id;
      const wann = a.at ? new Date(a.at).toLocaleDateString("de-DE") : null;
      const zeile = sel
        ? "★ Wird in der Bestenliste getragen"
        : a.unlocked
          ? `✓ Geschafft${wann ? " am " + wann : ""}`
          : `+${a.reward.toLocaleString("de-DE")}<i class=mk></i>`;
      /*
       * Fortschrittsbalken bei allem, was mehr als einen Schritt braucht.
       *
       * "Spiele 1.000 Runden" als graues Schloss ist entmutigend, wenn man
       * bei 780 steht und es nicht sieht. Die Zahlen kommen vom Server aus
       * derselben Quelle wie die Freischaltung, koennen also nicht davon
       * abweichen. Bei Ja/Nein-Zielen (ziel === 1) waere ein Balken sinnlos.
       */
      const mitBalken = !a.unlocked && a.ziel > 1;
      const balken = mitBalken
        ? `<div class="badge-bar"><i style="width:${Math.round((a.anteil || 0) * 100)}%"></i></div>` +
          `<span class="badge-fort">${(a.ist || 0).toLocaleString("de-DE")} von ${a.ziel.toLocaleString("de-DE")}</span>`
        : "";
      return `<div class="badge ${a.unlocked ? "on" : ""}${sel ? " selected" : ""}${mitBalken && a.anteil >= 0.5 ? " nah" : ""}" data-ach="${a.id}" data-unlocked="${a.unlocked ? 1 : 0}">` +
        `<span class="badge-emoji">${a.unlocked ? a.emoji : "🔒"}</span>` +
        `<span class="badge-label">${escapeHtml(a.label)}</span>` +
        `<span class="badge-desc">${escapeHtml(a.desc)}</span>` +
        balken +
        `<small>${zeile}</small></div>`;
    };

    const zeigen = achAlleZeigen ? [...offen, ...zu] : offen;
    box.innerHTML = zeigen.length
      ? zeigen.map(karte).join("")
      : '<p class="muted small">Noch keins freigeschaltet. Spiel ein paar Runden, das erste kommt schnell.</p>';

    if (knopf) {
      knopf.classList.toggle("hidden", !zu.length);
      knopf.textContent = achAlleZeigen
        ? "Gesperrte wieder ausblenden"
        : `Die ${zu.length} gesperrten anzeigen`;
    }
  });
}

$("#profile-ach-toggle")?.addEventListener("click", () => {
  achAlleZeigen = !achAlleZeigen;
  window.Casino.sound.play("tick");
  renderAchievements();
});

function statText(n) {
  return Math.floor(Number(n) || 0).toLocaleString("de-DE");
}

function levelHtml(l) {
  if (!l) return '<span class="muted small">Kein Level</span>';
  const pct = l.xpForNext ? Math.min(100, Math.round((100 * l.xpInLevel) / l.xpForNext)) : 100;
  return `<div class="level-head"><b style="color:${l.color}">${escapeHtml(l.emoji)} Level ${l.level}</b><span class="muted small">${escapeHtml(l.title)} · ${statText(l.xpInLevel)}/${statText(l.xpForNext)} XP</span></div>` +
    `<div class="level-bar"><div class="level-fill" style="width:${pct}%;background:${l.color}"></div></div>`;
}

const SOCIAL_GAME_LABELS = {
  pinco: "Pinco Ball",
  blackjack: "Blackjack",
  roulette: "Roulette",
  crash: "Crash",
  mines: "Mines",
  slots: "Slots",
  chess: "Schach",
  sudoku: "Sudoku",
  solitaire: "Solitär",
  memory: "Memory",
  sports: "Sportwetten",
  lobby: "Lobby",
};

// Duell-Herausforderung: Spieler wählt ein Spiel + Einsatz, erstellt ein
// privates Match und lädt den Gegner ein; dieser tritt beim Annehmen bei. ---
const DUEL_GAMES = [
  { key: "memory",  icon: "memory",    label: "Memory-Duell", screen: "memory",    ev: "memory:create",  extra: { size: "medium" } },
  { key: "sudoku",  icon: "sudoku",    label: "Sudoku-Race",  screen: "sudoku",    ev: "sudoku:create",  extra: { difficulty: "medium" } },
  { key: "solrace", icon: "solitaire", label: "Solitär-Race", screen: "solitaire", ev: "solrace:create", extra: {} },
  { key: "chess",   icon: "chess",     label: "Schach-Duell", screen: "chess",     ev: "chess:create",   extra: { tc: "5+0" } },
];
const DUEL_JOIN_HOOK = { memory: "_memoryJoinCode", sudoku: "_sudokuJoinCode", solrace: "_solraceJoinCode", chess: "_chessJoinCode" };
const DUEL_LABEL = { memory: "Memory-Duell", sudoku: "Sudoku-Race", solrace: "Solitär-Race", chess: "Schach-Duell" };

function openChallengePicker(name) {
  const body = $("#player-profile-body");
  if (!body || !name) return;
  body.innerHTML = `
    <div class="challenge-picker">
      <h2>${window.Casino.icons.ui("krieg")}${escapeHtml(name)} herausfordern</h2>
      <p class="muted small">Wähle ein Spiel und den Einsatz. ${escapeHtml(name)} bekommt eine Einladung und muss sie annehmen.</p>
      <div class="challenge-games">
        ${DUEL_GAMES.map((g) => `<button class="btn-secondary challenge-game" data-game="${g.key}">${window.Casino.icons.icon(g.icon) || ""}${g.label}</button>`).join("")}
      </div>
      <label class="mem-label" style="margin-top:12px">Einsatz (Buy-in)
        <input id="challenge-stake" type="number" inputmode="numeric" min="50" step="50" value="200" />
      </label>
      <div class="form-error" id="challenge-error"></div>
      <button class="btn-secondary" id="challenge-cancel" style="margin-top:10px;width:100%">‹ Zurück</button>
    </div>`;
  body.querySelectorAll(".challenge-game").forEach((b) =>
    b.addEventListener("click", () => startChallenge(b.dataset.game, name)));
  $("#challenge-cancel")?.addEventListener("click", () => openPlayerProfile(name));
}

function startChallenge(game, name) {
  const g = DUEL_GAMES.find((x) => x.key === game);
  const errEl = $("#challenge-error");
  if (!g) return;
  const stake = parseInt($("#challenge-stake")?.value, 10);
  if (!Number.isFinite(stake) || stake < 50) { if (errEl) errEl.textContent = "Mindest-Einsatz 50 Chips."; return; }
  if (state.account && state.account.chips < stake) { if (errEl) errEl.textContent = "Nicht genug Chips für den Einsatz."; return; }
  closePlayerProfile();
  // Privates Match für das gewählte Spiel anlegen, Code holen, Einladung schicken.
  showScreen(g.screen);
  socket.emit(g.ev, { buyIn: stake, isPublic: false, ...g.extra }, (res) => {
    if (!res || !res.ok) { toast(res?.error || "Konnte kein Match erstellen."); return; }
    socket.emit("social:challenge", { to: name, game, code: res.code, stake }, (r) => {
      if (!r || !r.ok) { toast(r?.error || "Einladung fehlgeschlagen."); return; }
      toast(r.delivered
        ? `${name} ist zu ${DUEL_LABEL[game]} eingeladen. Warte im Spielraum…`
        : `${name} ist gerade nicht online, die Einladung kam nicht an. Du kannst das Match wieder verlassen.`);
    });
  });
}

socket.on("social:challengeIncoming", ({ from, game, code, stake, label } = {}) => {
  if (!from || !game || !code) return;
  const hook = DUEL_JOIN_HOOK[game];
  const txt = `${from} fordert dich zu ${label || DUEL_LABEL[game] || "einem Duell"} heraus\nEinsatz: ${Number(stake || 0).toLocaleString("de-DE")} Chips\n\nAnnehmen?`;
  (async () => {
    const ja = hook && window.Casino[hook]
      && await window.Casino.dialog.frage(txt, { titel: "Herausforderung", okText: "Annehmen", abbruchText: "Ablehnen" });
    if (ja) window.Casino[hook](code);
    else { socket.emit("social:challengeDecline", { to: from, game }); toast(`Herausforderung von ${from} abgelehnt.`); }
  })();
});
socket.on("social:challengeDeclined", ({ by, label } = {}) => {
  toast(`${by || "Der Gegner"} hat deine ${label || "Duell"}-Herausforderung abgelehnt.`);
});

/**
 * Das Profil eines anderen Spielers.
 *
 * Vorher stand hier eine Statistik-Tabelle: Chips, Networth, Spiele. Damit
 * war jede gekaufte Kosmetik unsichtbar, sobald jemand anders hinsah. Und
 * genau dafuer kauft man sie. Angezeigt wird deshalb dieselbe Visitenkarte
 * wie im eigenen Profil, mit Banner, Namensstil, Rahmen, Titel und Imperium.
 *
 * Zwei Unterschiede zum eigenen Profil, beide beabsichtigt: die gesperrten
 * Achievements fehlen (was jemand nicht geschafft hat, geht niemanden etwas
 * an), und statt "Abmelden" stehen dort Statistik und Herausfordern.
 */
async function openPlayerProfile(name) {
  const modal = $("#player-profile-modal");
  const body = $("#player-profile-body");
  if (!modal || !body || !name) return;
  modal.classList.remove("hidden");
  body.innerHTML = '<div class="muted small">Profil lädt…</div>';
  try {
    const data = await api("/api/account/" + encodeURIComponent(name));
    const acc = data.account || {};
    const stats = acc.stats || {};
    const ach = data.ach || {};
    const c = data.city || null;
    const isMe = state.account && String(state.account.name || "").toLowerCase() === String(acc.name || name).toLowerCase();

    const kachel = (label, wert) => `<div class="pf-stat"><span>${label}</span><b>${wert}</b></div>`;
    const zahl = (n) => Number(n || 0).toLocaleString("de-DE");

    const tags = [];
    /*
     * Prunkstueck und Garnitur IN WORTEN.
     *
     * Beide haengen als kleine Marke am Namen und reisen damit durch das
     * ganze Haus — Online-Liste, Bestenliste, Ruhmestafel, Chat. Was sie
     * bedeuten, stand aber nur im `title`-Attribut, und auf dem iPad gibt
     * es kein Hover: dort waren es zwei namenlose Kaestchen mit einer
     * Zahl. Das Profil ist die Stelle, an die man tippt, wenn man wissen
     * will, wer das ist — also steht es hier ausgeschrieben.
     */
    if (acc.prunk && acc.prunk.label && acc.prunk.nr) {
      const p = acc.prunk;
      const rang = window.Casino.spieler.serienRang(p);
      const code = window.Casino.spieler.serienCode(p);
      tags.push(`<span class="pf-tag pf-tag-prunk serie-${rang}">`
        + `${window.Casino.icons.ui(rang === "jackpot" ? "stern-voll" : "stern")}`
        + `${escapeHtml(p.label)} #${escapeHtml(code)} · ${escapeHtml((p.serie && p.serie.label) || "Klassische Serie")}</span>`);
    }
    if (acc.garnitur && acc.garnitur.label && acc.garnitur.teile) {
      const g = acc.garnitur;
      tags.push(`<span class="pf-tag pf-tag-garnitur">${window.Casino.icons.ui("kosmetik")}`
        + `${escapeHtml(g.label)}-Garnitur · ${g.teile} Stücke angelegt</span>`);
    }
    if (data.clan) tags.push(`<span class="pf-tag">${window.Casino.icons.ui("clans")}${escapeHtml(data.clan)}</span>`);
    if (ach.badge) tags.push(`<span class="pf-tag">${ach.badge}</span>`);
    if (data.bounty) tags.push(`<span class="pf-tag pf-tag-bounty">${window.Casino.icons.ui("quests")}Kopfgeld ${window.Casino.betrag(data.bounty)}</span>`);
    if (acc.lastSeen) tags.push(`<span class="pf-tag">${window.Casino.icons.ui("uhr")}${wannGrob(acc.lastSeen)}</span>`);

    const badges = (ach.unlocked || []).length
      ? (ach.unlocked || []).map((b) =>
          `<div class="badge on"><span class="badge-emoji">${escapeHtml(b.emoji)}</span>` +
          `<span class="badge-label">${escapeHtml(b.label)}</span></div>`).join("")
      : '<p class="muted small" style="margin:0">Noch keins freigeschaltet.</p>';

    const imperium = c && c.houses
      ? `<div class="pf-stats">` +
          kachel("Häuser", zahl(c.houses)) +
          kachel("Wert", zahl(c.value) + "<i class=mk></i>") +
          kachel("Straßen-Monopole", zahl(c.streets)) +
          ((c.trophies || []).length ? kachel("Trophäen", (c.trophies || []).length) : "") +
          ((c.bossOf || []).length ? kachel("Stadtteil-Boss", escapeHtml((c.bossOf || []).join(", "))) : "") +
        `</div>`
      : '<p class="muted small" style="margin:0">Besitzt noch nichts in der Stadt.</p>';

    body.innerHTML = `
      <div class="pf-card pp-card"${acc.banner ? ` data-banner="${escapeHtml(acc.banner)}"` : ""}>
        <div class="pf-avatar">${window.Casino.spieler.avatar(acc)}</div>
        <div class="pf-ident">
          <h2>${window.Casino.spieler.name(acc)}</h2>
          ${acc.title ? `<div class="pl-title">${escapeHtml(acc.title)}</div>` : ""}
          <div class="pf-tags">${tags.join("")}</div>
        </div>
        <div class="level-box">${levelHtml(acc.level)}</div>
      </div>

      <div class="pf-stats">
        ${kachel("Guthaben", zahl(acc.chips) + "<i class=mk></i>")}
        ${kachel("Netto-Vermögen", zahl(acc.netWorth ?? acc.chips) + "<i class=mk></i>")}
        ${kachel("Gespielte Runden", zahl(stats.gamesPlayed))}
        ${kachel("Größter Gewinn", zahl(stats.biggestWin) + "<i class=mk></i>")}
        ${kachel("Mitglied seit", acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "-")}
      </div>

      <h3 class="section-title">${window.Casino.icons.ui("businesses")}Imperium</h3>
      ${imperium}

      <div class="pf-ach-head">
        <h3 class="section-title" style="margin:0">${window.Casino.icons.ui("bestenliste")}Achievements</h3>
        <span class="muted small">${(ach.unlocked || []).length} von ${ach.total || 0}</span>
      </div>
      <div class="badge-grid pp-badges">${badges}</div>

      <div class="player-profile-actions">
        <button class="btn-secondary" id="player-profile-stats-btn">Statistik ansehen</button>
        ${isMe ? "" : `<button class="btn-primary" id="player-profile-challenge-btn">Herausfordern</button>`}
      </div>`;
    $("#player-profile-stats-btn")?.addEventListener("click", () => {
      closePlayerProfile();
      if (window.Casino.openStats) window.Casino.openStats(acc.name || name);
    });
    $("#player-profile-challenge-btn")?.addEventListener("click", () => openChallengePicker(acc.name || name));
  } catch {
    body.innerHTML = '<div class="muted small">Profil konnte nicht geladen werden.</div>';
  }
}

/** "vor 3 Std" / "gestern". Grob reicht, auf die Minute waere unheimlich. */
function wannGrob(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 5) return "gerade hier";
  if (min < 60) return `vor ${min} Min hier`;
  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Std hier`;
  const tage = Math.floor(std / 24);
  return tage === 1 ? "gestern hier" : `vor ${tage} Tagen hier`;
}

function closePlayerProfile() {
  $("#player-profile-modal")?.classList.add("hidden");
}

$("#player-profile-close")?.addEventListener("click", closePlayerProfile);
$("#player-profile-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "player-profile-modal") closePlayerProfile();
});

// Abzeichen für die Bestenliste wählen oder abwählen.
$("#profile-badges").addEventListener("click", (e) => {
  const el = e.target.closest(".badge");
  if (!el || el.dataset.unlocked !== "1") return;
  const id = el.classList.contains("selected") ? null : el.dataset.ach;
  socket.emit("ach:setBadge", { id }, (res) => {
    if (!res || !res.ok) { toast(res?.error || "Fehler."); return; }
    toast(id ? "Wird jetzt in der Bestenliste angezeigt." : "Emoji entfernt.");
    renderProfile();
  });
});

// API-Aufrufe
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}

// Login
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#login-name").value.trim();
  const pin = $("#login-pin").value.trim();
  const errEl = $("#login-error");
  errEl.textContent = "";

  try {
    const data = await api("/api/login", { name, pin });
    if (data.config?.bonusCooldownMs) state.bonusCooldownMs = data.config.bonusCooldownMs;
    if (data.config?.rescueThreshold) RESCUE_THRESHOLD = data.config.rescueThreshold;
    setAccount(data.account, data.token);
    if (data.created) maybeShowOnboarding();
    /* Die Begruessung muss vor dem Lobby-Wechsel offen sein. Sonst oeffnet
       der Tagesbericht im selben Moment ebenfalls und zwei Fenster liegen
       uebereinander. */
    showScreen("lobby");
    if (data.created) toast(`Willkommen, ${data.account.name}! ${(data.account.chips || 0).toLocaleString("de-DE")} Chips geschenkt.`);
    else toast(`Willkommen zurück, ${data.account.name}!`);
    // Einbruchs-Warnung: fehlgeschlagene Login-Versuche seit dem letzten Besuch.
    if (!data.created && data.warnFails >= 3) {
      setTimeout(() => toast(`Seit deinem letzten Besuch gab es ${data.warnFails} falsche Anmeldeversuche. Vielleicht besser das Passwort ändern (Einstellungen).`), 1500);
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// Login-Kalender
function renderCalendar(s) {
  const grid = $("#calendar-grid");
  const btn = $("#calendar-claim-btn");
  if (!grid || !s || !s.rewards) return;
  grid.innerHTML = s.rewards.map((r, i) => {
    const claimed = i < s.current;
    const isNext = i === s.current && s.canClaim;
    return `<div class="cal-day ${claimed ? "claimed" : ""} ${isNext ? "next" : ""}">
      <div class="cal-daynum">Tag ${i + 1}</div>
      <div class="cal-reward">${r.toLocaleString("de-DE")}<i class=mk></i></div>
      <div class="cal-mark">${claimed ? "✓" : isNext ? "★" : ""}</div>
    </div>`;
  }).join("");
  if (btn) {
    btn.disabled = !s.canClaim;
    btn.innerHTML = s.canClaim ? `Tag ${s.current + 1} abholen: ${window.Casino.betrag(s.rewards[s.current])}` : "Heute schon abgeholt, morgen gibt's den nächsten.";
  }
}
function loadCalendar() {
  socket.emit("calendar:state", (s) => { if (s && s.ok) renderCalendar(s); });
  if (window.Casino._loadEventCalendar) window.Casino._loadEventCalendar();
}
$("#calendar-claim-btn")?.addEventListener("click", () => {
  socket.emit("calendar:claim", (r) => {
    if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
    setAccount(r.account);
    toast(`Tag ${r.day}: +${r.reward.toLocaleString("de-DE")} Chips`);
    loadCalendar();
    renderAbholBadge();
  });
});

// Live-Ops (Happy Hour / Turnier) Banner
let liveopsState = null;
function renderLiveops() {
  const el = $("#liveops-banner");
  if (!el) return;
  const s = liveopsState;
  const parts = [];
  if (s && s.happyActive) {
    const min = Math.max(0, Math.ceil((s.happyUntil - Date.now()) / 60000));
    parts.push(`<span class="lo-chip happy">Happy Hour: Aufträge zahlen doppelt · noch ${min} Min</span>`);
  }
  if (s && s.tourney) {
    const min = Math.max(0, Math.ceil((s.tourney.endsAt - Date.now()) / 60000));
    const lead = s.tourney.board && s.tourney.board[0];
    parts.push(`<span class="lo-chip tourney">Slot-Turnier · ${window.Casino.betrag(s.tourney.prize)} · noch ${min} Min${lead ? ` · vorne: ${escapeHtml(lead.name)} (${lead.mult}×)` : ""}</span>`);
  }
  el.innerHTML = parts.join("");
  el.classList.toggle("hidden", parts.length === 0);
}
socket.on("liveops:state", (s) => { liveopsState = s; renderLiveops(); });
socket.on("connect", () => socket.emit("liveops:state", (r) => { if (r && r.ok) { liveopsState = r; renderLiveops(); } }));
socket.on("liveops:tourneyWin", (w) => { if (w) toast(`${w.name} gewinnt das Slot-Turnier mit ${w.mult}× (+${w.prize.toLocaleString("de-DE")} Chips)`); });
// Kurze Server-Meldung an genau einen Spieler. Wird bisher nur genutzt, wenn
// die Stadt eine Kosmetik freischaltet.
socket.on("notice", ({ text } = {}) => { if (text) toast(String(text)); });

socket.on("level:up", (d) => {
  if (!d) return;
  if (state.account) state.account.level = { ...(state.account.level || {}), level: d.level, title: d.title, emoji: d.emoji };
  renderTopbar();
  toast(`Level ${d.level} erreicht: ${d.title}`);
});
setInterval(renderLiveops, 20000);

// Stunden-Bonus: Countdown auf Topbar-Knopf und Hero-Kachel
function updateBonusUI() {
  const acc = state.account;
  const btn = $("#bonus-btn");
  if (!acc || !btn) return;
  const left = state.bonusCooldownMs - (Date.now() - (acc.lastBonusAt || 0));
  const ready = left <= 0;
  const heroBtn = $("#hero-bonus");
  const heroSub = $("#hero-bonus-sub");

  btn.disabled = !ready;
  if (ready) {
    btn.innerHTML = `${window.Casino.icons.ui("geschenk")} Bonus`;
    if (heroSub) heroSub.textContent = "Jetzt abholen";
    heroBtn?.classList.add("ready");
    heroBtn && (heroBtn.disabled = false);
  } else {
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const t = (left >= 3600000 ? Math.floor(left / 3600000) + ":" : "") +
      String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    btn.innerHTML = `${window.Casino.icons.ui("uhr")} ${t}`;
    if (heroSub) heroSub.textContent = `Wieder in ${t}`;
    heroBtn?.classList.remove("ready");
    heroBtn && (heroBtn.disabled = true);
  }
}
setInterval(updateBonusUI, 1000);

// Hero-Bereich der Lobby
/**
 * Guthaben gross, Level-Fortschritt darunter. Das Guthaben zaehlt hoch, wenn
 * es sich geaendert hat: eine Zahl, die von 4.950 auf 128.450 springt, nimmt
 * man kaum wahr, eine hochlaufende schon.
 */
let heroChipsAngezeigt = null;
function renderHero() {
  const acc = state.account;
  if (!acc) return;
  const el = $("#hero-chips");
  if (el) {
    const ziel = acc.chips || 0;
    if (heroChipsAngezeigt === null || Math.abs(ziel - heroChipsAngezeigt) < 2) {
      el.textContent = ziel.toLocaleString("de-DE");
    } else {
      window.Casino.fx.countUp(el, heroChipsAngezeigt, ziel);
    }
    heroChipsAngezeigt = ziel;
  }

  const lvl = $("#hero-level");
  if (lvl) {
    const l = acc.level;
    if (!l) { lvl.innerHTML = ""; }
    else {
      const anteil = l.xpForNext > 0
        ? Math.min(100, Math.round((l.xpInLevel / l.xpForNext) * 100))
        : 100;
      lvl.innerHTML = `
        <div class="hero-level-row">
          <span class="hero-level-badge" style="color:${l.color || "inherit"}">${window.Casino.icons.rangZeichen(l)}Level ${l.level}</span>
          <small>${escapeHtml(l.title || "")}</small>
        </div>
        <div class="hero-level-bar" title="${l.xpInLevel} von ${l.xpForNext} XP"><i style="width:${anteil}%"></i></div>`;
    }
  }
  updateBonusUI();
}
window.Casino._renderHero = renderHero;

// Stunden-Bonus
async function claimBonus() {
  if (!state.account) return;
  try {
    const data = await api("/api/daily-bonus", { name: state.account.name, token: state.token });
    setAccount(data.account);
    const extras = [];
    if (data.tribute) extras.push(`+${data.tribute.toLocaleString("de-DE")} Straßen-Tribut (${data.streets} Straßen${data.golden ? ", Goldene Straße dabei" : ""})`);
    if (data.houses) {
      // Die Grundsteuer muss in der Meldung stehen. Sonst sieht man nur eine
      // Zahl, die nicht zur eigenen Haeuserzahl passt, und haelt sie fuer
      // einen Fehler.
      const st = data.stadt;
      const steuer = st && st.satz > 0.005 ? `, ${Math.round(st.satz * 100)} % Grundsteuer ab` : "";
      extras.push(`+${data.houses.toLocaleString("de-DE")} Haus-Miete (${data.housesOwned} Häuser${steuer})`);
    }
    if (data.sets) extras.push(`+${data.sets.toLocaleString("de-DE")} Sammel-Sets`);
    if (data.cashback) extras.push(`+${data.cashback.toLocaleString("de-DE")} Cashback`);
    const streakNote = data.streak > 1 ? `, ${data.streak} Tage am Stück` : "";
    toast(`+${data.amount.toLocaleString("de-DE")} Chips Bonus${streakNote}${extras.length ? " · " + extras.join(" · ") : ""}`);
  } catch (err) {
    toast(err.message || "Bonus nicht verfügbar.");
  }
}
$("#bonus-btn").addEventListener("click", claimBonus);
$("#hero-bonus")?.addEventListener("click", claimBonus);

// Soforthilfe (Pleite-Schutz)
async function claimRescue() {
  if (!state.account) return;
  try {
    const data = await api("/api/rescue", { name: state.account.name, token: state.token });
    setAccount(data.account);
    toast(`🆘 +${data.amount.toLocaleString("de-DE")} Chips Soforthilfe!`);
  } catch (err) {
    toast(err.message || "Soforthilfe nicht verfügbar.");
  }
}
$("#rescue-btn").addEventListener("click", claimRescue);

// Leaderboard (multi-category, tabbed)
const LB_ORDER = ["rich", "level", "horses", "estate", "streets", "bigwin", "bigloss", "games"];
// Wie der Wert einer Kategorie angezeigt wird (Standard: Chips).
const LB_UNIT = { level: (v) => `Level ${v}`, streets: (v) => `${v} ${v === 1 ? "Straße" : "Straßen"}`, games: (v) => `${v.toLocaleString("de-DE")} Spiele`, horses: (v) => `${v} ${v === 1 ? "Sieg" : "Siege"}` };
let lbData = null;
let lbActiveCat = "rich";

async function loadLeaderboard() {
  const list = $("#leaderboard-list");
  list.innerHTML = '<li class="muted">Lädt…</li>';
  try {
    const { leaderboard } = await api("/api/leaderboard");
    lbData = leaderboard;
    renderLbTabs();
    renderLbList();
  } catch {
    list.innerHTML = '<li class="muted">Konnte Bestenliste nicht laden.</li>';
  }
}

function renderLbTabs() {
  const tabs = $("#lb-tabs");
  if (!tabs || !lbData) return;
  tabs.innerHTML = "";
  LB_ORDER.forEach((cat) => {
    if (!lbData[cat]) return;
    const b = document.createElement("button");
    b.className = "lb-tab" + (cat === lbActiveCat ? " active" : "");
    // Das Symbol kommt als Kennung vom Server, gezeichnet wird hier.
    b.innerHTML = (lbData[cat].icon ? window.Casino.icons.ui(lbData[cat].icon) : "") +
      `<span>${escapeHtml(lbData[cat].label)}</span>`;
    b.addEventListener("click", () => {
      lbActiveCat = cat;
      renderLbTabs();
      renderLbList();
    });
    tabs.appendChild(b);
  });
}

function renderLbList() {
  const list = $("#leaderboard-list");
  if (!lbData) return;
  const cat = lbData[lbActiveCat];
  const entries = (cat && cat.entries) || [];
  if (!entries.length) {
    list.innerHTML = '<li class="muted">Noch keine Einträge.</li>';
    return;
  }
  list.innerHTML = "";
  entries.forEach((p, i) => {
    const li = document.createElement("li");
    const me = state.account && p.name === state.account.name;
    const rank = window.Casino.icons.platz(i);
    const unit = LB_UNIT[lbActiveCat];
    const badge = p.badge ? ` <span class="lb-badge" title="Achievement">${p.badge}</span>` : "";
    const champ = p.champ ? ` <span class="lb-badge lb-champ">${window.Casino.icons.ui("krone")}<i>Woche</i></span>` : "";
    const lvl = p.level ? ` <span class="lb-level" title="Level ${p.level}">Lv ${p.level}</span>` : "";
    const clan = p.clan ? ` <span class="lb-clan">[${escapeHtml(p.clan)}]</span>` : "";
    const ava = window.Casino.spieler.avatar(p);
    const nm = window.Casino.spieler.name(p, { tag: "b" }) + window.Casino.spieler.prunk(p) + window.Casino.spieler.garnitur(p);
    const titel = window.Casino.spieler.title(p);
    if (p.schild && SCHILDER.has(p.schild)) li.classList.add("sch-" + p.schild);
    li.innerHTML =
      `<span>${rank}${clan} ${ava} ${nm}${titel ? " " + titel : ""}${lvl}${champ}${badge}${me ? " (du)" : ""}</span>` +
      `<b>${unit ? unit(p.value) : p.value.toLocaleString("de-DE") + "<i class=mk></i>"}</b>`;
    // Zeile antippen zeigt die Statistik des Spielers.
    li.classList.add("lb-clickable");
    li.addEventListener("click", () => window.Casino.openStats && window.Casino.openStats(p.name));
    list.appendChild(li);
  });
}

// Logout
$("#logout-btn").addEventListener("click", () => {
  state.account = null;
  state.token = null;
  try {
    localStorage.removeItem("casino_name");
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
  $("#login-pin").value = "";
  // Ersetzen statt anhaengen: nach dem Abmelden soll die Zurueck-Geste nicht
  // in ein Spiel zurueckfuehren, das ohne Account gar nicht mehr geht.
  showScreen("login", { history: "replace" });
});

// Hilfsfunktionen
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// (Passwörter dürfen 4 bis 24 beliebige Zeichen haben, ohne Ziffern-Filter.)

// Bequemlichkeit: gespeicherten Namen vorausfüllen
try {
  const saved = localStorage.getItem("casino_name");
  if (saved) $("#login-name").value = saved;
} catch {}

// Bonus-Button-Status regelmäßig auffrischen
setInterval(refreshBonusButton, 60 * 1000);

/* Namen aendern.
   Der alte Name bleibt als Anmeldung gueltig, deshalb kann hier niemand sich
   selbst aussperren. Gesagt wird es trotzdem, sonst probiert es keiner aus. */
$("#rename-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#rn-error");
  errEl.textContent = "";
  const neu = ($("#rn-neu").value || "").trim();
  if (neu.length < 2) { errEl.textContent = "Mindestens zwei Zeichen."; return; }
  if (!await window.Casino.dialog.frage(
    `Du heißt ab sofort „${neu}“. Der Name steht überall, auch rückwirkend.\n\nAnmelden kannst du dich weiter mit „${state.account.name}“. Nächster Wechsel erst in einem Monat.`,
    { titel: "Name ändern", okText: "Umbenennen" })) return;
  socket.emit("account:rename", { neu }, (res) => {
    if (!res || !res.ok) { errEl.textContent = (res && res.error) || "Fehler."; return; }
    $("#rn-neu").value = "";
    toast(`Du heißt jetzt ${res.neu}.`);
  });
});

// PIN ändern
$("#change-pin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#cp-error");
  errEl.textContent = "";
  const oldPin = $("#cp-old").value.trim();
  const newPin = $("#cp-new").value.trim();
  const confirm = $("#cp-confirm").value.trim();
  if (newPin !== confirm) { errEl.textContent = "Neue PINs stimmen nicht überein."; return; }
  try {
    await api("/api/change-pin", { name: state.account.name, oldPin, newPin });
    $("#cp-old").value = ""; $("#cp-new").value = ""; $("#cp-confirm").value = "";
    toast("PIN erfolgreich geändert!");
  } catch (err) {
    errEl.textContent = err.message;
  }
});
// (Passwort-Felder: kein Ziffern-Filter mehr, 6 bis 24 beliebige Zeichen.)

// Chips senden
$("#transfer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const errEl = $("#tr-error");
  errEl.textContent = "";
  const to = $("#tr-to").value.trim();
  const amount = parseInt($("#tr-amount").value, 10);
  if (!to || !Number.isFinite(amount) || amount <= 0) { errEl.textContent = "Ungültige Eingabe."; return; }
  socket.emit("account:transfer", { to, amount }, (res) => {
    if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
    state.account = { ...state.account, ...res.account };
    renderTopbar();
    $("#tr-to").value = ""; $("#tr-amount").value = "";
    toast(`${amount.toLocaleString("de-DE")} Chips an ${to} gesendet!`);
  });
});

// Benachrichtigung wenn jemand Chips schickt
socket.on("account:received", ({ from, amount }) => {
  toast(`+${amount.toLocaleString("de-DE")} Chips von ${from} erhalten!`);
});

// Admin-Panel (nur für Vincent)
/* Eine Nachricht vom Casino an genau einen Spieler. Als Fenster und nicht als
   Toast: ein Toast ist nach vier Sekunden weg, und wer gerade eine Runde dreht,
   haette sie nie gesehen. */
socket.on("admin:nachricht", ({ titel, text } = {}) => {
  if (!text) return;
  window.Casino.dialog.hinweis(String(text), { titel: titel || "Nachricht vom Casino", okText: "Gelesen" });
});

socket.on("chat:geleert", ({ room } = {}) => {
  if (room && room !== "global") return;
  document.querySelectorAll("[data-chat-log]").forEach((el) => { el.innerHTML = ""; });
  toast("Der Chat wurde geleert.");
});

socket.on("admin:kicked", ({ reason }) => {
  toast(reason || "Du wurdest gesperrt.");
  state.account = null;
  state.token = null;
  try { localStorage.removeItem("casino_name"); } catch {}
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  showScreen("login", { history: "replace" });
});

/* Admin: Konten
   Vorher stand unter jedem der 78 Konten ein rotes "Löschen", eine
   unwiderrufliche Aktion, 78 Mal, einen Fehltipp entfernt. Und wer Chips
   setzen, sperren oder eine IP bannen wollte, tippte den Namen in jeweils ein
   eigenes Formular darunter neu ein.

   Jetzt: eine schmale Liste zum Suchen, ein Tipp öffnet die Person, und alles
   zu dieser Person steht an einer Stelle. Was sich nicht rückgängig machen
   lässt, steht unten in einem eigenen Kasten und fragt nach. */

let adKonten = [];        // zuletzt geladene Liste
let adGewaehlt = null;    // Name der geöffneten Person

function loadAdminAccounts() {
  loadAdminDashboard();
  if (istBesitzerUI()) { loadIpBans(); loadDeviceBans(); }
  ladeStrafen();
  socket.emit("announcement:get", (res) => {
    if (res && res.ok && res.announcement && $("#admin-announcement-text")) {
      $("#admin-announcement-text").value = res.announcement.text || "";
    }
  });
  const list = $("#admin-account-list");
  if (!list) return;
  list.innerHTML = '<div class="muted small">Lädt…</div>';
  socket.emit("admin:listAccounts", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<div class="muted small">Fehler.</div>'; return; }
    adKonten = (res.accounts || []).slice().sort((a, b) => istBesitzerUI()
      ? (b.chips || 0) - (a.chips || 0)
      : String(a.name).localeCompare(String(b.name), "de"));
    zeichneKontenListe();
    if (adGewaehlt) zeichnePerson(adGewaehlt);
  });
}

function zeichneKontenListe() {
  const list = $("#admin-account-list");
  if (!list) return;
  const suche = ($("#ad-suche")?.value || "").trim().toLowerCase();
  const treffer = suche
    ? adKonten.filter((p) => String(p.name).toLowerCase().includes(suche))
    : adKonten;

  const zaehler = $("#ad-treffer");
  if (zaehler) {
    zaehler.textContent = suche
      ? `${treffer.length} von ${adKonten.length}`
      : `${adKonten.length} Konten`;
  }

  if (!treffer.length) { list.innerHTML = '<div class="muted small">Kein Konto gefunden.</div>'; return; }
  /* Ohne Suche nur die ersten 25: 78 Zeilen sind auf dem iPad ein
     Bildschirmkilometer, und wer jemand Bestimmten sucht, tippt ohnehin. */
  const zeigen = suche ? treffer : treffer.slice(0, 25);
  list.innerHTML = zeigen.map((p, i) => `
    <button class="ad-reihe${adGewaehlt === p.name ? " aktiv" : ""}" type="button" data-konto="${escapeHtml(p.name)}">
      <span class="ad-platz">${suche ? "" : i + 1}</span>
      <span class="ad-name">${escapeHtml(p.name)}</span>
      ${p.rolle === "mod" ? '<span class="ad-flag ad-flag-mod">Mod</span>' : ""}
      ${p.locked || p.banned ? '<span class="ad-flag ad-flag-bad">eingesperrt</span>' : ""}
      ${(p.strafen || []).map((st) => `<span class="ad-flag">${escapeHtml(st.kurz)}</span>`).join("")}
      <b>${istBesitzerUI() ? `${Math.floor(p.chips || 0).toLocaleString("de-DE")}<i class=mk></i>` : (p.rolle === "mod" ? "Moderator" : "Spieler")}</b>
    </button>`).join("")
    + (!suche && treffer.length > zeigen.length
      ? `<div class="muted small ad-mehr">… und ${treffer.length - zeigen.length} weitere. Zum Finden oben tippen.</div>` : "");
}

/* Strafen (Admin)
   Vorher gab es zwei Knoepfe: Konto sperren (fuer immer) und Pechvogel (fuer
   immer). Beides musste jemand von Hand zuruecknehmen und beides ohne Grund,
   also stand am Konto nur, dass etwas ist, nicht warum. Wer nach zwei Wochen
   nachsah, fand einen Pechvogel und keine Erklaerung.

   Jetzt sieben Strafen, jede mit Ablaufzeit und Grund. Der Katalog kommt vom
   Server (`admin:strafen`), damit eine neue Strafe nicht an zwei Stellen
   beschrieben werden muss. */
let adStrafArten = null;    // { art: {name, was, wert?, spiele?} }
let adStrafSpiele = null;   // { id: name }

const AD_DAUERN = [
  { v: 15, t: "15 Minuten" }, { v: 60, t: "1 Stunde" }, { v: 180, t: "3 Stunden" },
  { v: 720, t: "12 Stunden" }, { v: 1440, t: "1 Tag" }, { v: 4320, t: "3 Tage" },
  { v: 10080, t: "7 Tage" }, { v: 0, t: "unbefristet" },
];

function adStrafRest(bis) {
  if (!bis) return "unbefristet";
  const ms = bis - Date.now();
  if (ms <= 0) return "abgelaufen";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `noch ${min} min`;
  const std = Math.round(min / 60);
  return std < 48 ? `noch ${std} h` : `noch ${Math.round(std / 24)} Tage`;
}

/** Was gilt, und das Formular fuer eine neue Strafe. */
function strafenBlock(p) {
  const offen = p.strafen || [];
  const arten = adStrafArten || {};
  const modArten = new Set(["sperre", "stumm", "spielsperre", "keineAuktion"]);
  const artListe = Object.keys(arten).filter((a) => istBesitzerUI() || modArten.has(a));
  const dauern = AD_DAUERN.filter((d) => istBesitzerUI() || d.v > 0);
  return `
    <div class="ad-straf">
      <div class="cd-sub">Strafen</div>
      ${offen.length ? `<div class="ad-strafliste">${offen.map((s) => `
        <div class="ad-strafchip">
          <b>${escapeHtml(s.kurz)}${s.art === "deckel" ? ` ${Number(s.wert || 0).toLocaleString("de-DE")}` : ""}${s.art === "pech" && s.wert < 100 ? ` ${s.wert} %` : ""}</b>
          <span>${adStrafRest(s.bis)}</span>
          ${s.spiele ? `<small>${escapeHtml(s.spiele.map((g) => (adStrafSpiele || {})[g] || g).join(", "))}</small>` : ""}
          ${s.grund ? `<small>${escapeHtml(s.grund)}</small>` : ""}
          ${istBesitzerUI() || modArten.has(s.art) ? `<button class="ad-strafweg" type="button" data-straf-weg="${escapeHtml(s.art)}" aria-label="Aufheben">✕</button>` : ""}
        </div>`).join("")}</div>
        ${istBesitzerUI() ? '<button class="chip-btn" type="button" data-straf-weg="*">Alle aufheben</button>' : ""}`
        : `<p class="hint">Nichts offen.</p>`}

      ${artListe.length ? `
      <div class="ad-felder ad-straf-form">
        <label class="ad-feld"><span>Strafe</span>
          <select id="ad-straf-art">${artListe.map((a) => `<option value="${a}">${escapeHtml(arten[a].name)}</option>`).join("")}</select></label>
        <label class="ad-feld"><span>Dauer</span>
          <select id="ad-straf-dauer">${dauern.map((d) => `<option value="${d.v}"${d.v === 1440 ? " selected" : ""}>${d.t}</option>`).join("")}</select></label>
        <label class="ad-feld hidden" id="ad-straf-wert-feld"><span id="ad-straf-wert-label">Wert</span>
          <input id="ad-straf-wert" type="number" inputmode="numeric" /></label>
      </div>
      <div class="ad-straf-spiele hidden" id="ad-straf-spiele">
        <span class="muted small">Welche Spiele?</span>
        <div class="ad-spielwahl">${Object.entries(adStrafSpiele || {}).map(([id, n]) =>
          `<label class="ad-haken"><input type="checkbox" value="${id}" /><span>${escapeHtml(n)}</span></label>`).join("")}</div>
      </div>
      <p class="hint" id="ad-straf-was"></p>
      <div class="ad-zeile">
        <input id="ad-straf-grund" type="text" maxlength="120" placeholder="Grund (liest er selbst)" />
        <button class="btn-danger ad-knopf" type="button" data-person-tun="straf">Strafe setzen</button>
      </div>` : `<p class="hint">Katalog lädt…</p>`}
    </div>`;
}

/** Die Felder zur gewaehlten Strafe zeigen: Wert nur beim Deckel und beim Pechvogel. */
function strafFormular() {
  const art = $("#ad-straf-art")?.value;
  const def = (adStrafArten || {})[art];
  if (!def) return;
  const wertFeld = $("#ad-straf-wert-feld");
  const spieleBox = $("#ad-straf-spiele");
  const was = $("#ad-straf-was");
  if (was) was.textContent = def.was || "";
  if (wertFeld) {
    wertFeld.classList.toggle("hidden", !def.wert);
    if (def.wert) {
      $("#ad-straf-wert-label").textContent = def.wert.label;
      const i = $("#ad-straf-wert");
      i.min = def.wert.min; i.max = def.wert.max;
      if (!i.dataset.art || i.dataset.art !== art) { i.value = def.wert.vorgabe; i.dataset.art = art; }
    }
  }
  if (spieleBox) spieleBox.classList.toggle("hidden", !def.spiele);
}

/** Alles, was gerade irgendwo gilt. */
function zeichneOffeneStrafen(liste) {
  const box = $("#ad-strafen-offen");
  if (!box) return;
  if (!liste || !liste.length) { box.innerHTML = '<div class="muted small">Nichts offen. Ruhiges Haus.</div>'; return; }
  box.innerHTML = liste.map((p) => `
    <button class="ad-strafzeile" type="button" data-konto="${escapeHtml(p.name)}">
      <b>${escapeHtml(p.name)}</b>
      <span>${p.strafen.map((s) => `${escapeHtml(s.kurz)} (${adStrafRest(s.bis)})`).join(" · ")}</span>
    </button>`).join("");
}

function ladeStrafen() {
  socket.emit("admin:strafen", (r) => {
    if (!r || !r.ok) return;
    adStrafArten = r.arten; adStrafSpiele = r.spiele;
    /* Die Kontenliste ist die Quelle fuer die Personenkarte, und sie wurde
       geladen, bevor die Strafe gesetzt wurde. Ohne diesen Abgleich stuende
       eine Strafe in der Uebersicht und in der Karte derselben Person nicht. */
    const nach = new Map((r.offen || []).map((p) => [String(p.name).toLowerCase(), p.strafen]));
    adKonten.forEach((k) => { k.strafen = nach.get(String(k.name).toLowerCase()) || []; });
    zeichneOffeneStrafen(r.offen);
    zeichneKontenListe();
    if (adGewaehlt) { zeichnePerson(adGewaehlt); strafFormular(); }
  });
}

/** Alles zu einer Person an einer Stelle. */
function zeichnePerson(name) {
  const box = $("#ad-person");
  if (!box) return;
  /* Solange die Kontenliste noch unterwegs ist, bleibt die Karte stehen, wie
     sie ist. Sonst schliesst sich die gerade geoeffnete Person wieder, weil
     die Strafen-Antwort vor der Kontenliste da war. */
  if (!adKonten.length) return;
  const p = adKonten.find((x) => x.name === name);
  if (!p) { box.classList.add("hidden"); adGewaehlt = null; return; }
  adGewaehlt = p.name;
  box.classList.remove("hidden");
  const chips = Math.floor(p.chips || 0);
  const bank = Math.floor(p.savings || 0);
  const owner = istBesitzerUI();
  const selbst = String(p.name).toLowerCase() === "vincent";
  const geschuetzt = selbst || (!owner && p.rolle === "mod");

  box.innerHTML = `
    <div class="ad-karte ad-person-karte">
      <div class="ad-person-kopf">
        <div>
          <b>${escapeHtml(p.name)}</b>
          <small>${owner ? `${chips.toLocaleString("de-DE")} auf der Hand · ${bank.toLocaleString("de-DE")} auf der Bank` : (p.rolle === "mod" ? "Moderator" : "Spieler")}</small>
        </div>
        <button class="chip-btn ad-zu" type="button" data-person-zu aria-label="Schließen">✕</button>
      </div>

      ${owner && !selbst ? `<div class="ad-vollsperre${p.locked ? " an" : ""}">
        <span class="ad-vollsperre-icon">${p.locked ? "⛓" : "◈"}</span>
        <div>
          <b>${p.locked ? "Spieler ist eingesperrt" : "Spieler vollständig sperren"}</b>
          <p>${p.locked
            ? `Konto${p.deviceBanned ? " und bekanntes Browser-Gerät" : ""} sind blockiert. Entsperren öffnet beides wieder.`
            : p.deviceKnown
              ? "Sperrt das Konto und das zuletzt benutzte Browser-Gerät. Dort kann auch kein neuer Account erstellt werden."
              : "Sperrt das Konto. Ein Browser-Gerät kann erst mitgesperrt werden, nachdem die Person sich einmal neu angemeldet hat."}</p>
        </div>
        <button class="${p.locked ? "btn-secondary" : "btn-danger"} ad-knopf" type="button" data-person-tun="${p.locked ? "unlock" : "lock"}">${p.locked ? "Vollständig entsperren" : "Spieler einsperren"}</button>
      </div>` : ""}

      <div class="ad-flags">
        ${owner && !selbst ? `<button class="ad-schalter${p.rolle === "mod" ? " an" : ""}" type="button" data-person-tun="rolle">
          ${p.rolle === "mod" ? "Moderator entfernen" : "Zum Moderator machen"}</button>
        ` : ""}${owner && !selbst ? `
        <button class="ad-schalter" type="button" data-person-tun="umbenennen">Namen ändern</button>` : ""}
        ${geschuetzt ? "" : '<button class="ad-schalter" type="button" data-person-tun="kick">Rauswerfen</button><button class="ad-schalter" type="button" data-person-tun="schreiben">Anschreiben</button>'}
      </div>
      <p class="hint">${geschuetzt ? "Besitzer und andere Moderatoren sind geschützt." : (owner ? "Dauerhafte Kontosperren bleiben beim Besitzer. Zeitstrafen stehen darunter." : "Du kannst schreiben, trennen und zeitlich begrenzt moderieren.")}</p>

      ${geschuetzt ? "" : strafenBlock(p)}

      ${owner ? `<div class="ad-feld ad-feld-breit">
        <span>Chips setzen</span>
        <div class="ad-zeile">
          <input id="ad-chips" type="number" inputmode="numeric" min="0" step="1000" value="${chips}" />
          <button class="btn-secondary ad-knopf" type="button" data-person-tun="chips">Setzen</button>
        </div>
      </div>

      <div class="ad-knopfreihe">
        <button class="chip-btn" type="button" data-person-tun="bank">Bank leeren</button>
        <button class="chip-btn" type="button" data-person-tun="bonus">Geschenke wieder frei</button>
        ${selbst ? "" : '<button class="chip-btn" type="button" data-person-tun="ipban">IP sperren</button>'}
      </div>

      <div class="ad-feld ad-feld-breit">
        <span>Aus der Bestenliste nehmen</span>
        <div class="ad-knopfreihe">
          <button class="chip-btn" type="button" data-person-stat="bigwin">Größter Gewinn</button>
          <button class="chip-btn" type="button" data-person-stat="bigloss">Größter Verlust</button>
          <button class="chip-btn" type="button" data-person-stat="games">Aktivste</button>
        </div>
      </div>

      ${selbst ? "" : `<div class="ad-gefahr">
        <b>Nicht rückgängig zu machen</b>
        <div class="ad-knopfreihe">
          <button class="btn-danger ad-knopf" type="button" data-person-tun="achievements">Achievements zurücksetzen</button>
          <button class="btn-danger ad-knopf" type="button" data-person-tun="loeschen">Konto löschen</button>
        </div>
      </div>`}
      ` : ""}
      <div class="form-error" id="ad-person-error"></div>
    </div>`;

  // Die Felder haengen an der gewaehlten Strafe, nicht alle sind immer sinnvoll.
  $("#ad-straf-art")?.addEventListener("change", strafFormular);
  strafFormular();
}

/** Ein Klick in der Personenkarte. Alles läuft über dieselbe Rückmeldung. */
async function personTun(tun, name) {
  const fehler = $("#ad-person-error");
  if (fehler) fehler.textContent = "";
  const fertig = (text) => { toast(text); loadAdminAccounts(); };
  const melde = (r, text) => {
    if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return false; }
    fertig(text); return true;
  };

  if (tun === "rolle") {
    const p = adKonten.find((x) => x.name === name);
    const geben = !p || p.rolle !== "mod";
    const ok = await window.Casino.dialog.frage(
      geben
        ? `${name} zum Moderator machen? Die Person darf Chats und Bilder moderieren, Spieler zeitlich bestrafen, rauswerfen und Ansagen stellen. Geld, Konten, Events und Spielausgänge bleiben geschützt.`
        : `${name} die Moderator-Rechte entziehen?`,
      { titel: geben ? "Moderator ernennen" : "Moderator entfernen", okText: geben ? "Ernennen" : "Entfernen" });
    if (!ok) return;
    socket.emit("admin:setRolle", { target: name, rolle: geben ? "mod" : null }, (r) =>
      melde(r, geben ? `${name} ist jetzt Moderator.` : `${name} ist kein Moderator mehr.`));
    return;
  }

  if (tun === "chips") {
    const betrag = parseInt($("#ad-chips")?.value, 10);
    if (!Number.isFinite(betrag) || betrag < 0) { if (fehler) fehler.textContent = "Ungültiger Betrag."; return; }
    socket.emit("admin:setChips", { target: name, amount: betrag }, (r) =>
      melde(r, `${name}: ${betrag.toLocaleString("de-DE")} Chips.`));
    return;
  }
  if (tun === "lock" || tun === "unlock") {
    const sperren = tun === "lock";
    const p = adKonten.find((x) => x.name === name) || {};
    const text = sperren
      ? `${name} vollständig einsperren? Das Konto wird gesperrt${p.deviceKnown ? " und das zuletzt benutzte Browser-Gerät blockiert. In diesem Browser kann dann auch kein neuer Account erstellt werden." : ". Es ist noch kein Browser-Gerät bekannt, daher greift dort zunächst nur die Kontosperre."}`
      : `${name} vollständig entsperren? Konto und bekanntes Browser-Gerät werden wieder freigegeben.`;
    if (!await window.Casino.dialog.frage(text, {
      titel: sperren ? "Spieler einsperren" : "Sperre aufheben",
      okText: sperren ? "Jetzt einsperren" : "Entsperren",
      gefahr: sperren,
    })) return;
    socket.emit(sperren ? "admin:lockPlayer" : "admin:unlockPlayer", { target: name }, (r) => {
      if (!r || !r.ok) { if (fehler) fehler.textContent = r?.error || "Fehler."; return; }
      const zusatz = r.deviceKnown
        ? (sperren ? " Konto und Browser sind gesperrt." : " Konto und Browser sind wieder frei.")
        : (sperren ? " Konto gesperrt; noch kein Browser bekannt." : " Konto ist wieder frei.");
      fertig(`${name}:${zusatz}`);
      loadDeviceBans();
    });
    return;
  }
  if (tun === "straf") {
    const art = $("#ad-straf-art")?.value;
    const def = (adStrafArten || {})[art];
    if (!def) return;
    const minuten = parseInt($("#ad-straf-dauer")?.value, 10) || 0;
    const grund = ($("#ad-straf-grund")?.value || "").trim();
    const wert = def.wert ? parseInt($("#ad-straf-wert")?.value, 10) : undefined;
    const spiele = def.spiele
      ? Array.from(document.querySelectorAll("#ad-straf-spiele input:checked")).map((i) => i.value)
      : undefined;
    /* Rueckfrage, obwohl es sich zuruecknehmen laesst: eine Zeitsperre wirft
       jemanden mitten aus dem Spiel, und der Deckel trifft jede Runde. Wer es
       versehentlich tippt, merkt es erst an der Nachfrage des Bestraften. */
    const dauerText = AD_DAUERN.find((d) => d.v === minuten)?.t || `${minuten} min`;
    if (!await window.Casino.dialog.frage(
      `${name}: ${def.name}${def.wert ? ` (${wert})` : ""} für ${dauerText}?` +
      (grund ? `\n\nGrund: ${grund}` : "\n\nOhne Grund. Er liest dann nur, DASS etwas gilt."),
      { titel: def.name, okText: "Setzen", gefahr: true })) return;
    socket.emit("admin:strafeSetzen", { target: name, art, minuten, wert, spiele, grund }, (r) => {
      if (!melde(r, `${name}: ${def.name} gesetzt${r && r.getrennt ? `, ${r.getrennt} Verbindung${r.getrennt === 1 ? "" : "en"} getrennt` : ""}.`)) return;
      ladeStrafen();
    });
    return;
  }
  if (tun === "umbenennen") {
    const neu = await window.Casino.dialog.eingabe(
      `Wie soll ${name} heißen? Der neue Name steht sofort überall, auch rückwirkend in Chronik, Bestenlisten, Stadt und Auktion. Anmelden kann er sich weiter mit dem alten.`,
      { titel: "Namen ändern", platzhalter: "Neuer Name", okText: "Umbenennen" });
    if (!neu) return;
    socket.emit("admin:rename", { target: name, neu }, (r) => {
      if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
      const nz = r.nachgezogen || {};
      adGewaehlt = r.neu;
      fertig(`Aus ${r.alt} wird ${r.neu}. Nachgezogen: ${Object.entries(nz).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
    });
    return;
  }
  if (tun === "kick") {
    const grund = await window.Casino.dialog.eingabe(`${name} rauswerfen. Was soll er lesen?`,
      { titel: "Rauswerfen", wert: "", platzhalter: "Grund (kann leer bleiben)", okText: "Rauswerfen" });
    if (grund === null) return;
    socket.emit("admin:kick", { target: name, grund }, (r) =>
      melde(r, r && r.getrennt ? `${name}: ${r.getrennt} Verbindung${r.getrennt === 1 ? "" : "en"} getrennt.` : `${name} war nicht online.`));
    return;
  }
  if (tun === "schreiben") {
    const text = await window.Casino.dialog.eingabe(`Nachricht an ${name}:`,
      { titel: "Anschreiben", platzhalter: "Text", okText: "Schicken" });
    if (!text) return;
    socket.emit("admin:nachricht", { target: name, text, auchPush: istBesitzerUI() }, (r) =>
      melde(r, r && r.gesehen
        ? `${name} hat es gerade gelesen.`
        : (istBesitzerUI() ? `${name} ist offline, Benachrichtigung ist raus.` : `${name} ist offline; die Nachricht wurde nicht zugestellt.`)));
    return;
  }
  if (tun === "bank") {
    if (!await window.Casino.dialog.frage(`${name}: Bank wirklich leeren?`, { okText: "Leeren", gefahr: true })) return;
    socket.emit("admin:clearBank", { target: name }, (r) =>
      melde(r, `${name}: Bank geleert (${((r && r.cleared) || 0).toLocaleString("de-DE")} Chips).`));
    return;
  }
  if (tun === "bonus") {
    socket.emit("admin:resetBonus", { target: name }, (r) => melde(r, `${name}: Bonus, Soforthilfe, Rad und Kalender wieder frei.`));
    return;
  }
  if (tun === "ipban") {
    if (!await window.Casino.dialog.frage(`Die zuletzt bekannte IP von ${name} sperren?`, { okText: "Sperren", gefahr: true })) return;
    socket.emit("admin:ipban", { target: name }, (r) => {
      if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
      toast(`IP ${r.ip} gesperrt (${r.kicked} Verbindung${r.kicked === 1 ? "" : "en"} getrennt).`);
      loadIpBans();
    });
    return;
  }
  if (tun === "deviceban") {
    if (!await window.Casino.dialog.frage(`Das zuletzt von ${name} benutzte Gerät sperren? Andere Menschen im selben WLAN bleiben dabei unberührt.`, { okText: "Gerät sperren", gefahr: true })) return;
    socket.emit("admin:deviceban", { target: name }, (r) => {
      if (!r || !r.ok) { if (fehler) fehler.textContent = r?.error || "Fehler."; return; }
      toast(`Gerät …${r.id} gesperrt (${r.getrennt} Verbindung${r.getrennt === 1 ? "" : "en"} getrennt).`);
      loadDeviceBans();
    });
    return;
  }
  if (tun === "achievements") {
    if (!await window.Casino.dialog.frage(`${name}: alle Achievements zurücksetzen?`, { okText: "Zurücksetzen", gefahr: true })) return;
    socket.emit("admin:resetAchievements", { target: name }, (r) => melde(r, `${name}: Achievements zurückgesetzt.`));
    return;
  }
  if (tun === "loeschen") {
    if (!await window.Casino.dialog.frage(`Konto „${name}“ endgültig löschen? Chips, Erfolge, Kosmetik und Stadtbesitz sind weg.`, { okText: "Löschen", gefahr: true })) return;
    adGewaehlt = null;
    $("#ad-person")?.classList.add("hidden");
    socket.emit("admin:deleteAccount", { target: name }, (r) => melde(r, `${name} gelöscht.`));
  }
}

$("#ad-suche")?.addEventListener("input", zeichneKontenListe);

document.addEventListener("click", (e) => {
  const reihe = e.target.closest("[data-konto]");
  if (reihe) {
    const name = reihe.dataset.konto;
    if (adGewaehlt === name) { adGewaehlt = null; $("#ad-person")?.classList.add("hidden"); }
    else zeichnePerson(name);
    zeichneKontenListe();
    $("#ad-person")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (e.target.closest("[data-person-zu]")) {
    adGewaehlt = null;
    $("#ad-person")?.classList.add("hidden");
    zeichneKontenListe();
    return;
  }
  const weg = e.target.closest("[data-straf-weg]");
  if (weg && adGewaehlt) {
    const art = weg.dataset.strafWeg;
    socket.emit("admin:strafeAufheben", { target: adGewaehlt, art }, (r) => {
      toast(r && r.ok ? "Aufgehoben." : ((r && r.error) || "Fehler."));
      ladeStrafen();
    });
    return;
  }
  const stat = e.target.closest("[data-person-stat]");
  if (stat && adGewaehlt) {
    socket.emit("admin:resetStat", { target: adGewaehlt, stat: stat.dataset.personStat }, (r) => {
      toast(r && r.ok ? `${adGewaehlt}: aus der Bestenliste genommen.` : ((r && r.error) || "Fehler."));
    });
    return;
  }
  const tun = e.target.closest("[data-person-tun]");
  if (tun && adGewaehlt) personTun(tun.dataset.personTun, adGewaehlt);
});

function adminMoney(n) {
  return `${Math.floor(Number(n) || 0).toLocaleString("de-DE")}<i class=mk></i>`;
}

function adminTimeLeft(ts) {
  const ms = Math.max(0, (Number(ts) || 0) - Date.now());
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function loadAdminDashboard() {
  const box = $("#admin-dashboard");
  if (!box) return;
  box.innerHTML = '<div class="muted small">Dashboard lädt…</div>';
  socket.emit("admin:dashboard", (res) => {
    if (!res || !res.ok) { box.innerHTML = '<div class="muted small">Dashboard nicht verfügbar.</div>'; return; }
    const d = res.dashboard || {};
    const live = (d.events && d.events.liveops) || {};
    const tourney = live.tourney;
    const online = (d.online && d.online.players) || [];
    const winners = d.topWinners || [];
    const losers = d.topLosers || [];
    const alerts = d.alerts || [];
    /* Den Event-Zustand an die Karten weiterreichen. Happy Hour und Turnier
       kommen aus liveops, die vier kurzen aus ihren eigenen Modulen. */
    const ev = d.events || {};
    evOnline = d.online?.accounts || 0;
    evGeplant = ev.geplant || {};
    evZustand = {
      happy: live.happyActive ? { active: true, endsAt: live.happyUntil } : { active: false },
      tourney: tourney ? { active: true, endsAt: tourney.endsAt, prize: tourney.prize } : { active: false },
      heist: ev.heist || { active: !!ev.heistActive },
      rain: ev.rain || { active: !!ev.rainActive },
      quiz: ev.quiz || { active: !!ev.quizActive },
      vault: ev.vault || { active: !!ev.vaultActive },
    };
    const laufen = Object.entries(evZustand).filter(([, z]) => z.active).length;
    // Verlosung und Kassensturz haben keinen Zustand, den man zaehlen koennte.
    const miniList = (items, valFn, empty) => items.length
      ? items.map((p) => `<li><span>${escapeHtml(p.name)}</span><b>${valFn(p)}</b></li>`).join("")
      : `<li class="muted">${empty}</li>`;
    if (!istBesitzerUI()) {
      const strafenZahl = (d.strafen || []).reduce((n, p) => n + p.strafen.length, 0);
      box.innerHTML = `
        <div class="ad-kopf ad-lage-kopf"><h3>Moderation</h3><button class="chip-btn" id="admin-dash-refresh">Aktualisieren</button></div>
        <div class="ad-kacheln">
          <div class="ad-kachel"><div class="muted small">Online</div><b>${d.online?.accounts || 0} Spieler</b>
            <div class="small ad-kachel-liste">${online.length ? online.map((p) => escapeHtml(p.name)).join(", ") : "Niemand da"}</div></div>
          <div class="ad-kachel"><div class="muted small">Offene Strafen</div><b>${strafenZahl}</b>
            <div class="small muted">Verwalten im Reiter „Spieler“</div></div>
          <div class="ad-kachel"><div class="muted small">Konten</div><b>${d.totals?.accounts || 0}</b>
            <div class="small muted">Geldwerte bleiben privat.</div></div>
        </div>
        <div class="ad-notiz"><span>Du kannst Ansagen stellen, Inhalte prüfen, Spieler anschreiben oder trennen und zeitlich begrenzte Strafen setzen.</span></div>`;
      $("#admin-dash-refresh")?.addEventListener("click", loadAdminDashboard);
      return;
    }
    /* Drei Zustaende lassen sich versehentlich anlassen: die Wartung, eine
       Strafe und ein Regie-Zettel. Alle drei stehen deshalb ganz oben und
       nicht nur in ihrem Reiter. */
    adWartung = d.wartung || adWartung;
    zeichneWartung();
    const strafenZahl = (d.strafen || []).reduce((n, p) => n + p.strafen.length, 0);
    const regieZahl = (d.regie || []).length;
    box.innerHTML = `
      ${d.wartung && d.wartung.an ? `<div class="ad-alarm">
        <b>Das Casino ist geschlossen.</b>
        <span>${escapeHtml(d.wartung.text || "")}</span>
        <button class="chip-btn" id="ad-alarm-auf">Wieder aufmachen</button></div>` : ""}
      ${strafenZahl || regieZahl ? `<div class="ad-notiz">
        ${strafenZahl ? `<span><b>${strafenZahl}</b> offene ${strafenZahl === 1 ? "Strafe" : "Strafen"}: ${escapeHtml((d.strafen || []).map((p) => p.name).join(", "))}</span>` : ""}
        ${regieZahl ? `<span><b>${regieZahl}</b> ${regieZahl === 1 ? "Regie-Zettel liegt" : "Regie-Zettel liegen"} bereit</span>` : ""}
      </div>` : ""}
      <div class="ad-kopf ad-lage-kopf">
        <h3>Lage im Haus</h3>
        <button class="chip-btn" id="admin-dash-refresh">Aktualisieren</button>
      </div>
      <div class="ad-kacheln">
        <div class="ad-kachel">
          <div class="muted small">Online</div>
          <b>${d.online?.accounts || 0} ${(d.online?.accounts || 0) === 1 ? "Spieler" : "Spieler"}</b>
          <div class="small muted">${d.online?.sockets || 0} ${(d.online?.sockets || 0) === 1 ? "Fenster" : "Fenster"} verbunden</div>
          <div class="small ad-kachel-liste">${online.length ? online.map((p) => escapeHtml(p.name)).join(", ") : "Niemand da"}</div>
        </div>
        <div class="ad-kachel">
          <div class="muted small">Events</div>
          <b>${laufen ? `${laufen} ${laufen === 1 ? "läuft" : "laufen"}` : "Keins aktiv"}</b>
          <div class="small muted ad-kachel-liste">${
            laufen
              ? escapeHtml(EVENTS.filter((e) => (evZustand[e.id] || {}).active).map((e) => e.name).join(", "))
              : "Starten und stoppen im Reiter „Events“."}</div>
          <button class="chip-btn" id="admin-zu-events">Zu den Events</button>
        </div>
        <div class="ad-kachel">
          <div class="muted small">Chips im Umlauf</div>
          <b>${adminMoney(d.totals?.chips || 0)}</b>
          <div class="small muted">Auf der Bank: ${adminMoney(d.totals?.bank || 0)}</div>
          <div class="small muted">${d.totals?.accounts || 0} Konten</div>
        </div>
      </div>
      <div class="ad-kacheln">
        <div><div class="muted small ad-listen-kopf">Wochengewinner</div><ol class="leaderboard ad-mini">${miniList(winners, (p) => `+${adminMoney(p.weeklyNet)}`, "Keine Gewinne diese Woche.")}</ol></div>
        <div><div class="muted small ad-listen-kopf">Wochenverluste</div><ol class="leaderboard ad-mini">${miniList(losers, (p) => `-${adminMoney(Math.abs(p.weeklyNet || 0))}`, "Keine Verluste diese Woche.")}</ol></div>
        <div><div class="muted small ad-listen-kopf">Größte Einzelrunden</div><ol class="leaderboard ad-mini">${miniList(alerts, (p) => `<span class="ad-gut">+${adminMoney(p.biggestWin)}</span> <span class="ad-schlecht">−${adminMoney(p.biggestLoss)}</span>`, "Nichts Auffälliges.")}</ol></div>
      </div>`;
    $("#admin-dash-refresh")?.addEventListener("click", loadAdminDashboard);
    $("#ad-alarm-auf")?.addEventListener("click", () => wartungSetzen(false));
    /* Die sieben Sofort-Knoepfe sind weg. Sie feuerten ohne Rueckfrage mit
       fest eingebauten Werten, die ausserdem von den Feldern weiter unten
       abwichen, zwei Wahrheiten fuer dieselbe Sache, und ein Fehlklick auf
       "Regen" schuettete 250.000 Chips aus. Der Knopf fuehrt jetzt dorthin,
       wo man sieht, was man tut. */
    /* Der Knopf muss den Reiter wechseln, nicht scrollen: die Karten liegen
       in einer ausgeblendeten Tafel, dorthin zu scrollen fuehrt ins Leere. */
    $("#admin-zu-events")?.addEventListener("click", () => {
      document.querySelector('.ad-reiter-knopf[data-ad="events"]')?.click();
    });
    renderAdminEvents();
  });
}

/*
 * Stadt-Grundstuecke.
 *
 * Die Stadt hat 1292 davon. Vorher baute der Bildschirm sie alle als eigene
 * Knoepfe auf, und zwar bei jedem Oeffnen des Admin-Bereichs, auch wenn man
 * nur eine Ansage stellen wollte. Jetzt wird gesucht, gezeigt werden
 * hoechstens 25, und geladen wird erst beim Wechsel auf den Reiter.
 */
let adLots = [];

function loadAdminLots() {
  const list = $("#admin-lot-list");
  if (!list) return;
  list.innerHTML = '<li class="muted">Lädt…</li>';
  socket.emit("admin:cityLots", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">Fehler.</li>'; return; }
    adLots = res.lots || [];
    zeichneLots();
  });
}

function zeichneLots() {
  const list = $("#admin-lot-list");
  if (!list) return;
  const suche = ($("#ad-lot-suche")?.value || "").trim().toLowerCase();
  const treffer = suche
    ? adLots.filter((l) => `${l.name} ${l.owner || ""}`.toLowerCase().includes(suche))
    : adLots;
  const zaehler = $("#ad-lot-treffer");
  if (zaehler) zaehler.textContent = `${adLots.length} im Besitz`;

  if (!adLots.length) { list.innerHTML = '<li class="muted">Kein Gebäude im Besitz.</li>'; return; }
  if (!treffer.length) { list.innerHTML = '<li class="muted">Nichts gefunden.</li>'; return; }
  const zeigen = treffer.slice(0, 25);
  list.innerHTML = zeigen.map((l) => `<li>
      <span>${escapeHtml(l.name)} <span class="muted small">${l.owner ? escapeHtml(l.owner) : "?"}</span></span>
      <button class="chip-btn" type="button" data-lot="${escapeHtml(String(l.id))}">Freigeben</button>
    </li>`).join("")
    + (treffer.length > zeigen.length
      ? `<li class="muted small">… und ${treffer.length - zeigen.length} weitere. Zum Finden oben tippen.</li>` : "");
}

$("#ad-lot-suche")?.addEventListener("input", zeichneLots);

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-lot]");
  if (!btn) return;
  socket.emit("admin:clearLot", { plotId: btn.dataset.lot }, (r) => {
    if (r && r.ok) { toast("Gebäude freigegeben."); loadAdminLots(); }
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-reset-city-btn")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Wirklich die GANZE Stadt zurücksetzen? Alle Grundstücke und Unternehmen gehen an NPC zurück.", { okText: "Zurücksetzen", gefahr: true })) return;
  socket.emit("admin:resetCity", (r) => {
    if (r && r.ok) { toast("Stadt zurückgesetzt."); loadAdminLots(); }
    else toast((r && r.error) || "Fehler.");
  });
});

/* Ansage an alle (Admin)
   Vorher: ein Textfeld, zwei Knoepfe, fertig. Man sah nicht, ob gerade eine
   Ansage steht, nicht wie sie beim Spieler aussieht, nicht was man zuletzt
   gesagt hat, und sie blieb stehen, bis jemand daran dachte, sie
   wegzunehmen, bei "heute ab 20 Uhr" ist das der Normalfall. */

let anArt = "info";
let anArten = [{ id: "info", label: "Info" }, { id: "warnung", label: "Achtung" }, { id: "fest", label: "Fest" }];

const AN_SYMBOL = { info: "ansage", warnung: "alarm", fest: "geschenk" };

/** Wie lange eine Ansage noch steht, grob. */
function anRestText(bis) {
  const ms = bis - Date.now();
  if (ms <= 0) return "läuft ab";
  const min = Math.round(ms / 60000);
  if (min < 60) return `noch ${min} min`;
  const std = Math.round(min / 60);
  return std < 48 ? `noch ${std} h` : `noch ${Math.round(std / 24)} Tage`;
}

/** Die Vorschau zeigt dieselbe Zeile, die die Spieler oben sehen. */
function anVorschau() {
  const txt = ($("#admin-announcement-text")?.value || "").trim();
  const v = $("#an-vorschau");
  const t = $("#an-v-text");
  const m = $("#an-v-meta");
  const z = $("#an-zaehler");
  if (z) {
    const n = ($("#admin-announcement-text")?.value || "").length;
    z.textContent = `${n} / 220`;
    z.classList.toggle("knapp", n > 195);
  }
  if (!v || !t || !m) return;
  v.dataset.art = anArt;
  const sym = v.querySelector(".an-v-sym");
  if (sym) sym.innerHTML = window.Casino.icons.ui(AN_SYMBOL[anArt] || "ansage");
  t.textContent = txt || "…";
  const min = parseInt($("#an-dauer")?.value || "0", 10);
  const label = (anArten.find((a) => a.id === anArt) || {}).label || "Ansage";
  m.textContent = min
    ? `${label} · verschwindet nach ${$("#an-dauer").selectedOptions[0].textContent}`
    : `${label} · bleibt stehen`;
}

/** Ton-Auswahl aufbauen. */
function anArtenBauen() {
  const box = $("#an-arten");
  if (!box) return;
  box.innerHTML = anArten.map((a) =>
    `<button type="button" class="an-art${a.id === anArt ? " active" : ""}" data-art="${escapeHtml(a.id)}"
       role="radio" aria-checked="${a.id === anArt}">
       ${window.Casino.icons.ui(AN_SYMBOL[a.id] || "ansage")}${escapeHtml(a.label)}</button>`).join("");
  box.querySelectorAll(".an-art").forEach((b) => b.addEventListener("click", () => {
    anArt = b.dataset.art;
    anArtenBauen();
    anVorschau();
  }));
}

/** Stand und Verlauf vom Server holen. */
function ladeAnsage() {
  socket.emit("admin:announcementState", (res) => {
    if (!res || !res.ok) return;
    if (Array.isArray(res.arten) && res.arten.length) anArten = res.arten;
    anArtenBauen();

    // Steht gerade eine?
    const steht = $("#an-steht");
    if (steht) {
      const a = res.announcement;
      if (!a) {
        steht.classList.add("hidden");
        steht.innerHTML = "";
      } else {
        steht.classList.remove("hidden");
        steht.dataset.art = a.art || "info";
        const wann = new Date(a.at).toLocaleString("de-DE",
          { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        steht.innerHTML =
          `<span class="an-steht-sym">${window.Casino.icons.ui(AN_SYMBOL[a.art] || "ansage")}</span>` +
          `<div><b>Steht gerade oben</b><small>„${escapeHtml(a.text)}“</small>` +
          `<small class="muted">seit ${wann}${a.bis ? ` · ${anRestText(a.bis)}` : " · bleibt stehen"}</small></div>`;
      }
    }

    // Verlauf. Vorher gab es keinen, man wusste nicht, was man vor drei
    // Tagen geschrieben hatte, und schrieb es sinngemaess noch einmal.
    const vBox = $("#an-verlauf");
    const vWrap = $("#an-verlauf-box");
    const v = res.verlauf || [];
    if (vBox && vWrap) {
      if (!v.length) {
        vWrap.classList.add("hidden");
      } else {
        vWrap.classList.remove("hidden");
        vBox.innerHTML = v.map((e) => {
          const wann = new Date(e.at).toLocaleString("de-DE",
            { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          return `<button type="button" class="an-v-zeile" data-text="${escapeHtml(e.text)}" data-art="${escapeHtml(e.art || "info")}">
            <span>${escapeHtml(e.text)}</span><small>${wann}</small></button>`;
        }).join("");
        // Antippen uebernimmt den Text. Eine wiederkehrende Ansage
        // ("gleich Neustart") tippt man sonst jedes Mal neu.
        vBox.querySelectorAll(".an-v-zeile").forEach((b) => b.addEventListener("click", () => {
          const ta = $("#admin-announcement-text");
          if (ta) ta.value = b.dataset.text;
          anArt = b.dataset.art || "info";
          anArtenBauen();
          anVorschau();
          ta?.focus();
        }));
      }
    }
  });
}

$("#admin-announcement-text")?.addEventListener("input", anVorschau);
$("#an-dauer")?.addEventListener("change", anVorschau);

$("#admin-announcement-send")?.addEventListener("click", async () => {
  const errEl = $("#admin-announcement-error");
  const input = $("#admin-announcement-text");
  if (errEl) errEl.textContent = "";
  const text = (input?.value || "").trim();
  if (!text) {
    if (errEl) errEl.textContent = "Text eingeben.";
    return;
  }
  const push = !!$("#an-push")?.checked;
  const minuten = parseInt($("#an-dauer")?.value || "0", 10);

  /* Ein Push geht an alle, die gerade nicht da sind, und laesst sich nicht
     zurueckholen. Dafuer lohnt die eine Rueckfrage, der Knopf sitzt direkt
     neben dem fuer die stille Ansage. */
  if (push) {
    const ok = await window.Casino.dialog.frage(
      `Diese Ansage geht als Benachrichtigung an alle, die gerade nicht online sind:\n\n„${text}“\n\nDas lässt sich nicht zurücknehmen.`,
      { titel: "Wirklich benachrichtigen?", okText: "Senden" });
    if (!ok) return;
  }

  socket.emit("admin:announcement", { text, art: anArt, minuten, push }, (res) => {
    if (!res || !res.ok) {
      if (errEl) errEl.textContent = res?.error || "Fehler.";
      return;
    }
    renderAnnouncement(res.announcement);
    toast(push
      ? `Ansage steht, ${res.pushErreicht || 0} ${res.pushErreicht === 1 ? "Gerät" : "Geräte"} benachrichtigt.`
      : "Ansage steht.");
    if (input) input.value = "";
    anVorschau();
    ladeAnsage();
  });
});

$("#admin-announcement-clear")?.addEventListener("click", () => {
  const errEl = $("#admin-announcement-error");
  if (errEl) errEl.textContent = "";
  socket.emit("admin:announcementClear", (res) => {
    if (!res || !res.ok) {
      if (errEl) errEl.textContent = res?.error || "Fehler.";
      return;
    }
    renderAnnouncement(null);
    toast("Ansage weggenommen.");
    ladeAnsage();
  });
});

// Admin: IP-Bann
$("#admin-ipban-btn")?.addEventListener("click", () => {
  const errEl = $("#admin-ipban-error");
  errEl.textContent = "";
  const raw = $("#admin-ipban-input").value.trim();
  if (!raw) { errEl.textContent = "Spielername oder IP eingeben."; return; }
  // Enthält Punkte oder Doppelpunkte: als IP behandeln, sonst als Spielername.
  const isIp = /[.:]/.test(raw) && !/\s/.test(raw);
  socket.emit("admin:ipban", isIp ? { ip: raw } : { target: raw }, (res) => {
    if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
    toast(`IP ${res.ip} gesperrt (${res.kicked} Verbindung${res.kicked === 1 ? "" : "en"} getrennt).`);
    $("#admin-ipban-input").value = "";
    loadIpBans();
  });
});

function loadIpBans() {
  const list = $("#admin-ipban-list");
  if (!list) return;
  socket.emit("admin:ipbanList", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">-</li>'; return; }
    if (!res.bans.length) { list.innerHTML = '<li class="muted">Keine IP gesperrt.</li>'; return; }
    list.innerHTML = "";
    res.bans.forEach((b) => {
      const li = document.createElement("li");
      const who = b.accounts && b.accounts.length ? ` <span class="muted small">(${b.accounts.map(escapeHtml).join(", ")})</span>` : "";
      li.innerHTML = `<span><code>${escapeHtml(b.ip)}</code>${who}</span>`;
      const btn = document.createElement("button");
      btn.className = "btn-primary";
      btn.style.cssText = "font-size:.75rem;padding:4px 10px";
      btn.textContent = "Entsperren";
      btn.addEventListener("click", () => {
        socket.emit("admin:ipunban", { ip: b.ip }, (r) => {
          if (!r || !r.ok) { toast("Konnte IP nicht entsperren."); return; }
          toast(`IP ${b.ip} entsperrt.`);
          loadIpBans();
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  });
}

function loadDeviceBans() {
  const list = $("#admin-deviceban-list");
  if (!list) return;
  socket.emit("admin:devicebanList", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">-</li>'; return; }
    if (!res.bans.length) { list.innerHTML = '<li class="muted">Kein Gerät gesperrt.</li>'; return; }
    list.innerHTML = "";
    res.bans.forEach((b) => {
      const li = document.createElement("li");
      const who = b.accounts?.length ? ` <span class="muted small">(${b.accounts.map(escapeHtml).join(", ")})</span>` : "";
      li.innerHTML = `<span><code>Gerät …${escapeHtml(b.id)}</code>${who}</span>`;
      const btn = document.createElement("button");
      btn.className = "btn-primary";
      btn.style.cssText = "font-size:.75rem;padding:4px 10px";
      btn.textContent = "Entsperren";
      btn.addEventListener("click", () => socket.emit("admin:deviceunban", { id: b.id }, (r) => {
        toast(r?.ok ? `Gerät …${b.id} entsperrt.` : (r?.error || "Fehler."));
        loadDeviceBans();
      }));
      li.appendChild(btn);
      list.appendChild(li);
    });
  });
}

// Beim Öffnen des Admin-Screens die IP-Bann-Liste mitladen.
socket.on("ipbanned", (d = {}) => {
  window.Casino.dialog.hinweis(d.device ? "Dieses Gerät wurde gesperrt." : "Dieses Netzwerk wurde gesperrt.");
});

// Admin: Test-Tools
$("#admin-force-win-btn")?.addEventListener("click", () => {
  socket.emit("admin:slotsForceWin", (r) => {
    if (r && r.ok) toast("Scharf gestellt: dein nächster Slot-Dreh zahlt den Maximalgewinn.");
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-city-event-btn")?.addEventListener("click", () => {
  socket.emit("admin:cityEvent", {}, (r) => {
    if (r && r.ok) toast(`Ausgelöst: ${r.event.txt}`);
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-new-week-btn")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Woche JETZT beenden? Kürt den Spieler der Woche und würfelt eine neue Goldene Straße.", { okText: "Beenden" })) return;
  socket.emit("admin:newWeek", (r) => {
    if (r && r.ok) toast("Neue Woche gestartet, steht im Chat.");
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-comeback-on-btn")?.addEventListener("click", async () => {
  const minutes = parseInt($("#admin-comeback-mins").value, 10) || 120;
  const pot = parseInt($("#admin-comeback-pot").value, 10) || 250000;
  // Einmal nachfragen: das laesst sich nicht zurueckdrehen, und alle
  // einundsiebzig Konten bekommen sofort eine Nachricht.
  const ja = await window.Casino.dialog.frage(
    `Wiedereröffnung jetzt ausrufen?\n\nAlle bekommen 14 Tage lang ihr Willkommens-Paket, die Gala läuft ${minutes} Minuten mit ${pot.toLocaleString("de-DE")} Chips im Topf. Es geht eine Ansage in den Chat und eine Benachrichtigung an alle, die welche anhaben.`,
    { titel: "Wiedereröffnung", okText: "Ausrufen" });
  if (!ja) return;
  socket.emit("admin:comeback", { on: true, minutes, pot }, (r) =>
    toast(r?.ok ? `Wiedereröffnung läuft: Gala ${r.minuten} Min, ${Number(r.topf).toLocaleString("de-DE")} Chips im Topf.` : (r?.error || "Fehler.")));
});
$("#admin-comeback-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:comeback", { on: false }, (r) => toast(r?.ok ? "Gala abgerechnet." : (r?.error || "Fehler.")));
});

/* Wartung
   Zwischen "laeuft" und "Server aus" gab es nichts, und deshalb wurde an der
   Wirtschaft im laufenden Betrieb geschraubt, waehrend Leute spielen. */
let adWartung = { an: false, text: "", standardText: "", zugang: [] };

function zeichneWartung() {
  const z = $("#ad-wartung-zustand");
  if (z) {
    const n = (adWartung.zugang || []).length;
    z.textContent = adWartung.an
      ? (n ? `geschlossen, ${n} im Test` : "geschlossen")
      : "offen";
    z.classList.toggle("zu", !!adWartung.an);
  }
  $("#ad-wartung-karte")?.classList.toggle("an", !!adWartung.an);
  const feld = $("#ad-wartung-text");
  if (feld) {
    if (adWartung.standardText) feld.placeholder = adWartung.standardText;
    if (!feld.value && adWartung.an) feld.value = adWartung.text || "";
  }
  const liste = $("#ad-test-liste");
  if (liste) {
    const leute = adWartung.zugang || [];
    liste.innerHTML = leute.length
      ? leute.map((n) => `<span class="ad-test-chip">${window.Casino.escapeHtml(n)}`
          + `<button type="button" data-test-raus="${window.Casino.escapeHtml(n)}" aria-label="${window.Casino.escapeHtml(n)} wieder aussperren">×</button></span>`).join("")
        + `<button type="button" class="ad-test-leeren" id="ad-test-leeren">Alle entfernen</button>`
      : `<span class="hint">Niemand. Bei geschlossenem Haus kommst nur du rein.</span>`;
  }
}

/* Testzugang: rein, raus, alle raus. Eine Runde je Knopf, und der Server
   schickt danach den ganzen Stand zurueck — so kann die Liste hier nicht
   von dem abweichen, was wirklich gilt. */
function testzugang(tun, name) {
  socket.emit("admin:testzugang", { tun, name }, (r) => {
    if (!r || !r.ok) return toast((r && r.error) || "Fehler.");
    adWartung = { ...adWartung, an: r.an, text: r.text, zugang: r.zugang || [] };
    zeichneWartung();
    const feld = $("#ad-test-name");
    if (feld && tun !== "raus" && tun !== "leeren") feld.value = "";
    toast(tun === "leeren" ? "Testliste geleert."
      : tun === "raus" ? `${name} ist wieder ausgesperrt.`
      : `${name} darf rein.`);
  });
}

$("#ad-test-add")?.addEventListener("click", () => {
  const n = ($("#ad-test-name")?.value || "").trim();
  if (!n) return toast("Welcher Spieler?");
  testzugang("rein", n);
});
$("#ad-test-name")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#ad-test-add")?.click(); }
});
document.addEventListener("click", (e) => {
  const raus = e.target.closest("[data-test-raus]");
  if (raus) { testzugang("raus", raus.dataset.testRaus); return; }
  if (e.target.closest("#ad-test-leeren")) testzugang("leeren");
});

function wartungSetzen(zu) {
  const text = ($("#ad-wartung-text")?.value || "").trim();
  socket.emit("admin:wartung", { on: !!zu, text }, (r) => {
    if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
    adWartung = { an: r.an, text: r.text, zugang: r.zugang || [], standardText: r.standardText || adWartung.standardText };
    zeichneWartung();
    toast(zu
      ? `Casino geschlossen${r.getrennt ? `, ${r.getrennt} rausgeschickt` : ""}.`
      : "Casino ist wieder offen.");
    loadAdminDashboard();
  });
}

$("#ad-wartung-zu")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage(
    "Das Casino für alle schließen? Wer gerade spielt, wird getrennt. Du selbst kommst weiter rein.",
    { titel: "Wartung", okText: "Schließen", gefahr: true })) return;
  wartungSetzen(true);
});
$("#ad-wartung-auf")?.addEventListener("click", () => wartungSetzen(false));

/* Regie: das naechste Ergebnis setzen
   Ein Formular je Ziel, weil die Ziele nichts gemeinsam haben: Slots braucht
   eine Auswahl, das Rad ein Feld, Roulette eine Zahl, Crash eine Kommazahl
   und keinen Spieler. */
let adRegieZiele = null, adRadFelder = [];

function zeichneRegie(liegt) {
  const box = $("#ad-regie-formulare");
  if (box && adRegieZiele) {
    box.innerHTML = Object.entries(adRegieZiele).map(([id, z]) => `
      <div class="ad-regie" data-regie="${id}">
        <div class="ad-regie-kopf"><b>${escapeHtml(z.name)}</b><small>${escapeHtml(z.was || "")}</small></div>
        <div class="ad-felder">
          ${z.global ? "" : `<label class="ad-feld"><span>Spieler</span>
            <input type="text" maxlength="24" data-regie-wer placeholder="Name" autocomplete="off" /></label>`}
          <label class="ad-feld"><span>Ergebnis</span>
            ${z.art === "wahl"
              ? `<select data-regie-wert>${Object.entries(z.optionen).map(([w, t]) => `<option value="${escapeHtml(w)}">${escapeHtml(t)}</option>`).join("")}</select>`
              : z.art === "feld"
                ? `<select data-regie-wert>${adRadFelder.map((f) => `<option value="${f.i}">${escapeHtml(f.label)}</option>`).join("")}</select>`
                : `<input type="number" inputmode="decimal" data-regie-wert value="${z.vorgabe != null ? z.vorgabe : 0}" min="${z.min}" max="${z.max}"${z.schritt ? ` step="${z.schritt}"` : ""} />`}
          </label>
          <button class="btn-secondary ad-knopf" type="button" data-regie-setzen>Setzen</button>
        </div>
      </div>`).join("");
  }
  const liste = $("#ad-regie-liste");
  if (!liste) return;
  liste.innerHTML = (liegt || []).length
    ? liegt.map((l) => `
      <div class="ad-strafchip">
        <b>${escapeHtml(l.name)}</b>
        <span>${escapeHtml(l.text)}</span>
        <small>${l.wer === "*" ? "für alle" : escapeHtml(l.wer)}</small>
        <button class="ad-strafweg" type="button" data-regie-weg="${escapeHtml(l.ziel)}" data-regie-wer="${escapeHtml(l.wer)}" aria-label="Wegnehmen">✕</button>
      </div>`).join("")
    : '<div class="muted small">Nichts. Alle Spiele würfeln ehrlich.</div>';
}

function ladeRegie() {
  socket.emit("admin:regie", (r) => {
    if (!r || !r.ok) return;
    adRegieZiele = r.ziele;
    adRadFelder = r.radFelder || [];
    zeichneRegie(r.liegt);
  });
}

document.addEventListener("click", (e) => {
  const setzen = e.target.closest("[data-regie-setzen]");
  if (setzen) {
    const karte = setzen.closest("[data-regie]");
    const ziel = karte.dataset.regie;
    const fehler = $("#ad-regie-error");
    if (fehler) fehler.textContent = "";
    const wer = karte.querySelector("[data-regie-wer]")?.value || "";
    const wert = karte.querySelector("[data-regie-wert]")?.value;
    socket.emit("admin:regieSetzen", { target: wer, ziel, wert }, (r) => {
      if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
      toast("Zettel liegt. Gilt genau einmal.");
      ladeRegie();
    });
    return;
  }
  const weg = e.target.closest("[data-regie-weg]");
  if (weg) {
    socket.emit("admin:regieLoeschen", { target: weg.dataset.regieWer, ziel: weg.dataset.regieWeg }, (r) => {
      toast(r && r.ok ? "Weggenommen." : ((r && r.error) || "Fehler."));
      ladeRegie();
    });
  }
});

/* Nachricht an einen Spieler */
$("#ad-nachricht-senden")?.addEventListener("click", () => {
  const fehler = $("#ad-nachricht-error");
  if (fehler) fehler.textContent = "";
  const target = ($("#ad-nachricht-wer")?.value || "").trim();
  const text = ($("#ad-nachricht-text")?.value || "").trim();
  if (!target || !text) { if (fehler) fehler.textContent = "Name und Text ausfüllen."; return; }
  socket.emit("admin:nachricht", { target, text, auchPush: !!$("#ad-nachricht-push")?.checked }, (r) => {
    if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
    $("#ad-nachricht-text").value = "";
    toast(r.gesehen ? "Angekommen, er ist online." : "Er ist offline, Benachrichtigung ist raus.");
  });
});

/* Kosmetik von Hand geben und wegnehmen */
let adKosKatalog = null;

function ladeKosKatalog() {
  if (adKosKatalog) return;
  socket.emit("admin:kosmetikKatalog", (r) => {
    if (!r || !r.ok) return;
    adKosKatalog = r.katalog;
    const art = $("#ad-kos-art");
    if (!art) return;
    const NAMEN = { avatar: "Bild", color: "Namensfarbe", style: "Namensstil", frame: "Rahmen",
      title: "Titel", effect: "Gewinn-Effekt", spruch: "Eintritts-Spruch", banner: "Profil-Streifen",
      schild: "Schild", aura: "Aura", karte: "Kartenrücken" };
    art.innerHTML = Object.keys(adKosKatalog).map((a) => `<option value="${a}">${escapeHtml(NAMEN[a] || a)}</option>`).join("");
    kosStuecke();
    art.addEventListener("change", kosStuecke);
  });
}

function kosStuecke() {
  const art = $("#ad-kos-art")?.value;
  const sel = $("#ad-kos-id");
  if (!sel || !adKosKatalog || !adKosKatalog[art]) return;
  sel.innerHTML = adKosKatalog[art].map((it) =>
    `<option value="${escapeHtml(it.id)}">${escapeHtml(it.label)}${it.limitiert ? " (limitiert)" : ""}</option>`).join("");
}

function kosTun(weg) {
  const fehler = $("#ad-kos-error");
  if (fehler) fehler.textContent = "";
  const target = ($("#ad-kos-wer")?.value || "").trim();
  const art = $("#ad-kos-art")?.value, id = $("#ad-kos-id")?.value;
  if (!target) { if (fehler) fehler.textContent = "Spielername fehlt."; return; }
  socket.emit("admin:kosmetik", { target, art, id, weg }, (r) => {
    if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
    toast(weg ? `${r.label} weggenommen.` : (r.neu ? `${r.label} geschenkt.` : `Hatte ${r.label} schon.`));
  });
}

$("#ad-kos-geben")?.addEventListener("click", () => kosTun(false));
$("#ad-kos-nehmen")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Stück wirklich wegnehmen? Es wird auch abgelegt, falls er es gerade trägt.",
    { okText: "Wegnehmen", gefahr: true })) return;
  kosTun(true);
});

/* Echte Fussballspiele.

   Der Besitzer hat gemeldet, dass beim Hoster nur simulierte Partien laufen.
   Sichtbar war das vorher nirgends: der Zugang kam aus einer Umgebungsvariablen
   und meldete sich nur in einer Konsolenzeile beim Start. Diese Karte sagt, ob
   er da ist, was der Anbieter zuletzt geantwortet hat und wie viele Spiele
   ankamen. */
let adSport = null;

function zeichneSport() {
  const zustand = $("#ad-sport-zustand");
  const box = $("#ad-sport-stand");
  if (!zustand || !box || !adSport) return;
  const an = adSport.an && !!adSport.letzterErfolg;
  zustand.textContent = !adSport.an ? "kein Zugang" : an ? "läuft" : "antwortet nicht";
  zustand.classList.toggle("zu", !an);
  $("#ad-sport-karte")?.classList.toggle("an", !an);

  const zeit = (ts) => (ts ? new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "nie");
  const comps = Object.entries(adSport.proWettbewerb || {});
  box.innerHTML = `
    <div class="ad-sport-zeilen">
      <div><span>Zugang</span><b>${adSport.an ? `gesetzt (endet auf ${escapeHtml(adSport.endet)}, aus ${adSport.quelle === "umgebung" ? "der Umgebung des Hosters" : "der Datei"})` : "keiner, es laufen nur Simulationen"}</b></div>
      <div><span>Wettbewerbe</span><b>${escapeHtml((adSport.wettbewerbe || []).join(", "))}</b></div>
      <div><span>Zuletzt geholt</span><b>${zeit(adSport.letzterLauf)}${adSport.letzterErfolg ? `, erfolgreich ${zeit(adSport.letzterErfolg)}` : ""}</b></div>
      <div><span>Spiele gerade</span><b>${adSport.echte} echte, ${adSport.simulierte} simulierte</b></div>
      ${comps.length ? `<div><span>Antworten</span><b>${comps.map(([c, w]) =>
        `${escapeHtml(c)}: ${w.status === 200 ? `${w.spiele} Spiele` : w.status ? `HTTP ${w.status}` : "kein Kontakt"}`).join(" · ")}</b></div>` : ""}
      ${adSport.fehler ? `<div><span>Zuletzt schiefgegangen</span><b class="ad-schlecht">${escapeHtml(adSport.fehler)}</b></div>` : ""}
    </div>`;
  const feld = $("#ad-sport-token");
  if (feld) {
    const fest = adSport.quelle === "umgebung";
    feld.disabled = fest;
    feld.placeholder = fest ? "Kommt vom Hoster, hier nicht änderbar" : "Schlüssel eintragen";
  }
}

function ladeSport() {
  socket.emit("admin:sport", (r) => {
    if (!r || !r.ok) return;
    adSport = r;
    zeichneSport();
  });
}

socket.on("admin:sportUpdate", (stand) => { adSport = stand; zeichneSport(); });

$("#ad-sport-speichern")?.addEventListener("click", () => {
  const fehler = $("#ad-sport-error");
  if (fehler) fehler.textContent = "";
  const token = ($("#ad-sport-token")?.value || "").trim();
  if (!token) { if (fehler) fehler.textContent = "Kein Schlüssel eingegeben."; return; }
  socket.emit("admin:sportToken", { token }, (r) => {
    if (!r || !r.ok) { if (fehler) fehler.textContent = (r && r.error) || "Fehler."; return; }
    $("#ad-sport-token").value = "";
    adSport = r; zeichneSport();
    toast("Gespeichert, die Spiele werden gerade geholt.");
    setTimeout(ladeSport, 9000);
  });
});

$("#ad-sport-holen")?.addEventListener("click", () => {
  socket.emit("admin:sportHolen", (r) => {
    toast(r?.ok ? "Wird geholt, gleich steht der Stand hier." : (r?.error || "Fehler."));
    setTimeout(ladeSport, 9000);
  });
});

$("#ad-sport-weg")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Schlüssel entfernen? Danach laufen nur noch simulierte Spiele.",
    { okText: "Entfernen", gefahr: true })) return;
  socket.emit("admin:sportToken", { token: "" }, (r) => {
    if (r && r.ok) { adSport = r; zeichneSport(); toast("Schlüssel entfernt."); }
    else toast((r && r.error) || "Fehler.");
  });
});

/* Gutschrift für alle */
$("#ad-alle-geben")?.addEventListener("click", async () => {
  const fehler = $("#ad-alle-error");
  if (fehler) fehler.textContent = "";
  const betrag = Math.floor(Number($("#ad-alle-betrag")?.value));
  const grund = ($("#ad-alle-grund")?.value || "").trim();
  if (!Number.isFinite(betrag) || betrag < 1) {
    if (fehler) fehler.textContent = "Betrag eintragen.";
    return;
  }
  if (!await window.Casino.dialog.frage(`Jedem Konto ${betrag.toLocaleString("de-DE")} Chips gutschreiben?`,
    { okText: "Gutschreiben", gefahr: true })) return;
  socket.emit("admin:alleChips", { amount: betrag, grund }, (r) => {
    if (!r || !r.ok) {
      if (fehler) fehler.textContent = (r && r.error) || "Fehler.";
      return;
    }
    toast(`${r.anzahl} Konten haben je ${betrag.toLocaleString("de-DE")} Chips bekommen.`);
  });
});

/* Chat leeren */
$("#ad-chat-leeren")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Den allgemeinen Chat bei allen leeren?",
    { okText: "Leeren", gefahr: true })) return;
  socket.emit("admin:chatLeeren", (r) => toast(r?.ok ? "Chat geleert." : (r?.error || "Fehler.")));
});

/* Wortfilter (Admin)
   Die Liste gehoert dem Haus, nicht dem Programm: was in einer Runde als
   schlimm gilt, entscheidet die Runde. Deshalb laesst sich hier beides
   pflegen: was gefiltert wird und was ausdruecklich nicht. */
function wfZeichne(d) {
  const basis = $("#wf-basis");
  if (basis) basis.textContent = `Die Basisliste umfasst ${d.basisAnzahl} Wörter.`;

  const male = (box, woerter, art, leer) => {
    if (!box) return;
    if (!woerter.length) { box.innerHTML = `<p class="muted small">${leer}</p>`; return; }
    box.innerHTML = woerter.map((w) =>
      `<span class="wf-wort">${escapeHtml(w)}${istBesitzerUI() ? `<button type="button" data-wf-weg="${escapeHtml(w)}"
        data-wf-art="${art}" aria-label="Entfernen">${window.Casino.icons.ui("schliessen")}</button>` : ""}</span>`).join("");
    box.querySelectorAll("[data-wf-weg]").forEach((b) => b.addEventListener("click", () => {
      socket.emit("admin:filterRemove", { wort: b.dataset.wfWeg, art: b.dataset.wfArt }, (r) => {
        if (r && r.ok) { wfZeichne(r); wfProbe(); }
        else toast(r?.error || "Fehler.");
      });
    }));
  };
  male($("#wf-liste"), d.eigene || [], "wort", "Noch nichts Eigenes, die Basisliste greift trotzdem.");
  male($("#wf-liste-aus"), d.ausnahmen || [], "ausnahme", "Keine Ausnahmen.");
}

function wfLade() {
  socket.emit("admin:filterState", (r) => { if (r && r.ok) wfZeichne(r); });
}

/* Die Probe laeuft im Server, nicht im Browser: der Filter ist dort, und
   eine zweite Fassung im Client waere eine zweite Wahrheit. */
let wfProbeTimer = null;
function wfProbe() {
  const feld = $("#wf-probe-text");
  const aus = $("#wf-probe-aus");
  if (!feld || !aus) return;
  const text = feld.value.trim();
  if (!text) { aus.textContent = "-"; aus.className = "wf-probe-aus"; return; }
  clearTimeout(wfProbeTimer);
  wfProbeTimer = setTimeout(() => {
    socket.emit("admin:filterProbe", { text }, (r) => {
      if (!r || !r.ok) return;
      /* Die gefundenen Woerter standen im title, auf dem iPad also
         nirgends. Sie sind das Einzige, was die Probe wirklich beantwortet. */
      aus.innerHTML = `<span class="wf-probe-text">${escapeHtml(r.entschaerft)}</span>` +
        (r.treffer.length
          ? `<small class="wf-probe-treffer">Gefunden: ${escapeHtml(r.treffer.join(", "))}</small>`
          : `<small class="wf-probe-treffer">Nichts beanstandet.</small>`);
      aus.className = "wf-probe-aus" + (r.treffer.length ? " getroffen" : " sauber");
    });
  }, 220);
}

$("#wf-add")?.addEventListener("click", () => {
  const f = $("#wf-neu"); const err = $("#wf-error");
  if (err) err.textContent = "";
  socket.emit("admin:filterAdd", { wort: f.value, art: "wort" }, (r) => {
    if (r && r.ok) { f.value = ""; wfZeichne(r); wfProbe(); }
    else if (err) err.textContent = r?.error || "Fehler.";
  });
});
$("#wf-add-aus")?.addEventListener("click", () => {
  const f = $("#wf-neu-aus"); const err = $("#wf-error");
  if (err) err.textContent = "";
  socket.emit("admin:filterAdd", { wort: f.value, art: "ausnahme" }, (r) => {
    if (r && r.ok) { f.value = ""; wfZeichne(r); wfProbe(); }
    else if (err) err.textContent = r?.error || "Fehler.";
  });
});
$("#wf-probe-text")?.addEventListener("input", wfProbe);

/* Hochgeladene Bilder im Admin. Gemeldete zuerst, sie sind der Grund,
   warum es diese Ansicht gibt. */
function blLade() {
  const aus = $("#bl-aus");
  if (aus) aus.innerHTML = '<p class="muted small">Lädt…</p>';
  socket.emit("admin:bilder", (r) => {
    if (!r || !r.ok) { if (aus) aus.innerHTML = '<p class="muted small">Fehler.</p>'; return; }
    const gemeldet = new Map((r.meldungen || []).map((m) => [m.clanId, m]));
    const liste = (r.bilder || []).slice().sort((a, b) =>
      (gemeldet.has(b.id) ? 1 : 0) - (gemeldet.has(a.id) ? 1 : 0));
    if (!liste.length) {
      if (aus) aus.innerHTML = '<p class="muted small">Noch keine Bilder hochgeladen.</p>';
      return;
    }
    if (!aus) return;
    aus.innerHTML = `<div class="bl-raster">` + liste.map((b) => {
      const m = gemeldet.get(b.id);
      return `<div class="bl-karte${m ? " gemeldet" : ""}">
        <img src="${escapeHtml(b.url)}" alt="" loading="lazy" />
        <div class="bl-info">
          <b>${escapeHtml(b.id)}</b>
          <small>${Math.round(b.bytes / 1024)} KB · ${new Date(b.at).toLocaleDateString("de-DE")}</small>
          ${m ? `<small class="bl-grund">Gemeldet von ${escapeHtml(m.von)}${m.grund ? `: „${escapeHtml(m.grund)}“` : ""}</small>` : ""}
        </div>
        <div class="bl-knoepfe">
          <button class="icon-btn icon-btn-gefahr bl-weg" data-art="${escapeHtml(b.art)}" data-id="${escapeHtml(b.id)}">Entfernen</button>
          ${m ? `<button class="icon-btn bl-ok" data-id="${escapeHtml(b.id)}">Passt schon</button>` : ""}
        </div>
      </div>`;
    }).join("") + `</div>`;

    aus.querySelectorAll(".bl-weg").forEach((btn) => btn.addEventListener("click", async () => {
      if (!await window.Casino.dialog.frage("Dieses Bild entfernen?", { okText: "Entfernen", gefahr: true })) return;
      socket.emit("admin:bildWeg", { art: btn.dataset.art, id: btn.dataset.id, meldungErledigen: true }, (x) => {
        toast(x?.ok ? "Bild entfernt." : (x?.error || "Fehler."));
        blLade();
      });
    }));
    aus.querySelectorAll(".bl-ok").forEach((btn) => btn.addEventListener("click", () => {
      socket.emit("admin:meldungOk", { clanId: btn.dataset.id }, (x) => {
        toast(x?.ok ? "Meldung abgehakt." : (x?.error || "Fehler."));
        blLade();
      });
    }));
  });
}
$("#bl-laden")?.addEventListener("click", blLade);

$("#wf-bestand-btn")?.addEventListener("click", () => {
  const aus = $("#wf-bestand-aus");
  if (aus) aus.innerHTML = '<p class="muted small">Prüfe…</p>';
  socket.emit("admin:filterPruefeBestand", (r) => {
    if (!r || !r.ok) { if (aus) aus.innerHTML = '<p class="muted small">Fehler.</p>'; return; }
    const zeilen = [];
    for (const a of r.accounts || []) {
      zeilen.push(`<div class="wf-bz"><b>${escapeHtml(a.name)}</b>
        <small>Account · ${escapeHtml(a.woerter.join(", "))}</small></div>`);
    }
    for (const c of r.clans || []) {
      zeilen.push(`<div class="wf-bz"><b>[${escapeHtml(c.tag)}] ${escapeHtml(c.name)}</b>
        <small>Clan · ${escapeHtml(c.woerter.join(", "))}</small></div>`);
    }
    if (aus) {
      aus.innerHTML = zeilen.length
        ? `<p class="hint">${zeilen.length} ${zeilen.length === 1 ? "Eintrag" : "Einträge"} von ${r.geprueft} geprüften. Umbenennen kannst du im Reiter „Spieler“.</p>` + zeilen.join("")
        : `<p class="wf-sauber">${window.Casino.icons.ui("ja")}Nichts gefunden, ${r.geprueft} Namen geprüft.</p>`;
    }
  });
});

/* Events (Admin)
   Vorher an zwei Orten mit zwei verschiedenen Wahrheiten: oben im Dashboard
   sieben Knoepfe, die sofort und ohne Rueckfrage mit fest eingebauten Werten
   feuerten, und unten sechs Zeilen mit nackten Zahlenfeldern, deren
   Bedeutung nur im title-Attribut stand, auf dem iPad also nirgends. Ein
   Fehlklick auf "Regen" schuettete 250.000 Chips aus.

   Jetzt: eine Karte je Event, beschriftete Felder, der Zustand mit Restzeit
   auf der Karte, und eine Rueckfrage vor allem, was Chips ausschuettet. */

const EVENTS = [
  {
    id: "happy", name: "Happy Hour", icon: "geschenk", ev: "admin:happyHour",
    was: "Doppelte Belohnung für alle Aufträge, solange sie läuft.",
    felder: [{ k: "minutes", label: "Minuten", wert: 60, min: 1, max: 240 }],
  },
  {
    id: "tourney", name: "Slot-Turnier", icon: "bestenliste", ev: "admin:tourney",
    was: "Wer den größten Slot-Gewinn landet, nimmt den Topf. Live-Tabelle für alle.",
    chips: true,
    felder: [
      { k: "minutes", label: "Minuten", wert: 10, min: 1, max: 120 },
      { k: "prize", label: "Preis", wert: 100000, min: 0, schritt: 10000, geld: true },
    ],
  },
  {
    id: "heist", name: "Casino-Heist", icon: "alarm", ev: "admin:heist",
    was: "Alle knacken gemeinsam einen Tresor. Der Tresor wird härter, je mehr online sind.",
    chips: true, braucht: 2, vorlauf: true,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 60, min: 15, max: 300 },
      { k: "loot", label: "Beute", wert: 500000, min: 1000, schritt: 50000, geld: true },
    ],
  },
  {
    id: "rain", name: "Chip-Regen", icon: "chip", ev: "admin:rain",
    was: "Chips fallen über den Bildschirm, wer zuerst tippt, bekommt sie.",
    chips: true, vorlauf: true,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 30, min: 10, max: 180 },
      { k: "pot", label: "Topf", wert: 250000, min: 1000, schritt: 50000, geld: true },
    ],
  },
  {
    id: "quiz", name: "Blitz-Quiz", icon: "frage", ev: "admin:quiz",
    was: "Ein paar schnelle Fragen, wer zuerst richtig antwortet, kassiert.",
    chips: true, vorlauf: true,
    felder: [
      { k: "rounds", label: "Fragen", wert: 5, min: 1, max: 15 },
      { k: "prize", label: "Preis je Frage", wert: 20000, min: 500, schritt: 5000, geld: true },
    ],
  },
  {
    id: "vault", name: "Tresorkampf", icon: "krieg", ev: "admin:teamvault",
    was: "Zwei Mannschaften hauen um die Wette. Braucht Leute auf beiden Seiten.",
    chips: true, braucht: 2, vorlauf: true,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 90, min: 20, max: 300 },
      { k: "pot", label: "Topf", wert: 500000, min: 1000, schritt: 50000, geld: true },
    ],
  },
  /* Die beiden Letzten laufen nicht, sie passieren: ein Knopf, ein Ergebnis,
     fertig. Deshalb haben sie keinen Zustand, keine Restzeit und keinen
     Abbrechen-Knopf, und die Rueckfrage sagt genau, was danach anders ist. */
  {
    id: "verlosung", name: "Verlosung", icon: "geschenk", ev: "admin:verlosung",
    was: "Einer von allen, die gerade online sind, bekommt den Topf. Sofort, ohne Spiel.",
    einmal: true, braucht: 1,
    felder: [{ k: "pot", label: "Topf", wert: 100000, min: 1000, schritt: 25000, geld: true }],
    frage: (w) => `${evGeld(w.pot)} Chips unter den ${evOnline} Anwesenden verlosen? Einer bekommt alles.`,
  },
  {
    id: "steuer", name: "Kassensturz", icon: "bank", ev: "admin:steuer",
    was: "Abgabe auf Bargeld über der Freigrenze. Nimmt Chips aus dem Spiel, statt neue zu machen. Die Bank bleibt unberührt.",
    einmal: true,
    felder: [
      { k: "prozent", label: "Prozent", wert: 5, min: 1, max: 25 },
      { k: "freigrenze", label: "Freigrenze", wert: 50000, min: 0, schritt: 10000, geld: true },
    ],
    frage: (w) => `${w.prozent} % von allem über ${evGeld(w.freigrenze)} Chips auf der Hand einziehen?\n\nBetrifft jedes Konto, auch die, die gerade nicht da sind. Das lässt sich nicht zurückdrehen.`,
  },
];

let evZustand = {};       // je id: Zustand vom Server
let evOnline = 0;
let evUhr = null;

const evGeld = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

function evRest(bis) {
  const ms = (Number(bis) || 0) - Date.now();
  if (ms <= 0) return "gleich vorbei";
  const s = Math.round(ms / 1000);
  if (s < 90) return `noch ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `noch ${m}:${String(s % 60).padStart(2, "0")} min` : `noch ${Math.round(m / 60)} h`;
}

/*
 * Kurze Events loesen bewusst keinen Push aus, die Nachricht kaeme spaeter
 * als das Ende. Genau deshalb koennen sie stattdessen einen Vorlauf haben:
 * angekuendigt wird sofort, gestartet wird spaeter. Dann ist die Nachricht
 * alt genug, dass jemand sie gelesen und die Seite geoeffnet haben kann.
 */
const EV_KURZ = new Set(["rain", "heist", "vault", "quiz"]);
let evGeplant = {};

function renderAdminEvents() {
  const box = $("#admin-events");
  if (!box) return;

  const onlineEl = $("#ev-online");
  if (onlineEl) {
    onlineEl.textContent = evOnline === 0
      ? "Gerade ist niemand online, das Event liefe ins Leere."
      : evOnline === 1
        ? "1 Spieler online. Heist und Tresorkampf brauchen mehr als einen."
        : `${evOnline} Spieler online.`;
    onlineEl.classList.toggle("ev-warn", evOnline < 2);
  }

  box.innerHTML = EVENTS.map((e) => {
    const z = evZustand[e.id] || {};
    const laeuft = !!z.active;
    const zeile = !laeuft ? "" :
      `<div class="ev-laeuft">${window.Casino.icons.ui("uhr")}<b>Läuft</b>` +
      (z.endsAt ? `<span>${evRest(z.endsAt)}</span>` : "") +
      (z.pot ? `<span>${evGeld(z.pot)} im Topf</span>` : "") +
      (z.loot ? `<span>${evGeld(z.loot)} Beute</span>` : "") +
      (z.prize ? `<span>${evGeld(z.prize)} Preis</span>` : "") +
      `</div>`;
    const zuWenig = e.braucht && evOnline < e.braucht;
    const plan = evGeplant[e.id];
    const angekuendigt = !!(plan && plan.geplant);
    const planZeile = !angekuendigt ? "" :
      `<div class="ev-plan">${window.Casino.icons.ui("uhr")}<b>Angekündigt</b>` +
      `<span data-plan-bis="${plan.startetUm}">startet ${evRest(plan.startetUm)}</span></div>`;

    return `<div class="ev-karte${laeuft ? " an" : ""}${angekuendigt ? " geplant" : ""}" data-ev="${e.id}">
      <div class="ev-kopf">
        <span class="ev-sym">${window.Casino.icons.ui(e.icon)}</span>
        <div><b>${escapeHtml(e.name)}</b><small>${escapeHtml(e.was)}</small></div>
      </div>
      ${zeile}${planZeile}
      ${zuWenig && !laeuft && !angekuendigt ? `<p class="ev-hinweis">${
        e.braucht === 1 ? "Dafür muss jemand online sein, gerade ist niemand da." : `Braucht mindestens ${e.braucht} Leute, gerade ${evOnline === 1 ? "ist einer" : `sind ${evOnline}`} online.`}${e.vorlauf ? " Mit Vorlauf ankündigen, dann können welche dazukommen." : ""}</p>` : ""}
      <div class="ev-felder">
        ${e.felder.map((f) => `<label class="ev-feld">
          <span>${escapeHtml(f.label)}</span>
          <input type="number" inputmode="numeric" data-ev-feld="${f.k}"
                 value="${f.wert}"${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.schritt ? ` step="${f.schritt}"` : ""} />
        </label>`).join("")}
        ${e.vorlauf ? `<label class="ev-feld ev-feld-vorlauf">
          <span>Vorlauf</span>
          <select data-ev-vorlauf>
            <option value="0">sofort</option>
            <option value="3">in 3 min</option>
            <option value="5" selected>in 5 min</option>
            <option value="10">in 10 min</option>
            <option value="15">in 15 min</option>
            <option value="30">in 30 min</option>
          </select>
        </label>` : ""}
      </div>
      ${e.vorlauf ? `<p class="ev-hinweis ev-leise">Mit Vorlauf wird es sofort im Chat und per Benachrichtigung angekündigt und startet erst danach. Ohne Vorlauf erreicht es nur, wer gerade da ist: für eine Benachrichtigung wäre es zu kurz.</p>` : ""}
      <div class="ev-knoepfe">
        <button class="btn-primary ev-start"${laeuft || angekuendigt ? " disabled" : ""}>${
          e.einmal ? "Auslösen" : laeuft ? "Läuft bereits" : angekuendigt ? "Angekündigt" : "Starten"}</button>
        ${e.einmal ? "" : `<button class="btn-danger ev-stop"${laeuft || angekuendigt ? "" : " disabled"}>${angekuendigt ? "Absagen" : "Abbrechen"}</button>`}
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll(".ev-karte").forEach((karte) => {
    const e = EVENTS.find((x) => x.id === karte.dataset.ev);
    const werte = () => {
      const out = { on: true };
      karte.querySelectorAll("[data-ev-feld]").forEach((i) => {
        const f = e.felder.find((x) => x.k === i.dataset.evFeld);
        const n = parseInt(i.value, 10);
        out[i.dataset.evFeld] = Number.isFinite(n) ? n : f.wert;
      });
      const v = karte.querySelector("[data-ev-vorlauf]");
      if (v) out.vorlauf = parseInt(v.value, 10) || 0;
      return out;
    };

    karte.querySelector(".ev-start")?.addEventListener("click", async () => {
      const w = werte();

      /* Rueckfrage vor allem, was Chips ins Spiel bringt. Das war der
         eigentliche Mangel: die Schnellknoepfe im Dashboard feuerten sofort,
         und ein Topf ist mit einem Klick draussen und nicht zurueckzuholen. */
      if (e.einmal) {
        // Eigene Rueckfrage: bei diesen beiden steht das Ergebnis sofort fest,
        // "starten" waere das falsche Wort.
        const ok = await window.Casino.dialog.frage(e.frage(w), {
          titel: e.name, okText: "Auslösen", gefahr: e.id === "steuer",
        });
        if (!ok) return;
        socket.emit(e.ev, w, (r) => {
          if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
          toast(e.id === "verlosung"
            ? `${r.gewinner} gewinnt ${evGeld(r.topf)} Chips.`
            : `${evGeld(r.summe)} Chips aus ${r.betroffen} Konten eingezogen.`);
          loadAdminDashboard();
        });
        return;
      }

      if (e.chips) {
        const geld = e.felder.find((f) => f.geld);
        const betrag = geld ? w[geld.k] : 0;
        const gleich = !w.vorlauf;
        const ok = await window.Casino.dialog.frage(
          (gleich
            ? `${e.name} sofort starten und ${evGeld(betrag)} Chips ausschütten?`
            : `${e.name} für in ${w.vorlauf} Minuten ankündigen? ${evGeld(betrag)} Chips gehen dann raus.\n\nDie Ankündigung geht sofort in den Chat und als Benachrichtigung an alle, die nicht da sind.`) +
          (gleich && evOnline < 2
            ? `\n\nGerade ${evOnline === 0 ? "ist niemand" : "ist nur einer"} online.` +
              (e.vorlauf ? " Mit Vorlauf könnten noch welche dazukommen." : "")
            : ""),
          { titel: e.name, okText: gleich ? "Jetzt starten" : "Ankündigen" });
        if (!ok) return;
      }
      socket.emit(e.ev, w, (r) => {
        toast(r?.ok
          ? (w.vorlauf ? `${e.name} für in ${w.vorlauf} Minuten angekündigt.` : `${e.name} gestartet.`)
          : (r?.error || "Fehler."));
        loadAdminDashboard();
      });
    });

    karte.querySelector(".ev-stop")?.addEventListener("click", async () => {
      const war = (evGeplant[e.id] || {}).geplant;
      if (!await window.Casino.dialog.frage(
        war ? `${e.name} wieder absagen? Die Ankündigung steht schon im Chat.` : `${e.name} jetzt abbrechen?`,
        { okText: war ? "Absagen" : "Abbrechen", abbruchText: "Doch nicht", gefahr: true })) return;
      socket.emit(e.ev, { on: false }, (r) => {
        toast(r?.ok ? (r.abgesagt ? `${e.name} abgesagt.` : `${e.name} beendet.`) : (r?.error || "Fehler."));
        loadAdminDashboard();
      });
    });
  });

  /* Die Restzeiten laufen mit, solange der Bildschirm offen ist. Vorher
     stand dort eine Zahl, die beim Laden stimmte und danach nicht mehr. */
  clearInterval(evUhr);
  evUhr = null;
  const laeuftWas = EVENTS.some((e) => (evZustand[e.id] || {}).active || (evGeplant[e.id] || {}).geplant);
  if (laeuftWas) {
    evUhr = setInterval(() => {
      if (window.Casino.screens.current() !== "admin") { clearInterval(evUhr); evUhr = null; return; }
      let offen = false;
      box.querySelectorAll(".ev-karte.an").forEach((k) => {
        const z = evZustand[k.dataset.ev] || {};
        if (!z.endsAt) { offen = true; return; }
        const span = k.querySelector(".ev-laeuft span");
        if (span) span.textContent = evRest(z.endsAt);
        if (z.endsAt > Date.now()) offen = true;
      });
      box.querySelectorAll("[data-plan-bis]").forEach((el) => {
        const bis = Number(el.dataset.planBis) || 0;
        el.textContent = "startet " + evRest(bis);
        if (bis > Date.now()) offen = true;
      });
      // Abgelaufen oder losgegangen? Dann den echten Stand holen statt zu raten.
      if (!offen) loadAdminDashboard();
    }, 1000);
  }
}

// Daten-Backup (nur Besitzer): ganzen data/-Ordner laden oder zurückspielen
$("#admin-backup-btn")?.addEventListener("click", async () => {
  const errEl = $("#admin-backup-error");
  errEl.textContent = "";
  try {
    const res = await fetch("/api/admin/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: state.token }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Backup fehlgeschlagen.");
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fakecasino-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Backup mit ${Object.keys(data.files).length} Dateien heruntergeladen.`);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$("#admin-restore-input")?.addEventListener("change", async (e) => {
  const errEl = $("#admin-backup-error");
  errEl.textContent = "";
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // dieselbe Datei später nochmal wählbar
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.kind !== "fakecasino-backup" || !data.files) throw new Error("Das ist kein Fake-Casino-Backup.");
    const n = Object.keys(data.files).length + Object.keys(data.binaer || {}).length;
    const when = data.createdAt ? new Date(data.createdAt).toLocaleString("de-DE") : "unbekannt";
    if (!await window.Casino.dialog.frage(`Backup vom ${when} (${n} Dateien) einspielen?\n\nDas überschreibt alle aktuellen Spieldaten. Der Server startet danach neu, alle Spieler fliegen kurz raus.`, { titel: "Backup einspielen", okText: "Einspielen", gefahr: true })) return;
    // `binaer` muss mit: der Server erwartet die Clan-Wappen dort, und ohne
    // sie stehen die Clans nach dem Einspielen ohne Bild da. Beim Sichern
    // wandern sie ins Backup, beim Einspielen fielen sie bisher still unter
    // den Tisch, der Fehler faellt erst auf, wenn man das Backup braucht.
    const res = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: state.token, files: data.files, binaer: data.binaer || {} }) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "Wiederherstellen fehlgeschlagen.");
    toast(`${out.written} Dateien eingespielt. Der Server startet neu, die Seite lädt gleich von selbst.`);
    setTimeout(() => location.reload(), 5000);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// Einstellungen: Design, Ton, Bewegung

/**
 * Theme-Auswahl zeichnen. Jede Karte zeigt zwei echte Farbtupfer aus der
 * Palette, damit man vor dem Umschalten sieht, worauf man sich einlässt.
 */
function renderThemePicker() {
  const host = $("#theme-picker");
  if (!host || !window.Casino.theme) return;
  const active = window.Casino.theme.get();
  host.innerHTML = window.Casino.theme.list().map((t) => `
    <button type="button" class="theme-card${t.id === active ? " active" : ""}"
            role="radio" aria-checked="${t.id === active}" data-theme-id="${t.id}">
      <span class="theme-swatch" aria-hidden="true">
        <i style="background:${t.swatch[0]}"></i><i style="background:${t.swatch[1]}"></i>
      </span>
      <b>${escapeHtml(t.label)}</b>
      <small>${escapeHtml(t.hint)}</small>
    </button>`).join("");
}

$("#theme-picker")?.addEventListener("click", (e) => {
  const card = e.target.closest("[data-theme-id]");
  if (!card) return;
  window.Casino.theme.set(card.dataset.themeId);
});

// Auf das Ereignis hören statt nach jedem Klick von Hand neu zu zeichnen.
// So stimmt die Markierung auch, wenn das Theme von woanders kommt, etwa
// beim Login vom Account eines anderen Geräts.
document.addEventListener("casino:themechange", renderThemePicker);

// Lautstaerke und Ton-Schalter. Die Engine haelt den Wert, hier haengt nur
// die Bedienung dran.
(function () {
  const slider = $("#set-volume");
  const box = $("#set-sound");
  if (slider) {
    slider.value = String(Math.round(window.Casino.sound.getVolume() * 100));
    slider.addEventListener("input", () => window.Casino.sound.setVolume(slider.value / 100));
    // Erst beim Loslassen an den Server, nicht bei jedem Pixel des Schiebers.
    slider.addEventListener("change", () => {
      window.Casino.sound.setVolume(slider.value / 100);
      window.Casino.savePrefs({ volume: window.Casino.sound.getVolume() });
      window.Casino.sound.play("tick"); // kurze Hoerprobe
    });
  }
  if (box) {
    box.checked = window.Casino.sound.isEnabled();
    box.addEventListener("change", () => {
      window.Casino.sound.setEnabled(box.checked);
      window.Casino.savePrefs({ sound: box.checked });
      if (box.checked) window.Casino.sound.play("select");
    });
  }
})();

$("#set-motion")?.addEventListener("change", (e) => {
  const on = e.target.checked;
  document.documentElement.classList.toggle("reduce-motion", on);
  window.Casino.savePrefs({ reduceMotion: on });
});

// Eckdaten vom Server holen, damit im Login keine veralteten Zahlen stehen.
(async function loadPublicConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg.bonusCooldownMs) state.bonusCooldownMs = cfg.bonusCooldownMs;
    if (cfg.rescueThreshold) RESCUE_THRESHOLD = cfg.rescueThreshold;
    const el = $("#login-start-chips");
    if (el && cfg.startingChips) el.textContent = cfg.startingChips.toLocaleString("de-DE");
  } catch {
    // Ohne Verbindung bleibt der Wert aus dem HTML stehen. Kein Drama.
  }
})();

// Start
// Erst versuchen, die gespeicherte Sitzung wiederherzustellen, damit ein
// weggeworfener Tab direkt in der Lobby landet. Die Anmeldung ist im HTML
// schon der Standard, ein Fehlschlag braucht also nichts weiter.
(async function boot() {
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  if (!token) return showScreen("login", { history: "replace" });

  /*
   * Warten, bis wirklich alle Spielmodule ausgefuehrt sind.
   *
   * Die rund vierzig Dateien haengen als `defer` im Dokument: sie laden
   * parallel und laufen dann der Reihe nach, alle vor DOMContentLoaded.
   * Diese Datei ist die dritte davon, die Sitzungsabfrage startet also,
   * waehrend stats.js, clans.js und der Rest noch unterwegs sind.
   *
   * Kam die Antwort zurueck, bevor das Modul zum Zielscreen dran war, rief
   * der Router dessen Ladefunktion auf, als es sie noch nicht gab. Der
   * Router versucht es kein zweites Mal, also blieb der Screen fuer immer
   * auf "Lädt…". Zu sehen bekam das, wer die Seite auf einem Unterscreen
   * neu lud oder einen geteilten Link oeffnete. Auf dem iPad, wo jede
   * Datei einzeln ueber die Leitung muss, deutlich haeufiger als hier.
   *
   * Drei Module (records, comeback, home) hatten sich das mit einem eigenen
   * Nachzieher gefangen. Die anderen sechsundzwanzig nicht. Deshalb steht
   * die Loesung hier an der Wurzel und nicht sechsundzwanzigmal verteilt.
   */
  // Achtung bei der Abfrage: waehrend ein `defer`-Skript laeuft, steht
  // readyState schon auf "interactive": das Dokument ist geparst, die
  // Skripte sind es nicht. Erst "complete" heisst, dass alle durch sind.
  const modulenBereit = document.readyState === "complete"
    ? Promise.resolve()
    : new Promise((fertig) => document.addEventListener("DOMContentLoaded", fertig, { once: true }));

  try {
    const data = await api("/api/session", { token });
    if (data.config?.bonusCooldownMs) state.bonusCooldownMs = data.config.bonusCooldownMs;
    if (data.config?.rescueThreshold) RESCUE_THRESHOLD = data.config.rescueThreshold;
    setAccount(data.account, data.token);
    // Geteilter Link? Dann dorthin, sonst in die Lobby. In beiden Faellen
    // ersetzen statt anhaengen, damit die Zurueck-Geste nicht auf einem
    // leeren Eintrag vor dem Start landet.
    await modulenBereit;
    const deep = window.Casino.screens.fromHash();
    const target = deep && deep !== "login" && window.Casino.screens.exists(deep) ? deep : "lobby";
    if (!showScreen(target, { history: "replace" })) showScreen("lobby", { history: "replace" });
  } catch {
    // Abgelaufen, widerrufen oder Konto weg: aufräumen und nach dem Passwort fragen.
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    showScreen("login", { history: "replace" });
  }
})();
