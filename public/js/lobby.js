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
    listEl.innerHTML = lobbies.map((l) => {
      const watchOnly = !l.joinable && l.watchable;
      const sub = watchOnly && l.names && l.names.length
        ? `Läuft: ${l.names.map(escapeHtml).join(" vs ")}`
        : `Anführer: ${escapeHtml(l.host)} · ${l.players}/${l.max} Spieler`;
      const btn = watchOnly
        ? `<button class="btn-secondary lobby-watch" data-game="${escapeHtml(l.game)}" data-code="${escapeHtml(l.code)}">👁️ Zuschauen</button>`
        : `<button class="btn-primary lobby-join" data-game="${escapeHtml(l.game)}" data-code="${escapeHtml(l.code)}">Beitreten</button>`;
      return `
      <div class="lobby-card">
        <div class="lobby-card-info">
          <div class="lobby-card-title">${escapeHtml(l.label)} <span class="muted small">· ${escapeHtml(String(l.buyIn))}</span></div>
          <div class="muted small">${sub}</div>
        </div>
        ${btn}
      </div>`;
    }).join("");
    listEl.querySelectorAll(".lobby-join").forEach((b) =>
      b.addEventListener("click", () => join(b.dataset.game, b.dataset.code)));
    listEl.querySelectorAll(".lobby-watch").forEach((b) =>
      b.addEventListener("click", () => watch(b.dataset.game, b.dataset.code)));
  }

  function watch(game, code) {
    if (game === "chess" && window.Casino._chessSpectate) window.Casino._chessSpectate(code);
    else toast("Diesem Spiel kann man gerade nicht zuschauen.");
  }

  function join(game, code) {
    if (game === "poker" && window.Casino._pokerJoinCode) window.Casino._pokerJoinCode(code);
    else if (game === "pvp" && window.Casino._pvpJoinCode) window.Casino._pvpJoinCode(code);
    else if (game === "blackjack" && window.Casino._bjJoinCode) window.Casino._bjJoinCode(code);
    else if (game === "roulette" && window.Casino._rouletteJoinCode) window.Casino._rouletteJoinCode(code);
    else if (game === "memory" && window.Casino._memoryJoinCode) window.Casino._memoryJoinCode(code);
    else if (game === "sudoku" && window.Casino._sudokuJoinCode) window.Casino._sudokuJoinCode(code);
    else if (game === "solrace" && window.Casino._solraceJoinCode) window.Casino._solraceJoinCode(code);
    else if (game === "chess" && window.Casino._chessJoinCode) window.Casino._chessJoinCode(code);
    else if (game === "pinco" && window.Casino._pincoJoinCode) window.Casino._pincoJoinCode(code);
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
