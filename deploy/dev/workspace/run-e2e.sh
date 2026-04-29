#!/bin/sh
set -eu

cd /workspace

sh /workspace/deploy/dev/workspace/reload-ipq.sh
sh /workspace/deploy/dev/workspace/seed-dev-nodes.sh
python3 /workspace/deploy/dev/workspace/setup-komari-purcarte.py "${KOMARI_PURCARTE_BASE_URL:-http://proxy:8081}"

cd /workspace/web

export IPQ_PUBLIC_BASE_URL="${IPQ_PUBLIC_BASE_URL:-http://127.0.0.1:8090}"
export IPQ_INTEGRATION_PUBLIC_BASE_URL="${IPQ_INTEGRATION_PUBLIC_BASE_URL:-http://proxy:8090}"
export KOMARI_DEFAULT_BASE_URL="${KOMARI_DEFAULT_BASE_URL:-http://proxy:8080}"
export KOMARI_PURCARTE_BASE_URL="${KOMARI_PURCARTE_BASE_URL:-http://proxy:8081}"

node playwright/verify-real-user-onboarding.mjs
node playwright/verify-react-preview-nodes.mjs

KOMARI_BASE_URL="${KOMARI_DEFAULT_BASE_URL}" \
KOMARI_THEME_SCENARIO=default \
EXPECTED_KOMARI_THEME=default \
node playwright/verify-embed-auth-flows.mjs

KOMARI_BASE_URL="${KOMARI_PURCARTE_BASE_URL}" \
KOMARI_THEME_SCENARIO=purcarte \
EXPECTED_KOMARI_THEME=purcarte \
node playwright/verify-embed-auth-flows.mjs

echo "playwright e2e checks completed"
