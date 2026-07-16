"use strict";

/* ============================================================
   Fake Casino – Towers (Dragon Tower, client).
   Climb the tower: pick a safe tile (🥚) each level to raise the
   multiplier, avoid the traps (💀). Cash out any time.
   Server-authoritative (game/towers.js); this only renders.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  // Client-side difficulty configs (width, safe) — nur für die Vorschau-Leiter;
  // die echten Werte kommen server-seitig identisch mit (Stake-exakt, RTP 98%).
  const DIFFS = [
    { key: "easy", label: "Einfach", w: 4, s: 3 },
    { key: "medium", label: "Mittel", w: 3, s: 2 },
    { key: "hard", label: "Schwer", w: 2, s: 1 },
    { key: "expert", label: "Experte", w: 3, s: 1 },
    { key: "master", label: "Meister", w: 4, s: 1 },
  ];
  const ROWS = 9;
  let diffKey = "easy";
  let game = null;

  const cfg = (k) => DIFFS.find((d) => d.key === k);
  function clientLadder(k) {
    const d = cfg(k), out = [];
    for (let l = 1; l <= ROWS; l++) out.push(Math.max(1, Math.floor(Math.pow(d.w / d.s, l) * 0.98 * 100) / 100));
    return out;
  }
  function previewView() {
    const d = cfg(diffKey);
    return { width: d.w, safe: d.s, rows: ROWS, level: 0, picks: [], over: false, ladder: clientLadder(diffKey), preview: true };
  }

  function renderDiffs() {
    const box = $("#tw-diffs");
    if (!box) return;
    box.innerHTML = DIFFS.map((d) => {
      const pct = Math.round((100 * d.s) / d.w);
      return `<button class="tw-diff${d.key === diffKey ? " active" : ""}" data-diff="${d.key}">${d.label}<span>${pct}% sicher</span></button>`;
    }).join("");
    box.querySelectorAll(".tw-diff").forEach((b) =>
      b.addEventListener("click", () => {
        diffKey = b.dataset.diff;
        renderDiffs();
        if (!game || game.over) renderBoard(previewView());
      })
    );
  }

  function setActive(active) {
    $("#tw-setup").style.display = active ? "none" : "";
    $("#tw-cashout").style.display = active ? "" : "none";
  }

  function renderTop(v) {
    $("#tw-mult").textContent = (v.multiplier || 1).toFixed(2) + "×";
    $("#tw-cashval").textContent = v.cashout ? fmt(v.cashout) + " 🪙" : "—";
    $("#tw-next").textContent = v.nextMultiplier ? v.nextMultiplier.toFixed(2) + "×" : "—";
    const btn = $("#tw-cashout");
    btn.textContent = v.cashout ? `💸 Auszahlen — ${fmt(v.cashout)} 🪙 (${v.multiplier.toFixed(2)}×)` : "💸 Auszahlen";
    btn.disabled = !v.cashout;
  }

  // Zeichnet den Turm aus einer Server-View. Reihen oben (Ebene 9) → unten (Ebene 1).
  // fx: { pop:{row,tile} } markiert die frisch aufgedeckte Kachel für die Animation.
  function renderBoard(v, fx = {}) {
    const board = $("#tw-board");
    const width = v.width;
    board.innerHTML = "";
    for (let disp = v.rows - 1; disp >= 0; disp--) { // disp = Reihenindex (0 = unten)
      const rowEl = document.createElement("div");
      rowEl.className = "tw-row";
      const climbed = disp < v.level;
      const active = disp === v.level && !v.over && !v.preview;
      const future = disp > v.level && !v.over && !v.preview;
      if (active) rowEl.classList.add("active");
      if (future) rowEl.classList.add("future");
      if (climbed) rowEl.classList.add("climbed");

      const mlab = document.createElement("span");
      mlab.className = "tw-mult-lab";
      mlab.textContent = "×" + (v.ladder[disp] || 1).toFixed(2);
      rowEl.appendChild(mlab);

      const tilesEl = document.createElement("div");
      tilesEl.className = "tw-tiles";
      for (let t = 0; t < width; t++) {
        const b = document.createElement("button");
        b.className = "tw-tile";
        const isTrap = v.trapLayout && v.trapLayout[disp] && v.trapLayout[disp].includes(t);
        if (climbed) {
          b.disabled = true;
          if (v.picks[disp] === t) { b.classList.add("egg"); b.textContent = "🥚"; }
          else if (v.trapLayout) { b.classList.add(isTrap ? "trap" : "safe-dim"); b.textContent = isTrap ? "💀" : "🥚"; }
          else b.classList.add("covered");
        } else if (active) {
          b.addEventListener("click", () => pick(t));
        } else {
          b.disabled = true;
          if (v.over && v.trapLayout) { b.classList.add(isTrap ? "trap" : "safe-dim"); b.textContent = isTrap ? "💀" : "🥚"; }
        }
        if (v.over && v.bust && disp === v.row && t === v.tile) b.classList.add("boom");
        if (fx.pop && disp === fx.pop.row && t === fx.pop.tile) b.classList.add("pop");
        tilesEl.appendChild(b);
      }
      rowEl.appendChild(tilesEl);
      if (active) {
        const dragon = document.createElement("span");
        dragon.className = "tw-dragon";
        dragon.textContent = "🐉";
        rowEl.appendChild(dragon);
      }
      board.appendChild(rowEl);
    }
  }

  function apply(v) {
    const prev = game;
    game = v;
    renderTop(v.bust ? { ...v, cashout: 0, nextMultiplier: null } : v);
    if (v.bust) { $("#tw-cashval").textContent = "verloren"; $("#tw-next").textContent = "—"; }
    // Frisch aufgedeckte Kachel für die Pop-Animation ermitteln.
    const fx = {};
    if (prev && !prev.over && v.level > prev.level) fx.pop = { row: v.level - 1, tile: v.picks[v.level - 1] };
    renderBoard(v, fx);
    const board = $("#tw-board");
    if (v.over) {
      setActive(false);
      if (v.account) applyAccount(v.account);
      if (v.bust) {
        board.classList.add("tw-bust");
        setTimeout(() => board.classList.remove("tw-bust"), 900);
        toast("💀 Falle erwischt! Einsatz weg.");
      } else if (v.cashedOut || v.cleared) {
        board.classList.add("tw-win");
        const float = document.createElement("div");
        float.className = "tw-float";
        float.textContent = `+${fmt(v.payout)} 🪙`;
        board.appendChild(float);
        setTimeout(() => { board.classList.remove("tw-win"); float.remove(); }, 1600);
        toast(v.cleared ? `🏆 Turm bezwungen! +${fmt(v.payout)} 🪙` : `💸 +${fmt(v.payout)} 🪙 (${v.mult.toFixed(2)}×)!`);
      }
    } else setActive(true);
  }

  function pick(t) {
    if (!game || game.over) return;
    socket.emit("towers:pick", { tile: t }, (v) => {
      if (!v || !v.ok) { $("#tw-error").textContent = (v && v.error) || "Fehler."; return; }
      apply(v);
    });
  }

  $("#tw-start").addEventListener("click", () => {
    const err = $("#tw-error"); err.textContent = "";
    const bet = parseInt($("#tw-amount").value, 10);
    if (!Number.isFinite(bet) || bet < 50) { err.textContent = "Mindestens 50 🪙."; return; }
    if (bet > 50000) { err.textContent = "Maximaleinsatz 50.000 🪙."; return; }
    socket.emit("towers:start", { bet, difficulty: diffKey }, (v) => {
      if (!v || !v.ok) { err.textContent = (v && v.error) || "Fehler."; return; }
      if (v.account) applyAccount(v.account);
      apply(v);
    });
  });

  $("#tw-cashout").addEventListener("click", () => {
    socket.emit("towers:cashout", (v) => {
      if (!v || !v.ok) { $("#tw-error").textContent = (v && v.error) || "Fehler."; return; }
      apply(v);
    });
  });

  window.Casino._loadTowers = () => {
    renderDiffs();
    // Läuft server-seitig noch ein Spiel (z.B. nach Tab-Reload)? → fortsetzen.
    socket.emit("towers:state", (v) => {
      if (v && v.ok && !v.none) { diffKey = v.difficulty || diffKey; renderDiffs(); apply(v); return; }
      if (!game || game.over) {
        game = null;
        $("#tw-error").textContent = "";
        setActive(false);
        renderTop({ multiplier: 1, cashout: 0, nextMultiplier: null });
        renderBoard(previewView());
      }
    });
  };
})();
