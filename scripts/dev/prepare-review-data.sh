#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.tmp/dev-preview"
SUMMARY_PATH="${SUMMARY_PATH:-$TMP_DIR/review-data-summary.json}"
KOMARI_BASE_URL="${KOMARI_BASE_URL:-http://127.0.0.1:8080}"
IPQ_BASE_URL="${IPQ_BASE_URL:-http://127.0.0.1:8090}"
REAL_REPORTER_CONTAINER="${REAL_REPORTER_CONTAINER:-ipq-review-reporter}"
IPQ_DB_PATH="${IPQ_DB_PATH:-$ROOT/data/ipq/ipq.db}"
START_SCRIPT="${START_SCRIPT:-$ROOT/scripts/dev/up.sh}"

mkdir -p "$TMP_DIR"

ensure_url() {
  local url="$1"
  if ! curl -fsS "$url" >/dev/null 2>&1; then
    return 1
  fi
}

if ! ensure_url "$KOMARI_BASE_URL/" || ! ensure_url "$IPQ_BASE_URL/api/v1/health"; then
  "$START_SCRIPT"
fi

python3 "$ROOT/scripts/dev/prepare-review-data.py" "$KOMARI_BASE_URL" "$IPQ_BASE_URL" "$SUMMARY_PATH" "$IPQ_DB_PATH"

REAL_NODE_UUID="$(python3 - <<'PY' "$SUMMARY_PATH"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fp:
    data = json.load(fp)
node = next(item for item in data["nodes"] if item["category"] == "真实上报节点")
print(node["ipq_node_uuid"])
PY
)"

REAL_INSTALL_TOKEN="$(python3 - <<'PY' "$SUMMARY_PATH"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fp:
    data = json.load(fp)
node = next(item for item in data["nodes"] if item["category"] == "真实上报节点")
print(node["install_token"])
PY
)"

docker rm -f "$REAL_REPORTER_CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$REAL_REPORTER_CONTAINER" \
  --network host \
  -v "$ROOT/deploy:/workspace/deploy:ro" \
  ubuntu:24.04 \
  bash -lc "export DEBIAN_FRONTEND=noninteractive && apt-get update >/tmp/apt.log && apt-get install -y curl jq iproute2 cron ca-certificates >/tmp/apt-install.log && bash /workspace/deploy/install.sh --server '$IPQ_BASE_URL' --install-token '$REAL_INSTALL_TOKEN' && tail -f /dev/null" \
  >/dev/null

python3 - <<'PY' "$IPQ_BASE_URL" "$REAL_NODE_UUID"
import json
import sys
import time
import urllib.request
import http.cookiejar

base = sys.argv[1].rstrip("/")
node_uuid = sys.argv[2]
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
login = urllib.request.Request(
    f"{base}/api/v1/auth/login",
    data=json.dumps({"username": "admin", "password": "admin"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
opener.open(login).read()

deadline = time.time() + 180
while time.time() < deadline:
    with opener.open(f"{base}/api/v1/nodes/{node_uuid}") as response:
        payload = json.load(response)
    if payload.get("has_data"):
        print("真实上报节点已产生数据。")
        sys.exit(0)
    time.sleep(2)

raise SystemExit("等待真实上报节点出数超时，请检查 docker logs ipq-review-reporter")
PY

python3 - <<'PY' "$IPQ_BASE_URL" "$REAL_NODE_UUID"
import json
import sys
import urllib.request
import http.cookiejar

base = sys.argv[1].rstrip("/")
node_uuid = sys.argv[2]
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
login = urllib.request.Request(
    f"{base}/api/v1/auth/login",
    data=json.dumps({"username": "admin", "password": "admin"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
opener.open(login).read()

with opener.open(f"{base}/api/v1/nodes/{node_uuid}") as response:
    payload = json.load(response)

targets = payload.get("targets") or []
for target in targets[1:]:
    request = urllib.request.Request(
        f"{base}/api/v1/nodes/{node_uuid}/targets/{target['id']}",
        method="DELETE",
    )
    opener.open(request).read()
PY

printf '\n验收节点已准备完成：\n\n'
python3 - <<'PY' "$SUMMARY_PATH" "$IPQ_BASE_URL"
import json, sys
summary_path = sys.argv[1]
ipq_base = sys.argv[2].rstrip("/")
with open(summary_path, "r", encoding="utf-8") as fp:
    data = json.load(fp)
for item in data["nodes"]:
    print(f"- {item['category']}: {item['name']}")
    if item["komari_url"]:
        print(f"  Komari: {item['komari_url']}")
    if item["ipq_node_uuid"]:
        print(f"  IPQ: {ipq_base}/#/nodes/{item['ipq_node_uuid']}")
print(f"\n真实上报容器: {__import__('os').environ.get('REAL_REPORTER_CONTAINER', 'ipq-review-reporter')}")
print(f"摘要文件: {summary_path}")
PY
