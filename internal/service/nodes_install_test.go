package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBuildNodeInstallScriptReplacesExistingReporterConfiguration(t *testing.T) {
	node := models.Node{
		NodeUUID:       "node-route-uuid",
		KomariNodeUUID: "node-uuid",
		Name:           "测试节点",
		ReporterToken:  "secret-token",
	}

	script := buildNodeInstallScript(node, []string{"1.1.1.1", "2606:4700:4700::1111"}, "https://ipq.example.com/api/v1/report/nodes/node-uuid", "0 0 * * *", "Asia/Shanghai", true, "")

	expectedSnippets := []string{
		"install_dependencies() {",
		"apt install -y curl",
		"if command -v systemctl >/dev/null 2>&1; then",
		"systemctl stop 'ipq-reporter-node-uuid.timer' >/dev/null 2>&1 || true",
		"systemctl disable 'ipq-reporter-node-uuid.service' >/dev/null 2>&1 || true",
		"rm -f '/etc/systemd/system/ipq-reporter-node-uuid.service' '/etc/systemd/system/ipq-reporter-node-uuid.timer' '/etc/cron.d/ipq-reporter-node-uuid' '/usr/local/bin/ipq-reporter-node-uuid.sh'",
		"mkdir -p '/opt/ipq-reporter-node-uuid'",
		"cat > '/etc/cron.d/ipq-reporter-node-uuid' <<'IPQ_REPORTER_CRON'",
		"CRON_TZ=Asia/Shanghai",
		"0 0 * * * root /opt/ipq-reporter-node-uuid/run.sh",
		"chmod 0644 '/etc/cron.d/ipq-reporter-node-uuid'",
		"Running the reporter immediately once after installation.",
		"PLAN_ENDPOINT='https://ipq.example.com/api/v1/report/nodes/node-uuid/plan'",
		"mapfile -t CANDIDATE_IPS < <(discover_candidate_ips | awk '!seen[$0]++')",
		"INTERFACE_SUMMARY_JSON=$(discover_interface_summary_json)",
		"AGENT_VERSION=\"install-script-v2\"",
		"--arg agent_version \"$AGENT_VERSION\"",
		"--arg hostname \"$HOSTNAME_VALUE\"",
		"--argjson interface_summary \"$INTERFACE_SUMMARY_JSON\"",
		"CANDIDATE_IPS_JSON='[]'",
		"--argjson candidate_ips \"$CANDIDATE_IPS_JSON\"",
		"mapfile -t TARGET_IPS < <(jq -er '.approved_targets[].target_ip' \"$PLAN_FILE\")",
		"REPORTER_TOKEN='secret-token'",
		"Timezone: Asia/Shanghai",
	}

	for _, snippet := range expectedSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("expected install script to contain %q", snippet)
		}
	}
}

func TestBuildNodeInstallScriptPostsPlanWithEmptyCandidateIPs(t *testing.T) {
	node := models.Node{
		NodeUUID:       "node-route-uuid",
		KomariNodeUUID: "node-uuid",
		Name:           "测试节点",
		ReporterToken:  "secret-token",
	}

	script := buildNodeInstallScript(node, nil, "https://ipq.example.com/api/v1/report/nodes/node-uuid", "0 0 * * *", "UTC", true, "")
	forbidden := "if [ \"${#CANDIDATE_IPS[@]}\" -eq 0 ]; then\n  echo \"No candidate IPs were discovered on this node.\" >&2\n  exit 1\nfi"
	if strings.Contains(script, forbidden) {
		t.Fatalf("install script exits before /plan when no candidate IPs are discovered")
	}
	if !strings.Contains(script, "CANDIDATE_IPS_JSON='[]'") {
		t.Fatalf("expected empty candidate IPs JSON fallback, got %s", script)
	}
	if !strings.Contains(script, "--argjson candidate_ips \"$CANDIDATE_IPS_JSON\"") {
		t.Fatalf("expected /plan payload to use fallback candidate JSON, got %s", script)
	}
	if strings.Index(script, "CANDIDATE_IPS_JSON='[]'") > strings.Index(script, "\"$PLAN_ENDPOINT\" -o \"$PLAN_FILE\"") {
		t.Fatalf("expected candidate fallback before /plan request")
	}
}

func TestDeployInstallScriptPostsPlanWithEmptyCandidateIPs(t *testing.T) {
	path := filepath.Join("..", "..", "deploy", "install.sh")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read deploy install script: %v", err)
	}
	script := string(raw)
	forbidden := "if [ \"\\${#CANDIDATE_IPS[@]}\" -eq 0 ]; then\n  echo \"No candidate IPs were discovered on this node.\" >&2\n  exit 1\nfi"
	if strings.Contains(script, forbidden) {
		t.Fatalf("deploy install script exits before /plan when no candidate IPs are discovered")
	}
	if !strings.Contains(script, "CANDIDATE_IPS_JSON='[]'") {
		t.Fatalf("expected deploy script to include empty candidate IPs JSON fallback")
	}
	if !strings.Contains(script, "--argjson candidate_ips \"\\$CANDIDATE_IPS_JSON\"") {
		t.Fatalf("expected deploy script /plan payload to use fallback candidate JSON")
	}
	if !strings.Contains(script, "At least one --target-ip is required.") || !strings.Contains(script, "LEGACY_INLINE_MODE") {
		t.Fatalf("expected deploy script to preserve legacy inline target-ip compatibility")
	}
	if !strings.Contains(script, "INITIAL_TARGET_IPS=(${target_ip_literals})") ||
		!strings.Contains(script, "CANDIDATE_IPS=(\"\\${INITIAL_TARGET_IPS[@]}\")") {
		t.Fatalf("expected deploy script to preserve explicit legacy target IPs as /plan candidates")
	}
}

func TestGetNodeInstallScriptByInstallTokenBuildsCurrentServiceScript(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{
		NodeUUID:               "node-install-token-route",
		KomariNodeUUID:         "node-install-token",
		Name:                   "测试节点",
		ReporterToken:          "secret-token",
		InstallToken:           "install-token",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.NodeTarget{
		NodeID:    node.ID,
		TargetIP:  "1.1.1.1",
		Source:    "manual",
		Enabled:   true,
		SortOrder: 0,
	}).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	script, err := GetNodeInstallScriptByInstallToken(db, node.InstallToken, "https://ipq.example.com")
	if err != nil {
		t.Fatalf("get install script by token: %v", err)
	}
	if !strings.Contains(script, "REPORT_ENDPOINT='https://ipq.example.com/api/v1/report/nodes/node-install-token-route'") {
		t.Fatalf("expected script to target current service endpoint, got %s", script)
	}
	if !strings.Contains(script, "CRON_TZ=Asia/Shanghai") {
		t.Fatalf("expected script to include timezone, got %s", script)
	}
}

func TestGetNodeInstallScriptByInstallTokenUsesLocalProbeInDevelopment(t *testing.T) {
	t.Setenv("IPQ_APP_ENV", "development")

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{
		NodeUUID:               "node-local-probe-route",
		KomariNodeUUID:         "node-local-probe",
		Name:                   "测试节点",
		ReporterToken:          "secret-token",
		InstallToken:           "install-token-local-probe",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.NodeTarget{
		NodeID:    node.ID,
		TargetIP:  "1.1.1.1",
		Source:    "manual",
		Enabled:   true,
		SortOrder: 0,
	}).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	script, err := GetNodeInstallScriptByInstallToken(db, node.InstallToken, "https://ipq.example.com")
	if err != nil {
		t.Fatalf("get install script by token: %v", err)
	}
	if !strings.Contains(script, "LOCAL_PROBE_URL='https://ipq.example.com/api/v1/report/local-probe'") {
		t.Fatalf("expected script to include local probe url, got %s", script)
	}
	if strings.Contains(script, "bash <(curl -fsSL https://IP.Check.Place)") && !strings.Contains(script, "if [ -n \"$LOCAL_PROBE_URL\" ]; then") {
		t.Fatalf("expected remote probe to be guarded by local probe branch, got %s", script)
	}
}
