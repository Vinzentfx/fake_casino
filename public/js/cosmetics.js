"use strict";

/* ============================================================
   Fake Casino – Kosmetik-Shop (client).
   Avatare & Namensfarben mit Chips kaufen und anlegen.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  function render(s) {
    const av = $("#cos-avatars");
    if (av) av.innerHTML = s.avatars.map((a) =>
      `<button class="cos-item ${a.equipped ? "equipped" : ""}" data-type="avatar" data-id="${a.id}" data-owned="${a.owned ? 1 : 0}">
        <span class="cos-emoji">${a.emoji}</span>
        <small>${a.equipped ? "✓ Aktiv" : a.owned ? "Anlegen" : (a.cost ? fmt(a.cost) + " 🪙" : "Gratis")}</small>
      </button>`).join("");
    const co = $("#cos-colors");
    if (co) co.innerHTML = s.colors.map((c) =>
      `<button class="cos-item ${c.equipped ? "equipped" : ""}" data-type="color" data-id="${c.id}" data-owned="${c.owned ? 1 : 0}">
        <span class="cos-swatch" style="background:${c.color || "#e8e8e8"}"></span>
        <small>${c.equipped ? "✓ Aktiv" : c.owned ? "Anlegen" : (c.cost ? fmt(c.cost) + " 🪙" : "Gratis")}</small>
      </button>`).join("");
  }

  function handle(el) {
    const type = el.dataset.type, id = el.dataset.id, owned = el.dataset.owned === "1";
    const ev = owned ? "cos:equip" : "cos:buy";
    socket.emit(ev, { type, id }, (r) => {
      if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      toast(owned ? "✓ Angelegt!" : "🎨 Gekauft!");
      render(r);
    });
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("#cos-avatars .cos-item, #cos-colors .cos-item");
    if (el) handle(el);
  });

  window.Casino._loadCosmetics = () => {
    socket.emit("cos:state", (s) => { if (s && s.ok) render(s); });
  };
})();
