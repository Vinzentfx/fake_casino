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

// ---- DOM-Helfer ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================
// Screen-Manager
// ============================================================
const screens = {};
$$(".screen").forEach((el) => (screens[el.dataset.screen] = el));

let currentScreen = "login";

function showScreen(name) {
  if (!screens[name]) return;
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
  currentScreen = name;

  // Top bar nur außerhalb des Logins zeigen
  $("#topbar").classList.toggle("hidden", name === "login");

  // Daten je Screen nachladen
  if (name === "leaderboard") loadLeaderboard();
  if (name === "profile") renderProfile();
  if (name === "admin") loadAdminAccounts();
  if (name === "work" && window.Casino._loadWork) window.Casino._loadWork();
  if (name === "businesses" && window.Casino._loadBusinesses) window.Casino._loadBusinesses();

  window.scrollTo(0, 0);
}

// Alle Elemente mit data-nav="screen" navigieren dorthin
document.addEventListener("click", (e) => {
  const navEl = e.target.closest("[data-nav]");
  if (navEl) showScreen(navEl.dataset.nav);
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

// ============================================================
// Account / Anzeige
// ============================================================
function setAccount(acc, token) {
  state.account = acc;
  if (token) state.token = token;
  try {
    localStorage.setItem("casino_name", acc.name);
  } catch {}
  if (state.token) socket.emit("auth", { token: state.token });
  renderTopbar();
  // Admin-Tile nur für Vincent sichtbar
  const adminTile = $("#admin-tile");
  if (adminTile) adminTile.style.display = acc.name.toLowerCase() === "vincent" ? "" : "none";
}

// Re-authenticate after a dropped connection: the server treats a reconnect as
// a fresh socket with no identity, so we must replay the token.
socket.on("connect", () => {
  if (state.token) socket.emit("auth", { token: state.token });
});

// Server can push an updated bank balance (e.g. after a poker buy-in/cash-out).
socket.on("account:update", ({ account }) => {
  if (!account) return;
  state.account = { ...state.account, ...account };
  renderTopbar();
  if (currentScreen === "profile") renderProfile();
});

const RESCUE_THRESHOLD = 50; // mirror of server; controls when the help button shows

function renderTopbar() {
  const acc = state.account;
  if (!acc) return;
  $("#balance-amount").textContent = acc.chips.toLocaleString("de-DE");
  $("#player-name").textContent = acc.name;
  // Pleite-Schutz: offer the help button only when nearly broke.
  const rescueBtn = $("#rescue-btn");
  if (rescueBtn) rescueBtn.style.display = acc.chips < RESCUE_THRESHOLD ? "" : "none";
  refreshBonusButton();
}

function refreshBonusButton() {
  const acc = state.account;
  if (!acc) return;
  const ready = Date.now() - (acc.lastBonusAt || 0) >= state.bonusCooldownMs;
  $("#bonus-btn").disabled = !ready;
  $("#bonus-btn").textContent = ready ? "🎁 Bonus" : "🎁 ✓";
}

function renderProfile() {
  const acc = state.account;
  if (!acc) return;
  $("#profile-name").textContent = acc.name;
  $("#profile-chips").textContent = acc.chips.toLocaleString("de-DE") + " 🪙";
  $("#profile-games").textContent = acc.stats?.gamesPlayed ?? 0;
  $("#profile-biggest").textContent =
    (acc.stats?.biggestWin ?? 0).toLocaleString("de-DE") + " 🪙";
  $("#profile-since").textContent = acc.createdAt
    ? new Date(acc.createdAt).toLocaleDateString("de-DE")
    : "–";
}

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
    if (data.created) toast(`Willkommen, ${data.account.name}! 1000 🪙 geschenkt.`);
    else toast(`Willkommen zurück, ${data.account.name}!`);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---- Täglicher Bonus ----
async function claimBonus() {
  if (!state.account) return;
  try {
    const data = await api("/api/daily-bonus", { name: state.account.name });
    setAccount(data.account);
    const streakNote = data.streak > 1 ? ` 🔥 ${data.streak}-Tage-Serie!` : "";
    toast(`+${data.amount} 🪙 Bonus erhalten!${streakNote}`);
  } catch (err) {
    toast(err.message || "Bonus nicht verfügbar.");
  }
}
$("#bonus-btn").addEventListener("click", claimBonus);
$("#bonus-tile").addEventListener("click", claimBonus);

// ---- Soforthilfe (Pleite-Schutz) ----
async function claimRescue() {
  if (!state.account) return;
  try {
    const data = await api("/api/rescue", { name: state.account.name });
    setAccount(data.account);
    toast(`🆘 +${data.amount.toLocaleString("de-DE")} 🪙 Soforthilfe!`);
  } catch (err) {
    toast(err.message || "Soforthilfe nicht verfügbar.");
  }
}
$("#rescue-btn").addEventListener("click", claimRescue);

// ---- Leaderboard (multi-category, tabbed) ----
const LB_ORDER = ["rich", "bigwin", "bigloss", "games"];
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
    li.innerHTML =
      `<span>${rank} ${escapeHtml(p.name)}${me ? " (du)" : ""}</span>` +
      `<b>${p.value.toLocaleString("de-DE")} 🪙</b>`;
    list.appendChild(li);
  });
}

// ---- Logout ----
$("#logout-btn").addEventListener("click", () => {
  state.account = null;
  state.token = null;
  try {
    localStorage.removeItem("casino_name");
  } catch {}
  $("#login-pin").value = "";
  showScreen("login");
});

// ============================================================
// Hilfsfunktionen
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// PIN-Feld: nur Ziffern
$("#login-pin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
});

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
["cp-old","cp-new","cp-confirm"].forEach((id) => {
  $("#" + id).addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
  });
});

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
  showScreen("login");
});

function loadAdminAccounts() {
  const list = $("#admin-account-list");
  list.innerHTML = '<li class="muted">Lädt…</li>';
  socket.emit("admin:listAccounts", (res) => {
    if (!res || !res.ok) { list.innerHTML = '<li class="muted">Fehler.</li>'; return; }
    if (!res.accounts.length) { list.innerHTML = '<li class="muted">Keine Accounts.</li>'; return; }
    list.innerHTML = "";
    res.accounts.sort((a, b) => b.chips - a.chips).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(p.name)}${p.banned ? " 🚫" : ""}</span>` +
        `<b>${p.chips.toLocaleString("de-DE")} 🪙</b>`;
      list.appendChild(li);
    });
  });
}

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

["admin-ban-btn","admin-unban-btn","admin-delete-btn"].forEach((id) => {
  $("#" + id).addEventListener("click", () => {
    const errEl = $("#admin-ban-error");
    errEl.textContent = "";
    const target = $("#admin-target-ban").value.trim();
    if (!target) { errEl.textContent = "Spielername eingeben."; return; }
    if (id === "admin-delete-btn" && !confirm(`Account "${target}" wirklich löschen?`)) return;
    const event = id === "admin-ban-btn" ? "admin:ban" : id === "admin-unban-btn" ? "admin:unban" : "admin:deleteAccount";
    socket.emit(event, { target }, (res) => {
      if (!res || !res.ok) { errEl.textContent = res?.error || "Fehler."; return; }
      const msg = id === "admin-ban-btn" ? `${target} gesperrt.` : id === "admin-unban-btn" ? `${target} entsperrt.` : `${target} gelöscht.`;
      toast(msg);
      $("#admin-target-ban").value = "";
      loadAdminAccounts();
    });
  });
});

// Shared API for the per-game modules (poker.js, slots.js etc.).
window.Casino = {
  socket,
  showScreen,
  toast,
  getAccount: () => state.account,
  escapeHtml,
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
};

// Start
showScreen("login");
