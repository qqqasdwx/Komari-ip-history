package service

import (
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPreviewNodeReportConfigUsesFiveFieldCron(t *testing.T) {
	preview, err := previewNodeReportConfig("0 0 * * *", "Asia/Shanghai", true, time.Date(2026, 4, 4, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("previewNodeReportConfig returned error: %v", err)
	}
	if preview.ScheduleCron != "0 0 * * *" {
		t.Fatalf("unexpected normalized cron: %s", preview.ScheduleCron)
	}
	if preview.Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected timezone: %s", preview.Timezone)
	}
	if len(preview.NextRuns) != 10 {
		t.Fatalf("expected 10 next runs, got %d", len(preview.NextRuns))
	}
	if preview.NextRuns[0].Format(time.RFC3339) != "2026-04-05T00:00:00+08:00" {
		t.Fatalf("unexpected first run: %s", preview.NextRuns[0].Format(time.RFC3339))
	}
}

func TestPreviewNodeReportConfigRejectsInvalidCron(t *testing.T) {
	if _, err := previewNodeReportConfig("not-a-cron", "UTC", true, time.Now().UTC()); err == nil {
		t.Fatal("expected invalid cron expression to be rejected")
	}
}

func TestPreviewNodeReportConfigRejectsInvalidTimezone(t *testing.T) {
	if _, err := previewNodeReportConfig("0 0 * * *", "not/a-timezone", true, time.Now().UTC()); err == nil {
		t.Fatal("expected invalid timezone to be rejected")
	}
}

func TestParseOptionalRunImmediately(t *testing.T) {
	value, err := ParseOptionalRunImmediately("0")
	if err != nil {
		t.Fatalf("ParseOptionalRunImmediately returned error: %v", err)
	}
	if value == nil || *value {
		t.Fatal("expected 0 to parse as false")
	}

	value, err = ParseOptionalRunImmediately("true")
	if err != nil {
		t.Fatalf("ParseOptionalRunImmediately returned error: %v", err)
	}
	if value == nil || !*value {
		t.Fatal("expected true to parse as true")
	}
}

func TestGetNodeReportConfigPreviewSupportsNodeUUID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{
		NodeUUID:               "internal-node-uuid",
		KomariNodeUUID:         "komari-node-uuid",
		Name:                   "Node",
		ReporterToken:          "token",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	preview, err := GetNodeReportConfigPreview(db, node.NodeUUID, "", "", nil)
	if err != nil {
		t.Fatalf("get node report config preview: %v", err)
	}
	if preview.Timezone != "Asia/Shanghai" {
		t.Fatalf("unexpected timezone: %s", preview.Timezone)
	}
}
