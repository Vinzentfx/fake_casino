"use strict";

/* Freiwilliges Sitzungsbudget und ruhige Verlust-Hinweise. */
(function () {
  const { socket, toast } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(Math.abs(Number(n) || 0)).toLocaleString("de-DE");
  let stand = null;

  function render(s) {
    if (!s || !s.ok) return;
    stand = s;
    const card = $("#budget-card");
    if (!card) return;
    card.classList.toggle("active", !!s.budget);
    card.classList.toggle("reached", !!s.budget && s.loss >= s.budget);
    $("#budget-value").innerHTML = s.budget ? `${fmt(s.budget)}<i class="mk"></i>` : "Aus";
    $("#budget-loss").innerHTML = `${fmt(s.loss)}<i class="mk"></i>`;
    $("#budget-left").innerHTML = s.budget
      ? `${fmt(Math.max(0, s.budget - s.loss))}<i class="mk"></i> übrig`
      : "Kein Hinweis eingestellt";
    $("#budget-fill").style.width = `${s.percent || 0}%`;
    $("#budget-custom").value = s.budget || "";
    document.querySelectorAll("[data-budget]").forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.budget) === Number(s.budget)));
    const off = $("#budget-off");
    if (off) off.disabled = !s.budget;
  }

  function load() { socket.emit("responsible:state", render); }

  function speichern(budget) {
    const err = $("#budget-error");
    err.textContent = "";
    socket.emit("responsible:set", { budget }, (r) => {
      if (!r || !r.ok) { err.textContent = (r && r.error) || "Budget konnte nicht gespeichert werden."; return; }
      render(r);
      toast(r.budget ? `Sitzungsbudget: ${fmt(r.budget)} Chips.` : "Sitzungsbudget ausgeschaltet.");
    });
  }

  $("#budget-presets")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-budget]");
    if (btn) speichern(Number(btn.dataset.budget));
  });
  $("#budget-save")?.addEventListener("click", () => speichern(Number($("#budget-custom").value)));
  $("#budget-off")?.addEventListener("click", () => speichern(0));

  function warning(w) {
    if (!w || !w.budget) return;
    const modal = $("#loss-warning-modal");
    if (!modal) return;
    const erreicht = w.level >= 100;
    modal.dataset.level = erreicht ? "100" : "80";
    $("#loss-warning-kicker").textContent = erreicht ? "Dein gesetzter Punkt" : "Kurzer Überblick";
    $("#loss-warning-title").textContent = erreicht ? "Sitzungsbudget erreicht" : "Noch 20 % im Budget";
    $("#loss-warning-text").textContent = erreicht
      ? "Du hast den Betrag erreicht, bei dem du erinnert werden wolltest. Das Casino sperrt dich nicht – die Entscheidung bleibt bei dir."
      : "Du näherst dich deinem freiwilligen Sitzungsbudget. Ein guter Moment, kurz zu prüfen, ob du weiterspielen möchtest.";
    $("#loss-warning-loss").innerHTML = `${fmt(w.loss)}<i class="mk"></i>`;
    $("#loss-warning-budget").innerHTML = `${fmt(w.budget)}<i class="mk"></i>`;
    $("#loss-warning-fill").style.width = `${Math.min(100, w.percent || 0)}%`;
    modal.classList.remove("hidden");
  }

  function warnSchliessen() { $("#loss-warning-modal")?.classList.add("hidden"); }
  $("#loss-warning-continue")?.addEventListener("click", warnSchliessen);
  $("#loss-warning-lobby")?.addEventListener("click", () => {
    warnSchliessen();
    window.Casino.screens.show("lobby");
  });
  $("#loss-warning-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "loss-warning-modal") warnSchliessen();
  });

  socket.on("responsible:update", render);
  socket.on("responsible:warning", warning);
  window.Casino._loadResponsible = load;
})();
