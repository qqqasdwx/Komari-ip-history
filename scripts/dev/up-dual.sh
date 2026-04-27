#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"
COMPOSE_FILE="$ROOT/compose.dev.dual.yml"
BACKEND_BIN="$TMP_DIR/ipq-dev-bin"
CONFIG_SUMMARY="$TMP_DIR/dual-config-summary.json"
PROXY_SCRIPT="$ROOT/scripts/dev/http_reverse_proxy.py"

mkdir -p \
  "$TMP_DIR" \
  "$ROOT/data/ipq-default" \
  "$ROOT/data/ipq-purcarte" \
  "$ROOT/data/komari-default" \
  "$ROOT/data/komari-purcarte"

if [[ ! -d "$ROOT/data/komari-purcarte" || -z "$(ls -A "$ROOT/data/komari-purcarte" 2>/dev/null)" ]]; then
  if [[ -d "$ROOT/data/komari" && -n "$(ls -A "$ROOT/data/komari" 2>/dev/null)" ]]; then
    rm -rf "$ROOT/data/komari-purcarte"
    mkdir -p "$ROOT/data/komari-purcarte"
    cp -a "$ROOT/data/komari/." "$ROOT/data/komari-purcarte/"
  fi
fi

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
  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "failed to start $label ($url)" >&2
  return 1
}

start_backend() {
  local name="$1"
  local port="$2"
  local db_path="$3"
  local public_base_url="$4"
  local pid_file="$TMP_DIR/ipq-backend-${name}.pid"
  local log_file="$TMP_DIR/ipq-backend-${name}.log"
  stop_pid_file "$pid_file"
  (
    setsid bash -lc "
      echo \$\$ > \"$pid_file\"
      exec env \
        IPQ_APP_ENV=development \
        IPQ_LISTEN=:$port \
        IPQ_BASE_PATH='' \
        IPQ_DB_PATH=\"$db_path\" \
        IPQ_PUBLIC_BASE_URL='$public_base_url' \
        IPQ_COOKIE_SECURE=false \
        \"$BACKEND_BIN\"
    " </dev/null >>"$log_file" 2>&1 &
  )
}

start_frontend() {
  local name="$1"
  local port="$2"
  local proxy_target="$3"
  local pid_file="$TMP_DIR/ipq-frontend-${name}.pid"
  local log_file="$TMP_DIR/ipq-frontend-${name}.log"
  stop_pid_file "$pid_file"
  (
    setsid bash -lc "
      cd \"$ROOT/web\"
      echo \$\$ > \"$pid_file\"
      exec env \
        VITE_DEV_PORT='$port' \
        VITE_PROXY_TARGET='$proxy_target' \
        node ./node_modules/vite/bin/vite.js --host 0.0.0.0 --port $port --strictPort
    " </dev/null >>"$log_file" 2>&1 &
  )
}

start_komari_proxy() {
  local name="$1"
  local port="$2"
  local target="$3"
  local pid_file="$TMP_DIR/komari-proxy-${name}.pid"
  local log_file="$TMP_DIR/komari-proxy-${name}.log"
  stop_pid_file "$pid_file"
  (
    setsid bash -lc "
      echo \$\$ > \"$pid_file\"
      exec python3 \"$PROXY_SCRIPT\" --listen-host 127.0.0.1 --listen-port $port --target '$target'
    " </dev/null >>"$log_file" 2>&1 &
  )
}

echo "[1/7] stopping old single/dual preview processes"
"$ROOT/scripts/dev/down.sh" >/dev/null 2>&1 || true
stop_pid_file "$TMP_DIR/ipq-backend-default.pid"
stop_pid_file "$TMP_DIR/ipq-backend-purcarte.pid"
stop_pid_file "$TMP_DIR/ipq-frontend-default.pid"
stop_pid_file "$TMP_DIR/ipq-frontend-purcarte.pid"
stop_pid_file "$TMP_DIR/komari-proxy-default.pid"
stop_pid_file "$TMP_DIR/komari-proxy-purcarte.pid"
pkill -f "$ROOT/.tmp/dev-preview/ipq-dev-bin" >/dev/null 2>&1 || true
pkill -f "/node_modules/vite/bin/vite.js" >/dev/null 2>&1 || true
for port in 8080 8081 8090 8091 5173 5174; do
  kill_listeners_on_port "$port"
done

echo "[2/7] ensuring dual Komari services"
docker compose -f "$COMPOSE_FILE" up -d komari-default komari-purcarte

echo "[3/7] ensuring frontend dependencies"
if [[ ! -d "$ROOT/web/node_modules" || -z "$(ls -A "$ROOT/web/node_modules" 2>/dev/null)" ]]; then
  npm --prefix "$ROOT/web" ci
fi

echo "[4/7] building IPQ backend binary"
go build -buildvcs=false -o "$BACKEND_BIN" "$ROOT/cmd/ipq"

echo "[5/7] starting two IPQ backends"
start_backend "default" "8090" "$ROOT/data/ipq-default/ipq.db" "http://127.0.0.1:5173"
start_backend "purcarte" "8091" "$ROOT/data/ipq-purcarte/ipq.db" "http://127.0.0.1:5174"

echo "[6/7] starting two Vite frontends"
start_frontend "default" "5173" "http://127.0.0.1:8090"
start_frontend "purcarte" "5174" "http://127.0.0.1:8091"

echo "[7/7] waiting for services and configuring loader injection"
wait_for_http "http://127.0.0.1:8090/api/v1/health" "IPQ default backend"
wait_for_http "http://127.0.0.1:8091/api/v1/health" "IPQ PurCarte backend"
wait_for_http "http://127.0.0.1:5173/" "IPQ default frontend"
wait_for_http "http://127.0.0.1:5174/" "IPQ PurCarte frontend"

if ! curl -fsS "http://127.0.0.1:8080/" >/dev/null 2>&1; then
  default_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' komari-ip-history-komari-default-1)"
  start_komari_proxy "default" "8080" "http://${default_ip}:25774"
fi
if ! curl -fsS "http://127.0.0.1:8081/" >/dev/null 2>&1; then
  purcarte_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' komari-ip-history-komari-purcarte-1)"
  start_komari_proxy "purcarte" "8081" "http://${purcarte_ip}:25774"
fi
wait_for_http "http://127.0.0.1:8080/" "Komari default"
wait_for_http "http://127.0.0.1:8081/" "Komari PurCarte"

python3 "$ROOT/scripts/dev/configure_dual_env.py" \
  "http://127.0.0.1:8080" "http://127.0.0.1:8090" "http://127.0.0.1:5173" \
  "http://127.0.0.1:8081" "http://127.0.0.1:8091" "http://127.0.0.1:5174" \
  "$CONFIG_SUMMARY" "default" "purcarte" >/dev/null

cat <<EOF

双套本地预览环境已启动：

- Default Komari:    http://127.0.0.1:8080
- Default IPQ UI:    http://127.0.0.1:5173
- Default IPQ API:   http://127.0.0.1:8090

- PurCarte Komari:   http://127.0.0.1:8081
- PurCarte IPQ UI:   http://127.0.0.1:5174
- PurCarte IPQ API:  http://127.0.0.1:8091

默认账号：
- Komari(default):   admin / admin
- Komari(purcarte):  admin / admin
- IPQ(default):      admin / admin
- IPQ(purcarte):     admin / admin

配置摘要：
- $CONFIG_SUMMARY
EOF
