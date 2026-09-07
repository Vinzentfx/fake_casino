"use strict";

(function () {
  const { socket, toast } = window.Casino;
  const $ = (s) => document.querySelector(s);

  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const MAX_TOTAL = 50000;

  let chipValue = 100;
  let bets = {};       // betKey → amount
  let spinning = false;
  let wheelAngle = 0;
  let history = [];
  let lobbyMode = null; // { code, isHost } when playing a shared-lobby table

  const BET_LABELS = {
    red: "Rot", black: "Schwarz", odd: "Ungerade", even: "Gerade", low: "1–18", high: "19–36",
  };

  // ── Sound: Kugelrattern, Aufsetzen, Gewinn/Verlust, Chip-Klick ──
  // Die Bausteine stehen in core/sound.js, hier nur die Klangfarbe.
  const { tone, click } = window.Casino.sound;

  const sndChip   = () => { tone(880, 0.05, "square", 0.05, 0, 1300); click(3000, 0.025); };
  const sndSettle = () => { tone(180, 0.18, "sine", 0.09, 0, 70); click(1200, 0.05); };
  const sndWin    = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.07, i * 0.08));
  const sndLose   = () => tone(200, 0.4, "sawtooth", 0.06, 0, 90);

  // Decelerating ball rattle synced to the ~4.8s wheel spin.
  function startBallRattle(totalMs) {
    let stopped = false, elapsed = 0, id = null;
    function step() {
      if (stopped) return;
      click(1600 + Math.random() * 1400, 0.03);
      const p = Math.min(1, elapsed / totalMs);
      const gap = 28 + 230 * Math.pow(p, 2.2); // ticks slow down as the ball loses speed
      elapsed += gap;
      if (elapsed < totalMs) id = setTimeout(step, gap);
    }
    step();
    return () => { stopped = true; if (id) clearTimeout(id); };
  }

  // ── Canvas wheel ───────────────────────────────────────────────
  const canvas = $("#roulette-canvas");
  const ctx    = canvas.getContext("2d");

  function resizeCanvas() {
    const side = Math.min(canvas.parentElement.clientWidth, 300);
    canvas.width  = side;
    canvas.height = side;
    drawWheel();
  }

  function drawWheel() {
    const w = canvas.width, cx = w / 2, cy = w / 2;
    const r = w * 0.43;
    const SLOT = 2 * Math.PI / 37;
    ctx.clearRect(0, 0, w, w);

    // Rim
    ctx.beginPath(); ctx.arc(cx, cy, r + w * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = "#7a5520"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r + w * 0.012, 0, Math.PI * 2);
    ctx.strokeStyle = "#c8920a"; ctx.lineWidth = w * 0.012; ctx.stroke();

    // Segments
    for (let i = 0; i < 37; i++) {
      const n  = WHEEL[i];
      const sa = -Math.PI / 2 + i * SLOT + wheelAngle;
      const ea = sa + SLOT;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, sa, ea); ctx.closePath();
      ctx.fillStyle = n === 0 ? "#1a8c3c" : RED.has(n) ? "#b52e2e" : "#111";
      ctx.fill();
      ctx.strokeStyle = "#c8920a"; ctx.lineWidth = 0.7; ctx.stroke();

      // Number label
      const mid = sa + SLOT / 2;
      ctx.save();
      ctx.translate(cx + r * 0.76 * Math.cos(mid), cy + r * 0.76 * Math.sin(mid));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(8, w * 0.038)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }

    // Hub
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = "#7a5520"; ctx.fill();
    ctx.strokeStyle = "#c8920a"; ctx.lineWidth = 2; ctx.stroke();

    // Ball indicator (fixed at top)
    const br = w * 0.026;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.88, br, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - br * 0.35, cy - r * 0.88 - br * 0.35, 0, cx, cy - r * 0.88, br);
    g.addColorStop(0, "#fff"); g.addColorStop(1, "#bbb");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "#888"; ctx.lineWidth = 1; ctx.stroke();
  }

  function spinToNumber(number, onDone) {
    const idx  = WHEEL.indexOf(number);
    const SLOT = 2 * Math.PI / 37;
    const jitter = (Math.random() - 0.5) * SLOT * 0.55;
    // Wheel angle that puts slot idx centre at 12-o'clock indicator
    const base   = -(idx + 0.5) * SLOT + jitter;
    // Travel at least 7 full clockwise rotations from current position
    const minEnd = wheelAngle + 7 * 2 * Math.PI;
    const n      = Math.ceil((minEnd - base) / (2 * Math.PI));
    const target = base + n * 2 * Math.PI;

    const startAngle = wheelAngle;
    const duration   = 4800;
    const t0         = performance.now();
    const stopRattle = startBallRattle(duration);

    function ease(t) { return 1 - Math.pow(1 - t, 3.5); }

    let abgeschlossen = false;
    function abschliessen() {
      if (abgeschlossen) return;
      abgeschlossen = true;
      wheelAngle = target;
      drawWheel();
      stopRattle();
      sndSettle();
      onDone();
    }

    function frame(now) {
      if (abgeschlossen) return;
      const t = Math.min(1, (now - t0) / duration);
      wheelAngle = startAngle + (target - startAngle) * ease(t);
      drawWheel();
      if (t < 1) requestAnimationFrame(frame);
      else abschliessen();
    }
    requestAnimationFrame(frame);

    /* Sicherheitsnetz. requestAnimationFrame steht still, solange der Tab im
       Hintergrund liegt — auf dem iPad passiert das bei jedem App-Wechsel.
       Der Einsatz ist zu diesem Zeitpunkt laengst abgebucht und das Ergebnis
       steht fest, aber die Runde bliebe bis zur Rueckkehr haengen: kein
       Ergebnis, kein Guthaben-Update, alle Knoepfe gesperrt.
       setTimeout wird im Hintergrund nur gedrosselt, nicht angehalten, und
       schliesst die Runde deshalb zuverlaessig ab. */
    setTimeout(abschliessen, duration + 1500);
  }

  // ── Betting table ──────────────────────────────────────────────
  /**
   * Das Tableau.
   *
   * Ein echtes Roulette-Tableau liegt quer: Null links, darauf zwoelf
   * Dreier-Spalten, rechts die Kolonnen. Auf dem iPad ist dafuer Platz, auf
   * einem schmalen Handy nicht, dort braucht es die stehende Fassung.
   *
   * Statt beim Wechsel neu zu bauen, traegt jede Zelle ihre Position fuer
   * BEIDE Layouts als CSS-Variablen (--lr/--lc quer, --pr/--pc hochkant).
   * Welche gilt, entscheidet allein eine Media-Query. Ein DOM, zwei Layouts,
   * kein Neuaufbau beim Drehen des Geraets.
   */
  function buildTable() {
    const table = $("#rt-table");
    table.innerHTML = "";

    const board = document.createElement("div");
    board.className = "rt-board";

    const z = makeCell("number", "0", "rt-zero");
    z.textContent = "0";
    board.appendChild(z);

    for (let n = 1; n <= 36; n++) {
      // quer: zwoelf Spalten a drei Zahlen, oben 3/6/9…, unten 1/4/7…
      const lc = Math.ceil(n / 3);
      const lr = 3 - ((n - 1) % 3);
      // hochkant: drei Spalten, oben 34-36, unten 1-3
      const pc = ((n - 1) % 3) + 1;
      const pr = 13 - lc;
      const cell = makeCell("number", String(n), "rt-num " + (RED.has(n) ? "rt-r" : "rt-b"));
      cell.textContent = String(n);
      cell.style.cssText = `--lr:${lr};--lc:${lc};--pr:${pr};--pc:${pc}`;
      board.appendChild(cell);
    }

    // Kolonnen. Wert 1 trifft 1,4,7… und liegt damit in der UNTERSTEN Reihe.
    for (let v = 1; v <= 3; v++) {
      const c = makeCell("column", String(v), "rt-col");
      c.textContent = "2,85×";
      c.style.cssText = `--lr:${4 - v};--pc:${v}`;
      board.appendChild(c);
    }
    table.appendChild(board);

    const doz = document.createElement("div");
    doz.className = "rt-dozens";
    [["1", "1–12"], ["2", "13–24"], ["3", "25–36"]].forEach(([v, lbl]) => {
      const c = makeCell("dozen", v, "rt-dozen");
      c.textContent = lbl;
      doz.appendChild(c);
    });
    table.appendChild(doz);

    const out = document.createElement("div");
    out.className = "rt-outside";
    [
      ["low", "", "1–18"], ["even", "", "Gerade"],
      ["red", "rt-r", "Rot"], ["black", "rt-b", "Schwarz"],
      ["odd", "", "Ungerade"], ["high", "", "19–36"],
    ].forEach(([type, cls, lbl]) => {
      const c = makeCell(type, undefined, "rt-out " + cls);
      c.textContent = lbl;
      out.appendChild(c);
    });
    table.appendChild(out);

    table.addEventListener("click", onTableClick);
    table.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (lobbyMode) return; // in einer Lobby raeumt der Server alles auf einmal ab
      const cell = e.target.closest("[data-type]");
      if (cell) { delete bets[betKey(cell)]; renderBets(); updateIndicators(); }
    });
  }

  function makeCell(type, value, cls) {
    const el = document.createElement("div");
    el.className = "rt-cell " + (cls || "");
    el.dataset.type = type;
    if (value !== undefined) el.dataset.value = value;
    return el;
  }

  function betKey(cell) {
    return cell.dataset.value !== undefined
      ? cell.dataset.type + ":" + cell.dataset.value
      : cell.dataset.type;
  }

  function onTableClick(e) {
    if (spinning) return;
    const cell = e.target.closest("[data-type]");
    if (!cell) return;
    const currentTotal = Object.values(bets).reduce((s, v) => s + v, 0);
    if (currentTotal + chipValue > MAX_TOTAL) {
      toast("Max. 50.000 Chips Gesamteinsatz.");
      return;
    }
    if (lobbyMode) {
      const bet = { type: cell.dataset.type, amount: chipValue };
      if (cell.dataset.value !== undefined)
        bet.value = Number.isNaN(Number(cell.dataset.value)) ? cell.dataset.value : Number(cell.dataset.value);
      socket.emit("rlobby:bet", bet, (res) => { if (res && !res.ok) toast(res.error || "Fehler."); });
      sndChip();
      return; // board updates from the server broadcast
    }
    const key  = betKey(cell);
    bets[key]  = (bets[key] || 0) + chipValue;
    betraegeProSetzung.push({ key, betrag: chipValue });
    merkeSetzung(key);
    sndChip();
    renderBets();
    updateIndicators();
  }

  function updateIndicators() {
    document.querySelectorAll("#rt-table [data-type]").forEach((cell) => {
      const amt = bets[betKey(cell)] || 0;
      cell.classList.toggle("rt-has-bet", amt > 0);
      let badge = cell.querySelector(".rt-bet-badge");
      if (amt > 0) {
        if (!badge) { badge = document.createElement("span"); badge.className = "rt-bet-badge"; cell.appendChild(badge); }
        badge.textContent = amt >= 1e6 ? (amt/1e6) + "M" : amt >= 1000 ? Math.round(amt / 1000) + "k" : String(amt);
      } else if (badge) badge.remove();
    });
  }

  function renderBets() {
    const el  = $("#rt-placed-bets");
    const tot = Object.values(bets).reduce((s, v) => s + v, 0);
    if (!tot) { el.innerHTML = '<span class="muted small">Keine Wetten gesetzt. Auf Felder tippen um zu setzen.</span>'; return; }
    el.innerHTML =
      Object.entries(bets).map(([k, v]) => {
        const [type, val] = k.split(":");
        const lbl = BET_LABELS[type] || (type === "number" ? "Zahl " + val : type === "dozen" ? val + ". Dutzend" : val + ". Reihe");
        return `<span class="rt-bet-tag">${lbl}: ${v.toLocaleString("de-DE")}<i class=mk></i></span>`;
      }).join("") +
      `<span class="rt-bet-total">= ${tot.toLocaleString("de-DE")}<i class=mk></i></span>`;
  }

  // ── History ────────────────────────────────────────────────────
  const freq = new Array(37).fill(0);   // how often each number has hit this session
  const lastSeen = new Array(37).fill(-1); // spin index a number was last seen (-1 = never)
  let spinCount = 0;

  function addHistory(number, color) {
    history.unshift({ number, color });
    if (history.length > 12) history.pop();
    const el = $("#rt-history");
    if (el) el.innerHTML = history.map((h) =>
      `<span class="rt-hist-num rt-hist-${h.color}">${h.number}</span>`
    ).join("");

    // Track stats for the (satirical) hot/cold board.
    freq[number]++;
    lastSeen[number] = spinCount++;
    renderHotCold();
  }

  const numColor = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

  function renderHotCold() {
    const box = $("#rt-hotcold");
    if (!box) return;
    if (spinCount < 3) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const nums = Array.from({ length: 37 }, (_, n) => n);
    // Hot: most frequent (ties → most recent). Cold: longest unseen (never seen is coldest).
    const hot = [...nums].sort((a, b) => freq[b] - freq[a] || lastSeen[b] - lastSeen[a])
      .filter((n) => freq[n] > 0).slice(0, 4);
    const cold = [...nums].sort((a, b) => lastSeen[a] - lastSeen[b] || freq[a] - freq[b]).slice(0, 4);
    const chip = (n) => `<span class="rt-hist-num rt-hist-${numColor(n)}">${n}</span>`;
    $("#rt-hot").innerHTML = hot.map(chip).join("");
    $("#rt-cold").innerHTML = cold.map(chip).join("");
  }

  // ── Spin ───────────────────────────────────────────────────────
  function showResult(number, color, netWin) {
    const numEl = $("#rt-result-num");
    numEl.textContent = number;
    numEl.className = "rt-result-num rt-hist-" + color;
    $("#rt-result-color").textContent = { red: "ROT", black: "SCHWARZ", green: "GRÜN" }[color];
    const netEl = $("#rt-net-win");
    if (netWin > 0) {
      netEl.textContent = "+" + netWin.toLocaleString("de-DE") + " Chips";
      netEl.className = "rt-net-win rt-win";
    } else if (netWin < 0) {
      netEl.textContent = netWin.toLocaleString("de-DE") + " Chips";
      netEl.className = "rt-net-win rt-lose";
    } else {
      netEl.textContent = "±0 Chips"; netEl.className = "rt-net-win";
    }
    $("#rt-result").style.display = "";
    if (netWin > 0) { sndWin(); toast("🎉 +" + netWin.toLocaleString("de-DE") + " Chips!"); }
    else if (netWin < 0) sndLose();
  }

  function highlightBetCells(number) {
    document.querySelectorAll("#rt-table .rt-has-bet").forEach((cell) => {
      const [type, val] = betKey(cell).split(":");
      const v   = val !== undefined ? (Number.isNaN(Number(val)) ? val : Number(val)) : undefined;
      const win = clientPayout(type, v, number) > 0;
      cell.classList.add(win ? "rt-win-cell" : "rt-lose-cell");
    });
    setTimeout(() => {
      document.querySelectorAll(".rt-win-cell, .rt-lose-cell").forEach((el) =>
        el.classList.remove("rt-win-cell", "rt-lose-cell"));
    }, 2600);
  }

  function doSpin() {
    if (spinning) return;
    // In a lobby only the leader spins, and the whole table shares one result.
    if (lobbyMode) {
      socket.emit("rlobby:spin", (res) => { if (res && !res.ok) $("#rt-error").textContent = res.error || "Fehler."; });
      return;
    }

    const tot = Object.values(bets).reduce((s, v) => s + v, 0);
    if (!tot) { toast("Bitte erst eine Wette setzen."); return; }

    spinning = true;
    letzteRunde = { ...bets }; // fuer "Wiederholen" nach dem Dreh
    $("#rt-spin").disabled  = true;
    $("#rt-clear").disabled = true;
    aktualisiereSetzKnoepfe();
    $("#rt-error").textContent = "";
    $("#rt-result").style.display = "none";

    const betArr = Object.entries(bets).map(([k, amount]) => {
      const [type, val] = k.split(":");
      const obj = { type, amount };
      if (val !== undefined) obj.value = Number.isNaN(Number(val)) ? val : Number(val);
      return obj;
    });

    socket.emit("roulette:spin", { bets: betArr }, (res) => {
      if (!res || !res.ok) {
        spinning = false;
        $("#rt-spin").disabled  = false;
        $("#rt-clear").disabled = false;
        aktualisiereSetzKnoepfe();
        $("#rt-error").textContent = res?.error || "Fehler.";
        return;
      }

      spinToNumber(res.number, () => {
        spinning = false;
        $("#rt-spin").disabled  = false;
        $("#rt-clear").disabled = false;
        showResult(res.number, res.color, res.netWin);
        window.Casino.setChips(res.balance);
        highlightBetCells(res.number);
        addHistory(res.number, res.color);
        bets = {};
        setzHistorie = [];
        betraegeProSetzung.length = 0;
        renderBets();
        updateIndicators();
        aktualisiereSetzKnoepfe();
      });
    });
  }

  function clientPayout(type, value, number) {
    if (type === "number") return number === value ? 36 : 0;
    if (number === 0) return 0;
    if (type === "red")    return RED.has(number) ? 2 : 0;
    if (type === "black")  return !RED.has(number) ? 2 : 0;
    if (type === "odd")    return number % 2 === 1 ? 2 : 0;
    if (type === "even")   return number % 2 === 0 ? 2 : 0;
    if (type === "low")    return number <= 18 ? 2 : 0;
    if (type === "high")   return number >= 19 ? 2 : 0;
    if (type === "dozen")  return Math.ceil(number / 12) === value ? 3 : 0;
    if (type === "column") return ((number - 1) % 3 + 1) === value ? 3 : 0;
    return 0;
  }

  // ── Chip buttons ───────────────────────────────────────────────
  // Die ueblichen Casino-Farben je Wert, damit man den Chip an der Farbe
  // erkennt und nicht erst die Zahl lesen muss.
  const CHIP_FARBEN = { 100: "#ecf0f1", 1000: "#2980b9", 10000: "#27ae60", 50000: "#2c3e50" };

  function setupChips() {
    const container = $("#rt-chips");
    container.innerHTML = "";
    [100, 1000, 10000, 50000].forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "rt-chip" + (v === chipValue ? " active" : "");
      btn.dataset.v = v;
      btn.style.setProperty("--chip", CHIP_FARBEN[v] || "#ecf0f1");
      btn.textContent = v >= 1e6 ? v / 1e6 + "M" : v >= 1000 ? v / 1000 + "k" : v;
      btn.addEventListener("click", () => {
        chipValue = v;
        container.querySelectorAll(".rt-chip").forEach((b) => b.classList.toggle("active", +b.dataset.v === v));
        sndChip();
      });
      container.appendChild(btn);
    });
  }

  // ---- Rueckgaengig und Wiederholen ----------------------------------------
  // Beim Roulette setzt man viele kleine Wetten hintereinander. Ein Fehlgriff
  // hiess bisher: alles loeschen und von vorn. Und wer dieselbe Kombination
  // noch einmal spielen will, musste sie Feld fuer Feld neu antippen.
  let setzHistorie = [];   // Schluessel in der Reihenfolge, in der gesetzt wurde
  let letzteRunde = null;  // die Wetten der zuletzt gedrehten Runde

  function merkeSetzung(key) {
    setzHistorie.push(key);
    if (setzHistorie.length > 200) setzHistorie.shift();
    aktualisiereSetzKnoepfe();
  }

  function rueckgaengig() {
    const key = setzHistorie.pop();
    if (!key) return;
    bets[key] = (bets[key] || 0) - chipValueBeiSetzung(key);
    if (bets[key] <= 0) delete bets[key];
    sndChip();
    renderBets();
    updateIndicators();
    aktualisiereSetzKnoepfe();
  }

  // Jede Setzung merkt sich ihren Betrag, sonst nimmt Rueckgaengig den
  // aktuell gewaehlten Chip statt des tatsaechlich gesetzten.
  const betraegeProSetzung = [];
  function chipValueBeiSetzung(key) {
    for (let i = betraegeProSetzung.length - 1; i >= 0; i--) {
      if (betraegeProSetzung[i].key === key) return betraegeProSetzung.splice(i, 1)[0].betrag;
    }
    return chipValue;
  }

  function wiederholen() {
    if (!letzteRunde || !Object.keys(letzteRunde).length) return;
    const summe = Object.values(letzteRunde).reduce((s, v) => s + v, 0);
    const acc = window.Casino.getAccount();
    if (acc && acc.chips < summe) { toast("Nicht genug Chips für dieselbe Runde."); return; }
    bets = { ...letzteRunde };
    setzHistorie = [];
    betraegeProSetzung.length = 0;
    sndChip();
    renderBets();
    updateIndicators();
    aktualisiereSetzKnoepfe();
  }

  function aktualisiereSetzKnoepfe() {
    const u = $("#rt-undo");
    const w = $("#rt-repeat");
    if (u) u.disabled = spinning || lobbyMode || !setzHistorie.length;
    if (w) w.disabled = spinning || lobbyMode || !letzteRunde || !Object.keys(letzteRunde).length;
  }

  $("#rt-spin").addEventListener("click", doSpin);
  $("#rt-clear").addEventListener("click", () => {
    if (spinning) return;
    if (lobbyMode) { socket.emit("rlobby:clear"); return; }
    bets = {};
    setzHistorie = [];
    betraegeProSetzung.length = 0;
    renderBets();
    updateIndicators();
    aktualisiereSetzKnoepfe();
  });
  $("#rt-undo").addEventListener("click", rueckgaengig);
  $("#rt-repeat").addEventListener("click", wiederholen);

  // ── Shared-lobby integration (driven by public/js/rouletteLobby.js) ──────
  const RT_LBL = { red: "Rot", black: "Schwarz", odd: "Ungerade", even: "Gerade", low: "1–18", high: "19–36" };

  function renderLobbyPanel(state) {
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const pEl = $("#rt-lobby-players");
    if (pEl) pEl.innerHTML = state.players.map((p) => {
      const mine = me && p.name && me.name && p.name.toLowerCase() === me.name.toLowerCase();
      const cls = p.net > 0 ? "pos" : p.net < 0 ? "neg" : "";
      const sign = p.net > 0 ? "+" : p.net < 0 ? "−" : "±";
      return `<div class="bj-lp${mine ? " mine" : ""}"><span>${esc(p.name)} <span class="muted small">(${p.staked.toLocaleString("de-DE")}<i class=mk></i>)</span></span><b class="${cls}">${sign}${Math.abs(p.net).toLocaleString("de-DE")}<i class=mk></i></b></div>`;
    }).join("");
    const bEl = $("#rt-lobby-bets");
    if (bEl) bEl.innerHTML = state.bets.length
      ? state.bets.map((b) => `<span class="rt-bet-tag">${esc(b.name)}: ${esc(b.label)} ${b.amount.toLocaleString("de-DE")}<i class=mk></i></span>`).join("")
      : '<span class="muted small">Noch keine Wetten — tippt auf den Tisch.</span>';
  }
  function esc(s) { return window.Casino.escapeHtml(String(s == null ? "" : s)); }

  window.Casino._roulette = {
    setLobby(code, isHost) {
      if (code) { lobbyMode = { code, isHost }; bets = {}; }
      else {
        lobbyMode = null; bets = {}; spinning = false;
        $("#rt-spin").disabled = false; $("#rt-clear").disabled = false;
        $("#rt-spin").textContent = "🎡 Drehen";
        renderBets(); updateIndicators();
      }
    },
    applyState(state) {
      if (!lobbyMode) return;
      lobbyMode.isHost = state.isHost;
      spinning = state.spinning;
      // My bets → the local board.
      bets = {};
      for (const b of state.myBets) {
        const key = b.value !== undefined ? b.type + ":" + b.value : b.type;
        bets[key] = (bets[key] || 0) + b.amount;
      }
      renderBets(); updateIndicators();
      renderLobbyPanel(state);
      // Shared roll board.
      history = state.history.slice(0, 12);
      const hEl = $("#rt-history");
      if (hEl) hEl.innerHTML = history.map((h) => `<span class="rt-hist-num rt-hist-${h.color}">${h.number}</span>`).join("");
      // Spin button: only the host, and not mid-spin.
      const spinBtn = $("#rt-spin");
      spinBtn.disabled = spinning || !state.isHost;
      spinBtn.textContent = state.isHost ? (spinning ? "Dreht…" : "🎡 Drehen") : "Warten auf Anführer…";
      $("#rt-clear").disabled = spinning;
    },
    playResult(result) {
      spinning = true;
      $("#rt-spin").disabled = true; $("#rt-clear").disabled = true;
      $("#rt-result").style.display = "none";
      spinToNumber(result.number, () => {
        const me = window.Casino.getAccount && window.Casino.getAccount();
        const mine = me && result.perPlayer.find((p) => p.name && me.name && p.name.toLowerCase() === me.name.toLowerCase());
        showResult(result.number, result.color, mine ? mine.net : 0);
        highlightBetCells(result.number);
        // Balance, bets and history refresh arrive via the next rlobby:state.
      });
    },
  };

  // ── Boot on screen entry ───────────────────────────────────────
  const screen = document.querySelector('[data-screen="roulette"]');
  let built = false;
  new MutationObserver(() => {
    if (!screen.classList.contains("active")) return;
    resizeCanvas();
    if (!built) { buildTable(); setupChips(); renderBets(); built = true; }
    aktualisiereSetzKnoepfe();
  }).observe(screen, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("resize", () => {
    if (screen.classList.contains("active")) resizeCanvas();
  });
})();
