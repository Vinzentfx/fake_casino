"use strict";

/* ============================================================
   Fake Casino – Team-Tresorkampf (client overlay).
   Red vs. blue: both teams hammer their own vault, the faster
   team splits the pot by hits. Server-authoritative.
   ============================================================ */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let active = false, endsAt = 0, myTeam = null, myHits = 0;

  const overlay = $("#vault-overlay");
  const btn = $("#vault-hit");

  // Minimieren: Kampf läuft weiter, Pill unten rechts holt das Overlay zurück.
  let minimized = false;
  const pill = $("#vault-pill");
  $("#vault-min").addEventListener("click", () => {
    minimized = true;
    overlay.classList.add("hidden");
    if (active) pill.classList.remove("hidden");
  });
  pill.addEventListener("click", () => {
    minimized = false;
    pill.classList.add("hidden");
    if (active) overlay.classList.remove("hidden");
  });

  function bar(team, s) {
    const pct = Math.max(0, Math.round((100 * s[team].hp) / s[team].max));
    $(`#vault-${team}-fill`).style.width = pct + "%";
    $(`#vault-${team}-txt`).textContent = `${team === "red" ? "🔴 Rot" : "🔵 Blau"} · Tresor ${pct}%`;
    $(`#vault-${team}-roster`).textContent = (s[team].names || []).join(", ");
  }

  function setTeamUi() {
    btn.className = "vault-hit" + (myTeam ? " " + myTeam : "");
    btn.textContent = myTeam ? `💥 DRAUF! (für ${myTeam === "red" ? "ROT" : "BLAU"})` : "💥 MITMACHEN!";
    $("#vault-my-team").innerHTML = myTeam
      ? `Du kämpfst für <b>${myTeam === "red" ? "🔴 Team Rot" : "🔵 Team Blau"}</b>`
      : "Hau drauf und du wirst dem kleineren Team zugelost!";
  }

  function show(s) {
    active = true; endsAt = s.endsAt; myHits = 0;
    myTeam = s.myTeam || null;
    if (minimized) pill.classList.remove("hidden");
    else overlay.classList.remove("hidden");
    $("#vault-result").innerHTML = "";
    btn.style.display = "";
    $("#vault-pot").innerHTML = `Pot: <b>${fmt(s.pot)} 🪙</b>`;
    setTeamUi();
    update(s);
  }

  function update(s) {
    if (!s || !s.active) return;
    endsAt = s.endsAt;
    bar("red", s); bar("blue", s);
  }

  setInterval(() => {
    if (!active) return;
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    const t = $("#vault-timer");
    if (t) t.textContent = `⏱️ ${left}s · deine Treffer: ${myHits}`;
  }, 200);

  function end(d) {
    active = false;
    btn.style.display = "none";
    const box = $("#vault-result");
    if (d && d.winner) {
      const me = window.Casino.getAccount && window.Casino.getAccount();
      const mine = (d.results || []).find((r) => me && r.name.toLowerCase() === me.name.toLowerCase());
      const won = myTeam === d.winner;
      box.innerHTML =
        `<div class="${won ? "heist-win" : "heist-fail"}">${d.winner === "red" ? "🔴 TEAM ROT" : "🔵 TEAM BLAU"} GEWINNT!</div>` +
        (mine ? `<div>Dein Anteil: <b>+${fmt(mine.share)} 🪙</b> (${mine.hits} Treffer)</div>` : won ? "" : `<div class="muted small">Knapp daneben — nächstes Mal!</div>`) +
        `<div class="heist-crooks">${(d.results || []).slice(0, 6).map((r) => `${escapeHtml(r.name)}: +${fmt(r.share)}`).join(" · ")}</div>`;
    } else if (d && d.draw) {
      box.innerHTML = '<div class="heist-fail">🤝 Unentschieden — der Pot bleibt im Tresor!</div>';
    } else {
      box.innerHTML = '<div class="heist-fail">Tresorkampf beendet.</div>';
    }
    $("#vault-timer").textContent = "";
    pill.classList.add("hidden");
    minimized = false;
    setTimeout(() => overlay.classList.add("hidden"), 7000);
  }

  btn.addEventListener("click", () => {
    if (!active) return;
    socket.emit("vault:hit", (r) => {
      if (r && r.ok) {
        myHits = r.myHits;
        if (r.team !== myTeam) { myTeam = r.team; setTeamUi(); }
      }
    });
  });

  socket.on("vault:start", (s) => {
    // The broadcast has no per-player team — fetch it, then show.
    socket.emit("vault:state", (st) => { show(st && st.active ? st : s); });
    toast("⚔️ TEAM-TRESORKAMPF! Rot gegen Blau!");
  });
  socket.on("vault:progress", update);
  socket.on("vault:end", end);
  // Join a running fight on (re)connect.
  socket.on("connect", () => socket.emit("vault:state", (s) => { if (s && s.active) show(s); }));
  socket.emit("vault:state", (s) => { if (s && s.active) show(s); });
})();
