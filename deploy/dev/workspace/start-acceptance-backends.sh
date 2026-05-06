#!/bin/sh
set -eu

WORKSPACE_TMP=${WORKSPACE_TMP:-/workspace/.tmp}
BINARY_PATH="${WORKSPACE_TMP}/ipq-acceptance-bin"
LOG_PREFIX=${LOG_PREFIX:-/tmp}

cd /workspace
mkdir -p "$WORKSPACE_TMP" /workspace/data/ipq-default /workspace/data/ipq-purcarte

sh /workspace/deploy/dev/workspace/stop-backend.sh >/dev/null 2>&1 || true
sh /workspace/deploy/dev/workspace/stop-acceptance-backends.sh >/dev/null 2>&1 || true

go build -buildvcs=false -o "$BINARY_PATH" ./cmd/ipq

start_backend() {
  name=$1
  port=$2
  db_path=$3
  public_base_url=$4
  pid_path="${WORKSPACE_TMP}/ipq-${name}.pid"
  log_path="${LOG_PREFIX}/ipq-${name}.log"

  IPQ_APP_ENV=development \
  IPQ_LISTEN=":${port}" \
  IPQ_BASE_PATH="" \
  IPQ_DB_PATH="$db_path" \
  IPQ_DEFAULT_ADMIN_USERNAME=admin \
  IPQ_DEFAULT_ADMIN_PASSWORD=admin \
  IPQ_PUBLIC_BASE_URL="$public_base_url" \
  IPQ_COOKIE_SECURE=false \
  VITE_BASE_PATH=/ \
  nohup "$BINARY_PATH" >"$log_path" 2>&1 &

  echo $! >"$pid_path"
  echo "${name} backend started on ${port}, log: ${log_path}"
}

start_backend default 8090 /workspace/data/ipq-default/ipq.db "${IPQ_DEFAULT_PUBLIC_BASE_URL:-http://127.0.0.1:8090}"
start_backend purcarte 8091 /workspace/data/ipq-purcarte/ipq.db "${IPQ_PURCARTE_PUBLIC_BASE_URL:-http://127.0.0.1:8091}"
