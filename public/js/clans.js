"use strict";

/* ============================================================
   Fake Casino – Clans / Familien (client).
   Gründen/Beitreten, Roster & Rollen, Schatzkammer (spenden),
   Clan-Kriege, Wochenliga und Clan-Rangliste.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let data = null;
  const canManage = () => data && (data.myRole === "founder" || data.myRole === "officer");
  const isFounder = () => data && data.myRole === "founder";
  const roleIcon = (r) => (r === "founder" ? "👑" : r === "officer" ? "⭐" : "");

  // ── My clan / create ──────────────────────────────────────
  function renderMine() {
    const box = $("#clan-mine");
    if (!box) return;
    if (!data.clan) {
      box.innerHTML =
        `<div class="clan-create">` +
        `<div class="cd-sub">Clan gründen (${fmt(data.createCost)} 🪙)</div>` +
        `<div class="crash-betrow"><label>Name<input id="clan-name" maxlength="22" placeholder="z. B. Die Haie" /></label>` +
        `<label>Tag<input id="clan-tag" maxlength="4" placeholder="HAI" style="text-transform:uppercase" /></label></div>` +
        `<button class="btn-primary" id="clan-create-btn" style="width:100%;margin-top:8px">🛡️ Clan gründen</button>` +
        `<div class="form-error" id="clan-error"></div></div>` +
        `<p class="muted small" style="margin:12px 0 4px">…oder unten einem Clan beitreten (bei 🔒 geschlossenen Clans per Anfrage).</p>`;
      $("#clan-create-btn").addEventListener("click", () => {
        const name = $("#clan-name").value.trim(), tag = $("#clan-tag").value.trim();
        socket.emit("clan:create", { name, tag }, (r) => {
          if (!r || !r.ok) { $("#clan-error").textContent = (r && r.error) || "Fehler."; return; }
          if (r.account) applyAccount(r.account);
          toast(`🛡️ Clan [${r.clan.tag}] gegründet!`); load();
        });
      });
      return;
    }

    const c = data.clan;
    const manage = canManage(), founder = isFounder();
    const lvl = c.level || { level: 1, xpInLevel: 0, xpForNext: 500 };
    const xpPct = lvl.xpForNext ? Math.min(100, Math.round((100 * lvl.xpInLevel) / lvl.xpForNext)) : 100;
    let html =
      `<div class="clan-header" style="border-color:${c.color}"><b style="color:${c.color}">[${escapeHtml(c.tag)}] ${escapeHtml(c.name)}</b>` +
      `<span class="muted small">Level ${lvl.level} · ${c.size} Mitglieder · ${roleIcon(data.myRole)} ${data.myRole === "founder" ? "Gründer" : data.myRole === "officer" ? "Offizier" : "Mitglied"}</span></div>`;

    html += `<div class="clan-level-card">` +
      `<div class="level-head"><b>Clan-Level ${lvl.level}</b><span class="muted small">${fmt(lvl.xpInLevel)} / ${fmt(lvl.xpForNext)} XP</span></div>` +
      `<div class="level-bar"><div class="level-fill" style="width:${xpPct}%;background:${c.color}"></div></div>` +
      `<div class="muted small">XP kommt aus echten Duell-Siegen und Clan-Aufträgen. Keine Chip-Belohnungen, nur Prestige.</div>` +
      `</div>`;

    // Motto
    html += `<div class="clan-motto">${c.motto ? `„${escapeHtml(c.motto)}”` : '<span class="muted small">Kein Motto.</span>'}`;
    if (manage) html += ` <button class="chip-btn" id="clan-motto-btn" title="Motto ändern">✏️</button>`;
    html += `</div>`;

    // Treasury
    html += `<div class="clan-treasury"><div>💰 Schatzkammer: <b>${fmt(c.treasury)} 🪙</b></div>` +
      `<div class="clan-donate-row"><input id="clan-donate-amt" type="number" min="1" placeholder="Betrag" />` +
      `<button class="btn-secondary" id="clan-donate-btn">Spenden</button></div></div>`;

    const quests = c.quests || [];
    html += `<div class="clan-quests"><div class="cd-sub">Wöchentliche Clan-Aufträge</div>` +
      (quests.length ? quests.map((q) => {
        const pct = q.target ? Math.min(100, Math.round((100 * q.progress) / q.target)) : 0;
        return `<div class="clan-quest ${q.done ? "done" : ""}">` +
          `<div><b>${q.done ? "✓ " : ""}${escapeHtml(q.label)}</b><span>${fmt(q.progress)} / ${fmt(q.target)} · +${fmt(q.xp)} XP</span></div>` +
          `<div class="clan-quest-bar"><i style="width:${pct}%"></i></div>` +
          `</div>`;
      }).join("") : `<p class="muted small">Keine Aufträge aktiv.</p>`) +
      `</div>`;

    // Roster with role controls
    html += `<div class="clan-roster">` + c.members.map((m) => {
      let ctrls = "";
      if (m.key !== c.founder) {
        if (founder) ctrls += m.role === "officer"
          ? `<button class="chip-btn clan-demote" data-k="${m.key}" title="Degradieren">⬇️</button>`
          : `<button class="chip-btn clan-promote" data-k="${m.key}" title="Zum Offizier">⭐</button>`;
        // kick: founder can kick anyone; officer can kick plain members
        if (founder || (manage && m.role === "member")) ctrls += `<button class="chip-btn clan-kick" data-k="${m.key}" title="Kicken">🚫</button>`;
      }
      return `<div class="clan-mrow"><span>${roleIcon(m.role)} ${escapeHtml(m.name)}</span><span><b>${fmt(m.value)} 🪙</b> ${ctrls}</span></div>`;
    }).join("") + `</div>`;

    // Requests (managers)
    if (manage && c.requests && c.requests.length) {
      html += `<div class="clan-requests"><div class="cd-sub">Beitritts-Anfragen</div>` + c.requests.map((r) =>
        `<div class="clan-mrow"><span>${escapeHtml(r.name)}</span><span>` +
        `<button class="chip-btn clan-appr" data-k="${r.key}">✅</button>` +
        `<button class="chip-btn clan-deny" data-k="${r.key}">❌</button></span></div>`).join("") + `</div>`;
    }

    // Manager row: closed toggle
    if (manage) {
      html += `<label class="clan-closed"><input type="checkbox" id="clan-closed-chk" ${c.closed ? "checked" : ""}/> 🔒 Geschlossen (Beitritt nur auf Anfrage)</label>`;
    }

    html += `<button class="btn-danger" id="clan-leave" style="width:100%;margin-top:10px">Clan verlassen</button>`;
    box.innerHTML = html;

    // Wire controls
    $("#clan-leave").addEventListener("click", () => {
      if (!confirm("Clan wirklich verlassen?")) return;
      socket.emit("clan:leave", (r) => { if (r && r.ok) { toast("Clan verlassen."); load(); } else toast(r?.error || "Fehler."); });
    });
    $("#clan-donate-btn")?.addEventListener("click", () => {
      const amt = parseInt($("#clan-donate-amt").value, 10);
      if (!Number.isFinite(amt) || amt < 1) { toast("Betrag eingeben."); return; }
      socket.emit("clan:donate", { amount: amt }, (r) => {
        if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
        if (r.account) applyAccount(r.account); toast(`💰 ${fmt(amt)} 🪙 gespendet.`); load();
      });
    });
    $("#clan-motto-btn")?.addEventListener("click", () => {
      const motto = prompt("Clan-Motto:", c.motto || "");
      if (motto == null) return;
      socket.emit("clan:setMotto", { motto }, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
    });
    $("#clan-closed-chk")?.addEventListener("change", (e) => {
      socket.emit("clan:setClosed", { closed: e.target.checked }, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
    });
    box.querySelectorAll(".clan-promote").forEach((b) => b.addEventListener("click", () => act("clan:promote", { key: b.dataset.k })));
    box.querySelectorAll(".clan-demote").forEach((b) => b.addEventListener("click", () => act("clan:demote", { key: b.dataset.k })));
    box.querySelectorAll(".clan-kick").forEach((b) => b.addEventListener("click", () => { if (confirm("Mitglied kicken?")) act("clan:kick", { key: b.dataset.k }); }));
    box.querySelectorAll(".clan-appr").forEach((b) => b.addEventListener("click", () => act("clan:approveRequest", { key: b.dataset.k })));
    box.querySelectorAll(".clan-deny").forEach((b) => b.addEventListener("click", () => act("clan:denyRequest", { key: b.dataset.k })));
  }

  function act(ev, payload) {
    socket.emit(ev, payload, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
  }

  // ── War panel ─────────────────────────────────────────────
  function renderWar() {
    const box = $("#clan-war");
    if (!box) return;
    const c = data.clan, w = c && c.war;
    if (!w) { box.innerHTML = ""; return; }
    const myId = c.id, iChallenged = w.aId === myId;
    let html = `<div class="clan-warcard">`;
    if (w.state === "pending") {
      if (iChallenged) {
        html += `<b>⚔️ Kriegs-Herausforderung gesendet</b><div class="muted small">An [${escapeHtml(w.bTag)}] ${escapeHtml(w.bName)} · Einsatz ${fmt(w.stake)} 🪙 · ${w.days} Tage. Warte auf Annahme…</div>`;
      } else {
        html += `<b>⚔️ Herausgefordert von [${escapeHtml(w.aTag)}] ${escapeHtml(w.aName)}!</b>` +
          `<div class="muted small">Einsatz ${fmt(w.stake)} 🪙 aus eurer Schatzkammer · ${w.days} Tage.</div>`;
        if (canManage()) html += `<div class="clan-war-actions"><button class="btn-primary" id="war-accept">Annehmen</button><button class="btn-secondary" id="war-decline">Ablehnen</button></div>`;
        else html += `<div class="muted small">Nur Gründer/Offiziere können annehmen.</div>`;
      }
    } else if (w.state === "active") {
      const left = w.endsAt ? Math.max(0, w.endsAt - Date.now()) : 0;
      const hrs = Math.floor(left / 3600000), mins = Math.floor((left % 3600000) / 60000);
      html += `<b>⚔️ Clan-Krieg läuft</b>` +
        `<div class="clan-war-score"><span style="color:${w.aId === myId ? c.color : "#9aa4b2"}">[${escapeHtml(w.aTag)}] ${w.aScore}</span>` +
        `<span class="muted">:</span><span style="color:${w.bId === myId ? c.color : "#9aa4b2"}">${w.bScore} [${escapeHtml(w.bTag)}]</span></div>` +
        `<div class="muted small">Pot ${fmt(w.stake * 2)} 🪙 · noch ${hrs}h ${mins}min · jeder Duell-Sieg zählt!</div>`;
    }
    html += `</div>`;
    box.innerHTML = html;
    $("#war-accept")?.addEventListener("click", () => socket.emit("clan:acceptWar", (r) => { if (r && r.ok) { toast("⚔️ Krieg angenommen!"); load(); } else toast(r?.error || "Fehler."); }));
    $("#war-decline")?.addEventListener("click", () => socket.emit("clan:declineWar", (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); }));
  }

  // ── Weekly league ─────────────────────────────────────────
  function renderWeekly() {
    const list = $("#clan-weekly");
    if (!list) return;
    const wl = data.weeklyLeague || [];
    if (!wl.length) { list.innerHTML = '<li class="muted small">Noch keine Duell-Siege diese Woche.</li>'; return; }
    const medals = ["🥇", "🥈", "🥉"];
    list.innerHTML = wl.map((c, i) =>
      `<li><span>${medals[i] || (i + 1) + "."} <b style="color:${c.color}">[${escapeHtml(c.tag)}]</b> ${escapeHtml(c.name)}</span><span><b>${c.wins}</b> Siege</span></li>`).join("");
  }

  // ── Value leaderboard (with join / declare-war) ───────────
  function renderBoard() {
    const list = $("#clan-board");
    if (!list) return;
    const board = data.leaderboard || [];
    if (!board.length) { list.innerHTML = '<li class="muted">Noch keine Clans — gründe den ersten!</li>'; return; }
    const medals = ["🥇", "🥈", "🥉"];
    const inClan = !!data.clan;
    const canWar = data.clan && canManage() && !(data.clan.war); // manager, not already at war
    list.innerHTML = board.map((c, i) => {
      let action = "";
      if (!inClan) action = `<button class="chip-btn clan-join" data-id="${c.id}">Beitreten</button>`;
      else if (canWar && c.id !== data.clan.id) action = `<button class="chip-btn clan-war-btn" data-id="${c.id}" data-tag="${escapeHtml(c.tag)}">⚔️ Krieg</button>`;
      return `<li><span>${medals[i] || (i + 1) + "."} <b style="color:${c.color}">[${escapeHtml(c.tag)}]</b> ${escapeHtml(c.name)} <span class="muted small">${c.size}👤</span></span><span><b>${fmt(c.value)} 🪙</b> ${action}</span></li>`;
    }).join("");
    list.querySelectorAll(".clan-join").forEach((b) => b.addEventListener("click", () => {
      socket.emit("clan:join", { id: b.dataset.id }, (r) => {
        if (r && r.ok) { toast(r.requested ? "📨 Beitritts-Anfrage gesendet." : "Clan beigetreten! 🛡️"); load(); }
        else toast(r?.error || "Fehler.");
      });
    }));
    list.querySelectorAll(".clan-war-btn").forEach((b) => b.addEventListener("click", () => {
      const cfg = data.warConfig || { minStake: 10000 };
      const stakeStr = prompt(`Kriegs-Einsatz aus eurer Schatzkammer (min ${fmt(cfg.minStake)} 🪙) gegen [${b.dataset.tag}]:`, String(cfg.minStake));
      if (stakeStr == null) return;
      const stake = parseInt(stakeStr, 10);
      const daysStr = prompt("Dauer in Tagen (1, 3 oder 7):", "3");
      const days = parseInt(daysStr, 10) || 3;
      socket.emit("clan:declareWar", { targetId: b.dataset.id, stake, days }, (r) => {
        if (r && r.ok) { toast(`⚔️ Krieg gegen [${b.dataset.tag}] erklärt!`); load(); } else toast(r?.error || "Fehler.");
      });
    }));
  }

  function load() {
    socket.emit("clan:state", (s) => { if (!s || !s.ok) return; data = s; renderMine(); renderWar(); renderWeekly(); renderBoard(); });
  }

  socket.on("clan:update", () => {
    const screen = document.querySelector('[data-screen="clans"]');
    if (screen && screen.classList.contains("active")) load();
  });

  window.Casino._loadClans = load;
})();
