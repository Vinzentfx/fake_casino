"use strict";

/* ============================================================
   Fake Casino – reusable chat widget.

   Markup convention (any container):
     <div class="chat-box" data-chat-room="global">
       <div class="chat-log" data-chat-log></div>
       <form class="chat-input" data-chat-form>
         <input data-chat-text /><button type="submit">Senden</button>
       </form>
     </div>

   Mount with window.Casino.chat.mount(boxEl[, room]) — room defaults to the
   box's data-chat-room. Re-mounting (e.g. a lobby code changes) is safe.
   ============================================================ */

(function () {
  const { socket, escapeHtml } = window.Casino;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  // boxEl -> { room } so incoming messages route to the right open widget.
  const mounted = new Map();

  function rowHtml(msg) {
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const mine = me && msg.name && me.name && msg.name.toLowerCase() === me.name.toLowerCase();
    return `<div class="chat-row${mine ? " mine" : ""}">
      <span class="chat-name">${escapeHtml(msg.name)}</span>
      <span class="chat-text">${escapeHtml(msg.text)}</span>
      <span class="chat-time">${fmtTime(msg.ts)}</span>
    </div>`;
  }

  function append(logEl, msg, scroll = true) {
    logEl.insertAdjacentHTML("beforeend", rowHtml(msg));
    if (scroll) logEl.scrollTop = logEl.scrollHeight;
  }

  function mount(boxEl, room) {
    if (!boxEl) return;
    room = room || boxEl.dataset.chatRoom || "global";
    const logEl = boxEl.querySelector("[data-chat-log]");
    const formEl = boxEl.querySelector("[data-chat-form]");
    const textEl = boxEl.querySelector("[data-chat-text]");
    if (!logEl || !formEl || !textEl) return;

    mounted.set(boxEl, { room, logEl });

    // Load recent history.
    logEl.innerHTML = '<div class="chat-empty muted small">Lädt…</div>';
    socket.emit("chat:history", { room }, (res) => {
      if (mounted.get(boxEl)?.room !== room) return; // re-mounted meanwhile
      logEl.innerHTML = "";
      if (!res || !res.ok || !res.messages.length) {
        logEl.innerHTML = '<div class="chat-empty muted small">Noch keine Nachrichten — sag Hallo! 👋</div>';
        return;
      }
      res.messages.forEach((m) => append(logEl, m, false));
      logEl.scrollTop = logEl.scrollHeight;
    });

    // Bind the form once per box.
    if (!boxEl.dataset.chatBound) {
      boxEl.dataset.chatBound = "1";
      formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = textEl.value.trim();
        if (!text) return;
        const cur = mounted.get(boxEl);
        if (!cur) return;
        socket.emit("chat:send", { room: cur.room, text }, (res) => {
          if (res && !res.ok) window.Casino.toast(res.error || "Konnte nicht senden.");
        });
        textEl.value = "";
      });
    }
  }

  function unmount(boxEl) {
    mounted.delete(boxEl);
  }

  socket.on("chat:msg", ({ room, msg }) => {
    for (const [boxEl, info] of mounted) {
      if (info.room !== room) continue;
      const empty = info.logEl.querySelector(".chat-empty");
      if (empty) empty.remove();
      append(info.logEl, msg);
    }
  });

  window.Casino.chat = { mount, unmount };

  // Mount the global lobby chat whenever the lobby screen opens.
  window.Casino._loadChatGlobal = () => {
    const box = document.querySelector("#global-chat");
    if (box) mount(box, "global");
  };
})();
