"use strict";

/**
 * Wiedereroeffnung: Willkommens-Paket und Eroeffnungsgala.
 *
 * Beides steht ganz oben in der Lobby und nur dann, wenn es etwas zu holen
 * oder zu sehen gibt. Wer sein Paket hat und wenn keine Gala laeuft, sieht
 * hier gar nichts, ein Banner, das immer da ist, wird nach zwei Tagen
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
      // Die Kosmetik beim Namen nennen. "Zwei Sachen" klang nach Beiwerk,
      // dabei sind genau die der Grund, warum das Paket besonders ist.
      const stuecke = (stand.paket || []).map((x) => `${x.icon} ${x.label}`).join(" und ");
      teile.push(`
        <div class="cb-karte cb-geschenk">
          <span class="cb-icon">🎁</span>
          <div class="cb-text">
            <b>Willkommen zurück!</b>
            <small>Dein Wiedereröffnungs-Paket wartet: ${fmt(stand.chips)}<i class=mk></i>, ${fmt(stand.xp)} Season-XP${stuecke ? `, dazu ${stuecke}. Beides gibt es nach der Wiedereröffnung nie wieder` : ""}.</small>
          </div>
          <button class="btn-primary" id="cb-claim" type="button">Auspacken</button>
        </div>`);
    }
    if (stand.gala) {
      const g = stand.gala;
      teile.push(`
        <div class="cb-karte cb-gala">
          <span class="cb-icon">🎊</span>
          <div class="cb-text">
            <b>Eröffnungsgala läuft · noch ${rest(g.endsAt)}</b>
            <small>${g.xpFaktor}× Season-XP auf jede Runde. Am Ende werden ${fmt(g.topf)}<i class=mk></i> unter allen verlost, die mitgespielt haben, je mehr Runden, desto mehr Lose. Du: ${fmt(g.meineRunden)} ${g.meineRunden === 1 ? "Runde" : "Runden"}, ${fmt(g.spieler)} dabei.</small>
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

  /* ------------------------------------------------------------------
   * Auspacken
   *
   * Vorher lief das Abholen still ab: ein Zahlenflug, ein Toast, weg. Die
   * beiden Kosmetik-Stuecke standen als Nebensatz im Toast und waren nach
   * vier Sekunden fort, man hat also nie gesehen, dass man sie hat, und
   * genau die sind das Besondere am Paket. Jetzt wird es ausgepackt: erst
   * das Paket antippen, dann kommt jedes Stueck als eigene Karte, und die
   * Kosmetik-Karten sagen dazu, wo man sie anlegt.
   * ------------------------------------------------------------------ */
  const reduziert = () => document.documentElement.classList.contains("reduce-motion");

  function schliesseModal() {
    const m = $("#geschenk-modal");
    if (m) m.classList.add("hidden");
  }

  /** Fenster mit dem verpackten Paket aufmachen. Abgeholt wird erst beim Tippen. */
  function zeigePaket() {
    const m = $("#geschenk-modal");
    if (!m) return;
    m.classList.remove("hidden");
    $("#gs-buehne").classList.remove("hidden", "gs-auf");
    $("#gs-inhalt").classList.add("hidden");
    $("#gs-karten").innerHTML = "";
    $("#gs-tipp").textContent = "Antippen zum Auspacken";
    $("#gs-paket").disabled = false;
    // Menue zu, sonst liegt es samt Hintergrund ueber dem Fenster. Ueber die
    // eigene Funktion, damit auch backdrop und body.sheet-open mitgehen.
    Casino.menuSchliessen?.();
  }

  /** Die Belohnungen als Karten einblenden, eine nach der anderen. */
  function zeigeInhalt(r) {
    const karten = [
      { icon: "<i class=mk></i>", label: fmt(r.chips) + " Chips", text: "Direkt auf dein Guthaben." },
      { icon: "⭐", label: fmt(r.xp) + " Season-XP", text: "Bringt dich im Season-Pass voran." },
      ...(r.stuecke || []).map((x) => ({ icon: x.icon, label: x.label, text: x.text, neu: true })),
    ];
    // Der Hinweis, wo man die Kosmetik anlegt, stand vorher auf jeder Karte
    // und las sich beim zweiten Mal wie ein Copy-Fehler. Einmal reicht, dafuer
    // mit Knopf: sonst sucht man den Bildschirm.
    const kos = (r.stuecke || []).length;
    $("#gs-fuss").innerHTML = kos
      ? `<small>${kos === 1 ? "Das Stück liegt" : "Beides liegt"} jetzt in deinem Schrank. Angelegt wird es unter Kosmetik.</small>
         <button class="chip-btn" id="gs-kosmetik" type="button">Zur Kosmetik</button>`
      : "";

    $("#gs-karten").innerHTML = karten
      .map((k, i) => `
        <div class="gs-item${k.neu ? " gs-neu" : ""}" style="animation-delay:${reduziert() ? 0 : 120 + i * 160}ms">
          <span class="gs-item-icon">${k.icon}</span>
          <div>
            <b>${escapeHtml(k.label)}</b>
            <small>${escapeHtml(k.text)}</small>
          </div>
          ${k.neu ? '<span class="gs-nurjetzt">Nur jetzt</span>' : ""}
        </div>`)
      .join("");
    $("#gs-inhalt").classList.remove("hidden");
  }

  const escapeHtml = (t) =>
    String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function packeAus() {
    const paket = $("#gs-paket");
    if (!paket || paket.disabled) return;
    paket.disabled = true;
    $("#gs-tipp").textContent = "";

    socket.emit("comeback:claim", (r) => {
      if (!r || !r.ok) {
        toast((r && r.error) || "Ging nicht.");
        schliesseModal();
        laden();
        return;
      }
      if (r.account) applyAccount(r.account);

      // Deckel fliegt ab, dann Salut, genau der Effekt, der im Paket liegt.
      $("#gs-buehne").classList.add("gs-auf");
      Casino.sound?.play("bigwin");
      const warten = reduziert() ? 0 : 520;
      setTimeout(() => {
        Casino.fx.spieleEffekt("salut", 4);
        $("#gs-buehne").classList.add("hidden");
        zeigeInhalt(r);
      }, warten);

      laden();
      if (Casino.renderAbholBadge) Casino.renderAbholBadge();
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#cb-claim") || e.target.closest("#menu-geschenk")) { zeigePaket(); return; }
    if (e.target.closest("#gs-paket")) { packeAus(); return; }
    if (e.target.closest("#gs-fertig")) { schliesseModal(); return; }
    if (e.target.closest("#gs-kosmetik")) { schliesseModal(); Casino.screens.show("cosmetics"); return; }
    // Neben das Fenster tippen schliesst es nur, wenn schon ausgepackt ist:
    // sonst waere das Paket weg, bevor man es angetippt hat.
    if (e.target.id === "geschenk-modal" && !$("#gs-inhalt").classList.contains("hidden")) schliesseModal();
  });

  socket.on("comeback:update", () => { if (Casino.screens.current() === "lobby") laden(); });

  Casino._loadComeback = laden;
  // Der Tagesbericht verlinkt das Paket direkt.
  Casino._zeigePaket = zeigePaket;
  // Beim Neuladen steht die Lobby unter Umstaenden schon, bevor diese Datei
  // ausgefuehrt wurde, dann holt onEnter den Stand nicht mehr.
  if (Casino.screens && Casino.screens.current() === "lobby") laden();
})();
