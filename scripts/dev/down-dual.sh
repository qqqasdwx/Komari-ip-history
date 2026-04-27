#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"
COMPOSE_FILE="$ROOT/compose.dev.dual.yml"

stop_pid_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$file"
  fi
}

for file in \
  "$TMP_DIR/ipq-backend-default.pid" \
  "$TMP_DIR/ipq-backend-purcarte.pid" \
  "$TMP_DIR/ipq-frontend-default.pid" \
  "$TMP_DIR/ipq-frontend-purcarte.pid" \
  "$TMP_DIR/komari-proxy-default.pid" \
  "$TMP_DIR/komari-proxy-purcarte.pid"; do
  stop_pid_file "$file"
done

pkill -f "$ROOT/.tmp/dev-preview/ipq-dev-bin" >/dev/null 2>&1 || true
pkill -f "/node_modules/vite/bin/vite.js" >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" stop komari-default komari-purcarte >/dev/null 2>&1 || true

echo "双套开发预览环境已停止。"
