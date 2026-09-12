"use strict";

/**
 * Lotterie, Oberfläche.
 *
 * Ein Tippschein mit sechzehn Zahlen, vier davon ankreuzen, Los kaufen. Die
 * Ziehung laeuft abends von selbst; wer dann nicht da ist, verpasst nichts.
 * Genau deshalb passt das Spiel hierher: es verlangt keine Gleichzeitigkeit.
 */
(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let stand = null;
  let gewaehlt = new Set();
  let uhr = null;

  function restText(bis) {
    const ms = Math.max(0, bis - Date.now());
    const std = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const sek = Math.floor((ms % 60000) / 1000);
    if (std > 0) return `${std} Std ${min} Min`;
    if (min > 0) return `${min}:${String(sek).padStart(2, "0")} Min`;
    return `${sek} Sek`;
  }

  function zeichneZahlen() {
    const box = $("#lo-zahlen");
    if (!box || !stand) return;
    box.innerHTML = "";
    for (let n = 1; n <= stand.zahlenBis; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lo-zahl" + (gewaehlt.has(n) ? " gewaehlt" : "");
      b.textContent = String(n);
      b.dataset.zahl = String(n);
      box.appendChild(b);
    }
    const voll = gewaehlt.size === stand.tipps;
    const kaufen = $("#lo-kaufen");
    kaufen.disabled = !voll;
    kaufen.innerHTML = voll
      ? `Los kaufen (${Casino.betrag(stand.lospreis)})`
      : `Noch ${stand.tipps - gewaehlt.size} Zahl${stand.tipps - gewaehlt.size === 1 ? "" : "en"} wählen`;
  }

  function zeichne(s) {
    if (!s || !s.ok) return;
    stand = s;

    $("#lo-jackpot").innerHTML = Casino.betrag(s.jackpot);
    $("#lo-anzahl").textContent = String(s.tipps);

    clearInterval(uhr);
    const tick = () => {
      const el = $("#lo-naechste");
      if (!el) return;
      el.textContent = `Ziehung ${s.nr} in ${restText(s.naechste)}`;
    };
    tick();
    uhr = setInterval(() => {
      if (Casino.screens.current() !== "lotterie") { clearInterval(uhr); return; }
      tick();
    }, 1000);

    zeichneZahlen();

    // Eigene Lose
    const meine = $("#lo-meine");
    meine.innerHTML = s.meineLose.length
      ? `<h3 class="lo-titel">Deine Lose (${s.meineLose.length} von ${s.maxLose})</h3>` +
        s.meineLose.map((t) => `<div class="lo-los">${t.map((z) => `<span>${z}</span>`).join("")}</div>`).join("")
      : `<p class="muted small">Noch kein Los für diese Ziehung.</p>`;

    // Was es zu gewinnen gibt
    $("#lo-info").innerHTML = `
      <h3 class="lo-titel">Was gezahlt wird</h3>
      <div class="lo-stufe"><b>4 Richtige</b><em>1 zu 1.820</em><span>Jackpot</span></div>
      <div class="lo-stufe"><b>3 Richtige</b><em>1 zu 38</em><span>${Casino.betrag(s.gewinn3)}</span></div>
      <div class="lo-stufe"><b>2 Richtige</b><em>1 zu 5</em><span>${Casino.betrag(s.gewinn2)}</span></div>
      <p class="muted small">${s.verkauft} Lose von ${s.mitspieler} ${s.mitspieler === 1 ? "Person" : "Leuten"} für diese Ziehung.
      Ein Teil jedes Loses wächst in den Jackpot, der Rest bleibt im Haus.</p>`;

    // Letzte Ziehung
    const l = s.letzte;
    $("#lo-letzte").innerHTML = l
      ? `<h3 class="lo-titel">Ziehung ${l.nr}</h3>
         <div class="lo-gezogen">${l.gezogen.map((z) => `<span>${z}</span>`).join("")}</div>
         <p class="muted small">
           ${l.gewinner[4].length ? `Jackpot an ${l.gewinner[4].join(", ")}: ${fmt(l.jackpotAus)} Chips.`
             : "Kein Volltreffer."}
           ${l.gewinner[3].length ? ` 3 Richtige: ${l.gewinner[3].join(", ")}.` : ""}
           ${l.gewinner[2] ? ` ${l.gewinner[2]}× zwei Richtige.` : ""}
         </p>`
      : `<p class="muted small">Noch keine Ziehung gelaufen.</p>`;
  }

  function kaufen() {
    const err = $("#lo-error"); err.textContent = "";
    if (!stand || gewaehlt.size !== stand.tipps) return;
    const btn = $("#lo-kaufen"); btn.disabled = true;
    socket.emit("lotterie:kaufen", { zahlen: [...gewaehlt] }, (r) => {
      btn.disabled = false;
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Ging nicht."; return; }
      if (r.account) applyAccount(r.account);
      Casino.sound?.play("select");
      toast(`Los gekauft: ${r.tipp.join(" · ")}`);
      gewaehlt.clear();
      zeichne(r);
    });
  }

  function wire() {
    $("#lo-zahlen")?.addEventListener("click", (e) => {
      const b = e.target.closest(".lo-zahl");
      if (!b || !stand) return;
      const n = Number(b.dataset.zahl);
      if (gewaehlt.has(n)) gewaehlt.delete(n);
      else if (gewaehlt.size < stand.tipps) gewaehlt.add(n);
      else { toast(`Nur ${stand.tipps} Zahlen. Nimm erst eine weg.`); return; }
      zeichneZahlen();
    });
    $("#lo-leeren")?.addEventListener("click", () => { gewaehlt.clear(); zeichneZahlen(); });
    $("#lo-zufall")?.addEventListener("click", () => {
      socket.emit("lotterie:zufall", (r) => {
        if (r && r.ok) { gewaehlt = new Set(r.tipp); zeichneZahlen(); }
      });
    });
    $("#lo-kaufen")?.addEventListener("click", kaufen);
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire, { once: true });

  // Die Ziehung laeuft auch, wenn gerade niemand hinschaut.
  socket.on("lotterie:update", () => {
    if (Casino.screens.current() === "lotterie") {
      socket.emit("lotterie:state", (r) => zeichne(r));
    }
  });

  window.Casino._loadLotterie = () => {
    gewaehlt.clear();
    socket.emit("lotterie:state", (r) => zeichne(r));
  };
})();
