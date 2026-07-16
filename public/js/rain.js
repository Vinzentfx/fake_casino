"use strict";

/* ============================================================
   Fake Casino – Chip-Regen (client).
   Chips rain over whatever screen you're on; tap them to grab.
   Falls through to the page beneath (layer is click-through,
   only the chips themselves catch taps). Server-authoritative.
   ============================================================ */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let active = false, mySum = 0;

  const layer = $("#rain-layer");
  const hud = $("#rain-hud");

  function setHud() {
    hud.innerHTML = `💸 Chip-Regen! <b>+${fmt(mySum)} 🪙</b>`;
    hud.classList.toggle("hidden", !active);
  }

  function begin() {
    active = true; mySum = 0;
    setHud();
  }

  function spawnChip(c) {
    if (!layer) return;
    const el = document.createElement("button");
    el.className = "rain-chip" + (c.gold ? " gold" : "");
    el.textContent = c.gold ? "💰" : "🪙";
    el.style.left = (c.x * 100) + "%";
    el.style.animationDuration = c.dur + "ms";
    let claimed = false;
    const grab = (ev) => {
      ev.preventDefault();
      if (claimed) return;
      claimed = true;
      socket.emit("rain:grab", { id: c.id }, (r) => {
        if (r && r.ok) {
          mySum = r.mySum; setHud();
          if (r.balance != null && window.Casino.setChips) window.Casino.setChips(r.balance);
          pop(el, `+${fmt(r.value)}`, c.gold);
        } else {
          claimed = false; // rate-limited? allow retry
          if (r && r.gone) el.remove();
        }
      });
    };
    el.addEventListener("pointerdown", grab);
    el.addEventListener("animationend", () => el.remove());
    layer.appendChild(el);
  }

  function pop(el, txt, gold) {
    const rect = el.getBoundingClientRect();
    el.remove();
    const p = document.createElement("div");
    p.className = "rain-pop" + (gold ? " gold" : "");
    p.textContent = txt;
    p.style.left = rect.left + rect.width / 2 + "px";
    p.style.top = rect.top + "px";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }

  function end(d) {
    active = false;
    if (layer) layer.querySelectorAll(".rain-chip").forEach((n) => n.remove());
    setHud();
    if (!d) return;
    const top = d.results && d.results[0];
    if (mySum > 0) toast(`💸 Regen vorbei — du hast ${fmt(mySum)} 🪙 gesammelt!`);
    else if (top) toast(`💸 Regen vorbei — ${escapeHtml(top.name)} war am fleißigsten (+${fmt(top.sum)}).`);
    mySum = 0;
  }

  socket.on("rain:start", () => { begin(); toast("💸 CHIP-REGEN! Tipp die fallenden Chips an!"); });
  socket.on("rain:chip", spawnChip);
  socket.on("rain:end", end);
  // Join a running rain on (re)connect — new chips arrive via broadcast.
  socket.on("connect", () => socket.emit("rain:state", (s) => { if (s && s.active && !active) begin(); }));
  socket.emit("rain:state", (s) => { if (s && s.active) begin(); });
})();
