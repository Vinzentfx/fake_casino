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
  const dec = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 });

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
      incomeRate = s.ratePerMin; // chips per MINUTE
      pending = s.pending;
      updateIncomePanel();
    });
  }

  function updateIncomePanel() {
    $("#biz-rate").textContent = fmt(incomeRate) + " 🪙/Min";
    $("#biz-pending").textContent = fmt(pending) + " 🪙";
  }

  // Visual ticker: grow the accrued counter each second by 1/60 of the per-minute rate.
  setInterval(() => {
    const screen = document.querySelector('[data-screen="businesses"]');
    if (!screen || !screen.classList.contains("active") || incomeRate <= 0) return;
    pending += incomeRate / 60;
    $("#biz-pending").textContent = fmt(pending) + " 🪙";
  }, 1000);

  function collectLot(plotId) {
    socket.emit("economy:collectLot", { plotId }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Nichts einzusammeln."); return; }
      applyAccount(res.account);
      if (res.city) cityData = res.city;
      renderMap();
      renderDetail();
      loadCity();
      toast(res.amount > 0 ? `💰 +${fmt(res.amount)} 🪙 eingesammelt!` : "Noch nichts aufgelaufen.");
    });
  }

  // ── SVG map ──────────────────────────────────────────────────────────────
  const CELL = 100, INSET = 12, LOT = CELL - INSET * 2;

  function renderMap() {
    const svg = $("#city-map");
    if (!svg || !cityData) return;
    const lp = $("#land-price");
    if (lp) {
      const arrow = cityData.landIndex >= 1 ? "📈" : "📉";
      lp.innerHTML = `🏷️ Bodenpreis: <b>${fmt(cityData.landPrice)} 🪙</b> ${arrow} (Index ${cityData.landIndex})`;
    }
    const W = cityData.cols * CELL, H = cityData.rows * CELL;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#33383d"/>`]; // asphalt
    for (let r = 1; r < cityData.rows; r++)
      parts.push(`<line x1="0" y1="${r * CELL}" x2="${W}" y2="${r * CELL}" stroke="#d9c463" stroke-width="2" stroke-dasharray="10 10" opacity="0.5"/>`);
    for (let c = 1; c < cityData.cols; c++)
      parts.push(`<line x1="${c * CELL}" y1="0" x2="${c * CELL}" y2="${H}" stroke="#d9c463" stroke-width="2" stroke-dasharray="10 10" opacity="0.5"/>`);

    for (const lot of cityData.lots) {
      const lx = lot.x * CELL + INSET, ly = lot.y * CELL + INSET;
      const selected = lot.id === selectedId;
      let fill, stroke = "rgba(255,255,255,0.15)", sw = 1;
      if (lot.biz && lot.biz.type === "casino") fill = "#5a2a6e";
      else if (lot.biz) fill = "#2f5840";   // a business
      else fill = "#3b6b4a";                // empty land
      if (lot.mine) { stroke = "#f4d782"; sw = 3; }
      else if (lot.rival) { stroke = "#d65a5a"; sw = 2.5; }
      if (selected) { stroke = "#7ec8ff"; sw = 4; }

      const label = lot.biz
        ? (lot.biz.operatorName || "frei kaufbar")
        : (lot.landOwnerName ? (lot.forRent ? lot.landOwnerName + " 🔑" : lot.landOwnerName) : "Grundstück");
      parts.push(`<g class="lot" data-lot-id="${lot.id}" style="cursor:pointer">`);
      parts.push(`<rect x="${lx}" y="${ly}" width="${LOT}" height="${LOT}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
      if (lot.emoji)
        parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-size="34">${lot.emoji}</text>`);
      else
        parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-size="26" fill="rgba(255,255,255,0.4)">＋</text>`);
      parts.push(`<text x="${lx + LOT / 2}" y="${ly + LOT - 7}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.85)">${escapeHtml(String(label)).slice(0, 14)}</text>`);
      if (lot.pending >= 1) {
        parts.push(`<circle cx="${lx + LOT - 10}" cy="${ly + 11}" r="9" fill="#f4d782" stroke="#7a5a10" stroke-width="1.5"/>`);
        parts.push(`<text x="${lx + LOT - 10}" y="${ly + 12}" text-anchor="middle" dominant-baseline="central" font-size="11">💰</text>`);
      }
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

  const money = (n) => (n >= 0 ? "" : "−") + fmt(Math.abs(n));

  function renderDetail() {
    const box = $("#city-detail");
    if (!box) return;
    const lot = lotById(selectedId);
    if (!lot) {
      box.innerHTML = '<p class="muted small" style="text-align:center;padding:14px">Tippe ein Feld auf der Karte an.</p>';
      return;
    }
    const b = lot.biz;
    const head = `<div class="cd-head">${lot.emoji || "🟩"} <b>${b ? escapeHtml(b.name) : "Leeres Grundstück"}</b></div>`;
    let body = "";

    // Per-business income to collect (you must tap each one).
    if (lot.pending >= 1)
      body += `<button class="btn-primary cd-collect" data-act="collect">💰 ${fmt(lot.pending)} 🪙 einsammeln</button>`;

    // ── Grundstück (land) ──
    body += `<div class="cd-section"><div class="cd-sub">🟩 Grundstück</div>`;
    body += `<div class="cd-row">Besitzer: <b>${lot.landMine ? "Du" : lot.landOwnerName ? escapeHtml(lot.landOwnerName) : "— frei (Stadt) —"}</b></div>`;
    if (lot.landOwner === null) {
      body += `<button class="btn-primary cd-btn" data-act="buyLand">Grundstück kaufen — ${fmt(cityData.landPrice)} 🪙</button>`;
    } else if (lot.landMine && !b) {
      body += `<button class="btn-primary cd-btn" data-act="sellLand">An Markt verkaufen — ${fmt(cityData.landSellPrice)} 🪙</button>`;
      body += lot.forRent
        ? `<button class="cd-toggle on" data-act="setForRent" data-val="0">🔑 Vermietet — Vermietung beenden</button>`
        : `<button class="cd-toggle" data-act="setForRent" data-val="1">🔑 Zum Bebauen vermieten</button>`;
    }
    body += `</div>`;

    // ── Unternehmen (business) ──
    body += `<div class="cd-section"><div class="cd-sub">🏢 Unternehmen</div>`;
    if (b) {
      const p = b.pnl;
      const leased = b.builtBy && b.operator && b.builtBy !== b.operator;
      body += `<div class="cd-row">Betreiber: <b>${b.operatorMine ? "Du" : b.operatorName ? escapeHtml(b.operatorName) : "— frei kaufbar —"}</b></div>`;
      if (leased) body += `<div class="cd-row">Gebäude: <b>${b.builtMine ? "Du (verpachtet)" : escapeHtml(b.builtByName)}</b></div>`;
      body += `<div class="cd-pnl">`;
      body += `<div><span>Einkommen</span><b class="pos">${fmt(p.income)} 🪙/Min</b></div>`;
      if (p.rent > 0) body += `<div><span>Miete</span><b class="neg">−${fmt(p.rent)}/Min</b></div>`;
      body += `<div class="cd-net"><span>= Gewinn</span><b class="${p.net >= 0 ? "pos" : "neg"}">${fmt(p.net)} 🪙/Min</b></div>`;
      body += `</div>`;
      // Product / buff this business sells.
      if (b.product) {
        const pr = b.product;
        body += `<div class="cd-product"><div class="cd-prod-head">${pr.emoji} <b>${escapeHtml(pr.name)}</b> — ${escapeHtml(pr.desc)} (${pr.mins} Min)</div>`;
        body += `<button class="btn-primary cd-btn" data-act="buyProduct">${pr.emoji} Kaufen — ${fmt(pr.payPrice)} 🪙${pr.owned ? " (dein Rabatt)" : ""}</button></div>`;
      }
      const t = cityData.buildingTypes[b.type];
      if (b.operator === null && b.builtBy === null) {
        body += `<button class="btn-primary cd-btn" data-act="buyBiz">Unternehmen kaufen — ${fmt(t.cost)} 🪙</button>`;
      } else if (b.operatorMine && b.builtMine) {
        body += b.forLease
          ? `<button class="cd-toggle on" data-act="setForLease" data-val="0">Verpachtung zurückziehen</button>`
          : `<button class="cd-toggle" data-act="setForLease" data-val="1">📜 Betrieb verpachten (Miete kassieren)</button>`;
      } else if (b.forLease && !b.operatorMine) {
        body += `<button class="btn-primary cd-btn" data-act="lease">Betrieb pachten (zahlt ${fmt(t.rent)} 🪙/s Miete)</button>`;
      } else if (!b.operatorMine && b.builtBy === b.operator) {
        body += `<button class="btn-primary cd-btn" data-act="takeover">Übernehmen (+50%) — ${fmt(Math.ceil(t.cost * cityData.buyoutPremium))} 🪙</button>`;
      }
      // IPO: list a company you own (not casino/bank) on the stock market.
      if (b.builtMine && t.buildable) {
        body += b.listed
          ? `<div class="cd-row" style="color:#7ec8ff">📈 Börsennotiert</div>`
          : `<button class="cd-toggle" data-act="ipo">📈 An die Börse bringen (IPO — Kapital sammeln)</button>`;
      }
    } else if (lot.canBuildHere) {
      const rented = !lot.landMine;
      body += `<div class="cd-row">${rented ? "Auf gemietetem Land bauen (Miete fällt an):" : "Bebaue dein Grundstück:"}</div><div class="cd-builds">`;
      for (const [id, t] of Object.entries(cityData.buildingTypes)) {
        if (!t.buildable) continue;
        body += `<button class="cd-build" data-build="${id}">${t.emoji} ${escapeHtml(t.name)}<small>${fmt(t.cost)} 🪙</small></button>`;
      }
      body += `</div>`;
    } else {
      body += `<div class="cd-row muted">Erst das Grundstück kaufen (oder gemietetes Land), dann bauen.</div>`;
    }
    body += `</div>`;

    box.innerHTML = head + body;
  }

  $("#city-detail").addEventListener("click", (e) => {
    const lot = lotById(selectedId);
    if (!lot) return;
    const actBtn = e.target.closest("[data-act]");
    const buildBtn = e.target.closest("[data-build]");
    if (actBtn) {
      if (actBtn.dataset.act === "collect") { collectLot(lot.id); return; }
      if (actBtn.dataset.act === "buyProduct") { buyProduct(lot.id); return; }
      const EVT = {
        buyLand: "city:buyLand", sellLand: "city:sellLand", setForRent: "city:setForRent",
        buyBiz: "city:buyBiz", takeover: "city:takeover", setForLease: "city:setForLease",
        lease: "city:lease", ipo: "city:ipo",
      };
      const event = EVT[actBtn.dataset.act];
      if (event) socket.emit(event, { plotId: lot.id, val: actBtn.dataset.val === "1" ? 1 : 0 }, onCityActionResult);
    } else if (buildBtn) {
      socket.emit("city:build", { plotId: lot.id, type: buildBtn.dataset.build }, onCityActionResult);
    }
  });

  function buyProduct(plotId) {
    socket.emit("city:buyProduct", { plotId }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Kauf fehlgeschlagen."); return; }
      applyAccount(res.account);
      renderDetail();
      const pr = res.product;
      toast(`${pr.emoji} ${pr.name} aktiv: ${pr.desc} (${pr.mins} Min)!`);
    });
  }

  function onCityActionResult(res) {
    if (!res || !res.ok) { toast((res && res.error) || "Aktion fehlgeschlagen."); return; }
    applyAccount(res.account);
    if (res.city) cityData = res.city;
    renderMap();
    renderDetail();
    loadCity(); // refresh income rate/pending after the ownership change
    if (res.raised) toast(`🚀 Börsengang! +${fmt(res.raised)} 🪙 Kapital (${res.sym}).`);
    else if (res.gain) toast(`✓ +${fmt(res.gain)} 🪙`);
    else if (res.cost) toast(`✓ −${fmt(res.cost)} 🪙`);
    else toast("✓ Erledigt");
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
