# Fake Casino

Ein Casino im Browser für mich und meine Freunde, mit Spielgeld statt echtem
Geld. Man kann dort nichts einzahlen und nichts auszahlen, die Chips sind nur
Punkte. Trotzdem steckt hinter jedem Spiel die gleiche Mathematik wie in einem
echten Casino, und genau das fand ich daran spannend.

**Ausprobieren:** <https://chipstadt.de>
Name und Passwort ausdenken, das Konto wird beim ersten Anmelden angelegt.
Am besten auf dem iPad oder Handy, dafür ist die Seite gebaut.

## Wie es dazu kam

Angefangen hat es im Juni 2026 mit Poker und ein paar Spielautomaten. Daraus
wurde über den Sommer ein ganzes Casino mit rund 30 Spielen und einer Stadt,
in der man mit seinen Gewinnen echte Häuser aus Porta Westfalica kaufen kann.
Inzwischen haben um die 70 Leute ein Konto.

Das meiste, was sich im Laufe der Zeit geändert hat, kam von den Leuten, die
dort spielen. Jemand hat einen Fehler gemeldet, ein Spiel hat viel zu
großzügig ausgezahlt, und ein paar haben versucht, das System mit Zweitkonten
auszutricksen. Aus fast jedem dieser Fälle ist eine Änderung geworden.

## Was drin ist

- **Klassiker:** Blackjack, Roulette, Poker (Texas Hold'em), vier
  Spielautomaten mit eigenen Grafiken und Sounds.
- **Schnelle Runden:** Mines, Towers, Crash, Plinko, Higher/Lower,
  Würfelpoker, eine Lotterie mit täglicher Ziehung.
- **Sportwetten** auf echte Spiele aus Bundesliga, Premier League und La Liga.
  Die Quoten rechnet der Server aus der Stärke der Teams in der letzten Saison.
- **Pferderennen**, die live für alle gleichzeitig laufen. Pferde kann man
  kaufen, trainieren und selbst antreten lassen.
- **Duelle:** Schach mit Uhr, Memory, Sudoku, Solitär und Kniffel gegen andere
  Spieler.
- **Die Stadt:** eine echte Karte von Porta Westfalica mit über 11.000 Häusern
  aus OpenStreetMap. Wer eine ganze Straße besitzt, färbt sie auf der Karte in
  seiner Farbe ein.
- **Drumherum:** Bank, Börse, Clans, Chat, Bestenlisten, Achievements, ein
  Season-Pass und ein Laden für Kosmetik wie Namensfarben oder Rahmen.

## Was ich dabei gelernt habe

**Alles, was Chips bewegt, gehört auf den Server.** Der Browser schickt nur
"ich möchte drehen", ob und wie viel man gewinnt, entscheidet der Server. Sonst
reicht ein Blick in die Entwicklertools, und jemand gibt sich selbst Chips.
Dasselbe gilt für Grenzen wie den Höchsteinsatz: die kommen vom Server und
stehen nicht fest im Browser-Code.

**Auszahlungsquoten muss man simulieren, nicht schätzen.** Bei jedem Spiel
lege ich fest, wie viel Prozent der Einsätze auf lange Sicht zurückkommen
sollen, meistens 97 bis 98 Prozent. Beim Würfelpoker sah die erste Messung gut
aus, bis ich gemerkt habe, dass die Simulation nie gezielt auf Straßen gespielt
hat. Wer das tut, bekommt eine große Straße fast dreißigmal so oft. Jetzt ist
das Spiel gegen drei verschiedene Spielweisen durchgerechnet.

**Eine Wirtschaft mit 70 Leuten verhält sich nicht so, wie man denkt.** Es gibt
eine Bremse, die reichen Spielern weniger Gratis-Chips gibt. Die hat eine Weile
genau die Falschen getroffen: wer seine Chips in Häuser gesteckt hatte, galt als
reich, obwohl er nichts mehr zum Spielen hatte. Das habe ich erst gesehen, als
ich mir die echten Spielstände angeschaut habe.

**Wir sind selten gleichzeitig online.** Poker und die Duelle haben deshalb
lange fast nie stattgefunden. Die meisten Duelle laufen jetzt versetzt: man
spielt seine Runde, das Ergebnis wartet, und der andere spielt dieselbe Aufgabe
später. Wer lange weg war, bekommt beim Reinkommen einen kurzen Bericht, was in
der Zeit passiert ist.

## Technik

- **Server:** Node.js mit Express und Socket.IO. Jedes Spiel ist ein eigenes
  Modul in `game/`, die Spielstände liegen als JSON-Dateien auf dem Server.
- **Browser:** reines JavaScript ohne Framework und ohne Build-Schritt. Die
  Screens schaltet ein kleiner eigener Router um.
- **Betrieb:** ein kleiner Server bei DigitalOcean in Frankfurt, davor Caddy für
  HTTPS. Tägliche Backups, Push-Benachrichtigungen über Web Push.
- **Design:** drei Farbschemata, die alle aus denselben Variablen kommen,
  gezeichnete Symbole statt Emojis, und alles ist auf das iPad ausgelegt, weil
  dort am meisten gespielt wird.

Insgesamt sind es gut 50.000 Zeilen. Wie die einzelnen Spiele auszahlen, steht
in [CHEATSHEET.md](CHEATSHEET.md), Betrieb und Deployment in
[DEPLOY.md](DEPLOY.md).

## Selbst starten

```bash
npm install
npm start
```

Danach läuft das Casino auf <http://localhost:3000>. Beim ersten Start legt
der Server seine Schlüssel und einen leeren Datenordner selbst an.

## Ehrlich gesagt

Nicht jede Zeile Code habe ich selbst geschrieben. Ein großer Teil ist mit
einem KI-Assistenten entstanden. Was gebaut wird, wie sich ein Spiel anfühlen
soll, wann etwas zu großzügig oder zu geizig ist und was an einem Fehler
eigentlich falsch läuft, musste ich trotzdem selbst herausfinden, meistens
zusammen mit den Leuten, die dort spielen.
