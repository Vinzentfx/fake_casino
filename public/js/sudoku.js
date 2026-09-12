"use strict";

/* Sudoku-Race
   Live gegeneinander: beide lösen dasselbe Rätsel, die erste richtige volle
   Lösung gewinnt. Geprüft wird auf dem Server. */

(function () {
  const { socket, toast, applyAccount, getAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let st = null;
  let myCode = null;
  let chosenDiff = "medium";
  let soloMode = false, soloPlaying = false;
  // Laeuft gerade ein asynchrones Duell? Dann steht hier seine Kennung.
  let duellId = null;
  let duellStand = null;
  // Ein laufendes Duell ueberlebt das Neuladen der Seite.
  const DUELL_KEY = "casino_duell_sudoku";
  let puzzle = null;      // given cells (0 = blank)
  let grid = null;        // my working grid (81)
  let selected = -1;      // selected cell index
  let sendTimer = null;   // bremst sudoku:update
  let timerInt = null;
  let endsAt = 0;

  const DIFF_LABELS = { easy: "Leicht", medium: "Mittel", hard: "Schwer" };
  const progressCount = () => Array.isArray(grid) && Array.isArray(puzzle)
    ? grid.filter((v, i) => puzzle[i] !== 0 || (v >= 1 && v <= 9)).length
    : 0;
  const setProgress = (prefix, progress) => {
    const n = Math.max(0, Math.min(81, Math.floor(Number(progress)) || 0));
    $(`#sdk-${prefix}-val`).textContent = String(n);
    $(`#sdk-${prefix}-bar`).style.width = Math.round((n / 81) * 100) + "%";
  };

  const views = ["sdk-setup", "sdk-wait", "sdk-game", "sdk-result"];
  function show(view) { for (const v of views) { const el = $("#" + v); if (el) el.style.display = v === view ? "" : "none"; } }

  // Difficulty picker
  document.querySelectorAll("#sdk-diffs .mem-size-btn").forEach((b) =>
    b.addEventListener("click", () => {
      chosenDiff = b.dataset.diff;
      document.querySelectorAll("#sdk-diffs .mem-size-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));

  // Mode tabs (Solo / PvP-Race)
  document.querySelectorAll("#sdk-setup .sol-mode-tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll("#sdk-setup .sol-mode-tab").forEach((x) => x.classList.toggle("active", x === t));
      const m = t.dataset.smode;
      $("#sdk-solo-panel").style.display = m === "solo" ? "" : "none";
      $("#sdk-duell-panel").style.display = m === "duell" ? "" : "none";
      $("#sdk-pvp-panel").style.display = m === "race" ? "" : "none";
      if (m === "duell") ladeDuelle();
    }));

  // Grid
  function buildGrid() {
    const g = $("#sdk-grid");
    if (g.childElementCount === 81) return;
    g.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const c = document.createElement("button");
      c.className = "sdk-cell";
      const r = Math.floor(i / 9), col = i % 9;
      if (col === 2 || col === 5) c.classList.add("br");
      if (r === 2 || r === 5) c.classList.add("bb");
      c.dataset.i = i;
      c.addEventListener("click", () => selectCell(i));
      g.appendChild(c);
    }
  }

  function conflictIndexes() {
    const conflicts = new Set();
    if (!Array.isArray(grid)) return conflicts;
    const groups = [];
    for (let r = 0; r < 9; r++) groups.push([...Array(9)].map((_, c) => r * 9 + c));
    for (let c = 0; c < 9; c++) groups.push([...Array(9)].map((_, r) => r * 9 + c));
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        groups.push([...Array(9)].map((_, k) => (br * 3 + Math.floor(k / 3)) * 9 + (bc * 3 + (k % 3))));
      }
    }
    for (const group of groups) {
      const seen = new Map();
      for (const i of group) {
        const v = grid[i];
        if (!v) continue;
        if (!seen.has(v)) seen.set(v, []);
        seen.get(v).push(i);
      }
      for (const hits of seen.values()) {
        if (hits.length > 1) hits.forEach((i) => conflicts.add(i));
      }
    }
    return conflicts;
  }

  function renderGrid() {
    const cells = $("#sdk-grid").children;
    const conflicts = conflictIndexes();
    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      const given = puzzle[i] !== 0;
      const v = grid[i];
      c.textContent = v ? String(v) : "";
      c.classList.toggle("given", given);
      c.classList.toggle("sel", i === selected);
      c.classList.toggle("conflict", conflicts.has(i));
      c.disabled = given;
    }
  }

  function selectCell(i) {
    if (puzzle[i] !== 0) return; // Vorgaben lassen sich nicht wählen
    selected = i;
    renderGrid();
  }

  function setNumber(n) {
    if (selected < 0 || !grid || puzzle[selected] !== 0) return;
    grid[selected] = n; // 0 = erase
    renderGrid();
    scheduleSend();
  }

  function scheduleSend() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      if (!grid) return;
      const showProgress = (r) => {
        if (r && r.ok && !r.solved && typeof r.progress === "number") {
          setProgress("you", r.progress);
        }
      };
      if (duellId) {
        // Im Duell zaehlt nur die Abgabe. Waehrenddessen den Fortschritt
        // trotzdem zeigen, aber ohne den Server zu fragen: der wuerde dabei
        // verraten, welche Felder richtig sind.
        setProgress("you", progressCount());
        merkeDuellStand();
      } else if (soloMode) {
        socket.emit("sudoku:soloUpdate", { grid }, (r) => { if (r && r.ok && r.solved) onSoloSolved(); else showProgress(r); });
      } else if (myCode) {
        socket.emit("sudoku:update", { grid }, showProgress);
      }
    }, 350);
  }

  function onSoloSolved() {
    soloPlaying = false;
    show("sdk-result");
    $("#sdk-result-emoji").textContent = "🏆";
    $("#sdk-result-title").textContent = "Gelöst!";
    $("#sdk-result-sub").innerHTML = "Sauber gelöst. Zählt für Achievements und Statistik.";
    $("#sdk-rematch").style.display = "none"; $("#sdk-rematch-status").textContent = "";
  }

  // Number pad
  document.querySelectorAll("#sdk-pad .sdk-key").forEach((b) =>
    b.addEventListener("click", () => setNumber(parseInt(b.dataset.n, 10))));
  // Tastatur, solange man auf dem Sudoku-Screen ist
  document.addEventListener("keydown", (e) => {
    const active = duellId ? true : soloMode ? soloPlaying : (st && st.state === "playing");
    if (!active) return;
    if (document.querySelector('[data-screen="sudoku"]') && !document.querySelector('[data-screen="sudoku"]').classList.contains("active")) return;
    if (e.key >= "1" && e.key <= "9") setNumber(parseInt(e.key, 10));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") setNumber(0);
  });

  // Uhr
  function startTimer() {
    stopTimer();
    timerInt = setInterval(() => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $("#sdk-timer").textContent = `${m}:${String(s).padStart(2, "0")}`;
      if (left <= 0) stopTimer();
    }, 500);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  // Zustand
  function renderProgress(s) {
    const you = s.you || { name: "Du", progress: 0 }, opp = s.opponent || { name: "Gegner", progress: 0 };
    $("#sdk-you-name").textContent = you.name;
    $("#sdk-opp-name").textContent = opp.name;
    setProgress("opp", opp.progress || 0);
    setProgress("you", you.progress || progressCount());
  }

  function renderResult(s) {
    const r = s.result, me = getAccount(), myName = me && me.name;
    const emoji = $("#sdk-result-emoji"), title = $("#sdk-result-title"), sub = $("#sdk-result-sub");
    if (r.tie) { emoji.textContent = "🤝"; title.textContent = "Unentschieden!"; sub.textContent = `Einsatz zurück (${fmt(s.buyIn)} Chips je Spieler).`; }
    else {
      const iWon = myName && r.winner && r.winner.toLowerCase() === myName.toLowerCase();
      emoji.textContent = iWon ? "🏆" : "😔";
      title.textContent = iWon ? "Gewonnen!" : `${escapeHtml(r.winner)} gewinnt`;
      const line = r.players.map((p) => `${escapeHtml(p.name)}: ${p.correct} richtig${p.finished ? " ✓" : ""}`).join(" · ");
      sub.innerHTML = (iWon ? `+${fmt(r.payout)}<i class=mk></i> (Pot ${fmt(r.pot)}, Rake ${fmt(r.rake)})` : `Pot ${fmt(r.pot)}<i class=mk></i> an ${escapeHtml(r.winner)}`) +
        `<br>${line}` + (r.walkover ? "<br><span class='muted'>Gegner hat aufgegeben.</span>" : "");
    }
  }

  function apply(s) {
    const prevState = st && st.state;
    st = s; myCode = s.code;
    if (s.state === "waiting") {
      show("sdk-wait");
      $("#sdk-code-show").textContent = s.code;
      $("#sdk-wait-info").textContent = `${s.playerCount}/2 Spieler · ${DIFF_LABELS[s.difficulty] || s.difficulty} · ${s.public ? "öffentlich" : "privat (nur per Code)"}`;
      $("#sdk-start").style.display = (s.isHost && s.playerCount === 2) ? "" : "none";
    } else if (s.state === "playing") {
      soloMode = false; soloPlaying = false;
      $("#sdk-topbar").style.display = ""; $("#sdk-opp-row").style.display = ""; // race layout
      show("sdk-game");
      // Erster Wechsel auf "läuft": das eigene Raster aus dem Rätsel bauen.
      if (prevState !== "playing" || !grid) {
        puzzle = s.puzzle.slice();
        grid = s.puzzle.slice();
        selected = -1;
        buildGrid();
        renderGrid();
        endsAt = Date.now() + (s.timeLeft || 0);
        startTimer();
      }
      renderProgress(s);
    } else if (s.state === "done") {
      stopTimer();
      show("sdk-result");
      renderResult(s);
      const rm = s.rematch || {};
      $("#sdk-rematch").style.display = rm.canRematch ? "" : "none";
      $("#sdk-rematch-status").textContent = rm.youWant ? "Warte auf Revanche des Gegners…" : (rm.oppWants ? "Gegner will Revanche!" : "");
      // Kampflos: der Gegner ist mitten im Rennen gegangen, den Gewinner benachrichtigen (Chips sind schon gutgeschrieben).
      const r = s.result, me = getAccount(), myName = me && me.name;
      if (r && r.walkover && r.winner && myName && r.winner.toLowerCase() === myName.toLowerCase()) {
        toast(`Dein Gegner hat das Rennen verlassen, du bekommst ${fmt(r.payout)} Chips.`);
      }
    }
  }

  socket.on("sudoku:state", (s) => { if (s) apply(s); });
  socket.on("account:update", (d) => { if (d && d.account) applyAccount(d.account); });

  // Actions
  $("#sdk-create").addEventListener("click", () => {
    const err = $("#sdk-error"); err.textContent = "";
    const buyIn = parseInt($("#sdk-buyin").value, 10);
    if (!Number.isFinite(buyIn) || buyIn < 50) { err.textContent = "Mindest-Buy-in 50 Chips."; return; }
    const visEl = document.querySelector('input[name="sdk-vis"]:checked');
    const isPublic = !visEl || visEl.value === "public";
    socket.emit("sudoku:create", { buyIn, isPublic, difficulty: chosenDiff }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Fehler."; }
    });
  });

  function doJoin(code) {
    const err = $("#sdk-error"); if (err) err.textContent = "";
    socket.emit("sudoku:join", { code }, (r) => {
      if (!r || !r.ok) { if (err) err.textContent = (r && r.error) || "Fehler."; else toast((r && r.error) || "Fehler."); }
    });
  }
  $("#sdk-join").addEventListener("click", () => {
    const code = ($("#sdk-code").value || "").trim().toUpperCase();
    if (code.length !== 4) { $("#sdk-error").textContent = "Code hat 4 Zeichen."; return; }
    doJoin(code);
  });

  // Solo (ohne Uhr, ohne Einsatz)
  $("#sdk-solo-start").addEventListener("click", () => {
    $("#sdk-error").textContent = "";
    socket.emit("sudoku:soloStart", { difficulty: chosenDiff }, (r) => {
      if (!r || !r.ok) { $("#sdk-error").textContent = (r && r.error) || "Fehler."; return; }
      soloMode = true; soloPlaying = true; myCode = null; st = null;
      puzzle = r.puzzle.slice(); grid = r.puzzle.slice(); selected = -1;
      buildGrid(); renderGrid();
      $("#sdk-topbar").style.display = "none";   // keine Uhr
      $("#sdk-opp-row").style.display = "none";  // kein Gegner
      $("#sdk-you-name").textContent = "Ausgefüllt"; setProgress("you", progressCount());
      show("sdk-game");
    });
  });
  $("#sdk-start").addEventListener("click", () => socket.emit("sudoku:start", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); }));

  function leave() {
    // Ein laufendes Duell bleibt bewusst stehen: der Einsatz ist bezahlt, die
    // Spielzeit laeuft, und man soll zurueckkommen koennen.
    duellId = null;
    $("#sdk-duell-submit").style.display = "none";
    $("#sdk-giveup").style.display = "";
    if (myCode) socket.emit("sudoku:leave");
    if (soloMode || soloPlaying) socket.emit("sudoku:soloLeave");
    myCode = null; st = null; grid = null; puzzle = null; soloMode = false; soloPlaying = false; stopTimer();
  }
  $("#sdk-cancel").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-again").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-giveup").addEventListener("click", () => { leave(); show("sdk-setup"); });
  $("#sdk-rematch").addEventListener("click", () => {
    socket.emit("sudoku:rematch", (r) => { if (r && !r.ok) toast(r.error || "Fehler."); else $("#sdk-rematch-status").textContent = "Warte auf Revanche des Gegners…"; });
  });


  // Duell ohne Gleichzeitigkeit
  /*
   * Der Live-Race verlangt zwei Leute im selben Moment. Das passiert hier fast
   * nie, also stand er still. Fuer die Aufgabe selbst ist Gleichzeitigkeit
   * egal: beide loesen dasselbe Raetsel, am Ende werden zwei Ergebnisse
   * verglichen. Hier laeuft deshalb dieselbe Partie versetzt.
   */
  const zeitText = (ms) => {
    const s2 = Math.round(Math.max(0, ms) / 1000);
    return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, "0")}`;
  };
  const restText = (bis) => {
    const h = Math.max(0, Math.round((bis - Date.now()) / 3600000));
    return h >= 1 ? `noch ${h} Std` : "läuft bald ab";
  };

  function ladeDuelle() {
    socket.emit("duell:state", (r) => {
      if (!r || !r.ok) return;
      duellStand = r;
      const nurSudoku = (liste) => liste.filter((d) => d.spiel === "sudoku");

      const offen = nurSudoku(r.offen);
      $("#sdk-duell-offen").innerHTML = offen.length ? offen.map((d) => `
        <div class="duell-zeile">
          <div class="duell-info">
            <b>${escapeHtml(d.erstellerName)}</b>
            <small>${escapeHtml(d.label)} · ${escapeHtml((d.erstellerErgebnis && d.erstellerErgebnis.text) || "")}</small>
            <small class="muted">${restText(d.laeuftBisAt)}</small>
          </div>
          <button class="btn-primary duell-btn" data-duell-accept="${d.id}">Annehmen<span>${fmt(d.einsatz)}<i class=mk></i></span></button>
        </div>`).join("")
        : '<p class="muted small" style="margin:0">Gerade nichts offen. Mach selbst eine auf, dann kann jemand anders annehmen, wenn er Zeit hat.</p>';

      const meine = nurSudoku(r.meine);
      $("#sdk-duell-meine").innerHTML = meine.length ? meine.map((d) => `
        <div class="duell-zeile">
          <div class="duell-info">
            <b>${escapeHtml(d.label)} · ${fmt(d.einsatz)}<i class=mk></i></b>
            <small>${escapeHtml((d.erstellerErgebnis && d.erstellerErgebnis.text) || "noch nicht gespielt")}</small>
            <small class="muted">${d.gegnerName ? escapeHtml(d.gegnerName) + " spielt gerade" : restText(d.laeuftBisAt)}</small>
          </div>
        </div>`).join("")
        : '<p class="muted small" style="margin:0">Keine offenen Herausforderungen von dir.</p>';

      const archiv = nurSudoku(r.archiv);
      $("#sdk-duell-archiv").innerHTML = archiv.length ? archiv.map((d) => {
        const sieger = d.sieger === "ersteller" ? d.erstellerName : d.sieger === "gegner" ? d.gegnerName : null;
        const kopf = d.ausgang === "abgelaufen"
          ? `${escapeHtml(d.erstellerName)}: niemand hat angenommen, Einsatz zurück`
          : sieger ? `<b>${escapeHtml(sieger)}</b> schlägt ${escapeHtml(sieger === d.erstellerName ? d.gegnerName : d.erstellerName)}`
            : `${escapeHtml(d.erstellerName)} und ${escapeHtml(d.gegnerName)} unentschieden`;
        return `<div class="duell-zeile">
          <div class="duell-info">
            <span>${kopf}</span>
            <small class="muted">${escapeHtml((d.erstellerErgebnis && d.erstellerErgebnis.text) || "-")} · ${escapeHtml((d.gegnerErgebnis && d.gegnerErgebnis.text) || "-")}</small>
          </div>
          ${d.auszahlung ? `<b class="duell-pot">${fmt(d.auszahlung)}<i class=mk></i></b>` : ""}
        </div>`;
      }).join("")
        : '<p class="muted small" style="margin:0">Noch nichts entschieden.</p>';

      // Steht eine eigene Partie offen, die noch gespielt werden muss?
      const laufend = nurSudoku(r.laufend)[0];
      if (laufend && !duellId) zeigeFortsetzen(laufend);
    });
  }

  function zeigeFortsetzen(d) {
    const box = $("#sdk-duell-offen");
    if (!box) return;
    box.insertAdjacentHTML("afterbegin", `
      <div class="duell-zeile duell-eigen">
        <div class="duell-info">
          <b>Du bist dran</b>
          <small>${escapeHtml(d.label)} · ${fmt(d.einsatz)}<i class=mk></i> · noch ${zeitText(d.bisAt - Date.now())}</small>
        </div>
        <button class="btn-primary duell-btn" data-duell-weiter="${d.id}">Weiterspielen</button>
      </div>`);
  }

  /** Ein Duell-Rätsel aufs Brett legen. Gleiche Ansicht wie Solo, aber mit Uhr. */
  /*
   * Ein Duell laeuft dreissig Minuten. Auf dem iPad raeumt Safari den Tab in
   * der Zeit regelmaessig weg, und beim Zurueckkommen stand vorher wieder ein
   * leeres Raetsel da, die halbe Stunde Arbeit war weg, der Einsatz aber
   * bezahlt. Der Zwischenstand liegt deshalb lokal, gebunden an die Kennung
   * des Duells.
   */
  function merkeDuellStand() {
    if (!duellId || !grid) return;
    try { localStorage.setItem(DUELL_KEY, JSON.stringify({ id: duellId, grid })); } catch {}
  }
  function holeDuellStand(id) {
    try {
      const v = JSON.parse(localStorage.getItem(DUELL_KEY) || "null");
      return v && v.id === id && Array.isArray(v.grid) && v.grid.length === 81 ? v.grid : null;
    } catch { return null; }
  }
  function vergissDuellStand() {
    try { localStorage.removeItem(DUELL_KEY); } catch {}
  }

  function starteDuellPartie(id, aufgabe, bisAt, gegen) {
    duellId = id;
    soloMode = false; soloPlaying = false; myCode = null; st = null;
    puzzle = aufgabe.puzzle.slice();
    grid = holeDuellStand(id) || aufgabe.puzzle.slice();
    selected = -1;
    buildGrid(); renderGrid();
    $("#sdk-topbar").style.display = "";
    endsAt = bisAt;
    startTimer();
    $("#sdk-opp-row").style.display = gegen ? "" : "none";
    if (gegen) {
      $("#sdk-opp-name").textContent = gegen.name;
      // Der Gegner hat schon gespielt: seine Punktzahl ist der Balken, den es
      // zu schlagen gilt. Genau das ist der Reiz an der versetzten Partie.
      setProgress("opp", gegen.punkte || 0);
    }
    $("#sdk-you-name").textContent = "Ausgefüllt";
    setProgress("you", progressCount());
    $("#sdk-duell-submit").style.display = "";
    $("#sdk-giveup").style.display = "none";
    show("sdk-game");
  }

  function duellAbgeben() {
    if (!duellId) return;
    const id = duellId;
    socket.emit("duell:submit", { id, einsendung: grid }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      duellId = null;
      vergissDuellStand();
      if (r.account) applyAccount(r.account);
      stopTimer();
      $("#sdk-duell-submit").style.display = "none";
      $("#sdk-giveup").style.display = "";
      show("sdk-result");
      $("#sdk-rematch").style.display = "none";
      $("#sdk-rematch-status").textContent = "";
      if (r.wartet) {
        $("#sdk-result-emoji").textContent = "⏳";
        $("#sdk-result-title").textContent = "Abgegeben";
        $("#sdk-result-sub").textContent = `${r.ergebnis.text}. Jetzt wartet dein Ergebnis, bis jemand annimmt.`;
      } else {
        const ich = getAccount();
        const gewonnen = r.siegerName && ich && r.siegerName.toLowerCase() === String(ich.name).toLowerCase();
        $("#sdk-result-emoji").textContent = r.siegerName ? (gewonnen ? "🏆" : "😤") : "🤝";
        $("#sdk-result-title").textContent = r.siegerName ? (gewonnen ? "Gewonnen!" : `${r.siegerName} war besser`) : "Unentschieden";
        const e = r.eintrag || {};
        $("#sdk-result-sub").textContent =
          `${e.erstellerName}: ${(e.erstellerErgebnis || {}).text || "-"} · ${e.gegnerName}: ${(e.gegnerErgebnis || {}).text || "-"}`
          + (gewonnen ? `, +${fmt(r.auszahlung)}<i class=mk></i>` : "");
        if (gewonnen) window.Casino.fx.bigWin(r.auszahlung, { label: "Duell gewonnen" });
      }
      ladeDuelle();
    });
  }

  $("#sdk-duell-create").addEventListener("click", () => {
    const einsatz = parseInt($("#sdk-duell-einsatz").value, 10);
    if (!Number.isFinite(einsatz) || einsatz < 50) { toast("Mindestens 50 Chips."); return; }
    socket.emit("duell:create", { spiel: "sudoku", einsatz, optionen: { difficulty: chosenDiff } }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      window.Casino.sound.play("chip");
      starteDuellPartie(r.id, r.aufgabe, r.bisAt, null);
    });
  });

  document.addEventListener("click", (e) => {
    const an = e.target.closest("[data-duell-accept]");
    if (an) {
      socket.emit("duell:accept", { id: an.dataset.duellAccept }, (r) => {
        if (!r || !r.ok) { toast((r && r.error) || "Geht nicht mehr."); ladeDuelle(); return; }
        if (r.account) applyAccount(r.account);
        window.Casino.sound.play("chip");
        starteDuellPartie(r.id, r.aufgabe, r.bisAt, { name: r.gegenName, punkte: (r.gegenErgebnis || {}).punkte || 0 });
      });
      return;
    }
    const weiter = e.target.closest("[data-duell-weiter]");
    if (weiter && duellStand) {
      const d = (duellStand.laufend || []).find((x) => x.id === weiter.dataset.duellWeiter);
      if (d) starteDuellPartie(d.id, d.aufgabe, d.bisAt, d.erstellerErgebnis && !d.meine
        ? { name: d.erstellerName, punkte: d.erstellerErgebnis.punkte } : null);
    }
  });

  $("#sdk-duell-submit").addEventListener("click", duellAbgeben);
  socket.on("duell:update", () => {
    if (document.querySelector('[data-screen="sudoku"]')?.classList.contains("active")) ladeDuelle();
  });

  // Wer mitten im Rennen den Screen verlässt (‹ Lobby), gibt auf, der Gegner bekommt den Topf.
  const sdkBack = document.querySelector('[data-screen="sudoku"] .back-btn');
  if (sdkBack) sdkBack.addEventListener("click", () => { if (myCode || soloPlaying) leave(); });

  window.Casino._sudokuJoinCode = (code) => { window.Casino.showScreen("sudoku"); doJoin(code); };
  /** Direkt in den Duell-Reiter springen (vom Hinweis in der Lobby aus). */
  window.Casino._sudokuDuelle = () => {
    window.Casino.screens.show("sudoku");
    const tab = document.querySelector('#sdk-setup [data-smode="duell"]');
    if (tab) tab.click();
  };
  window.Casino._loadSudoku = () => {
    ladeDuelle();
    if (duellId) { show("sdk-game"); return; }
    // Nach einem Neuladen ist duellId weg. Steht im Speicher noch ein Stand,
    // wird die Partie samt Zwischenstand wieder aufgenommen.
    let gemerkt = null;
    try { gemerkt = JSON.parse(localStorage.getItem(DUELL_KEY) || "null"); } catch {}
    if (gemerkt && gemerkt.id) {
      socket.emit("duell:state", (r) => {
        if (!r || !r.ok) return;
        const d = (r.laufend || []).find((x) => x.id === gemerkt.id);
        if (!d) { vergissDuellStand(); return; }
        const tab = document.querySelector('#sdk-setup [data-smode="duell"]');
        if (tab) tab.click();
        starteDuellPartie(d.id, d.aufgabe, d.bisAt,
          d.erstellerErgebnis && !d.meine ? { name: d.erstellerName, punkte: d.erstellerErgebnis.punkte } : null);
      });
      return;
    }
    if (soloMode && soloPlaying) { show("sdk-game"); return; }
    if (!st || st.state === "done") { show("sdk-setup"); $("#sdk-error").textContent = ""; }
    else apply(st);
  };
})();
