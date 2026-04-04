package service

import (
	"encoding/json"
	"testing"
	"time"

	"komari-ip-history/internal/models"
	"komari-ip-history/internal/sampledata"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGetNodeHistoryEventsUsesAllTargetsWhenTargetIsNotSelected(t *testing.T) {
	db := openHistoryEventsTestDB(t)

	node := models.Node{
		KomariNodeUUID: "node-all-targets",
		Name:           "node-all-targets",
		ReporterToken:  "token",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target1 := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", SortOrder: 0}
	target2 := models.NodeTarget{NodeID: node.ID, TargetIP: "2.2.2.2", SortOrder: 1}
	if err := db.Create(&target1).Error; err != nil {
		t.Fatalf("create target1: %v", err)
	}
	if err := db.Create(&target2).Error; err != nil {
		t.Fatalf("create target2: %v", err)
	}

	mustInsertTargetHistory(t, db, target1.ID, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org A")
	})
	mustInsertTargetHistory(t, db, target1.ID, time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org B")
	})
	mustInsertTargetHistory(t, db, target2.ID, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Type", "Usage", "IPinfo"}, "ISP")
	})
	mustInsertTargetHistory(t, db, target2.ID, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Type", "Usage", "IPinfo"}, "Hosting")
	})

	startAt := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	page1, err := GetNodeHistoryEvents(db, node.KomariNodeUUID, nil, "", 1, 1, &startAt, nil)
	if err != nil {
		t.Fatalf("page1: %v", err)
	}
	if page1.Total != 2 {
		t.Fatalf("expected total 2, got %d", page1.Total)
	}
	if page1.TotalPages != 2 {
		t.Fatalf("expected total pages 2, got %d", page1.TotalPages)
	}
	if len(page1.Items) != 1 {
		t.Fatalf("expected 1 item on page1, got %d", len(page1.Items))
	}
	if page1.Items[0].TargetIP != "2.2.2.2" {
		t.Fatalf("expected newest event from target2, got %s", page1.Items[0].TargetIP)
	}

	page2, err := GetNodeHistoryEvents(db, node.KomariNodeUUID, nil, "", 2, 1, &startAt, nil)
	if err != nil {
		t.Fatalf("page2: %v", err)
	}
	if len(page2.Items) != 1 {
		t.Fatalf("expected 1 item on page2, got %d", len(page2.Items))
	}
	if page2.Items[0].TargetIP != "1.1.1.1" {
		t.Fatalf("expected older event from target1, got %s", page2.Items[0].TargetIP)
	}
}

func TestGetNodeHistoryEventsTracksPreviousRecordedAtPerFieldChange(t *testing.T) {
	db := openHistoryEventsTestDB(t)

	node := models.Node{
		KomariNodeUUID: "node-previous-recorded-at",
		Name:           "node-previous-recorded-at",
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
		setNestedValue(result, []string{"Info", "Organization"}, "Org A")
	})
	mustInsertTargetHistory(t, db, target.ID, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org A")
	})
	mustInsertTargetHistory(t, db, target.ID, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), func(result map[string]any) {
		setNestedValue(result, []string{"Info", "Organization"}, "Org B")
	})

	startAt := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	page, err := GetNodeHistoryEvents(db, node.KomariNodeUUID, &target.ID, "info.organization", 1, 10, &startAt, nil)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if page.Total != 1 {
		t.Fatalf("expected 1 event, got %d", page.Total)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(page.Items))
	}
	if got, want := page.Items[0].PreviousRecordedAt, "2026-01-01T00:00:00Z"; got != want {
		t.Fatalf("expected previous recorded at %s, got %s", want, got)
	}
}

func openHistoryEventsTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.NodeTargetHistory{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func mustInsertTargetHistory(t *testing.T, db *gorm.DB, targetID uint, recordedAt time.Time, mutate func(map[string]any)) {
	t.Helper()

	result, err := sampledata.IPQualityTemplateResult()
	if err != nil {
		t.Fatalf("load template: %v", err)
	}
	mutate(result)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	history := models.NodeTargetHistory{
		NodeTargetID: targetID,
		ResultJSON:   string(raw),
		RecordedAt:   recordedAt,
	}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history: %v", err)
	}
}

func setNestedValue(root map[string]any, path []string, value any) {
	current := root
	for _, key := range path[:len(path)-1] {
		next, ok := current[key].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[key] = next
		}
		current = next
	}
	current[path[len(path)-1]] = value
}
