package service

import (
	"errors"
	"strings"
	"testing"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openNodesServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.NodeTargetHistory{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestReorderNodeTargetsRejectsDuplicateIDs(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-reorder", Name: "node-reorder", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	targets := []models.NodeTarget{
		{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0},
		{NodeID: node.ID, TargetIP: "2.2.2.2", SortOrder: 1},
		{NodeID: node.ID, TargetIP: "3.3.3.3", SortOrder: 2},
	}
	for _, target := range targets {
		if err := db.Create(&target).Error; err != nil {
			t.Fatalf("create target: %v", err)
		}
	}

	err := ReorderNodeTargets(db, node.KomariNodeUUID, ReorderNodeTargetsInput{
		TargetIDs: []uint{targets[0].ID, targets[0].ID, targets[1].ID},
	})
	if err == nil || err.Error() != "target_ids mismatch" {
		t.Fatalf("expected target_ids mismatch, got %v", err)
	}
}

func TestCreateIndependentNodeCanUseReportConfig(t *testing.T) {
	db := openNodesServiceTestDB(t)

	detail, err := CreateNode(db, CreateNodeInput{Name: "Independent Node"})
	if err != nil {
		t.Fatalf("create independent node: %v", err)
	}
	if detail.NodeUUID == "" {
		t.Fatalf("expected generated node_uuid")
	}
	if detail.KomariNodeUUID != "" {
		t.Fatalf("expected no komari binding, got %q", detail.KomariNodeUUID)
	}
	if detail.BindingState != "independent" {
		t.Fatalf("unexpected binding state: %s", detail.BindingState)
	}

	target, err := AddNodeTarget(db, config.Config{}, detail.NodeUUID, AddNodeTargetInput{IP: "198.51.100.80"})
	if err != nil {
		t.Fatalf("add independent target: %v", err)
	}
	nextDetail, err := GetNodeDetail(db, detail.NodeUUID, nil)
	if err != nil {
		t.Fatalf("get independent node detail: %v", err)
	}
	if got, want := strings.Join(nextDetail.ReportConfig.TargetIPs, ","), target.IP; got != want {
		t.Fatalf("unexpected target IPs: got %q want %q", got, want)
	}
	if nextDetail.ReportConfig.EndpointPath != "/api/v1/report/nodes/"+detail.NodeUUID {
		t.Fatalf("expected report endpoint to use independent node_uuid, got %s", nextDetail.ReportConfig.EndpointPath)
	}
}

func TestUpdateNodeRenamesIPQNodeWithoutChangingKomariName(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "komari-rename", KomariNodeName: "Komari Original", Name: "IPQ Original", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	detail, err := UpdateNode(db, node.NodeUUID, UpdateNodeInput{Name: "IPQ Renamed"})
	if err != nil {
		t.Fatalf("update node: %v", err)
	}
	if detail.Name != "IPQ Renamed" {
		t.Fatalf("expected IPQ name to change, got %s", detail.Name)
	}
	if detail.KomariNodeName != "Komari Original" {
		t.Fatalf("expected Komari name to be preserved, got %s", detail.KomariNodeName)
	}
}

func TestBindKomariNodeConsumesPendingShellAndUnbindKeepsNode(t *testing.T) {
	db := openNodesServiceTestDB(t)

	independent, err := CreateNode(db, CreateNodeInput{Name: "Independent Binding Target"})
	if err != nil {
		t.Fatalf("create independent node: %v", err)
	}
	pending, _, err := RegisterNode(db, config.Config{}, RegisterNodeInput{
		KomariNodeUUID: "komari-pending-bind",
		Name:           "Komari Pending Bind",
	})
	if err != nil {
		t.Fatalf("create pending komari shell: %v", err)
	}

	candidates, err := ListKomariBindingCandidates(db, independent.NodeUUID)
	if err != nil {
		t.Fatalf("list candidates: %v", err)
	}
	if len(candidates) != 1 || !candidates[0].Available || candidates[0].Occupied {
		t.Fatalf("expected available pending candidate, got %#v", candidates)
	}

	bound, err := BindKomariNode(db, independent.NodeUUID, BindKomariNodeInput{KomariNodeUUID: pending.KomariNodeUUID})
	if err != nil {
		t.Fatalf("bind komari node: %v", err)
	}
	if bound.NodeUUID != independent.NodeUUID {
		t.Fatalf("expected independent node to remain primary, got %s", bound.NodeUUID)
	}
	if bound.KomariNodeUUID != "komari-pending-bind" || bound.KomariNodeName != "Komari Pending Bind" {
		t.Fatalf("unexpected binding detail: %#v", bound)
	}
	var pendingCount int64
	if err := db.Model(&models.Node{}).Where("id = ?", pending.ID).Count(&pendingCount).Error; err != nil {
		t.Fatalf("count pending shell: %v", err)
	}
	if pendingCount != 0 {
		t.Fatalf("expected pending shell to be consumed, got %d", pendingCount)
	}

	unbound, err := UnbindKomariNode(db, bound.NodeUUID)
	if err != nil {
		t.Fatalf("unbind komari node: %v", err)
	}
	if unbound.NodeUUID != independent.NodeUUID {
		t.Fatalf("expected node to remain after unbind")
	}
	if unbound.KomariNodeUUID != "" || unbound.BindingState != "independent" {
		t.Fatalf("expected independent node after unbind, got %#v", unbound)
	}
}

func TestBindKomariNodeRejectsOccupiedCandidate(t *testing.T) {
	db := openNodesServiceTestDB(t)

	independent, err := CreateNode(db, CreateNodeInput{Name: "Independent Conflict Target"})
	if err != nil {
		t.Fatalf("create independent node: %v", err)
	}
	occupied := models.Node{KomariNodeUUID: "komari-occupied", KomariNodeName: "Komari Occupied", Name: "Already Bound", ReporterToken: "token"}
	if err := db.Create(&occupied).Error; err != nil {
		t.Fatalf("create occupied node: %v", err)
	}
	if err := db.Create(&models.NodeTarget{NodeID: occupied.ID, TargetIP: "203.0.113.90", SortOrder: 0}).Error; err != nil {
		t.Fatalf("create occupied target: %v", err)
	}

	candidates, err := ListKomariBindingCandidates(db, independent.NodeUUID)
	if err != nil {
		t.Fatalf("list candidates: %v", err)
	}
	if len(candidates) != 1 || candidates[0].Available || !candidates[0].Occupied {
		t.Fatalf("expected occupied candidate, got %#v", candidates)
	}

	_, err = BindKomariNode(db, independent.NodeUUID, BindKomariNodeInput{KomariNodeUUID: occupied.KomariNodeUUID})
	if !errors.Is(err, ErrKomariNodeAlreadyBound) {
		t.Fatalf("expected ErrKomariNodeAlreadyBound, got %v", err)
	}
}

func TestAddNodeTargetRejectsEquivalentIPv6Forms(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-ipv6", Name: "node-ipv6", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	if _, err := AddNodeTarget(db, config.Config{}, node.KomariNodeUUID, AddNodeTargetInput{IP: "2001:db8::1"}); err != nil {
		t.Fatalf("add normalized ipv6 target: %v", err)
	}

	_, err := AddNodeTarget(db, config.Config{}, node.KomariNodeUUID, AddNodeTargetInput{IP: "2001:0db8:0:0:0:0:0:1"})
	if err == nil || err.Error() != "ip already exists" {
		t.Fatalf("expected ip already exists, got %v", err)
	}
}

func TestReporterPlanReturnsEnabledManualTargetsWithEmptyCandidates(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-plan-manual", Name: "node-plan-manual", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target, err := AddNodeTarget(db, config.Config{}, node.KomariNodeUUID, AddNodeTargetInput{IP: "198.51.100.10"})
	if err != nil {
		t.Fatalf("add manual target: %v", err)
	}

	plan, err := GetNodeReporterPlan(db, node.KomariNodeUUID, node.ReporterToken, ReporterPlanInput{})
	if err != nil {
		t.Fatalf("get reporter plan: %v", err)
	}
	if got, want := strings.Join(plan.TargetIPs, ","), target.IP; got != want {
		t.Fatalf("unexpected empty-candidate plan: got %q want %q", got, want)
	}
}

func TestReporterPlanDiscoversAutoTargetsAndSkipsDisabledTargets(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-plan-auto", Name: "node-plan-auto", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	manual, err := AddNodeTarget(db, config.Config{}, node.KomariNodeUUID, AddNodeTargetInput{IP: "198.51.100.20"})
	if err != nil {
		t.Fatalf("add manual target: %v", err)
	}

	plan, err := GetNodeReporterPlan(db, node.KomariNodeUUID, node.ReporterToken, ReporterPlanInput{
		CandidateIPs: []string{"203.0.113.20", "2001:0db8:0:0:0:0:0:1", "203.0.113.20"},
	})
	if err != nil {
		t.Fatalf("get reporter plan: %v", err)
	}
	expectedPlan := []string{manual.IP, "203.0.113.20", "2001:db8::1"}
	if got, want := strings.Join(plan.TargetIPs, ","), strings.Join(expectedPlan, ","); got != want {
		t.Fatalf("unexpected discovered plan: got %q want %q", got, want)
	}

	var autoTarget models.NodeTarget
	if err := db.First(&autoTarget, "node_id = ? AND target_ip = ?", node.ID, "203.0.113.20").Error; err != nil {
		t.Fatalf("load auto target: %v", err)
	}
	if autoTarget.TargetSource != targetSourceAuto {
		t.Fatalf("expected auto source, got %q", autoTarget.TargetSource)
	}
	if !autoTarget.ReportEnabled {
		t.Fatalf("expected auto target to be enabled by default")
	}
	if autoTarget.LastDiscoveredAt == nil {
		t.Fatalf("expected auto target to record last_discovered_at")
	}

	emptyCandidatePlan, err := GetNodeReporterPlan(db, node.KomariNodeUUID, node.ReporterToken, ReporterPlanInput{})
	if err != nil {
		t.Fatalf("get empty-candidate plan after discovery: %v", err)
	}
	if got, want := strings.Join(emptyCandidatePlan.TargetIPs, ","), manual.IP; got != want {
		t.Fatalf("expected stale auto target to be skipped without current candidate, got %q want %q", got, want)
	}

	if _, err := UpdateNodeTarget(db, node.KomariNodeUUID, autoTarget.ID, UpdateNodeTargetInput{ReportEnabled: false}); err != nil {
		t.Fatalf("disable auto target: %v", err)
	}
	disabledAutoPlan, err := GetNodeReporterPlan(db, node.KomariNodeUUID, node.ReporterToken, ReporterPlanInput{
		CandidateIPs: []string{"203.0.113.20"},
	})
	if err != nil {
		t.Fatalf("get plan with disabled auto target: %v", err)
	}
	if got, want := strings.Join(disabledAutoPlan.TargetIPs, ","), manual.IP; got != want {
		t.Fatalf("expected disabled auto target to be skipped, got %q want %q", got, want)
	}

	if _, err := UpdateNodeTarget(db, node.KomariNodeUUID, manual.ID, UpdateNodeTargetInput{ReportEnabled: false}); err != nil {
		t.Fatalf("disable manual target: %v", err)
	}
	allDisabledPlan, err := GetNodeReporterPlan(db, node.KomariNodeUUID, node.ReporterToken, ReporterPlanInput{
		CandidateIPs: []string{"203.0.113.20"},
	})
	if err != nil {
		t.Fatalf("get plan with all targets disabled: %v", err)
	}
	if len(allDisabledPlan.TargetIPs) != 0 {
		t.Fatalf("expected no approved targets when all targets are disabled, got %#v", allDisabledPlan.TargetIPs)
	}
}

func TestReportNodeRejectsDisabledTargetAndAllowsAfterReenable(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-disabled-report", Name: "node-disabled-report", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target, err := AddNodeTarget(db, config.Config{}, node.KomariNodeUUID, AddNodeTargetInput{IP: "198.51.100.30"})
	if err != nil {
		t.Fatalf("add target: %v", err)
	}
	if _, err := UpdateNodeTarget(db, node.KomariNodeUUID, target.ID, UpdateNodeTargetInput{ReportEnabled: false}); err != nil {
		t.Fatalf("disable target: %v", err)
	}

	err = ReportNode(db, node.KomariNodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: target.IP,
		Summary:  "disabled",
		Result: map[string]any{
			"Head": map[string]any{"IP": target.IP},
		},
	})
	if err == nil || err.Error() != "target ip disabled" {
		t.Fatalf("expected target ip disabled, got %v", err)
	}

	var historyCount int64
	if err := db.Model(&models.NodeTargetHistory{}).Where("node_target_id = ?", target.ID).Count(&historyCount).Error; err != nil {
		t.Fatalf("count history after disabled report: %v", err)
	}
	if historyCount != 0 {
		t.Fatalf("expected disabled target to reject report without history, got %d history rows", historyCount)
	}

	if _, err := UpdateNodeTarget(db, node.KomariNodeUUID, target.ID, UpdateNodeTargetInput{ReportEnabled: true}); err != nil {
		t.Fatalf("reenable target: %v", err)
	}
	if err := ReportNode(db, node.KomariNodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: target.IP,
		Summary:  "reenabled",
		Result: map[string]any{
			"Head": map[string]any{"IP": target.IP},
		},
	}); err != nil {
		t.Fatalf("report reenabled target: %v", err)
	}
	if err := db.Model(&models.NodeTargetHistory{}).Where("node_target_id = ?", target.ID).Count(&historyCount).Error; err != nil {
		t.Fatalf("count history after reenabled report: %v", err)
	}
	if historyCount != 1 {
		t.Fatalf("expected reenabled target to accept report, got %d history rows", historyCount)
	}
}

func TestReportNodeMatchesEquivalentIPv6Forms(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-report-ipv6", Name: "node-report-ipv6", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target := models.NodeTarget{NodeID: node.ID, TargetIP: "2001:0db8:0:0:0:0:0:1", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	err := ReportNode(db, node.KomariNodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: "2001:db8::1",
		Summary:  "ok",
		Result: map[string]any{
			"Head": map[string]any{"IP": "2001:db8::1"},
		},
	})
	if err != nil {
		t.Fatalf("report node: %v", err)
	}

	var historyCount int64
	if err := db.Model(&models.NodeTargetHistory{}).Where("node_target_id = ?", target.ID).Count(&historyCount).Error; err != nil {
		t.Fatalf("count history: %v", err)
	}
	if historyCount != 1 {
		t.Fatalf("expected 1 history row, got %d", historyCount)
	}
}

func TestNodeRoutesAcceptNodeUUIDAndKomariUUID(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{NodeUUID: "ipq-node-route", KomariNodeUUID: "komari-node-route", Name: "node-route", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	if _, err := GetNodeDetail(db, node.NodeUUID, nil); err != nil {
		t.Fatalf("get detail by node_uuid: %v", err)
	}
	if _, err := GetNodeDetail(db, node.KomariNodeUUID, nil); err != nil {
		t.Fatalf("get detail by komari_node_uuid: %v", err)
	}
	if _, err := AddNodeTarget(db, config.Config{}, node.NodeUUID, AddNodeTargetInput{IP: "2.2.2.2"}); err != nil {
		t.Fatalf("add target by node_uuid: %v", err)
	}
	if err := ReportNode(db, node.NodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: "1.1.1.1",
		Summary:  "ok",
		Result: map[string]any{
			"Head": map[string]any{"IP": "1.1.1.1"},
		},
	}); err != nil {
		t.Fatalf("report by node_uuid: %v", err)
	}
	if err := ReportNode(db, node.KomariNodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: "1.1.1.1",
		Summary:  "ok",
		Result: map[string]any{
			"Head": map[string]any{"IP": "1.1.1.1"},
		},
	}); err != nil {
		t.Fatalf("report by komari_node_uuid: %v", err)
	}
}

func TestReportConfigUsesNodeUUIDPathsWhenAvailable(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{NodeUUID: "ipq-report-config", KomariNodeUUID: "komari-report-config", Name: "node-report-config", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	detail, err := GetNodeDetail(db, node.KomariNodeUUID, nil)
	if err != nil {
		t.Fatalf("get node detail: %v", err)
	}
	if detail.ReportConfig.EndpointPath != "/api/v1/report/nodes/"+node.NodeUUID {
		t.Fatalf("expected endpoint path to use node_uuid, got %s", detail.ReportConfig.EndpointPath)
	}
	if detail.ReportConfig.InstallerPath != "/api/v1/report/nodes/"+node.NodeUUID+"/install.sh" {
		t.Fatalf("expected installer path to use node_uuid, got %s", detail.ReportConfig.InstallerPath)
	}

	config, err := GetNodeInstallConfigByInstallToken(db, node.InstallToken, "https://example.test")
	if err != nil {
		t.Fatalf("get install config by install token: %v", err)
	}
	if config.NodeUUID != node.NodeUUID {
		t.Fatalf("expected install config node_uuid %q, got %q", node.NodeUUID, config.NodeUUID)
	}
	if config.ReportEndpoint != "https://example.test/api/v1/report/nodes/"+node.NodeUUID {
		t.Fatalf("expected report endpoint to use node_uuid, got %s", config.ReportEndpoint)
	}

	legacyEndpointConfig, err := GetNodeInstallConfig(db, node.KomariNodeUUID, node.ReporterToken, "https://example.test/api/v1/report/nodes/"+node.KomariNodeUUID)
	if err != nil {
		t.Fatalf("get install config by legacy route: %v", err)
	}
	if legacyEndpointConfig.ReportEndpoint != "https://example.test/api/v1/report/nodes/"+node.NodeUUID {
		t.Fatalf("expected legacy route install config to return node_uuid endpoint, got %s", legacyEndpointConfig.ReportEndpoint)
	}

	script, err := GetNodeInstallScript(db, node.KomariNodeUUID, node.ReporterToken, "https://example.test/api/v1/report/nodes/"+node.KomariNodeUUID, "", "", nil)
	if err != nil {
		t.Fatalf("get install script by legacy route: %v", err)
	}
	if !strings.Contains(script, "REPORT_ENDPOINT='https://example.test/api/v1/report/nodes/"+node.NodeUUID+"'") {
		t.Fatalf("expected legacy route install script to use node_uuid endpoint")
	}
}

func TestUpdateNodeReportConfigPersistsTimezoneForInstallConfig(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{NodeUUID: "ipq-report-timezone", KomariNodeUUID: "komari-report-timezone", Name: "node-report-timezone", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	updated, err := UpdateNodeReportConfig(db, node.KomariNodeUUID, UpdateNodeReportConfigInput{
		ScheduleCron:     "15 8 * * *",
		ScheduleTimezone: "Asia/Shanghai",
		RunImmediately:   false,
	})
	if err != nil {
		t.Fatalf("update report config: %v", err)
	}
	if updated.ScheduleCron != "15 8 * * *" || updated.ScheduleTimezone != "Asia/Shanghai" || updated.RunImmediately {
		t.Fatalf("unexpected updated report config: %#v", updated)
	}

	var stored models.Node
	if err := db.First(&stored, node.ID).Error; err != nil {
		t.Fatalf("load stored node: %v", err)
	}
	if stored.ReporterScheduleCron != "15 8 * * *" || stored.ReporterScheduleTimezone != "Asia/Shanghai" || stored.ReporterRunImmediately {
		t.Fatalf("report config was not persisted on node: %#v", stored)
	}

	installConfig, err := GetNodeInstallConfigByInstallToken(db, stored.InstallToken, "https://example.test")
	if err != nil {
		t.Fatalf("get install config: %v", err)
	}
	if installConfig.ScheduleCron != "15 8 * * *" || installConfig.ScheduleTimezone != "Asia/Shanghai" || installConfig.RunImmediately {
		t.Fatalf("install config did not reflect saved report config: %#v", installConfig)
	}
}

func TestSyncKomariNodeEntryStateCreatesPendingShell(t *testing.T) {
	db := openNodesServiceTestDB(t)

	state, err := SyncKomariNodeEntryState(db, RegisterNodeInput{
		KomariNodeUUID: "komari-entry-new",
		Name:           "Komari Entry New",
	})
	if err != nil {
		t.Fatalf("sync komari node entry state: %v", err)
	}
	if state.NodeUUID == "" {
		t.Fatalf("expected generated node_uuid")
	}
	if state.KomariNodeUUID != "komari-entry-new" {
		t.Fatalf("unexpected komari uuid: %s", state.KomariNodeUUID)
	}
	if state.Connected {
		t.Fatalf("new shell should not be connected before targets are configured")
	}
	if state.TargetCount != 0 {
		t.Fatalf("expected no targets, got %d", state.TargetCount)
	}

	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", "komari-entry-new").Error; err != nil {
		t.Fatalf("expected pending shell to be persisted: %v", err)
	}
	if node.ReporterToken == "" || node.InstallToken == "" {
		t.Fatalf("expected pending shell to have reporter and install tokens")
	}
}

func TestGetKomariNodeEntryStateDoesNotCreatePendingShell(t *testing.T) {
	db := openNodesServiceTestDB(t)

	state, err := GetKomariNodeEntryState(db, RegisterNodeInput{
		KomariNodeUUID: "komari-entry-status-only",
		Name:           "Komari Entry Status Only",
	})
	if err != nil {
		t.Fatalf("get komari node entry state: %v", err)
	}
	if state.Exists {
		t.Fatalf("missing node should not exist")
	}
	if state.NodeUUID != "" {
		t.Fatalf("missing node should not expose node_uuid, got %s", state.NodeUUID)
	}

	var count int64
	if err := db.Model(&models.Node{}).Where("komari_node_uuid = ?", "komari-entry-status-only").Count(&count).Error; err != nil {
		t.Fatalf("count nodes: %v", err)
	}
	if count != 0 {
		t.Fatalf("status lookup should not create node shell, got %d rows", count)
	}
}

func TestSyncKomariNodeEntryStateMarksConfiguredNodeConnected(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "komari-entry-existing", Name: "Old Name", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	state, err := SyncKomariNodeEntryState(db, RegisterNodeInput{
		KomariNodeUUID: node.KomariNodeUUID,
		Name:           "Updated Name",
	})
	if err != nil {
		t.Fatalf("sync komari node entry state: %v", err)
	}
	if !state.Connected {
		t.Fatalf("expected node with targets to be connected")
	}
	if state.TargetCount != 1 {
		t.Fatalf("expected one target, got %d", state.TargetCount)
	}
	if state.Name != "Updated Name" {
		t.Fatalf("expected updated name, got %s", state.Name)
	}
}
