"use strict";

/* Casino-Heist (Overlay)
   Alle hauen auf KNACKEN!, bis der Tresor leer ist oder die Zeit abläuft. Die
   Beute wird nach Treffern verteilt, entschieden wird auf dem Server. */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let active = false, endsAt = 0, myHits = 0;

  // Minimieren: Heist läuft weiter, Pill unten rechts holt das Overlay zurück.
  let minimized = false;
  $("#heist-min").addEventListener("click", () => {
    minimized = true;
    $("#heist-overlay").classList.add("hidden");
    if (active) $("#heist-pill").classList.remove("hidden");
  });
  $("#heist-pill").addEventListener("click", () => {
    minimized = false;
    $("#heist-pill").classList.add("hidden");
    if (active) $("#heist-overlay").classList.remove("hidden");
  });

  function show(s) {
    active = true; endsAt = s.endsAt; myHits = 0;
    if (minimized) $("#heist-pill").classList.remove("hidden");
    else $("#heist-overlay").classList.remove("hidden");
    $("#heist-result").innerHTML = "";
    $("#heist-crack").style.display = "";
    $("#heist-crack").disabled = false;
    $("#heist-loot").innerHTML = `Beute: <b>${fmt(s.loot)}<i class=mk></i></b>`;
    update(s);
  }
  function update(s) {
    if (!s || !s.active) return;
    endsAt = s.endsAt;
    const pct = Math.max(0, Math.round((100 * s.vaultHp) / s.vaultMax));
    $("#heist-vault-fill").style.width = pct + "%";
    $("#heist-vault-txt").textContent = `Tresor ${pct}%`;
  }
  function tickTimer() {
    if (!active) return;
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const t = $("#heist-timer");
    if (t) t.textContent = `Noch ${left}s · deine Treffer: ${myHits}`;
  }
  setInterval(tickTimer, 200);

  function end(d) {
    active = false;
    $("#heist-crack").style.display = "none";
    const box = $("#heist-result");
    if (d.success) {
      const mine = (d.results || []).find((r) => {
        const me = window.Casino.getAccount && window.Casino.getAccount();
        return me && r.name.toLowerCase() === me.name.toLowerCase();
      });
      box.innerHTML = `<div class="heist-win">Tresor geknackt!</div>` +
        (mine ? `<div>Dein Anteil: <b>+${fmt(mine.share)}<i class=mk></i></b> (${mine.hits} Treffer)</div>` : `<div class="muted small">Du warst nicht dabei.</div>`) +
        `<div class="heist-crooks">${(d.results || []).slice(0, 6).map((r) => `${escapeHtml(r.name)}: +${fmt(r.share)}`).join(" · ")}</div>`;
    } else {
      box.innerHTML = `<div class="heist-fail">Der Tresor hat gehalten, Heist gescheitert.</div>`;
    }
    $("#heist-timer").textContent = "";
    $("#heist-pill").classList.add("hidden");
    minimized = false;
    setTimeout(() => $("#heist-overlay").classList.add("hidden"), 6000);
  }

  $("#heist-crack").addEventListener("click", () => {
    if (!active) return;
    socket.emit("heist:hit", (r) => { if (r && r.ok) { myHits = r.myHits; } });
  });

  socket.on("heist:start", (s) => { show(s); toast("Casino-Heist! Ran an den Tresor."); });
  socket.on("heist:progress", update);
  socket.on("heist:end", end);
  // Beim Verbinden oder Neuverbinden in einen laufenden Heist einsteigen.
  socket.on("connect", () => socket.emit("heist:state", (s) => { if (s && s.active) show(s); }));
  socket.emit("heist:state", (s) => { if (s && s.active) show(s); });
})();
