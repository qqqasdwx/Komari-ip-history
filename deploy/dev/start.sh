#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT_DIR"

docker compose -f compose.dev.yml up -d --build
docker compose -f compose.dev.yml exec -T proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || docker compose -f compose.dev.yml restart proxy
docker compose -f compose.dev.yml exec -T workspace sh /workspace/deploy/dev/workspace/prepare-acceptance-env.sh
