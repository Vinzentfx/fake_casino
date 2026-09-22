"use strict";

/**
 * Kosmetik-Shop.
 *
 * Vorher gab es hier zwei Regler: ein Emoji und eine flache Schriftfarbe.
 * Beides sieht bei allen gleich aus, und nach zwei Wochen war es niemandem
 * mehr eine Anzeige wert. Dazu kommen jetzt Namensstile (Verlauf, teilweise
 * bewegt), Titel und Rahmen ums Bild.
 *
 * Wichtig ist die Vorschau ganz oben: eine Animation kauft man nicht auf
 * Verdacht. Sie zeigt den eigenen Namen mit dem, was gerade angetippt ist,
 * bevor Chips fliessen.
 */
(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  let stand = null;
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
    kiste: "Aus Kisten", auktion: "Auktionshaus", rad: "Glücksrad",
    comeback: "Wiedereröffnung", haus: "Vom Haus", season: "Season-Pass",
    sammlung: "Kollektion", verdienbar: "Zu verdienen", gratis: "Gratis",
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
        data-type="${type}" data-id="${x.id}" data-owned="${x.owned ? 1 : 0}" data-locked="${gesperrt ? 1 : 0}">
        ${marke(x)}
        ${nummer(x)}
        ${inhalt}
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
      /* Die Garnitur rechnet der Server aus dem ANGELEGTEN aus, nicht aus
         der Vorschau: wer gerade etwas anprobiert, traegt es ja noch
         nicht. Die Karte zeigt deshalb den echten Stand. */
      garnitur: (stand && stand.garnitur) || null,
    };

    const alle = Object.values(listen()).flat();
    const besessen = alle.filter((x) => x.owned).length;
    const gepraegt = alle.filter((x) => x.owned && x.praegung && x.praegung.nr).length;
    const gesamt = alle.filter((x) => x.id !== "keiner" && x.id !== "keins" && x.id !== "standard" && x.id !== "haus" && x.id !== "smile" && x.id !== "white" && x.id !== "konfetti").length;
    const prunk = p.prunk && p.prunk.label && p.prunk.nr
      ? `<div class="cos-pass-trophy">
          <span class="cos-pass-trophy-kicker">Dein Prunkstück</span>
          <b>${escapeHtml(p.prunk.label)}</b><small>${escapeHtml((p.prunk.serie && p.prunk.serie.label) || "Klassische Serie")} · #${escapeHtml(Casino.spieler.serienCode(p.prunk))}</small>
        </div>`
      : `<div class="cos-pass-trophy leer">
          <span class="cos-pass-trophy-kicker">Dein Prunkstück</span>
          <b>Der erste Fund wartet.</b><small>Geprägte Stücke werden hier zu deinem Erkennungszeichen.</small>
        </div>`;
    const details = [
      ["Stil", p.nameStyle ? nameVon("style", p.nameStyle) : "Klassisch"],
      ["Rahmen", p.frame ? nameVon("frame", p.frame) : "Ohne"],
      ["Aura", p.aura ? nameVon("aura", p.aura) : "Ohne"],
      ["Zeichen", p.zeichen ? nameVon("zeichen", p.zeichen) : "Ohne"],
    ];

    box.innerHTML = `
      <div class="cos-atelier-kopf">
        <div><span class="cos-eyebrow">${vorschau ? "Vorschau" : "Dein Auftritt"}</span>
          <b>${vorschau ? "So würde dieses Stück wirken" : "Nicht nur besitzen. Wiedererkennbar sein."}</b></div>
        <span class="cos-sammlung-zaehler"><strong>${besessen}</strong> / ${gesamt} Stücke</span>
      </div>
      <div class="cos-pass"${p.banner ? ` data-banner="${escapeHtml(p.banner)}"` : ""}>
        <div class="cos-pass-foil" aria-hidden="true"></div>
        <div class="cos-pass-brand"><span>FAKE CASINO</span><i>Spielerkarte</i></div>
        <div class="cos-pass-portrait">${Casino.spieler.avatar(p)}</div>
        <div class="cos-pass-person">${Casino.spieler.zeichen(p)}${Casino.spieler.name(p)}${Casino.spieler.prunk(p)}${Casino.spieler.garnitur(p)}${Casino.spieler.title(p)}</div>
        ${prunk}
      </div>
      <div class="cos-atelier-info">
        <div class="cos-atelier-stats">
          <span><b>${gepraegt}</b><small>geprägt</small></span>
          <span><b>${(stand.sammlungen || []).filter((k) => k.komplett).length}</b><small>Kollektionen</small></span>
          <span><b>${p.badge || "—"}</b><small>Auszeichnung</small></span>
        </div>
        <div class="cos-atelier-details">${details.map(([label, value]) =>
          `<span><i>${escapeHtml(label)}</i><b>${escapeHtml(value)}</b></span>`).join("")}</div>
      </div>`;
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

    renderPrunk();
    renderSammlungen();
    renderFamilien();
    renderVorschau();
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

  function handle(el) {
    const type = el.dataset.type, id = el.dataset.id;
    if (el.dataset.locked === "1") {
      const liste = { style: stand.styles, title: stand.titles, frame: stand.frames, avatar: stand.avatars,
        color: stand.colors, effect: stand.effects, spruch: stand.sprueche, banner: stand.banner,
        schild: stand.schilder, aura: stand.auren, karte: stand.karten, zeichen: stand.zeichen }[type] || [];
      const x = liste.find((i) => i.id === id);
      /* Gesperrt heisst jetzt "hast du nicht", nicht mehr "kostet Chips".
         Antippen zeigt es trotzdem in der Vorschau: man soll sehen koennen,
         wofuer man Kisten aufmacht. */
      if (!(vorschau && vorschau.type === type && vorschau.id === id)) {
        vorschau = { type, id };
        Casino.sound.play("tick");
        renderVorschau();
        $("#cos-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      const woher = x && x.herkunft === "kiste"
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
      $("#cos-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    socket.emit("cos:equip", { type, id }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
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
    if (e.target.id === "cos-spruch-text") zeigeSpruchVorschau();
  });

  document.addEventListener("click", (e) => {
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

  window.Casino._loadCosmetics = (skipDust = false) => {
    vorschau = null;
    socket.emit("cos:state", (s) => { if (s && s.ok) render(s); });
    if (!skipDust && window.Casino._loadPraegestaub) window.Casino._loadPraegestaub();
  };
})();
