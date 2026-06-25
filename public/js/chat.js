"use strict";

/* ============================================================
   Fake Casino – floating chat dock (bottom-left, every screen).

   Idle state: only the 💬 bubble shows; the message log is faded out and
   click-through (pointer-events:none) so it never blocks game buttons. A new
   message or a tap reveals the log briefly, then it fades again. Tapping the
   bubble opens the input. One dock, whose room switches with the screen
   (global on the home/lobby, a lobby code inside a game lobby — set later).
   ============================================================ */

(function () {
  const { socket, escapeHtml } = window.Casino;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const FADE_MS = 7000; // hide the log this long after the last message/interaction

  const dock = document.getElementById("chat-dock");
  if (!dock) return;
  const logEl = dock.querySelector("[data-chat-log]");
  const formEl = dock.querySelector("[data-chat-form]");
  const textEl = dock.querySelector("[data-chat-text]");
  const toggleEl = dock.querySelector("[data-chat-toggle]");
  const tagEl = dock.querySelector("[data-chat-tag]");

  let room = dock.dataset.chatRoom || "global";
  let open = false;
  let fadeTimer = null;
  let loadToken = 0;

  function rowHtml(msg) {
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const mine = me && msg.name && me.name && msg.name.toLowerCase() === me.name.toLowerCase();
    return `<div class="chat-row${mine ? " mine" : ""}">
      <span class="chat-name">${escapeHtml(msg.name)}</span>
      <span class="chat-text">${escapeHtml(msg.text)}</span>
    </div>`;
  }
  function append(msg, scroll = true) {
    const empty = logEl.querySelector(".chat-empty");
    if (empty) empty.remove();
    logEl.insertAdjacentHTML("beforeend", rowHtml(msg));
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    if (scroll) logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Reveal / fade ──────────────────────────────────────────────────────
  function reveal() {
    dock.classList.add("show");
    clearTimeout(fadeTimer);
    if (!open) fadeTimer = setTimeout(hide, FADE_MS);
  }
  function hide() {
    if (open) return;
    dock.classList.remove("show");
  }
  function setOpen(v) {
    open = v;
    dock.classList.toggle("open", v);
    if (v) { reveal(); clearTimeout(fadeTimer); textEl.focus(); }
    else { fadeTimer = setTimeout(hide, FADE_MS); }
  }

  // ── Room / history ─────────────────────────────────────────────────────
  function loadRoom(r) {
    room = r || "global";
    dock.dataset.chatRoom = room;
    if (tagEl) tagEl.textContent = room === "global" ? "" : "•";
    const token = ++loadToken;
    logEl.innerHTML = '<div class="chat-empty muted small">Lädt…</div>';
    socket.emit("chat:history", { room }, (res) => {
      if (token !== loadToken) return;
      logEl.innerHTML = "";
      if (!res || !res.ok || !res.messages.length) {
        logEl.innerHTML = '<div class="chat-empty muted small">Noch keine Nachrichten 👋</div>';
        return;
      }
      res.messages.forEach((m) => append(m, false));
      logEl.scrollTop = logEl.scrollHeight;
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  toggleEl.addEventListener("click", () => setOpen(!open));

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textEl.value.trim();
    if (!text) return;
    socket.emit("chat:send", { room, text }, (res) => {
      if (res && !res.ok) window.Casino.toast(res.error || "Konnte nicht senden.");
    });
    textEl.value = "";
    reveal();
  });

  // Collapse the input shortly after it loses focus if left empty (keeps the
  // screen clear on iPad once you're done typing).
  textEl.addEventListener("blur", () => {
    setTimeout(() => { if (open && !textEl.value.trim() && document.activeElement !== textEl) setOpen(false); }, 250);
  });

  // Any interaction with the dock keeps it awake.
  dock.addEventListener("pointerdown", reveal);

  socket.on("chat:msg", ({ room: r, msg }) => {
    if (r !== room) return;
    append(msg);
    reveal();
  });

  // ── Public API ─────────────────────────────────────────────────────────
  window.Casino.chat = {
    // Enter/leave a game lobby's private chat channel (keyed by lobby code).
    enterLobby: (code) => { dock.dataset.lobbyRoom = code; if (code !== room) loadRoom(code); },
    leaveLobby: () => { delete dock.dataset.lobbyRoom; loadRoom("global"); },
    // Show/hide the whole dock (hidden on the login screen).
    update: (screen) => {
      if (screen === "login") { dock.classList.add("hidden"); setOpen(false); return; }
      dock.classList.remove("hidden");
      // In a game lobby? keep that channel; otherwise the global channel.
      if (room !== "global" && !dock.dataset.lobbyRoom) loadRoom("global");
    },
  };

  loadRoom("global");
})();
