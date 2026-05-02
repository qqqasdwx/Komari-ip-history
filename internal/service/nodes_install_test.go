package service

import (
	"strings"
	"testing"

	"komari-ip-history/internal/models"
)

func TestBuildNodeInstallScriptReplacesExistingReporterConfiguration(t *testing.T) {
	node := models.Node{
		KomariNodeUUID: "node-uuid",
		Name:           "测试节点",
		ReporterToken:  "secret-token",
	}

	script := buildNodeInstallScript(node, []string{"1.1.1.1", "2606:4700:4700::1111"}, "https://ipq.example.com/api/v1/report/nodes/node-uuid", "0 0 * * *", "Asia/Shanghai", true)

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
		"TZ=Asia/Shanghai",
		"0 0 * * * root /opt/ipq-reporter-node-uuid/run.sh",
		"chmod 0644 '/etc/cron.d/ipq-reporter-node-uuid'",
		"Running the reporter immediately once after installation.",
		"Schedule timezone: Asia/Shanghai",
		"TARGET_IPS=('1.1.1.1' '2606:4700:4700::1111')",
		"REPORTER_TOKEN='secret-token'",
	}

	for _, snippet := range expectedSnippets {
		if !strings.Contains(script, snippet) {
			t.Fatalf("expected install script to contain %q", snippet)
		}
	}
}
