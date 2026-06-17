"use strict";

/* ============================================================
   Blackjack Client
   Kommuniziert über bj:* Socket-Events mit game/blackjack.js.
   ============================================================ */

(function () {
  const socket = window.Casino.socket;
  const SUIT_COLOR = { h: "red", d: "red", s: "black", c: "black" };
  const SUIT_SYM   = { h: "♥", d: "♦", s: "♠", c: "♣" };
  const RANK_LBL   = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };

  // ---- DOM refs ----
  const screen      = () => document.querySelector('[data-screen="blackjack"]');
  const $ = (id) => document.getElementById(id);

  // ---- State ----
  let state = null;   // last bj:state payload
  let betAmount = 100;
  let soundOn = true;

  // ---- Audio ----
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, dur, type = "sine", vol = 0.18) {
    if (!soundOn) return;
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch {}
  }
  function sfxCard()  { playTone(600, 0.07, "triangle", 0.12); }
  function sfxWin()   { [520,660,800].forEach((f,i) => setTimeout(() => playTone(f, 0.15, "sine", 0.2), i*90)); }
  function sfxLose()  { playTone(220, 0.35, "sawtooth", 0.1); }
  function sfxChip()  { playTone(900, 0.05, "square", 0.08); }

  // ---- Render ----
  function cardHTML(card, faceDown = false) {
    if (faceDown || card.hidden) {
      return `<div class="bj-card face-down"><div class="bj-card-inner"></div></div>`;
    }
    const suit = SUIT_SYM[card.suit] || "?";
    const rank = RANK_LBL[card.rank] || "?";
    const color = SUIT_COLOR[card.suit] === "red" ? "red" : "";
    return `<div class="bj-card ${color}">
      <div class="bj-card-tl">${rank}<br>${suit}</div>
      <div class="bj-card-center">${suit}</div>
      <div class="bj-card-br">${rank}<br>${suit}</div>
    </div>`;
  }

  function handResult(hand) {
    if (!hand.result) return "";
    const map = { win:"✅ Gewonnen", blackjack:"🃏 Blackjack!", push:"🤝 Unentschieden", lose:"❌ Verloren", bust:"💥 Überkauft" };
    return map[hand.result] || hand.result;
  }

  function render(s) {
    if (!s) return;
    state = s;

    // Balance
    window.Casino.setChips(s.balance);

    // Dealer area
    const dArea = $("bj-dealer-cards");
    if (dArea) {
      dArea.innerHTML = s.dealerCards.map(c => cardHTML(c)).join("");
      $("bj-dealer-value").textContent = s.phase === "player"
        ? `${s.dealerValue}+`
        : (s.dealerCards.length ? `${s.dealerValue}` : "");
    }

    // Player hands
    const hArea = $("bj-player-hands");
    if (hArea) {
      hArea.innerHTML = s.playerHands.map((hand, i) => {
        const active = i === s.activeHand && s.phase === "player";
        const res = hand.result ? `<div class="bj-hand-result ${hand.result}">${handResult(hand)}</div>` : "";
        return `<div class="bj-hand ${active ? "active" : ""} ${hand.result || ""}">
          <div class="bj-hand-label">${s.playerHands.length > 1 ? `Hand ${i+1} ` : ""}
            <span class="bj-hand-value">${hand.value}</span>
            ${hand.doubled ? '<span class="bj-badge">×2</span>' : ""}
          </div>
          <div class="bj-cards">${hand.cards.map(c => cardHTML(c)).join("")}</div>
          <div class="bj-hand-bet">Einsatz: <b>${hand.bet.toLocaleString("de-DE")} 🪙</b></div>
          ${res}
        </div>`;
      }).join("");
    }

    // Controls
    renderControls(s);

    // Message
    const msg = $("bj-message");
    if (msg) {
      msg.textContent = s.message || "";
      msg.className = "bj-message" + (s.message ? " show" : "");
    }

    // Bet display
    const bd = $("bj-bet-display");
    if (bd) bd.textContent = betAmount.toLocaleString("de-DE");
  }

  function renderControls(s) {
    const betting = $("bj-betting");
    const actions = $("bj-actions");
    const done    = $("bj-done");
    if (!betting || !actions || !done) return;

    betting.classList.toggle("hidden", s.phase !== "betting" && s.phase !== "done");
    actions.classList.toggle("hidden", s.phase !== "player");
    done.classList.toggle("hidden", s.phase !== "done");

    if (s.phase === "player" && s.playerHands.length > 0) {
      const hand = s.playerHands[s.activeHand] || s.playerHands[0];
      $("bj-btn-double").disabled = !hand.canDouble;
      $("bj-btn-split").disabled  = !hand.canSplit;
    }
  }

  // ---- Socket events ----
  socket.on("bj:state", (s) => {
    const prev = state;
    const wasDealing = !prev || prev.phase === "betting";
    render(s);
    // Sound cues
    if (s.phase === "player" && wasDealing) {
      [0,80,160,240].forEach(t => setTimeout(sfxCard, t));
    }
    if (s.phase === "done") {
      const anyWin = s.playerHands.some(h => h.result === "win" || h.result === "blackjack");
      const allLost = s.playerHands.every(h => h.result === "lose" || h.result === "bust");
      if (anyWin) sfxWin(); else if (allLost) sfxLose();
    }
  });

  // ---- Actions ----
  function doAction(action) {
    socket.emit("bj:action", { action }, (res) => {
      if (res && !res.ok) window.Casino.toast(res.error || "Fehler");
    });
    sfxCard();
  }

  function doDeal() {
    const acc = window.Casino.getAccount();
    if (!acc) return window.Casino.toast("Erst einloggen.");
    if (betAmount > acc.chips) return window.Casino.toast("Nicht genug Chips.");
    socket.emit("bj:deal", { bet: betAmount }, (res) => {
      if (res && !res.ok) window.Casino.toast(res.error || "Fehler");
    });
    sfxChip();
  }

  // ---- Bet controls ----
  const BET_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
  function stepBet(dir) {
    const idx = BET_STEPS.findIndex(v => v >= betAmount);
    let next;
    if (dir > 0) next = BET_STEPS[Math.min(idx + 1, BET_STEPS.length - 1)];
    else         next = BET_STEPS[Math.max(idx - 1, 0)];
    if (next === undefined) next = dir > 0 ? BET_STEPS[BET_STEPS.length - 1] : BET_STEPS[0];
    betAmount = next;
    const bd = $("bj-bet-display");
    if (bd) bd.textContent = betAmount.toLocaleString("de-DE");
    sfxChip();
  }

  // ---- Chip quick-select ----
  let chipsSetup = false;
  function setupChipButtons() {
    const bar = $("bj-chip-bar");
    if (!bar || chipsSetup) return;
    chipsSetup = true;
    [10, 50, 100, 500, 1000, 5000].forEach(v => {
      const btn = document.createElement("button");
      btn.className = "bj-chip-btn";
      btn.textContent = v >= 1000 ? (v/1000) + "k" : v;
      btn.addEventListener("click", () => {
        betAmount = v;
        const bd = $("bj-bet-display");
        if (bd) bd.textContent = betAmount.toLocaleString("de-DE");
        sfxChip();
      });
      bar.appendChild(btn);
    });
  }

  // ---- Init ----
  function onEnterBlackjack() {
    soundOn = localStorage.getItem("casino_sound") !== "off";
    socket.emit("bj:init");
    setupChipButtons();
  }

  // Hook into screen navigation
  const origShow = window.Casino.showScreen.bind(window.Casino);
  window.Casino.showScreen = function (name) {
    origShow(name);
    if (name === "blackjack") onEnterBlackjack();
  };

  // Wire up buttons after DOM is ready
  document.addEventListener("DOMContentLoaded", () => {
    $("bj-btn-deal")   ?.addEventListener("click", doDeal);
    $("bj-btn-hit")    ?.addEventListener("click", () => doAction("hit"));
    $("bj-btn-stand")  ?.addEventListener("click", () => doAction("stand"));
    $("bj-btn-double") ?.addEventListener("click", () => doAction("double"));
    $("bj-btn-split")  ?.addEventListener("click", () => doAction("split"));
    $("bj-btn-again")  ?.addEventListener("click", doDeal);
    $("bj-bet-up")     ?.addEventListener("click", () => stepBet(1));
    $("bj-bet-down")   ?.addEventListener("click", () => stepBet(-1));
    setupChipButtons();
  });

  // Also handle if DOMContentLoaded already fired
  if (document.readyState !== "loading") {
    $("bj-btn-deal")   ?.addEventListener("click", doDeal);
    $("bj-btn-hit")    ?.addEventListener("click", () => doAction("hit"));
    $("bj-btn-stand")  ?.addEventListener("click", () => doAction("stand"));
    $("bj-btn-double") ?.addEventListener("click", () => doAction("double"));
    $("bj-btn-split")  ?.addEventListener("click", () => doAction("split"));
    $("bj-btn-again")  ?.addEventListener("click", doDeal);
    $("bj-bet-up")     ?.addEventListener("click", () => stepBet(1));
    $("bj-bet-down")   ?.addEventListener("click", () => stepBet(-1));
  }

  // Settings sync
  document.addEventListener("change", (e) => {
    if (e.target?.id === "set-sound") soundOn = e.target.checked;
  });
})();
