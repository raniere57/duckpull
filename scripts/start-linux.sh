#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/duckpull.pid"
LOG_FILE="$RUNTIME_DIR/duckpull.log"
ENV_FILE="$ROOT_DIR/.env"
HOST="127.0.0.1"
PORT="5767"
FOREGROUND_MODE="${DUCKPULL_FOREGROUND:-0}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun não encontrado no PATH."
  exit 1
fi

mkdir -p "$RUNTIME_DIR"

if [ -f "$PID_FILE" ]; then
  CURRENT_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$CURRENT_PID" ] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    echo "duckpull já está em execução (PID $CURRENT_PID)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

while IFS='=' read -r key value; do
  case "$key" in
    DUCKPULL_HOST)
      HOST="${value:-$HOST}"
      ;;
    DUCKPULL_PORT)
      PORT="${value:-$PORT}"
      ;;
  esac
done < <(grep -E '^(DUCKPULL_HOST|DUCKPULL_PORT)=' "$ENV_FILE" 2>/dev/null || true)

if [ -z "$HOST" ]; then
  HOST="127.0.0.1"
fi
if [ -z "$PORT" ]; then
  PORT="5767"
fi

cd "$ROOT_DIR"
bun install

if [ ! -f "$ROOT_DIR/dist/index.html" ]; then
  echo "Build do frontend não encontrado. Executando build..."
  bun run build
fi

if [ "$FOREGROUND_MODE" = "1" ]; then
  echo "duckpull iniciando em foreground."
  echo "URL: http://$HOST:$PORT"
  exec bun start
fi

nohup bun start >>"$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

sleep 1
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "duckpull iniciado em segundo plano (PID $APP_PID)."
  echo "URL: http://$HOST:$PORT"
  echo "Log: $LOG_FILE"
else
  echo "duckpull falhou ao iniciar. Verifique $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
