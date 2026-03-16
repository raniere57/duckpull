#!/usr/bin/env bash
set -euo pipefail

SYSTEMD_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_DIR}/duckpull.service"

systemctl --user disable --now duckpull.service >/dev/null 2>&1 || true
rm -f "$SERVICE_FILE"
systemctl --user daemon-reload

echo "Autostart do duckpull desabilitado."
