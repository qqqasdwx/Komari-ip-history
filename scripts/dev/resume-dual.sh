#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_SUMMARY="$ROOT/.tmp/dev-preview/review-data-default.json"
PURCARTE_SUMMARY="$ROOT/.tmp/dev-preview/review-data-purcarte.json"

echo "[1/3] restoring dual runtime"
"$ROOT/scripts/dev/up-dual.sh"

echo "[2/3] checking persisted review datasets"
if python3 - <<'PY' "$DEFAULT_SUMMARY" "$PURCARTE_SUMMARY"
import json
import sys
import urllib.request
import http.cookiejar

stacks = [
    ("default", "http://127.0.0.1:8090", sys.argv[1]),
    ("purcarte", "http://127.0.0.1:8091", sys.argv[2]),
]

expected_categories = {
    "已接入 IPQ / 空节点",
    "已接入 IPQ / 无数据",
    "已接入 IPQ / 单条数据",
    "已接入 IPQ / 多条历史",
    "真实上报节点",
    "IPQ 独立节点",
}

for label, base, summary_path in stacks:
    with open(summary_path, "r", encoding="utf-8") as fp:
        summary = json.load(fp)
    categories = {item["category"] for item in summary.get("nodes", []) if item.get("ipq_node_uuid")}
    if categories != expected_categories:
        raise SystemExit(1)

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login = urllib.request.Request(
        f"{base}/api/v1/auth/login",
        data=json.dumps({"username": "admin", "password": "admin"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener.open(login).read()
    payload = json.load(opener.open(f"{base}/api/v1/nodes"))
    names = {item["name"] for item in payload.get("items", [])}
    expected_names = {item["name"] for item in summary.get("nodes", []) if item.get("ipq_node_uuid")}
    if names != expected_names:
        raise SystemExit(1)
PY
then
  echo "Persisted review datasets are intact."
else
  echo "Review datasets missing or inconsistent; rebuilding curated review data."
  "$ROOT/scripts/dev/prepare-review-data-dual.sh"
fi

echo "[3/3] dual environment ready"
