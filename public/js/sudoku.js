"use strict";

/* ============================================================
   Fake Casino – Sudoku-Race (client).
   Real-time PvP: both players fill the SAME puzzle; first correct
   full solution wins. Server-authoritative validation.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, getAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let st = null;
  let myCode = null;
  let chosenDiff = "medium";
  let soloMode = false, soloPlaying = false;
  let puzzle = null;      // given cells (0 = blank)
  let grid = null;        // my working grid (81)
  let selected = -1;      // selected cell index
  let sendTimer = null;   // throttle for sudoku:update
  let timerInt = null;
  let endsAt = 0;

  const DIFF_LABELS = { easy: "Leicht", medium: "Mittel", hard: "Schwer" };
  const progressCount = () => Array.isArray(grid) && Array.isArray(puzzle)
    ? grid.filter((v, i) => puzzle[i] !== 0 || (v >= 1 && v <= 9)).length
    : 0;
  const setProgress = (prefix, progress) => {
    const n = Math.max(0, Math.min(81, Math.floor(Number(progress)) || 0));
    $(`#sdk-${prefix}-val`).textContent = String(n);
    $(`#sdk-${prefix}-bar`).style.width = Math.round((n / 81) * 100) + "%";
  };

  const views = ["sdk-setup", "sdk-wait", "sdk-game", "sdk-result"];
  function show(view) { for (const v of views) { const el = $("#" + v); if (el) el.style.display = v === view ? "" : "none"; } }

  // Difficulty picker
  document.querySelectorAll("#sdk-diffs .mem-size-btn").forEach((b) =>
    b.addEventListener("click", () => {
      chosenDiff = b.dataset.diff;
      document.querySelectorAll("#sdk-diffs .mem-size-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));

  // Mode tabs (Solo / PvP-Race)
  document.querySelectorAll("#sdk-setup .sol-mode-tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll("#sdk-setup .sol-mode-tab").forEach((x) => x.classList.toggle("active", x === t));
      const m = t.dataset.smode;
      $("#sdk-solo-panel").style.display = m === "solo" ? "" : "none";
      $("#sdk-pvp-panel").style.display = m === "race" ? "" : "none";
    }));

  // ── Grid ──────────────────────────────────────────────────
  function buildGrid() {
    const g = $("#sdk-grid");
    if (g.childElementCount === 81) return;
    g.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const c = document.createElement("button");
      c.className = "sdk-cell";
      const r = Math.floor(i / 9), col = i % 9;
      if (col === 2 || col === 5) c.classList.add("br");
      if (r === 2 || r === 5) c.classList.add("bb");
      c.dataset.i = i;
      c.addEventListener("click", () => selectCell(i));
      g.appendChild(c);
    }
  }

  function conflictIndexes() {
    const conflicts = new Set();
    if (!Array.isArray(grid)) return conflicts;
    const groups = [];
    for (let r = 0; r < 9; r++) groups.push([...Array(9)].map((_, c) => r * 9 + c));
    for (let c = 0; c < 9; c++) groups.push([...Array(9)].map((_, r) => r * 9 + c));
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        groups.push([...Array(9)].map((_, k) => (br * 3 + Math.floor(k / 3)) * 9 + (bc * 3 + (k % 3))));
      }
    }
    for (const group of groups) {
      const seen = new Map();
      for (const i of group) {
        const v = grid[i];
        if (!v) continue;
        if (!seen.has(v)) seen.set(v, []);
        seen.get(v).push(i);
      }
      for (const hits of seen.values()) {
        if (hits.length > 1) hits.forEach((i) => conflicts.add(i));
      }
    }
    return conflicts;
  }

  function renderGrid() {
    const cells = $("#sdk-grid").children;
    const conflicts = conflictIndexes();
    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      const given = puzzle[i] !== 0;
      const v = grid[i];
      c.textContent = v ? String(v) : "";
      c.classList.toggle("given", given);
      c.classList.toggle("sel", i === selected);
      c.classList.toggle("conflict", conflicts.has(i));
      c.disabled = given;
    }
  }

  function selectCell(i) {
    if (puzzle[i] !== 0) return; // givens not selectable
    selected = i;
    renderGrid();
  }

  function setNumber(n) {
    if (selected < 0 || !grid || puzzle[selected] !== 0) return;
    grid[selected] = n; // 0 = erase
    renderGrid();
    scheduleSend();
  }

  function scheduleSend() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      if (!grid) return;
      const showProgress = (r) => {
        if (r && r.ok && !r.solved && typeof r.progress === "number") {
          setProgress("you", r.progress);
        }
      };
      if (soloMode) {
        socket.emit("sudoku:soloUpdate", { grid }, (r) => { if (r && r.ok && r.solved) onSoloSolved(); else showProgress(r); });
      } else if (myCode) {
        socket.emit("sudoku:update", { grid }, showProgress);
      }
    }, 350);
  }

  function onSoloSolved() {
    soloPlaying = false;
    show("sdk-result");
    $("#sdk-result-emoji").textContent = "🏆";
    $("#sdk-result-title").textContent = "Gelöst! 🎉";
    $("#sdk-result-sub").innerHTML = "Sauber gelöst — zählt für deine Achievements & Statistik.";
    $("#sdk-rematch").style.display = "none"; $("#sdk-rematch-status").textContent = "";
  }

  // Number pad
  document.querySelectorAll("#sdk-pad .sdk-key").forEach((b) =>
    b.addEventListener("click", () => setNumber(parseInt(b.dataset.n, 10))));
  // Keyboard support while on the sudoku screen
  document.addEventListener("keydown", (e) => {
    const active = soloMode ? soloPlaying : (st && st.state === "playing");
    if (!active) return;
    if (document.querySelector('[data-screen="sudoku"]') && !document.querySelector('[data-screen="sudoku"]').classList.contains("active")) return;
    if (e.key >= "1" && e.key <= "9") setNumber(parseInt(e.key, 10));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") setNumber(0);
  });

  // ── Timer ─────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    timerInt = setInterval(() => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $("#sdk-timer").textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (left <= 0) stopTimer();
    }, 500);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  // ── State ─────────────────────────────────────────────────
  function renderProgress(s) {
    const you = s.you || { name: "Du", progress: 0 }, opp = s.opponent || { name: "Gegner", progress: 0 };
    $("#sdk-you-name").textContent = you.name;
    $("#sdk-opp-name").textContent = opp.name;
    setProgress("opp", opp.progress || 0);
    setProgress("you", you.progress || progressCount());
  }

  function renderResult(s) {
    const r = s.result, me = getAccount(), myName = me && me.name;
    const emoji = $("#sdk-result-emoji"), title = $("#sdk-result-title"), sub = $("#sdk-result-sub");
    if (r.tie) { emoji.textContent = "🤝"; title.textContent = "Unentschieden!"; sub.textContent = `Einsatz zurück (${fmt(s.buyIn)} 🪙 je Spieler).`; }
    else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      const line = r.players.map((p) => `${escapeHtml(p.name)}: ${p.correct} richtig${p.finished ? " ✅" : ""}`).join(" · ");
      sub.innerHTML = (iWon ? `+${fmt(r.payout)} 🪙 (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)} 🪙 an ${escapeHtml(r.winner)}`) +
        `<br>${line}` + (r.walkover ? "<br><span class='muted'>Gegner hat aufgegeben.</span>" : "");
    }
  }

  function apply(s) {
    const prevState = st && st.state;
    st = s; myCode = s.code;
    if (s.state === "waiting") {
      show("sdk-wait");
      $("#sdk-code-show").textContent = s.code;
      $("#sdk-wait-info").textContent = `${s.playerCount}/2 Spieler · ${DIFF_LABELS[s.difficulty] || s.difficulty} · ${s.public ? "🌐 öffentlich" : "🔒 privat (nur per Code)"}`;
      $("#sdk-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      soloMode = false; soloPlaying = false;
      $("#sdk-topbar").style.display = ""; $("#sdk-opp-row").style.display = ""; // race layout
      show("sdk-game");
      // First transition into playing → set up my grid from the puzzle.
      if (prevState !== "playing" || !grid) {
        puzzle = s.puzzle.slice();
        grid = s.puzzle.slice();
        selected = -1;
        buildGrid();
        renderGrid();
        endsAt = Date.now() + (s.timeLeft || 0);
        startTimer();
      }
      renderProgress(s);
    } else if (s.state === "done") {
      stopTimer();
      show("sdk-result");
      renderResult(s);
      const rm = s.rematch || {};
      $("#sdk-rematch").style.display = rm.canRematch ? "" : "none";
      $("#sdk-rematch-status").textContent = rm.youWant ? "Warte auf Revanche des Gegners…" : (rm.oppWants ? "🔁 Gegner will Revanche!" : "");
      // Walkover: opponent left mid-race → notify the winner (money already credited).
      const r = s.result, me = getAccount(), myName = me && me.name;
      if (r && r.walkover && r.winner && myName && r.winner.toLowerCase() === myName.toLowerCase()) {
        toast(`🏆 Gegner hat das Race verlassen — du gewinnst ${fmt(r.payout)} 🪙!`);
      }
    }
  }

  socket.on("sudoku:state", (s) => { if (s) apply(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  // ── Actions ───────────────────────────────────────────────
  $("#sdk-create").addEventListener("click", () => {
    const err = $("#sdk-error"); err.textContent = "";
    const buyIn = parseInt($("#sdk-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 🪙."; return; }
    const visEl = document.querySelector('input[name="sdk-vis"]:checked');
    const isPublic = !visEl || visEl.value === "public";
    socket.emit("sudoku:create", { buyIn, isPublic, difficulty: chosenDiff }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Fehler."; }
    });
  });

  function doJoin(code) {
    const err = $("#sdk-error"); if (err) err.textContent = "";
    socket.emit("sudoku:join", { code }, (r) => {
      if (!r || !r.ok) { if (err) err.textContent = (r && r.error) || "Fehler."; else toast((r && r.error) || "Fehler."); }
    });
  }
  $("#sdk-join").addEventListener("click", () => {
    const code = ($("#sdk-code").value || "").trim().toUpperCase();
    if (code.length !== 4) { $("#sdk-error").textContent = "Code hat 4 Zeichen."; return; }
    doJoin(code);
  });

  // Solo (no timer, no stake)
  $("#sdk-solo-start").addEventListener("click", () => {
    $("#sdk-error").textContent = "";
    socket.emit("sudoku:soloStart", { difficulty: chosenDiff }, (r) => {
      if (!r || !r.ok) { $("#sdk-error").textContent = (r && r.error) || "Fehler."; return; }
      soloMode = true; soloPlaying = true; myCode = null; st = null;
      puzzle = r.puzzle.slice(); grid = r.puzzle.slice(); selected = -1;
      buildGrid(); renderGrid();
      $("#sdk-topbar").style.display = "none";   // no timer
      $("#sdk-opp-row").style.display = "none";  // no opponent
      $("#sdk-you-name").textContent = "Ausgefüllt"; setProgress("you", progressCount());
      show("sdk-game");
    });
  });
  $("#sdk-start").addEventListener("click", () => socket.emit("sudoku:start", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); }));

  function leave() {
    if (myCode) socket.emit("sudoku:leave");
    if (soloMode || soloPlaying) socket.emit("sudoku:soloLeave");
    myCode = null; st = null; grid = null; puzzle = null; soloMode = false; soloPlaying = false; stopTimer();
  }
  $("#sdk-cancel").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-again").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-giveup").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-rematch").addEventListener("click", () => {
    socket.emit("sudoku:rematch", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); else $("#sdk-rematch-status").textContent = "Warte auf Revanche des Gegners…"; });
  });

  // Leaving the game screen (‹ Lobby) mid-race forfeits → opponent wins the pot.
  const sdkBack = document.querySelector('[data-screen="sudoku"] .back-btn');
  if (sdkBack) sdkBack.addEventListener("click", () => { if (myCode || soloPlaying) leave(); });

  window.Casino._sudokuJoinCode = (code) => { window.Casino.showScreen("sudoku"); doJoin(code); };
  window.Casino._loadSudoku = () => {
    if (soloMode && soloPlaying) { show("sdk-game"); return; }
    if (!st || st.state === "done") { show("sdk-setup"); $("#sdk-error").textContent = ""; }
    else apply(st);
  };
})();
