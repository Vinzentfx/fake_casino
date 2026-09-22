"use strict";

/* Kisten
   Der Server zieht, dieser Bildschirm zeigt die Ziehung. Die Rolle kommt
   fertig vom Server, der Treffer steht auf einem festen Platz weit hinten;
   hier wird nur noch dorthin gefahren. Nichts davon entscheidet etwas. */

(function () {
  const { socket, toast, applyAccount, escapeHtml } = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");
  const pct = (n) => Number(n).toLocaleString("de-DE", { maximumFractionDigits: 1 });

  let stand = null;
  let laeuft = false;
  let reiter = "kisten";
  const acc = () => window.Casino.getAccount() || {};
  const aufSchirm = () => document.querySelector('[data-screen="kiste"]')?.classList.contains("active");

  /* Breite eines Feldes auf der Bahn plus Abstand. Muss zu .ki-feld in
     styles.css passen: der Endpunkt wird daraus gerechnet, und ein
     Unterschied von zwei Pixeln verschiebt den Treffer sichtbar aus der
     Mitte. Deshalb steht die Zahl hier und wird aus dem ersten Feld
     nachgemessen, statt sie zu raten. */
  const FELD_FALLBACK = 116;

  function load() {
    socket.emit("kiste:state", (res) => {
      if (!res || !res.ok) return;
      stand = res;
      render();
      zeichneRuhm(res.ruhm || []);
    });
  }

  /* ---------------------------------------------------------------
     Die Ruhmestafel
     Was zuletzt im Haus gezogen wurde, mit Namen. Sie steht ganz oben,
     weil sie die einzige Antwort auf die Frage ist, die man sich vor
     einer 600.000er Kiste stellt: kommt da wirklich etwas raus?
     --------------------------------------------------------------- */
  let tafel = [];

  function zeichneRuhm(liste) {
    tafel = liste || [];
    const kasten = $("#ki-ruhm");
    const band = $("#ki-ruhm-band");
    if (!kasten || !band) return;
    kasten.classList.toggle("hidden", !tafel.length);
    if (!tafel.length) return;
    band.innerHTML = tafel.map((e) => `
      <div class="ki-ruhm-karte" style="--stufe:${e.stufe.farbe}">
        <div class="ki-ruhm-stufe">${escapeHtml(e.stufe.label)}</div>
        <div class="ki-ruhm-demo">${window.Casino.spieler.kosVorschau(e.look2, { name: e.name })}</div>
        <div class="ki-ruhm-name">${escapeHtml(e.label)}</div>
        ${e.nr ? window.Casino.spieler.serienBadge(e, { label: false }) : ""}
        <div class="ki-ruhm-wer">${window.Casino.spieler.chip(e.look ? { ...e.look, name: e.name } : { name: e.name })}</div>
      </div>`).join("");
  }

  /* Ein neuer Eintrag schiebt sich vorne rein, statt die ganze Tafel neu zu
     bauen: wer gerade zusieht, soll sehen, DASS etwas dazugekommen ist. */
  socket.on("ruhm:neu", ({ eintrag, banner } = {}) => {
    if (!eintrag) return;
    tafel = [eintrag, ...tafel].slice(0, 12);
    if (aufSchirm()) {
      zeichneRuhm(tafel);
      $("#ki-ruhm-band")?.firstElementChild?.classList.add("frisch");
    }
    if (banner) zeigeRuhmBanner(eintrag);
  });

  /* Das Banner quer ueber den Bildschirm. Für sehr seltene Stücke und
     besonders seltene Seriennummern, aber nicht für den Ziehenden selbst. */
  let bannerTimer = null;
  function zeigeRuhmBanner(e) {
    const el = $("#ruhm-banner");
    if (!el) return;
    if (e.name === acc().name) return;
    const serienRang = e.serie && e.serie.id;
    const art = serienRang === "jackpot" ? "jackpot"
      : serienRang === "gold" ? "gold"
      : e.stufe.id === "kiste" ? "einzel" : "mythisch";
    const titel = serienRang === "jackpot" ? "Serien-Jackpot"
      : serienRang === "gold" ? "Gold-Serie"
      : e.stufe.id === "kiste" ? "Einzelstück" : "Mythischer Fund";
    el.dataset.art = art;
    el.style.setProperty("--stufe", (e.serie && e.serie.farbe) || e.stufe.farbe);
    el.innerHTML = `<span class="rb-spark" aria-hidden="true">✦</span><span class="rb-stufe">${titel}</span>
      <span class="rb-text">${window.Casino.spieler.name(e.look ? { ...e.look, name: e.name } : { name: e.name })}
      zieht <b>${escapeHtml(e.label)}</b>${e.nr ? ` · #${escapeHtml(window.Casino.spieler.serienCode(e))} ${(e.serie && escapeHtml(e.serie.kurz)) || ""}` : ""}`
      + `${e.artName ? ` <i>${escapeHtml(e.artName)}</i>` : ""}</span>`;
    el.classList.remove("hidden");
    // Neu anstossen, falls schon eins laeuft.
    el.classList.remove("an");
    void el.offsetWidth;
    el.classList.add("an");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.classList.remove("an"); el.classList.add("hidden"); }, 6200);
  }

  /* ---------------------------------------------------------------
     Reiter
     --------------------------------------------------------------- */
  function zeigeReiter(name) {
    reiter = name;
    document.querySelectorAll("#ki-reiter .ki-reiter-knopf").forEach((b) => {
      const an = b.dataset.kiTab === name;
      b.classList.toggle("active", an);
      b.setAttribute("aria-selected", an ? "true" : "false");
    });
    document.querySelectorAll("[data-ki-tafel]").forEach((t) => {
      t.classList.toggle("hidden", t.dataset.kiTafel !== name);
    });
    if (name === "duelle") ladeDuelle();
  }

  /** Die farbige Leiste unter einer Kiste: welche Stufe wie wahrscheinlich ist. */
  function chancenLeiste(k) {
    return `<div class="ki-chancen" role="img" aria-label="${k.chancen.map((c) => `${c.label} ${c.pct} Prozent`).join(", ")}">`
      + k.chancen.map((c) => `<span style="flex:${c.pct};background:${c.farbe}"></span>`).join("")
      + `</div>`
      + `<div class="ki-chancen-text">${k.chancen.map((c) =>
          `<span><i style="background:${c.farbe}"></i>${escapeHtml(c.label)} ${c.pct} %</span>`).join("")}</div>`;
  }

  /* Wie lange eine limitierte Kiste noch steht. Tage, solange es mehr als
     einer ist, danach Stunden: "noch 1 Tag" ist eine andere Nachricht als
     "noch 9 Stunden". */
  function restLauf(bis) {
    const ms = bis - Date.now();
    if (ms <= 0) return "gleich vorbei";
    const tage = Math.floor(ms / 86400000);
    if (tage >= 2) return `${tage} Tage`;
    const std = Math.floor(ms / 3600000);
    if (std >= 2) return `${std} Stunden`;
    return `${Math.max(1, Math.round(ms / 60000))} Minuten`;
  }

  /* Die beste Stufe, die eine Kiste ueberhaupt ausspucken kann. Sie faerbt
     die Kachel: der Schein hinter der Kiste, der Rand und die Zeile darueber.
     Damit sieht man den Unterschied zwischen 30.000 und 600.000, bevor man
     den Preis gelesen hat. `chancen` kommt in der Reihenfolge der Stufen vom
     Server, das letzte Feld ist also das hoechste. */
  const beste = (k) => k.chancen[k.chancen.length - 1];

  function renderSerienlotterie() {
    const box = $("#ki-serienlotterie");
    if (!box || !stand || !stand.serien) return;
    const klassen = stand.serien.klassen || [];
    box.innerHTML = `<div class="ki-serien-kopf">
        <span class="ki-serien-siegel" aria-hidden="true">#</span>
        <div><span class="cos-eyebrow">Serienlotterie</span><b>Jeder Zug prägt eine freie Nummer.</b>
          <p>Nummern reichen von #0001 bis #9999 und werden nach Seltenheitsklasse ausgelost.</p></div>
      </div>
      <div class="ki-serien-chancen">${klassen.map((s) => `
        <span class="serie-${escapeHtml(s.id)}"><i style="--serie:${s.farbe}"></i><b>${escapeHtml(s.kurz)}</b><small>${pct(s.chance)} %</small></span>`).join("")}</div>`;
  }

  function render() {
    if (!stand) return;
    renderSerienlotterie();
    const chips = (window.Casino.getAccount() || {}).chips || 0;
    $("#ki-liste").innerHTML = stand.kisten.map((k) => {
      const wartet = k.frei && k.wiederAb > Date.now();
      const zuTeuer = !k.frei && chips < k.preis;
      const gesperrt = wartet || zuTeuer;
      const rest = wartet ? k.wiederAb - Date.now() : 0;
      const stunden = Math.ceil(rest / 3600000);
      const knopfText = wartet
        ? (rest < 3600000 ? `Wieder in ${Math.max(1, Math.ceil(rest / 60000))} Minuten`
                          : `Wieder in ${stunden} ${stunden === 1 ? "Stunde" : "Stunden"}`)
        : zuTeuer ? `Dir fehlen ${fmt(k.preis - chips)}`
        : k.frei ? "Kostenlos öffnen"
        : `Öffnen für ${fmt(k.preis)}`;
      const top = beste(k);
      return `<div class="ki-karte ki-karte-${escapeHtml(k.id)}${gesperrt ? " arm" : ""}${k.frei ? " gratis" : ""}${k.limitiert ? " limitiert" : ""}" style="--top:${top.farbe}">
        ${k.limitiert ? `<div class="ki-limit">Nur noch ${restLauf(k.bis)}</div>` : ""}
        <button class="ki-kopf-knopf" data-inhalt="${k.id}" type="button"
          aria-label="Was ist in der ${escapeHtml(k.label)}?">
        <div class="ki-kopf">
          <span class="ki-bild-halter">
            <img class="ki-bild" src="/assets/kisten/${encodeURIComponent(k.id)}.png" alt="" loading="lazy" decoding="async">
          </span>
          <div class="ki-kopf-text">
            <span class="ki-top">bis ${escapeHtml(top.label)}${k.stueckzahl && k.limitiert ? ` · ${k.stueckzahl} eigene Stücke` : ""}</span>
            <b>${escapeHtml(k.label)}</b>
            <span class="muted small">${escapeHtml(k.text)}</span>
          </div>
        </div>
        ${chancenLeiste(k)}
        <span class="ki-mehr">Antippen: was ist drin?</span>
        </button>
        <button class="btn-primary ki-knopf" data-oeffne="${k.id}" ${gesperrt ? "disabled" : ""}>
          ${knopfText}${k.frei || gesperrt ? "" : "<i class=mk></i>"}
        </button>
      </div>`;
    }).join("");

    /* Die Legende zaehlt den DAUERHAFTEN Vorrat. Eine limitierte Kiste
       bringt ihren eigenen mit, und die Zahlen hier zusammenzuwerfen
       hiesse, nach dem Stichtag stillschweigend kleiner zu werden. */
    const limits = stand.kisten.filter((k) => k.limitiert);
    $("#ki-stufen").innerHTML = `<div class="ki-legende">`
      + stand.stufen.map((s) => `<span><i style="background:${s.farbe}"></i>${escapeHtml(s.label)} <b>${s.anzahl}</b></span>`).join("")
      + `</div><p class="muted small" style="margin:6px 0 0">`
      + (limits.length
        ? `So viele Stücke gibt es dauerhaft. Dazu kommt, was nur in einer limitierten Kiste steckt: `
          + `${limits.map((k) => `${k.stueckzahl} in der ${escapeHtml(k.label)}`).join(", ")}. `
        : "")
      + `Doppelte Funde werden zu Prägestaub. Damit prägst du in der Sammlung einen der drei wechselnden Wochenpreise. `
      + `Alles Neue lässt sich auf dem Markt weitergeben.</p>`;
  }

  /** Ein Feld auf der Bahn. Gleiche Vorschau wie im Laden und auf dem Markt. */
  function feld(f, treffer) {
    return `<div class="ki-feld${treffer ? " treffer" : ""}" style="--stufe:${(f.stufe && f.stufe.farbe) || "#9aa4ae"}">
      <div class="ki-feld-demo">${window.Casino.spieler.kosVorschau(f.look, { name: (window.Casino.getAccount() || {}).name || "Du" })}</div>
      <div class="ki-feld-name">${escapeHtml(f.label || "")}</div>
    </div>`;
  }

  /* Wie laut eine Stufe sein darf. Eine Holzkiste mit einem 20.000er Avatar
     soll nicht dasselbe Feuerwerk bekommen wie ein Einzelstueck, sonst ist
     das Feuerwerk nach dem dritten Mal nichts mehr wert. */
  const WUCHT = { gewoehnlich: 0, selten: 1, episch: 2, legendaer: 3, mythisch: 4, kiste: 5 };
  const SERIEN_WUCHT = { standard: 0, glueck: 2, gold: 4, jackpot: 6 };

  const overlay = () => $("#ki-overlay");
  const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduziert = () => document.documentElement.classList.contains("reduce-motion");

  /**
   * Die ganze Ziehung, von vorne bis zum Ergebnis.
   *
   * Der Treffer steht fest, bevor sich irgendetwas bewegt: der Server hat
   * ihn schon gezogen und mitgeschickt. Was hier passiert, ist ausschliesslich
   * Anschauung, und sie laeuft in drei Abschnitten.
   *
   *   AUFBAU    Die Kiste steht allein im Bild und fängt an zu zittern. Das
   *             sind anderthalb Sekunden, in denen nichts passiert, und
   *             genau die machen den Unterschied: ohne sie beginnt die Bahn
   *             aus dem Nichts und es gibt keinen Moment davor.
   *   BAHN      Die Rolle faehrt aus, lange auslaufend, und die Marke in der
   *             Mitte entscheidet.
   *   LANDUNG   Blitz in der Farbe der Stufe, danach die Karte.
   *
   * Bei "Bewegung reduzieren" faellt alles davon weg und das Ergebnis steht
   * sofort da. Dieselbe Ziehung, nur ohne Show.
   */
  async function zeigeZiehung(res) {
    const ov = overlay();
    const wucht = Math.max(WUCHT[res.stufe.id] ?? 0, SERIEN_WUCHT[res.treffer.serie && res.treffer.serie.id] || 0);
    ov.style.setProperty("--stufe", res.stufe.farbe);
    ov.style.setProperty("--serie", (res.treffer.serie && res.treffer.serie.farbe) || res.stufe.farbe);
    ov.dataset.wucht = String(wucht);
    ov.dataset.serie = (res.treffer.serie && res.treffer.serie.id) || "standard";
    ov.classList.remove("hidden");
    document.body.classList.add("ki-offen");
    $("#ki-ergebnis").classList.add("hidden");
    $("#ki-strahlen").className = "ki-strahlen";
    $("#ki-blitz").className = "ki-blitz";
    $("#ki-wasch").className = "ki-wasch";

    if (reduziert()) {
      $("#ki-aufbau").classList.add("hidden");
      $("#ki-phase-bahn").classList.add("hidden");
      ergebnis(res);
      return;
    }

    /* Die Dauer kommt vom Server. Nicht aus Ordnungsliebe: der Server
       wartet mit der Ansage im Chat genau so lange, wie das hier laeuft,
       und wenn die beiden Zahlen auseinanderlaufen, steht das Ergebnis
       wieder im Chat, bevor die Kiste aufgegangen ist. */
    const schau = res.schau || { aufbau: 1250, platzen: 260, bahn: 4900, rollen: 950, halten: 620, landung: 300 };

    /*
     * Die Bahn wird JETZT gebaut, nicht erst nach dem Zittern.
     *
     * Achtundzwanzig Felder mit echten Vorschauen kosten den Browser
     * messbar Zeit (auf einem langsamen Geraet ueber zwei Sekunden), und
     * die lagen vorher als Stillstand zwischen dem Platzen der Kiste und
     * dem Losfahren der Bahn. Waehrend die Kiste zittert, ist der
     * Bildschirm ohnehin beschaeftigt und die Bahn noch verdeckt — da
     * kostet der Aufbau nichts.
     */
    baueBahn(res);

    // AUFBAU
    $("#ki-aufbau").classList.remove("hidden");
    const kiste = $("#ki-kiste-gross");
    kiste.innerHTML = `<img src="/assets/kisten/${encodeURIComponent(res.kiste.id)}.png" alt="">`;
    kiste.className = "ki-kiste-gross zittert";
    kiste.style.setProperty("--aufbau", `${schau.aufbau}ms`);
    $("#ki-aufbau-text").textContent = res.kiste.label;
    window.Casino.sound?.play("chip");
    await schlafe(schau.aufbau);
    kiste.classList.add("platzt");
    window.Casino.sound?.play("deal");
    await schlafe(schau.platzen);
    $("#ki-aufbau").classList.add("hidden");

    // BAHN
    const phase = $("#ki-phase-bahn");
    phase.classList.remove("hidden", "wartet", "verblasst");
    /* Die Tempo-Klassen sitzen am RAHMEN, nicht an der Phase: dort liegt
       die Marke, dort liegt der Kegel, und dort greifen die Regeln. Sie
       hier an die Phase zu haengen war ein Fehler — `.ki-bahn-rahmen.steht`
       hat nie getroffen, und dass es trotzdem aussah wie gewollt, lag nur
       daran, dass `langsam` stehenblieb. */
    const rahmen = phase.querySelector(".ki-bahn-rahmen");
    rahmen.classList.remove("schnell", "langsam", "rollt", "einschlag", "steht");
    await fahre(res, schau);

    /*
     * HALTEN. Die Bahn steht, der Treffer liegt unter der Marke, und eine
     * halbe Sekunde lang passiert nichts.
     *
     * Das ist die teuerste halbe Sekunde der ganzen Schau und die billigste
     * zu bauen. Vorher sprang die Karte im selben Moment auf, in dem die
     * Bahn stehenblieb, und nahm sich damit ihren eigenen Moment weg: man
     * hat gar nicht gesehen, WAS unter der Marke liegt, bevor schon das
     * Ergebnis daneben stand.
     */
    rahmen.classList.remove("schnell", "langsam");
    rahmen.classList.add("steht");
    const treffer = phase.querySelector(".ki-feld.treffer");
    if (treffer) treffer.classList.add("gefunden");
    if (!reduziert()) {
      window.Casino.sound?.play("select");
      await schlafe(schau.halten || 620);
    }

    // LANDUNG. Die Bahn hat ihre Arbeit getan und tritt zurueck, statt neben
    // dem Ergebnis stehen zu bleiben und ihm den Platz wegzunehmen.
    phase.classList.add("verblasst");
    ergebnis(res);
  }

  /**
   * Die Fahrt.
   *
   * Es wird nur so weit nach links geschoben, dass der Treffer unter der
   * Marke landet, mit einer Kurve, die schnell anfängt und lange ausläuft.
   * Der kleine Versatz am Ende ist Absicht: immer exakt mittig zu stoppen
   * sieht gerechnet aus.
   */
  /**
   * Die Felder anlegen und auf Anfang stellen.
   *
   * Hier wird NICHT gemessen, und das ist wichtig genug fuer einen eigenen
   * Absatz. Ich hatte die Breite hier abgenommen und fuer `fahre()`
   * gemerkt, und damit einen Fehler gebaut, der genau ab der ZWEITEN
   * Ziehung zuschlug: nach der ersten bleibt `verblasst` an der Phase
   * stehen, und das ist ein `scale(0.9)`. Ein Feld misst sich dann als
   * 118,8 statt 132 Pixel. Auf 38 Felder gerechnet fehlen damit rund 500
   * Pixel, also dreieinhalb Felder — die Bahn hielt vor einem voellig
   * anderen Stueck, obwohl gezogen und angezeigt das richtige wurde.
   *
   * Gemessen wird deshalb erst in `fahre()`, wenn die Phase nachweislich
   * sauber ist. Das kostet ein bis drei Millisekunden; der Grund, aus dem
   * ich es hierher vorgezogen hatte, war ohnehin eine Fehlmessung.
   */
  function baueBahn(res) {
    const bahn = $("#ki-bahn");
    const phase = $("#ki-phase-bahn");
    phase.classList.remove("hidden", "verblasst");
    phase.classList.add("wartet");
    bahn.style.transition = "none";
    bahn.style.transform = "translate3d(0,0,0)";
    bahn.innerHTML = res.rolle.felder.map((f, i) => feld(f, i === res.rolle.trefferIndex)).join("");
  }

  /**
   * Die Fahrt: erst knapp davor halten, dann VORWAERTS in die Mitte.
   *
   * Die Bahn hielt urspruenglich irgendwo im Trefferfeld an. Der Platz war
   * absichtlich zufaellig, weil immer exakt mittig zu stoppen gerechnet
   * aussieht — nur war der Zufall zu gross: bis zu 41 Pixel neben der
   * Feldmitte, bei einem 132 Pixel breiten Feld und nur 10 Pixel Abstand
   * zum naechsten. Die Marke stand dann dicht an der Kante, und mit einer
   * Kiste, in der dasselbe Stueck mehrfach auf der Rolle liegt, sah das
   * aus, als haette sie auf dem Nachbarn gehalten.
   *
   * Der zweite Anlauf fuhr deshalb ZU WEIT und rollte zurueck. Zurueck ist
   * erlaubt — aber nur, solange der Halt noch auf dem TREFFERFELD liegt.
   * Sobald die Bahn weit genug faehrt, dass das NACHBARfeld unter der
   * Marke steht, glaubt man eine Sekunde lang, dieses Stueck bekommen zu
   * haben, und das Zurueckrollen nimmt es einem wieder weg. Ein Beinahe
   * darf nicht wie ein Entzug aussehen.
   *
   * Deshalb zwei Spielarten, je zur Haelfte:
   *
   *   ZURUECK  Die Bahn faehrt ein Stueck ueber die Mitte und rollt
   *            zurueck. Der Ueberschuss bleibt INNERHALB des Trefferfelds
   *            (hoechstens 57 von 66 Pixeln bis zu dessen Kante) — es ist
   *            also nie ein fremdes Stueck zu sehen, das danach
   *            verschwindet.
   *
   *   VORWAERTS Die Bahn haelt kurz DAVOR, manchmal noch ein paar Pixel
   *            auf dem VORIGEN Feld, und kriecht dann weiter auf die
   *            Mitte. Hier darf das Nachbarfeld zu sehen sein: man denkt,
   *            man haette das davor erwischt, und bekommt dann doch das
   *            dahinter. Das ist ein Gewinn, kein Entzug.
   *
   * Die Richtung des Beinahe entscheidet also, ob es sich gut anfuehlt.
   */
  function fahre(res, schau) {
    return new Promise((fertig) => {
      const bahn = $("#ki-bahn");
      const rahmen = bahn.parentElement;

      /*
       * Gemessen wird im LAYOUT, nicht auf dem Bildschirm.
       *
       * `getBoundingClientRect()` liefert die sichtbare Groesse, also die
       * nach allen Transformationen der Eltern. Und genau darueber bin ich
       * gestolpert: nach einer Ziehung bleibt `verblasst` an der Phase
       * stehen, das ist ein `scale(0.9)`, und beim Entfernen laeuft ein
       * halbsekuendiger Uebergang zurueck auf 1. Wer in dieser halben
       * Sekunde misst, bekommt irgendetwas zwischen 118,8 und 132 Pixeln.
       * Auf 38 Felder gerechnet sind das bis zu 500 Pixel Fehler, also
       * dreieinhalb Felder: die Bahn hielt vor einem ganz anderen Stueck,
       * obwohl gezogen und angezeigt das richtige wurde. Mal ging es gut,
       * mal nicht, je nachdem wie der Uebergang gerade stand.
       *
       * `offsetWidth`, `clientWidth` und `offsetLeft` kennen keine
       * Transformationen. Sie liefern immer dieselben Zahlen, und der Wert,
       * den wir am Ende setzen (`translate3d`), rechnet in genau diesen
       * Einheiten.
       */
      const erstes = bahn.querySelector(".ki-feld");
      const breite = (erstes && erstes.offsetWidth) || FELD_FALLBACK;
      const luecke = parseFloat(getComputedStyle(bahn).gap) || 0;
      const schritt = breite + luecke;
      const mitte = rahmen.clientWidth / 2;
      /* Wo die Bahn anfaengt, gemessen von derselben Kante wie `mitte`.
         `offsetLeft` ist laut CSSOM bereits ab der POLSTERKANTE des
         offsetParent gemessen, und `clientWidth` spannt genau dieselbe
         Box — die Rahmenlinie steckt also in keiner der beiden Zahlen.
         Ich hatte hier zusaetzlich `- clientLeft` stehen und damit die
         Rahmenlinie ein zweites Mal abgezogen: die Karte stand danach
         exakt einen Pixel neben der Marke. Ein Pixel sieht man, wenn
         beides daneben still steht. */
      const randVersatz = bahn.offsetLeft;
      const genau = -(res.rolle.trefferIndex * schritt) + mitte - breite / 2 - randVersatz;
      /* Der Halt vor dem Nachlauf, als Abstand zur Feldmitte.
         Vorwaerts (negativ): 48 bis 85 Pixel davor. Die halbe Feldbreite
         sind 66, bis zur Kante des vorigen Felds kommen 10 Pixel Luecke
         dazu — im oberen Drittel haengt die Marke also ein paar Pixel auf
         dem Vorgaenger, und genau das ist gewollt.
         Zurueck (positiv): 26 bis 57 Pixel dahinter, immer diesseits der
         66er-Kante. Das Trefferfeld bleibt die ganze Zeit unter der
         Marke, es verschwindet nichts. */
      /* Der Halt bleibt AUF DER TREFFERKARTE, in beide Richtungen.
         Gerechnet wird deshalb gegen die Kartenbreite und nicht gegen den
         Schritt: die Karte ist 132 Pixel breit, ihre Kante liegt also 66
         Pixel von der Mitte weg, und mehr als 0,43 Kartenbreiten (57
         Pixel) darf der Halt nie daneben liegen.

         Vorher ging der Vorwaerts-Zweig bis 85 Pixel und hielt damit auf
         dem Feld DAVOR. Das war ausdruecklich so gebaut — und ist
         trotzdem falsch: worauf die Bahn sichtbar stehenbleibt, darauf
         muss sie auch einrasten. Alles andere ist ein Karteneinsatz, den
         man erst glaubt und dann doch nicht bekommt.

         Das Vorzeichen fuehlt sich verkehrt an: ein GROESSERES x schiebt
         die Bahn nach rechts, die Marke zeigt also auf ein FRUEHERES
         Feld. Ein Halt vor der Mitte ist damit positiv, einer dahinter
         negativ. */
      const weit = breite * (0.2 + Math.random() * 0.23);   // 26 bis 57 Pixel
      const versatz = Math.random() < 0.5 ? weit : -weit;

      const lauf = (schau.bahn || 4900) / 1000;
      const rollen = (schau.rollen || 950) / 1000;

      // Ein Bild abwarten, sonst fasst der Browser Aufbau und Fahrt zusammen
      // und es gibt gar keine Bewegung.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bahn.style.transition = `transform ${lauf}s cubic-bezier(.08,.72,.11,1)`;
        bahn.style.transform = `translate3d(${genau + versatz}px,0,0)`;
        ticker(lauf);
        rahmen.classList.add("schnell");
        /* Ab drei Vierteln kriecht die Bahn nur noch. Das sieht man an der
           Kurve, aber man MERKT es erst, wenn die Marke mitgeht: sie waechst,
           leuchtet, und das Feld darunter bekommt einen Kegel. */
        setTimeout(() => { rahmen.classList.remove("schnell"); rahmen.classList.add("langsam"); }, lauf * 1000 * 0.72);

        // Der Nachlauf auf die genaue Mitte, vorwaerts oder zurueck.
        setTimeout(() => {
          rahmen.classList.add("rollt");
          bahn.style.transition = `transform ${rollen}s cubic-bezier(.32,.96,.34,1)`;
          bahn.style.transform = `translate3d(${genau}px,0,0)`;
          window.Casino.sound?.play("tick");
        }, lauf * 1000 + 120);

        // Aufgesetzt.
        setTimeout(() => {
          rahmen.classList.remove("rollt");
          rahmen.classList.add("einschlag");
          window.Casino.sound?.play("select");
          setTimeout(() => rahmen.classList.remove("einschlag"), 700);
          fertig();
        }, lauf * 1000 + 120 + rollen * 1000);
      }));
    });
  }

  /* Das Klacken beim Vorbeiziehen. Wird seltener, so wie die Bahn langsamer
     wird; ein gleichmaessiges Ticken wuerde gegen die Kurve arbeiten. */
  function ticker(sekunden) {
    const start = performance.now();
    const dauer = sekunden * 1000;
    const schlag = () => {
      const t = (performance.now() - start) / dauer;
      if (t >= 1) return;
      window.Casino.sound?.play("tick");
      setTimeout(schlag, 52 + 560 * Math.pow(t, 3));
    };
    setTimeout(schlag, 60);
  }

  /** Blitz, Strahlen und die Karte. Alles nach Stufe abgestuft. */
  function ergebnis(res) {
    const ov = overlay();
    const wucht = Math.max(WUCHT[res.stufe.id] ?? 0, SERIEN_WUCHT[res.treffer.serie && res.treffer.serie.id] || 0);
    const t = res.treffer;

    if (!reduziert()) {
      $("#ki-blitz").className = "ki-blitz an";
      if (wucht >= 3) {
        $("#ki-strahlen").className = "ki-strahlen an";
        /* Der ganze Bildschirm in der Farbe der Stufe. Der Blitz allein sass
           in der Mitte und war bei einem Einzelstueck zu wenig. */
        $("#ki-wasch").className = "ki-wasch an";
        ov.classList.add("beben");
        setTimeout(() => ov.classList.remove("beben"), 620);
      }
    }

    const erg = $("#ki-ergebnis");
    /* In Stufen: erst der Stempel mit der Seltenheit, dann das Stueck, dann
       der Name. Alles auf einmal ist eine Karte, nacheinander ist eine
       Enthuellung — und die Reihenfolge stimmt auch inhaltlich, die Stufe
       ist das, was man zuerst wissen will. */
    erg.innerHTML = `
      <div class="ki-erg-karte stufig">
        <span class="ki-erg-stufe">${escapeHtml(res.stufe.label)}</span>
        <div class="ki-erg-demo">${window.Casino.spieler.kosVorschau(t.look, { name: (window.Casino.getAccount() || {}).name || "Du" })}</div>
        <div class="ki-erg-name">${escapeHtml(t.label)}</div>
        <div class="ki-erg-art">${escapeHtml((t.look && t.look.artName) || "")}</div>
        ${res.neu && t.nr ? `<div class="ki-erg-serie serie-${escapeHtml((t.serie && t.serie.id) || "standard")}">
          <span>Serienprägung</span><b>#${escapeHtml(window.Casino.spieler.serienCode(t))}</b>
          <strong>${escapeHtml((t.serie && t.serie.label) || "Klassische Serie")}</strong>
          <small>${pct((t.serie && t.serie.chance) || 90)} % aller neuen Exemplare</small>
        </div>` : ""}
        <div class="ki-erg-zeile">${res.neu
          ? `<b class="pos">Neu für dich.</b> Liegt in deiner Sammlung.`
          : `Hattest du schon. <b>+${fmt(res.staub)}</b><span class="staub-symbol">✦</span> Prägestaub.</div>`}
        <div class="ki-erg-knoepfe">
          <button class="btn-secondary" data-schliessen>Fertig</button>
          ${/* Bei der Gratiskiste gibt es kein "noch eine": sie ist gerade
                erst gesperrt worden. Ein Knopf mit "Noch eine · 0", der dann
                eine Absage bringt, ist schlimmer als kein Knopf. */
            res.kiste.frei ? "" :
            `<button class="btn-primary" data-nochmal="${res.kiste.id}">Noch eine · ${fmt(res.kiste.preis)}<i class=mk></i></button>`}
        </div>
      </div>`;
    erg.classList.remove("hidden");
    laeuft = false;
    meldeFertig();

    window.Casino.sound?.play(wucht >= 3 ? "bigwin" : res.neu ? "win" : "cash");
    /* Der gekaufte Gewinn-Effekt des Spielers, aber nur oben. Bei jeder
       Holzkiste Konfetti zu werfen macht den Effekt wertlos, und der ist
       selbst ein Kosmetikstueck. */
    if (wucht >= 3 && !reduziert()) {
      try { window.Casino.fx?.spieleGewinnEffekt({ stufe: wucht >= 5 ? 3 : 2 }); } catch {}
    }
  }

  function schliesse() {
    $("#ki-phase-bahn")?.classList.add("hidden");
    $("#ki-phase-bahn")?.classList.remove("wartet");
    overlay().classList.add("hidden");
    document.body.classList.remove("ki-offen");
    $("#ki-ergebnis").classList.add("hidden");
    load();
  }

  /* Die Kennung der laufenden Ziehung. Damit sagt der Client dem Server,
     wann die Schau wirklich vorbei ist — der hat es vorher gerechnet, und
     auf einem langsamen Geraet stand die Ansage im Chat, bevor die Kiste
     offen war. */
  let zugId = null;
  socket.on("kiste:zug", ({ zugId: id } = {}) => { zugId = id || null; });

  function meldeFertig() {
    if (!zugId) return;
    socket.emit("kiste:fertig", { zugId });
    zugId = null;
  }

  function oeffne(id) {
    if (laeuft) return;
    laeuft = true;
    zugId = null;
    socket.emit("kiste:oeffne", { id }, (res) => {
      if (!res || !res.ok) { laeuft = false; return toast((res && res.error) || "Ging nicht."); }
      applyAccount(res.account);
      zeigeZiehung(res);
    });
  }

  document.addEventListener("click", (e) => {
    const auf = e.target.closest("[data-oeffne]");
    if (auf) { oeffne(auf.dataset.oeffne); return; }
    const info = e.target.closest("[data-inhalt]");
    if (info) { zeigeInhalt(info.dataset.inhalt); return; }
    const jetzt = e.target.closest("[data-inhalt-auf]");
    if (jetzt) {
      const id = jetzt.dataset.inhaltAuf;
      kbOverlay().classList.add("hidden");
      document.body.classList.remove("ki-offen");
      oeffne(id);
      return;
    }
    const nochmal = e.target.closest("[data-nochmal]");
    if (nochmal) { $("#ki-ergebnis").classList.add("hidden"); oeffne(nochmal.dataset.nochmal); return; }
    if (e.target.closest("[data-schliessen]")) schliesse();
  });
  /* ------------------------------------------------------------------
     Was ist in der Kiste?

     Die Chancen standen bisher nur als Stufen an der Kachel ("21 %
     episch"), und das beantwortet die eigentliche Frage nicht: WAS ist
     episch? Wer gezielt etwas sucht — fuer eine Kollektion oder weil ihm
     genau ein Stueck fehlt — muss sehen koennen, wo es ueberhaupt drin
     ist. Was man schon hat, steht blass daneben: die zweite Frage ist
     immer, was einem hier noch fehlt.
     ------------------------------------------------------------------ */
  function zeigeInhalt(id) {
    socket.emit("kiste:inhalt", { id }, (r) => {
      if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
      const k = r.kiste;
      const fehlt = k.stufen.reduce((n, s) => n + s.stuecke.filter((x) => !x.hat).length, 0);
      const gesamt = k.stufen.reduce((n, s) => n + s.stuecke.length, 0);
      $("#kb-inhalt").innerHTML = `
        <div class="kin">
          <div class="kin-kopf">
            <img src="/assets/kisten/${encodeURIComponent(k.id)}.png" alt="">
            <div>
              <b>${escapeHtml(k.label)}</b>
              <span class="muted small">${escapeHtml(k.text)}</span>
              ${k.limitiert ? `<span class="kin-limit">Nur noch ${restLauf(k.bis)} · danach entsteht keins dieser Stücke mehr</span>` : ""}
              <span class="kin-zahl">${fehlt} von ${gesamt} fehlen dir noch</span>
            </div>
          </div>
          ${k.stufen.map((s) => `
            <div class="kin-stufe" style="--stufe:${s.farbe}">
              <div class="kin-stufe-kopf">
                <b>${escapeHtml(s.label)}</b>
                <span>${s.pct} % · ${s.stuecke.length} ${s.stuecke.length === 1 ? "Stück" : "Stücke"} · je ${s.jeStueck.toFixed(s.jeStueck < 1 ? 2 : 1)} % · doppelt +${fmt((k.staub && (k.frei ? k.staub.frei : k.staub.werte[s.id])) || 0)} ✦</span>
              </div>
              <div class="kin-liste">
                ${s.stuecke.map((x) => `
                  <div class="kin-stueck${x.hat ? " hat" : ""}">
                    <span class="kin-demo">${window.Casino.spieler.kosVorschau(x.look, { name: acc().name || "Du" })}</span>
                    <b>${escapeHtml((x.look && x.look.label) || x.label)}</b>
                    <small>${escapeHtml((x.look && x.look.artName) || "")}</small>
                    ${x.hat ? `<span class="kin-hat">hast du</span>` : ""}
                  </div>`).join("")}
              </div>
            </div>`).join("")}
          <p class="muted small kin-fuss">
            Was du schon hast, wird zu Prägestaub. Den gibst du in der Sammlung für wechselnde Wochenpreise aus.
          </p>
          <div class="ki-erg-knoepfe">
            <button class="btn-secondary" data-kb-zu>Zurück</button>
            ${k.frei || (acc().chips || 0) < k.preis ? "" :
              `<button class="btn-primary" data-inhalt-auf="${k.id}">Öffnen für ${fmt(k.preis)}<i class=mk></i></button>`}
          </div>
        </div>`;
      kbOverlay().classList.remove("hidden");
      kbOverlay().dataset.modus = "inhalt";
      document.body.classList.add("ki-offen");
    });
  }
  /* ==================================================================
     Kisten-Duelle, live

     Server: game/kistenDuell.js. Zwei Zahlen, und sie bedeuten
     Verschiedenes: der EINSATZ sind echte Chips und darum wird gespielt,
     das BUDGET ist nur die Grenze beim Zusammenstellen und kostet nichts.
     Die gezogenen Stuecke gehoeren niemandem, ihr Wert ist die Augenzahl.
     ================================================================== */

  let dstand = null;          // { duelle, kisten, maxKisten, minEinsatz, ... }
  let bau = null;             // { einsatz, budget, gewaehlt: [], id?, schritt }
  let offenesDuell = null;    // das Duell, das gerade im Vollbild laeuft

  const kbOverlay = () => $("#kb-overlay");

  function ladeDuelle() {
    socket.emit("kdl:state", (r) => {
      if (!r || !r.ok) return;
      dstand = r;
      rendereDuelle();
    });
  }

  /* ------------------------------------------------------------------
     Die Liste
     ------------------------------------------------------------------ */

  const restZeit = (bis) => {
    const ms = bis - Date.now();
    if (ms <= 0) return "läuft ab";
    const min = Math.max(1, Math.round(ms / 60000));
    return `noch ${min} ${min === 1 ? "Minute" : "Minuten"}`;
  };

  /** Die Kisten eines Spielers als Bilderreihe. Sagt mehr als "5 Kisten". */
  function kistenReihe(liste, klasse = "kd-kisten") {
    return `<div class="${klasse}">` + liste.map((k) =>
      `<img src="/assets/kisten/${encodeURIComponent(k.id)}.png" alt="" title="${escapeHtml(k.label)}" loading="lazy">`
    ).join("") + `</div>`;
  }

  function rendereDuelle() {
    const el = $("#kd-liste");
    if (!el || !dstand) return;
    const chips = acc().chips || 0;
    const alle = dstand.duelle || [];

    const karte = (d) => {
      const laeuft = d.status === "laeuft";
      const ersteller = d.spieler[0] || {};
      const knopf = laeuft
        ? `<button class="btn-secondary" data-kd-zusehen="${d.id}">${d.meins ? "Zurück ins Duell" : "Zusehen"}</button>`
        : d.meins
          ? `<button class="btn-secondary" data-kd-ab="${d.id}">Abbrechen, Einsatz zurück</button>`
          : `<button class="btn-primary" data-kd-bei="${d.id}" ${chips < d.einsatz ? "disabled" : ""}>
               ${chips < d.einsatz ? `Dir fehlen ${fmt(d.einsatz - chips)}` : `Mitmachen für ${fmt(d.einsatz)}`}<i class=mk></i></button>`;
      const wer = d.spieler.map((s) =>
        `<span class="kd-teilnehmer">${window.Casino.spieler.chip(s.look ? { ...s.look, name: s.name } : { name: s.name })}</span>`
      ).join(`<span class="kd-gegen">gegen</span>`);
      return `<div class="kd-karte${laeuft ? " laeuft" : ""}${d.meins ? " meins" : ""}">
        <div class="kd-kopf">
          <span class="kd-einsatz">${fmt(d.einsatz)}<i class=mk></i></span>
          <span class="kd-status">${laeuft ? `Runde ${Math.min(d.runde + 1, d.runden)} von ${d.runden}` : restZeit(d.bisAt)}</span>
        </div>
        <div class="kd-unter">${fmt(d.budget)} Budget · Sieger ${fmt(d.topf)}<i class=mk></i></div>
        ${kistenReihe(ersteller.kisten || [])}
        <div class="kd-wer">${wer}${d.spieler.length < 2 ? `<span class="kd-gegen">gegen</span><span class="kd-leer">wartet</span>` : ""}</div>
        ${knopf}
      </div>`;
    };

    const offen = alle.filter((d) => d.status === "offen");
    const laufend = alle.filter((d) => d.status === "laeuft");
    let html = "";
    if (laufend.length) html += `<div class="cd-sub">Läuft gerade</div>` + laufend.map(karte).join("");
    if (offen.length) html += `<div class="cd-sub">Wartet auf einen Gegner</div>` + offen.map(karte).join("");
    if (!html) {
      html = `<div class="mkt-leer">${window.Casino.icons.ui("krieg")}
        <b>Gerade läuft keins</b>
        <span>Mach eins auf. Solange niemand mitmacht, kostet es nichts.</span></div>`;
    }
    el.innerHTML = html;

    const knopf = document.querySelector('[data-ki-tab="duelle"]');
    if (knopf) {
      let marke = knopf.querySelector(".ki-reiter-marke");
      const n = alle.length;
      if (!n) { if (marke) marke.remove(); }
      else {
        if (!marke) { marke = document.createElement("i"); knopf.appendChild(marke); }
        marke.className = "ki-reiter-marke" + (laufend.length ? " dran" : "");
        marke.textContent = String(n);
      }
    }
  }

  /* ------------------------------------------------------------------
     Aufmachen: erst die Zahlen, dann die Kisten

     Zwei Schritte, weil es zwei verschiedene Entscheidungen sind. Wie viel
     man riskiert, hat mit dem eigenen Konto zu tun; was man aufmacht, mit
     der Frage, wie man spielen will. Beides in ein Formular zu werfen
     hiesse, dass man die zweite trifft, bevor man die erste verstanden hat.
     ------------------------------------------------------------------ */

  const ausgegeben = (gewaehlt) =>
    gewaehlt.reduce((n, id) => n + (dstand.kisten.find((k) => k.id === id)?.preis || 0), 0);

  function zeigeBau(vorlage) {
    if (!dstand) return;
    bau = vorlage || { schritt: "zahlen", einsatz: Math.min(dstand.minEinsatz * 10, acc().chips || 0), budget: dstand.minBudget * 5, gewaehlt: [] };
    zeichneBau();
    kbOverlay().classList.remove("hidden");
    kbOverlay().dataset.modus = "bau";
    document.body.classList.add("ki-offen");
  }

  /** Ein paar Vorschläge. Anklicken setzt das Feld, tippen geht weiter. */
  function vorschlaege(feld, werte, max) {
    return `<div class="kb-schnell">` + werte.filter((w) => w <= max).map((w) =>
      `<button type="button" data-kb-setz="${feld}" data-wert="${w}"${bau[feld] === w ? ' class="an"' : ""}>${fmt(w)}</button>`
    ).join("") + `</div>`;
  }

  function zeichneBau() {
    if (bau.schritt === "kisten") return zeichneKistenwahl();
    const chips = acc().chips || 0;
    const maxE = Math.min(dstand.maxEinsatz, chips);
    const gueltig = bau.einsatz >= dstand.minEinsatz && bau.einsatz <= maxE
      && bau.budget >= dstand.minBudget && bau.budget <= dstand.maxBudget;
    $("#kb-inhalt").innerHTML = `
      <div class="kb-bau">
        <div class="kb-schritte"><span class="an">1 Zahlen</span><i></i><span>2 Kisten</span></div>

        <label class="kb-eingabe">
          <span class="kb-eingabe-kopf"><b>Einsatz</b><small>echte Chips</small></span>
          <input type="number" inputmode="numeric" id="kb-einsatz" value="${bau.einsatz}"
            min="${dstand.minEinsatz}" max="${maxE}" step="1000">
          <small class="kb-eingabe-fuss">bis ${fmt(maxE)} · Sieger bekommt ${fmt(Math.round(bau.einsatz * 2 * (1 - dstand.rake)))}</small>
        </label>
        ${vorschlaege("einsatz", [10000, 50000, 250000, 1000000], maxE)}

        <label class="kb-eingabe">
          <span class="kb-eingabe-kopf"><b>Budget</b><small>kostet nichts</small></span>
          <input type="number" inputmode="numeric" id="kb-budget" value="${bau.budget}"
            min="${dstand.minBudget}" max="${dstand.maxBudget}" step="10000">
          <small class="kb-eingabe-fuss">bis ${fmt(dstand.maxBudget)} · beide gleich, max ${dstand.maxKisten} Kisten</small>
        </label>
        ${vorschlaege("budget", [150000, 600000, 2000000, dstand.maxBudget], dstand.maxBudget)}

        <div class="ki-erg-knoepfe">
          <button class="btn-secondary" data-kb-zu>Abbrechen</button>
          <button class="btn-primary" data-kb-weiter ${gueltig ? "" : "disabled"}>Weiter</button>
        </div>
      </div>`;
  }

  function zeichneKistenwahl() {
    const summe = ausgegeben(bau.gewaehlt);
    const rest = bau.budget - summe;
    const beitritt = !!bau.id;
    $("#kb-inhalt").innerHTML = `
      <div class="kb-bau">
        <div class="kb-schritte">${beitritt ? "" : `<span>1 Zahlen</span><i></i>`}<span class="an">${beitritt ? "" : "2 "}Kisten</span></div>
        <h3>Was machst du auf?</h3>
        <div class="kb-rest"><b>${fmt(rest)}</b> von ${fmt(bau.budget)} übrig · ${bau.gewaehlt.length}/${dstand.maxKisten}</div>
        <div class="kb-bau-liste">
          ${dstand.kisten.map((k) => {
            const n = bau.gewaehlt.filter((x) => x === k.id).length;
            const passt = bau.gewaehlt.length < dstand.maxKisten && rest >= k.preis;
            return `<div class="kb-bau-zeile">
              <img src="/assets/kisten/${encodeURIComponent(k.id)}.png" alt="">
              <div class="kb-bau-text"><b>${escapeHtml(k.label)}</b><span class="muted small">${fmt(k.preis)}</span></div>
              <div class="kd-zaehler">
                <button data-kb-minus="${k.id}" ${n ? "" : "disabled"}>−</button>
                <b>${n}</b>
                <button data-kb-plus="${k.id}" ${passt ? "" : "disabled"}>+</button>
              </div>
            </div>`;
          }).join("")}
        </div>
        <div class="ki-erg-knoepfe">
          <button class="btn-secondary" data-kb-zurueck>${beitritt ? "Doch nicht" : "Zurück"}</button>
          <button class="btn-primary" data-kb-los ${bau.gewaehlt.length ? "" : "disabled"}>
            ${bau.gewaehlt.length
              ? (beitritt ? `Mitmachen für ${fmt(bau.einsatz)}` : `Für ${fmt(bau.einsatz)} aufmachen`)
              : "Wähl erst eine Kiste"}</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Das Duell im Vollbild
     ------------------------------------------------------------------ */

  function zeigeDuell(d) {
    offenesDuell = { ...d, spieler: d.spieler.map((s) => ({ ...s })) };
    kbOverlay().classList.remove("hidden");
    kbOverlay().dataset.modus = "duell";
    document.body.classList.add("ki-offen");
    zeichneDuell(d.status === "offen" ? "Wartet auf einen Gegner" : "Gleich geht es los");
  }

  function zeichneDuell(kopfText) {
    const d = offenesDuell;
    if (!d) return;
    const spalten = d.spieler.map((s) => `
      <div class="kb-spalte" data-spieler="${escapeHtml(s.key)}">
        <div class="kb-spieler">${window.Casino.spieler.chip(s.look ? { ...s.look, name: s.name } : { name: s.name })}</div>
        <div class="kb-wert" data-wert>${fmt(s.wert || 0)}</div>
        ${kistenReihe(s.kisten || [], "kb-kisten")}
        <div class="kb-fenster">
          <div class="kb-marke" aria-hidden="true"></div>
          <div class="kb-bahn" data-bahn></div>
        </div>
        <div class="kb-bisher" data-bisher>${(s.gezogen || []).map(bisherKarte).join("")}</div>
      </div>`).join(`<div class="kb-vs">VS</div>`);

    const warte = d.spieler.length < 2
      ? `<div class="kb-warte">
           <div class="kb-warte-punkte" aria-hidden="true"><i></i><i></i><i></i></div>
           <b>Wartet auf einen Gegner</b>
           <span class="muted small">Du kannst zumachen, es läuft weiter.</span>
           <button class="btn-secondary" data-kb-ab="${escapeHtml(d.id)}">Abbrechen, Einsatz zurück</button>
         </div>`
      : "";

    $("#kb-inhalt").innerHTML = `
      <div class="kb-duell">
        <div class="kb-kopfzeile">
          <span class="kb-topf">${fmt(d.topf)}<i class=mk></i> für den Sieger</span>
          <span class="kb-runde" id="kb-runde">${escapeHtml(kopfText || "")}</span>
          <span class="kb-budget">${fmt(d.budget)} Budget</span>
        </div>
        <div class="kb-bahnen">${spalten}</div>
        ${warte}
        <div class="kb-ende hidden" id="kb-ende"></div>
        <button class="btn-secondary kb-zu" data-kb-zu>Schließen</button>
      </div>`;
  }

  /** Eine kleine Karte fuer etwas, das schon gezogen wurde. */
  function bisherKarte(t) {
    return `<div class="kb-bisher-karte" style="--stufe:${t.stufe.farbe}" title="${escapeHtml(t.label)} · ${fmt(t.wert)}">
      <div class="kb-bisher-demo">${window.Casino.spieler.kosVorschau(t.look, { name: acc().name || "Du" })}</div>
    </div>`;
  }

  /** Ein Feld auf einer senkrechten Bahn. */
  function kbFeld(f, treffer) {
    return `<div class="kb-feld${treffer ? " treffer" : ""}" style="--stufe:${(f.stufe && f.stufe.farbe) || "#9aa4ae"}">
      <div class="kb-feld-demo">${window.Casino.spieler.kosVorschau(f.look, { name: acc().name || "Du" })}</div>
    </div>`;
  }

  /**
   * Eine Runde fahren, fuer beide gleichzeitig.
   *
   * Senkrecht und nicht waagerecht: zwei Bahnen nebeneinander muessen
   * schmal sein, und eine schmale waagerechte Bahn zeigt drei Felder.
   * Wer mit seiner Liste schon durch ist, bekommt in dieser Runde keinen
   * Zug und steht still daneben.
   */
  function fahreRunde(daten) {
    const d = offenesDuell;
    if (!d || d.id !== daten.id) return;
    const runde = $("#kb-runde");
    if (runde) runde.textContent = `Runde ${daten.runde + 1} von ${daten.von}`;

    /* Wer in dieser Runde nichts zieht, ist mit seiner Liste durch. Das
       steht dann auch da: sonst sieht die stehengebliebene Bahn aus, als
       waere etwas haengengeblieben. */
    const ziehen = new Set(daten.zuege.map((z) => z.key));
    for (const s of d.spieler) {
      const spalte = document.querySelector(`.kb-spalte[data-spieler="${CSS.escape(s.key)}"]`);
      if (spalte) spalte.classList.toggle("fertig", !ziehen.has(s.key));
    }
    for (const zug of daten.zuege) {
      const spalte = document.querySelector(`.kb-spalte[data-spieler="${CSS.escape(zug.key)}"]`);
      if (!spalte) continue;
      spalte.querySelectorAll(".kb-kisten img").forEach((img, i) => {
        img.classList.toggle("dran", i === daten.runde);
        img.classList.toggle("durch", i < daten.runde);
      });
    }

    const dauer = (daten.schau && daten.schau.bahn ? daten.schau.bahn : 3200) / 1000;
    for (const zug of daten.zuege) {
      const spalte = document.querySelector(`.kb-spalte[data-spieler="${CSS.escape(zug.key)}"]`);
      if (!spalte) continue;
      const bahn = spalte.querySelector("[data-bahn]");
      bahn.style.transition = "none";
      bahn.style.transform = "translate3d(0,0,0)";
      bahn.innerHTML = zug.rolle.felder.map((f, i) => kbFeld(f, i === zug.rolle.trefferIndex)).join("");
      const erstes = bahn.querySelector(".kb-feld");
      const hoehe = erstes ? erstes.getBoundingClientRect().height : 74;
      const luecke = parseFloat(getComputedStyle(bahn).gap) || 0;
      const schritt = hoehe + luecke;
      const mitte = spalte.querySelector(".kb-fenster").getBoundingClientRect().height / 2;
      const versatz = (Math.random() - 0.5) * (hoehe * 0.5);
      const ziel = -(zug.rolle.trefferIndex * schritt) + mitte - hoehe / 2 + versatz;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (reduziert()) {
          bahn.style.transform = `translate3d(0,${ziel}px,0)`;
        } else {
          bahn.style.transition = `transform ${dauer}s cubic-bezier(.08,.72,.11,1)`;
          bahn.style.transform = `translate3d(0,${ziel}px,0)`;
        }
      }));
    }
    if (!reduziert()) ticker(dauer);

    setTimeout(() => {
      if (!offenesDuell || offenesDuell.id !== daten.id) return;
      for (const zug of daten.zuege) {
        const spalte = document.querySelector(`.kb-spalte[data-spieler="${CSS.escape(zug.key)}"]`);
        if (!spalte) continue;
        const wert = spalte.querySelector("[data-wert]");
        wert.textContent = fmt(zug.wert);
        wert.classList.remove("hoch");
        void wert.offsetWidth;
        wert.classList.add("hoch");
        spalte.querySelector("[data-bisher]").insertAdjacentHTML("beforeend", bisherKarte(zug.treffer));
        const eigene = offenesDuell.spieler.find((s) => s.key === zug.key);
        if (eigene) { eigene.wert = zug.wert; (eigene.gezogen = eigene.gezogen || []).push(zug.treffer); }
      }
      // Wer vorn liegt, wird markiert. Das ist der ganze Reiz beim Zusehen.
      const werte = offenesDuell.spieler.map((s) => s.wert || 0);
      const best = Math.max(...werte);
      for (const s of offenesDuell.spieler) {
        const spalte = document.querySelector(`.kb-spalte[data-spieler="${CSS.escape(s.key)}"]`);
        if (spalte) spalte.classList.toggle("vorn", (s.wert || 0) === best && werte.filter((w) => w === best).length === 1);
      }
      const gross = daten.zuege.some((z) => ["legendaer", "mythisch", "kiste"].includes(z.treffer.stufe.id));
      window.Casino.sound?.play(gross ? "bigwin" : "cash");
    }, (reduziert() ? 0 : dauer * 1000) + 120);
  }

  function zeigeEnde(daten) {
    const d = offenesDuell;
    if (!d || d.id !== daten.id) return;
    const el = $("#kb-ende");
    if (!el) return;
    const ich = acc().name;
    const gewonnen = daten.sieger && daten.sieger.name === ich;
    el.className = "kb-ende" + (gewonnen ? " gewonnen" : "");
    el.innerHTML = daten.abbruch
      ? `<b>Abgebrochen.</b><span>Eine Kiste war nicht mehr da. Beide Einsätze sind zurück.</span>`
      : daten.unentschieden
        ? `<b>Unentschieden.</b><span>Gleicher Wert gezogen. Beide bekommen ihren Einsatz zurück.</span>`
        : `<b>${escapeHtml(daten.sieger.name)} gewinnt.</b>
           <span>${daten.stand.map((s) => `${escapeHtml(s.name)} ${fmt(s.wert)}`).join(" gegen ")}</span>
           <span class="kb-beute">${gewonnen
             ? `${fmt(daten.gewinn)} Chips gehen an dich.`
             : `${fmt(daten.gewinn)} Chips gehen an ${escapeHtml(daten.sieger.name)}.`}</span>`;
    el.classList.remove("hidden");
    if ($("#kb-runde")) $("#kb-runde").textContent = "Vorbei";
    document.querySelectorAll(".kb-kisten img").forEach((img) => { img.classList.remove("dran"); img.classList.add("durch"); });
    window.Casino.sound?.play(gewonnen ? "bigwin" : "cash");
    if (gewonnen && !reduziert()) { try { window.Casino.fx?.spieleGewinnEffekt({ stufe: 3 }); } catch {} }
  }

  function schliesseDuell() {
    kbOverlay().classList.add("hidden");
    document.body.classList.remove("ki-offen");
    offenesDuell = null;
    bau = null;
    ladeDuelle();
    load();
  }

  /* ------------------------------------------------------------------
     Ereignisse
     ------------------------------------------------------------------ */

  socket.on("kdl:update", () => { if (aufSchirm()) ladeDuelle(); });
  socket.on("kdl:runde", (daten) => fahreRunde(daten));
  socket.on("kdl:ende", (daten) => zeigeEnde(daten));

  /* Das Duell geht los. Zwei Faelle, beide brauchen dasselbe: wer
     aufgemacht hat, steht bis hierhin allein auf dem Schirm und muss den
     Gegner danebengestellt bekommen; und wer das Fenster zugemacht hat,
     wird zurueckgeholt. Live heisst, dass man dabei ist. */
  socket.on("kdl:start", ({ id, duell } = {}) => {
    if (!duell) return;
    if (offenesDuell && offenesDuell.id === id) { zeigeDuell(duell); return; }
    if (!aufSchirm()) return;
    const meins = ((dstand && dstand.duelle) || []).find((x) => x.id === id && x.meins);
    if (meins) zeigeDuell(duell);
  });

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-ki-tab]");
    if (tab) { zeigeReiter(tab.dataset.kiTab); return; }

    if (e.target.closest("[data-kd-neu]")) { zeigeBau(null); return; }

    const setz = e.target.closest("[data-kb-setz]");
    if (setz && bau) {
      bau[setz.dataset.kbSetz] = Number(setz.dataset.wert);
      zeichneBau();
      return;
    }
    if (e.target.closest("[data-kb-weiter]") && bau) {
      bau.einsatz = Math.floor(Number($("#kb-einsatz")?.value) || bau.einsatz);
      bau.budget = Math.floor(Number($("#kb-budget")?.value) || bau.budget);
      bau.schritt = "kisten";
      zeichneBau();
      return;
    }
    if (e.target.closest("[data-kb-zurueck]") && bau) {
      if (bau.id) { schliesseDuell(); return; }   // beim Beitreten gibt es kein Zurueck
      bau.schritt = "zahlen";
      zeichneBau();
      return;
    }

    const plus = e.target.closest("[data-kb-plus]");
    if (plus && bau) { bau.gewaehlt.push(plus.dataset.kbPlus); zeichneBau(); return; }
    const minus = e.target.closest("[data-kb-minus]");
    if (minus && bau) {
      const i = bau.gewaehlt.lastIndexOf(minus.dataset.kbMinus);
      if (i >= 0) bau.gewaehlt.splice(i, 1);
      zeichneBau();
      return;
    }
    if (e.target.closest("[data-kb-zu]")) { schliesseDuell(); return; }

    const los = e.target.closest("[data-kb-los]");
    if (los && bau && bau.gewaehlt.length) {
      const a = { ...bau, gewaehlt: bau.gewaehlt.slice() };
      bau = null;
      if (a.id) {
        socket.emit("kdl:beitreten", { id: a.id, kisten: a.gewaehlt }, (r) => {
          if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); schliesseDuell(); return; }
          applyAccount(r.account);
          zeigeDuell(r.duell);
          ladeDuelle();
        });
      } else {
        socket.emit("kdl:erstelle", { einsatz: a.einsatz, budget: a.budget, kisten: a.gewaehlt }, (r) => {
          if (!r || !r.ok) { toast((r && r.error) || "Ging nicht."); schliesseDuell(); return; }
          applyAccount(r.account);
          zeigeDuell(r.duell);
          ladeDuelle();
        });
      }
      return;
    }

    const bei = e.target.closest("[data-kd-bei]");
    if (bei) {
      const d = ((dstand && dstand.duelle) || []).find((x) => x.id === bei.dataset.kdBei);
      if (!d) return toast("Diese Herausforderung gibt es nicht mehr.");
      // Direkt in die Kistenwahl: Einsatz und Budget stehen schon fest.
      zeigeBau({ schritt: "kisten", id: d.id, einsatz: d.einsatz, budget: d.budget, gewaehlt: [] });
      return;
    }

    const ab = e.target.closest("[data-kd-ab], [data-kb-ab]");
    if (ab) {
      const id = ab.dataset.kdAb || ab.dataset.kbAb;
      socket.emit("kdl:abbrechen", { id }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Ging nicht.");
        applyAccount(r.account);
        toast("Zurückgenommen, dein Einsatz ist wieder da.");
        schliesseDuell();
      });
      return;
    }

    const zu = e.target.closest("[data-kd-zusehen]");
    if (zu) {
      const d = ((dstand && dstand.duelle) || []).find((x) => x.id === zu.dataset.kdZusehen);
      if (d) zeigeDuell(d);
      return;
    }
  });

  /* Getippte Zahlen merken, damit ein Zwischenstand beim Neuzeichnen nicht
     verlorengeht. */
  document.addEventListener("input", (e) => {
    if (!bau) return;
    if (e.target.id === "kb-einsatz") bau.einsatz = Math.floor(Number(e.target.value) || 0);
    else if (e.target.id === "kb-budget") bau.budget = Math.floor(Number(e.target.value) || 0);
    else return;
    const knopf = document.querySelector("[data-kb-weiter]");
    if (knopf) {
      const maxE = Math.min(dstand.maxEinsatz, acc().chips || 0);
      knopf.disabled = !(bau.einsatz >= dstand.minEinsatz && bau.einsatz <= maxE
        && bau.budget >= dstand.minBudget && bau.budget <= dstand.maxBudget);
    }
  });

  window.Casino.screens.register("kiste", {
    onEnter: () => {
      /* Zuruecksetzen, nicht nur aufraeumen: bleibt `laeuft` von einer
         abgebrochenen Ziehung stehen, nimmt der Bildschirm gar keinen
         Klick mehr an und sagt auch nicht, warum. */
      laeuft = false;
      overlay()?.classList.add("hidden");
      document.body.classList.remove("ki-offen");
      zeigeReiter("kisten");
      load();
      ladeDuelle();
    },
    // Wer mitten in der Ziehung wegnavigiert, soll kein Vollbild zurueck-
    // lassen, das ueber der Lobby klebt.
    onLeave: () => { laeuft = false; overlay()?.classList.add("hidden"); document.body.classList.remove("ki-offen"); },
  });
})();
