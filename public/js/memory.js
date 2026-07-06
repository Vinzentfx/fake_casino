"use strict";

/* ============================================================
   Fake Casino – Memory-Duell (client).
   Turn-based PvP memory. Create a match (buy-in) or join by code /
   from the open lobby. Server-authoritative board.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, getAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let st = null;        // last server state
  let myCode = null;    // code of the match I'm in
  let chosenSize = "medium";

  const SIZE_LABELS = { small: "Klein (12)", medium: "Mittel (20)", large: "Groß (30)" };

  // Board-size picker (segmented buttons).
  document.querySelectorAll("#mem-sizes .mem-size-btn").forEach((b) =>
    b.addEventListener("click", () => {
      chosenSize = b.dataset.size;
      document.querySelectorAll("#mem-sizes .mem-size-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));

  const views = ["mem-setup", "mem-wait", "mem-game", "mem-result"];
  function show(view) {
    for (const v of views) { const el = $("#" + v); if (el) el.style.display = v === view ? "" : "none"; }
  }

  // ── Board rendering ───────────────────────────────────────
  function buildGrid(n) {
    const grid = $("#mem-grid");
    if (grid.childElementCount === n) return;
    grid.innerHTML = "";
    const cols = Math.ceil(Math.sqrt(n));
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.className = "mem-card";
      b.dataset.i = i;
      b.addEventListener("click", () => flip(i));
      grid.appendChild(b);
    }
  }

  function renderBoard(s) {
    buildGrid(s.board.length);
    const cards = $("#mem-grid").children;
    for (const c of s.board) {
      const el = cards[c.i];
      if (!el) continue;
      el.textContent = c.up ? c.face : "";
      el.classList.toggle("up", c.up);
      el.classList.toggle("matched", c.matched);
      el.disabled = !s.yourTurn || c.up;
    }
  }

  function renderScores(s) {
    const you = s.you || { name: "Du", pairs: 0 };
    const opp = s.opponent || { name: "Gegner", pairs: 0 };
    $("#mem-you").querySelector(".mem-name").textContent = you.name;
    $("#mem-you").querySelector(".mem-pairs").textContent = you.pairs;
    $("#mem-opp").querySelector(".mem-name").textContent = opp.name;
    $("#mem-opp").querySelector(".mem-pairs").textContent = opp.pairs;
    $("#mem-turn").textContent = s.yourTurn ? "▶ Du bist dran" : `Wartet auf ${s.turnName || "Gegner"}…`;
    $("#mem-turn").classList.toggle("me", !!s.yourTurn);
    $("#mem-pot").textContent = `Pot: ${fmt(s.pot)} 🪙 · Einsatz ${fmt(s.buyIn)} 🪙`;
  }

  function renderResult(s) {
    const r = s.result;
    const me = getAccount();
    const myName = me && me.name;
    const emoji = $("#mem-result-emoji"), title = $("#mem-result-title"), sub = $("#mem-result-sub");
    if (r.tie) {
      emoji.textContent = "🤝"; title.textContent = "Unentschieden!";
      sub.textContent = `Einsatz zurück (${fmt(s.buyIn)} 🪙 je Spieler).`;
    } else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      const scoreline = r.players.map((p) => `${escapeHtml(p.name)} ${p.pairs}`).join(" · ");
      sub.innerHTML = (iWon ? `+${fmt(r.payout)} 🪙 (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)} 🪙 an ${escapeHtml(r.winner)}`) +
        `<br>${scoreline}` + (r.walkover ? "<br><span class='muted'>Gegner hat aufgegeben.</span>" : "");
    }
  }

  function apply(s) {
    st = s;
    myCode = s.code;
    if (s.state === "waiting") {
      show("mem-wait");
      $("#mem-code-show").textContent = s.code;
      $("#mem-wait-players").textContent = `${s.playerCount}/2 Spieler · 🧩 ${SIZE_LABELS[s.size] || s.size} · ${s.public ? "🌐 öffentlich" : "🔒 privat (nur per Code)"}`;
      $("#mem-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      show("mem-game");
      renderScores(s);
      renderBoard(s);
    } else if (s.state === "done") {
      show("mem-result");
      renderResult(s);
      // Walkover: the opponent left mid-game → notify the winner even if they're
      // no longer on this screen (money is already credited via account:update).
      const r = s.result, me = getAccount(), myName = me && me.name;
      if (r && r.walkover && r.winner && myName && r.winner.toLowerCase() === myName.toLowerCase()) {
        toast(`🏆 Gegner hat das Duell verlassen — du gewinnst ${fmt(r.payout)} 🪙!`);
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────
  function flip(i) {
    if (!st || !st.yourTurn) return;
    socket.emit("memory:flip", { index: i }, (r) => {
      if (r && !r.ok && r.error) { /* transient (not your turn / waiting) — ignore quietly */ }
    });
  }

  socket.on("memory:state", (s) => { if (s) apply(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  $("#mem-create").addEventListener("click", () => {
    const err = $("#mem-error"); err.textContent = "";
    const buyIn = parseInt($("#mem-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 🪙."; return; }
    const visEl = document.querySelector('input[name="mem-vis"]:checked');
    const isPublic = !visEl || visEl.value === "public";
    socket.emit("memory:create", { buyIn, isPublic, size: chosenSize }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Fehler."; return; }
    });
  });

  function doJoin(code) {
    const err = $("#mem-error"); if (err) err.textContent = "";
    socket.emit("memory:join", { code }, (r) => {
      if (!r || !r.ok) { if (err) err.textContent = (r && r.error) || "Fehler."; else toast((r && r.error) || "Fehler."); }
    });
  }

  $("#mem-join").addEventListener("click", () => {
    const code = ($("#mem-code").value || "").trim().toUpperCase();
    if (code.length !== 4) { $("#mem-error").textContent = "Code hat 4 Zeichen."; return; }
    doJoin(code);
  });

  $("#mem-start").addEventListener("click", () => {
    socket.emit("memory:start", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); });
  });

  function leave() {
    if (myCode) socket.emit("memory:leave");
    myCode = null; st = null;
  }
  $("#mem-cancel").addEventListener("click", () => { leave(); show("mem-setup"); });
  $("#mem-again").addEventListener("click", () => { leave(); show("mem-setup"); });

  // Leaving the game screen (‹ Lobby) mid-match forfeits → opponent wins the pot.
  const memBack = document.querySelector('[data-screen="memory"] .back-btn');
  if (memBack) memBack.addEventListener("click", () => { if (myCode) leave(); });

  // Join straight from the open-lobby browser.
  window.Casino._memoryJoinCode = (code) => { window.Casino.showScreen("memory"); doJoin(code); };

  window.Casino._loadMemory = () => {
    // Fresh visit with no active match → setup view.
    if (!st || st.state === "done") { show("mem-setup"); $("#mem-error").textContent = ""; }
    else apply(st);
  };
})();
