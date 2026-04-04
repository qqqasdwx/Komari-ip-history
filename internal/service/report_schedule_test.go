package service

import (
	"testing"
	"time"
)

func TestPreviewNodeReportConfigUsesFiveFieldCron(t *testing.T) {
	preview, err := previewNodeReportConfig("0 0 * * *", true, time.Date(2026, 4, 4, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("previewNodeReportConfig returned error: %v", err)
	}
	if preview.ScheduleCron != "0 0 * * *" {
		t.Fatalf("unexpected normalized cron: %s", preview.ScheduleCron)
	}
	if len(preview.NextRuns) != 10 {
		t.Fatalf("expected 10 next runs, got %d", len(preview.NextRuns))
	}
	if preview.NextRuns[0].Format(time.RFC3339) != "2026-04-05T00:00:00Z" {
		t.Fatalf("unexpected first run: %s", preview.NextRuns[0].Format(time.RFC3339))
	}
}

func TestPreviewNodeReportConfigRejectsInvalidCron(t *testing.T) {
	if _, err := previewNodeReportConfig("not-a-cron", true, time.Now().UTC()); err == nil {
		t.Fatal("expected invalid cron expression to be rejected")
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
