"use strict";

/* ============================================================
   Fake Casino – Markt (product inventory + player trading)
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, showScreen, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let inventory = [];
  let offers = [];

  const onScreen = () => {
    const s = document.querySelector('[data-screen="market"]');
    return s && s.classList.contains("active");
  };

  function load() {
    socket.emit("market:state", (res) => {
      if (!res || !res.ok) return;
      inventory = res.inventory;
      offers = res.offers;
      render();
    });
  }

  function render() {
    renderInventory();
    renderOffers();
  }

  function renderInventory() {
    const el = $("#mkt-inventory");
    if (!el) return;
    if (!inventory.length) { el.innerHTML = '<p class="muted small">Leer — kauf Produkte bei deinen Unternehmen in der Stadt.</p>'; return; }
    el.innerHTML = inventory.map((it) => `
      <div class="mkt-item">
        <div class="mkt-item-head">${it.emoji} <b>${escapeHtml(it.name)}</b> ×${it.count}<br><span class="muted small">${escapeHtml(it.desc)} (${it.mins} Min)</span></div>
        <div class="mkt-item-actions">
          <button class="btn-primary mkt-use" data-key="${it.key}">Benutzen</button>
          <div class="mkt-sell">
            <input type="number" class="mkt-price" data-key="${it.key}" min="1" value="${Math.round(it.suggested * 1.5)}" />
            <button class="mkt-list" data-key="${it.key}">Verkaufen</button>
          </div>
        </div>
      </div>`).join("");
    el.querySelectorAll(".mkt-use").forEach((b) =>
      b.addEventListener("click", () => useItem(b.dataset.key)));
    el.querySelectorAll(".mkt-list").forEach((b) =>
      b.addEventListener("click", () => {
        const price = parseInt(el.querySelector(`.mkt-price[data-key="${b.dataset.key}"]`).value, 10);
        listItem(b.dataset.key, price);
      }));
  }

  function renderOffers() {
    const el = $("#mkt-offers");
    if (!el) return;
    if (!offers.length) { el.innerHTML = '<p class="muted small">Keine Angebote.</p>'; return; }
    const me = window.Casino.getAccount() && window.Casino.getAccount().name;
    el.innerHTML = offers.map((o) => {
      const mine = o.seller === me;
      return `<div class="mkt-offer">
        <div>${o.emoji} <b>${escapeHtml(o.name)}</b> <span class="muted small">von ${escapeHtml(o.seller)}</span></div>
        <div class="mkt-offer-buy"><b>${fmt(o.price)} 🪙</b>
          ${mine ? `<button class="mkt-unlist" data-id="${o.id}">Zurücknehmen</button>`
                 : `<button class="btn-primary mkt-buy" data-id="${o.id}">Kaufen</button>`}</div>
      </div>`;
    }).join("");
    el.querySelectorAll(".mkt-buy").forEach((b) => b.addEventListener("click", () => buyOffer(b.dataset.id)));
    el.querySelectorAll(".mkt-unlist").forEach((b) => b.addEventListener("click", () => unlist(b.dataset.id)));
  }

  function useItem(itemKey) {
    socket.emit("item:use", { itemKey }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      applyAccount(res.account);
      inventory = res.inventory; render();
      toast(`${res.product.emoji} ${res.product.name} aktiv: ${res.product.desc}!`);
    });
  }
  function listItem(itemKey, price) {
    socket.emit("item:list", { itemKey, price }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      inventory = res.inventory; offers = res.offers; render();
      toast("Zum Verkauf eingestellt.");
    });
  }
  function unlist(offerId) {
    socket.emit("item:unlist", { offerId }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      inventory = res.inventory; offers = res.offers; render();
    });
  }
  function buyOffer(offerId) {
    socket.emit("market:buy", { offerId }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      applyAccount(res.account);
      inventory = res.inventory; offers = res.offers; render();
      toast("Gekauft — im Inventar!");
    });
  }

  socket.on("market:update", () => { if (onScreen()) load(); });

  // app.js's showScreen calls this when the market screen opens.
  window.Casino._loadMarket = load;
})();
