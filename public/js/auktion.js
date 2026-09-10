"use strict";

/* ============================================================
   Fake Casino – Auktionshaus.

   Ein Los zur Zeit. Geboten wird mit echten Chips, die sofort
   hinterlegt werden; wer ueberboten wird, hat sein Geld sofort
   zurueck. Der Zuschlag verbrennt den Betrag.

   Der Countdown laeuft hier, das Ende bestimmt der Server: er
   schickt einen Zeitstempel, kein "noch 4 Minuten". Sonst
   laeuft die Uhr auf einem Geraet, das ein paar Sekunden
   danebenliegt, an der echten vorbei.
   ============================================================ */

(function () {
  const Casino = window.Casino;
  const { socket, toast, applyAccount, escapeHtml } = Casino;
  const $ = (s) => document.querySelector(s);
  const zahl = (n) => Math.round(Number(n) || 0).toLocaleString("de-DE");

  let stand = null;
  let uhr = null;

  function restText(ms) {
    if (ms <= 0) return "Zuschlag läuft …";
    const t = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (t > 0) return `noch ${t} ${t === 1 ? "Tag" : "Tage"} ${h} Std`;
    if (h > 0) return `noch ${h} Std ${m} Min`;
    if (m > 0) return `noch ${m}:${String(s).padStart(2, "0")} Min`;
    return `noch ${s} Sekunden`;
  }

  function tickUhr() {
    const el = $("#auk-uhr");
    if (!el || !stand || !stand.los) return;
    const rest = stand.los.endet - Date.now();
    el.textContent = restText(rest);
    // In den letzten zwei Minuten wird jedes Gebot die Uhr weiterschieben.
    el.classList.toggle("auk-heiss", rest > 0 && rest < 120000);
    if (rest <= 0 && !el.dataset.geholt) {
      // Der Server haemmert im Zehn-Sekunden-Takt; danach einmal nachfragen.
      el.dataset.geholt = "1";
      setTimeout(lade, 3000);
    }
  }

  function stueckVorschau(los) {
    // Dieselbe Zeichnung wie im Laden, damit man sieht, worauf man bietet.
    if (los.type === "style") return `<span class="pl-name nm-${escapeHtml(los.id)}" data-name="${escapeHtml(los.label)}">${escapeHtml(los.label)}</span>`;
    if (los.type === "frame") return `<span class="pl-ava fr-${escapeHtml(los.id)}">🙂</span>`;
    if (los.type === "aura") return `<span class="pl-aura au-${escapeHtml(los.id)}"><span class="pl-ava">🙂</span></span>`;
    if (los.type === "karte") return `<span class="cos-karte-demo" data-karte="${escapeHtml(los.id)}"></span>`;
    if (los.type === "schild") return `<span class="auk-schild sch-${escapeHtml(los.id)}">${escapeHtml(los.label)}</span>`;
    if (los.type === "banner") return `<span class="cos-banner-demo" data-banner="${escapeHtml(los.id)}"></span>`;
    if (los.type === "title") return `<span class="auk-titel">${escapeHtml(los.label)}</span>`;
    return `<span class="auk-titel">${escapeHtml(los.label)}</span>`;
  }

  function render(s) {
    stand = s;
    const box = $("#auk-inhalt");
    if (!box) return;

    if (!s.los) {
      box.innerHTML = `
        <div class="tafel tafel-mitte">
          <p class="muted">Zurzeit steht nichts unter dem Hammer.</p>
          <p class="hint">Alle Stücke der ersten Sammlung sind vergeben. Die nächste wird vorbereitet.</p>
        </div>
        ${archivHTML(s)}`;
      return;
    }

    const l = s.los;
    const gesperrt = s.sperreBis > Date.now();
    const tage = gesperrt ? Math.ceil((s.sperreBis - Date.now()) / 86400000) : 0;

    box.innerHTML = `
      <div class="tafel auk-los">
        <div class="auk-kopf">
          <span class="auk-nr">Los ${l.nr}</span>
          <span class="auk-art">${escapeHtml(l.art)}</span>
        </div>
        <div class="auk-buehne">${stueckVorschau(l)}</div>
        <h3 class="auk-name">${escapeHtml(l.label)}</h3>

        <div class="auk-stand">
          <div class="auk-feld">
            <small>${l.gebot ? "Höchstgebot" : "Startgebot"}</small>
            <b>${zahl(l.gebot || s.startGebot)}<i class=mk></i></b>
            <small>${l.gebot ? (l.binIch ? "Das bist du." : escapeHtml(l.bieterName || "")) : "Noch niemand hat geboten."}</small>
          </div>
          <div class="auk-feld">
            <small>Zuschlag</small>
            <b class="auk-uhr" id="auk-uhr">…</b>
            <small>Jedes Gebot in den letzten 2 Minuten verlängert um 2 Minuten.</small>
          </div>
        </div>

        ${gesperrt ? `
          <p class="auk-sperre">Du hast gerade erst ersteigert. Noch ${tage} ${tage === 1 ? "Tag" : "Tage"} Pause, damit nicht immer dieselben alles bekommen.</p>
        ` : l.binIch ? `
          <p class="auk-fuehrt">Du hältst das Höchstgebot. Deine ${zahl(l.gebot)} Chips liegen so lange hinterlegt.</p>
        ` : `
          <div class="auk-bieten">
            <label class="mem-label">Dein Gebot (mindestens ${zahl(l.mindest)})
              <input id="auk-betrag" type="number" inputmode="numeric" min="${l.mindest}" step="1000" value="${l.mindest}" />
            </label>
            <button class="btn-primary" id="auk-bieten">${zahl(l.mindest)} Chips bieten</button>
          </div>
          <p class="hint auk-hinweis">Der Betrag geht sofort vom Konto und kommt sofort zurück, sobald dich jemand überbietet.</p>
        `}

        ${l.verlauf.length ? `<div class="auk-verlauf">
          <h4 class="auk-h">Gebote</h4>
          ${l.verlauf.map((g) => `<div class="auk-zeile"><span>${escapeHtml(g.name)}</span><b>${zahl(g.betrag)}<i class=mk></i></b></div>`).join("")}
        </div>` : ""}
      </div>
      ${archivHTML(s)}`;

    tickUhr();
    if (uhr) clearInterval(uhr);
    uhr = setInterval(tickUhr, 1000);
  }

  function archivHTML(s) {
    const rest = s.offen ? `<p class="hint auk-rest">Noch ${s.offen} ${s.offen === 1 ? "Stück wartet" : "Stücke warten"} auf ihren Termin.</p>` : "";
    if (!s.archiv || !s.archiv.length) return rest;
    return `${rest}
      <div class="tafel auk-archiv">
        <h4 class="auk-h">Schon vergeben</h4>
        ${s.archiv.map((a) => `<div class="auk-zeile">
          <span>${escapeHtml(a.art)} „${escapeHtml(a.label)}“ — ${escapeHtml(a.name)}</span>
          <b>${zahl(a.betrag)}<i class=mk></i></b>
        </div>`).join("")}
      </div>`;
  }

  function lade() {
    socket.emit("auktion:state", (s) => { if (s && s.ok) render(s); });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#auk-bieten")) return;
    const feld = $("#auk-betrag");
    const betrag = Math.floor(Number(feld && feld.value) || 0);
    socket.emit("auktion:bieten", { betrag }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      Casino.sound.play("win");
      toast(r.verlaengert ? `Geboten — und die Uhr läuft zwei Minuten länger.` : `Geboten: ${zahl(betrag)} Chips.`);
      render(r);
    });
  });

  // Der Betrag im Knopf laeuft mit dem Feld mit.
  document.addEventListener("input", (e) => {
    if (e.target.id !== "auk-betrag") return;
    const btn = $("#auk-bieten");
    if (btn) btn.textContent = `${zahl(e.target.value)} Chips bieten`;
  });

  socket.on("auktion:update", () => {
    if (Casino.screens.current() === "auktion") lade();
  });

  socket.on("auktion:ueberboten", (d) => {
    toast(`Überboten bei „${d.label}“: ${d.von} bietet ${zahl(d.betrag)}. Deine ${zahl(d.zurueck)} Chips sind zurück.`);
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
