"use strict";

/*
 * Das Buch der Geheimnisse.
 *
 * Gefundenes steht mit Stück, Raum, Datum und dem Satz von damals da.
 * Was fehlt, verrät nur seine Sterne. Das Weserlicht bekommt einen eigenen
 * Eintrag mit Stufen, und darunter steht, was man unterwegs schon bekommen
 * hat: wer den Bierdeckel einmal gesehen hat, soll ihn nicht abschreiben
 * müssen, bevor er das Fenster schließt.
 *
 * Alles kommt vom Server (welt:logbuch). Der Browser kennt die Lösungen
 * nicht und auch nicht, wo etwas liegt, das man noch nicht hat.
 */
(function () {
  const Casino = window.Casino;
  const { socket, escapeHtml: esc } = Casino;
  const $ = (s) => document.querySelector(s);

  const sterne = (n) => "★".repeat(n) + `<i>${"★".repeat(Math.max(0, 5 - n))}</i>`;
  const datum = (t) => new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

  function weserlicht(e, w) {
    const stufen = Array.from({ length: w.von }, (_, i) => `<i class="${i < w.stufe ? "an" : ""}"></i>`).join("");
    const notizen = (w.notizen || []).map((n) => `<div class="lb-notiz"><h4>${esc(n.titel)}</h4><pre>${esc(n.text)}</pre></div>`).join("");
    const kopf = e.gefunden
      ? `<b>${esc(e.label)}</b><small>Nr. ${esc(w.nr || "?")} an der Tafel, seit ${esc(datum(e.gefunden))}</small>`
      : `<b>???</b><small>${w.stufe ? "Du bist auf der Spur." : "Ein Rätsel in mehreren Teilen."} ${w.eingetragen ? `Bisher ${w.eingetragen} eingetragen.` : "Bisher hat es niemand gelöst."}</small>`;
    return `<article class="lb-eintrag lb-weserlicht${e.gefunden ? "" : " zu"}">
      ${kopf}
      <span class="lb-sterne">${sterne(e.schwer)}</span>
      ${w.stufe ? `<div class="lb-stufen" aria-label="Stufe ${w.stufe} von ${w.von}">${stufen}</div>` : ""}
      ${notizen}
    </article>`;
  }

  function zeichne(r) {
    const box = $("#lb-liste");
    if (!r || !r.ok) { box.innerHTML = `<p class="muted small">${esc((r && r.error) || "Das Buch klemmt.")}</p>`; return; }
    const gefunden = r.liste.filter((e) => e.gefunden).length;
    $("#lb-zahl").textContent = `${gefunden} von ${r.liste.length}`;
    // Das Weserlicht zuerst, dann Gefundenes, dann der Rest nach Schwierigkeit.
    const sortiert = [...r.liste].sort((a, b) => (b.weserlicht - a.weserlicht) || (!!b.gefunden - !!a.gefunden) || (a.schwer - b.schwer));
    box.innerHTML = sortiert.map((e) => {
      if (e.weserlicht) return weserlicht(e, r.weserlicht);
      if (!e.gefunden) return `<article class="lb-eintrag zu"><b>???</b><span class="lb-sterne">${sterne(e.schwer)}</span><small>Noch nicht gefunden</small></article>`;
      return `<article class="lb-eintrag">
        <b>${esc(e.label)}</b>
        <small>${esc(e.ort)}, ${esc(datum(e.gefunden))}</small>
        <span class="lb-sterne">${sterne(e.schwer)}</span>
        <p>${esc(e.satz)}</p>
      </article>`;
    }).join("");
    const sub = $("#menu-logbuch-sub");
    if (sub) sub.textContent = `${gefunden} von ${r.liste.length} gefunden`;
  }

  function laden() { socket.emit("welt:logbuch", zeichne); }
  Casino.screens.register("logbuch", { onEnter: laden });
  if (Casino.screens.current() === "logbuch") laden();
})();
