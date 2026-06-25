"use strict";

/* ============================================================
   Fake Casino – Roulette lobby coordinator.
   Socket wiring + panel buttons for the shared roulette table; the actual
   board/wheel rendering lives in roulette.js via window.Casino._roulette.
   ============================================================ */

(function () {
  const { socket, toast } = window.Casino;
  const $ = (id) => document.getElementById(id);
  let code = null;

  const panel = () => $("rt-lobby-panel");
  const rt = () => window.Casino._roulette;

  function showPanel(c) {
    code = c;
    panel().classList.remove("hidden");
    $("rt-lobby-code").textContent = c;
    if (rt()) rt().setLobby(c, false);
    if (window.Casino.chat) window.Casino.chat.enterLobby(c);
  }
  function hidePanel() {
    code = null;
    panel().classList.add("hidden");
    $("rt-lobby-players").innerHTML = "";
    $("rt-lobby-bets").innerHTML = "";
    if (rt()) rt().setLobby(null);
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  socket.on("rlobby:state", (s) => {
    if (!s || s.ok === false) return;
    if (s.code && panel().classList.contains("hidden")) showPanel(s.code);
    code = s.code;
    if (rt()) rt().applyState(s);
  });
  socket.on("rlobby:result", (r) => { if (rt()) rt().playResult(r); });

  function wire() {
    $("rt-lobby-btn")?.addEventListener("click", () => {
      if (code) return toast("Du bist schon in einer Lobby.");
      socket.emit("rlobby:create", (res) => {
        if (res && res.ok) showPanel(res.code);
        else toast((res && res.error) || "Konnte Lobby nicht erstellen.");
      });
    });
    $("rt-lobby-leave")?.addEventListener("click", () => { socket.emit("rlobby:leave"); hidePanel(); });
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);

  // Joined from the home-screen lobby browser.
  window.Casino._rouletteJoinCode = (c) => {
    window.Casino.showScreen("roulette");
    socket.emit("rlobby:join", { code: c }, (res) => {
      if (res && res.ok) showPanel(res.code);
      else toast((res && res.error) || "Lobby nicht gefunden.");
    });
  };

  // Leave the lobby when navigating away from the roulette screen.
  const rtScreen = document.querySelector('[data-screen="roulette"]');
  if (rtScreen) {
    new MutationObserver(() => {
      if (code && !rtScreen.classList.contains("active")) { socket.emit("rlobby:leave"); hidePanel(); }
    }).observe(rtScreen, { attributes: true, attributeFilter: ["class"] });
  }
})();
