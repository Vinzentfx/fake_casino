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
const lockedScreens = new Set(["sudoku", "solitaire", "chess"]);

function showScreen(name) {
  if (lockedScreens.has(name)) {
    toast("Dieses Spiel ist gerade gesperrt und kommt bald zurück.");
    return;
  }
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
  if (name === "bank" && window.Casino._loadBank) window.Casino._loadBank();
  if (name === "market" && window.Casino._loadMarket) window.Casino._loadMarket();
  if (name === "stocks" && window.Casino._loadStocks) window.Casino._loadStocks();
  if (name === "blackjack" && window.Casino._loadBlackjack) window.Casino._loadBlackjack();
  if (name === "lobby" && window.Casino._loadLobbies) window.Casino._loadLobbies();
  if (name === "lobby" && window.Casino._loadFeed) window.Casino._loadFeed();
  if (name === "stats" && window.Casino._loadStats) window.Casino._loadStats();
  if (name === "quests" && window.Casino._loadQuests) window.Casino._loadQuests();
  if (name === "season" && window.Casino._loadSeason) window.Casino._loadSeason();
  if (name === "calendar") loadCalendar();
  if (name === "wheel" && window.Casino._loadWheel) window.Casino._loadWheel();
  if (name === "clans" && window.Casino._loadClans) window.Casino._loadClans();
  if (name === "cosmetics" && window.Casino._loadCosmetics) window.Casino._loadCosmetics();
  if (name === "crash" && window.Casino._loadCrash) window.Casino._loadCrash();
  if (name === "mines" && window.Casino._loadMines) window.Casino._loadMines();
  if (name === "pinco" && window.Casino._loadPinco) window.Casino._loadPinco();
  if (name === "memory" && window.Casino._loadMemory) window.Casino._loadMemory();
  if (name === "suggest" && window.Casino._loadSuggest) window.Casino._loadSuggest();
  if (name === "sudoku" && window.Casino._loadSudoku) window.Casino._loadSudoku();
  if (name === "solitaire" && window.Casino._loadSolitaire) window.Casino._loadSolitaire();
  if (name === "chess" && window.Casino._loadChess) window.Casino._loadChess();
  if (name === "sports" && window.Casino._loadSports) window.Casino._loadSports();
  if (window.Casino.chat) window.Casino.chat.update(name);

  window.scrollTo(0, 0);
}

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
  requestPresence();
  // Admin-Tile nur für Vincent sichtbar
  const adminTile = $("#admin-tile");
  if (adminTile) adminTile.style.display = acc.name.toLowerCase() === "vincent" ? "" : "none";
  maybeShowUpdate();
}

// ---- Update-/Changelog-Modal (einmal pro Version) ----
const UPDATE_VERSION = "2026-07-06-level-clans-wheel";
function maybeShowUpdate() {
  let seen = null;
  try { seen = localStorage.getItem("casino_seen_update"); } catch {}
  if (seen === UPDATE_VERSION) return;
  const m = $("#update-modal");
  if (m) m.classList.remove("hidden");
}
$("#update-close")?.addEventListener("click", () => {
  $("#update-modal")?.classList.add("hidden");
  try { localStorage.setItem("casino_seen_update", UPDATE_VERSION); } catch {}
});

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
    const color = p.nameColor ? ` style="color:${p.nameColor}"` : "";
    return `<span class="online-player"><span>${escapeHtml(p.avatar || "🙂")}</span><b${color}>${escapeHtml(p.name || "?")}</b>${level}</span>`;
  }).join("");
}

function requestPresence() {
  socket.emit("presence:list", (res) => {
    if (res && res.ok) renderOnlinePlayers(res.online || []);
  });
}

socket.on("presence:update", ({ online } = {}) => renderOnlinePlayers(online || []));

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

function renderTopbar() {
  const acc = state.account;
  if (!acc) return;
  $("#balance-amount").textContent = acc.chips.toLocaleString("de-DE");
  $("#player-name").textContent = acc.name;
  if (acc.avatar) $("#avatar").textContent = acc.avatar;
  $("#player-name").style.color = acc.nameColor || "";
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

function renderProfile() {
  const acc = state.account;
  if (!acc) return;
  $("#profile-name").textContent = acc.name;
  if (acc.avatar) $("#profile-big").textContent = acc.avatar;
  $("#profile-name").style.color = acc.nameColor || "";
  const renderLevel = (l) => {
    const lb = $("#profile-level");
    if (!lb || !l) return;
    const pct = l.xpForNext ? Math.min(100, Math.round((100 * l.xpInLevel) / l.xpForNext)) : 100;
    lb.innerHTML =
      `<div class="level-head"><b style="color:${l.color}">${l.emoji} Level ${l.level}</b><span class="muted small">${escapeHtml(l.title)} · ${l.xpInLevel}/${l.xpForNext} XP</span></div>` +
      `<div class="level-bar"><div class="level-fill" style="width:${pct}%;background:${l.color}"></div></div>`;
  };
  renderLevel(acc.level);
  // Refresh level/XP from the server (slots don't push a full account).
  fetch("/api/account/" + encodeURIComponent(acc.name)).then((r) => r.json())
    .then((d) => { if (d.account && d.account.level) { state.account.level = d.account.level; renderLevel(d.account.level); } }).catch(() => {});
  $("#profile-chips").textContent = acc.chips.toLocaleString("de-DE") + " 🪙";
  $("#profile-games").textContent = acc.stats?.gamesPlayed ?? 0;
  $("#profile-biggest").textContent =
    (acc.stats?.biggestWin ?? 0).toLocaleString("de-DE") + " 🪙";
  $("#profile-since").textContent = acc.createdAt
    ? new Date(acc.createdAt).toLocaleDateString("de-DE")
    : "–";
  // Achievements/badges (server-authoritative list). Tap an unlocked badge to
  // wear its emoji behind your name in the leaderboard (tap again to remove).
  socket.emit("ach:list", (res) => {
    const box = $("#profile-badges");
    if (!box) return;
    if (!res || !res.ok) { box.innerHTML = '<p class="muted small">–</p>'; return; }
    const unlocked = res.list.filter((a) => a.unlocked).length;
    box.innerHTML = `<p class="muted small" style="margin:0 0 8px">${unlocked}/${res.list.length} freigeschaltet · Tippe ein Achievement an, um sein Emoji im Leaderboard zu tragen.</p>`
      + res.list.map((a) => {
        const sel = res.badge === a.id;
        return `<div class="badge ${a.unlocked ? "on" : ""}${sel ? " selected" : ""}" data-ach="${a.id}" data-unlocked="${a.unlocked ? 1 : 0}" title="${escapeHtml(a.desc)} · +${a.reward.toLocaleString("de-DE")} 🪙">` +
          `<span class="badge-emoji">${a.unlocked ? a.emoji : "🔒"}</span><span class="badge-label">${escapeHtml(a.label)}</span>` +
          `<small>${sel ? "★ im Leaderboard" : a.unlocked ? "✓" : escapeHtml(a.desc)}</small></div>`;
      }).join("");
  });
}

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
    if (data.created) toast(`Willkommen, ${data.account.name}! 1000 🪙 geschenkt.`);
    else toast(`Willkommen zurück, ${data.account.name}!`);
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
socket.on("level:up", (d) => {
  if (!d) return;
  if (state.account) state.account.level = { ...(state.account.level || {}), level: d.level, title: d.title, emoji: d.emoji };
  renderTopbar();
  toast(`${d.emoji} LEVEL UP! Du bist jetzt Level ${d.level} — ${d.title}!`);
});
setInterval(renderLiveops, 20000);

// ---- Stunden-Bonus: Live-Countdown auf Button + Lobby-Kachel ----
function updateBonusUI() {
  const acc = state.account;
  const btn = $("#bonus-btn");
  const tileSpan = $("#bonus-tile span");
  if (!acc || !btn) return;
  const left = state.bonusCooldownMs - (Date.now() - (acc.lastBonusAt || 0));
  const ready = left <= 0;
  btn.disabled = !ready;
  if (ready) {
    btn.textContent = "🎁 Bonus";
    if (tileSpan) tileSpan.textContent = "Stunden-Bonus abholen!";
    $("#bonus-tile")?.classList.add("bonus-ready");
  } else {
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const t = (left >= 3600000 ? Math.floor(left / 3600000) + ":" : "") +
      String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    btn.textContent = `⏳ ${t}`;
    if (tileSpan) tileSpan.textContent = `Bonus in ${t}`;
    $("#bonus-tile")?.classList.remove("bonus-ready");
  }
}
setInterval(updateBonusUI, 1000);

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
$("#bonus-tile").addEventListener("click", claimBonus);

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
const LB_ORDER = ["rich", "estate", "streets", "bigwin", "bigloss", "games"];
// How a category's value is displayed (default: chips).
const LB_UNIT = { streets: (v) => `${v} 👑`, games: (v) => `${v.toLocaleString("de-DE")} Spiele` };
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
    const ava = p.avatar ? `${p.avatar} ` : "";
    const nameCol = p.nameColor ? ` style="color:${p.nameColor}"` : "";
    li.innerHTML =
      `<span>${rank}${clan} ${ava}<b${nameCol}>${escapeHtml(p.name)}</b>${lvl}${champ}${badge}${me ? " (du)" : ""}</span>` +
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
  loadAdminDashboard();
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
      li.querySelector("[data-admin-clear-bank]")?.addEventListener("click", () => {
        if (!confirm(`${p.name}: Bank wirklich leeren?`)) return;
        socket.emit("admin:clearBank", { target: p.name }, (r) => {
          if (r && r.ok) {
            toast(`${p.name}: Bank geleert (${(r.cleared || 0).toLocaleString("de-DE")} 🪙).`);
            loadAdminAccounts();
          } else toast((r && r.error) || "Fehler.");
        });
      });
      li.querySelector("[data-admin-delete]")?.addEventListener("click", () => {
        if (!confirm(`Account "${p.name}" wirklich löschen?`)) return;
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

$("#admin-reset-city-btn")?.addEventListener("click", () => {
  if (!confirm("Wirklich die GANZE Stadt zurücksetzen? Alle Grundstücke & Unternehmen gehen an NPC zurück.")) return;
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

$("#admin-new-week-btn")?.addEventListener("click", () => {
  if (!confirm("Woche JETZT beenden? Kürt den Spieler der Woche und würfelt eine neue Goldene Straße.")) return;
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
  // Master volume (0–1) — every game's WebAudio gain multiplies by this.
  vol: Math.min(1, Math.max(0, (parseInt(localStorage.getItem("casino_vol"), 10) || 80) / 100)),
};

// Master volume slider (settings).
(function () {
  const slider = document.getElementById("set-volume");
  if (!slider) return;
  slider.value = Math.round(window.Casino.vol * 100);
  slider.addEventListener("input", () => {
    window.Casino.vol = Math.min(1, Math.max(0, slider.value / 100));
    localStorage.setItem("casino_vol", String(slider.value));
  });
})();

// Start
showScreen("login");
