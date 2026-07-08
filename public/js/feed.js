"use strict";

/* ============================================================
   Lobby live feed.
   ============================================================ */

(function () {
  const { socket, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const items = [];

  function ago(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "gerade";
    const m = Math.floor(s / 60);
    if (m < 60) return `vor ${m}m`;
    return `vor ${Math.floor(m / 60)}h`;
  }

  function icon(type) {
    if (type === "win") return "💥";
    if (type === "loss") return "💸";
    if (type === "level") return "⭐";
    if (type === "season") return "🎟️";
    return "📣";
  }

  function render() {
    const list = $("#global-feed-list");
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="muted small">Noch keine Highlights.</div>';
      return;
    }
    list.innerHTML = items.slice(0, 8).map((it) => `
      <div style="display:flex;gap:.5rem;align-items:flex-start;padding:.35rem 0;border-bottom:1px solid rgba(255,255,255,.07)">
        <span>${icon(it.type)}</span>
        <div style="min-width:0;flex:1">
          <div class="small">${escapeHtml(it.text)}</div>
          <div class="muted small">${ago(it.ts)}</div>
        </div>
      </div>`).join("");
  }

  function load() {
    socket.emit("feed:list", (res) => {
      if (!res || !res.ok) return;
      items.length = 0;
      items.push(...(res.items || []));
      render();
    });
  }

  socket.on("feed:update", (item) => {
    if (!item) return;
    items.unshift(item);
    if (items.length > 30) items.length = 30;
    render();
  });

  window.Casino._loadFeed = load;
  setInterval(render, 60000).unref?.();
})();
