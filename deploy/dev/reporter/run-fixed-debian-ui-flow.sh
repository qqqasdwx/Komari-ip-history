#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.dev.yml"
CONTAINER_NAME="${IPQ_FIXED_REPORTER_CONTAINER:-ipq-reporter-debian-dev}"
NODE_NAME="${IPQ_FIXED_REPORTER_NAME:-真实上报-Debian页面接入}"
CRON_EXPR="${IPQ_FIXED_REPORTER_CRON:-0 * * * *}"
TIMEZONE="${IPQ_FIXED_REPORTER_TIMEZONE:-UTC}"
OUTPUT_DIR="${ROOT_DIR}/web/playwright-output/fixed-debian-reporter"
COMMAND_JSON="${OUTPUT_DIR}/command.json"
CONTAINER_SCRIPT="${OUTPUT_DIR}/run-in-debian.sh"

mkdir -p "$OUTPUT_DIR"

docker compose -f "$COMPOSE_FILE" up -d proxy workspace komari-default
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" exec -T workspace sh -lc "
  cd /workspace/web &&
  IPQ_PUBLIC_BASE_URL='http://127.0.0.1:8090' \
  IPQ_INTEGRATION_PUBLIC_BASE_URL='http://127.0.0.1:8090' \
  KOMARI_DEFAULT_BASE_URL='http://proxy:8080' \
  IPQ_FIXED_REPORTER_NAME='${NODE_NAME}' \
  IPQ_FIXED_REPORTER_CRON='${CRON_EXPR}' \
  IPQ_FIXED_REPORTER_TIMEZONE='${TIMEZONE}' \
  IPQ_FIXED_REPORTER_COMMAND_PATH='/workspace/web/playwright-output/fixed-debian-reporter/command.json' \
  node playwright/prepare-fixed-debian-reporter-node.mjs
"

python3 - "$COMMAND_JSON" "$CONTAINER_SCRIPT" <<'PY'
import json
import pathlib
import re
import sys

command_path = pathlib.Path(sys.argv[1])
script_path = pathlib.Path(sys.argv[2])
data = json.loads(command_path.read_text())
command = data.get("installCommand", "")
if not re.search(r"(^|\s)'?-t'?(?=\s)", command):
    raise SystemExit("install command does not contain install-token argument")

patched, count = re.subn(
    r"https://raw\.githubusercontent\.com/\S+/deploy/install\.sh",
    "file:///workspace/deploy/install.sh",
    command,
    count=1,
)
if count != 1:
    raise SystemExit("failed to replace GitHub install script URL with local script path")
if "file:///workspace/deploy/install.sh" not in patched:
    raise SystemExit("patched install command does not use local install script")

script_path.write_text(
    "\n".join([
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update",
        "apt-get install -y --no-install-recommends ca-certificates curl",
        patched,
        "if command -v cron >/dev/null 2>&1; then",
        "  exec cron -f",
        "fi",
        "if command -v crond >/dev/null 2>&1; then",
        "  exec crond -f",
        "fi",
        "echo 'cron daemon was not installed; keeping container alive for inspection' >&2",
        "exec tail -f /dev/null",
        "",
    ])
)
script_path.chmod(0o755)
print(script_path)
PY

proxy_container="$(docker compose -f "$COMPOSE_FILE" ps -q proxy)"
if [ -z "$proxy_container" ]; then
  echo "proxy container is not running" >&2
  exit 1
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --network "container:${proxy_container}" \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  debian:12-slim \
  bash /workspace/web/playwright-output/fixed-debian-reporter/run-in-debian.sh >/dev/null

docker logs -f "$CONTAINER_NAME" &
logs_pid=$!
cleanup() {
  kill "$logs_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker compose -f "$COMPOSE_FILE" exec -T workspace sh -lc "
  cd /workspace/web &&
  IPQ_PUBLIC_BASE_URL='http://127.0.0.1:8090' \
  IPQ_FIXED_REPORTER_NAME='${NODE_NAME}' \
  IPQ_FIXED_REPORTER_COMMAND_PATH='/workspace/web/playwright-output/fixed-debian-reporter/command.json' \
  node playwright/verify-fixed-debian-reporter-node.mjs
"; then
  docker logs --tail=200 "$CONTAINER_NAME" >&2 || true
  exit 1
fi

echo "fixed Debian reporter UI flow verified: ${NODE_NAME}"
