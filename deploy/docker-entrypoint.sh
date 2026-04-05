#!/usr/bin/env bash
set -euo pipefail

db_path="${IPQ_DB_PATH:-/data/ipq.db}"
db_dir="$(dirname "$db_path")"

mkdir -p "$db_dir"

exec /app/ipq
