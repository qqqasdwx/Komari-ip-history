#!/bin/sh
set -eu

WORKSPACE_DIR=${WORKSPACE_DIR:-/workspace}
DEFAULT_KOMARI_BASE_URL=${DEFAULT_KOMARI_BASE_URL:-http://proxy:8080}
PURCARTE_KOMARI_BASE_URL=${PURCARTE_KOMARI_BASE_URL:-http://proxy:8081}
DEFAULT_IPQ_BASE_URL=${DEFAULT_IPQ_BASE_URL:-http://127.0.0.1:8090}
PURCARTE_IPQ_BASE_URL=${PURCARTE_IPQ_BASE_URL:-http://127.0.0.1:8091}
RELEASE_IPQ_BASE_URL=${RELEASE_IPQ_BASE_URL:-http://127.0.0.1:8092}
FRONTEND_BASE_URL=${FRONTEND_BASE_URL:-http://127.0.0.1:5173}

wait_for_url() {
  label=$1
  url=$2
  attempts=${3:-60}

  ok=0
  for _ in $(seq 1 "$attempts"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 1
  done

  if [ "$ok" -ne 1 ]; then
    echo "$label is not ready: $url" >&2
    exit 1
  fi
}

cd "$WORKSPACE_DIR"

echo "[1/8] installing dependencies"
sh "$WORKSPACE_DIR/deploy/dev/workspace/bootstrap.sh"

echo "[2/8] building static frontend for backend-served acceptance pages"
cd "$WORKSPACE_DIR/web"
npm run build
cd "$WORKSPACE_DIR"

echo "[3/8] starting isolated IPQ backends"
sh "$WORKSPACE_DIR/deploy/dev/workspace/start-acceptance-backends.sh"
wait_for_url "Default IPQ backend" "$DEFAULT_IPQ_BASE_URL/api/v1/health" 60
wait_for_url "PurCarte IPQ backend" "$PURCARTE_IPQ_BASE_URL/api/v1/health" 60
wait_for_url "Release simulation IPQ backend" "$RELEASE_IPQ_BASE_URL/api/v1/health" 60

echo "[4/8] starting frontend dev server"
sh "$WORKSPACE_DIR/deploy/dev/workspace/start-frontend.sh"
wait_for_url "Vite frontend" "$FRONTEND_BASE_URL" 60

echo "[5/8] waiting for Komari instances"
wait_for_url "Komari default proxy" "$DEFAULT_KOMARI_BASE_URL" 90
wait_for_url "Komari PurCarte proxy" "$PURCARTE_KOMARI_BASE_URL" 90

echo "[6/8] configuring PurCarte theme"
python3 "$WORKSPACE_DIR/deploy/dev/workspace/setup-komari-purcarte.py" "$PURCARTE_KOMARI_BASE_URL"

echo "[7/8] rebuilding isolated seed data"
KOMARI_BASE_URL="$DEFAULT_KOMARI_BASE_URL" \
IPQ_BASE_URL="$DEFAULT_IPQ_BASE_URL" \
KOMARI_DISPLAY_BASE_URL=http://127.0.0.1:8080 \
IPQ_DB_PATH=/workspace/data/ipq-default/ipq.db \
sh "$WORKSPACE_DIR/deploy/dev/workspace/seed-dev-nodes.sh"

KOMARI_BASE_URL="$PURCARTE_KOMARI_BASE_URL" \
IPQ_BASE_URL="$PURCARTE_IPQ_BASE_URL" \
KOMARI_DISPLAY_BASE_URL=http://127.0.0.1:8081 \
IPQ_DB_PATH=/workspace/data/ipq-purcarte/ipq.db \
sh "$WORKSPACE_DIR/deploy/dev/workspace/seed-dev-nodes.sh"

echo "[8/8] acceptance environment ready"
echo "Default IPQ: $DEFAULT_IPQ_BASE_URL"
echo "PurCarte IPQ: $PURCARTE_IPQ_BASE_URL"
echo "Release simulation IPQ: $RELEASE_IPQ_BASE_URL"
echo "IPQ frontend dev server: $FRONTEND_BASE_URL"
echo "Komari default proxy: $DEFAULT_KOMARI_BASE_URL"
echo "Komari PurCarte proxy: $PURCARTE_KOMARI_BASE_URL"
