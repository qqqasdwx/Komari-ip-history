package handlers

import (
	"testing"
	"time"
)

func TestParseHistoryDateRangeSupportsRFC3339Offsets(t *testing.T) {
	startAt, endAt := parseHistoryDateRange("2026-04-02T00:00:00+08:00", "2026-04-02T23:59:59+08:00")
	if startAt == nil || endAt == nil {
		t.Fatalf("expected both start and end to be parsed")
	}

	if got, want := startAt.Format(time.RFC3339), "2026-04-01T16:00:00Z"; got != want {
		t.Fatalf("unexpected start time: got %s want %s", got, want)
	}
	if got, want := endAt.Format(time.RFC3339), "2026-04-02T15:59:59Z"; got != want {
		t.Fatalf("unexpected end time: got %s want %s", got, want)
	}
}
