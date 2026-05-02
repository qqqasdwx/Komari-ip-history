#!/usr/bin/env bash
set -euo pipefail

NODE_UUID=""
SERVER_BASE_URL=""
INSTALL_TOKEN=""
REPORTER_TOKEN=""
SCHEDULE_CRON="0 0 * * *"
SCHEDULE_TIMEZONE="UTC"
RUN_IMMEDIATELY="1"
TARGET_IPS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--node-uuid)
      NODE_UUID="${2:-}"
      shift 2
      ;;
    -e|--server)
      SERVER_BASE_URL="${2:-}"
      shift 2
      ;;
    -t|--install-token)
      INSTALL_TOKEN="${2:-}"
      shift 2
      ;;
    --node-uuid)
      NODE_UUID="${2:-}"
      shift 2
      ;;
    --server)
      SERVER_BASE_URL="${2:-}"
      shift 2
      ;;
    --token)
      REPORTER_TOKEN="${2:-}"
      shift 2
      ;;
    --cron)
      SCHEDULE_CRON="${2:-}"
      shift 2
      ;;
    --timezone|--schedule-timezone)
      SCHEDULE_TIMEZONE="${2:-}"
      shift 2
      ;;
    --run-immediately)
      RUN_IMMEDIATELY="${2:-}"
      shift 2
      ;;
    --target-ip)
      TARGET_IPS+=("${2:-}")
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

if [[ -z "$SERVER_BASE_URL" ]]; then
  echo "Missing required argument: --server" >&2
  exit 1
fi

SERVER_BASE_URL="${SERVER_BASE_URL%/}"
LEGACY_INLINE_MODE=0
if [[ "$SERVER_BASE_URL" == */api/v1/report/nodes/* ]]; then
  LEGACY_INLINE_MODE=1
  REPORT_ENDPOINT="$SERVER_BASE_URL"
fi

if [[ "$LEGACY_INLINE_MODE" -eq 0 && -z "$INSTALL_TOKEN" && ( -z "$NODE_UUID" || -z "$REPORTER_TOKEN" ) ]]; then
  echo "Missing required arguments: --server and either --install-token or legacy --node-uuid + --token" >&2
  exit 1
fi

if [[ ${#TARGET_IPS[@]} -eq 0 && "$LEGACY_INLINE_MODE" -eq 1 ]]; then
  echo "At least one --target-ip is required." >&2
  exit 1
fi

install_dependencies() {
  local need_curl=0
  local need_cron=0
  local need_jq=0

  if ! command -v curl >/dev/null 2>&1; then
    need_curl=1
  fi
  if ! command -v crontab >/dev/null 2>&1 && [ ! -d /etc/cron.d ]; then
    need_cron=1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    need_jq=1
  fi
  if [ "$need_curl" -eq 0 ] && [ "$need_cron" -eq 0 ] && [ "$need_jq" -eq 0 ]; then
    return
  fi

  if command -v apt >/dev/null 2>&1; then
    apt update
    local packages=()
    [ "$need_curl" -eq 1 ] && packages+=("curl")
    [ "$need_cron" -eq 1 ] && packages+=("cron")
    [ "$need_jq" -eq 1 ] && packages+=("jq")
    apt install -y "${packages[@]}"
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    local packages=()
    [ "$need_curl" -eq 1 ] && packages+=("curl")
    [ "$need_cron" -eq 1 ] && packages+=("cronie")
    [ "$need_jq" -eq 1 ] && packages+=("jq")
    yum install -y "${packages[@]}"
    return
  fi

  if command -v apk >/dev/null 2>&1; then
    local packages=()
    [ "$need_curl" -eq 1 ] && packages+=("curl")
    [ "$need_cron" -eq 1 ] && packages+=("dcron")
    [ "$need_jq" -eq 1 ] && packages+=("jq")
    apk add --no-cache "${packages[@]}"
    return
  fi

  echo "Missing required dependencies (curl/cron/jq), and no supported package manager was found." >&2
  exit 1
}

install_dependencies

if [[ "$LEGACY_INLINE_MODE" -eq 0 ]]; then
  if [[ -n "$INSTALL_TOKEN" ]]; then
    CONFIG_URL="${SERVER_BASE_URL}/api/v1/report/install-config/${INSTALL_TOKEN}"
  else
    CONFIG_URL="${SERVER_BASE_URL}/api/v1/report/nodes/${NODE_UUID}/install-config"
  fi
  CONFIG_FILE="$(mktemp)"
  cleanup_config() {
    rm -f "$CONFIG_FILE"
  }
  trap cleanup_config EXIT

  if [[ -n "$INSTALL_TOKEN" ]]; then
    curl -fsSL "$CONFIG_URL" -o "$CONFIG_FILE"
  else
    curl -fsSL \
      -H "X-IPQ-Reporter-Token: ${REPORTER_TOKEN}" \
      "$CONFIG_URL" -o "$CONFIG_FILE"
  fi

  NODE_UUID="$(jq -er '.node_uuid' "$CONFIG_FILE")"
  REPORT_ENDPOINT="$(jq -er '.report_endpoint' "$CONFIG_FILE")"
  REPORTER_TOKEN="$(jq -er '.reporter_token' "$CONFIG_FILE")"
  SCHEDULE_CRON="$(jq -er '.schedule_cron' "$CONFIG_FILE")"
  SCHEDULE_TIMEZONE="$(jq -er '.schedule_timezone // "UTC"' "$CONFIG_FILE")"
  if jq -e '.run_immediately == true' "$CONFIG_FILE" >/dev/null 2>&1; then
    RUN_IMMEDIATELY="1"
  else
    RUN_IMMEDIATELY="0"
  fi
  mapfile -t TARGET_IPS < <(jq -er '.target_ips[]' "$CONFIG_FILE")
  if [[ -z "${REPORT_ENDPOINT:-}" ]]; then
    echo "Install config did not include report_endpoint." >&2
    exit 1
  fi
  if [[ ${#TARGET_IPS[@]} -eq 0 ]]; then
    echo "Install config did not include any target IPs." >&2
    exit 1
  fi
fi

UNIT_NAME="ipq-reporter-${NODE_UUID}"
INSTALL_DIR="/opt/${UNIT_NAME}"
SCRIPT_PATH="${INSTALL_DIR}/run.sh"
CRON_PATH="/etc/cron.d/${UNIT_NAME}"
LEGACY_SCRIPT_PATH="/usr/local/bin/${UNIT_NAME}.sh"
LEGACY_SERVICE_PATH="/etc/systemd/system/${UNIT_NAME}.service"
LEGACY_TIMER_PATH="/etc/systemd/system/${UNIT_NAME}.timer"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
  systemctl disable "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
  systemctl stop "${UNIT_NAME}.service" >/dev/null 2>&1 || true
  systemctl disable "${UNIT_NAME}.service" >/dev/null 2>&1 || true
fi

rm -f "$LEGACY_SERVICE_PATH" "$LEGACY_TIMER_PATH" "$LEGACY_SCRIPT_PATH" "$CRON_PATH"
mkdir -p "$INSTALL_DIR"

target_ip_literals=""
for target_ip in "${TARGET_IPS[@]}"; do
  if [[ -n "$target_ip_literals" ]]; then
    target_ip_literals="${target_ip_literals} "
  fi
  target_ip_literals="${target_ip_literals}'${target_ip//\'/\'\"\'\"\'}'"
done

cat > "$SCRIPT_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

REPORT_ENDPOINT='${REPORT_ENDPOINT//\'/\'\"\'\"\'}'
REPORTER_TOKEN='${REPORTER_TOKEN//\'/\'\"\'\"\'}'
TARGET_IPS=(${target_ip_literals})

WORKDIR=\$(mktemp -d)
cleanup() {
  rm -rf "\$WORKDIR"
}
trap cleanup EXIT

for TARGET_IP in "\${TARGET_IPS[@]}"; do
  SAFE_NAME=\$(printf '%s' "\$TARGET_IP" | tr ':/' '__')
  RESULT_FILE="\$WORKDIR/\$SAFE_NAME.json"
  PROBE_LOG="\$WORKDIR/\$SAFE_NAME.log"
  PROBE_EXIT=0
  echo "Probing \$TARGET_IP..."
  if ! bash <(curl -fsSL https://IP.Check.Place) -j -y -i "\$TARGET_IP" -o "\$RESULT_FILE" >"\$PROBE_LOG" 2>&1; then
    PROBE_EXIT=\$?
  fi
  if [ ! -s "\$RESULT_FILE" ]; then
    echo "IPQuality probe failed or returned empty result: \$TARGET_IP" >&2
    continue
  fi
  if [ "\$PROBE_EXIT" -ne 0 ]; then
    echo "IPQuality probe exited with code \$PROBE_EXIT for \$TARGET_IP, but JSON output was produced; continuing to upload." >&2
  fi
  {
    printf '{"target_ip":"%s","result":' "\$TARGET_IP"
    cat "\$RESULT_FILE"
    printf '}'
  } | curl -fsS -X POST \
      -H 'Content-Type: application/json' \
      -H "X-IPQ-Reporter-Token: \${REPORTER_TOKEN}" \
      --data-binary @- \
      "\$REPORT_ENDPOINT" >/dev/null
  echo "Uploaded result for \$TARGET_IP."
done
EOF

chmod +x "$SCRIPT_PATH"

cat > "$CRON_PATH" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=${SCHEDULE_TIMEZONE}
TZ=${SCHEDULE_TIMEZONE}
${SCHEDULE_CRON} root ${SCRIPT_PATH}
EOF

chmod 0644 "$CRON_PATH"

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl list-unit-files cron.service >/dev/null 2>&1; then
    systemctl enable --now cron.service >/dev/null 2>&1 || true
  elif systemctl list-unit-files crond.service >/dev/null 2>&1; then
    systemctl enable --now crond.service >/dev/null 2>&1 || true
  fi
fi

if [[ "$RUN_IMMEDIATELY" == "1" || "$RUN_IMMEDIATELY" == "true" ]]; then
  INITIAL_RUN_LOG="${INSTALL_DIR}/initial-run.log"
  echo "Starting the reporter once in the background after installation."
  if ! ( nohup "$SCRIPT_PATH" >"$INITIAL_RUN_LOG" 2>&1 & ); then
    echo "Failed to start the immediate run. Scheduled execution remains installed." >&2
  fi
fi

echo "Installed ${UNIT_NAME} with ${#TARGET_IPS[@]} target IP(s)."
echo "Schedule: ${SCHEDULE_CRON}"
echo "Schedule timezone: ${SCHEDULE_TIMEZONE}"
if [[ "$RUN_IMMEDIATELY" == "1" || "$RUN_IMMEDIATELY" == "true" ]]; then
  echo "Immediate execution: enabled"
else
  echo "Immediate execution: disabled"
fi
echo "Re-run this command after changing the target IP list or schedule to replace the existing reporter configuration."
