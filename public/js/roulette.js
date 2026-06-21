"use strict";

(function () {
  const { socket, toast } = window.Casino;
  const $ = (s) => document.querySelector(s);

  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

  let chipValue = 100;
  let bets = {};       // betKey → amount
  let spinning = false;
  let wheelAngle = 0;
  let history = [];

  const BET_LABELS = {
    red: "Rot", black: "Schwarz", odd: "Ungerade", even: "Gerade", low: "1–18", high: "19–36",
  };

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

    function ease(t) { return 1 - Math.pow(1 - t, 3.5); }

    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      wheelAngle = startAngle + (target - startAngle) * ease(t);
      drawWheel();
      if (t < 1) requestAnimationFrame(frame);
      else { wheelAngle = target; drawWheel(); onDone(); }
    }
    requestAnimationFrame(frame);
  }

  // ── Betting table ──────────────────────────────────────────────
  function buildTable() {
    const table = $("#rt-table");
    table.innerHTML = "";

    // Zero
    const z = makeCell("number", "0", "rt-zero");
    z.textContent = "0";
    table.appendChild(z);

    // Numbers 1–36  (rows top→bottom: 34-36, 31-33, …, 1-3)
    const grid = document.createElement("div");
    grid.className = "rt-numbers";
    for (let row = 12; row >= 1; row--) {
      for (let col = 1; col <= 3; col++) {
        const n    = (row - 1) * 3 + col;
        const cell = makeCell("number", String(n), "rt-num " + (RED.has(n) ? "rt-r" : "rt-b"));
        cell.textContent = String(n);
        grid.appendChild(cell);
      }
    }
    table.appendChild(grid);

    // Column bets
    const cols = document.createElement("div");
    cols.className = "rt-col-bets";
    for (let v = 1; v <= 3; v++) {
      const c = makeCell("column", String(v), "rt-col");
      c.textContent = "2:1";
      cols.appendChild(c);
    }
    table.appendChild(cols);

    // Dozen bets
    const doz = document.createElement("div");
    doz.className = "rt-dozens";
    [["1","1–12"],["2","13–24"],["3","25–36"]].forEach(([v, lbl]) => {
      const c = makeCell("dozen", v, "rt-dozen");
      c.textContent = lbl;
      doz.appendChild(c);
    });
    table.appendChild(doz);

    // Outside bets
    const out = document.createElement("div");
    out.className = "rt-outside";
    [
      ["low","","1–18"], ["even","","Gerade"],
      ["red","rt-r","Rot"], ["black","rt-b","Schwarz"],
      ["odd","","Ungerade"], ["high","","19–36"],
    ].forEach(([type, cls, lbl]) => {
      const c = makeCell(type, undefined, "rt-out " + cls);
      c.textContent = lbl;
      out.appendChild(c);
    });
    table.appendChild(out);

    table.addEventListener("click", onTableClick);
    table.addEventListener("contextmenu", (e) => {
      e.preventDefault();
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
    const key  = betKey(cell);
    bets[key]  = (bets[key] || 0) + chipValue;
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
        badge.textContent = amt >= 1000 ? Math.round(amt / 1000) + "k" : String(amt);
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
        return `<span class="rt-bet-tag">${lbl}: ${v.toLocaleString("de-DE")} 🪙</span>`;
      }).join("") +
      `<span class="rt-bet-total">= ${tot.toLocaleString("de-DE")} 🪙</span>`;
  }

  // ── History ────────────────────────────────────────────────────
  function addHistory(number, color) {
    history.unshift({ number, color });
    if (history.length > 12) history.pop();
    const el = $("#rt-history");
    if (el) el.innerHTML = history.map((h) =>
      `<span class="rt-hist-num rt-hist-${h.color}">${h.number}</span>`
    ).join("");
  }

  // ── Spin ───────────────────────────────────────────────────────
  function doSpin() {
    if (spinning) return;
    const tot = Object.values(bets).reduce((s, v) => s + v, 0);
    if (!tot) { toast("Bitte erst eine Wette setzen."); return; }

    spinning = true;
    $("#rt-spin").disabled  = true;
    $("#rt-clear").disabled = true;
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
        $("#rt-error").textContent = res?.error || "Fehler.";
        return;
      }

      spinToNumber(res.number, () => {
        spinning = false;
        $("#rt-spin").disabled  = false;
        $("#rt-clear").disabled = false;

        // Show result
        const numEl = $("#rt-result-num");
        numEl.textContent = res.number;
        numEl.className = "rt-result-num rt-hist-" + res.color;
        $("#rt-result-color").textContent = { red: "ROT", black: "SCHWARZ", green: "GRÜN" }[res.color];
        const netEl = $("#rt-net-win");
        if (res.netWin > 0) {
          netEl.textContent = "+" + res.netWin.toLocaleString("de-DE") + " 🪙";
          netEl.className = "rt-net-win rt-win";
        } else if (res.netWin < 0) {
          netEl.textContent = res.netWin.toLocaleString("de-DE") + " 🪙";
          netEl.className = "rt-net-win rt-lose";
        } else {
          netEl.textContent = "±0 🪙"; netEl.className = "rt-net-win";
        }
        $("#rt-result").style.display = "";

        window.Casino.setChips(res.balance);
        if (res.netWin > 0) toast("🎉 +" + res.netWin.toLocaleString("de-DE") + " 🪙!");

        // Highlight winning / losing cells
        document.querySelectorAll("#rt-table .rt-has-bet").forEach((cell) => {
          const [type, val] = betKey(cell).split(":");
          const v   = val !== undefined ? (Number.isNaN(Number(val)) ? val : Number(val)) : undefined;
          const win = clientPayout(type, v, res.number) > 0;
          cell.classList.add(win ? "rt-win-cell" : "rt-lose-cell");
        });
        setTimeout(() => {
          document.querySelectorAll(".rt-win-cell, .rt-lose-cell").forEach((el) =>
            el.classList.remove("rt-win-cell", "rt-lose-cell")
          );
        }, 2600);

        addHistory(res.number, res.color);
        bets = {};
        renderBets();
        updateIndicators();
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
  function setupChips() {
    const container = $("#rt-chips");
    container.innerHTML = "";
    [10, 50, 100, 500, 1000, 5000].forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "rt-chip" + (v === chipValue ? " active" : "");
      btn.dataset.v = v;
      btn.textContent = v >= 1000 ? v / 1000 + "k" : v;
      btn.addEventListener("click", () => {
        chipValue = v;
        container.querySelectorAll(".rt-chip").forEach((b) => b.classList.toggle("active", +b.dataset.v === v));
      });
      container.appendChild(btn);
    });
  }

  $("#rt-spin").addEventListener("click", doSpin);
  $("#rt-clear").addEventListener("click", () => {
    if (spinning) return;
    bets = {};
    renderBets();
    updateIndicators();
  });

  // ── Boot on screen entry ───────────────────────────────────────
  const screen = document.querySelector('[data-screen="roulette"]');
  let built = false;
  new MutationObserver(() => {
    if (!screen.classList.contains("active")) return;
    resizeCanvas();
    if (!built) { buildTable(); setupChips(); renderBets(); built = true; }
  }).observe(screen, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("resize", () => {
    if (screen.classList.contains("active")) resizeCanvas();
  });
})();
