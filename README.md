# Momal – Montagsmalen (PHP-only + Vanilla JS)

Kleines Multiplayer-MVP im Browser: Zeichnen (Canvas), Live-Chat/Antworten, Punkte und Highscore.

## Anforderungen

- PHP **8.3+** (CLI + Built-in server)
- Composer

## Setup

```sh
cd /home/honsa/PhpstormProjects/momal
composer install
```

## Starten

### 1) WebSocket-Server (Ratchet)

```sh
cd /home/honsa/PhpstormProjects/momal
php server/ws-server.php
```

Der Server lauscht standardmäßig auf `ws://localhost:8080`.

### 2) HTTP Server (Frontend + Highscore API)

In einem zweiten Terminal:

```sh
cd /home/honsa/PhpstormProjects/momal
php -S 0.0.0.0:8000 -t public public/index.php
```

Dann im Browser öffnen:

- `http://localhost:8000`

### Dev-Shortcut (beide Server zusammen)

```sh
cd /home/honsa/PhpstormProjects/momal
./bin/dev.sh
```

Optional:

- `MOMAL_WS_PORT` (Default: `8080`)
- `MOMAL_HTTP_HOST` (Default: `0.0.0.0`)
- `MOMAL_HTTP_PORT` (Default: `8000`)

## Spielen

1. In 2 Browser-Tabs/Fenstern öffnen.
2. Beide geben den gleichen Room-Code ein (z.B. `ABC123`).
3. Der Host (erster Spieler im Raum) klickt **„Runde starten“**.
4. Der Zeichner sieht das Wort und zeichnet. Die anderen raten im Chat.

## Hinweise

- MVP: Lösung muss aktuell **exakt** stimmen (case-insensitive).
- Highscore wird in `var/highscore.json` gespeichert.

## Troubleshooting

- Wenn `ws://localhost:8080` nicht geht: Port belegt? Dann `MOMAL_WS_PORT=8090 php server/ws-server.php` und in `public/app.js` den Port anpassen.

### Rate limiting (Spam-Schutz)

Der Server begrenzt die Frequenz von Chat/Guess und Draw-Events pro Connection.

- `MOMAL_CHAT_RATE_LIMIT_MS` (Default: `400`) – minimale Zeit zwischen Chat/Guess-Nachrichten
- `MOMAL_DRAW_RATE_LIMIT_MS` (Default: `10`) – minimale Zeit zwischen Draw-Events

Beispiel:

```sh
MOMAL_CHAT_RATE_LIMIT_MS=250 MOMAL_DRAW_RATE_LIMIT_MS=25 php server/ws-server.php
```

## Debug Tools

### WebSocket Smoke Test

Wenn du prüfen willst, ob ein Client überhaupt WebSocket-Nachrichten (JSON + Binary `MOML` Frames) empfängt:

- Öffne: `http://localhost:8000/ws-smoke.html`

Die Seite loggt:

- `json type=...` (z.B. `hello`, `room:snapshot`, `draw:batch`)
- `binary len=... prefix=MOML` (Binary Draw Frames)

Das ist hilfreich bei „Canvas bleibt weiß“ oder „nichts kommt beim Spieler an“.

### Server Debug Logging

Der WebSocket-Server hat optionales Debug-Logging (für Connect/Join/Draw/Broadcast). Aktivieren:

```sh
MOMAL_DEBUG_WS=1 php server/ws-server.php
```

Oder mit dem Dev-Script:

```sh
MOMAL_DEBUG_WS=1 ./bin/dev.sh
```

Die Logs landen in:

- `var/log/ws-server.log`

## Tests & Code-Analyse

### Pop!_OS Install-Hinweis

Falls du PHP/Composer noch nicht installiert hast:

```sh
sudo apt update
sudo apt install -y php php-cli php-mbstring php-xml unzip composer
```

### PHPUnit

```sh
cd /home/honsa/PhpstormProjects/momal
composer test
```

### PHPStan

```sh
cd /home/honsa/PhpstormProjects/momal
composer stan
```

### Beides zusammen

```sh
cd /home/honsa/PhpstormProjects/momal
composer check
```