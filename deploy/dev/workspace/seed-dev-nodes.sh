#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
KOMARI_BASE_URL=${KOMARI_BASE_URL:-http://proxy:8080}
IPQ_BASE_URL=${IPQ_BASE_URL:-http://127.0.0.1:8090}
KOMARI_DISPLAY_BASE_URL=${KOMARI_DISPLAY_BASE_URL:-http://127.0.0.1:8080}

python3 "$SCRIPT_DIR/seed-dev-nodes.py" "$KOMARI_BASE_URL" "$IPQ_BASE_URL" "$KOMARI_DISPLAY_BASE_URL" "$@"
