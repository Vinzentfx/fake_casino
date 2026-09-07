"use strict";

/**
 * Wiedereroeffnung: Willkommens-Paket und Eroeffnungsgala.
 *
 * Beides steht ganz oben in der Lobby und nur dann, wenn es etwas zu holen
 * oder zu sehen gibt. Wer sein Paket hat und wenn keine Gala laeuft, sieht
 * hier gar nichts — ein Banner, das immer da ist, wird nach zwei Tagen
 * uebersehen.
 */
(function () {
  const { socket, toast, applyAccount } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let stand = null;
  let uhr = null;

  const rest = (bis) => {
    const ms = Math.max(0, bis - Date.now());
    const m = Math.floor(ms / 60000), sek = Math.floor((ms % 60000) / 1000);
    return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m}:${String(sek).padStart(2, "0")}`;
  };

  function zeichne() {
    const box = $("#lobby-comeback");
    if (!box) return;
    if (!stand || !stand.ok) { box.classList.add("hidden"); return; }

    const teile = [];
    if (stand.geschenkOffen && !stand.geholt) {
      teile.push(`
        <div class="cb-karte cb-geschenk">
          <span class="cb-icon">🎁</span>
          <div class="cb-text">
            <b>Willkommen zurück!</b>
            <small>Dein Wiedereröffnungs-Paket wartet: ${fmt(stand.chips)} 🪙, ${fmt(stand.xp)} Season-XP und zwei Sachen, die es danach nie wieder gibt.</small>
          </div>
          <button class="btn-primary" id="cb-claim" type="button">Abholen</button>
        </div>`);
    }
    if (stand.gala) {
      const g = stand.gala;
      teile.push(`
        <div class="cb-karte cb-gala">
          <span class="cb-icon">🎊</span>
          <div class="cb-text">
            <b>Eröffnungsgala läuft · noch ${rest(g.endsAt)}</b>
            <small>${g.xpFaktor}× Season-XP auf jede Runde. Am Ende werden ${fmt(g.topf)} 🪙 unter allen verlost, die mitgespielt haben — je mehr Runden, desto mehr Lose. Du: ${fmt(g.meineRunden)} ${g.meineRunden === 1 ? "Runde" : "Runden"}, ${fmt(g.spieler)} dabei.</small>
          </div>
        </div>`);
    }

    box.innerHTML = teile.join("");
    box.classList.toggle("hidden", !teile.length);

    // Die Uhr laeuft nur, solange auch eine Gala laeuft.
    clearInterval(uhr);
    if (stand.gala) uhr = setInterval(() => { if (Casino.screens.current() === "lobby") zeichne(); }, 1000);
  }

  function laden() {
    if (!socket) return;
    socket.emit("comeback:state", (r) => { stand = r; zeichne(); });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#cb-claim")) return;
    const btn = e.target.closest("#cb-claim");
    btn.disabled = true;
    socket.emit("comeback:claim", (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); btn.disabled = false; return; }
      if (r.account) applyAccount(r.account);
      Casino.fx.bigWin(r.chips, { label: "Willkommen zurück" });
      const dazu = (r.stuecke || []).length ? ` Dazu: ${r.stuecke.join(" und ")}.` : "";
      toast(`🎁 ${fmt(r.chips)} 🪙 und ${fmt(r.xp)} Season-XP.${dazu}`);
      laden();
      if (Casino.renderAbholBadge) Casino.renderAbholBadge();
    });
  });

  socket.on("comeback:update", () => { if (Casino.screens.current() === "lobby") laden(); });

  Casino._loadComeback = laden;
  // Beim Neuladen steht die Lobby unter Umstaenden schon, bevor diese Datei
  // ausgefuehrt wurde — dann holt onEnter den Stand nicht mehr.
  if (Casino.screens && Casino.screens.current() === "lobby") laden();
})();
