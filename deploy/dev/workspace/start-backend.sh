#!/bin/sh
set -eu

LOG_FILE=/tmp/ipq-backend-bootstrap.log
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
mkdir -p /root/.tmp || fail
log "root_tmp=$(ls -ld /root/.tmp)"
if [ -f /root/.tmp/ipq-backend.pid ]; then
  OLD_PID="$(cat /root/.tmp/ipq-backend.pid 2>/dev/null || true)"
  log "old_pid=${OLD_PID}"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
    kill "${OLD_PID}" >/dev/null 2>&1 || true
    sleep 1
  fi
fi
rm -f /root/.tmp/ipq-backend.pid /root/.tmp/ipq-backend-bin
if ! go build -o /root/.tmp/ipq-backend-bin ./cmd/ipq >>"${LOG_FILE}" 2>&1; then
  fail
fi
log "binary=$(ls -l /root/.tmp/ipq-backend-bin)"
nohup /root/.tmp/ipq-backend-bin >/tmp/ipq-backend.log 2>&1 &
echo $! >/root/.tmp/ipq-backend.pid
log "new_pid=$(cat /root/.tmp/ipq-backend.pid 2>/dev/null || true)"
echo "backend started, log: /tmp/ipq-backend.log"
