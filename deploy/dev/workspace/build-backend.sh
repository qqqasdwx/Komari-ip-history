#!/bin/sh
set -eu

LOG_FILE=/tmp/ipq-backend-build.log
WORKSPACE_TMP=/workspace/.tmp
BINARY_PATH="${WORKSPACE_TMP}/ipq-backend-bin"

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
log "go=$(which go)"
if ! go version >>"${LOG_FILE}" 2>&1; then
  fail
fi
if ! go env GOCACHE GOPATH CGO_ENABLED GOOS GOARCH CC CXX >>"${LOG_FILE}" 2>&1; then
  fail
fi
log "gcc=$(which gcc || true)"
gcc --version >>"${LOG_FILE}" 2>&1 || true
rm -f "${BINARY_PATH}"
if ! go build -buildvcs=false -x -o "${BINARY_PATH}" ./cmd/ipq >>"${LOG_FILE}" 2>&1; then
  fail
fi
log "binary=$(ls -l "${BINARY_PATH}")"
echo "backend built: ${BINARY_PATH}"
