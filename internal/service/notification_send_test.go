package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openNotificationSendTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.AppSetting{},
		&models.Node{},
		&models.NodeTarget{},
		&models.NotificationChannel{},
		&models.NotificationRule{},
		&models.NotificationRuleNodeScope{},
		&models.NotificationRuleTargetScope{},
		&models.NotificationDelivery{},
	); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestBuildNotificationEventsUsesRecordedTimesAndAbsoluteURLs(t *testing.T) {
	db := openNotificationSendTestDB(t)
	if err := db.AutoMigrate(&models.AppSetting{}); err != nil {
		t.Fatalf("migrate settings: %v", err)
	}
	if err := db.Create(&models.AppSetting{
		Key:       "integration_public_base_url",
		Value:     "https://ipq.example.com/app",
		UpdatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("create app setting: %v", err)
	}

	node := models.Node{ID: 7, NodeUUID: "node-events-route", KomariNodeUUID: "node-events", Name: "Node Events"}
	target := models.NodeTarget{ID: 12, NodeID: node.ID, TargetIP: "1.1.1.1"}
	previousRecordedAt := time.Date(2026, 4, 17, 8, 0, 0, 0, time.UTC)
	recordedAt := time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC)

	events, err := buildNotificationEvents(
		db,
		node,
		target,
		42,
		map[string]any{"Info": map[string]any{"Organization": "Org A"}},
		map[string]any{"Info": map[string]any{"Organization": "Org B"}},
		&previousRecordedAt,
		recordedAt,
	)
	if err != nil {
		t.Fatalf("build notification events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	event := events[0]
	if event.PreviousRecorded != previousRecordedAt.Format(time.RFC3339) {
		t.Fatalf("unexpected previous recorded time: %s", event.PreviousRecorded)
	}
	if !event.RecordedAt.Equal(recordedAt) {
		t.Fatalf("unexpected recorded time: %s", event.RecordedAt.Format(time.RFC3339))
	}
	if !strings.HasPrefix(event.DetailURL, "https://ipq.example.com/app/#/nodes/node-events-route") {
		t.Fatalf("unexpected detail url: %s", event.DetailURL)
	}
	if !strings.HasPrefix(event.CompareURL, "https://ipq.example.com/app/#/nodes/node-events-route/compare") {
		t.Fatalf("unexpected compare url: %s", event.CompareURL)
	}
}

func TestBuildNotificationEventsFallsBackToRelativeURLsWithoutConfiguredBase(t *testing.T) {
	db := openNotificationSendTestDB(t)

	node := models.Node{ID: 7, NodeUUID: "node-events-relative-route", KomariNodeUUID: "node-events-relative", Name: "Node Events"}
	target := models.NodeTarget{ID: 13, NodeID: node.ID, TargetIP: "1.1.1.1"}
	recordedAt := time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC)

	events, err := buildNotificationEvents(
		db,
		node,
		target,
		42,
		map[string]any{"Info": map[string]any{"Organization": "Org A"}},
		map[string]any{"Info": map[string]any{"Organization": "Org B"}},
		nil,
		recordedAt,
	)
	if err != nil {
		t.Fatalf("build notification events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].PreviousRecorded != "" {
		t.Fatalf("expected empty previous recorded time, got %s", events[0].PreviousRecorded)
	}
	if events[0].DetailURL != "/#/nodes/node-events-relative-route?target_id=13" {
		t.Fatalf("unexpected relative detail url: %s", events[0].DetailURL)
	}
	if events[0].CompareURL != "/#/nodes/node-events-relative-route/compare?target_id=13" {
		t.Fatalf("unexpected relative compare url: %s", events[0].CompareURL)
	}
}

func TestBuildNotificationEventsUsesEnvPublicBaseURLFallback(t *testing.T) {
	t.Setenv("IPQ_PUBLIC_BASE_URL", "https://env.example.com/base")

	db := openNotificationSendTestDB(t)
	node := models.Node{ID: 7, NodeUUID: "node-env-route", KomariNodeUUID: "node-env-komari", Name: "Node Env"}
	target := models.NodeTarget{ID: 14, NodeID: node.ID, TargetIP: "1.1.1.1"}
	recordedAt := time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC)

	events, err := buildNotificationEvents(
		db,
		node,
		target,
		42,
		map[string]any{"Info": map[string]any{"Organization": "Org A"}},
		map[string]any{"Info": map[string]any{"Organization": "Org B"}},
		nil,
		recordedAt,
	)
	if err != nil {
		t.Fatalf("build notification events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].DetailURL != "https://env.example.com/base/#/nodes/node-env-route?target_id=14" {
		t.Fatalf("unexpected env detail url: %s", events[0].DetailURL)
	}
	if events[0].CompareURL != "https://env.example.com/base/#/nodes/node-env-route/compare?target_id=14" {
		t.Fatalf("unexpected env compare url: %s", events[0].CompareURL)
	}
}

func TestSendTestNotificationWebhook(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		var payload struct {
			Message string `json:"message"`
		}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			t.Fatalf("expected valid json body, got %s (%v)", string(bodyBytes), err)
		}
		if !strings.Contains(payload.Message, "203.0.113.10") {
			t.Fatalf("expected rendered ip in message, got %s", payload.Message)
		}
		if !strings.Contains(payload.Message, "IPQS 分数") {
			t.Fatalf("expected rendered field label in message, got %s", payload.Message)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	channel := models.NotificationChannel{
		Name:       "webhook",
		Type:       "webhook",
		Enabled:    true,
		ConfigJSON: `{"url":"` + server.URL + `","method":"POST","content_type":"application/json","body":"{\"message\":\"{{message}}\"}"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	if err := SendTestNotification(db, channel.ID); err != nil {
		t.Fatalf("send test notification: %v", err)
	}
}

func TestSendTestNotificationJavascript(t *testing.T) {
	db := openNotificationSendTestDB(t)
	channel := models.NotificationChannel{
		Name:       "javascript",
		Type:       "javascript",
		Enabled:    true,
		ConfigJSON: `{"script":"async function sendMessage(message, title) { return true; } async function sendEvent(event) { return true; }"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	if err := SendTestNotification(db, channel.ID); err != nil {
		t.Fatalf("send test notification: %v", err)
	}
}

func TestSendTestNotificationJavascriptSyncLoopTimesOut(t *testing.T) {
	db := openNotificationSendTestDB(t)
	channel := models.NotificationChannel{
		Name:       "javascript-timeout",
		Type:       "javascript",
		Enabled:    true,
		ConfigJSON: `{"script":"function sendMessage(message, title) { while (true) {} }"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	start := time.Now()
	err := SendTestNotification(db, channel.ID)
	if err == nil {
		t.Fatal("expected javascript timeout error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "timeout") {
		t.Fatalf("expected timeout error, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("expected bounded timeout, took %s", elapsed)
	}
}

func TestSendTestNotificationJavascriptFetch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	channel := models.NotificationChannel{
		Name:       "javascript-fetch",
		Type:       "javascript",
		Enabled:    true,
		ConfigJSON: `{"script":"async function sendMessage(message, title) { const resp = await fetch('` + server.URL + `', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: message + '|' + title }); const body = await resp.text(); return resp.ok && body === 'ok'; }"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	if err := SendTestNotification(db, channel.ID); err != nil {
		t.Fatalf("send test notification with fetch: %v", err)
	}
}

func TestSendTestNotificationJavascriptXHR(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	channel := models.NotificationChannel{
		Name:       "javascript-xhr",
		Type:       "javascript",
		Enabled:    true,
		ConfigJSON: `{"script":"function sendMessage(message, title) { return new Promise((resolve, reject) => { const req = new XMLHttpRequest(); req.open('POST', '` + server.URL + `', true); req.onload = function () { resolve(req.status === 200 && req.responseText === 'ok'); }; req.onerror = function () { reject(new Error('xhr failed')); }; req.send(message + '|' + title); }); }"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}

	if err := SendTestNotification(db, channel.ID); err != nil {
		t.Fatalf("send test notification with xhr: %v", err)
	}
}

func TestSendTestNotificationUsesGlobalTemplates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if !strings.Contains(r.URL.RawQuery, "Custom+Title%3A+Test+Node") {
			t.Fatalf("expected custom title in query, got %s", r.URL.RawQuery)
		}
		if !strings.Contains(r.URL.RawQuery, "Custom+Message%3A+203.0.113.10") {
			t.Fatalf("expected custom message in query, got %s", r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	if err := db.AutoMigrate(&models.AppSetting{}); err != nil {
		t.Fatalf("migrate app settings: %v", err)
	}
	if _, err := SetNotificationSettings(db, nil, "Custom Title: {{node_name}}", "Custom Message: {{target_ip}}"); err != nil {
		t.Fatalf("set notification settings: %v", err)
	}

	channel := models.NotificationChannel{
		Name:       "webhook",
		Type:       "webhook",
		Enabled:    true,
		ConfigJSON: `{"url":"` + server.URL + `?message={{message}}&title={{title}}","method":"GET"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	activeChannelID := channel.ID
	if _, err := SetNotificationSettings(db, &activeChannelID, "Custom Title: {{node_name}}", "Custom Message: {{target_ip}}"); err != nil {
		t.Fatalf("set active channel: %v", err)
	}

	if err := SendTestNotification(db, channel.ID); err != nil {
		t.Fatalf("send test notification with templates: %v", err)
	}
}

func TestDispatchNotificationRulesCreatesDeliveryLog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	node := models.Node{KomariNodeUUID: "node-notify", Name: "Node", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	channel := models.NotificationChannel{
		Name:       "webhook",
		Type:       "webhook",
		Enabled:    true,
		ConfigJSON: `{"url":"` + server.URL + `","method":"POST","content_type":"application/json","body":"{\"message\":\"{{message}}\",\"title\":\"{{title}}\"}"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	activeChannelID := channel.ID
	if _, err := SetNotificationSettings(db, &activeChannelID, defaultNotificationTitleTemplate, defaultNotificationMessageTemplate); err != nil {
		t.Fatalf("set active channel: %v", err)
	}
	_, err := CreateNotificationRule(db, NotificationRulePayload{
		FieldID:  "info.organization",
		Enabled:  true,
		AllNodes: false,
		NodeScopes: []NotificationRuleNodeScopePayload{{
			NodeID:     node.ID,
			AllTargets: false,
			TargetIDs:  []uint{target.ID},
		}},
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}

	previousResult := map[string]any{"Info": map[string]any{"Organization": "Org A"}}
	currentResult := map[string]any{"Info": map[string]any{"Organization": "Org B"}}
	if err := DispatchNotificationRules(db, node, target, 1, previousResult, currentResult, time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("dispatch notification rules: %v", err)
	}

	var deliveries []models.NotificationDelivery
	if err := db.Find(&deliveries).Error; err != nil {
		t.Fatalf("list deliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(deliveries))
	}
	if deliveries[0].Status != "success" {
		t.Fatalf("unexpected delivery status: %s", deliveries[0].Status)
	}
	if deliveries[0].CreatedAt.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected delivery created_at to be set")
	}
}

func TestDispatchNotificationRulesRecordsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer server.Close()

	db := openNotificationSendTestDB(t)
	node := models.Node{KomariNodeUUID: "node-notify-fail", Name: "Node", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true, SortOrder: 0}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	channel := models.NotificationChannel{
		Name:       "webhook",
		Type:       "webhook",
		Enabled:    true,
		ConfigJSON: `{"url":"` + server.URL + `","method":"POST","content_type":"application/json","body":"{\"message\":\"{{message}}\",\"title\":\"{{title}}\"}"}`,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	activeChannelID := channel.ID
	if _, err := SetNotificationSettings(db, &activeChannelID, defaultNotificationTitleTemplate, defaultNotificationMessageTemplate); err != nil {
		t.Fatalf("set active channel: %v", err)
	}
	_, err := CreateNotificationRule(db, NotificationRulePayload{
		FieldID:  "info.organization",
		Enabled:  true,
		AllNodes: false,
		NodeScopes: []NotificationRuleNodeScopePayload{{
			NodeID:     node.ID,
			AllTargets: false,
			TargetIDs:  []uint{target.ID},
		}},
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}

	previousResult := map[string]any{"Info": map[string]any{"Organization": "Org A"}}
	currentResult := map[string]any{"Info": map[string]any{"Organization": "Org B"}}
	if err := DispatchNotificationRules(db, node, target, 2, previousResult, currentResult, time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("dispatch notification rules: %v", err)
	}

	var deliveries []models.NotificationDelivery
	if err := db.Order("id ASC").Find(&deliveries).Error; err != nil {
		t.Fatalf("list deliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(deliveries))
	}
	if deliveries[0].Status != "failed" {
		t.Fatalf("expected failed delivery, got %s", deliveries[0].Status)
	}
	if deliveries[0].ResponseSummary == "" {
		t.Fatal("expected failure summary to be recorded")
	}
}
