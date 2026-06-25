"use strict";

/* ============================================================
   Fake Casino – Poker (Texas Hold'em) client
   Renders the table from server state and sends player actions.
   Depends on window.Casino (socket, showScreen, toast, getAccount).
   ============================================================ */

(function () {
  const { socket, toast, getAccount, escapeHtml } = window.Casino;

  const $ = (s) => document.querySelector(s);

  const lobbyView = $("#poker-lobby");
  const tableView = $("#poker-table-view");
  const felt = $("#felt");

  let state = null; // latest table state from server
  let joined = false;

  // Visual slots around the felt; index 0 = bottom (always the viewer).
  // [left%, top%]
  const SLOTS = [
    [50, 90], // 0 bottom center (you)
    [12, 72], // 1
    [12, 26], // 2
    [50, 8], // 3 top center
    [88, 26], // 4
    [88, 72], // 5
  ];

  const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const rankLabel = (r) => RANK[r] || String(r);

  // ----------------------------------------------------------------
  // Table lobby: create / join
  // ----------------------------------------------------------------
  $("#create-table-btn").addEventListener("click", () => {
    const bb = parseInt($("#blind-select").value, 10);
    socket.emit("poker:create", { smallBlind: Math.floor(bb / 2), bigBlind: bb }, (res) => {
      if (res && res.ok) enterTable(res.code);
      else toast((res && res.error) || "Konnte Tisch nicht erstellen.");
    });
  });

  $("#poker-bots-entry").addEventListener("click", () => {
    const bots = parseInt($("#bot-count").value, 10) || 3;
    const buyIn = parseInt($("#bot-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 20) return toast("Buy-in muss mind. 20 sein.");
    socket.emit("poker:createBots", { bots, buyIn, bigBlind: 20 }, (res) => {
      if (res && res.ok) enterTable(res.code);
      else toast((res && res.error) || "Konnte Bot-Tisch nicht erstellen.");
    });
  });

  // Fill the current table with a bot (works on friend tables too).
  $("#add-bot-btn").addEventListener("click", () => {
    socket.emit("poker:addBot", (res) => {
      if (res && !res.ok) toast(res.error || "Konnte keinen Bot hinzufügen.");
    });
  });

  $("#join-table-btn").addEventListener("click", joinFromInput);
  $("#join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinFromInput();
  });
  $("#join-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });

  function joinFromInput() {
    const code = $("#join-code").value.trim().toUpperCase();
    const errEl = $("#poker-join-error");
    errEl.textContent = "";
    if (code.length !== 4) {
      errEl.textContent = "Code besteht aus 4 Zeichen.";
      return;
    }
    socket.emit("poker:join", { code }, (res) => {
      if (res && res.ok) enterTable(res.code);
      else errEl.textContent = (res && res.error) || "Tisch nicht gefunden.";
    });
  }

  function enterTable() {
    joined = true;
    lobbyView.classList.add("hidden");
    tableView.classList.remove("hidden");
  }

  function exitToLobby() {
    joined = false;
    state = null;
    tableView.classList.add("hidden");
    lobbyView.classList.remove("hidden");
    $("#join-code").value = "";
    $("#poker-join-error").textContent = "";
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  // Joined from the home-screen lobby browser → open the poker screen; the
  // poker:state broadcast then drops us into the table view automatically.
  window.Casino._pokerJoinCode = (code) => {
    window.Casino.showScreen("poker");
    socket.emit("poker:join", { code }, (res) => {
      if (res && !res.ok) toast(res.error || "Tisch nicht gefunden.");
    });
  };

  $("#leave-table-btn").addEventListener("click", () => {
    socket.emit("poker:leave");
    exitToLobby();
  });

  // Leave the table automatically when navigating away from the poker screen.
  const pokerScreen = document.querySelector('[data-screen="poker"]');
  new MutationObserver(() => {
    if (joined && !pokerScreen.classList.contains("active")) {
      socket.emit("poker:leave");
      exitToLobby();
    }
  }).observe(pokerScreen, { attributes: true, attributeFilter: ["class"] });

  // ----------------------------------------------------------------
  // Incoming state
  // ----------------------------------------------------------------
  socket.on("poker:state", (s) => {
    state = s;
    if (!joined) enterTable();
    // Friend tables get their own chat channel; solo bot tables stay on global.
    if (window.Casino.chat && state.code && !state.vsBots)
      window.Casino.chat.enterLobby(state.code);
    render();
  });

  socket.on("poker:error", ({ message }) => toast(message));

  // ----------------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------------
  function cardEl(card, faceDown) {
    const d = document.createElement("div");
    d.className = "card" + (faceDown ? " back" : "");
    if (faceDown || !card) return d;
    const red = card.suit === "h" || card.suit === "d";
    d.classList.toggle("red", red);
    d.innerHTML = `<span class="cr">${rankLabel(card.rank)}</span><span class="cs">${SUIT[card.suit]}</span>`;
    return d;
  }

  function render() {
    if (!state) return;
    $("#table-code").textContent = state.code;

    // Pot & board
    $("#pot").textContent = state.pot > 0 ? `Pot: ${state.pot.toLocaleString("de-DE")} 🪙` : "";
    const board = $("#board");
    board.innerHTML = "";
    state.board.forEach((c) => board.appendChild(cardEl(c, false)));

    renderSeats();
    renderBanner();
    renderControls();
    renderLog();
  }

  function renderSeats() {
    // Remove old seat nodes
    felt.querySelectorAll(".seat").forEach((n) => n.remove());

    const me = state.yourSeat;
    for (let i = 0; i < state.maxSeats; i++) {
      const seat = state.seats[i];
      // Visual slot: rotate so the viewer (if seated) sits at the bottom.
      const slotIndex = me >= 0 ? (i - me + state.maxSeats) % state.maxSeats : i;
      const [left, top] = SLOTS[slotIndex];

      const el = document.createElement("div");
      el.className = "seat";
      el.style.left = left + "%";
      el.style.top = top + "%";

      if (!seat) {
        el.classList.add("empty");
        el.innerHTML = `<div class="seat-empty">Frei</div>`;
        felt.appendChild(el);
        continue;
      }

      if (seat.isTurn) el.classList.add("active-turn");
      if (seat.folded) el.classList.add("folded");
      const isWinner =
        state.lastResult &&
        state.lastResult.winners.some((w) => w.name === seat.name) &&
        !state.handActive;
      if (isWinner) el.classList.add("winner");

      // Hole cards (your own face-up, others face-down unless revealed)
      let cardsHtml = "";
      if (seat.hole) {
        cardsHtml = '<div class="hole">' +
          seat.hole.map((c) => {
            const red = c.suit === "h" || c.suit === "d";
            return `<div class="card mini ${red ? "red" : ""}"><span class="cr">${rankLabel(c.rank)}</span><span class="cs">${SUIT[c.suit]}</span></div>`;
          }).join("") + "</div>";
      } else if (seat.hasCards) {
        cardsHtml = '<div class="hole"><div class="card mini back"></div><div class="card mini back"></div></div>';
      }

      const reveal = state.lastResult && state.lastResult.reveals.find((r) => r.name === seat.name);
      const handName = reveal && !state.handActive ? `<div class="hand-name">${reveal.handName}</div>` : "";

      el.innerHTML =
        cardsHtml +
        `<div class="seat-plate">
           <div class="seat-name">${escapeHtml(seat.name)}${seat.index === me ? " (du)" : ""} ${seat.isButton ? '<span class="btn-chip">D</span>' : ""}</div>
           <div class="seat-chips">${seat.chips.toLocaleString("de-DE")} 🪙${seat.allIn ? " · All-In" : ""}</div>
         </div>` +
        handName +
        (seat.bet > 0 ? `<div class="seat-bet">${seat.bet.toLocaleString("de-DE")}</div>` : "");

      felt.appendChild(el);
    }
  }

  function renderBanner() {
    const banner = $("#table-banner");
    if (!state.handActive && state.lastResult) {
      const w = state.lastResult.winners.map((x) => `${escapeHtml(x.name)} +${x.amount}`).join(", ");
      banner.innerHTML = `🏆 ${w}`;
      banner.classList.add("show");
    } else if (state.handActive) {
      banner.textContent = state.stageLabel;
      banner.classList.remove("show");
    } else {
      banner.textContent = "";
      banner.classList.remove("show");
    }
  }

  // ----------------------------------------------------------------
  // Controls (buy-in / start / actions)
  // ----------------------------------------------------------------
  function renderControls() {
    const c = $("#table-controls");
    c.innerHTML = "";
    const seated = state.yourSeat !== -1;

    if (!seated) {
      const acc = getAccount();
      const max = acc ? acc.chips : 0;
      const def = Math.min(max, state.bigBlind * 50);
      c.innerHTML = `
        <div class="buyin">
          <span>Platz nehmen — Buy-in:</span>
          <input id="buyin-input" type="number" min="${state.bigBlind}" max="${max}" value="${def}" />
          <button class="btn-primary" id="sit-btn">Setzen</button>
        </div>
        <div class="muted small">Dein Bank-Guthaben: ${max.toLocaleString("de-DE")} 🪙</div>`;
      $("#sit-btn").addEventListener("click", () => {
        const buyIn = parseInt($("#buyin-input").value, 10);
        socket.emit("poker:sit", { buyIn }, (res) => {
          if (!res || !res.ok) toast((res && res.error) || "Konnte nicht sitzen.");
        });
      });
      return;
    }

    // Seated. Action row depends on whose turn it is.
    const myTurn = state.options && state.yourSeat === state.toAct && state.handActive;

    if (myTurn) {
      c.appendChild(buildActionRow(state.options));
    } else if (state.handActive) {
      const who = state.seats[state.toAct];
      const div = document.createElement("div");
      div.className = "waiting-row";
      div.textContent = who ? `Am Zug: ${who.name}…` : "Warte…";
      c.appendChild(div);
    } else {
      // No active hand → start / waiting. Only the lobby leader may start;
      // bot tables (solo) have no leader gate.
      const row = document.createElement("div");
      row.className = "start-row";
      const canIStart = state.vsBots || state.isHost;
      if (state.canStart && canIStart) {
        row.innerHTML = `<button class="btn-primary" id="start-btn">Hand starten</button>`;
      } else if (state.canStart) {
        row.innerHTML = `<span class="muted">Warte auf Anführer${state.hostName ? ` (${state.hostName})` : ""}…</span>`;
      } else {
        row.innerHTML = `<span class="muted">Warte auf Spieler (mind. 2 mit Chips)…</span>`;
      }
      c.appendChild(row);
      const startBtn = $("#start-btn");
      if (startBtn) startBtn.addEventListener("click", () => socket.emit("poker:start"));
    }

    // Stand-up button (always available while seated)
    const stand = document.createElement("button");
    stand.className = "stand-btn";
    stand.textContent = "Aufstehen";
    stand.addEventListener("click", () => socket.emit("poker:stand"));
    c.appendChild(stand);
  }

  function buildActionRow(opts) {
    const wrap = document.createElement("div");
    wrap.className = "action-row";

    const fold = btn("Passen", "act-fold", () => sendAction("fold"));
    wrap.appendChild(fold);

    if (opts.canCheck) {
      wrap.appendChild(btn("Check", "act-check", () => sendAction("check")));
    } else {
      wrap.appendChild(
        btn(`Call ${opts.callAmount.toLocaleString("de-DE")}`, "act-call", () => sendAction("call"))
      );
    }

    // Raise / bet UI (only if the player can put in more than a call)
    if (opts.maxRaiseTo > opts.minRaiseTo - 1 && opts.maxRaiseTo > opts.callAmount) {
      const raiseWrap = document.createElement("div");
      raiseWrap.className = "raise-wrap";
      const min = opts.minRaiseTo;
      const max = opts.maxRaiseTo;
      raiseWrap.innerHTML = `
        <input type="range" id="raise-range" min="${min}" max="${max}" value="${min}" step="${state.bigBlind}" />
        <div class="raise-line">
          <input type="number" id="raise-amount" min="${min}" max="${max}" value="${min}" />
          <button class="act-raise" id="raise-btn">${opts.isBet ? "Setzen" : "Erhöhen"}</button>
        </div>
        <div class="raise-quick">
          <button data-q="pot">Pot</button>
          <button data-q="max">All-In</button>
        </div>`;
      wrap.appendChild(raiseWrap);

      const range = raiseWrap.querySelector("#raise-range");
      const amount = raiseWrap.querySelector("#raise-amount");
      const clamp = (v) => Math.max(min, Math.min(max, Math.floor(v) || min));
      const sync = (v) => {
        v = clamp(v);
        range.value = v;
        amount.value = v;
      };
      range.addEventListener("input", () => sync(range.value));
      // While typing, only move the slider — don't rewrite the field (so a custom
      // amount can be typed freely). Clamp the field once on blur.
      amount.addEventListener("input", () => { range.value = clamp(amount.value); });
      amount.addEventListener("change", () => sync(amount.value));
      raiseWrap.querySelector("#raise-btn").addEventListener("click", () =>
        sendAction("raise", clamp(amount.value))
      );
      raiseWrap.querySelectorAll(".raise-quick button").forEach((b) =>
        b.addEventListener("click", () => {
          if (b.dataset.q === "max") sync(max);
          else sync(Math.min(max, state.pot + opts.toCall)); // pot-sized raise approximation
        })
      );
    }

    return wrap;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function sendAction(action, amount) {
    socket.emit("poker:action", { action, amount });
  }

  function renderLog() {
    const log = $("#table-log");
    log.innerHTML = (state.log || []).map((m) => `<div>${escapeHtml(m)}</div>`).join("");
    log.scrollTop = log.scrollHeight;
  }
})();
