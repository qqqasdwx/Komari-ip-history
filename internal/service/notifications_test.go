package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openNotificationServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Node{},
		&models.NodeTarget{},
		&models.NodeTargetHistory{},
		&models.AppSetting{},
		&models.NotificationChannel{},
		&models.NotificationRule{},
		&models.NotificationDeliveryLog{},
	); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func notificationTestServer(status int, body string, hits *atomic.Int64) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		hits.Add(1)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func notificationReportResult(ip string, organization string) map[string]any {
	return map[string]any{
		"Head": map[string]any{
			"IP":      ip,
			"Time":    "2026-05-03T00:00:00Z",
			"Version": "test",
		},
		"Info": map[string]any{
			"Organization": organization,
		},
	}
}

func createNotificationNode(t *testing.T, db *gorm.DB, targetIP string) NodeDetail {
	t.Helper()
	detail, err := CreateNode(db, CreateNodeInput{Name: "Notification Test Node"})
	if err != nil {
		t.Fatalf("create node: %v", err)
	}
	if _, err := AddNodeTarget(db, config.Config{}, detail.NodeUUID, AddNodeTargetInput{IP: targetIP}); err != nil {
		t.Fatalf("add target: %v", err)
	}
	detail, err = GetNodeDetail(db, detail.NodeUUID, nil)
	if err != nil {
		t.Fatalf("reload node: %v", err)
	}
	return detail
}

func reportNotificationNode(t *testing.T, db *gorm.DB, cfg config.Config, detail NodeDetail, targetIP string, organization string, recordedAt string) {
	t.Helper()
	parsedAt, err := time.Parse(time.RFC3339, recordedAt)
	if err != nil {
		t.Fatalf("parse time: %v", err)
	}
	if err := ReportNodeWithConfig(db, cfg, detail.NodeUUID, detail.ReportConfig.ReporterToken, ReportNodeInput{
		TargetIP:   targetIP,
		Summary:    organization,
		Result:     notificationReportResult(targetIP, organization),
		RecordedAt: &parsedAt,
	}); err != nil {
		t.Fatalf("report node: %v", err)
	}
}

func countNotificationLogs(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&models.NotificationDeliveryLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count logs: %v", err)
	}
	return count
}

func TestNotificationChannelsCanSaveAndTestSend(t *testing.T) {
	db := openNotificationServiceTestDB(t)
	var hits atomic.Int64
	server := notificationTestServer(http.StatusOK, "ok", &hits)
	defer server.Close()

	channels := []NotificationChannelInput{
		{
			Name:    "Telegram Test",
			Type:    NotificationChannelTelegram,
			Enabled: true,
			Config: map[string]string{
				"api_url": server.URL,
				"chat_id": "12345",
			},
		},
		{
			Name:    "Webhook Test",
			Type:    NotificationChannelWebhook,
			Enabled: true,
			Config: map[string]string{
				"url":          server.URL,
				"headers_json": `{"X-Test":"ok"}`,
			},
		},
		{
			Name:    "JavaScript Test",
			Type:    NotificationChannelJavaScript,
			Enabled: true,
			Config: map[string]string{
				"script": `function send(input) { return { ok: input.title.length > 0 }; }`,
			},
		},
	}

	for _, input := range channels {
		t.Run(input.Type, func(t *testing.T) {
			channel, err := CreateNotificationChannel(db, input)
			if err != nil {
				t.Fatalf("create channel: %v", err)
			}
			log, err := TestNotificationChannel(db, channel.ID)
			if err != nil {
				t.Fatalf("test channel: %v", err)
			}
			if log.Status != NotificationDeliverySuccess {
				t.Fatalf("expected success log, got %#v", log)
			}
		})
	}

	if got, want := hits.Load(), int64(2); got != want {
		t.Fatalf("expected telegram and webhook test HTTP hits %d, got %d", want, got)
	}
}

func TestNotificationMatchingRuleCreatesDeliveryLog(t *testing.T) {
	db := openNotificationServiceTestDB(t)
	targetIP := "203.0.113.41"
	cfg := config.Config{PublicBaseURL: "https://ipq.example"}
	detail := createNotificationNode(t, db, targetIP)
	reportNotificationNode(t, db, cfg, detail, targetIP, "Org A", "2026-05-03T00:00:00Z")

	var hits atomic.Int64
	server := notificationTestServer(http.StatusOK, "ok", &hits)
	defer server.Close()
	if _, err := SetNotificationSettings(db, NotificationSettings{Enabled: true}); err != nil {
		t.Fatalf("enable settings: %v", err)
	}
	channel, err := CreateNotificationChannel(db, NotificationChannelInput{
		Name:    "Webhook",
		Type:    NotificationChannelWebhook,
		Enabled: true,
		Config:  map[string]string{"url": server.URL},
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := CreateNotificationRule(db, NotificationRuleInput{
		Name:      "Organization changed",
		Enabled:   true,
		ChannelID: channel.ID,
		NodeUUID:  detail.NodeUUID,
		TargetIP:  targetIP,
		FieldID:   "info.organization",
	}); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	reportNotificationNode(t, db, cfg, detail, targetIP, "Org B", "2026-05-03T01:00:00Z")

	if got, want := hits.Load(), int64(1); got != want {
		t.Fatalf("expected %d webhook delivery, got %d", want, got)
	}
	logs, err := ListNotificationDeliveryLogs(db, 1, 10)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if len(logs.Items) != 1 {
		t.Fatalf("expected one delivery log, got %d", len(logs.Items))
	}
	log := logs.Items[0]
	if log.Status != NotificationDeliverySuccess || log.FieldID != "info.organization" || log.PreviousValue != "Org A" || log.CurrentValue != "Org B" {
		t.Fatalf("unexpected delivery log: %#v", log)
	}
	if !strings.Contains(log.DetailURL, "https://ipq.example/#/nodes/") || !strings.Contains(log.CompareURL, "/snapshots?target_id=") {
		t.Fatalf("expected public links in log, got detail=%q compare=%q", log.DetailURL, log.CompareURL)
	}
}

func TestNotificationSkipsNonMatchingDisabledRuleAndDisabledChannel(t *testing.T) {
	cases := []struct {
		name      string
		rule      NotificationRuleInput
		channelOn bool
	}{
		{
			name:      "non matching rule",
			channelOn: true,
			rule: NotificationRuleInput{
				Name:     "ASN only",
				Enabled:  true,
				FieldID:  "info.asn",
				TargetIP: "203.0.113.42",
			},
		},
		{
			name:      "disabled rule",
			channelOn: true,
			rule: NotificationRuleInput{
				Name:     "Disabled org",
				Enabled:  false,
				FieldID:  "info.organization",
				TargetIP: "203.0.113.42",
			},
		},
		{
			name:      "disabled channel",
			channelOn: false,
			rule: NotificationRuleInput{
				Name:     "Disabled channel org",
				Enabled:  true,
				FieldID:  "info.organization",
				TargetIP: "203.0.113.42",
			},
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			db := openNotificationServiceTestDB(t)
			targetIP := "203.0.113.42"
			detail := createNotificationNode(t, db, targetIP)
			reportNotificationNode(t, db, config.Config{}, detail, targetIP, "Org A", "2026-05-03T00:00:00Z")
			var hits atomic.Int64
			server := notificationTestServer(http.StatusOK, "ok", &hits)
			defer server.Close()
			if _, err := SetNotificationSettings(db, NotificationSettings{Enabled: true}); err != nil {
				t.Fatalf("enable settings: %v", err)
			}
			channel, err := CreateNotificationChannel(db, NotificationChannelInput{
				Name:    "Webhook",
				Type:    NotificationChannelWebhook,
				Enabled: tt.channelOn,
				Config:  map[string]string{"url": server.URL},
			})
			if err != nil {
				t.Fatalf("create channel: %v", err)
			}
			tt.rule.ChannelID = channel.ID
			tt.rule.NodeUUID = detail.NodeUUID
			if _, err := CreateNotificationRule(db, tt.rule); err != nil {
				t.Fatalf("create rule: %v", err)
			}

			reportNotificationNode(t, db, config.Config{}, detail, targetIP, "Org B", "2026-05-03T01:00:00Z")
			if got := hits.Load(); got != 0 {
				t.Fatalf("expected no webhook hits, got %d", got)
			}
			if got := countNotificationLogs(t, db); got != 0 {
				t.Fatalf("expected no delivery logs, got %d", got)
			}
		})
	}
}

func TestNotificationFailureLogAndJavaScriptTimeout(t *testing.T) {
	db := openNotificationServiceTestDB(t)
	var hits atomic.Int64
	server := notificationTestServer(http.StatusInternalServerError, "failed upstream", &hits)
	defer server.Close()

	webhook, err := CreateNotificationChannel(db, NotificationChannelInput{
		Name:    "Failing Webhook",
		Type:    NotificationChannelWebhook,
		Enabled: true,
		Config:  map[string]string{"url": server.URL},
	})
	if err != nil {
		t.Fatalf("create failing webhook: %v", err)
	}
	webhookLog, err := TestNotificationChannel(db, webhook.ID)
	if err != nil {
		t.Fatalf("test failing webhook: %v", err)
	}
	if webhookLog.Status != NotificationDeliveryFailed || !strings.Contains(webhookLog.Error, "http 500") {
		t.Fatalf("expected failed webhook log with reason, got %#v", webhookLog)
	}

	js, err := CreateNotificationChannel(db, NotificationChannelInput{
		Name:    "Slow JavaScript",
		Type:    NotificationChannelJavaScript,
		Enabled: true,
		Config: map[string]string{
			"script": `function send(input) { while (true) {} }`,
		},
	})
	if err != nil {
		t.Fatalf("create slow js channel: %v", err)
	}
	start := time.Now()
	jsLog, err := TestNotificationChannel(db, js.ID)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("test slow js channel: %v", err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("javascript sender blocked too long: %s", elapsed)
	}
	if jsLog.Status != NotificationDeliveryFailed || !strings.Contains(strings.ToLower(jsLog.Error), "timeout") {
		t.Fatalf("expected timeout failure log, got %#v", jsLog)
	}
}
