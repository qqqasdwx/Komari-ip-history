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
