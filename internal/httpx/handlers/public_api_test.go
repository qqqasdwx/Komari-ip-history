package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Node{},
		&models.NodeTarget{},
		&models.KomariBinding{},
		&models.NodeTargetHistory{},
		&models.APIKey{},
		&models.APIAccessLog{},
	); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestPublicAPIRequiresAPIKey(t *testing.T) {
	db := openPublicAPITestDB(t)
	handler := PublicHandler{DB: db}

	router := gin.New()
	group := router.Group("/api/public/v1")
	group.Use(middleware.RequireAPIKey(db))
	group.GET("/nodes", handler.APIList)

	req := httptest.NewRequest(http.MethodGet, "/api/public/v1/nodes", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
}

func TestPublicAPIListAndDetail(t *testing.T) {
	db := openPublicAPITestDB(t)
	handler := PublicHandler{DB: db}

	key, err := service.CreateAPIKey(db, "readonly")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	node := models.Node{
		KomariNodeUUID:       "node-public",
		Name:                 "Node Public",
		ReporterToken:        "token",
		ReporterScheduleCron: "0 0 * * *",
		ReporterTimezone:     "UTC",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.KomariBinding{
		NodeID:         node.ID,
		KomariNodeUUID: node.KomariNodeUUID,
		KomariNodeName: "Komari Public",
		BindingSource:  "from_komari",
	}).Error; err != nil {
		t.Fatalf("create binding: %v", err)
	}
	target := models.NodeTarget{
		NodeID:                 node.ID,
		TargetIP:               "1.1.1.1",
		Source:                 "manual",
		Enabled:                true,
		SortOrder:              0,
		HasData:                true,
		CurrentSummary:         "summary",
		CurrentResultJSON:      `{"Head":{"IP":"1.1.1.1"}}`,
		CurrentResultUpdatedAt: ptrTime(time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)),
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	history := models.NodeTargetHistory{
		NodeTargetID: target.ID,
		ResultJSON:   `{"Head":{"IP":"1.1.1.1"}}`,
		Summary:      "history",
		RecordedAt:   time.Date(2026, 4, 15, 1, 0, 0, 0, time.UTC),
	}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("create history: %v", err)
	}

	router := gin.New()
	group := router.Group("/api/public/v1")
	group.Use(middleware.RequireAPIKey(db))
	group.GET("/nodes", handler.APIList)
	group.GET("/nodes/:uuid", handler.APIDetail)
	group.GET("/nodes/:uuid/targets", handler.APITargets)
	group.GET("/nodes/:uuid/targets/:targetID", handler.APITargetDetail)
	group.GET("/nodes/:uuid/history", handler.APIHistory)

	makeReq := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-IPQ-API-Key", key.Key)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		return resp
	}

	listResp := makeReq("/api/public/v1/nodes")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d", listResp.Code)
	}
	var listPayload struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(listResp.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listPayload.Items) != 1 {
		t.Fatalf("expected 1 node, got %d", len(listPayload.Items))
	}
	if listPayload.Items[0]["node_uuid"] == "" {
		t.Fatalf("expected node_uuid in public list payload, got %#v", listPayload.Items[0])
	}

	detailResp := makeReq("/api/public/v1/nodes/node-public")
	if detailResp.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d", detailResp.Code)
	}
	var detailPayload map[string]any
	if err := json.Unmarshal(detailResp.Body.Bytes(), &detailPayload); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}
	if detailPayload["node_uuid"] == "" {
		t.Fatalf("expected node_uuid in public detail payload, got %#v", detailPayload)
	}

	targetsResp := makeReq("/api/public/v1/nodes/node-public/targets")
	if targetsResp.Code != http.StatusOK {
		t.Fatalf("expected targets 200, got %d", targetsResp.Code)
	}

	targetResp := makeReq("/api/public/v1/nodes/node-public/targets/" + strconv.FormatUint(uint64(target.ID), 10))
	if targetResp.Code != http.StatusOK {
		t.Fatalf("expected target detail 200, got %d", targetResp.Code)
	}

	historyResp := makeReq("/api/public/v1/nodes/node-public/history")
	if historyResp.Code != http.StatusOK {
		t.Fatalf("expected history 200, got %d", historyResp.Code)
	}
}

func TestPublicAPIRateLimitAndAccessLog(t *testing.T) {
	db := openPublicAPITestDB(t)
	handler := PublicHandler{DB: db}
	middleware.ResetPublicAPIRateLimiterForTesting()

	key, err := service.CreateAPIKey(db, "readonly-limit")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	node := models.Node{
		KomariNodeUUID: "node-limit",
		Name:           "Node Limit",
		ReporterToken:  "token",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	router := gin.New()
	group := router.Group("/api/public/v1")
	group.Use(middleware.RequireAPIKey(db, middleware.WithPublicAPIRateLimit(1, time.Hour)))
	group.GET("/nodes", handler.APIList)

	makeReq := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/public/v1/nodes", nil)
		req.Header.Set("X-IPQ-API-Key", key.Key)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		return resp
	}

	firstResp := makeReq()
	if firstResp.Code != http.StatusOK {
		t.Fatalf("expected first response 200, got %d", firstResp.Code)
	}

	secondResp := makeReq()
	if secondResp.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second response 429, got %d", secondResp.Code)
	}

	var logs []models.APIAccessLog
	if err := db.Order("id ASC").Find(&logs).Error; err != nil {
		t.Fatalf("list access logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 access logs, got %d", len(logs))
	}
	if logs[0].StatusCode != http.StatusOK {
		t.Fatalf("expected first log status 200, got %d", logs[0].StatusCode)
	}
	if logs[1].StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected second log status 429, got %d", logs[1].StatusCode)
	}
	if logs[0].APIKeyID != key.ID || logs[1].APIKeyID != key.ID {
		t.Fatalf("unexpected api key ids in access logs: %#v", logs)
	}
}

func TestPublicAPIAliasRouteWorks(t *testing.T) {
	db := openPublicAPITestDB(t)
	handler := PublicHandler{DB: db}
	middleware.ResetPublicAPIRateLimiterForTesting()

	key, err := service.CreateAPIKey(db, "readonly-alias")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	node := models.Node{
		KomariNodeUUID: "node-alias",
		Name:           "Node Alias",
		ReporterToken:  "token",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	router := gin.New()
	group := router.Group("/api/public/v1")
	group.Use(middleware.RequireAPIKey(db))
	group.GET("/nodes", handler.APIList)

	req := httptest.NewRequest(http.MethodGet, "/api/public/v1/nodes", nil)
	req.Header.Set("X-IPQ-API-Key", key.Key)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected alias route 200, got %d", resp.Code)
	}
}

func TestPublicAPIDetailSupportsNodeUUID(t *testing.T) {
	db := openPublicAPITestDB(t)
	handler := PublicHandler{DB: db}
	middleware.ResetPublicAPIRateLimiterForTesting()

	key, err := service.CreateAPIKey(db, "readonly-node-uuid")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	node := models.Node{
		NodeUUID:       "public-node-internal",
		KomariNodeUUID: "public-node-komari",
		Name:           "Public Internal",
		ReporterToken:  "token",
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	router := gin.New()
	group := router.Group("/api/public/v1")
	group.Use(middleware.RequireAPIKey(db))
	group.GET("/nodes/:uuid", handler.APIDetail)

	req := httptest.NewRequest(http.MethodGet, "/api/public/v1/nodes/"+node.NodeUUID, nil)
	req.Header.Set("X-IPQ-API-Key", key.Key)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected detail 200 by node_uuid, got %d", resp.Code)
	}
}

func ptrTime(value time.Time) *time.Time {
	return &value
}
