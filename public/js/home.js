"use strict";

/**
 * Lobby (Startbildschirm).
 *
 * Vorher standen alle neunzehn Spielkacheln fest im HTML, alle mit demselben
 * Grün, derselben Größe, demselben Aufbau. Poker sah aus wie Sudoku sah aus
 * wie die Bank. Dazu kamen vierzehn winzige Emoji-Knöpfe als Resterampe, in
 * denen Einstellungen und Profil zwischen den Spielen standen.
 *
 * Jetzt kommt alles aus der Liste GAMES weiter unten. Das erlaubt Kategorien,
 * Favoriten, Live-Spielerzahlen und eine eigene Farbe je Spiel, ohne dass man
 * dafür neunzehn Blöcke HTML pflegen muss.
 *
 * Die Farbe steckt als Farbton (--h) auf der Karte. Karte und Rand mischen ihn
 * nur schwach in die Theme-Fläche ein, statt eine eigene Farbe zu setzen: so
 * bekommt jedes Spiel ein Gesicht und trotzdem sehen alle drei Themes stimmig
 * aus.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const Casino = window.Casino;

  const KATEGORIEN = [
    { id: "casino", label: "Casino" },
    { id: "pvp", label: "Gegeneinander" },
    { id: "wirtschaft", label: "Wirtschaft" },
  ];

  const GAMES = [
    // --- Casino: gegen das Haus ---
    { id: "slots",      name: "Slots",          sub: "Vier Automaten, von zahm bis wild", icon: "🎰", cat: "casino", h: 42 },
    { id: "blackjack",  name: "Blackjack",      sub: "21 schlagen. Bester Schnitt im Haus", icon: "♠️", cat: "casino", h: 152 },
    { id: "roulette",   name: "Roulette",       sub: "Europäisch, eine einzige Null",     icon: "🎡", cat: "casino", h: 2 },
    { id: "crash",      name: "Crash",          sub: "Aussteigen, bevor es knallt",       icon: "🚀", cat: "casino", h: 22 },
    { id: "mines",      name: "Mines",          sub: "Edelsteine sammeln, Bomben meiden", icon: "💣", cat: "casino", h: 268 },
    { id: "towers",     name: "Towers",         sub: "Turm erklimmen, Fallen meiden",     icon: "🗼", cat: "casino", h: 190 },
    { id: "pinco",      name: "Pinco Ball",     sub: "Bälle droppen, gemeinsam zuschauen", icon: "🟢", cat: "casino", h: 96 },
    { id: "horses",     name: "Rennbahn",       sub: "Live-Rennen und eigene Pferde",     icon: "🐎", cat: "casino", h: 32 },
    { id: "sports",     name: "Sportwetten",    sub: "Echte Ligen, echte Ergebnisse",     icon: "⚽", cat: "casino", h: 128 },

    // --- Gegeneinander: kein Hausvorteil, nur Können ---
    { id: "poker",      name: "Texas Hold'em",  sub: "Gegen Freunde, ohne Hausvorteil",   icon: "🃏", cat: "pvp", h: 214 },
    { id: "chess",      name: "Schach-Duell",   sub: "Blitz um Chips, mit Wertung",       icon: "♟️", cat: "pvp", h: 240 },
    { id: "memory",     name: "Memory-Duell",   sub: "Paare finden, schneller als er",    icon: "🧠", cat: "pvp", h: 322 },
    { id: "sudoku",     name: "Sudoku-Race",    sub: "Solo oder Duell, wer zuerst löst",  icon: "🔢", cat: "pvp", h: 206 },
    { id: "solitaire",  name: "Solitär",        sub: "Klondike, frei oder gegen das Haus", icon: "🂡", cat: "pvp", h: 354 },

    // --- Wirtschaft: was du mit den Gewinnen machst ---
    { id: "businesses", name: "Stadt",          sub: "Porta Westfalica Haus für Haus",    icon: "🏙️", cat: "wirtschaft", h: 174 },
    { id: "stocks",     name: "Börse",          sub: "Long und Short mit Hebel",          icon: "📈", cat: "wirtschaft", h: 146 },
    { id: "bank",       name: "Bank",           sub: "Sparkonto und Kredite",             icon: "🏦", cat: "wirtschaft", h: 210 },
    { id: "work",       name: "Arbeiten",       sub: "Starthilfe, wenn gar nichts geht",  icon: "💼", cat: "wirtschaft", h: 48 },
  ];

  const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));
  const MAX_FAVORITEN = 8;
  const LETZTE_KEY = "casino_zuletzt";

  let aktiveKategorie = "casino";
  let spielerProScreen = {};   // screen -> Anzahl
  let favoriten = [];

  // ---------------------------------------------------------------
  // Favoriten und zuletzt gespielt
  // ---------------------------------------------------------------
  function ladeFavoriten() {
    const acc = Casino.getAccount();
    favoriten = (acc && acc.prefs && Array.isArray(acc.prefs.favorites)) ? acc.prefs.favorites.slice() : [];
  }

  function toggleFavorit(id) {
    const i = favoriten.indexOf(id);
    if (i >= 0) favoriten.splice(i, 1);
    else {
      if (favoriten.length >= MAX_FAVORITEN) {
        Casino.toast(`Höchstens ${MAX_FAVORITEN} Favoriten.`);
        return;
      }
      favoriten.push(id);
    }
    const acc = Casino.getAccount();
    if (acc) acc.prefs = { ...(acc.prefs || {}), favorites: favoriten.slice() };
    Casino.savePrefs({ favorites: favoriten.slice() });
    Casino.sound.play("select");
    zeichneSpiele();
  }

  /** Zuletzt gespielt bleibt bewusst lokal: das ist Gerätegewohnheit, kein Besitz. */
  function letzteSpiele() {
    try {
      const roh = JSON.parse(localStorage.getItem(LETZTE_KEY) || "[]");
      return Array.isArray(roh) ? roh.filter((id) => GAME_BY_ID.has(id)).slice(0, 4) : [];
    } catch { return []; }
  }

  function merkeSpiel(id) {
    if (!GAME_BY_ID.has(id)) return;
    const liste = [id, ...letzteSpiele().filter((x) => x !== id)].slice(0, 4);
    try { localStorage.setItem(LETZTE_KEY, JSON.stringify(liste)); } catch {}
  }

  // ---------------------------------------------------------------
  // Zeichnen
  // ---------------------------------------------------------------
  function karte(g, { klein = false } = {}) {
    const anzahl = spielerProScreen[g.id] || 0;
    const istFavorit = favoriten.includes(g.id);
    const live = anzahl > 0
      ? `<span class="tile-live" title="${anzahl} gerade dort">● ${anzahl}</span>`
      : "";
    const stern = klein ? "" :
      `<button class="tile-fav${istFavorit ? " on" : ""}" data-fav="${g.id}" type="button"
               aria-label="${istFavorit ? "Favorit entfernen" : "Als Favorit merken"}"
               title="${istFavorit ? "Favorit entfernen" : "Als Favorit merken"}">${istFavorit ? "★" : "☆"}</button>`;
    return `
      <button class="game-tile${klein ? " tile-sm" : ""}" style="--h:${g.h}" data-game="${g.id}" type="button">
        <span class="tile-icon" aria-hidden="true">${g.icon}</span>
        <span class="tile-body">
          <span class="tile-name">${Casino.escapeHtml(g.name)}</span>
          ${klein ? "" : `<span class="tile-sub">${Casino.escapeHtml(g.sub)}</span>`}
        </span>
        ${live}${stern}
      </button>`;
  }

  function zeichneTabs() {
    const host = $("#cat-tabs");
    if (!host) return;
    host.innerHTML = KATEGORIEN.map((k) => {
      const n = GAMES.filter((g) => g.cat === k.id).length;
      return `<button class="cat-tab${k.id === aktiveKategorie ? " active" : ""}" data-cat="${k.id}"
                      type="button" role="tab" aria-selected="${k.id === aktiveKategorie}">
                ${k.label}<small>${n}</small>
              </button>`;
    }).join("");
  }

  function zeichneSpiele() {
    const host = $("#lobby-games");
    if (!host) return;
    host.innerHTML = GAMES.filter((g) => g.cat === aktiveKategorie).map((g) => karte(g)).join("");
    zeichneSchnellzugriff();
    zeichneTabs();
  }

  /**
   * Oben eine Reihe mit Favoriten, sonst mit zuletzt Gespieltem. Wer nichts
   * von beidem hat (neuer Account), sieht die Reihe gar nicht — ein leerer
   * Kasten mit "noch nichts" kostet nur Platz.
   */
  function zeichneSchnellzugriff() {
    const wrap = $("#lobby-quick");
    const host = $("#lobby-quick-list");
    const titel = $("#lobby-quick-title");
    if (!wrap || !host) return;

    const ausFavoriten = favoriten.map((id) => GAME_BY_ID.get(id)).filter(Boolean);
    const liste = ausFavoriten.length ? ausFavoriten : letzteSpiele().map((id) => GAME_BY_ID.get(id)).filter(Boolean);
    if (!liste.length) { wrap.classList.add("hidden"); return; }

    wrap.classList.remove("hidden");
    titel.textContent = ausFavoriten.length ? "★ Deine Favoriten" : "↩ Zuletzt gespielt";
    host.innerHTML = liste.map((g) => karte(g, { klein: true })).join("");
  }

  // ---------------------------------------------------------------
  // Wartende Herausforderungen
  // ---------------------------------------------------------------
  /*
   * Ein Duell wartet, bis jemand vorbeikommt — deshalb steht es hier oben und
   * nicht nur im Spiel selbst. Ohne diesen Hinweis findet es niemand, und
   * genau das war ja das Problem der alten PvP-Modi.
   */
  function zeichneDuelle() {
    const el = $("#lobby-duelle");
    if (!el) return;
    Casino.socket.emit("duell:state", (r) => {
      if (!r || !r.ok) { el.classList.add("hidden"); return; }
      const dran = (r.laufend || []).length;
      const offen = (r.offen || []).length;
      if (!dran && !offen) { el.classList.add("hidden"); return; }
      el.classList.remove("hidden");
      el.innerHTML = dran
        ? `<span class="duell-banner-icon">⏳</span><span><b>Du bist in einem Duell dran</b><small>Deine Partie läuft noch, das Ergebnis fehlt.</small></span>`
        : `<span class="duell-banner-icon">⚔️</span><span><b>${offen} ${offen === 1 ? "Herausforderung wartet" : "Herausforderungen warten"}</b><small>Jederzeit annehmen, niemand muss gleichzeitig da sein.</small></span>`;
    });
  }

  // ---------------------------------------------------------------
  // Live-Spielerzahlen aus der Präsenz
  // ---------------------------------------------------------------
  function setzeAnwesenheit(online) {
    spielerProScreen = {};
    const ich = Casino.getAccount();
    for (const p of online || []) {
      const screen = p.status && p.status.screen;
      if (!screen || screen === "lobby") continue;
      // Sich selbst nicht mitzählen: "1 dort" waere man ja selbst.
      if (ich && p.name && p.name.toLowerCase() === ich.name.toLowerCase()) continue;
      spielerProScreen[screen] = (spielerProScreen[screen] || 0) + 1;
    }
    if (Casino.screens.current() === "lobby") zeichneSpiele();
  }

  // ---------------------------------------------------------------
  // Verdrahtung
  // ---------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav]");
    if (fav) { e.stopPropagation(); toggleFavorit(fav.dataset.fav); return; }

    const tile = e.target.closest("[data-game]");
    if (tile) {
      const id = tile.dataset.game;
      merkeSpiel(id);
      Casino.sound.play("select");
      Casino.screens.show(id);
      return;
    }

    const tab = e.target.closest("[data-cat]");
    if (tab) {
      aktiveKategorie = tab.dataset.cat;
      Casino.sound.play("tick");
      zeichneSpiele();
    }
  });

  Casino.screens.register("lobby", {
    onEnter() {
      ladeFavoriten();
      zeichneSpiele();
      if (Casino._loadLobbies) Casino._loadLobbies();
      if (Casino._loadFeed) Casino._loadFeed();
      if (Casino._loadRecords) Casino._loadRecords();
      zeichneDuelle();
      if (Casino._renderHero) Casino._renderHero();
    },
  });

  // data-nav wuerde nur den Bildschirm oeffnen, nicht den richtigen Reiter.
  document.getElementById("lobby-duelle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    Casino.sound.play("select");
    if (Casino._sudokuDuelle) Casino._sudokuDuelle();
    else Casino.screens.show("sudoku");
  });

  Casino.socket.on("duell:update", () => {
    if (Casino.screens.current() === "lobby") zeichneDuelle();
  });

  Casino._lobbyPresence = setzeAnwesenheit;
  Casino._lobbyRedraw = zeichneSpiele;
  Casino._games = GAMES;
})();
