"use strict";

/* ============================================================
   Fake Casino – Börse (stock market) client
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, showScreen, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 });

  let data = null;
  let selected = null;
  let lev = 1;

  const onScreen = () => {
    const s = document.querySelector('[data-screen="stocks"]');
    return s && s.classList.contains("active");
  };

  function load() {
    socket.emit("stocks:state", (res) => {
      if (!res || !res.ok) return;
      data = res;
      if (!selected && data.stocks.length) selected = data.stocks[0].sym;
      render();
    });
  }

  // Mini SVG sparkline from a price history.
  function sparkline(history) {
    if (!history || history.length < 2) return "";
    const w = 64, h = 22;
    const min = Math.min(...history), max = Math.max(...history);
    const range = max - min || 1;
    const pts = history.map((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const up = history[history.length - 1] >= history[0];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? "#4ade80" : "#f0707a"}" stroke-width="1.5"/></svg>`;
  }

  function render() {
    if (!data) return;
    renderNews();
    renderList();
    renderTrade();
    renderPortfolio();
  }

  function renderNews() {
    const el = $("#stk-news");
    if (!el) return;
    el.innerHTML = (data.news || []).slice(0, 3)
      .map((n) => `<div class="stk-news-item">${escapeHtml(n.text)}</div>`).join("");
  }

  function renderList() {
    const el = $("#stk-list");
    if (!el) return;
    el.innerHTML = data.stocks.map((s) => {
      const cls = s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "";
      const arrow = s.changePct > 0 ? "▲" : s.changePct < 0 ? "▼" : "•";
      return `<button class="stk-row ${selected === s.sym ? "sel" : ""}" data-sym="${s.sym}">
          <div class="stk-id"><b>${s.sym}</b><span>${escapeHtml(s.name)}</span></div>
          ${sparkline(s.history)}
          <div class="stk-px"><b>${fmt(s.price)} 🪙</b><span class="${cls}">${arrow} ${fmt(Math.abs(s.changePct))}%</span></div>
        </button>`;
    }).join("");
    el.querySelectorAll(".stk-row").forEach((b) =>
      b.addEventListener("click", () => { selected = b.dataset.sym; render(); }));
  }

  function renderTrade() {
    const el = $("#stk-trade");
    if (!el) return;
    const s = data.stocks.find((x) => x.sym === selected);
    if (!s) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    const levBtns = [];
    for (let i = 1; i <= data.maxLeverage; i++)
      levBtns.push(`<button class="stk-lev ${lev === i ? "on" : ""}" data-lev="${i}">${i}×</button>`);
    const cls = s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "";
    const arrow = s.changePct > 0 ? "▲" : s.changePct < 0 ? "▼" : "•";
    // Your open positions in THIS stock (sell them right here).
    const mine = (data.positions || []).filter((p) => p.sym === s.sym);
    const posHtml = mine.map((p) => `
      <div class="stk-detpos">
        <span>${p.dir > 0 ? "📈 Long" : "📉 Short"} ${p.lev}× <span class="muted small">@${fmt(p.entry)}</span></span>
        <b class="${p.pnl >= 0 ? "up" : "down"}">${p.pnl >= 0 ? "+" : ""}${fmt(p.pnl)} 🪙</b>
        <button class="stk-close" data-id="${p.id}">Verkaufen<small>${fmt(p.equity)} 🪙</small></button>
      </div>`).join("");

    el.innerHTML = `
      <button class="stk-detclose" id="stk-detclose">✕ Schließen</button>
      <div class="stk-trade-head">${escapeHtml(s.name)} <b>(${s.sym})</b></div>
      <div class="stk-detprice"><b>${fmt(s.price)} 🪙</b> <span class="${cls}">${arrow} ${fmt(Math.abs(s.changePct))}%</span></div>
      ${bigChart(s.history)}
      ${mine.length ? `<div class="stk-detpos-wrap"><div class="muted small">Deine Positionen:</div>${posHtml}</div>` : ""}
      <label class="bank-input-row"><span>Einsatz (Margin)</span><input id="stk-margin" type="number" min="1000" value="5000"/></label>
      <div class="stk-lev-row"><span class="muted small">Hebel</span>${levBtns.join("")}</div>
      <div class="stk-actions">
        <button class="stk-long" id="stk-long">📈 Long (steigt)</button>
        <button class="stk-short" id="stk-short">📉 Short (fällt)</button>
      </div>`;
    el.querySelectorAll(".stk-lev").forEach((b) =>
      b.addEventListener("click", () => { lev = +b.dataset.lev; renderTrade(); }));
    el.querySelectorAll(".stk-close").forEach((b) =>
      b.addEventListener("click", () => closePos(b.dataset.id)));
    $("#stk-detclose").addEventListener("click", () => { selected = null; render(); });
    $("#stk-long").addEventListener("click", () => openPos(1));
    $("#stk-short").addEventListener("click", () => openPos(-1));
  }

  // Large detail chart with a baseline and min/max labels.
  function bigChart(history) {
    if (!history || history.length < 2) return '<div class="stk-bigchart-empty muted small">Noch kein Verlauf.</div>';
    const w = 320, h = 120, pad = 4;
    const min = Math.min(...history), max = Math.max(...history);
    const range = max - min || 1;
    const X = (i) => pad + (i / (history.length - 1)) * (w - 2 * pad);
    const Y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
    const pts = history.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const up = history[history.length - 1] >= history[0];
    const col = up ? "#4ade80" : "#f0707a";
    const area = `${X(0)},${h - pad} ${pts} ${X(history.length - 1)},${h - pad}`;
    return `<svg class="stk-bigchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polygon points="${area}" fill="${col}" opacity="0.12"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2"/>
      <text x="${pad}" y="11" class="stk-axis">${fmt(max)}</text>
      <text x="${pad}" y="${h - 4}" class="stk-axis">${fmt(min)}</text>
    </svg>`;
  }

  function openPos(dir) {
    const margin = parseInt($("#stk-margin").value, 10);
    socket.emit("stocks:open", { sym: selected, dir, margin, lev }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      applyAccount(res.account);
      data = res;
      render();
      toast(`${dir > 0 ? "📈 Long" : "📉 Short"} ${selected} eröffnet (${fmt(margin)} 🪙 · ${lev}×).`);
    });
  }

  function renderPortfolio() {
    const el = $("#stk-portfolio");
    if (!el) return;
    const ps = data.positions || [];
    if (!ps.length) { el.innerHTML = '<p class="muted small">Keine offenen Positionen.</p>'; return; }
    el.innerHTML = ps.map((p) => {
      const cls = p.pnl >= 0 ? "up" : "down";
      return `<div class="stk-pos">
          <div class="stk-pos-id">${p.dir > 0 ? "📈" : "📉"} <b>${p.sym}</b> ${p.lev}× <span class="muted small">@${fmt(p.entry)}</span></div>
          <div class="stk-pos-pnl ${cls}">${p.pnl >= 0 ? "+" : ""}${fmt(p.pnl)} 🪙</div>
          <button class="stk-close" data-id="${p.id}">Schließen<small>${fmt(p.equity)} 🪙</small></button>
        </div>`;
    }).join("");
    el.querySelectorAll(".stk-close").forEach((b) =>
      b.addEventListener("click", () => closePos(b.dataset.id)));
  }

  function closePos(id) {
    socket.emit("stocks:close", { id }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      applyAccount(res.account);
      data = res;
      render();
      toast(`Position geschlossen: +${fmt(res.payout)} 🪙.`);
    });
  }

  // Live market updates + liquidation notices.
  socket.on("stocks:update", () => { if (onScreen()) load(); });
  socket.on("stocks:liquidated", ({ lost, won, account }) => {
    if (account) applyAccount(account);
    if (won > 0) toast(`💥 Insolvenz! Dein Short zahlte +${fmt(won)} 🪙.`);
    if (lost > 0) toast(`💥 Liquidiert! −${fmt(lost)} 🪙 verloren.`);
    if (onScreen()) load();
  });

  // app.js's showScreen calls this when the stocks screen opens.
  window.Casino._loadStocks = load;
})();
