"use strict";

/* ============================================================
   Fake Casino – Sportwetten (simulated + real WC) client.
   Match board + a bet slip: tap selections to add legs. 1 leg = single bet,
   2+ legs = combo/parlay (odds multiply, ALL must win). See what others back.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const SAME_GAME_HAIRCUT = 0.90; // mirror of the server

  let data = { matches: [], feed: [], myCombos: [] };
  let betAmount = 100;
  let slip = []; // legs: { matchId, market, selection, odds, label }

  const onScreen = () => {
    const s = document.querySelector('[data-screen="sports"]');
    return s && s.classList.contains("active");
  };

  function load() {
    socket.emit("sports:state", (res) => {
      if (!res || !res.ok) return;
      data = res;
      // Drop slip legs whose match is no longer open.
      slip = slip.filter((l) => { const m = data.matches.find((x) => x.id === l.matchId); return m && m.state === "open"; });
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
    if (m.state === "live") return `<span class="sb-live">🔴 LIVE${m.minute ? ` ${m.minute}'` : ""}</span>`;
    if (m.state === "pending") return `<span class="sb-pending">⏳ läuft · Ergebnis folgt</span>`;
    if (m.state === "done") {
      const o = m.result ? (m.result.outcome === "home" ? m.home : m.result.outcome === "away" ? m.away : "Unentschieden") : "";
      return `<span class="sb-final">Schluss · ${escapeHtml(o)}</span>`;
    }
    if (m.real && m.kickoffAt) {
      const d = new Date(m.kickoffAt);
      return `<span class="sb-kick">⏱ ${d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>`;
    }
    const s = m.kickoffIn, mm = Math.floor(s / 60), ss = s % 60;
    return `<span class="sb-kick">⏱ Anpfiff ${mm}:${String(ss).padStart(2, "0")}</span>`;
  }

  // ── Bet slip ────────────────────────────────────────────────────────────
  const legIn = (matchId, market, selection) => slip.find((l) => l.matchId === matchId && l.market === market && l.selection === selection);
  function toggleLeg(m, market, selection) {
    const odds = m.markets[market].sels[selection];
    const i = slip.findIndex((l) => l.matchId === m.id && l.market === market);
    if (i >= 0 && slip[i].selection === selection) { slip.splice(i, 1); return; } // tap again → remove
    if (slip.length >= 6 && i < 0) { toast("Maximal 6 Tipps pro Kombi."); return; }
    const leg = { matchId: m.id, market, selection, odds, label: `${m.home}–${m.away}: ${selLabel(m, market, selection)}` };
    if (i >= 0) slip[i] = leg; else slip.push(leg); // one leg per match+market
  }
  function comboOdds() {
    const per = {};
    for (const l of slip) per[l.matchId] = (per[l.matchId] || 0) + 1;
    let o = slip.reduce((p, l) => p * l.odds, 1);
    for (const k of Object.values(per)) if (k > 1) o *= Math.pow(SAME_GAME_HAIRCUT, k - 1);
    return Math.round(o * 100) / 100;
  }

  function renderSlip() {
    const el = $("sb-slip-panel");
    if (!el) return;
    if (!slip.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    const o = comboOdds();
    const legs = slip.map((l, i) => `<div class="sb-leg"><span>${escapeHtml(l.label)} <b>@${l.odds.toFixed(2)}</b></span><button class="sb-leg-x" data-i="${i}">✕</button></div>`).join("");
    const title = slip.length === 1 ? "Einzelwette" : `Kombi · ${slip.length} Tipps`;
    el.innerHTML = `
      <div class="sb-slip-head"><b>🎟️ ${title}</b><span>Gesamtquote <b class="sb-odds">${o.toFixed(2)}</b></span></div>
      <div class="sb-legs">${legs}</div>
      <div class="sb-amount-row">
        <input type="number" class="sb-amount" min="50" step="50" value="${betAmount}" inputmode="numeric" />
        <span class="muted small">🪙 → Gewinn <b class="sb-payout">${fmt(betAmount * o)} 🪙</b></span>
      </div>
      <div class="sb-chips">${[100, 1000, 10000, 100000, 1000000].map((v) => `<button class="sb-chip${v === betAmount ? " on" : ""}" data-amt="${v}">${v >= 1e6 ? v / 1e6 + "M" : v >= 1000 ? v / 1000 + "k" : v}</button>`).join("")}</div>
      <div class="sb-slip-actions">
        <button class="sb-slip-clear" data-act="clear">Leeren</button>
        <button class="btn-primary sb-slip-place" data-act="place">${slip.length === 1 ? "Wetten" : "Kombi setzen"} ${fmt(betAmount)} 🪙</button>
      </div>`;
    el.querySelectorAll(".sb-leg-x").forEach((b) => b.addEventListener("click", () => { slip.splice(+b.dataset.i, 1); render(); }));
    el.querySelectorAll(".sb-chip").forEach((b) => b.addEventListener("click", () => { betAmount = +b.dataset.amt; render(); }));
    el.querySelector('[data-act="clear"]').addEventListener("click", () => { slip = []; render(); });
    el.querySelector('[data-act="place"]').addEventListener("click", place);
    const inp = el.querySelector(".sb-amount");
    inp.addEventListener("input", () => {
      betAmount = Math.max(0, Math.floor(Number(inp.value) || 0));
      el.querySelector(".sb-payout").textContent = `${fmt(betAmount * o)} 🪙`;
      el.querySelector(".sb-slip-place").textContent = `${slip.length === 1 ? "Wetten" : "Kombi setzen"} ${fmt(betAmount)} 🪙`;
      el.querySelectorAll(".sb-chip").forEach((c) => c.classList.toggle("on", +c.dataset.amt === betAmount));
    });
  }

  function place() {
    if (!slip.length || betAmount < 50) { toast("Mindesteinsatz 50 🪙."); return; }
    if (slip.length === 1) {
      const l = slip[0];
      socket.emit("sports:bet", { matchId: l.matchId, market: l.market, selection: l.selection, amount: betAmount }, done);
    } else {
      socket.emit("sports:combo", { legs: slip.map((l) => ({ matchId: l.matchId, market: l.market, selection: l.selection })), amount: betAmount }, done);
    }
    function done(res) {
      if (!res || !res.ok) { toast((res && res.error) || "Fehler."); return; }
      if (res.account) applyAccount(res.account);
      toast(slip.length === 1 ? `Wette platziert: ${fmt(betAmount)} 🪙` : `Kombi platziert @${res.comboOdds} 🪙`);
      slip = [];
      load();
    }
  }

  // ── Match board ─────────────────────────────────────────────────────────
  function render() { renderSlip(); renderMatches(); renderCombos(); renderFeed(); }

  function renderMatches() {
    const el = $("sb-matches");
    if (!el) return;
    if (document.activeElement && document.activeElement.classList.contains("sb-amount")) return; // don't wipe typing
    if (!data.matches.length) { el.innerHTML = '<p class="muted small">Neue Spiele werden angesetzt…</p>'; return; }
    const cardHtml = (m) => {
      const showScore = m.state === "live" || m.state === "done";
      let markets = "";
      if (m.state === "open") {
        for (const [mk, def] of Object.entries(m.markets)) {
          const book = m.book[mk] || {};
          const total = Object.values(book).reduce((s, c) => s + c.stake, 0) || 0;
          markets += `<div class="sb-market"><div class="sb-mk-label">${escapeHtml(def.label)}</div><div class="sb-sels">`;
          for (const [sel, od] of Object.entries(def.sels)) {
            const c = book[sel] || { stake: 0, backers: 0 };
            const share = total ? Math.round((c.stake / total) * 100) : 0;
            const on = legIn(m.id, mk, sel) ? " on" : "";
            markets += `<button class="sb-sel${on}" data-id="${m.id}" data-mk="${mk}" data-sel="${sel}">
              <span class="sb-sel-name">${escapeHtml(selLabel(m, mk, sel))}</span>
              <b class="sb-odds">${od.toFixed(2)}</b>
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
      return `<div class="sb-match${m.real ? " sb-real-match" : ""}" data-id="${m.id}">
        <div class="sb-head"><span>${m.leagueEmoji} ${escapeHtml(m.league)}${m.real ? ' <span class="sb-real">ECHT</span>' : ""}</span>${statusHtml(m)}</div>
        <div class="sb-teams"><span>${escapeHtml(m.home)}</span>${showScore ? `<b class="sb-score">${m.score.h} : ${m.score.a}</b>` : `<span class="sb-vs">vs</span>`}<span>${escapeHtml(m.away)}</span></div>
        ${markets}
        ${myb ? `<div class="sb-myb">${myb}</div>` : ""}
      </div>`;
    };

    const real = data.matches.filter((m) => m.real);
    const sim = data.matches.filter((m) => !m.real);
    let html = "";
    if (real.length) html += `<div class="sb-section-head">🌍 Echte WM-Spiele <span class="muted small">· hier zählt das echte Endergebnis</span></div>` + real.map(cardHtml).join("");
    if (sim.length) html += `<div class="sb-section-head">🎮 Simulierte Spiele <span class="muted small">· sofortige Action zwischendurch</span></div>` + sim.map(cardHtml).join("");
    el.innerHTML = html;

    el.querySelectorAll(".sb-sel").forEach((b) => b.addEventListener("click", () => {
      const m = data.matches.find((x) => x.id === +b.dataset.id);
      if (!m) return;
      toggleLeg(m, b.dataset.mk, b.dataset.sel);
      render();
    }));
  }

  function renderCombos() {
    const el = $("sb-combos");
    if (!el) return;
    const cs = data.myCombos || [];
    if (!cs.length) { el.innerHTML = '<p class="muted small">Noch keine Kombi. Tippe mehrere Spiele an → Wettschein.</p>'; return; }
    el.innerHTML = cs.map((c) => {
      const status = !c.settled ? '<span class="muted">offen</span>'
        : c.voided ? `<span class="muted">↩ Erstattet (Spiel abgesagt) ${fmt(c.payout)} 🪙</span>`
        : c.won ? `<span class="pos">✓ Gewonnen +${fmt(c.payout)} 🪙</span>` : '<span class="neg">✗ Verloren</span>';
      const legs = c.legs.map((l) => {
        const ic = l.result === "win" ? "✓" : l.result === "lose" ? "✗" : l.result === "void" ? "↩" : "•";
        const cl = l.result === "win" ? "pos" : l.result === "lose" ? "neg" : "muted";
        return `<div class="sb-combo-leg"><span class="${cl}">${ic}</span> ${escapeHtml(l.label)} <b>@${l.odds.toFixed(2)}</b></div>`;
      }).join("");
      return `<div class="sb-combo">
        <div class="sb-combo-head"><b>${c.legs.length}er-Kombi @${c.comboOdds.toFixed(2)}</b> · ${fmt(c.amount)} 🪙 ${status}</div>
        ${legs}</div>`;
    }).join("");
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

  let poll = null;
  window.Casino._loadSports = () => {
    load();
    clearInterval(poll);
    poll = setInterval(() => { if (onScreen()) load(); else clearInterval(poll); }, 2000);
  };
})();
