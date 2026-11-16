# Fake Casino – Umsetzung und Look-Richtung

Stand: 1. Oktober 2026. Erste Umsetzungsrunde lokal umgesetzt, noch nicht veröffentlicht. Der umfassende Prüfbericht bleibt die Befundgrundlage; diese Liste ersetzt keine vollständige Sicherheitsfreigabe.

## 1. Bereits umgesetzt

### Spickzettel
- Bestehende Anleitung erweitert und direkt in der App durchsuchbar gemacht.
- Auszahlung und Nettogewinn, berechnete und geschätzte Quoten sowie Grenzen und Verbindungsabbrüche erklärt.
- Würfelpoker auf einen Nachwurf korrigiert; tatsächliche Strategieabhängigkeit und noch offene Neukalibrierung sichtbar gemacht.
- Jackpot-Chance korrekt einsatzabhängig beschrieben, Freispiele und Vorführungen ausgeschlossen.
- Veraltete Markt- und Cosmetic-Erklärungen ersetzt; Garderobe, Anprobe, Looks, Seriennummern und Herkunft erläutert.

### Schutz und zuverlässige Spielstände
- Fehlerhafte Socket-Nachrichten werden begrenzt und abgefangen; ein Handlerfehler soll den Server nicht beenden. Das ersetzt noch keine vollständigen Fachschemas und kontoweiten Ratenlimits.
- Private Chat-Verläufe erfordern Anmeldung und Mitgliedschaft im Raum.
- Passwortänderungen widerrufen bestehende Sitzungen. Ein neu angelegtes Konto unter einem gelöschten Namen übernimmt keine alten Anmeldungen. Vorherige Tokens werden beim Update einmalig ungültig.
- Öffentliche Profile geben Prüfungsdaten und Einstellungen nicht mehr aus.
- Fehlerhafte Cookies werden kontrolliert behandelt. Wiederherstellungs-Anfragen werden vor dem großen JSON-Parser autorisiert.
- Offene Slot-Freispiele liegen am Konto und überstehen Wiederverbindung und Prozessneustart. Ein zweiter Tab darf einen erwarteten Freispielzug nicht versehentlich als bezahlten Zug ausführen.
- Mines und Towers beachten ihren Auszahlungsdeckel auch bei automatischer Abrechnung.
- Die Bank erhält Zinsbruchteile bei häufigem Abrufen.
- Sportwetten sichern neue Wetten, Cash-outs und Abrechnungen direkt; die Datei wird vollständig ersetzt. Beim Neustart bleiben noch nicht wieder angehängte echte Wetten erhalten, während Erstattungen für weggefallene Simulationen nicht erneut anfallen. Der Anpfiff wird unmittelbar vor der Buchung geprüft. Eine dateiübergreifend atomare Buchung mit Kontoständen bleibt offen.
- Sportwetten akzeptieren nur tatsächlich angebotene Märkte und Auswahlen, auch bei Kombiwetten. Ein Cash-out zum Vor-Anpfiff-Wert wird ab dem tatsächlichen Anpfiff abgewiesen, selbst wenn der Spielzustand noch nicht aktualisiert wurde.
- Abgelehnte Aktienkäufe hinterlassen keine Position auf der Platte.
- Angebotene Cosmetics zählen weiterhin als bereits vorhanden; doppelte Funde erzeugen keinen Phantom-Besitz. Fortuna berücksichtigt bereits ausgegebene und vernichtete Exemplare.
- Produktionsabhängigkeiten aktualisiert.
- Poker-Zugfristen an den tatsächlichen Spielzug gebunden: erneute Zustandsmeldungen und ungültige Aktionen verlängern sie nicht. Veraltete Timer lösen keine Folgeaktion aus.
- Kniffel nimmt nach Ablauf der angezeigten Zugfrist keine Haltewechsel, Würfe oder Einträge mehr an. Verspätete Timer können spätere Züge nicht automatisch ausfüllen.
- Zeitversetzte Duelle erstellen die Aufgabe vor der Abbuchung: Schlägt die Erzeugung fehl, bleibt der Einsatz erhalten. Verspätete Abgaben werden unmittelbar gegen die Spielzeit geprüft und können eine bereits abgelaufene Partie nicht mehr entscheiden.
- Offene Kisten-Duelle werden bei Beitritt, Ansicht und Neuanlage sofort auf Ablauf geprüft. Abgelaufene Herausforderungen erstatten den Einsatz einmalig und aktualisieren den angezeigten Kontostand verbundener Spieler.
- Schach zieht bei ungültigen Zügen keine Zeit doppelt ab. Ein Zeitverlust hält die angezeigte Uhr korrekt an; eine nach Fristablauf eintreffende Aufgabe kann das Ergebnis nicht mehr umdrehen.
- Das Auktionshaus lehnt ungültige Startgebote vor Einlieferung ab, statt still das Mindestgebot zu verwenden und Gebühr sowie Stück einzuziehen.
- Würfelpoker-Tabelle mit vollständiger Auswertung aller 252 ungeordneten Ausgangshände auf rund 95,85 % bei optimalem Spiel kalibriert. Halteempfehlungen prüfen alle 32 Optionen für den tatsächlichen Einsatz; pauschale Trefferchancen aus der Anzeige entfernt.
- Cashback auf saldierte Hausspielergebnisse umgestellt. Vorherige Auszahlungen bleiben als Verrechnung erhalten; Spieler-gegen-Spieler-Ergebnisse zählen nicht. Offene Altverluste werden einmalig übernommen.
- Einsatzdeckel an tatsächlichen Buchungen ergänzt: Slot-Bonus nach vollem Kaufpreis, Blackjack Double/Split nach Gesamteinsatz, bezahlte Kisten und Eintritte in Kniffel-, Kisten- und asynchrone Duelle. Sudoku, Memory und Schach prüfen den Buy-in auch bei Beitritt, Start und Rückspiel; das Slots-Duell bei Beitritt und Start. Fehler in der zentralen Spielprüfung lassen kostenpflichtige Aktionen nicht mehr ungeprüft durch.
- Eine später verhängte Spielsperre lässt Abschluss, Auszahlung und Rückgabe schon bezahlter Runden zu. Neue Einsätze bleiben blockiert. Bei Slots gilt diese Ausnahme nur für serverseitig gespeicherte Freispiele am passenden Automaten. Zusätzliche Buchungsstellen prüfen den Deckel: Roulette-Lobby als Rundensumme, Slot-Risiko, Poker-Buy-in nach Anpassung, Solitär-Rennen bei Beitritt/Start/Rückspiel sowie Pferde-Startgeld und Lotterielose.
- Bei Pferderennen gilt der persönliche Einsatzdeckel für die Summe aller Wetten im laufenden Rennen und für die Summe der bereits angemeldeten eigenen Pferde im nächsten Rennen.
- Bei der Lotterie gilt der persönliche Einsatzdeckel für die Summe gekaufter Lose pro Ziehung. Geschenkte Lose werden getrennt geführt; der bezahlte Stand überlebt Neustarts. Lose aus älteren Ziehungsdaten ohne Kaufkennzeichnung gelten während der laufenden Ziehung vorsichtig als bezahlt.
- Rennbahn-Wetten werden nach dem tatsächlichen Ende des Wettfensters auch dann abgewiesen, wenn der Start-Timer noch nicht gelaufen ist. Lotterietipps müssen genau vier verschiedene ganze Zahlen enthalten; zusätzliche oder stillschweigend abgerundete Eingaben kosten keine Chips.
- Laufende bezahlte Runden lassen sich nicht mehr durch einen neuen Blackjack-Deal oder einen neuen (auch kostenlosen) Solitär-Start überschreiben. Die bisherige Runde muss erst beendet werden.
- Laufende Slots-Duelle lassen sich durch erneutes Erstellen oder Beitreten nicht mehr überschreiben. Die Sperre gilt kontoweit über mehrere Tabs; ein zweiter Bot-Start kann dadurch keinen weiteren Buy-in abbuchen und die erste Partie bleibt spielbar.
- Crash nimmt nach dem serverseitigen Ende des Wettfensters keine Einsätze mehr an. Manuelle und automatische Auszahlungen genau am Crashpunkt verlieren; unmögliche Auto-Ziele ab 120x werden vor der Abbuchung abgewiesen.
- Solo-Roulette und gemeinsamer Roulette-Tisch weisen fehlende, nicht ganzzahlige und ungültige Zahlen-, Dutzend- oder Kolonnenwerte vor jeder Abbuchung ab. Die gültige Null bleibt als Zahlenwette möglich.
- Sudoku-Rätsel werden nur mit eindeutiger Lösung veröffentlicht. Vollständig gültige Lösungen erhalten auch bei alten gespeicherten Duellen 81 Punkte. Unvollständige Raster zählen nur konfliktfreie eigene Einträge; falsche Zahlen kosten zwei Punkte, damit blindes Ausfüllen keinen erwarteten Vorteil bringt. Gleichstände ohne positive Punkte im versetzten Duell erstatten beide Einsätze unabhängig von der Abgabezeit. Drei Stufen bleiben über die Zahl der Vorgaben definiert; eine Einstufung nach Lösungstechniken ist weiterhin offen.

### Look und Garderobe
- Neue Begrüßung und sichtbare Clubfiguren in der Lobby; nur tatsächlich anwesende Konten werden gezeigt.
- Eigene Figur mit dezenter Bewegung und Chat-Vorschau. Nach UI-Revision: kompakte dunkle Vorschau statt heller „Heute gehst du so“-Fläche; Sammlung daneben im Mittelpunkt.
- Vorhandene Namensstile färben die Jacke; Rahmen werden als Kopf-Accessoires interpretiert und Auren als Schein. Dies ist eine erste Darstellung, noch kein eigenständiges Kleidungssystem. Einige Stücke teilen sich eine Darstellung.
- Drei am Konto gespeicherte Looks. Beim Anlegen wird der gesamte Besitz geprüft; verkaufte Teile werden nicht zurückgegeben und ein ungültiger Look nicht teilweise angelegt.
- Besitzfilter, Anprobe, Suche und Kategorien; neu geordnete Sammlung mit eigener Bestandsanzeige und ruhigeren Karten. Herkunftshinweise verdecken keine Gegenstände mehr.
- Gespeicherte Looks, Atelier, Prunkstück und Sammelziele separat einklappbar; mobile Vorschau kompakt.
- Handyansicht ohne horizontalen Überlauf bei 390 Pixeln; reduzierte Bewegung berücksichtigt.
- Figur erneut überarbeitet: Haare, Bomberjacke, Sneaker und Chip in der Hand. Gewählter Avatar als Jackenaufnäher; Farben und Kopf-Accessoires bleiben an die bestehende Ausstattung gebunden.
- Spielerkarte gegen verzogene Rahmen und lange Inhalte abgesichert: quadratischer Avatar, flexible Namenszeile, umbrechender Titel, eigenständige Serienmarke. Mit dem Screenshot-Fall und einem besonders langen Namen bei 390 Pixeln geprüft.

### Begehbare Welt (Stand 30. September 2026)
- Die Lobby ist ein kleiner Casino-Raum mit Lounge, vier Automaten, Glücksrad, Spielhalle, Wettschalter, Roulette, Blackjack, Poker, Spieltisch für Duelle, Kisten und Garderobe. Eine Tür führt ins Kontor mit Stadtkartentisch, Börsentafel, Bankschalter, Markt, Auktionspult und Schreibtisch.
- Steuerung mit WASD und Pfeiltasten, auf Touch-Geräten ein Stick unter dem Finger und Tippen zum Hingehen. Hinweis beim Näherkommen, geöffnet wird nur mit E, dem großen Knopf oder einem Tipp auf das Ding. Bewegungstasten ruhen, solange ein Textfeld oder Fenster offen ist.
- Spiele und Systeme öffnen sich über dem gedimmten Raum, die Kamera fährt vorher heran. Beim Schließen steht man am selben Platz. Der grüne Vollbildhintergrund liegt dann verdeckt hinter dem Raum.
- Mitspieler laufen weich überblendet, wer spielt, bleibt sichtbar stehen und trägt ein Tätigkeitsschild. Sprechblasen nur aus dem allgemeinen Chat. Winken, Jubeln, Sitzen auf Sofa und Sessel. Türschilder zeigen, wie viele im anderen Raum sind. Figur antippen öffnet die Spielerkarte, dort steht jetzt auch, was sie trägt.
- Schnellwahl mit allen Spielen und die bisherige Lobby als „Übersicht“ bleiben als direkter Weg erhalten.
- Server prüft jeden Zug (freier Boden, kein Weg durch Möbel, Gehtempo mit begrenztem Aufholen), jede Benutzung (Abstand), Tür und Sitzplatz. Die Figur gehört dem Konto: mehrere Tabs zeigen eine Figur, Raumwechsel ziehen alle Tabs mit, Wiederverbindung behält den Platz fünfzehn Minuten. Abmelden entfernt die Figur sofort.
- Figur mit Vorder-, Rück- und Seitenansicht, Lauf-, Atem-, Blinzel- und Gestenanimation hinter „Bewegung reduzieren“. Namensstil wird zur Jacke, Rahmen zur Kopfbedeckung (dreizehn eigene Formen), Chat-Zeichen zum Gegenstand in der Hand, Aura zum Schein am Boden. Besitz, Looks, Prägung und Herkunft bleiben unverändert.
- Kostenlose Grundform (Haut, Haare, Frisur, Hose) in der Garderobe, am Konto gespeichert. Dieselbe Figur erscheint in Garderobe, Übersicht und Spielerkarte.
- Elf zusätzliche automatische Tests: Erreichbarkeit aller Dinge, Zugprüfung, zwei Tabs, Raumwechsel, Tätigkeit, Sitzplatz, Abmelden.

Offen bei der Welt: eigene Kleidungsstücke als neue Besitzart (Abschnitt 2), Figuren direkt an den Spieltischen sitzend, Wegfindung für Tippen auf größere Räume mit Binärheap, und eine Messung auf echten iPads im Querformat mit mehreren gleichzeitig Anwesenden.

## 2. Warum die Cosmetics bisher wenig tragen

Arbeitshypothese aus der Oberfläche, noch keine durch Nutzerdaten bestätigte Aussage: Viele Belohnungen ändern kleine Namensdetails, während Herkunft, Seltenheit, Serienklasse, Garnitur und Prägung viel Aufmerksamkeit verlangen. Wer die Begriffe nicht kennt, erkennt den Wert kaum. Mehr Seltenheitsstufen würden dieses Problem nicht lösen.

Die aus dem Club-Penguin-Vergleich abgeleitete Designrichtung lautet: Eine erkennbare Figur, eine selbst gewählte Kombination und ein Ort, an dem andere sie sehen. Ein lustiger Hut muss auch ohne hohe Seltenheitsstufe begehrenswert sein.

### Nächste gestalterische Ausbaustufe
1. **Echte Kleidungsstücke:** Kopf, Oberteil und Handobjekt als getrennte Ebenen. Als kleine erste Auswahl beispielsweise Fischerhut, Kopfhörer, Regenjacke, Sakko, Kaffeebecher und Spielkarten. Klare Silhouetten statt sechs Varianten desselben Leuchtens. Bestehende Sammlerstücke behalten ihre Herkunft und ihren Besitz; keine stille Entwertung oder Umwandlung.
2. **Ein sofort nutzbarer Startlook:** Einige frei kombinierbare Grundfarben und Kleidungsstücke von Beginn an. Identität darf nicht erst nach vielen Kistenfunden entstehen. Besondere Stücke bleiben Ziele.
3. **Sichtbare soziale Momente:** Figur am Tisch und im Profil, Winken und Anstoßen mit begrenzter Häufigkeit. Eine kleine Lounge mit erkennbaren Plätzen als überschaubarer Anfang; keine riesige leere Welt. Ohne anwesende Freunde bleibt das Profil als dauerhafte Bühne sinnvoll.
4. **Erinnerungen statt reiner Preise:** Ein Stück für ein gemeinsames Ereignis oder eine nachvollziehbare Leistung, mit kurzer Herkunftsbeschreibung. Keine besseren Gewinnchancen durch Kleidung.
5. **Erst Wirkung prüfen:** Garderobenbesuche, gespeicherte Looks und freiwillige Outfitwechsel in aggregierter Form betrachten. Nicht nur Kistenöffnungen zählen; keine privaten Chattexte für diese Auswertung erfassen.

Keine der zuvor vorgeschlagenen neuen Spielideen wird in dieser Reihe gebaut. Zunächst sollen die bestehenden Spiele zuverlässig sein und das Casino eine erkennbare Persönlichkeit erhalten.

Bei einem Serverneustart gehen Spielstände einiger laufender Partien noch verloren. Deren Wiederherstellung oder automatische Erstattung bleibt vor einer Sicherheitsfreigabe gesondert zu prüfen.

## 3. Weitere Umsetzungsreihenfolge

| Reihenfolge | Arbeitspaket | Fertig, wenn … |
| --- | --- | --- |
| 2 | Ergebnisregie und Einsatzgrenzen | versteckte Ergebniseingriffe entfernt oder transparent getrennt und Grenzen vor jedem Einsatz geprüft; Würfelpoker und Cashback in dieser Runde korrigiert |
| 3 | Sudoku | Sudoku eindeutig lösbar bzw. jede gültige Lösung korrekt bewertet; Poker-Zugfrist bereits behoben |
| 4 | Buchungen und Wiederaufnahme | belastbare gemeinsame Buchung von Besitz und Geld, wiederholbare Anfragen ohne Doppelbuchung, Wiederaufnahme weiterer laufender Spiele und geprüfte Wiederherstellung |
| 5 | Konten und Missbrauchsschutz | dauerhafte Konto-IDs über alle Besitzsysteme, vollständiger Löschablauf, kontoweite Ratenlimits und fachliche Nachrichtenprüfung |
| 6 | Kleidung und soziale Präsenz | eigenständige kombinierbare Stücke, gute Startauswahl, klare Herkunft, sichtbare Figuren an den relevanten Orten und sparsame soziale Aktionen |

Die Reihenfolge verhindert, dass zusätzliche Belohnungen die noch offenen wirtschaftlichen Fehler verstärken. Look-Arbeit kann neben fachlich unabhängigen Fehlerkorrekturen weitergehen.

## 4. Nachweise und Grenzen

- 81 automatische Tests bestanden, einschließlich Wiederherstellung, Auswahl- und Zeitgrenzen bei Sportwetten, Zugfristen bei Kniffel und zeitversetzten Duellen, Ablauf und Erstattung bei Kisten-Duellen, Schachuhr, Auktions-Startgebot, Zeitgrenzen bei Crash, Roulette-Wettprüfung und Schutz laufender Slots-Duelle.
- Netzwerkprüfung: Eine ungültige Auth-Nachricht wird abgewiesen; danach beantwortet derselbe Server weiterhin eine gültige Anfrage. Fehlerhaft codierte Cookies verursachen keinen Serverfehler.
- Slot-Bonus in einem neuen Prozess wiederhergestellt; keine erneute Bonusabbuchung.
- Browser: Anprobe, Besitzfilter, Suche und gespeicherter Look geprüft. Handyansicht bei 390 × 844 Pixeln geprüft. Keine Warnungen oder Fehler in den abgefragten Browser-Logs.
- Abhängigkeitsprüfung: npm audit --omit=dev ohne gemeldete Schwachstellen zum Prüfzeitpunkt.
- Tests und lokale Vorschau verwenden getrennte Testdaten. Keine Produktionsdaten für Tests verändert.

Offen bleiben insbesondere dateiübergreifend atomare Buchungen, Wiederaufnahme anderer Spiele, vollständige Kontolöschung, Wirtschaftskalibrierung und umfassende Missbrauchsgrenzen. Die Änderungen machen das Projekt in den genannten Punkten besser, sind aber keine Behauptung, dass alle Auditbefunde erledigt seien.

Vor Veröffentlichung: Daten sichern, Änderungen am Zielstand prüfen, die einmalige erneute Anmeldung ankündigen und die verbleibenden wirtschaftlichen Befunde berücksichtigen. Noch kein Commit, Push oder Deployment durch diese Umsetzungsrunde.
