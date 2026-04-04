#!/usr/bin/env bash
set -euo pipefail

NODE_UUID=""
REPORT_ENDPOINT=""
REPORTER_TOKEN=""
SCHEDULE_CRON="0 0 * * *"
RUN_IMMEDIATELY="1"
TARGET_IPS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-uuid)
      NODE_UUID="${2:-}"
      shift 2
      ;;
    --server)
      REPORT_ENDPOINT="${2:-}"
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

if [[ -z "$NODE_UUID" || -z "$REPORT_ENDPOINT" || -z "$REPORTER_TOKEN" ]]; then
  echo "Missing required arguments: --node-uuid, --server, --token" >&2
  exit 1
fi

if [[ ${#TARGET_IPS[@]} -eq 0 ]]; then
  echo "At least one --target-ip is required." >&2
  exit 1
fi

install_dependencies() {
  if command -v curl >/dev/null 2>&1; then
    return
  fi
  if command -v apt >/dev/null 2>&1; then
    apt update
    apt install -y curl
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    yum install -y curl
    return
  fi
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl
    return
  fi
  echo "curl is required, and no supported package manager was found." >&2
  exit 1
}

install_dependencies

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

for TARGET_IP in "${TARGET_IPS[@]}"; do
  SAFE_NAME=\$(printf '%s' "\$TARGET_IP" | tr ':/' '__')
  RESULT_FILE="\$WORKDIR/\$SAFE_NAME.json"
  PROBE_EXIT=0
  if ! bash <(curl -fsSL https://IP.Check.Place) -j -y -i "\$TARGET_IP" -o "\$RESULT_FILE"; then
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
done
EOF

chmod +x "$SCRIPT_PATH"

cat > "$CRON_PATH" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
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
  echo "Running the reporter immediately once after installation."
  if ! "$SCRIPT_PATH"; then
    echo "Immediate run failed. Scheduled execution remains installed." >&2
  fi
fi

echo "Installed ${UNIT_NAME} with ${#TARGET_IPS[@]} target IP(s)."
echo "Schedule: ${SCHEDULE_CRON}"
if [[ "$RUN_IMMEDIATELY" == "1" || "$RUN_IMMEDIATELY" == "true" ]]; then
  echo "Immediate execution: enabled"
else
  echo "Immediate execution: disabled"
fi
echo "Re-run this command after changing the target IP list or schedule to replace the existing reporter configuration."
