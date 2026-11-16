"use strict";

/*
 * Das Wochenend-Derby im Eventkalender und als Karte in der Übersicht.
 * Rechnen tut der Server (game/eventCalendar.js); hier steht nur, was er
 * schickt. Jeder fremde Name geht durch escapeHtml.
 */
(function () {
  const { socket, toast, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString("de-DE");
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
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
    return `${format.format(new Date(startAt))} bis ${format.format(new Date(endAt))}`;
  }

  const aktiv = () => !!(current && current.schedule && current.schedule.active && Date.now() < current.schedule.endAt);

  function renderClock() {
    if (!current || !current.schedule) return;
    const s = current.schedule;
    const an = aktiv();
    const target = an ? s.endAt : s.startAt;
    const el = $("#event-countdown");
    const status = $("#event-week-status");
    const card = $("#event-week-card");
    if (status) status.textContent = an ? "LÄUFT" : "NÄCHSTES DERBY";
    if (card) card.classList.toggle("active", an);
    const t = current.teams || [];
    const menuSub = $("#menu-calendar-sub");
    if (menuSub) menuSub.textContent = an && t.length
      ? `Derby läuft · ${t[0].punkte} : ${t[1].punkte}`
      : "Nächstes Derby: Freitag 18 Uhr";
    if (el) el.innerHTML = `<b>${an ? "Endet" : "Startet"} in ${duration(target - Date.now())}</b><span>${dateRange(s.startAt, s.endAt)}</span>`;
    const lobbyCard = $("#lobby-event-card");
    const lobbyKicker = $("#lobby-event-kicker");
    const lobbyTimer = $("#lobby-event-timer");
    if (lobbyCard) lobbyCard.classList.toggle("active", an);
    if (lobbyKicker) lobbyKicker.textContent = an ? "LÄUFT · JEDE RUNDE ZÄHLT FÜRS TEAM" : "DAS WOCHENEND-EVENT";
    if (lobbyTimer) lobbyTimer.textContent = `${an ? "Endet" : "Startet"} in ${duration(target - Date.now())}`;
  }

  /* Das Tauziehen: zwei Namen, zwei Zahlen und ein Balken, der zur Seite
     des Führenden wandert. Vor dem ersten Punkt steht er in der Mitte. */
  function tau(teams, punkte, ich) {
    const summe = punkte[0] + punkte[1];
    const anteil = summe ? punkte[0] / summe * 100 : 50;
    return `<div class="derby-seiten">
        ${teams.map((t, i) => `<div class="derby-seite t${i}${ich === i ? " meins" : ""}">
          <small>${ich === i ? "Dein Team" : `Team ${i ? "Blau" : "Rot"}`}</small>
          <b>${esc(t.name)}</b>
          <strong>${fmt(punkte[i])}</strong>
        </div>`).join('<span class="derby-gegen" aria-hidden="true">gegen</span>')}
      </div>
      <div class="derby-balken" role="img" aria-label="${esc(teams[0].name)} ${fmt(punkte[0])}, ${esc(teams[1].name)} ${fmt(punkte[1])}">
        <i class="t0" style="width:${anteil.toFixed(1)}%"></i><i class="t1"></i><span style="left:${anteil.toFixed(1)}%"></span>
      </div>`;
  }

  function render(data) {
    if (!data || !data.ok) return;
    current = data;
    const an = aktiv();
    const teams = data.teams || [];
    const r = data.regeln || {};
    const ich = data.ich;
    $("#event-week-title").textContent = data.title || "Wochenend-Derby";
    $("#derby-text").textContent = an
      ? `${teams[0].name} gegen ${teams[1].name}. Jede Runde, die du spielst, zählt für dein Team. Wer an mehr Tagen wiederkommt, gewinnt, nicht wer am meisten setzt.`
      : `Am Wochenende spielt ${teams[0].name} gegen ${teams[1].name}. Mit deiner ersten Runde kommst du in ein Team, und jede weitere zählt für dieses Team.`;
    $("#derby-tau").innerHTML = an || (teams[0] && teams[0].punkte + teams[1].punkte) ? tau(teams, teams.map((t) => t.punkte), ich ? ich.team : null) : "";

    /* Was man selbst gerade beiträgt, und was heute noch geht. */
    const ichEl = $("#derby-ich");
    if (ich && an) {
      const rest = Math.max(0, (r.tagesDeckel || 25) - (ich.heute || 0));
      ichEl.innerHTML = `<div class="derby-meins t${ich.team}">
        <span><small>Dein Beitrag</small><b>${fmt(ich.punkte)} Punkte</b></span>
        <span><small>Heute</small><b>${rest ? `noch ${rest} Runden` : "Tagesdeckel voll"}</b></span>
        <span><small>Belohnung</small><b>${ich.punkte >= (r.minBeitrag || 10) ? "gesichert" : `ab ${r.minBeitrag || 10} Punkten`}</b></span>
      </div>`;
    } else if (an) {
      ichEl.innerHTML = `<p class="derby-hinweis">Spiel eine Runde, egal welches Spiel, und du bist dabei. Das Team bekommst du zugeteilt, damit beide Seiten gleich groß bleiben.</p>`;
    } else ichEl.innerHTML = "";

    /* Wer für welches Team zieht. Nur die Besten, das ist die Bühne. */
    $("#derby-teams").innerHTML = an ? teams.map((t, i) => `<div class="derby-team t${i}">
        <h4>${esc(t.name)} <small>${t.spieler} Spieler</small></h4>
        ${t.beste && t.beste.length ? `<ol>${t.beste.map((b) => `<li><span>${esc(b.name)}</span><b>${fmt(b.punkte)}</b></li>`).join("")}</ol>` : `<p class="muted small">Noch niemand dabei.</p>`}
      </div>`).join("") : "";

    const lohn = r.lohn || {};
    $("#derby-regeln").textContent = `Jede Runde bringt deinem Team einen Punkt, höchstens ${r.tagesDeckel || 25} am Tag, und die erste an jedem Tag ${r.antritt || 5} extra. `
      + `Ab ${r.minBeitrag || 10} Punkten bekommst du am Sonntag um Mitternacht ${fmt(lohn.sieg)} Chips, wenn dein Team gewinnt, sonst ${fmt(lohn.niederlage)}. `
      + `Wer zum ersten Mal gewinnt, bekommt den Siegerschal für seine Figur.`
      + (data.bilanz && data.bilanz.teilnahmen ? ` Deine Bilanz: ${data.bilanz.siege} ${data.bilanz.siege === 1 ? "Sieg" : "Siege"} in ${data.bilanz.teilnahmen} ${data.bilanz.teilnahmen === 1 ? "Derby" : "Derbys"}.` : "");

    /* Das letzte Wochenende: wer gewonnen hat und wer am meisten gezogen hat. */
    const l = data.letztes;
    $("#derby-letztes").innerHTML = l && !an ? `<div class="derby-zuletzt">
        <small>Letztes Wochenende</small>
        <b>${l.sieger === -1 ? `Unentschieden, ${fmt(l.punkte[0])} zu ${fmt(l.punkte[1])}` : `${esc(l.teams[l.sieger].name)} gewinnt ${fmt(Math.max(...l.punkte))} zu ${fmt(Math.min(...l.punkte))}`}</b>
        ${l.meins ? `<span>Du hast ${fmt(l.meins.betrag)} Chips bekommen${l.meins.schal ? " und den Siegerschal" : ""}.</span>` : ""}
        <span class="derby-beste">${(l.beste || []).map((b, i) => b.length ? `<em class="t${i}">${esc(l.teams[i].name)}: ${b.map((x) => esc(x.name)).join(", ")}</em>` : "").join("")}</span>
      </div>` : "";

    // Die kleine Karte in der Übersicht.
    const lobbyTitle = $("#lobby-event-title");
    const lobbyPoints = $("#lobby-event-points");
    const lobbyLabel = $("#lobby-event-label");
    const lobbyFill = $("#lobby-event-fill");
    if (lobbyTitle && teams.length) lobbyTitle.textContent = `${teams[0].name} gegen ${teams[1].name}`;
    if (lobbyLabel) lobbyLabel.textContent = ich && an ? `Dein Team: ${teams[ich.team].name}` : "Stand";
    if (lobbyPoints && teams.length) lobbyPoints.textContent = `${fmt(teams[0].punkte)} : ${fmt(teams[1].punkte)}`;
    if (lobbyFill && teams.length) {
      const summe = teams[0].punkte + teams[1].punkte;
      lobbyFill.style.width = `${summe ? teams[0].punkte / summe * 100 : 50}%`;
    }
    renderClock();
    clearInterval(clock);
    clock = setInterval(renderClock, 30000);
  }

  function load() { socket.emit("eventcalendar:state", render); }

  socket.on("eventcalendar:update", render);
  socket.on("eventcalendar:reward", (r) => {
    if (!r) return;
    if (r.kind === "team") toast(`Wochenend-Derby: Du spielst für ${r.team}. Jede Runde zählt.`);
    if (r.kind === "derby") {
      const was = r.art === "sieg" ? `${r.team} hat gewonnen` : r.art === "remis" ? "Unentschieden" : `${r.team} hat verloren`;
      toast(`${was}: +${fmt(r.betrag)} Chips${r.schal ? " und der Siegerschal" : ""}`);
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
