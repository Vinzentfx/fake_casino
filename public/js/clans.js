"use strict";

/* ============================================================
   Clans

   Der Bildschirm war eine einzige Rolle: Level, Season, Motto, Schatzkammer,
   Auftraege, Mitgliederliste, Anfragen, Protokoll und ganz unten der
   Verlassen-Knopf. Auf dem iPad hiess das anderthalb Meter wischen, um zu
   sehen, wer im Clan ist, und die woechentlichen Auftraege, das Einzige,
   was ohne zwei gleichzeitig anwesende Leute funktioniert, lagen irgendwo
   in der Mitte.

   Jetzt steht oben, was gerade zu tun ist (Auftraege, laufender Krieg),
   und alles Uebrige liegt hinter Reitern.

   Die Rollen-Schaltflaechen tragen ihre Bedeutung nicht mehr im
   title-Attribut. Auf dem iPad gibt es kein Hover: dort standen bisher ein
   nacktes ⬇️ und ein nacktes 🚫 nebeneinander, und einer der beiden warf
   jemanden aus dem Clan.
   ============================================================ */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const sym = (id) => window.Casino.icons.ui(id);
  const betrag = (n) => window.Casino.betrag(n);

  let data = null;
  let reiter = "auftraege";      // welcher Reiter offen ist
  let uhrLaeuft = null;          // Timer fuer den Kriegs-Countdown

  const canManage = () => data && (data.myRole === "founder" || data.myRole === "officer");
  const isFounder = () => data && data.myRole === "founder";
  const rolleName = (r) => (r === "founder" ? "Gründer" : r === "officer" ? "Offizier" : "Mitglied");
  const rolleZeichen = (r) => (r === "founder" ? sym("krone") : r === "officer" ? sym("stern-voll") : "");

  /*
   * Wappen oder Ersatz. Ohne Bild steht der Tag in der Clanfarbe da, das
   * sieht nach Absicht aus, ein leeres Kaestchen nach Fehler.
   */
  function wappenHtml(c, groesse) {
    const kl = "cl-wappen" + (groesse === "gross" ? " cl-wappen-gross" : "");
    if (c.wappen) {
      return `<span class="${kl}"><img src="${escapeHtml(c.wappen)}" alt="Wappen ${escapeHtml(c.name)}" loading="lazy" /></span>`;
    }
    return `<span class="${kl} cl-wappen-leer" style="color:${c.color};border-color:${c.color}">${escapeHtml((c.tag || "?").slice(0, 3))}</span>`;
  }

  /* Restzeit als Text. Unter einer Stunde in Minuten, darueber in Stunden,
     "noch 71h 04min" liest niemand als "knapp drei Tage". */
  function restText(ms) {
    if (ms <= 0) return "gleich vorbei";
    const min = Math.floor(ms / 60000);
    if (min < 60) return `noch ${min} min`;
    const std = Math.floor(min / 60);
    if (std < 48) return `noch ${std} h ${String(min % 60).padStart(2, "0")} min`;
    return `noch ${Math.floor(std / 24)} Tage ${std % 24} h`;
  }

  // --- Eintritt: gruenden oder beitreten ---
  /*
   * Der leere Zustand sagte bisher nur "Clan gründen (100.000)" und darunter
   * "Noch keine Clans, gründe den ersten!". Wofuer man hunderttausend Chips
   * ausgibt, stand nirgends.
   */
  function renderEintritt() {
    const c = data.leaderboard || [];
    return `
      <div class="cl-werbung">
        <div class="cl-werbung-kopf">
          <span class="cl-werbung-sym">${sym("clans")}</span>
          <div>
            <b>Zusammen spielen, ohne gleichzeitig da zu sein</b>
            <small>Ein Clan sammelt, was seine Mitglieder ohnehin spielen,
              jede Runde zählt für alle, egal wer gerade online ist.</small>
          </div>
        </div>
        <ul class="cl-vorteile">
          <li>${sym("quests")}<span><b>Wochenaufträge</b> für die ganze Gruppe. Jede Runde
            von jedem zählt mit.</span></li>
          <li>${sym("schatzkammer")}<span><b>Gemeinsame Kasse.</b> Einzahlen kann jeder,
            auszahlen Gründer und Offiziere.</span></li>
          <li>${sym("season")}<span><b>Clan-Season.</b> Ab Stufe 2 sammeln alle Mitglieder
            schneller Season-XP.</span></li>
          <li>${sym("krieg")}<span><b>Clan-Kriege</b> über mehrere Tage gegen einen anderen
            Clan. Es zählt, was ihr in der Zeit zusammen spielt.</span></li>
        </ul>
      </div>

      <div class="cl-gruenden">
        <div class="cd-sub">Clan gründen <span class="muted">(${betrag(data.createCost)})</span></div>
        <div class="cl-gruenden-felder">
          <label>Name<input id="clan-name" maxlength="22" placeholder="z. B. Die Haie" /></label>
          <label>Tag<input id="clan-tag" maxlength="4" placeholder="HAI" style="text-transform:uppercase" /></label>
        </div>
        <button class="btn-primary" id="clan-create-btn">${sym("clans")} Clan gründen</button>
        <div class="form-error" id="clan-error"></div>
      </div>

      <h3 class="section-title">${sym("bestenliste")}Clans im Haus</h3>
      ${c.length
        ? `<p class="hint">Bei ${sym("sperre")} geschlossenen Clans wird aus dem Beitritt eine Anfrage.</p>`
        : ""}
      <ol class="leaderboard cl-liste" id="clan-board"></ol>`;
  }

  // --- Auftraege: das Herzstueck ---
  /*
   * Sie standen vorher als vierter Abschnitt zwischen Schatzkammer und
   * Mitgliederliste, als schmale Balken ohne Angabe, wie man sie erfuellt
   * und wer schon etwas dazu beigetragen hat. Dabei sind sie das Einzige im
   * ganzen Clan, das ohne zwei gleichzeitig anwesende Leute funktioniert.
   */
  function renderAuftraege(c) {
    const qs = c.quests || [];
    if (!qs.length) return `<p class="muted small">Diese Woche keine Aufträge.</p>`;
    const offen = qs.filter((q) => !q.done).length;
    const namen = new Map((c.members || []).map((m) => [m.key, m.name]));

    return `
      <div class="cl-auftrag-kopf">
        <span>${offen ? `${offen} von ${qs.length} offen` : "Alle erledigt"}</span>
        <small class="muted">Montag gibt es neue</small>
      </div>
      ${qs.map((q) => {
        const pct = q.target ? Math.min(100, Math.round((100 * q.progress) / q.target)) : 0;
        /* Wer hat beigetragen. Die drei Groessten reichen, eine Liste aus
           zwanzig Namen mit je vier XP sagt nichts mehr. */
        const wer = Object.entries(q.wer || {})
          .map(([k, xp]) => ({ name: namen.get(k) || k, xp }))
          .filter((x) => x.xp > 0)
          .sort((a, b) => b.xp - a.xp)
          .slice(0, 3);
        return `<div class="cl-auftrag${q.done ? " done" : ""}">
          <div class="cl-auftrag-zeile">
            <span class="cl-auftrag-haken">${q.done ? sym("ja") : ""}</span>
            <div class="cl-auftrag-text">
              <b>${escapeHtml(q.label)}</b>
              ${q.hinweis ? `<small>${escapeHtml(q.hinweis)}</small>` : ""}
            </div>
            <span class="cl-auftrag-xp">+${fmt(q.xp)} XP</span>
          </div>
          <div class="cl-auftrag-balken"><i style="width:${pct}%"></i></div>
          <div class="cl-auftrag-fuss">
            <span>${fmt(q.progress)} / ${fmt(q.target)}</span>
            ${wer.length
              ? `<span class="cl-wer">${wer.map((x) =>
                  `<em>${escapeHtml(x.name)}</em> ${fmt(x.xp)}`).join(" · ")}</span>`
              : `<span class="muted">noch niemand</span>`}
          </div>
        </div>`;
      }).join("")}`;
  }

  // --- Krieg ---
  /*
   * Der Krieg sah tot aus und war es nicht. Gemessen wird laengst die
   * Season-XP beider Clans ueber mehrere Tage, dafuer muss niemand
   * gleichzeitig da sein. Die Oberflaeche sprach aber weiter von
   * Duell-Siegen, zeigte zwei nackte Zahlen ohne Groessenordnung, und die
   * Restzeit wurde einmal beim Laden ausgerechnet und stand danach still.
   */
  function renderKrieg(c) {
    const w = c && c.war;
    if (!w) {
      return `<div class="cl-kein-krieg">
        <span>${sym("krieg")}</span>
        <div><b>Kein Krieg im Gange</b>
        <small>${canManage()
          ? "Fordert unten in der Liste einen anderen Clan heraus."
          : "Gründer und Offiziere können einen Krieg erklären."}</small></div>
      </div>`;
    }
    const meine = c.id, ichBinA = w.aId === meine;
    const meinTag = ichBinA ? w.aTag : w.bTag, gegnerTag = ichBinA ? w.bTag : w.aTag;
    const meinName = ichBinA ? w.aName : w.bName, gegnerName = ichBinA ? w.bName : w.aName;

    if (w.state === "pending") {
      const gesendet = ichBinA;
      return `<div class="cl-krieg pending">
        <div class="cl-krieg-kopf">${sym("krieg")}
          <b>${gesendet ? "Herausforderung gesendet" : `Herausgefordert von [${escapeHtml(gegnerTag)}]`}</b></div>
        <p class="muted small">${gesendet
          ? `An [${escapeHtml(gegnerTag)}] ${escapeHtml(gegnerName)} · Einsatz ${betrag(w.stake)} · ${w.days} Tage. Warte auf Annahme…`
          : `${escapeHtml(gegnerName)} setzt ${betrag(w.stake)} · ${w.days} Tage. Euer Einsatz kommt aus der Schatzkammer.`}</p>
        ${!gesendet ? (canManage()
          ? `<div class="cl-krieg-knoepfe">
               <button class="btn-primary" id="war-accept">Annehmen</button>
               <button class="btn-secondary" id="war-decline">Ablehnen</button></div>`
          : `<p class="hint">Nur Gründer und Offiziere können annehmen.</p>`) : ""}
      </div>`;
    }

    // Laufender Krieg: Balken statt zweier Zahlen, damit man den Abstand sieht.
    const meinScore = ichBinA ? w.aScore : w.bScore;
    const gegnerScore = ichBinA ? w.bScore : w.aScore;
    const summe = Math.max(1, meinScore + gegnerScore);
    const meinPct = Math.round((100 * meinScore) / summe);
    const vorn = meinScore > gegnerScore, gleich = meinScore === gegnerScore;
    const beitraege = (ichBinA ? w.aBeitrag : w.bBeitrag) || [];

    return `<div class="cl-krieg aktiv ${vorn ? "vorn" : gleich ? "gleich" : "hinten"}">
      <div class="cl-krieg-kopf">${sym("krieg")}<b>Clan-Krieg läuft</b>
        <span class="cl-krieg-zeit" data-endet="${w.endsAt || 0}">${
          w.endsAt ? restText(w.endsAt - Date.now()) : ""}</span></div>

      <div class="cl-krieg-stand">
        <span class="cl-seite mein"><b>[${escapeHtml(meinTag)}]</b>${fmt(meinScore)}</span>
        <span class="cl-seite gegner">${fmt(gegnerScore)}<b>[${escapeHtml(gegnerTag)}]</b></span>
      </div>
      <div class="cl-krieg-balken"><i style="width:${meinPct}%"></i></div>
      <p class="cl-krieg-lage">${
        gleich ? "Gleichstand." :
        vorn ? `Ihr liegt ${fmt(meinScore - gegnerScore)} Punkte vorn.`
             : `${escapeHtml(gegnerName)} liegt ${fmt(gegnerScore - meinScore)} Punkte vorn.`
      } Topf: <b>${betrag(w.stake * 2)}</b></p>

      <p class="hint">Gezählt wird die Season-XP, die ihr in der Kriegszeit zusammen
        sammelt, also jede Runde von jedem, egal welches Spiel. Duell-Siege zählen
        zusätzlich. Niemand muss dafür gleichzeitig online sein.</p>

      ${beitraege.length ? `<div class="cl-krieg-wer">
        <div class="cd-sub">Wer trägt den Krieg</div>
        ${beitraege.slice(0, 6).map((b) => {
          const pct = Math.max(3, Math.round((100 * b.xp) / Math.max(1, beitraege[0].xp)));
          return `<div class="cl-wer-zeile"><span>${escapeHtml(b.name)}</span>
            <i style="width:${pct}%"></i><b>${fmt(b.xp)}</b></div>`;
        }).join("")}
      </div>` : `<p class="muted small">Noch hat niemand etwas beigetragen, die nächste Runde zählt schon.</p>`}
    </div>`;
  }

  /* Die Restzeit lief bisher nicht: sie wurde beim Rendern einmal
     ausgerechnet und stand dann still, bis jemand den Bildschirm neu
     aufrief. Bei einem Krieg ueber drei Tage faellt das nicht auf, in der
     letzten Stunde sehr wohl. */
  function starteUhr() {
    clearInterval(uhrLaeuft);
    uhrLaeuft = setInterval(() => {
      const el = document.querySelector(".cl-krieg-zeit");
      if (!el) { clearInterval(uhrLaeuft); uhrLaeuft = null; return; }
      const endet = Number(el.dataset.endet || 0);
      if (!endet) return;
      const rest = endet - Date.now();
      el.textContent = restText(rest);
      el.classList.toggle("knapp", rest > 0 && rest < 3600000);
      if (rest <= 0) { clearInterval(uhrLaeuft); uhrLaeuft = null; load(); }
    }, 30000);
  }

  // --- Mitglieder ---
  function renderMitglieder(c) {
    const founder = isFounder(), manage = canManage();
    const beitragMap = new Map((c.beitrag || []).map((b) => [b.key, b.xp]));
    const groesster = Math.max(1, ...(c.beitrag || []).map((b) => b.xp), 1);

    let html = `<p class="hint">Der Balken zeigt, wer diese Woche wie viel Season-XP
      für den Clan gesammelt hat. Er setzt sich Montag zurück.</p><div class="cl-roster">`;

    html += c.members.map((m) => {
      const xp = beitragMap.get(m.key) || 0;
      const pct = Math.round((100 * xp) / groesster);
      let ctrls = "";
      if (m.key !== c.founder) {
        /* Beschriftet statt bebildert. Vorher standen hier ⬇️ und 🚫
           nebeneinander, beide erklaert nur im title, auf dem iPad also
           gar nicht. Einer der beiden warf jemanden aus dem Clan. */
        if (founder) ctrls += m.role === "officer"
          ? `<button class="icon-btn clan-demote" data-k="${escapeHtml(m.key)}">${sym("degradieren")}<span>Zurückstufen</span></button>`
          : `<button class="icon-btn clan-promote" data-k="${escapeHtml(m.key)}">${sym("befoerdern")}<span>Offizier</span></button>`;
        if (founder || (manage && m.role === "member")) {
          ctrls += `<button class="icon-btn icon-btn-gefahr clan-kick" data-k="${escapeHtml(m.key)}">${sym("kicken")}<span>Entfernen</span></button>`;
        }
      }
      return `<div class="cl-mitglied">
        <div class="cl-m-kopf">
          <span class="cl-m-name">${rolleZeichen(m.role)}<b>${escapeHtml(m.name)}</b>
            <small>${rolleName(m.role)}</small></span>
          <span class="cl-m-wert">${betrag(m.value)}</span>
        </div>
        <div class="cl-m-balken"><i style="width:${pct}%"></i></div>
        <div class="cl-m-fuss">
          <span>${xp ? `${fmt(xp)} XP diese Woche` : "diese Woche noch nichts"}</span>
          ${ctrls ? `<span class="cl-m-knoepfe">${ctrls}</span>` : ""}
        </div>
      </div>`;
    }).join("") + `</div>`;

    if (manage && c.requests && c.requests.length) {
      html += `<div class="cd-sub" style="margin-top:14px">Beitritts-Anfragen</div>` +
        c.requests.map((r) =>
          `<div class="cl-anfrage"><span>${escapeHtml(r.name)}</span><span>
            <button class="icon-btn icon-btn-gut clan-appr" data-k="${escapeHtml(r.key)}">${sym("ja")}<span>Aufnehmen</span></button>
            <button class="icon-btn icon-btn-gefahr clan-deny" data-k="${escapeHtml(r.key)}">${sym("nein")}<span>Ablehnen</span></button>
          </span></div>`).join("");
    }

    if (manage) {
      html += `<label class="cl-geschlossen">
        <input type="checkbox" id="clan-closed-chk" ${c.closed ? "checked" : ""}/>
        ${sym("sperre")}<span><b>Geschlossen</b><small>Beitritt nur auf Anfrage</small></span></label>`;
    }
    return html;
  }

  // --- Kasse ---
  function renderKasse(c) {
    const manage = canManage();
    let html = `<div class="cl-kasse">
      <div class="cl-kasse-kopf">${sym("schatzkammer")}
        <div><small>Schatzkammer</small><b>${betrag(c.treasury)}</b></div></div>
      <div class="cl-kasse-zeile">
        <input id="clan-donate-amt" type="number" min="1" inputmode="numeric" placeholder="Betrag" />
        <button class="btn-secondary" id="clan-donate-btn">Einzahlen</button>
      </div>`;
    if (manage) {
      html += `<div class="cl-kasse-zeile">
        <select id="clan-payout-to">${(c.members || []).map((m) =>
          `<option value="${escapeHtml(m.key)}">${escapeHtml(m.name)}</option>`).join("")}</select>
        <input id="clan-payout-amt" type="number" min="1" inputmode="numeric" placeholder="Betrag" />
        <button class="btn-secondary" id="clan-payout-btn">Auszahlen</button></div>
        <p class="hint">Jede Auszahlung steht mit Namen im Protokoll und im Chat.</p>`;
    }
    html += `</div>`;

    const log = c.log || [];
    if (log.length) {
      html += `<div class="cd-sub" style="margin-top:14px">Letzte Bewegungen</div><div class="cl-log">` +
        log.slice(0, 10).map((e) => {
          const wann = new Date(e.at).toLocaleString("de-DE",
            { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          return `<div class="cl-log-zeile"><span>${escapeHtml(e.text)}</span><small>${wann}</small></div>`;
        }).join("") + `</div>`;
    }
    return html;
  }

  // --- Fortschritt (Level + Clan-Season) ---
  function renderFortschritt(c) {
    const lvl = c.level || { level: 1, xpInLevel: 0, xpForNext: 500 };
    const xpPct = lvl.xpForNext ? Math.min(100, Math.round((100 * lvl.xpInLevel) / lvl.xpForNext)) : 100;
    let html = `<div class="cl-stufe">
      <div class="cl-stufe-kopf"><b>Clan-Level ${lvl.level}</b>
        <span class="muted small">${fmt(lvl.xpInLevel)} / ${fmt(lvl.xpForNext)} XP</span></div>
      <div class="cl-balken"><i style="width:${xpPct}%;background:${c.color}"></i></div>
      <small class="muted">Kommt aus Duell-Siegen und erledigten Clan-Aufträgen. Nur Prestige, keine Chips.</small>
    </div>`;

    const sa = c.saison;
    if (sa) {
      const naechste = (sa.levels || []).find((r) => !r.erreicht);
      const basis = sa.level > 0 ? (sa.levels[sa.level - 1]?.xp || 0) : 0;
      const spanne = Math.max(1, (sa.nextXp || 0) - basis);
      const pct = naechste ? Math.min(100, Math.round((100 * (sa.xp - basis)) / spanne)) : 100;
      html += `<div class="cl-stufe">
        <div class="cl-stufe-kopf"><b>Clan-Season · Stufe ${sa.level} von ${(sa.levels || []).length}</b>
          <span class="muted small">${naechste ? `${fmt(sa.xp)} / ${fmt(sa.nextXp)} XP` : "alles erreicht"}</span></div>
        <div class="cl-balken"><i style="width:${pct}%;background:${c.color}"></i></div>
        ${sa.bonus > 0
          ? `<div class="cl-bonus">Alle Mitglieder sammeln <b>+${Math.round(sa.bonus * 100)} %</b> Season-XP.</div>`
          : `<small class="muted">Ab Stufe 2 sammeln alle Mitglieder schneller Season-XP.</small>`}
        <div class="cl-season-bahn">${(sa.levels || []).map((r) =>
          `<div class="cl-season-schritt${r.erreicht ? " done" : ""}">
            <span class="cs-num">${r.level}</span>
            <span class="cs-label">${escapeHtml(r.label)}</span>
            <span class="cs-xp">${fmt(r.xp)} XP</span></div>`).join("")}</div>
        <small class="muted">Jede Season-XP eines Mitglieds zählt hier mit, egal welches Spiel.</small>
      </div>`;
    }
    return html;
  }

  // --- Ranglisten ---
  function renderRanglisten() {
    const wl = data.weeklyLeague || [];
    const board = data.leaderboard || [];
    const inClan = !!data.clan;
    const canWar = data.clan && canManage() && !data.clan.war;
    const platz = (i) => `<span class="cl-platz p${i + 1}">${i + 1}</span>`;

    let html = `<h3 class="section-title">${sym("season")}Clan-Liga <span class="muted small">(Season-XP dieser Woche)</span></h3>`;
    html += wl.length
      ? `<ol class="leaderboard cl-liste">` + wl.map((c, i) =>
          `<li>${platz(i)}<span><b style="color:${c.color}">[${escapeHtml(c.tag)}]</b> ${escapeHtml(c.name)}</span>
           <span><b>${fmt(c.xp)}</b> XP${c.wins ? ` · ${c.wins} Duelle` : ""}</span></li>`).join("") + `</ol>`
      : `<p class="muted small">Diese Woche hat noch kein Clan XP gesammelt.</p>`;

    html += `<h3 class="section-title">${sym("bestenliste")}Clan-Rangliste <span class="muted small">(Gesamtwert der Mitglieder)</span></h3>`;
    html += board.length
      ? `<ol class="leaderboard cl-liste" id="clan-board">` + board.map((c, i) => {
          let action = "";
          if (!inClan) action = `<button class="icon-btn clan-join" data-id="${escapeHtml(c.id)}">Beitreten</button>`;
          else if (canWar && c.id !== data.clan.id) {
            action = `<button class="icon-btn clan-war-btn" data-id="${escapeHtml(c.id)}" data-tag="${escapeHtml(c.tag)}">${sym("krieg")}<span>Krieg</span></button>`;
          }
          const meldeKnopf = c.wappen && (!data.clan || c.id !== data.clan.id)
            ? `<button class="cl-melden" data-melde="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}"
                 aria-label="Wappen melden" title="Wappen melden">${sym("alarm")}</button>`
            : "";
          return `<li>${platz(i)}<span class="cl-liste-name">${wappenHtml(c)}
            <span><b style="color:${c.color}">[${escapeHtml(c.tag)}]</b> ${escapeHtml(c.name)}
            <small class="muted">${c.size} ${c.size === 1 ? "Mitglied" : "Mitglieder"}</small></span></span>
            <span>${betrag(c.value)} ${meldeKnopf} ${action}</span></li>`;
        }).join("") + `</ol>`
      : `<p class="muted small">Noch keine Clans, gründe den ersten.</p>`;
    return html;
  }

  // --- Zusammenbau ---
  function renderMine() {
    const box = $("#clan-mine");
    if (!box) return;
    clearInterval(uhrLaeuft); uhrLaeuft = null;

    if (!data.clan) {
      box.innerHTML = renderEintritt() + renderRanglisten();
      verdrahteEintritt();
      return;
    }

    const c = data.clan;
    const offen = (c.quests || []).filter((q) => !q.done).length;
    const reiterListe = [
      ["auftraege", "Aufträge", offen || null],
      ["mitglieder", "Mitglieder", c.size],
      ["kasse", "Kasse", null],
      ["fortschritt", "Fortschritt", null],
    ];

    box.innerHTML = `
      <div class="cl-kopf" style="border-color:${c.color}">
        ${wappenHtml(c, "gross")}
        <div class="cl-kopf-name">
          <b style="color:${c.color}">[${escapeHtml(c.tag)}] ${escapeHtml(c.name)}</b>
          <small>Level ${(c.level || {}).level || 1} · ${c.size} ${c.size === 1 ? "Mitglied" : "Mitglieder"} · du bist ${rolleName(data.myRole)}</small>
        </div>
        <div class="cl-kopf-kasse"><small>Kasse</small>${betrag(c.treasury)}</div>
      </div>
      ${canManage() ? `<div class="cl-wappen-knoepfe">
        <button class="icon-btn" id="cl-wappen-neu">${sym("bearbeiten")}<span>${c.wappen ? "Wappen ändern" : "Wappen hochladen"}</span></button>
        ${c.wappen ? `<button class="icon-btn icon-btn-gefahr" id="cl-wappen-weg">${sym("nein")}<span>Entfernen</span></button>` : ""}
      </div>` : ""}

      <div class="cl-motto">${c.motto
        ? `„${escapeHtml(c.motto)}”`
        : `<span class="muted small">Kein Motto.</span>`}${canManage()
        ? ` <button class="icon-btn" id="clan-motto-btn">${sym("bearbeiten")}<span>Motto</span></button>` : ""}</div>

      ${renderKrieg(c)}

      <nav class="cl-reiter" role="tablist">
        ${reiterListe.map(([id, label, zahl]) =>
          `<button class="cl-reiter-knopf${reiter === id ? " active" : ""}" data-reiter="${id}" role="tab"
             aria-selected="${reiter === id}">${escapeHtml(label)}${
             zahl != null ? `<span class="cl-reiter-zahl">${zahl}</span>` : ""}</button>`).join("")}
      </nav>
      <div class="cl-tafel" id="clan-tafel">${
        reiter === "auftraege" ? renderAuftraege(c) :
        reiter === "mitglieder" ? renderMitglieder(c) :
        reiter === "kasse" ? renderKasse(c) : renderFortschritt(c)}</div>

      ${renderRanglisten()}
      <button class="btn-danger" id="clan-leave">Clan verlassen</button>`;

    verdrahteClan(c);
    if (c.war && c.war.state === "active") starteUhr();
  }

  // --- Verdrahtung ---
  function verdrahteEintritt() {
    $("#clan-create-btn")?.addEventListener("click", () => {
      const name = $("#clan-name").value.trim(), tag = $("#clan-tag").value.trim();
      socket.emit("clan:create", { name, tag }, (r) => {
        if (!r || !r.ok) { $("#clan-error").textContent = (r && r.error) || "Fehler."; return; }
        if (r.account) applyAccount(r.account);
        toast(`Clan [${r.clan.tag}] gegründet.`); load();
      });
    });
    verdrahteRanglisten();
  }

  function verdrahteRanglisten() {
    /* Bilder kann kein Filter pruefen, nur Menschen. Der Knopf schickt die
       Meldung an den Hausherrn, entschieden wird dort. */
    document.querySelectorAll(".cl-melden").forEach((b) => b.addEventListener("click", async () => {
      const grund = await window.Casino.dialog.eingabe(
        `Was stimmt mit dem Wappen von „${b.dataset.name}“ nicht?`,
        { titel: "Wappen melden", platzhalter: "kurz in eigenen Worten", okText: "Melden" });
      if (grund == null) return;
      socket.emit("clan:meldeWappen", { clanId: b.dataset.melde, grund }, (r) => {
        if (!r || !r.ok) return toast(r?.error || "Fehler.");
        toast(r.schon ? "Hattest du schon gemeldet." : "Danke, ist gemeldet.");
      });
    }));
    document.querySelectorAll(".clan-join").forEach((b) => b.addEventListener("click", () => {
      socket.emit("clan:join", { id: b.dataset.id }, (r) => {
        if (r && r.ok) { toast(r.requested ? "Beitritts-Anfrage gesendet." : "Clan beigetreten."); load(); }
        else toast(r?.error || "Fehler.");
      });
    }));
    document.querySelectorAll(".clan-war-btn").forEach((b) => b.addEventListener("click", () => kriegErklaeren(b)));
  }

  function verdrahteClan(c) {
    // Reiter
    document.querySelectorAll(".cl-reiter-knopf").forEach((b) => b.addEventListener("click", () => {
      reiter = b.dataset.reiter;
      renderMine();
    }));

    $("#clan-leave")?.addEventListener("click", async () => {
      if (!await window.Casino.dialog.frage("Clan wirklich verlassen?", { okText: "Verlassen", gefahr: true })) return;
      socket.emit("clan:leave", (r) => { if (r && r.ok) { toast("Clan verlassen."); load(); } else toast(r?.error || "Fehler."); });
    });

    /*
     * Wappen hochladen. Das Bild wird im Browser auf 256x256 gebracht und
     * neu kodiert (core/bildwahl.js), was hier rausgeht, ist ein frisch
     * gezeichnetes Rasterbild, kein weitergereichter Dateiinhalt.
     */
    $("#cl-wappen-neu")?.addEventListener("click", async () => {
      const knopf = $("#cl-wappen-neu");
      const r = await window.Casino.bildwahl.waehle({ kante: 256 });
      if (!r) return;                       // abgebrochen
      if (!r.ok) return toast(r.error);
      if (knopf) { knopf.disabled = true; }
      socket.emit("clan:setWappen", { bild: r.datenUrl }, (a) => {
        if (knopf) knopf.disabled = false;
        if (!a || !a.ok) return toast(a?.error || "Fehler.");
        toast("Wappen gesetzt.");
        load();
      });
    });

    $("#cl-wappen-weg")?.addEventListener("click", async () => {
      if (!await window.Casino.dialog.frage("Wappen wirklich entfernen?",
        { okText: "Entfernen", gefahr: true })) return;
      socket.emit("clan:loescheWappen", (a) => {
        if (!a || !a.ok) return toast(a?.error || "Fehler.");
        toast("Wappen entfernt.");
        load();
      });
    });

    $("#clan-motto-btn")?.addEventListener("click", async () => {
      const motto = await window.Casino.dialog.eingabe("Clan-Motto:", { wert: c.motto || "", okText: "Speichern" });
      if (motto == null) return;
      socket.emit("clan:setMotto", { motto }, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
    });

    $("#clan-donate-btn")?.addEventListener("click", () => {
      const amt = parseInt($("#clan-donate-amt").value, 10);
      if (!Number.isFinite(amt) || amt < 1) { toast("Betrag eingeben."); return; }
      socket.emit("clan:donate", { amount: amt }, (r) => {
        if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
        if (r.account) applyAccount(r.account);
        toast(`${window.Casino.betragText(amt)} eingezahlt.`); load();
      });
    });

    $("#clan-payout-btn")?.addEventListener("click", () => {
      const to = $("#clan-payout-to")?.value;
      const amt = parseInt($("#clan-payout-amt").value, 10);
      if (!to) { toast("Empfänger wählen."); return; }
      if (!Number.isFinite(amt) || amt < 1) { toast("Betrag eingeben."); return; }
      socket.emit("clan:payout", { to, amount: amt }, (r) => {
        if (!r || !r.ok) { toast(r?.error || "Fehler."); return; }
        window.Casino.sound.play("cash");
        toast(`${window.Casino.betragText(amt)} ausgezahlt.`); load();
      });
    });

    $("#clan-closed-chk")?.addEventListener("change", (e) => {
      socket.emit("clan:setClosed", { closed: e.target.checked }, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
    });

    $("#war-accept")?.addEventListener("click", () =>
      socket.emit("clan:acceptWar", (r) => { if (r && r.ok) { toast("Krieg angenommen."); load(); } else toast(r?.error || "Fehler."); }));
    $("#war-decline")?.addEventListener("click", () =>
      socket.emit("clan:declineWar", (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); }));

    document.querySelectorAll(".clan-promote").forEach((b) => b.addEventListener("click", () => act("clan:promote", { key: b.dataset.k })));
    document.querySelectorAll(".clan-demote").forEach((b) => b.addEventListener("click", () => act("clan:demote", { key: b.dataset.k })));
    document.querySelectorAll(".clan-kick").forEach((b) => b.addEventListener("click", async () => {
      if (await window.Casino.dialog.frage("Mitglied wirklich aus dem Clan werfen?", { okText: "Rauswerfen", gefahr: true })) {
        act("clan:kick", { key: b.dataset.k });
      }
    }));
    document.querySelectorAll(".clan-appr").forEach((b) => b.addEventListener("click", () => act("clan:approveRequest", { key: b.dataset.k })));
    document.querySelectorAll(".clan-deny").forEach((b) => b.addEventListener("click", () => act("clan:denyRequest", { key: b.dataset.k })));

    verdrahteRanglisten();
  }

  /*
   * Krieg erklaeren. Die Dauer war eine freie Texteingabe mit dem Hinweis
   * "1, 3 oder 7", wer 5 tippte, bekam kommentarlos 3, weil der Server
   * unbekannte Werte darauf zurueckfallen laesst. Die erlaubten Werte
   * schickt er in warConfig.days laengst mit; jetzt werden sie auch benutzt.
   */
  async function kriegErklaeren(b) {
    const cfg = data.warConfig || { minStake: 10000, days: [1, 3, 7] };
    const kasse = (data.clan && data.clan.treasury) || 0;
    const stakeStr = await window.Casino.dialog.eingabe(
      `Einsatz aus eurer Schatzkammer (${fmt(kasse)} Chips vorhanden). Mindestens ${fmt(cfg.minStake)}.`,
      { titel: `Krieg gegen [${b.dataset.tag}]`, wert: String(cfg.minStake), okText: "Weiter" });
    if (stakeStr == null) return;
    const stake = parseInt(stakeStr, 10);
    if (!Number.isFinite(stake) || stake < cfg.minStake) {
      return toast(`Mindestens ${fmt(cfg.minStake)} Chips.`);
    }
    if (stake > kasse) return toast("So viel ist nicht in der Schatzkammer.");

    const tage = (cfg.days || [1, 3, 7]).slice().sort((x, y) => x - y);
    const hinweise = { 1: "Ein Abend entscheidet", 3: "Genug Zeit für alle", 7: "Die ganze Woche" };
    const wahl = await window.Casino.dialog.wahl(
      "Wie lange soll der Krieg laufen? Gewertet wird die Season-XP, die beide Clans in der Zeit zusammen sammeln.",
      {
        titel: "Dauer",
        optionen: tage.map((t) => ({
          wert: String(t),
          label: t === 1 ? "1 Tag" : `${t} Tage`,
          hinweis: hinweise[t] || "",
        })),
      });
    if (wahl == null) return;
    const days = parseInt(wahl, 10);

    socket.emit("clan:declareWar", { targetId: b.dataset.id, stake, days }, (r) => {
      if (r && r.ok) { toast(`Krieg gegen [${b.dataset.tag}] erklärt.`); load(); }
      else toast(r?.error || "Fehler.");
    });
  }

  function act(ev, payload) {
    socket.emit(ev, payload, (r) => { if (r && r.ok) load(); else toast(r?.error || "Fehler."); });
  }

  function load() {
    socket.emit("clan:state", (s) => { if (!s || !s.ok) return; data = s; renderMine(); });
  }

  socket.on("clan:update", () => {
    const screen = document.querySelector('[data-screen="clans"]');
    if (screen && screen.classList.contains("active")) load();
  });

  window.Casino.screens.register("clans", {
    onEnter: load,
    // Der Countdown muss nicht weiterlaufen, wenn niemand hinsieht.
    onLeave: () => { clearInterval(uhrLaeuft); uhrLaeuft = null; },
  });
  window.Casino._loadClans = load;
})();
