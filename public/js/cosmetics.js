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
  let vorschau = null;   // { type, id } — nur angesehen, nicht gekauft

  /*
   * Preis oder Zustand eines Stuecks. Gibt HTML zurueck, nicht Text — die
   * Spielmarke und das Schloss sind gezeichnet. Was von aussen kommt (`via`
   * aus dem Katalog) wird hier einzeln escaped; frueher lief der ganze
   * Rueckgabewert durch escapeHtml, was jetzt die Marke als Zeichenkette
   * sichtbar machen wuerde.
   */
  const preisHtml = (x) => {
    const sperre = window.Casino.icons.ui("sperre");
    if (x.equipped) return `${window.Casino.icons.ui("ja")} Aktiv`;
    if (x.owned) return "Anlegen";
    if (x.cost === null) return `${sperre} ${escapeHtml(x.via || "Season")}`;
    return x.cost ? window.Casino.betrag(x.cost) : "Gratis";
  };

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
    if (x.owned || x.cost !== null) return "";
    const f = (stand && stand.fristen) || {};
    // Zwei Zeilen: oben WAS es ist, darunter WIE LANGE noch. In einer Zeile
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
    /* Fortuna laeuft nicht nach ZEIT ab, sondern nach STUECKZAHL. Deshalb
       steht hier kein Countdown, sondern wie viele es noch gibt. */
    if (x.limitiert === "rad") {
      const fo = (stand && stand.fortuna) || {};
      return fo.rest
        ? bau("jetzt", `${fo.rest} von ${fo.max}`, "nur am Glücksrad")
        : bau("vorbei", "Vergeben", "alle sieben sind weg");
    }
    return bau("verdienen", "Zu verdienen", "");
  }

  function knopf(type, x, inhalt, klasse = "") {
    const gesperrt = !x.owned && x.cost === null;
    return `<button class="cos-item ${x.equipped ? "equipped" : ""}${gesperrt ? " locked" : ""} ${klasse}"
        data-type="${type}" data-id="${x.id}" data-owned="${x.owned ? 1 : 0}" data-locked="${gesperrt ? 1 : 0}">
        ${marke(x)}
        ${inhalt}
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
    };
    box.innerHTML =
      `<span class="cos-preview-label">So sehen dich die anderen</span>` +
      `<span class="cos-preview-row">${Casino.spieler.avatar(p)}` +
      `<span class="pl-text">${Casino.spieler.name(p)}${Casino.spieler.title(p)}</span></span>`;
    if (p.banner) box.dataset.banner = p.banner; else delete box.dataset.banner;
  }

  function render(s) {
    stand = s;
    const setze = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };

    setze("#cos-styles", s.styles.map((x) => knopf("style", x,
      `<span class="cos-style-demo ${x.id === "standard" ? "" : "nm-" + x.id}">${escapeHtml(x.label)}</span>` +
      (x.motion ? `<span class="cos-motion" title="bewegt sich">✨</span>` : ""))).join(""));

    setze("#cos-titles", s.titles.map((x) => knopf("title", x,
      `<span class="cos-title-demo">${x.text ? escapeHtml(x.text) : "— ohne —"}</span>`)).join(""));

    setze("#cos-frames", s.frames.map((x) => knopf("frame", x,
      `<span class="pl-ava ${x.id === "keiner" ? "" : "fr-" + x.id}">🙂</span>`)).join(""));

    setze("#cos-effects", s.effects.map((x) => knopf("effect", x,
      `<span class="cos-effekt-demo">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-auren", s.auren.map((x) => knopf("aura", x,
      `<span class="cos-aura-demo ${x.id === "keine" ? "" : "au-" + x.id}"><span class="pl-ava">🙂</span></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-karten", s.karten.map((x) => knopf("karte", x,
      `<span class="cos-karte-demo" data-karte="${x.id}"></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-schilder", s.schilder.map((x) => knopf("schild", x,
      `<span class="online-player cos-schild-demo${x.id === "keins" ? "" : " sch-" + x.id}"><span>🙂</span><b>${escapeHtml((Casino.getAccount() || {}).name || "Du")}</b></span>` +
      `<span class="cos-banner-label">${escapeHtml(x.label)}</span>`)).join(""));

    setze("#cos-sprueche", s.sprueche.map((x) => knopf("spruch", x,
      `<span class="cos-title-demo">${x.eigen ? "✍️ Eigener Satz" : x.text ? escapeHtml(x.text.replace("{name}", (Casino.getAccount() || {}).name || "Du")) : "— ohne —"}</span>`)).join(""));

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

    renderVorschau();
  }

  function handle(el) {
    const type = el.dataset.type, id = el.dataset.id;
    if (el.dataset.locked === "1") {
      const liste = { style: stand.styles, title: stand.titles, frame: stand.frames, avatar: stand.avatars,
        color: stand.colors, effect: stand.effects, spruch: stand.sprueche, banner: stand.banner,
        schild: stand.schilder, aura: stand.auren, karte: stand.karten }[type] || [];
      const x = liste.find((i) => i.id === id);
      return toast(x && x.via ? `Nicht zu kaufen. ${x.via}.` : "Gibt es nur über den Season-Pass.");
    }
    const owned = el.dataset.owned === "1";
    // Einen Effekt kann man nicht in einer Zeile zeigen — der muss laufen.
    // Deshalb spielt jeder Tipp ihn einmal ab, egal ob gekauft oder nicht.
    if (type === "effect") {
      const acc = Casino.getAccount() || {};
      const gemerkt = acc.winEffect;
      acc.winEffect = id === "konfetti" ? null : id;
      Casino.fx.spieleGewinnEffekt();
      setTimeout(() => { acc.winEffect = gemerkt; }, 1400);
    }
    // Erst ansehen, dann kaufen: ein Tipp auf etwas Fremdes zeigt es nur in
    // der Vorschau. Der zweite Tipp auf dasselbe kauft.
    if (!owned && !(vorschau && vorschau.type === type && vorschau.id === id)) {
      vorschau = { type, id };
      Casino.sound.play("tick");
      renderVorschau();
      $("#cos-preview")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    socket.emit(owned ? "cos:equip" : "cos:buy", { type, id }, (r) => {
      if (!r || !r.ok) { toast((r && r.error) || "Fehler."); return; }
      if (r.account) applyAccount(r.account);
      vorschau = null;
      Casino.sound.play(owned ? "select" : "win");
      toast(owned ? "✓ Angelegt!" : "🎨 Gekauft! Jetzt nochmal antippen zum Anlegen.");
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
    vor.textContent = text ? `👋 ${name} ${text}` : "👋 (noch nichts eingetragen)";
  }

  document.addEventListener("input", (e) => {
    if (e.target.id === "cos-spruch-text") zeigeSpruchVorschau();
  });

  document.addEventListener("click", (e) => {
    if (e.target.id === "cos-spruch-save") {
      const feld = $("#cos-spruch-text");
      socket.emit("cos:spruchText", { text: feld.value }, (r) => {
        if (!r || !r.ok) return toast((r && r.error) || "Fehler.");
        toast("✓ Satz gespeichert.");
        render(r);
      });
      return;
    }
    const el = e.target.closest('[data-screen="cosmetics"] .cos-item');
    if (el) handle(el);
  });

  window.Casino._loadCosmetics = () => {
    vorschau = null;
    socket.emit("cos:state", (s) => { if (s && s.ok) render(s); });
  };
})();
