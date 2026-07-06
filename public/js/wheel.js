"use strict";

/* ============================================================
   Fake Casino – Glücksrad (Wheel of Fortune).
   One free spin per day; the wheel animates to the server's
   chosen segment. Server-authoritative payout.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);

  let segments = [];
  let rotation = 0;   // accumulated rotation (deg)
  let spinning = false;

  const CX = 100, CY = 100, R = 95;
  const pt = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
  };

  function renderWheel() {
    const svg = $("#wheel-svg");
    if (!svg || !segments.length) return;
    const n = segments.length, span = 360 / n;
    let html = "";
    for (let i = 0; i < n; i++) {
      const a0 = i * span, a1 = (i + 1) * span;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
      html += `<path d="M${CX} ${CY} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z" fill="${segments[i].color}" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`;
      const [lx, ly] = pt(a0 + span / 2, R * 0.62);
      html += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" font-size="${segments[i].label.length > 4 ? 8 : 11}" font-weight="800" fill="#12160f" transform="rotate(${a0 + span / 2} ${lx} ${ly})">${escapeHtml(segments[i].label)}</text>`;
    }
    html += `<circle cx="${CX}" cy="${CY}" r="12" fill="#141a24" stroke="#f4d782" stroke-width="2"/>`;
    svg.innerHTML = `<g id="wheel-rot" style="transform-origin:${CX}px ${CY}px;transition:transform 4.5s cubic-bezier(0.16,1,0.3,1)">${html}</g>`;
    applyRotation();
  }
  function applyRotation() {
    const g = document.getElementById("wheel-rot");
    if (g) g.style.transform = `rotate(${rotation}deg)`;
  }

  function updateBtn(state) {
    const btn = $("#wheel-spin");
    if (!btn) return;
    if (spinning) { btn.disabled = true; btn.textContent = "🎡 Dreht…"; return; }
    if (state && !state.canSpin) {
      btn.disabled = true;
      const h = Math.floor(state.msLeft / 3600000), m = Math.floor((state.msLeft % 3600000) / 60000);
      btn.textContent = `⏳ Nächster Dreh in ${h}h ${m}m`;
    } else { btn.disabled = false; btn.textContent = "🎡 Gratis drehen"; }
  }

  function load() {
    socket.emit("wheel:state", (s) => {
      if (!s || !s.ok) return;
      segments = s.segments || [];
      renderWheel();
      updateBtn(s);
    });
  }

  $("#wheel-spin").addEventListener("click", () => {
    if (spinning) return;
    const err = $("#wheel-error"); err.textContent = "";
    spinning = true; updateBtn();
    socket.emit("wheel:spin", (r) => {
      if (!r || !r.ok) { spinning = false; err.textContent = (r && r.error) || "Fehler."; updateBtn({ canSpin: false, msLeft: r && r.msLeft || 0 }); return; }
      const n = segments.length, span = 360 / n;
      // Land segment `index` under the top pointer: its centre must point up.
      const target = 360 * 6 - (r.index * span + span / 2);
      rotation = rotation - (rotation % 360) + target; // keep spinning forward
      applyRotation();
      setTimeout(() => {
        spinning = false;
        if (r.account) applyAccount(r.account);
        toast(r.prize >= 50000 ? `🎉 JACKPOT! +${r.prize.toLocaleString("de-DE")} 🪙!` : `🎡 +${r.prize.toLocaleString("de-DE")} 🪙!`);
        load();
      }, 4700);
    });
  });

  window.Casino._loadWheel = load;
})();
