"use strict";

/* ============================================================
   Fake Casino – Frontend
   Screen-Manager + Account/Lobby-Logik. Spiele (Poker, Slots)
   docken später an dieses Gerüst und an `socket` an.
   ============================================================ */

// ---- Verbindung für spätere Echtzeit-Spiele (jetzt nur aufgebaut) ----
const socket = io();

// ---- Globaler Zustand ----
const state = {
  account: null, // { name, chips, createdAt, lastBonusAt, stats }
  token: null,   // signed session token from /api/login, proves identity to the socket
  bonusCooldownMs: 20 * 60 * 60 * 1000, // fallback; the server sends the real value on login
};
let appVersion = null;
let reloadRequired = false;

// ---- DOM-Helfer ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================
// Screen-Manager
// ============================================================
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
  return true;
});

// Screens, deren Ladefunktion hier in app.js steht oder von der Namens-
// konvention abweicht. Alle uebrigen findet core/screens.js selbst ueber
// Casino._load<Name>.
window.Casino.screens.register("leaderboard", { onEnter: () => loadLeaderboard() });
window.Casino.screens.register("profile", { onEnter: () => renderProfile() });
window.Casino.screens.register("admin", {
  onEnter: () => { loadAdminAccounts(); ladeAnsage(); anVorschau(); adminReiter(); },
  // Die Uhr der Event-Karten muss nicht weiterlaufen, wenn niemand hinsieht.
  onLeave: () => { if (typeof evUhr !== "undefined" && evUhr) { clearInterval(evUhr); evUhr = null; } },
});

/*
 * Reiter im Admin-Bildschirm.
 *
 * Er war ueber dreitausend Pixel lang — Dashboard, Ansage, saemtliche
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
    });
  });
}
window.Casino.screens.register("settings", { onEnter: () => { renderThemePicker(); if (window.Casino._loadPush) window.Casino._loadPush(); } });
window.Casino.screens.register("updates", { onEnter: () => renderUpdates() });
window.Casino.screens.register("calendar", { onEnter: () => loadCalendar() });
window.Casino.screens.register("lobby", {
  onEnter: () => {
    if (window.Casino._loadLobbies) window.Casino._loadLobbies();
    if (window.Casino._loadFeed) window.Casino._loadFeed();
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

     Der Name ist mit Bedacht NICHT data-screen. Fuenfundzwanzig Stellen in
     den Spielmodulen fragen mit
       document.querySelector('[data-screen="crash"]')
     ab, ob ihr Screen gerade offen ist. #app steht im DOM vor den Screens,
     haette also jedes Mal den Container zurueckgegeben — und zwar genau dann,
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
 * muss UNTER der Leiste kleben. Eine geratene Zahl geht schief, sobald sich
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

// ============================================================
// Menü (alles, was kein Spiel ist)
// ============================================================
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

// ============================================================
// Toast-Hinweise
// ============================================================
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
        <div class="update-emoji">🔄</div>
        <h2>Update verfügbar</h2>
        <p class="muted small" style="text-align:center">Deine Seite läuft noch auf einer alten Version. Bitte lade neu, damit Spiele, Bank und Stadt wieder synchron sind.</p>
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

// Shared API for the per-game modules (poker.js, slots.js etc.).
// Expose this early because navigation and modals can trigger screen changes
// before the whole file reaches the final startup call.
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

// ============================================================
// Account / Anzeige
// ============================================================
// Session token lives in localStorage, not just memory: iPadOS discards
// background Safari tabs aggressively, and an in-memory-only token meant every
// tab kill sent you back to the login screen.
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
  renderTopbar();
  requestPresence();
  // Admin-Tile nur für Vincent sichtbar
  const adminItem = $("#menu-admin");
  if (adminItem) adminItem.style.display = acc.name.toLowerCase() === "vincent" ? "" : "none";
  maybeShowUpdate();
  renderUpdateBadge();
}

// ============================================================
// Update-Historie: Comeback-Fenster und Updates-Tab
// ============================================================
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
 * Pause macht, kommt also OHNE Merkwert zurueck. Vorher galt das als "neuer
 * Spieler" und das Comeback-Fenster wurde stillschweigend uebersprungen —
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
  /* `icon` darf beides sein: eine Kennung aus core/icons.js (dann wird
     gezeichnet) oder ein Emoji, wie es die alten Eintraege tragen. Die
     Historie soll nicht rueckwirkend umgeschrieben werden — was 2026 mit
     einem Emoji ausgeliefert wurde, steht auch weiter so da. */
  const gezeichnet = item.icon && window.Casino.icons.hatUi(item.icon)
    ? window.Casino.icons.ui(item.icon)
    : null;
  return `<div class="update-item"><span${gezeichnet ? ' class="ui-punkt"' : ""}>` +
    `${gezeichnet || escapeHtml(item.icon || "")}</span><div>` +
    `<b>${escapeHtml(item.titel)}</b><small>${escapeHtml(item.text)}</small>` +
    `</div></div>`;
}

/**
 * Fenster beim Reinkommen. Zeigt ALLES, was seit dem letzten Besuch dazukam,
 * nicht nur das neueste Update. Wer zwei Monate weg war, soll nicht raten
 * muessen, was sich geaendert hat.
 */
function maybeShowUpdate() {
  const cl = window.Casino.changelog;
  if (!cl) return;
  const gesehen = gesehenerStand();
  if (!gesehen) return; // ohne Account gibt es nichts zu vergleichen

  const alleNeu = cl.neuSeit(gesehen);
  if (!alleNeu.length) return;
  /*
   * Ein Eintrag mit `soloImFenster` erzaehlt die ganze Geschichte selbst
   * (der Sammel-Eintrag zur Wiedereroeffnung). Dann steht NUR er im Fenster,
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
        ? `<p class="update-more">Jede einzelne Änderung steht im Menü unter <b>Updates</b> — ${weitere} Einträge im Detail.</p>`
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
 * kann der Dialog-Baustein laengst — nur dieses Fenster ist aelter.
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
  // Das Fenster sagt, WAS neu ist. Der Rundgang zeigt, WO es ist. Direkt
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
 * schlicht vergessen — man sieht sie nur, wenn man den Bildschirm ohnehin
 * aufmacht. Die Marke am Menue-Knopf sagt, dass da etwas liegt, und die
 * Menue-Eintraege sagen, was.
 */
/**
 * Dieselbe Zahl noch einmal an dem Eintrag, aus dem sie kommt.
 *
 * Die Marke am Menue-Knopf sagt nur DASS etwas wartet. Wer dann aufmacht,
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
  let season = 0, geschenk = 0;

  const zeichne = () => {
    const gesamt = season + geschenk;
    let marke = btn.querySelector(".menu-count");
    if (!gesamt) { if (marke) marke.remove(); return; }
    if (!marke) {
      marke = document.createElement("span");
      marke.className = "menu-count";
      btn.appendChild(marke);
    }
    marke.textContent = String(gesamt);
    marke.title = `${gesamt} ${gesamt === 1 ? "Belohnung wartet" : "Belohnungen warten"}`;
  };

  socket.emit("season:state", (r) => {
    season = r && r.ok ? (r.rewards || []).filter((x) => x.unlocked && !x.claimed).length : 0;
    const sub = $("#menu-season-sub");
    if (sub) sub.textContent = season ? `${season} ${season === 1 ? "Stufe wartet" : "Stufen warten"}` : "Fortschritt und Belohnungen";
    setzeSheetMarke('[data-nav="season"]', season);
    zeichne();
  });
  socket.emit("comeback:state", (r) => {
    geschenk = r && r.ok && r.geschenkOffen && !r.geholt ? 1 : 0;
    const eintrag = $("#menu-geschenk");
    if (eintrag) eintrag.hidden = !geschenk;
    setzeSheetMarke("#menu-geschenk", geschenk);
    zeichne();
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

const ONBOARDING_VERSION = "2026-07-08-first-steps";
function maybeShowOnboarding() {
  let seen = null;
  try { seen = localStorage.getItem("casino_seen_onboarding"); } catch {}
  if (seen === ONBOARDING_VERSION) return;
  const m = $("#onboarding-modal");
  if (m) m.classList.remove("hidden");
}
$("#onboarding-close")?.addEventListener("click", () => {
  $("#onboarding-modal")?.classList.add("hidden");
  try { localStorage.setItem("casino_seen_onboarding", ONBOARDING_VERSION); } catch {}
});
$("#onboarding-quests")?.addEventListener("click", () => {
  $("#onboarding-modal")?.classList.add("hidden");
  try { localStorage.setItem("casino_seen_onboarding", ONBOARDING_VERSION); } catch {}
  showScreen("quests");
});

// Re-authenticate after a dropped connection: the server treats a reconnect as
// a fresh socket with no identity, so we must replay the token.
socket.on("connect", () => {
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

socket.on("announcement:state", ({ announcement, toast: shouldToast } = {}) => {
  renderAnnouncement(announcement);
  if (shouldToast && announcement && announcement.text) toast(announcement.text);
});

// Server can push an updated bank balance (e.g. after a poker buy-in/cash-out).
socket.on("account:update", ({ account }) => {
  if (!account) return;
  state.account = { ...state.account, ...account };
  renderTopbar();
  if (currentScreen === "profile") renderProfile();
});

// Nur bekannte Schilder durchlassen: ein alter Wert aus einer Nachricht darf
// keine fremde Klasse ins Dokument schreiben.
const SCHILDER = new Set(["messing", "jade", "rubin", "karo", "neon", "puls", "prisma"]);
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
      window.Casino.spieler.avatar(p) + window.Casino.spieler.name(p, { tag: "b" }) +
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
      window.Casino.spieler.avatar(p) + window.Casino.spieler.name(p, { tag: "b" }) +
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

const RESCUE_THRESHOLD = 50; // mirror of server; controls when the help button shows

// Active product buffs shown in the topbar.
/* Die vier laufen dauerhaft oben in der Kopfzeile mit, direkt neben dem
   gezeichneten Guthaben — vier bunte Emoji fielen dort am meisten auf. */
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
setInterval(renderBuffs, 5000); // keep countdowns fresh

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
   * Bewusst NICHT die Klasse pl-ava: die bringt eine eigene Groesse mit
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
  $("#balance-amount").textContent = acc.chips.toLocaleString("de-DE");
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
  // Pleite-Schutz: offer the help button only when nearly broke.
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
    kachel("Mitglied seit", acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "–");

  /* Der Rest (Stadt-Imperium, Clan, Achievements) kommt vom Server. Vorher
     wurde derselbe Aufruf nur benutzt, um das Level nachzuladen — die Daten
     zum Imperium lagen ungenutzt in der Antwort. */
  fetch("/api/account/" + encodeURIComponent(acc.name))
    .then((r) => r.json())
    .then((d) => {
      if (d.account && d.account.level) { state.account.level = d.account.level; renderLevel(d.account.level); }

      const tags = [];
      if (d.clan) tags.push(`<span class="pf-tag">${window.Casino.icons.ui("clans")}${escapeHtml(d.clan)}</span>`);
      if (d.ach && d.ach.badge) tags.push(`<span class="pf-tag">${d.ach.badge}</span>`);
      if (d.bounty) tags.push(`<span class="pf-tag pf-tag-bounty">${window.Casino.icons.ui("quests")}Kopfgeld ${Number(d.bounty).toLocaleString("de-DE")} Chips</span>`);
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
    if (!res || !res.ok) { box.innerHTML = '<p class="muted small">–</p>'; return; }

    const offen = res.list.filter((a) => a.unlocked);
    const zu = res.list.filter((a) => !a.unlocked);
    if (zaehler) zaehler.textContent = `${offen.length} von ${res.list.length}`;

    /*
     * Die Bedingung stand nur bei den GESPERRTEN in der Karte; bei den
     * freigeschalteten stand dort ein Haken. Wofuer man eines bekommen hat,
     * war ausschliesslich im title-Attribut zu sehen — also nur beim
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
      return `<div class="badge ${a.unlocked ? "on" : ""}${sel ? " selected" : ""}" data-ach="${a.id}" data-unlocked="${a.unlocked ? 1 : 0}">` +
        `<span class="badge-emoji">${a.unlocked ? a.emoji : "🔒"}</span>` +
        `<span class="badge-label">${escapeHtml(a.label)}</span>` +
        `<span class="badge-desc">${escapeHtml(a.desc)}</span>` +
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

// ── Duell-Herausforderung: Spieler wählt ein Spiel + Einsatz, erstellt ein
// privates Match und lädt den Gegner ein; dieser tritt beim Annehmen bei. ──
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
  // Create a PRIVATE match for the chosen game → get the code → send the invite.
  showScreen(g.screen);
  socket.emit(g.ev, { buyIn: stake, isPublic: false, ...g.extra }, (res) => {
    if (!res || !res.ok) { toast(res?.error || "Konnte kein Match erstellen."); return; }
    socket.emit("social:challenge", { to: name, game, code: res.code, stake }, (r) => {
      if (!r || !r.ok) { toast(r?.error || "Einladung fehlgeschlagen."); return; }
      toast(r.delivered
        ? `⚔️ ${name} zu ${DUEL_LABEL[game]} eingeladen — warte im Spielraum…`
        : `${name} ist offline — Einladung nicht zugestellt. Du kannst das Match verlassen.`);
    });
  });
}

socket.on("social:challengeIncoming", ({ from, game, code, stake, label } = {}) => {
  if (!from || !game || !code) return;
  const hook = DUEL_JOIN_HOOK[game];
  const txt = `⚔️ ${from} fordert dich zu ${label || DUEL_LABEL[game] || "einem Duell"} heraus\nEinsatz: ${Number(stake || 0).toLocaleString("de-DE")}<i class=mk></i>\n\nAnnehmen?`;
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
 * war jede gekaufte Kosmetik unsichtbar, sobald jemand anders hinsah — und
 * genau dafuer kauft man sie. Angezeigt wird deshalb dieselbe Visitenkarte
 * wie im eigenen Profil, mit Banner, Namensstil, Rahmen, Titel und Imperium.
 *
 * Zwei Unterschiede zum eigenen Profil, beide beabsichtigt: die gesperrten
 * Achievements fehlen (was jemand NICHT geschafft hat, geht niemanden etwas
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
    if (data.clan) tags.push(`<span class="pf-tag">${window.Casino.icons.ui("clans")}${escapeHtml(data.clan)}</span>`);
    if (ach.badge) tags.push(`<span class="pf-tag">${ach.badge}</span>`);
    if (data.bounty) tags.push(`<span class="pf-tag pf-tag-bounty">${window.Casino.icons.ui("quests")}Kopfgeld ${zahl(data.bounty)} Chips</span>`);
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
        ${kachel("Mitglied seit", acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "–")}
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

/** "vor 3 Std" / "gestern" — grob reicht, auf die Minute waere unheimlich. */
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

// Pick/unpick the leaderboard title emoji.
$("#profile-badges").addEventListener("click", (e) => {
  const el = e.target.closest(".badge");
  if (!el || el.dataset.unlocked !== "1") return;
  const id = el.classList.contains("selected") ? null : el.dataset.ach;
  socket.emit("ach:setBadge", { id }, (res) => {
    if (!res || !res.ok) { toast(res?.error || "Fehler."); return; }
    toast(id ? "★ Emoji wird im Leaderboard getragen." : "Emoji entfernt.");
    renderProfile();
  });
});

// ============================================================
// API-Aufrufe
// ============================================================
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

// ---- Login ----
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#login-name").value.trim();
  const pin = $("#login-pin").value.trim();
  const errEl = $("#login-error");
  errEl.textContent = "";

  try {
    const data = await api("/api/login", { name, pin });
    if (data.config?.bonusCooldownMs) state.bonusCooldownMs = data.config.bonusCooldownMs;
    setAccount(data.account, data.token);
    showScreen("lobby");
    if (data.created) maybeShowOnboarding();
    if (data.created) toast(`Willkommen, ${data.account.name}! ${(data.account.chips || 0).toLocaleString("de-DE")} Chips geschenkt.`);
    else toast(`Willkommen zurück, ${data.account.name}!`);
    // Einbruchs-Warnung: fehlgeschlagene Login-Versuche seit dem letzten Besuch.
    if (!data.created && data.warnFails >= 3) {
      setTimeout(() => toast(`⚠️ ${data.warnFails} fehlgeschlagene Login-Versuche seit deinem letzten Besuch — ggf. Passwort in den Einstellungen ändern!`), 1500);
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---- Login-Kalender ----
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
    btn.textContent = s.canClaim ? `Tag ${s.current + 1} abholen — ${s.rewards[s.current].toLocaleString("de-DE")} Chips` : "✓ Heute schon abgeholt — morgen wieder!";
  }
}
function loadCalendar() {
  socket.emit("calendar:state", (s) => { if (s && s.ok) renderCalendar(s); });
}
$("#calendar-claim-btn")?.addEventListener("click", () => {
  socket.emit("calendar:claim", (r) => {
    if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
    setAccount(r.account);
    toast(`📅 Tag ${r.day} — +${r.reward.toLocaleString("de-DE")} Chips!`);
    loadCalendar();
  });
});

// ---- Live-Ops (Happy Hour / Turnier) Banner ----
let liveopsState = null;
function renderLiveops() {
  const el = $("#liveops-banner");
  if (!el) return;
  const s = liveopsState;
  const parts = [];
  if (s && s.happyActive) {
    const min = Math.max(0, Math.ceil((s.happyUntil - Date.now()) / 60000));
    parts.push(`<span class="lo-chip happy">🍹 Happy Hour — doppelte Quest-Belohnungen · noch ${min} Min</span>`);
  }
  if (s && s.tourney) {
    const min = Math.max(0, Math.ceil((s.tourney.endsAt - Date.now()) / 60000));
    const lead = s.tourney.board && s.tourney.board[0];
    parts.push(`<span class="lo-chip tourney">🏁 Slot-Turnier · ${s.tourney.prize.toLocaleString("de-DE")} Chips · noch ${min} Min${lead ? ` · 👑 ${escapeHtml(lead.name)} (${lead.mult}×)` : ""}</span>`);
  }
  el.innerHTML = parts.join("");
  el.classList.toggle("hidden", parts.length === 0);
}
socket.on("liveops:state", (s) => { liveopsState = s; renderLiveops(); });
socket.on("connect", () => socket.emit("liveops:state", (r) => { if (r && r.ok) { liveopsState = r; renderLiveops(); } }));
socket.on("liveops:tourneyWin", (w) => { if (w) toast(`🏆 Turnier gewonnen: ${w.name} mit ${w.mult}× (+${w.prize.toLocaleString("de-DE")} Chips)!`); });
// Kurze Server-Meldung an genau einen Spieler. Wird bisher nur genutzt, wenn
// die Stadt eine Kosmetik freischaltet.
socket.on("notice", ({ text } = {}) => { if (text) toast(String(text)); });

socket.on("level:up", (d) => {
  if (!d) return;
  if (state.account) state.account.level = { ...(state.account.level || {}), level: d.level, title: d.title, emoji: d.emoji };
  renderTopbar();
  toast(`${d.emoji} LEVEL UP! Du bist jetzt Level ${d.level} — ${d.title}!`);
});
setInterval(renderLiveops, 20000);

// ---- Stunden-Bonus: Countdown auf Topbar-Knopf und Hero-Kachel ----
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

// ============================================================
// Hero-Bereich der Lobby
// ============================================================
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

// ---- Stunden-Bonus ----
async function claimBonus() {
  if (!state.account) return;
  try {
    const data = await api("/api/daily-bonus", { name: state.account.name, token: state.token });
    setAccount(data.account);
    const extras = [];
    if (data.tribute) extras.push(`👑 +${data.tribute.toLocaleString("de-DE")} Straßen-Tribut (${data.streets} Straßen${data.golden ? " · ✨ Goldene Straße!" : ""})`);
    if (data.houses) extras.push(`🏠 +${data.houses.toLocaleString("de-DE")} Haus-Miete (${data.housesOwned} Häuser)`);
    if (data.sets) extras.push(`🧩 +${data.sets.toLocaleString("de-DE")} Sammel-Sets`);
    if (data.cashback) extras.push(`💸 +${data.cashback.toLocaleString("de-DE")} Cashback`);
    const streakNote = data.streak > 1 ? ` 🔥 ${data.streak}er-Serie!` : "";
    toast(`+${data.amount.toLocaleString("de-DE")} Chips Bonus!${streakNote}${extras.length ? " · " + extras.join(" · ") : ""}`);
  } catch (err) {
    toast(err.message || "Bonus nicht verfügbar.");
  }
}
$("#bonus-btn").addEventListener("click", claimBonus);
$("#hero-bonus")?.addEventListener("click", claimBonus);

// ---- Soforthilfe (Pleite-Schutz) ----
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

// ---- Leaderboard (multi-category, tabbed) ----
const LB_ORDER = ["rich", "level", "horses", "estate", "streets", "bigwin", "bigloss", "games"];
// How a category's value is displayed (default: chips).
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
    const nm = window.Casino.spieler.name(p, { tag: "b" });
    const titel = window.Casino.spieler.title(p);
    if (p.schild && SCHILDER.has(p.schild)) li.classList.add("sch-" + p.schild);
    li.innerHTML =
      `<span>${rank}${clan} ${ava} ${nm}${titel ? " " + titel : ""}${lvl}${champ}${badge}${me ? " (du)" : ""}</span>` +
      `<b>${unit ? unit(p.value) : p.value.toLocaleString("de-DE") + "<i class=mk></i>"}</b>`;
    // Tap a row to inspect that player's stats.
    li.classList.add("lb-clickable");
    li.addEventListener("click", () => window.Casino.openStats && window.Casino.openStats(p.name));
    list.appendChild(li);
  });
}

// ---- Logout ----
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

// ============================================================
// Hilfsfunktionen
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// (Passwörter dürfen jetzt 4–24 beliebige Zeichen sein — kein Ziffern-Filter mehr.)

// Bequemlichkeit: gespeicherten Namen vorausfüllen
try {
  const saved = localStorage.getItem("casino_name");
  if (saved) $("#login-name").value = saved;
} catch {}

// Bonus-Button-Status regelmäßig auffrischen
setInterval(refreshBonusButton, 60 * 1000);

// ---- PIN ändern ----
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
// (Passwort-Felder: kein Ziffern-Filter mehr — 6–24 beliebige Zeichen.)

// ---- Chips senden ----
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
socket.on("admin:kicked", ({ reason }) => {
  toast(reason || "Du wurdest gesperrt.");
  state.account = null;
  state.token = null;
  try { localStorage.removeItem("casino_name"); } catch {}
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  showScreen("login", { history: "replace" });
});

function loadAdminAccounts() {
  loadAdminDashboard();
  loadIpBans();
  socket.emit("announcement:get", (res) => {
    if (res && res.ok && res.announcement && $("#admin-announcement-text")) {
      $("#admin-announcement-text").value = res.announcement.text || "";
    }
  });
  const list = $("#admin-account-list");
  list.innerHTML = '<li class="muted">Lädt…</li>';
  socket.emit("admin:listAccounts", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">Fehler.</li>'; return; }
    if (!res.accounts.length) { list.innerHTML = '<li class="muted">Keine Accounts.</li>'; return; }
    list.innerHTML = "";
    res.accounts.sort((a, b) => b.chips - a.chips).forEach((p) => {
      const savings = Number(p.savings) || 0;
      const li = document.createElement("li");
      li.className = "admin-acc";
      li.innerHTML =
        `<div class="admin-acc-top"><span>${escapeHtml(p.name)}${p.banned ? " 🚫" : ""}${p.shadowban ? " 🌑" : ""}</span><b>${p.chips.toLocaleString("de-DE")}<i class=mk></i></b></div>` +
        `<div class="admin-acc-lb">Bank: <b>${savings.toLocaleString("de-DE")}<i class=mk></i></b>` +
        ` <button class="chip-btn" data-admin-clear-bank="${escapeHtml(p.name)}">Bank leeren</button>` +
        ` <button class="btn-danger" data-admin-delete="${escapeHtml(p.name)}">Löschen</button></div>` +
        `<div class="admin-acc-lb">Leaderboard löschen:` +
        ` <button class="chip-btn" data-stat="bigwin" title="Größter Gewinn">🎰✖</button>` +
        ` <button class="chip-btn" data-stat="bigloss" title="Größter Verlust">💸✖</button>` +
        ` <button class="chip-btn" data-stat="games" title="Aktivste">🎲✖</button></div>`;
      li.querySelector("[data-admin-clear-bank]")?.addEventListener("click", async () => {
        if (!await window.Casino.dialog.frage(`${p.name}: Bank wirklich leeren?`, { okText: "Leeren", gefahr: true })) return;
        socket.emit("admin:clearBank", { target: p.name }, (r) => {
          if (r && r.ok) {
            toast(`${p.name}: Bank geleert (${(r.cleared || 0).toLocaleString("de-DE")} Chips).`);
            loadAdminAccounts();
          } else toast((r && r.error) || "Fehler.");
        });
      });
      li.querySelector("[data-admin-delete]")?.addEventListener("click", async () => {
        if (!await window.Casino.dialog.frage(`Account "${p.name}" wirklich löschen?`, { okText: "Löschen", gefahr: true })) return;
        socket.emit("admin:deleteAccount", { target: p.name }, (res) => {
          if (!res || !res.ok) { toast(res?.error || "Fehler."); return; }
          toast(`${p.name} gelöscht.`);
          loadAdminAccounts();
        });
      });
      li.querySelectorAll("[data-stat]").forEach((b) =>
        b.addEventListener("click", () => {
          socket.emit("admin:resetStat", { target: p.name, stat: b.dataset.stat }, (r) => {
            if (r && r.ok) toast(`${p.name}: aus Leaderboard entfernt.`);
            else toast((r && r.error) || "Fehler.");
          });
        }));
      list.appendChild(li);
    });
  });
  loadAdminLots();
}

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
    evZustand = {
      happy: live.happyActive ? { active: true, endsAt: live.happyUntil } : { active: false },
      tourney: tourney ? { active: true, endsAt: tourney.endsAt, prize: tourney.prize } : { active: false },
      heist: ev.heist || { active: !!ev.heistActive },
      rain: ev.rain || { active: !!ev.rainActive },
      quiz: ev.quiz || { active: !!ev.quizActive },
      vault: ev.vault || { active: !!ev.vaultActive },
    };
    const laufen = Object.entries(evZustand).filter(([, z]) => z.active).length;
    const miniList = (items, valFn, empty) => items.length
      ? items.map((p) => `<li><span>${escapeHtml(p.name)}</span><b>${valFn(p)}</b></li>`).join("")
      : `<li class="muted">${empty}</li>`;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:center;flex-wrap:wrap">
        <h3 style="margin:0">Live-Ops Dashboard</h3>
        <button class="chip-btn" id="admin-dash-refresh">Aktualisieren</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.75rem">
        <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.75rem;background:rgba(0,0,0,.16)">
          <div class="muted small">Online</div>
          <b>${d.online?.accounts || 0} Accounts</b><div class="small muted">${d.online?.sockets || 0} Tabs verbunden</div>
          <div class="small" style="margin-top:.35rem">${online.length ? online.map((p) => escapeHtml(p.name)).join(", ") : "Niemand online"}</div>
        </div>
        <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.75rem;background:rgba(0,0,0,.16)">
          <div class="muted small">Events</div>
          <b>${laufen ? `${laufen} ${laufen === 1 ? "läuft" : "laufen"}` : "Keins aktiv"}</b>
          <div class="small muted" style="margin-top:.35rem">${
            laufen
              ? escapeHtml(EVENTS.filter((e) => (evZustand[e.id] || {}).active).map((e) => e.name).join(", "))
              : "Starten und stoppen im Reiter „Events“."}</div>
          <button class="chip-btn" id="admin-zu-events" style="margin-top:.5rem">Zu den Events</button>
        </div>
        <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.75rem;background:rgba(0,0,0,.16)">
          <div class="muted small">Casino gesamt</div>
          <b>${adminMoney(d.totals?.chips || 0)}</b><div class="small muted">Bank: ${adminMoney(d.totals?.bank || 0)} · Accounts: ${d.totals?.accounts || 0}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem">
        <div><div class="muted small" style="margin-bottom:.25rem">Wochengewinner</div><ol class="leaderboard" style="margin:0">${miniList(winners, (p) => `+${adminMoney(p.weeklyNet)}`, "Keine Gewinne diese Woche.")}</ol></div>
        <div><div class="muted small" style="margin-bottom:.25rem">Wochenverluste</div><ol class="leaderboard" style="margin:0">${miniList(losers, (p) => `-${adminMoney(Math.abs(p.weeklyNet || 0))}`, "Keine Verluste diese Woche.")}</ol></div>
        <div><div class="muted small" style="margin-bottom:.25rem">Große Ausschläge</div><ol class="leaderboard" style="margin:0">${miniList(alerts, (p) => `W ${adminMoney(p.biggestWin)} / L ${adminMoney(p.biggestLoss)}`, "Keine großen Ausschläge.")}</ol></div>
      </div>`;
    $("#admin-dash-refresh")?.addEventListener("click", loadAdminDashboard);
    /* Die sieben Sofort-Knoepfe sind weg. Sie feuerten ohne Rueckfrage mit
       fest eingebauten Werten, die ausserdem von den Feldern weiter unten
       abwichen — zwei Wahrheiten fuer dieselbe Sache, und ein Fehlklick auf
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

function loadAdminLots() {
  const list = $("#admin-lot-list");
  if (!list) return;
  list.innerHTML = '<li class="muted">Lädt…</li>';
  socket.emit("admin:cityLots", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">Fehler.</li>'; return; }
    if (!res.lots.length) { list.innerHTML = '<li class="muted">Keine Gebäude im Besitz.</li>'; return; }
    list.innerHTML = "";
    res.lots.forEach((l) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${l.emoji} ${escapeHtml(l.name)} — ${l.owner ? escapeHtml(l.owner) : "?"}</span>`;
      const btn = document.createElement("button");
      btn.className = "btn-danger";
      btn.textContent = "Freigeben";
      btn.addEventListener("click", () => {
        socket.emit("admin:clearLot", { plotId: l.id }, (r) => {
          if (r && r.ok) { toast("Gebäude freigegeben."); loadAdminLots(); }
          else toast((r && r.error) || "Fehler.");
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  });
}

$("#admin-reset-city-btn")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Wirklich die GANZE Stadt zurücksetzen? Alle Grundstücke und Unternehmen gehen an NPC zurück.", { okText: "Zurücksetzen", gefahr: true })) return;
  socket.emit("admin:resetCity", (r) => {
    if (r && r.ok) { toast("Stadt zurückgesetzt."); loadAdminLots(); }
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-set-chips-btn").addEventListener("click", () => {
  const errEl = $("#admin-chips-error");
  errEl.textContent = "";
  const target = $("#admin-target-chips").value.trim();
  const amount = parseInt($("#admin-amount").value, 10);
  if (!target || !Number.isFinite(amount) || amount < 0) { errEl.textContent = "Ungültige Eingabe."; return; }
  socket.emit("admin:setChips", { target, amount }, (res) => {
    if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
    toast(`${target}: Chips auf ${amount.toLocaleString("de-DE")} Chips gesetzt.`);
    loadAdminAccounts();
  });
});

/* ===========================================================================
   Ansage an alle (Admin)
   ---------------------------------------------------------------------------
   Vorher: ein Textfeld, zwei Knoepfe, fertig. Man sah nicht, ob gerade eine
   Ansage steht, nicht wie sie beim Spieler aussieht, nicht was man zuletzt
   gesagt hat, und sie blieb stehen, bis jemand daran dachte, sie
   wegzunehmen — bei "heute ab 20 Uhr" ist das der Normalfall.
   ========================================================================= */

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

    // Verlauf. Vorher gab es keinen — man wusste nicht, was man vor drei
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
        // Antippen uebernimmt den Text — eine wiederkehrende Ansage
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
     zurueckholen. Dafuer lohnt die eine Rueckfrage — der Knopf sitzt direkt
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
      ? `Ansage steht — ${res.pushErreicht || 0} ${res.pushErreicht === 1 ? "Gerät" : "Geräte"} benachrichtigt.`
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

["admin-shadow-on-btn", "admin-shadow-off-btn"].forEach((id) => {
  $("#" + id)?.addEventListener("click", () => {
    const errEl = $("#admin-ban-error");
    errEl.textContent = "";
    const target = $("#admin-target-ban").value.trim();
    if (!target) { errEl.textContent = "Spielername eingeben."; return; }
    const on = id === "admin-shadow-on-btn";
    socket.emit("admin:shadowban", { target, on }, (res) => {
      if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
      toast(on ? `🌑 ${target} ist jetzt ein Pechvogel.` : `🌞 ${target} hat wieder normales Glück.`);
      loadAdminAccounts();
    });
  });
});

["admin-ban-btn","admin-unban-btn"].forEach((id) => {
  $("#" + id).addEventListener("click", () => {
    const errEl = $("#admin-ban-error");
    errEl.textContent = "";
    const target = $("#admin-target-ban").value.trim();
    if (!target) { errEl.textContent = "Spielername eingeben."; return; }
    const event = id === "admin-ban-btn" ? "admin:ban" : "admin:unban";
    socket.emit(event, { target }, (res) => {
      if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
      toast(id === "admin-ban-btn" ? `${target} gesperrt.` : `${target} entsperrt.`);
      $("#admin-target-ban").value = "";
      loadAdminAccounts();
    });
  });
});

// ---- Admin: IP-Bann ----
$("#admin-ipban-btn")?.addEventListener("click", () => {
  const errEl = $("#admin-ipban-error");
  errEl.textContent = "";
  const raw = $("#admin-ipban-input").value.trim();
  if (!raw) { errEl.textContent = "Spielername oder IP eingeben."; return; }
  // Enthält Punkte/Doppelpunkte → als IP behandeln, sonst als Spielername.
  const isIp = /[.:]/.test(raw) && !/\s/.test(raw);
  socket.emit("admin:ipban", isIp ? { ip: raw } : { target: raw }, (res) => {
    if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
    toast(`🚫 IP ${res.ip} gesperrt (${res.kicked} Verbindung${res.kicked === 1 ? "" : "en"} getrennt).`);
    $("#admin-ipban-input").value = "";
    loadIpBans();
  });
});

function loadIpBans() {
  const list = $("#admin-ipban-list");
  if (!list) return;
  socket.emit("admin:ipbanList", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">—</li>'; return; }
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
          toast(`✅ IP ${b.ip} entsperrt.`);
          loadIpBans();
        });
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  });
}

// Beim Öffnen des Admin-Screens die IP-Bann-Liste mitladen.
socket.on("ipbanned", () => { window.Casino.dialog.hinweis("Deine IP-Adresse wurde gesperrt."); });

// ---- Admin: Test-Tools ----
$("#admin-force-win-btn")?.addEventListener("click", () => {
  socket.emit("admin:slotsForceWin", (r) => {
    if (r && r.ok) toast("🎰 Scharf! Dein nächster Slot-Spin ist der MAXIMALGEWINN.");
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-city-event-btn")?.addEventListener("click", () => {
  socket.emit("admin:cityEvent", {}, (r) => {
    if (r && r.ok) toast(`📰 Ausgelöst: ${r.event.txt}`);
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-new-week-btn")?.addEventListener("click", async () => {
  if (!await window.Casino.dialog.frage("Woche JETZT beenden? Kürt den Spieler der Woche und würfelt eine neue Goldene Straße.", { okText: "Beenden" })) return;
  socket.emit("admin:newWeek", (r) => {
    if (r && r.ok) toast("🗓️ Neue Woche eingeläutet — siehe Chat.");
    else toast((r && r.error) || "Fehler.");
  });
});

$("#admin-comeback-on-btn")?.addEventListener("click", async () => {
  const minutes = parseInt($("#admin-comeback-mins").value, 10) || 120;
  const pot = parseInt($("#admin-comeback-pot").value, 10) || 250000;
  // Einmal nachfragen: das laesst sich nicht zurueckdrehen, und alle
  // einundsiebzig Konten bekommen sofort eine Nachricht.
  const ja = await window.Casino.dialog.frage(
    `Wiedereröffnung jetzt ausrufen?\n\nAlle bekommen 14 Tage lang ihr Willkommens-Paket, die Gala läuft ${minutes} Minuten mit ${pot.toLocaleString("de-DE")}<i class=mk></i> im Topf. Es geht eine Ansage in den Chat und eine Benachrichtigung an alle, die welche anhaben.`,
    { titel: "🎊 Wiedereröffnung", okText: "Ausrufen" });
  if (!ja) return;
  socket.emit("admin:comeback", { on: true, minutes, pot }, (r) =>
    toast(r?.ok ? `🎊 Wiedereröffnung läuft — Gala ${r.minuten} Min, ${Number(r.topf).toLocaleString("de-DE")} Chips im Topf.` : (r?.error || "Fehler.")));
});
$("#admin-comeback-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:comeback", { on: false }, (r) => toast(r?.ok ? "Gala abgerechnet." : (r?.error || "Fehler.")));
});

/* ===========================================================================
   Events (Admin)
   ---------------------------------------------------------------------------
   Vorher an zwei Orten mit zwei verschiedenen Wahrheiten: oben im Dashboard
   sieben Knoepfe, die sofort und ohne Rueckfrage mit fest eingebauten Werten
   feuerten, und unten sechs Zeilen mit nackten Zahlenfeldern, deren
   Bedeutung nur im title-Attribut stand — auf dem iPad also nirgends. Ein
   Fehlklick auf "Regen" schuettete 250.000 Chips aus.

   Jetzt: eine Karte je Event, beschriftete Felder, der Zustand mit Restzeit
   auf der Karte, und eine Rueckfrage vor allem, was Chips ausschuettet.
   ========================================================================= */

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
    chips: true, braucht: 2,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 60, min: 15, max: 300 },
      { k: "loot", label: "Beute", wert: 500000, min: 1000, schritt: 50000, geld: true },
    ],
  },
  {
    id: "rain", name: "Chip-Regen", icon: "chip", ev: "admin:rain",
    was: "Chips fallen über den Bildschirm, wer zuerst tippt, bekommt sie.",
    chips: true,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 30, min: 10, max: 180 },
      { k: "pot", label: "Topf", wert: 250000, min: 1000, schritt: 50000, geld: true },
    ],
  },
  {
    id: "quiz", name: "Blitz-Quiz", icon: "frage", ev: "admin:quiz",
    was: "Ein paar schnelle Fragen, wer zuerst richtig antwortet, kassiert.",
    chips: true,
    felder: [
      { k: "rounds", label: "Fragen", wert: 5, min: 1, max: 15 },
      { k: "prize", label: "Preis je Frage", wert: 20000, min: 500, schritt: 5000, geld: true },
    ],
  },
  {
    id: "vault", name: "Tresorkampf", icon: "krieg", ev: "admin:teamvault",
    was: "Zwei Mannschaften hauen um die Wette. Braucht Leute auf beiden Seiten.",
    chips: true, braucht: 2,
    felder: [
      { k: "seconds", label: "Sekunden", wert: 90, min: 20, max: 300 },
      { k: "pot", label: "Topf", wert: 500000, min: 1000, schritt: 50000, geld: true },
    ],
  },
];

let evZustand = {};       // id -> Zustand vom Server
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

/** Kurze Events (unter zwei Minuten) loesen bewusst keinen Push aus. */
const EV_KURZ = new Set(["rain", "heist", "vault", "quiz"]);

function renderAdminEvents() {
  const box = $("#admin-events");
  if (!box) return;

  const onlineEl = $("#ev-online");
  if (onlineEl) {
    onlineEl.textContent = evOnline === 0
      ? "Gerade ist niemand online — ein Event liefe ins Leere."
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
    return `<div class="ev-karte${laeuft ? " an" : ""}" data-ev="${e.id}">
      <div class="ev-kopf">
        <span class="ev-sym">${window.Casino.icons.ui(e.icon)}</span>
        <div><b>${escapeHtml(e.name)}</b><small>${escapeHtml(e.was)}</small></div>
      </div>
      ${zeile}
      ${zuWenig && !laeuft ? `<p class="ev-hinweis">Braucht mindestens ${e.braucht} Leute — gerade ${evOnline} online.</p>` : ""}
      ${EV_KURZ.has(e.id) ? `<p class="ev-hinweis ev-leise">Zu kurz für eine Benachrichtigung — es erreicht nur, wer gerade da ist.</p>` : ""}
      <div class="ev-felder">
        ${e.felder.map((f) => `<label class="ev-feld">
          <span>${escapeHtml(f.label)}</span>
          <input type="number" inputmode="numeric" data-ev-feld="${f.k}"
                 value="${f.wert}"${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.schritt ? ` step="${f.schritt}"` : ""} />
        </label>`).join("")}
      </div>
      <div class="ev-knoepfe">
        <button class="btn-primary ev-start"${laeuft ? " disabled" : ""}>${laeuft ? "Läuft bereits" : "Starten"}</button>
        <button class="btn-danger ev-stop"${laeuft ? "" : " disabled"}>Abbrechen</button>
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
      return out;
    };

    karte.querySelector(".ev-start")?.addEventListener("click", async () => {
      const w = werte();

      /* Rueckfrage vor allem, was Chips ins Spiel bringt. Das war der
         eigentliche Mangel: die Schnellknoepfe im Dashboard feuerten sofort,
         und ein Topf ist mit einem Klick draussen und nicht zurueckzuholen. */
      if (e.chips) {
        const geld = e.felder.find((f) => f.geld);
        const betrag = geld ? w[geld.k] : 0;
        const ok = await window.Casino.dialog.frage(
          `${e.name} starten und ${evGeld(betrag)} Chips ausschütten?` +
          (evOnline < 2 ? `\n\nGerade ${evOnline === 0 ? "ist niemand" : "ist nur einer"} online.` : ""),
          { titel: e.name, okText: "Starten" });
        if (!ok) return;
      }
      socket.emit(e.ev, w, (r) => {
        toast(r?.ok ? `${e.name} gestartet.` : (r?.error || "Fehler."));
        loadAdminDashboard();
      });
    });

    karte.querySelector(".ev-stop")?.addEventListener("click", async () => {
      if (!await window.Casino.dialog.frage(`${e.name} jetzt abbrechen?`,
        { okText: "Abbrechen", abbruchText: "Weiterlaufen lassen", gefahr: true })) return;
      socket.emit(e.ev, { on: false }, (r) => {
        toast(r?.ok ? `${e.name} beendet.` : (r?.error || "Fehler."));
        loadAdminDashboard();
      });
    });
  });

  /* Die Restzeiten laufen mit, solange der Bildschirm offen ist. Vorher
     stand dort eine Zahl, die beim Laden stimmte und danach nicht mehr. */
  clearInterval(evUhr);
  evUhr = null;
  if (EVENTS.some((e) => (evZustand[e.id] || {}).active)) {
    evUhr = setInterval(() => {
      if (window.Casino.screens.current() !== "admin") { clearInterval(evUhr); evUhr = null; return; }
      let nochAktiv = false;
      box.querySelectorAll(".ev-karte.an").forEach((k) => {
        const z = evZustand[k.dataset.ev] || {};
        if (!z.endsAt) return;
        const span = k.querySelector(".ev-laeuft span");
        if (span) span.textContent = evRest(z.endsAt);
        if (z.endsAt > Date.now()) nochAktiv = true;
      });
      // Abgelaufen? Dann den echten Stand holen statt zu raten.
      if (!nochAktiv) loadAdminDashboard();
    }, 1000);
  }
}

// ---- 💾 Daten-Backup (Owner): kompletten data/-Ordner laden / zurückspielen ----
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
    toast(`💾 Backup mit ${Object.keys(data.files).length} Dateien heruntergeladen — gut aufheben!`);
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
    const n = Object.keys(data.files).length;
    const when = data.createdAt ? new Date(data.createdAt).toLocaleString("de-DE") : "unbekannt";
    if (!await window.Casino.dialog.frage(`Backup vom ${when} (${n} Dateien) einspielen?\n\nÜBERSCHREIBT alle aktuellen Spieldaten. Der Server startet danach neu, alle Spieler fliegen kurz raus.`, { titel: "⚠️ Backup einspielen", okText: "Einspielen", gefahr: true })) return;
    const res = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: state.token, files: data.files }) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "Wiederherstellen fehlgeschlagen.");
    toast(`📂 ${out.written} Dateien eingespielt — Server startet neu, Seite lädt gleich nach …`);
    setTimeout(() => location.reload(), 5000);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

["admin-reset-bonus-btn", "admin-reset-ach-btn"].forEach((id) => {
  $("#" + id)?.addEventListener("click", () => {
    const errEl = $("#admin-test-error");
    errEl.textContent = "";
    const target = $("#admin-target-test").value.trim();
    if (!target) { errEl.textContent = "Spielername eingeben."; return; }
    const event = id === "admin-reset-bonus-btn" ? "admin:resetBonus" : "admin:resetAchievements";
    socket.emit(event, { target }, (res) => {
      if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
      toast(id === "admin-reset-bonus-btn" ? `${target}: Bonus & Soforthilfe wieder verfügbar.` : `${target}: Achievements zurückgesetzt.`);
    });
  });
});

// ============================================================
// Einstellungen: Design, Ton, Bewegung
// ============================================================

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
    const el = $("#login-start-chips");
    if (el && cfg.startingChips) el.textContent = cfg.startingChips.toLocaleString("de-DE");
  } catch {
    // Ohne Verbindung bleibt der Wert aus dem HTML stehen. Kein Drama.
  }
})();

// ---- Start ----
// Try to resume a stored session before falling back to the login screen, so a
// discarded tab returns straight to the lobby. The login screen is the markup
// default, so a failed resume needs no extra work.
(async function boot() {
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  if (!token) return showScreen("login", { history: "replace" });

  /*
   * Warten, bis wirklich alle Spielmodule ausgefuehrt sind.
   *
   * Die rund vierzig Dateien haengen als `defer` im Dokument: sie laden
   * parallel und laufen dann der Reihe nach, alle vor DOMContentLoaded.
   * Diese Datei ist die dritte davon — die Sitzungsabfrage startet also,
   * waehrend stats.js, clans.js und der Rest noch unterwegs sind.
   *
   * Kam die Antwort zurueck, bevor das Modul zum Zielscreen dran war, rief
   * der Router dessen Ladefunktion auf, als es sie noch nicht gab. Der
   * Router versucht es kein zweites Mal, also blieb der Screen fuer immer
   * auf "Lädt…". Zu sehen bekam das, wer die Seite auf einem Unterscreen
   * neu lud oder einen geteilten Link oeffnete — auf dem iPad, wo jede
   * Datei einzeln ueber die Leitung muss, deutlich haeufiger als hier.
   *
   * Drei Module (records, comeback, home) hatten sich das mit einem eigenen
   * Nachzieher gefangen. Die anderen sechsundzwanzig nicht. Deshalb steht
   * die Loesung hier an der Wurzel und nicht sechsundzwanzigmal verteilt.
   */
  // Achtung bei der Abfrage: waehrend ein `defer`-Skript laeuft, steht
  // readyState schon auf "interactive" — das Dokument ist geparst, die
  // Skripte sind es nicht. Erst "complete" heisst, dass alle durch sind.
  const modulenBereit = document.readyState === "complete"
    ? Promise.resolve()
    : new Promise((fertig) => document.addEventListener("DOMContentLoaded", fertig, { once: true }));

  try {
    const data = await api("/api/session", { token });
    if (data.config?.bonusCooldownMs) state.bonusCooldownMs = data.config.bonusCooldownMs;
    setAccount(data.account, data.token);
    // Geteilter Link? Dann dorthin, sonst in die Lobby. In beiden Faellen
    // ersetzen statt anhaengen, damit die Zurueck-Geste nicht auf einem
    // leeren Eintrag vor dem Start landet.
    await modulenBereit;
    const deep = window.Casino.screens.fromHash();
    const target = deep && deep !== "login" && window.Casino.screens.exists(deep) ? deep : "lobby";
    if (!showScreen(target, { history: "replace" })) showScreen("lobby", { history: "replace" });
  } catch {
    // Expired, revoked or account gone → clean up and ask for the password.
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    showScreen("login", { history: "replace" });
  }
})();
