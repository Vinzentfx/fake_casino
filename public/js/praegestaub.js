"use strict";

/* Prägestaub und die drei wöchentlichen Festangebote in der Sammlung. */
(function () {
  const Casino = window.Casino;
  const { socket, toast, escapeHtml } = Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString("de-DE");
  let stand = null;

  function rest(ms) {
    ms = Math.max(0, ms);
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days ? `${days} Tage, ${hours} Std.` : `${Math.max(1, hours)} Std.`;
  }

  function render(s) {
    if (!s || !s.ok) return;
    stand = s;
    $("#staub-balance").textContent = fmt(s.balance);
    $("#staub-zeit").textContent = `Neue Auswahl in ${rest(s.resetsAt - Date.now())}`;
    const box = $("#staub-angebote");
    box.innerHTML = (s.offers || []).map((o) => {
      const disabled = o.owned || o.bought || s.balance < o.cost;
      const status = o.owned ? "Bereits in deiner Sammlung"
        : o.bought ? "Diese Woche geprägt"
        : s.balance < o.cost ? `Noch ${fmt(o.cost - s.balance)} ✦ nötig`
        : `${fmt(o.cost)} ✦ prägen`;
      return `<article class="staub-angebot staub-${escapeHtml(o.tier)}${o.owned ? " owned" : ""}">
        <span class="staub-stufe">${escapeHtml(o.tier === "legendaer" ? "Legendär" : o.tier === "episch" ? "Episch" : "Selten")}</span>
        <div class="staub-demo">${Casino.spieler.kosVorschau(o.look, { name: (Casino.getAccount() || {}).name || "Du" })}</div>
        <div class="staub-name"><small>${escapeHtml(o.artName)}</small><b>${escapeHtml(o.label)}</b></div>
        <button class="${disabled ? "btn-secondary" : "btn-primary"}" data-staub-buy="${escapeHtml(o.id)}" ${disabled ? "disabled" : ""}>${status}</button>
      </article>`;
    }).join("");
  }

  function load() { socket.emit("staub:state", (s) => { if (s && s.ok) render(s); }); }

  document.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-staub-buy]");
    if (!button || !stand) return;
    const offer = stand.offers.find((x) => x.id === button.dataset.staubBuy);
    if (!offer) return;
    const yes = await Casino.dialog.frage(
      `„${offer.label}“ für ${fmt(offer.cost)} Prägestaub prägen? Die Seriennummer wird erst dabei ausgelost.`,
      { okText: "Jetzt prägen" },
    );
    if (!yes) return;
    button.disabled = true;
    const err = $("#staub-error");
    err.textContent = "";
    socket.emit("staub:buy", { offerId: offer.id }, (r) => {
      if (!r || !r.ok) {
        button.disabled = false;
        err.textContent = (r && r.error) || "Prägung fehlgeschlagen.";
        return;
      }
      render(r);
      const p = r.boughtPiece || {};
      toast(`${p.label || "Wochenpreis"}${p.nr ? ` · #${Casino.spieler.serienCode(p)}` : ""} geprägt.`);
      if (Casino._loadCosmetics) Casino._loadCosmetics(true);
    });
  });

  Casino._loadPraegestaub = load;
  /* Eigener Screen-Haken als Sicherheitsnetz: die Sammlung selbst nutzt noch
     den alten _loadCosmetics-Einstieg und kann bei einem sehr schnellen
     ersten Seitenaufbau vor diesem Modul dran sein. */
  document.addEventListener("casino:screen", (e) => {
    if (e.detail && e.detail.screen === "cosmetics") load();
  });
})();
