# Betrieb und Deployment

Stand: 12.9.2026. Das Casino läuft auf Railway. Von Juli bis Anfang September
2026 lag es auf einem eigenen Server bei DigitalOcean. Der ist nicht mehr in
Betrieb, siehe ganz unten.

## Wo läuft was

| | |
|---|---|
| **Adresse** | https://fakecasino-production-5147.up.railway.app |
| **Plattform** | Railway, gebaut mit Nixpacks, gestartet mit `npm start` (siehe `railway.json`) |
| **Node** | ab Version 22 (`engines` in `package.json`) |
| **Neustart** | `restartPolicyType: ON_FAILURE`; der Restore beendet den Prozess bewusst mit Fehlercode, damit auch Free-/Trial-Dienste neu starten |
| **Repo** | https://github.com/Vinzentfx/fake_casino |

## Deployen

Ein Push auf `main` reicht. Railway holt den Stand, baut neu und startet den
Dienst neu. Am 12.9.2026 war ein Push nach wenigen Minuten online.

```bash
git push origin main
```

Ob der neue Stand läuft, sieht man an der Version. Sie ist ein Fingerabdruck
über den Inhalt und ändert sich mit jedem Deploy, der Code verändert:

```bash
curl https://fakecasino-production-5147.up.railway.app/api/version
```

Jeder Push startet das Casino neu, auch einer, der nur Doku ändert. Laufende
Runden brechen dabei ab, also nicht mitten in einer Pokerrunde pushen.

## Spielstände

Alle Spielstände liegen im Ordner `data/` neben dem Code (`game/accounts.js`
und die anderen Module schreiben dorthin). Der Ordner ist gitignored, die echten
Daten gibt es nur auf Railway. Der lokale `data/`-Ordner ist Testmüll und darf
nie hochgeladen werden.

**Offen: liegt `data/` auf einem Volume?** Ohne Volume ist das Dateisystem bei
Railway nach jedem Deploy wieder leer, und das Haus startet ohne Konten. Nach
dem Deploy am 12.9.2026 zeigte die Bestenliste weiter volle Einträge, das
spricht dafür, dass die Daten überleben. Sicher ist es erst mit einem Blick im
Railway-Dashboard unter Volumes: dort muss ein Volume auf den `data`-Ordner der
App zeigen.

In `data/` liegt auch `vapid.json`, der Schlüssel für Benachrichtigungen. Geht
die Datei verloren, muss sich jedes Gerät neu für Push anmelden.

## Backups

Automatische Backups sind im Repo nicht eingerichtet. Es gibt den
Owner-Backup-Knopf im Admin-Bildschirm. Er ruft `POST /api/admin/backup` auf
und lädt den kompletten `data/`-Ordner als eine JSON-Datei herunter, inklusive
`.secret` und der hochgeladenen Clan-Wappen. Über `POST /api/admin/restore`
spielt man so eine Datei wieder ein. Beides geht nur mit dem Konto des Besitzers.
Das Einspielen legt das Backup zuerst in `data/.wiederherstellung` ab; der
Server beendet sich, Railway startet neu, und erst der neue Prozess tauscht
die Dateien ein, bevor er sie liest. Startet der Dienst danach nicht von
selbst neu, bleibt das Backup dort liegen, bis er gestartet wird.

Vor größeren Deploys ein Backup ziehen und auf dem Mac aufheben. Genau so
wurden beim Umzug die 70 Konten wiederhergestellt.

## Umgebungsvariablen

Stehen bei Railway im Projekt unter Variables.

| Variable | Bedeutung |
|---|---|
| `FOOTBALL_DATA_TOKEN` | Zugang zu football-data.org für echte Fußballspiele. **Fehlt sie, laufen nur simulierte Spiele.** Auf Railway als Service-Variable hinterlegen und die Änderung deployen. Der Admin-Bildschirm unter „Werkzeuge > Echte Fußballspiele“ kann den Schlüssel alternativ in `data/sport-zugang.json` speichern; ohne dauerhaftes Volume kann diese Datei bei einem Deploy verschwinden. Eine gesetzte Umgebungsvariable hat Vorrang. |
| `FOOTBALL_DATA_COMPS` | Welche Wettbewerbe, auf dem alten Server war es `BL1,PL,PD` |
| `SPORTS_SIM` | auf `off` setzen, um die simulierten Füllspiele auszublenden |
| `PORT` | setzt Railway selbst |
| `APP_VERSION` | optional, ersetzt den Fingerabdruck über den Inhalt |
| `NODE_ENV` | alles außer `production` gilt als Entwicklung (`game/buildinfo.js`) |

Geänderte Variablen werden bei Railway zunächst vorgemerkt und nach dem Deploy
im neu gestarteten Dienst wirksam.

### Wenn echte Sportwetten fehlen

Im Casino als Besitzer unter **Team & Verlauf → Werkzeuge → Echte Fußballspiele**
„Jetzt holen“ drücken und die Antworten der Wettbewerbe prüfen. „Kein Zugang“
bedeutet, dass `FOOTBALL_DATA_TOKEN` im laufenden Railway-Service fehlt und auch
keine gespeicherte Datei geladen wurde. Den vorhandenen Schlüssel in Railway
beim **richtigen Service und der richtigen Umgebung** unter **Variables** als
`FOOTBALL_DATA_TOKEN` eintragen; die Änderung anschließend deployen. Den
Schlüssel nie ins Repository oder in eine öffentliche Nachricht kopieren.

HTTP 400 mit der Anbieter-Meldung „Your API token is invalid“ heißt, dass der
gespeicherte Schlüssel ungültig oder unvollständig ist. Den vollständigen
API-Schlüssel im football-data.org-Konto nachsehen und neu eintragen. HTTP 401
heißt ebenfalls, dass die API den Schlüssel nicht akzeptiert. HTTP 403 heißt,
dass der Wettbewerb für diesen Schlüssel nicht freigeschaltet ist; die
Wettbewerbsliste (`FOOTBALL_DATA_COMPS`) und den Tarif beim Anbieter prüfen.
HTTP 429 bedeutet zu viele Abrufe; nach der Sperrfrist erneut prüfen.
Antworten mit HTTP 200 und null Spielen können bei einer leeren Terminspanne
normal sein; die App fragt zwei Tage zurück bis zehn Tage voraus ab. Der
Admin-Bildschirm zeigt den letzten Abruf und die Anzahl pro Wettbewerb, ohne
den geheimen Schlüssel auszugeben.

## Lokal entwickeln

```bash
cd ~/fake-casino && npm start
```

Läuft auf http://localhost:3000. Umgebungsvariablen fürs lokale Testen stehen
in der lokalen Startkonfiguration (nicht im Repo).

## Domain

`chipstadt.de` ist bei INWX registriert (rund 6 € im Jahr). Die A-Records
(`@`, `www`, `*`) zeigen noch auf die IP des alten Servers und damit ins Leere.

**Offen:** die Domain in Railway als eigene Domain eintragen und die Einträge
bei INWX so setzen, wie Railway es dann anzeigt.

Warum überhaupt eine eigene Domain: Schulnetze und andere gefilterte Netze
sperren Dienste wie DuckDNS oder sslip.io, eine normale Domain fällt in keine
dieser Kategorien. Aus demselben Grund steht bewusst kein "casino" im Namen,
Filter sortieren auch nach dem Domainnamen. Die Railway-Adresse enthält das
Wort, sie kann in solchen Netzen also gesperrt sein.

**Achtung beim Wechsel der Adresse:** `localStorage` gehört zur Herkunft
(Origin). Wer über eine neue Adresse kommt, hat kein Sitzungstoken und muss
sich einmal neu anmelden. Push-Anmeldungen hängen ebenfalls an der Herkunft.

## Wartung, die irgendwann fällig wird

**Team-Stärken jede Saison auffrischen.** Die Werte in `game/sportsbook.js`
stammen aus der abgeschlossenen Saison 2025/26: Punkte und Tordifferenz pro
Spiel aus den Abschlusstabellen von football-data.org, linear auf die Skala
abgebildet (Spitze etwa 92, Mittelfeld etwa 70, Schlusslicht etwa 59).
Aufsteiger haben keine Erstliga-Bilanz und bekommen zwei Punkte unter dem
schwächsten verbleibenden Team.

Warum das wichtig ist: fällt ein Team auf den Standardwert 70 zurück, wird es
wie ein Durchschnittsteam bepreist. Bayern gegen einen Aufsteiger wäre dann
ein Münzwurf, und jeder, der Fußball guckt, druckt gegen die Bank Chips.

Zum Auffrischen die Tabellen der letzten abgeschlossenen Saison ziehen
(`/v4/competitions/{BL1,PL,PD}/standings?season=JJJJ`) und dasselbe Verfahren
laufen lassen.

**Rate-Limit:** football-data.org erlaubt im Free-Tier 10 Anfragen pro Minute.
Beim Testen mit Abstand abfragen, sonst kommt HTTP 429 zurück. Der Poller im
Code hält 6,5 Sekunden Abstand ein.

## Der alte Server

Das Droplet bei DigitalOcean (IP 206.189.60.121, Frankfurt) antwortet seit dem
12.9.2026 mit anderen Host-Schlüsseln, und Port 443 ist zu. Es wurde also
gelöscht oder neu aufgesetzt, möglicherweise gehört die IP inzwischen jemand
anderem. Deshalb nicht mehr per SSH verbinden.

Auf dem Mac liegen dafür noch Reste, die man aufräumen kann:

* der Schlüssel `~/.ssh/id_ed25519_casino` und der Eintrag `Host casino` in `~/.ssh/config`
* der alte Eintrag in `known_hosts`, zu entfernen mit `ssh-keygen -R 206.189.60.121`

Im DigitalOcean-Konto nachsehen, ob dort noch etwas läuft und Guthaben verbraucht.
