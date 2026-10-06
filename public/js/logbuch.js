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
    /* Die Hinweise der Woche sieht jeder, auch wer noch nicht angefangen hat:
       sie sind der Weg hinein. */
    const h = w.hinweise || { liste: [] };
    const naechster = h.naechster ? new Date(h.naechster).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) : null;
    const tipps = h.liste.length || naechster ? `<div class="lb-notiz lb-hinweise"><h4>Hinweise der Woche (${h.liste.length} von ${h.von})</h4>
        ${h.liste.length ? `<ol>${h.liste.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
        ${naechster ? `<small>Der nächste kommt am ${esc(naechster)}.</small>` : "<small>Mehr Hinweise gibt es nicht.</small>"}</div>` : "";
    const kopf = e.gefunden
      ? `<b>${esc(e.label)}</b><small>Nr. ${esc(w.nr || "?")} an der Tafel, seit ${esc(datum(e.gefunden))}</small>`
      : `<b>???</b><small>${w.stufe ? "Du bist auf der Spur." : "Ein Rätsel in mehreren Teilen."} ${w.eingetragen ? `Bisher ${w.eingetragen} eingetragen.` : "Bisher hat es niemand gelöst."}</small>`;
    return `<article class="lb-eintrag lb-weserlicht${e.gefunden ? "" : " zu"}">
      ${kopf}
      <span class="lb-sterne">${sterne(e.schwer)}</span>
      ${w.stufe ? `<div class="lb-stufen" aria-label="Stufe ${w.stufe} von ${w.von}">${stufen}</div>` : ""}
      ${tipps}
      ${notizen}
    </article>`;
  }

  const eintrag = (e) => {
    if (!e.gefunden) return `<article class="lb-eintrag zu"><span class="lb-status nein">Offen</span><b>???</b><span class="lb-sterne">${sterne(e.schwer)}</span></article>`;
    return `<article class="lb-eintrag">
      <span class="lb-status ja">✓ Gelöst</span>
      <b>${esc(e.label)}</b>
      <small>${esc(e.ort)}, ${esc(datum(e.gefunden))}</small>
      <span class="lb-sterne">${sterne(e.schwer)}</span>
      ${e.titel ? `<small class="lb-titel">Titel: ${esc(e.titel)}</small>` : ""}
      <p>${esc(e.satz)}</p>
    </article>`;
  };

  /* Der Stand an drei Stellen: Knopf in der Weltleiste, Eintrag im Menü,
     Zeile im eigenen Profil. Alle drei aus derselben Antwort. */
  function standZeigen(r) {
    if (!r || !r.ok) return;
    const gefunden = r.liste.filter((e) => e.gefunden).length, von = r.liste.length;
    const zahl = document.querySelector(".welt-geh-zahl");
    if (zahl) {
      zahl.textContent = `${gefunden}/${von}`;
      zahl.closest(".welt-geh-knopf")?.classList.toggle("alle", gefunden === von);
    }
    const sub = $("#menu-logbuch-sub");
    if (sub) sub.textContent = `${gefunden} von ${von} gelöst`;
    const pf = $("#profile-geheimnisse");
    if (pf) {
      pf.hidden = false;
      $("#profile-geh-zahl").textContent = `Geheimnisse: ${gefunden} von ${von} gelöst`;
      const offen = r.liste.filter((e) => !e.gefunden);
      $("#profile-geh-sub").textContent = offen.length
        ? `Noch offen: ${offen.length}, das leichteste mit ${Math.min(...offen.map((e) => e.schwer))} von 5 Sternen.`
        : "Alles gefunden. Das Haus hat keine Geheimnisse mehr vor dir.";
      $("#profile-geh-balken").style.width = `${Math.round((gefunden / von) * 100)}%`;
    }
  }

  function zeichne(r) {
    const box = $("#lb-liste");
    if (!r || !r.ok) { box.innerHTML = `<p class="muted small">${esc((r && r.error) || "Das Buch klemmt.")}</p>`; return; }
    standZeigen(r);
    const gefunden = r.liste.filter((e) => e.gefunden).length;
    $("#lb-zahl").textContent = `${gefunden} von ${r.liste.length} gelöst`;
    const wl = r.liste.find((e) => e.weserlicht);
    const rest = r.liste.filter((e) => !e.weserlicht);
    // Gelöstes nach Datum, Offenes vom leichtesten zum schwersten.
    const geloest = rest.filter((e) => e.gefunden).sort((a, b) => a.gefunden - b.gefunden);
    const offen = rest.filter((e) => !e.gefunden).sort((a, b) => a.schwer - b.schwer);
    box.innerHTML = (wl ? weserlicht(wl, r.weserlicht) : "");
        const abschnitte = `
      <h3 class="lb-abschnitt">✓ Gelöst <small>${geloest.length}</small></h3>
      <div class="lb-liste">${geloest.map(eintrag).join("") || '<p class="lb-leer">Noch nichts. Fang mit einem Stern an.</p>'}</div>
      <h3 class="lb-abschnitt">Noch offen <small>${offen.length}</small></h3>
      <div class="lb-liste">${offen.map(eintrag).join("") || '<p class="lb-leer">Nichts mehr offen.</p>'}</div>`;
    let rest2 = $("#lb-abschnitte");
    if (!rest2) { rest2 = document.createElement("div"); rest2.id = "lb-abschnitte"; box.after(rest2); }
    rest2.innerHTML = abschnitte;
    const leiste = $("#lb-meilensteine");
    if (leiste) leiste.innerHTML = (r.meilensteine || []).map((m) => `<div class="lb-meilenstein${m.erreicht ? " an" : ""}">
        <b>${m.ab}</b><span><small>${esc(m.name)}</small>${esc(m.label)}</span></div>`).join("");
  }

  /* Der Zähler soll auch stimmen, wenn das Buch nie aufgeschlagen wurde:
     einmal nach dem Anmelden und nach jedem Fund neu holen. */
  let holen = null;
  function standHolen() {
    clearTimeout(holen);
    holen = setTimeout(() => socket.emit("welt:logbuch", standZeigen), 600);
  }
  socket.on("welt:geheimnis", standHolen);
  socket.on("welt:nachgetragen", standHolen);
  // Nach dem Anmelden genau einmal; account:update kommt sonst bei jedem Dreh.
  let einmal = false;
  socket.on("account:update", () => { if (!einmal) { einmal = true; standHolen(); } });
  socket.on("connect", () => { einmal = false; });
  document.addEventListener("casino:screen", (e) => { if (e.detail && e.detail.screen === "profile") standHolen(); });
  Casino.logbuch = { aktualisieren: standHolen };
  $("#lb-rangliste")?.addEventListener("click", () => {
    if (Casino._lbKategorie) Casino._lbKategorie("raetsel");
    Casino.showScreen("leaderboard");
  });
  if (socket.connected) standHolen();

  function laden() { socket.emit("welt:logbuch", zeichne); }
  Casino.screens.register("logbuch", { onEnter: laden });
  if (Casino.screens.current() === "logbuch") laden();
})();
