# Fake Casino

Ein Casino im Browser für meinen Freundeskreis, mit Spielgeld statt echtem
Geld. Einzahlen oder auszahlen kann man nichts, die Chips sind nur Punkte.

**Ausprobieren:** <https://chipstadt.de> (Name und Passwort ausdenken, das
Konto entsteht beim ersten Anmelden. Gebaut fürs iPad und Handy.)

## Warum

Im Juni 2026 habe ich mit Poker und ein paar Spielautomaten angefangen. Mich
hat interessiert, wie so ein Casino eigentlich rechnet: warum das Haus auf
Dauer immer gewinnt und wie man ein Spiel baut, das sich trotzdem fair
anfühlt. Über den Sommer sind daraus rund 30 Spiele geworden, und inzwischen
haben um die 70 Leute ein Konto. Vieles, was sich geändert hat, kam von ihnen:
gemeldete Fehler, ein Spiel, das viel zu großzügig war, und Versuche, das
System mit Zweitkonten auszutricksen.

## Was drin ist

- Blackjack, Roulette, Poker und vier Spielautomaten
- schnelle Runden wie Mines, Towers, Crash, Plinko und eine tägliche Lotterie
- Sportwetten auf echte Bundesliga-, Premier-League- und La-Liga-Spiele
- Pferderennen, die für alle gleichzeitig live laufen
- Duelle in Schach, Memory, Sudoku, Solitär und Kniffel
- eine Stadt aus über 11.000 echten Häusern von Porta Westfalica
  (OpenStreetMap), die man mit seinen Gewinnen kaufen kann
- Bank, Börse, Clans, Chat, Bestenlisten und Achievements

## Wie es funktioniert

Alles, was Chips bewegt, entscheidet der Server. Der Browser schickt nur
"ich möchte drehen", sonst könnte man sich über die Entwicklertools selbst
Geld geben. Jedes Spiel hat eine festgelegte Auszahlungsquote, meistens 97
bis 98 Prozent, und die habe ich mit Simulationen geprüft. Beim Würfelpoker
hat die erste Simulation nie gezielt auf Straßen gespielt und die Quote
deshalb völlig falsch eingeschätzt. Seitdem rechne ich gegen mehrere
Spielweisen.

Weil wir selten gleichzeitig online sind, laufen die meisten Duelle versetzt:
man spielt seine Runde, und der andere spielt dieselbe Aufgabe später. Wer
länger weg war, bekommt beim Reinkommen einen kurzen Bericht, was passiert ist.

Technisch ist es Node.js mit Express und Socket.IO auf einem kleinen Server
in Frankfurt, im Browser reines JavaScript ohne Framework. Die Auszahlungen
der einzelnen Spiele stehen in [CHEATSHEET.md](CHEATSHEET.md), der Betrieb in
[DEPLOY.md](DEPLOY.md).

```bash
npm install
npm start   # läuft dann auf http://localhost:3000
```

## Ehrlich gesagt

Nicht jede Zeile Code habe ich selbst geschrieben, ein großer Teil ist mit
einem KI-Assistenten entstanden. Was gebaut wird, wie sich ein Spiel anfühlen
soll und was an einem Fehler eigentlich falsch läuft, musste ich trotzdem
selbst herausfinden, meistens zusammen mit den Leuten, die dort spielen.
