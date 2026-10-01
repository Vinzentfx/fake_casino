"use strict";

/*
 * Ans Haus abgeben (Server: game/ankauf.js). Im Markt unter den eigenen
 * Angeboten: was man nicht mehr will, wird man hier sofort los, zu einem
 * festen, niedrigen Preis. Das Exemplar verschwindet dabei; deshalb fragt
 * jeder Knopf noch einmal nach.
 */
(function () {
  const Casino = window.Casino;
  const { socket, toast, escapeHtml } = Casino;
  const $ = (s) => document.querySelector(s);
  const wurzel = document.querySelector('[data-screen="market"]');
  if (!wurzel || !$("#ank-liste")) return;

  const FARBE = { gewoehnlich: "#9aa4ae", selten: "#5ea8e0", episch: "#c86bd6", legendaer: "#f4d782", mythisch: "#e0705e", einzel: "#b6ff4d" };
  let daten = null;
  let art = "alle";
  let laedt = false;

  const betrag = (n) => (Casino.betrag ? Casino.betrag(n) : escapeHtml(String(n)));

  function laden() {
    if (laedt) return;
    laedt = true;
    socket.emit("ankauf:liste", (r) => {
      laedt = false;
      if (!r || !r.ok) { $("#ank-intro").textContent = (r && r.error) || "Gerade nicht erreichbar."; return; }
      daten = r;
      zeichnen();
    });
  }

  function zeichnen() {
    if (!daten) return;
    const rest = Math.max(0, daten.rest);
    $("#ank-intro").innerHTML = `Was du nicht mehr willst, nimmt das Haus sofort zurück: für ein Viertel des Werts, Kioskware für die Hälfte ihres Preises. Stücke aus der Tageskiste waren gratis und bringen nur ein Zwanzigstel. Das Stück ist danach weg. <b>Heute noch ${rest} von ${daten.jeTag}.</b>`;
    const liste = daten.stuecke || [];
    const arten = [...new Map(liste.map((x) => [x.art, x.artName])).entries()];
    if (art !== "alle" && !arten.some(([a]) => a === art)) art = "alle";
    $("#ank-filter").innerHTML = liste.length > 6
      ? [["alle", "Alle"], ...arten].map(([a, n]) => `<button type="button" role="tab" class="ank-art" data-ank-art="${escapeHtml(a)}" aria-selected="${a === art}">${escapeHtml(n)}</button>`).join("")
      : "";
    const sicht = art === "alle" ? liste : liste.filter((x) => x.art === art);
    $("#ank-liste").innerHTML = sicht.length ? sicht.map((x) => `<div class="ank-zeile" style="--stufe:${FARBE[x.stufe] || FARBE.gewoehnlich}">
        <span class="ank-punkt" aria-hidden="true"></span>
        <span class="ank-name"><b>${escapeHtml(x.label)}</b><small>${escapeHtml(x.artName)}${x.nr ? ` · Nr. ${x.nr}` : ""}${x.gratis ? " · aus der Tageskiste" : ""}</small></span>
        <button type="button" class="chip-btn ank-knopf" data-ank="${escapeHtml(x.art)}:${escapeHtml(x.id)}" ${rest ? "" : "disabled"}>${betrag(x.preis)}</button>
      </div>`).join("")
      : `<p class="muted small">Nichts dabei, was das Haus annimmt. Limitiertes, Verdientes und Gratis-Grundteile bleiben bei dir.</p>`;
  }

  async function abgeben(artId) {
    const x = daten && daten.stuecke.find((s) => `${s.art}:${s.id}` === artId);
    if (!x) return;
    const ok = await Casino.dialog.frage(
      `${x.label}${x.nr ? ` (Nr. ${x.nr})` : ""} für ${x.preis.toLocaleString("de-DE")} Chips ans Haus abgeben? Das Stück ist danach weg${x.nr ? ", und diese Nummer gibt es nicht mehr. Auf dem Markt bekommst du meistens mehr" : ""}.`,
      { titel: "Ans Haus abgeben", okText: "Abgeben", gefahr: true });
    if (!ok) return;
    socket.emit("ankauf:verkaufen", { art: x.art, id: x.id }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Das ging nicht."); return; }
      if (r.account) {
        Casino.applyAccount(r.account);
        // Ein abgegebenes Stück, das man trug, ist auch an der Figur weg.
        const tok = localStorage.getItem("casino_token");
        if (tok) socket.emit("auth", { token: tok });
      }
      toast(`${r.label} abgegeben: +${r.preis.toLocaleString("de-DE")} Chips.`);
      daten = { ...daten, stuecke: r.stuecke, rest: r.rest, jeTag: r.jeTag };
      zeichnen();
    });
  }

  wurzel.addEventListener("click", (e) => {
    const f = e.target.closest("[data-ank-art]");
    if (f) { art = f.dataset.ankArt; zeichnen(); return; }
    const b = e.target.closest("[data-ank]");
    if (b && !b.disabled) abgeben(b.dataset.ank);
  });

  // Der Markt meldet sich über den Screen-Manager an; hier reicht es, auf
  // das Öffnen des Bildschirms zu achten.
  new MutationObserver(() => { if (wurzel.classList.contains("active")) laden(); })
    .observe(wurzel, { attributes: true, attributeFilter: ["class"] });
  if (wurzel.classList.contains("active")) laden();
})();
