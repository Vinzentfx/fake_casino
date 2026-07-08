"use strict";

/* ============================================================
   Fake Casino – Solitär / Klondike (client).
   Two modes: Solo vs house (sol:*) and PvP race (solrace:*).
   Click a card to select its run, click a destination to move.
   Double-click sends a card to its foundation. Server-authoritative.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, getAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  const SUITS = ["♠", "♥", "♦", "♣"];
  const RED = { 1: true, 2: true };
  const rankLabel = (r) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[r] || String(r));

  let mode = "solo";       // "solo" | "race"
  let board = null;        // last publicView
  let over = false;
  let sel = null;          // { kind: "w"|"t"|"f", col?, idx?, s? }
  // race
  let raceSt = null, myCode = null, timerInt = null, endsAt = 0;

  const views = ["sol-setup", "sol-wait", "sol-game", "sol-result"];
  function show(v) { for (const x of views) { const e = $("#" + x); if (e) e.style.display = x === v ? "" : "none"; } }

  // ── Mode tabs ─────────────────────────────────────────────
  document.querySelectorAll(".sol-mode-tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".sol-mode-tab").forEach((x) => x.classList.toggle("active", x === t));
      const m = t.dataset.mode;
      $("#sol-free-panel").style.display = m === "free" ? "" : "none";
      $("#sol-solo-panel").style.display = m === "solo" ? "" : "none";
      $("#sol-race-panel").style.display = m === "race" ? "" : "none";
    }));

  // ── Card element ──────────────────────────────────────────
  function cardEl(c, opts = {}) {
    const el = document.createElement("div");
    el.className = "sol-card";
    if (!c || c.up === false) { el.classList.add("down"); return el; }
    el.classList.add(RED[c.s] ? "red" : "black");
    el.innerHTML = `<span>${rankLabel(c.r)}</span><span>${SUITS[c.s]}</span>`;
    if (opts.sel) el.classList.add("sel");
    return el;
  }

  function send(m, cb) {
    const ev = mode === "race" ? "solrace:move" : "sol:move";
    socket.emit(ev, m, cb || (() => {}));
  }

  // ── Board rendering ───────────────────────────────────────
  function renderBoard(b) {
    board = b;
    const root = $("#sol-board");
    root.innerHTML = "";

    // Top row: stock, waste, spacer, 4 foundations
    const top = document.createElement("div");
    top.className = "sol-top";
    const stock = document.createElement("div");
    stock.className = "sol-slot sol-stock" + (b.stockCount ? "" : (b.recycles === 0 ? " empty" : " recycle"));
    stock.innerHTML = b.stockCount ? `<div class="sol-card down"></div>` : (b.recycles === 0 ? "✕" : "↻");
    stock.addEventListener("click", () => doDraw());
    top.appendChild(stock);

    // Waste: draw-1 everywhere → show only the TOP card (each card was already
    // seen when it was drawn, so nothing "new" appears underneath).
    const waste = document.createElement("div");
    waste.className = "sol-slot sol-waste";
    const wcards = b.waste || [];
    const wtop = wcards.length ? wcards[wcards.length - 1] : null;
    if (wtop) {
      const el = cardEl(wtop, { sel: sel && sel.kind === "w" });
      el.addEventListener("click", (e) => { e.stopPropagation(); clickWaste(); });
      el.addEventListener("dblclick", (e) => { e.stopPropagation(); autoFoundation("w"); });
      waste.appendChild(el);
    }
    top.appendChild(waste);

    const spacer = document.createElement("div"); spacer.className = "sol-slot sol-spacer"; top.appendChild(spacer);

    b.foundations.forEach((f, fi) => {
      const slot = document.createElement("div");
      slot.className = "sol-slot sol-foundation" + (sel && sel.kind === "f" && sel.s === fi ? " sel" : "");
      slot.innerHTML = `<span class="sol-found-suit ${RED[fi] ? "red" : "black"}">${SUITS[fi]}</span>`;
      if (f) { slot.innerHTML = ""; slot.appendChild(cardEl(f)); }
      slot.addEventListener("click", () => clickFoundation(fi));
      top.appendChild(slot);
    });
    root.appendChild(top);

    // Tableau: 7 columns
    const tab = document.createElement("div");
    tab.className = "sol-tableau";
    b.tableau.forEach((pile, col) => {
      const colEl = document.createElement("div");
      colEl.className = "sol-col";
      colEl.addEventListener("click", (e) => { if (e.target === colEl) clickColumn(col); });
      if (!pile.length) {
        const empty = document.createElement("div"); empty.className = "sol-slot sol-empty-col";
        empty.addEventListener("click", () => clickColumn(col));
        colEl.appendChild(empty);
      } else {
        pile.forEach((c, idx) => {
          const isSel = sel && sel.kind === "t" && sel.col === col && idx >= sel.idx;
          const el = cardEl(c.up === false ? { up: false } : c, { sel: isSel });
          el.style.marginTop = idx === 0 ? "0" : (c.up === false ? "-58px" : "-42px");
          el.addEventListener("click", (e) => { e.stopPropagation(); clickTableauCard(col, idx); });
          el.addEventListener("dblclick", (e) => { e.stopPropagation(); if (c.up !== false && idx === pile.length - 1) autoFoundation("t", col); });
          colEl.appendChild(el);
        });
      }
      tab.appendChild(colEl);
    });
    root.appendChild(tab);
  }

  // ── Interaction ───────────────────────────────────────────
  function clearSel() { sel = null; }
  function reRender() { if (mode === "race" && raceSt && raceSt.board) renderBoard(raceSt.board); else if (board) renderBoard(board); }

  function apply(res) {
    if (!res) return;
    if (res.account) applyAccount(res.account);
    if (res.moveError) flash(res.moveError);
    if (res.board) renderBoard(res.board);            // race move ack
    else if (res.tableau) renderBoard(res);           // solo view is the board itself
    if (mode === "solo" && res.won) { over = true; endSolo(true, res.payout); return; }
    if (mode === "solo" && board && !over) renderSoloHud();
  }

  function doDraw() { clearSel(); send({ type: "draw" }, apply); }

  function clickWaste() {
    if (!hasWasteTop()) return;
    if (sel && sel.kind === "w") { clearSel(); reRender(); return; }
    sel = { kind: "w" }; reRender();
  }
  function hasWasteTop() { const b = curBoard(); return b && b.waste && b.waste.length; }
  function curBoard() { return mode === "race" ? (raceSt && raceSt.board) : board; }

  function clickFoundation(fi) {
    if (sel && sel.kind === "w") { send({ type: "wf" }, afterMove); return; }
    if (sel && sel.kind === "t") {
      const b = curBoard(); const pile = b.tableau[sel.col];
      if (sel.idx === pile.length - 1) send({ type: "tf", col: sel.col }, afterMove);
      else flash("Nur die oberste Karte kann auf die Basis.");
      return;
    }
    // no selection → select this foundation as a source
    const b = curBoard();
    if (b && b.foundations[fi]) { sel = { kind: "f", s: fi }; reRender(); }
  }

  function clickTableauCard(col, idx) {
    const b = curBoard(); if (!b) return;
    const pile = b.tableau[col];
    const c = pile[idx];
    if (sel) {
      // attempt a move to this column; if it fails and we clicked a face-up card, reselect it
      attemptMoveToColumn(col, () => { if (c && c.up !== false) selectRun(col, idx); });
      return;
    }
    if (c && c.up !== false) selectRun(col, idx);
  }
  function selectRun(col, idx) { sel = { kind: "t", col, idx }; reRender(); }

  function clickColumn(col) {
    if (!sel) return;
    attemptMoveToColumn(col);
  }

  function attemptMoveToColumn(col, onFail) {
    if (!sel) return;
    if (sel.kind === "w") { send({ type: "wt", col }, (r) => afterMove(r, onFail)); }
    else if (sel.kind === "t") {
      const b = curBoard(); const pile = b.tableau[sel.col];
      const count = pile.length - sel.idx;
      if (sel.col === col) { clearSel(); reRender(); return; }
      send({ type: "tt", from: sel.col, to: col, count }, (r) => afterMove(r, onFail));
    } else if (sel.kind === "f") { send({ type: "ft", s: sel.s, to: col }, (r) => afterMove(r, onFail)); }
  }

  function afterMove(res, onFail) {
    if (res && res.moveError) {
      if (onFail) { clearSel(); onFail(); return; }
      flash(res.moveError); return;
    }
    clearSel();
    apply(res);
  }

  function autoFoundation(kind, col) {
    if (kind === "w") send({ type: "wf" }, afterMove);
    else send({ type: "tf", col }, afterMove);
  }

  let flashTimer = null;
  function flash(msg) {
    const el = $("#sol-movehint"); if (!el) return;
    el.textContent = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = ""; }, 1600);
  }

  // ── Solo HUD / lifecycle ──────────────────────────────────
  function renderSoloHud() {
    if (board.free) {
      $("#sol-hud").innerHTML = `<div class="sol-hud-item"><span>Modus</span><b>🎯 Frei</b></div>
        <div class="sol-hud-item"><span>Neuauflagen</span><b>∞</b></div>
        <div class="sol-hud-item"><span>Basis</span><b>${board.foundationTotal || 0}/52</b></div>`;
    } else {
      $("#sol-hud").innerHTML = `<div class="sol-hud-item"><span>Einsatz</span><b>${fmt(board.bet || 0)} 🪙</b></div>
        <div class="sol-hud-item"><span>Bei Sieg</span><b>${fmt((board.bet || 0) * (board.winMult || 3))} 🪙</b></div>
        <div class="sol-hud-item"><span>Basis</span><b>${board.foundationTotal || 0}/52</b></div>`;
    }
    $("#sol-auto").style.display = "";
    $("#sol-giveup").style.display = "";
    $("#sol-giveup").textContent = board.free ? "Beenden" : "Aufgeben";
  }

  function endSolo(won, payout) {
    stopTimer();
    show("sol-result");
    $("#sol-rematch").style.display = "none"; $("#sol-rematch-status").textContent = ""; // solo has no rematch
    const free = board && board.free;
    $("#sol-result-emoji").textContent = won ? "🏆" : "🙈";
    $("#sol-result-title").textContent = won ? "Abgeräumt!" : (free ? "Beendet" : "Aufgegeben");
    if (won) $("#sol-result-sub").innerHTML = free ? "🎉 Geschafft! Zählt für deine Achievements." : `+${fmt(payout)} 🪙 (Einsatz ×${board.winMult || 3})!`;
    else $("#sol-result-sub").innerHTML = free ? "Kein Verlust — jederzeit neu starten." : "Einsatz weg. Nächstes Mal!";
  }

  // ── Race lifecycle ────────────────────────────────────────
  function startTimer() {
    stopTimer();
    timerInt = setInterval(() => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      const t = $("#sol-race-timer"); if (t) t.textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (left <= 0) stopTimer();
    }, 500);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  function renderRaceHud(s) {
    const you = s.you || { name: "Du", foundations: 0 }, opp = s.opponent || { name: "Gegner", foundations: 0 };
    $("#sol-hud").innerHTML = `<div class="sol-hud-item"><span>${escapeHtml(you.name)}</span><b>${you.foundations}/52</b></div>
      <div class="sol-hud-item sol-hud-timer"><span>Zeit</span><b id="sol-race-timer">–</b></div>
      <div class="sol-hud-item"><span>${escapeHtml(opp.name)}</span><b>${opp.foundations}/52</b></div>`;
    $("#sol-auto").style.display = "";
    $("#sol-giveup").style.display = "none";
  }

  function renderRaceResult(s) {
    const r = s.result, me = getAccount(), myName = me && me.name;
    const emoji = $("#sol-result-emoji"), title = $("#sol-result-title"), sub = $("#sol-result-sub");
    if (r.tie) { emoji.textContent = "🤝"; title.textContent = "Unentschieden!"; sub.textContent = `Einsatz zurück (${fmt(s.buyIn)} 🪙 je Spieler).`; }
    else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      const line = r.players.map((p) => `${escapeHtml(p.name)}: ${p.foundations}/52`).join(" · ");
      sub.innerHTML = (iWon ? `+${fmt(r.payout)} 🪙 (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)} 🪙 an ${escapeHtml(r.winner)}`) +
        `<br>${line}` + (r.walkover ? "<br><span class='muted'>Gegner hat aufgegeben.</span>" : "");
      if (r.walkover && iWon) toast(`🏆 Gegner hat das Race verlassen — du gewinnst ${fmt(r.payout)} 🪙!`);
    }
  }

  function applyRace(s) {
    const prev = raceSt && raceSt.state;
    raceSt = s; myCode = s.code; mode = "race";
    if (s.state === "waiting") {
      show("sol-wait");
      $("#sol-code-show").textContent = s.code;
      $("#sol-wait-info").textContent = `${s.playerCount}/2 Spieler · ${s.public ? "🌐 öffentlich" : "🔒 privat (nur per Code)"}`;
      $("#sol-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      show("sol-game");
      if (prev !== "playing") { endsAt = Date.now() + (s.timeLeft || 0); startTimer(); clearSel(); }
      renderRaceHud(s);
      if (s.board) renderBoard(s.board);
    } else if (s.state === "done") {
      stopTimer(); show("sol-result"); renderRaceResult(s);
      const rm = s.rematch || {};
      $("#sol-rematch").style.display = rm.canRematch ? "" : "none";
      $("#sol-rematch-status").textContent = rm.youWant ? "Warte auf Revanche des Gegners…" : (rm.oppWants ? "🔁 Gegner will Revanche!" : "");
    }
  }

  socket.on("solrace:state", (s) => { if (s) applyRace(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  // ── Buttons ───────────────────────────────────────────────
  $("#sol-free-start").addEventListener("click", () => {
    mode = "solo"; over = false; clearSel();
    socket.emit("sol:start", { free: true }, (res) => {
      if (!res || !res.ok) { $("#sol-error").textContent = (res && res.error) || "Fehler."; return; }
      show("sol-game"); renderBoard(res); renderSoloHud();
    });
  });

  $("#sol-solo-start").addEventListener("click", () => {
    const err = $("#sol-error"); err.textContent = "";
    const bet = parseInt($("#sol-bet").value, 10);
    if (!Number.isFinite(bet) || bet < 20) { err.textContent = "Mindesteinsatz 20 🪙."; return; }
    if (bet > 500) { err.textContent = "Maximaleinsatz 500 🪙."; return; }
    mode = "solo"; over = false; clearSel();
    socket.emit("sol:start", { bet }, (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      if (res.account) applyAccount(res.account);
      show("sol-game"); renderBoard(res); renderSoloHud();
    });
  });

  $("#sol-auto").addEventListener("click", () => { clearSel(); send({ type: "auto" }, apply); });
  $("#sol-giveup").addEventListener("click", () => {
    if (mode !== "solo") return;
    socket.emit("sol:giveup", (res) => { if (res && res.ok) { over = true; endSolo(false); } });
  });

  $("#sol-race-create").addEventListener("click", () => {
    const err = $("#sol-error"); err.textContent = "";
    const buyIn = parseInt($("#sol-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 🪙."; return; }
    const visEl = document.querySelector('input[name="sol-vis"]:checked');
    const isPublic = !visEl || visEl.value === "public";
    socket.emit("solrace:create", { buyIn, isPublic }, (r) => { if (!r || !r.ok) err.textContent = (r && r.error) || "Fehler."; });
  });
  function doJoin(code) {
    const err = $("#sol-error"); if (err) err.textContent = "";
    socket.emit("solrace:join", { code }, (r) => { if (!r || !r.ok) { if (err) err.textContent = (r && r.error) || "Fehler."; else toast((r && r.error) || "Fehler."); } });
  }
  $("#sol-join").addEventListener("click", () => {
    const code = ($("#sol-code").value || "").trim().toUpperCase();
    if (code.length !== 4) { $("#sol-error").textContent = "Code hat 4 Zeichen."; return; }
    doJoin(code);
  });
  $("#sol-start").addEventListener("click", () => socket.emit("solrace:start", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); }));

  function leaveRace() { if (myCode) socket.emit("solrace:leave"); myCode = null; raceSt = null; stopTimer(); }
  function resetToSetup() { leaveRace(); board = null; over = false; clearSel(); show("sol-setup"); $("#sol-error").textContent = ""; }
  $("#sol-cancel").addEventListener("click", resetToSetup);
  $("#sol-again").addEventListener("click", resetToSetup);
  $("#sol-rematch").addEventListener("click", () => {
    socket.emit("solrace:rematch", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); else $("#sol-rematch-status").textContent = "Warte auf Revanche des Gegners…"; });
  });
  const solBack = document.querySelector('[data-screen="solitaire"] .back-btn');
  if (solBack) solBack.addEventListener("click", () => { if (myCode) leaveRace(); });

  window.Casino._solraceJoinCode = (code) => { window.Casino.showScreen("solitaire"); doJoin(code); };
  window.Casino._loadSolitaire = () => {
    if (mode === "race" && raceSt && raceSt.state !== "done") { applyRace(raceSt); return; }
    if (mode === "solo" && board && !over) { show("sol-game"); renderBoard(board); renderSoloHud(); return; }
    show("sol-setup"); $("#sol-error").textContent = "";
  };
})();
