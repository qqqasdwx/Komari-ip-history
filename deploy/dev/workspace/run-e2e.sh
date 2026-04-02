#!/bin/sh
set -eu

cd /workspace/web

export IPQ_PUBLIC_BASE_URL="${IPQ_PUBLIC_BASE_URL:-http://127.0.0.1:8090}"
export IPQ_INTEGRATION_PUBLIC_BASE_URL="${IPQ_INTEGRATION_PUBLIC_BASE_URL:-http://workspace:8090}"
export KOMARI_BASE_URL="${KOMARI_BASE_URL:-http://proxy:8080}"

node playwright/verify-react-preview-nodes.mjs
node playwright/verify-embed-auth-flows.mjs

echo "playwright e2e checks completed"
