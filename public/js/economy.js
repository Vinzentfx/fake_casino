"use strict";

/* ============================================================
   Fake Casino – Economy Frontend
   Arbeiten (Klicker) + Unternehmen (Passives Einkommen)
   ============================================================ */

const MAX_OFFLINE_SEC = 8 * 60 * 60;

// ─── Work / Klicker Screen ────────────────────────────────────────────────────

let workState = { clickPower: 1, loaded: false };

function clickUpgradeCostClient(cp) {
  return Math.ceil(50 * Math.pow(1.5, cp - 1));
}

function renderWork() {
  const cp = workState.clickPower;
  const cost = clickUpgradeCostClient(cp);
  document.getElementById("work-power").textContent = cp.toLocaleString("de-DE") + " 🪙";
  document.getElementById("clicker-power").textContent = cp.toLocaleString("de-DE");
  document.getElementById("work-upgrade-cost").textContent = cost.toLocaleString("de-DE") + " 🪙";
  document.getElementById("work-error").textContent = "";
}

function loadWork() {
  if (!Casino.getAccount()) return;
  Casino.socket.emit("economy:state", (res) => {
    if (!res || !res.ok) return Casino.toast("Fehler beim Laden.");
    workState.clickPower = res.clickPower;
    workState.loaded = true;
    renderWork();
  });
}

// ── Clicker Button ────────────────────────────────────────────────────────────
document.getElementById("clicker-btn").addEventListener("click", () => {
  Casino.socket.emit("work:click", (res) => {
    if (!res) return;
    if (!res.ok) return; // rate-limited — silently ignore
    Casino.applyAccount(res.account);
    spawnClickPopup(res.earned || workState.clickPower);
    // small button press animation
    const btn = document.getElementById("clicker-btn");
    btn.classList.remove("clicker-press");
    void btn.offsetWidth; // force reflow
    btn.classList.add("clicker-press");
  });
});

function spawnClickPopup(amount) {
  const btn = document.getElementById("clicker-btn");
  const rect = btn.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "clicker-popup";
  el.textContent = "+" + amount.toLocaleString("de-DE");
  // random horizontal drift
  const drift = (Math.random() - 0.5) * 60;
  el.style.setProperty("--drift", drift + "px");
  el.style.left = (rect.left + rect.width / 2) + "px";
  el.style.top = (rect.top + rect.height / 2) + "px";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// ── Upgrade Button ────────────────────────────────────────────────────────────
document.getElementById("work-upgrade-btn").addEventListener("click", () => {
  const errEl = document.getElementById("work-error");
  errEl.textContent = "";
  Casino.socket.emit("work:upgrade", (res) => {
    if (!res || !res.ok) {
      errEl.textContent = res?.error || "Fehler.";
      return;
    }
    Casino.applyAccount(res.account);
    workState.clickPower = res.clickPower;
    renderWork();
    Casino.toast("⬆️ Klick-Stärke: " + res.clickPower + " 🪙");
  });
});

// ─── Businesses Screen ────────────────────────────────────────────────────────

let bizState = {
  catalog: [],
  owned: {},
  ratePerSec: 0,
  pendingBase: 0,
  pendingBaseAt: 0,
};
let bizTicker = null;

function pendingNow() {
  const elapsed = (Date.now() - bizState.pendingBaseAt) / 1000;
  const cap = MAX_OFFLINE_SEC * bizState.ratePerSec;
  return Math.min(Math.floor(bizState.pendingBase + bizState.ratePerSec * elapsed), cap);
}

function startBizTicker() {
  if (bizTicker) clearInterval(bizTicker);
  bizTicker = setInterval(() => {
    const el = document.getElementById("biz-pending");
    if (el) el.textContent = pendingNow().toLocaleString("de-DE") + " 🪙";
  }, 1000);
}

function loadBusinesses() {
  if (!Casino.getAccount()) return;
  Casino.socket.emit("economy:state", (res) => {
    if (!res || !res.ok) return Casino.toast("Fehler beim Laden.");
    bizState.catalog     = res.catalog;
    bizState.owned       = res.owned;
    bizState.ratePerSec  = res.ratePerSec;
    bizState.pendingBase = res.pending;
    bizState.pendingBaseAt = Date.now();
    renderBizRate();
    renderBizList();
    renderBizPending();
    startBizTicker();
  });
}

function renderBizRate() {
  const el = document.getElementById("biz-rate");
  if (el) el.textContent = bizState.ratePerSec.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " 🪙";
}

function renderBizPending() {
  const el = document.getElementById("biz-pending");
  if (el) el.textContent = pendingNow().toLocaleString("de-DE") + " 🪙";
}

function renderBizList() {
  const list = document.getElementById("biz-list");
  if (!list || !bizState.catalog.length) return;
  list.innerHTML = "";
  for (const biz of bizState.catalog) {
    const owned = bizState.owned[biz.id] || 0;
    const cost = Math.ceil(biz.baseCost * Math.pow(1.15, owned));
    const totalIncome = (biz.incomePerSec * owned).toLocaleString("de-DE", { maximumFractionDigits: 2 });

    const card = document.createElement("div");
    card.className = "biz-card";
    card.dataset.bizId = biz.id;
    card.innerHTML = `
      <div class="biz-card-icon">${biz.emoji}</div>
      <div class="biz-card-info">
        <div class="biz-card-name">${Casino.escapeHtml(biz.name)}</div>
        <div class="biz-card-sub">
          <span class="biz-owned" id="biz-owned-${biz.id}">${owned}× besessen</span>
          <span class="biz-income" id="biz-income-${biz.id}">${totalIncome} 🪙/Sek.</span>
        </div>
      </div>
      <div class="biz-card-buy">
        <div class="biz-cost" id="biz-cost-${biz.id}">${cost.toLocaleString("de-DE")} 🪙</div>
        <button class="biz-buy-btn" id="biz-buy-${biz.id}">Kaufen</button>
      </div>
    `;
    list.appendChild(card);

    document.getElementById("biz-buy-" + biz.id).addEventListener("click", () => buyBusiness(biz.id));
  }
}

function buyBusiness(id) {
  Casino.socket.emit("economy:buy", { id }, (res) => {
    if (!res || !res.ok) return Casino.toast(res?.error || "Fehler.");
    Casino.applyAccount(res.account);

    // Update local state
    bizState.owned[id] = res.owned;
    bizState.ratePerSec = res.ratePerSec;

    // Update the card in place
    const biz = bizState.catalog.find((b) => b.id === id);
    if (biz) {
      const owned = res.owned;
      document.getElementById("biz-owned-" + id).textContent = owned + "× besessen";
      document.getElementById("biz-income-" + id).textContent =
        (biz.incomePerSec * owned).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " 🪙/Sek.";
      document.getElementById("biz-cost-" + id).textContent =
        res.nextCost.toLocaleString("de-DE") + " 🪙";
    }
    renderBizRate();
    Casino.toast(`${biz?.emoji || "✅"} ${biz?.name || id} gekauft!`);
  });
}

// ── Collect Button ────────────────────────────────────────────────────────────
document.getElementById("biz-collect-btn").addEventListener("click", () => {
  Casino.socket.emit("economy:collect", (res) => {
    if (!res || !res.ok) return Casino.toast(res?.error || "Fehler.");
    Casino.applyAccount(res.account);
    // Reset pending counter
    bizState.pendingBase = 0;
    bizState.pendingBaseAt = Date.now();
    renderBizPending();
    if (res.amount > 0) {
      Casino.toast("💰 +" + res.amount.toLocaleString("de-DE") + " 🪙 eingesammelt!");
    } else {
      Casino.toast("Noch kein Einkommen aufgelaufen.");
    }
  });
});

// ── Register loaders on window.Casino ────────────────────────────────────────
window.Casino._loadWork       = loadWork;
window.Casino._loadBusinesses = loadBusinesses;
