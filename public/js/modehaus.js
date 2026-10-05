"use strict";

/*
 * Das Modehaus in der Ladenstraße.
 *
 * Schaufenster und Kleiderstange (game/boutique.js) lagen bisher unten auf
 * dem Kisten-Bildschirm, unter der Kleiderkiste. Wer etwas Bestimmtes
 * kaufen wollte, landete damit zwischen Glücksspiel-Kisten, und wer eine
 * Kiste aufmachen wollte, scrollte an einem Laden vorbei. Jetzt sind es
 * zwei Häuser: die Kisten für die Überraschung, das Modehaus für das eine
 * Stück, das man will.
 *
 * Dazu die Umkleidekabine: jedes Stück lässt sich an der eigenen Figur
 * anprobieren, auch mehrere zusammen, bevor man bezahlt. Preise, Bestand
 * und Besitz kommen vom Server, gekauft wird über `boutique:kaufen`.
 */
(function () {
  const Casino = window.Casino;
  if (!Casino || !Casino.socket) return;
  const { socket, toast, escapeHtml: esc } = Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const betrag = (n) => (Casino.betrag ? Casino.betrag(n) : esc(fmt(n)));

  const STUFE = { gewoehnlich: "Gewöhnlich", selten: "Selten", episch: "Episch", legendaer: "Legendär", mythisch: "Mythisch" };

  let daten = null;
  let reiter = "fenster";        // fenster, stange
  let stangeArt = "alle";
  let kabine = [];               // [{ art, id, quelle }] in der Reihenfolge des Anprobierens
  let laeuft = false;

  const konto = () => (Casino.getAccount && Casino.getAccount()) || {};
  const quelleVon = (q) => (q === "stange" ? daten.stange : daten.stuecke) || [];
  const finde = (art, id, quelle) => quelleVon(quelle).find((x) => x.art === art && x.id === id) || null;
  const inKabine = (art, id) => kabine.some((k) => k.art === art && k.id === id);

  /** Die eigene Figur mit allem, was in der Kabine hängt. */
  function kabinenLook() {
    const acc = konto();
    const kleidung = { ...(acc.kleidung || {}) };
    for (const k of kabine) kleidung[k.art] = k.id;
    /* Wer ein Fahrzeug angelegt hat, steht in der Kabine trotzdem zu Fuß:
       von vorn verdeckt der Wagen alles, was man gerade anprobiert. */
    delete kleidung.fahrzeug;
    return { ...acc, kleidung };
  }

  /* ---------- Fassade ---------- */
  function fassade() {
    const M = Casino.weltMoebel;
    const z = M && M.ding ? M.ding({ id: "mh-fassade", art: "ladenfront", laden: "modehaus", x: 0, y: 0, block: [0, 0, 3.8, 1] }) : null;
    return z ? `<div class="mh-fassade" style="--seiten:${(z.w / z.h).toFixed(3)}" aria-hidden="true">${z.svg}</div>` : "";
  }

  /* ---------- Schaufenster ---------- */
  function puppe(x) {
    const acc = konto();
    const look = { ...acc, kleidung: { ...(acc.kleidung || {}), [x.art]: x.id } };
    delete look.kleidung.fahrzeug;
    const figur = Casino.figur ? Casino.figur.vorschau(look) : "";
    const an = inKabine(x.art, x.id);
    return `<article class="mh-puppe${an ? " an" : ""}">
      <button type="button" class="mh-puppe-fenster" data-mh-probe="${esc(x.art)}:${esc(x.id)}:fenster" aria-label="${esc(x.label)} anprobieren">
        <span class="mh-spot" aria-hidden="true"></span>
        <span class="mh-puppe-figur">${figur}</span>
        <span class="mh-podest" aria-hidden="true"></span>
      </button>
      <div class="mh-etikett">
        <small class="st-${esc(x.stufe)}">${esc(STUFE[x.stufe] || "")}</small>
        <b>${esc(x.label)}</b>
        ${x.hat ? `<span class="mh-hat">Hast du</span>` : `<span class="mh-preis">${betrag(x.preis)}</span>`}
      </div>
    </article>`;
  }

  function fenster() {
    const tage = Math.max(1, Math.ceil((daten.bis - Date.now()) / 86400000));
    return `<div class="mh-abschnitt-kopf"><div><small class="mh-kicker">Diese Woche</small><h3>Schaufenster</h3></div>
        <span class="mh-frist">Neue Auslage in ${tage} ${tage === 1 ? "Tag" : "Tagen"}</span></div>
      <p class="mh-hinweis">Zwei seltene und zwei epische Stücke zum festen Preis, für alle dieselben. Tipp eine Puppe an, um das Stück anzuprobieren.</p>
      <div class="mh-fenster">${(daten.stuecke || []).map(puppe).join("")}</div>`;
  }

  /* ---------- Kleiderstange ---------- */
  function buegel(x) {
    const bild = Casino.figur ? Casino.figur.stueckVorschau(x.art, x.id, kabinenLook()) : "";
    const an = inKabine(x.art, x.id);
    return `<button type="button" class="mh-buegel${an ? " an" : ""}${x.hat ? " hat" : ""}" data-mh-probe="${esc(x.art)}:${esc(x.id)}:stange" aria-label="${esc(x.label)} anprobieren">
      <svg class="mh-haken" viewBox="0 0 40 18" aria-hidden="true"><path d="M20 7V5a2.4 2.4 0 1 0-2.4-2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M20 7 3 16h34L20 7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <span class="mh-buegel-bild">${bild}</span>
      <b>${esc(x.label)}</b>
      ${x.hat ? `<span class="mh-hat">Hast du</span>` : `<span class="mh-preis">${betrag(x.preis)}</span>`}
    </button>`;
  }

  function stange() {
    const liste = daten.stange || [];
    const namen = daten.artNamen || {};
    const arten = [...new Set(liste.map((x) => x.art))];
    const sicht = stangeArt === "alle" ? liste : liste.filter((x) => x.art === stangeArt);
    const offen = liste.filter((x) => !x.hat).length;
    return `<div class="mh-abschnitt-kopf"><div><small class="mh-kicker">Immer da</small><h3>Kleiderstange</h3></div>
        <span class="mh-frist">${offen ? `${offen} Teile fehlen dir` : "Du hast alles von der Stange"}</span></div>
      <p class="mh-hinweis">Alles Gewöhnliche, dauerhaft und unter dem Wert.</p>
      <div class="mh-filter" role="tablist" aria-label="Art">${["alle", ...arten].map((a) => `<button type="button" role="tab" data-mh-art="${esc(a)}" aria-selected="${a === stangeArt}">${esc(a === "alle" ? "Alles" : namen[a] || a)}</button>`).join("")}</div>
      <div class="mh-stange"><div class="mh-stange-liste">${sicht.map(buegel).join("")}</div></div>`;
  }

  /* ---------- Umkleidekabine ---------- */
  function kabineHtml() {
    const figur = Casino.figur ? Casino.figur.vorschau(kabinenLook()) : "";
    const stuecke = kabine.map((k) => ({ ...k, x: finde(k.art, k.id, k.quelle) })).filter((k) => k.x);
    const offen = stuecke.filter((k) => !k.x.hat);
    const summe = offen.reduce((n, k) => n + k.x.preis, 0);
    const chips = konto().chips || 0;
    return `<div class="mh-kabine${stuecke.length ? " belegt" : ""}">
      <div class="mh-vorhang" aria-hidden="true"><i></i><i></i></div>
      <div class="mh-kabine-kopf"><small class="mh-kicker">Umkleidekabine</small><b>${stuecke.length ? "So sähe es an dir aus" : "Noch nichts anprobiert"}</b></div>
      <div class="mh-kabine-spiegel"><span class="mh-kabine-figur">${figur}</span></div>
      ${stuecke.length ? `<ul class="mh-kabine-liste">${stuecke.map((k) => `<li>
          <span class="mh-kabine-bild">${Casino.figur ? Casino.figur.stueckVorschau(k.art, k.id, kabinenLook()) : ""}</span>
          <span class="mh-kabine-name"><b>${esc(k.x.label)}</b><small>${k.quelle === "stange" ? "Kleiderstange" : "Schaufenster"}</small></span>
          ${k.x.hat ? `<span class="mh-hat">Hast du</span>`
            : `<button type="button" class="btn-primary mh-kauf" data-mh-kauf="${esc(k.art)}:${esc(k.id)}:${esc(k.quelle)}" ${chips < k.x.preis ? "disabled" : ""}>${betrag(k.x.preis)}</button>`}
          <button type="button" class="mh-weg" data-mh-weg="${esc(k.art)}:${esc(k.id)}" aria-label="${esc(k.x.label)} ausziehen">×</button>
        </li>`).join("")}</ul>
        <div class="mh-kabine-fuss">
          ${offen.length > 1 ? `<button type="button" class="btn-primary" data-mh-alles ${chips < summe ? "disabled" : ""}>Alles kaufen · ${betrag(summe)}</button>` : ""}
          ${offen.length && chips < summe ? `<small class="mh-fehlt">Dir fehlen ${fmt(summe - chips)} Chips.</small>` : ""}
          <button type="button" class="chip-btn" data-mh-leeren>Alles ausziehen</button>
        </div>`
        : `<p class="mh-hinweis">Tipp ein Stück an, dann hängt es hier an deiner Figur. Du kannst mehrere kombinieren.</p>`}
    </div>`;
  }

  /* ---------- Aufbau ---------- */
  function render() {
    const host = $("#mh");
    if (!host) return;
    if (!daten) { host.innerHTML = `<p class="mh-laedt">Die Türglocke klingelt …</p>`; return; }
    host.innerHTML = `
      <header class="mh-kopf">${fassade()}<div class="mh-kopf-text"><small class="mh-kicker">Ladenstraße</small><h2>Modehaus</h2><p>Für das eine Stück, das du willst.</p></div></header>
      <div class="mh-haus">
        <div class="mh-laden">
          <nav class="mh-reiter" role="tablist">
            <button type="button" role="tab" data-mh-reiter="fenster" aria-selected="${reiter === "fenster"}">Schaufenster</button>
            <button type="button" role="tab" data-mh-reiter="stange" aria-selected="${reiter === "stange"}">Kleiderstange</button>
          </nav>
          <div class="mh-inhalt">${reiter === "stange" ? stange() : fenster()}</div>
          <button type="button" class="mh-kiste" data-nav="kiste">
            <img src="/assets/kisten/kleider.png" alt="" loading="lazy" decoding="async">
            <span><b>Lieber eine Überraschung?</b><small>Die Kleiderkiste steht im Tresorraum bei den Kisten. Dort gibt es auch Legendäres und Mythisches, das nie im Laden hängt.</small></span>
            <em aria-hidden="true">›</em>
          </button>
        </div>
        <aside class="mh-seite" aria-label="Umkleidekabine">${kabineHtml()}</aside>
      </div>`;
  }

  function kabineNeu() {
    const s = $("#mh .mh-seite");
    if (s) s.innerHTML = kabineHtml();
  }

  function laden() {
    render();
    socket.emit("boutique:state", (r) => {
      if (!r || !r.ok) { if (r && r.error) toast(r.error); return; }
      daten = r;
      /* Was nicht mehr ausliegt (neue Woche), fliegt aus der Kabine. */
      kabine = kabine.filter((k) => finde(k.art, k.id, k.quelle));
      render();
    });
  }

  function kaufen(art, id, quelle) {
    return new Promise((fertig) => {
      socket.emit("boutique:kaufen", { art, id, quelle: quelle === "stange" ? "stange" : null }, (r) => {
        if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); return fertig(false); }
        if (r.account) Casino.applyAccount(r.account);
        const x = finde(art, id, quelle);
        if (x) x.hat = true;
        fertig(r.label || true);
      });
    });
  }

  function gekauft(namen) {
    Casino.sound && Casino.sound.play && Casino.sound.play("win");
    const text = namen.length === 1 ? `${namen[0]} gehört jetzt dir.` : `${namen.length} Stücke gehören jetzt dir.`;
    Casino.dialog && Casino.dialog.frage
      ? Casino.dialog.frage(`${text} Anziehen kannst du ${namen.length === 1 ? "es" : "sie"} in der Garderobe.`, { titel: "Eingepackt", okText: "Zur Garderobe", abbruchText: "Weiter stöbern" })
        .then((ja) => { if (ja) Casino.showScreen("garderobe"); })
      : toast(text);
  }

  document.addEventListener("click", async (e) => {
    if (!e.target.closest || !e.target.closest('[data-screen="modehaus"]')) return;
    const t = (s) => e.target.closest(s);
    let b;
    if ((b = t("[data-mh-reiter]"))) { reiter = b.dataset.mhReiter; render(); return; }
    if ((b = t("[data-mh-art]"))) { stangeArt = b.dataset.mhArt; render(); return; }
    if ((b = t("[data-mh-probe]"))) {
      const [art, id, quelle] = b.dataset.mhProbe.split(":");
      if (inKabine(art, id)) kabine = kabine.filter((k) => !(k.art === art && k.id === id));
      else kabine = [...kabine.filter((k) => k.art !== art), { art, id, quelle }];
      Casino.sound && Casino.sound.play && Casino.sound.play("tick");
      render();
      /* Auf dem Telefon steht die Kabine unter dem Laden: kurz zeigen, dass
         sich dort etwas getan hat. */
      const kab = $("#mh .mh-kabine");
      if (kab && kabine.length && kab.getBoundingClientRect().top > window.innerHeight) kab.classList.add("ruft");
      return;
    }
    if ((b = t("[data-mh-weg]"))) {
      const [art, id] = b.dataset.mhWeg.split(":");
      kabine = kabine.filter((k) => !(k.art === art && k.id === id));
      render();
      return;
    }
    if (t("[data-mh-leeren]")) { kabine = []; render(); return; }
    if ((b = t("[data-mh-kauf]"))) {
      if (laeuft) return;
      const [art, id, quelle] = b.dataset.mhKauf.split(":");
      laeuft = true; b.disabled = true;
      const r = await kaufen(art, id, quelle);
      laeuft = false;
      render();
      if (r) gekauft([r]);
      return;
    }
    if ((b = t("[data-mh-alles]"))) {
      if (laeuft) return;
      laeuft = true; b.disabled = true;
      const namen = [];
      for (const k of kabine) {
        const x = finde(k.art, k.id, k.quelle);
        if (!x || x.hat) continue;
        const r = await kaufen(k.art, k.id, k.quelle);
        if (!r) break;
        namen.push(r);
      }
      laeuft = false;
      render();
      if (namen.length) gekauft(namen);
    }
  });

  /* Chips ändern sich (Miete, Gewinn in einem anderen Tab): Knöpfe neu. */
  socket.on("account:update", () => { if (Casino.screens.current() === "modehaus" && daten && !laeuft) kabineNeu(); });

  /* Von der Kleiderstange im Raum kommt man an die Stange, von den Puppen
     ans Schaufenster. */
  Casino._modehausReiter = (r) => { if (r === "fenster" || r === "stange") reiter = r; };

  Casino.screens.register("modehaus", { onEnter: laden });
  if (Casino.screens.current() === "modehaus") laden();
})();
