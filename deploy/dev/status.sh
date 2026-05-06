#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT_DIR"

check_url() {
  label=$1
  url=$2
  if curl -sf "$url" >/dev/null 2>&1; then
    printf '%-24s ok     %s\n' "$label" "$url"
  else
    printf '%-24s failed %s\n' "$label" "$url"
  fi
}

check_workspace_url() {
  label=$1
  url=$2
  if docker compose -f compose.dev.yml exec -T workspace sh -lc "curl -sf '$url' >/dev/null 2>&1"; then
    printf '%-24s ok     %s\n' "$label" "$url"
  else
    printf '%-24s failed %s\n' "$label" "$url"
  fi
}

docker compose -f compose.dev.yml ps
echo
check_url "Default IPQ" "http://127.0.0.1:8090/api/v1/health"
check_url "PurCarte IPQ" "http://127.0.0.1:8091/api/v1/health"
check_workspace_url "Default IPQ proxy" "http://proxy:8090/api/v1/health"
check_workspace_url "PurCarte IPQ proxy" "http://proxy:8091/api/v1/health"
check_url "Vite frontend" "http://127.0.0.1:5173/"
check_url "Komari default" "http://127.0.0.1:8080/"
check_url "Komari PurCarte" "http://127.0.0.1:8081/"
