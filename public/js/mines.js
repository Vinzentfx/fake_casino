"use strict";

/* ============================================================
   Fake Casino – Mines (client).
   Reveal safe tiles (💎) to climb the multiplier; avoid bombs
   (💣). Cash out any time. Server-authoritative.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  const TILES = 25;
  let game = null; // { revealed:[], over } mirror of last server view

  function buildGrid() {
    const grid = $("#mines-grid");
    if (grid.childElementCount === TILES) return;
    grid.innerHTML = "";
    for (let i = 0; i < TILES; i++) {
      const b = document.createElement("button");
      b.className = "mine-tile";
      b.dataset.tile = i;
      b.addEventListener("click", () => reveal(i));
      grid.appendChild(b);
    }
  }

  function setActive(active) {
    $("#mines-setup").style.display = active ? "none" : "";
    $("#mines-cashout").style.display = active ? "" : "none";
  }

  function renderTop(v) {
    $("#mines-mult").textContent = (v.multiplier || 1).toFixed(2) + "×";
    $("#mines-cashval").textContent = v.cashout ? fmt(v.cashout) + " 🪙" : "—";
    $("#mines-next").textContent = v.nextMultiplier ? v.nextMultiplier.toFixed(2) + "×" : "—";
    if (v.cashout) $("#mines-cashout").textContent = `💸 Auszahlen — ${fmt(v.cashout)} 🪙 (${(v.multiplier).toFixed(2)}×)`;
    else $("#mines-cashout").textContent = "💸 Auszahlen";
    $("#mines-cashout").disabled = !v.cashout;
  }

  function paint(v) {
    const tiles = $("#mines-grid").children;
    for (let i = 0; i < TILES; i++) {
      const t = tiles[i];
      t.className = "mine-tile";
      t.textContent = "";
      t.disabled = !!v.over;
    }
    for (const idx of v.revealed || []) { tiles[idx].classList.add("gem"); tiles[idx].textContent = "💎"; }
    if (v.over && v.mineSet) {
      for (const idx of v.mineSet) {
        if (!tiles[idx].classList.contains("gem")) { tiles[idx].classList.add("bomb"); tiles[idx].textContent = "💣"; }
      }
      if (v.bust && v.tile != null) tiles[v.tile].classList.add("boom");
    }
  }

  function apply(v) {
    game = v;
    // On a bust the "cashout" value is meaningless (you lost) — show 0.
    renderTop(v.bust ? { ...v, multiplier: v.multiplier, cashout: 0, nextMultiplier: null } : v);
    if (v.bust) { $("#mines-cashval").textContent = "verloren"; $("#mines-next").textContent = "—"; }
    paint(v);
    if (v.over) {
      setActive(false);
      if (v.account) applyAccount(v.account);
      if (v.bust) toast("💥 Bombe! Einsatz weg.");
      else if (v.cashedOut) toast(`💸 +${fmt(v.payout)} 🪙 (${v.mult.toFixed(2)}×)!`);
      else if (v.cleared) toast(`🏆 Feld leergeräumt! +${fmt(v.payout)} 🪙`);
    } else setActive(true);
  }

  function reveal(i) {
    if (!game || game.over) return;
    if ((game.revealed || []).includes(i)) return;
    socket.emit("mines:reveal", { tile: i }, (v) => {
      if (!v || !v.ok) { $("#mines-error").textContent = (v && v.error) || "Fehler."; return; }
      apply(v);
    });
  }

  $("#mines-start").addEventListener("click", () => {
    const err = $("#mines-error"); err.textContent = "";
    const bet = parseInt($("#mines-amount").value, 10);
    const mines = parseInt($("#mines-count").value, 10);
    if (!Number.isFinite(bet) || bet < 50) { err.textContent = "Mindestens 50 🪙."; return; }
    if (bet > 10000) { err.textContent = "Maximaleinsatz 10.000 🪙."; return; }
    if (!Number.isFinite(mines) || mines < 1 || mines > 24) { err.textContent = "1–24 Minen."; return; }
    socket.emit("mines:start", { bet, mines }, (v) => {
      if (!v || !v.ok) { err.textContent = (v && v.error) || "Fehler."; return; }
      if (v.account) applyAccount(v.account);
      apply(v);
    });
  });

  $("#mines-cashout").addEventListener("click", () => {
    socket.emit("mines:cashout", (v) => {
      if (!v || !v.ok) { $("#mines-error").textContent = (v && v.error) || "Fehler."; return; }
      apply(v);
    });
  });

  window.Casino._loadMines = () => {
    buildGrid();
    // Läuft server-seitig noch ein Spiel (z.B. nach Tab-Reload)? → fortsetzen.
    socket.emit("mines:state", (v) => {
      if (v && v.ok && !v.none) { apply(v); return; }
      if (!game || game.over) {
        $("#mines-error").textContent = "";
        setActive(false);
        const tiles = $("#mines-grid").children;
        for (let i = 0; i < TILES; i++) { tiles[i].className = "mine-tile"; tiles[i].textContent = ""; tiles[i].disabled = false; }
        renderTop({ multiplier: 1, cashout: 0, nextMultiplier: null });
      }
    });
  };
})();
