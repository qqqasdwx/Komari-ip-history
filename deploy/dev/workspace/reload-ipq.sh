#!/bin/sh
set -eu

cd /workspace

echo "[1/4] building frontend"
cd /workspace/web
npm run build

echo "[2/4] restarting backend"
sh /workspace/deploy/dev/workspace/stop-backend.sh
sh /workspace/deploy/dev/workspace/start-backend.sh

echo "[3/4] waiting for health"
ok=0
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8090/api/v1/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done

if [ "$ok" -ne 1 ]; then
  echo "ipq health check failed after restart" >&2
  echo "backend log:" >&2
  tail -n 80 /tmp/ipq-backend.log >&2 || true
  exit 1
fi

echo "[4/4] health ok"
curl -sf http://127.0.0.1:8090/api/v1/health
echo

echo "ipq frontend build and backend reload completed"
