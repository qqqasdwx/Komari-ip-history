#!/bin/sh
set -eu

LOG_FILE=/tmp/ipq-backend-bootstrap.log
WORKSPACE_TMP=/workspace/.tmp
BINARY_PATH="${WORKSPACE_TMP}/ipq-backend-bin"
PID_PATH="${WORKSPACE_TMP}/ipq-backend.pid"
rm -f "${LOG_FILE}"

log() {
  printf '%s\n' "$*" >>"${LOG_FILE}"
}

fail() {
  cat "${LOG_FILE}" >&2 || true
  exit 1
}

cd /workspace
log "pwd=$(pwd)"
log "user=$(id)"
mkdir -p "${WORKSPACE_TMP}" || fail
log "workspace_tmp=$(ls -ld "${WORKSPACE_TMP}")"
if [ -f "${PID_PATH}" ]; then
  OLD_PID="$(cat "${PID_PATH}" 2>/dev/null || true)"
  log "old_pid=${OLD_PID}"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
    kill "${OLD_PID}" >/dev/null 2>&1 || true
    sleep 1
  fi
fi
rm -f "${PID_PATH}"
if [ ! -x "${BINARY_PATH}" ]; then
  if ! go build -buildvcs=false -o "${BINARY_PATH}" ./cmd/ipq >>"${LOG_FILE}" 2>&1; then
    fail
  fi
fi
log "binary=$(ls -l "${BINARY_PATH}")"
nohup "${BINARY_PATH}" >/tmp/ipq-backend.log 2>&1 &
echo $! >"${PID_PATH}"
log "new_pid=$(cat "${PID_PATH}" 2>/dev/null || true)"
echo "backend started, log: /tmp/ipq-backend.log"
