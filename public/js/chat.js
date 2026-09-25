"use strict";

/* Chat-Dock, schwebt unten links auf jedem Screen.

   In Ruhe ist nur die Blase zu sehen. Der Verlauf ist ausgeblendet und lässt
   Klicks durch (pointer-events:none), damit er nie einen Spielknopf verdeckt.
   Eine neue Nachricht oder ein Tipp blendet ihn kurz ein, danach verblasst er
   wieder. Die Blase antippen öffnet die Eingabe. Es gibt nur ein Dock, der Raum
   wechselt mit dem Screen (global in Lobby und Startseite, der Lobby-Code in
   einer Spiel-Lobby). */

(function () {
  const { socket, escapeHtml } = window.Casino;
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const FADE_MS = 7000; // so lange nach der letzten Nachricht oder Berührung wird der Verlauf ausgeblendet

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
    // Namensstil und Farbe kommen jetzt mit der Nachricht mit. Vorher war der
    // Chat die einzige Stelle, an der alle Namen gleich grau aussahen.
    const nm = window.Casino.spieler
      ? window.Casino.spieler.name(msg, { extra: "chat-name" }) + window.Casino.spieler.prunk(msg) + window.Casino.spieler.garnitur(msg)
      : `<span class="chat-name">${escapeHtml(msg.name)}</span>`;
    const zn = window.Casino.spieler ? window.Casino.spieler.zeichen(msg) : "";
    return `<div class="chat-row${mine ? " mine" : ""}">
      ${zn}${nm}
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

  // Reveal / fade
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

  // Raum und Verlauf
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
        logEl.innerHTML = '<div class="chat-empty muted small">Noch keine Nachrichten</div>';
        return;
      }
      res.messages.forEach((m) => append(m, false));
      logEl.scrollTop = logEl.scrollHeight;
    });
  }

  // Wiring
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

  // Die Eingabe kurz nach dem Fokusverlust einklappen, wenn sie leer ist (dann
  // bleibt der Bildschirm auf dem iPad frei, sobald man fertig ist).
  textEl.addEventListener("blur", () => {
    setTimeout(() => { if (open && !textEl.value.trim() && document.activeElement !== textEl) setOpen(false); }, 250);
  });

  // Jede Berührung am Dock hält es wach.
  dock.addEventListener("pointerdown", reveal);

  socket.on("chat:msg", ({ room: r, msg }) => {
    if (r !== room) return;
    append(msg);
    reveal();
  });

  // Nach außen
  window.Casino.chat = {
    // Privaten Chat einer Lobby betreten oder verlassen (Schlüssel ist der Lobby-Code).
    enterLobby: (code) => { dock.dataset.lobbyRoom = code; if (code !== room) loadRoom(code); },
    leaveLobby: () => { delete dock.dataset.lobbyRoom; loadRoom("global"); },
    // Ganzes Dock ein- oder ausblenden (auf der Anmeldung ist es weg).
    update: (screen) => {
      if (screen === "login" || screen === "verification") { dock.classList.add("hidden"); setOpen(false); return; }
      dock.classList.remove("hidden");
      // In a game lobby? keep that channel; otherwise the global channel.
      if (room !== "global" && !dock.dataset.lobbyRoom) loadRoom("global");
    },
  };

  loadRoom("global");
})();
