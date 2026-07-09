"use strict";

/* ============================================================
   Fake Casino – Slots client
   Real slot-machine feel: pull the lever, symbols roll top→bottom
   through a window with a center payline, then an escalating win
   celebration (Small → Big → Mega → Ultra w/ money shower).
   Server is authoritative (game/slots.js); this only animates.
   ============================================================ */

(function () {
  const { socket, toast } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 🍋 Zitrone buff: spins twice as fast (animation durations halved).
  function spinSpeed() {
    const a = window.Casino.getAccount();
    const b = a && a.buffs && a.buffs.fastSpins;
    return b && b.until > Date.now() ? 1 / (b.mult || 2) : 1;
  }

  let machines = [];
  let machine = null;
  let betIndex = 1;
  let spinning = false;
  let freeActive = false;
  let autoRoll = false;
  let autoRemaining = Infinity; // remaining auto-spins (Infinity = ∞)
  let freeWinTotal = 0;
  let cellH = 70; // measured at runtime

  // PvP duel state
  let pvpMode = false;
  let pvp = null; // { code, buyIn, state, isHost, chips, spinsLeft, done, youName, opponent, result }

  // ===============================================================
  // Sound — classic mechanical slot (ratchet) + wins
  // ===============================================================
  let audioCtx = null;
  const soundOn = () => {
    const cb = $("#set-sound");
    return !cb || cb.checked;
  };
  function ac() {
    if (!soundOn()) return null;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch {
      return null;
    }
  }
  function tone(freq, dur, type = "square", gain = 0.05, delay = 0, to = null) {
    const ctx = ac();
    if (!ctx) return;
    gain *= (window.Casino.vol ?? 1);
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  function noise(dur, gain = 0.05, delay = 0, freq = 1000, q = 1) {
    const ctx = ac();
    if (!ctx) return;
    gain *= (window.Casino.vol ?? 1);
    const t = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start(t);
  }

  // A single ratchet "click" (pawl over gear tooth).
  function ratchetClick() {
    tone(2100, 0.01, "square", 0.018);
    noise(0.012, 0.022, 0, 3200, 5);
  }
  // Decelerating ratchet for the whole spin — the classic casino "rrrrr...r..r..r" .
  function startRatchet(totalMs) {
    let stopped = false;
    let elapsed = 0;
    let id = null;
    function step() {
      if (stopped) return;
      ratchetClick();
      const p = Math.min(1, elapsed / totalMs);
      const gap = 36 + 150 * Math.pow(p, 1.7);
      elapsed += gap;
      if (elapsed < totalMs + 180) id = setTimeout(step, gap);
    }
    step();
    return () => {
      stopped = true;
      if (id) clearTimeout(id);
    };
  }
  const sndLever = () => {
    tone(150, 0.16, "sawtooth", 0.06, 0, 70);
    noise(0.16, 0.05, 0, 500, 0.8);
    tone(520, 0.1, "triangle", 0.03, 0.12, 900);
  };
  const sndReelStop = (i = 0) => {
    tone(240 - i * 18, 0.07, "square", 0.05, 0, 90);
    noise(0.05, 0.045, 0, 480, 1.3);
  };
  const sndWin = () => [523, 659, 784].forEach((f, i) => tone(f, 0.13, "triangle", 0.06, i * 0.07));
  const sndBig = () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.26, "triangle", 0.07, i * 0.09));
    noise(0.4, 0.03, 0, 1600, 0.6);
  };
  const sndUltra = () => {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.34, "triangle", 0.08, i * 0.1));
    noise(0.7, 0.04, 0, 2000, 0.5);
  };
  const sndCoin = () => tone(1760 + Math.random() * 300, 0.05, "triangle", 0.035, 0, 2400);

  // ===============================================================
  // Machine list
  // ===============================================================
  function loadMachines() {
    socket.emit("slots:machines", (res) => {
      machines = (res && res.machines) || [];
      renderMachineGrid();
      updateJackpotLine(res && res.jackpot);
    });
  }
  function updateJackpotLine(pot) {
    const el = document.getElementById("jackpot-line");
    if (el && pot != null) el.innerHTML = `💰 Gemeinschafts-Jackpot: <b>${pot.toLocaleString("de-DE")} 🪙</b> <span class="muted small">— 0,5 % jedes Einsatzes, kann bei jedem Spin knallen</span>`;
  }
  function isMachineUnlocked(m) {
    if (!m || m.unlockCost === 0) return true;
    const acc = window.Casino.getAccount();
    return !!acc && (acc.unlocked || ["lucky7"]).includes(m.id);
  }
  function renderMachineGrid() {
    const grid = $("#machine-grid");
    grid.innerHTML = "";
    machines.forEach((m) => {
      const unlocked = isMachineUnlocked(m);
      const card = document.createElement("button");
      card.className = "machine-card theme-" + m.theme + (unlocked ? "" : " locked");
      const sampleSyms = Object.keys(m.emojis).slice(0, 5).map((sym) => symbolHtml(symbolAsset(m, sym) || m.emojis[sym], "mc-symbol-img")).join("");
      const feature = m.mystery ? "🌿 Mystery-Reveal" : m.freeSpins ? "🎁 Freispiele" : "⚡ Klassisch";
      card.innerHTML = `
        <div class="mc-topline"><span class="mc-led"></span><span>Automat</span></div>
        <div class="mc-syms"><span>${sampleSyms}</span></div>
        <div class="mc-name">${m.name}</div>
        <div class="mc-tag">${m.tagline}</div>
        <div class="mc-bets">Einsatz ${m.bets[0].toLocaleString("de-DE")}–${m.bets[m.bets.length - 1].toLocaleString("de-DE")} 🪙</div>
        ${unlocked
          ? `<div class="mc-feature">${feature}</div>`
          : `<div class="mc-lock">🔒 ${m.unlockCost.toLocaleString("de-DE")} 🪙</div>`}`;
      card.addEventListener("click", () => (unlocked ? openMachine(m.id) : tryUnlock(m)));
      grid.appendChild(card);
    });
  }
  function tryUnlock(m) {
    if (pvpMode) return toast("Im Duell kannst du nichts freischalten.");
    const acc = window.Casino.getAccount();
    if (!acc) return;
    if (acc.chips < m.unlockCost) return toast(`Du brauchst ${m.unlockCost.toLocaleString("de-DE")} 🪙 für ${m.name}.`);
    if (!confirm(`${m.name} für ${m.unlockCost.toLocaleString("de-DE")} 🪙 freischalten?`)) return;
    socket.emit("slots:unlock", { machineId: m.id }, (res) => {
      if (res && res.ok) {
        window.Casino.applyAccount(res.account);
        toast(`${m.name} freigeschaltet! 🎉`);
        renderMachineGrid();
      } else {
        toast((res && res.error) || "Freischalten fehlgeschlagen.");
      }
    });
  }

  // ===============================================================
  // Open / close a machine
  // ===============================================================
  function openMachine(id) {
    const m = machines.find((x) => x.id === id);
    if (!m) return;
    // In a PvP duel the machine is assigned regardless of unlocks.
    if (!pvpMode && !isMachineUnlocked(m)) return toast("Erst freischalten.");
    machine = m;
    betIndex = pvpMode ? 0 : 1; // PvP: fixed bet = machine minimum
    freeActive = false;
    resetSession(); // fresh streak/history per machine visit
    $("#slots-select").classList.add("hidden");
    const mv = $("#slots-machine");
    mv.classList.remove("hidden");
    mv.className = "theme-" + machine.theme;
    setBodyTheme(machine.theme);
    $("#machine-title").textContent = machine.name;
    $("#reels").style.gridTemplateColumns = `repeat(${machine.cols}, 1fr)`;
    buildReels(true);
    // Decide payline visibility synchronously (only line machines with a true
    // middle row). Positioning happens after layout.
    $("#payline").style.display = machine.mode === "lines" && machine.rows % 2 === 1 ? "" : "none";
    requestAnimationFrame(() => {
      measureCells();
      positionPayline();
    });
    updateBet();
    $("#win-amount").textContent = "0";
    $("#free-badge").classList.remove("show");
    $("#mult-badge").classList.remove("show");
    // In PvP the machine & bet are fixed: lock the bet stepper and hide the
    // "‹ Automaten" back button (no machine switching mid-duel).
    const lockBet = pvpMode;
    $("#bet-down").style.display = lockBet ? "none" : "";
    $("#bet-up").style.display = lockBet ? "none" : "";
    $("#slots-back").style.display = lockBet ? "none" : "";
    autoRoll = false;
    const autoBtn = $("#auto-roll");
    if (autoBtn) { autoBtn.classList.remove("active"); autoBtn.style.display = lockBet ? "none" : ""; }
    if (pvpMode) $("#machine-title").textContent = machine.name + " 🎲";
  }
  function closeMachine() {
    autoRoll = false;
    const ab = $("#auto-roll");
    if (ab) ab.classList.remove("active");
    $("#slots-machine").classList.add("hidden");
    $("#slots-select").classList.remove("hidden");
    setBodyTheme(null);
    machine = null;
  }

  const BG_THEMES = ["bg-classic", "bg-gems", "bg-dragon", "bg-cosmic", "bg-algae"];
  function setBodyTheme(theme) {
    document.body.classList.remove(...BG_THEMES);
    if (theme) document.body.classList.add("bg-" + theme);
  }
  $("#slots-back").addEventListener("click", () => {
    if (spinning || freeActive) return;
    closeMachine();
  });

  const slotsScreen = document.querySelector('[data-screen="slots"]');
  new MutationObserver(() => {
    if (slotsScreen.classList.contains("active")) {
      if (!machines.length) loadMachines();
    } else if (machine && !spinning && !freeActive) {
      closeMachine();
    }
  }).observe(slotsScreen, { attributes: true, attributeFilter: ["class"] });

  // ===============================================================
  // Reels (vertical scrolling strips)
  // ===============================================================
  const pool = () => Object.keys(machine.emojis).map((sym) => symbolAsset(machine, sym) || machine.emojis[sym]);
  const randSym = () => pool()[Math.floor(Math.random() * pool().length)];

  function symbolAsset(m, sym) {
    return m && m.assets && m.assets[sym] ? m.assets[sym] : null;
  }

  function escapeAttr(s) {
    return String(s || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function symbolHtml(value, cls = "slot-symbol-img") {
    const v = String(value || "");
    if (v.startsWith("/assets/")) return `<img class="${cls}" src="${escapeAttr(v)}" alt="" draggable="false" />`;
    return escapeAttr(v);
  }

  // Build idle reels showing `rows` symbols per column.
  function buildReels(randomFill) {
    const reels = $("#reels");
    reels.innerHTML = "";
    for (let c = 0; c < machine.cols; c++) {
      const reel = document.createElement("div");
      reel.className = "reel";
      reel.dataset.col = c;
      const strip = document.createElement("div");
      strip.className = "strip";
      for (let r = 0; r < machine.rows; r++) strip.appendChild(makeCell(c, r, randSym()));
      reel.appendChild(strip);
      reels.appendChild(reel);
    }
  }
  function makeCell(c, r, emoji) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.c = c;
    cell.dataset.r = r;
    cell.innerHTML = `<span>${symbolHtml(emoji)}</span>`;
    return cell;
  }
  // A plain (non-indexed) cell for the rolling part of a strip.
  function rollCell(emoji) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = `<span>${symbolHtml(emoji)}</span>`;
    return cell;
  }
  function measureCells() {
    const cell = document.querySelector("#reels .cell");
    if (cell) cellH = cell.getBoundingClientRect().height || cellH;
  }
  // Centre the payline band on the true vertical middle of the symbol area.
  // (Measured from real cells so it lines up regardless of padding/borders;
  // for odd rows it sits on the middle row, for 4 rows on the exact centre.)
  function positionPayline() {
    const pl = $("#payline");
    const win = $("#reels-window");
    const first = document.querySelector('.cell[data-c="0"][data-r="0"]');
    if (!pl || !win || !first) return;
    // Only show a center line where it actually makes sense: payline machines
    // with a true middle row (odd row count). Ways/cluster or even rows → hide.
    if (machine.mode !== "lines" || machine.rows % 2 === 0) {
      pl.style.display = "none";
      return;
    }
    pl.style.display = "";
    const wb = win.getBoundingClientRect();
    const fb = first.getBoundingClientRect();
    const ch = fb.height;
    const cellsTop = fb.top - wb.top;
    const center = cellsTop + (machine.rows * ch) / 2;
    pl.style.top = center - ch / 2 + "px";
    pl.style.height = ch + "px";
  }
  function setCell(c, r, emoji) {
    const cell = document.querySelector(`.cell[data-c="${c}"][data-r="${r}"]`);
    if (cell) cell.querySelector("span").innerHTML = symbolHtml(emoji);
  }
  const cellEl = (c, r) => document.querySelector(`.cell[data-c="${c}"][data-r="${r}"]`);
  function clearHighlights() {
    document.querySelectorAll(".cell.win, .cell.dim, .cell.scatter-hit").forEach((el) =>
      el.classList.remove("win", "dim", "scatter-hit")
    );
  }

  // ===============================================================
  // Bet controls
  // ===============================================================
  function updateBet() {
    $("#bet-amount").textContent = machine.bets[betIndex].toLocaleString("de-DE");
    updateBonusBtn();
  }
  function updateBonusBtn() {
    const btn = $("#buy-bonus");
    if (!btn) return;
    if (machine && machine.buyBonus && !pvpMode) {
      const cost = machine.bets[betIndex] * machine.buyBonus;
      btn.style.display = "";
      btn.textContent = `🎁 Bonus ${cost.toLocaleString("de-DE")}`;
    } else btn.style.display = "none";
    // Admin-only showcase button: arm a guaranteed max win on the next spin.
    const fw = $("#force-win-btn");
    if (fw) {
      const acc = window.Casino.getAccount && window.Casino.getAccount();
      fw.style.display = acc && acc.name && acc.name.toLowerCase() === "vincent" && !pvpMode ? "" : "none";
    }
  }
  $("#bet-down").addEventListener("click", () => {
    if (spinning || freeActive) return;
    betIndex = Math.max(0, betIndex - 1);
    updateBet();
  });
  $("#bet-up").addEventListener("click", () => {
    if (spinning || freeActive) return;
    betIndex = Math.min(machine.bets.length - 1, betIndex + 1);
    updateBet();
  });

  // ===============================================================
  // Spin
  // ===============================================================
  async function doSpin() {
    if (spinning) return;
    if (pvpMode && (!pvp || pvp.done || pvp.state !== "playing")) return;

    const bet = machine.bets[betIndex];
    const wasFree = freeActive;
    // Affordability (match-chips in PvP, account otherwise).
    if (!wasFree) {
      if (pvpMode) {
        if (pvp.chips < bet) return toast("Nicht genug Match-Chips.");
      } else if ((window.Casino.getAccount()?.chips ?? 0) < bet) {
        return toast("Nicht genug Chips.");
      }
    }

    spinning = true;
    setControlsEnabled(false);
    clearHighlights();
    $("#win-pop").classList.remove("show");
    $("#mult-badge").classList.remove("show");
    $("#win-amount").textContent = "0";

    if (!wasFree) {
      if (pvpMode) { pvp.chips -= bet; updateHud(); }
      else window.Casino.adjustChips(-bet);
    }

    // Occasionally taunt the player with a fake "luck" popup (parody).
    if (!wasFree && !pvpMode && Math.random() < 0.13) luckPopup();

    const totalSpinMs = (850 + (machine.cols - 1) * 230 + 250) * spinSpeed();
    sndLever();
    const stopRatchet = startRatchet(totalSpinMs);
    startRoll();

    const event = pvpMode ? "pvp:spin" : "slots:spin";
    const res = await new Promise((resolve) => socket.emit(event, { machineId: machine.id, bet }, resolve));

    if (!res || !res.ok) {
      stopRatchet();
      buildReels(true);
      if (!wasFree) { if (pvpMode) { pvp.chips += bet; updateHud(); } else window.Casino.adjustChips(bet); }
      toast((res && res.error) || "Spin fehlgeschlagen.");
      spinning = false;
      setControlsEnabled(true);
      return;
    }

    await landRoll(res.displayGrid || res.grid);
    stopRatchet();
    await revealMystery(res);
    await resolveResult(res);

    if (pvpMode) {
      pvp.chips = res.chips;
      pvp.spinsLeft = res.spinsLeft;
      pvp.done = res.done;
      updateHud();
    } else {
      window.Casino.setChips(res.balance);
      if (!wasFree) recordSession(res.totalWin, bet); // track streak on base spins
      if (res.jackpot) window.Casino.toast(`💰💥 JACKPOT GEKNACKT: +${res.jackpot.toLocaleString("de-DE")} 🪙!`);
      updateJackpotLine(res.jackpotPot);
    }
    spinning = false;

    if (res.freeSpins && res.freeSpins.active) {
      freeActive = true;
      updateFreeBadge(res.freeSpins);
      setControlsEnabled(false);
      await sleep(800);
      doSpin();
    } else {
      if (freeActive) {
        freeActive = false;
        $("#free-badge").classList.remove("show");
        $("#mult-badge").classList.remove("show");
        if (freeWinTotal > 0) bigBanner(`Freispiele vorbei!\n+${freeWinTotal.toLocaleString("de-DE")} 🪙`, "t-big");
        freeWinTotal = 0;
      }
      if (pvpMode && pvp.done) {
        setControlsEnabled(false);
        const hint = $("#spin-hint");
        const oppDone = !pvp.opponent || pvp.opponent.done;
        if (hint) hint.textContent = oppDone ? "Beide fertig…" : "🤖 Bot spielt noch…";
      } else {
        setControlsEnabled(true);
      }
    }

    // Auto-Roll: queue the next spin once idle (base game only, not in PvP).
    if (autoRoll && !pvpMode && !freeActive && !spinning) {
      autoRemaining -= 1;
      if (autoRemaining <= 0) {
        setAuto(false);
      } else if ((window.Casino.getAccount()?.chips ?? 0) >= machine.bets[betIndex]) {
        setTimeout(() => { if (autoRoll && !spinning && !freeActive) doSpin(); }, 850);
      } else {
        setAuto(false);
        toast("Auto-Roll gestoppt — nicht genug Chips.");
      }
    }
  }

  // Toggle continuous auto-spinning (with optional spin count).
  function setAuto(on) {
    autoRoll = on && !pvpMode;
    if (autoRoll) {
      const n = parseInt($("#auto-count") ? $("#auto-count").value : "0", 10) || 0;
      autoRemaining = n > 0 ? n : Infinity;
    }
    const btn = $("#auto-roll");
    if (btn) btn.classList.toggle("active", autoRoll);
    if (autoRoll && !spinning && !freeActive && !pvpMode) doSpin();
  }
  $("#auto-roll").addEventListener("click", () => setAuto(!autoRoll));
  // Stop auto-spin when the player leaves the slots screen (e.g. taps the logo →
  // lobby), so the reels don't keep spinning in the background.
  window.Casino._slotsStopAuto = () => { if (autoRoll) setAuto(false); };

  // Bonus-Buy: pay to start free spins immediately.
  $("#force-win-btn").addEventListener("click", () => {
    socket.emit("admin:slotsForceWin", (r) => {
      if (!r || !r.ok) { window.Casino.toast((r && r.error) || "Kein Zugriff."); return; }
      const fw = $("#force-win-btn");
      fw.textContent = "🎯 SCHARF";
      setTimeout(() => (fw.textContent = "🎯 Max"), 4000);
      window.Casino.toast("🎯 Nächster Spin = Maximalgewinn — zieh den Hebel!");
    });
  });

  $("#buy-bonus").addEventListener("click", () => {
    if (!machine || !machine.buyBonus || spinning || freeActive || pvpMode) return;
    const bet = machine.bets[betIndex];
    const cost = bet * machine.buyBonus;
    if ((window.Casino.getAccount()?.chips ?? 0) < cost) return toast("Nicht genug Chips für den Bonus-Kauf.");
    socket.emit("slots:buyBonus", { machineId: machine.id, bet }, (res) => {
      if (!res || !res.ok) return toast((res && res.error) || "Bonus-Kauf fehlgeschlagen.");
      window.Casino.setChips(res.balance);
      freeActive = true;
      updateFreeBadge(res.freeSpins);
      setControlsEnabled(false);
      bigBanner(`🎁 Bonus gekauft!\n${res.freeSpins.remaining} Freispiele`, "t-big");
      setTimeout(() => doSpin(), 900);
    });
  });

  function setControlsEnabled(on) {
    $("#bet-up").disabled = !on;
    $("#bet-down").disabled = !on;
    $("#slots-back").style.opacity = on ? "1" : "0.4";
    $("#lever").classList.toggle("disabled", !on);
  }

  // Begin rolling: give each reel a tall strip of random symbols scrolling down.
  function startRoll() {
    measureCells();
    for (let c = 0; c < machine.cols; c++) {
      const reel = document.querySelector(`.reel[data-col="${c}"]`);
      reel.style.height = machine.rows * cellH + "px";
      reel.classList.add("rolling");
      const strip = reel.querySelector(".strip");
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      strip.dataset.spin = 18 + c * 4; // travel length (cells)
    }
  }

  // Land each reel staggered onto the final grid, scrolling top→bottom.
  async function landRoll(grid) {
    const stops = [];
    for (let c = 0; c < machine.cols; c++) {
      const reel = document.querySelector(`.reel[data-col="${c}"]`);
      const strip = reel.querySelector(".strip");
      const spin = parseInt(strip.dataset.spin, 10);

      // Strip content: [final rows] + [spin random]. Resting at translateY 0 shows finals.
      strip.innerHTML = "";
      for (let r = 0; r < machine.rows; r++) strip.appendChild(makeCell(c, r, symbolAsset(machine, grid[c][r]) || machine.emojis[grid[c][r]]));
      for (let i = 0; i < spin; i++) strip.appendChild(rollCell(randSym()));

      // Start shifted up so the random tail is in view, then animate down to finals.
      strip.style.transition = "none";
      strip.style.transform = `translateY(${-spin * cellH}px)`;
      strip.getBoundingClientRect(); // reflow

      const dur = (850 + c * 230) * spinSpeed();
      strip.style.transition = `transform ${dur}ms cubic-bezier(0.16, 0.78, 0.24, 1)`;
      strip.style.transform = "translateY(0)";

      stops.push(
        new Promise((resolve) => {
          setTimeout(() => {
            // Trim to just the final rows (seamless) and let rays escape the reel.
            strip.innerHTML = "";
            for (let r = 0; r < machine.rows; r++) strip.appendChild(makeCell(c, r, symbolAsset(machine, grid[c][r]) || machine.emojis[grid[c][r]]));
            strip.style.transition = "none";
            strip.style.transform = "translateY(0)";
            reel.classList.remove("rolling");
            reel.style.height = "";
            reel.classList.add("bump");
            setTimeout(() => reel.classList.remove("bump"), 220);
            sndReelStop(c);
            resolve();
          }, dur);
        })
      );
    }
    await Promise.all(stops);
    await sleep(120);
  }

  // ===============================================================
  // Resolve result — present each win in turn: mark it, fly its value
  // into the central running total, accumulate. Markers stay while the
  // counter climbs; on a cluster machine the grid tumbles only after a
  // step's wins have been added.
  // ===============================================================
  async function resolveResult(res) {
    const fsMult = res.wasFreeSpin && machine.freeSpins && machine.freeSpins.multiplier
      ? machine.freeSpins.multiplier : 1;

    if (res.multiplier && res.multiplier > 1) {
      $("#mult-badge").textContent = "×" + res.multiplier;
      $("#mult-badge").classList.add("show");
    }

    if (res.totalWin > 0) {
      openCelebration(res.totalWin, res.bet);
      if (res.instantWin > 0) {
        const positions = (res.razorReveals || []).filter((r) => r.kind === "coin").map((r) => [r.c, r.r]);
        await addWin(positions.length ? positions : [[Math.floor(machine.cols / 2), Math.floor(machine.rows / 2)]], res.instantWin);
      }

      if (machine.mode === "cluster" && res.cascades && res.cascades.length) {
        // Each cascade step escalates: faster trace, more confetti, strobe deeper in.
        let stepIdx = 0;
        const multiStep = res.cascades.length > 1;
        for (const step of res.cascades) {
          stepIdx++;
          for (const w of step.wins) {
            await traceHighlight(w.positions, Math.max(40, 90 - stepIdx * 12), stepIdx); // reveal cluster cell-by-cell
            comboEscalate(stepIdx, multiStep);
            await addWin(w.positions, Math.round(w.win * fsMult)); // fly + count up
          }
          await sleep(280);
          // Tumble: clear winners, drop the new grid in.
          step.wins.forEach((w) => w.positions.forEach(([c, r]) => cellEl(c, r) && cellEl(c, r).classList.add("dim")));
          await sleep(220);
          clearHighlights();
          for (let c = 0; c < machine.cols; c++)
            for (let r = 0; r < machine.rows; r++) setCell(c, r, symbolAsset(machine, step.gridAfter[c][r]) || machine.emojis[step.gridAfter[c][r]]);
          $("#reels").classList.add("tumble");
          await sleep(260);
          $("#reels").classList.remove("tumble");
        }
      } else if (res.wins && res.wins.length) {
        // Line/ways: reveal each winning line in turn, tracing its connected
        // symbols one-by-one. Each successive line builds the combo and hits harder.
        let combo = 0;
        const multiWin = res.wins.length > 1;
        for (const w of res.wins) {
          clearHighlights();
          dimAllCells();
          combo++;
          await traceHighlight(w.positions, Math.max(45, 100 - combo * 10), combo);
          comboEscalate(combo, multiWin);
          await addWin(w.positions, Math.round(w.win * fsMult));
          await sleep(Math.max(150, 260 - combo * 20));
        }
        clearHighlights();
      }

      await finishCelebration(res.totalWin);
      if (freeActive) freeWinTotal += res.totalWin;
    }

    if (res.scatterPositions && res.freeSpinsAwarded) {
      res.scatterPositions.forEach(([c, r]) => cellEl(c, r) && cellEl(c, r).classList.add("scatter-hit"));
    }

    if (res.freeSpinsAwarded) {
      sndBig();
      confettiBurst(150);
      bigBanner(`🎁 ${res.freeSpinsAwarded} FREISPIELE!`, "t-big");
      await sleep(1400);
    }
  }

  async function revealMystery(res) {
    if (!res || !res.mysteryReveals || !res.mysteryReveals.length) return;
    bigBanner("🌿 ALGEN-REVEAL!", "t-big");
    sideLights(1300);
    casinoStrobe();
    sndZap();
    await sleep(420);
    let n = 0;
    for (const rev of res.mysteryReveals) {
      const cell = cellEl(rev.c, rev.r);
      if (!cell) continue;
      cell.classList.add("mystery-pop");
      cellShockwave(centerOfCell(cell));
      coinFountain(centerOfCell(cell), 6 + Math.min(10, n * 2));
      await sleep(120);
      const finalSym = rev.finalSymbol || rev.symbol;
      setCell(rev.c, rev.r, symbolAsset(machine, finalSym) || machine.emojis[finalSym]);
      if (rev.razor) razorRevealPop(cell, rev.razor);
      cell.classList.add("win", "trace-pop");
      sndBlip(7 + n);
      setTimeout(() => cell.classList.remove("mystery-pop", "trace-pop", "win"), 520);
      n++;
      await sleep(95);
    }
    clearHighlights();
    await sleep(180);
  }

  function centerOfCell(el) {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  function razorRevealPop(cell, razor) {
    const tag = document.createElement("em");
    tag.className = "razor-prize";
    tag.textContent = razor.kind === "coin" ? `×${razor.value}` : razor.kind === "scatter" ? "+BONUS" : "WILD!";
    cell.appendChild(tag);
    jackpotSirens(razor.kind === "coin" && razor.value >= 10 ? 1400 : 900);
    moneyTicker(tag.textContent);
    setTimeout(() => tag.remove(), 1200);
  }

  function dimAllCells() {
    for (let c = 0; c < machine.cols; c++)
      for (let r = 0; r < machine.rows; r++) {
        const el = cellEl(c, r);
        if (el) el.classList.add("dim");
      }
  }

  function highlightCells(positions) {
    positions.forEach(([c, r]) => {
      const el = cellEl(c, r);
      if (el) { el.classList.remove("dim"); el.classList.add("win"); }
    });
  }

  // Rising chromatic "blip" — the classic ascending payline-reveal tick.
  function sndBlip(i) {
    tone(440 * Math.pow(2, Math.min(i, 28) / 12), 0.05, "triangle", 0.05);
  }
  // Electric crackle for the lightning arcs.
  function sndZap() {
    tone(1600 + Math.random() * 600, 0.08, "sawtooth", 0.05);
    tone(2600 + Math.random() * 800, 0.05, "square", 0.03);
  }
  // Light a win's cells ONE AT A TIME, tracing the connection. Pitch climbs
  // across the whole sequence (comboBase) so each successive win feels bigger.
  async function traceHighlight(positions, perMs, comboBase) {
    for (let i = 0; i < positions.length; i++) {
      const [c, r] = positions[i];
      const el = cellEl(c, r);
      if (el) {
        el.classList.remove("dim");
        el.classList.add("win", "trace-pop");
        const cell = el;
        setTimeout(() => cell.classList.remove("trace-pop"), 320);
      }
      sndBlip((comboBase || 0) * 2 + i);
      if (i < positions.length - 1) await sleep(perMs);
    }
  }

  // Climbing "COMBO ×N" badge during a multi-win reveal.
  function showCombo(n) {
    let el = document.getElementById("combo-badge");
    if (!el) {
      el = document.createElement("div");
      el.id = "combo-badge";
      document.body.appendChild(el);
    }
    el.textContent = "COMBO ×" + n;
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    // Auto-fade so the badge never lingers after the sequence ends.
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove("go"), 1000);
  }

  // Ramp the celebration up as the win sequence grows — more wins back-to-back
  // means progressively more confetti, shake and strobe (escalating dopamine).
  function comboEscalate(n, show) {
    if (show && n >= 1) showCombo(n);
    if (n >= 1) confettiBurst(14 + n * 8);   // even the first win pops
    if (n >= 2) { confettiBurst(28 + n * 26); zoomPunch(); sideLights(900); }
    if (n >= 3) { casinoStrobe(); moneyTicker(`COMBO ×${n}`); }
    if (n >= 4) { hypeWords(Math.min(8, n)); jackpotSirens(1300); }
  }

  // Screen-space centre of a set of cells (for the flying "+amount").
  function cellsCentroid(positions) {
    let x = 0, y = 0, n = 0;
    positions.forEach(([c, r]) => {
      const el = cellEl(c, r);
      if (el) {
        const b = el.getBoundingClientRect();
        x += b.left + b.width / 2;
        y += b.top + b.height / 2;
        n++;
      }
    });
    return n ? { x: x / n, y: y / n } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  // A floating "+amount" flies from the win cells to the central counter.
  function flyPlus(from, delta) {
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "fly-add";
      el.textContent = "+" + delta.toLocaleString("de-DE");
      el.style.left = from.x + "px";
      el.style.top = from.y + "px";
      document.body.appendChild(el);
      const tx = window.innerWidth / 2 - from.x;
      const ty = window.innerHeight * 0.46 - from.y;
      requestAnimationFrame(() => {
        el.style.transform = `translate(${tx}px, ${ty}px) scale(0.7)`;
        el.style.opacity = "0";
      });
      setTimeout(() => {
        el.remove();
        resolve();
      }, 460);
    });
  }

  // ---- Blue electric lightning between connected winning symbols ----
  const SVGNS = "http://www.w3.org/2000/svg";
  let boltSvg = null;
  function boltLayer() {
    if (boltSvg && document.body.contains(boltSvg)) return boltSvg;
    boltSvg = document.createElementNS(SVGNS, "svg");
    boltSvg.id = "slot-bolts";
    boltSvg.innerHTML =
      `<defs><filter id="boltGlow" x="-60%" y="-60%" width="220%" height="220%">
         <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
       </filter></defs>`;
    document.body.appendChild(boltSvg);
    return boltSvg;
  }
  function jaggedPath(x1, y1, x2, y2, segs = 7, amp = 16) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    let d = `M ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    for (let i = 1; i < segs; i++) {
      const t = i / segs, o = (Math.random() * 2 - 1) * amp * Math.sin(Math.PI * t);
      d += ` L ${(x1 + dx * t + nx * o).toFixed(1)} ${(y1 + dy * t + ny * o).toFixed(1)}`;
    }
    return d + ` L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  function zap(x1, y1, x2, y2) {
    const svg = boltLayer();
    const g = document.createElementNS(SVGNS, "g");
    const glow = document.createElementNS(SVGNS, "path");
    const core = document.createElementNS(SVGNS, "path");
    glow.setAttribute("stroke", "#3aa0ff"); glow.setAttribute("stroke-width", "6"); glow.setAttribute("opacity", "0.85");
    core.setAttribute("stroke", "#eaffff"); core.setAttribute("stroke-width", "2");
    for (const p of [glow, core]) { p.setAttribute("fill", "none"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("filter", "url(#boltGlow)"); g.appendChild(p); }
    const redraw = () => { const d = jaggedPath(x1, y1, x2, y2); glow.setAttribute("d", d); core.setAttribute("d", d); };
    redraw();
    svg.appendChild(g);
    let n = 0; const iv = setInterval(() => { redraw(); if (++n > 3) clearInterval(iv); }, 65);
    setTimeout(() => { g.style.transition = "opacity .22s"; g.style.opacity = "0"; setTimeout(() => g.remove(), 240); }, 380);
  }
  // Draw bolts along the chain of a win's cells + a quick blue screen pulse.
  function lightningChain(positions) {
    if (!positions || positions.length < 2) return;
    const pts = positions.map(([c, r]) => { const el = cellEl(c, r); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }).filter(Boolean);
    for (let i = 0; i < pts.length - 1; i++) zap(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    bluePulse();
  }
  let pulseEl = null;
  function bluePulse() {
    if (!pulseEl) { pulseEl = document.createElement("div"); pulseEl.id = "slot-zap-flash"; document.body.appendChild(pulseEl); }
    pulseEl.classList.remove("go"); void pulseEl.offsetWidth; pulseEl.classList.add("go");
  }
  // Expanding shockwave ring at a win's centre.
  function cellShockwave(center) {
    const r = document.createElement("div");
    r.className = "slot-shockwave";
    r.style.left = center.x + "px"; r.style.top = center.y + "px";
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 620);
  }

  // ---- Central running-total celebration ----
  let wcRunning = 0;
  let wcFired = [];
  let wcBet = 0;
  const WC = {};

  function openCelebration(total, bet) {
    WC.tier = $("#wc-tier");
    WC.amt = $("#wc-amount");
    WC.bottom = $("#win-amount");
    wcRunning = 0;
    wcBet = bet || 1;
    wcFired = WIN_TIERS.map(() => false);
    $("#win-celebration").classList.add("show", "dopamine-on");
    WC.amt.textContent = "0";
    WC.amt.className = "wc-amount";
    moneyTicker("GEWINN ERKANNT");
    sideLights(1200);
    // Below the first tier (4× bet) it's just a "WIN", no fanfare.
    if (total < wcBet * WIN_TIERS[0].mult) {
      WC.tier.textContent = "WIN";
      WC.tier.className = "wc-tier show t-small";
    } else {
      WC.tier.textContent = "";
      WC.tier.className = "wc-tier";
    }
  }

  // Fly the win in, then ramp the running counter up by `delta`, escalating tiers.
  async function addWin(positions, delta) {
    if (delta <= 0) return;
    sndWin();
    flicker(); // every win flashes
    // Blue electric arcs between the connected winning symbols + a shockwave.
    const center = cellsCentroid(positions);
    lightningChain(positions);
    sndZap();
    cellShockwave(center);
    // Burst the winning symbol out of the hit cells — bigger win, bigger burst.
    const firstCell = positions[0] && cellEl(positions[0][0], positions[0][1]);
    const emoji = firstCell ? firstCell.textContent.trim() : "🪙";
    if (emoji) emojiExplosion(emoji, center, Math.min(36, 10 + Math.floor(delta / Math.max(wcBet, 1)) * 3));
    dopamineKick(center, delta);
    await flyPlus(center, delta);
    const from = wcRunning;
    const to = wcRunning + delta;
    const dur = Math.min(1300, 320 + Math.sqrt(delta) * 20);
    const start = performance.now();
    const coinIv = setInterval(sndCoin, 80);
    WC.amt.classList.add("wc-bump");
    setTimeout(() => WC.amt.classList.remove("wc-bump"), 260);
    await new Promise((resolve) => {
      function tick(now) {
        const t = Math.min(1, (now - start) / dur);
        const val = Math.round(from + (to - from) * t);
        WC.amt.textContent = val.toLocaleString("de-DE");
        WC.bottom.textContent = val.toLocaleString("de-DE");
        for (let i = 0; i < WIN_TIERS.length; i++) {
          if (!wcFired[i] && val >= wcBet * WIN_TIERS[i].mult) {
            wcFired[i] = true;
            WC.tier.textContent = WIN_TIERS[i].name;
            WC.tier.className = "wc-tier show " + WIN_TIERS[i].cls;
            WC.amt.className = "wc-amount " + WIN_TIERS[i].cls;
            WIN_TIERS[i].fx();
          }
        }
        if (t < 1) requestAnimationFrame(tick);
        else {
          clearInterval(coinIv);
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
    wcRunning = to;
  }

  async function finishCelebration(total) {
    WC.amt.textContent = total.toLocaleString("de-DE");
    WC.bottom.textContent = total.toLocaleString("de-DE");
    await sleep(total >= wcBet * 10 ? 1700 : total >= wcBet * 4 ? 1100 : 650);
    $("#win-celebration").classList.remove("show", "dopamine-on");
  }

  // Escalating win tiers, RELATIVE to the bet (a win only counts as "big" if it
  // actually beats the stake by a meaningful multiple).
  const WIN_TIERS = [
    { mult: 3,   name: "BIG WIN",            cls: "t-big",   fx: () => { quake("big"); confettiBurst(180); zoomPunch(); shockwave(); sideLights(1800); moneyTicker("BIG WIN"); sndBig(); hypeWords(4); } },
    { mult: 7,   name: "MEGA WIN",           cls: "t-mega",  fx: () => { quake("mega"); confettiBurst(260); zoomPunch(); shockwave(); casinoStrobe(); jackpotSirens(1800); sideLights(2200); moneyTicker("MEGA WIN"); sndBig(); hypeWords(7); } },
    { mult: 15,  name: "SUPER MEGA WIN",     cls: "t-super", fx: () => { quake("mega"); confettiBurst(320); shockwave(); casinoStrobe(); zoomPunch(); screenRainbow(1500); jackpotSirens(2400); sideLights(2800); moneyTicker("SUPER MEGA"); sndUltra(); hypeWords(10); } },
    { mult: 30,  name: "ULTRA WIN",          cls: "t-ultra", fx: () => { quake("mega"); coinRain(3500); shockwave(); casinoStrobe(); screenRainbow(2000); jackpotSirens(3200); sideLights(3600); moneyTicker("ULTRA WIN"); sndUltra(); hypeWords(14); } },
    { mult: 60,  name: "WAHNSINNS-WIN!!!",   cls: "t-ultra", fx: () => { quake("mega"); coinRain(4500); confettiBurst(400); shockwave(); casinoStrobe(); screenRainbow(2500); zoomPunch(); jackpotSirens(4200); sideLights(4600); moneyTicker("WAHNSINN"); sndUltra(); hypeWords(20); } },
    { mult: 150, name: "GOTTGLEICHER WIN",   cls: "t-ultra", fx: () => { coinRain(6000); confettiBurst(500); shockwave(); casinoStrobe(); screenRainbow(3000); zoomPunch(); jackpotSirens(5600); sideLights(6200); moneyTicker("GOTTGLEICH"); sndUltra(); hypeWords(28); } },
    { mult: 400, name: "💥 CASINO GESPRENGT 💥", cls: "t-ultra", fx: () => { coinRain(9000); confettiBurst(700); shockwave(); casinoStrobe(); screenRainbow(4000); zoomPunch(); jackpotSirens(9000); sideLights(9000); moneyTicker("CASINO GESPRENGT"); sndUltra(); hypeWords(40); } },
  ];

  function quake(level) {
    // Shake the whole app, not just the stage, for a more violent feel.
    const stage = document.getElementById("app") || $("#slot-stage");
    const cls = level === "mega" ? "shake-strong" : "shake";
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), level === "mega" ? 900 : 600);
  }

  function updateFreeBadge(fs) {
    const b = $("#free-badge");
    const mult = fs && fs.multiplier && fs.multiplier > 1 ? ` · ×${fs.multiplier}` : "";
    b.textContent = `🎁 Freispiele: ${fs.remaining}${mult}`;
    b.classList.add("show");
  }

  // ===============================================================
  // Banner
  // ===============================================================
  let bannerTimer = null;
  function bigBanner(text, cls) {
    let b = $("#slot-banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "slot-banner";
      b.className = "slot-banner";
      $("#slot-stage").appendChild(b);
    }
    b.textContent = text;
    b.className = "slot-banner show " + (cls || "");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove("show"), 1700);
  }

  // ===============================================================
  // Canvas effects (shared canvas; later effect takes over)
  // ===============================================================
  let canvasRaf = null;
  function canvasCtx() {
    const canvas = $("#confetti");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    return { canvas, ctx: canvas.getContext("2d") };
  }
  function confettiBurst(count) {
    const { canvas, ctx } = canvasCtx();
    const rect = $("#slot-stage").getBoundingClientRect();
    const colors = ["#f4d782", "#e7c66b", "#6fe39c", "#5aa0ff", "#ff6b8b", "#fff"];
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const parts = Array.from({ length: count }, () => ({
      x: cx + (Math.random() - 0.5) * rect.width, y: cy + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 26, vy: Math.random() * -24 - 6,
      g: 0.45 + Math.random() * 0.35, size: 7 + Math.random() * 12,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, life: 1,
    }));
    if (canvasRaf) cancelAnimationFrame(canvasRaf);
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of parts) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.012;
        if (p.life > 0 && p.y < canvas.height) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }
      if (alive) canvasRaf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    frame();
  }
  // Raining gold coins — the "money shower" for ULTRA wins.
  function coinRain(duration = 2600) {
    const { canvas, ctx } = canvasCtx();
    const coins = [];
    const end = performance.now() + duration;
    if (canvasRaf) cancelAnimationFrame(canvasRaf);
    function spawn() {
      for (let i = 0; i < 11; i++)
        coins.push({
          x: Math.random() * canvas.width, y: -20,
          vy: 6 + Math.random() * 8, vx: (Math.random() - 0.5) * 3,
          r: 11 + Math.random() * 12, spin: Math.random() * Math.PI, vs: (Math.random() - 0.5) * 0.45,
        });
    }
    function frame(now) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (now < end) spawn();
      for (const c of coins) {
        c.vy += 0.15; c.y += c.vy; c.x += c.vx; c.spin += c.vs;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(Math.max(0.2, Math.abs(Math.cos(c.spin))), 1);
        ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2);
        ctx.fillStyle = "#f4d782"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#b8860b"; ctx.stroke();
        ctx.fillStyle = "#9c7012"; ctx.font = `bold ${c.r}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("$", 0, 0);
        ctx.restore();
      }
      for (let i = coins.length - 1; i >= 0; i--) if (coins[i].y > canvas.height + 40) coins.splice(i, 1);
      if (now < end || coins.length) canvasRaf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvasRaf = requestAnimationFrame(frame);
  }

  // ===============================================================
  // Übertriebene Dopamin-Effekte (liebevolle Parodie auf echte Casinos)
  // ===============================================================
  function dopamineKick(center, delta) {
    sideLights(700);
    moneyTicker("+" + delta.toLocaleString("de-DE"));
    coinFountain(center, Math.min(34, 8 + Math.floor(delta / Math.max(wcBet, 1)) * 2));
    const rw = $("#reels-window");
    if (rw) {
      rw.classList.remove("payblast");
      void rw.offsetWidth;
      rw.classList.add("payblast");
      setTimeout(() => rw.classList.remove("payblast"), 520);
    }
    const stage = $("#slot-stage");
    if (stage) {
      stage.classList.remove("neon-suck");
      void stage.offsetWidth;
      stage.classList.add("neon-suck");
      setTimeout(() => stage.classList.remove("neon-suck"), 620);
    }
  }

  function sideLights(ms = 1000) {
    let el = document.getElementById("slot-side-lights");
    if (!el) {
      el = document.createElement("div");
      el.id = "slot-side-lights";
      el.innerHTML = "<i></i><i></i>";
      document.body.appendChild(el);
    }
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("go"), ms);
  }

  function jackpotSirens(ms = 1500) {
    let el = document.getElementById("slot-sirens");
    if (!el) {
      el = document.createElement("div");
      el.id = "slot-sirens";
      el.innerHTML = "<i></i><i></i>";
      document.body.appendChild(el);
    }
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("go"), ms);
  }

  function moneyTicker(text) {
    let el = document.getElementById("slot-money-ticker");
    if (!el) {
      el = document.createElement("div");
      el.id = "slot-money-ticker";
      document.body.appendChild(el);
    }
    const msg = String(text || "WIN");
    el.innerHTML = Array.from({ length: 8 }, () => `<span>${msg} · 💸 · JACKPOT-FEELING · </span>`).join("");
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("go"), 1500);
  }

  function coinFountain(from, count) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "coin-pop";
      el.textContent = Math.random() < 0.78 ? "🪙" : "💎";
      el.style.left = from.x + "px";
      el.style.top = from.y + "px";
      el.style.setProperty("--dx", ((Math.random() - 0.5) * 360).toFixed(0) + "px");
      el.style.setProperty("--dy", (-130 - Math.random() * 220).toFixed(0) + "px");
      el.style.setProperty("--rot", ((Math.random() - 0.5) * 720).toFixed(0) + "deg");
      el.style.animationDelay = (Math.random() * 0.16).toFixed(2) + "s";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1300);
    }
  }

  function casinoStrobe() {
    let el = document.getElementById("casino-strobe");
    if (!el) {
      el = document.createElement("div");
      el.id = "casino-strobe";
      document.body.appendChild(el);
    }
    el.classList.remove("go");
    void el.offsetWidth; // reflow
    el.classList.add("go");
  }

  // One-shot helper to fire a CSS animation by toggling .go on a singleton div.
  function fireFx(id, ms) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement("div"); el.id = id; document.body.appendChild(el); }
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    if (ms) { clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("go"), ms); }
  }
  // Expanding shockwave ring from the centre.
  function shockwave() { fireFx("shockwave", 750); setTimeout(() => fireFx("shockwave2", 750), 120); }
  // Full-screen rainbow pulse that hue-cycles for the duration.
  function screenRainbow(ms = 1600) { fireFx("screen-rainbow", ms); }

  // A rapid screen + reel flicker fired on EVERY win — constant flashing.
  function flicker() {
    let el = document.getElementById("win-flash");
    if (!el) {
      el = document.createElement("div");
      el.id = "win-flash";
      document.body.appendChild(el);
    }
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
    const win = $("#reels-window");
    if (win) {
      win.classList.remove("flickwin");
      void win.offsetWidth;
      win.classList.add("flickwin");
      setTimeout(() => win.classList.remove("flickwin"), 420);
    }
  }

  const HYPE = ["BOOM!", "WOW!", "UNGLAUBLICH!", "KRASS!", "LETS GOOO!", "🤑", "BIG MONEY!",
    "ZU EINFACH!", "GÖNN DIR!", "💸💸💸", "NICE!", "MASCHINE!", "DU LEGENDE!"];
  function hypeWords(n) {
    const stage = $("#slot-stage").getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const el = document.createElement("div");
        el.className = "hype-word";
        el.textContent = HYPE[(Math.random() * HYPE.length) | 0];
        el.style.left = (stage.left + 20 + Math.random() * (stage.width - 40)) + "px";
        el.style.top = (stage.top + 30 + Math.random() * (stage.height - 60)) + "px";
        el.style.setProperty("--rot", ((Math.random() - 0.5) * 26).toFixed(1) + "deg");
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add("go"));
        setTimeout(() => el.remove(), 1000);
      }, i * 100);
    }
  }

  // Burst the winning symbol outward from a point.
  function emojiExplosion(emoji, from, count) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "emoji-bit";
      el.textContent = emoji;
      el.style.left = from.x + "px";
      el.style.top = from.y + "px";
      document.body.appendChild(el);
      const ang = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 260;
      const dx = Math.cos(ang) * sp;
      const dy = Math.sin(ang) * sp - 120;
      const rot = (Math.random() - 0.5) * 720;
      el.animate(
        [
          { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy + 240}px) rotate(${rot}deg) scale(0.4)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, easing: "cubic-bezier(0.2,0.6,0.3,1)" }
      );
      setTimeout(() => el.remove(), 1500);
    }
  }

  function zoomPunch() {
    const s = $("#slot-stage");
    s.classList.remove("zoompunch");
    void s.offsetWidth;
    s.classList.add("zoompunch");
    setTimeout(() => s.classList.remove("zoompunch"), 430);
  }

  // Satirical "luck manipulation" popup — purely cosmetic, mocks predatory casino UX.
  const LUCK_MSGS = [
    "🍀 Glückssträhne aktiviert!", "🔥 Du bist HEUTE besonders glücklich!", "⭐ VIP-Bonus-Modus läuft!",
    "🎯 Der Algorithmus mag dich gerade!", "💎 Nächster Spin = bestimmt Jackpot!*", "🤖 Glücks-KI auf deiner Seite!",
    "📈 Deine Gewinnchance: SEHR JA!", "👑 Highroller erkannt!", "✨ Die Sterne stehen günstig!",
  ];
  function luckPopup() {
    let el = document.getElementById("luck-popup");
    if (!el) {
      el = document.createElement("div");
      el.id = "luck-popup";
      document.body.appendChild(el);
    }
    el.textContent = LUCK_MSGS[(Math.random() * LUCK_MSGS.length) | 0];
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
  }

  // ===============================================================
  // Session strip — recent spins + win/loss streak (per machine visit)
  // ===============================================================
  let sessionDots = []; // recent base spins: { totalWin, bet, net }
  let streak = 0;       // +N net-win streak, -N no-net-win streak

  function resetSession() {
    sessionDots = [];
    streak = 0;
    const box = $("#slots-session");
    if (box) box.classList.add("hidden");
  }

  function recordSession(totalWin, bet) {
    const net = totalWin - bet;
    if (net > 0) streak = streak > 0 ? streak + 1 : 1;
    else streak = streak < 0 ? streak - 1 : -1;
    sessionDots.push({ totalWin, bet, net });
    if (sessionDots.length > 14) sessionDots.shift();
    renderSession();
  }

  function renderSession() {
    const box = $("#slots-session");
    if (!box) return;
    box.classList.remove("hidden");
    $("#ss-dots").innerHTML = sessionDots.map((d) => {
      const cls = d.net > 0 ? "ss-win" : d.totalWin > 0 ? "ss-partial" : "ss-loss";
      return `<span class="ss-dot ${cls}"></span>`;
    }).join("");
    const st = $("#ss-streak");
    if (streak >= 2) { st.textContent = `🔥 ${streak} Gewinne in Folge!`; st.className = "ss-streak ss-hot"; }
    else if (streak <= -3) { st.textContent = `🥶 ${-streak} Spins ohne Plus…`; st.className = "ss-streak ss-cold"; }
    else { st.textContent = ""; st.className = "ss-streak"; }
  }

  // ===============================================================
  // Lever — pull down to spin
  // ===============================================================
  (function setupLever() {
    const lever = $("#lever");
    const arm = $("#lever-arm");
    if (!lever || !arm) return;
    const MAX = 92;
    let dragging = false;
    let startY = 0;
    let pulled = 0;
    let moved = false;

    const setArm = (y) => {
      arm.style.transform = `translateY(${y}px)`;
    };
    const release = () => {
      arm.style.transition = "transform 0.4s cubic-bezier(0.3,1.6,0.5,1)";
      setArm(0);
      setTimeout(() => (arm.style.transition = ""), 420);
    };
    function fire() {
      if (spinning || freeActive) {
        release();
        return;
      }
      // Snap down then spring back, and spin.
      arm.style.transition = "transform 0.12s ease-in";
      setArm(MAX);
      doSpin();
      setTimeout(release, 150);
    }

    arm.addEventListener("pointerdown", (e) => {
      if (spinning || freeActive) return;
      dragging = true;
      moved = false;
      startY = e.clientY;
      arm.style.transition = "none";
      arm.setPointerCapture && arm.setPointerCapture(e.pointerId);
    });
    arm.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      pulled = Math.max(0, Math.min(MAX, e.clientY - startY));
      if (pulled > 4) moved = true;
      setArm(pulled);
    });
    arm.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      if (pulled >= MAX * 0.55) {
        setArm(MAX);
        if (!spinning && !freeActive) doSpin();
        setTimeout(release, 120);
      } else if (!moved) {
        fire(); // treated as a tap
      } else {
        release();
      }
      pulled = 0;
    });
    // Plain click fallback (and makes it testable).
    lever.addEventListener("click", (e) => {
      if (e.target === arm) return; // handled by pointer flow
      fire();
    });
  })();

  // ===============================================================
  // PvP duel
  // ===============================================================
  const esc = window.Casino.escapeHtml;
  const PVP_VIEWS = [
    "slots-select", "slots-machine",
    "pvp-lobby", "pvp-bot-setup", "pvp-friends-setup",
    "pvp-room", "pvp-result",
  ];
  function showSlotsView(id) {
    PVP_VIEWS.forEach((x) => $("#" + x).classList.toggle("hidden", x !== id));
  }
  function setHud(show) {
    $("#pvp-hud").classList.toggle("hidden", !show);
    $("#slots-lobby-back").classList.toggle("hidden", show);
  }

  let prevOppChips = null;
  function updateHud() {
    if (!pvp) return;
    $("#pvp-you-name").textContent = pvp.youName || "Du";
    $("#pvp-you-chips").textContent = (pvp.chips || 0).toLocaleString("de-DE");
    $("#pvp-you-spins").textContent = (pvp.spinsLeft || 0) + " Spins";
    if (pvp.opponent) {
      $("#pvp-opp-name").textContent = pvp.opponent.name;
      const oppChipsEl = $("#pvp-opp-chips");
      const newChips = pvp.opponent.chips;
      oppChipsEl.textContent = newChips.toLocaleString("de-DE");
      // Flash animation when bot chips change
      if (prevOppChips !== null && prevOppChips !== newChips) {
        oppChipsEl.classList.remove("pvp-chip-flash");
        void oppChipsEl.offsetWidth; // reflow
        oppChipsEl.classList.add("pvp-chip-flash");
        setTimeout(() => oppChipsEl.classList.remove("pvp-chip-flash"), 600);
      }
      prevOppChips = newChips;
      const spinsLeft = pvp.opponent.spinsLeft;
      $("#pvp-opp-spins").textContent = pvp.opponent.done ? "Fertig" : spinsLeft + " Spins";
    } else {
      $("#pvp-opp-name").textContent = "Wartet…";
      $("#pvp-opp-chips").textContent = "–";
      $("#pvp-opp-spins").textContent = "";
      prevOppChips = null;
    }
  }

  function onPvpState(st) {
    pvp = pvp || {};
    pvp.code = st.code;
    pvp.buyIn = st.buyIn;
    pvp.state = st.state;
    pvp.isHost = st.isHost;
    pvp.result = st.result;
    pvp.youName = (st.you && st.you.name) || "Du";
    pvp.opponent = st.opponent;
    pvp.machineId = st.machineId;
    pvp.machineName = st.machineName;
    // Friend duels get their own chat channel; bot duels stay on global.
    if (window.Casino.chat && st.code && !st.vsBot) window.Casino.chat.enterLobby(st.code);
    if (!spinning && st.you) {
      pvp.chips = st.you.chips;
      pvp.spinsLeft = st.you.spinsLeft;
      pvp.done = st.you.done;
    }

    if (st.state === "waiting") {
      pvpMode = false;
      setHud(false);
      showSlotsView("pvp-room");
      renderRoom(st);
    } else if (st.state === "playing") {
      const justEntered = !pvpMode;
      if (justEntered) enterPvpPlay();
      pvpMode = true;
      setHud(true);
      updateHud();
      if (justEntered && st.vsBot && st.opponent) {
        toast(`🤖 Duell gestartet — Freispiele zählen nicht für den Bot!`);
      }
    } else if (st.state === "done") {
      pvpMode = false;
      setHud(false);
      showPvpResult(st.result);
    }
  }

  function renderRoom(st) {
    $("#pvp-room-code").textContent = st.code;
    const you = st.you ? st.you.name : "Du";
    const opp = st.opponent ? st.opponent.name : "— wartet —";
    $("#pvp-room-players").innerHTML =
      `<div class="pvp-room-player">👤 ${esc(you)} <span class="muted">(du)</span></div>` +
      `<div class="pvp-room-player">🆚 ${esc(opp)}</div>` +
      `<div class="muted small">Buy-in ${st.buyIn} 🪙 · Pot ${st.buyIn * 2} 🪙 · ${st.startChips} Match-Chips · ${st.spins} Spins</div>`;
    const startBtn = $("#pvp-start");
    startBtn.disabled = !(st.isHost && st.opponent);
    startBtn.textContent = st.isHost ? "Duell starten" : "Warten auf Host…";
    $("#pvp-room-hint").textContent = st.opponent
      ? (st.isHost ? "Bereit — starte das Duell!" : "Warte, bis der Host startet.")
      : "Teile den Code mit deinem Gegner.";
  }

  function enterPvpPlay() {
    pvpMode = true;
    setHud(true);
    // Hide all sub-views first, then open the assigned machine.
    showSlotsView("slots-machine");
    if (pvp.machineId && machines.some((m) => m.id === pvp.machineId)) {
      openMachine(pvp.machineId);
    } else {
      showSlotsView("slots-select");
    }
    const hint = $("#spin-hint");
    if (hint) hint.textContent = "🕹️ Hebel ziehen";
  }

  function showPvpResult(result) {
    setBodyTheme(null);
    showSlotsView("pvp-result");
    const youWon = !result.tie && result.winner === (pvp && pvp.youName);
    $("#pvp-result-icon").textContent = result.tie ? "🤝" : youWon ? "🏆" : "😢";
    $("#pvp-result-title").textContent = result.tie
      ? "Unentschieden"
      : result.walkover
      ? `${result.winner} gewinnt (Gegner weg)`
      : `${result.winner} gewinnt!`;
    let detail = result.players
      .map((p) => `${esc(p.name)}: <b>${p.chips.toLocaleString("de-DE")}</b> Match-🪙`)
      .join("<br>");
    detail += `<br>Pot: <b>${result.pot.toLocaleString("de-DE")} 🪙</b>`;
    if (result.tie) {
      detail += `<br><span class="muted">Unentschieden — Buy-ins zurückerstattet.</span>`;
    } else {
      if (result.rake > 0)
        detail += `<br><span class="muted">−15% Gebühr (${result.rake.toLocaleString("de-DE")} 🪙)</span>`;
      detail += youWon
        ? `<div class="pvp-win-msg">🎉 +${result.payout.toLocaleString("de-DE")} 🪙 gewonnen!</div>`
        : `<div class="pvp-lose-msg">Diesmal verloren.</div>`;
    }
    $("#pvp-result-detail").innerHTML = detail;
    if (youWon) {
      confettiBurst(180);
      sndBig();
    }
  }

  function pvpExit() {
    if (pvp && pvp.code) socket.emit("pvp:leave");
    pvpMode = false;
    pvp = null;
    prevOppChips = null;
    setHud(false);
    setBodyTheme(null);
    const hint = $("#spin-hint");
    if (hint) hint.textContent = "🕹️ Hebel ziehen";
    if (window.Casino.chat) window.Casino.chat.leaveLobby();
  }

  // Joined a slots-duel from the home-screen lobby browser → open slots; the
  // pvp:state broadcast then shows the duel room automatically.
  window.Casino._pvpJoinCode = (code) => {
    window.Casino.showScreen("slots");
    pvp = null; pvpMode = false; setHud(false); prevOppChips = null;
    socket.emit("pvp:join", { code }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Duell nicht gefunden."); showSlotsView("pvp-lobby"); }
    });
  };

  // ---- PvP entry & navigation ----
  $("#pvp-entry").addEventListener("click", () => {
    pvp = null; pvpMode = false; setHud(false); prevOppChips = null;
    showSlotsView("pvp-lobby");
  });
  $("#pvp-lobby-back").addEventListener("click", () => showSlotsView("slots-select"));

  // Mode selection
  $("#pvp-choose-bot").addEventListener("click", () => showSlotsView("pvp-bot-setup"));
  $("#pvp-choose-friend").addEventListener("click", () => showSlotsView("pvp-friends-setup"));
  $("#pvp-bot-back").addEventListener("click", () => showSlotsView("pvp-lobby"));
  $("#pvp-friends-back").addEventListener("click", () => showSlotsView("pvp-lobby"));

  // Bot start
  $("#pvp-bot-start").addEventListener("click", () => {
    const buyIn = parseInt($("#pvp-bot-buyin").value, 10);
    socket.emit("pvp:createBot", { buyIn }, (res) => {
      if (!res || !res.ok) toast((res && res.error) || "Konnte Bot-Duell nicht starten.");
    });
  });

  // Friends: create / join
  $("#pvp-create").addEventListener("click", () => {
    const buyIn = parseInt($("#pvp-buyin").value, 10);
    socket.emit("pvp:create", { buyIn }, (res) => {
      if (!res || !res.ok) toast((res && res.error) || "Konnte Duell nicht erstellen.");
    });
  });
  $("#pvp-join").addEventListener("click", pvpJoinFromInput);
  $("#pvp-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });
  $("#pvp-code").addEventListener("keydown", (e) => { if (e.key === "Enter") pvpJoinFromInput(); });
  function pvpJoinFromInput() {
    const code = $("#pvp-code").value.trim().toUpperCase();
    $("#pvp-join-error").textContent = "";
    if (code.length !== 4) { $("#pvp-join-error").textContent = "Code besteht aus 4 Zeichen."; return; }
    socket.emit("pvp:join", { code }, (res) => {
      if (!res || !res.ok) $("#pvp-join-error").textContent = (res && res.error) || "Match nicht gefunden.";
    });
  }

  // Room / result navigation
  $("#pvp-room-back").addEventListener("click", () => { pvpExit(); showSlotsView("pvp-lobby"); });
  $("#pvp-start").addEventListener("click", () => socket.emit("pvp:start"));
  $("#pvp-quit").addEventListener("click", () => { pvpExit(); showSlotsView("pvp-lobby"); });
  $("#pvp-result-back").addEventListener("click", () => { pvp = null; prevOppChips = null; showSlotsView("pvp-lobby"); });
  socket.on("pvp:state", onPvpState);

  // Leaving the slots screen during a duel forfeits it.
  new MutationObserver(() => {
    if (pvpMode && !slotsScreen.classList.contains("active") && !spinning && !freeActive) pvpExit();
  }).observe(slotsScreen, { attributes: true, attributeFilter: ["class"] });

  // ===============================================================
  // Paytable modal
  // ===============================================================
  $("#paytable-btn").addEventListener("click", showPaytable);
  $("#paytable-close").addEventListener("click", () => $("#paytable-modal").classList.add("hidden"));

  function showPaytable() {
    const body = $("#paytable-body");
    const bet = machine.bets[betIndex];
    const scale = machine.payScale;
    const coins = (raw) => Math.round((raw * scale) / 20 * bet); // payout in coins at current bet
    $("#paytable-title").textContent = machine.name;
    const rows = [];

    if (machine.mode === "cluster") {
      rows.push(`<p class="pt-note">Auszahlung in 🪙 bei Einsatz <b>${bet}</b> — bei 5+ verbundenen Symbolen (Cluster).</p>`);
      const syms = Object.keys(machine.clusterPays).sort(
        (a, b) => coins(topVal(machine.clusterPays[b])) - coins(topVal(machine.clusterPays[a]))
      );
      for (const sym of syms) {
        const table = machine.clusterPays[sym];
        const parts = Object.keys(table).map(Number).sort((a, b) => a - b)
          .map((sz) => `<span class="pt-cnt">${sz}+</span> ${coins(table[sz]).toLocaleString("de-DE")}`).join("");
        rows.push(`<div class="pt-row"><span class="pt-sym">${symbolHtml(symbolAsset(machine, sym) || machine.emojis[sym], "pt-symbol-img")}</span><div class="pt-vals">${parts}</div></div>`);
      }
    } else {
      const anywhere = machine.mode === "anywhere";
      const label = machine.mode === "ways" ? "pro Way" : anywhere ? "irgendwo auf dem Feld" : "pro Linie";
      rows.push(`<p class="pt-note">Auszahlung in 🪙 bei Einsatz <b>${bet}</b> (${label}). Wild ${symbolHtml(symbolAsset(machine, machine.wild) || machine.emojis[machine.wild], "pt-symbol-img")} ersetzt alle außer Scatter.</p>`);
      const syms = Object.keys(machine.pays).sort(
        (a, b) => coins(topVal(machine.pays[b])) - coins(topVal(machine.pays[a]))
      );
      for (const sym of syms) {
        const table = machine.pays[sym];
        const cnts = Object.keys(table).map(Number).sort((a, b) => a - b);
        const parts = cnts.map((n) => {
          // "anywhere" pays use thresholds (3+, 4+, …); lines/ways use exact counts.
          const suffix = anywhere ? "+" : "×";
          return `<span class="pt-cnt">${n}${suffix}</span> ${coins(table[n]).toLocaleString("de-DE")}`;
        }).join("");
        rows.push(`<div class="pt-row"><span class="pt-sym">${symbolHtml(symbolAsset(machine, sym) || machine.emojis[sym], "pt-symbol-img")}</span><div class="pt-vals">${parts}</div></div>`);
      }
    }
    if (machine.mystery) {
      rows.push(`<div class="pt-row pt-scatter"><span class="pt-sym">${symbolHtml(symbolAsset(machine, machine.mystery) || machine.emojis[machine.mystery], "pt-symbol-img")}</span><div class="pt-vals">Mystery-Alge — wird nach dem Spin zu Symbol, Wild oder Bonus aufgedeckt</div></div>`);
    }
    if (machine.scatter) {
      rows.push(`<div class="pt-row pt-scatter"><span class="pt-sym">${symbolHtml(symbolAsset(machine, machine.scatter) || machine.emojis[machine.scatter], "pt-symbol-img")}</span><div class="pt-vals">Scatter — ${machine.freeSpins.trigger}+ lösen ${machine.freeSpins.count} Freispiele aus</div></div>`);
    }
    body.innerHTML = rows.join("");
    $("#paytable-modal").classList.remove("hidden");
  }
  function topVal(table) {
    return Math.max(...Object.values(table));
  }
})();
