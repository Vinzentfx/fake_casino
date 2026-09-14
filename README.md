# Fake Casino

Ein Casino im Browser für meinen Freundeskreis, mit Spielgeld statt echtem
Geld. Es gibt keine Einzahlung, keine Auszahlung und keinen Weg, Chips in
irgendetwas Reales zu tauschen: die Chips sind nur Punkte, jedes neue Konto
bekommt sie geschenkt. Damit ist es ein Spiel und kein Glücksspielangebot,
und das war von Anfang an so gewollt.

**Ausprobieren:** <https://fakecasino-production-5147.up.railway.app/?v=mtys3xxe#/lobby> (Name und Passwort ausdenken, das
Konto entsteht beim ersten Anmelden. Gebaut fürs iPad und Handy.)

## Warum

Ich hatte Lust, verschiedene Spiele für mich und meine Freunde zu bauen, bei
denen man selbst aktiv spielt und auch gegeneinander antreten kann. Angefangen
habe ich im Februar 2026, seitdem hat sich das Projekt Stück für Stück
weiterentwickelt. Online und in der Versionsgeschichte ist es seit Juni 2026.
Inzwischen haben um die 70 Leute ein Konto, und viele Änderungen kamen direkt
von ihnen: gemeldete Fehler, ein Spiel, das viel zu großzügig war, oder
Versuche, das System mit Zweitkonten auszutricksen. Trotzdem würde ich sagen,
dass ich persönlich mehr Zeit in
[LiftLog](https://github.com/Vinzentfx/liftlog) gesteckt habe.

## Was drin ist

* Blackjack, Roulette, Poker und vier Spielautomaten
* schnelle Runden wie Mines, Towers, Crash, Pinco Ball und eine tägliche Lotterie
* Sportwetten auf echte Spiele aus Bundesliga, Premier League und La Liga
* Pferderennen, die für alle gleichzeitig live laufen
* Duelle in Schach, Memory, Sudoku, Solitär und Kniffel
* eine Stadt aus über 11.000 echten Häusern von Porta Westfalica
  (OpenStreetMap), die man mit seinen Gewinnen kaufen kann
* Bank, Börse, Clans, Chat, Bestenlisten und Achievements

## Wie es funktioniert

Alles, was Chips bewegt, entscheidet der Server. Der Browser schickt nur
"ich möchte drehen", sonst könnte man sich über die Entwicklertools selbst
Geld geben. Jedes Spiel hat eine festgelegte Auszahlungsquote, meistens 97
bis 98 Prozent, und die habe ich mit Simulationen geprüft. Beim Würfelpoker
hat die erste Simulation nie gezielt auf Straßen gespielt und die Quote
deshalb völlig falsch eingeschätzt. Seitdem rechne ich gegen mehrere
Spielweisen.

Weil selten alle gleichzeitig online sind, laufen die meisten Duelle
versetzt: man spielt seine Runde, und der andere spielt dieselbe Aufgabe
später. Wer länger weg war, bekommt beim Reinkommen einen kurzen Bericht,
was passiert ist.

Technisch ist es Node.js mit Express und Socket.IO auf einem kleinen Server
in Frankfurt, im Browser reines JavaScript ohne Framework. Die Auszahlungen
der einzelnen Spiele stehen in [CHEATSHEET.md](CHEATSHEET.md), der Betrieb in
[DEPLOY.md](DEPLOY.md).

```bash
npm install
npm start   # läuft dann auf http://localhost:3000
```

## Sonstiges

Natürlich ist nicht jede Zeile Code  selbst geschrieben, ein großer Teil ist mit
Hilfe von KI entstanden. Was gebaut wird, wie sich ein Spiel anfühlen soll,
wie es gebaut werden soll und was an einem Fehler eigentlich falsch läuft, musste ich trotzdem selbst
herausfinden, meistens zusammen mit den Leuten, die dort spielen.

## Quellen

Die Häuser und Straßen der Spielstadt stammen aus
[OpenStreetMap](https://www.openstreetmap.org), © OpenStreetMap-Mitwirkende,
veröffentlicht unter der [Open Database License](https://opendatacommons.org/licenses/odbl/).
Die Spielpläne der Sportwetten beziehen sich auf echte Begegnungen, gewettet
wird aber ausschließlich mit Spielgeld.
