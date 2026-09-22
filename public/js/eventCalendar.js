"use strict";

/* Planbarer Wochenend-Pokal im Eventkalender. */
(function () {
  const { socket, toast } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString("de-DE");
  let current = null;
  let clock = null;

  function duration(ms) {
    ms = Math.max(0, ms);
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (days) return `${days} T ${hours} Std`;
    if (hours) return `${hours} Std ${mins} Min`;
    return `${Math.max(1, mins)} Min`;
  }

  function dateRange(startAt, endAt) {
    const format = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `${format.format(new Date(startAt))} – ${format.format(new Date(endAt))}`;
  }

  function renderClock() {
    if (!current || !current.schedule) return;
    const s = current.schedule;
    const active = s.active && Date.now() < s.endAt;
    const target = active ? s.endAt : s.startAt;
    const el = $("#event-countdown");
    const status = $("#event-week-status");
    const card = $("#event-week-card");
    if (status) status.textContent = active ? "JETZT AKTIV" : "NÄCHSTER START";
    if (card) card.classList.toggle("active", active);
    const menuSub = $("#menu-calendar-sub");
    if (menuSub) menuSub.textContent = active
      ? `Wochenend-Pokal läuft · ${current.points || 0}/${current.cap || 30}`
      : "Nächster Pokal: Freitag 18:00";
    if (el) el.innerHTML = `<b>${active ? "Endet" : "Startet"} in ${duration(target - Date.now())}</b><span>${dateRange(s.startAt, s.endAt)}</span>`;

    const lobbyCard = $("#lobby-event-card");
    const lobbyKicker = $("#lobby-event-kicker");
    const lobbyTimer = $("#lobby-event-timer");
    if (lobbyCard) lobbyCard.classList.toggle("active", active);
    if (lobbyKicker) lobbyKicker.textContent = active ? "JETZT AKTIV · JEDE RUNDE ZÄHLT" : "DAS FESTE WOCHENEND-EVENT";
    if (lobbyTimer) lobbyTimer.textContent = `${active ? "Endet" : "Startet"} in ${duration(target - Date.now())}`;
  }

  function render(data) {
    if (!data || !data.ok) return;
    current = data;
    const points = Math.max(0, Number(data.points) || 0);
    const cap = Math.max(1, Number(data.cap) || 30);
    $("#event-week-title").textContent = data.title || "Wochenend-Pokal";
    $("#event-points").textContent = `${points} / ${cap}`;
    $("#event-points-fill").style.width = `${Math.min(100, points / cap * 100)}%`;
    const lobbyTitle = $("#lobby-event-title");
    const lobbyPoints = $("#lobby-event-points");
    const lobbyFill = $("#lobby-event-fill");
    if (lobbyTitle) lobbyTitle.textContent = data.title || "Wochenend-Pokal";
    if (lobbyPoints) lobbyPoints.textContent = `${points} / ${cap}`;
    if (lobbyFill) lobbyFill.style.width = `${Math.min(100, points / cap * 100)}%`;

    const milestones = $("#event-milestones");
    milestones.innerHTML = (data.milestones || []).map((m) => {
      const done = m.claimed || points >= m.points;
      return `<article class="event-milestone ${done ? "done" : ""}">
        <span>${done ? "✓" : m.points}</span>
        <div><small>${m.points} Runden</small><b>${m.label}</b><em>+${fmt(m.reward)}<i class="mk"></i></em></div>
      </article>`;
    }).join("");

    const c = data.community || {};
    const cPoints = Math.max(0, Number(c.points) || 0);
    const cTarget = Math.max(1, Number(c.target) || 30);
    $("#event-community-fill").style.width = `${Math.min(100, cPoints / cTarget * 100)}%`;
    $("#event-community-label").innerHTML = c.unlocked
      ? `Gefüllt · ${c.rewarded ? "Belohnung erhalten" : `+${fmt(c.reward)}<i class="mk"></i> nach deiner ersten Runde`}`
      : `${cPoints} / ${cTarget} · Extra: +${fmt(c.reward)}<i class="mk"></i>`;
    const people = Number(c.participants) || 0;
    $("#event-community-people").textContent = people ? `${people} ${people === 1 ? "Teilnehmer" : "Teilnehmende"}` : "Noch niemand dabei";
    $("#event-week-card").classList.toggle("community-done", !!c.unlocked);
    renderClock();
    clearInterval(clock);
    clock = setInterval(renderClock, 30000);
  }

  function load() { socket.emit("eventcalendar:state", render); }

  socket.on("eventcalendar:update", render);
  socket.on("eventcalendar:reward", (r) => {
    if (!r) return;
    const rewards = r.kind === "bundle" ? (r.rewards || []) : [r];
    for (const reward of rewards) {
      if (reward.kind === "milestone") toast(`${reward.label}: +${fmt(reward.amount)} Chips`);
      if (reward.kind === "community") toast(`Gemeinsamer Pokal gefüllt: +${fmt(reward.amount)} Chips`);
    }
  });
  window.Casino._loadEventCalendar = load;
  /* app.js wird absichtlich frueher geladen. Bei einem Neuladen direkt in
     der Lobby kann deren erster onEnter deshalb schon vorbei sein, bevor
     dieses Modul bereitsteht. Der Screen-Haken und die aktive Startansicht
     halten die Vorschau trotzdem immer aktuell. */
  document.addEventListener("casino:screen", (e) => {
    const screen = e.detail && e.detail.screen;
    if (screen === "lobby" || screen === "calendar") load();
  });
  const active = document.querySelector(".screen.active");
  if (active && ["lobby", "calendar"].includes(active.dataset.screen)) load();
})();
