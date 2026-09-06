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

  const preisText = (x) =>
    x.equipped ? "✓ Aktiv"
      : x.owned ? "Anlegen"
        : x.cost === null ? (x.via ? "🔒 " + x.via : "🔒 Season")
          : x.cost ? fmt(x.cost) + " 🪙" : "Gratis";

  function knopf(type, x, inhalt, klasse = "") {
    const gesperrt = !x.owned && x.cost === null;
    return `<button class="cos-item ${x.equipped ? "equipped" : ""}${gesperrt ? " locked" : ""} ${klasse}"
        data-type="${type}" data-id="${x.id}" data-owned="${x.owned ? 1 : 0}" data-locked="${gesperrt ? 1 : 0}">
        ${inhalt}
        <small>${escapeHtml(preisText(x))}</small>
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
      title: vorschau && vorschau.type === "title"
        ? (stand.titles.find((t) => t.id === vorschau.id) || {}).text || null
        : acc.title || null,
    };
    box.innerHTML =
      `<span class="cos-preview-label">So sehen dich die anderen</span>` +
      `<span class="cos-preview-row">${Casino.spieler.avatar(p)}` +
      `<span class="pl-text">${Casino.spieler.name(p)}${Casino.spieler.title(p)}</span></span>`;
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

    setze("#cos-avatars", s.avatars.map((x) => knopf("avatar", x,
      `<span class="cos-emoji">${x.emoji}</span>`)).join(""));

    setze("#cos-colors", s.colors.map((x) => knopf("color", x,
      `<span class="cos-swatch" style="background:${x.color || "#e8e8e8"}"></span>`)).join(""));

    renderVorschau();
  }

  function handle(el) {
    const type = el.dataset.type, id = el.dataset.id;
    if (el.dataset.locked === "1") {
      const liste = { style: stand.styles, title: stand.titles, frame: stand.frames, avatar: stand.avatars, color: stand.colors }[type] || [];
      const x = liste.find((i) => i.id === id);
      return toast(x && x.via ? `Nicht zu kaufen. ${x.via}.` : "Gibt es nur über den Season-Pass.");
    }
    const owned = el.dataset.owned === "1";
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

  document.addEventListener("click", (e) => {
    const el = e.target.closest('[data-screen="cosmetics"] .cos-item');
    if (el) handle(el);
  });

  window.Casino._loadCosmetics = () => {
    vorschau = null;
    socket.emit("cos:state", (s) => { if (s && s.ok) render(s); });
  };
})();
