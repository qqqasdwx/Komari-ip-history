#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"

echo "=== PIDs ==="
for file in \
  "$TMP_DIR/ipq-backend-default.pid" \
  "$TMP_DIR/ipq-backend-purcarte.pid" \
  "$TMP_DIR/ipq-frontend-default.pid" \
  "$TMP_DIR/ipq-frontend-purcarte.pid" \
  "$TMP_DIR/komari-proxy-default.pid" \
  "$TMP_DIR/komari-proxy-purcarte.pid"; do
  if [[ -f "$file" ]]; then
    printf '%s: %s\n' "$(basename "$file")" "$(cat "$file")"
  else
    printf '%s: (missing)\n' "$(basename "$file")"
  fi
done

echo
echo "=== Ports ==="
ss -ltnp | grep -E ':(8080|8081|8090|8091|5173|5174)\b' || true

echo
echo "=== Health ==="
for url in \
  "http://127.0.0.1:8080/" \
  "http://127.0.0.1:8081/" \
  "http://127.0.0.1:8090/api/v1/health" \
  "http://127.0.0.1:8091/api/v1/health" \
  "http://127.0.0.1:5173/" \
  "http://127.0.0.1:5174/"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  printf '%s -> %s\n' "$url" "${code:-000}"
done
