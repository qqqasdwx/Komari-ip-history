#!/bin/sh
set -eu

cd /workspace/web

node playwright/verify-react-preview-nodes.mjs
node playwright/verify-embed-auth-flows.mjs

echo "playwright e2e checks completed"
