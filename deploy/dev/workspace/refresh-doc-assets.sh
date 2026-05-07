#!/bin/sh
set -eu

cd /workspace

sh /workspace/deploy/dev/workspace/run-acceptance-e2e.sh

cd /workspace/web
FRONTEND_REFACTOR_STAGE=acceptance-docs \
IPQ_PUBLIC_BASE_URL=http://127.0.0.1:8090 \
node playwright/capture-frontend-baseline.mjs

ASSET_DIR=/workspace/docs/assets/双环境验收
rm -rf "$ASSET_DIR"
mkdir -p "$ASSET_DIR"

copy_if_exists() {
  source=$1
  target=$2
  if [ -f "$source" ]; then
    cp "$source" "$ASSET_DIR/$target"
  else
    echo "missing screenshot: $source" >&2
    exit 1
  fi
}

copy_if_exists /workspace/web/playwright-output/frontend-refactor/acceptance-docs/nodes-desktop.png 01-ipq-nodes.png
copy_if_exists /workspace/web/playwright-output/frontend-refactor/acceptance-docs/nodes-report-config-desktop.png 02-ipq-node-settings.png
copy_if_exists /workspace/web/playwright-output/frontend-refactor/acceptance-docs/history-multi-ip-desktop.png 03-ipq-history.png
copy_if_exists /workspace/web/playwright-output/frontend-refactor/acceptance-docs/compare-multi-snapshot-desktop.png 04-ipq-snapshots.png
copy_if_exists /workspace/web/playwright-output/frontend-refactor/acceptance-docs/settings-integration-desktop.png 05-ipq-integration.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/default/09-komari-home-entry-buttons.png 06-default-home-entry.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/default/10-komari-connected-popup-light.png 07-default-popup-light.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/default/11-komari-connected-popup-dark.png 08-default-popup-dark.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/purcarte/09-komari-home-entry-buttons.png 09-purcarte-home-entry.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/purcarte/10-komari-connected-popup-light.png 10-purcarte-popup-light.png
copy_if_exists /workspace/web/playwright-output/real-user-onboarding/purcarte/11-komari-connected-popup-dark.png 11-purcarte-popup-dark.png
copy_if_exists /workspace/web/playwright-output/embed-default/guest-blocked.png 12-default-guest-blocked.png
copy_if_exists /workspace/web/playwright-output/embed-default/guest-allowed.png 13-default-guest-allowed.png
copy_if_exists /workspace/web/playwright-output/embed-purcarte/guest-blocked.png 14-purcarte-guest-blocked.png
copy_if_exists /workspace/web/playwright-output/embed-purcarte/guest-allowed.png 15-purcarte-guest-allowed.png

cp /workspace/web/playwright-output/frontend-refactor/acceptance-docs/summary.json "$ASSET_DIR/frontend-summary.json"
cp /workspace/web/playwright-output/real-user-onboarding/summary.json "$ASSET_DIR/real-user-summary.json"

echo "documentation screenshots refreshed: $ASSET_DIR"
