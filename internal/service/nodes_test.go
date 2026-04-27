package service

import (
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
	if err := db.AutoMigrate(&models.KomariBinding{}, &models.NotificationChannel{}, &models.NotificationRule{}, &models.NotificationDelivery{}); err != nil {
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

func TestSetNodeTargetEnabledUpdatesTarget(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-toggle", Name: "node-toggle", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	item, err := SetNodeTargetEnabled(db, node.KomariNodeUUID, target.ID, false)
	if err != nil {
		t.Fatalf("disable target: %v", err)
	}
	if item.Enabled {
		t.Fatal("expected target to be disabled")
	}
}

func TestGetNodeReportPlanCreatesDiscoveredTargetsAndSkipsDisabledTargets(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{
		KomariNodeUUID:       "node-plan",
		Name:                 "node-plan",
		ReporterToken:        "token",
		ReporterScheduleCron: "0 12 * * *",
		ReporterTimezone:     "Asia/Shanghai",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	disabledTarget := models.NodeTarget{
		NodeID:    node.ID,
		TargetIP:  "10.0.0.2",
		Source:    "manual",
		SortOrder: 0,
	}
	if err := db.Create(&disabledTarget).Error; err != nil {
		t.Fatalf("create disabled target: %v", err)
	}
	if err := db.Model(&disabledTarget).Update("enabled", false).Error; err != nil {
		t.Fatalf("disable target: %v", err)
	}

	plan, err := GetNodeReportPlan(db, node.KomariNodeUUID, node.ReporterToken, ReportPlanInput{
		CandidateIPs: []string{"10.0.0.2", "203.0.113.10"},
	})
	if err != nil {
		t.Fatalf("get report plan: %v", err)
	}

	if plan.Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected timezone: %s", plan.Timezone)
	}
	if plan.ScheduleCron != "0 12 * * *" {
		t.Fatalf("unexpected cron: %s", plan.ScheduleCron)
	}
	if len(plan.ApprovedTargets) != 1 {
		t.Fatalf("expected 1 approved target, got %d", len(plan.ApprovedTargets))
	}
	if plan.ApprovedTargets[0].TargetIP != "203.0.113.10" {
		t.Fatalf("expected discovered target to be approved, got %s", plan.ApprovedTargets[0].TargetIP)
	}
	if plan.ApprovedTargets[0].Source != "discovered" {
		t.Fatalf("expected discovered source, got %s", plan.ApprovedTargets[0].Source)
	}

	var discoveredCount int64
	if err := db.Model(&models.NodeTarget{}).Where("node_id = ? AND target_ip = ? AND source = ?", node.ID, "203.0.113.10", "discovered").Count(&discoveredCount).Error; err != nil {
		t.Fatalf("count discovered targets: %v", err)
	}
	if discoveredCount != 1 {
		t.Fatalf("expected discovered target to be persisted, got %d", discoveredCount)
	}
}

func TestGetNodeReportPlanKeepsEnabledManualTargetsOutsideCandidateSet(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{
		KomariNodeUUID:       "node-plan-manual",
		Name:                 "node-plan-manual",
		ReporterToken:        "token",
		ReporterScheduleCron: "0 12 * * *",
		ReporterTimezone:     "Asia/Shanghai",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	manualTarget := models.NodeTarget{
		NodeID:    node.ID,
		TargetIP:  "198.51.100.9",
		Source:    "manual",
		Enabled:   true,
		SortOrder: 0,
	}
	if err := db.Create(&manualTarget).Error; err != nil {
		t.Fatalf("create manual target: %v", err)
	}

	plan, err := GetNodeReportPlan(db, node.KomariNodeUUID, node.ReporterToken, ReportPlanInput{
		CandidateIPs: []string{"203.0.113.10"},
	})
	if err != nil {
		t.Fatalf("get report plan: %v", err)
	}

	if len(plan.ApprovedTargets) != 2 {
		t.Fatalf("expected 2 approved targets, got %d", len(plan.ApprovedTargets))
	}

	approvedByIP := make(map[string]ReportPlanTarget, len(plan.ApprovedTargets))
	for _, item := range plan.ApprovedTargets {
		approvedByIP[item.TargetIP] = item
	}
	if _, ok := approvedByIP["198.51.100.9"]; !ok {
		t.Fatal("expected enabled manual target to remain in plan")
	}
	if approvedByIP["198.51.100.9"].Source != "manual" {
		t.Fatalf("expected manual source, got %s", approvedByIP["198.51.100.9"].Source)
	}
	if _, ok := approvedByIP["203.0.113.10"]; !ok {
		t.Fatal("expected discovered candidate target to be included in plan")
	}
}

func TestReportNodeRejectsDisabledTarget(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-disabled-report", Name: "node-disabled-report", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	if err := db.Model(&target).Update("enabled", false).Error; err != nil {
		t.Fatalf("disable target: %v", err)
	}

	err := ReportNode(db, node.KomariNodeUUID, node.ReporterToken, ReportNodeInput{
		TargetIP: "1.1.1.1",
		Summary:  "blocked",
		Result: map[string]any{
			"Head": map[string]any{"IP": "1.1.1.1"},
		},
	})
	if err == nil || err.Error() != "target ip reporting disabled" {
		t.Fatalf("expected disabled target error, got %v", err)
	}
}

func TestCreateStandaloneNodeAndBindKomari(t *testing.T) {
	db := openNodesServiceTestDB(t)
	if err := db.AutoMigrate(&models.KomariBinding{}); err != nil {
		t.Fatalf("migrate binding: %v", err)
	}

	node, err := CreateStandaloneNode(db, "Standalone")
	if err != nil {
		t.Fatalf("create standalone node: %v", err)
	}
	if !strings.HasPrefix(node.KomariNodeUUID, "ipq-") {
		t.Fatalf("expected internal standalone uuid, got %s", node.KomariNodeUUID)
	}

	binding, err := BindNodeToKomari(db, node.ID, "komari-real-uuid", "Komari Node")
	if err != nil {
		t.Fatalf("bind node to komari: %v", err)
	}
	if binding.KomariNodeUUID != "komari-real-uuid" {
		t.Fatalf("unexpected binding uuid: %s", binding.KomariNodeUUID)
	}

	if err := UnbindNodeFromKomari(db, node.ID); err != nil {
		t.Fatalf("unbind node from komari: %v", err)
	}
	var count int64
	if err := db.Model(&models.KomariBinding{}).Where("node_id = ?", node.ID).Count(&count).Error; err != nil {
		t.Fatalf("count bindings: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected binding to be removed, got %d", count)
	}

	var reloaded models.Node
	if err := db.First(&reloaded, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("reload node: %v", err)
	}
	if !strings.HasPrefix(reloaded.KomariNodeUUID, standaloneKomariNodeUUIDPrefix) {
		t.Fatalf("expected unbound node to regain standalone komari uuid, got %s", reloaded.KomariNodeUUID)
	}
}

func TestSyncKomariNodeCreatesShadowCandidateWithoutBinding(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node, existed, err := SyncKomariNode(db, RegisterNodeInput{
		KomariNodeUUID: "komari-shadow-uuid",
		Name:           "Komari Shadow",
	})
	if err != nil {
		t.Fatalf("sync komari node: %v", err)
	}
	if existed {
		t.Fatal("expected first sync to create a shadow node")
	}
	if node.Name != "Komari Shadow" {
		t.Fatalf("unexpected shadow node name: %s", node.Name)
	}

	var bindingCount int64
	if err := db.Model(&models.KomariBinding{}).Where("node_id = ?", node.ID).Count(&bindingCount).Error; err != nil {
		t.Fatalf("count bindings: %v", err)
	}
	if bindingCount != 0 {
		t.Fatalf("expected shadow node to have no binding, got %d", bindingCount)
	}

	items, err := ListNodes(db, "")
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected shadow node to be hidden from node list, got %d items", len(items))
	}

	candidates, err := ListKomariBindingCandidates(db)
	if err != nil {
		t.Fatalf("list komari binding candidates: %v", err)
	}
	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].KomariNodeName != "Komari Shadow" || candidates[0].HasExistingBinding {
		t.Fatalf("unexpected candidate payload: %#v", candidates[0])
	}
	if candidates[0].NodeName != "" {
		t.Fatalf("expected shadow candidate to have no bound node name, got %#v", candidates[0])
	}
}

func TestRegisterNodeCreatesAutoBoundNameAndBinding(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node, existed, err := RegisterNode(db, config.Config{}, RegisterNodeInput{
		KomariNodeUUID: "komari-connect-uuid",
		Name:           "test",
	})
	if err != nil {
		t.Fatalf("register node: %v", err)
	}
	if existed {
		t.Fatal("expected first connect to create a new node")
	}
	if node.Name != "test（自动绑定）" {
		t.Fatalf("unexpected auto-bound node name: %s", node.Name)
	}

	var binding models.KomariBinding
	if err := db.First(&binding, "node_id = ?", node.ID).Error; err != nil {
		t.Fatalf("load binding: %v", err)
	}
	if binding.KomariNodeUUID != "komari-connect-uuid" || binding.KomariNodeName != "test" {
		t.Fatalf("unexpected binding: %#v", binding)
	}
}

func TestUpdateNodeName(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{KomariNodeUUID: "node-rename", Name: "Old Name", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	updated, err := UpdateNodeName(db, node.KomariNodeUUID, "New Name")
	if err != nil {
		t.Fatalf("update node name: %v", err)
	}
	if updated.Name != "New Name" {
		t.Fatalf("expected updated name, got %s", updated.Name)
	}

	var reloaded models.Node
	if err := db.First(&reloaded, "id = ?", node.ID).Error; err != nil {
		t.Fatalf("reload node: %v", err)
	}
	if reloaded.Name != "New Name" {
		t.Fatalf("expected persisted name, got %s", reloaded.Name)
	}
	if strings.TrimSpace(reloaded.NodeUUID) == "" {
		t.Fatal("expected node_uuid to be populated")
	}
}

func TestCreateStandaloneNodePopulatesNodeUUID(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node, err := CreateStandaloneNode(db, "Standalone UUID")
	if err != nil {
		t.Fatalf("create standalone node: %v", err)
	}
	if strings.TrimSpace(node.NodeUUID) == "" {
		t.Fatal("expected standalone node_uuid to be generated")
	}
}

func TestGetNodeDetailReportConfigUsesNodeUUIDPaths(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{
		NodeUUID:               "detail-route-uuid",
		KomariNodeUUID:         "detail-komari-uuid",
		Name:                   "Node Detail",
		ReporterToken:          "token",
		InstallToken:           "install-token",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	detail, err := GetNodeDetail(db, node.KomariNodeUUID, nil)
	if err != nil {
		t.Fatalf("get node detail: %v", err)
	}
	if detail.ReportConfig.EndpointPath != "/api/v1/report/nodes/detail-route-uuid" {
		t.Fatalf("unexpected endpoint path: %s", detail.ReportConfig.EndpointPath)
	}
	if detail.ReportConfig.InstallerPath != "/api/v1/report/nodes/detail-route-uuid/install.sh" {
		t.Fatalf("unexpected installer path: %s", detail.ReportConfig.InstallerPath)
	}
}

func TestGetNodeInstallConfigUsesNodeUUID(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node := models.Node{
		NodeUUID:               "install-config-route-uuid",
		KomariNodeUUID:         "install-config-komari-uuid",
		Name:                   "Node Install Config",
		ReporterToken:          "token",
		InstallToken:           "install-token",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	config, err := GetNodeInstallConfigByInstallToken(db, node.InstallToken, "https://ipq.example.com")
	if err != nil {
		t.Fatalf("get node install config by token: %v", err)
	}
	if config.NodeUUID != "install-config-route-uuid" {
		t.Fatalf("unexpected node_uuid: %s", config.NodeUUID)
	}
	if config.ReportEndpoint != "https://ipq.example.com/api/v1/report/nodes/install-config-route-uuid" {
		t.Fatalf("unexpected report endpoint: %s", config.ReportEndpoint)
	}
}

func TestBindNodeToKomariMigratesShellNodeBinding(t *testing.T) {
	db := openNodesServiceTestDB(t)

	standalone, err := CreateStandaloneNode(db, "Standalone")
	if err != nil {
		t.Fatalf("create standalone node: %v", err)
	}

	shellNode := models.Node{
		KomariNodeUUID:       "komari-shell-uuid",
		Name:                 "Shell Node",
		ReporterToken:        "token-shell",
		ReporterScheduleCron: "0 0 * * *",
		ReporterTimezone:     "UTC",
	}
	if err := db.Create(&shellNode).Error; err != nil {
		t.Fatalf("create shell node: %v", err)
	}
	if err := db.Create(&models.KomariBinding{
		NodeID:         shellNode.ID,
		KomariNodeUUID: "komari-shell-uuid",
		KomariNodeName: "Komari Shell",
		BindingSource:  "from_komari",
	}).Error; err != nil {
		t.Fatalf("create shell binding: %v", err)
	}

	binding, err := BindNodeToKomari(db, standalone.ID, "komari-shell-uuid", "Komari Shell")
	if err != nil {
		t.Fatalf("bind standalone to shell komari node: %v", err)
	}
	if binding.NodeID != standalone.ID {
		t.Fatalf("expected binding node id %d, got %d", standalone.ID, binding.NodeID)
	}

	var deletedShellCount int64
	if err := db.Model(&models.Node{}).Where("id = ?", shellNode.ID).Count(&deletedShellCount).Error; err != nil {
		t.Fatalf("count shell node: %v", err)
	}
	if deletedShellCount != 0 {
		t.Fatalf("expected shell node to be removed, got %d", deletedShellCount)
	}
}

func TestListKomariBindingCandidatesShowsKomariNamesAndBoundNodeNames(t *testing.T) {
	db := openNodesServiceTestDB(t)

	if _, _, err := SyncKomariNode(db, RegisterNodeInput{
		KomariNodeUUID: "komari-shadow",
		Name:           "Komari Shell",
	}); err != nil {
		t.Fatalf("sync shadow node: %v", err)
	}

	boundNode, err := CreateStandaloneNode(db, "Bound Node")
	if err != nil {
		t.Fatalf("create standalone node: %v", err)
	}
	if _, err := BindNodeToKomari(db, boundNode.ID, "komari-bound", "Komari Bound"); err != nil {
		t.Fatalf("bind node to komari: %v", err)
	}

	items, err := ListKomariBindingCandidates(db)
	if err != nil {
		t.Fatalf("list komari binding candidates: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 komari candidates, got %d", len(items))
	}
	if items[0].KomariNodeUUID != "komari-shadow" || items[0].HasExistingBinding {
		t.Fatalf("expected shell candidate to be unbound, got %#v", items[0])
	}
	if items[0].KomariNodeName != "Komari Shell" || items[0].NodeName != "" {
		t.Fatalf("expected shell candidate to show komari name only, got %#v", items[0])
	}
	if items[1].KomariNodeUUID != "komari-bound" || !items[1].HasExistingBinding {
		t.Fatalf("expected bound candidate to be marked existing-binding, got %#v", items[1])
	}
	if items[1].NodeName != "Bound Node" {
		t.Fatalf("expected bound candidate node name, got %#v", items[1])
	}
}

func TestListKomariBindingCandidatesSkipsInvalidShadowNames(t *testing.T) {
	db := openNodesServiceTestDB(t)

	if _, _, err := SyncKomariNode(db, RegisterNodeInput{
		KomariNodeUUID: "komari-invalid",
		Name:           "Komari Monitor",
	}); err != nil {
		t.Fatalf("sync invalid shadow: %v", err)
	}

	items, err := ListKomariBindingCandidates(db)
	if err != nil {
		t.Fatalf("list komari binding candidates: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected invalid shadow name to be filtered, got %#v", items)
	}
}

func TestListNodesMatchesKomariBindingName(t *testing.T) {
	db := openNodesServiceTestDB(t)

	node, err := CreateStandaloneNode(db, "Internal Node Name")
	if err != nil {
		t.Fatalf("create standalone node: %v", err)
	}
	if _, err := BindNodeToKomari(db, node.ID, "komari-search-uuid", "Komari Search Name"); err != nil {
		t.Fatalf("bind node to komari: %v", err)
	}

	items, err := ListNodes(db, "Search Name")
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 matched node, got %d", len(items))
	}
	if items[0].KomariNodeName != "Komari Search Name" {
		t.Fatalf("unexpected komari node name: %s", items[0].KomariNodeName)
	}
}
