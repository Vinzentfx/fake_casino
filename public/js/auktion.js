"use strict";

/* Auktionshaus

   Ein Los zur Zeit. Geboten wird mit echten Chips, die sofort
   hinterlegt werden; wer ueberboten wird, hat sein Geld sofort
   zurueck. Der Zuschlag verbrennt den Betrag.

   Der Countdown laeuft hier, das Ende bestimmt der Server: er
   schickt einen Zeitstempel, kein "noch 4 Minuten". Sonst
   laeuft die Uhr auf einem Geraet, das ein paar Sekunden
   danebenliegt, an der echten vorbei.

   Gesetzt wird ueber Knoepfe, nicht ueber ein Zahlenfeld. Auf
   dem iPad ist das Feld eine Tastatur, die den halben Schirm
   verdeckt, und der haeufigste Fall ist ohnehin "genau ein
   Schritt drueber". */

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
    /* Seit Spieler selbst einliefern koennen, kommen hier auch Arten an, die
       es als Haus-Los nie gab: Profilbilder, Farben, Sprueche, Chat-Zeichen.
       Ohne diese Zeilen stuende auf der Buehne nur der Name. */
    if (type === "avatar") return `<span class="cos-emoji">${escapeHtml(String(label).split(" ")[0] || "🙂")}</span>`;
    if (type === "zeichen" && window.Casino.spieler) {
      return window.Casino.spieler.kosVorschau({ art: "style", id: "standard", label });
    }
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
    const gesperrt = !!s.gesperrt;
    const chips = s.meineChips || 0;

    const band = gesperrt
      ? `<div class="auk-band auk-band-still">
           <b>Dieses Los setzt du aus</b>
           <small>Du hast das letzte gewonnen. Beim nächsten bist du wieder dabei.</small>
         </div>`
      : l.binIch
        ? `<div class="auk-band auk-band-gut">
             <b>Du hältst das Höchstgebot</b>
             <small>${Casino.betrag(l.gebot)} liegen hinterlegt, bis dich jemand überbietet.</small>
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
        <h3 class="auk-name">${escapeHtml(l.label)}${l.stueckNr ? ` <span class="auk-stuecknr${l.stueckNr === 1 ? " erst" : ""}">Nr. ${l.stueckNr}</span>` : ""}</h3>
        <p class="auk-einmal">${l.vonName
          ? `Eingeliefert von <b>${escapeHtml(l.vonName)}</b>. Dieses eine Exemplar wechselt den Besitzer.`
          : "Gibt es genau einmal, und nur hier."}</p>

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

        ${l.meins ? `<p class="hint auk-hinweis">Dein Los. Bieten kannst du hier nicht — der Erlös abzüglich ${Math.round((s.einliefern?.provision || 0) * 100)} % Provision kommt beim Zuschlag auf dein Konto.</p>` : ""}
        ${gesperrt || l.binIch || l.meins ? "" : `
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
      ${schlangeHTML(s)}
      ${einliefernHTML(s)}
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

  /**
   * Was Spieler eingeliefert haben und noch wartet.
   *
   * Steht getrennt von "Kommt noch": das sind die Haus-Stuecke, hier stehen
   * die der anderen. Wer wissen will, ob sich das Warten lohnt, sieht beides
   * und in welcher Reihenfolge.
   */
  function schlangeHTML(s) {
    const e = s.einliefern;
    if (!e || !e.schlange.length) return "";
    return `<div class="tafel auk-kommt">
      <h4 class="auk-h">Von Spielern eingeliefert (${e.schlange.length})</h4>
      <div class="auk-schlange">
        ${e.schlange.map((x) => `<div class="auk-schlange-zeile${x.meins ? " auk-meins" : ""}">
          <span class="auk-platz">${x.platz}</span>
          <span class="auk-schlange-demo">${window.Casino.spieler.kosVorschau(x.look, { name: x.name })}</span>
          <span class="auk-schlange-text">
            <b>${escapeHtml((x.look && x.look.label) || x.label)}</b>
            <small>Nr. ${x.nr} · von ${escapeHtml(x.name)} · ab ${zahl(x.mindest)}</small>
          </span>
          ${x.meins ? `<button class="btn-secondary auk-klein" data-auk-zurueck="${escapeHtml(x.uid)}">Zurück</button>` : ""}
        </div>`).join("")}
      </div>
    </div>`;
  }

  /**
   * Selbst etwas unter den Hammer bringen.
   *
   * Der Markt ist der stille Weg: fester Preis, liegt da, bis jemand
   * zugreift. Das Auktionshaus ist der laute: ein Los am Tag, Ansage im
   * Chat, Zuschlag zur festen Uhrzeit, alle sehen zu. Dafuer kostet es
   * mehr, und genau das steht hier auch dran.
   */
  function einliefernHTML(s) {
    const e = s.einliefern;
    if (!e) return "";
    const habe = e.schlange.some((x) => x.meins);
    return `<div class="tafel auk-einliefern">
      <h4 class="auk-h">Selbst versteigern</h4>
      <p class="muted small">Einliefergebühr <b>${zahl(e.gebuehr)}</b> Chips, fällig sofort und auch weg,
        wenn niemand bietet. Vom Zuschlag behält das Haus ${Math.round(e.provision * 100)} %.
        Mehr als im Markt — dafür steht dein Stück einen ganzen Tag auf der Bühne und jeder bekommt es mit.
        Angenommen wird ab <b>Episch</b>: bei kleineren Stücken frisst die feste Gebühr den Erlös auf.</p>
      ${habe ? `<p class="hint">Du hast schon etwas in der Warteschlange. Mehr geht erst, wenn das durch ist.</p>`
        : e.voll ? `<p class="hint">Die Warteschlange ist voll. Versuch es später wieder.</p>`
        : !e.meine.length ? `<p class="hint">Du hast gerade nichts, was hier hineinpasst — gehandelt wird ab Episch. Kleineres geht auf den Markt.</p>`
        : `<div class="auk-meine">
            ${e.meine.map((x) => `<button class="auk-meins-kachel" data-auk-ein="${escapeHtml(x.uid)}"
                data-label="${escapeHtml(x.label)}" data-nr="${x.nr}">
              <span class="auk-meins-demo">${window.Casino.spieler.kosVorschau(x.look, { name: "Du" })}</span>
              <b>${escapeHtml((x.look && x.look.label) || x.label)}</b>
              <small class="${x.nr === 1 ? "auk-erst" : ""}">${x.nr === 1 ? "Erstprägung" : `Nr. ${x.nr}`}${x.bestand > 1 ? ` von ${x.bestand}` : ""}</small>
            </button>`).join("")}
          </div>`}
    </div>`;
  }

  function archivHTML(s) {
    if (!s.archiv || !s.archiv.length) return "";
    return `<div class="tafel auk-archiv">
      <h4 class="auk-h">Schon vergeben</h4>
      ${s.archiv.map((a) => `<div class="auk-zeile">
        <span class="auk-wer">${escapeHtml(a.art)} „${escapeHtml(a.label)}“${a.stueckNr ? ` Nr. ${a.stueckNr}` : ""}</span>
        <span class="auk-wann">${escapeHtml(a.name)}${a.von ? ` von ${escapeHtml(a.von)}` : ""}</span>
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

    const ein = e.target.closest("[data-auk-ein]");
    if (ein) {
      const g = stand && stand.einliefern ? stand.einliefern.gebuehr : 0;
      Casino.dialog.eingabe(
        `Ab welchem Betrag soll „${ein.dataset.label}“ Nr. ${ein.dataset.nr} losgehen? `
        + `Mindestens ${zahl(stand.startGebot)} Chips. Die Einliefergebühr von ${zahl(g)} Chips wird sofort fällig.`,
        { titel: "Unter den Hammer", platzhalter: "Startgebot in Chips", okText: "Einliefern" },
      ).then((betrag) => {
        if (!betrag) return;
        socket.emit("auktion:einliefern", { uid: ein.dataset.aukEin, mindest: Number(betrag) }, (r) => {
          if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
          if (r.account) applyAccount(r.account);
          toast(`„${r.label}“ Nr. ${r.nr} steht in der Warteschlange.`);
          render({ ok: true, ...r });
        });
      });
      return;
    }

    const zur = e.target.closest("[data-auk-zurueck]");
    if (zur) {
      socket.emit("auktion:zurueck", { uid: zur.dataset.aukZurueck }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
        if (r.account) applyAccount(r.account);
        toast(`„${r.label}“ ist wieder bei dir. Die Gebühr bleibt weg.`);
        render({ ok: true, ...r });
      });
      return;
    }
  });

  socket.on("auktion:verkauft", (d) => {
    toast(`Zuschlag auf dein Los: „${d.label}“ Nr. ${d.nr} geht für ${zahl(d.betrag)} an ${d.an}. Du bekommst ${zahl(d.erloes)} Chips.`);
    Casino.fx?.confetti({ count: 60, wucht: 1.1 });
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
