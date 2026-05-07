#!/bin/sh
set -eu

WORKSPACE_TMP=${WORKSPACE_TMP:-/workspace/.tmp}
BINARY_PATH="${WORKSPACE_TMP}/ipq-acceptance-bin"

stop_pid_file() {
  pid_file=$1
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

stop_pid_file "${WORKSPACE_TMP}/ipq-default.pid"
stop_pid_file "${WORKSPACE_TMP}/ipq-purcarte.pid"

pkill -f "${BINARY_PATH}" >/dev/null 2>&1 || true

echo "acceptance backends stopped"
