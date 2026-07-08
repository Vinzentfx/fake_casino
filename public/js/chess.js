"use strict";

/* ============================================================
   Fake Casino – Schach-Duell (client).
   PvP wager chess. Board + clocks rendered from server state;
   click a piece to see legal moves, click a target to move.
   Server-authoritative (chess.js). Includes the Schach-Liga view.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, getAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  const GLYPH = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  };
  const FILES = "abcdefgh";

  let st = null, myCode = null, chosenTc = "5+0";
  let selected = null, legalTargets = [];
  let clockInt = null, clockBase = null, clockTurn = null, clockAt = 0;

  const views = ["chs-setup", "chs-wait", "chs-game", "chs-result", "chs-league"];
  function show(v) { for (const x of views) { const e = $("#" + x); if (e) e.style.display = x === v ? "" : "none"; } }

  // Time-control picker
  document.querySelectorAll("#chs-tcs .mem-size-btn").forEach((b) =>
    b.addEventListener("click", () => {
      chosenTc = b.dataset.tc;
      document.querySelectorAll("#chs-tcs .mem-size-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));

  // ── Board ─────────────────────────────────────────────────
  function myColor() { return st && st.yourColor ? st.yourColor : "w"; }
  function squareName(row, col) { return FILES[col] + (8 - row); } // board[row][col], row0=rank8

  function renderBoard() {
    const root = $("#chs-board");
    root.innerHTML = "";
    const flip = myColor() === "b";
    const rows = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const board = st.board;
    for (const r of rows) {
      for (const c of cols) {
        const sq = squareName(r, c);
        const cell = document.createElement("div");
        cell.className = "chs-cell " + (((r + c) % 2 === 0) ? "light" : "dark");
        cell.dataset.sq = sq;
        const piece = board && board[r] && board[r][c];
        if (piece) {
          const span = document.createElement("span");
          span.className = "chs-piece " + (piece.c === "w" ? "wp" : "bp");
          span.textContent = GLYPH[piece.c][piece.t];
          cell.appendChild(span);
        }
        if (st.lastMove && (st.lastMove.from === sq || st.lastMove.to === sq)) cell.classList.add("lastmv");
        if (selected === sq) cell.classList.add("sel");
        if (legalTargets.includes(sq)) cell.classList.add("legal");
        cell.addEventListener("click", () => clickSquare(sq));
        root.appendChild(cell);
      }
    }
  }

  function clickSquare(sq) {
    if (!st || st.state !== "playing") return;
    const myTurn = st.turn === myColor();
    if (!myTurn) return;
    if (selected && legalTargets.includes(sq)) {
      const from = selected, to = sq;
      selected = null; legalTargets = [];
      socket.emit("chess:move", { from, to, promotion: "q" }, (r) => {
        if (r && !r.ok && r.error) flashStatus(r.error);
      });
      return;
    }
    // select a piece of mine
    const board = st.board;
    // find r,c for sq
    const col = FILES.indexOf(sq[0]), row = 8 - parseInt(sq[1], 10);
    const piece = board && board[row] && board[row][col];
    if (piece && piece.c === myColor()) {
      selected = sq;
      socket.emit("chess:legal", { square: sq }, (res) => {
        legalTargets = (res && res.targets) || [];
        renderBoard();
      });
      renderBoard();
    } else { selected = null; legalTargets = []; renderBoard(); }
  }

  // ── Clocks ────────────────────────────────────────────────
  function fmtClock(ms) {
    ms = Math.max(0, ms | 0);
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function renderClocks() {
    if (!st.clocks) return;
    let c = { ...st.clocks };
    if (clockTurn && clockBase) {
      const elapsed = Date.now() - clockAt;
      c[clockTurn] = Math.max(0, clockBase[clockTurn] - elapsed);
    }
    const you = myColor(), opp = you === "w" ? "b" : "w";
    $("#chs-you-clock").textContent = fmtClock(c[you]);
    $("#chs-opp-clock").textContent = fmtClock(c[opp]);
    $("#chs-you-bar").classList.toggle("active", st.turn === you);
    $("#chs-opp-bar").classList.toggle("active", st.turn === opp);
  }
  function startClock() {
    stopClock();
    clockInt = setInterval(renderClocks, 250);
  }
  function stopClock() { if (clockInt) { clearInterval(clockInt); clockInt = null; } }

  // ── Status / moves ────────────────────────────────────────
  let statusTimer = null;
  function flashStatus(msg) {
    const el = $("#chs-status"); if (!el) return;
    el.textContent = msg; el.classList.add("warn");
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.classList.remove("warn"); renderStatus(); }, 1500);
  }
  function renderStatus() {
    const el = $("#chs-status"); if (!el || !st) return;
    if (st.state !== "playing") return;
    const myTurn = st.turn === myColor();
    let s = myTurn ? "▶ Du bist am Zug" : "Gegner ist am Zug…";
    if (st.check) s += " · Schach!";
    el.textContent = s;
  }
  function renderMoves() {
    const el = $("#chs-moves"); if (!el || !st.historySan) return;
    let html = "";
    for (let i = 0; i < st.historySan.length; i += 2) {
      const no = i / 2 + 1;
      html += `<span class="chs-mv">${no}. ${escapeHtml(st.historySan[i] || "")} ${escapeHtml(st.historySan[i + 1] || "")}</span>`;
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function renderPlayerBars() {
    const you = st.you || { name: "Du" }, opp = st.opponent || { name: "Gegner" };
    const yc = myColor() === "w" ? "♔" : "♚", oc = myColor() === "w" ? "♚" : "♔";
    $("#chs-you-bar").querySelector(".chs-pname").textContent = `${yc} ${you.name} (${you.rating || "?"})`;
    $("#chs-opp-bar").querySelector(".chs-pname").textContent = `${oc} ${opp.name} (${opp.rating || "?"})`;
  }

  function renderResult() {
    const r = st.result, me = getAccount(), myName = me && me.name;
    const emoji = $("#chs-result-emoji"), title = $("#chs-result-title"), sub = $("#chs-result-sub");
    const reasonTxt = { checkmate: "Schachmatt", timeout: "Zeit abgelaufen", resign: "Aufgabe", walkover: "Gegner hat verlassen", stalemate: "Patt", draw: "Remis" }[r.reason] || r.reason;
    if (r.draw) {
      emoji.textContent = "🤝"; title.textContent = "Remis!";
      sub.innerHTML = `${reasonTxt} — Einsatz zurück (${fmt(st.buyIn)} 🪙).<br>` + r.players.map((p) => `${escapeHtml(p.name)}: ${p.rating}`).join(" · ");
    } else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      sub.innerHTML = `${reasonTxt} · ` + (iWon ? `+${fmt(r.payout)} 🪙 (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)} 🪙 an ${escapeHtml(r.winner)}`) +
        `<br>` + r.players.map((p) => `${escapeHtml(p.name)}: ${p.rating}`).join(" · ");
      if (r.walkover && iWon) toast(`🏆 Gegner hat das Duell verlassen — du gewinnst ${fmt(r.payout)} 🪙!`);
    }
  }

  // ── State ─────────────────────────────────────────────────
  function apply(s) {
    const prev = st && st.state;
    st = s; myCode = s.code;
    if (s.state === "waiting") {
      show("chs-wait");
      $("#chs-code-show").textContent = s.code;
      $("#chs-wait-info").textContent = `${s.playerCount}/2 Spieler · ${s.tc} · ${s.public ? "🌐 öffentlich" : "🔒 privat (nur per Code)"}`;
      $("#chs-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      show("chs-game");
      if (prev !== "playing") { selected = null; legalTargets = []; }
      // clock baseline for local ticking
      clockBase = { ...s.clocks }; clockTurn = s.turn; clockAt = Date.now();
      renderBoard(); renderClocks(); renderPlayerBars(); renderStatus(); renderMoves();
      startClock();
    } else if (s.state === "done") {
      stopClock();
      show("chs-result");
      renderResult();
      const rm = s.rematch || {};
      $("#chs-rematch").style.display = rm.canRematch ? "" : "none";
      $("#chs-rematch-status").textContent = rm.youWant ? "Warte auf Revanche des Gegners…" : (rm.oppWants ? "🔁 Gegner will Revanche!" : "");
    }
  }

  socket.on("chess:state", (s) => { if (s) apply(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  // ── Buttons ───────────────────────────────────────────────
  $("#chs-create").addEventListener("click", () => {
    const err = $("#chs-error"); err.textContent = "";
    const buyIn = parseInt($("#chs-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 🪙."; return; }
    const visEl = document.querySelector('input[name="chs-vis"]:checked');
    const isPublic = !visEl || visEl.value === "public";
    socket.emit("chess:create", { buyIn, isPublic, tc: chosenTc }, (r) => { if (!r || !r.ok) err.textContent = (r && r.error) || "Fehler."; });
  });
  function doJoin(code) {
    const err = $("#chs-error"); if (err) err.textContent = "";
    socket.emit("chess:join", { code }, (r) => { if (!r || !r.ok) { if (err) err.textContent = (r && r.error) || "Fehler."; else toast((r && r.error) || "Fehler."); } });
  }
  $("#chs-join").addEventListener("click", () => {
    const code = ($("#chs-code").value || "").trim().toUpperCase();
    if (code.length !== 4) { $("#chs-error").textContent = "Code hat 4 Zeichen."; return; }
    doJoin(code);
  });
  $("#chs-start").addEventListener("click", () => socket.emit("chess:start", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); }));
  $("#chs-resign").addEventListener("click", () => {
    if (!confirm("Aufgeben? Der Gegner gewinnt den Pot.")) return;
    socket.emit("chess:resign", () => {});
  });

  function leave() { if (myCode) socket.emit("chess:leave"); myCode = null; st = null; stopClock(); }
  function reset() { leave(); show("chs-setup"); $("#chs-error").textContent = ""; }
  $("#chs-cancel").addEventListener("click", reset);
  $("#chs-again").addEventListener("click", reset);
  $("#chs-rematch").addEventListener("click", () => {
    socket.emit("chess:rematch", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); else $("#chs-rematch-status").textContent = "Warte auf Revanche des Gegners…"; });
  });
  const chsBack = document.querySelector('[data-screen="chess"] .back-btn');
  if (chsBack) chsBack.addEventListener("click", () => { if (myCode) leave(); });

  // ── League ────────────────────────────────────────────────
  function renderLeague(data) {
    const me = data.me;
    $("#chs-me-card").innerHTML = me
      ? `<div class="chs-me">Deine Wertung: <b>${me.rating}</b> · ${me.wins}S / ${me.losses}N / ${me.draws}R</div>`
      : `<div class="chs-me muted">Spiel ein Duell, um in die Wertung zu kommen.</div>`;
    const pl = data.players || [];
    $("#chs-lb-players").innerHTML = pl.length
      ? pl.map((p, i) => `<div class="chs-lb-row"><span class="chs-lb-rank">${i + 1}</span>
          <span class="chs-lb-name">${p.tag ? `[${escapeHtml(p.tag)}] ` : ""}${escapeHtml(p.name)}</span>
          <span class="chs-lb-rating">${p.rating}</span>
          <span class="chs-lb-wl muted small">${p.wins}-${p.losses}-${p.draws}</span></div>`).join("")
      : '<p class="muted small">Noch keine gewerteten Partien.</p>';
    const cl = data.clans || [];
    $("#chs-lb-clans").innerHTML = cl.length
      ? cl.map((c, i) => `<div class="chs-lb-row"><span class="chs-lb-rank">${i + 1}</span>
          <span class="chs-lb-name" style="color:${c.color || "#e6b04b"}">[${escapeHtml(c.tag || "?")}]</span>
          <span class="chs-lb-rating">${c.wins} Siege</span>
          <span class="chs-lb-wl muted small">Ø ${c.avgRating} · ${c.members} akt.</span></div>`).join("")
      : '<p class="muted small">Noch keine Clan-Partien.</p>';
  }
  function openLeague() {
    show("chs-league");
    socket.emit("chess:leaderboards", (r) => { if (r && r.ok) renderLeague(r); });
  }
  $("#chs-league-btn").addEventListener("click", openLeague);
  $("#chs-league-back").addEventListener("click", () => show("chs-setup"));

  window.Casino._chessJoinCode = (code) => { window.Casino.showScreen("chess"); doJoin(code); };
  window.Casino._loadChess = () => {
    if (st && st.state && st.state !== "done") { apply(st); return; }
    show("chs-setup"); $("#chs-error").textContent = "";
  };
})();
