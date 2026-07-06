"use strict";

/* ============================================================
   Fake Casino – open-lobby browser (home screen).
   Lists every joinable lobby across games so players can join without
   exchanging a code. Live-updates via the server's "lobby:list" broadcast.
   ============================================================ */

(function () {
  const { socket, escapeHtml, toast } = window.Casino;
  const listEl = document.getElementById("lobby-list");
  if (!listEl) return;

  let lobbies = [];
  const onScreen = () => {
    const s = document.querySelector('[data-screen="lobby"]');
    return s && s.classList.contains("active");
  };

  function render() {
    if (!lobbies.length) {
      listEl.innerHTML = '<p class="muted small">Keine offenen Lobbys gerade. Erstelle eine in 🃏 Poker oder 🎰 Slots-Duell — sie taucht hier für alle auf.</p>';
      return;
    }
    listEl.innerHTML = lobbies.map((l) => `
      <div class="lobby-card">
        <div class="lobby-card-info">
          <div class="lobby-card-title">${escapeHtml(l.label)} <span class="muted small">· ${escapeHtml(String(l.buyIn))}</span></div>
          <div class="muted small">Anführer: ${escapeHtml(l.host)} · ${l.players}/${l.max} Spieler</div>
        </div>
        <button class="btn-primary lobby-join" data-game="${escapeHtml(l.game)}" data-code="${escapeHtml(l.code)}">Beitreten</button>
      </div>`).join("");
    listEl.querySelectorAll(".lobby-join").forEach((b) =>
      b.addEventListener("click", () => join(b.dataset.game, b.dataset.code)));
  }

  function join(game, code) {
    if (game === "poker" && window.Casino._pokerJoinCode) window.Casino._pokerJoinCode(code);
    else if (game === "pvp" && window.Casino._pvpJoinCode) window.Casino._pvpJoinCode(code);
    else if (game === "blackjack" && window.Casino._bjJoinCode) window.Casino._bjJoinCode(code);
    else if (game === "roulette" && window.Casino._rouletteJoinCode) window.Casino._rouletteJoinCode(code);
    else if (game === "memory" && window.Casino._memoryJoinCode) window.Casino._memoryJoinCode(code);
    else if (game === "sudoku" && window.Casino._sudokuJoinCode) window.Casino._sudokuJoinCode(code);
    else toast("Diese Lobby lässt sich gerade nicht beitreten.");
  }

  function load() {
    socket.emit("lobby:list", (res) => {
      if (res && res.ok) { lobbies = res.lobbies; render(); }
    });
  }

  // Server pushes the full list on any change (array payload).
  socket.on("lobby:list", (list) => {
    lobbies = Array.isArray(list) ? list : (list && list.lobbies) || [];
    if (onScreen()) render();
  });

  document.getElementById("lobby-refresh")?.addEventListener("click", load);
  window.Casino._loadLobbies = load;
})();
