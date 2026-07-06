"use strict";

/* ============================================================
   Fake Casino – Crash / Aviator (client).
   One shared round for everyone: a rocket climbs with the
   multiplier and explodes at the crash point. Cash out in time!
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let phase = "betting";     // betting | flying | crashed
  let multiplier = 1;        // latest server multiplier
  let dispMult = 1;          // smoothed for display/animation
  let crashPoint = null;
  let myBet = null;          // { amount, cashedAt }
  let bets = [];
  let history = [];
  let msLeft = 0, msLeftAt = 0;

  // ── Rocket canvas ────────────────────────────────────────────────────────
  const canvas = $("#crash-canvas");
  const ctx = canvas && canvas.getContext("2d");
  let boom = 0; // explosion animation frames remaining

  function resize() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  function draw() {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Smooth the displayed multiplier toward the server value.
    dispMult += (multiplier - dispMult) * 0.25;
    const m = phase === "crashed" ? (crashPoint || dispMult) : dispMult;

    // Map multiplier → rocket position on a curved path (log scale).
    const p = Math.min(1, Math.log(Math.max(1, m)) / Math.log(12)); // 1×→0, 12×→1
    const pad = 34;
    const x = pad + p * (w - pad * 2);
    const y = (h - pad) - p * (h - pad * 1.6);

    const flying = phase === "flying";
    const col = flying ? "126,200,255" : "214,90,90";

    // Trail (quadratic curve from launch pad to rocket) — bright & glowing.
    ctx.save();
    ctx.shadowColor = `rgba(${col},0.9)`;
    ctx.shadowBlur = flying ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.quadraticCurveTo(pad + (x - pad) * 0.5, h - pad, x, y);
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    // Fill under the trail.
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.quadraticCurveTo(pad + (x - pad) * 0.5, h - pad, x, y);
    ctx.lineTo(x, h - pad); ctx.closePath();
    ctx.fillStyle = `rgba(${col},0.14)`;
    ctx.fill();

    if (boom > 0) {
      ctx.font = `${54 + (30 - boom) * 4}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.globalAlpha = Math.max(0, boom / 30);
      ctx.fillText("💥", x, y);
      ctx.globalAlpha = 1;
      boom--;
    } else if (phase !== "crashed") {
      // Bright glow halo so the rocket pops against the multiplier text.
      const grd = ctx.createRadialGradient(x, y, 0, x, y, 46);
      grd.addColorStop(0, `rgba(${col},0.6)`);
      grd.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
      // The rocket itself — big, tilted, with a flickering flame.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.6);
      ctx.font = "46px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (flying && Math.random() > 0.3) ctx.fillText("🔥", -20, 18);
      ctx.fillText("🚀", 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  function renderMult() {
    const el = $("#crash-mult");
    if (!el) return;
    const m = phase === "crashed" ? crashPoint : dispMult;
    el.textContent = (m || 1).toFixed(2) + "×";
    el.classList.toggle("crashed", phase === "crashed");
    el.classList.toggle("flying", phase === "flying");
  }
  function renderStatus() {
    const el = $("#crash-status");
    if (!el) return;
    if (phase === "betting") { const s = Math.ceil(Math.max(0, (msLeftAt + msLeft) - Date.now()) / 1000); el.textContent = `Einsätze offen … Start in ${s}s`; }
    else if (phase === "flying") el.textContent = "🚀 Steigt …";
    else el.textContent = `💥 Geplatzt bei ${(crashPoint || 0).toFixed(2)}×`;
  }
  function renderHistory() {
    const el = $("#crash-history");
    if (!el) return;
    el.innerHTML = history.map((c) => `<span class="crash-hchip ${c < 2 ? "lo" : c < 5 ? "mid" : "hi"}">${c.toFixed(2)}×</span>`).join("");
  }
  function renderPlayers() {
    const el = $("#crash-players");
    if (!el) return;
    if (!bets.length) { el.innerHTML = '<p class="muted small" style="margin:0">Noch keine Einsätze.</p>'; return; }
    el.innerHTML = bets.slice().sort((a, b) => (b.won || 0) - (a.won || 0)).map((b) => {
      const state = b.cashedAt ? `<b class="pos">${b.cashedAt.toFixed(2)}× · +${fmt(b.won)}</b>`
        : phase === "crashed" ? `<b class="neg">−${fmt(b.amount)}</b>` : `<span class="muted">${fmt(b.amount)} 🪙 drin</span>`;
      return `<div class="crash-prow"><span>${escapeHtml(b.name)}</span>${state}</div>`;
    }).join("");
  }
  function renderAction() {
    const btn = $("#crash-action");
    if (!btn) return;
    const mine = myBet;
    if (phase === "flying" && mine && !mine.cashedAt) {
      const win = Math.round(mine.amount * dispMult);
      btn.disabled = false; btn.className = "btn-primary crash-cashbtn";
      btn.textContent = `💸 Auszahlen — ${fmt(win)} 🪙 (${dispMult.toFixed(2)}×)`;
    } else if (phase === "betting" && !mine) {
      btn.disabled = false; btn.className = "btn-primary";
      btn.textContent = "🚀 Einsatz setzen";
    } else if (phase === "betting" && mine) {
      btn.disabled = true; btn.className = "btn-primary"; btn.textContent = "✓ Einsatz gesetzt — warte auf Start";
    } else if (mine && mine.cashedAt) {
      btn.disabled = true; btn.className = "btn-primary"; btn.textContent = `✓ Ausgezahlt bei ${mine.cashedAt.toFixed(2)}×`;
    } else {
      btn.disabled = true; btn.className = "btn-primary"; btn.textContent = phase === "flying" ? "Zuschauen …" : "Warte auf Runde";
    }
  }
  function renderAll() { renderMult(); renderStatus(); renderHistory(); renderPlayers(); renderAction(); }

  // Keep the cashout button's live win amount + status ticking.
  setInterval(() => {
    const screen = document.querySelector('[data-screen="crash"]');
    if (!screen || !screen.classList.contains("active")) return;
    if (phase === "flying") renderAction();
    if (phase === "betting") renderStatus();
  }, 120);

  // ── Apply server state ───────────────────────────────────────────────────
  function apply(s) {
    if (!s) return;
    phase = s.phase; bets = s.bets || []; history = s.history || history;
    if (typeof s.multiplier === "number") multiplier = s.multiplier;
    if (s.crashPoint != null) crashPoint = s.crashPoint;
    if (typeof s.msLeft === "number") { msLeft = s.msLeft; msLeftAt = Date.now(); }
    // Track my own bet from the shared list.
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const mine = me && bets.find((b) => b.name.toLowerCase() === me.name.toLowerCase());
    myBet = mine ? { amount: mine.amount, cashedAt: mine.cashedAt } : (phase === "betting" ? null : myBet);
    if (phase === "betting") { crashPoint = null; if (!mine) myBet = null; multiplier = 1; }
    renderAll();
  }

  socket.on("crash:round", apply);
  socket.on("crash:flying", (s) => { apply(s); crashPoint = null; });
  socket.on("crash:tick", (s) => { multiplier = s.multiplier; renderMult(); });
  socket.on("crash:end", (s) => { apply(s); if (boom <= 0) boom = 30; renderAll(); });
  socket.on("crash:cashed", (d) => { if (d && d.auto) toast(`🚀 Auto-Cashout bei ${d.mult.toFixed(2)}× — +${fmt(d.payout)} 🪙!`); });

  // ── Actions ──────────────────────────────────────────────────────────────
  $("#crash-action").addEventListener("click", () => {
    const err = $("#crash-error"); err.textContent = "";
    if (phase === "flying" && myBet && !myBet.cashedAt) {
      socket.emit("crash:cashout", (r) => {
        if (!r || !r.ok) { err.textContent = (r && r.error) || "Zu spät."; return; }
        applyAccount(r.account); myBet.cashedAt = r.mult;
        toast(`💸 Ausgezahlt bei ${r.mult.toFixed(2)}× — +${fmt(r.payout)} 🪙!`);
        renderAll();
      });
      return;
    }
    if (phase !== "betting") { err.textContent = "Warte auf die nächste Runde."; return; }
    const amount = parseInt($("#crash-amount").value, 10);
    const autoRaw = parseFloat($("#crash-auto").value);
    const target = Number.isFinite(autoRaw) && autoRaw >= 1.01 ? autoRaw : null;
    if (!Number.isFinite(amount) || amount < 50) { err.textContent = "Mindestens 50 🪙."; return; }
    socket.emit("crash:bet", { amount, target }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Fehler."; return; }
      applyAccount(r.account);
      myBet = { amount, cashedAt: null };
      toast(target ? `Einsatz gesetzt · Auto @ ${target}×` : "Einsatz gesetzt 🚀");
      renderAll();
    });
  });

  // ── Screen hook ──────────────────────────────────────────────────────────
  window.Casino._loadCrash = () => {
    resize();
    socket.emit("crash:state", (s) => { if (s && s.ok) apply(s); });
    if (!draw._started) { draw._started = true; requestAnimationFrame(draw); }
  };
})();
