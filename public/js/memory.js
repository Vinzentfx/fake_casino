"use strict";

/* Memory-Duell
   Abwechselnd gegeneinander. Match mit Buy-in anlegen oder per Code bzw. über
   die Lobby beitreten. Das Brett liegt auf dem Server. */

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

  // Board rendering
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
      /*
       * Zwei Seiten statt eines leeren Vierecks, in dem ein Emoji erscheint.
       * Bei einem Spiel, das Memory heisst, ist das Umdrehen der Karte der
       * ganze Vorgang, der darf man auch sehen.
       */
      b.innerHTML = `<span class="mem-flip"><span class="mem-back"></span><span class="mem-front"></span></span>`;
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
      // Die Vorderseite behaelt ihr Motiv, auch wenn die Karte wieder
      // zugeklappt wird: sonst blitzt sie beim Zurueckdrehen leer auf.
      if (c.up) el.querySelector(".mem-front").textContent = c.face;
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
    $("#mem-pot").textContent = `Pot: ${fmt(s.pot)} Chips · Einsatz ${fmt(s.buyIn)} Chips`;
  }

  function renderResult(s) {
    const r = s.result;
    const me = getAccount();
    const myName = me && me.name;
    const emoji = $("#mem-result-emoji"), title = $("#mem-result-title"), sub = $("#mem-result-sub");
    if (r.tie) {
      emoji.textContent = "🤝"; title.textContent = "Unentschieden!";
      sub.textContent = `Einsatz zurück (${fmt(s.buyIn)} Chips je Spieler).`;
    } else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      const scoreline = r.players.map((p) => `${escapeHtml(p.name)} ${p.pairs}`).join(" · ");
      sub.innerHTML = (iWon ? `+${fmt(r.payout)}<i class=mk></i> (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)}<i class=mk></i> an ${escapeHtml(r.winner)}`) +
        `<br>${scoreline}` + (r.walkover ? "<br><span class='muted'>Gegner hat aufgegeben.</span>" : "");
    }
  }

  function apply(s) {
    st = s;
    myCode = s.code;
    if (s.state === "waiting") {
      show("mem-wait");
      $("#mem-code-show").textContent = s.code;
      $("#mem-wait-players").textContent = `${s.playerCount}/2 Spieler · ${SIZE_LABELS[s.size] || s.size} · ${s.public ? "öffentlich" : "privat (nur per Code)"}`;
      $("#mem-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      show("mem-game");
      renderScores(s);
      renderBoard(s);
    } else if (s.state === "done") {
      show("mem-result");
      renderResult(s);
      const rm = s.rematch || {};
      $("#mem-rematch").style.display = rm.canRematch ? "" : "none";
      $("#mem-rematch-status").textContent = rm.youWant ? "Warte auf Revanche des Gegners…" : (rm.oppWants ? "Dein Gegner will eine Revanche!" : "");
      // Kampflos: der Gegner ist mitten im Spiel gegangen. Den Gewinner auch dann
      // benachrichtigen, wenn er woanders ist (die Chips kamen schon über account:update).
      const r = s.result, me = getAccount(), myName = me && me.name;
      if (r && r.walkover && r.winner && myName && r.winner.toLowerCase() === myName.toLowerCase()) {
        toast(`Dein Gegner hat das Duell verlassen, du bekommst ${fmt(r.payout)} Chips.`);
      }
    }
  }

  // Actions
  function flip(i) {
    if (!st || !st.yourTurn) return;
    socket.emit("memory:flip", { index: i }, (r) => {
      if (r && !r.ok && r.error) { /* nur vorübergehend (nicht dran, warten), einfach ignorieren */ }
    });
  }

  socket.on("memory:state", (s) => { if (s) apply(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  $("#mem-create").addEventListener("click", () => {
    const err = $("#mem-error"); err.textContent = "";
    const buyIn = parseInt($("#mem-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 Chips."; return; }
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
  $("#mem-rematch").addEventListener("click", () => {
    socket.emit("memory:rematch", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); else { $("#mem-rematch-status").textContent = "Warte auf Revanche des Gegners…"; } });
  });

  // Wer mitten im Match den Screen verlässt (‹ Lobby), gibt auf, der Gegner bekommt den Topf.
  const memBack = document.querySelector('[data-screen="memory"] .back-btn');
  if (memBack) memBack.addEventListener("click", () => { if (myCode) leave(); });

  // Direkt aus der Lobby-Liste beitreten.
  window.Casino._memoryJoinCode = (code) => { window.Casino.showScreen("memory"); doJoin(code); };

  window.Casino._loadMemory = () => {
    // Neuer Besuch ohne laufendes Match: Einstellungen zeigen.
    if (!st || st.state === "done") { show("mem-setup"); $("#mem-error").textContent = ""; }
    else apply(st);
  };
})();
