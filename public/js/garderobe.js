"use strict";

/*
 * Die Garderobe: die Figur vor dem Spiegel.
 *
 * Bis hierher war Umziehen ein Abschnitt in der Sammlung, zwischen
 * Namensstilen, Kartenrücken und dem Archiv. Wer eine Hose wechseln wollte,
 * suchte sie in einer Liste von 300 Stücken, und die Figur stand klein am
 * Rand. Hier steht sie gross in der Mitte, um sie herum ein Fach je
 * Körperstelle, und daneben der Schrank mit dem, was in dieses Fach passt.
 *
 * Besitz, Anlegen und Looks prüft weiter der Server (`cos:equip`,
 * `cos:setAnlegen`, `cos:outfitSave`, `cos:outfitWear`), dieselben
 * Ereignisse wie in der Sammlung. Nichts hier vergibt etwas.
 *
 * Eigene Stücke legt ein Tipp sofort an. Fremde zieht ein Tipp nur im
 * Spiegel an (`probe`), und mehrere fremde Stücke lassen sich kombinieren:
 * man soll sehen können, wofür man auf den Markt geht.
 */
(function () {
  const Casino = window.Casino;
  if (!Casino || !Casino.socket) return;
  const { socket, toast, escapeHtml: esc } = Casino;
  const $ = (s) => document.querySelector(s);

  /* Die Fächer in der Reihenfolge, in der man an sich herunterschaut.
     Links stehen die am Körper, rechts was man dabeihat. */
  const LINKS = ["kopf", "frisur", "brille", "oberteil", "hose"];
  const RECHTS = ["schuhe", "accessoire", "hand", "fahrzeug", "haustier"];

  const HINWEIS = {
    kopf: "Ohne Kopfbedeckung trägt deine Figur, was ihr Rahmen hergibt.",
    frisur: "Ersetzt die Frisur der Grundform, die Haarfarbe bleibt.",
    oberteil: "Die Clubjacke färbt sich nach deinem Namensstil.",
    hand: "Ohne Ding in der Hand hältst du dein Chat-Zeichen.",
    fahrzeug: "Darauf rollst du im Raum etwas schneller. Am Spiel ändert das nichts.",
    haustier: "Läuft dir im Raum hinterher.",
  };
  const STUFE = { gewoehnlich: "Gewöhnlich", selten: "Selten", episch: "Episch", legendaer: "Legendär", mythisch: "Mythisch", einzel: "Einzelstück", haus: "Vom Haus" };
  const STUFEN = new Set(Object.keys(STUFE));
  const LEER = new Set(["keine", "keins", "standard"]);
  const LAEDEN = new Set(["zoo", "autohaus", "kiosk"]);
  /* Die Blickrichtungen der Figur, wie in der Welt (`r-…` an `.wf`). */
  const BLICKE = ["runter", "rechts", "hoch", "links"];

  let stand = null;
  let fach = "oberteil";
  let reiter = "fach";          // fach, sets, figur, looks
  let alle = false;             // im Fach auch zeigen, was man nicht hat
  let probe = {};               // art -> id, nur im Spiegel
  let blick = 0;
  let laeuft = false;           // eine Anfrage ist unterwegs

  const konto = () => (Casino.getAccount && Casino.getAccount()) || {};
  const art = (a) => stand && (stand.kleidungArten || []).find((x) => x.art === a);
  const topf = (a) => { const x = art(a); return x ? stand[x.topf] || [] : []; };
  const stueck = (a, id) => topf(a).find((x) => x.id === id) || null;
  const stufeVon = (x) => (x && STUFEN.has(x.stufe) ? x.stufe : "gewoehnlich");
  const istLeer = (id) => !id || LEER.has(id);
  /* Wirklich nichts an dieser Stelle. "standard" ist dagegen ein Stück
     (Clubjacke, Sneaker) und bekommt ein Bild. */
  const istNichts = (id) => !id || id === "keine" || id === "keins";

  /** Was gerade wirklich angelegt ist, je Fach die Kennung (auch das Leere). */
  function angelegt(a) {
    const x = topf(a).find((s) => s.equipped);
    return x ? x.id : (topf(a)[0] || {}).id;
  }

  /** Das Aussehen im Spiegel: angelegt, darüber die Anprobe. */
  function spiegelLook() {
    const acc = konto();
    const kleidung = { ...(acc.kleidung || {}) };
    for (const [a, id] of Object.entries(probe)) {
      if (istLeer(id)) delete kleidung[a];
      else kleidung[a] = id;
    }
    return { ...acc, kleidung };
  }

  /* ---------- Spiegel ---------- */

  function figurHtml(p) {
    const F = Casino.figur;
    if (!F) return "";
    const k = p.kleidung || {};
    const fz = typeof k.fahrzeug === "string" && !istLeer(k.fahrzeug) && /^[a-z0-9_]+$/.test(k.fahrzeug) ? k.fahrzeug : null;
    const aura = p.aura && F.AUREN.has(p.aura) ? ` data-aura="${esc(p.aura)}"` : "";
    const tier = typeof k.haustier === "string" && !istLeer(k.haustier) && Casino.haustiere && Casino.haustiere.hat(k.haustier)
      ? `<span class="gd-tier">${Casino.haustiere.tier(k.haustier)}</span>` : "";
    return `<div class="wf gd-wf r-${BLICKE[blick]}${fz ? ` reitet fz-${fz}` : ""}" id="gd-wf">`
      + `<div class="wf-aura"${aura}></div><div class="wf-koerper">${F.ansichten(p)}</div></div>${tier}`;
  }

  function spiegel() {
    const p = spiegelLook();
    const probeListe = Object.entries(probe).filter(([a, id]) => id !== angelegt(a));
    const set = konto().stilSet;
    const proben = probeListe.map(([a, id]) => {
      const x = stueck(a, id);
      return x ? { a, x } : null;
    }).filter(Boolean);
    const fremd = proben.filter(({ x }) => !x.owned);
    const eigen = proben.filter(({ x }) => x.owned);
    return `<div class="gd-spiegel${proben.length ? " probe" : ""}">
        <div class="gd-rahmen" aria-hidden="true">${"<i></i>".repeat(10)}</div>
        <div class="gd-glas">
          <span class="gd-schein" aria-hidden="true"></span>
          ${!proben.length && set && set.label ? `<span class="gd-set">${esc(set.label)}</span>` : ""}
          ${proben.length ? `<span class="gd-probe-marke">Anprobe</span>` : ""}
          <div class="gd-figur" role="img" aria-label="Deine Figur">${figurHtml(p)}</div>
          <span class="gd-boden" aria-hidden="true"></span>
        </div>
      </div>
      <div class="gd-spiegel-leiste">
        <button type="button" class="gd-rund" data-gd-drehen aria-label="Figur drehen">${Casino.icons ? Casino.icons.ui("aktualisieren") : "↻"}</button>
        <div class="gd-gesten">${gestenKnoepfe(p)}</div>
      </div>
      ${proben.length ? `<div class="gd-anprobe">
        <div class="gd-anprobe-text"><b>Im Spiegel, nicht angelegt</b>
          <ul>${proben.map(({ a, x }) => `<li><span>${esc(x.label)}</span>${x.owned ? "<small>gehört dir</small>" : `<small>${esc(woher(x))}</small>`}</li>`).join("")}</ul></div>
        <div class="gd-anprobe-knoepfe">
          ${eigen.length ? `<button type="button" class="btn-primary" data-gd-eigene>${eigen.length === proben.length ? "Anziehen" : "Eigene anziehen"}</button>` : ""}
          ${fremd.some(({ x }) => LAEDEN.has(x.herkunft)) ? `<button type="button" class="btn-secondary" data-gd-laden="${esc(fremd.find(({ x }) => LAEDEN.has(x.herkunft)).x.herkunft)}">Zum Laden</button>` : ""}
          ${fremd.some(({ x }) => x.nur === "kleider") ? `<button type="button" class="btn-secondary" data-nav="modehaus">Modehaus</button>` : ""}
          ${fremd.some(({ x }) => !LAEDEN.has(x.herkunft)) ? `<button type="button" class="btn-secondary" data-nav="kiste">Kisten</button><button type="button" class="btn-secondary" data-nav="market">Markt</button>` : ""}
          <button type="button" class="chip-btn" data-gd-ausziehen>Ausziehen</button>
        </div>
      </div>` : ""}`;
  }

  /* Gesten, die das Outfit im Spiegel mitbringt, zum Ansehen. In der Welt
     gibt es dieselben unter „Gesten“; hier spielt sie nur der Spiegel. */
  function gestenKnoepfe(p) {
    const R = Casino.weltRaeume;
    const liste = [{ id: "winken", name: "Winken" }, { id: "jubeln", name: "Jubeln" }]
      .concat(R && R.gestenFuer ? R.gestenFuer(p.kleidung || {}) : []);
    return liste.slice(0, 6).map((g) => `<button type="button" class="chip-btn" data-gd-geste="${esc(g.id)}">${esc(g.name)}</button>`).join("");
  }

  /* ---------- Fächer ---------- */

  function fachKnopf(a) {
    const x = art(a);
    if (!x) return "";
    const zeigt = probe[a] !== undefined ? probe[a] : angelegt(a);
    const s = stueck(a, zeigt);
    const bild = Casino.figur && s && !istNichts(zeigt) ? Casino.figur.stueckVorschau(a, zeigt, spiegelLook()) : "";
    const zahl = topf(a).filter((t) => t.owned && !istLeer(t.id)).length;
    return `<button type="button" class="gd-fach${fach === a && reiter === "fach" ? " an" : ""}${probe[a] !== undefined && probe[a] !== angelegt(a) ? " probe" : ""}" data-gd-fach="${esc(a)}" aria-pressed="${fach === a && reiter === "fach"}">
      <span class="gd-fach-bild${bild ? "" : " leer"}">${bild}</span>
      <span class="gd-fach-text"><small>${esc(x.name)}</small><b>${esc(s ? s.label : "Ohne")}</b></span>
      <i class="gd-fach-zahl" aria-label="${zahl} eigene">${zahl}</i>
    </button>`;
  }

  /* ---------- Schrank ---------- */

  function woher(x) {
    if (!x) return "";
    if (x.herkunft === "zoo") return "Zoohandlung";
    if (x.herkunft === "autohaus") return "Autohaus";
    if (x.herkunft === "kiosk") return "Kiosk";
    if (x.nur === "kleider") return "Modehaus, Kleiderkiste oder Markt";
    if (x.herkunft === "kiste") return "Kisten oder Markt";
    return x.via || "Anderswo";
  }

  function karte(a, x) {
    const imSpiegel = (probe[a] !== undefined ? probe[a] : angelegt(a)) === x.id;
    const stufe = stufeVon(x);
    const bild = Casino.figur ? Casino.figur.stueckVorschau(a, x.id, spiegelLook()) : "";
    const geste = Casino.weltRaeume && Casino.weltRaeume.gestenFuer && !istLeer(x.id)
      ? Casino.weltRaeume.gestenFuer({ [a]: x.id }).map((g) => g.name).join(", ") : "";
    const nr = x.praegung && x.praegung.nr && Casino.spieler.serienBadge ? Casino.spieler.serienBadge(x.praegung, { label: false }) : "";
    return `<button type="button" class="gd-stueck gd-st-${stufe}${x.equipped ? " traegt" : ""}${imSpiegel && !x.equipped ? " spiegel" : ""}${x.owned ? "" : " fremd"}"
        data-gd-stueck="${esc(x.id)}" aria-pressed="${!!x.equipped}"
        aria-label="${esc(x.label)}, ${x.equipped ? "angelegt" : x.owned ? "anlegen" : "anprobieren"}">
      ${nr}
      <span class="gd-stueck-bild">${istNichts(x.id) ? `<span class="gd-ohne">${esc(x.label)}</span>` : bild}</span>
      <b>${esc(x.label)}</b>
      ${istLeer(x.id) ? "<small>Grundausstattung</small>"
        : `<small class="gd-stufe st-${stufe}">${esc(STUFE[stufe])}</small>`}
      ${geste ? `<small class="gd-geste">Geste: ${esc(geste)}</small>` : ""}
      <span class="gd-status">${x.equipped ? "Trägst du" : x.owned ? "Anziehen" : imSpiegel ? esc(woher(x)) : "Anprobieren"}</span>
    </button>`;
  }

  function schrankFach() {
    const x = art(fach);
    if (!x) return "";
    const liste = topf(fach);
    const eigene = liste.filter((t) => t.owned);
    const zeigen = alle ? liste : eigene;
    const fremdeZahl = liste.length - eigene.length;
    return `<div class="gd-schrank-kopf">
        <div><small class="gd-kicker">Fach</small><h3>${esc(x.name)}</h3></div>
        <div class="gd-umschalter" role="group" aria-label="Was zeigen">
          <button type="button" data-gd-alle="0" aria-pressed="${!alle}">Meine <small>${eigene.filter((t) => !istLeer(t.id)).length}</small></button>
          <button type="button" data-gd-alle="1" aria-pressed="${alle}">Alle <small>${liste.length - 1}</small></button>
        </div>
      </div>
      ${HINWEIS[fach] ? `<p class="gd-hinweis">${esc(HINWEIS[fach])}</p>` : ""}
      <div class="gd-raster">${zeigen.map((t) => karte(fach, t)).join("")}</div>
      ${!alle && fremdeZahl ? `<button type="button" class="gd-mehr" data-gd-alle="1">${fremdeZahl} weitere zum Anprobieren ›</button>` : ""}`;
  }

  function schrankSets() {
    const sets = (stand && stand.sets) || [];
    const look = konto();
    const fertig = sets.filter((s) => s.teile.every((t) => t.hat)).length;
    return `<div class="gd-schrank-kopf"><div><small class="gd-kicker">Style-Sets</small><h3>Ganze Looks</h3></div><span class="gd-zahl">${fertig} / ${sets.length} komplett</span></div>
      <p class="gd-hinweis">Trägst du alle Teile eines Sets, steht sein Name über deiner Figur.</p>
      <div class="gd-sets">${sets.map((st) => {
        const hat = st.teile.filter((t) => t.hat).length;
        const traegt = st.teile.every((t) => t.traegt);
        const komplett = hat === st.teile.length;
        return `<article class="gd-set-karte${traegt ? " traegt" : ""}${komplett ? " komplett" : ""}">
          <header><b>${esc(st.label)}</b><small>${hat} / ${st.teile.length}</small></header>
          <div class="gd-set-teile">${st.teile.map((t) => `<span class="gd-set-teil${t.hat ? " hat" : ""}" title="${esc(t.label)}">${Casino.figur ? Casino.figur.stueckVorschau(t.art, t.id, look) : ""}<small>${esc(t.label)}</small></span>`).join("")}</div>
          <p>${esc(st.text)}</p>
          ${traegt ? `<span class="gd-status">Trägst du</span>`
            : komplett ? `<button type="button" class="btn-primary" data-gd-set-an="${esc(st.id)}">Anziehen</button>`
            : `<button type="button" class="btn-secondary" data-gd-set-probe="${esc(st.id)}">Anprobieren</button>`}
        </article>`;
      }).join("")}</div>`;
  }

  function schrankFigur() {
    return `<div class="gd-schrank-kopf"><div><small class="gd-kicker">Kostenlos</small><h3>Deine Figur</h3></div></div>
      <div id="gd-grundform"></div>`;
  }

  function schrankLooks() {
    const outfits = (stand && stand.outfits) || [];
    return `<div class="gd-schrank-kopf"><div><small class="gd-kicker">Drei Plätze</small><h3>Gespeicherte Looks</h3></div></div>
      <p class="gd-hinweis">Ein Look merkt sich alles, was du angelegt hast: Kleidung, Namensstil, Rahmen, Titel. Anziehen geht nur, solange dir jedes Stück noch gehört.</p>
      <div class="gd-looks">${outfits.map((o) => {
        const bild = o.look && Casino.figur ? Casino.figur.vorschau({ ...konto(), ...o.look }) : "";
        return `<article class="gd-look${o.saved ? "" : " frei"}">
          <span class="gd-look-nr">${o.slot + 1}</span>
          <span class="gd-look-figur">${bild || `<span class="gd-ohne">frei</span>`}</span>
          <small>${o.saved && o.savedAt ? `gespeichert ${esc(new Date(o.savedAt).toLocaleDateString("de-DE", { day: "numeric", month: "short" }))}` : "Noch leer"}</small>
          <div class="gd-look-knoepfe">
            <button type="button" class="btn-primary" data-gd-look-an="${o.slot}" ${o.saved ? "" : "disabled"}>Anziehen</button>
            <button type="button" class="btn-secondary" data-gd-look-save="${o.slot}">${o.saved ? "Ersetzen" : "Speichern"}</button>
          </div>
        </article>`;
      }).join("")}</div>`;
  }

  /* ---------- Aufbau ---------- */

  function render() {
    const host = $("#gd");
    if (!host) return;
    if (!stand) { host.innerHTML = `<p class="gd-laedt">Der Spiegel wird geputzt …</p>`; return; }
    const reiterKnopf = (id, name) => `<button type="button" role="tab" data-gd-reiter="${id}" aria-selected="${reiter === id}">${name}</button>`;
    const inhalt = reiter === "sets" ? schrankSets() : reiter === "figur" ? schrankFigur() : reiter === "looks" ? schrankLooks() : schrankFach();
    host.innerHTML = `
      <header class="gd-kopf">
        <div><small class="gd-kicker">Umkleide</small><h2>Garderobe</h2></div>
        <button type="button" class="chip-btn" data-nav="cosmetics">Sammlung ›</button>
      </header>
      <div class="gd-buehne">
        <div class="gd-faecher gd-links">${LINKS.map(fachKnopf).join("")}</div>
        <div class="gd-mitte">${spiegel()}</div>
        <div class="gd-faecher gd-rechts">${RECHTS.map(fachKnopf).join("")}</div>
      </div>
      <section class="gd-schrank" aria-label="Schrank">
        <nav class="gd-reiter" role="tablist">${reiterKnopf("fach", "Fächer")}${reiterKnopf("sets", "Style-Sets")}${reiterKnopf("figur", "Figur")}${reiterKnopf("looks", "Looks")}</nav>
        <div class="gd-schrank-inhalt">${inhalt}</div>
      </section>`;
    if (reiter === "figur" && Casino.grundform) Casino.grundform.zeichne($("#gd-grundform"));
  }

  /** Nur den Spiegel und die Fächer neu, der Schrank behält seine Stelle. */
  function spiegelNeu() {
    const m = $("#gd .gd-mitte");
    if (!m) return render();
    m.innerHTML = spiegel();
    $("#gd .gd-links").innerHTML = LINKS.map(fachKnopf).join("");
    $("#gd .gd-rechts").innerHTML = RECHTS.map(fachKnopf).join("");
  }

  function geste(id, dauer = 2600) {
    const wf = $("#gd-wf");
    if (!wf || !/^[a-z_]+$/.test(id)) return;
    for (const c of [...wf.classList]) if (c.startsWith("g-")) wf.classList.remove(c);
    void wf.offsetWidth;
    wf.classList.add("g-" + id);
    clearTimeout(geste.t);
    geste.t = setTimeout(() => { const w = $("#gd-wf"); if (w) w.classList.remove("g-" + id); }, dauer);
  }

  /** Nach jedem Anlegen: Konto übernehmen und der Welt Bescheid sagen. */
  function uebernehmen(r) {
    if (r.account) {
      Casino.applyAccount(r.account);
      let tok = null;
      try { tok = localStorage.getItem("casino_token"); } catch {}
      if (tok) socket.emit("auth", { token: tok });
    }
    stand = r;
  }

  function anlegen(a, id) {
    if (laeuft) return Promise.resolve(false);
    laeuft = true;
    return new Promise((fertig) => {
      socket.emit("cos:equip", { type: a, id }, (r) => {
        laeuft = false;
        if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); return fertig(false); }
        uebernehmen(r);
        delete probe[a];
        fertig(true);
      });
    });
  }

  /* Ein Fahrzeug sieht man nur von der Seite: von vorn verdeckt es die
     ganze Figur. Bei allem anderen bleibt der Blick, wie man ihn gedreht hat. */
  function blickFuer(a, id) {
    if (a === "fahrzeug") blick = istNichts(id) ? 0 : 1;
  }

  async function stueckGetippt(id) {
    const x = stueck(fach, id);
    if (!x) return;
    blickFuer(fach, id);
    if (x.owned) {
      if (x.equipped && probe[fach] === undefined) return;
      if (x.equipped) { delete probe[fach]; render(); return; }
      if (await anlegen(fach, id)) {
        Casino.sound && Casino.sound.play("select");
        render();
        $("#gd-wf") && $("#gd-wf").classList.add("gd-neu");
      }
      return;
    }
    /* Fremdes Stück: zweiter Tipp nimmt es wieder aus dem Spiegel. */
    if (probe[fach] === id) delete probe[fach];
    else probe[fach] = id;
    Casino.sound && Casino.sound.play("tick");
    render();
  }

  async function eigeneAnziehen() {
    const liste = Object.entries(probe).filter(([a, id]) => { const x = stueck(a, id); return x && x.owned; });
    for (const [a, id] of liste) {
      if (!(await anlegen(a, id))) break;
    }
    Casino.sound && Casino.sound.play("select");
    render();
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest('[data-screen="garderobe"]')) return;
    const t = (sel) => e.target.closest(sel);
    let b;
    if ((b = t("[data-gd-fach]"))) {
      fach = b.dataset.gdFach; reiter = "fach";
      render();
      const s = $("#gd .gd-schrank");
      if (s && s.getBoundingClientRect().top > window.innerHeight * 0.75) s.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if ((b = t("[data-gd-reiter]"))) { reiter = b.dataset.gdReiter; render(); return; }
    if ((b = t("[data-gd-alle]"))) { alle = b.dataset.gdAlle === "1"; render(); return; }
    if ((b = t("[data-gd-stueck]"))) { stueckGetippt(b.dataset.gdStueck); return; }
    if (t("[data-gd-drehen]")) {
      blick = (blick + 1) % BLICKE.length;
      const wf = $("#gd-wf");
      if (wf) { for (const r of BLICKE) wf.classList.remove("r-" + r); wf.classList.add("r-" + BLICKE[blick]); }
      return;
    }
    if ((b = t("[data-gd-geste]"))) { geste(b.dataset.gdGeste); return; }
    if (t("[data-gd-ausziehen]")) { probe = {}; render(); return; }
    if (t("[data-gd-eigene]")) { eigeneAnziehen(); return; }
    if ((b = t("[data-gd-laden]"))) {
      if (Casino._ladenWunsch) Casino._ladenWunsch(b.dataset.gdLaden);
      Casino.showScreen("laeden");
      return;
    }
    if ((b = t("[data-gd-set-probe]"))) {
      const st = ((stand && stand.sets) || []).find((s) => s.id === b.dataset.gdSetProbe);
      if (!st) return;
      for (const teil of st.teile) probe[teil.art] = teil.id;
      blick = st.teile.some((teil) => teil.art === "fahrzeug") ? 1 : 0;
      Casino.sound && Casino.sound.play("tick");
      render();
      const sp = $("#gd .gd-spiegel");
      if (sp && sp.getBoundingClientRect().top < 0) sp.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if ((b = t("[data-gd-set-an]"))) {
      if (laeuft) return;
      laeuft = true;
      socket.emit("cos:setAnlegen", { set: b.dataset.gdSetAn }, (r) => {
        laeuft = false;
        if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
        uebernehmen(r);
        probe = {};
        Casino.sound && Casino.sound.play("select");
        render();
        geste("jubeln");
      });
      return;
    }
    if ((b = t("[data-gd-look-an], [data-gd-look-save]"))) {
      const speichern = b.hasAttribute("data-gd-look-save");
      const slot = Number(speichern ? b.dataset.gdLookSave : b.dataset.gdLookAn);
      if (laeuft) return;
      laeuft = true;
      b.disabled = true;
      socket.emit(speichern ? "cos:outfitSave" : "cos:outfitWear", { slot }, (r) => {
        laeuft = false;
        b.disabled = false;
        if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
        uebernehmen(r);
        probe = {};
        render();
        toast(speichern ? `Look ${slot + 1} gespeichert.` : `Look ${slot + 1} angezogen.`);
        if (!speichern) geste("jubeln");
      });
    }
  });

  function laden() {
    probe = {};
    blick = 0;
    render();
    socket.emit("cos:state", (s) => {
      if (!s || !s.ok) return;
      stand = s;
      render();
      setTimeout(() => geste("winken", 1800), 250);
    });
  }

  /* Die Grundform meldet sich, wenn sich Haut, Haare oder Hose ändern. */
  document.addEventListener("casino:figur", () => { if (Casino.screens.current() === "garderobe") spiegelNeu(); });
  /* Ein anderer Tab desselben Kontos hat sich umgezogen. */
  socket.on("account:update", () => {
    if (Casino.screens.current() !== "garderobe" || laeuft) return;
    socket.emit("cos:state", (s) => { if (s && s.ok) { stand = s; render(); } });
  });

  Casino.screens.register("garderobe", { onEnter: laden });
  if (Casino.screens.current() === "garderobe") laden();
})();
