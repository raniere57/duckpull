#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/data/runtime/duckpull.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "duckpull não está em execução."
  exit 0
fi

APP_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -z "$APP_PID" ]; then
  rm -f "$PID_FILE"
  echo "PID inválido removido."
  exit 0
fi

if kill -0 "$APP_PID" 2>/dev/null; then
  kill "$APP_PID"
  for _ in 1 2 3 4 5; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if kill -0 "$APP_PID" 2>/dev/null; then
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  echo "duckpull interrompido."
else
  echo "Processo não estava mais ativo."
fi

rm -f "$PID_FILE"
