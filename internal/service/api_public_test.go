package service

import (
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openAPIPublicTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.KomariBinding{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestListNodesForAPIReturnsBindingState(t *testing.T) {
	db := openAPIPublicTestDB(t)

	node := models.Node{KomariNodeUUID: "komari-uuid", Name: "Node A", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.KomariBinding{
		NodeID:         node.ID,
		KomariNodeUUID: "komari-uuid",
		KomariNodeName: "Komari Node A",
		BindingSource:  "manual",
	}).Error; err != nil {
		t.Fatalf("create binding: %v", err)
	}

	items, err := ListNodesForAPI(db, "")
	if err != nil {
		t.Fatalf("list nodes for api: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 node, got %d", len(items))
	}
	if !items[0].HasKomariBinding {
		t.Fatal("expected node to have komari binding")
	}
}

func TestGetNodeDetailForAPIReturnsCurrentTarget(t *testing.T) {
	db := openAPIPublicTestDB(t)

	node := models.Node{KomariNodeUUID: "node-api-detail", Name: "Node A", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	detail, err := GetNodeDetailForAPI(db, node.KomariNodeUUID, &target.ID)
	if err != nil {
		t.Fatalf("get node detail for api: %v", err)
	}
	if detail.CurrentTarget == nil {
		t.Fatal("expected current target")
	}
	if detail.CurrentTarget.IP != "1.1.1.1" {
		t.Fatalf("unexpected current target ip: %s", detail.CurrentTarget.IP)
	}
}

func TestListNodeTargetsForAPI(t *testing.T) {
	db := openAPIPublicTestDB(t)

	node := models.Node{KomariNodeUUID: "node-api-targets", Name: "Node A", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "discovered", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	items, err := ListNodeTargetsForAPI(db, node.KomariNodeUUID)
	if err != nil {
		t.Fatalf("list node targets for api: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 target, got %d", len(items))
	}
	if items[0].Source != "discovered" {
		t.Fatalf("unexpected target source: %s", items[0].Source)
	}
}

func TestGetNodeHistoryForAPI(t *testing.T) {
	db := openAPIPublicTestDB(t)
	if err := db.AutoMigrate(&models.NodeTargetHistory{}); err != nil {
		t.Fatalf("migrate history: %v", err)
	}

	node := models.Node{KomariNodeUUID: "node-api-history", Name: "Node A", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	history := models.NodeTargetHistory{
		NodeTargetID: target.ID,
		ResultJSON:   `{"Head":{"IP":"1.1.1.1"}}`,
		Summary:      "summary",
		RecordedAt:   time.Date(2026, 4, 14, 0, 0, 0, 0, time.UTC),
	}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history: %v", err)
	}

	page, err := GetNodeHistoryForAPI(db, node.KomariNodeUUID, &target.ID, 1, 20, nil, nil)
	if err != nil {
		t.Fatalf("get node history for api: %v", err)
	}
	if page.Total != 1 {
		t.Fatalf("expected total 1, got %d", page.Total)
	}
}

func TestGetNodeHistoryEventsForAPI(t *testing.T) {
	db := openHistoryEventsTestDB(t)

	node := models.Node{
		KomariNodeUUID: "node-api-events",
		Name:           "node-api-events",
		ReporterToken:  "token",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	mustInsertTargetHistory(t, db, target.ID, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org A")
	})
	mustInsertTargetHistory(t, db, target.ID, time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org B")
	})

	page, err := GetNodeHistoryEventsForAPI(db, node.KomariNodeUUID, &target.ID, "info.organization", 1, 20, nil, nil)
	if err != nil {
		t.Fatalf("get node history events for api: %v", err)
	}
	if page.Total < 1 {
		t.Fatalf("expected at least 1 event, got %d", page.Total)
	}
}
