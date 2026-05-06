#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT_DIR"

docker rm -f ipq-reporter-debian-dev >/dev/null 2>&1 || true
if docker compose -f compose.dev.yml ps -q workspace >/dev/null 2>&1; then
  docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/stop-frontend.sh >/dev/null 2>&1 || true
  docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/stop-acceptance-backends.sh >/dev/null 2>&1 || true
  docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/stop-backend.sh >/dev/null 2>&1 || true
fi
docker compose -f compose.dev.yml down
