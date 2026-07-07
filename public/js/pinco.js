"use strict";

/* ============================================================
   Fake Casino – Pinco Ball client.
   Server-authoritative drops; canvas only visualizes the decided path.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let boards = {
    medium: { label: "Mittel", rows: 10, multipliers: [7, 2.6, 1.5, 1.05, 0.8, 0.65, 0.8, 1.05, 1.5, 2.6, 7] },
    large: { label: "Groß", rows: 14, multipliers: [14, 6, 3, 1.9, 1.25, 0.9, 0.75, 0.55, 0.75, 0.9, 1.25, 1.9, 3, 6, 14] },
  };
  let selectedSize = "medium";
  let roomCode = null;
  let drops = [];
  let activeBalls = [];
  let animationLoop = false;
  let ballSeq = 0;

  const canvas = () => $("#pinco-canvas");
  const ctx = () => canvas().getContext("2d");
  const board = () => boards[selectedSize] || boards.medium;

  function setError(msg) {
    const el = $("#pinco-error");
    if (el) el.textContent = msg || "";
  }

  function fitCanvas() {
    const c = canvas();
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.floor(rect.width * dpr));
    const h = Math.max(300, Math.floor(rect.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  function pegPositions(b = board()) {
    const c = canvas();
    const w = c.width, h = c.height;
    const top = h * 0.12;
    const bottom = h * 0.84;
    const rowGap = (bottom - top) / b.rows;
    const xGap = w / (b.rows + 3);
    const rows = [];
    for (let r = 0; r < b.rows; r++) {
      const count = r + 2;
      const y = top + r * rowGap;
      const start = w / 2 - ((count - 1) * xGap) / 2;
      rows.push(Array.from({ length: count }, (_, i) => ({ x: start + i * xGap, y })));
    }
    return { rows, top, bottom, rowGap, xGap };
  }

  function pathPoints(drop) {
    const b = boards[drop.size] || board();
    const c = canvas();
    const { top, bottom, rowGap, xGap } = pegPositions(b);
    const points = [{ x: c.width / 2, y: top - rowGap * 0.75 }];
    let offset = 0;
    for (let r = 0; r < b.rows; r++) {
      offset += drop.path[r] ? 0.5 : -0.5;
      points.push({ x: c.width / 2 + offset * xGap, y: top + r * rowGap + rowGap * 0.45 });
    }
    const slotGap = c.width / b.multipliers.length;
    points.push({ x: slotGap * (drop.slot + 0.5), y: bottom + rowGap * 0.9 });
    return points;
  }

  function draw(balls) {
    fitCanvas();
    const c = canvas();
    const g = ctx();
    const b = board();
    const w = c.width, h = c.height;
    const geo = pegPositions(b);
    g.clearRect(0, 0, w, h);

    g.fillStyle = "rgba(255,255,255,0.04)";
    for (const row of geo.rows) {
      for (const p of row) {
        g.beginPath();
        g.arc(p.x, p.y, Math.max(3, w * 0.007), 0, Math.PI * 2);
        g.fill();
      }
    }

    const slotGap = w / b.multipliers.length;
    const y = geo.bottom + geo.rowGap * 0.45;
    for (let i = 0; i < b.multipliers.length; i++) {
      const m = b.multipliers[i];
      g.fillStyle = m >= 1 ? "rgba(74,222,128,0.22)" : m >= 0.5 ? "rgba(244,215,130,0.18)" : "rgba(214,90,90,0.2)";
      g.fillRect(i * slotGap + 1, y, slotGap - 2, h - y - 6);
    }

    const activeBalls = Array.isArray(balls) ? balls : balls ? [balls] : [];
    for (const ball of activeBalls) {
      g.beginPath();
      g.arc(ball.x, ball.y, Math.max(7, w * 0.014), 0, Math.PI * 2);
      g.fillStyle = ball.color || "#4ade80";
      g.shadowColor = "rgba(74,222,128,0.8)";
      g.shadowBlur = 14;
      g.fill();
      g.shadowBlur = 0;
    }
  }

  function renderMultipliers() {
    const b = board();
    const box = $("#pinco-mults");
    if (!box) return;
    box.style.gridTemplateColumns = `repeat(${b.multipliers.length}, 1fr)`;
    box.innerHTML = b.multipliers.map((m) => {
      const cls = m >= 1 ? "win" : m >= 0.5 ? "mid" : "lose";
      return `<div class="pinco-mult ${cls}">${m}×</div>`;
    }).join("");
  }

  function renderFeed() {
    const box = $("#pinco-feed");
    if (!box) return;
    if (!drops.length) { box.innerHTML = '<p class="muted small">Noch keine Drops.</p>'; return; }
    box.innerHTML = drops.slice(0, 18).map((d) => {
      const cls = d.net >= 0 ? "pos" : "neg";
      const sign = d.net >= 0 ? "+" : "-";
      return `<div class="pinco-feed-row">
        <span><b>${escapeHtml(d.name)}</b> · ${fmt(d.bet)} 🪙 · ${d.multiplier}×</span>
        <span class="${cls}">${sign}${fmt(Math.abs(d.net))} 🪙</span>
      </div>`;
    }).join("");
  }

  function renderRoom(state) {
    const panel = $("#pinco-lobby-panel");
    if (panel) panel.classList.toggle("hidden", !roomCode);
    $("#pinco-lobby-code").textContent = roomCode || "----";
    const box = $("#pinco-room");
    if (!box || !state) return;
    box.innerHTML = (state.players || []).map((p) => {
      const cls = p.net >= 0 ? "pos" : "neg";
      const sign = p.net >= 0 ? "+" : "-";
      return `<div class="pinco-player"><span>${escapeHtml(p.name)} <small class="muted">${p.drops} Drops</small></span><b class="${cls}">${sign}${fmt(Math.abs(p.net))}</b></div>`;
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
    $("#pinco-mode-readout").value = boards[size].label;
    renderMultipliers();
    draw();
  }

  function dropStatus(drop) {
    const cls = drop.net >= 0 ? "pos" : "neg";
    const sign = drop.net >= 0 ? "+" : "-";
    return `${escapeHtml(drop.name)} landet auf <b>${drop.multiplier}×</b> · <span class="${cls}">${sign}${fmt(Math.abs(drop.net))} 🪙</span>`;
  }

  function startAnimationLoop() {
    if (animationLoop) return;
    animationLoop = true;
    function frame(now) {
      const visible = [];
      const stillActive = [];
      for (const entry of activeBalls) {
        const elapsed = now - entry.start;
        const t = Math.min(1, elapsed / entry.duration);
        const pts = entry.pts;
        const segmentCount = pts.length - 1;
        const pos = Math.min(segmentCount - 0.0001, t * segmentCount);
        const i = Math.max(0, Math.min(segmentCount - 1, Math.floor(pos)));
        const local = Math.max(0, Math.min(1, pos - i));
        const a = pts[i], b = pts[i + 1] || pts[i];
        const wobble = Math.sin(t * Math.PI * entry.drop.rows + entry.seq) * canvas().width * 0.004;
        visible.push({
          x: a.x + (b.x - a.x) * local + wobble,
          y: a.y + (b.y - a.y) * local,
          color: entry.seq % 2 ? "#bff5d0" : "#4ade80",
        });
        if (t < 1) stillActive.push(entry);
        else $("#pinco-status").innerHTML = dropStatus(entry.drop);
      }
      activeBalls = stillActive;
      draw(visible);
      if (activeBalls.length) requestAnimationFrame(frame);
      else {
        animationLoop = false;
        draw();
      }
    }
    requestAnimationFrame(frame);
  }

  function animateDrop(drop) {
    if (!drop || !Array.isArray(drop.path)) return;
    setSize(drop.size);
    const pts = pathPoints(drop);
    if (pts.length < 2) { draw(); return; }
    activeBalls.push({
      drop,
      pts,
      start: performance.now(),
      duration: drop.rows === 14 ? 1900 : 1500,
      seq: ballSeq++,
    });
    startAnimationLoop();
  }

  function dropBall() {
    setError("");
    const bet = parseInt($("#pinco-bet").value, 10);
    socket.emit("pinco:drop", { size: selectedSize, bet }, (res) => {
      if (!res || !res.ok) { setError((res && res.error) || "Fehler."); return; }
      if (res.account) applyAccount(res.account);
      // In lobbies the broadcast animates the drop for everyone, including me.
      if (!roomCode && res.drop) {
        drops.unshift(res.drop);
        drops = drops.slice(0, 24);
        renderFeed();
        animateDrop(res.drop);
      }
    });
  }

  function createLobby() {
    socket.emit("pinco:create", (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Lobby konnte nicht erstellt werden."); return; }
      roomCode = res.code;
      drops = [];
      renderFeed();
      $("#pinco-status").textContent = `Lobby ${roomCode} eröffnet.`;
      if (window.Casino.chat) window.Casino.chat.enterLobby(roomCode);
    });
  }

  function joinLobby(code) {
    socket.emit("pinco:join", { code }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Lobby nicht gefunden."); return; }
      roomCode = res.code;
      drops = [];
      renderFeed();
      $("#pinco-status").textContent = `Lobby ${roomCode} beigetreten.`;
      if (window.Casino.chat) window.Casino.chat.enterLobby(roomCode);
    });
  }

  function leaveLobby() {
    socket.emit("pinco:leave");
    roomCode = null;
    renderRoom(null);
    $("#pinco-room").innerHTML = "";
    $("#pinco-status").textContent = "Lobby verlassen.";
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  socket.on("pinco:room", (state) => {
    if (!state || !state.code) return;
    roomCode = state.code;
    renderRoom(state);
  });
  socket.on("pinco:drop", (drop) => {
    if (!drop || !drop.id) return;
    if (!drops.some((d) => d.id === drop.id)) drops.unshift(drop);
    drops = drops.slice(0, 24);
    renderFeed();
    animateDrop(drop);
  });
  function wire() {
    $("#pinco-drop")?.addEventListener("click", dropBall);
    $("#pinco-create")?.addEventListener("click", createLobby);
    $("#pinco-leave")?.addEventListener("click", leaveLobby);
    document.querySelectorAll(".pinco-size").forEach((b) => b.addEventListener("click", () => setSize(b.dataset.size)));
    window.addEventListener("resize", () => draw());
    const screen = document.querySelector('[data-screen="pinco"]');
    if (screen) {
      new MutationObserver(() => {
        if (roomCode && !screen.classList.contains("active")) leaveLobby();
      }).observe(screen, { attributes: true, attributeFilter: ["class"] });
    }
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
  window.Casino._pincoJoinCode = (code) => {
    window.Casino.showScreen("pinco");
    joinLobby(code);
  };

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
