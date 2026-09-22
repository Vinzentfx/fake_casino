"use strict";

/* Der persistente Starter-Pass in der Lobby. */
(function () {
  const Casino = window.Casino;
  const { socket, escapeHtml, toast } = Casino;
  const $ = (s) => document.querySelector(s);
  let current = null;

  const STEPS = [
    { id: "bonus", icon: "geschenk", title: "Startpolster holen", text: "Stunden-Bonus einmal abholen", button: "Bonus holen", go: "bonus" },
    { id: "quests", icon: "quests", title: "Ziele kennen", text: "Tages- und Wochenaufträge öffnen", button: "Aufträge ansehen", go: "quests" },
    { id: "play", icon: "blackjack", title: "Erste Runde", text: "Ein beliebiges Spiel abschließen", button: "Blackjack öffnen", go: "blackjack" },
    { id: "city", icon: "businesses", title: "Langfristig denken", text: "Die Stadt und ihre Häuser besuchen", button: "Stadt entdecken", go: "businesses" },
  ];

  function render(s) {
    if (!s || !s.ok) return;
    current = s;
    const box = $("#starter-pass");
    if (!box) return;
    box.classList.toggle("hidden", !s.eligible || s.claimed);
    if (!s.eligible || s.claimed) return;
    box.classList.toggle("ready", !!s.complete);
    $("#starter-pass-fill").style.width = `${Math.round((s.count || 0) / Math.max(1, s.total || 4) * 100)}%`;
    $("#starter-steps").innerHTML = STEPS.map((step, index) => {
      const done = !!(s.done && s.done[step.id]);
      return `<article class="starter-step${done ? " done" : ""}">
        <span class="starter-step-nr">${done ? "✓" : index + 1}</span>
        <span class="starter-step-icon">${Casino.icons.ui(step.icon)}</span>
        <div><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.text)}</small></div>
        ${done ? '<em>Erledigt</em>' : `<button class="chip-btn" type="button" data-starter-go="${step.go}">${escapeHtml(step.button)}</button>`}
      </article>`;
    }).join("");
    const claim = $("#starter-claim");
    claim.disabled = !s.complete;
    claim.textContent = s.complete
      ? `Starter-Belohnung abholen: +${Number(s.reward || 0).toLocaleString("de-DE")} Chips`
      : `${s.count || 0} von ${s.total || 4} Schritten erledigt`;
  }

  function load() { socket.emit("onboarding:state", render); }
  function visit(step, next) {
    socket.emit("onboarding:visit", { step }, (s) => {
      if (s && s.ok) render(s);
      if (next) next();
    });
  }

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-starter-go]");
    if (go) {
      const target = go.dataset.starterGo;
      if (target === "bonus") {
        $("#hero-bonus")?.click();
        setTimeout(load, 500);
      } else if (target === "quests") visit("quests", () => Casino.screens.show("quests"));
      else if (target === "businesses") visit("city", () => Casino.screens.show("businesses"));
      else Casino.screens.show(target);
      return;
    }
    if (e.target.closest("#starter-claim") && current && current.complete) {
      socket.emit("onboarding:claim", (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Belohnung konnte nicht abgeholt werden.");
        if (r.account) Casino.applyAccount(r.account);
        render(r);
        if (Casino.fx.confetti) Casino.fx.confetti();
        toast(`Starter-Pass geschafft: +${Number(r.reward || 0).toLocaleString("de-DE")} Chips`);
      });
    }
  });

  socket.on("onboarding:update", render);
  Casino._loadOnboarding = load;
  document.addEventListener("casino:screen", (e) => {
    const screen = e.detail && e.detail.screen;
    if (screen === "lobby") load();
    if (screen === "quests") visit("quests");
    if (screen === "businesses") visit("city");
  });
  const active = document.querySelector(".screen.active");
  if (active && active.dataset.screen === "lobby") load();
})();
