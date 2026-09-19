"use strict";

/**
 * Mitspieler in die eigene Lobby holen.
 *
 * Absenderseite: ein Knopf neben dem Chat, der nur erscheint, wenn man
 * gerade wirklich in einer Lobby sitzt. Bewusst dort und nicht in den neun
 * Lobby-Bildschirmen einzeln: eine Stelle, die auf jedem Bildschirm liegt,
 * statt neun, die auseinanderlaufen.
 *
 * Empfaengerseite: die Einladung kommt als Frage mitten auf den Bildschirm,
 * mit "Mitmachen" direkt darin. Ein Toast waere nach vier Sekunden weg, und
 * dann waere die Einladung genauso verpufft wie vorher der Tisch selbst.
 */
(function () {
  const Casino = window.Casino;
  const socket = Casino.socket;
  if (!socket) return;

  let stand = { aktiv: false };
  let offen = false;

  /* senden */

  /*
   * Der Knopf.
   *
   * Er war ein nackter Kreis unten rechts, der irgendwann lautlos auftauchte,
   * und damit hat ihn niemand bemerkt — genau an der Stelle, an der es
   * darauf ankommt: man macht eine Lobby auf und moechte SOFORT wissen, wen
   * man holen kann. Jetzt steht der Text dabei, die Zahl der Erreichbaren
   * daneben, und beim ersten Erscheinen faehrt er einmal auf und pulst
   * kurz. Danach ist er ruhig; ein Knopf, der dauernd wackelt, wird zur
   * Tapete.
   */
  function knopf() {
    let b = document.getElementById("einladen-fab");
    if (!b) {
      b = document.createElement("button");
      b.id = "einladen-fab";
      b.className = "einladen-fab";
      b.type = "button";
      b.setAttribute("aria-label", "Mitspieler einladen");
      b.innerHTML = '<i data-icon="rufen"></i><span class="einladen-text">Mitspieler holen</span><b class="einladen-zahl"></b>';
      document.body.appendChild(b);
      if (Casino.icons && Casino.icons.zeichne) Casino.icons.zeichne(b);
      b.addEventListener("click", oeffneWahl);
    }
    return b;
  }

  let warSichtbar = false;
  function zeichneKnopf() {
    const b = knopf();
    // Kein Knopf, wenn niemand da ist, den man einladen koennte.
    const leute = (stand.spieler || []).length;
    const sinnvoll = stand.aktiv && leute > 0;
    b.hidden = !sinnvoll;
    if (!sinnvoll) { warSichtbar = false; return; }

    const zahl = b.querySelector(".einladen-zahl");
    if (zahl) zahl.textContent = String(leute);
    const text = b.querySelector(".einladen-text");
    if (text) text.textContent = stand.label ? `Zu ${stand.label} holen` : "Mitspieler holen";

    /* Einmal auffahren, wenn er neu ist. `rein` bleibt danach stehen, die
       Animation laeuft nur einmal — sonst huepft er bei jedem Takt neu. */
    if (!warSichtbar) {
      warSichtbar = true;
      b.classList.remove("rein");
      void b.offsetWidth;
      b.classList.add("rein");
      try { Casino.sound && Casino.sound.play("select"); } catch {}
    }
  }

  async function oeffneWahl() {
    if (!stand.aktiv) return;
    const leute = stand.spieler || [];
    if (!leute.length) return;

    // Casino.dialog.wahl kann Auswahllisten, dafuer braucht es kein eigenes
    // Fenster. Der Aufenthaltsort steht als Hinweis dabei: wer gerade in
    // einem Spiel sitzt, sagt vielleicht eher ab als wer in der Lobby steht.
    const frei = stand.frei != null ? ` Noch ${stand.frei} ${stand.frei === 1 ? "Platz" : "Plätze"} frei.` : "";
    const an = await Casino.dialog.wahl(`Wen holst du zu ${stand.label} dazu?${frei}`, {
      titel: "Mitspieler einladen",
      optionen: leute.map((p) => ({ wert: p.key, label: p.name, hinweis: wo(p.screen) })),
    });
    if (!an) return;

    socket.emit("einladung:senden", { an, schirm: Casino.screens ? Casino.screens.current() : "" }, (r) => {
      Casino.toast(r && r.ok ? "Einladung ist raus." : (r && r.error) || "Ging nicht.");
      hole();
    });
  }

  const WO = {
    lobby: "in der Lobby", poker: "bei Poker", slots: "an den Slots", blackjack: "bei Blackjack",
    roulette: "am Roulette", crash: "bei Crash", mines: "bei Mines", towers: "bei Towers",
    horses: "an der Rennbahn", pinco: "bei Pinco", memory: "bei Memory", sudoku: "bei Sudoku",
    solitaire: "bei Solitär", chess: "beim Schach", sports: "bei Sportwetten",
    hilo: "bei Higher/Lower", wuerfel: "beim Würfelpoker", lotterie: "bei der Lotterie", kniffel: "beim Kniffel",
  };
  const wo = (s) => WO[s] || "online";

  /* empfangen */

  socket.on("einladung:neu", async (e) => {
    if (!e || offen) return;
    offen = true;
    try {
      Casino.sound && Casino.sound.play("select");
      const ja = await Casino.dialog.frage(
        `${e.von} lädt dich zu ${e.label} ein.${e.privat ? "\n\nDas ist eine private Runde, ohne Einladung kommst du da nicht rein." : ""}`,
        { titel: "Einladung", okText: "Mitmachen", abbruchText: "Später" }
      );
      if (ja) beitreten(e.spiel, e.code);
    } finally {
      offen = false;
    }
  });

  /** Dieselbe Zuordnung wie in js/lobby.js, damit es nur einen Weg gibt. */
  function beitreten(spiel, code) {
    const w = window.Casino;
    const m = {
      poker: w._pokerJoinCode, pvp: w._pvpJoinCode, blackjack: w._bjJoinCode,
      roulette: w._rouletteJoinCode, memory: w._memoryJoinCode, sudoku: w._sudokuJoinCode,
      solrace: w._solraceJoinCode, chess: w._chessJoinCode, pinco: w._pincoJoinCode,
      kniffel: w._kniffelJoinCode,
    };
    const fn = m[spiel];
    if (fn) fn(code);
    else Casino.toast("Diese Runde lässt sich gerade nicht betreten.");
  }

  /* Status */

  function hole() {
    if (!socket.connected) return;
    socket.emit("einladung:status", { schirm: Casino.screens ? Casino.screens.current() : "" }, (r) => {
      stand = r && r.ok ? r : { aktiv: false };
      zeichneKnopf();
    });
  }

  /*
   * Wann nachgefragt wird.
   *
   * Der Takt allein reichte nicht: eine Lobby aufzumachen wechselt den
   * Bildschirm nicht, also stand der Knopf bis zu acht Sekunden lang nicht
   * da — genau in den Sekunden, in denen man ihn braucht. `lobby:list`
   * kommt vom Server, sobald sich an irgendeiner Lobby etwas aendert, und
   * das ist der Moment, in dem sich auch die Antwort aendert.
   */
  document.addEventListener("casino:screen", hole);
  socket.on("connect", hole);
  socket.on("lobby:list", hole);
  Casino.einladung = { pruefe: hole };
  setInterval(hole, 8000);
  hole();
})();
