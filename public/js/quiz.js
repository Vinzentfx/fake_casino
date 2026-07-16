"use strict";

/* ============================================================
   Fake Casino – Blitz-Quiz (client overlay).
   A few broadcast multiple-choice rounds; the fastest correct
   answer wins the round prize. Server keeps the solution until
   the round is resolved.
   ============================================================ */

(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let active = false, endsAt = 0, myChoice = null;

  const overlay = $("#quiz-overlay");
  const head = $("#quiz-head");
  const qEl = $("#quiz-question");
  const optsEl = $("#quiz-options");
  const barEl = $("#quiz-bar-fill");
  const infoEl = $("#quiz-info");

  function show() { overlay.classList.remove("hidden"); }
  function hide() { overlay.classList.add("hidden"); }

  function begin(d) {
    active = true; show();
    head.textContent = `❓ BLITZ-QUIZ · ${d.rounds} Fragen · ${fmt(d.prize)} 🪙 pro Runde`;
    qEl.textContent = "Mach dich bereit …";
    optsEl.innerHTML = "";
    infoEl.innerHTML = "";
    barEl.style.width = "100%";
  }

  function question(q) {
    if (!q) return;
    active = true; show();
    endsAt = q.endsAt; myChoice = null;
    head.textContent = `❓ Frage ${q.round}/${q.rounds} · ${fmt(q.prize)} 🪙`;
    qEl.textContent = q.text;
    infoEl.innerHTML = "";
    optsEl.innerHTML = "";
    q.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "quiz-opt";
      b.textContent = opt;
      b.addEventListener("click", () => {
        if (myChoice !== null || Date.now() > endsAt) return;
        socket.emit("quiz:answer", { choice: i }, (r) => {
          if (r && r.ok) {
            myChoice = i;
            b.classList.add("picked");
            optsEl.querySelectorAll(".quiz-opt").forEach((o) => (o.disabled = true));
            infoEl.innerHTML = '<span class="muted">Antwort gespeichert — Daumen drücken!</span>';
          }
        });
      });
      optsEl.appendChild(b);
    });
  }

  function result(r) {
    if (!r) return;
    const btns = optsEl.querySelectorAll(".quiz-opt");
    btns.forEach((b, i) => {
      b.disabled = true;
      if (i === r.correct) b.classList.add("correct");
      else if (i === myChoice) b.classList.add("wrong");
    });
    const me = window.Casino.getAccount && window.Casino.getAccount();
    const iWon = r.winner && me && r.winner.name.toLowerCase() === me.name.toLowerCase();
    infoEl.innerHTML = r.winner
      ? `<b class="${iWon ? "quiz-me" : ""}">🏆 ${escapeHtml(r.winner.name)}</b> war am schnellsten (+${fmt(r.prize)} 🪙)` +
        (iWon ? " — das bist DU! 🎉" : "")
      : '<span class="muted">Niemand wusste es … 🤷</span>';
    barEl.style.width = "0%";
  }

  function end(d) {
    active = false;
    const rows = (d && d.board) || [];
    qEl.textContent = d && d.aborted ? "Quiz abgebrochen." : "Quiz vorbei!";
    optsEl.innerHTML = "";
    infoEl.innerHTML = rows.length
      ? `<div class="quiz-board">${rows.map((r, i) => `${i === 0 ? "🏆" : "•"} ${escapeHtml(r.name)}: ${r.wins} richtig`).join("<br>")}</div>`
      : '<span class="muted">Keine richtigen Antworten.</span>';
    setTimeout(hide, d && d.aborted ? 1500 : 8000);
  }

  setInterval(() => {
    if (!active || !endsAt) return;
    const total = 12000;
    const left = Math.max(0, endsAt - Date.now());
    barEl.style.width = Math.min(100, (100 * left) / total) + "%";
  }, 150);

  socket.on("quiz:begin", (d) => { begin(d); toast("❓ BLITZ-QUIZ startet!"); });
  socket.on("quiz:question", question);
  socket.on("quiz:result", result);
  socket.on("quiz:end", end);
  // Rejoin a running quiz on (re)connect.
  const rejoin = () => socket.emit("quiz:state", (s) => {
    if (s && s.active) { begin({ rounds: s.rounds, prize: s.prize }); if (s.question) question(s.question); }
  });
  socket.on("connect", rejoin);
  rejoin();
})();
