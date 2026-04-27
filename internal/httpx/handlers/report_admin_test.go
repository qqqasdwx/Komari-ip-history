package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Node{},
		&models.NodeTarget{},
		&models.AppSetting{},
		&models.NotificationRule{},
		&models.NotificationRuleNodeScope{},
		&models.NotificationRuleTargetScope{},
	); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestInstallScriptByTokenReturnsServerGeneratedScript(t *testing.T) {
	db := openHandlerTestDB(t)
	handler := ReportHandler{DB: db, Cfg: config.Config{BasePath: ""}}

	node := models.Node{
		NodeUUID:               "node-install-token-handler-route",
		KomariNodeUUID:         "node-install-token-handler",
		Name:                   "Handler Node",
		ReporterToken:          "reporter-token",
		InstallToken:           "install-token-handler",
		ReporterScheduleCron:   "0 12 * * *",
		ReporterTimezone:       "Asia/Shanghai",
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.NodeTarget{
		NodeID:    node.ID,
		TargetIP:  "1.1.1.1",
		Source:    "manual",
		Enabled:   true,
		SortOrder: 0,
	}).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	router := gin.New()
	router.GET("/api/v1/report/install-script/:installToken", handler.InstallScriptByToken)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/report/install-script/"+node.InstallToken, nil)
	req.Host = "ipq.example.com"
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	body := resp.Body.String()
	if !strings.Contains(body, "REPORT_ENDPOINT='http://ipq.example.com/api/v1/report/nodes/node-install-token-handler-route'") {
		t.Fatalf("expected generated report endpoint in script, got %s", body)
	}
}

func TestNotificationSettingsHandlersRoundTrip(t *testing.T) {
	db := openHandlerTestDB(t)
	handler := AdminHandler{DB: db}

	router := gin.New()
	router.GET("/api/v1/admin/notification/settings", handler.GetNotificationSettings)
	router.PUT("/api/v1/admin/notification/settings", handler.PutNotificationSettings)

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/notification/settings", nil)
	getResp := httptest.NewRecorder()
	router.ServeHTTP(getResp, getReq)
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected get 200, got %d", getResp.Code)
	}

	putReq := httptest.NewRequest(http.MethodPut, "/api/v1/admin/notification/settings", strings.NewReader(`{"enabled":false,"title_template":"Title {{node_name}}","message_template":"Body {{current_value}}"}`))
	putReq.Header.Set("Content-Type", "application/json")
	putResp := httptest.NewRecorder()
	router.ServeHTTP(putResp, putReq)
	if putResp.Code != http.StatusOK {
		t.Fatalf("expected put 200, got %d", putResp.Code)
	}

	var payload struct {
		Enabled         bool   `json:"enabled"`
		TitleTemplate   string `json:"title_template"`
		MessageTemplate string `json:"message_template"`
	}
	if err := json.Unmarshal(putResp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Enabled {
		t.Fatal("expected notifications disabled after put")
	}
	if payload.TitleTemplate != "Title {{node_name}}" {
		t.Fatalf("unexpected title template: %s", payload.TitleTemplate)
	}
	if payload.MessageTemplate != "Body {{current_value}}" {
		t.Fatalf("unexpected message template: %s", payload.MessageTemplate)
	}
}

func TestListNotificationRulesSurvivesDeletedTargetReference(t *testing.T) {
	db := openHandlerTestDB(t)
	handler := AdminHandler{DB: db}

	node := models.Node{KomariNodeUUID: "handler-notify-node", Name: "handler-notify-node", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	rule := models.NotificationRule{FieldID: "score.ipqs", AllNodes: false, Enabled: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	scope := models.NotificationRuleNodeScope{RuleID: rule.ID, NodeID: node.ID, AllTargets: false}
	if err := db.Create(&scope).Error; err != nil {
		t.Fatalf("create scope: %v", err)
	}
	if err := db.Create(&models.NotificationRuleTargetScope{RuleNodeID: scope.ID, TargetID: target.ID}).Error; err != nil {
		t.Fatalf("create target scope: %v", err)
	}
	if err := db.Delete(&models.NodeTarget{}, "id = ?", target.ID).Error; err != nil {
		t.Fatalf("delete target without cleanup: %v", err)
	}

	router := gin.New()
	router.GET("/api/v1/admin/notification/rules", handler.ListNotificationRules)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/notification/rules", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected notification rules endpoint to survive orphan reference, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestLocalProbeReturnsTemplateInDevelopment(t *testing.T) {
	db := openHandlerTestDB(t)
	handler := ReportHandler{DB: db, Cfg: config.Config{AppEnv: "development"}}

	router := gin.New()
	router.GET("/api/v1/report/local-probe", handler.LocalProbe)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/report/local-probe?target_ip=1.1.1.1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	body := resp.Body.String()
	if !strings.Contains(body, "\"IP\":\"1.1.1.1\"") {
		t.Fatalf("expected local probe to include target ip, got %s", body)
	}
	if !strings.Contains(body, "local-development-probe") {
		t.Fatalf("expected local probe marker, got %s", body)
	}
}

func TestLocalProbeReturns404OutsideDevelopment(t *testing.T) {
	db := openHandlerTestDB(t)
	handler := ReportHandler{DB: db, Cfg: config.Config{AppEnv: "production"}}

	router := gin.New()
	router.GET("/api/v1/report/local-probe", handler.LocalProbe)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/report/local-probe?target_ip=1.1.1.1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.Code)
	}
}
