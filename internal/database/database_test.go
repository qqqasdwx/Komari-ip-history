package database

import (
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(name), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.AdminUser{},
		&models.Session{},
		&models.Node{},
		&models.NodeTarget{},
		&models.NodeHistory{},
		&models.NodeTargetHistory{},
		&models.AppSetting{},
	); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	return db
}

func TestCleanupLegacyNodeHistoryDeletesOnlyNodesWithTargets(t *testing.T) {
	db := openTestDB(t, "file:cleanup_legacy_node_history?mode=memory&cache=shared")

	nodeWithTarget := models.Node{KomariNodeUUID: "node-with-target", Name: "node-with-target", ReporterToken: "token-a"}
	nodeWithoutTarget := models.Node{KomariNodeUUID: "node-without-target", Name: "node-without-target", ReporterToken: "token-b"}
	if err := db.Create(&nodeWithTarget).Error; err != nil {
		t.Fatalf("create nodeWithTarget: %v", err)
	}
	if err := db.Create(&nodeWithoutTarget).Error; err != nil {
		t.Fatalf("create nodeWithoutTarget: %v", err)
	}

	target := models.NodeTarget{NodeID: nodeWithTarget.ID, TargetIP: "1.1.1.1"}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	legacyRows := []models.NodeHistory{
		{NodeID: nodeWithTarget.ID, ResultJSON: `{"Head":{"IP":"1.1.1.1"}}`, Summary: "old-a", RecordedAt: time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)},
		{NodeID: nodeWithoutTarget.ID, ResultJSON: `{"Head":{"IP":"2.2.2.2"}}`, Summary: "old-b", RecordedAt: time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)},
	}
	for _, row := range legacyRows {
		if err := db.Create(&row).Error; err != nil {
			t.Fatalf("create legacy row: %v", err)
		}
	}

	if err := cleanupLegacyNodeHistory(db); err != nil {
		t.Fatalf("cleanup legacy node history: %v", err)
	}

	var withTargetCount int64
	if err := db.Model(&models.NodeHistory{}).Where("node_id = ?", nodeWithTarget.ID).Count(&withTargetCount).Error; err != nil {
		t.Fatalf("count withTarget legacy rows: %v", err)
	}
	if withTargetCount != 0 {
		t.Fatalf("expected legacy rows for migrated node to be deleted, got %d", withTargetCount)
	}

	var withoutTargetCount int64
	if err := db.Model(&models.NodeHistory{}).Where("node_id = ?", nodeWithoutTarget.ID).Count(&withoutTargetCount).Error; err != nil {
		t.Fatalf("count withoutTarget legacy rows: %v", err)
	}
	if withoutTargetCount != 1 {
		t.Fatalf("expected legacy rows for node without targets to remain, got %d", withoutTargetCount)
	}
}

func TestMigrateLegacyNodeTargetsCopiesHistoryAndCleanupRemovesLegacyRows(t *testing.T) {
	db := openTestDB(t, "file:migrate_legacy_node_targets?mode=memory&cache=shared")

	recordedAt := time.Date(2026, 4, 3, 3, 6, 9, 0, time.UTC)
	node := models.Node{
		KomariNodeUUID:         "legacy-node",
		Name:                   "legacy-node",
		ReporterToken:          "token",
		HasData:                true,
		CurrentSummary:         "summary",
		CurrentResultJSON:      `{"Head":{"IP":"203.0.113.10"}}`,
		CurrentResultUpdatedAt: &recordedAt,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.NodeHistory{
		NodeID:     node.ID,
		ResultJSON: `{"Head":{"IP":"203.0.113.10"},"Score":{"IPQS":30}}`,
		Summary:    "legacy-history",
		RecordedAt: recordedAt,
	}).Error; err != nil {
		t.Fatalf("create legacy history: %v", err)
	}

	if err := migrateLegacyNodeTargets(db); err != nil {
		t.Fatalf("migrate legacy targets: %v", err)
	}
	if err := cleanupLegacyNodeHistory(db); err != nil {
		t.Fatalf("cleanup legacy node history: %v", err)
	}

	var targetCount int64
	if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", node.ID).Count(&targetCount).Error; err != nil {
		t.Fatalf("count targets: %v", err)
	}
	if targetCount != 1 {
		t.Fatalf("expected 1 migrated target, got %d", targetCount)
	}

	var historyCount int64
	if err := db.Model(&models.NodeTargetHistory{}).Count(&historyCount).Error; err != nil {
		t.Fatalf("count target history: %v", err)
	}
	if historyCount != 1 {
		t.Fatalf("expected 1 migrated target history row, got %d", historyCount)
	}

	var legacyCount int64
	if err := db.Model(&models.NodeHistory{}).Where("node_id = ?", node.ID).Count(&legacyCount).Error; err != nil {
		t.Fatalf("count legacy history: %v", err)
	}
	if legacyCount != 0 {
		t.Fatalf("expected legacy history rows to be removed after migration, got %d", legacyCount)
	}
}

func TestAutoMigrateCreatesHistoryCompositeIndexes(t *testing.T) {
	db := openTestDB(t, "file:history_indexes?mode=memory&cache=shared")

	if !db.Migrator().HasIndex(&models.NodeTargetHistory{}, "idx_node_target_history_target_recorded") {
		t.Fatalf("expected composite index idx_node_target_history_target_recorded")
	}
	if !db.Migrator().HasIndex(&models.NodeTargetHistory{}, "idx_node_target_history_favorite_recorded") {
		t.Fatalf("expected composite index idx_node_target_history_favorite_recorded")
	}
}
