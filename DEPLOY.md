# Betrieb & Deployment

Stand: 2026-09-05. Das Casino lief bis Juli 2026 auf Railway und liegt seitdem
auf einem eigenen Server.

## Wo läuft was

| | |
|---|---|
| **Öffentliche Adresse** | https://206-189-60-121.sslip.io |
| **Server** | DigitalOcean Droplet, Ubuntu 24.04 LTS, 1 GB RAM / 1 vCPU / 25 GB, Frankfurt |
| **IP** | 206.189.60.121 |
| **Kosten** | ca. 6 $/Monat, bezahlt per PayPal-Guthaben (kein Abo, keine Karte hinterlegt) |
| **Repo** | https://github.com/Vinzentfx/fake_casino |

`sslip.io` löst den Hostnamen auf die IP auf. Dadurch bekommt Caddy ein echtes
Let's-Encrypt-Zertifikat, ohne dass eine eigene Domain nötig ist. Eine richtige
Domain oder eine DuckDNS-Subdomain kann jederzeit davorgesetzt werden: DNS auf
die IP zeigen lassen, den Namen in `/etc/caddy/Caddyfile` eintragen,
`systemctl reload caddy`.

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

Umgebungsvariablen fürs lokale Testen stehen in `~/.claude/launch.json`.

## Deployen

Erst pushen, dann auf dem Server ausrollen:

```bash
git push origin main
ssh -i ~/.ssh/id_ed25519_casino root@206.189.60.121 casino-deploy
```

`casino-deploy` macht ein Backup, holt den Code, installiert Abhängigkeiten und
startet den Dienst neu. Während des Neustarts sehen Besucher etwa drei Sekunden
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

- privat: `~/.ssh/id_ed25519_casino` (bleibt auf dem Mac, wird niemals geteilt)
- öffentlich: `~/.ssh/id_ed25519_casino.pub` (liegt beim Droplet hinterlegt)

Bequemer wird es mit einem Eintrag in `~/.ssh/config`:

```
Host casino
    HostName 206.189.60.121
    User root
    IdentityFile ~/.ssh/id_ed25519_casino
```

Danach reicht `ssh casino` und `ssh casino casino-deploy`.
