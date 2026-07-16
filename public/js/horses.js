"use strict";

/* ============================================================
   Fake Casino – 🐎 Porta-Rennbahn (Client).
   Geteiltes Live-Rennen: Canvas-Seitenansicht mit animierten
   Pferde-Silhouetten, Wetten mit Live-Quoten, Stall & Markt.
   Server ist autoritativ (game/horses.js); hier nur Darstellung.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  const SILKS = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22", "#1abc9c", "#ec8ecf"];
  const TACTICS = { front: "🏃 Frontrunner", closer: "🎯 Verfolger", stayer: "⚖️ Gleichmäßig" };

  let st = null;          // letzter Server-State
  let ticks = null;       // letzte Tick-Positionen [{lane,p,fin,spr}]
  let smooth = {};        // lane -> geglätteter Fortschritt
  let betTotal = 0;       // volle Wettfenster-Länge der aktuellen Runde (für den Countdown-Balken)
  let betNo = null;       // Runden-Nr., zu der betTotal gehört
  let config = {};
  let stable = [];
  let market = [];
  let raf = false;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll(".horses-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".horses-tab").forEach((b) => b.classList.toggle("active", b === btn));
      const tab = btn.dataset.htab;
      ["race", "stable", "market"].forEach((t) => $("#hv-" + t).classList.toggle("hidden", t !== tab));
      if (tab !== "race") load(); // Stall/Markt frisch ziehen
    });
  });

  // ── Canvas-Rennen ─────────────────────────────────────────────────────────
  const canvas = $("#race-canvas");
  const ctx = canvas && canvas.getContext("2d");

  function resize() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // Stilisierte Galopp-Silhouette: Rumpf, Hals, Kopf, Schweif, 4 Beine im Takt.
  // num: Startnummer auf der Satteldecke in Trikotfarbe (Zuordnung Liste ↔ Bahn).
  function drawHorse(x, y, s, color, phase, sprinting, num) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const leg = (off, front) => {
      const a = Math.sin(phase + off) * 0.7;
      ctx.save();
      ctx.translate(front ? 9 : -9, 4);
      ctx.rotate(a * (front ? 1 : -1));
      ctx.fillRect(-1.4, 0, 2.8, 11);
      ctx.restore();
    };
    ctx.fillStyle = "#241a12"; // Silhouette
    leg(0, false); leg(Math.PI * 0.9, false);
    // Rumpf
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    // Hals + Kopf (gestreckt beim Sprint)
    ctx.save();
    ctx.rotate(sprinting ? -0.12 : -0.3);
    ctx.fillRect(8, -9, 5, 10);
    ctx.beginPath(); ctx.ellipse(12.5, -10, 4.6, 2.6, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Schweif
    ctx.beginPath(); ctx.moveTo(-13, -3);
    ctx.quadraticCurveTo(-19, -2 + Math.sin(phase) * 2, -18, 3);
    ctx.quadraticCurveTo(-16, 1, -12, 1); ctx.closePath(); ctx.fill();
    leg(Math.PI * 0.45, true); leg(Math.PI * 1.4, true);
    // Satteldecke in Trikotfarbe mit Startnummer
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-7.5, -3.5, 11, 8.5, 2) : ctx.rect(-7.5, -3.5, 11, 8.5);
    ctx.fill();
    if (num != null) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(num), -2, 0.8);
      ctx.textBaseline = "alphabetic";
    }
    // Jockey im Trikot
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(-1, -9, 3.6, 4.4, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(1.5, -13.5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!ctx) { raf = false; return; }
    const screen = document.querySelector('[data-screen="horses"]');
    if (!screen || !screen.classList.contains("active")) { raf = false; return; }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const now = performance.now() / 1000;
    ctx.clearRect(0, 0, w, h);

    // ── Kulisse ── Himmel mit Sonne + driftenden Wolken
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    sky.addColorStop(0, "#7db1de"); sky.addColorStop(1, "#cfe4f2");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.42);
    ctx.fillStyle = "#fff3c2";
    ctx.beginPath(); ctx.arc(w * 0.87, h * 0.10, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 3; i++) {
      const cx = ((now * (5 + i * 2) + i * 271) % (w + 140)) - 70;
      const cy = h * (0.07 + i * 0.055);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 26, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 17, cy - 4, 17, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 16, cy - 2, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tribüne: Dach, Stützen, Publikumsreihen (deterministisch bunt, dezent wippend)
    const triTop = h * 0.40, triH = h * 0.13;
    ctx.fillStyle = "#4d4234"; ctx.fillRect(0, triTop, w, triH);                 // Korpus
    ctx.fillStyle = "#2e2820"; ctx.fillRect(0, triTop - 4, w, 5);                // Dachkante
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let x = 14; x < w; x += 46) ctx.fillRect(x, triTop, 3, triH);           // Stützen
    for (let row = 0; row < 3; row++) {
      const ry = triTop + triH * (0.22 + row * 0.26);
      for (let i = 0; i < w / 9; i++) {
        const seed = i * 31 + row * 17;
        ctx.fillStyle = ["#e8d9c0", "#c66655", "#6699cc", "#ddcc77", "#cc99cc", "#77bb99"][seed % 6];
        const bob = Math.sin(now * 2 + seed) * 0.8;
        ctx.fillRect(4 + i * 9 + (seed % 3), ry + bob, 3, 3.5);
      }
    }
    // Wimpel überm Dach
    for (let x = 30; x < w; x += 90) {
      ctx.strokeStyle = "#3a332a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, triTop - 4); ctx.lineTo(x, triTop - 16); ctx.stroke();
      ctx.fillStyle = SILKS[(x / 90) % SILKS.length | 0];
      const flap = Math.sin(now * 3 + x) * 2;
      ctx.beginPath(); ctx.moveTo(x, triTop - 16); ctx.lineTo(x + 10, triTop - 13 + flap); ctx.lineTo(x, triTop - 10); ctx.closePath(); ctx.fill();
    }

    // Rasen
    const grass = ctx.createLinearGradient(0, triTop + triH, 0, h);
    grass.addColorStop(0, "#3f7d3a"); grass.addColorStop(1, "#2a5f27");
    ctx.fillStyle = grass; ctx.fillRect(0, triTop + triH, w, h - triTop - triH);

    const lanes = st ? st.field.length : 8;
    const trackTop = h * 0.56, trackH = h * 0.40;
    const laneH = trackH / lanes;
    const padL = 26, padR = 60;

    // Bahnen: alternierende Streifen + Begrenzungen mit Pfosten
    for (let i = 0; i < lanes; i++) {
      if (i % 2 === 0) { ctx.fillStyle = "rgba(255,255,255,0.045)"; ctx.fillRect(0, trackTop + i * laneH, w, laneH); }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    for (let i = 1; i < lanes; i++) {
      ctx.beginPath(); ctx.moveTo(0, trackTop + i * laneH); ctx.lineTo(w, trackTop + i * laneH); ctx.stroke();
    }
    ctx.strokeStyle = "#e8e2d2"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, trackTop); ctx.lineTo(w, trackTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, trackTop + trackH); ctx.lineTo(w, trackTop + trackH); ctx.stroke();
    ctx.fillStyle = "#e8e2d2";
    for (let x = 10; x < w; x += 42) { ctx.fillRect(x, trackTop - 5, 2, 5); ctx.fillRect(x, trackTop + trackH, 2, 5); }
    // Distanzmarken bei 25/50/75 %
    ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1;
    for (const fr of [0.25, 0.5, 0.75]) {
      const mx = padL + fr * (w - padL - padR);
      ctx.beginPath(); ctx.moveTo(mx, trackTop); ctx.lineTo(mx, trackTop + trackH); ctx.stroke();
    }

    // Ziellinie: Schachbrett-Band + Fähnchen
    const fx = w - padR;
    for (let ry = 0; ry < trackH; ry += 7) {
      ctx.fillStyle = (ry / 7) % 2 ? "#fff" : "#222";
      ctx.fillRect(fx - 3, trackTop + ry, 4, Math.min(7, trackH - ry));
      ctx.fillStyle = (ry / 7) % 2 ? "#222" : "#fff";
      ctx.fillRect(fx + 1, trackTop + ry, 4, Math.min(7, trackH - ry));
    }
    ctx.font = "bold 11px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText("🏁 ZIEL", fx, trackTop - 8);

    if (st && st.field.length) {
      const running = st.phase === "running";
      const betting = st.phase === "betting";

      // Startboxen in der Wettphase
      if (betting) {
        ctx.fillStyle = "rgba(40,32,24,0.55)";
        ctx.fillRect(padL - 16, trackTop, 13, trackH);
        ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
        for (let i = 1; i < lanes; i++) { const gy = trackTop + i * laneH; ctx.beginPath(); ctx.moveTo(padL - 16, gy); ctx.lineTo(padL - 3, gy); ctx.stroke(); }
      }

      // Fortschritt glätten + Live-Rangfolge bestimmen
      const order = [];
      for (const f of st.field) {
        const target = ticks ? (ticks.find((x) => x.lane === f.lane) || { p: f.progress }).p : f.progress;
        smooth[f.lane] = (smooth[f.lane] ?? 0) + ((target || 0) - (smooth[f.lane] ?? 0)) * 0.18;
        order.push({ lane: f.lane, p: smooth[f.lane] || 0 });
      }
      order.sort((a, b) => b.p - a.p);
      const rankOf = {}; order.forEach((o, i) => (rankOf[o.lane] = i + 1));

      for (const f of st.field) {
        const p = Math.min(1.012, smooth[f.lane]);
        const x = padL + p * (w - padL - padR);
        const y = trackTop + f.lane * laneH + laneH * 0.62;
        const tick = ticks && ticks.find((x2) => x2.lane === f.lane);
        const sprinting = !!(tick && tick.spr);
        const phase = running ? now * 11 + f.lane * 1.7 : f.lane; // Galopp-Takt
        const silk = SILKS[f.silk % SILKS.length];
        if (sprinting) { // Staubwölkchen
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = "#e8dcc0";
          for (let d = 0; d < 3; d++) ctx.beginPath(), ctx.arc(x - 18 - d * 7, y + 6, 3 - d * 0.7, 0, Math.PI * 2), ctx.fill();
          ctx.globalAlpha = 1;
        }
        // Führenden-Glow
        if (running && rankOf[f.lane] === 1 && p > 0.03) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "#ffd76a";
          ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
        drawHorse(x, y, Math.min(1.15, laneH / 26), silk, phase, sprinting, f.lane + 1);
        // Live-Rang überm Pferd (nur im Rennen)
        if (running && p > 0.03) {
          const r = rankOf[f.lane];
          ctx.fillStyle = r === 1 ? "#ffd76a" : "rgba(255,255,255,0.85)";
          ctx.font = `bold ${r === 1 ? 11 : 9}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(r === 1 ? "👑" : r + ".", x, y - laneH * 0.55);
        }
        // Bahn-Label: Nummer im Trikotkästchen + Name
        const ly = trackTop + f.lane * laneH;
        ctx.fillStyle = silk;
        ctx.fillRect(4, ly + 2.5, 9, 9);
        ctx.fillStyle = "#fff"; ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(String(f.lane + 1), 8.5, ly + 9.5);
        ctx.font = "bold 9px sans-serif"; ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fillText(f.horse.name, 16, ly + 10);
      }

      // Countdown-Balken in der Wettphase
      if (betting) {
        const remaining = Math.max(0, st.msLeft - (Date.now() - st._at));
        const frac = Math.min(1, remaining / (betTotal || 90000));
        ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, h - 7, w, 7);
        ctx.fillStyle = frac > 0.25 ? "#ffd76a" : "#e8735a";
        ctx.fillRect(0, h - 7, w * frac, 7);
      }
    }
    requestAnimationFrame(draw);
  }
  function startDraw() { if (!raf) { raf = true; requestAnimationFrame(draw); } }

  // ── Render: Kopf, Feld/Wetten, Ticker, Stall, Markt ───────────────────────
  let countdownIv = null;
  function renderHead() {
    const el = $("#race-head");
    if (!el || !st) return;
    const s = Math.ceil(Math.max(0, st.msLeft - (Date.now() - st._at)) / 1000);
    const phase = st.phase === "betting" ? `Wetten offen · Start in ${s}s` : st.phase === "running" ? "🏇 Rennen läuft!" : "Zieleinlauf";
    el.innerHTML = `<b>Rennen #${st.no}</b> · ${st.distance}m · Boden: ${st.going} <span class="rh-phase">${phase}</span>`;
    const status = $("#race-status");
    if (status) status.textContent = st.phase === "betting" ? `Start in ${s}s` : "";
    renderPodium();
  }

  // Zieleinlauf-Podium als Overlay über der Bahn (nur in der "done"-Phase).
  function renderPodium() {
    const el = $("#race-podium");
    if (!el || !st) return;
    if (st.phase !== "done" || !st.result) { el.classList.add("hidden"); return; }
    const medals = ["🥇", "🥈", "🥉"];
    const rows = st.result.slice(0, 3).map((r, i) => {
      const f = st.field.find((x) => x.lane === r.lane);
      const silk = f ? SILKS[f.silk % SILKS.length] : "#888";
      return `<div class="rp-row rp-${i}">
        <span class="rp-medal">${medals[i]}</span>
        <span class="hf-silk" style="background:${silk}"></span>
        <span class="rp-name">${escapeHtml(r.name)}${r.photo ? " 📸" : ""}</span>
      </div>`;
    }).join("");
    el.innerHTML = `<div class="rp-card"><div class="rp-title">🏆 Zieleinlauf</div>${rows}</div>`;
    el.classList.remove("hidden");
  }

  function renderField() {
    const el = $("#race-field");
    if (!el || !st) return;
    const betting = st.phase === "betting";
    const myByLane = {};
    for (const b of st.myBets || []) (myByLane[b.lane] = myByLane[b.lane] || []).push(b);
    el.innerHTML = st.field.map((f) => {
      const h = f.horse;
      const me = window.Casino.getAccount && window.Casino.getAccount();
      const mine = me && h.owner && h.owner === me.name.toLowerCase();
      const ownerTag = h.npc ? '<span class="hf-npc">Stall Porta</span>' : `<span class="hf-owner">${mine ? "⭐ dein Pferd" : "👤 " + escapeHtml(h.ownerName || h.owner)}</span>`;
      const form = (h.formHint === "up" ? "📈" : h.formHint === "down" ? "📉" : "➖") + (h.handicap ? " 🏋️" : "");
      const myTags = (myByLane[f.lane] || []).map((b) => `<span class="hf-mybet">${b.type === "win" ? "Sieg" : "Platz"} ${fmt(b.amount)}</span>`).join("");
      const pos = st.phase === "done" && st.result ? `<b class="hf-pos">${st.result.find((r) => r.lane === f.lane).pos}.</b>` : "";
      return `<div class="hf-row">
        <span class="hf-silk" style="background:${SILKS[f.silk % SILKS.length]}"></span>
        <div class="hf-main">
          <div class="hf-name">${pos} ${escapeHtml(h.name)} ${form} ${ownerTag}</div>
          <div class="hf-sub">T ${h.speed} · A ${h.stamina} · ${TACTICS[f.tactic] || ""} ${myTags}</div>
        </div>
        ${f.odds ? `
        <button class="hf-bet" data-lane="${f.lane}" data-type="win" ${betting ? "" : "disabled"}>Sieg<br><b>${f.odds.win.toFixed(2)}</b></button>
        <button class="hf-bet" data-lane="${f.lane}" data-type="place" ${betting ? "" : "disabled"}>Platz<br><b>${f.odds.place.toFixed(2)}</b></button>` : ""}
      </div>`;
    }).join("");
    el.querySelectorAll(".hf-bet").forEach((btn) => btn.addEventListener("click", () => openBetSlip(+btn.dataset.lane, btn.dataset.type)));
  }

  function renderBets() {
    const el = $("#race-bets");
    if (!el || !st) return;
    const bets = st.bets || [];
    $("#race-bets-head").textContent = bets.length ? `Wetten (${bets.length})` : "Wetten — noch keine";
    el.innerHTML = bets.slice(-14).reverse().map((b) => {
      const horse = st.field[b.lane] ? st.field[b.lane].horse.name : "?";
      const res = b.won === true ? ` <b class="pos">+${fmt(Math.round(b.amount * b.odds))}</b>` : b.won === false ? ' <b class="neg">✗</b>' : "";
      return `<div class="rb-row">${escapeHtml(b.name)}: ${b.type === "win" ? "Sieg" : "Platz"} ${escapeHtml(horse)} · ${fmt(b.amount)} @ ${b.odds}${res}</div>`;
    }).join("");
  }

  function renderSprint() {
    const btn = $("#sprint-btn");
    if (!btn || !st) return;
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const mine = me && st.field.find((f) => f.horse.owner === me.name.toLowerCase() && !f.finished && !f.sprintUsed);
    btn.classList.toggle("hidden", !(st.phase === "running" && mine));
  }

  function renderTicker(lines) {
    const el = $("#race-ticker");
    if (!el) return;
    el.innerHTML = (lines || []).slice(-4).map((t) => `<div>${escapeHtml(typeof t === "string" ? t : t.text)}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }

  function statBar(v, max = 95) {
    return `<span class="sb"><i style="width:${Math.min(100, v / max * 100)}%"></i></span>`;
  }

  function renderStable() {
    const el = $("#stable-list");
    if (!el) return;
    $("#stable-hint").textContent = stable.length ? `Startgeld ${fmt(config.entryFee || 2000)} 🪙 · Training dauert ~20 Min (Pferd solange gesperrt) · Kondition unter ${config.enterMinCondition || 50} = Zwangspause` : "Noch keine Pferde — schau im Markt vorbei!";
    el.innerHTML = stable.map((h) => {
      const career = Math.round(h.career * 100);
      const form = h.formHint === "up" ? "📈 gute Form" : h.formHint === "down" ? "📉 außer Form" : "➖ normale Form";
      if (h.retired) return `<div class="horse-card retired"><div class="hc-name">🏅 ${escapeHtml(h.name)} <span class="muted small">in Rente</span></div>
        <div class="hc-sub">${h.races} Rennen · ${h.wins} Siege · ${fmt(h.earnings)} 🪙 verdient</div></div>`;
      const evBadge = h.event ? `<div class="hc-event">${escapeHtml(h.event.label)} — noch ~${h.event.hoursLeft}h${h.event.block ? " · kann nicht antreten" : ""}</div>` : "";
      const busy = !!h.training;
      const trainBadge = busy ? `<div class="hc-event">🏋️ Im Training — noch ~${h.training.minsLeft} Min · nicht startbereit</div>` : "";
      const hcap = h.handicap ? " 🏋️" : "";
      const dis = busy ? "disabled" : "";
      const condClass = h.condition >= 70 ? "" : h.condition >= 50 ? "sb-warn" : "sb-low";
      return `<div class="horse-card${busy ? " busy" : ""}">
        <div class="hc-head">
          <div class="hc-name">🐴 ${escapeHtml(h.name)}${hcap} <button class="hc-rename" data-id="${h.id}" data-name="${escapeHtml(h.name)}" title="Umbenennen">✏️</button></div>
          <span class="hc-form">${form}</span>
        </div>
        ${trainBadge}${evBadge}
        <div class="hc-stats">
          <div class="hc-stat"><span>⚡ Tempo</span> ${statBar(h.speed)} <b>${h.speed}</b> <button class="hc-train" data-id="${h.id}" data-stat="speed" ${dis}>+ Training</button></div>
          <div class="hc-stat"><span>🫀 Ausdauer</span> ${statBar(h.stamina)} <b>${h.stamina}</b> <button class="hc-train" data-id="${h.id}" data-stat="stamina" ${dis}>+ Training</button></div>
          <div class="hc-stat"><span>💪 Kondition</span> <span class="sb ${condClass}"><i style="width:${h.condition}%"></i></span> <b>${h.condition}</b></div>
          <div class="hc-record">🏁 ${h.races} · 🏆 ${h.wins} · 🥉 ${h.podiums} · 💰 ${fmt(h.earnings)} · Karriere ${career}%</div>
        </div>
        <div class="hc-actions">
          <select class="hc-tactic" data-id="${h.id}">
            <option value="stayer">⚖️ Gleichmäßig</option><option value="front">🏃 Frontrunner</option><option value="closer">🎯 Schlussspurt</option>
          </select>
          <button class="hc-enter btn-primary" data-id="${h.id}" ${dis}>🏁 Anmelden (${fmt(config.entryFee || 2000)})</button>
          <button class="hc-sell" data-id="${h.id}">Verkaufen</button>
        </div>
      </div>`;
    }).join("");
    el.querySelectorAll(".hc-train").forEach((b) => b.addEventListener("click", () => {
      socket.emit("horses:train", { horseId: b.dataset.id, stat: b.dataset.stat }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Training fehlgeschlagen.");
        applyAccount(r.account);
        toast(`💪 +${r.gain} ${r.stat === "speed" ? "Tempo" : "Ausdauer"} (${r.value}) · −${fmt(r.cost)} 🪙 · 🏋️ ~${r.trainingMins} Min gesperrt`);
        load();
      });
    }));
    el.querySelectorAll(".hc-enter").forEach((b) => b.addEventListener("click", () => {
      const tactic = el.querySelector(`.hc-tactic[data-id="${b.dataset.id}"]`).value;
      socket.emit("horses:enter", { horseId: b.dataset.id, tactic }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Anmeldung fehlgeschlagen.");
        applyAccount(r.account);
        toast(`🏁 Angemeldet fürs nächste Rennen (Startplatz ${r.position})`);
      });
    }));
    el.querySelectorAll(".hc-sell").forEach((b) => b.addEventListener("click", () => {
      const h = stable.find((x) => x.id === b.dataset.id);
      if (!confirm(`${h.name} ans Haus verkaufen?`)) return;
      socket.emit("horses:sell", { horseId: b.dataset.id }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Verkauf fehlgeschlagen.");
        if (r.account) applyAccount(r.account);
        toast(r.refund ? `Verkauft: +${fmt(r.refund)} 🪙` : "Verabschiedet. 🐴👋");
        load();
      });
    }));
    el.querySelectorAll(".hc-rename").forEach((b) => b.addEventListener("click", () => {
      const cur = b.dataset.name;
      const name = prompt(`Neuer Name für ${cur} (2–18 Zeichen):`, cur);
      if (name == null || name.trim() === cur) return;
      socket.emit("horses:rename", { horseId: b.dataset.id, name }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Umbenennen fehlgeschlagen.");
        toast(`✏️ Umbenannt in ${r.horse.name}!`);
        load();
      });
    }));
  }

  function renderMarket() {
    const el = $("#market-list");
    if (!el) return;
    el.innerHTML = market.map((h) => {
      const power = h.speed + h.stamina;
      const tier = power >= 165 ? { t: "Elite", c: "t-elite" } : power >= 140 ? { t: "Stark", c: "t-strong" } : power >= 120 ? { t: "Solide", c: "t-mid" } : { t: "Anfänger", c: "t-low" };
      const temp = "🌶️".repeat(Math.max(1, Math.round(h.temperament / 2)));
      return `<div class="horse-card">
        <div class="hc-head">
          <div class="hc-name">🐴 ${escapeHtml(h.name)}</div>
          <span class="hc-tier ${tier.c}">${tier.t}</span>
        </div>
        <div class="hc-stats">
          <div class="hc-stat"><span>⚡ Tempo</span> ${statBar(h.speed)} <b>${h.speed}</b></div>
          <div class="hc-stat"><span>🫀 Ausdauer</span> ${statBar(h.stamina)} <b>${h.stamina}</b></div>
          <div class="muted small">Temperament ${temp} (${h.temperament}/10) — je mehr, desto unberechenbarer</div>
        </div>
        <div class="hc-actions"><button class="hc-buy btn-primary" data-id="${h.id}">🛒 Kaufen · ${fmt(h.price)} 🪙</button></div>
      </div>`;
    }).join("");
    el.querySelectorAll(".hc-buy").forEach((b) => b.addEventListener("click", () => {
      socket.emit("horses:buy", { horseId: b.dataset.id }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Kauf fehlgeschlagen.");
        applyAccount(r.account);
        toast(`🐎 ${r.horse.name} gehört jetzt dir!`);
        load();
      });
    }));
  }

  function renderAll() { renderChamp(); renderHead(); renderField(); renderBets(); renderSprint(); }

  // ── Tages-Champion-Banner ─────────────────────────────────────────────────
  function renderChamp() {
    const el = $("#champ-banner");
    if (!el || !st) return;
    const top = st.dailyTop || [];
    const me = st.myDaily || null;
    const yest = st.champYesterday;
    const prizes = st.dailyPrizes || [500000, 250000, 100000];
    const meName = (window.Casino.getAccount && window.Casino.getAccount() || {}).name;
    const medals = ["🥇", "🥈", "🥉"];

    let head = `<div class="cb-title"><span class="cb-crown">👑</span> Renn-Champion des Tages</div>`;
    let rows = "";
    if (!top.length) {
      rows = `<div class="cb-row cb-empty">Noch kein Sieg heute — der Thron ist frei! Melde ein Pferd an und hol dir ${fmt(prizes[0])} 🪙.</div>`;
    } else {
      rows = top.map((r, i) => {
        const isMe = meName && r.name.toLowerCase() === meName.toLowerCase();
        return `<div class="cb-row${isMe ? " cb-me" : ""}"><span class="cb-medal">${medals[i]}</span><span class="cb-name">${escapeHtml(r.name)}${isMe ? " (du)" : ""}</span><span class="cb-wins">${r.wins} ${r.wins === 1 ? "Sieg" : "Siege"}</span><span class="cb-cash">+${fmt(prizes[i] || 0)}</span></div>`;
      }).join("");
      // Eigener Rang, falls außerhalb der Top 3.
      if (me && me.rank > 3) {
        rows += `<div class="cb-row cb-me cb-outside"><span class="cb-medal">${me.rank}.</span><span class="cb-name">${escapeHtml(me.name)} (du)</span><span class="cb-wins">${me.wins} ${me.wins === 1 ? "Sieg" : "Siege"}</span><span class="cb-cash">–</span></div>`;
      } else if (!me) {
        rows += `<div class="cb-row cb-outside"><span class="cb-medal">–</span><span class="cb-name">Du: noch kein Sieg heute</span><span class="cb-wins"></span><span class="cb-cash"></span></div>`;
      }
    }
    const potLine = st.betPot > 0 ? `<div class="cb-foot">💰 Heutiger Wett-Topf: <b>${fmt(st.betPot)} 🪙</b> — 50/30/20 % on top für Platz 1–3</div>` : "";
    const foot = yest ? `<div class="cb-foot">Gestern: 🏆 <b>${escapeHtml(yest.name)}</b> (${yest.wins} ${yest.wins === 1 ? "Sieg" : "Siege"})</div>` : "";
    el.innerHTML = head + `<div class="cb-list">${rows}</div>` + potLine + foot;
  }

  // ── Wettschein (Bottom-Sheet) ─────────────────────────────────────────────
  let slip = null; // { lane, type, amount }
  const CHIPS = [100, 500, 1000, 5000, 25000];

  function openBetSlip(lane, type) {
    if (!st || st.phase !== "betting" || !st.field[lane] || !st.field[lane].odds) return;
    slip = { lane, type, amount: 500 };
    renderSlip();
    const el = $("#bet-slip");
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
  }
  function closeBetSlip() {
    slip = null;
    const el = $("#bet-slip");
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
  }
  function renderSlip() {
    if (!slip || !st) return;
    const f = st.field[slip.lane];
    const h = f.horse;
    const odds = slip.type === "win" ? f.odds.win : f.odds.place;
    $("#bet-slip-head").innerHTML =
      `<span class="hf-silk" style="background:${SILKS[f.silk % SILKS.length]}"></span>` +
      `<span><b>${escapeHtml(h.name)}</b><br><span class="muted small">${slip.type === "win" ? "Siegwette" : "Platzwette (Top 3)"} @ ${odds.toFixed(2)}</span></span>`;
    $("#bet-slip-types").innerHTML = ["win", "place"].map((t) => {
      const o = t === "win" ? f.odds.win : f.odds.place;
      return `<button class="bs-type ${slip.type === t ? "active" : ""}" data-type="${t}">${t === "win" ? "Sieg" : "Platz"} · ${o.toFixed(2)}</button>`;
    }).join("");
    $("#bet-slip-chips").innerHTML = CHIPS.map((c) => `<button class="bs-chip" data-add="${c}">+${c >= 1000 ? c / 1000 + "k" : c}</button>`).join("") + `<button class="bs-chip bs-clear" data-clear="1">C</button>`;
    const inp = $("#bet-slip-input");
    inp.value = slip.amount;
    const payout = Math.round(slip.amount * odds);
    $("#bet-slip-payout").innerHTML = `Möglicher Gewinn <b>${fmt(payout)} 🪙</b>`;
    // Listener (frisch, da innerHTML neu)
    $("#bet-slip-types").querySelectorAll(".bs-type").forEach((b) => b.addEventListener("click", () => { slip.type = b.dataset.type; renderSlip(); }));
    $("#bet-slip-chips").querySelectorAll(".bs-chip").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.clear) slip.amount = 0;
      else slip.amount = Math.min(config.maxBet || 100000, (slip.amount || 0) + Number(b.dataset.add));
      renderSlip();
    }));
  }
  $("#bet-slip-input").addEventListener("input", (e) => { if (slip) slip.amount = parseInt(e.target.value, 10) || 0; const f = st.field[slip.lane]; const odds = slip.type === "win" ? f.odds.win : f.odds.place; $("#bet-slip-payout").innerHTML = `Möglicher Gewinn <b>${fmt(Math.round((slip.amount || 0) * odds))} 🪙</b>`; });
  $("#bet-slip-x").addEventListener("click", closeBetSlip);
  $("#bet-slip").addEventListener("click", (e) => { if (e.target.id === "bet-slip") closeBetSlip(); });
  $("#bet-slip-go").addEventListener("click", () => {
    if (!slip) return;
    const { lane, type, amount } = slip;
    const horse = st.field[lane] ? st.field[lane].horse.name : "?";
    if (!Number.isFinite(amount) || amount < (config.minBet || 50)) return toast(`Mindestens ${config.minBet || 50} 🪙.`);
    socket.emit("horses:bet", { lane, type, amount }, (r) => {
      if (!r || !r.ok) return toast((r && r.error) || "Wette fehlgeschlagen.");
      applyAccount(r.account);
      toast(`✅ ${type === "win" ? "Sieg" : "Platz"} auf ${horse}: ${fmt(amount)} @ ${r.bet.odds}`);
      st.myBets.push(r.bet);
      closeBetSlip();
      renderField();
    });
  });

  $("#sprint-btn").addEventListener("click", () => {
    socket.emit("horses:sprint", (r) => {
      if (!r || !r.ok) return toast((r && r.error) || "Kein Sprint möglich.");
      toast(r.early ? "⚡ Sprint gezündet — SEHR früh, hoffentlich hält er durch!" : "⚡ Sprint gezündet!");
      $("#sprint-btn").classList.add("hidden");
    });
  });

  // ── Socket ────────────────────────────────────────────────────────────────
  function applyState(s) {
    if (!s) return;
    s._at = Date.now();
    const wasBets = st && st.myBets;
    const prevMyDaily = st && st.myDaily;
    st = s;
    if (!st.myBets && wasBets && st.phase !== "betting") st.myBets = wasBets;
    // myDaily kommt nur mit dem eigenen horses:state (Broadcasts haben key=null).
    // Aus dem stets frischen Top-3 aktualisieren, sonst letzten Wert halten.
    if (!st.myDaily) {
      const meName = (window.Casino.getAccount && window.Casino.getAccount() || {}).name;
      const idx = meName ? (st.dailyTop || []).findIndex((r) => r.name.toLowerCase() === meName.toLowerCase()) : -1;
      st.myDaily = idx >= 0 ? { name: st.dailyTop[idx].name, wins: st.dailyTop[idx].wins, rank: idx + 1 } : (prevMyDaily || null);
    }
    if (s.phase === "betting") {
      ticks = null; smooth = {};
      // Volle Fensterlänge nur beim ersten State der Runde merken (spätere Fetches haben weniger msLeft).
      betTotal = Math.max(betNo === s.no ? betTotal : 0, s.msLeft || 0);
      betNo = s.no;
    }
    renderAll();
    renderTicker(st.commentary);
  }
  socket.on("horses:round", (s) => { const my = st && st.myBets; applyState({ ...s, myBets: s.phase === "betting" ? [] : my || [] }); });
  socket.on("horses:tick", (t) => { ticks = t.field; if (st) st.phase = "running"; });
  socket.on("horses:bets", ({ bets }) => { if (st) { st.bets = bets; renderBets(); } });
  socket.on("horses:say", ({ text }) => { if (st) { st.commentary = (st.commentary || []).concat(text); renderTicker(st.commentary); } });
  socket.on("horses:entries", () => {});

  let headIv = null;
  window.Casino._loadHorses = () => {
    resize();
    load();
    startDraw();
    clearInterval(headIv);
    headIv = setInterval(() => {
      const screen = document.querySelector('[data-screen="horses"]');
      if (!screen || !screen.classList.contains("active")) { clearInterval(headIv); return; }
      renderHead();
    }, 1000);
  };

  function load() {
    socket.emit("horses:state", (s) => {
      if (!s || !s.ok) return;
      config = s.config || config;
      stable = s.stable || [];
      market = s.market || [];
      applyState(s);
      renderStable();
      renderMarket();
    });
  }
})();
