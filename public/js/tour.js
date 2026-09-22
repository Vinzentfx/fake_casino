"use strict";

/**
 * Rundgang durch die Neuerungen.
 *
 * Das Comeback-Fenster sagt, was sich geaendert hat. Danach steht man in der
 * Lobby und weiss immer noch nicht, wo das alles ist. Der Rundgang zeigt es:
 * jeder Schritt erklaert eine Sache in zwei Saetzen und hat einen Knopf, der
 * genau dorthin springt.
 *
 * Laeuft genau einmal von selbst, danach nur noch ueber das Menue. Wer ihn
 * abbricht, bekommt ihn nicht wieder vorgesetzt, ein Rundgang, den man
 * weggeklickt hat, ist eine Antwort und keine Panne.
 */
(function () {
  const Casino = window.Casino;
  const $ = (s) => document.querySelector(s);

  const SCHRITTE = [
    {
      icon: "rundgang",
      titel: "Willkommen zurück",
      text: "Im Casino hat sich viel verändert. Dieser kurze Rundgang zeigt dir die wichtigsten Orte und führt dich direkt dorthin. Du kannst ihn jederzeit beenden und später über das Menü erneut öffnen.",
    },
    {
      icon: "slots",
      titel: "Die Lobby",
      text: "Spiele stehen jetzt nach Kategorie sortiert, jedes mit eigener Farbe und Logo. Der Stern rechts unten heftet dir ein Spiel nach oben. Und auf der Kachel siehst du, wer gerade dort spielt.",
      ziel: "lobby",
      knopf: "Zur Lobby",
    },
    {
      icon: "bestenliste",
      titel: "Wochenrekorde",
      text: "Jedes Spiel merkt sich eine Woche lang die beste Runde, mit Namen. Gewertet wird das Vielfache deines Einsatzes, nicht die Höhe des Gewinns: mit 200 Chips hast du dieselbe Chance wie jemand mit zwei Millionen. Du findest sie in der Lobby unter den Spielen.",
      ziel: "lobby",
      knopf: "Ansehen",
    },
    {
      icon: "sudoku",
      titel: "Duelle ohne Termin",
      text: "Der Grund, warum Poker und die Duelle nie liefen: zwei Leute müssen gleichzeitig da sein. Im Sudoku gibt es jetzt den Reiter „Duell“: du machst eine Herausforderung auf, löst sofort, und dein Ergebnis wartet, bis jemand annimmt.",
      ziel: "sudoku",
      knopf: "Zum Sudoku",
    },
    {
      icon: "ansage",
      titel: "Das Casino meldet sich",
      text: "Wenn ein Turnier läuft, jemand einen Tisch aufmacht oder deinen Rekord schlägt. In der Lobby gibt es außerdem „Mitspieler rufen“, mit dem du den anderen kurz Bescheid gibst. Auf dem iPad musst du die Seite dafür einmal über Teilen zum Home-Bildschirm legen.",
      ziel: "settings",
      knopf: "Einschalten",
    },
    {
      icon: "kosmetik",
      titel: "Deine Sammlung",
      text: "Zwölf Arten verändern deinen Auftritt – vom Profilbild und Namensstil bis zu Aura, Kartenrücken und Gewinn-Effekt. Neue Stücke kommen aus Kisten, Belohnungen, Auktionen und dem Spielermarkt; jede Prägung trägt ihre eigene Seriennummer.",
      ziel: "cosmetics",
      knopf: "Zur Sammlung",
    },
    {
      icon: "businesses",
      titel: "Die Stadt",
      text: "Unter der Karte steht jetzt, wem wie viel gehört. Tippst du jemanden an, siehst du seine Häuser mit dem Preis, den du für eine Übernahme zahlen würdest. Übernehmen ging immer schon, nur hat es niemand gefunden.",
      ziel: "businesses",
      knopf: "Zur Stadt",
    },
    {
      icon: "season",
      titel: "Season 2 läuft",
      text: "Acht Wochen, zwanzig Stufen. XP bekommst du einfach beim Spielen, jeden Tag gibt ein anderes Spiel doppelte XP. Unterwegs vier Sachen, die es nirgends zu kaufen gibt. Viel Spaß, und willkommen zurück.",
      ziel: "season",
      knopf: "Zur Season",
    },
  ];

  let i = 0;

  function zeichne() {
    const s = SCHRITTE[i];
    const box = $("#tour-modal");
    if (!box || !s) return;
    const icon = $("#tour-icon");
    if (icon) icon.innerHTML = Casino.icons && Casino.icons.hatUi(s.icon)
      ? Casino.icons.ui(s.icon)
      : "";
    $("#tour-title").textContent = s.titel;
    $("#tour-text").textContent = s.text;
    const zaehler = $("#tour-counter");
    if (zaehler) zaehler.textContent = `${i + 1} / ${SCHRITTE.length}`;
    $("#tour-dots").innerHTML = SCHRITTE
      .map((_, n) => `<span class="tour-dot${n === i ? " on" : ""}"></span>`).join("");
    $("#tour-back").disabled = i === 0;
    $("#tour-next").textContent = i === SCHRITTE.length - 1 ? "Fertig" : "Weiter";
    const ziel = $("#tour-goto");
    ziel.classList.toggle("hidden", !s.ziel);
    if (s.ziel) ziel.textContent = s.knopf || "Zeig mir";
  }

  function oeffne(start = 0) {
    i = start;
    $("#tour-modal")?.classList.remove("hidden");
    zeichne();
  }

  function schliesse() {
    $("#tour-modal")?.classList.add("hidden");
    // Einmal gesehen reicht. Liegt am Account, damit es auf allen Geraeten
    // gilt und Safari es nicht nach sieben Tagen vergisst.
    Casino.savePrefs({ tourGesehen: true });
    const acc = Casino.getAccount();
    if (acc) acc.prefs = { ...(acc.prefs || {}), tourGesehen: true };
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#tour-next")) {
      if (i >= SCHRITTE.length - 1) return schliesse();
      i++; Casino.sound.play("tick"); return zeichne();
    }
    if (e.target.closest("#tour-back")) { if (i > 0) { i--; Casino.sound.play("tick"); zeichne(); } return; }
    if (e.target.closest("#tour-skip")) return schliesse();
    // Ueber das Menue laesst er sich jederzeit wieder aufmachen.
    if (e.target.closest("#menu-tour")) {
      if (Casino.menuSchliessen) Casino.menuSchliessen();
      oeffne(0);
      return;
    }
    if (e.target.closest("#tour-goto")) {
      const ziel = SCHRITTE[i].ziel;
      schliesse();
      if (ziel === "sudoku" && Casino._sudokuDuelle) Casino._sudokuDuelle();
      else if (ziel) Casino.screens.show(ziel);
      return;
    }
  });

  Casino.tour = {
    oeffne,
    /** Startet den Rundgang, wenn ihn dieser Account noch nie gesehen hat. */
    vielleicht() {
      const acc = Casino.getAccount();
      if (!acc || (acc.prefs && acc.prefs.tourGesehen)) return false;
      oeffne(0);
      return true;
    },
  };
})();
