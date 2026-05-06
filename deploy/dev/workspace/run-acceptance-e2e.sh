#!/bin/sh
set -eu

cd /workspace

sh /workspace/deploy/dev/workspace/prepare-acceptance-env.sh

cd /workspace/web

run_default_ipq_checks() {
  export IPQ_PUBLIC_BASE_URL=http://127.0.0.1:8090
  export IPQ_INTEGRATION_PUBLIC_BASE_URL=http://proxy:8090
  export KOMARI_DEFAULT_BASE_URL=http://proxy:8080
  export KOMARI_PURCARTE_BASE_URL=http://proxy:8081

  REAL_USER_SCENARIOS=default node playwright/verify-real-user-onboarding.mjs
  node playwright/verify-react-preview-nodes.mjs
  node playwright/verify-independent-node-binding.mjs
  node playwright/verify-public-api-api-key.mjs
  node playwright/verify-notifications.mjs

  KOMARI_BASE_URL="$KOMARI_DEFAULT_BASE_URL" \
  KOMARI_THEME_SCENARIO=default \
  EXPECTED_KOMARI_THEME=default \
  node playwright/verify-embed-auth-flows.mjs
}

run_purcarte_ipq_checks() {
  export IPQ_PUBLIC_BASE_URL=http://127.0.0.1:8091
  export IPQ_INTEGRATION_PUBLIC_BASE_URL=http://proxy:8091
  export KOMARI_DEFAULT_BASE_URL=http://proxy:8080
  export KOMARI_PURCARTE_BASE_URL=http://proxy:8081

  REAL_USER_SCENARIOS=purcarte node playwright/verify-real-user-onboarding.mjs

  KOMARI_BASE_URL="$KOMARI_PURCARTE_BASE_URL" \
  KOMARI_THEME_SCENARIO=purcarte \
  EXPECTED_KOMARI_THEME=purcarte \
  node playwright/verify-embed-auth-flows.mjs
}

run_default_ipq_checks
run_purcarte_ipq_checks

echo "dual environment acceptance checks completed"
