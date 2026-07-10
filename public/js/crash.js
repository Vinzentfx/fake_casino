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
  let needBoom = false;   // crash arrived → spawn explosion at rocket position
  let boomAt = null;      // frozen explosion position
  let stars = null;       // parallax star layers
  let parts = [];         // exhaust + explosion particles
  let ring = 0;           // shockwave radius (0 = off)
  let prevWholeMult = 1;  // for the multiplier pulse

  function resize() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = null; // re-seed for the new size
  }
  window.addEventListener("resize", resize);

  function seedStars(w, h) {
    const layer = (n, rMin, rMax, speed) => Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: rMin + Math.random() * (rMax - rMin),
      tw: Math.random() * Math.PI * 2, speed,
    }));
    stars = [layer(60, 0.5, 1.1, 0.35), layer(28, 1.1, 1.8, 0.7), layer(10, 1.8, 2.6, 1.15)];
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  function skyGradient(w, h, p) {
    // Aufstieg: Horizont-Blau → tiefes Weltall, je höher der Multiplikator.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${lerp(10, 3, p) | 0},${lerp(20, 2, p) | 0},${lerp(46, 16, p) | 0})`);
    g.addColorStop(1, `rgb(${lerp(16, 8, p) | 0},${lerp(44, 10, p) | 0},${lerp(78, 30, p) | 0})`);
    return g;
  }

  function spawnExhaust(x, y, ang, boostP) {
    const n = 3 + Math.floor(boostP * 3);
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 0.5;
      const speed = 1.6 + Math.random() * 2.4;
      parts.push({
        x, y,
        vx: -Math.cos(ang + spread) * speed,
        vy: -Math.sin(ang + spread) * speed,
        life: 22 + Math.random() * 18, max: 40,
        r: 1.6 + Math.random() * 2.6, g: 0,
        color: ["#ffffff", "#ffe08a", "#ff9d4d", "#ff5a3c"][(Math.random() * 4) | 0],
      });
    }
  }

  function spawnExplosion(x, y) {
    for (let i = 0; i < 90; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 6.5;
      parts.push({
        x, y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 1.2,
        life: 30 + Math.random() * 34, max: 64,
        r: 1.5 + Math.random() * 3.4, g: 0.09,
        color: ["#ffffff", "#ffd76a", "#ff9d4d", "#ff5a3c", "#c8c8d4"][(Math.random() * 5) | 0],
      });
    }
    ring = 1;
    const stage = $("#crash-stage");
    if (stage) { stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); }
  }

  // Kleiner Vektor-Raketenkörper (Spitze zeigt in +x, wird rotiert).
  function drawRocket(x, y, ang, flying) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const grd = ctx.createLinearGradient(0, -9, 0, 9);
    grd.addColorStop(0, "#f4f8ff"); grd.addColorStop(0.55, "#c9d6ea"); grd.addColorStop(1, "#8fa3c2");
    // Halo
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 44);
    halo.addColorStop(0, flying ? "rgba(126,200,255,0.5)" : "rgba(214,90,90,0.5)");
    halo.addColorStop(1, "rgba(126,200,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fill();
    // Finnen
    ctx.fillStyle = "#ff5a3c";
    ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(-26, -13); ctx.lineTo(-9, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-16, 4); ctx.lineTo(-26, 13); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fill();
    // Rumpf
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.quadraticCurveTo(14, -8, -2, -8);
    ctx.lineTo(-16, -6); ctx.lineTo(-16, 6); ctx.lineTo(-2, 8);
    ctx.quadraticCurveTo(14, 8, 22, 0);
    ctx.closePath(); ctx.fill();
    // Nasenspitze
    ctx.fillStyle = "#ff7a4d";
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.quadraticCurveTo(16, -5, 11, -6); ctx.lineTo(11, 6); ctx.quadraticCurveTo(16, 5, 22, 0); ctx.closePath(); ctx.fill();
    // Cockpit-Fenster
    ctx.fillStyle = "#8fe3ff";
    ctx.shadowColor = "rgba(120,220,255,0.9)"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(2, 0, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function draw() {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!stars) seedStars(w, h);

    // Smooth the displayed multiplier toward the server value.
    dispMult += (multiplier - dispMult) * 0.25;
    const m = phase === "crashed" ? (crashPoint || dispMult) : dispMult;

    // Map multiplier → rocket position on a curved path (log scale).
    const p = Math.min(1, Math.log(Math.max(1, m)) / Math.log(12)); // 1×→0, 12×→1
    const pad = 34;
    const x = pad + p * (w - pad * 2);
    const y = (h - pad) - p * (h - pad * 1.6);
    const flying = phase === "flying";
    // Tangente der Flugkurve → Raketen-Neigung & Triebwerksrichtung.
    const ang = Math.atan2(y - (h - pad), Math.max(1, (x - pad) * 0.5));
    const col = flying ? "126,200,255" : "214,90,90";

    // Himmel + Parallax-Sterne (ziehen beim Steigen schneller nach unten).
    ctx.fillStyle = skyGradient(w, h, p);
    ctx.fillRect(0, 0, w, h);
    const starSpeed = flying ? 0.35 + p * 5 : 0.12;
    for (let li = 0; li < stars.length; li++) {
      for (const s of stars[li]) {
        s.y += starSpeed * s.speed;
        if (s.y > h) { s.y = -2; s.x = Math.random() * w; }
        s.tw += 0.05;
        ctx.globalAlpha = (0.35 + 0.65 * Math.abs(Math.sin(s.tw))) * (0.45 + p * 0.55);
        ctx.fillStyle = li === 2 ? "#cfe6ff" : "#ffffff";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Trail mit Verlaufs-Glow (Startrampe → Rakete).
    if (flying || phase === "crashed") {
      const tg = ctx.createLinearGradient(pad, h - pad, x, y);
      tg.addColorStop(0, `rgba(${col},0)`);
      tg.addColorStop(0.55, `rgba(${col},0.55)`);
      tg.addColorStop(1, `rgba(${col},0.95)`);
      ctx.save();
      ctx.shadowColor = `rgba(${col},0.8)`;
      ctx.shadowBlur = flying ? 16 : 6;
      ctx.beginPath();
      ctx.moveTo(pad, h - pad);
      ctx.quadraticCurveTo(pad + (x - pad) * 0.5, h - pad, x, y);
      ctx.strokeStyle = tg;
      ctx.lineWidth = 4.5; ctx.lineCap = "round"; ctx.stroke();
      ctx.restore();
      // Fläche unter der Kurve.
      ctx.beginPath();
      ctx.moveTo(pad, h - pad);
      ctx.quadraticCurveTo(pad + (x - pad) * 0.5, h - pad, x, y);
      ctx.lineTo(x, h - pad); ctx.closePath();
      ctx.fillStyle = `rgba(${col},0.10)`;
      ctx.fill();
    }

    // Cashout-Marker: kleine Fallschirm-Tags an der Kurve.
    if ((flying || phase === "crashed") && bets.length) {
      ctx.font = "13px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      let shown = 0;
      for (const b of bets) {
        if (!b.cashedAt || b.cashedAt > m || shown >= 6) continue;
        const cp = Math.min(1, Math.log(Math.max(1, b.cashedAt)) / Math.log(12));
        const cx = pad + cp * (w - pad * 2);
        const cy = (h - pad) - cp * (h - pad * 1.6);
        ctx.globalAlpha = 0.85;
        ctx.fillText("🪂", cx - 6, cy - 12);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#bfe0ff";
        ctx.fillText(`${b.name} ${b.cashedAt.toFixed(2)}×`, cx + 10, cy - 12);
        ctx.globalAlpha = 1;
        shown++;
      }
    }

    // Explosion auslösen, sobald das Crash-Event da ist.
    if (needBoom) { needBoom = false; boomAt = { x, y }; spawnExplosion(x, y); }

    // Partikel (Triebwerk + Explosion) — additiv für Neon-Glow.
    if (flying) spawnExhaust(x - Math.cos(ang) * 18, y - Math.sin(ang) * 18, ang, p);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const pt = parts[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += pt.g; pt.life--;
      if (pt.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * (0.5 + pt.life / pt.max), 0, Math.PI * 2); ctx.fill();
    }
    // Schockwellen-Ring der Explosion.
    if (ring > 0 && boomAt) {
      ring += 5;
      const alpha = Math.max(0, 1 - ring / 130);
      if (alpha <= 0) { ring = 0; } else {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#ffd76a";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(boomAt.x, boomAt.y, ring, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Rakete (nach dem Crash übernehmen die Trümmer-Partikel).
    if (phase !== "crashed") drawRocket(x, y, ang, flying);

    // Multiplikator-Puls bei jeder vollen Stufe.
    const whole = Math.floor(dispMult);
    if (flying && whole > prevWholeMult) {
      prevWholeMult = whole;
      const el = $("#crash-mult");
      if (el) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }
    }
    if (!flying) prevWholeMult = 1;

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
    // Eskalations-Stufen: Farbe/Glow ziehen mit dem Multiplikator an.
    const v = phase === "flying" ? (m || 1) : 0;
    el.classList.toggle("t2", v >= 2 && v < 5);
    el.classList.toggle("t5", v >= 5 && v < 10);
    el.classList.toggle("t10", v >= 10);
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
  socket.on("crash:end", (s) => { apply(s); needBoom = true; renderAll(); });
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
