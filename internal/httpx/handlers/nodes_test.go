package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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

func TestNodeHandlerUpdateRenamesNode(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.KomariBinding{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{KomariNodeUUID: "node-handler-rename", Name: "Old Name", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	handler := NodeHandler{DB: db, Cfg: config.Config{}}
	router := gin.New()
	router.PUT("/api/v1/nodes/:uuid", handler.Update)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/"+node.KomariNodeUUID, bytes.NewBufferString(`{"name":"New Name"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var payload struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Name != "New Name" {
		t.Fatalf("expected updated name, got %s", payload.Name)
	}
}

func TestNodeHandlerUpdateSupportsNodeUUID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.KomariBinding{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{NodeUUID: "internal-node-route", KomariNodeUUID: "komari-node-route", Name: "Old Name", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}

	handler := NodeHandler{DB: db, Cfg: config.Config{}}
	router := gin.New()
	router.PUT("/api/v1/nodes/:uuid", handler.Update)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/"+node.NodeUUID, bytes.NewBufferString(`{"name":"By Internal UUID"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestNodeHandlerUpdateReturnsBindingProjection(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.KomariBinding{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	node := models.Node{NodeUUID: "internal-node-route", KomariNodeUUID: "ipq-shell-node", Name: "Old Name", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := db.Create(&models.KomariBinding{
		NodeID:         node.ID,
		KomariNodeUUID: "komari-real-uuid",
		KomariNodeName: "Komari Bound Name",
		BindingSource:  "manual",
	}).Error; err != nil {
		t.Fatalf("create binding: %v", err)
	}

	handler := NodeHandler{DB: db, Cfg: config.Config{}}
	router := gin.New()
	router.PUT("/api/v1/nodes/:uuid", handler.Update)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/"+node.NodeUUID, bytes.NewBufferString(`{"name":"By Internal UUID"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var payload struct {
		Name             string `json:"name"`
		KomariNodeUUID   string `json:"komari_node_uuid"`
		KomariNodeName   string `json:"komari_node_name"`
		HasKomariBinding bool   `json:"has_komari_binding"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Name != "By Internal UUID" {
		t.Fatalf("expected updated name, got %s", payload.Name)
	}
	if payload.KomariNodeUUID != "komari-real-uuid" {
		t.Fatalf("expected projected komari uuid, got %s", payload.KomariNodeUUID)
	}
	if payload.KomariNodeName != "Komari Bound Name" {
		t.Fatalf("expected projected komari name, got %s", payload.KomariNodeName)
	}
	if !payload.HasKomariBinding {
		t.Fatal("expected projected binding state to be true")
	}
}
