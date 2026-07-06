"use strict";

/* ============================================================
   Fake Casino – Clans / Familien (client).
   Gründe oder tritt einem Clan bei, sieh Roster & Clan-Rangliste.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let data = null;

  function renderMine() {
    const box = $("#clan-mine");
    if (!box) return;
    if (data.clan) {
      const c = data.clan;
      box.innerHTML =
        `<div class="clan-header" style="border-color:${c.color}"><b style="color:${c.color}">[${escapeHtml(c.tag)}] ${escapeHtml(c.name)}</b>` +
        `<span class="muted small">${c.size} Mitglieder · 💎 ${fmt(c.value)} 🪙 Gesamtwert</span></div>` +
        `<div class="clan-roster">` + c.members.map((m) =>
          `<div class="clan-mrow"><span>${m.founder ? "👑 " : ""}${escapeHtml(m.name)}</span><b>${fmt(m.value)} 🪙</b></div>`).join("") + `</div>` +
        `<button class="btn-danger" id="clan-leave" style="width:100%;margin-top:10px">Clan verlassen</button>`;
      $("#clan-leave").addEventListener("click", () => {
        if (!confirm("Clan wirklich verlassen?")) return;
        socket.emit("clan:leave", (r) => { if (r && r.ok) { toast("Clan verlassen."); load(); } else toast(r?.error || "Fehler."); });
      });
    } else {
      box.innerHTML =
        `<div class="clan-create">` +
        `<div class="cd-sub">Clan gründen (${fmt(data.createCost)} 🪙)</div>` +
        `<div class="crash-betrow"><label>Name<input id="clan-name" maxlength="22" placeholder="z. B. Die Haie" /></label>` +
        `<label>Tag<input id="clan-tag" maxlength="4" placeholder="HAI" style="text-transform:uppercase" /></label></div>` +
        `<button class="btn-primary" id="clan-create-btn" style="width:100%;margin-top:8px">🛡️ Clan gründen</button>` +
        `<div class="form-error" id="clan-error"></div></div>` +
        `<p class="muted small" style="margin:12px 0 4px">…oder einem Clan aus der Rangliste beitreten (Klick auf „Beitreten").</p>`;
      $("#clan-create-btn").addEventListener("click", () => {
        const name = $("#clan-name").value.trim(), tag = $("#clan-tag").value.trim();
        socket.emit("clan:create", { name, tag }, (r) => {
          if (!r || !r.ok) { $("#clan-error").textContent = (r && r.error) || "Fehler."; return; }
          if (r.account) applyAccount(r.account);
          toast(`🛡️ Clan [${r.clan.tag}] gegründet!`);
          load();
        });
      });
    }
  }

  function renderBoard() {
    const list = $("#clan-board");
    if (!list) return;
    const board = data.leaderboard || [];
    if (!board.length) { list.innerHTML = '<li class="muted">Noch keine Clans — gründe den ersten!</li>'; return; }
    const medals = ["🥇", "🥈", "🥉"];
    const inClan = !!data.clan;
    list.innerHTML = board.map((c, i) => {
      const join = (!inClan) ? `<button class="chip-btn clan-join" data-id="${c.id}">Beitreten</button>` : "";
      return `<li><span>${medals[i] || (i + 1) + "."} <b style="color:${c.color}">[${escapeHtml(c.tag)}]</b> ${escapeHtml(c.name)} <span class="muted small">${c.size}👤</span></span><span><b>${fmt(c.value)} 🪙</b> ${join}</span></li>`;
    }).join("");
    list.querySelectorAll(".clan-join").forEach((b) => b.addEventListener("click", () => {
      socket.emit("clan:join", { id: b.dataset.id }, (r) => { if (r && r.ok) { toast("Clan beigetreten! 🛡️"); load(); } else toast(r?.error || "Fehler."); });
    }));
  }

  function load() {
    socket.emit("clan:state", (s) => { if (!s || !s.ok) return; data = s; renderMine(); renderBoard(); });
  }

  socket.on("clan:update", () => {
    const screen = document.querySelector('[data-screen="clans"]');
    if (screen && screen.classList.contains("active")) load();
  });

  window.Casino._loadClans = load;
})();
