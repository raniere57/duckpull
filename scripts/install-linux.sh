#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun não encontrado no PATH. Instale o Bun e rode este script novamente."
  exit 1
fi

mkdir -p "$ROOT_DIR/data/runtime"

if [ ! -f "$ROOT_DIR/.env" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

cd "$ROOT_DIR"
bun install
bun run build

echo "duckpull instalado."
echo "Edite $ROOT_DIR/.env se precisar e execute scripts/start-linux.sh"
