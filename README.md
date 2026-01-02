# Momal – Montagsmalen (PHP-only + Vanilla JS)

Kleines Multiplayer-MVP im Browser: Zeichnen (Canvas), Live-Chat/Antworten, Punkte und Highscore.

## Anforderungen

- PHP **8.3+** (CLI + Built-in server)
- Composer

## Setup

```sh
# im Projektordner
composer install
```

## Starten

### 1) WebSocket-Server (Ratchet)

```sh
php server/ws-server.php
```

Der Server lauscht standardmaessig auf `ws://localhost:8080`.

### 2) HTTP Server (Frontend + Highscore API)

In einem zweiten Terminal:

```sh
php -S 0.0.0.0:8000 -t public public/index.php
```

Dann im Browser oeffnen:

- `http://localhost:8000`

### Dev-Shortcut (beide Server zusammen)

```sh
./bin/dev.sh
```

Optional:

- `MOMAL_WS_PORT` (Default: `8080`)
- `MOMAL_HTTP_HOST` (Default: `0.0.0.0`)
- `MOMAL_HTTP_PORT` (Default: `8000`)

## Spielen

1. In 2 Browser-Tabs/Fenstern oeffnen.
2. Beide geben den gleichen Room-Code ein (z.B. `ABC123`).
3. Beide waehlen unterschiedliche Namen (Namen sind pro Raum eindeutig, case-insensitive).
4. Der Host (erster Spieler im Raum) klickt **„Runde starten“**.
5. Der Zeichner sieht das Wort und zeichnet. Die anderen raten im Chat.

## Hinweise

- MVP: Antworten muessen aktuell **exakt** stimmen (case-insensitive).
- Highscore wird **pro Raum** gespeichert in `var/highscore-by-room.json`.

## Troubleshooting

- Wenn `ws://localhost:8080` nicht geht: Port belegt? Dann `MOMAL_WS_PORT=8090 php server/ws-server.php` und in `public/app.js` den Port anpassen.

## Security / Hardening

### WebSocket Origin Allowlist (empfohlen)

Wenn du den WS-Server nicht komplett offen betreiben willst, setze eine Allowlist:

- `MOMAL_WS_ALLOWED_ORIGINS` (Comma-separated)

Beispiel:

```sh
MOMAL_WS_ALLOWED_ORIGINS="http://localhost:8000,http://127.0.0.1:8000" php server/ws-server.php
```

### WebSocket Payload Limits

Zum Schutz gegen grosse Nachrichten (DoS):

- `MOMAL_WS_MAX_TEXT_BYTES` (Default: `65536`)
- `MOMAL_WS_MAX_BINARY_BYTES` (Default: `131072`)

## Rate limiting (Spam-Schutz)

Der Server begrenzt die Frequenz von Chat/Guess und Draw-Events pro Connection.

- `MOMAL_CHAT_RATE_LIMIT_MS` (Default: `400`) – minimale Zeit zwischen Chat/Guess-Nachrichten
- `MOMAL_DRAW_RATE_LIMIT_MS` (Default: `10`) – minimale Zeit zwischen Draw-Events

Beispiel:

```sh
MOMAL_CHAT_RATE_LIMIT_MS=250 MOMAL_DRAW_RATE_LIMIT_MS=25 php server/ws-server.php
```

## Debug Tools

### WebSocket Smoke Test

Wenn du pruefen willst, ob ein Client ueberhaupt WebSocket-Nachrichten (JSON + Binary `MOML` Frames) empfaengt:

- Oeffne: `http://localhost:8000/ws-smoke.html`

Die Seite loggt:

- `json type=...` (z.B. `hello`, `room:snapshot`, `draw:batch`)
- `binary len=... prefix=MOML` (Binary Draw Frames)

Das ist hilfreich bei „Canvas bleibt weiss“ oder „nichts kommt beim Spieler an“.

### Server Debug Logging

Der WebSocket-Server hat optionales Debug-Logging (fuer Connect/Join/Draw/Broadcast). Aktivieren:

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

### PHPUnit

```sh
composer test
```

### PHPStan

```sh
composer stan
```

### Beides zusammen

```sh
composer check
```

## Lizenz

Dieses Projekt steht unter der **MIT License** (siehe `LICENSE`).

Drittanbieter-Abhaengigkeiten werden per Composer eingebunden; Details siehe `THIRD_PARTY_NOTICES.md`.
