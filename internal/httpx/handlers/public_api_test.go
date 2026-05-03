package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/models"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openPublicAPITestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.NodeTargetHistory{}, &models.APIKey{}, &models.APIAccessLog{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func newPublicAPITestRouter(db *gorm.DB, limit int) *gin.Engine {
	handler := PublicAPIHandler{DB: db}
	router := gin.New()
	group := router.Group("/api/v1/public-api")
	group.Use(middleware.RequireAPIKey(db, middleware.NewAPIKeyRateLimiter(limit, time.Minute)))
	{
		group.GET("/nodes", handler.ListNodes)
		group.GET("/nodes/:uuid", handler.NodeDetail)
		group.GET("/nodes/:uuid/targets", handler.NodeTargets)
		group.GET("/nodes/:uuid/targets/:targetID/current", handler.TargetCurrent)
		group.GET("/nodes/:uuid/history", handler.NodeHistory)
		group.GET("/nodes/:uuid/history/events", handler.NodeHistoryEvents)
	}
	return router
}

func seedPublicAPINode(t *testing.T, db *gorm.DB) (models.Node, models.NodeTarget) {
	t.Helper()

	t1 := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)
	node := models.Node{
		NodeUUID:               "public-api-node",
		KomariNodeUUID:         "komari-public-api-node",
		KomariNodeName:         "Komari Public API Node",
		Name:                   "Public API Node",
		HasData:                true,
		CurrentSummary:         "Org B",
		CurrentResultUpdatedAt: &t2,
		ReporterToken:          "reporter",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	target := models.NodeTarget{
		NodeID:                 node.ID,
		TargetIP:               "203.0.113.10",
		TargetSource:           "manual",
		ReportEnabled:          true,
		HasData:                true,
		CurrentSummary:         "Org B",
		CurrentResultJSON:      `{"Head":{"IP":"203.0.113.10"},"Info":{"Organization":"Org B"}}`,
		CurrentResultUpdatedAt: &t2,
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}

	history := []models.NodeTargetHistory{
		{NodeTargetID: target.ID, ResultJSON: `{"Head":{"IP":"203.0.113.10"},"Info":{"Organization":"Org A"}}`, Summary: "Org A", RecordedAt: t1},
		{NodeTargetID: target.ID, ResultJSON: target.CurrentResultJSON, Summary: "Org B", RecordedAt: t2},
	}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history: %v", err)
	}
	return node, target
}

func performPublicAPIRequest(router *gin.Engine, method, path, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestPublicAPIRequiresAPIKeyAndReturnsReadOnlyNodeData(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openPublicAPITestDB(t)
	node, target := seedPublicAPINode(t, db)
	key, err := service.CreateAPIKey(db, "public-api-test")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}
	router := newPublicAPITestRouter(db, 100)

	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", ""); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("missing key should be 401, got %d", recorder.Code)
	}
	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", "bad-key"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("invalid key should be 401, got %d", recorder.Code)
	}

	listRecorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes?page=1&page_size=1&q=Public", key.PlaintextKey)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list nodes failed: %d %s", listRecorder.Code, listRecorder.Body.String())
	}
	if !strings.Contains(listRecorder.Body.String(), `"node_uuid":"`+node.NodeUUID+`"`) || !strings.Contains(listRecorder.Body.String(), `"page_size":1`) {
		t.Fatalf("unexpected node list response: %s", listRecorder.Body.String())
	}

	for _, path := range []string{
		"/api/v1/public-api/nodes/" + node.NodeUUID,
		"/api/v1/public-api/nodes/" + node.NodeUUID + "/targets",
		"/api/v1/public-api/nodes/" + node.NodeUUID + "/targets/" + strconvUint(target.ID) + "/current",
		"/api/v1/public-api/nodes/" + node.NodeUUID + "/history?page=1&page_size=1&target_id=" + strconvUint(target.ID) + "&start_date=2026-04-01&end_date=2026-04-03",
		"/api/v1/public-api/nodes/" + node.NodeUUID + "/history/events?page=1&page_size=1&field=info.organization&start_date=2026-04-01&end_date=2026-04-03",
	} {
		recorder := performPublicAPIRequest(router, http.MethodGet, path, key.PlaintextKey)
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s failed: %d %s", path, recorder.Code, recorder.Body.String())
		}
		if strings.Contains(recorder.Body.String(), "reporter_token") {
			t.Fatalf("%s leaked reporter token: %s", path, recorder.Body.String())
		}
	}

	var logCount int64
	if err := db.Model(&models.APIAccessLog{}).Count(&logCount).Error; err != nil {
		t.Fatalf("count logs: %v", err)
	}
	if logCount < 3 {
		t.Fatalf("expected access logs, got %d", logCount)
	}
}

func TestPublicAPIDeniesDisabledKeysAndRateLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openPublicAPITestDB(t)
	seedPublicAPINode(t, db)
	key, err := service.CreateAPIKey(db, "limited")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	disabled := false
	if _, err := service.UpdateAPIKey(db, key.ID, nil, &disabled); err != nil {
		t.Fatalf("disable api key: %v", err)
	}
	router := newPublicAPITestRouter(db, 2)
	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", key.PlaintextKey); recorder.Code != http.StatusForbidden {
		t.Fatalf("disabled key should be 403, got %d", recorder.Code)
	}

	enabled := true
	if _, err := service.UpdateAPIKey(db, key.ID, nil, &enabled); err != nil {
		t.Fatalf("enable api key: %v", err)
	}
	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", key.PlaintextKey); recorder.Code != http.StatusOK {
		t.Fatalf("first request should pass, got %d", recorder.Code)
	}
	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", key.PlaintextKey); recorder.Code != http.StatusOK {
		t.Fatalf("second request should pass, got %d", recorder.Code)
	}
	if recorder := performPublicAPIRequest(router, http.MethodGet, "/api/v1/public-api/nodes", key.PlaintextKey); recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("third request should rate limit, got %d", recorder.Code)
	}
}

func TestAdminAPIKeyHandlersCreateListAndExposeLogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openPublicAPITestDB(t)
	handler := AdminHandler{DB: db}
	router := gin.New()
	router.POST("/admin/api-keys", handler.CreateAPIKey)
	router.GET("/admin/api-keys", handler.ListAPIKeys)
	router.GET("/admin/api-access-logs", handler.ListAPIAccessLogs)

	req := httptest.NewRequest(http.MethodPost, "/admin/api-keys", strings.NewReader(`{"name":"ui key"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("create key failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var created service.APIKeyItem
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created key: %v", err)
	}
	if created.PlaintextKey == "" {
		t.Fatalf("create response should include plaintext key")
	}

	listRecorder := httptest.NewRecorder()
	router.ServeHTTP(listRecorder, httptest.NewRequest(http.MethodGet, "/admin/api-keys", nil))
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list keys failed: %d %s", listRecorder.Code, listRecorder.Body.String())
	}
	if strings.Contains(listRecorder.Body.String(), created.PlaintextKey) {
		t.Fatalf("list response leaked plaintext key: %s", listRecorder.Body.String())
	}

	storedKey, err := service.VerifyAPIKey(db, created.PlaintextKey)
	if err != nil {
		t.Fatalf("verify created key: %v", err)
	}
	service.RecordAPIAccessLog(db, &storedKey, "", http.MethodGet, "/api/v1/public-api/nodes", "127.0.0.1", 200)
	logRecorder := httptest.NewRecorder()
	router.ServeHTTP(logRecorder, httptest.NewRequest(http.MethodGet, "/admin/api-access-logs", nil))
	if logRecorder.Code != http.StatusOK {
		t.Fatalf("list logs failed: %d %s", logRecorder.Code, logRecorder.Body.String())
	}
	if !strings.Contains(logRecorder.Body.String(), `"path":"/api/v1/public-api/nodes"`) || !strings.Contains(logRecorder.Body.String(), `"status_code":200`) {
		t.Fatalf("unexpected logs response: %s", logRecorder.Body.String())
	}
}

func strconvUint(value uint) string {
	return strconv.FormatUint(uint64(value), 10)
}
