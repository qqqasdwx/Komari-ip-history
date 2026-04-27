#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

KOMARI_BASE_URL="http://127.0.0.1:8080" \
IPQ_BASE_URL="http://127.0.0.1:8090" \
IPQ_DB_PATH="$ROOT/data/ipq-default/ipq.db" \
SUMMARY_PATH="$ROOT/.tmp/dev-preview/review-data-default.json" \
REAL_REPORTER_CONTAINER="ipq-review-reporter-default" \
START_SCRIPT="$ROOT/scripts/dev/up-dual.sh" \
"$ROOT/scripts/dev/prepare-review-data.sh"

KOMARI_BASE_URL="http://127.0.0.1:8081" \
IPQ_BASE_URL="http://127.0.0.1:8091" \
IPQ_DB_PATH="$ROOT/data/ipq-purcarte/ipq.db" \
SUMMARY_PATH="$ROOT/.tmp/dev-preview/review-data-purcarte.json" \
REAL_REPORTER_CONTAINER="ipq-review-reporter-purcarte" \
START_SCRIPT="$ROOT/scripts/dev/up-dual.sh" \
"$ROOT/scripts/dev/prepare-review-data.sh"

echo
echo "双套验收数据已准备完成："
echo "- Default 摘要:   $ROOT/.tmp/dev-preview/review-data-default.json"
echo "- PurCarte 摘要:  $ROOT/.tmp/dev-preview/review-data-purcarte.json"
