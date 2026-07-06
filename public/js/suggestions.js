"use strict";

/* ============================================================
   Fake Casino – Vorschläge (client).
   Players send suggestions to the owner (rate-limited server-side).
   The owner ("vincent") sees an inbox with all received suggestions.
   ============================================================ */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);

  function renderRemaining(s) {
    const el = $("#suggest-remaining");
    if (el) el.textContent = `Noch ${s.remaining}/${s.perHour} Vorschläge diese Stunde`;
    const send = $("#suggest-send");
    if (send) send.disabled = s.remaining <= 0;
  }

  function renderInbox(s) {
    const inbox = $("#suggest-inbox");
    if (!s.isOwner) { inbox.style.display = "none"; return; }
    inbox.style.display = "";
    const list = $("#suggest-list");
    const items = s.items || [];
    if (!items.length) { list.innerHTML = '<p class="muted small">Noch keine Vorschläge.</p>'; return; }
    list.innerHTML = items.map((it) => {
      const when = new Date(it.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return `<div class="suggest-item">
        <div class="suggest-item-head"><b>${escapeHtml(it.name)}</b> <span class="muted small">${when}</span></div>
        <div class="suggest-item-text">${escapeHtml(it.text)}</div>
        <button class="btn-secondary suggest-del" data-at="${it.at}">Erledigt / löschen</button>
      </div>`;
    }).join("");
    list.querySelectorAll(".suggest-del").forEach((b) =>
      b.addEventListener("click", () => socket.emit("suggest:delete", { at: Number(b.dataset.at) }, (r) => { if (r && r.ok) applyState(r); })));
  }

  function applyState(s) {
    if (!s || !s.ok) return;
    renderRemaining(s);
    renderInbox(s);
  }

  function load() {
    $("#suggest-error").textContent = "";
    $("#suggest-thanks").style.display = "none";
    socket.emit("suggest:state", applyState);
  }

  $("#suggest-send").addEventListener("click", () => {
    const err = $("#suggest-error"); err.textContent = "";
    const text = ($("#suggest-text").value || "").trim();
    if (text.length < 3) { err.textContent = "Bitte schreib etwas mehr."; return; }
    socket.emit("suggest:send", { text }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Fehler."; return; }
      $("#suggest-text").value = "";
      $("#suggest-thanks").style.display = "";
      renderRemaining({ remaining: r.remaining, perHour: 5 });
      toast("💡 Vorschlag gesendet — danke!");
    });
  });

  // Live ping for the owner when a new suggestion arrives.
  socket.on("suggest:new", (d) => {
    toast(`💡 Neuer Vorschlag von ${d && d.name ? d.name : "jemandem"}!`);
    const inbox = $("#suggest-inbox");
    if (inbox && inbox.style.display !== "none") load();
  });

  window.Casino._loadSuggest = load;
})();
