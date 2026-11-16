# Durchsicht November 2026

Stand: 12. November 2026. Letzter Commit ist vom 9. Oktober. Gelesen wurden
alle Server-Module unter `game/`, `server.js`, die Tests (161, alle grün),
der Changelog, der Spickzettel und die wichtigsten Client-Dateien. Dazu
Simulationen für Börse und Slots und ein Blick auf Lobby, Börse, Season,
Kisten und Auktionshaus im Browser. Produktionsdaten wurden nicht angefasst.

Kurzfassung: Das Haus ist technisch in gutem Zustand. Buchungen, Neustarts,
Strafen und Ablaufgrenzen sind sorgfältig gebaut, die Hausspiele rechnen
sauber. Es gibt einen echten Geldfehler (Börse), zwei Zeitfehler (Lotterie
und Auktion ziehen zur falschen Uhrzeit) und ein inhaltliches Loch: die
Season ist seit dem 1. November zu Ende, die limitierte Kiste seit dem
12. Oktober, und nichts ist nachgerückt.

## 1. Fehler, die Chips bewegen

Nachtrag vom 13. November: 1.1 und 1.2 sind behoben (noch nicht veröffentlicht).
Die Tagesgrenzen bei Pferden und Überweisungen aus 1.2 sind bewusst noch offen.

### 1.1 Die Börse druckt Chips über Leerverkäufe

`game/stocks.js`: Der Takt läuft alle 6 Sekunden, und in jedem Takt geht
jede Aktie mit 0,25 % Wahrscheinlichkeit pleite (`Math.random() < 0.0025`).
Das sind im Mittel rund 35 Pleiten je Aktie und Tag, eine Aktie lebt etwa
40 Minuten. Bei einer Pleite bekommt ein Short `margin × (1 + Hebel)`
ausgezahlt, ein Long verliert alles.

Simulation mit den Regeln aus dem Modul (20.000 Positionen je Fall,
Erwartungswert als Vielfaches des Einschusses):

| Position | Haltedauer | Erwartungswert |
|---|---|---|
| Long, Hebel 1 | 1 Stunde | 0,36 |
| Long, Hebel 5 | 1 Stunde | 0,65 |
| Short, Hebel 1 | 1 Stunde | 1,47 |
| Short, Hebel 5 | 1 Stunde | 2,07 |
| Short, Hebel 5 | 10 Minuten | 1,58 |

Wer alle sechs Aktien mit Hebel 5 shortet und liegen lässt, verdoppelt
seinen Einsatz im Schnitt alle 13 Minuten. Es gibt keinen Höchsteinsatz je
Position und keinen Test, der die Börse nachrechnet. Nebenwirkungen:

- Ein Börsengang aus der Stadt (`city:ipo`) wird nach rund 40 Minuten vom
  selben Zufall gelöscht. Das Feature ist damit faktisch tot.
- Die Nachrichtenleiste besteht zu großen Teilen aus „ist pleite“.
- Firmennamen werden ohne Prüfung auf Doppelte gezogen; lokal standen
  „PixelPlay Games“ zweimal in der Liste.

Vorschlag: Pleite als seltenes Ereignis (etwa 0,25 % je Stunde statt je
Takt, also `0.0025 / 600` je Takt) und nur über den Kursverfall unter 12 %
des Grundwerts als Regelfall. Short-Auszahlung bei Pleite auf den fairen
Wert beschränken (Einschuss plus Hebel-Gewinn bis zum Kurs 0 ist das schon,
aber nur sinnvoll, wenn Pleiten selten sind). Höchsteinsatz je Position
(z. B. 250.000 wie bei Crash) und ein Test wie `economyBalance.test.js`,
der Long und Short über 10.000 Positionen simuliert und unter 1,0 verlangt.
Firmennamen aus der Liste ohne Doppelte ziehen.

### 1.2 Lotterie und Auktionshaus laufen nach Serverzeit

`game/lotterie.js` (`setHours(20)`) und `game/auktion.js` (`setHours(20, 30)`)
rechnen mit der Zeitzone des Servers. Railway läuft in UTC, eine `TZ`
Variable ist nirgends dokumentiert oder gesetzt. Dann zieht die Lotterie um
21 Uhr deutscher Zeit (im Sommer 22 Uhr), der Zuschlag fällt um 21:30, und
die Ansage im Chat sagt trotzdem „heute um 20:30 Uhr“, weil `endeText` die
Serverstunde ausgibt. Kachel und Changelog versprechen 20 Uhr und halb neun.

Dasselbe gilt kleiner für den Renn-Champion des Tages, das Trainingslimit
der Pferde und das Überweisungslimit (`toDateString()`), die um 1 Uhr nachts
statt um Mitternacht wechseln.

Vorschlag: Beide Termine über `game/hauszeit.js` rechnen, das genau dafür
gebaut wurde (Zoo, Schaufenster und Garagentor benutzen es schon). Als
Sofortmaßnahme reicht `TZ=Europe/Berlin` als Service-Variable auf Railway,
dann stimmen alle Stellen auf einmal; der saubere Weg bleibt `hauszeit`.

### 1.3 Blackjack nimmt 2.000.000 je Hand

`game/blackjack.js` deckelt den Einsatz bei 2 Millionen. Alle anderen
Hausspiele liegen bei 50.000 (Mines, Towers, Higher/Lower, Würfelpoker,
Roulette) oder 250.000 (Crash), nach der Regel aus CLAUDE.md „am echten
Spielstand gemessen“. Blackjack bei guter Strategie hat über 99 % Rückfluss
und ist damit der Ort, an dem große Konten Chips mit dem kleinsten
Hausvorteil hin und her schieben. Vorschlag: 250.000 wie Crash.

### 1.4 Gratisgeld aus den automatischen Events

`game/liveops.js` startet Heist, Chip-Regen, Tresorkampf, Quiz und Turnier
von selbst, sobald jemand online ist. Mit den Töpfen und Wartezeiten aus
dem Modul kommen grob zusammen:

| Event | Topf | ungefähr je Tag |
|---|---|---|
| Heist | 150.000 bis 500.000 | 2 Mal |
| Tresorkampf | 100.000 bis 250.000 | 2 Mal |
| Chip-Regen | 60.000 bis 150.000 | 2 Mal |
| Slot-Turnier | 25.000 bis 60.000 | 4 bis 5 Mal |
| Quiz | 8.000 bis 15.000 je Runde | 2 Mal 3 bis 5 Runden |

Das sind in der Größenordnung 1,3 bis 1,6 Millionen neue Chips am Tag,
solange immer jemand da ist (und laut Besitzer sind es immer mindestens
zehn). Dazu kommen der Renn-Champion des Tages (300.000, 200.000 und
100.000 feste Preise, also bis 600.000 am Tag für zwei bis drei Pferdebesitzer)
und der Rake des Casino-Besitzers (5 % jedes Hausverlusts aus dem Nichts).

Das ist kein Fehler im Code, aber die größte Inflationsquelle im Haus, und
sie ist nirgends gemessen. Vorschlag: einmal am Tag die Geldmenge (Chips,
Bank, Depots, Schatzkammern) in eine kleine Datei schreiben und im Admin
als Kurve zeigen. Danach entscheiden, ob die Events aus einem Topf bezahlt
werden, den Gebühren und Rake füllen, statt aus dem Nichts.

## 2. Inhalt, der abgelaufen ist

- **Season „Porta-Herbst“** endete am 1. November (`game/season.js`). Der
  Bildschirm zeigt „beendet“, eine neue Season ist nicht angelegt. XP
  laufen trotzdem weiter in die alte Season (`addXp` prüft die Phase
  nicht), wer bis jetzt Stufe 20 verpasst hat, kann sie also nachgrinden.
- **Gala-Kiste** lief bis 12. Oktober. Der Bereich „Nur für kurze Zeit“ im
  Tresorraum ist seitdem leer.
- **Hinweise zum Weserlicht** sind neun; der letzte erscheint am 7. Dezember.
  Danach gibt es für die Rätselfreunde nichts Neues mehr.
- Schnitzeljagd und Wiedereröffnung hängen am Admin-Knopf, das ist Absicht.

Vorschlag: Seasons als Liste anlegen und die laufende über das Datum wählen,
damit nie wieder „beendet“ dasteht, sondern „startet am …“ mit Countdown.
Eine Winter-Season (Dezember bis Januar) mit drei neuen `s3_`-Stücken, dazu
eine Winterkiste mit eigenem Topf nach dem Muster der Gala (`nur: "winter"`,
`bis` Mitte Januar). Der Login-Kalender ist technisch ein 7-Tage-Band; ein
Adventskalender mit 24 Feldern wäre mit derselben Mechanik in einem Abend
gebaut und passt genau in die Zeit, in der das Haus sonst still ist.

## 3. Kleinere Fehler

- `game/tableManager.js`, `presence:screen`: prüft `typeof ack`, obwohl der
  Handler kein `ack` hat; ein unsauberer Bildschirmname wird still verworfen.
  Harmlos, aber tote Zeile.
- Beim Start warnt Node `MaxListenersExceededWarning` (51 connection
  listeners bei Grenze 50). `io.setMaxListeners(0)` steht erst nach den
  Spielmodulen; nach vorn ziehen.
- `game/achievements.js`, `greifer_halt`: der Rückfall liest `cosOwned.hand`,
  der Topf heißt aber `handdinge`. Der Zähler `greifer.gehalten` fängt neue
  Treffer auf, wer das Huhn schon vorher hatte, bekommt das Achievement nicht.
- Nach einer Umbenennung bilden ein paar Stellen den Schlüssel noch aus dem
  Anzeigenamen: `push.js` (`anAlle`, Serien-Erinnerung), `economy.js`
  (`stadtKosmetikFuerAlle`), `season.js` (`publicState` für den Clanbonus),
  `weekly.js` (Krone des Spielers der Woche über `lastWinner.key`),
  `accounts.placeBounty` (Ziel nur über `normalizeName`). Überall
  `accounts.schluesselVon(acc)` bzw. `kanonisch(name)` nehmen.
- `game/economy.js`, Klick-Bremse: `disconnect` löscht `clickTimes` unter
  `socket.id`, gespeichert wird aber unter dem Kontoschlüssel. Die Map wächst
  langsam.
- `UMSETZUNGSPLAN.md` liegt seit dem 1. Oktober untracked im Projekt.
  Entweder committen oder in `data/` verschieben.
- Slot-Quoten nachgerechnet (200.000 Drehs je Automat): Lucky 7s 97,8 %,
  Gem Storm 97,4 % (Bonuskauf 88,6 %), Algen Abyss 96,6 %, Book of Rah
  96,8 %. Der Kommentar bei Book of Rah behauptet 98,5 %; der Spickzettel
  nennt die Slots ohnehin als Schätzung. Kein Handlungsbedarf, aber die
  Zahl im Kommentar stimmt nicht.

## 4. Was gut ist und so bleiben sollte

- Jede Chipbewegung liegt auf dem Server, die Bremse (`strafen.bremse`)
  deckelt zentral, Acks werden fast überall auf Funktion geprüft.
- Offene Runden, Buchungen und Backups überleben Neustarts; die
  Reihenfolge „erst abbuchen und sichern, dann Runde merken“ ist
  konsequent umgesetzt.
- Mines, Towers, Higher/Lower, Crash, Würfelpoker und Roulette rechnen
  korrekt und sind getestet.
- Markt, Auktionshaus, Prägung und Läden sind stimmig verzahnt; die
  Exemplar-Logik hat keine Lücke, die ich gefunden hätte.
- Die Welt ist der stärkste Teil des Hauses. Die Geheimnisse mit
  Gerüchten, Titeln und Meilensteinen sind genau die Art Inhalt, die
  versetzt funktioniert.

## 5. Vorschläge, nach Wirkung sortiert

1. Börse reparieren (1.1). Ein Nachmittag, und es ist der einzige Punkt, an
   dem gerade Chips entstehen, ohne dass jemand es merkt.
2. Zeitzone fixen (1.2). Eine Variable auf Railway heute, `hauszeit` im
   Code danach.
3. Winter-Season plus Winterkiste plus Adventskalender (2). Das ist das
   sichtbare „es geht weiter“, auf das die Runde nach fünf Wochen Stille
   wartet. Im Changelog mit `gross: true`.
4. Geldmenge messen (1.4), dann Events und Renn-Champion aus einem Topf
   statt aus dem Nichts bezahlen. Das Haus hat viele Senken gebaut
   (Gebühren, Rake, Verwaltung), aber niemand sieht, ob sie reichen.
5. Blackjack-Deckel auf 250.000 (1.3).
6. Zweites großes Rätsel oder ein saisonales Geheimnis in der Welt, wenn
   die Weserlicht-Hinweise im Dezember durch sind. Die Geheimnisse sind
   laut Changelog das, woran zuletzt am meisten gebaut wurde, und sie
   tragen ohne Gleichzeitigkeit.
7. Die Kleinigkeiten aus Abschnitt 3 in einem Aufwasch.

## 6. Nicht geprüft

Der echte Spielstand auf dem Server (Geldmenge, Verteilung, wer die Börse
nutzt). Die Zahlen oben zur Inflation sind aus den Konstanten gerechnet,
nicht gemessen. Poker, Schach, Sudoku, Memory und Solitär habe ich nur auf
Buchungen gelesen, nicht gespielt. Push und Service Worker nicht getestet.
