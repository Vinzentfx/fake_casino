"use strict";

/* ============================================================
   Fake Casino – Blackjack lobby (social layer).
   The game itself is unchanged (each player vs the dealer); this just shows a
   shared roster + a live feed of who won/lost how much, plus per-lobby chat.
   ============================================================ */

(function () {
  const { socket, escapeHtml, toast } = window.Casino;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.abs(Math.round(n)).toLocaleString("de-DE");

  let code = null;
  let state = null;

  const panel = () => $("bj-lobby-panel");

  function showPanel(c) {
    code = c;
    panel().classList.remove("hidden");
    $("bj-lobby-code").textContent = c;
    if (window.Casino.chat) window.Casino.chat.enterLobby(c);
  }
  function hidePanel() {
    code = null;
    state = null;
    panel().classList.add("hidden");
    $("bj-lobby-players").innerHTML = "";
    $("bj-lobby-feed").innerHTML = "";
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  function netStr(n) {
    const cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
    return `<b class="${cls}">${sign}${fmt(n)} 🪙</b>`;
  }

  function render() {
    if (!state) return;
    $("bj-lobby-code").textContent = state.code;
    const me = window.Casino.getAccount && window.Casino.getAccount();
    $("bj-lobby-players").innerHTML = state.players.map((p) => {
      const mine = me && p.name && me.name && p.name.toLowerCase() === me.name.toLowerCase();
      return `<div class="bj-lp${mine ? " mine" : ""}"><span>${escapeHtml(p.name)} <span class="muted small">(${p.hands})</span></span>${netStr(p.net)}</div>`;
    }).join("");
    const feed = state.feed.slice().reverse().map((f) => {
      const cls = f.net > 0 ? "pos" : f.net < 0 ? "neg" : "";
      const verb = f.net > 0 ? `gewann +${fmt(f.net)} 🪙` : f.net < 0 ? `verlor −${fmt(f.net)} 🪙` : "Push";
      return `<div class="bj-feed-row"><span>${escapeHtml(f.name)}</span> <span class="${cls}">${verb}</span></div>`;
    }).join("");
    $("bj-lobby-feed").innerHTML = feed || '<div class="muted small">Noch keine Runde gespielt — gib Karten!</div>';
  }

  socket.on("bjlobby:state", (s) => {
    if (!s || s.ok === false) return;
    state = s;
    if (s.code && panel().classList.contains("hidden")) showPanel(s.code);
    code = s.code;
    render();
  });

  function wire() {
    $("bj-lobby-btn")?.addEventListener("click", () => {
      if (code) return toast("Du bist schon in einer Lobby.");
      socket.emit("bjlobby:create", (res) => {
        if (res && res.ok) showPanel(res.code);
        else toast((res && res.error) || "Konnte Lobby nicht erstellen.");
      });
    });
    $("bj-lobby-leave")?.addEventListener("click", () => { socket.emit("bjlobby:leave"); hidePanel(); });
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);

  // Joined from the home-screen lobby browser.
  window.Casino._bjJoinCode = (c) => {
    window.Casino.showScreen("blackjack");
    socket.emit("bjlobby:join", { code: c }, (res) => {
      if (res && res.ok) showPanel(res.code);
      else toast((res && res.error) || "Lobby nicht gefunden.");
    });
  };

  // Leave the lobby automatically when navigating away from blackjack.
  const bjScreen = document.querySelector('[data-screen="blackjack"]');
  if (bjScreen) {
    new MutationObserver(() => {
      if (code && !bjScreen.classList.contains("active")) { socket.emit("bjlobby:leave"); hidePanel(); }
    }).observe(bjScreen, { attributes: true, attributeFilter: ["class"] });
  }
})();
