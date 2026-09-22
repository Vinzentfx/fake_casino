"use strict";

/* Oeffentliches Ideenbrett: einreichen, unterstuetzen und den Stand sehen. */
(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);

  const STATUS = {
    open:     { label: "Offen", icon: "vorschlaege", hint: "wartet auf Prüfung" },
    planned:  { label: "Geplant", icon: "kalender", hint: "steht auf dem Plan" },
    done:     { label: "Umgesetzt", icon: "ja", hint: "ist im Casino" },
    rejected: { label: "Archiv", icon: "nein", hint: "wird vorerst nicht gebaut" },
  };
  let stand = null;
  let filter = "all";

  const icon = (id) => window.Casino.icons.ui(id);
  const wann = (ts) => new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  function renderRemaining(s) {
    const el = $("#suggest-remaining");
    if (el) el.textContent = `${s.remaining} von ${s.perHour} Ideen diese Stunde übrig`;
    const send = $("#suggest-send");
    if (send) send.disabled = s.remaining <= 0;
  }

  function renderStats(s) {
    const c = s.counts || {};
    const box = $("#suggest-stats");
    if (!box) return;
    box.innerHTML = `
      <div><b>${c.all || 0}</b><small>Ideen</small></div>
      <div><b>${c.planned || 0}</b><small>geplant</small></div>
      <div><b>${c.done || 0}</b><small>umgesetzt</small></div>`;
  }

  function adminBereich(it) {
    if (!stand.isOwner) return "";
    return `<details class="suggest-admin">
      <summary>${icon("admin")} Idee verwalten</summary>
      <div class="suggest-admin-grid">
        <label>Stand
          <select data-suggest-status="${escapeHtml(it.id)}">
            ${Object.entries(STATUS).map(([id, z]) => `<option value="${id}"${it.status === id ? " selected" : ""}>${z.label}</option>`).join("")}
          </select>
        </label>
        <label>Antwort vom Casino
          <textarea rows="3" maxlength="600" data-suggest-reply="${escapeHtml(it.id)}" placeholder="Warum, wann oder wie geht es weiter?">${escapeHtml(it.reply || "")}</textarea>
        </label>
        <div class="suggest-admin-actions">
          <button class="btn-primary" data-suggest-save="${escapeHtml(it.id)}">Speichern</button>
          <button class="btn-danger" data-suggest-delete="${escapeHtml(it.id)}">Löschen</button>
        </div>
      </div>
    </details>`;
  }

  function karte(it) {
    const z = STATUS[it.status] || STATUS.open;
    const zusammen = it.mergedCount
      ? `<span class="suggest-merged">${icon("gruppe")} ${it.mergedCount + 1} ähnliche Einsendungen gebündelt</span>` : "";
    const antwort = it.reply ? `<div class="suggest-reply">
      <span class="suggest-reply-mark">${icon("marke")}</span>
      <div><small>Antwort vom Casino</small><p>${escapeHtml(it.reply)}</p></div>
    </div>` : "";
    return `<article class="suggest-card status-${it.status}" data-suggest-id="${escapeHtml(it.id)}">
      <div class="suggest-card-top">
        <span class="suggest-status">${icon(z.icon)}${z.label}</span>
        <span class="suggest-date">${wann(it.at)}</span>
      </div>
      <p class="suggest-card-text">${escapeHtml(it.text)}</p>
      <div class="suggest-by">Idee von <b>${escapeHtml(it.name)}</b>${zusammen}</div>
      ${antwort}
      <div class="suggest-card-foot">
        <button class="suggest-vote${it.voted ? " on" : ""}" data-suggest-vote="${escapeHtml(it.id)}" aria-pressed="${it.voted ? "true" : "false"}">
          ${icon(it.voted ? "stern-voll" : "stern")}<b>${it.votes}</b><span>${it.voted ? "Unterstützt" : "Unterstützen"}</span>
        </button>
        <span class="suggest-state-hint">${escapeHtml(z.hint)}</span>
      </div>
      ${adminBereich(it)}
    </article>`;
  }

  function renderFilter(s) {
    const c = s.counts || {};
    const box = $("#suggest-filters");
    if (!box) return;
    const tabs = [
      ["all", "Alle"], ["open", "Offen"], ["planned", "Geplant"],
      ["done", "Umgesetzt"], ["rejected", "Archiv"],
    ];
    box.innerHTML = tabs.map(([id, label]) => `<button class="suggest-filter${filter === id ? " on" : ""}" data-suggest-filter="${id}">
      ${label}<small>${c[id] || 0}</small></button>`).join("");
  }

  function renderBoard(s) {
    renderFilter(s);
    const list = $("#suggest-list");
    if (!list) return;
    const items = (s.items || []).filter((it) => filter === "all" || it.status === filter);
    if (!items.length) {
      const text = filter === "all" ? "Noch keine Idee auf dem Brett." : `Hier ist gerade nichts unter „${STATUS[filter]?.label || filter}“.`;
      list.innerHTML = `<div class="suggest-empty">${icon("vorschlaege")}<b>Noch freie Fläche</b><span>${escapeHtml(text)}</span></div>`;
      return;
    }
    list.innerHTML = items.map(karte).join("");
  }

  function applyState(s) {
    if (!s || !s.ok) return;
    stand = s;
    renderRemaining(s);
    renderStats(s);
    renderBoard(s);
  }

  function load() {
    $("#suggest-error").textContent = "";
    socket.emit("suggest:state", applyState);
  }

  $("#suggest-text")?.addEventListener("input", () => {
    const n = $("#suggest-text").value.length;
    $("#suggest-count").textContent = `${n} / 500`;
    $("#suggest-thanks").classList.add("hidden");
  });

  $("#suggest-send")?.addEventListener("click", () => {
    const err = $("#suggest-error");
    err.textContent = "";
    const text = ($("#suggest-text").value || "").trim();
    if (text.length < 3) { err.textContent = "Bitte beschreibe deine Idee etwas genauer."; return; }
    socket.emit("suggest:send", { text }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Die Idee konnte nicht gespeichert werden."; return; }
      $("#suggest-text").value = "";
      $("#suggest-count").textContent = "0 / 500";
      const danke = $("#suggest-thanks");
      danke.classList.remove("hidden");
      danke.innerHTML = r.duplicate
        ? `${icon("gruppe")} Diese Idee gibt es schon – ${r.alreadyVoted ? "deine Unterstützung war bereits dabei." : "deine Stimme wurde hinzugefügt."}`
        : `${icon("ja")} Deine Idee hängt jetzt am Brett.`;
      toast(r.duplicate ? "Ähnliche Idee gefunden und gebündelt." : "Idee veröffentlicht!");
      load();
    });
  });

  $("#suggest-filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-suggest-filter]");
    if (!btn || !stand) return;
    filter = btn.dataset.suggestFilter;
    renderBoard(stand);
  });

  $("#suggest-list")?.addEventListener("click", async (e) => {
    const vote = e.target.closest("[data-suggest-vote]");
    if (vote) {
      vote.disabled = true;
      socket.emit("suggest:vote", { id: vote.dataset.suggestVote }, (r) => {
        if (!r || !r.ok) { toast((r && r.error) || "Stimme konnte nicht gespeichert werden."); vote.disabled = false; return; }
        load();
      });
      return;
    }

    const save = e.target.closest("[data-suggest-save]");
    if (save) {
      const id = save.dataset.suggestSave;
      const status = document.querySelector(`[data-suggest-status="${CSS.escape(id)}"]`)?.value;
      const reply = document.querySelector(`[data-suggest-reply="${CSS.escape(id)}"]`)?.value || "";
      save.disabled = true;
      socket.emit("suggest:moderate", { id, status, reply }, (r) => {
        if (!r || !r.ok) { toast((r && r.error) || "Konnte nicht gespeichert werden."); save.disabled = false; return; }
        applyState(r); toast("Idee aktualisiert.");
      });
      return;
    }

    const del = e.target.closest("[data-suggest-delete]");
    if (del) {
      const ok = await window.Casino.dialog.frage("Diese Idee endgültig vom Brett entfernen?", {
        titel: "Idee löschen", okText: "Löschen", gefahr: true,
      });
      if (!ok) return;
      socket.emit("suggest:delete", { id: del.dataset.suggestDelete }, (r) => {
        if (r && r.ok) { applyState(r); toast("Idee entfernt."); }
        else toast((r && r.error) || "Konnte nicht gelöscht werden.");
      });
    }
  });

  socket.on("suggest:changed", () => {
    if (window.Casino.screens.current() === "suggest") load();
  });

  window.Casino._loadSuggest = load;
})();
