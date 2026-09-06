"use strict";

/**
 * Update-Historie.
 *
 * Eine einzige Quelle fuer zwei Dinge:
 *   1. das Comeback-Fenster beim Reinkommen (zeigt alles, was seit dem
 *      letzten Besuch dazugekommen ist)
 *   2. den Updates-Tab im Menue (die ganze Historie zum Nachlesen)
 *
 * Die id ist das Datum im Format JJJJ-MM-TT und wird als Zeichenkette
 * verglichen. Das ist Absicht: der alte Merkwert im localStorage hiess
 * "2026-07-16-sicherheit-fixes", und der ist als Zeichenkette groesser als
 * "2026-07-16", aber kleiner als "2026-09-06". Wer das Juli-Fenster damals
 * gesehen hat, bekommt es also nicht noch einmal.
 *
 * Neueste Eintraege stehen oben.
 */
(function () {
  const RELEASES = [
    {
      id: "2026-09-06",
      datum: "6. September 2026",
      titel: "Das Casino ist zurück",
      gross: true,
      intro: "Der erste Teil eines größeren Umbaus: alles sieht anders aus, und einiges läuft endlich so, wie es sollte.",
      items: [
        { icon: "🏠", titel: "Neue Lobby", text: "Guthaben und Level stehen jetzt oben, darunter die Spiele nach Kategorie sortiert. Jedes Spiel hat seine eigene Farbe, und du siehst auf der Karte, wer gerade dort spielt. Mit dem Stern heftest du dir deine Lieblingsspiele nach oben." },
        { icon: "🎨", titel: "Drei Designs", text: "Klassik (Filzgrün und Gold), Mitternacht (Marineblau) und Neon (fast schwarz mit Türkis). Umschalten in den Einstellungen. Die Wahl gilt auf allen deinen Geräten." },
        { icon: "♠️", titel: "Blackjack am echten Tisch", text: "Filz mit Bande, größere Karten, der Einsatz als Chipstapel und die Hausregel auf dem Tisch. Geteilte Hände stehen nebeneinander, die aktive ist hervorgehoben." },
        { icon: "🔊", titel: "Ton in mehr Spielen", text: "Mines, Towers, Crash und Pinco haben jetzt Klang. In Mines und Towers steigt der Ton mit jedem sicheren Zug. Große Gewinne werden überall gefeiert, nicht nur an den Slots. Alles abschaltbar." },
        { icon: "⚡", titel: "Schneller und app-tauglich", text: "Die Seite lädt beim zweiten Aufruf fast nichts mehr nach. Auf dem iPad kannst du das Casino über \"Zum Home-Bildschirm\" als richtige App ablegen. Und die Zurück-Geste geht endlich einen Screen zurück statt aus der App heraus." },
        { icon: "🎡", titel: "Roulette am richtigen Tableau", text: "Statt einer langen Zahlenliste liegt das Tableau jetzt quer, wie am echten Tisch: Null links, zwölf Spalten, Kolonnen rechts. Deine Chips liegen sichtbar auf den Feldern. Neu dazu: Zurück (letzten Chip zurücknehmen) und Wiederholen (dieselben Wetten wie in der letzten Runde). Auf dem Handy bleibt die stehende Fassung." },
        { icon: "👤", titel: "Profil als Visitenkarte", text: "Bild, Name, Clan und Rang stehen zusammen oben, darunter deine Zahlen als Raster statt als Liste. Neu dabei: dein Stadt-Imperium mit Häusern, Wert, Straßen-Monopolen und Trophäen. Die Achievements zeigen jetzt erst die freigeschalteten, die gesperrten kommen auf Knopfdruck." },
        { icon: "🃏", titel: "Poker mit Zug-Uhr", text: "Der Tisch folgt jetzt dem gewählten Design statt immer grün mit brauner Bande zu sein. Der Pot zeigt einen Chipstapel, der mit dem Betrag wächst. Und die 30 Sekunden Bedenkzeit laufen als Balken direkt an deinem Sitz ab, nicht mehr nur als Zahl über dem Tisch: die letzten zehn Sekunden werden rot." },
        { icon: "⚽", titel: "Sportwetten übersichtlich", text: "Vorher stand jedes der siebzig Spiele mit allen sechs Wettmärkten offen da: über 700 Knöpfe und rund vierunddreißig Bildschirme Scrollen. Jetzt siehst du je Spiel den Sieger-Markt, der Rest kommt auf Tipp. Dazu ein Liga-Filter, laufende Spiele zuoberst, und der Wettschein bleibt beim Scrollen stehen." },
        { icon: "🐛", titel: "Fünf alte Fehler weg", text: "Wer Towers oder Rennbahn spielte, erschien für alle \"in der Lobby\". Der Login versprach 1.000 Startchips statt 5.000. Nach einem Update wurde niemand mehr zum Neuladen aufgefordert. Und das Passwort-Formular in den Einstellungen hatte gar keine Formatierung. Beim Roulette blieb außerdem die Runde hängen, wenn man mitten im Dreh die App wechselte." },
      ],
    },
    {
      id: "2026-09-05",
      datum: "5. September 2026",
      titel: "Echte Ligen und Dauer-Login",
      items: [
        { icon: "⚽", titel: "Sportwetten auf laufende Ligen", text: "Statt der längst beendeten WM laufen jetzt Bundesliga, Premier League und La Liga mit echten Spielen und echten Ergebnissen. Die Team-Stärken kommen aus den Abschlusstabellen der letzten Saison, nicht aus dem Bauch." },
        { icon: "🔐", titel: "Eingeloggt bleiben", text: "Safari wirft auf dem iPad gern Hintergrund-Tabs weg. Die Sitzung überlebt das jetzt und hält 30 Tage." },
      ],
    },
    {
      id: "2026-07-16",
      datum: "16. Juli 2026",
      titel: "Drei Live-Events und sichere Passwörter",
      gross: true,
      items: [
        { icon: "💸", titel: "Chip-Regen, Blitz-Quiz, Tresorkampf", text: "Drei Events, die zufällig starten: fallende Chips antippen, die schnellste richtige Antwort gewinnt, und Rot gegen Blau am Tresor." },
        { icon: "🔑", titel: "Richtige Passwörter", text: "Statt vierstelliger PIN sind jetzt 6 bis 24 Zeichen möglich. Zu viele Fehlversuche sperren den Account, und du wirst gewarnt, wenn jemand an deinem Login herumprobiert hat." },
        { icon: "🛟", titel: "Reload-Schutz", text: "Towers, Mines und Blackjack überleben Tab-Reload und Verbindungsabbruch. Dein laufendes Spiel wartet auf dich, statt den Einsatz zu fressen." },
        { icon: "🐎", titel: "Fairere Renn-Quoten", text: "Die Quoten kennen jetzt Kondition, Taktik und Sprint der Pferde." },
        { icon: "💾", titel: "Backup-Knopf", text: "Der Besitzer kann alle Spielstände als eine Datei herunterladen und wieder einspielen." },
      ],
    },
    {
      id: "2026-07-15",
      datum: "15. Juli 2026",
      titel: "Towers und der neue Pinco Ball",
      items: [
        { icon: "🗼", titel: "Neues Spiel: Towers", text: "Etage für Etage den Turm hoch, Fallen meiden, jederzeit aussteigen. Je höher, desto mehr." },
        { icon: "🟢", titel: "Pinco Ball neu gebaut", text: "Echte Physik von Stift zu Stift statt einer gewürfelten Bahn. Der Gewinn steht erst fest, wenn der Ball landet." },
      ],
    },
    {
      id: "2026-07-11",
      datum: "11. Juli 2026",
      titel: "Die Porta-Rennbahn",
      gross: true,
      items: [
        { icon: "🐎", titel: "Live-Pferderennen", text: "Eigene Pferde besitzen, trainieren, umbenennen und auf Rennen wetten. Mit Sprint-Knopf und Tages-Rangliste." },
        { icon: "🏆", titel: "Renn-Champion des Tages", text: "Preisgeld für die ersten drei Plätze, jeden Tag neu." },
        { icon: "🛡️", titel: "Wett-Limits", text: "Höchstens 50.000 pro Pferd und 100.000 pro Rennen, damit ein einzelner Abend nicht die ganze Wirtschaft kippt." },
      ],
    },
    {
      id: "2026-07-10",
      datum: "10. Juli 2026",
      titel: "Book of Rah und neue Crash-Optik",
      items: [
        { icon: "📖", titel: "Neuer Slot: Book of Rah", text: "Fünf Walzen, zehn Linien, expandierendes Bonussymbol. Ersetzt Cosmic Cluster." },
        { icon: "🚀", titel: "Crash sieht neu aus", text: "Weltraum mit Parallax, gezeichnete Rakete, Partikel und eine richtige Explosion." },
        { icon: "🎡", titel: "Roulette angepasst", text: "Die Auszahlungen waren zu großzügig und sind auf ein normales Maß zurück." },
        { icon: "📱", titel: "Weniger Last auf dem iPad", text: "Kleinere Texturen und weniger Effekte auf Animationen, damit die Slots flüssig laufen." },
      ],
    },
    {
      id: "2026-07-09",
      datum: "9. Juli 2026",
      titel: "Algen Abyss und Ankündigungen",
      items: [
        { icon: "🌊", titel: "Neuer Slot: Algen Abyss", text: "Mystery-Algen, Nudge und Reveal. Unterwasser-Szene als Hintergrund." },
        { icon: "📣", titel: "Ankündigungen", text: "Der Besitzer kann eine Nachricht an alle schicken, die oben im Bild steht." },
        { icon: "💼", titel: "Arbeiten mit Aufgaben", text: "Der Klick-Job hat wechselnde Mini-Aufgaben statt nur einem Knopf." },
      ],
    },
    {
      id: "2026-07-08",
      datum: "8. Juli 2026",
      titel: "Season-Pass, Denkspiele, Live-Feed",
      gross: true,
      items: [
        { icon: "🎟️", titel: "Season-Pass", text: "Stufen mit Belohnungen, die sich durchs normale Spielen füllen." },
        { icon: "🧩", titel: "Denkspiele ausgebaut", text: "Solitär und Sudoku auch solo, Revanche nach jedem Duell, Schachbrett-Fehler behoben." },
        { icon: "📡", titel: "Live-Feed in der Lobby", text: "Große Gewinne, Käufe und Duelle laufen für alle sichtbar durch." },
        { icon: "🎓", titel: "Einstieg für Neue", text: "Ein kurzes Fenster erklärt beim ersten Mal, wo man anfängt." },
      ],
    },
    {
      id: "2026-07-06",
      datum: "6. Juli 2026",
      titel: "Level, Clans, Heist und vier Denkspiele",
      gross: true,
      items: [
        { icon: "🌱", titel: "Spieler-Level und XP", text: "Durchs Spielen steigst du auf. Der Rang steht neben deinem Namen." },
        { icon: "🛡️", titel: "Clans", text: "Gründen, beitreten, Schatzkammer, Clan-Kriege und eine Wochenliga." },
        { icon: "💰", titel: "Casino-Heist", text: "Ein Event, bei dem alle gemeinsam am Tresor hämmern." },
        { icon: "♟️", titel: "Memory, Sudoku, Solitär, Schach", text: "Vier Denkspiele, alle auch als Duell um Chips." },
        { icon: "🎨", titel: "Kosmetik-Shop", text: "Avatare und Namensfarben. Kostet Chips, bringt keine Vorteile, sieht aber gut aus." },
      ],
    },
    {
      id: "2026-07-05",
      datum: "5. Juli 2026",
      titel: "Aufträge, Live-Ops und Kalender",
      items: [
        { icon: "🎯", titel: "Aufträge", text: "Tages- und Wochenziele, die beim normalen Spielen nebenbei mitlaufen. Alle sehen dieselben, damit man darüber reden kann." },
        { icon: "⏰", titel: "Happy Hour und Turniere", text: "Zeitlich begrenzte Events mit doppelten Belohnungen und einem Preispot für den größten Einzelgewinn." },
        { icon: "📅", titel: "Login-Kalender", text: "Sieben Tage in Folge, jeden Tag mehr." },
        { icon: "🎯", titel: "Kopfgeld", text: "Setz ein Kopfgeld auf jemanden aus. Wer ihn schlägt, kassiert." },
      ],
    },
    {
      id: "2026-07-04",
      datum: "4. Juli 2026",
      titel: "Die echte Stadtkarte",
      gross: true,
      items: [
        { icon: "🏙️", titel: "Porta Westfalica als Karte", text: "Acht echte Ortsteile mit über 11.000 echten Häusern aus OpenStreetMap, samt Straßen und Adressen." },
        { icon: "👑", titel: "Territorium statt Einkommen", text: "Häuser bringen kein Geld mehr, sondern Status: Straßen-Monopole färben die Karte in deiner Farbe, der Stadtteil-Boss steht namentlich drauf." },
        { icon: "🏆", titel: "Trophäen-Gebäude", text: "Bahnhof, Kirche, Schule und Wahrzeichen. Einzigartig, teuer, mit echten Vorteilen." },
      ],
    },
    {
      id: "2026-06-26",
      datum: "26. Juni 2026",
      titel: "Kombi-Wetten, Bank und Statistik",
      items: [
        { icon: "🎟️", titel: "Kombi-Wetten", text: "Mehrere Tipps in einen Schein. Alle müssen stimmen, dafür multiplizieren sich die Quoten." },
        { icon: "🏦", titel: "Sparkonto", text: "Sicher, aber schlägt nie aktives Spielen." },
        { icon: "📊", titel: "Statistik", text: "Deine Bilanz aufgeschlüsselt nach Spiel." },
        { icon: "🛡️", titel: "Anti-Cheat", text: "Chip-Obergrenze, begrenzte Neu-Accounts pro Anschluss, und mehrere Wege dichtgemacht, über die man Chips drucken konnte." },
      ],
    },
  ];

  const NEUESTE = RELEASES[0].id;

  /** Alle Eintraege, die seit `gesehen` dazugekommen sind. */
  function neuSeit(gesehen) {
    if (!gesehen) return [];
    return RELEASES.filter((r) => r.id > gesehen);
  }

  window.Casino = window.Casino || {};
  window.Casino.changelog = { releases: RELEASES, neueste: NEUESTE, neuSeit };
})();
