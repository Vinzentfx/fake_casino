"use strict";

/* ============================================================
   Auktionshaus

   Ein Los zur Zeit. Geboten wird mit echten Chips, die sofort
   hinterlegt werden; wer ueberboten wird, hat sein Geld sofort
   zurueck. Der Zuschlag verbrennt den Betrag.

   Der Countdown laeuft hier, das Ende bestimmt der Server: er
   schickt einen Zeitstempel, kein "noch 4 Minuten". Sonst
   laeuft die Uhr auf einem Geraet, das ein paar Sekunden
   danebenliegt, an der echten vorbei.

   Gesetzt wird ueber KNOEPFE, nicht ueber ein Zahlenfeld. Auf
   dem iPad ist das Feld eine Tastatur, die den halben Schirm
   verdeckt, und der haeufigste Fall ist ohnehin "genau ein
   Schritt drueber".
   ============================================================ */

(function () {
  const Casino = window.Casino;
  const { socket, toast, applyAccount, escapeHtml } = Casino;
  const $ = (s) => document.querySelector(s);
  const zahl = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

  let stand = null;
  let uhr = null;
  let eigenes = null;   // selbst getippter Betrag, solange er ueber dem Mindestgebot liegt

  function restText(ms) {
    if (ms <= 0) return "Zuschlag läuft";
    const t = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (t > 0) return `${t} ${t === 1 ? "Tag" : "Tage"} ${h} Std`;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")} Std`;
    return `${m}:${String(s).padStart(2, "0")} Min`;
  }

  function vorText(ts) {
    const ms = Date.now() - ts;
    if (ms < 60000) return "gerade eben";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `vor ${m} Min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `vor ${h} Std`;
    return `vor ${Math.floor(h / 24)} Tagen`;
  }

  function tickUhr() {
    const el = $("#auk-uhr");
    if (!el || !stand || !stand.los) return;
    const l = stand.los;
    const rest = l.endet - Date.now();
    el.textContent = restText(rest);
    const heiss = rest > 0 && rest < 120000;
    el.classList.toggle("auk-heiss", heiss);
    $("#auk-uhr-sub")?.classList.toggle("auk-heiss", heiss);

    // Der Balken zeigt, wie viel von der Laufzeit schon durch ist.
    const balken = $("#auk-balken i");
    if (balken) {
      const ganz = Math.max(1, l.endet - l.start);
      const durch = Math.min(1, Math.max(0, (Date.now() - l.start) / ganz));
      balken.style.width = `${Math.round(durch * 100)}%`;
      balken.classList.toggle("auk-balken-heiss", heiss);
    }
    if (rest <= 0 && !el.dataset.geholt) {
      // Der Server haemmert im Zehn-Sekunden-Takt; danach einmal nachfragen.
      el.dataset.geholt = "1";
      setTimeout(lade, 3500);
    }
  }

  /* Bei diesen Arten ist die Vorschau der Name (der Stil faerbt ihn, das
     Schild traegt ihn, der Titel ist er). In der kleinen Kachel steht er
     deshalb nur einmal. */
  const zeigtNamen = (type) => type === "style" || type === "schild" || type === "title" || type === "effect";

  /** Dieselbe Zeichnung wie im Laden, man soll sehen, worauf man bietet. */
  function stueck(type, id, label, klein) {
    const k = klein ? " auk-mini" : "";
    if (type === "style") return `<span class="pl-name nm-${escapeHtml(id)}${k}" data-name="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    if (type === "frame") return `<span class="pl-ava fr-${escapeHtml(id)}">🙂</span>`;
    if (type === "aura") return `<span class="pl-aura au-${escapeHtml(id)}"><span class="pl-ava">🙂</span></span>`;
    if (type === "karte") return `<span class="cos-karte-demo${k}" data-karte="${escapeHtml(id)}"></span>`;
    if (type === "schild") return `<span class="auk-schild sch-${escapeHtml(id)}">${escapeHtml(label)}</span>`;
    if (type === "banner") return `<span class="cos-banner-demo${k}" data-banner="${escapeHtml(id)}"></span>`;
    if (type === "effect") return `<span class="auk-effekt">${escapeHtml(label)}</span>`;
    return `<span class="auk-titeltext">${escapeHtml(label)}</span>`;
  }

  /** Die Knoepfe zum Bieten. Ein Schritt, ein Sprung, ein Satz. */
  function bietKnoepfe(l, chips) {
    const stufen = [
      { betrag: l.mindest, label: "Mindestgebot" },
      { betrag: Math.max(l.mindest, Math.ceil((l.gebot || l.mindest) * 1.15 / 1000) * 1000), label: "+15 %" },
      { betrag: Math.max(l.mindest, Math.ceil((l.gebot || l.mindest) * 1.5 / 1000) * 1000), label: "+50 %" },
    ];
    // Doppelte Stufen fallen weg: beim ersten Gebot liegen alle drei auf dem
    // Startgebot, und drei gleiche Knoepfe sind kein Angebot, sondern Rauschen.
    const gesehen = new Set();
    const echte = stufen.filter((s) => !gesehen.has(s.betrag) && gesehen.add(s.betrag));
    return echte.map((s) => `
      <button class="auk-stufe${s.betrag > chips ? " auk-zuteuer" : ""}" type="button" data-gebot="${s.betrag}"
        ${s.betrag > chips ? "disabled" : ""}>
        <b>${zahl(s.betrag)}</b><small>${escapeHtml(s.label)}</small>
      </button>`).join("");
  }

  function render(s) {
    stand = s;
    const box = $("#auk-inhalt");
    if (!box) return;

    if (!s.los) {
      box.innerHTML = `
        <div class="tafel auk-leer">
          <div class="auk-leer-sym"><i data-icon="auktion"></i></div>
          <b>Zurzeit steht nichts unter dem Hammer.</b>
          <p class="muted small">Alle Stücke der ersten Sammlung sind vergeben. Die nächste wird vorbereitet.</p>
        </div>
        ${archivHTML(s)}`;
      Casino.icons.zeichne(box);
      return;
    }

    const l = s.los;
    const gesperrt = s.sperreBis > Date.now();
    const tage = gesperrt ? Math.ceil((s.sperreBis - Date.now()) / 86400000) : 0;
    const chips = s.meineChips || 0;

    const band = gesperrt
      ? `<div class="auk-band auk-band-still">
           <b>Eine Woche Pause</b>
           <small>Du hast gerade erst ersteigert. Noch ${tage} ${tage === 1 ? "Tag" : "Tage"}, damit nicht immer dieselben alles bekommen.</small>
         </div>`
      : l.binIch
        ? `<div class="auk-band auk-band-gut">
             <b>Du hältst das Höchstgebot</b>
             <small>${zahl(l.gebot)} Chips liegen hinterlegt, bis dich jemand überbietet.</small>
           </div>`
        : l.warIch
          ? `<div class="auk-band auk-band-warn">
               <b>Du wurdest überboten</b>
               <small>Dein Einsatz ist zurück auf dem Konto. ${escapeHtml(l.bieterName || "")} führt mit ${zahl(l.gebot)}.</small>
             </div>`
          : "";

    box.innerHTML = `
      <div class="tafel auk-los">
        <div class="auk-plakette">
          <span class="auk-nr">Los ${l.nr}</span>
          <span class="auk-art">${escapeHtml(l.art)}</span>
        </div>

        <div class="auk-buehne">
          <div class="auk-licht" aria-hidden="true"></div>
          <div class="auk-podest" aria-hidden="true"></div>
          <div class="auk-stueck">${stueck(l.type, l.id, l.label)}</div>
        </div>
        <h3 class="auk-name">${escapeHtml(l.label)}</h3>
        <p class="auk-einmal">Gibt es genau einmal, und nur hier.</p>

        <div class="auk-stand">
          <div class="auk-feld">
            <small>${l.gebot ? "Höchstgebot" : "Startgebot"}</small>
            <b class="auk-gross">${zahl(l.gebot || s.startGebot)}<i class=mk></i></b>
            <small class="auk-von">${l.gebot ? (l.binIch ? "von dir" : `von ${escapeHtml(l.bieterName || "")}`) : "noch niemand"}</small>
          </div>
          <div class="auk-feld">
            <small>Zuschlag in</small>
            <b class="auk-gross auk-uhr" id="auk-uhr">…</b>
            <small class="auk-von" id="auk-uhr-sub">letzte 2 Minuten verlängern</small>
          </div>
        </div>
        <div class="auk-balken" id="auk-balken"><i></i></div>

        ${band}

        ${gesperrt || l.binIch ? "" : `
          <div class="auk-bieten">
            <div class="auk-stufen">${bietKnoepfe(l, chips)}</div>
            <details class="auk-eigen">
              <summary>Eigener Betrag</summary>
              <div class="auk-eigen-zeile">
                <input id="auk-betrag" type="number" inputmode="numeric" min="${l.mindest}" step="1000"
                  value="${eigenes && eigenes >= l.mindest ? eigenes : l.mindest}" />
                <button class="btn-primary" id="auk-bieten" type="button">Bieten</button>
              </div>
            </details>
            <p class="hint auk-hinweis">Der Betrag geht sofort vom Konto und kommt sofort zurück, sobald dich jemand überbietet. Wer den Zuschlag bekommt, dessen Gebot verfällt an das Haus.</p>
          </div>
        `}

        ${l.verlauf.length ? `<div class="auk-verlauf">
          <h4 class="auk-h">Gebote</h4>
          ${l.verlauf.map((g, i) => `<div class="auk-zeile${g.ich ? " auk-meins" : ""}${i === 0 ? " auk-fuehrt" : ""}">
            <span class="auk-wer">${escapeHtml(g.name)}${g.ich ? " <i>(du)</i>" : ""}</span>
            <span class="auk-wann">${vorText(g.ts)}</span>
            <b>${zahl(g.betrag)}<i class=mk></i></b>
          </div>`).join("")}
        </div>` : ""}
      </div>
      ${kommendesHTML(s)}
      ${archivHTML(s)}`;

    Casino.icons.zeichne(box);
    tickUhr();
    if (uhr) clearInterval(uhr);
    uhr = setInterval(tickUhr, 1000);
  }

  function kommendesHTML(s) {
    if (!s.kommendes || !s.kommendes.length) return "";
    return `<div class="tafel auk-kommt">
      <h4 class="auk-h">Kommt noch (${s.kommendes.length})</h4>
      <div class="auk-kommt-reihe">
        ${s.kommendes.map((k) => `<div class="auk-kachel">
          <div class="auk-kachel-bild">${stueck(k.type, k.id, k.label, true)}</div>
          ${zeigtNamen(k.type) ? "" : `<b>${escapeHtml(k.label)}</b>`}
          <small>${escapeHtml(k.art)}</small>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function archivHTML(s) {
    if (!s.archiv || !s.archiv.length) return "";
    return `<div class="tafel auk-archiv">
      <h4 class="auk-h">Schon vergeben</h4>
      ${s.archiv.map((a) => `<div class="auk-zeile">
        <span class="auk-wer">${escapeHtml(a.art)} „${escapeHtml(a.label)}“</span>
        <span class="auk-wann">${escapeHtml(a.name)}</span>
        <b>${zahl(a.betrag)}<i class=mk></i></b>
      </div>`).join("")}
    </div>`;
  }

  function lade() {
    socket.emit("auktion:state", (s) => {
      if (!s || !s.ok) return;
      render(s);
      // Hingesehen heisst gelesen: die rote Marke im Menue geht mit.
      if (Casino.renderAbholBadge) Casino.renderAbholBadge();
    });
  }

  function biete(betrag) {
    betrag = Math.floor(Number(betrag) || 0);
    if (!betrag) return;
    socket.emit("auktion:bieten", { betrag }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      eigenes = null;
      Casino.sound.play("win");
      toast(r.verlaengert ? "Geboten. Die Uhr läuft jetzt zwei Minuten länger." : `Geboten: ${zahl(betrag)} Chips.`);
      render(r);
      if (Casino.renderAbholBadge) Casino.renderAbholBadge();
    });
  }

  document.addEventListener("click", (e) => {
    const stufe = e.target.closest("[data-gebot]");
    if (stufe) { biete(stufe.dataset.gebot); return; }
    if (e.target.closest("#auk-bieten")) { biete($("#auk-betrag")?.value); return; }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id !== "auk-betrag") return;
    // Merken, damit ein Zwischenstand beim Neuzeichnen nicht verlorengeht.
    eigenes = Math.floor(Number(e.target.value) || 0) || null;
  });

  socket.on("auktion:update", () => {
    if (Casino.screens.current() === "auktion") lade();
    else if (Casino.renderAbholBadge) Casino.renderAbholBadge();
  });

  socket.on("auktion:ueberboten", (d) => {
    toast(`Überboten bei „${d.label}“: ${d.von} bietet ${zahl(d.betrag)}. Deine ${zahl(d.zurueck)} Chips sind zurück.`);
    if (Casino.renderAbholBadge) Casino.renderAbholBadge();
  });

  socket.on("auktion:zuschlag", (d) => {
    toast(`Zuschlag! ${d.art} „${d.label}“ gehört dir. Anlegen unter Kosmetik.`);
    Casino.fx?.confetti({ count: 80, wucht: 1.3 });
  });

  Casino.screens.register("auktion", {
    onEnter: lade,
    onLeave() { if (uhr) { clearInterval(uhr); uhr = null; } },
  });

  // Der Bildschirm kann schon offen sein, bevor diese Datei geladen ist.
  if (Casino.screens.current() === "auktion") lade();
})();
