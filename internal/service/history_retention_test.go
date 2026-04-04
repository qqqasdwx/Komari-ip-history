package service

import (
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCleanupExpiredHistorySnapshotsSkipsFavorites(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:history_retention_test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.NodeTargetHistory{}, &models.AppSetting{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	node := models.Node{KomariNodeUUID: "node-1", Name: "节点1", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1"}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	now := time.Date(2026, 4, 4, 12, 0, 0, 0, time.UTC)
	oldTime := now.AddDate(0, 0, -40)
	recentTime := now.AddDate(0, 0, -5)
	history := []models.NodeTargetHistory{
		{NodeTargetID: target.ID, ResultJSON: `{"Head":{"IP":"1.1.1.1"}}`, Summary: "old", RecordedAt: oldTime, IsFavorite: false},
		{NodeTargetID: target.ID, ResultJSON: `{"Head":{"IP":"1.1.1.1"}}`, Summary: "old-favorite", RecordedAt: oldTime.Add(time.Hour), IsFavorite: true},
		{NodeTargetID: target.ID, ResultJSON: `{"Head":{"IP":"1.1.1.1"}}`, Summary: "recent", RecordedAt: recentTime, IsFavorite: false},
	}
	for _, item := range history {
		if err := db.Create(&item).Error; err != nil {
			t.Fatalf("create history: %v", err)
		}
	}

	if _, err := SetHistoryRetentionSettings(db, 30); err != nil {
		t.Fatalf("set retention: %v", err)
	}

	deleted, err := CleanupExpiredHistorySnapshots(db, now)
	if err != nil {
		t.Fatalf("cleanup history: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected 1 deleted row, got %d", deleted)
	}

	var count int64
	if err := db.Model(&models.NodeTargetHistory{}).Count(&count).Error; err != nil {
		t.Fatalf("count history: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 history rows left, got %d", count)
	}

	var favoriteCount int64
	if err := db.Model(&models.NodeTargetHistory{}).Where("is_favorite = ?", true).Count(&favoriteCount).Error; err != nil {
		t.Fatalf("count favorites: %v", err)
	}
	if favoriteCount != 1 {
		t.Fatalf("expected favorite history to remain")
	}
}
