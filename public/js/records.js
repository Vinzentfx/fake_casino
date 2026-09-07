"use strict";

/**
 * Wochenrekorde in der Lobby.
 *
 * Alles Soziale im Casino verlangte bisher, dass zwei Leute gleichzeitig da
 * sind: Poker, Duelle, Lobbys, Clan-Kriege. Gespielt wird aber in Schueben,
 * jeder zu seiner Zeit. Hier steht deshalb der Wettbewerb, der ohne
 * Gleichzeitigkeit funktioniert: jedes Spiel haelt eine Woche lang seine beste
 * Runde fest, mit Namen. Wer reinkommt, sieht, was die anderen hinterlassen
 * haben.
 *
 * Gewertet wird das VIELFACHE des Einsatzes, nicht die Hoehe des Gewinns. Sonst
 * gewinnt immer, wer am meisten setzen kann, und in einer Freundesrunde mit
 * sehr unterschiedlichen Kontostaenden waere das sofort langweilig.
 */
(function () {
  const { socket, escapeHtml } = window.Casino;
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString("de-DE");

  // Der Server kennt die Sportwetten als "sportwetten", der Bildschirm heisst
  // "sports". Alle anderen Namen sind identisch.
  const SCREEN = { sportwetten: "sports" };

  let letzterStand = null;

  function wannKurz(ts) {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} Min`;
    const std = Math.floor(min / 60);
    if (std < 24) return `vor ${std} Std`;
    return `vor ${Math.floor(std / 24)} T`;
  }

  function karte(z) {
    const screen = SCREEN[z.spiel] || z.spiel;
    // Dieselbe Zeichnung wie auf der Spielkachel. Ein Emoji neben gezeichneten
    // Kacheln sieht aus, als waere die Karte von woanders.
    const symbol = (Casino.icons && Casino.icons.icon(screen)) || z.icon;
    // Farbton des Spiels, damit die Karte zur Kachel passt.
    const spiel = (Casino._games || []).find((g) => g.id === screen);
    const ton = spiel ? spiel.h : 45;
    // Die Regel steht auf jeder Karte, weil sie sich je Spiel unterscheidet:
    // Blackjack zahlt hoechstens das Zweieinhalbfache, ein Vielfaches-Rekord
    // waere dort nach der ersten Runde fuer immer festgenagelt. Dort zaehlt
    // deshalb die Serie.
    if (!z.best) {
      const vor = z.vorwoche
        ? `Letzte Woche: ${escapeHtml(z.vorwoche.name)} mit ${escapeHtml(z.vorwoche.text)}`
        : escapeHtml(z.regel);
      return `<button class="rec rec-frei" data-rec="${screen}" style="--h:${ton}" type="button">
          <span class="rec-icon" aria-hidden="true">${symbol}</span>
          <span class="rec-game">${escapeHtml(z.label)}</span>
          <span class="rec-faktor">frei</span>
          <span class="rec-who">Hol ihn dir</span>
          <small class="rec-detail">${vor}</small>
        </button>`;
    }
    const b = z.best;
    const wer = b.meiner ? "Dein Rekord" : escapeHtml(b.name);
    const detail = z.art === "serie"
      ? `${escapeHtml(z.regel)} · ${wannKurz(b.at)}`
      : `${fmt(b.einsatz)} → ${fmt(b.gewinn)}<i class=mk></i> · ${wannKurz(b.at)}`;
    return `<button class="rec${b.meiner ? " rec-mein" : ""}" data-rec="${screen}" style="--h:${ton}" type="button">
        <span class="rec-icon" aria-hidden="true">${symbol}</span>
        <span class="rec-game">${escapeHtml(z.label)}</span>
        <span class="rec-faktor">${escapeHtml(b.text)}</span>
        <span class="rec-who">${wer}</span>
        <small class="rec-detail">${detail}</small>
      </button>`;
  }

  function zeichne(res) {
    const wrap = $("#lobby-records");
    const host = $("#recs-grid");
    const hint = $("#recs-hint");
    if (!wrap || !host) return;
    if (!res || !res.ok) { wrap.classList.add("hidden"); return; }

    letzterStand = res;
    wrap.classList.remove("hidden");
    if (hint) {
      hint.textContent = `Ab ${fmt(res.minEinsatz)} Chips Einsatz. Was zählt, steht auf jeder Karte. Setzt sich jeden Montag zurück.`;
    }
    host.innerHTML = res.zeilen.map(karte).join("");
  }

  function laden() {
    if (!socket) return;
    // Bewusst ohne connected-Pruefung: beim ersten Laden ist die Lobby da,
    // bevor die Verbindung steht. Socket.IO haelt das Ereignis solange fest.
    socket.emit("records:state", zeichne);
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-rec]");
    if (!el) return;
    Casino.sound.play("select");
    Casino.screens.show(el.dataset.rec);
  });

  // Ein fremder Rekord faellt: sofort neu zeichnen, aber nur wenn die Lobby
  // gerade sichtbar ist. Sonst holt onEnter den Stand ohnehin frisch.
  socket.on("records:update", () => {
    if (Casino.screens.current() === "lobby") laden();
  });

  // Nach einem Verbindungsabbruch (iPad-Deckel zu, Netzwechsel) steht hier
  // sonst ein veralteter Stand bis zum naechsten Lobby-Besuch.
  socket.on("connect", () => {
    if (Casino.screens.current() === "lobby") laden();
  });

  Casino._loadRecords = laden;
  Casino._recordsState = () => letzterStand;

  // Beim Neuladen der Seite steht die Lobby unter Umstaenden schon, bevor
  // diese Datei ueberhaupt ausgefuehrt wurde — dann ist onEnter laengst
  // durch und niemand hat die Rekorde geholt. Genau das passiert auf dem
  // iPad staendig, weil Safari die Seite beim Zurueckwechseln neu laedt.
  if (Casino.screens.current() === "lobby") laden();
})();
