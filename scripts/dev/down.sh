#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"
COMPOSE_FILE="$ROOT/compose.dev.yml"

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

stop_pid_file "$TMP_DIR/ipq-backend.pid"
stop_pid_file "$TMP_DIR/ipq-frontend.pid"

pkill -f "$ROOT/.tmp/dev-preview/ipq-dev-bin" >/dev/null 2>&1 || true
pkill -x ipq >/dev/null 2>&1 || true
pkill -f "go run ./cmd/ipq" >/dev/null 2>&1 || true
pkill -f "/node_modules/vite/bin/vite.js" >/dev/null 2>&1 || true
pkill -f "vite --host 0.0.0.0 --port 5173" >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" stop proxy komari workspace >/dev/null 2>&1 || true

echo "开发预览环境已停止。"
