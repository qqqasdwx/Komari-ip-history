#!/bin/sh
set -eu

cd /workspace/web

node playwright/verify-injection.mjs
node playwright/verify-stage1-flows.mjs

echo "playwright e2e checks completed"
