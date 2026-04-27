#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"
COMPOSE_FILE="$ROOT/compose.dev.yml"
BACKEND_BIN="$TMP_DIR/ipq-dev-bin"
BACKEND_PID_FILE="$TMP_DIR/ipq-backend.pid"
FRONTEND_PID_FILE="$TMP_DIR/ipq-frontend.pid"
BACKEND_LOG="$TMP_DIR/ipq-backend.log"
FRONTEND_LOG="$TMP_DIR/ipq-frontend.log"

mkdir -p "$TMP_DIR" "$ROOT/data/ipq" "$ROOT/data/komari"

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

kill_listeners_on_port() {
  local port="$1"
  local pids
  pids="$(ss -ltnp "( sport = :$port )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)"
  if [[ -n "${pids:-}" ]]; then
    while read -r pid; do
      [[ -n "${pid:-}" ]] || continue
      kill "$pid" >/dev/null 2>&1 || true
    done <<< "$pids"
    sleep 1
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "failed to start $label ($url)" >&2
  return 1
}

echo "[1/6] stopping stale local preview processes"
stop_pid_file "$BACKEND_PID_FILE"
stop_pid_file "$FRONTEND_PID_FILE"
pkill -f "$ROOT/.tmp/dev-preview/ipq-dev-bin" >/dev/null 2>&1 || true
pkill -x ipq >/dev/null 2>&1 || true
pkill -f "go run ./cmd/ipq" >/dev/null 2>&1 || true
pkill -f "/node_modules/vite/bin/vite.js" >/dev/null 2>&1 || true
pkill -f "vite --host 0.0.0.0 --port 5173" >/dev/null 2>&1 || true
kill_listeners_on_port 8090
kill_listeners_on_port 5173

echo "[2/6] ensuring compose services"
docker compose -f "$COMPOSE_FILE" stop workspace >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" up -d komari proxy

echo "[3/6] ensuring frontend dependencies"
if [[ ! -d "$ROOT/web/node_modules" || -z "$(ls -A "$ROOT/web/node_modules" 2>/dev/null)" ]]; then
  npm --prefix "$ROOT/web" ci
fi

echo "[4/6] building and starting IPQ backend on host"
go build -buildvcs=false -o "$BACKEND_BIN" "$ROOT/cmd/ipq"
(
  setsid bash -lc "
    echo \$\$ > \"$BACKEND_PID_FILE\"
    exec env \
      IPQ_APP_ENV=development \
      IPQ_LISTEN=:8090 \
      IPQ_BASE_PATH='' \
      IPQ_DB_PATH=\"$ROOT/data/ipq/ipq.db\" \
      IPQ_PUBLIC_BASE_URL='http://127.0.0.1:5173' \
      IPQ_COOKIE_SECURE=false \
      \"$BACKEND_BIN\"
  " </dev/null >>"$BACKEND_LOG" 2>&1 &
)

echo "[5/6] starting Vite dev server on host"
(
  setsid bash -lc "
    cd \"$ROOT/web\"
    echo \$\$ > \"$FRONTEND_PID_FILE\"
    exec node ./node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort
  " </dev/null >>"$FRONTEND_LOG" 2>&1 &
)

echo "[6/6] waiting for services"
wait_for_http "http://127.0.0.1:8080/" "Komari"
wait_for_http "http://127.0.0.1:8090/api/v1/health" "IPQ backend"
wait_for_http "http://127.0.0.1:5173/" "IPQ frontend"

cat <<EOF

开发预览环境已启动：

- Komari:  http://127.0.0.1:8080
- IPQ UI:  http://127.0.0.1:5173
- IPQ API: http://127.0.0.1:8090

默认账号：
- Komari: admin / admin
- IPQ:    admin / admin

日志：
- Backend:  $BACKEND_LOG
- Frontend: $FRONTEND_LOG

说明：
- Komari 注入链路会使用 http://127.0.0.1:5173 作为 IPQ 对外地址
- 这样你看到的页面和我调试时看到的是同一套实时刷新前端
EOF
