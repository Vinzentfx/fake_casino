"use strict";

/* ============================================================
   Fake Casino – Sportwetten (simulated) client.
   Renders the live match board, odds, what others are backing, and a bet slip.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let data = { matches: [], feed: [] };
  let betAmount = 100;
  const picks = {}; // matchId -> { market, selection, odds }
  let poll = null;

  const onScreen = () => {
    const s = document.querySelector('[data-screen="sports"]');
    return s && s.classList.contains("active");
  };

  function load() {
    socket.emit("sports:state", (res) => {
      if (!res || !res.ok) return;
      data = res;
      render();
    });
  }

  // ── Labels ──────────────────────────────────────────────────────────────
  function selLabel(m, market, sel) {
    if (market === "1x2") return sel === "home" ? m.home : sel === "away" ? m.away : "Unent.";
    if (market === "ou25") return sel === "over" ? "Über 2,5" : "Unter 2,5";
    if (market === "btts") return sel === "yes" ? "Beide" : "Keiner";
    return sel;
  }

  function statusHtml(m) {
    if (m.state === "live") return `<span class="sb-live">🔴 LIVE ${m.minute}'</span>`;
    if (m.state === "done") {
      const o = m.result ? (m.result.outcome === "home" ? m.home : m.result.outcome === "away" ? m.away : "Unentschieden") : "";
      return `<span class="sb-final">Schluss · ${escapeHtml(o)}</span>`;
    }
    const s = m.kickoffIn;
    const mm = Math.floor(s / 60), ss = s % 60;
    return `<span class="sb-kick">⏱ Anpfiff ${mm}:${String(ss).padStart(2, "0")}</span>`;
  }

  function render() {
    renderMatches();
    renderFeed();
  }

  function renderMatches() {
    const el = $("sb-matches");
    if (!el) return;
    if (!data.matches.length) { el.innerHTML = '<p class="muted small">Neue Spiele werden angesetzt…</p>'; return; }
    el.innerHTML = data.matches.map((m) => {
      const showScore = m.state === "live" || m.state === "done";
      const pick = picks[m.id];
      let markets = "";
      if (m.state === "open") {
        for (const [mk, def] of Object.entries(m.markets)) {
          const book = m.book[mk] || {};
          const total = Object.values(book).reduce((s, c) => s + c.stake, 0) || 0;
          markets += `<div class="sb-market"><div class="sb-mk-label">${escapeHtml(def.label)}</div><div class="sb-sels">`;
          for (const [sel, o] of Object.entries(def.sels)) {
            const c = book[sel] || { stake: 0, backers: 0 };
            const share = total ? Math.round((c.stake / total) * 100) : 0;
            const on = pick && pick.market === mk && pick.selection === sel;
            markets += `<button class="sb-sel${on ? " on" : ""}" data-mk="${mk}" data-sel="${sel}">
              <span class="sb-sel-name">${escapeHtml(selLabel(m, mk, sel))}</span>
              <b class="sb-odds">${o.toFixed(2)}</b>
              <span class="sb-book">${c.backers ? `${c.backers}·${fmt(c.stake)}` : "—"}</span>
              <span class="sb-bar" style="width:${share}%"></span></button>`;
          }
          markets += `</div></div>`;
        }
      }
      const myb = (m.myBets || []).map((b) => {
        const st = m.state === "done" ? (b.won ? `<span class="pos">✓ +${fmt(b.payout)}</span>` : `<span class="neg">✗</span>`) : `<span class="muted">offen</span>`;
        return `<div class="sb-myb-row">${escapeHtml(selLabel(m, b.market, b.selection))} @${b.odds.toFixed(2)} · ${fmt(b.amount)} 🪙 ${st}</div>`;
      }).join("");

      const slip = pick ? `<div class="sb-slip">
        <div class="sb-slip-info">${escapeHtml(selLabel(m, pick.market, pick.selection))} @${pick.odds.toFixed(2)} → <b>${fmt(betAmount * pick.odds)} 🪙</b></div>
        <div class="sb-chips">${[100, 1000, 10000, 100000].map((v) => `<button class="sb-chip${v === betAmount ? " on" : ""}" data-amt="${v}">${v >= 1000 ? v / 1000 + "k" : v}</button>`).join("")}</div>
        <button class="btn-primary sb-place" data-id="${m.id}">Wetten ${fmt(betAmount)} 🪙</button>
      </div>` : "";

      return `<div class="sb-match" data-id="${m.id}">
        <div class="sb-head"><span>${m.leagueEmoji} ${escapeHtml(m.league)}</span>${statusHtml(m)}</div>
        <div class="sb-teams"><span>${escapeHtml(m.home)}</span>${showScore ? `<b class="sb-score">${m.score.h} : ${m.score.a}</b>` : `<span class="sb-vs">vs</span>`}<span>${escapeHtml(m.away)}</span></div>
        ${markets}
        ${myb ? `<div class="sb-myb">${myb}</div>` : ""}
        ${slip}
      </div>`;
    }).join("");

    el.querySelectorAll(".sb-sel").forEach((b) => b.addEventListener("click", () => {
      const card = b.closest(".sb-match");
      const id = +card.dataset.id;
      const m = data.matches.find((x) => x.id === id);
      const o = m.markets[b.dataset.mk].sels[b.dataset.sel];
      picks[id] = { market: b.dataset.mk, selection: b.dataset.sel, odds: o };
      render();
    }));
    el.querySelectorAll(".sb-chip").forEach((b) => b.addEventListener("click", () => { betAmount = +b.dataset.amt; render(); }));
    el.querySelectorAll(".sb-place").forEach((b) => b.addEventListener("click", () => placeBet(+b.dataset.id)));
  }

  function placeBet(id) {
    const pick = picks[id];
    if (!pick) return;
    socket.emit("sports:bet", { matchId: id, market: pick.market, selection: pick.selection, amount: betAmount }, (res) => {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      if (res.account) applyAccount(res.account);
      delete picks[id];
      toast(`Wette platziert: ${fmt(betAmount)} 🪙`);
      load();
    });
  }

  function renderFeed() {
    const el = $("sb-feed");
    if (!el) return;
    if (!data.feed.length) { el.innerHTML = '<p class="muted small">Noch keine Tipps. Sei der Erste!</p>'; return; }
    el.innerHTML = data.feed.map((f) =>
      `<div class="sb-feed-row"><b>${escapeHtml(f.name)}</b> tippt <span class="sb-feed-sel">${escapeHtml(f.sel)}</span> <span class="muted">(${escapeHtml(f.match)})</span> · ${fmt(f.amount)} 🪙 @${f.odds.toFixed(2)}</div>`
    ).join("");
  }

  socket.on("sports:update", () => { if (onScreen()) load(); });

  window.Casino._loadSports = () => {
    load();
    clearInterval(poll);
    poll = setInterval(() => { if (onScreen()) load(); else clearInterval(poll); }, 2000);
  };
})();
