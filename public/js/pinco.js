"use strict";

/* ============================================================
   Fake Casino – Pinco Ball (Plinko) client.
   Server decides the fair drop path (game/pinco.js); the client
   runs a REAL physics animation — gravity per frame, the ball
   bounces off each peg, steered to the server's decided slot.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const DEFAULT_BALL = "#4ade80";

  let boards = {
    medium: { label: "Mittel", rows: 10, multipliers: [7.33, 2.74, 1.57, 1.11, 0.84, 0.70, 0.84, 1.11, 1.57, 2.74, 7.33] },
    large: { label: "Groß", rows: 14, multipliers: [15.23, 6.41, 3.20, 2.05, 1.33, 0.96, 0.81, 0.70, 0.81, 0.96, 1.33, 2.05, 3.20, 6.41, 15.23] },
  };
  let selectedSize = "medium";
  let roomCode = null;
  let drops = [];
  let balls = [];          // active physics balls
  let particles = [];      // landing bursts
  const pegHits = new Map(); // "r,i" → timestamp of last hit (for flash)
  const bucketFlash = [];  // per-bucket flash timestamps
  let looping = false;
  let ballSeq = 0;
  let lastT = 0;

  const canvas = () => $("#pinco-canvas");
  const ctx = () => canvas().getContext("2d");
  const board = () => boards[selectedSize] || boards.medium;

  function setError(msg) { const el = $("#pinco-error"); if (el) el.textContent = msg || ""; }

  function fitCanvas() {
    const c = canvas();
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.floor(rect.width * dpr));
    const h = Math.max(300, Math.floor(rect.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // Peg geometry. Row r has r+2 pegs; buckets = rows+1.
  function geom(b = board()) {
    const c = canvas();
    const w = c.width, h = c.height;
    const top = h * 0.13;
    const bottom = h * 0.82;
    const rowGap = (bottom - top) / b.rows;
    const xGap = w / (b.rows + 3);
    const pegR = Math.max(2.5, w * 0.006);
    const ballR = Math.max(6, xGap * 0.28);
    return { w, h, top, bottom, rowGap, xGap, pegR, ballR };
  }
  function pegXY(r, i, gm) {
    const count = r + 2;
    const start = gm.w / 2 - ((count - 1) * gm.xGap) / 2;
    return { x: start + i * gm.xGap, y: gm.top + r * gm.rowGap };
  }

  // Build a real-physics ball from a server drop (path = left/right per row).
  function makeBall(drop) {
    const b = boards[drop.size] || board();
    const gm = geom(b);
    // Contact x per row (peg the ball hits), from the decided path.
    const contact = [gm.w / 2];
    for (let r = 0; r < b.rows; r++) contact.push(contact[r] + (drop.path[r] ? 0.5 : -0.5) * gm.xGap);
    const slotGap = gm.w / b.multipliers.length;
    const bucketX = slotGap * (drop.slot + 0.5);
    const floorY = gm.bottom + gm.rowGap * 1.15;
    // Gravity tuned so one row-fall ≈ 0.16s → resolution independent.
    const g = (2 * gm.rowGap) / (0.16 * 0.16);
    const bounceUp = Math.sqrt(2 * g * gm.rowGap * 0.34);
    return {
      drop, b, gm, contact, bucketX, floorY, g, bounceUp,
      color: drop.color || DEFAULT_BALL,
      seq: ballSeq++,
      x: gm.w / 2 + (Math.random() - 0.5) * gm.xGap * 0.35,
      y: gm.top - gm.rowGap * 1.1,
      vx: 0, vy: 0,
      row: 0,               // next peg row to resolve
      trail: [],
      settled: false, settleBounces: 0,
      done: false,
    };
  }

  function timeToReach(vy0, g, dist) {
    const disc = vy0 * vy0 + 2 * g * dist;
    if (disc <= 0) return 0.0001;
    return (-vy0 + Math.sqrt(disc)) / g;
  }

  function stepBall(ball, dt) {
    const gm = ball.gm;
    ball.vy += ball.g * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Trail
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 9) ball.trail.shift();

    if (ball.row < ball.b.rows) {
      const rowY = gm.top + ball.row * gm.rowGap;
      if (ball.y >= rowY && ball.vy > 0) {
        // Hit the peg on this row → pop up + steer toward next contact point.
        ball.y = rowY;
        const targetX = ball.contact[ball.row + 1];
        ball.vy = -ball.bounceUp * (0.9 + Math.random() * 0.2);
        const tFall = timeToReach(ball.vy, ball.g, gm.rowGap);
        ball.vx = (targetX - ball.x) / tFall;
        // Flash the nearest peg in this row.
        const count = ball.row + 2;
        const start = gm.w / 2 - ((count - 1) * gm.xGap) / 2;
        let best = 0, bd = 1e9;
        for (let i = 0; i < count; i++) { const px = start + i * gm.xGap; const d = Math.abs(px - ball.x); if (d < bd) { bd = d; best = i; } }
        pegHits.set(ball.row + "," + best, performance.now());
        ball.squash = performance.now();
        ball.row++;
      }
    } else if (!ball.settled) {
      // Past the last peg: steer to the bucket centre and settle on the floor.
      const targetX = ball.bucketX;
      ball.vx += (targetX - ball.x) * 6 * dt; // gentle horizontal pull
      ball.vx *= 0.9;
      if (ball.y >= ball.floorY) {
        ball.y = ball.floorY;
        ball.settleBounces++;
        if (ball.settleBounces === 1) {
          // Landed: flash bucket + particle burst + status.
          bucketFlash[ball.drop.slot] = performance.now();
          burst(ball.bucketX, ball.floorY, ball.color, 18);
          $("#pinco-status").innerHTML = dropStatus(ball.drop);
        }
        if (ball.bounceUp * Math.pow(0.45, ball.settleBounces) < gm.rowGap * 0.08 || ball.settleBounces > 4) {
          ball.settled = true; ball.done = true; ball.vy = 0;
        } else {
          ball.vy = -ball.bounceUp * Math.pow(0.45, ball.settleBounces);
          ball.vx *= 0.5;
        }
      }
    }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 220;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 1, color });
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function heatColor(mult) {
    // center (mult≈0.5) cold blue → 1 neutral → high mult hot gold/red.
    if (mult >= 5) return "#ff5a3c";
    if (mult >= 2) return "#ff9d3c";
    if (mult >= 1.2) return "#f4d24a";
    if (mult >= 1) return "#7fd79a";
    if (mult >= 0.8) return "#5aa0e0";
    return "#4a6f8a";
  }

  function draw(now) {
    fitCanvas();
    const c = canvas(), g = ctx(), b = board(), gm = geom(b);
    const w = gm.w, h = gm.h;
    g.clearRect(0, 0, w, h);

    // soft top glow (drop zone)
    const glow = g.createRadialGradient(w / 2, gm.top * 0.4, 0, w / 2, gm.top * 0.4, w * 0.5);
    glow.addColorStop(0, "rgba(120,200,255,0.10)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);

    // Pegs (glow + hit flash)
    for (let r = 0; r < b.rows; r++) {
      const count = r + 2;
      for (let i = 0; i < count; i++) {
        const p = pegXY(r, i, gm);
        const hit = pegHits.get(r + "," + i);
        const flash = hit ? Math.max(0, 1 - (now - hit) / 260) : 0;
        const rad = gm.pegR * (1 + flash * 1.1);
        if (flash > 0) {
          g.beginPath(); g.arc(p.x, p.y, rad * 3.2, 0, Math.PI * 2);
          g.fillStyle = `rgba(255,255,255,${0.18 * flash})`; g.fill();
        }
        g.beginPath(); g.arc(p.x, p.y, rad, 0, Math.PI * 2);
        g.fillStyle = flash > 0 ? "#ffffff" : "rgba(200,220,255,0.55)";
        g.shadowColor = "rgba(150,190,255,0.6)"; g.shadowBlur = 6 + flash * 10;
        g.fill(); g.shadowBlur = 0;
      }
    }

    // Buckets
    const slotGap = w / b.multipliers.length;
    const by = gm.bottom + gm.rowGap * 0.65;
    const bh = h - by - 4;
    for (let i = 0; i < b.multipliers.length; i++) {
      const m = b.multipliers[i];
      const col = heatColor(m);
      const [rr, gg, bb] = hexToRgb(col);
      const fl = bucketFlash[i] ? Math.max(0, 1 - (now - bucketFlash[i]) / 500) : 0;
      const x = i * slotGap + 2, ww = slotGap - 4;
      const grad = g.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, `rgba(${rr},${gg},${bb},${0.95})`);
      grad.addColorStop(1, `rgba(${rr},${gg},${bb},${0.62})`);
      g.fillStyle = grad;
      roundRect(g, x, by - fl * 6, ww, bh + fl * 6, Math.min(7, ww * 0.25)); g.fill();
      if (fl > 0) { g.fillStyle = `rgba(255,255,255,${0.5 * fl})`; roundRect(g, x, by - fl * 6, ww, bh + fl * 6, Math.min(7, ww * 0.25)); g.fill(); }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, 3.2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // Balls (trail + squash + glow)
    for (const ball of balls) {
      for (let t = 0; t < ball.trail.length; t++) {
        const tp = ball.trail[t], a = (t / ball.trail.length) * 0.28;
        g.globalAlpha = a; g.fillStyle = ball.color;
        g.beginPath(); g.arc(tp.x, tp.y, gm.ballR * (0.4 + 0.5 * t / ball.trail.length), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      const sq = ball.squash ? Math.max(0, 1 - (now - ball.squash) / 130) : 0;
      const sx = 1 + sq * 0.35, sy = 1 - sq * 0.3;
      g.save(); g.translate(ball.x, ball.y); g.scale(sx, sy);
      const rg = g.createRadialGradient(-gm.ballR * 0.3, -gm.ballR * 0.35, gm.ballR * 0.2, 0, 0, gm.ballR);
      rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.35, ball.color); rg.addColorStop(1, shade(ball.color, -0.35));
      g.fillStyle = rg; g.shadowColor = ball.color; g.shadowBlur = 16;
      g.beginPath(); g.arc(0, 0, gm.ballR, 0, Math.PI * 2); g.fill();
      g.restore(); g.shadowBlur = 0;
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  function loop(now) {
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000; lastT = now;
    dt = Math.min(dt, 0.032);
    // substep for stable collisions
    const steps = 2;
    for (const ball of balls) for (let s = 0; s < steps && !ball.done; s++) stepBall(ball, dt / steps);
    balls = balls.filter((b) => !b.done);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.1;
      if (p.life <= 0) particles.splice(i, 1);
    }
    draw(now);
    if (balls.length || particles.length) requestAnimationFrame(loop);
    else { looping = false; lastT = 0; draw(now); }
  }
  function startLoop() { if (!looping) { looping = true; lastT = 0; requestAnimationFrame(loop); } }

  function animateDrop(drop) {
    if (!drop || !Array.isArray(drop.path)) return;
    setSize(drop.size);
    balls.push(makeBall(drop));
    startLoop();
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  function renderMultipliers() {
    const b = board(), box = $("#pinco-mults");
    if (!box) return;
    box.style.gridTemplateColumns = `repeat(${b.multipliers.length}, 1fr)`;
    box.innerHTML = b.multipliers.map((m) => `<div class="pinco-mult" style="--c:${heatColor(m)}">${m}×</div>`).join("");
  }
  function renderFeed() {
    const box = $("#pinco-feed");
    if (!box) return;
    if (!drops.length) { box.innerHTML = '<p class="muted small">Noch keine Drops.</p>'; return; }
    box.innerHTML = drops.slice(0, 18).map((d) => {
      const cls = d.net >= 0 ? "pos" : "neg", sign = d.net >= 0 ? "+" : "-", color = d.color || DEFAULT_BALL;
      return `<div class="pinco-feed-row"><span><i class="pinco-dot" style="background:${escapeHtml(color)};color:${escapeHtml(color)}"></i><b>${escapeHtml(d.name)}</b> · ${fmt(d.bet)} 🪙 · ${d.multiplier}×</span><span class="${cls}">${sign}${fmt(Math.abs(d.net))} 🪙</span></div>`;
    }).join("");
  }
  function renderRoom(state) {
    const panel = $("#pinco-lobby-panel");
    if (panel) panel.classList.toggle("hidden", !roomCode);
    $("#pinco-lobby-code").textContent = roomCode || "----";
    const box = $("#pinco-room");
    if (!box || !state) return;
    box.innerHTML = (state.players || []).map((p) => {
      const cls = p.net >= 0 ? "pos" : "neg", sign = p.net >= 0 ? "+" : "-", color = p.color || DEFAULT_BALL;
      return `<div class="pinco-player" style="border-color:${escapeHtml(color)}55"><span><i class="pinco-dot" style="background:${escapeHtml(color)};color:${escapeHtml(color)}"></i>${escapeHtml(p.name)} <small class="muted">${p.drops} Drops</small></span><b class="${cls}">${sign}${fmt(Math.abs(p.net))}</b></div>`;
    }).join("");
    if (Array.isArray(state.history)) {
      drops = state.history.concat(drops.filter((d) => !state.history.some((h) => h.id === d.id))).slice(0, 24);
      renderFeed();
    }
  }
  function setSize(size) {
    if (!boards[size]) return;
    selectedSize = size;
    document.querySelectorAll(".pinco-size").forEach((b) => b.classList.toggle("active", b.dataset.size === size));
    const ro = $("#pinco-mode-readout"); if (ro) ro.value = boards[size].label;
    renderMultipliers();
    draw(performance.now());
  }
  function dropStatus(drop) {
    const cls = drop.net >= 0 ? "pos" : "neg", sign = drop.net >= 0 ? "+" : "-";
    return `${escapeHtml(drop.name)} landet auf <b>${drop.multiplier}×</b> · <span class="${cls}">${sign}${fmt(Math.abs(drop.net))} 🪙</span>`;
  }

  function dropBall() {
    setError("");
    const bet = parseInt($("#pinco-bet").value, 10);
    socket.emit("pinco:drop", { size: selectedSize, bet }, (res) => {
      if (!res || !res.ok) { setError((res && res.error) || "Fehler."); return; }
      if (res.account) applyAccount(res.account);
      if (!roomCode && res.drop) {
        drops.unshift(res.drop); drops = drops.slice(0, 24); renderFeed();
        animateDrop(res.drop);
      }
    });
  }
  function createLobby() {
    socket.emit("pinco:create", (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Lobby konnte nicht erstellt werden."); return; }
      roomCode = res.code; drops = []; renderFeed();
      $("#pinco-status").textContent = `Lobby ${roomCode} eröffnet.`;
      if (window.Casino.chat) window.Casino.chat.enterLobby(roomCode);
    });
  }
  function joinLobby(code) {
    socket.emit("pinco:join", { code }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Lobby nicht gefunden."); return; }
      roomCode = res.code; drops = []; renderFeed();
      $("#pinco-status").textContent = `Lobby ${roomCode} beigetreten.`;
      if (window.Casino.chat) window.Casino.chat.enterLobby(roomCode);
    });
  }
  function leaveLobby() {
    socket.emit("pinco:leave"); roomCode = null; renderRoom(null);
    $("#pinco-room").innerHTML = ""; $("#pinco-status").textContent = "Lobby verlassen.";
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  socket.on("pinco:room", (state) => { if (!state || !state.code) return; roomCode = state.code; renderRoom(state); });
  socket.on("pinco:drop", (drop) => {
    if (!drop || !drop.id) return;
    if (!drops.some((d) => d.id === drop.id)) drops.unshift(drop);
    drops = drops.slice(0, 24); renderFeed(); animateDrop(drop);
  });

  function wire() {
    $("#pinco-drop")?.addEventListener("click", dropBall);
    $("#pinco-create")?.addEventListener("click", createLobby);
    $("#pinco-leave")?.addEventListener("click", leaveLobby);
    document.querySelectorAll(".pinco-size").forEach((b) => b.addEventListener("click", () => setSize(b.dataset.size)));
    window.addEventListener("resize", () => draw(performance.now()));
    const screen = document.querySelector('[data-screen="pinco"]');
    if (screen) new MutationObserver(() => { if (roomCode && !screen.classList.contains("active")) leaveLobby(); }).observe(screen, { attributes: true, attributeFilter: ["class"] });
  }

  window.Casino._loadPinco = () => {
    socket.emit("pinco:config", (res) => {
      if (res && res.ok) {
        boards = res.boards || boards;
        $("#pinco-bet").min = res.minBet || 50;
        $("#pinco-bet").max = res.maxBet || 100000;
      }
      setSize(selectedSize);
      renderRoom(roomCode ? { code: roomCode, players: [], history: drops } : null);
    });
  };
  window.Casino._pincoJoinCode = (code) => { window.Casino.showScreen("pinco"); joinLobby(code); };

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
