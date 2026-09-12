"use strict";

/* Chip-Regen
   Chips regnen über den Screen, auf dem man gerade ist, antippen sammelt sie
   ein. Die Ebene lässt Klicks durch, nur die Chips selbst fangen sie.
   Entschieden wird auf dem Server. */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let active = false, mySum = 0;

  const layer = $("#rain-layer");
  const hud = $("#rain-hud");

  function setHud() {
    hud.innerHTML = `Chip-Regen! <b>+${fmt(mySum)}<i class=mk></i></b>`;
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
    /*
     * Gezeichnete Muenze statt Text.
     *
     * Hier stand `el.textContent = "Chips"`, ein Rest der Aktion, in der die
     * Muenz-Emoji ueberall durch das Wort "Chips" ersetzt wurden. In einem
     * Fliesstext ist das richtig, hier fiel dadurch das Wort "Chips" in
     * 2,2rem Schrift vom Himmel statt einer Muenze. Die goldene bekommt einen
     * Ring und einen Stern dazu, damit man sie im Fallen unterscheidet.
     */
    el.innerHTML = c.gold ? goldMuenze() : muenze();
    el.setAttribute("aria-label", c.gold ? "Goldener Chip" : "Chip");
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

  /* Die normale Muenze: dieselbe Form wie die Marke neben jedem Betrag. */
  const muenze = () => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" fill="none"
    stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4" opacity=".65"/>
    <path d="M12 3.6v2.4M12 18v2.4M3.6 12H6M18 12h2.4"/></svg>`;

  /* Die goldene ist fuenfmal so viel wert und muss das im Fallen zeigen. */
  const goldMuenze = () => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" fill="none"
    stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="8.8" fill="currentColor" opacity=".18"/>
    <circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="5.2" opacity=".7"/>
    <path d="M12 8.6l1 2.2 2.4.3-1.8 1.7.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.7 2.4-.3z" fill="currentColor" stroke="none"/></svg>`;

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
    if (mySum > 0) toast(`Regen vorbei, du hast ${fmt(mySum)} Chips gesammelt.`);
    else if (top) toast(`Regen vorbei, ${escapeHtml(top.name)} hat am meisten erwischt (+${fmt(top.sum)}).`);
    mySum = 0;
  }

  socket.on("rain:start", () => { begin(); toast("Chip-Regen! Tipp die fallenden Chips an."); });
  socket.on("rain:chip", spawnChip);
  socket.on("rain:end", end);
  // Bei (Wieder-)Verbindung in einen laufenden Regen einsteigen, neue Chips kommen per Broadcast.
  socket.on("connect", () => socket.emit("rain:state", (s) => { if (s && s.active && !active) begin(); }));
  socket.emit("rain:state", (s) => { if (s && s.active) begin(); });
})();
