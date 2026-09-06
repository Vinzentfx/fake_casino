"use strict";

/* ============================================================
   Fake Casino – Economy client
   • Work: a capped clicker (starter aid only).
   • Stadt: ECHTE Karte von Porta Westfalica — Territorium & Status.
     Übersicht (Stadtteile mit Boss & Index) → Ortsteil (echte
     Häuser + Straßen). Besitz malt die Karte in deiner Farbe:
     Straßen-Monopole, Stadtteil-Boss, Trophäen-Gebäude,
     Ortsteil-Spekulation, Wohnsitz. Server ist autoritativ.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const idxStr = (i) => String(i).replace(".", ",");
  let workState = null;
  let workTick = null;
  let routeAnswer = [];
  let switchBits = [];
  let keypadInput = "";
  let currentTaskKey = "";

  function taskSep(task) {
    return task && task.type === "route" ? " → " : " · ";
  }

  // ── Work (capped clicker) ────────────────────────────────────────────────
  function applyWorkState(s) {
    if (!s || !s.ok) return;
    const factor = s.hustle && s.hustle.factor ? s.hustle.factor : 1;
    const power = Math.max(1, Math.round(s.clickPower * (s.schulleiter ? 3 : 1) * factor));
    $("#clicker-power").textContent = power;
    $("#work-power").textContent = power + " 🪙" + (s.schulleiter ? " (🏫 Schulleiter ×3)" : "");
    renderHustle(s.hustle);
    renderJobs(s.jobs);
    const btn = $("#work-upgrade-btn");
    const costEl = $("#work-upgrade-cost");
    if (s.maxed) {
      costEl.textContent = "max. ausgebaut";
      btn.disabled = true;
      btn.textContent = "✓ Voll ausgebaut";
    } else {
      costEl.textContent = fmt(s.upgradeCost) + " 🪙";
      btn.disabled = false;
      btn.textContent = "⬆️ Upgrade kaufen";
    }
  }

  /* Emoji und Beschreibung kommen vom Server. Vorher lagen sie hier als
     zweite Kopie und beschrieben nach dem Umbau noch die alten Aufgaben
     ("Route, Scanner oder Pakete"), obwohl es die nicht mehr gibt. */
  function jobMeta(job) {
    return { icon: job.emoji || "💼", text: job.hint || "Aktiver Job." };
  }

  function timeLeft(ts) {
    const ms = Math.max(0, Math.ceil((Number(ts) || 0) - Date.now()));
    if (!ms) return "";
    const s = Math.ceil(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  }

  function renderJobs(jobs) {
    const box = $("#work-jobs");
    if (!box || !jobs) return;
    workState = jobs;
    const tag = jobs.dayEarned || 0, tagMax = jobs.dayCap || 1;
    $("#work-job-day-earned").textContent = fmt(tag);
    $("#work-job-day").textContent = `${fmt(tag)} / ${fmt(tagMax)} 🪙 Tagesgrenze`;
    const bar = $("#work-day-bar")?.firstElementChild;
    if (bar) bar.style.width = Math.min(100, Math.round((100 * tag) / tagMax)) + "%";
    $("#work-job-hour").textContent = `${fmt(jobs.hourEarned || 0)} / ${fmt(jobs.hourCap || 0)} 🪙`;

    const f = jobs.factor || {};
    const faktor = f.factor || 1;
    $("#work-job-factor-value").textContent = faktor.toLocaleString("de-DE") + "×";
    // Der nackte Faktor sagt niemandem etwas. Erklaeren, woher er kommt.
    $("#work-job-factor").textContent = faktor >= 2.5
      ? "Je weniger du besitzt, desto mehr zahlt die Schicht."
      : faktor >= 1
        ? `Bei ${fmt(f.smoothedNetWorth || f.netWorth || 0)} 🪙 Vermögen.`
        : "Du bist längst reich — hier gibt es nur noch wenig.";
    renderTask(jobs.activeTask);
    box.innerHTML = (jobs.jobs || []).map((j) => {
      const m = jobMeta(j);
      const cool = timeLeft(j.readyAt);
      const shift = j.id === "shift" && jobs.activeShift;
      const shiftLeft = shift ? timeLeft(jobs.activeShift.readyAt) : "";
      const blockiert = jobs.activeTask || cool || (j.id === "shift" && shift);
      const label = shift
        ? (shiftLeft ? `Läuft ${shiftLeft}` : "Abholen")
        : (cool ? cool : (j.id === "shift" ? "Schicht starten" : "Antreten"));
      // Wartezeit als Fortschritt am Kartenrand, damit man sieht, wie lange
      // es noch dauert, ohne die Sekunden zu lesen.
      const anteil = cool && j.cooldownMs
        ? Math.max(0, Math.min(1, (j.readyAt - Date.now()) / j.cooldownMs))
        : 0;
      return `<button class="work-job${blockiert ? " is-busy" : ""}" style="--h:${j.hue || 40}"
                      data-job-action="${j.id}" ${blockiert ? "disabled" : ""}>
        <span class="work-job-icon">${m.icon}</span>
        <span class="work-job-main">
          <span class="work-job-head"><b>${escapeHtml(j.label)}</b></span>
          <span class="work-job-hint">${escapeHtml(m.text)}</span>
        </span>
        <span class="work-job-right">
          <span class="work-job-pay">${fmt(j.payout)} 🪙</span>
          ${j.xp ? `<span class="work-job-xp">${fmt(j.xp)} XP</span>` : ""}
          <span class="work-job-cta">${label}</span>
        </span>
        <span class="work-job-cool" style="width:${Math.round(anteil * 100)}%"></span>
      </button>`;
    }).join("");
    if (jobs.activeShift && !timeLeft(jobs.activeShift.readyAt)) {
      // Achtung: die ganze Karte IST der Knopf. Nur die Beschriftung
      // austauschen, nicht den Karteninhalt.
      const karte = box.querySelector('[data-job-action="shift"]');
      if (karte) {
        karte.disabled = false;
        karte.classList.remove("is-busy");
        const cta = karte.querySelector(".work-job-cta");
        if (cta) cta.textContent = "Abholen";
      }
    }
    if (!workTick) workTick = setInterval(() => { if (workState) renderJobs(workState); }, 1000);
  }

  function renderTask(task, force = false) {
    const panel = $("#work-task-panel");
    const box = $("#work-task-box");
    if (!panel || !box) return;
    if (!task) {
      panel.classList.add("hidden");
      box.innerHTML = "";
      routeAnswer = [];
      switchBits = [];
      keypadInput = "";
      currentTaskKey = "";
      return;
    }
    const taskKey = `${task.id}:${task.type}:${task.expiresAt}`;
    if (!force && currentTaskKey === taskKey) {
      const timer = box.querySelector(".work-task-head > span");
      if (timer) timer.textContent = timeLeft(task.expiresAt) || "jetzt";
      return;
    }
    if (currentTaskKey !== taskKey) {
      routeAnswer = [];
      switchBits = [];
      keypadInput = "";
      currentTaskKey = taskKey;
    }
    panel.classList.remove("hidden");
    const left = timeLeft(task.expiresAt);
    let inner = `<div class="work-task-head"><div><b>${escapeHtml(task.title || "Aufgabe")}</b><p class="muted small">${escapeHtml(task.prompt || "")}</p></div><span>${left || "jetzt"}</span></div>`;
    if (task.type === "wechseln") {
      // Chips antippen, Reihenfolge egal. Der Server sortiert vor dem Vergleich.
      const summe = routeAnswer.reduce((a, b) => a + Number(b), 0);
      inner += `<div class="work-chip-row">${(task.chips || []).map((c) =>
        `<button class="work-chip" data-pick="${c}">${fmt(c)}</button>`).join("")}</div>`;
      inner += `<div class="work-input-line">Gelegt: <b id="work-route-current">${
        routeAnswer.length ? routeAnswer.map((c) => fmt(c)).join(" + ") + " = " + fmt(summe) + " 🪙" : "–"
      }</b></div>`;
      inner += `<div class="work-task-actions"><button class="btn-secondary" id="work-task-reset">Zurück</button><button class="btn-primary" id="work-task-submit">Auszahlen</button></div>`;
    } else if (task.type === "bestellung") {
      inner += `<div class="work-route-target">${(task.target || []).map(escapeHtml).join(" → ")}</div>`;
      inner += `<div class="work-task-buttons">${(task.options || []).map((o) =>
        `<button class="btn-secondary work-pick-btn" data-pick="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("")}</div>`;
      inner += `<div class="work-input-line">Reihenfolge: <b id="work-route-current">${routeAnswer.join(" → ") || "–"}</b></div>`;
      inner += `<div class="work-task-actions"><button class="btn-secondary" id="work-task-reset">Zurück</button><button class="btn-primary" id="work-task-submit">Ausliefern</button></div>`;
    } else if (task.zeilen) {
      // Wettscheine pruefen: erst die Zeilen lesen, dann den falschen tippen.
      inner += `<div class="work-slips">${task.zeilen.map((z) =>
        `<div class="work-slip">${escapeHtml(z)}</div>`).join("")}</div>`;
      inner += `<div class="work-task-buttons">${(task.options || []).map((o) =>
        `<button class="btn-secondary work-crate-btn" data-answer="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("")}</div>`;
    } else if (task.options) {
      // Alle uebrigen sind Auswahlfragen (Auszahlung, Quote, Grundstrategie).
      inner += `<div class="work-task-buttons work-choice">${(task.options || []).map((o) =>
        `<button class="btn-secondary work-crate-btn" data-answer="${escapeHtml(o)}">${escapeHtml(o)}${
          task.suffix ? " " + task.suffix : ""}</button>`).join("")}</div>`;
    } else {
      inner += `<div class="work-code-display">${escapeHtml(task.code || "")}</div>`;
      inner += `<input id="work-code-input" class="work-code-input" inputmode="numeric" autocomplete="off" placeholder="Code eingeben" />`;
      inner += `<button class="btn-primary" id="work-task-submit" style="width:100%;margin-top:8px">Senden</button>`;
    }
    box.innerHTML = inner;
  }

  function submitTask(answer) {
    socket.emit("work:taskComplete", { answer }, (res) => {
      if (!res || !res.ok) {
        if (res && res.jobs) renderJobs(res.jobs);
        toast((res && res.error) || "Aufgabe fehlgeschlagen.");
        return;
      }
      if (res.account) applyAccount(res.account);
      if (res.jobs) renderJobs(res.jobs);
      const extra = res.outcome === "bonus" ? " · Bonus!" : (res.outcome === "schwach" ? " · schwacher Auftrag" : "");
      if (res.richtig === false) {
        // Kein Totalausfall: sagen, was richtig gewesen waere, damit man es
        // beim naechsten Mal weiss.
        window.Casino.sound.play("error");
        toast(`Daneben. Richtig wäre: ${res.loesung || "?"} · Trostlohn +${fmt(res.earned || 0)} 🪙`);
      } else {
        window.Casino.sound.play("cash");
        toast(`✓ +${fmt(res.earned || 0)} 🪙${res.xp ? ` · +${fmt(res.xp)} XP` : ""}${extra}${res.capped ? " · Cap erreicht" : ""}`);
      }
    });
  }

  function renderHustle(h) {
    const box = $("#work-hustle");
    if (!box || !h) return;
    const pct = h.target ? Math.min(100, Math.round((100 * (h.clicks || 0)) / h.target)) : 0;
    box.innerHTML = `
      <div class="stat-row"><span>Hustle-Bonus</span><b>${fmt(h.clicks || 0)}/${fmt(h.target || 25)}</b></div>
      <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <p class="muted small" style="margin:.35rem 0 0">Faktor: ${(h.factor || 1).toLocaleString("de-DE")}× bei ${fmt(h.smoothedNetWorth || h.netWorth || 0)} 🪙 Wert · Bonus-Cap: ${fmt(h.hourEarned || 0)}/${fmt(h.hourCap || 0)} 🪙 pro Stunde · ${fmt(h.dayEarned || 0)}/${fmt(h.dayCap || 0)} 🪙 heute</p>`;
  }

  function loadWork() {
    socket.emit("economy:state", applyWorkState);
  }

  $("#clicker-btn").addEventListener("click", () => {
    socket.emit("work:click", (res) => {
      if (!res || !res.ok) return;
      applyAccount(res.account);
      if (res.hustle) renderHustle(res.hustle);
      if (res.jobs) renderJobs(res.jobs);
      flyFromClicker("+" + res.earned + (res.hustleBonus ? " Hustle!" : ""));
    });
  });

  $("#work-jobs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-job-action]");
    if (!btn) return;
    const id = btn.dataset.jobAction;
    const event = id === "shift" && workState && workState.activeShift && !timeLeft(workState.activeShift.readyAt)
      ? "work:shiftClaim"
      : "work:jobStart";
    const done = (res) => {
      if (!res || !res.ok) {
        if (res && res.jobs) renderJobs(res.jobs);
        toast((res && res.error) || "Job nicht möglich.");
        return;
      }
      if (res.account) applyAccount(res.account);
      if (res.jobs) renderJobs(res.jobs);
      if (res.started) { toast("Schicht gestartet. Gleich wieder abholen."); return; }
      if (res.task) { toast("Aufgabe gestartet. Löse sie zum Kassieren."); return; }
    };
    if (event === "work:shiftClaim") socket.emit(event, done);
    else socket.emit(event, { id }, done);
  });

  $("#work-task-panel")?.addEventListener("click", (e) => {
    const pickBtn = e.target.closest(".work-pick-btn");
    if (pickBtn) {
      routeAnswer.push(pickBtn.dataset.pick || "");
      const cur = $("#work-route-current");
      const task = workState && workState.activeTask;
      if (cur) cur.textContent = routeAnswer.join(taskSep(task)) || "–";
      return;
    }
    const chip = e.target.closest(".work-chip");
    if (chip) {
      routeAnswer.push(Number(chip.dataset.pick) || 0);
      renderTask(workState && workState.activeTask, true);
      return;
    }
    const crate = e.target.closest(".work-crate-btn");
    if (crate) { submitTask(crate.dataset.answer || ""); return; }
    const scan = e.target.closest(".work-scan-card");
    if (scan) { submitTask(scan.dataset.answer || ""); return; }
    const key = e.target.closest(".work-key");
    if (key) {
      const k = key.dataset.key;
      if (k === "OK") submitTask(keypadInput);
      else if (k === "⌫") keypadInput = keypadInput.slice(0, -1);
      else if (keypadInput.length < 6) keypadInput += k;
      const task = workState && workState.activeTask;
      renderTask(task, true);
      return;
    }
    const meter = e.target.closest(".work-meter-slot");
    if (meter) { submitTask(meter.dataset.answer || ""); return; }
    const sw = e.target.closest(".work-switch");
    if (sw) {
      const i = parseInt(sw.dataset.switch, 10);
      switchBits[i] = switchBits[i] === "1" ? "0" : "1";
      const task = workState && workState.activeTask;
      renderTask(task, true);
      return;
    }
    if (e.target.closest("#work-task-reset")) {
      routeAnswer = [];
      switchBits = [];
      keypadInput = "";
      const task = workState && workState.activeTask;
      renderTask(task, true);
      return;
    }
    if (e.target.closest("#work-task-submit")) {
      const task = workState && workState.activeTask;
      if (!task) return;
      if (task.type === "wechseln" || task.type === "bestellung") submitTask(routeAnswer);
      else submitTask($("#work-code-input")?.value || "");
    }
  });

  $("#work-upgrade-btn").addEventListener("click", () => {
    const err = $("#work-error");
    err.textContent = "";
    socket.emit("work:upgrade", (res) => {
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Fehler."; return; }
      applyAccount(res.account);
      loadWork();
      toast(`Klick-Stärke: +${res.clickPower} 🪙`);
    });
  });

  function flyFromClicker(text) {
    const btn = $("#clicker-btn");
    if (!btn) return;
    const b = btn.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "click-float";
    el.textContent = text + " 🪙";
    el.style.left = b.left + b.width / 2 + (Math.random() - 0.5) * 40 + "px";
    el.style.top = b.top + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  // ── City state ───────────────────────────────────────────────────────────
  let view = "overview";
  let overview = null;
  let district = null;
  let selectedId = null;
  let vb = null, fitVb = null;

  const CLS_FILL = {
    residential: "#3e5748", civic: "#4a4f6e", kiosk: "#5e5636", cafe: "#5d4a33",
    shop: "#33565e", hotel: "#59335e", factory: "#5a4a3a", casino: "#5a2a6e", bank: "#6e5a2a",
  };
  const LM_EMOJI = { school: "🏫", station: "🚉", park: "🏞️", sport: "🏟️" };

  function loadCity() {
    socket.emit("city:state", (res) => {
      if (!res || !res.ok) return;
      overview = res.overview;
      renderEmpire(overview.me);
      // Nach jedem Kauf aendern sich Besitz UND die eigene Staffel, die
      // zwischengespeicherten Hauslisten waeren dann veraltet.
      besitzerHaeuser = {};
      renderBoard();
      if (view === "district" && district) return loadDistrict(district.id, true);
      view = "overview";
      renderOverview();
      renderDetail();
    });
  }

  function loadDistrict(id, keepView) {
    socket.emit("city:district", { id }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Stadtteil nicht ladbar."); return; }
      district = res.district;
      view = "district";
      if (!keepView) { selectedId = null; vb = null; }
      renderDistrict();
      renderDetail();
    });
  }

  // ── "Dein Imperium" panel ────────────────────────────────────────────────
  function renderEmpire(me) {
    const box = $("#biz-buffs");
    if (!box) return;
    if (!me || !me.houses) {
      box.innerHTML = `<p class="muted small" style="margin:0;text-align:center">Noch kein Besitz. Kauf dein erstes Haus — komplette Straßen färben die Karte in deiner Farbe!</p>`;
      return;
    }
    const chips = [];
    chips.push(`<span class="buff-chip" style="border-color:${me.color};color:${me.color}">🏠 ${me.houses} ${me.houses === 1 ? "Haus" : "Häuser"}</span>`);
    chips.push(`<span class="buff-chip">💎 ${fmt(me.value)} 🪙 Wert</span>`);
    if (me.streets) chips.push(`<span class="buff-chip">👑 ${me.streets} ${me.streets === 1 ? "Straße" : "Straßen"} komplett</span>`);
    if (me.hasGolden) chips.push(`<span class="buff-chip" style="border-color:#ffd700;color:#ffd700">✨ Goldene Straße (2× Tribut)</span>`);
    for (const s of me.sets || []) chips.push(`<span class="buff-chip">${s.emoji} ${escapeHtml(s.label)} (+${s.tribute.toLocaleString("de-DE")}/Std)</span>`);
    for (const t of me.trophies) chips.push(`<span class="buff-chip">${t.emoji} ${escapeHtml(t.title)}</span>`);
    for (const d of me.bossOf) chips.push(`<span class="buff-chip">🥇 Boss von ${escapeHtml(d)}</span>`);
    // "Meine Immobilien" — tap to jump to the building on the map.
    let list = `<details class="empire-list"><summary>📋 Meine Immobilien (${me.houses})</summary><div class="empire-items">`;
    for (const p of me.properties || []) {
      list += `<button class="empire-item" data-goto-d="${p.did}" data-goto-b="${p.id}">${p.emoji} ${escapeHtml(p.label)}<small>${escapeHtml(p.districtName)} · ${fmt(p.price)} 🪙</small></button>`;
    }
    list += `</div></details>`;
    box.innerHTML = chips.join("") + list;
  }

  // ── "Wem gehört Porta" ───────────────────────────────────────────────────
  /*
   * Die Uebernahme gab es schon immer (150 %, der Vorbesitzer bekommt den
   * Marktwert), aber sie stand nur an einem einzelnen Haus tief in einem
   * Ortsteil. Wer neu anfing, sah nur eine Karte voller fremder Farben und
   * hatte kein Ziel. Hier steht jetzt, wem wie viel gehoert, und ein Tipp auf
   * eine Zeile listet die Haeuser dieser Person mit dem Preis, den DU dafuer
   * zahlen wuerdest — billigste zuerst, damit sichtbar ist, was erreichbar ist.
   */
  let offenerBesitzer = null;
  let besitzerHaeuser = {};

  function renderBoard() {
    const box = $("#city-board");
    const hint = $("#city-board-hint");
    if (!box || !overview || !overview.board) return;
    const b = overview.board;

    if (hint) {
      const staffel = overview.ownerScale || 1;
      const teile = [`${fmt(b.besetzt)} von ${fmt(b.gesamt)} Gebäuden haben einen Besitzer, ${fmt(b.frei)} sind noch frei.`];
      if (staffel > 1.01) {
        teile.push(`Dein Kaufpreis liegt bei ${staffel.toLocaleString("de-DE")}× — je mehr du besitzt, desto teurer wird das nächste Haus (höchstens ${overview.ownerScaleMax}×).`);
      } else {
        teile.push("Jedes Haus lässt sich übernehmen: du zahlst 50 % Aufschlag, der Vorbesitzer bekommt den vollen Marktwert.");
      }
      hint.textContent = teile.join(" ");
    }

    if (!b.liste.length) {
      box.innerHTML = '<p class="muted small" style="margin:0">Noch gehört niemandem etwas. Die ganze Stadt ist frei.</p>';
      return;
    }

    box.innerHTML = b.liste.map((z) => {
      const offen = offenerBesitzer === z.key;
      const marken = [];
      if (z.streets) marken.push(`👑 ${z.streets}`);
      if (z.trophies) marken.push(`🏆 ${z.trophies}`);
      return `<div class="cb-block${offen ? " open" : ""}">
          <button class="cb-row${z.isMe ? " mine" : ""}" data-owner="${escapeHtml(z.key)}" type="button">
            <span class="cb-rank">${z.rang}</span>
            <span class="cb-dot" style="background:${z.color}"></span>
            <span class="cb-name">${escapeHtml(z.name)}${z.isMe ? " (du)" : ""}</span>
            <span class="cb-num">🏠 ${fmt(z.houses)}</span>
            <span class="cb-num cb-value">${fmt(z.value)} 🪙</span>
            ${marken.length ? `<span class="cb-tags">${marken.join(" ")}</span>` : ""}
            <span class="cb-caret">${offen ? "▾" : "▸"}</span>
          </button>
          ${offen ? `<div class="cb-items" data-items="${escapeHtml(z.key)}">${renderBesitzerListe(z)}</div>` : ""}
        </div>`;
    }).join("");
  }

  function renderBesitzerListe(z) {
    const liste = besitzerHaeuser[z.key];
    if (!liste) return '<p class="muted small" style="margin:6px 0">Lädt…</p>';
    if (!liste.length) return '<p class="muted small" style="margin:6px 0">Nichts gefunden.</p>';
    const kopf = z.isMe
      ? '<p class="muted small" style="margin:6px 0">Deine Häuser, günstigste zuerst.</p>'
      : '<p class="muted small" style="margin:6px 0">Günstigste zuerst. Der Preis ist, was DU zahlen würdest.</p>';
    return kopf + liste.map((p) => `
        <button class="cb-item" data-goto-d="${p.did}" data-goto-b="${p.id}" type="button">
          <span class="cb-item-main">${p.emoji} ${escapeHtml(p.label)}<small>${escapeHtml(p.districtName)}${p.st ? " · " + escapeHtml(p.st) : ""}</small></span>
          <b>${p.mine ? fmt(p.price) + " 🪙 Wert" : "Übernehmen " + fmt(p.takeoverCost) + " 🪙"}</b>
        </button>`).join("");
  }

  $("#city-board")?.addEventListener("click", (e) => {
    const zeile = e.target.closest("[data-owner]");
    if (zeile) {
      const key = zeile.dataset.owner;
      offenerBesitzer = offenerBesitzer === key ? null : key;
      window.Casino.sound.play("tick");
      renderBoard();
      if (offenerBesitzer && !besitzerHaeuser[key]) {
        socket.emit("city:owner", { owner: key }, (res) => {
          if (!res || !res.ok) return;
          besitzerHaeuser[res.owner] = res.properties;
          if (offenerBesitzer === res.owner) renderBoard();
        });
      }
      return;
    }
    const ziel = e.target.closest("[data-goto-b]");
    if (ziel) springeZuGebaeude(ziel.dataset.gotoD, parseInt(ziel.dataset.gotoB, 10));
  });

  /** Ortsteil laden, Haus auswaehlen und die Karte dorthin schieben. */
  function springeZuGebaeude(did, bid) {
    socket.emit("city:district", { id: did }, (res) => {
      if (!res || !res.ok) return;
      district = res.district;
      district.residents = district.residents || {};
      view = "district";
      selectedId = bid;
      const b = district.buildings.find((x) => x.id === bid);
      vb = b ? { x: b.c[0] - 200, y: b.c[1] - 150, w: 400, h: 300 } : null;
      renderDistrict();
      renderDetail();
      document.querySelector(".city-map-box").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Jump from the property list straight to the building on the map.
  $("#biz-buffs").addEventListener("click", (e) => {
    const item = e.target.closest(".empire-item");
    if (!item) return;
    springeZuGebaeude(item.dataset.gotoD, parseInt(item.dataset.gotoB, 10));
  });

  // ── Geometry helpers ─────────────────────────────────────────────────────
  const pathOf = (pts) => "M" + pts.map((p) => p[0] + " " + p[1]).join("L") + "Z";
  const openPath = (pts) => "M" + pts.map((p) => p[0] + " " + p[1]).join("L");
  function bboxOf(ptsList) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const pts of ptsList) for (const [x, y] of pts) {
      if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  }
  const ringCentroid = (pts) => {
    let x = 0, y = 0;
    for (const p of pts) { x += p[0]; y += p[1]; }
    return [x / pts.length, y / pts.length];
  };
  const setViewBox = () => { if (vb) $("#city-map").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); };

  // ── Overview: all districts ──────────────────────────────────────────────
  function renderOverview() {
    const svg = $("#city-map");
    if (!svg || !overview) return;
    $("#city-back").classList.add("hidden");
    $("#city-zoom").classList.add("hidden");
    $("#city-title").textContent = overview.city;
    $("#city-subtitle").innerHTML = `Erobere die echte Stadt: Häuser kaufen, Straßen-Monopole sichern, Stadtteil-Boss werden. Chips kommen aus dem Casino — hier zeigst du sie her.`;
    const lp = $("#land-price");
    if (lp) {
      lp.innerHTML = (overview.casinoOwnerName ? `🎰 ${escapeHtml(overview.casinoOwnerName)}` : "🎰 frei")
        + (overview.bankOwnerName ? ` · 🏦 ${escapeHtml(overview.bankOwnerName)}` : " · 🏦 frei");
    }

    const rings = overview.districts.filter((d) => d.ring && d.ring.length > 2);
    const bb = bboxOf(rings.map((d) => d.ring));
    const pad = Math.max(bb.w, bb.h) * 0.03;
    svg.setAttribute("viewBox", `${bb.x1 - pad} ${bb.y1 - pad} ${bb.w + 2 * pad} ${bb.h + 2 * pad}`);

    const fs = Math.max(bb.w, bb.h) / 42;
    const parts = [];
    for (const d of rings) {
      const fill = d.mine > 0 ? "#3d5a3f" : "#33463a";
      const stroke = d.boss ? d.boss.color : "rgba(255,255,255,0.35)";
      parts.push(`<g class="dist" data-d="${d.id}" style="cursor:pointer">`);
      parts.push(`<path d="${pathOf(d.ring)}" fill="${fill}" stroke="${stroke}" stroke-width="${d.boss ? fs / 5 : fs / 8}" />`);
      const [cx, cy] = ringCentroid(d.ring);
      const marks = (d.hasCasino ? "🎰" : "") + (d.hasBank ? "🏦" : "");
      const trendPct = Math.round((d.idx - 1) * 100);
      const trend = `${d.idx >= 1 ? "📈" : "📉"} ${trendPct >= 0 ? "+" : ""}${trendPct}%`;
      parts.push(`<text x="${cx}" y="${cy - fs * 0.9}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="#fff" stroke="#20291f" stroke-width="${fs / 9}" paint-order="stroke">${escapeHtml(d.name)}${marks ? " " + marks : ""}</text>`);
      parts.push(`<text x="${cx}" y="${cy + fs * 0.3}" text-anchor="middle" font-size="${fs * 0.62}" fill="rgba(255,255,255,0.85)" stroke="#20291f" stroke-width="${fs / 12}" paint-order="stroke">${d.total} Häuser · ${trend}${d.monos ? ` · ${d.monos}👑` : ""}</text>`);
      if (d.boss)
        parts.push(`<text x="${cx}" y="${cy + fs * 1.4}" text-anchor="middle" font-size="${fs * 0.68}" font-weight="800" fill="${d.boss.color}" stroke="#20291f" stroke-width="${fs / 12}" paint-order="stroke">🥇 ${escapeHtml(d.boss.name)}${d.boss.isMe ? " (Du)" : ""}</text>`);
      parts.push(`</g>`);
    }
    svg.innerHTML = parts.join("");
  }

  // ── District: real buildings, streets, territory colours ────────────────
  function renderDistrict() {
    const svg = $("#city-map");
    if (!svg || !district) return;
    $("#city-back").classList.remove("hidden");
    $("#city-zoom").classList.remove("hidden");
    $("#city-title").textContent = district.name;
    const mine = district.buildings.filter((b) => b.mine).length;
    const monoStr = district.monopolies.length
      ? ` · 👑 ${district.monopolies.map((m) => escapeHtml(m.st)).slice(0, 3).join(", ")}${district.monopolies.length > 3 ? "…" : ""}`
      : "";
    $("#city-subtitle").innerHTML = `${district.buildings.length} echte Häuser${mine ? ` — <b>${mine}</b> deins` : ""}${monoStr}`;
    const lp = $("#land-price");
    if (lp) {
      const pct = Math.round((district.idx - 1) * 100);
      lp.innerHTML = `${district.idx >= 1 ? "📈" : "📉"} ${escapeHtml(district.name)}-Index <b>${idxStr(district.idx)}</b> (${pct >= 0 ? "+" : ""}${pct}% zum Normalpreis)`
        + (district.boss ? ` · 🥇 <b style="color:${district.boss.color}">${escapeHtml(district.boss.name)}</b>` : "");
    }

    const bb = bboxOf([district.ring.length > 2 ? district.ring : district.buildings.flatMap((b) => b.pts)]);
    const pad = Math.max(bb.w, bb.h) * 0.04;
    fitVb = { x: bb.x1 - pad, y: bb.y1 - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad };
    if (!vb) vb = { ...fitVb };
    setViewBox();

    // Street name → monopoly (colours the whole street).
    const monoBySt = {};
    for (const m of district.monopolies) monoBySt[m.st] = m;

    const parts = [];
    if (district.ring.length > 2)
      parts.push(`<path d="${pathOf(district.ring)}" fill="#2c3a30" stroke="#d9c463" stroke-width="${fitVb.w / 260}" stroke-dasharray="${fitVb.w / 60} ${fitVb.w / 90}" opacity="0.9"/>`);

    for (const l of district.landmarks) {
      if (l.pts && l.pts.length > 2)
        parts.push(`<path d="${pathOf(l.pts)}" fill="${l.type === "park" ? "#31513a" : "#33494f"}" opacity="0.8"/>`);
    }

    // Streets: monopolised streets glow in the owner's colour; the weekly
    // GOLDEN street shimmers gold underneath everything. 👑✨
    const monoLabelAt = {}; // st -> longest road midpoint for the label
    let goldenLabelAt = null;
    for (const r of district.roads || []) {
      const mono = r.n && monoBySt[r.n];
      const isGolden = r.n && district.golden === r.n;
      const w = r.w === 2 ? 9 : r.w === 1 ? 5.5 : 2.5;
      const col = mono ? mono.color : r.w === 2 ? "#565b63" : r.w === 1 ? "#4a4f56" : "#42464c";
      if (isGolden)
        parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="#ffd700" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" style="pointer-events:none"/>`);
      parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="${col}" stroke-width="${mono ? w + 2 : w}" stroke-linecap="round" stroke-linejoin="round" ${mono ? 'opacity="0.95"' : ""} style="pointer-events:none"/>`);
      if (!mono && r.w >= 1)
        parts.push(`<path d="${openPath(r.pts)}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="${w * 0.22}" stroke-dasharray="${w * 2.2} ${w * 2.6}" stroke-linecap="round" style="pointer-events:none"/>`);
      if (mono) {
        const cur = monoLabelAt[r.n];
        if (!cur || r.pts.length > cur.len) monoLabelAt[r.n] = { len: r.pts.length, p: r.pts[Math.floor(r.pts.length / 2)] };
      }
      if (isGolden && (!goldenLabelAt || r.pts.length > goldenLabelAt.len))
        goldenLabelAt = { len: r.pts.length, p: r.pts[Math.floor(r.pts.length / 2)] };
    }

    // Buildings: territory painting — owned houses fill in the owner's colour.
    // When a house is selected, every house on the SAME street is highlighted so
    // you can spot the whole street at a glance.
    const selB = selectedId != null ? district.buildings.find((x) => x.id === selectedId) : null;
    const selSt = selB ? selB.st : null;
    for (const b of district.buildings) {
      const sel = b.id === selectedId;
      const sameSt = !sel && selSt && b.st === selSt;
      let fill = CLS_FILL[b.cls] || "#3e5748";
      let stroke = "rgba(0,0,0,0.35)", sw = 0.4;
      if (b.owner) { fill = b.color; stroke = b.mine ? "#f4d782" : "rgba(0,0,0,0.5)"; sw = b.mine ? 1.6 : 0.7; }
      if (sameSt) { stroke = "#ffcf5e"; sw = 2.0; }   // same-street highlight
      if (sel) { stroke = "#7ec8ff"; sw = 2.4; }
      const special = b.cls === "casino" || b.cls === "bank" || b.trophy;
      parts.push(`<path class="bld" data-b="${b.id}" d="${pathOf(b.pts)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${special ? 'filter="url(#glow)"' : ""} style="cursor:pointer"/>`);
      if (b.cls === "casino" || b.cls === "bank")
        parts.push(`<text x="${b.c[0]}" y="${b.c[1]}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(14, Math.sqrt(b.a))}" style="pointer-events:none">${b.cls === "casino" ? "🎰" : "🏦"}</text>`);
      else if (b.trophy)
        parts.push(`<text x="${b.c[0]}" y="${b.c[1]}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(11, Math.sqrt(b.a) * 0.9)}" style="pointer-events:none">${district.trophies[b.trophy].emoji}</text>`);
    }

    for (const l of district.landmarks) {
      parts.push(`<text x="${l.x}" y="${l.y}" text-anchor="middle" dominant-baseline="central" font-size="26" opacity="0.95" style="pointer-events:none">${LM_EMOJI[l.type] || "📍"}</text>`);
    }

    // Monopoly street labels on top.
    for (const [st, info] of Object.entries(monoLabelAt)) {
      const m = monoBySt[st];
      parts.push(`<text x="${info.p[0]}" y="${info.p[1] - 8}" text-anchor="middle" font-size="13" font-weight="800" fill="${m.color}" stroke="#1c231b" stroke-width="2.5" paint-order="stroke" style="pointer-events:none">👑 ${escapeHtml(m.ownerName)}s ${escapeHtml(st)}</text>`);
    }
    if (goldenLabelAt && district.golden)
      parts.push(`<text x="${goldenLabelAt.p[0]}" y="${goldenLabelAt.p[1] + 18}" text-anchor="middle" font-size="13" font-weight="800" fill="#ffd700" stroke="#1c231b" stroke-width="2.5" paint-order="stroke" style="pointer-events:none">✨ Goldene Straße: ${escapeHtml(district.golden)} (2× Tribut)</text>`);

    svg.innerHTML = `<defs><filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#f4d782" flood-opacity="0.85"/></filter></defs>` + parts.join("");
  }

  // ── Pan & zoom (district view) ───────────────────────────────────────────
  const mapEl = $("#city-map");
  const pointers = new Map();
  let panStart = null, moved = false, pinchStart = null;
  // Selection happens on pointerup using the pointerdown target: after
  // setPointerCapture the browser retargets the eventual click to the SVG
  // itself, so a plain click handler never sees the .bld path (mouse bug).
  let downTarget = null;

  const clientToMap = (cx, cy) => {
    const r = mapEl.getBoundingClientRect();
    return [vb.x + ((cx - r.left) / r.width) * vb.w, vb.y + ((cy - r.top) / r.height) * vb.h];
  };

  function zoomAt(factor, cx, cy) {
    if (view !== "district" || !vb) return;
    const [mx, my] = cx != null ? clientToMap(cx, cy) : [vb.x + vb.w / 2, vb.y + vb.h / 2];
    const minW = 60, maxW = fitVb.w * 1.4;
    const nw = Math.min(maxW, Math.max(minW, vb.w * factor));
    const scale = nw / vb.w;
    vb = { x: mx - (mx - vb.x) * scale, y: my - (my - vb.y) * scale, w: nw, h: vb.h * scale };
    setViewBox();
  }

  mapEl.addEventListener("pointerdown", (e) => {
    if (view !== "district") return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 1) { panStart = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; downTarget = e.target; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), vb: { ...vb } };
      panStart = null;
    }
    mapEl.setPointerCapture(e.pointerId);
  });
  mapEl.addEventListener("pointermove", (e) => {
    if (view !== "district" || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (d > 0) {
        const scale = pinchStart.dist / d;
        const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
        vb = { ...pinchStart.vb };
        setViewBox();
        zoomAt(scale, cx, cy);
      }
      moved = true;
    } else if (panStart) {
      const r = mapEl.getBoundingClientRect();
      const dx = ((e.clientX - panStart.x) / r.width) * panStart.vb.w;
      const dy = ((e.clientY - panStart.y) / r.height) * panStart.vb.h;
      if (Math.abs(e.clientX - panStart.x) + Math.abs(e.clientY - panStart.y) > 6) moved = true;
      vb = { ...panStart.vb, x: panStart.vb.x - dx, y: panStart.vb.y - dy };
      setViewBox();
    }
  });
  const endPointer = (e) => {
    // A tap (no drag) selects the building under the initial pointerdown.
    if (e.type === "pointerup" && view === "district" && !moved && pointers.size === 1 && downTarget) {
      const bEl = downTarget.closest && downTarget.closest(".bld");
      if (bEl) {
        selectedId = parseInt(bEl.dataset.b, 10);
        renderDistrict();
        renderDetail();
        $("#city-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { panStart = null; downTarget = null; }
  };
  mapEl.addEventListener("pointerup", endPointer);
  mapEl.addEventListener("pointercancel", endPointer);
  mapEl.addEventListener("wheel", (e) => {
    if (view !== "district") return;
    e.preventDefault();
    zoomAt(e.deltaY > 0 ? 1.18 : 0.85, e.clientX, e.clientY);
  }, { passive: false });

  $("#zoom-in").addEventListener("click", () => zoomAt(0.7));
  $("#zoom-out").addEventListener("click", () => zoomAt(1.45));
  $("#zoom-fit").addEventListener("click", () => { if (fitVb) { vb = { ...fitVb }; setViewBox(); } });
  $("#city-back").addEventListener("click", () => {
    view = "overview"; district = null; selectedId = null; vb = null;
    loadCity();
  });

  // Overview has no pointer capture, so a plain click works there.
  // (District selection happens in endPointer — see note at downTarget.)
  mapEl.addEventListener("click", (e) => {
    if (moved) return;
    const dEl = e.target.closest(".dist");
    if (dEl && view === "overview") loadDistrict(dEl.dataset.d);
  });

  // ── Detail panel ─────────────────────────────────────────────────────────
  const bldById = (id) => district && district.buildings.find((b) => b.id === id);

  const OSM_TYPE = {
    house: "Wohnhaus", detached: "Einfamilienhaus (freistehend)", residential: "Wohngebäude",
    apartments: "Mehrfamilienhaus", semidetached_house: "Doppelhaushälfte", terrace: "Reihenhaus",
    bungalow: "Bungalow", farm: "Bauernhaus", farm_auxiliary: "Wirtschaftsgebäude", barn: "Scheune",
    stable: "Stall", retail: "Geschäftshaus", commercial: "Gewerbegebäude", office: "Bürogebäude",
    supermarket: "Supermarkt", industrial: "Industriegebäude", warehouse: "Lagerhalle",
    manufacture: "Produktionshalle", hotel: "Hotel", church: "Kirche", chapel: "Kapelle",
    school: "Schule", kindergarten: "Kindergarten", civic: "Öffentliches Gebäude",
    public: "Öffentliches Gebäude", government: "Behörde", fire_station: "Feuerwache",
    hospital: "Krankenhaus", university: "Hochschule", sports_hall: "Sporthalle",
    garage: "Garage", bunker: "Bunker", cabin: "Hütte", allotment_house: "Gartenlaube",
    train_station: "Bahnhofsgebäude", transportation: "Verkehrsgebäude", parking: "Parkhaus",
    sports_centre: "Sportzentrum", riding_hall: "Reithalle", silo: "Silo", works: "Werk",
    shop: "Ladengebäude", kiosk: "Kiosk", dormitory: "Wohnheim", hall: "Halle",
    community_centre: "Gemeindezentrum", greenhouse: "Gewächshaus", shed: "Schuppen",
  };

  /**
   * Eine Zeile, die erklaert, warum der eigene Preis vom Marktwert abweicht.
   * Ohne sie sieht man nur eine hoehere Zahl und haelt sie fuer einen Fehler.
   */
  function staffelHinweis(bossRabatt) {
    let out = "";
    if (bossRabatt) out += `<div class="cd-row muted small">🥇 Boss-Rabatt: −10 % in deinem Ortsteil.</div>`;
    const st = district && district.ownerScale;
    if (st && st > 1.01) {
      const max = district.ownerScaleMax || 3;
      out += `<div class="cd-row muted small">🏠 Besitzer-Staffel: du hast ${fmt(district.ownerHouses)} Gebäude, deshalb ×${st.toLocaleString("de-DE")} auf jeden Kauf (höchstens ×${max}). Verkaufen und Entschädigungen bleiben beim Marktwert.</div>`;
    }
    return out;
  }

  function renderDetail() {
    const box = $("#city-detail");
    if (!box) return;
    if (view === "overview") {
      // Overview panel = local news feed (Spekulation!).
      let html = `<div class="cd-sub" style="margin-bottom:6px">📰 Orts-News</div>`;
      if (overview && overview.news && overview.news.length) {
        html += overview.news.map((n) => `<div class="cd-row ${n.up ? "news-up" : "news-down"}">${escapeHtml(n.txt)}</div>`).join("");
        html += `<p class="muted small" style="margin:8px 0 0">News bewegen den Preis-Index des Ortsteils — kauf billig, verkauf teuer (Verkauf: 90%).</p>`;
      } else {
        html += `<p class="muted small" style="margin:0">Noch keine Ereignisse — die Indizes driften vor sich hin. Tippe einen Stadtteil an!</p>`;
      }
      box.innerHTML = html;
      return;
    }
    const b = bldById(selectedId);
    if (!b) {
      box.innerHTML = '<p class="muted small" style="text-align:center;padding:14px">Zoome rein und tippe ein Haus an.</p>';
      return;
    }
    const c = district.classes[b.cls];
    const troph = b.trophy ? district.trophies[b.trophy] : null;
    const title = b.nm ? escapeHtml(b.nm) : escapeHtml(c.name);
    const head = `<div class="cd-head">${troph ? troph.emoji : c.emoji} <b>${title}</b>${troph ? ` <span class="cd-trophy-tag">TROPHÄE</span>` : ""}</div>`;

    // Info block: address, type, size.
    let body = `<div class="cd-info">`;
    body += `<div class="cd-row">📍 ${b.n ? `<b>${escapeHtml(b.n)}</b> · ` : ""}${escapeHtml(district.name)}</div>`;
    const art = b.t ? (OSM_TYPE[b.t] || b.t.replace(/_/g, " ")) : c.name;
    body += `<div class="cd-row">🏗️ Art: <b>${escapeHtml(art)}</b>${b.lv ? ` · ${b.lv} ${b.lv === 1 ? "Etage" : "Etagen"}` : ""}</div>`;
    body += `<div class="cd-row">📐 ${fmt(b.a)} m² Grundfläche${b.lm ? " · ⭐ Top-Lage" : ""}</div>`;
    // Residents (Wohnsitz flavour).
    const residents = (district.residents && district.residents[b.id]) || [];
    if (residents.length)
      body += `<div class="cd-row">🛏️ Hier wohnt: <b>${residents.map(escapeHtml).join(", ")}</b></div>`;
    body += `</div>`;

    // Trophy perk.
    if (troph)
      body += `<div class="cd-row cd-buff ${b.mine ? "on" : ""}">${troph.emoji} <b>${escapeHtml(troph.title)}</b> — ${escapeHtml(troph.perk)}${b.mine ? ` · <span class="pos">deins!</span>` : ""}</div>`;
    if (c.perk)
      body += `<div class="cd-row cd-buff ${b.mine ? "on" : ""}">⭐ <b>${escapeHtml(c.perk)}</b></div>`;

    // Street monopoly progress.
    if (b.st && district.streetTotals[b.st]) {
      const total = district.streetTotals[b.st];
      const ownedByMe = district.buildings.filter((x) => x.st === b.st && x.mine).length;
      const mono = district.monopolies.find((m) => m.st === b.st);
      if (mono)
        body += `<div class="cd-row cd-street">👑 <b style="color:${mono.color}">${escapeHtml(mono.ownerName)}s ${escapeHtml(b.st)}</b> — Straßen-Monopol!</div>`;
      else
        body += `<div class="cd-row cd-street">🏘️ <b>${escapeHtml(b.st)}</b>: ${ownedByMe}/${total} Häuser deins — bei ${total}/${total} färbt sich die Straße!</div>`;
    }

    body += `<div class="cd-section">`;
    body += `<div class="cd-row">Besitzer: <b>${b.mine ? "Du" : b.ownerName ? `<span style="color:${b.color}">${escapeHtml(b.ownerName)}</span>` : "— frei —"}</b></div>`;
    if (!b.owner) {
      /* myPrice kommt jetzt vom Server und enthaelt Boss-Rabatt UND
         Besitzer-Staffel. Es kann also unter ODER ueber dem Marktwert
         liegen, deshalb beide Richtungen zeigen statt nur den Rabatt. */
      const meiner = b.myPrice != null ? b.myPrice : b.price;
      const abweichung = meiner !== b.price;
      body += `<button class="btn-primary cd-btn" data-act="buy">Kaufen — ${fmt(meiner)} 🪙${abweichung ? ` <s class="muted small">${fmt(b.price)}</s>` : ""}</button>`;
      body += staffelHinweis(meiner < b.price);
    } else if (b.mine) {
      body += `<button class="btn-primary cd-btn" data-act="sell">Verkaufen — ${fmt(b.sellPrice)} 🪙</button>`;
      if (/^(kiosk|cafe|shop|hotel|factory)$/.test(b.cls)) {
        body += b.listed
          ? `<div class="cd-row" style="color:#7ec8ff">📈 Börsennotiert</div>`
          : `<button class="cd-toggle" data-act="ipo">📈 An die Börse bringen (IPO)</button>`;
      }
    } else {
      /* Preis kommt vom Server: der Client rechnete hier frueher price × 1,5
         nach und haette mit der Besitzer-Staffel eine falsche Zahl gezeigt. */
      const kosten = b.takeoverCost != null ? b.takeoverCost : Math.ceil(b.price * 1.5);
      body += `<button class="btn-primary cd-btn" data-act="takeover">Übernehmen — ${fmt(kosten)} 🪙</button>`;
      body += `<div class="cd-row muted small">50 % Aufschlag auf den Marktwert von ${fmt(b.price)} 🪙. Der Vorbesitzer bekommt den vollen Marktwert, der Rest verfällt.</div>`;
      body += staffelHinweis(false);
    }
    // Wohnsitz: free flavour on any building.
    const myAcc = window.Casino.getAccount && window.Casino.getAccount();
    const myName = myAcc && myAcc.name;
    const iLiveHere = myName && residents.some((r) => r.toLowerCase() === myName.toLowerCase());
    body += iLiveHere
      ? `<button class="cd-toggle on" data-act="moveout">🛏️ Du wohnst hier — ausziehen</button>`
      : `<button class="cd-toggle" data-act="movein">🛏️ Hier einziehen (kostenlos, nur Spaß)</button>`;
    body += `</div>`;
    box.innerHTML = head + body;
  }

  $("#city-detail").addEventListener("click", (e) => {
    const b = bldById(selectedId);
    if (!b || view !== "district") return;
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "movein" || act === "moveout") {
      socket.emit("city:residence", { buildingId: act === "movein" ? b.id : null }, (res) => {
        if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
        toast(act === "movein" ? "🛏️ Eingezogen!" : "📦 Ausgezogen.");
        loadDistrict(district.id, true);
      });
      return;
    }
    const EVT = { buy: "city:buy", sell: "city:sell", takeover: "city:takeover", ipo: "city:ipo" };
    const ev = EVT[act];
    if (!ev) return;
    socket.emit(ev, { buildingId: b.id, districtId: district.id }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Aktion fehlgeschlagen."); return; }
      applyAccount(res.account);
      if (res.district) { district = res.district; district.residents = district.residents || {}; }
      renderDistrict();
      renderDetail();
      socket.emit("city:state", (r2) => { if (r2 && r2.ok) { overview = r2.overview; renderEmpire(overview.me); } });
      if (res.raised) toast(`🚀 Börsengang! +${fmt(res.raised)} 🪙 Kapital (${res.sym}).`);
      else if (res.gain) toast(`✓ +${fmt(res.gain)} 🪙`);
      else if (res.cost) toast(`✓ −${fmt(res.cost)} 🪙`);
      else toast("✓ Erledigt");
    });
  });

  // Live refresh + news toasts.
  socket.on("city:update", () => {
    const screen = document.querySelector('[data-screen="businesses"]');
    if (screen && screen.classList.contains("active")) loadCity();
  });
  socket.on("city:news", (n) => {
    if (n && n.txt) toast(`📰 ${n.txt}`);
  });
  // Achievement unlocked → celebrate (only for me; big ones hit the chat anyway).
  socket.on("ach:unlocked", (a) => {
    const acc = window.Casino.getAccount && window.Casino.getAccount();
    if (!a || !acc || !a.user || a.user.toLowerCase() !== acc.name.toLowerCase()) return;
    toast(`🏆 Achievement: ${a.emoji} ${a.label} — +${fmt(a.reward)} 🪙!`);
  });

  // ── Screen-entry hooks (called by app.js's showScreen) ───────────────────
  window.Casino._loadWork = loadWork;
  window.Casino._loadBusinesses = () => {
    view = "overview"; district = null; selectedId = null; vb = null;
    loadCity();
  };
})();
