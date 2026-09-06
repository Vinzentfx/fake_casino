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
window.Casino.screens.register("admin", { onEnter: () => loadAdminAccounts() });
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
  const at = Number(announcement.at) || 0;
  metaEl.textContent = at
    ? `Ankündigung · ${new Date(at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
    : "Ankündigung";
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
  return `<div class="update-item"><span>${item.icon}</span><div>` +
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
  const neu = alleNeu.slice(0, MAX_IM_FENSTER);
  const weitere = alleNeu.length - neu.length;

  const modal = $("#update-modal");
  if (!modal) return;

  // "Comeback" nur, wenn wirklich etwas verpasst wurde: mehr als ein Update
  // oder eines, das als grosses markiert ist. Bei einer kleinen Aenderung
  // waere die Begruessung uebertrieben.
  const comeback = alleNeu.length > 1 || alleNeu.some((r) => r.gross);
  $("#update-emoji").textContent = comeback ? "👋" : "🎉";
  $("#update-title").textContent = comeback ? "Comeback!" : "Neu im Casino";
  $("#update-sub").textContent = comeback
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
    ? `<p class="update-more">…und ${weitere} ${weitere === 1 ? "älteres Update" : "ältere Updates"}. Alles davon steht im Menü unter <b>Updates</b>.</p>`
    : "");

  modal.classList.remove("hidden");
}

$("#update-close")?.addEventListener("click", () => {
  $("#update-modal")?.classList.add("hidden");
  if (window.Casino.changelog) merkeStand(window.Casino.changelog.neueste);
  renderUpdateBadge();
});
$("#update-all")?.addEventListener("click", () => {
  $("#update-modal")?.classList.add("hidden");
  if (window.Casino.changelog) merkeStand(window.Casino.changelog.neueste);
  renderUpdateBadge();
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
function renderUpdateBadge() {
  const cl = window.Casino.changelog;
  const btn = $("#menu-btn");
  const sub = $("#menu-updates-sub");
  if (!cl || !btn) return;
  const neu = cl.neuSeit(gesehenerStand());
  btn.classList.toggle("has-news", neu.length > 0);
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
  if (shouldToast && announcement && announcement.text) toast(`📣 ${announcement.text}`);
});

// Server can push an updated bank balance (e.g. after a poker buy-in/cash-out).
socket.on("account:update", ({ account }) => {
  if (!account) return;
  state.account = { ...state.account, ...account };
  renderTopbar();
  if (currentScreen === "profile") renderProfile();
});

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
    const level = p.level ? `<small style="color:${p.level.color || ""}">${escapeHtml(p.level.emoji || "🌱")} ${p.level.level}</small>` : "";
    const clan = p.clan ? `<small class="online-clan">[${escapeHtml(p.clan)}]</small>` : "";
    const status = p.status && p.status.label ? escapeHtml(p.status.label) : "online";
    return `<button class="online-player" type="button" data-player-profile="${escapeHtml(p.name || "")}" title="${escapeHtml(p.name || "?")} ansehen">` +
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
    `<button class="online-player last-player" type="button" data-player-profile="${escapeHtml(p.name || "")}">` +
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
const BUFF_META = {
  fastSpins:  { icon: "⚡", label: "2× Spins" },
  clickBoost: { icon: "☕", label: "×5 Arbeit" },
  winBoost:   { icon: "🍀", label: "+Gewinn" },
  vip:        { icon: "🎟️", label: "VIP" },
};
function renderBuffs() {
  const el = $("#buff-strip");
  if (!el) return;
  const buffs = (state.account && state.account.buffs) || {};
  const now = Date.now();
  const items = Object.entries(buffs)
    .filter(([, b]) => b.until > now)
    .map(([type, b]) => {
      const m = BUFF_META[type] || { icon: "✨", label: type };
      const mins = Math.ceil((b.until - now) / 60000);
      const lbl = type === "winBoost" ? `+${Math.round((b.mult - 1) * 100)}%` : m.label;
      return `<span class="buff-chip" title="${m.label}">${m.icon} ${lbl} <small>${mins}m</small></span>`;
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
  "nm-neon", "nm-regenbogen", "nm-feuer", "nm-glitch", "nm-krone", "nm-s2_bernstein", "nm-s2_phoenix"];
const RAHMEN_KLASSEN = ["fr-silber", "fr-gold", "fr-neon", "fr-rotierend", "fr-flamme", "fr-sterne", "fr-s2_wolf"];

function setzeNamensStil(el, acc) {
  if (!el) return;
  el.textContent = acc.name;
  el.classList.remove(...NAMENS_KLASSEN);
  const stil = acc.nameStyle && NAMENS_KLASSEN.includes("nm-" + acc.nameStyle) ? "nm-" + acc.nameStyle : null;
  if (stil) { el.classList.add(stil); el.style.color = ""; }
  else el.style.color = acc.nameColor || "";
}

function setzeRahmen(el, acc) {
  if (!el) return;
  el.classList.remove(...RAHMEN_KLASSEN, "pl-ava");
  if (!acc.frame) return;
  const kl = "fr-" + acc.frame;
  if (!RAHMEN_KLASSEN.includes(kl)) return;
  el.classList.add("pl-ava", kl);
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
    lc.textContent = `${acc.level.emoji} ${acc.level.level}`;
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
    kachel("Guthaben", chips.toLocaleString("de-DE") + " 🪙") +
    kachel("Netto-Vermögen", (acc.netWorth ?? chips).toLocaleString("de-DE") + " 🪙") +
    kachel("Gespielte Runden", gespielt.toLocaleString("de-DE")) +
    kachel("Größter Gewinn", groesster.toLocaleString("de-DE") + " 🪙") +
    kachel("Mitglied seit", acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "–");

  /* Der Rest (Stadt-Imperium, Clan, Achievements) kommt vom Server. Vorher
     wurde derselbe Aufruf nur benutzt, um das Level nachzuladen — die Daten
     zum Imperium lagen ungenutzt in der Antwort. */
  fetch("/api/account/" + encodeURIComponent(acc.name))
    .then((r) => r.json())
    .then((d) => {
      if (d.account && d.account.level) { state.account.level = d.account.level; renderLevel(d.account.level); }

      const tags = [];
      if (d.clan) tags.push(`<span class="pf-tag">🛡️ ${escapeHtml(d.clan)}</span>`);
      if (d.ach && d.ach.badge) tags.push(`<span class="pf-tag">${d.ach.badge}</span>`);
      if (d.bounty) tags.push(`<span class="pf-tag pf-tag-bounty">🎯 Kopfgeld ${Number(d.bounty).toLocaleString("de-DE")} 🪙</span>`);
      $("#profile-tags").innerHTML = tags.join("");

      const c = d.city;
      const cityEl = $("#profile-city");
      if (cityEl) {
        if (c && c.houses) {
          const trophaeen = (c.trophies || []).length;
          cityEl.innerHTML =
            `<h3 class="section-title">🏙️ Dein Imperium</h3><div class="pf-stats">` +
            kachel("Häuser", Number(c.houses).toLocaleString("de-DE")) +
            kachel("Wert", Number(c.value || 0).toLocaleString("de-DE") + " 🪙") +
            kachel("Straßen-Monopole", Number(c.streets || 0)) +
            (trophaeen ? kachel("Trophäen", trophaeen) : "") +
            ((c.bossOf || []).length ? kachel("Stadtteil-Boss", (c.bossOf || []).join(", ")) : "") +
            `</div>`;
        } else {
          cityEl.innerHTML =
            `<h3 class="section-title">🏙️ Dein Imperium</h3>` +
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
          : `+${a.reward.toLocaleString("de-DE")} 🪙`;
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
  { key: "memory",  label: "🧠 Memory-Duell", screen: "memory",    ev: "memory:create",  extra: { size: "medium" } },
  { key: "sudoku",  label: "🔢 Sudoku-Race",  screen: "sudoku",    ev: "sudoku:create",  extra: { difficulty: "medium" } },
  { key: "solrace", label: "🃏 Solitär-Race", screen: "solitaire", ev: "solrace:create", extra: {} },
  { key: "chess",   label: "♟️ Schach-Duell", screen: "chess",     ev: "chess:create",   extra: { tc: "5+0" } },
];
const DUEL_JOIN_HOOK = { memory: "_memoryJoinCode", sudoku: "_sudokuJoinCode", solrace: "_solraceJoinCode", chess: "_chessJoinCode" };
const DUEL_LABEL = { memory: "Memory-Duell", sudoku: "Sudoku-Race", solrace: "Solitär-Race", chess: "Schach-Duell" };

function openChallengePicker(name) {
  const body = $("#player-profile-body");
  if (!body || !name) return;
  body.innerHTML = `
    <div class="challenge-picker">
      <h2>⚔️ ${escapeHtml(name)} herausfordern</h2>
      <p class="muted small">Wähle ein Spiel und den Einsatz. ${escapeHtml(name)} bekommt eine Einladung und muss sie annehmen.</p>
      <div class="challenge-games">
        ${DUEL_GAMES.map((g) => `<button class="btn-secondary challenge-game" data-game="${g.key}">${g.label}</button>`).join("")}
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
  if (!Number.isFinite(stake) || stake < 50) { if (errEl) errEl.textContent = "Mindest-Einsatz 50 🪙."; return; }
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
  const txt = `⚔️ ${from} fordert dich zu ${label || DUEL_LABEL[game] || "einem Duell"} heraus\nEinsatz: ${Number(stake || 0).toLocaleString("de-DE")} 🪙\n\nAnnehmen?`;
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
    const city = data.city || {};
    const badgeLine = ach.unlocked && ach.unlocked.length
      ? ach.unlocked.slice(0, 10).map((b) => `<span class="mini-badge" title="${escapeHtml(b.label)}">${escapeHtml(b.emoji)}</span>`).join("")
      : '<span class="muted small">Noch keine Badges</span>';
    const clan = data.clan ? `[${escapeHtml(data.clan)}]` : "";
    const isMe = state.account && String(state.account.name || "").toLowerCase() === String(acc.name || name).toLowerCase();
    body.innerHTML = `
      <div class="player-profile-head"${acc.banner ? ` data-banner="${escapeHtml(acc.banner)}"` : ""}>
        <div class="player-profile-avatar">${window.Casino.spieler.avatar(acc)}</div>
        <div>
          <h2>${window.Casino.spieler.name(acc)} ${clan}</h2>
          ${acc.title ? `<div class="pl-title">${escapeHtml(acc.title)}</div>` : ""}
          <div class="muted small">Dabei seit ${acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("de-DE") : "–"}</div>
        </div>
      </div>
      <div class="player-profile-level">${levelHtml(acc.level)}</div>
      <div class="player-profile-stats">
        <div><span>Chips</span><b>${statText(acc.chips)} 🪙</b></div>
        <div><span>Networth</span><b>${statText(acc.netWorth)} 🪙</b></div>
        <div><span>Spiele</span><b>${statText(stats.gamesPlayed)}</b></div>
        <div><span>Größter Gewinn</span><b>${statText(stats.biggestWin)} 🪙</b></div>
        <div><span>Stadtwert</span><b>${statText(city.value)} 🪙</b></div>
        <div><span>Häuser</span><b>${statText(city.houses)}</b></div>
      </div>
      <div class="player-profile-badges">
        <div class="muted small">${(ach.unlocked || []).length}/${ach.total || 0} Achievements</div>
        <div>${badgeLine}</div>
      </div>
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
    if (data.created) toast(`Willkommen, ${data.account.name}! ${(data.account.chips || 0).toLocaleString("de-DE")} 🪙 geschenkt.`);
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
      <div class="cal-reward">${r.toLocaleString("de-DE")} 🪙</div>
      <div class="cal-mark">${claimed ? "✓" : isNext ? "★" : ""}</div>
    </div>`;
  }).join("");
  if (btn) {
    btn.disabled = !s.canClaim;
    btn.textContent = s.canClaim ? `Tag ${s.current + 1} abholen — ${s.rewards[s.current].toLocaleString("de-DE")} 🪙` : "✓ Heute schon abgeholt — morgen wieder!";
  }
}
function loadCalendar() {
  socket.emit("calendar:state", (s) => { if (s && s.ok) renderCalendar(s); });
}
$("#calendar-claim-btn")?.addEventListener("click", () => {
  socket.emit("calendar:claim", (r) => {
    if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
    setAccount(r.account);
    toast(`📅 Tag ${r.day} — +${r.reward.toLocaleString("de-DE")} 🪙!`);
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
    parts.push(`<span class="lo-chip tourney">🏁 Slot-Turnier · ${s.tourney.prize.toLocaleString("de-DE")} 🪙 · noch ${min} Min${lead ? ` · 👑 ${escapeHtml(lead.name)} (${lead.mult}×)` : ""}</span>`);
  }
  el.innerHTML = parts.join("");
  el.classList.toggle("hidden", parts.length === 0);
}
socket.on("liveops:state", (s) => { liveopsState = s; renderLiveops(); });
socket.on("connect", () => socket.emit("liveops:state", (r) => { if (r && r.ok) { liveopsState = r; renderLiveops(); } }));
socket.on("liveops:tourneyWin", (w) => { if (w) toast(`🏆 Turnier gewonnen: ${w.name} mit ${w.mult}× (+${w.prize.toLocaleString("de-DE")} 🪙)!`); });
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
    btn.textContent = "🎁 Bonus";
    if (heroSub) heroSub.textContent = "Jetzt abholen";
    heroBtn?.classList.add("ready");
    heroBtn && (heroBtn.disabled = false);
  } else {
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const t = (left >= 3600000 ? Math.floor(left / 3600000) + ":" : "") +
      String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    btn.textContent = `⏳ ${t}`;
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
          <span class="hero-level-badge" style="color:${l.color || "inherit"}">${escapeHtml(l.emoji || "🌱")} Level ${l.level}</span>
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
    toast(`+${data.amount.toLocaleString("de-DE")} 🪙 Bonus!${streakNote}${extras.length ? " · " + extras.join(" · ") : ""}`);
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
    toast(`🆘 +${data.amount.toLocaleString("de-DE")} 🪙 Soforthilfe!`);
  } catch (err) {
    toast(err.message || "Soforthilfe nicht verfügbar.");
  }
}
$("#rescue-btn").addEventListener("click", claimRescue);

// ---- Leaderboard (multi-category, tabbed) ----
const LB_ORDER = ["rich", "level", "horses", "estate", "streets", "bigwin", "bigloss", "games"];
// How a category's value is displayed (default: chips).
const LB_UNIT = { level: (v) => `Level ${v}`, streets: (v) => `${v} 👑`, games: (v) => `${v.toLocaleString("de-DE")} Spiele`, horses: (v) => `${v} 🏆` };
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
    b.textContent = lbData[cat].label;
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
  const medals = ["🥇", "🥈", "🥉"];
  list.innerHTML = "";
  entries.forEach((p, i) => {
    const li = document.createElement("li");
    const me = state.account && p.name === state.account.name;
    const rank = medals[i] || `${i + 1}.`;
    const unit = LB_UNIT[lbActiveCat];
    const badge = p.badge ? ` <span class="lb-badge" title="Achievement">${p.badge}</span>` : "";
    const champ = p.champ ? ` <span class="lb-badge" title="Spieler der Woche">🏆</span>` : "";
    const lvl = p.level ? ` <span class="lb-level" title="Level ${p.level}">Lv ${p.level}</span>` : "";
    const clan = p.clan ? ` <span class="lb-clan">[${escapeHtml(p.clan)}]</span>` : "";
    const ava = window.Casino.spieler.avatar(p);
    const nm = window.Casino.spieler.name(p, { tag: "b" });
    const titel = window.Casino.spieler.title(p);
    li.innerHTML =
      `<span>${rank}${clan} ${ava} ${nm}${titel}${lvl}${champ}${badge}${me ? " (du)" : ""}</span>` +
      `<b>${unit ? unit(p.value) : p.value.toLocaleString("de-DE") + " 🪙"}</b>`;
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
    toast(`${amount.toLocaleString("de-DE")} 🪙 an ${to} gesendet!`);
  });
});

// Benachrichtigung wenn jemand Chips schickt
socket.on("account:received", ({ from, amount }) => {
  toast(`+${amount.toLocaleString("de-DE")} 🪙 von ${from} erhalten!`);
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
        `<div class="admin-acc-top"><span>${escapeHtml(p.name)}${p.banned ? " 🚫" : ""}${p.shadowban ? " 🌑" : ""}</span><b>${p.chips.toLocaleString("de-DE")} 🪙</b></div>` +
        `<div class="admin-acc-lb">Bank: <b>${savings.toLocaleString("de-DE")} 🪙</b>` +
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
            toast(`${p.name}: Bank geleert (${(r.cleared || 0).toLocaleString("de-DE")} 🪙).`);
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
  return `${Math.floor(Number(n) || 0).toLocaleString("de-DE")} 🪙`;
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
    const eventLines = [
      live.happyActive ? `Happy Hour: aktiv (${adminTimeLeft(live.happyUntil)})` : "Happy Hour: aus",
      tourney ? `Turnier: ${adminMoney(tourney.prize)} (${adminTimeLeft(tourney.endsAt)})` : "Turnier: aus",
      d.events && d.events.heistActive ? "Heist: aktiv" : "Heist: aus",
      d.events && d.events.rainActive ? "Chip-Regen: aktiv" : "Chip-Regen: aus",
      d.events && d.events.quizActive ? "Quiz: aktiv" : "Quiz: aus",
      d.events && d.events.vaultActive ? "Tresorkampf: aktiv" : "Tresorkampf: aus",
    ];
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
          <div class="small">${eventLines.map(escapeHtml).join("<br>")}</div>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="chip-btn" data-admin-dash="happy">Happy</button>
            <button class="chip-btn" data-admin-dash="tourney">Turnier</button>
            <button class="chip-btn" data-admin-dash="heist">Heist</button>
            <button class="chip-btn" data-admin-dash="rain">Regen</button>
            <button class="chip-btn" data-admin-dash="quiz">Quiz</button>
            <button class="chip-btn" data-admin-dash="vault">Tresorkampf</button>
            <button class="chip-btn" data-admin-dash="city">City</button>
          </div>
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
    box.querySelectorAll("[data-admin-dash]").forEach((btn) => btn.addEventListener("click", () => {
      const kind = btn.dataset.adminDash;
      if (kind === "happy") socket.emit("admin:happyHour", { on: true, minutes: 60 }, (r) => { toast(r?.ok ? "Happy Hour gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "tourney") socket.emit("admin:tourney", { on: true, minutes: 10, prize: 100000 }, (r) => { toast(r?.ok ? "Turnier gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "heist") socket.emit("admin:heist", { on: true, seconds: 60, loot: 500000 }, (r) => { toast(r?.ok ? "Heist gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "rain") socket.emit("admin:rain", { on: true, seconds: 30, pot: 250000 }, (r) => { toast(r?.ok ? "Chip-Regen gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "quiz") socket.emit("admin:quiz", { on: true, rounds: 5, prize: 20000 }, (r) => { toast(r?.ok ? "Quiz gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "vault") socket.emit("admin:teamvault", { on: true, seconds: 90, pot: 500000 }, (r) => { toast(r?.ok ? "Tresorkampf gestartet." : (r?.error || "Fehler.")); loadAdminDashboard(); });
      if (kind === "city") socket.emit("admin:cityEvent", {}, (r) => { toast(r?.ok ? `Ausgelöst: ${r.event.txt}` : (r?.error || "Fehler.")); loadAdminDashboard(); });
    }));
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
    toast(`${target}: Chips auf ${amount.toLocaleString("de-DE")} 🪙 gesetzt.`);
    loadAdminAccounts();
  });
});

$("#admin-announcement-send")?.addEventListener("click", () => {
  const errEl = $("#admin-announcement-error");
  const input = $("#admin-announcement-text");
  if (errEl) errEl.textContent = "";
  const text = (input?.value || "").trim();
  if (!text) {
    if (errEl) errEl.textContent = "Text eingeben.";
    return;
  }
  socket.emit("admin:announcement", { text }, (res) => {
    if (!res || !res.ok) {
      if (errEl) errEl.textContent = res?.error || "Fehler.";
      return;
    }
    renderAnnouncement(res.announcement);
    toast("Ankündigung gesendet.");
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
    const input = $("#admin-announcement-text");
    if (input) input.value = "";
    renderAnnouncement(null);
    toast("Ankündigung ausgeblendet.");
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

$("#admin-happy-on-btn")?.addEventListener("click", () => {
  const minutes = parseInt($("#admin-happy-mins").value, 10) || 60;
  socket.emit("admin:happyHour", { on: true, minutes }, (r) => toast(r?.ok ? `🍹 Happy Hour für ${minutes} Min gestartet.` : (r?.error || "Fehler.")));
});
$("#admin-happy-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:happyHour", { on: false }, (r) => toast(r?.ok ? "Happy Hour beendet." : (r?.error || "Fehler.")));
});
$("#admin-tourney-on-btn")?.addEventListener("click", () => {
  const minutes = parseInt($("#admin-tourney-mins").value, 10) || 10;
  const prize = parseInt($("#admin-tourney-prize").value, 10) || 100000;
  socket.emit("admin:tourney", { on: true, minutes, prize }, (r) => toast(r?.ok ? `🏁 Turnier gestartet (${minutes} Min, ${prize.toLocaleString("de-DE")} 🪙).` : (r?.error || "Fehler.")));
});
$("#admin-tourney-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:tourney", { on: false }, (r) => toast(r?.ok ? "Turnier beendet." : (r?.error || "Fehler.")));
});
$("#admin-heist-on-btn")?.addEventListener("click", () => {
  const seconds = parseInt($("#admin-heist-secs").value, 10) || 60;
  const loot = parseInt($("#admin-heist-loot").value, 10) || 500000;
  socket.emit("admin:heist", { on: true, seconds, loot }, (r) => toast(r?.ok ? "🚨 Heist gestartet!" : (r?.error || "Fehler.")));
});
$("#admin-heist-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:heist", { on: false }, (r) => toast(r?.ok ? "Heist abgebrochen." : (r?.error || "Fehler.")));
});
$("#admin-rain-on-btn")?.addEventListener("click", () => {
  const seconds = parseInt($("#admin-rain-secs").value, 10) || 30;
  const pot = parseInt($("#admin-rain-pot").value, 10) || 250000;
  socket.emit("admin:rain", { on: true, seconds, pot }, (r) => toast(r?.ok ? "💸 Chip-Regen gestartet!" : (r?.error || "Fehler.")));
});
$("#admin-rain-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:rain", { on: false }, (r) => toast(r?.ok ? "Chip-Regen gestoppt." : (r?.error || "Fehler.")));
});
$("#admin-quiz-on-btn")?.addEventListener("click", () => {
  const rounds = parseInt($("#admin-quiz-rounds").value, 10) || 5;
  const prize = parseInt($("#admin-quiz-prize").value, 10) || 20000;
  socket.emit("admin:quiz", { on: true, rounds, prize }, (r) => toast(r?.ok ? "❓ Blitz-Quiz gestartet!" : (r?.error || "Fehler.")));
});
$("#admin-quiz-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:quiz", { on: false }, (r) => toast(r?.ok ? "Quiz abgebrochen." : (r?.error || "Fehler.")));
});
$("#admin-vault-on-btn")?.addEventListener("click", () => {
  const seconds = parseInt($("#admin-vault-secs").value, 10) || 90;
  const pot = parseInt($("#admin-vault-pot").value, 10) || 500000;
  socket.emit("admin:teamvault", { on: true, seconds, pot }, (r) => toast(r?.ok ? "⚔️ Tresorkampf gestartet!" : (r?.error || "Fehler.")));
});
$("#admin-vault-off-btn")?.addEventListener("click", () => {
  socket.emit("admin:teamvault", { on: false }, (r) => toast(r?.ok ? "Tresorkampf abgebrochen." : (r?.error || "Fehler.")));
});

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

  try {
    const data = await api("/api/session", { token });
    if (data.config?.bonusCooldownMs) state.bonusCooldownMs = data.config.bonusCooldownMs;
    setAccount(data.account, data.token);
    // Geteilter Link? Dann dorthin, sonst in die Lobby. In beiden Faellen
    // ersetzen statt anhaengen, damit die Zurueck-Geste nicht auf einem
    // leeren Eintrag vor dem Start landet.
    const deep = window.Casino.screens.fromHash();
    const target = deep && deep !== "login" && window.Casino.screens.exists(deep) ? deep : "lobby";
    if (!showScreen(target, { history: "replace" })) showScreen("lobby", { history: "replace" });
  } catch {
    // Expired, revoked or account gone → clean up and ask for the password.
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    showScreen("login", { history: "replace" });
  }
})();
