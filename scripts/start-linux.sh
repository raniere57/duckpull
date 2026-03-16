#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun não encontrado no PATH."
  exit 1
fi

if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
  echo "Build do frontend não encontrado. Executando build..."
  cd "$ROOT_DIR/frontend"
  bun install
  bun run build
fi

cd "$ROOT_DIR/backend"
bun install
bun index.js
