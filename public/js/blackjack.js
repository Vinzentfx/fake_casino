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

  // ---- Audio ----
  // Karten und Chips klingen jetzt im ganzen Haus gleich.
  const snd = window.Casino.sound;
  function sfxCard()  { snd.play("deal"); }
  function sfxWin()   { snd.play("win"); }
  function sfxLose()  { snd.play("lose"); }
  function sfxChip()  { snd.play("chip"); }

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

  /**
   * Einsatz als Chipstapel. Ein Stapel sagt auf einen Blick, ob viel oder
   * wenig im Spiel ist; "Einsatz: 250.000 Chips" muss man erst lesen.
   * Die Farben sind die ueblichen Casino-Werte.
   */
  const CHIP_WERTE = [
    { wert: 1000000, farbe: "#8e44ad" },
    { wert: 250000,  farbe: "#c0392b" },
    { wert: 50000,   farbe: "#2c3e50" },
    { wert: 10000,   farbe: "#27ae60" },
    { wert: 1000,    farbe: "#2980b9" },
    { wert: 100,     farbe: "#ecf0f1" },
  ];
  const MAX_CHIPS = 8; // hoechstens acht Scheiben, sonst wird der Stapel zur Saeule
  function chipStackHTML(betrag) {
    let rest = Math.max(0, Math.floor(betrag) || 0);
    const chips = [];
    for (const c of CHIP_WERTE) {
      while (rest >= c.wert && chips.length < MAX_CHIPS) { chips.push(c.farbe); rest -= c.wert; }
      if (chips.length >= MAX_CHIPS) break;
    }
    if (!chips.length) chips.push(CHIP_WERTE[CHIP_WERTE.length - 1].farbe);
    // Von unten nach oben stapeln: die dicksten Scheiben liegen zuunterst.
    return `<span class="bj-chip-stack">${chips
      .map((f, i) => `<i style="background:${f};bottom:${(chips.length - 1 - i) * 3}px"></i>`)
      .join("")}</span>`;
  }

  function handResult(hand) {
    if (!hand.result) return "";
    const map = { win: "Gewonnen", blackjack: "Blackjack!", push: "Unentschieden", lose: "Verloren", bust: "Überkauft" };
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
          <div class="bj-hand-bet">${chipStackHTML(hand.bet)}<b>${hand.bet.toLocaleString("de-DE")}<i class=mk></i></b></div>
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
    // Nur einmal je Runde feiern: bj:state kommt auch danach noch, etwa
    // wenn ein Mitspieler in der Lobby fertig wird.
    if (s.phase === "done" && (!prev || prev.phase !== "done")) {
      const anyWin = s.playerHands.some(h => h.result === "win" || h.result === "blackjack");
      const allLost = s.playerHands.every(h => h.result === "lose" || h.result === "bust");
      const blackjack = s.playerHands.some(h => h.result === "blackjack");
      // Auszahlung: Gewinn zahlt 2x den Einsatz, Blackjack 2,5x.
      const auszahlung = s.playerHands.reduce((sum, h) => {
        if (h.result === "blackjack") return sum + Math.floor(h.bet * 2.5);
        if (h.result === "win") return sum + h.bet * 2;
        if (h.result === "push") return sum + h.bet;
        return sum;
      }, 0);
      const einsatz = s.playerHands.reduce((sum, h) => sum + h.bet, 0);

      if (blackjack) {
        window.Casino.fx.bigWin(auszahlung, { label: "🃏 Blackjack" });
      } else if (anyWin && auszahlung >= einsatz * 2) {
        // Echter Gewinn (nicht nur eine gepushte Hand): Muenzwurf am Tisch.
        sfxWin();
        window.Casino.fx.coins(document.querySelector(".bj-table"));
      } else if (anyWin) {
        sfxWin();
      } else if (allLost) {
        sfxLose();
      }
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
  const BET_STEPS = [50, 100, 500, 1000, 5000, 10000, 25000, 100000, 250000, 500000, 1000000, 2000000];
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
    [100, 1000, 10000, 50000, 250000, 1000000].forEach(v => {
      const btn = document.createElement("button");
      btn.className = "bj-chip-btn";
      btn.textContent = v >= 1e6 ? (v/1e6) + "M" : v >= 1000 ? (v/1000) + "k" : v;
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
    socket.emit("bj:init");
    setupChipButtons();
  }

  // Ruft der Router auf, wenn der Blackjack-Screen aufgeht.
  window.Casino._loadBlackjack = onEnterBlackjack;

  /*
   * Knoepfe genau einmal verdrahten.
   *
   * Hier stand beides untereinander: ein DOMContentLoaded-Listener und
   * darunter derselbe Block nochmal, "falls DOMContentLoaded schon durch
   * ist". Das Skript laedt aber mit `defer`, und dann ist der Zustand
   * "interactive" (also nicht mehr "loading"), WAEHREND DOMContentLoaded
   * noch aussteht. Beide Zweige liefen, jeder Knopf war doppelt verdrahtet,
   * und ein Tipp auf "Karte" zog zwei Karten.
   *
   * Dieselbe if/else-Form benutzen blackjackLobby.js, pinco.js und
   * rouletteLobby.js, dort war es von Anfang an richtig.
   */
  function wire() {
    $("bj-btn-deal")   ?.addEventListener("click", doDeal);
    $("bj-btn-hit")    ?.addEventListener("click", () => doAction("hit"));
    $("bj-btn-stand")  ?.addEventListener("click", () => doAction("stand"));
    $("bj-btn-double") ?.addEventListener("click", () => doAction("double"));
    $("bj-btn-split")  ?.addEventListener("click", () => doAction("split"));
    $("bj-btn-again")  ?.addEventListener("click", doDeal);
    $("bj-bet-up")     ?.addEventListener("click", () => stepBet(1));
    $("bj-bet-down")   ?.addEventListener("click", () => stepBet(-1));
    setupChipButtons();
  }

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire, { once: true });

})();
