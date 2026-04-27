#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"

echo "=== PIDs ==="
for file in "$TMP_DIR/ipq-backend.pid" "$TMP_DIR/ipq-frontend.pid"; do
  if [[ -f "$file" ]]; then
    printf '%s: %s\n' "$(basename "$file")" "$(cat "$file")"
  else
    printf '%s: (missing)\n' "$(basename "$file")"
  fi
done

echo
echo "=== Ports ==="
ss -ltnp | grep -E ':(8080|8090|5173)\b' || true

echo
echo "=== Health ==="
for url in \
  "http://127.0.0.1:8080/" \
  "http://127.0.0.1:8090/api/v1/health" \
  "http://127.0.0.1:5173/"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  printf '%s -> %s\n' "$url" "${code:-000}"
done
