"use strict";

/** Sammlung, Anprobe und gespeicherte Looks. Besitzänderungen prüft der Server. */
(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let stand = null;
  let filter = "owned";
  let vorschau = null;   // { type, id }, nur angesehen, nicht gekauft

  /*
   * Preis oder Zustand eines Stuecks. Gibt HTML zurueck, nicht Text, die
   * Spielmarke und das Schloss sind gezeichnet. Was von aussen kommt (`via`
   * aus dem Katalog) wird hier einzeln escaped; frueher lief der ganze
   * Rueckgabewert durch escapeHtml, was jetzt die Marke als Zeichenkette
   * sichtbar machen wuerde.
   */
  /*
   * Zustand eines Stuecks. Hier stand der PREIS, und das war die Zeile, die
   * den Laden ausgemacht hat. Kaufen gibt es nicht mehr: Kosmetik kommt aus
   * den Kisten und vom Markt. An der Stelle des Preises steht jetzt, WOHER
   * das Stueck kommt, und das ist bei einem Stueck, das man noch nicht hat,
   * die Angabe, die man wirklich braucht.
   */
  const HERKUNFT = {
    kiste: "Aus Kisten", auktion: "Auktionshaus", rad: "Glücksrad", greifer: "Greifautomat", einlass: "Eröffnung", premiere: "Eröffnung",
    comeback: "Wiedereröffnung", haus: "Vom Haus", season: "Season-Pass",
    sammlung: "Kollektion", verdienbar: "Zu verdienen", gratis: "Gratis",
    staub: "Prägeatelier",
    zoo: "Zoohandlung", autohaus: "Autohaus", kiosk: "Kiosk",
    /* Nur noch über den Markt: die Namensfarben entstehen nicht mehr neu. */
    markt: "Nur noch Markt",
  };
  const preisHtml = (x) => {
    const sperre = window.Casino.icons.ui("sperre");
    if (x.equipped) return `${window.Casino.icons.ui("ja")} Aktiv`;
    if (x.owned) return "Anlegen";
    if (x.herkunft === "gratis") return "Gratis";
    return `${sperre} ${escapeHtml(HERKUNFT[x.herkunft] || x.via || "Anderswo")}`;
  };

  /*
   * Die Seltenheit ist nicht nur eine Zahl im Katalog. In der Sammlung
   * braucht jedes Stück schon aus der Entfernung eine eigene Wertigkeit,
   * sonst sehen ein gewöhnlicher Titel und ein einzelnes Auktionsstück wie
   * dieselbe Kachel aus.
   *
   * Die Stufe kommt vom SERVER (`stufeKennung` in game/cosmetics.js) und
   * wird hier nicht noch einmal aus Preisen gerechnet. Es gibt sie an vier
   * Stellen im Haus — Marke am Namen, Kisteninhalt, Markt, Sammlung — und
   * zwei Schwellenlisten laufen beim nächsten neuen Stück auseinander.
   *
   * Die Serienprägung läuft daneben als eigene Ebene: Stück-Seltenheit und
   * Nummern-Seltenheit sollen nicht dieselbe Farbe an derselben Kante sein.
   */
  const STUFEN = new Set(["gewoehnlich", "selten", "episch", "legendaer", "mythisch", "einzel", "haus"]);
  function stufeVon(x) {
    return x && STUFEN.has(x.stufe) ? x.stufe : "gewoehnlich";
  }

  /** Grob genug: bei sieben Wochen interessiert niemanden die Stunde. */
  function restText(bis) {
    const ms = bis - Date.now();
    if (ms <= 0) return "läuft aus";
    const tage = Math.floor(ms / 86400000);
    if (tage >= 2) return `noch ${tage} Tage`;
    const std = Math.max(1, Math.round(ms / 3600000));
    return `noch ${std} Std`;
  }

  /*
   * Drei Sorten von "nicht kaeuflich", und sie bedeuten Verschiedenes:
   * Season-Stuecke sind mit der Season weg, Comeback-Stuecke mit dem
   * Wiedereroeffnungs-Fenster, und die Stadt-Stuecke bleiben fuer immer
   * erreichbar. Vorher stand ueberall nur ein Schloss, und man konnte nicht
   * sehen, wo es eilt.
   */
  function marke(x) {
    if (x.owned || x.herkunft === "gratis" || x.herkunft === "kiste") return "";
    const f = (stand && stand.fristen) || {};
    // Zwei Zeilen: oben was es ist, darunter wie lange noch. In einer Zeile
    // passt der Countdown nicht in die schmale Kachel und wird abgeschnitten.
    const bau = (art, kopf, frist) =>
      `<span class="cos-marke cos-marke-${art}">${kopf}${frist ? `<i>${frist}</i>` : ""}</span>`;
    if (x.season) return bau("season", "Season 2", f.season ? restText(f.season) : "");
    if (x.limitiert === "comeback") {
      return f.comeback
        ? bau("jetzt", "Nur jetzt", restText(f.comeback))
        : bau("vorbei", "Vorbei", "nicht mehr zu haben");
    }
    /* Auktionsware laeuft gar nicht ab: sie kommt einzeln unter den Hammer,
       und wer sie hat, hat sie von dort. */
    if (x.limitiert === "auktion") return bau("auktion", "Auktion", "einzeln versteigert");
    /* Sammlungs-Belohnung. Nicht "zu verdienen": es gibt genau einen Weg,
       und der steht besser da als ein allgemeines Wort. */
    if (x.limitiert === "sammlung") return bau("sammlung", "Kollektion", "nur komplett");
    if (x.limitiert === "staub") return bau("jetzt", "Prägeatelier", "exklusiver Wochenpreis");
    if (x.limitiert === "haus") return bau("haus", "Vom Haus", "wird vergeben");
    if (x.limitiert === "kiste") return bau("jetzt", "Einzelstück", "nur aus Kisten");
    /* Fortuna laeuft nicht nach Zeit ab, sondern nach Stückzahl. Deshalb
       steht hier kein Countdown, sondern wie viele es noch gibt. */
    if (x.limitiert === "rad") {
      const fo = (stand && stand.fortuna) || {};
      return fo.rest
        ? bau("jetzt", `${fo.rest} von ${fo.max}`, "nur am Glücksrad")
        : bau("vorbei", "Vergeben", "alle sieben sind weg");
    }
    return bau("verdienen", "Zu verdienen", "");
  }

  /*
   * Die Nummer des eigenen Exemplars.
   *
   * Nur bei dem, was man selbst hat: bei allem anderen gibt es kein
   * Exemplar, sondern nur eine Stueckzahl, und die steht schon in der Marke.
   * Das ist der ganze Sinn der Praegung, deshalb steht sie gross und nicht
   * als Beiwerk im Preisfeld.
   */
  function nummer(x) {
    const p = x.praegung;
    if (!p || !p.nr) return "";
    return Casino.spieler.serienBadge(p, { label: false });
  }

  function knopf(type, x, inhalt, klasse = "") {
    // Gesperrt ist jetzt alles, was man noch nicht hat: kaufen kann man
    // nichts mehr, es gibt nur noch besitzen oder nicht besitzen.
    const gesperrt = !x.owned && x.herkunft !== "gratis";
    const stufe = stufeVon(x);
    return `<button class="cos-item ${x.equipped ? "equipped" : ""}${gesperrt ? " locked" : ""} ${klasse}"
        aria-label="${escapeHtml(nameVon(type, x.id))} – ${x.equipped ? "angelegt" : x.owned ? "anlegen" : "anprobieren"}" aria-pressed="${!!x.equipped}"
        data-search="${escapeHtml((nameVon(type, x.id) + " " + (HERKUNFT[x.herkunft] || "")).toLowerCase())}"
        data-type="${type}" data-id="${x.id}" data-owned="${x.owned ? 1 : 0}" data-locked="${gesperrt ? 1 : 0}" data-gratis="${x.cost === 0 ? 1 : 0}">
        ${marke(x)}
        ${nummer(x)}
        ${inhalt}
        ${["avatar", "color", "frame"].includes(type) ? `<span class="cos-piece-name">${escapeHtml(x.label || x.id)}</span>` : ""}
        <span class="cos-tier cos-tier-${stufe}" aria-hidden="true"></span>
        <small class="kos-preis">${preisHtml(x)}</small>
      </button>`;
  }

  /** Der eigene Name so, wie er mit dieser Auswahl aussehen wuerde. */
  function renderVorschau() {
    const box = $("#cos-preview");
    if (!box || !stand) return;
    const acc = Casino.getAccount() || {};
    const gewaehlt = (art, feld, standardwert) => {
      if (vorschau && vorschau.type === art) return vorschau.id === standardwert ? null : vorschau.id;
      return acc[feld] || null;
    };
    const p = {
      name: acc.name || "Du",
      avatar: (vorschau && vorschau.type === "avatar"
        ? (stand.avatars.find((a) => a.id === vorschau.id) || {}).emoji
        : acc.avatar) || "🙂",
      nameColor: vorschau && vorschau.type === "color"
        ? (stand.colors.find((c) => c.id === vorschau.id) || {}).color || null
        : acc.nameColor || null,
      nameStyle: gewaehlt("style", "nameStyle", "standard"),
      frame: gewaehlt("frame", "frame", "keiner"),
      aura: gewaehlt("aura", "aura", "keine"),
      banner: gewaehlt("banner", "banner", "keiner"),
      title: vorschau && vorschau.type === "title"
        ? (stand.titles.find((t) => t.id === vorschau.id) || {}).text || null
        : acc.title || null,
      zeichen: vorschau && vorschau.type === "zeichen" ? vorschau.id : acc.zeichen || null,
      prunk: acc.prunk || null,
      badge: acc.badge || null,
      figur: acc.figur || null,
      /* Anprobe von Kleidung: das eine Stück ersetzt, was an seinem Platz
         liegt, der Rest bleibt, wie er angelegt ist. */
      kleidung: vorschau && vorschau.type === "set"
        ? { ...(acc.kleidung || {}), ...Object.fromEntries(vorschau.teile.map((t) => [t.art, t.id])) }
        : vorschau && kleidungsTopf(vorschau.type)
        ? { ...(acc.kleidung || {}), [vorschau.type]: vorschau.id }
        : acc.kleidung || {},
      stilSet: acc.stilSet || null,
      /* Die Garnitur rechnet der Server aus dem ANGELEGTEN aus, nicht aus
         der Vorschau: wer gerade etwas anprobiert, traegt es ja noch
         nicht. Die Karte zeigt deshalb den echten Stand. */
      garnitur: (stand && stand.garnitur) || null,
    };

    // Die Kleidung zählt mit: sonst stand oben „1 / 142“, während die Leiste darunter ein Dutzend eigene Stücke zeigte.
    const kleidung = (stand.kleidungArten || []).flatMap((a) => stand[a.topf] || []);
    const alle = [...Object.values(listen()).flat(), ...kleidung];
    const besessen = alle.filter((x) => x.owned && x.cost !== 0).length;
    const gepraegt = alle.filter((x) => x.owned && x.praegung && x.praegung.nr).length;
    const gesamt = alle.filter(x => x.cost !== 0).length;
    const details = [["Stil", p.nameStyle ? nameVon("style", p.nameStyle) : "Clubgrün"], ["Rahmen", p.frame ? nameVon("frame", p.frame) : "Ohne"], ["Aura", p.aura ? nameVon("aura", p.aura) : "Ohne"]];
    /* Was davon an der Figur zu sehen ist: der Rahmen wird zur
       Kopfbedeckung, das Chat-Zeichen zum Gegenstand in der Hand. */
    if (Casino.figur) {
      const traegt = Casino.figur.beschreibung(p);
      const handding = p.kleidung && p.kleidung.hand && p.kleidung.hand !== "keins"
        ? (kleidungsTopf("hand") || []).find((x) => x.id === p.kleidung.hand) : null;
      details.push(["Auf dem Kopf", traegt.kopf || "Nichts"], ["In der Hand", handding ? handding.label : traegt.hand]);
      if (p.stilSet && p.stilSet.label) details.push(["Style-Set", p.stilSet.label]);
    }
    $("#cos-collection-count").innerHTML = `<b>${besessen}<span> / ${gesamt}</span></b><small>Sammlerstücke · ${gepraegt} geprägt</small>`;
    $("#cos-collection-note").textContent = besessen ? "Eigene Stücke anlegen oder fehlende unverbindlich anprobieren." : "Deine Grundausstattung ist bereit. Unter „Alles entdecken“ kannst du die Sammlung anprobieren.";
    box.innerHTML = `<div class="wardrobe-stage"${p.banner ? ` data-banner="${escapeHtml(p.banner)}"` : ""}>
      <div class="wardrobe-stage-label"><span class="club-kicker">${vorschau ? "ANPROBE" : "ANGELEGT"}</span><h3>${vorschau ? escapeHtml(vorschau.type === "set" ? vorschau.label : nameVon(vorschau.type, vorschau.id)) : "Dein Look"}</h3></div>
      <div class="wardrobe-model">${Casino.spieler.figur(p)}<div class="wardrobe-name">${Casino.spieler.name(p)}${Casino.spieler.title(p)}</div></div>
      <div class="wardrobe-swatches">${details.map(([k,v]) => `<span><small>${escapeHtml(k)}</small><b>${escapeHtml(v)}</b></span>`).join("")}</div>
      ${vorschau ? '<div class="wardrobe-preview-note"><p>Nicht angelegt. Dein Look bleibt erhalten.</p><button type="button" class="club-button" id="cos-reset-preview">Anprobe beenden</button></div>' : ''}
    </div>
    <div class="wardrobe-context"><span>Im Chat</span><div>${Casino.spieler.avatar(p)}<div>${Casino.spieler.name(p)}${Casino.spieler.zeichen(p)}<p>Bereit für eine Runde.</p></div></div></div>`;
  }

  function filterWardrobe() {
    const query = ($("#cos-search")?.value || "").trim().toLowerCase();
    const nurSets = kategorie === "sets";
    const category = nurSets ? "all" : kategorie;
    const sets = $("#cos-sets"), hinweis = $("#cos-sets-hinweis");
    if (sets) sets.hidden = !nurSets;
    if (hinweis) hinweis.hidden = nurSets || !!query || category !== "all";
    if (nurSets) {
      document.querySelectorAll(".wardrobe-category").forEach((section) => { section.hidden = true; });
      const fertig = ((stand && stand.sets) || []).filter((st) => st.teile.every((t) => t.hat)).length;
      $("#cos-results").textContent = `${fertig} von ${((stand && stand.sets) || []).length} Sets komplett. Unvollständige kannst du als Ganzes anprobieren.`;
      document.querySelectorAll("[data-wardrobe]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wardrobe === filter)));
      return;
    }
    let count = 0;
    document.querySelectorAll(".wardrobe-category").forEach(section => {
      let visible = 0;
      section.querySelectorAll(".cos-item").forEach(item => {
        const show = (filter === "all" || item.dataset.owned === "1") && (category === "all" || item.dataset.type === category) && (!query || item.dataset.search.includes(query));
        item.hidden = !show;
        if (show) visible++;
      });
      section.hidden = !visible;
      section.classList.toggle("has-many-pieces", visible > 2);
      count += visible;
    });
    $("#cos-results").textContent = count ? `${count} auswählbare Stücke${filter === "owned" ? " einschließlich deiner Grundausstattung" : " zum Anlegen oder Anprobieren"}.` : "Keine passenden Stücke. Ändere die Suche oder entdecke alle Stücke.";
    document.querySelectorAll("[data-wardrobe]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wardrobe === filter)));
  }

  function renderOutfits() {
    const host = $("#cos-outfits");
    if (!host) return;
    host.innerHTML = (stand.outfits || []).map(o => `<div class="wardrobe-slot"><span class="wardrobe-slot-number">0${o.slot + 1}</span><div><b>Look ${o.slot + 1}</b><small>${o.saved ? "Gespeichert" : "Noch frei"}</small></div><button type="button" data-outfit-wear="${o.slot}" ${o.saved ? "" : "disabled"} aria-label="Look ${o.slot + 1} anlegen">Anlegen</button><button type="button" data-outfit-save="${o.slot}" aria-label="Aktuellen Look auf Platz ${o.slot + 1} ${o.saved ? "ersetzen" : "speichern"}">${o.saved ? "Ersetzen" : "Speichern"}</button></div>`).join("");
  }

  function render(s) {
    stand = s;
    const setze = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };

    setze("#cos-styles", s.styles.map((x) => knopf("style", x,
      `<span class="cos-style-demo ${x.id === "standard" ? "" : "nm-" + x.id}">${escapeHtml(x.label)}</span>` +
      (x.motion ? `<span class="cos-motion" title="bewegt sich">✨</span>` : ""))).join(""));

    setze("#cos-titles", s.titles.map((x) => knopf("title", x,
      `<span class="cos-title-demo">${x.text ? escapeHtml(x.text) : "(ohne)"}</span>`)).join(""));

    setze("#cos-frames", s.frames.map((x) => knopf("frame", x,
      `<span class="pl-ava ${x.id === "keiner" ? "" : "fr-" + x.id}">🙂</span>`)).join(""));

    setze("#cos-effects", s.effects.map((x) => knopf("effect", x,
      `<span class="cos-effekt-demo">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-auren", s.auren.map((x) => knopf("aura", x,
      `<span class="cos-aura-demo ${x.id === "keine" ? "" : "au-" + x.id}"><span class="pl-ava">🙂</span></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-zeichen", s.zeichen.map((x) => knopf("zeichen", x,
      `<span class="cos-zeichen-demo">${x.icon ? Casino.icons.ui(x.icon) : "–"}</span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-karten", s.karten.map((x) => knopf("karte", x,
      `<span class="cos-karte-demo" data-karte="${x.id}"></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-schilder", s.schilder.map((x) => knopf("schild", x,
      `<span class="online-player cos-schild-demo${x.id === "keins" ? "" : " sch-" + x.id}"><span>🙂</span><b>${escapeHtml((Casino.getAccount() || {}).name || "Du")}</b></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-sprueche", s.sprueche.map((x) => knopf("spruch", x,
      `<span class="cos-title-demo">${x.eigen ? "Eigener Satz" : x.text ? escapeHtml(x.text.replace("{name}", (Casino.getAccount() || {}).name || "Du")) : "(ohne)"}</span>`)).join(""));

    // Das Eingabefeld erscheint erst, wenn der eigene Satz gekauft ist.
    const eigen = s.sprueche.find((x) => x.eigen);
    const box2 = $("#cos-spruch-eigen");
    if (box2) {
      box2.classList.toggle("hidden", !(eigen && eigen.owned));
      const feld = $("#cos-spruch-text");
      if (feld && document.activeElement !== feld) feld.value = s.spruchText || "";
      if (feld) feld.maxLength = s.spruchMax || 60;
      zeigeSpruchVorschau();
    }

    setze("#cos-banner", s.banner.map((x) => knopf("banner", x,
      `<span class="cos-banner-demo" data-banner="${x.id}"></span><span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-avatars", s.avatars.map((x) => knopf("avatar", x,
      `<span class="cos-emoji">${x.emoji}</span>`)).join(""));

    setze("#cos-colors", s.colors.map((x) => knopf("color", x,
      `<span class="cos-swatch" style="background:${x.color || "#e8e8e8"}"></span>`)).join(""));

    renderKleidung(s);
    renderSets(s);
    renderPrunk();
    renderSammlungen();
    renderFamilien();
    renderVorschau();
    renderOutfits();
    renderKategorien();
    filterWardrobe();
  }

  /*
   * Kategorien als Leiste. Vorher war die Kategorie ein Auswahlmenü, und
   * die fünfzehn Style-Sets standen VOR den eigenen Stücken: wer eine Hose
   * anlegen wollte, scrollte erst über drei iPad-Bildschirme voller Sets.
   * Jetzt ist jede Kategorie ein Tipp, die Leiste bleibt beim Scrollen oben,
   * und die Sets sind eine eigene Ansicht. Das Auswahlmenü bleibt als
   * Zustand im Dokument, damit Suche und Filter nur eine Quelle haben.
   */
  let kategorie = "all";
  function renderKategorien() {
    const tools = document.querySelector('[data-screen="cosmetics"] .wardrobe-tools');
    const auswahl = $("#cos-category");
    if (!tools || !auswahl) return;
    let leiste = $("#cos-kategorien");
    if (!leiste) {
      leiste = document.createElement("nav");
      leiste.id = "cos-kategorien";
      leiste.className = "cos-kategorien";
      leiste.setAttribute("aria-label", "Kategorien");
      tools.after(leiste);
    }
    const zaehle = (typ) => {
      const k = [...document.querySelectorAll(`#cos-catalogue .cos-item[data-type="${typ}"]`)].filter((x) => x.dataset.gratis !== "1");
      return [k.filter((x) => x.dataset.owned === "1").length, k.length];
    };
    const sets = (stand && stand.sets) || [];
    const fertig = sets.filter((st) => st.teile.every((t) => t.hat)).length;
    const eintraege = [{ id: "all", label: "Alles" }];
    if (sets.length) eintraege.push({ id: "sets", label: "Style-Sets", zahl: `${fertig}/${sets.length}` });
    for (const o of auswahl.options) {
      if (o.value === "all") continue;
      const [hat, alle] = zaehle(o.value);
      eintraege.push({ id: o.value, label: o.textContent, zahl: alle ? `${hat}/${alle}` : "" });
    }
    leiste.innerHTML = eintraege.map((e) => `<button type="button" data-kategorie="${escapeHtml(e.id)}" aria-pressed="${e.id === kategorie}">${escapeHtml(e.label)}${e.zahl ? `<small>${e.zahl}</small>` : ""}</button>`).join("");
    let hinweis = $("#cos-sets-hinweis");
    if (!hinweis && sets.length) {
      hinweis = document.createElement("button");
      hinweis.type = "button";
      hinweis.id = "cos-sets-hinweis";
      hinweis.className = "cos-sets-hinweis";
      hinweis.dataset.kategorie = "sets";
      $("#cos-catalogue").before(hinweis);
    }
    if (hinweis) {
      const traegt = sets.find((st) => st.teile.every((t) => t.traegt));
      hinweis.innerHTML = `<b>Style-Sets</b><span>${fertig} von ${sets.length} komplett${traegt ? ` · du trägst ${escapeHtml(traegt.label)}` : ""}</span><em>Ansehen ›</em>`;
    }
  }

  function kategorieWaehlen(id) {
    kategorie = id;
    const auswahl = $("#cos-category");
    if (auswahl && [...auswahl.options].some((o) => o.value === id)) auswahl.value = id;
    else if (auswahl) auswahl.value = "all";
    document.querySelectorAll("[data-kategorie]").forEach((b) => b.hasAttribute("aria-pressed") && b.setAttribute("aria-pressed", String(b.dataset.kategorie === id)));
    filterWardrobe();
    // Der Anfang der Auswahl soll sichtbar sein, nicht die Mitte der alten Liste.
    const ziel = $("#cos-kategorien");
    if (ziel && ziel.getBoundingClientRect().top < 0) ziel.scrollIntoView({ block: "start" });
    const aktiv = ziel && ziel.querySelector('[aria-pressed="true"]');
    if (aktiv) aktiv.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /*
   * Kleidung: Frisur, Oberteil, Hose, Schuhe, Brille, Accessoire, Handding,
   * Fahrzeug, Haustier. Die Abschnitte entstehen aus der Liste, die der
   * Server mitschickt (`kleidungArten`), und stehen ganz oben: das ist,
   * was man im Raum an der Figur sieht.
   */
  const HINWEIS_KLEIDUNG = {
    kopf: "Ohne Kopfbedeckung trägt deine Figur, was ihr Rahmen hergibt.",
    frisur: "Ersetzt die Frisur der Grundform, die Haarfarbe bleibt.",
    oberteil: "Die Clubjacke färbt sich nach deinem Namensstil, alles andere hat seine eigene Farbe.",
    fahrzeug: "Darauf rollst du im Raum etwas schneller, am Spiel ändert das nichts. Skateboard und Fahrzeuge mit Hupe bringen eine eigene Geste mit.",
    haustier: "Läuft dir im Raum hinterher und macht unter „Gesten“ ein Kunststück.",
    hand: "Ohne Handding hältst du dein Chat-Zeichen oder einen Chip. Was eine Geste freischaltet, steht an der Kachel; du findest sie im Raum unter „Gesten“.",
  };
  /* Welche Geste ein Stück im Raum freischaltet. Die Liste steht in
     public/js/welt/raeume.js, dieselbe, die der Server prüft. */
  function gesteHinweis(art, id) {
    const R = Casino.weltRaeume;
    if (!R || !R.gestenFuer || id === "keins" || id === "keine") return "";
    const g = R.gestenFuer({ [art]: id });
    return g.length ? `<span class="cos-geste">Geste: ${escapeHtml(g.map((x) => x.name).join(", "))}</span>` : "";
  }
  function kleidungsTopf(art) {
    const a = stand && (stand.kleidungArten || []).find((x) => x.art === art);
    return a ? stand[a.topf] || [] : null;
  }
  function renderKleidung(s) {
    const katalog = $("#cos-catalogue");
    if (!katalog || !s.kleidungArten) return;
    const acc = Casino.getAccount() || {};
    const auswahl = $("#cos-category");
    let davor = katalog.firstChild;
    s.kleidungArten.forEach(({ art, topf, name }, i) => {
      let sek = katalog.querySelector(`.wardrobe-category[data-category="${art}"]`);
      if (!sek) {
        sek = document.createElement("section");
        sek.className = "wardrobe-category wardrobe-kleidung";
        sek.dataset.category = art;
        sek.innerHTML = `<h3 class="section-title" style="margin-top:14px">${escapeHtml(name)}</h3>`
          + (HINWEIS_KLEIDUNG[art] ? `<p class="hint" style="margin-top:-4px">${escapeHtml(HINWEIS_KLEIDUNG[art])}</p>` : "")
          + `<div class="cos-grid cos-grid-wide"></div>`;
        katalog.insertBefore(sek, davor);
        if (auswahl && !auswahl.querySelector(`option[value="${art}"]`)) {
          const o = document.createElement("option");
          o.value = art; o.textContent = name;
          auswahl.insertBefore(o, auswahl.options[1 + i] || null);
        }
      }
      davor = sek.nextSibling;
      sek.querySelector(".cos-grid").innerHTML = (s[topf] || []).map((x) => knopf(art, x,
        `<span class="cos-kleidung-demo">${Casino.figur ? Casino.figur.stueckVorschau(art, x.id, acc) : ""}</span>`
        + `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`
        + gesteHinweis(art, x.id))).join("");
    });
  }

  /*
   * Style-Sets. Wer alle Teile eines Sets gleichzeitig trägt, bekommt den
   * Namen des Sets über den Kopf. Hier steht, was dazugehört, was man schon
   * hat, und ein Knopf, der alles auf einmal anlegt.
   */
  function renderSets(s) {
    const katalog = $("#cos-catalogue");
    if (!katalog || !Array.isArray(s.sets)) return;
    let box = $("#cos-sets");
    if (!box) {
      box = document.createElement("section");
      box.id = "cos-sets";
      box.className = "cos-sets";
      katalog.parentNode.insertBefore(box, katalog);
    }
    const acc = Casino.getAccount() || {};
    box.innerHTML = `<div class="cos-sets-kopf"><span class="club-kicker">STYLE-SETS</span><h3>Ganze Looks</h3><p>Trägst du alle Teile eines Sets, steht sein Name über deiner Figur.</p></div>`
      + `<div class="cos-sets-liste">${s.sets.map((st) => {
        const hat = st.teile.filter((t) => t.hat).length;
        const traegt = st.teile.every((t) => t.traegt);
        const komplett = hat === st.teile.length;
        const fehlt = st.teile.filter((t) => !t.hat).map((t) => t.label);
        return `<article class="cos-set${traegt ? " getragen" : ""}${komplett ? " komplett" : ""}">
          <header><b>${escapeHtml(st.label)}</b><small>${hat} / ${st.teile.length}</small></header>
          <p>${escapeHtml(st.text)}</p>
          <div class="cos-set-teile">${st.teile.map((t) => `<span class="cos-set-teil${t.hat ? " hat" : ""}${t.traegt ? " traegt" : ""}">${Casino.figur ? Casino.figur.stueckVorschau(t.art, t.id, acc) : ""}<small>${escapeHtml(t.label)}</small></span>`).join("")}</div>
          ${traegt ? `<span class="cos-set-status">Getragen</span>`
            : komplett ? `<button type="button" class="club-button" data-set-anlegen="${escapeHtml(st.id)}">Set anlegen</button>`
            : `<span class="cos-set-status">Fehlt: ${escapeHtml(fehlt.join(", "))}</span><button type="button" class="club-button cos-set-probe" data-set-probe="${escapeHtml(st.id)}">Anprobieren</button>`}
        </article>`;
      }).join("")}</div>`;
  }

  /*
   * Das Prunkstueck.
   *
   * Der wunde Punkt bei Kosmetik in diesem Haus ist nicht, wie schoen sie
   * ist, sondern dass sie niemand sieht: Kartenruecken nur bei einem selbst,
   * Aura nur bei Gleichzeitigkeit, Banner erst beim Antippen. Das
   * Prunkstueck haengt dagegen am Namen und reist ueberall mit, wo der Name
   * hingeht. Waehlbar ist nur, was eine Nummer hat.
   */
  function renderPrunk() {
    const box = $("#cos-prunk");
    if (!box || !stand) return;
    const alle = [];
    for (const [art, liste] of Object.entries(listen())) {
      for (const x of liste) {
        if (x.owned && x.praegung && x.praegung.nr) alle.push({ art, ...x });
      }
    }
    if (!alle.length) {
      box.innerHTML = `<div class="cos-vitrine cos-vitrine-leer">
        <div class="cos-vitrine-siegel" aria-hidden="true">✦</div>
        <div><span class="cos-eyebrow">Noch leer</span><b>Deine Vitrine beginnt mit einem Fundstück.</b>
          <p>Alles aus einer Kiste erhält eine Nummer. Wähle später genau eines, das an deinem Namen überall im Haus sichtbar bleibt.</p></div>
        <button class="btn-secondary cos-vitrine-cta" data-nav="kiste" type="button">Kisten ansehen</button>
      </div>`;
      return;
    }
    const aktuell = stand.prunk || "";
    box.innerHTML = `<div class="cos-vitrine"><div class="cos-vitrine-siegel" aria-hidden="true">✦</div><div class="cos-vitrine-intro"><span class="cos-eyebrow">Ausgewähltes Erkennungszeichen</span><b>Ein Fundstück reist mit deinem Namen.</b><p>Die Nummer bleibt sichtbar – auch im Chat, auf Listen und am Tisch.</p></div></div>`
      + `<div class="cos-prunk-liste">`
      + `<button class="cos-prunk-item${aktuell ? "" : " on"}" data-prunk=""><span>Ohne Prunkstück</span><small>ausgeblendet</small></button>`
      + alle.map((x) => {
        const k = `${x.art}:${x.id}`;
        return `<button class="cos-prunk-item${aktuell === k ? " on" : ""}" data-prunk="${escapeHtml(k)}">`
          + `<span>${escapeHtml(nameVon(x.art, x.id))}</span><small>${escapeHtml((x.praegung.serie && x.praegung.serie.kurz) || "Serie")} #${escapeHtml(Casino.spieler.serienCode(x.praegung))}</small></button>`;
      }).join("")
      + `</div>`;
  }

  /** Alle Listen mit ihrer Art, an einer Stelle. */
  function listen() {
    return {
      style: stand.styles, title: stand.titles, frame: stand.frames, avatar: stand.avatars,
      color: stand.colors, effect: stand.effects, spruch: stand.sprueche, banner: stand.banner,
      schild: stand.schilder, aura: stand.auren, karte: stand.karten,
      zeichen: stand.zeichen,
    };
  }

  /**
   * Name eines Stuecks, wie ein Mensch ihn liest.
   *
   * Nicht einfach `x.label`: ein Spruch traegt seinen Satz mit Platzhalter
   * ("Das Haus gruesst {name}."), und der gehoert in einer Liste nicht so
   * hin. Ein Profilbild hat sein Emoji, aber das allein ist als Listenname
   * zu wenig.
   */
  function nameVon(art, id) {
    const x = (listen()[art] || []).find((i) => i.id === id);
    if (!x) return id;
    if (art === "avatar") return `${x.emoji || ""} ${x.label || id}`.trim();
    if (x.label) return x.label;
    if (x.text) return String(x.text).replace("{name}", (Casino.getAccount() || {}).name || "Du");
    return x.emoji || id;
  }

  /**
   * Die Garnituren: was man von jeder Familie hat und was davon an ist.
   *
   * Drei Zahlen je Zeile, und sie beantworten drei verschiedene Fragen:
   * wie viele es gibt (lohnt sich das ueberhaupt), wie viele ich habe
   * (wie weit bin ich), wie viele ich TRAGE (ist sie an). Ohne die dritte
   * waere die Garnitur eine Marke, die irgendwann auftaucht, statt eines
   * Ziels, auf das man zugeht.
   */
  function renderFamilien() {
    const box = $("#cos-familien");
    if (!box || !stand) return;
    const liste = stand.familien || [];
    const ab = stand.garniturAb || 3;
    if (!liste.length) {
      box.innerHTML = `<p class="hint">Noch keine Familie angefangen. Alles aus einer Kiste, einer Kollektion oder dem Auktionshaus gehört zu einer.</p>`;
      return;
    }
    box.innerHTML = liste.map((f) => {
      const an = f.getragen >= ab;
      return `<div class="cos-fam${an ? " an" : ""}" style="--fam:${f.farbe}">
        <div class="cos-fam-kopf">
          <b>${escapeHtml(f.label)}</b>
          ${an ? `<span class="cos-fam-marke${f.getragen >= 5 ? " voll" : ""}">Garnitur ×${f.getragen}</span>`
               : `<span class="cos-fam-fehlt">noch ${ab - f.getragen} zum Anlegen</span>`}
        </div>
        <div class="cos-fam-bahn"><span style="width:${Math.round(f.hat / f.gesamt * 100)}%"></span></div>
        <div class="cos-fam-zahlen">
          <span><b>${f.hat}</b> von ${f.gesamt} besitzt</span>
          <span><b>${f.getragen}</b> angelegt</span>
        </div>
      </div>`;
    }).join("");
  }

  function renderSammlungen() {
    const box = $("#cos-sammlungen");
    if (!box || !stand || !stand.sammlungen) return;
    const zeichen = { porta: "♜", mitternacht: "☾", feuer: "♠" };
    const voll = stand.sammlungen.filter((k) => k.komplett).length;
    const teile = stand.sammlungen.reduce((n, k) => n + k.voll, 0);
    const gesamt = stand.sammlungen.reduce((n, k) => n + k.gesamt, 0);
    const prozent = gesamt ? Math.round(teile / gesamt * 100) : 0;
    box.innerHTML = `
      <div class="cos-archiv">
        <div class="cos-archiv-siegel" style="--fort:${prozent * 3.6}deg"><span>${prozent}<i>%</i></span></div>
        <div class="cos-archiv-text"><span class="cos-eyebrow">Das Sammlungsarchiv</span>
          <b>${voll === stand.sammlungen.length ? "Das Archiv ist vollständig." : `${gesamt - teile} Fundstücke bis zum vollständigen Archiv.`}</b>
          <p>Jede Reihe endet mit einer exklusiven Trophäe, die weder in Kisten noch auf dem Markt entsteht.</p></div>
        <div class="cos-archiv-zahlen"><span><b>${teile}</b><small>von ${gesamt} Teilen</small></span><span><b>${voll}</b><small>von ${stand.sammlungen.length} voll</small></span></div>
      </div>`
      + stand.sammlungen.map((k, index) => {
        const pct = Math.round(k.voll / k.gesamt * 100);
        return `<article class="cos-slg cos-slg-${escapeHtml(k.id)}${k.komplett ? " voll" : ""}">
          <div class="cos-slg-glanz" aria-hidden="true"></div>
          <header class="cos-slg-kopf">
            <div class="cos-slg-symbol" aria-hidden="true">${zeichen[k.id] || "✦"}</div>
            <div class="cos-slg-titel"><span class="cos-eyebrow">Archiv ${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(k.label)}</b><p>${escapeHtml(k.text || "")}</p></div>
            <div class="cos-slg-stand"><strong>${k.voll}</strong><i>/ ${k.gesamt}</i><small>${k.komplett ? "vollendet" : "gefunden"}</small></div>
          </header>
          <div class="cos-slg-bahn"><span style="width:${pct}%"></span><i>${pct} %</i></div>
          <div class="cos-slg-teile">${k.teile.map((t, i) => {
            const stufe = STUFEN.has(t.stufe) ? t.stufe : "gewoehnlich";
            return `<div class="cos-slg-teil cos-slg-teil-${stufe}${t.hat ? " hat" : ""}">
              <span class="cos-slg-index">${String(i + 1).padStart(2, "0")}</span>
              <div class="cos-slg-demo">${Casino.spieler.kosVorschau(t.look, { name: (Casino.getAccount() || {}).name || "Du" })}</div>
              <b>${escapeHtml(t.label || nameVon(t.art, t.id))}</b>
              <small>${escapeHtml((t.look && t.look.artName) || "Fundstück")}</small>
              <span class="cos-slg-status">${t.hat ? "Im Archiv" : "Fehlt"}</span>
            </div>`;
          }).join("")}</div>
          <div class="cos-slg-preis${k.komplett ? " frei" : ""}">
            <div class="cos-slg-preis-demo">${Casino.spieler.kosVorschau(k.belohnung.look, { name: (Casino.getAccount() || {}).name || "Du" })}</div>
            <div><span>${k.komplett ? "Archiv-Trophäe freigeschaltet" : "Trophäe hinter dem letzten Siegel"}</span>
              <b>${escapeHtml(k.belohnung.label || nameVon(k.belohnung.art, k.belohnung.id))}</b>
              <small>${k.komplett ? "Gehört dir für immer." : `Noch ${k.gesamt - k.voll} ${k.gesamt - k.voll === 1 ? "Fundstück" : "Fundstücke"}.`}</small></div>
          </div>
        </article>`;
      }).join("");
  }

  /* Filter, Anprobe und gespeicherte Looks behandelt der Klick-Listener
     weiter unten. Hier standen sie ein zweites Mal, und damit ging jedes
     Speichern oder Anlegen eines Looks zweimal an den Server. */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-prunk]");
    if (!b) return;
    const [type, id] = (b.dataset.prunk || "").split(":");
    socket.emit("cos:prunk", { type, id }, (r) => {
      if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
      if (r.account) applyAccount(r.account);
      render(r);
      toast(type ? "Prunkstück gesetzt. Es hängt jetzt überall an deinem Namen." : "Prunkstück abgelegt.");
    });
  });

  /* Zur Anprobe nur dann scrollen, wenn die Vorschau nicht schon im Bild
     steht. Auf breiten Bildschirmen klebt sie links, dort sprang die Seite
     sonst bei jedem Tipp nach oben und man verlor die Stelle in der Liste. */
  function vorschauZeigen() {
    const box = $("#cos-preview");
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handle(el) {
    const type = el.dataset.type, id = el.dataset.id;
    if (el.dataset.locked === "1") {
      const liste = { style: stand.styles, title: stand.titles, frame: stand.frames, avatar: stand.avatars,
        color: stand.colors, effect: stand.effects, spruch: stand.sprueche, banner: stand.banner,
        schild: stand.schilder, aura: stand.auren, karte: stand.karten, zeichen: stand.zeichen }[type] || kleidungsTopf(type) || [];
      const x = liste.find((i) => i.id === id);
      /* Gesperrt heisst jetzt "hast du nicht", nicht mehr "kostet Chips".
         Antippen zeigt es trotzdem in der Vorschau: man soll sehen koennen,
         wofuer man Kisten aufmacht. */
      if (!(vorschau && vorschau.type === type && vorschau.id === id)) {
        vorschau = { type, id };
        Casino.sound.play("tick");
        renderVorschau();
        vorschauZeigen();
        return;
      }
      /* Was aus einem Laden in der Ladenstraße kommt, öffnet gleich den
         Laden: dort steht der Preis, und man kann es sofort holen. */
      if (x && ["zoo", "autohaus", "kiosk"].includes(x.herkunft)) {
        if (Casino._ladenWunsch) Casino._ladenWunsch(x.herkunft);
        return Casino.showScreen("laeden");
      }
      const woher = x && x.nur === "kleider"
        ? "Das kommt aus der Kleiderkiste oder, wenn es diese Woche ausliegt, aus dem Schaufenster daneben. Beides im Menü unter „Kisten“. Sonst auf dem Markt von jemandem, der es hat."
        : x && x.herkunft === "kiste"
        ? "Das kommt aus den Kisten. Im Menü unter „Kisten“, oder auf dem Markt von jemandem, der es hat."
        : x && x.via ? x.via + "." : "Gibt es hier nicht.";
      return toast(woher);
    }
    const owned = el.dataset.owned === "1";
    // Einen Effekt kann man nicht in einer Zeile zeigen, der muss laufen.
    // Deshalb spielt jeder Tipp ihn einmal ab, egal ob gekauft oder nicht.
    if (type === "effect") {
      const acc = Casino.getAccount() || {};
      const gemerkt = acc.winEffect;
      acc.winEffect = id === "konfetti" ? null : id;
      Casino.fx.spieleGewinnEffekt();
      setTimeout(() => { acc.winEffect = gemerkt; }, 1400);
    }
    // Erst ansehen: ein Tipp auf etwas, das man nicht hat, zeigt es nur in
    // der Vorschau.
    if (!owned && !(vorschau && vorschau.type === type && vorschau.id === id)) {
      vorschau = { type, id };
      Casino.sound.play("tick");
      renderVorschau();
      vorschauZeigen();
      return;
    }
    socket.emit("cos:equip", { type, id }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) { applyAccount(r.account); const tok = localStorage.getItem("casino_token"); if (tok) socket.emit("auth", { token: tok }); }
      vorschau = null;
      Casino.sound.play("select");
      toast("Angelegt.");
      render(r);
    });
  }

  /** Vorschau des eigenen Satzes, so wie er im Chat stehen wuerde. */
  function zeigeSpruchVorschau() {
    const feld = $("#cos-spruch-text");
    const vor = $("#cos-spruch-vorschau");
    if (!feld || !vor) return;
    const name = (Casino.getAccount() || {}).name || "Du";
    const text = feld.value.trim();
    vor.textContent = text ? `${name} ${text}` : "(noch nichts eingetragen)";
  }

  document.addEventListener("input", (e) => {
    if (e.target.id === "cos-search") filterWardrobe();
    if (e.target.id === "cos-spruch-text") zeigeSpruchVorschau();
  });

  $("#cos-category")?.addEventListener("change", (e) => kategorieWaehlen(e.target.value));
  document.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-wardrobe]");
    if (mode) { filter = mode.dataset.wardrobe; filterWardrobe(); return; }
    if (e.target.closest("#cos-reset-preview")) { vorschau = null; renderVorschau(); return; }
    const outfit = e.target.closest("[data-outfit-save], [data-outfit-wear]");
    if (outfit) {
      const saving = outfit.hasAttribute("data-outfit-save");
      const slot = Number(saving ? outfit.dataset.outfitSave : outfit.dataset.outfitWear);
      outfit.disabled = true;
      socket.emit(saving ? "cos:outfitSave" : "cos:outfitWear", { slot }, r => {
        outfit.disabled = false;
        if (!r?.ok) return toast(r?.error || "Look konnte nicht gespeichert werden.");
        if (r.account) { applyAccount(r.account); const tok = localStorage.getItem("casino_token"); if (tok) socket.emit("auth", { token: tok }); }
        vorschau = null;
        render(r);
        toast(saving ? "Dein angelegter Look ist gespeichert." : "Look angelegt.");
      });
      return;
    }
    const kat = e.target.closest("[data-kategorie]");
    if (kat) { kategorieWaehlen(kat.dataset.kategorie); return; }
    const probe = e.target.closest("[data-set-probe]");
    if (probe && stand) {
      const st = (stand.sets || []).find((x) => x.id === probe.dataset.setProbe);
      if (st) {
        vorschau = { type: "set", id: st.id, label: st.label, teile: st.teile.map((t) => ({ art: t.art, id: t.id })) };
        Casino.sound.play("tick");
        renderVorschau();
        vorschauZeigen();
      }
      return;
    }
    const setKnopf = e.target.closest("[data-set-anlegen]");
    if (setKnopf) {
      socket.emit("cos:setAnlegen", { set: setKnopf.dataset.setAnlegen }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
        if (r.account) { applyAccount(r.account); const tok = localStorage.getItem("casino_token"); if (tok) socket.emit("auth", { token: tok }); }
        vorschau = null;
        Casino.sound.play("select");
        toast("Set angelegt.");
        render(r);
      });
      return;
    }
    if (e.target.id === "cos-spruch-save") {
      const feld = $("#cos-spruch-text");
      socket.emit("cos:spruchText", { text: feld.value }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Fehler.");
        toast("Satz gespeichert.");
        render(r);
      });
      return;
    }
    const el = e.target.closest('[data-screen="cosmetics"] .cos-item');
    if (el) handle(el);
  });

  // Die Grundform (public/js/welt/grundform.js) zeichnet die Vorschau neu.
  window.Casino._cosVorschau = () => renderVorschau();
  window.Casino._loadCosmetics = (skipDust = false) => {
    vorschau = null;
    socket.emit("cos:state", (s) => { if (s && s.ok) render(s); });
    if (!skipDust && window.Casino._loadPraegestaub) window.Casino._loadPraegestaub();
  };
})();
