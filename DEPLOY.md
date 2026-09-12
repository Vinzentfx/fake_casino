# Betrieb & Deployment

Stand: 2026-09-05. Das Casino lief bis Juli 2026 auf Railway und liegt seitdem
auf einem eigenen Server.

## Wo läuft was

| | |
|---|---|
| **Öffentliche Adresse** | https://chipstadt.de |
| **Weitere Namen** | www.chipstadt.de · fake-casino.duckdns.org · www.fake-casino.duckdns.org · cas-porta.duckdns.org · 206-189-60-121.sslip.io (alle bleiben aktiv) |
| **Server** | DigitalOcean Droplet, Ubuntu 24.04 LTS, 1 GB RAM / 1 vCPU / 25 GB, Frankfurt |
| **IP** | 206.189.60.121 |
| **Kosten** | ca. 6 $/Monat, bezahlt per PayPal-Guthaben (kein Abo, keine Karte hinterlegt) |
| **Repo** | https://github.com/Vinzentfx/fake_casino |

Seit 7.9.2026 ist **chipstadt.de** die Hauptadresse, registriert bei INWX für
rund 6 €/Jahr, bezahlt aus PayPal-Guthaben (Prepaid, keine Karte hinterlegt).
Drei A-Records (`@`, `www`, `*`) zeigen auf 206.189.60.121, die Nameserver
bleiben bei INWX.

**Warum eine eigene Domain, obwohl DuckDNS technisch reichte:** Schulnetze und
andere gefilterte Netze sperren `duckdns.org` als Dynamic DNS und `sslip.io`
als Proxy-Werkzeug, beides sind Standardkategorien in Web-Filtern. Die Seite
war dort entweder gar nicht erreichbar (Verbindung läuft ins Leere) oder warf
eine Zertifikatswarnung, weil der Filter sich in die TLS-Verbindung klinkt.
Eine normale Domain fällt in keine dieser Kategorien. Aus demselben Grund
steht bewusst **kein** "casino" im Namen: Filter kategorisieren auch nach dem
Domainnamen, und das wäre als Glücksspiel eingestuft worden.

Alle alten Namen bleiben im Caddyfile stehen, damit verschickte Links und
Lesezeichen nicht kaputtgehen. Solange nicht bestätigt ist, dass `chipstadt.de`
in den gefilterten Netzen wirklich durchkommt, bleiben sie auch **direkt**
erreichbar statt umgeleitet: sie sind der Rückfall, falls die neue Domain
ebenfalls gesperrt wird.

**Achtung bei einem Domainwechsel:** `localStorage` gehört zur Herkunft
(Origin). Wer über einen neuen Namen kommt, hat kein Sitzungstoken und muss
sich einmal neu anmelden. Push-Anmeldungen hängen ebenfalls an der Herkunft;
wer auf beiden Namen zustimmt, bekommt jede Nachricht doppelt.

Ein weiterer Name kommt so dazu: DNS auf die IP zeigen lassen, den Namen in
`/etc/caddy/Caddyfile` in die Zeile vor der `{` aufnehmen (kommagetrennt),
`systemctl reload caddy`. Caddy holt das Let's-Encrypt-Zertifikat dann selbst,
das dauert rund fünf Sekunden.

**Achtung bei DuckDNS:** die Seite trägt beim Anlegen automatisch die IP ein,
von der man gerade kommt. Die muss man auf die Server-IP ändern, sonst zeigt
die Domain auf den eigenen Anschluss.

### Aufbau auf dem Server

```
/opt/casino/app        Code (git clone), läuft als System-User "casino"
/opt/casino/app/data   Spielstände (gitignored, NUR hier liegen die echten Daten)
/opt/casino/backups    tägliche Backups, 14 Tage
/etc/casino.env        Secrets, chmod 600, gehört root
/etc/systemd/system/casino.service
/etc/caddy/Caddyfile
```

Node läuft auf Port 3000 und ist nur lokal erreichbar. Caddy nimmt 443 entgegen
und reicht durch, inklusive WebSocket-Upgrade für Socket.IO. Die Firewall (ufw)
lässt nur SSH, 80 und 443 zu.

## Lokal entwickeln

```bash
cd ~/fake-casino && npm start
```

Läuft auf http://localhost:3000. Der lokale `data/`-Ordner ist **Testmüll**
(Accounts wie `captest` mit Milliarden Chips) und hat nichts mit den echten
Spielständen zu tun. Zum Testen ist das genau richtig, verwechsle es nur nicht
mit dem Produktivstand.

Umgebungsvariablen fürs lokale Testen stehen in der lokalen Startkonfiguration (nicht im Repo).

## Deployen

Erst pushen, dann auf dem Server ausrollen:

```bash
git push origin main
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121 casino-deploy
```

`casino-deploy` macht ein Backup, holt den Code, installiert Abhängigkeiten und
startet den Dienst neu.

Seit 6.9.2026 hängt eine neue Abhängigkeit dran (`web-push`), die kommt über den
Installationsschritt automatisch mit. Beim ersten Start danach legt der Server
`data/vapid.json` an, den Schlüssel für Benachrichtigungen. Die Datei liegt in
`data/`, ist also gitignored und wird mitgesichert. Löscht man sie, muss sich
jedes Gerät neu anmelden. Während des Neustarts sehen Besucher etwa drei Sekunden
lang einen 502. Nicht mitten in einer Pokerrunde deployen.

## Backups

Automatisch jede Nacht um 04:00 nach `/opt/casino/backups`, 14 Tage
Aufbewahrung. Zusätzlich läuft vor jedem Deploy eines.

```bash
# Sofort-Backup
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121 casino-backup

# Backups ansehen
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121 'ls -la /opt/casino/backups'

# Eines auf den Mac holen
scp -i ~/.ssh/id_ed25519_casino root@206.189.60.121:/opt/casino/backups/data_JJJJ-MM-TT_HHMM.tar.gz ~/Downloads/
```

Unabhängig davon gibt es im Spiel den Owner-Backup-Knopf, der den kompletten
`data/`-Ordner als eine JSON-Datei herunterlädt und wieder einspielen kann.
Genau daraus wurden beim Umzug die 70 Accounts wiederhergestellt.

### Wiederherstellen

```bash
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121
systemctl stop casino
tar -xzf /opt/casino/backups/data_JJJJ-MM-TT_HHMM.tar.gz -C /opt/casino/app
chown -R casino:casino /opt/casino/app/data
systemctl start casino
```

## Umgebungsvariablen

Stehen in `/etc/casino.env` (nur für root lesbar, deshalb liegt der API-Token
nicht in der systemd-Unit, die wäre für alle lesbar).

| Variable | Bedeutung |
|---|---|
| `FOOTBALL_DATA_TOKEN` | Zugang zu football-data.org für echte Fußballspiele |
| `FOOTBALL_DATA_COMPS` | Welche Wettbewerbe, aktuell `BL1,PL,PD` |
| `SPORTS_SIM` | auf `off` setzen, um die simulierten Füllspiele auszublenden |
| `PORT` | steht in der systemd-Unit, 3000 |

Nach Änderungen:

```bash
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121 'systemctl restart casino'
```

## Server-Befehle

```bash
# Verbinden
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121

# Läuft alles?
systemctl status casino caddy

# Logs live mitlesen
journalctl -u casino -f

# Neustart ohne Deploy
systemctl restart casino
```

## Wartung, die irgendwann fällig wird

**Team-Stärken jede Saison auffrischen.** Die Werte in `game/sportsbook.js`
stammen aus der abgeschlossenen Saison 2025/26: Punkte und Tordifferenz pro
Spiel aus den Abschlusstabellen von football-data.org, linear auf die Skala
abgebildet (Spitze ~92, Mittelfeld ~70, Schlusslicht ~59). Aufsteiger haben
keine Erstliga-Bilanz und bekommen zwei Punkte unter dem schwächsten
verbleibenden Team.

Warum das wichtig ist: fällt ein Team auf den Standardwert 70 zurück, wird es
wie ein Durchschnittsteam bepreist. Bayern gegen einen Aufsteiger wäre dann
ein Münzwurf, und jeder, der Fußball guckt, druckt gegen die Bank Chips.

Zum Auffrischen die Standings der letzten abgeschlossenen Saison ziehen
(`/v4/competitions/{BL1,PL,PD}/standings?season=JJJJ`) und dasselbe Verfahren
laufen lassen.

**Achtung Rate-Limit:** football-data.org erlaubt im Free-Tier 10 Anfragen pro
Minute. Beim Testen mit Abstand abfragen, sonst kommt HTTP 429 zurück. Der
Poller im Code hält mit 6,5 Sekunden Abstand ein.

**PayPal-Guthaben nachladen.** Bei DigitalOcean liegt keine Karte hinterlegt.
Läuft das Guthaben leer, wird der Server abgeschaltet. Gelegentlich nachsehen.

## SSH-Zugang

Der Schlüssel wurde eigens für dieses Droplet erzeugt:

* privat: `~/.ssh/id_ed25519_casino` (bleibt auf dem Mac, wird niemals geteilt)
* öffentlich: `~/.ssh/id_ed25519_casino.pub` (liegt beim Droplet hinterlegt)

Bequemer wird es mit einem Eintrag in `~/.ssh/config`:

```
Host casino
    HostName 206.189.60.121
    User root
    IdentityFile ~/.ssh/id_ed25519_casino
```

Danach reicht `ssh casino` und `ssh casino casino-deploy`.
