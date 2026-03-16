#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_DIR}/duckpull.service"

mkdir -p "$SYSTEMD_DIR"

cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=duckpull local artifact sync client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
Environment=DUCKPULL_FOREGROUND=1
ExecStart=${ROOT_DIR}/scripts/start-linux.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable duckpull.service
systemctl --user restart duckpull.service

echo "Autostart do duckpull habilitado no systemd do usuário."
echo "Service file: $SERVICE_FILE"
