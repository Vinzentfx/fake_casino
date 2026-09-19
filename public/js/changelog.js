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
 * Die id ist trotzdem nur ein Sortierschlüssel. Zwischen dem 7. und 10.
 * September kamen so viele Updates, dass sie einzeln hochgezählt wurden,
 * manche ids liegen deshalb in der Zukunft. Für Spieler sichtbar ist nur
 * `datum`. Ein neuer Eintrag braucht eine id, die größer ist als alle
 * bisherigen, sonst sieht ihn niemand im Comeback-Fenster.
 *
 * Neueste Einträge stehen oben.
 */
(function () {
  const RELEASES = [
    {
      /*
       * Ein Eintrag fuer das ganze Update.
       *
       * Waehrend der Arbeit sind daraus neun geworden, jeder mit eigener
       * Ueberschrift, zusammen vierundvierzig Punkte. Fuer Spieler ist das
       * kein Verlauf, sondern eine Wand — und die Haelfte davon stimmte am
       * Ende nicht mehr, weil der naechste Eintrag sie ueberholt hatte
       * (die Duelle waren erst versetzt, dann live, dann ohne Beute).
       * Hier steht deshalb nur, was am Ende WAHR ist.
       */
      id: "2026-09-30-a",
      datum: "19. September 2026",
      titel: "Die Stadt, die Kisten und der Markt",
      gross: true,
      items: [
        { icon: "businesses", titel: "Die Stadt zahlt wieder",
          text: "Der Dreifachpreis beim Kaufen ist weg, jeder zahlt den Marktwert. Stattdessen wirft jedes Gebäude Miete ab, jede Stunde, und davon gehen Verwaltung und Grundsteuer ab. Die ganze Rechnung steht offen da: Miete, Abzüge, was bleibt. Auch in der Statistik, bei dir und bei jedem anderen." },

        { icon: "aufwerten", titel: "Häuser ausbauen, Betriebe besetzen",
          text: "Aus einem Wohnhaus wird eine Pension, daraus ein Kiosk, ein Café, ein Hotel, am Ende eine Fabrik. Der Ausbau dauert Stunden, höchstens drei Baustellen gleichzeitig, und ein Neustart macht ihm nichts aus. Betriebe bringen nur die volle Miete, wenn Personal drin ist. Dazu Ereignisse an deinen Häusern, Bewohner mit Namen, eine Abgabe, die der Ortsteil-Boss selbst festlegt, und Lohfeld als neuer Ortsteil." },

        { icon: "geschenk", titel: "Kosmetik kommt aus Kisten",
          text: "Den Laden gibt es nicht mehr. Vier Kisten: die Tageskiste ist gratis und geht einmal in 20 Stunden, dann Holz für 30.000, Messing für 150.000 und die Schwarze für 600.000. An jeder steht offen, was drin sein kann und wie wahrscheinlich. Tipp eine an, und du siehst jedes einzelne Stück, samt Markierung, was dir noch fehlt." },

        { icon: "aufwerten", titel: "Die Ziehung",
          text: "Der Bildschirm wird schwarz, die Kiste zittert und platzt auf, dann läuft die Rolle aus. Auf den letzten Metern wächst die Marke und ein Lichtkegel geht an. Die Bahn hält kurz neben der Mitte und rückt dann darauf ein, mal von links, mal von rechts — aber immer auf der Karte, auf der sie sichtbar stehengeblieben ist. Auf eine fremde Karte springt sie nie. Und Einzelstücke sind jetzt limettengrün statt türkis: die höchste Stufe sah aus wie „Selten“ und ging im Neon-Design ganz unter. Erst danach kommt die Karte. Ab Legendär wird der ganze Bildschirm einmal in der Farbe der Stufe gewaschen." },

        { icon: "stern", titel: "Die Gala-Kiste, limitiert",
          text: "250.000 Chips, und sie steht nur bis zum Stichtag. Sie zieht kein einziges Stück aus dem normalen Katalog, sondern aus dreizehn, die es ausschließlich dort gibt: ein eigener Satz für jede Seltenheit, vom Konfetti-Zeichen bis zum Rampenlicht. Danach entstehen diese dreizehn nie wieder." },

        { icon: "kosmetik", titel: "Jedes Stück hat eine Nummer",
          text: "Alles, was nicht gratis ist, bekommt beim Vergeben eine laufende Nummer, ein Prägedatum und die Kette aller Besitzer. Aus „Neon“ wird „Neon Nr. 7“. Und von jedem Stück gibt es genau eine Nummer 1: die Erstprägung, und die bekommt, wer es als Erster wirklich aus einer Kiste zieht." },

        { icon: "warenkorb", titel: "Markt und Auktionshaus",
          text: "Auf dem Markt verkaufst du geprägte Stücke zum Festpreis, zehn Prozent gehen ans Haus. An jedem Angebot steht, woher das Stück kommt und was vorher dafür gezahlt wurde. Im Auktionshaus kannst du jetzt auch selbst etwas einliefern: 25.000 Gebühr, 15 Prozent vom Zuschlag, dafür steht dein Stück einen ganzen Tag auf der Bühne." },

        { icon: "krieg", titel: "Kisten-Duelle, live",
          text: "Du setzt Chips, und du wählst ein Budget. Das Budget kostet nichts, es ist nur die Grenze, innerhalb derer sich jeder selbst zusammenstellt, was er aufmacht. Dann laufen beide Bahnen gleichzeitig, Runde für Runde, und jeder sieht, was der andere gerade dreht. Die gezogenen Stücke gehören niemandem, es zählt ihr Wert: wer mehr zieht, gewinnt den Einsatz." },

        { icon: "bestenliste", titel: "Endlich sieht man, was du hast",
          text: "Das Prunkstück hängt mit seiner Nummer an deinem Namen, überall. Chat-Zeichen setzen ein Symbol vor jede deiner Nachrichten. Und wer drei Stücke derselben Familie gleichzeitig trägt, bekommt eine Garnitur-Marke dazu, ab fünf leuchtet sie. Dafür muss niemand gleichzeitig online sein." },

        { icon: "season", titel: "Kollektionen und Ruhmestafel",
          text: "Drei Sammlungen mit je sechs Stücken. Wer eine vollständig hat, bekommt etwas, das es auf keinem anderen Weg gibt. Oben bei den Kisten steht, was zuletzt im ganzen Haus gezogen wurde, und bei etwas richtig Seltenem läuft es bei allen quer über den Bildschirm." },

        { icon: "kosmetik", titel: "37 neue Stücke",
          text: "Polarlicht zieht senkrecht durch den Namen, bei Hochspannung schlägt ein Blitz quer durch, Uhrwerk sind zwei gegenläufige Ringe. Dazu Auren, die fallen statt zu schweben, ein Schild, in das Wasser steigt, sechs neue Chat-Zeichen und Einzelstücke, die es nur aus einer Kiste gibt." },

        { icon: "warenkorb", titel: "Verkaufen ist jetzt eine Entscheidung",
          text: "Du tippst auf ein Stück und wählst, wie du es loswirst. Festpreis im Markt: du nennst die Zahl und bekommst sie auch, 10 % Gebühr beim Verkauf, vorher kostet es nichts. Oder unter den Hammer im Auktionshaus: da nennst du nur, wo es losgeht, und hoch treiben es die anderen — nach oben offen. Dafür ist die Einliefergebühr sofort weg, auch wenn keiner bietet, und das Haus behält mehr vom Zuschlag. Beide Zahlen stehen nebeneinander im selben Fenster, und wenn ein Stück fürs Auktionshaus nicht in Frage kommt, steht gleich dabei warum. Der Weg geht von beiden Bildschirmen aus." },

        { icon: "frage", titel: "Und der Kleinkram",
          text: "Kisten, Markt, Auktionshaus und Sammlung sind jetzt Kacheln in der Lobby statt nur Zeilen im Menü. Die Tageskiste, ein Stadt-Ereignis und ein volles Sparkonto melden sich mit einer Zahl an ihrer Kachel. Edelstein, Bombe und Totenkopf waren als Chat-Zeichen leer, Silber und Gold als Rahmen unsichtbar. Die Automaten sind gratis, ließen sich aber nicht drehen, wenn man sie früher nicht gekauft hatte. Und die Ziehungsbahn hielt ab der zweiten Kiste vor dem falschen Feld: gezogen wurde immer das Richtige, angezeigt auch, nur die Bahn stand woanders. Am Ende der Freispiele stand hinter der Gewinnsumme ein Stück Programmcode statt der Chip-Marke, in der Duell-Herausforderung genauso. Und wer sich umbenennt, steht jetzt auch in einer schon offenen Herausforderung mit dem neuen Namen da. Und der Knopf zum Mitspieler-Holen steht jetzt sofort da statt acht Sekunden später. Knöpfe, die gerade nicht gehen, sehen jetzt auch so aus — vorher leuchteten „Wieder in 5 Stunden“ und „Dir fehlen …“ golden wie der Hauptknopf. Im Profil eines Spielers steht jetzt ausgeschrieben, was seine beiden Marken am Namen bedeuten: welches Prunkstück er trägt und welche Garnitur. Und das Auktionshaus nimmt ab sofort erst ab Episch an: bei kleineren Stücken hat die feste Einliefergebühr mehr gefressen, als der Zuschlag je einbringen konnte. Wer früher ein Los ersteigert hat, trägt es jetzt als Nr. 1 — ein Haus-Los kommt nach dem Zuschlag nie wieder, du warst also der Erste und der Einzige. Und dein Guthaben oben springt jetzt sofort mit, wenn du Chips bekommst, ohne selbst etwas gedrückt zu haben: Heist, Tresorkampf, Quiz, Lotterie, Spieler der Woche, Clan-Auszahlung und versetzte Duelle. Vorher stand daneben „Dein Anteil: +40.000“ und die Zahl oben rührte sich nicht." },
      ],
    },
    {
      id: "2026-09-22-g",
      datum: "17. September 2026",
      titel: "Drei gemeldete Fehler",
      items: [
        { icon: "frage", titel: "Spickzettel im Menü",
          text: "Im Menü steht jetzt „Spickzettel“. Da drin stehen alle Auszahlungsquoten, Einsatzgrenzen, Belohnungen und Regeln, von den Slots über die Stadt bis zum Season-Pass." },
        { icon: "slots", titel: "Alle Automaten frei",
          text: "Gem Storm, Algen Abyss und Book of Rah musste man früher freischalten. Das kostet jetzt nichts mehr, alle vier Automaten stehen jedem offen. Was du fürs Freischalten bezahlt hast, bekommst du zurück." },
        { icon: "chip", titel: "Bonus nach einer Umbenennung",
          text: "Wer seinen Namen geändert hat oder umbenannt wurde, kam nicht mehr an den Stunden-Bonus und die Soforthilfe. Der Server hat dabei den neuen Namen mit dem alten verglichen und abgelehnt. Geht wieder." },
        { icon: "chess", titel: "Weiße Figuren waren schwarz",
          text: "Auf Windows hat der Browser die Schachfiguren als Emoji gezeichnet, und die bringen ihre eigene Farbe mit. Jetzt sind Weiß und Schwarz wieder zu unterscheiden." },
        { icon: "ansage", titel: "Wenn die Verbindung weg ist",
          text: "Reißt die Verbindung ab, tut kein Knopf mehr etwas, obwohl die Seite normal aussieht. Das Casino sagt jetzt Bescheid und meldet sich von selbst wieder an." },
      ],
    },
    {
      id: "2026-09-22-f",
      datum: "13. September 2026",
      titel: "Du kannst deinen Namen ändern",
      items: [
        { icon: "profil", titel: "Neuer Name, altes Konto",
          text: "In den Einstellungen steht jetzt „Name ändern“. Der neue Name gilt sofort überall, auch rückwirkend: in der Chronik, in den Bestenlisten, an deinen Häusern, im Auktionshaus. Anmelden kannst du dich weiter mit dem alten Namen, du kannst dich also nicht aussperren. Einmal im Monat." },
        { icon: "sports", titel: "Echte Fußballspiele",
          text: "Bei den Sportwetten kamen zuletzt nur simulierte Partien. Woran es liegt, war von außen nicht zu sehen; jetzt steht es im Klartext im Admin-Bereich und lässt sich dort auch beheben." },
      ],
    },
    {
      id: "2026-09-22-e",
      datum: "12. September 2026",
      titel: "Zwei neue Events, Post vom Casino und ein Loch im Server",
      items: [
        { icon: "geschenk", titel: "Verlosung",
          text: "Ein Knopf, ein Gewinner: der Topf geht an einen von allen, die gerade da sind. Ohne Spiel, ohne Wartezeit. Wer gewinnt, bekommt ein Fenster und der Chat erfährt es." },
        { icon: "bank", titel: "Kassensturz",
          text: "Das erste Event, das Chips aus dem Spiel NIMMT statt neue zu machen: eine Abgabe auf Bargeld über einer Freigrenze. Was auf der Bank liegt, bleibt unberührt, und unter der Freigrenze zahlt niemand. Damit ein Haus in zwei Jahren noch etwas wert ist." },
        { icon: "ansage", titel: "Nachricht vom Casino",
          text: "Es gab nur die Ansage an alle. Für „deinen doppelt gebuchten Einsatz habe ich zurückgelegt“ war das das falsche Werkzeug. Jetzt kommt so etwas als Fenster bei genau einem an, und wer offline ist, bekommt es als Benachrichtigung." },
        { icon: "sperre", titel: "Ein Fehler, mit dem man das Casino hätte abschalten können",
          text: "Eine falsch aufgebaute Anfrage an den Server hat ihn abstürzen lassen, und das konnte jeder Eingeloggte auslösen. An 271 Stellen nachgezogen. Gemerkt hätte man es nur daran, dass plötzlich alle rausfliegen." },
      ],
    },
    {
      id: "2026-09-22-d",
      datum: "12. September 2026",
      titel: "Auktion: nur ein Los aussetzen, und überall steht jetzt das Zeichen",
      items: [
        { icon: "auktion", titel: "Eine Woche Pause war zu lang",
          text: "Wer ein Stück ersteigert hatte, war eine Woche gesperrt. Bei neun Losen und einem Los alle ein bis zwei Tage hieß das: für die halbe Sammlung raus. Jetzt setzt man genau EIN Los aus, das direkt nach dem eigenen Zuschlag, und ist danach wieder dabei. Damit gewinnt niemand zweimal hintereinander, aber mitbieten darf jeder fast immer." },
        { icon: "chip", titel: "Das Chip-Zeichen statt das Wort „Chips“",
          text: "An über zwanzig Stellen stand bei einer Zahl noch das Wort statt des gezeichneten Zeichens: im Glücksrad, auf der ganzen Season-Leiter, beim Kalender-Knopf, beim Lotterie-Jackpot und den Gewinnstufen, bei der Arbeit, beim Crash-Auszahlknopf, im Kniffel-Topf, bei Higher/Lower, Würfelpoker, Kopfgeld und im Auktionshaus. Im Fließtext bleibt das Wort, da gehört es hin." },
      ],
    },
    {
      id: "2026-09-22-c",
      datum: "11. September 2026",
      titel: "Aufgeräumt",
      items: [
        { icon: "bearbeiten", titel: "Weniger Emojis, klarere Texte",
          text: "Meldungen im Chat, Toasts und Hinweise sind durchgesehen. Die meisten Emojis davor sind weg, und ein paar Sätze, die man zweimal lesen musste, sagen jetzt direkt, was los ist. Am Spiel selbst ändert sich nichts." },
        { icon: "updates", titel: "Zwei Symbole in den Updates fehlten",
          text: "Bei zwei alten Einträgen stand statt eines Symbols das Wort „achievements“ bzw. „rennbahn“. Die zeigen jetzt wieder ein Bild." },
      ],
    },
    {
      id: "2026-09-22-b",
      datum: "11. September 2026",
      titel: "Wer alles in Häuser gesteckt hat, wurde dafür bestraft",
      items: [
        { icon: "businesses", titel: "Die Vermögensbremse traf die Falschen",
          text: "Freie Einnahmen (Stunden-Bonus, Kalender, Aufträge, Glücksrad) werden gebremst, wenn man reich ist. Nur: gerechnet wurde mit Immobilien voll und Bankguthaben gar nicht. Wer seine Chips in Gebäude gesteckt hatte, galt damit als reich und bekam ein Viertel, obwohl er nichts mehr zum Spielen hatte. Zwei von euch liefen mit 814 und 10.062 Chips auf der Hand bei 38 und 25 Prozent, während jemand mit 780.000 bar bei 96 lief. Ab jetzt zählt, was man ausgeben kann: Chips und Bank voll, Immobilien zu einem Viertel. Für die Betroffenen springt der Zufluss auf 88 bis 100 Prozent." },
        { icon: "geschenk", titel: "Die Soforthilfe war ein Witz",
          text: "Sie kam erst unter 50 Chips und füllte auf 150 auf. Der kleinste Einsatz im Haus sind 50, das reichte für drei Slot-Drehungen. Jetzt: ab unter 2.000 Chips, füllt auf 2.000 auf, alle 30 Minuten. Das Bankguthaben zählt mit, wer dort etwas liegen hat, braucht keine Nothilfe." },
        { icon: "kosmetik", titel: "Die beiden neuen Titel sind bezahlbar",
          text: "„67“ kostet jetzt 67.676 statt 6,7 Millionen, „25 pages on november 26th“ 250.000 statt 2,5 Millionen. Bei den alten Preisen hätte ein einziger Titel mehr gekostet als alles Geld, das es im Haus gibt. Mein Fehler." },
        { icon: "statistik", titel: "Fünf Milliarden bei Poker",
          text: "In einer Statistik stand bei Poker ein Netto von 5.069.495.042 und bei Slots 274 Millionen. Im ganzen Haus sind keine zehn Millionen Chips im Umlauf. Das stammt aus der Zeit mit den Poker-Bots, deren Stapel das Haus bezahlt hat. Die Geldwerte sind jetzt auf null gesetzt, Runden und Siege bleiben stehen." },
      ],
    },
    {
      id: "2026-09-22",
      datum: "10. September 2026",
      titel: "Das Auktionshaus, und drei Sachen, die nie funktioniert haben",
      gross: true,
      items: [
        { icon: "admin", titel: "Admin-Bereich aufgeräumt",
          text: "Betrifft nur mich, steht aber der Vollständigkeit halber hier: Kontenliste durchsuchbar statt 78 Karten untereinander, alles zu einer Person an einer Stelle, gefährliche Sachen erst nach Rückfrage, und die Stadtliste mit ihren 1292 Grundstücken lädt nicht mehr bei jedem Öffnen mit." },
        { icon: "kosmetik", titel: "Silber- und Goldrahmen waren unsichtbar",
          text: "Wer 40.000 oder 80.000 für einen Rahmen gezahlt hat, hat nichts bekommen. Der Ring war da, aber durchsichtig: die Grundregel für alle Rahmen hat die Farbe der einzelnen Rahmen überstimmt. Aufgefallen ist es nicht, weil Neon zusätzlich leuchtet und die bewegten Rahmen ihren Ring anders zeichnen. Beide sehen jetzt aus, wofür ihr bezahlt habt." },
        { icon: "kosmetik", titel: "Salut hat nie etwas gezeigt",
          text: "Der Gewinn-Effekt aus dem Wiedereröffnungs-Paket hat gefeuert, nur unterhalb des Bildschirmrands: die Bänder starteten unter der Kante und flogen von dort nach unten weg. Jetzt fliegen sie hoch, drehen sich am höchsten Punkt und fallen wieder." },
        { icon: "kosmetik", titel: "Zwei neue Titel",
          text: "„67“ für 6.700.000 und „25 pages on november 26th“ für 2.500.000. Ihr wisst schon. Beide sind teurer als das größte Konto im Haus. Das ist Absicht, die sind kein Kauf, sondern ein Projekt." },
        { icon: "auktion", titel: "Das Auktionshaus hat aufgemacht",
          text: "Ein Stück zur Zeit, und es gibt es nur dort. Geboten wird mit echten Chips: der Betrag geht sofort vom Konto und kommt sofort zurück, sobald dich jemand überbietet. Was am Ende steht, verbrennt. Es geht an niemanden, genau darum geht es. Zwei Regeln machen es für uns überhaupt erst fair: jedes Gebot in den letzten zwei Minuten verlängert um zwei Minuten (sonst gewinnt immer, wer zufällig in der Schlusssekunde online ist), und nach einem Zuschlag hat man eine Woche Pause (sonst räumen die zwei größten Konten alles ab). Zuschlag ist immer um 20:30 Uhr, jedes Los läuft mindestens einen Tag. Jedes Gebot steht im Chat, wer überboten wird bekommt zusätzlich eine Nachricht aufs Gerät, und oben rechts am Menü leuchtet ein roter Punkt, solange ein neues Los läuft, das du noch nicht gesehen hast, oder dein Gebot überholt wurde." },
        { icon: "kosmetik", titel: "Neun Stücke, die es nur dort gibt",
          text: "Darunter zwei ganz neue Arten. Eine Aura läuft dauerhaft um dein Bild, überall wo du auftauchst, nicht nur wenn du gewinnst, als Goldstaub oder als Schwarzes Loch. Und ein Kartenrücken ändert deine verdeckten Karten in Poker, Blackjack, Solitär und Memory. Dazu ein Name, der flimmert wie ein Hologramm, ein Namensschild aus Metall statt aus Farbe, ein Gewitter als Profil-Banner und ein Gewinn-Effekt, bei dem in der Bildmitte ein Tresor aufgeht." },
      ],
    },
    {
      id: "2026-09-21",
      datum: "10. September 2026",
      titel: "Tagesbericht beim Reinkommen, und das Glücksrad verschenkt Fortuna",
      gross: true,
      items: [
        { icon: "ansage", titel: "Tagesbericht",
          text: "Wir spielen selten gleichzeitig. Wer drei Tage nicht reinschaut, hat bisher alles verpasst: Rekorde fallen, Gebäude wechseln den Besitzer, die Lotterie zieht, und der Chat ist längst weggerollt. Beim ersten Reinkommen am Tag steht jetzt da, was passiert ist, seit du zuletzt hier warst, was gerade auf dich wartet und wie es steht (Jackpot, Goldene Straße, dein Platz). Über das Menü ist er jederzeit erreichbar." },
        { icon: "geschenk", titel: "Die Zahl oben rechts zählt jetzt alles mit",
          text: "Bisher kam sie nur, wenn eine Season-Stufe freigeschaltet war. Jetzt zählt sie auch den Kalender und den Gratis-Dreh am Glücksrad, und im Menü steht bei jedem Eintrag, was dort liegt." },
        { icon: "gluecksrad", titel: "Glücksrad verschenkt jetzt Sachen, die es für Chips nicht gibt",
          text: "Das Rad war die dritte tägliche Gratis-Quelle neben Stunden-Bonus und Kalender und brachte nur ein Zehntel davon: ein Pflichtklick ohne eigenen Grund. Jetzt stehen zwölf Felder drauf, und die Hälfte zahlt keine Chips: Gratis-Lose für die Lotterie, Season-XP (die zählen nicht gegen dein Tageslimit) und der Glückstag, der deine nächste Kalender-Abholung verdoppelt. Die Chip-Beträge sind dafür kleiner geworden. Blau heißt Sonderfeld, Gold heißt Chips." },
        { icon: "kosmetik", titel: "Fortuna: sieben Stück im ganzen Casino",
          text: "Auf einem Feld steht Fortuna. Wer es trifft, bekommt drei Stücke auf einmal: einen Ring aus zwölf Goldsegmenten um sein Bild, einen Namen, in dem sich ein Rad dreht, und den Titel „Glückspilz“. Es gibt genau sieben davon, dann nie wieder. Danach zahlt das Feld Chips. Auf dem Glücksrad steht, wie viele noch im Rad sind, und wenn eines fällt, steht es im Chat. Nicht kaufbar, nicht handelbar, reine Glückssache: jeder hat denselben einen Dreh am Tag." },
        { icon: "gluecksrad", titel: "Und das Rad sieht endlich nach Casino aus",
          text: "Es war ein flacher Tortenteller in acht Pastellfarben, die zu keinem der drei Designs passten, und auf der linken Hälfte stand jede Zahl auf dem Kopf. Jetzt: goldener Rand mit Stiften, ein Zeiger, der beim Drehen mitwippt, der Countdown unter dem Knopf statt darin, und was du gewonnen hast, bleibt danach stehen." },
      ],
    },
    {
      id: "2026-09-20",
      datum: "10. September 2026",
      titel: "Kniffel gegeneinander, und Achievements zeigen endlich den Fortschritt",
      gross: true,
      items: [
        { icon: "kniffel", titel: "Kniffel-Duell",
          text: "Zwei Spieler, sieben Felder, drei Würfe pro Zug. Du siehst direkt auf dem Zettel, was jedes freie Feld mit deinen Würfeln bringen würde. Entscheiden musst du nur, wo du einen mittelmäßigen Wurf einträgst, rechnen musst du nicht. Sieben Felder statt der klassischen dreizehn, weil eine volle Partie zu zweit über eine Viertelstunde dauert und so lange bleibt hier niemand am Tisch. Das Haus behält nur 5 Prozent Vermittlung, der Rest geht an den Gewinner." },
        { icon: "bestenliste", titel: "Achievements mit Fortschrittsbalken",
          text: "„Spiele 1.000 Runden“ war ein graues Schloss, auch wenn du bei 780 standest. Jetzt steht überall, wie weit du bist, und die noch offenen sind danach sortiert: was fast geschafft ist, steht oben." },
        { icon: "bestenliste", titel: "25 neue Achievements",
          text: "Level 25 und 50, alle Casino-Spiele einmal gespielt, Higher/Lower-Kette, fünf gleiche im Würfelpoker, drei Richtige und der Jackpot in der Lotterie, ein Pferd kaufen und 25 Rennen gewinnen, 150 Häuser, Boss von drei Ortsteilen, Sparkonto, Clan beitreten, jemandem Chips schicken, jemanden einladen, Kosmetik sammeln, einen Wochenrekord halten und Season-Stufe 20." },
      ],
    },
    {
      id: "2026-09-19",
      datum: "10. September 2026",
      titel: "Vier Sachen repariert, die ihr gemeldet habt",
      items: [
        { icon: "rufen", titel: "Beim Chip-Regen fiel das Wort „Chips“ vom Himmel",
          text: "Statt Münzen regnete es das Wort „Chips“ in Riesenschrift. Ein Überbleibsel davon, dass wir die Münz-Emoji überall durch das Wort ersetzt haben. Im Fließtext richtig, hier nicht. Jetzt fallen gezeichnete Münzen, die goldene mit Ring und Stern, damit man sie im Fallen erkennt." },
        { icon: "horses", titel: "Im Champion-Banner stand nur der erste Buchstabe",
          text: "Da stand „V“ statt „Vincent“. Zwei verschiedene Bauteile hatten sich denselben CSS-Namen geteilt: das Banner der Rennbahn und die Besitzliste in der Stadt. Die Stadt gewann, und ihr Raster gab dem Namen eine zehn Pixel breite Spalte." },
        { icon: "horses", titel: "Pferdenamen, die klangen wie ein Ersatzteil",
          text: "„Mitternachtwind“ fehlte das Fugen-s, „Turbohufe“ und „Goldhufe“ klangen nach Werkstatt. Die Bausteine tragen ihr s jetzt selbst, „hufe“ ist raus, dafür gibt es Husar, Komet, Falke und Bote dazu. Und „Blitzblitz“ kann nicht mehr passieren." },
        { icon: "sports", titel: "Die echten Spiele waren da, nur nie zu sehen",
          text: "Auf dem Brett stehen 67 echte Partien gegen 5 simulierte. Nur: die simulierten laufen im Dauerbetrieb und gelten damit fast immer als „live“, und live stand ganz oben. Die echten lagen darunter und wurden nie gefunden. Jetzt stehen echte Spiele zuerst, mit ihrer richtigen Anstoßzeit. Die Sortierung danach hat übrigens auch nie funktioniert, sie rechnete mit Text statt mit Datum." },
      ],
    },
    {
      id: "2026-09-18",
      datum: "9. September 2026",
      titel: "Drei neue Spiele",
      gross: true,
      intro: "Zwei fürs schnelle Zwischendurch und eins, für das man gar nicht online sein muss.",
      items: [
        { icon: "hilo", titel: "Higher/Lower",
          text: "Eine Karte liegt offen, ist die nächste höher oder tiefer? Jeder Treffer multipliziert, aussteigen kannst du nach jedem. Das Besondere: die Multiplikatoren sind keine feste Tabelle, sondern werden aus dem echten Restdeck gerechnet und stehen auf den Knöpfen. Beim König bringt „höher“ das 11,76-fache, weil nur noch vier Asse darüber liegen. Bei einer Acht steht es fifty-fifty. Gleicher Wert zählt nicht, die Karte fliegt raus und es geht weiter." },
        { icon: "wuerfel", titel: "Würfelpoker",
          text: "Fünf Würfel, ein Wurf, dann hältst du was dir gefällt und wirfst den Rest einmal nach. Fünf gleiche zahlen 25×, große Straße 3×, Full House und vier gleiche 2,5×. Neben jeder Zeile steht die echte Chance, und das ist wichtig: wer Würfel halten darf, kommt viel leichter an eine Straße als die Poker-Rangfolge glauben lässt. Wenn du magst, schlägt dir das Spiel vor, welche Würfel sich zu halten lohnen." },
        { icon: "lotterie", titel: "Lotterie, jeden Abend um 20 Uhr",
          text: "Vier Zahlen aus sechzehn ankreuzen, Los kaufen, fertig. Gezogen wird abends von selbst, du musst dafür nicht da sein. Zwei Richtige geben den Einsatz zurück, drei Richtige das Zehnfache, vier Richtige den Jackpot. Der wächst mit jedem verkauften Los weiter, solange ihn niemand knackt. Höchstens zehn Lose pro Person und Ziehung, damit die Ziehung nicht dem gehört, der am meisten Chips hat." },
      ],
    },
    {
      id: "2026-09-17",
      datum: "9. September 2026",
      titel: "Towers sagt jetzt die Wahrheit, Poker zählt richtig",
      items: [
        { icon: "towers", titel: "Die Leiter versprach mehr, als ausgezahlt wird",
          text: "Auf „Meister“ steht auf Ebene 9 das 256.901-fache. Ausgezahlt werden aber höchstens 2 Mio pro Runde, und zwar schon beim Mindesteinsatz von 50 Chips. Der Deckel stand nirgends. Jetzt steht er unter der Leiter, und die Stufen, die bei DEINEM Einsatz abgeschnitten werden, sind durchgestrichen. Tippst du einen anderen Betrag, ändert sich das mit." },
        { icon: "poker", titel: "Poker zählte nur die Gewinner",
          text: "Wer gepasst hat, tauchte in der Wertung gar nicht auf: kein Eintrag in der Statistik, keine XP für die Hand, und der verlorene Einsatz fehlte im Wochen-Netto. Bei einem Spiel, bei dem Passen der häufigste Ausgang ist, sah Poker dadurch dauerhaft profitabler aus als es ist." },
        { icon: "mines", titel: "Multiplikatoren deutsch geschrieben",
          text: "In Mines und Towers stand „×13.05“ mit englischem Punkt, während im Rest des Hauses überall Komma steht. Jetzt „×13,05“." },
      ],
    },
    {
      id: "2026-09-16",
      datum: "9. September 2026",
      titel: "Zwei Fehler behoben",
      items: [
        { icon: "blackjack", titel: "Blackjack zog zwei Karten auf einmal",
          text: "Ein Tipp auf „Karte“ hat zwei Karten gezogen, was eine Hand natürlich sofort ruinieren konnte. Jeder Knopf am Tisch war doppelt verdrahtet: die Seite hat die Knöpfe zweimal angemeldet, einmal sofort und einmal noch mal, wenn das Dokument fertig geladen war. Betraf auch Geben, Halten, Verdoppeln und Teilen." },
        { icon: "horses", titel: "Renn-Champion: Gleichstand wurde falsch behandelt",
          text: "Wer gleich viele Tagessiege hatte, bekam trotzdem verschiedene Plätze, rein danach wie die Konten zufällig sortiert lagen. Und das entschied über echtes Geld: bei drei Siegen gleichauf bekam der eine den Preis und der andere nichts. Jetzt heißt gleich viele Siege gleicher Platz, alle Gleichauf-Stehenden stehen auf dem Treppchen, und sie teilen sich die Preise der belegten Plätze. Ausgeschüttet wird insgesamt genauso viel wie vorher." },
      ],
    },
    {
      id: "2026-09-15",
      datum: "8. September 2026",
      titel: "Mitspieler direkt einladen",
      items: [
        { icon: "rufen", titel: "Hol dir jemanden an den Tisch",
          text: "Wenn du in einer Lobby sitzt, taucht unten rechts ein Knopf auf. Ein Tipp darauf zeigt alle, die gerade online sind, samt der Stelle wo sie stecken (in der Lobby, an den Slots, bei Mines). Du wählst jemanden aus, und bei ihm geht mitten auf dem Bildschirm eine Einladung auf: mitmachen oder später. Wer zusagt, landet direkt in deiner Runde, ohne Code abtippen." },
        { icon: "sperre", titel: "Endlich auch für private Runden",
          text: "Private Lobbys stehen in keiner Liste, bisher musste man den Code irgendwie durchsagen. Jetzt lädst du einfach ein, und nur wer eingeladen wurde, kommt rein. Der Code steht dabei nirgendwo öffentlich." },
        { icon: "chat", titel: "Und niemand wird zugespammt",
          text: "Dieselbe Person kannst du höchstens einmal pro Minute einladen, insgesamt höchstens acht Einladungen pro Minute. Wer schon in deiner Runde sitzt oder gerade gar nicht da ist, taucht in der Liste erst gar nicht auf." },
      ],
    },
    {
      id: "2026-09-14",
      datum: "8. September 2026",
      titel: "Offene Tische sagen jetzt Bescheid",
      items: [
        { icon: "ansage", titel: "Wer einen Tisch aufmacht, wird gehört",
          text: "Bisher konntest du eine Runde Roulette, Blackjack, Poker oder Memory aufmachen, allein davorsitzen und wieder gehen, ohne dass irgendwer davon erfahren hat. Man musste zufällig im selben Moment auf den richtigen Bildschirm schauen. Jetzt geht jede neu geöffnete Lobby einmal in den Chat, mit Spiel, Einsatz und wie viele Plätze noch frei sind. Wer gerade nicht da ist, bekommt eine Benachrichtigung, sofern er sie eingeschaltet hat. Es gilt für alle neun Spiele mit Lobby, vorher hatte nur Poker so etwas. Und keine Sorge wegen Zuspammen: pro Person und Spiel wird höchstens alle zehn Minuten etwas gesagt." },
        { icon: "chip", titel: "Bei großen Gewinnen stand Zeichensalat auf dem Bild",
          text: "Nach einer fetten Auszahlung erschien mittig die Gewinnsumme, und direkt dahinter ein Stück Programmcode statt der Chip-Marke. Ist behoben, überall wo eine große Gewinnanzeige aufgeht." },
      ],
    },
    {
      id: "2026-09-13",
      datum: "7. September 2026",
      titel: "Clan-Wappen und ein Filter für die Sprache",
      items: [
        { icon: "clans", titel: "Euer Clan bekommt ein Gesicht",
          text: "Gründer und Offiziere können ein eigenes Bild hochladen. Es steht im Clan-Bildschirm und neben eurem Tag in der Rangliste. Das Bild wird auf deinem Gerät zurechtgeschnitten und verkleinert, bevor überhaupt etwas losgeschickt wird, die Originaldatei verlässt dein Handy nicht. Passt ein fremdes Wappen nicht, gibt es daneben einen Melde-Knopf." },
        { icon: "sperre", titel: "Grobe Wörter werden gefiltert",
          text: "Im Chat werden sie mit Sternchen ersetzt, die Nachricht kommt trotzdem an. Bei Namen (Account, Clan, Pferd, Motto, Tischname, Eintritts-Spruch) wird die Eingabe abgelehnt, denn die stehen dauerhaft irgendwo. Wer schon einen Namen hat, behält ihn." },
      ],
    },
    {
      id: "2026-09-12",
      datum: "7. September 2026",
      titel: "Events kündigen sich jetzt an",
      items: [
        { icon: "uhr", titel: "Ein Event kommt nicht mehr aus dem Nichts",
          text: "Chip-Regen, Heist, Tresorkampf und Blitz-Quiz dauern unter zwei Minuten. Genau deshalb konnten sie dich nie per Benachrichtigung erreichen, die wäre später angekommen als das Ende. Also erwischten sie nur, wer zufällig gerade offen hatte. Jetzt lassen sie sich ankündigen: die Nachricht geht sofort raus („in fünf Minuten geht es los“), losgelegt wird erst danach. Damit hast du Zeit, dazuzukommen." },
        { icon: "ansage", titel: "Ansagen haben einen Ton",
          text: "Eine Wartungsansage sah bisher aus wie eine Einladung zum Turnier, beides dieselbe goldene Zeile. Jetzt sind sie unterscheidbar, und eine Ansage kann von selbst wieder verschwinden statt tagelang stehenzubleiben. Bei wichtigen kommt außerdem eine Benachrichtigung, wenn du gerade nicht da bist; abschalten kannst du das in den Einstellungen." },
      ],
    },
    {
      id: "2026-09-11",
      datum: "7. September 2026",
      titel: "Alles trägt dieselbe Handschrift",
      gross: true,
      items: [
        { icon: "menue", titel: "Das Menü sieht aus wie das Casino",
          text: "Hinter den drei Strichen standen sechzehn bunte Emoji, jedes aus einer anderen Ecke, jedes mit eigener Farbe, die zu höchstens einem der drei Designs passte. Direkt daneben trugen die Spielkacheln längst gezeichnete Symbole. Jetzt ist alles gezeichnet und nimmt die Farbe des Designs an: in Neon türkis, in Klassik gold. Dasselbe gilt für die Kopfzeile, die Überschriften und die Knöpfe in den Spielen." },
        { icon: "chip", titel: "Chips sehen überall gleich aus",
          text: "Hinter jeder Zahl im Haus stand ein Münz-Emoji, das auf jedem Gerät ein anderes Bild war und immer gelb blieb, auch wenn die rote Zahl davor einen Verlust meinte. Jetzt ist die Spielmarke gezeichnet und nimmt die Farbe der Zahl an: bei einem Gewinn grün, bei einem Verlust rot." },
        { icon: "statistik", titel: "Statistik zeigt, wohin die Chips gehen",
          text: "Vorher sieben gleich aussehende Zeilen untereinander, inklusive „Größter Einzelgewinn +0“, wenn man noch nie gespielt hatte. Jetzt stehen die Zahlen, die etwas sagen, als eigene Kacheln da, und die Bilanz je Spiel hat einen Balken: du siehst auf einen Blick, welches Spiel deine Kasse trägt und welches sie leert." },
        { icon: "clans", titel: "Clans: die Aufträge stehen jetzt vorn",
          text: "Der Clan war eine endlose Rolle aus neun Abschnitten. Auf dem iPad anderthalb Meter wischen, um zu sehen, wer überhaupt dabei ist. Jetzt stehen oben die Wochenaufträge und ein laufender Krieg, alles Übrige liegt hinter Reitern. Neu ist, wer was beigetragen hat: bei jedem Auftrag und bei jedem Mitglied steht, wie viel diese Woche von wem kam." },
        { icon: "season", titel: "Jede Woche andere Clan-Aufträge",
          text: "Es waren jahrelang dieselben vier. Jetzt wird montags aus einem Vorrat gezogen: ein kleiner Auftrag zum Reinkommen, ein großer, für den ihr einander braucht, und zwei wechselnde. Dabei ist immer mindestens einer, den man auch allein erledigen kann. Eine Woche, in der alles an Duellen hängt, gibt es nicht mehr." },
        { icon: "krieg", titel: "Der Clan-Krieg sagt endlich die Wahrheit",
          text: "Er wirkte tot, war es aber nie: gezählt wird längst die Season-XP, die beide Clans über mehrere Tage zusammen sammeln, dafür muss niemand gleichzeitig online sein. Die Anzeige sprach trotzdem von Duell-Siegen, zeigte zwei nackte Zahlen und eine Restzeit, die stillstand. Jetzt: ein Balken, der zeigt wie knapp es ist, eine laufende Uhr, und die Liste, wer gerade trägt. Duell-Siege zählen jetzt spürbar mit statt mit einem einzigen Punkt." },
        { icon: "kicken", titel: "Knöpfe, die man auf dem iPad auch versteht",
          text: "Im Clan standen ein Pfeil nach unten und ein Verbotsschild nebeneinander, und einer der beiden warf jemanden raus. Was welcher war, stand nur in einem Tooltip, den es auf dem iPad gar nicht gibt. Dasselbe galt für ein gutes Dutzend weiterer Knöpfe. Jetzt steht das Wort daneben." },
        { icon: "aktualisieren", titel: "Was sonst noch klemmte",
          text: "Wer die Seite auf einem Unterbildschirm neu lud oder einen geteilten Link öffnete, landete manchmal auf einem Bildschirm, der für immer „Lädt…“ anzeigte. Das Comeback-Fenster ließ sich nur über seinen einen Knopf schließen, nicht mit Escape oder einem Tipp daneben. Und beim Clan-Krieg konnte man eine Dauer eintippen, die es gar nicht gibt. 5 Tage wurden stillschweigend zu 3." },
      ],
    },
    {
      /*
       * Der Sammel-Eintrag zum Comeback.
       *
       * Zwischen Juli und September war die Seite weg. In den zwei Tagen des
       * Umbaus sind daraus siebzehn einzelne Eintraege geworden. Die stehen
       * weiter im Updates-Tab, aber wer nach zwei Monaten reinkommt, soll
       * nicht siebzehn Kaesten durchscrollen. `soloImFenster` sagt dem
       * Comeback-Fenster: zeig nur das hier, der Rest ist die Fussnote.
       */
      id: "2026-09-09",
      datum: "Wiedereröffnung",
      titel: "Das Casino ist zurück",
      gross: true,
      soloImFenster: true,
      intro: "Zwei Monate war zu. In der Zeit ist fast alles überarbeitet worden. Das Wichtigste in Kürze, alles Einzelne steht im Menü unter Updates.",
      items: [
        { icon: "season", titel: "Season-Bildschirm neu", text: "Vorher eine senkrechte Liste aus zwanzig gleichen Zeilen: runterscrollen, abholen, fertig. Jetzt siehst du oben deine Stufe als große Zahl, wie weit es bis zur nächsten ist und was dort wartet, darunter alle zwanzig Stufen auf einen Blick, und die Belohnungen als Bahn, die automatisch dorthin springt, wo du stehst. Abholbares leuchtet, und es gibt einen Knopf, der alles Offene auf einmal holt. Oben rechts am Menü steht eine Zahl, wenn etwas auf dich wartet." },
        { icon: "kosmetik", titel: "Gewinne werden gefeiert", text: "Wie laut, hängt davon ab, wie groß der Gewinn für dich war: gemessen am Vielfachen deines Einsatzes und daran, wie viel dein Guthaben dazu ist. Dieselbe Runde feiert bei jemandem mit 30.000 also lauter als bei jemandem mit drei Millionen, und das ist so gewollt. Ab der dritten Stufe läuft zusätzlich ein Farbschwall über den ganzen Bildschirm, beim Blitzschlag wackelt er." },
        { icon: "businesses", titel: "Neue Lobby, drei Designs, eigene Symbole", text: "Guthaben und Level stehen oben, darunter die Spiele nach Kategorie, jedes mit eigener Farbe und gezeichnetem Logo. Mit dem Stern heftest du dir Lieblingsspiele nach oben. Umschalten kannst du zwischen Klassik, Mitternacht und Neon; die Wahl gilt auf allen deinen Geräten. Auf dem iPad lässt sich das Casino über „Zum Home-Bildschirm“ als richtige App ablegen, und die Zurück-Geste geht endlich einen Bildschirm zurück statt aus der App heraus." },
        { icon: "bestenliste", titel: "Wochenrekorde: gegeneinander, ohne Termin", text: "Das größte Problem war nie der Inhalt, sondern die Uhrzeit: Poker, Duelle, Lobbys und Clan-Kriege verlangen alle, dass zwei Leute gleichzeitig da sind. Jedes Spiel merkt sich jetzt eine Woche lang die beste Runde, mit Namen. Gewertet wird das Vielfache deines Einsatzes, nicht die Höhe des Gewinns: mit 200 Chips hast du dieselbe Chance wie jemand mit zwei Millionen. Bei Blackjack zählt stattdessen die längste Serie gewonnener Hände." },
        { icon: "uhr", titel: "Sudoku-Duell, das man versetzt spielt", text: "Herausforderung aufmachen, Rätsel sofort lösen, dein Ergebnis wartet. Kommt später jemand vorbei, sieht er dein Ergebnis, nimmt an und spielt dasselbe Rätsel. Niemand muss auf jemanden warten. Nimmt 48 Stunden lang niemand an, bekommst du deinen Einsatz zurück." },
        { icon: "ansage", titel: "Das Casino meldet sich", text: "Wenn wirklich etwas los ist: ein Turnier läuft, jemand macht einen Poker-Tisch auf, jemand hat deinen Rekord geschlagen. Dazu ein Knopf „Mitspieler rufen“, mit dem du den anderen kurz Bescheid gibst, dass du da bist. Und unter der Online-Liste steht, wer zuletzt hier war, damit man sieht, ob sich Warten lohnt." },
        { icon: "season", titel: "Season 2 läuft: Porta-Herbst", text: "Acht Wochen, zwanzig Stufen. XP sammelst du einfach beim Spielen, jeden Tag gibt ein anderes Spiel doppelte XP, und wer an aufeinanderfolgenden Tagen spielt, sammelt schneller. Unterwegs vier Sachen, die es nirgends zu kaufen gibt." },
        { icon: "clans", titel: "Clans zählen endlich mit", text: "Vorher hing am Clan alles an Duell-Siegen, weshalb seit Monaten nichts passierte. Jetzt zählt jede Runde, die irgendwer spielt, für den ganzen Clan. Die Schatzkammer ist keine Einbahnstraße mehr: Gründer und Offiziere können an Mitglieder auszahlen." },
        { icon: "businesses", titel: "Die Stadt gehört nicht mehr einem allein", text: "Unter der Karte steht jetzt, wem wie viel gehört, und ein Tipp auf jemanden zeigt seine Häuser mit dem Preis, den DU für eine Übernahme zahlen würdest. Übernehmen ging immer schon, aber niemand hat es gefunden. Dazu eine Staffel: jedes Haus, das du hast, macht das nächste etwas teurer. Wer hortet, zahlt mehr; wer anfängt, zahlt den vollen Wert." },
        { icon: "kosmetik", titel: "Kosmetik: neun Arten statt zwei", text: "Vorher ein Emoji und eine Schriftfarbe. Jetzt animierte Namensstile, Titel, Rahmen ums Bild, Namensschilder für die Listen, Profil-Banner, Gewinn-Effekte und ein Eintritts-Spruch im Chat. Zwei Stücke sind nicht käuflich: sie kommen für eine komplette Straße und dafür, Boss eines Ortsteils zu sein." },
        { icon: "work", titel: "Arbeiten ist jetzt Arbeit im Casino", text: "Kellner, Kasse, Croupier, Sicherheit. Und die Aufgaben sind das, was man dort können muss: wechseln, richtig auszahlen, Quoten rechnen, einen falschen Wettschein erkennen. Vorher waren drei Aufgabentypen rechnerisch unlösbar: du hast richtig gelöst, bekamst nichts, und die Wartezeit lief trotzdem." },
        { icon: "wuerfel", titel: "Die Spiele sehen anders aus", text: "Mines, Towers und Memory hatten leere Vierecke, in denen ein Emoji auftauchte. Die Kacheln klappen jetzt um und dahinter liegen gezeichnete Motive. Blackjack hat einen Filztisch mit Bande, Roulette ein liegendes Tableau wie am echten Tisch, Sportwetten einen Liga-Filter statt siebzig offener Spiele, Crash Hilfslinien für die Multiplikatoren." },
        { icon: "einstellungen", titel: "Und eine Menge kaputter Sachen repariert", text: "Crash und die Rennbahn zeichneten gar nichts mehr. Nach einem Update wurde niemand mehr zum Neuladen aufgefordert. Der Login versprach 1.000 Startchips statt 5.000. Angezeigte Belohnungen stimmten nicht mit den ausgezahlten überein. Und jede Spielkachel hatte ein leeres Zwillingsfeld daneben." },
      ],
    },
    {
      id: "2026-09-08-g",
      datum: "8. September 2026",
      titel: "Das Willkommens-Paket wird ausgepackt",
      items: [
        { icon: "geschenk", titel: "Erst antippen, dann auspacken", text: "Vorher lief das Abholen still ab: eine Zahl flog hoch, ein Hinweis blitzte auf, weg. Die beiden Kosmetik-Stücke standen als Nebensatz darin und waren nach vier Sekunden fort, man hat also nie gesehen, dass man sie hat, dabei sind genau die das Besondere am Paket. Jetzt steht ein verschnürtes Paket da, das du antippst: der Deckel fliegt weg, der Salut geht los, und jede Belohnung kommt als eigene Karte. Die beiden Stücke sind als „Nur jetzt“ markiert, und ein Knopf bringt dich direkt zur Kosmetik, um sie anzulegen." },
        { icon: "level", titel: "Die Zahl oben rechts sagt jetzt auch, woher sie kommt", text: "Am Menü-Knopf stand nur eine Zahl. Wer aufmachte, stand vor zwölf gleich aussehenden Zeilen und musste raten, welche gemeint war. Jetzt trägt der Eintrag dieselbe Zahl: beim Season-Pass, bei den Updates, und das Willkommens-Paket taucht als eigener Eintrag ganz oben auf, solange es abzuholen ist." },
      ],
    },
    {
      id: "2026-09-08-f",
      datum: "8. September 2026",
      titel: "Man sieht jetzt, was nur kurz zu haben ist",
      items: [
        { icon: "uhr", titel: "Marke auf zeitlich begrenzter Kosmetik", text: "Im Shop stand an allem, was man nicht kaufen kann, dasselbe Schloss: an Season-Stücken, an den Comeback-Stücken und an denen, die man sich in der Stadt verdient. Man konnte nicht sehen, wo es eilt. Jetzt trägt jedes eine Marke mit Restzeit: „Season 2, noch 54 Tage“, „Nur jetzt, noch 13 Tage“ für die Wiedereröffnung, „Zu verdienen“ für alles, was dauerhaft erreichbar bleibt. Ist ein Fenster zu, steht „Vorbei“ da statt eines Schlosses, das nach einem Fehler aussieht." },
      ],
    },
    {
      id: "2026-09-08-e",
      datum: "8. September 2026",
      titel: "Pinco und Crash nachgezogen",
      items: [
        { icon: "pinco", titel: "Pinco: echte Nägel", text: "Die Nägel waren flache graue Punkte, die auf dem dunklen Brett wie Staub aussahen. Jetzt sind es kleine Metallstifte mit Glanz oben links, dunklem Rand unten rechts und einem Schatten darunter, und sie sind etwas größer." },
        { icon: "crash", titel: "Crash: Hilfslinien", text: "Die Fläche war eine leere dunkle Box: man sah die Zahl steigen, aber nicht, wie weit oben man ist. Jetzt liegen Marken bei 1,5×, 2×, 3×, 5× und 10× im Bild, auf derselben Skala wie die Flugbahn. Erreichte Marken leuchten in der Farbe der Rakete, die noch offenen bleiben gestrichelt." },
      ],
    },
    {
      id: "2026-09-08-d",
      datum: "8. September 2026",
      titel: "Mines, Towers und Memory sehen aus wie Spiele",
      gross: true,
      intro: "Alle drei waren leere Vierecke, in denen beim Antippen ein Emoji erschien. Kein Moment, keine Bewegung, und auf jedem Gerät ein anderes Bild.",
      items: [
        { icon: "mines", titel: "Mines", text: "Die Felder haben jetzt einen echten Deckel mit Struktur und Wölbung und klappen beim Aufdecken um. Dahinter liegt ein gezeichneter Edelstein, der grün glüht, oder eine gezeichnete Bombe. Die Bombe, die du erwischst, bekommt eine Druckwelle und rüttelt; die anderen bleiben zurückgenommen im Hintergrund." },
        { icon: "towers", titel: "Towers", text: "Dieselben zwei Seiten, hier klappt die Kachel nach hinten weg. Ei und Totenkopf sind gezeichnet statt Emoji, das gewählte Feld leuchtet grün, Fallen rot." },
        { icon: "memory", titel: "Memory", text: "Endlich echte Karten: gemusterte Rückseite mit Rahmen, und beim Antippen dreht sich die Karte um. Bei einem Spiel, dessen ganzer Vorgang das Umdrehen ist, war das vorher nur ein Emoji, das im Viereck auftauchte." },
        { icon: "einstellungen", titel: "Weiterhin abschaltbar", text: "Wer in den Einstellungen „Bewegung reduzieren“ anhat, sieht dieselben Bilder ohne Drehung. Der Effekt entfällt, die Information nicht." },
      ],
    },
    {
      id: "2026-09-08-c",
      datum: "8. September 2026",
      titel: "Rahmen sitzt, Mines und Towers aufgeräumt",
      items: [
        { icon: "kosmetik", titel: "Der Rahmen lag neben dem Bild", text: "Im Profil steckt das Bild schon in einem runden Kasten. Der gekaufte Rahmen zeichnete darin einen zweiten, größeren Kreis, der über den Rand hinausstand. Jetzt liegt er genau auf dem vorhandenen Kreis, und es ist nur noch einer zu sehen. Auch oben in der Leiste, wo das Bild vorher gar nicht quadratisch war und der Ring deshalb eine Ellipse wurde." },
        { icon: "chip", titel: "Das Einsatzfeld war zusammengequetscht", text: "Min, ½, 2× und Max standen als vier schmale Streifen neben dem Eingabefeld statt darunter. Das Feld nimmt jetzt die ganze Breite, ist höher und die Schnellwahl hat eine eigene Zeile. Gilt in Mines, Towers, Crash und Pinco." },
        { icon: "statistik", titel: "Die Auszahlungstabelle hatte keinen Platz", text: "In Mines drängten sich Überschrift, fünf Stufen und der Höchstgewinn in einer einzigen Zeile. Jetzt drei Ebenen: Überschrift, ein Raster mit Luft dazwischen, und der Höchstgewinn als eigene Zeile darunter." },
      ],
    },
    {
      id: "2026-09-08-b",
      datum: "8. September 2026",
      titel: "Kosmetik auch in der Statistik, weiße Figuren sichtbar",
      items: [
        { icon: "statistik", titel: "Die Statistik zeigt jetzt auch die Visitenkarte", text: "Wer in der Bestenliste auf einen Namen tippt, landet in der Statistik. Dort stand ein eigener Kasten mit dem nackten Emoji und der flachen Namensfarbe: Banner, Namensstil, Rahmen und Titel fehlten ausgerechnet an der Stelle, wo man am häufigsten hinkommt. Jetzt steht dort dieselbe Visitenkarte wie im Profil." },
        { icon: "einstellungen", titel: "Titel klebte am Namen", text: "In der Bestenliste stand der Titel ohne Leerzeichen direkt hinter dem Namen." },
        { icon: "chess", titel: "Weiße Schachfiguren waren fast unsichtbar", text: "Für Weiß wurden die Umriss-Zeichen benutzt und weiß eingefärbt. Übrig blieb ein dünner weißer Strich, der auf hellen Feldern verschwand. Beide Farben benutzen jetzt die gefüllte Figur, Weiß mit dunklem Rand, Schwarz mit hellem. So macht es jedes Schachbrett." },
      ],
    },
    {
      id: "2026-09-08",
      datum: "8. September 2026",
      titel: "Angezeigte Beträge stimmen jetzt",
      items: [
        { icon: "chip", titel: "Aufträge, Kalender und Glücksrad zeigten zu viel", text: "Ab einer Million Vermögen werden Gratis-Einnahmen abgeschwächt. Angezeigt wurde trotzdem der volle Betrag: da stand 3.200 und es kamen 2.100 an, was nach einem Fehler aussieht statt nach einer Regel. Überall steht jetzt die Zahl, die wirklich ankommt, und darüber eine Zeile, warum sie kleiner ist. Dasselbe in der Season-Leiter. Wer unter einer Million liegt, also fast alle, merkt davon nichts." },
        { icon: "speichern", titel: "Sudoku-Duell überlebt das Neuladen", text: "Ein Duell läuft dreißig Minuten. Auf dem iPad räumt Safari den Tab in der Zeit gern weg, und beim Zurückkommen stand ein leeres Rätsel da: die halbe Stunde Arbeit weg, der Einsatz bezahlt. Der Zwischenstand bleibt jetzt erhalten, samt Uhr." },
        { icon: "blackjack", titel: "Blackjack-Serie überlebt einen Neustart", text: "Die laufende Serie wurde erst gespeichert, wenn zufällig etwas anderes speicherte. Bei einem Server-Neustart war sie deshalb manchmal weg." },
      ],
    },
    {
      id: "2026-09-07-profil",
      datum: "7. September 2026",
      titel: "Fremde Profile zeigen jetzt das ganze Profil",
      items: [
        { icon: "profil", titel: "Nicht mehr nur eine Zahlentabelle", text: "Wer jemanden antippte, sah Chips, Networth und Spiele. Jede gekaufte Kosmetik war damit für alle anderen unsichtbar, und genau dafür kauft man sie. Jetzt steht dort dieselbe Visitenkarte wie im eigenen Profil: Banner, Namensstil, Rahmen, Titel, Level, Imperium und die geschafften Achievements." },
        { icon: "sperre", titel: "Zwei Unterschiede, mit Absicht", text: "Die gesperrten Achievements fehlen, denn was jemand noch nicht geschafft hat, geht niemanden etwas an. Und statt „Abmelden“ stehen dort Statistik und Herausfordern." },
      ],
    },
    {
      id: "2026-09-07-fix",
      datum: "7. September 2026",
      titel: "Kachel-Chaos behoben und fünf echte Gewinn-Effekte",
      gross: true,
      items: [
        { icon: "quests", titel: "Jede Kachel hatte ein leeres Zwillingsfeld", text: "Der Favoriten-Stern war eine Schaltfläche innerhalb der Kachel, die selbst eine Schaltfläche ist. Das ist ungültiges HTML: der Browser reißt den Stern heraus und hängt ihn als eigenes Feld daneben. Im Raster stand deshalb hinter jedem Spiel eine zweite, graue Kachel mit nur einem Stern darin, und die Reihenfolge sah zerwürfelt aus. Den Fehler hatte ich beim Bau der neuen Lobby eingebaut, er ist jetzt weg." },
        { icon: "stocks", titel: "Alte Rekorde standen als NaN da", text: "Beim Umbau auf Serien statt Vielfache habe ich die vorhandenen Einträge nicht mitgenommen. Towers und Mines zeigten „NaN×“, Blackjack „undefined Siege am Stück“. Alte Einträge werden jetzt umgerechnet; der Blackjack-Eintrag ist weg, weil sich ein Vielfaches nicht in eine Serie umrechnen lässt." },
        { icon: "kosmetik", titel: "Die Gewinn-Effekte sind jetzt wirklich verschieden", text: "Vorher war alles außer dem Blitz dasselbe Konfetti in anderen Farben. Jetzt hat jeder seine eigene Form und Bewegung: Münzen springen von unten hoch und fallen zurück, der Goldregen ist ein dichter Vorhang senkrechter Streifen, das Feuerwerk sind drei Explosionen mit radial wegfliegenden Funken, der Blitz zieht einen gezackten Schlag über den Schirm, und der Sternenfall sind wenige große Sterne, die langsam schräg durchziehen." },
        { icon: "ansage", titel: "Namensschild", text: "Deine ganze Zeile in der Online-Liste und der Bestenliste bekommt Farbe, nicht nur der Ring ums Bild: Messing, Jade, Rubin, Karo, Neon, ein pulsierendes Herzschlag-Schild und ein wanderndes Prisma." },
        { icon: "bearbeiten", titel: "Eigener Eintritts-Satz", text: "Das teuerste Stück im Laden. Du schreibst deinen eigenen Satz, dein Name steht dabei immer davor und lässt sich nicht wegschreiben, und mehr als 60 Zeichen gehen nicht. Damit kann man sich etwas ausdenken, aber niemandem etwas in den Mund legen." },
        { icon: "kosmetik", titel: "Auch die Rekord-Karten haben jetzt die Zeichnungen", text: "Sie trugen noch Emoji, während die Kacheln darüber schon gezeichnete Symbole hatten." },
      ],
    },
    {
      id: "2026-09-07-style",
      datum: "7. September 2026",
      titel: "Eigene Spiel-Symbole und drei neue Kosmetik-Arten",
      gross: true,
      items: [
        { icon: "kosmetik", titel: "Die Kacheln haben jetzt gezeichnete Symbole", text: "Vorher stand in jeder Kachel ein Emoji. Die sehen auf jedem Gerät anders aus, bringen ihre eigenen Farben mit und passen zu keinem der drei Designs. Und manche sagten schlicht nichts: Pinco Ball war ein grüner Kreis, was ein Spiel mit Nägeln und Fächern überhaupt nicht beschreibt. Jetzt hat jedes Spiel eine eigene Zeichnung, die die Farbe des Spiels annimmt." },
        { icon: "kosmetik", titel: "Gewinn-Effekt", text: "Was auf dem Bildschirm passiert, wenn du groß gewinnst: Konfetti, Münzflut, Goldregen, Feuerwerk, Blitzschlag oder Sternenfall. Das ist die Kosmetik, die du selbst am häufigsten siehst. Im Shop einmal antippen spielt sie ab, bevor du zahlst." },
        { icon: "rundgang", titel: "Eintritts-Spruch", text: "Eine Zeile im Chat, wenn du reinkommst: „Vorsicht, Tom ist wieder im Spiel.“ Das ist die einzige Kosmetik, die die anderen sehen, ohne dich anzutippen. Höchstens einmal pro Stunde, damit ein Verbindungsabbruch keine Ansage wird." },
        { icon: "kosmetik", titel: "Profil-Banner", text: "Der Streifen hinter deinem Namen im Profil: Filztisch, Mitternacht, Abendrot, Weserwelle, Blattgold und ein bewegtes Nordlicht. Das Erste, was jemand sieht, der dich antippt." },
      ],
    },
    {
      id: "2026-09-07",
      datum: "7. September 2026",
      titel: "Rekorde repariert und ehrlich gerechnet",
      gross: true,
      intro: "Zwei Fehler bei den Wochenrekorden, und ein Balancing, das ich mit den falschen Zahlen gemacht hatte. Beides korrigiert.",
      items: [
        { icon: "pinco", titel: "Pinco zählte gar nicht", text: "Pinco fasst zehn Bälle zu einer Runde zusammen. Für den Rekord war das falsch: über zehn Bälle gemittelt verschwindet jeder gute Treffer im Durchschnitt, und wer mit einer Ballzahl aufhörte, die nicht durch zehn teilbar ist, wurde überhaupt nie gewertet. Jetzt zählt jeder Ball einzeln. Nebenbei gingen dadurch auch die letzten Bälle einer Sitzung für Statistik, Aufträge und Season verloren, auch das ist behoben." },
        { icon: "blackjack", titel: "Blackjack zählt jetzt Serien", text: "Blackjack zahlt höchstens das Zweieinhalbfache. Ein Rekord auf das Vielfache war dort nach der ersten Runde für immer festgenagelt, niemand hätte ihn je brechen können. Gewertet wird jetzt die längste Serie gewonnener Hände am Stück. Ein Unentschieden lässt die Serie stehen, eine verlorene Hand beendet sie." },
        { icon: "einstellungen", titel: "Jedes Spiel hat seine eigene Hürde", text: "Pinco kann höchstens 15,23 zahlen, Mines geht ins Unermessliche. Deshalb zählt bei Pinco ab dem Doppelten, bei Slots erst ab dem Fünffachen. Was gilt, steht auf jeder Karte." },
        { icon: "waage", titel: "Einsatzgrenzen neu, diesmal mit den echten Zahlen", text: "Ich hatte Mines und Towers auf 250.000 gesetzt, nach den Testdaten auf meinem Rechner. Im echten Casino sind 8,6 Millionen Chips insgesamt im Umlauf und das mittlere Guthaben liegt bei 25.000. Beide stehen jetzt bei 50.000, Crash bei 250.000 statt einer Million, Sportwetten bei 500.000 statt fünf Millionen. Höchstgewinn pro Runde in Mines und Towers: zwei Millionen." },
        { icon: "waage", titel: "Die Vermögensbremse greift endlich", text: "Der Stunden-Bonus, Aufträge, das Rad und der Kalender werden für sehr reiche Spieler abgeschwächt. Nur begann das erst ab zehn Millionen Vermögen, und das höchste im ganzen Casino sind 5,7 Millionen. Die Bremse hat also bei niemandem gewirkt. Jetzt setzt sie ab einer Million ein: 61 von 71 Konten merken davon gar nichts." },
        { icon: "season", titel: "Season neu gerechnet", text: "Die Season hätte 1,5 Millionen Chips ausgeschüttet, also fast so viel, wie der reichste Spieler überhaupt besitzt. Jetzt sind es 580.500, weiterhin der mit Abstand größte Einzelpreis im Casino. Abgeholt hatte noch niemand etwas, es geht also niemandem etwas verloren." },
        { icon: "kalender", titel: "Season-Kosmetik neu", text: "Die Belohnung auf Stufe 10 war eine flache orange Namensfarbe, also genau das, was man sich auch kaufen kann. Jetzt gibt es dort den animierten Stil „Bernstein“, auf Stufe 15 zusätzlich zum Wolf einen Wolfsring ums Bild, und auf Stufe 20 den Phönix-Avatar, den Namensstil „Glut“ und den Titel „Phönix von Porta“. Nichts davon ist käuflich." },
        { icon: "krone", titel: "Stadtteil-Boss-Kosmetik kam nicht an", text: "Die Krone für den Ortsteil-Boss wurde nur geprüft, wenn man gerade etwas kaufte. Wer seinen Ortsteil längst erobert hatte, wartete deshalb ewig. Jetzt reicht es, die Stadt zu öffnen." },
      ],
    },
    {
      id: "2026-09-06-dialoge",
      datum: "6. September 2026",
      titel: "Keine grauen Systemfenster mehr",
      items: [
        { icon: "updates", titel: "Eigene Dialoge", text: "An achtzehn Stellen kam bisher das graue Fenster des Browsers hoch: Clan verlassen, Kriegs-Einsatz eingeben, Pferd umbenennen, Kopfgeld aussetzen, Automat freischalten, Backup einspielen. Auf dem iPad sah das jedes Mal aus, als wäre etwas kaputt. Jetzt passen sie zum Rest, und die Knöpfe sind groß genug zum Treffen." },
        { icon: "uhr", titel: "Und wichtiger: nichts steht mehr still", text: "Die alten Browser-Fenster halten das ganze Spiel an, solange sie offen sind. Chat, Uhren, laufende Runden, alles eingefroren, bis jemand auf OK tippt. Das ist jetzt vorbei." },
      ],
    },
    {
      id: "2026-09-06-duell",
      datum: "6. September 2026",
      titel: "Sudoku-Duell, ohne Termin",
      gross: true,
      intro: "Sudoku-Race, Memory, Schach und Solitär-Race verlangen alle, dass zwei Leute im selben Moment vor dem Bildschirm sitzen. Genau das passiert bei uns fast nie, deshalb standen sie monatelang still.",
      items: [
        { icon: "uhr", titel: "Du spielst sofort, dein Gegner wann er will", text: "Neuer Reiter im Sudoku: Herausforderung aufmachen, Einsatz setzen, Rätsel sofort lösen. Dein Ergebnis wartet dann. Kommt später jemand vorbei, sieht er „Tom hat 81 Felder in 6:12 geschafft“, nimmt an, löst dasselbe Rätsel und erfährt sofort, ob er besser war. Niemand muss auf jemanden warten." },
        { icon: "quests", titel: "Du siehst, was du schlagen musst", text: "Wer annimmt, hat den Wert des Gegners von Anfang an als Balken vor sich. Gewertet wird erst die Zahl richtiger Felder, dann die Zeit: wer löst, gewinnt gegen jeden, der nicht gelöst hat, egal wie schnell." },
        { icon: "clans", titel: "Warten kostet nichts", text: "Nimmt 48 Stunden lang niemand an, bekommst du deinen Einsatz zurück. Wer annimmt und dann nicht abgibt, verliert; wer selbst nicht fertig spielt, bekommt sein Geld zurück statt es 48 Stunden zu binden. Unentschieden gibt beiden den Einsatz zurück, ohne Abzug." },
        { icon: "ansage", titel: "Du erfährst, wie es ausging", text: "Wartende Herausforderungen stehen oben in der Lobby. Und wenn dein Duell entschieden wird, während du weg bist, sagt dir das Casino Bescheid, falls du Benachrichtigungen anhast." },
      ],
    },
    {
      id: "2026-09-06-mines",
      datum: "6. September 2026",
      titel: "Mines und Towers überarbeitet",
      items: [
        { icon: "statistik", titel: "Du siehst vorher, was es bringt", text: "In Mines stand die Minenzahl in einem Zahlenfeld, ohne dass irgendwo gestanden hätte, was zwei Minen gegenüber zwanzig zahlen. Jetzt sind die Minen eine Knopfreihe, und darunter steht die Auszahlung für 1, 2, 3, 5 und 10 Felder." },
        { icon: "wuerfel", titel: "Zufälliges Feld und Autoplay", text: "Beim Aufdecken gibt es nichts zu können, jedes verdeckte Feld ist gleich wahrscheinlich. Deshalb ein Knopf, der eins für dich aufdeckt, und einer, der so lange weitermacht, bis dein Ziel-Multiplikator erreicht ist, und dann automatisch auszahlt. Auf dem iPad muss man damit nicht mehr auf winzige Kacheln zielen." },
        { icon: "chip", titel: "Einsätze passen wieder zu euren Konten", text: "Mines war bei 10.000 gedeckelt, Towers bei 50.000. Diese Zahlen sind aus der Anfangszeit, als das viel war. Beide stehen jetzt bei 250.000. Der Hausvorteil bleibt bei 2 Prozent, es ändert sich nur, wie groß die Schwankung sein darf." },
        { icon: "hilfe", titel: "Deckel bei 50 Millionen pro Runde", text: "Neu dazu, und zwar aus einem Grund: bei 15 Minen zahlt das komplette Leerräumen rund 3,2 Millionen mal den Einsatz. Mit dem neuen Limit wären das 800 Milliarden Chips aus einer einzigen Runde. Das passiert etwa einmal in 3,3 Millionen Versuchen, also praktisch nie, aber es würde die Wirtschaft auf einen Schlag erledigen. Der Deckel steht sichtbar in der Auszahlungstabelle." },
        { icon: "blitz", titel: "Schnellwahl beim Einsatz", text: "Min, ½, 2× und Max unter dem Einsatzfeld, in Mines und Towers. Max nimmt nie mehr, als du wirklich hast." },
        { icon: "uhr", titel: "Letzte Runden", text: "Unter beiden Spielen steht jetzt, wie die letzten zwölf Runden ausgegangen sind." },
      ],
    },
    {
      id: "2026-09-06-style",
      datum: "6. September 2026",
      titel: "Endlich mehr als ein Emoji",
      gross: true,
      intro: "Kosmetik hieß bisher: ein Emoji und eine flache Schriftfarbe. Beides sah bei allen gleich aus. Jetzt gibt es drei neue Sachen, und man sieht sie überall, wo dein Name steht.",
      items: [
        { icon: "kosmetik", titel: "Namensstile", text: "Dein Name bekommt einen Farbverlauf statt einer flachen Farbe, und die teureren bewegen sich: Goldschimmer, Puls, Neon, Regenbogen, Feuer und Glitch. Falls dir das zu unruhig ist, stehen sie still, sobald du in den Einstellungen „Bewegung reduzieren“ anhast." },
        { icon: "kosmetik", titel: "Titel", text: "Eine kleine Zeile unter deinem Namen: Stammgast, Nachtschicht, Pechvogel, Hochroller, Kartenzähler, Legende von Porta und ein paar mehr. Steht in der Online-Liste, der Bestenliste und auf deinem Profil." },
        { icon: "kosmetik", titel: "Rahmen", text: "Ein Ring um dein Bild. Silber und Gold ruhig, Kreisel, Flamme und Sternenring drehen sich." },
        { icon: "krone", titel: "Zwei Sachen kann man nicht kaufen", text: "Den Titel „Straßenkönig“ gibt es für die erste komplette Straße, den Namensstil „Krone“ dafür, dass du Boss eines Ortsteils bist. Damit hängt zum ersten Mal etwas Sichtbares daran, was du in der Stadt wirklich geschafft hast." },
        { icon: "feed", titel: "Vorschau vor dem Kauf", text: "Oben im Shop steht dein Name so, wie ihn die anderen sehen würden. Einmal antippen zeigt, zweimal kauft. Niemand soll eine Animation blind bezahlen." },
        { icon: "chat", titel: "Farben im Chat", text: "Der Chat hat Namen bisher grau angezeigt. Ausgerechnet dort, wo man sich am meisten sieht, war von gekaufter Kosmetik nichts zu sehen. Jetzt schon." },
      ],
    },
    {
      id: "2026-09-06-stadt",
      datum: "6. September 2026",
      titel: "Die Stadt gehört nicht einem allein",
      items: [
        { icon: "businesses", titel: "Wem gehört Porta", text: "Unter der Karte steht jetzt, wem wie viel gehört: Häuser, Wert, komplette Straßen, Trophäen. Tippst du jemanden an, siehst du seine Gebäude mit dem Preis, den DU für eine Übernahme zahlen würdest, günstigste zuerst. Übernehmen ging schon immer, aber man kam nur dran, indem man zufällig das richtige Haus antippte." },
        { icon: "stocks", titel: "Besitzer-Staffel", text: "Jedes Haus, das du schon hast, macht das nächste um 4 % teurer, gedeckelt beim Dreifachen. Bis zehn Häuser merkst du fast nichts, eine komplette Straße bleibt gut machbar. Wer dreißig hortet, zahlt mehr als das Doppelte. Verkaufserlös und die Entschädigung bei einer Übernahme bleiben beim Marktwert, es wird also nur das Weiterkaufen teurer, nichts weggenommen." },
        { icon: "kosmetik", titel: "Ehrliche Preise", text: "Der Übernahmepreis wurde vorher im Browser nachgerechnet. Jetzt kommt jede Zahl vom Server, inklusive Boss-Rabatt und Staffel, und auf dem Knopf steht genau das, was abgebucht wird." },
      ],
    },
    {
      // Zweiter Eintrag am selben Tag. Die Kennung bleibt sortierbar: sie ist
      // als Zeichenkette groesser als "2026-09-06" und kleiner als der
      // naechste Tag, das Comeback-Fenster zeigt sie also genau einmal.
      id: "2026-09-06-abend",
      datum: "6. September 2026",
      titel: "Gegeneinander spielen, ohne gleichzeitig da zu sein",
      gross: true,
      intro: "Fast alles Gesellige hier verlangte, dass zwei Leute zur selben Zeit online sind. Das passiert praktisch nie. Diese drei Sachen ändern das.",
      items: [
        { icon: "bestenliste", titel: "Wochenrekorde", text: "Jedes Spiel merkt sich eine Woche lang die beste Runde, mit Namen. Du kommst rein, siehst was die anderen hinterlassen haben, und kannst es schlagen. Gewertet wird nicht der größte Gewinn, sondern das beste Vielfache deines Einsatzes: mit 200 Chips hast du dieselbe Chance wie jemand mit zwei Millionen. Steht in der Lobby unter den Spielen, jeden Montag wieder frei." },
        { icon: "ansage", titel: "Benachrichtigungen", text: "Das Casino kann sich melden, wenn wirklich etwas los ist: ein Turnier oder eine Happy Hour läuft, jemand macht einen Poker-Tisch auf, jemand hat deinen Wochenrekord geschlagen, oder deine Login-Serie reißt gleich. Jeder Anlass ist einzeln abschaltbar, und solange du im Casino bist, kommt gar nichts. Auf dem iPad musst du die Seite dafür einmal über Teilen und \"Zum Home-Bildschirm\" ablegen, das verlangt Safari so. Einschalten in den Einstellungen." },
        { icon: "rufen", titel: "Mitspieler rufen", text: "Ein Knopf unten in der Lobby. Er schickt allen, die Benachrichtigungen anhaben, kurz Bescheid, dass du da bist. Höchstens alle drei Stunden pro Person, und wenn ihn gerade niemand bekommen kann, bleibt er dir erhalten." },
        { icon: "rundgang", titel: "Zuletzt hier", text: "Unter der Online-Liste steht jetzt, wer in den letzten Tagen da war und wann. Damit man sieht, ob hier vor zwanzig Minuten noch etwas los war oder seit einer Woche nichts mehr." },
        { icon: "bestenliste", titel: "Achievements auf dem iPad lesbar", text: "Wofür es ein Achievement gibt, stand nur im Tooltip, also nur sichtbar, wenn man mit einer Maus darauf zeigt. Auf dem iPad war die Information damit gar nicht erreichbar. Jetzt steht die Bedingung immer auf der Karte, dazu die Belohnung und bei den geschafften das Datum." },
      ],
    },
    {
      id: "2026-09-06",
      datum: "6. September 2026",
      titel: "Das Casino ist zurück",
      gross: true,
      intro: "Der erste Teil eines größeren Umbaus: alles sieht anders aus, und einiges läuft endlich so, wie es sollte.",
      items: [
        { icon: "season", titel: "Season 2 läuft: Porta-Herbst", text: "Acht Wochen, zwanzig Stufen, unterwegs vier Sachen, die es nirgends zu kaufen gibt (Joker, Bernstein-Namensfarbe, Wolf, Phönix). XP sammelst du einfach beim Spielen. Jeden Tag gibt ein anderes Spiel doppelte XP, und wer an aufeinanderfolgenden Tagen spielt, sammelt bis zu 50 % schneller." },
        { icon: "clans", titel: "Clans zählen endlich mit", text: "Bisher hing am Clan alles an Duell-Siegen: Fortschritt, Wochenliga, Clan-Kriege, zwei von drei Aufträgen. Deshalb standen alle Clans seit Monaten still. Jetzt zählt jede Runde, die irgendwer spielt, für den ganzen Clan: Season, Wochenliga, laufender Krieg und Aufträge. Die Clan-Stufen zahlen abwechselnd in die Schatzkammer und geben allen Mitgliedern bis zu 25 % mehr Season-XP." },
        { icon: "chip", titel: "Schatzkammer ist keine Einbahnstraße mehr", text: "Bisher konnte man nur einzahlen und nie wieder heran, außer als Einsatz für einen Clan-Krieg. Gründer und Offiziere können jetzt an Mitglieder auszahlen: um jemandem auszuhelfen, Kriegsgewinne zu teilen oder gute Leistung zu belohnen. Jede Bewegung steht mit Namen und Betrag im Clan-Protokoll und im Chat." },
        { icon: "work", titel: "Arbeiten neu: du arbeitest im Casino", text: "Die Jobs sind jetzt Rollen im Haus: Kellner, Kasse, Croupier, Sicherheit. Und die Aufgaben sind das, was man dort können muss: wechseln, richtig auszahlen, Quoten rechnen, einen falschen Wettschein erkennen. Statt Paketstapeln und Kabelfarben. Wer danebenliegt, bekommt trotzdem einen Trostlohn und erfährt die richtige Antwort. Der ganze Screen ist neu: oben steht, was du heute schon verdient hast und wie viel noch geht, die laufende Aufgabe steht ganz oben statt unter vier Karten. Und Arbeiten zählt jetzt für die Season mit." },
        { icon: "einstellungen", titel: "Crash und Arbeiten repariert", text: "Crash zeichnete nichts mehr und man kam nie zum Setzen, die Rennbahn blieb leer. Ursache war ein Fehler von mir aus dem letzten Update. Bei den Mini-Jobs waren drei Aufgabentypen rechnerisch unlösbar: du hast richtig gelöst und trotzdem nichts bekommen, die Wartezeit lief aber. Beides behoben." },
        { icon: "businesses", titel: "Neue Lobby", text: "Guthaben und Level stehen jetzt oben, darunter die Spiele nach Kategorie sortiert. Jedes Spiel hat seine eigene Farbe, und du siehst auf der Karte, wer gerade dort spielt. Mit dem Stern heftest du dir deine Lieblingsspiele nach oben." },
        { icon: "kosmetik", titel: "Drei Designs", text: "Klassik (Filzgrün und Gold), Mitternacht (Marineblau) und Neon (fast schwarz mit Türkis). Umschalten in den Einstellungen. Die Wahl gilt auf allen deinen Geräten." },
        { icon: "blackjack", titel: "Blackjack am echten Tisch", text: "Filz mit Bande, größere Karten, der Einsatz als Chipstapel und die Hausregel auf dem Tisch. Geteilte Hände stehen nebeneinander, die aktive ist hervorgehoben." },
        { icon: "einstellungen", titel: "Ton in mehr Spielen", text: "Mines, Towers, Crash und Pinco haben jetzt Klang. In Mines und Towers steigt der Ton mit jedem sicheren Zug. Große Gewinne werden überall gefeiert, nicht nur an den Slots. Alles abschaltbar." },
        { icon: "blitz", titel: "Schneller und app-tauglich", text: "Die Seite lädt beim zweiten Aufruf fast nichts mehr nach. Auf dem iPad kannst du das Casino über \"Zum Home-Bildschirm\" als richtige App ablegen. Und die Zurück-Geste geht endlich einen Screen zurück statt aus der App heraus." },
        { icon: "roulette", titel: "Roulette am richtigen Tableau", text: "Statt einer langen Zahlenliste liegt das Tableau jetzt quer, wie am echten Tisch: Null links, zwölf Spalten, Kolonnen rechts. Deine Chips liegen sichtbar auf den Feldern. Neu dazu: Zurück (letzten Chip zurücknehmen) und Wiederholen (dieselben Wetten wie in der letzten Runde). Auf dem Handy bleibt die stehende Fassung." },
        { icon: "profil", titel: "Profil als Visitenkarte", text: "Bild, Name, Clan und Rang stehen zusammen oben, darunter deine Zahlen als Raster statt als Liste. Neu dabei: dein Stadt-Imperium mit Häusern, Wert, Straßen-Monopolen und Trophäen. Die Achievements zeigen jetzt erst die freigeschalteten, die gesperrten kommen auf Knopfdruck." },
        { icon: "poker", titel: "Poker mit Zug-Uhr", text: "Der Tisch folgt jetzt dem gewählten Design statt immer grün mit brauner Bande zu sein. Der Pot zeigt einen Chipstapel, der mit dem Betrag wächst. Und die 30 Sekunden Bedenkzeit laufen als Balken direkt an deinem Sitz ab, nicht mehr nur als Zahl über dem Tisch: die letzten zehn Sekunden werden rot." },
        { icon: "sports", titel: "Sportwetten übersichtlich", text: "Vorher stand jedes der siebzig Spiele mit allen sechs Wettmärkten offen da: über 700 Knöpfe und rund vierunddreißig Bildschirme Scrollen. Jetzt siehst du je Spiel den Sieger-Markt, der Rest kommt auf Tipp. Dazu ein Liga-Filter, laufende Spiele zuoberst, und der Wettschein bleibt beim Scrollen stehen." },
        { icon: "hilfe", titel: "Fünf alte Fehler weg", text: "Wer Towers oder Rennbahn spielte, erschien für alle \"in der Lobby\". Der Login versprach 1.000 Startchips statt 5.000. Nach einem Update wurde niemand mehr zum Neuladen aufgefordert. Und das Passwort-Formular in den Einstellungen hatte gar keine Formatierung. Beim Roulette blieb außerdem die Runde hängen, wenn man mitten im Dreh die App wechselte." },
      ],
    },
    {
      id: "2026-09-05",
      datum: "5. September 2026",
      titel: "Echte Ligen und Dauer-Login",
      items: [
        { icon: "sports", titel: "Sportwetten auf laufende Ligen", text: "Statt der längst beendeten WM laufen jetzt Bundesliga, Premier League und La Liga mit echten Spielen und echten Ergebnissen. Die Team-Stärken kommen aus den Abschlusstabellen der letzten Saison, nicht aus dem Bauch." },
        { icon: "sperre", titel: "Eingeloggt bleiben", text: "Safari wirft auf dem iPad gern Hintergrund-Tabs weg. Die Sitzung überlebt das jetzt und hält 30 Tage." },
      ],
    },
    {
      id: "2026-07-16",
      datum: "16. Juli 2026",
      titel: "Drei Live-Events und sichere Passwörter",
      gross: true,
      items: [
        { icon: "auszahlen", titel: "Chip-Regen, Blitz-Quiz, Tresorkampf", text: "Drei Events, die zufällig starten: fallende Chips antippen, die schnellste richtige Antwort gewinnt, und Rot gegen Blau am Tresor." },
        { icon: "sperre", titel: "Richtige Passwörter", text: "Statt vierstelliger PIN sind jetzt 6 bis 24 Zeichen möglich. Zu viele Fehlversuche sperren den Account, und du wirst gewarnt, wenn jemand an deinem Login herumprobiert hat." },
        { icon: "hilfe", titel: "Reload-Schutz", text: "Towers, Mines und Blackjack überleben Tab-Reload und Verbindungsabbruch. Dein laufendes Spiel wartet auf dich, statt den Einsatz zu fressen." },
        { icon: "horses", titel: "Fairere Renn-Quoten", text: "Die Quoten kennen jetzt Kondition, Taktik und Sprint der Pferde." },
        { icon: "speichern", titel: "Backup-Knopf", text: "Der Besitzer kann alle Spielstände als eine Datei herunterladen und wieder einspielen." },
      ],
    },
    {
      id: "2026-07-15",
      datum: "15. Juli 2026",
      titel: "Towers und der neue Pinco Ball",
      items: [
        { icon: "towers", titel: "Neues Spiel: Towers", text: "Etage für Etage den Turm hoch, Fallen meiden, jederzeit aussteigen. Je höher, desto mehr." },
        { icon: "pinco", titel: "Pinco Ball neu gebaut", text: "Echte Physik von Stift zu Stift statt einer gewürfelten Bahn. Der Gewinn steht erst fest, wenn der Ball landet." },
      ],
    },
    {
      id: "2026-07-11",
      datum: "11. Juli 2026",
      titel: "Die Porta-Rennbahn",
      gross: true,
      items: [
        { icon: "horses", titel: "Live-Pferderennen", text: "Eigene Pferde besitzen, trainieren, umbenennen und auf Rennen wetten. Mit Sprint-Knopf und Tages-Rangliste." },
        { icon: "bestenliste", titel: "Renn-Champion des Tages", text: "Preisgeld für die ersten drei Plätze, jeden Tag neu." },
        { icon: "clans", titel: "Wett-Limits", text: "Höchstens 50.000 pro Pferd und 100.000 pro Rennen, damit ein einzelner Abend nicht die ganze Wirtschaft kippt." },
      ],
    },
    {
      id: "2026-07-10",
      datum: "10. Juli 2026",
      titel: "Book of Rah und neue Crash-Optik",
      items: [
        { icon: "slots", titel: "Neuer Slot: Book of Rah", text: "Fünf Walzen, zehn Linien, expandierendes Bonussymbol. Ersetzt Cosmic Cluster." },
        { icon: "crash", titel: "Crash sieht neu aus", text: "Weltraum mit Parallax, gezeichnete Rakete, Partikel und eine richtige Explosion." },
        { icon: "roulette", titel: "Roulette angepasst", text: "Die Auszahlungen waren zu großzügig und sind auf ein normales Maß zurück." },
        { icon: "updates", titel: "Weniger Last auf dem iPad", text: "Kleinere Texturen und weniger Effekte auf Animationen, damit die Slots flüssig laufen." },
      ],
    },
    {
      id: "2026-07-09",
      datum: "9. Juli 2026",
      titel: "Algen Abyss und Ankündigungen",
      items: [
        { icon: "slots", titel: "Neuer Slot: Algen Abyss", text: "Mystery-Algen, Nudge und Reveal. Unterwasser-Szene als Hintergrund." },
        { icon: "rufen", titel: "Ankündigungen", text: "Der Besitzer kann eine Nachricht an alle schicken, die oben im Bild steht." },
        { icon: "work", titel: "Arbeiten mit Aufgaben", text: "Der Klick-Job hat wechselnde Mini-Aufgaben statt nur einem Knopf." },
      ],
    },
    {
      id: "2026-07-08",
      datum: "8. Juli 2026",
      titel: "Season-Pass, Denkspiele, Live-Feed",
      gross: true,
      items: [
        { icon: "season", titel: "Season-Pass", text: "Stufen mit Belohnungen, die sich durchs normale Spielen füllen." },
        { icon: "quests", titel: "Denkspiele ausgebaut", text: "Solitär und Sudoku auch solo, Revanche nach jedem Duell, Schachbrett-Fehler behoben." },
        { icon: "feed", titel: "Live-Feed in der Lobby", text: "Große Gewinne, Käufe und Duelle laufen für alle sichtbar durch." },
        { icon: "rundgang", titel: "Einstieg für Neue", text: "Ein kurzes Fenster erklärt beim ersten Mal, wo man anfängt." },
      ],
    },
    {
      id: "2026-07-06",
      datum: "6. Juli 2026",
      titel: "Level, Clans, Heist und vier Denkspiele",
      gross: true,
      items: [
        { icon: "neuling", titel: "Spieler-Level und XP", text: "Durchs Spielen steigst du auf. Der Rang steht neben deinem Namen." },
        { icon: "clans", titel: "Clans", text: "Gründen, beitreten, Schatzkammer, Clan-Kriege und eine Wochenliga." },
        { icon: "chip", titel: "Casino-Heist", text: "Ein Event, bei dem alle gemeinsam am Tresor hämmern." },
        { icon: "chess", titel: "Memory, Sudoku, Solitär, Schach", text: "Vier Denkspiele, alle auch als Duell um Chips." },
        { icon: "kosmetik", titel: "Kosmetik-Shop", text: "Avatare und Namensfarben. Kostet Chips, bringt keine Vorteile, sieht aber gut aus." },
      ],
    },
    {
      id: "2026-07-05",
      datum: "5. Juli 2026",
      titel: "Aufträge, Live-Ops und Kalender",
      items: [
        { icon: "quests", titel: "Aufträge", text: "Tages- und Wochenziele, die beim normalen Spielen nebenbei mitlaufen. Alle sehen dieselben, damit man darüber reden kann." },
        { icon: "uhr", titel: "Happy Hour und Turniere", text: "Zeitlich begrenzte Events mit doppelten Belohnungen und einem Preispot für den größten Einzelgewinn." },
        { icon: "kalender", titel: "Login-Kalender", text: "Sieben Tage in Folge, jeden Tag mehr." },
        { icon: "quests", titel: "Kopfgeld", text: "Setz ein Kopfgeld auf jemanden aus. Wer ihn schlägt, kassiert." },
      ],
    },
    {
      id: "2026-07-04",
      datum: "4. Juli 2026",
      titel: "Die echte Stadtkarte",
      gross: true,
      items: [
        { icon: "businesses", titel: "Porta Westfalica als Karte", text: "Acht echte Ortsteile mit über 11.000 echten Häusern aus OpenStreetMap, samt Straßen und Adressen." },
        { icon: "krone", titel: "Territorium statt Einkommen", text: "Häuser bringen kein Geld mehr, sondern Status: Straßen-Monopole färben die Karte in deiner Farbe, der Stadtteil-Boss steht namentlich drauf." },
        { icon: "bestenliste", titel: "Trophäen-Gebäude", text: "Bahnhof, Kirche, Schule und Wahrzeichen. Einzigartig, teuer, mit echten Vorteilen." },
      ],
    },
    {
      id: "2026-06-26",
      datum: "26. Juni 2026",
      titel: "Kombi-Wetten, Bank und Statistik",
      items: [
        { icon: "season", titel: "Kombi-Wetten", text: "Mehrere Tipps in einen Schein. Alle müssen stimmen, dafür multiplizieren sich die Quoten." },
        { icon: "bank", titel: "Sparkonto", text: "Sicher, aber schlägt nie aktives Spielen." },
        { icon: "statistik", titel: "Statistik", text: "Deine Bilanz aufgeschlüsselt nach Spiel." },
        { icon: "clans", titel: "Anti-Cheat", text: "Chip-Obergrenze, begrenzte Neu-Accounts pro Anschluss, und mehrere Wege dichtgemacht, über die man Chips drucken konnte." },
      ],
    },
  ];

  const NEUESTE = RELEASES[0].id;

  /*
   * Alle Eintraege, die seit `gesehen` dazugekommen sind.
   *
   * Verglichen wird die Position in der Liste, nicht die id als Zeichenkette.
   * Die ids sind laengst keine echten Daten mehr, sondern eine fortlaufende
   * Reihe ("2026-09-22-b", "-c"), und der Eintrag vom 11. September traegt die
   * Nummer 2026-09-22-c. Wer sich beim naechsten Eintrag am echten Datum
   * orientiert, schreibt damit eine id, die kleiner ist als die darueber
   * stehenden, und dann zeigt das Menue eine Zahl an, die durch Ansehen nicht
   * verschwindet, weil der Merker sofort wieder unter den anderen einsortiert.
   * Genau das war passiert: eine 12, die sich nicht wegklicken liess.
   *
   * Die Reihenfolge in RELEASES ist ohnehin die verlaessliche Quelle: neu ist,
   * was ueber dem zuletzt Gesehenen steht.
   */
  function neuSeit(gesehen) {
    if (!gesehen) return [];
    const i = RELEASES.findIndex((r) => r.id === gesehen);
    /* Merker unbekannt: das gibt es noch aus der Zeit, als dort Werte wie
       "2026-07-16-sicherheit-fixes" standen. Fuer die bleibt der alte
       Zeichenketten-Vergleich, sonst saehen sie auf einen Schlag die ganze
       Historie als neu. Haengenbleiben kann die Marke trotzdem nicht: beim
       Ansehen wird der oberste Eintrag gemerkt, und der wird gefunden. */
    if (i < 0) return RELEASES.filter((r) => r.id > gesehen);
    return RELEASES.slice(0, i);
  }

  window.Casino = window.Casino || {};
  window.Casino.changelog = { releases: RELEASES, neueste: NEUESTE, neuSeit };
})();
