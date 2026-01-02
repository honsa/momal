#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WS_PORT="${MOMAL_WS_PORT:-8080}"
HTTP_HOST="${MOMAL_HTTP_HOST:-0.0.0.0}"
HTTP_PORT="${MOMAL_HTTP_PORT:-8000}"

cd "$ROOT_DIR"

mkdir -p var/log

pids=()

cleanup() {
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "Starting WebSocket server on ws://localhost:${WS_PORT} ..."
MOMAL_WS_PORT="$WS_PORT" php server/ws-server.php > var/log/ws-server.log 2>&1 &
pids+=("$!")

echo "Starting HTTP server on http://${HTTP_HOST}:${HTTP_PORT} ..."
php -S "${HTTP_HOST}:${HTTP_PORT}" -t public public/index.php > var/log/http-server.log 2>&1 &
pids+=("$!")

echo "Logs:"
echo "  - var/log/ws-server.log"
echo "  - var/log/http-server.log"

echo "Press Ctrl+C to stop."
wait

