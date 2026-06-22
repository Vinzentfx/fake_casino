"use strict";

/* ============================================================
   Fake Casino – Economy client
   • Work: a capped clicker (starter aid only).
   • Stadt: shared SVG city map — buy land & build, buy out
     businesses, take over the casino. Server is authoritative.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, showScreen, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  // ── Work (capped clicker) ────────────────────────────────────────────────
  function applyWorkState(s) {
    if (!s || !s.ok) return;
    $("#clicker-power").textContent = s.clickPower;
    $("#work-power").textContent = s.clickPower + " 🪙";
    const btn = $("#work-upgrade-btn");
    const costEl = $("#work-upgrade-cost");
    if (s.maxed) {
      costEl.textContent = "max. ausgebaut";
      btn.disabled = true;
      btn.textContent = "✓ Voll ausgebaut";
    } else {
      costEl.textContent = fmt(s.upgradeCost) + " 🪙";
      btn.disabled = false;
      btn.textContent = "⬆️ Upgrade kaufen";
    }
  }

  function loadWork() {
    socket.emit("economy:state", applyWorkState);
  }

  $("#clicker-btn").addEventListener("click", () => {
    socket.emit("work:click", (res) => {
      if (!res || !res.ok) return;
      applyAccount(res.account);
      flyFromClicker("+" + res.earned);
    });
  });

  $("#work-upgrade-btn").addEventListener("click", () => {
    const err = $("#work-error");
    err.textContent = "";
    socket.emit("work:upgrade", (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account);
      loadWork(); // refresh exact next cost / maxed state
      toast(`Klick-Stärke: +${res.clickPower} 🪙`);
    });
  });

  function flyFromClicker(text) {
    const btn = $("#clicker-btn");
    if (!btn) return;
    const b = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "click-float";
    el.textContent = text + " 🪙";
    el.style.left = b.left + b.width / 2 + (Math.random() - 0.5) * 40 + "px";
    el.style.top = b.top + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  // ── Shared city ────────────────────────────────────────────────────────
  let cityData = null;
  let selectedId = null;
  let incomeRate = 0;
  let pending = 0;

  function loadCity() {
    socket.emit("city:state", (res) => {
      if (!res || !res.ok) return;
      cityData = res.city;
      renderMap();
      renderDetail();
    });
    socket.emit("economy:state", (s) => {
      if (!s || !s.ok) return;
      incomeRate = s.ratePerSec;
      pending = s.pending;
      updateIncomePanel();
    });
  }

  function updateIncomePanel() {
    $("#biz-rate").textContent = fmt(incomeRate) + " 🪙";
    $("#biz-pending").textContent = fmt(pending) + " 🪙";
  }

  // Visual ticker: grow the pending counter each second by the income rate.
  setInterval(() => {
    const screen = document.querySelector('[data-screen="businesses"]');
    if (!screen || !screen.classList.contains("active") || incomeRate <= 0) return;
    pending += incomeRate;
    $("#biz-pending").textContent = fmt(pending) + " 🪙";
  }, 1000);

  $("#biz-collect-btn").addEventListener("click", () => {
    socket.emit("economy:collect", (res) => {
      if (!res || !res.ok) return;
      applyAccount(res.account);
      pending = 0;
      updateIncomePanel();
      if (res.amount > 0) toast(`💰 +${fmt(res.amount)} 🪙 eingesammelt!`);
      else toast("Noch nichts aufgelaufen.");
    });
  });

  // ── SVG map ──────────────────────────────────────────────────────────────
  const CELL = 100, INSET = 12, LOT = CELL - INSET * 2;

  function renderMap() {
    const svg = $("#city-map");
    if (!svg || !cityData) return;
    const W = cityData.cols * CELL, H = cityData.rows * CELL;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#33383d"/>`]; // asphalt
    for (let r = 1; r < cityData.rows; r++)
      parts.push(`<line x1="0" y1="${r * CELL}" x2="${W}" y2="${r * CELL}" stroke="#d9c463" stroke-width="2" stroke-dasharray="10 10" opacity="0.5"/>`);
    for (let c = 1; c < cityData.cols; c++)
      parts.push(`<line x1="${c * CELL}" y1="0" x2="${c * CELL}" y2="${H}" stroke="#d9c463" stroke-width="2" stroke-dasharray="10 10" opacity="0.5"/>`);

    const meStroke = "#f4d782";
    for (const lot of cityData.lots) {
      const lx = lot.x * CELL + INSET, ly = lot.y * CELL + INSET;
      const selected = lot.id === selectedId;
      let fill, stroke = "rgba(255,255,255,0.15)", sw = 1;
      if (lot.type === "casino") fill = "#5a2a6e";
      else if (lot.type) fill = "#2f5840";   // business
      else fill = "#3b6b4a";                 // empty land
      if (lot.mine) { stroke = meStroke; sw = 3; }
      else if (lot.owner) { stroke = "#d65a5a"; sw = 2.5; }
      if (selected) { stroke = "#7ec8ff"; sw = 4; }

      parts.push(`<g class="lot" data-lot-id="${lot.id}" style="cursor:pointer">`);
      parts.push(`<rect x="${lx}" y="${ly}" width="${LOT}" height="${LOT}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
      if (lot.emoji)
        parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-size="34">${lot.emoji}</text>`);
      else
        parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-size="26" fill="rgba(255,255,255,0.4)">＋</text>`);
      const label = lot.ownerName ? lot.ownerName : (lot.type ? "frei kaufbar" : "Grundstück");
      parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT - 7}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.85)">${escapeHtml(String(label)).slice(0, 14)}</text>`);
      parts.push(`</g>`);
    }
    svg.innerHTML = parts.join("");
  }

  $("#city-map").addEventListener("click", (e) => {
    const g = e.target.closest(".lot");
    if (!g) return;
    selectedId = parseInt(g.dataset.lotId, 10);
    renderMap();
    renderDetail();
  });

  function lotById(id) {
    return cityData && cityData.lots.find((l) => l.id === id);
  }

  function renderDetail() {
    const box = $("#city-detail");
    if (!box) return;
    const lot = lotById(selectedId);
    if (!lot) {
      box.innerHTML = '<p class="muted small" style="text-align:center;padding:14px">Tippe ein Feld auf der Karte an.</p>';
      return;
    }
    const head = `<div class="cd-head">${lot.emoji || "🟩"} <b>${lot.typeName || "Leeres Grundstück"}</b></div>`;
    let body = "";

    if (lot.type) {
      body += `<div class="cd-row">Einkommen: <b>${fmt(lot.income)} 🪙/Sek</b></div>`;
      body += `<div class="cd-row">Besitzer: <b>${lot.ownerName ? escapeHtml(lot.ownerName) : "— frei —"}</b></div>`;
    }

    if (lot.action === "buyLand") {
      body += `<button class="btn-primary cd-btn" data-act="buyLand">Land kaufen — ${fmt(lot.price)} 🪙</button>`;
    } else if (lot.action === "build") {
      body += `<div class="cd-row">Dein Grundstück — bebauen:</div><div class="cd-builds">`;
      for (const [id, t] of Object.entries(cityData.buildingTypes)) {
        if (!t.buildable) continue;
        body += `<button class="cd-build" data-build="${id}">${t.emoji} ${escapeHtml(t.name)}<small>${fmt(t.cost)} 🪙 · +${fmt(t.income)}/s</small></button>`;
      }
      body += `</div>`;
    } else if (lot.action === "buyout") {
      const label = lot.owner ? `Übernehmen (+50%) — ${fmt(lot.price)} 🪙` : `Aufkaufen — ${fmt(lot.price)} 🪙`;
      body += `<button class="btn-primary cd-btn" data-act="buyout">${label}</button>`;
    } else if (lot.mine) {
      body += `<div class="cd-row" style="color:var(--gold-strong)">✓ Gehört dir</div>`;
    }
    box.innerHTML = head + body;
  }

  $("#city-detail").addEventListener("click", (e) => {
    const lot = lotById(selectedId);
    if (!lot) return;
    const actBtn = e.target.closest("[data-act]");
    const buildBtn = e.target.closest("[data-build]");
    if (actBtn) {
      const event = actBtn.dataset.act === "buyLand" ? "city:buyLand" : "city:buyout";
      socket.emit(event, { plotId: lot.id }, onCityActionResult);
    } else if (buildBtn) {
      socket.emit("city:build", { plotId: lot.id, type: buildBtn.dataset.build }, onCityActionResult);
    }
  });

  function onCityActionResult(res) {
    if (!res || !res.ok) { toast((res && res.error) || "Aktion fehlgeschlagen."); return; }
    applyAccount(res.account);
    if (res.city) cityData = res.city;
    renderMap();
    renderDetail();
    loadCity(); // refresh income rate/pending after the ownership change
    toast(`✓ −${fmt(res.cost)} 🪙`);
  }

  // Live refresh when anyone changes the shared city.
  socket.on("city:update", () => {
    const screen = document.querySelector('[data-screen="businesses"]');
    if (screen && screen.classList.contains("active")) loadCity();
  });

  // ── Screen-entry hooks ───────────────────────────────────────────────────
  const origShow = showScreen;
  window.Casino.showScreen = function (name) {
    origShow(name);
    if (name === "work") loadWork();
    if (name === "businesses") { selectedId = null; loadCity(); }
  };
})();
