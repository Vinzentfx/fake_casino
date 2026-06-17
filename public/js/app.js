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
function setAccount(acc) {
  state.account = acc;
  try {
    localStorage.setItem("casino_name", acc.name);
  } catch {}
  // Tell the server who this socket is (for poker buy-in / cash-out).
  socket.emit("auth", { name: acc.name });
  renderTopbar();
}

// Server can push an updated bank balance (e.g. after a poker buy-in/cash-out).
socket.on("account:update", ({ account }) => {
  if (!account) return;
  state.account = { ...state.account, ...account };
  renderTopbar();
  if (currentScreen === "profile") renderProfile();
});

function renderTopbar() {
  const acc = state.account;
  if (!acc) return;
  $("#balance-amount").textContent = acc.chips.toLocaleString("de-DE");
  $("#player-name").textContent = acc.name;
  refreshBonusButton();
}

function refreshBonusButton() {
  const acc = state.account;
  if (!acc) return;
  const cooldown = 20 * 60 * 60 * 1000;
  const ready = Date.now() - (acc.lastBonusAt || 0) >= cooldown;
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
    setAccount(data.account);
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
    toast(`+${data.amount} 🪙 Bonus erhalten!`);
  } catch (err) {
    toast(err.message || "Bonus nicht verfügbar.");
  }
}
$("#bonus-btn").addEventListener("click", claimBonus);
$("#bonus-tile").addEventListener("click", claimBonus);

// ---- Leaderboard ----
async function loadLeaderboard() {
  const list = $("#leaderboard-list");
  list.innerHTML = '<li class="muted">Lädt…</li>';
  try {
    const { leaderboard } = await api("/api/leaderboard");
    if (!leaderboard.length) {
      list.innerHTML = '<li class="muted">Noch keine Spieler.</li>';
      return;
    }
    list.innerHTML = "";
    leaderboard.forEach((p) => {
      const li = document.createElement("li");
      const me = state.account && p.name === state.account.name;
      li.innerHTML = `<span>${escapeHtml(p.name)}${me ? " (du)" : ""}</span>` +
        `<b>${p.chips.toLocaleString("de-DE")} 🪙</b>`;
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = '<li class="muted">Konnte Bestenliste nicht laden.</li>';
  }
}

// ---- Logout ----
$("#logout-btn").addEventListener("click", () => {
  state.account = null;
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

// Shared API for the per-game modules (poker.js, slots.js etc.).
window.Casino = {
  socket,
  showScreen,
  toast,
  getAccount: () => state.account,
  escapeHtml,
  // Set the displayed balance to an exact value (authoritative, e.g. after a slot reveal).
  setChips(n) {
    if (!state.account) return;
    state.account.chips = n;
    renderTopbar();
    if (currentScreen === "profile") renderProfile();
  },
  // Adjust the displayed balance by a delta (optimistic, e.g. bet deducted at spin start).
  adjustChips(delta) {
    if (!state.account) return;
    state.account.chips = Math.max(0, state.account.chips + delta);
    renderTopbar();
  },
  // Merge a full account object (chips, unlocked, …), e.g. after an unlock.
  applyAccount(account) {
    if (!account) return;
    state.account = { ...state.account, ...account };
    renderTopbar();
    if (currentScreen === "profile") renderProfile();
  },
  // Admin/test cheat: grant chips to the logged-in account.
  cheat(amount = 1000000, code = "casino-admin") {
    if (!state.account) return toast("Erst einloggen.");
    socket.emit("admin:grant", { code, amount }, (res) => {
      if (res && res.ok) {
        state.account.chips = res.account.chips;
        renderTopbar();
        if (currentScreen === "profile") renderProfile();
        toast(`Admin: +${amount.toLocaleString("de-DE")} 🪙`);
      } else {
        toast((res && res.error) || "Admin fehlgeschlagen.");
      }
    });
  },
};

// Hidden admin gesture: tap the balance 5× quickly → grant test chips.
(function () {
  let taps = 0;
  let timer = null;
  const bal = $("#balance");
  if (!bal) return;
  bal.addEventListener("click", () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => (taps = 0), 1500);
    if (taps >= 5) {
      taps = 0;
      const input = prompt("💰 Admin — wie viele Chips hinzufügen?", "1000000");
      if (input === null) return;
      const amt = parseInt(input, 10);
      if (Number.isFinite(amt)) window.Casino.cheat(amt);
    }
  });
})();

// Start
showScreen("login");
