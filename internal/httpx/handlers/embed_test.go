package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"komari-ip-history/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openEmbedHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.Node{}, &models.NodeTarget{}, &models.NodeTargetHistory{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestEmbedRegisterBeaconCreatesShellWithoutSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openEmbedHandlerTestDB(t)
	handler := EmbedHandler{DB: db}

	router := gin.New()
	router.GET("/embed/nodes/register", handler.RegisterBeacon)

	req := httptest.NewRequest(http.MethodGet, "/embed/nodes/register?uuid=komari-beacon&name=Komari%20Beacon", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected embed CORS header")
	}

	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", "komari-beacon").Error; err != nil {
		t.Fatalf("expected beacon node shell: %v", err)
	}
}

func TestEmbedNodeStatusReportsMissingWithoutCreatingShell(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openEmbedHandlerTestDB(t)
	handler := EmbedHandler{DB: db}

	router := gin.New()
	router.GET("/embed/nodes/status", handler.NodeStatus)

	req := httptest.NewRequest(http.MethodGet, "/embed/nodes/status?uuid=komari-status&name=Komari%20Status", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"connected":false`) {
		t.Fatalf("expected disconnected status, got %s", recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"exists":false`) {
		t.Fatalf("expected missing status, got %s", recorder.Body.String())
	}

	var count int64
	if err := db.Model(&models.Node{}).Where("komari_node_uuid = ?", "komari-status").Count(&count).Error; err != nil {
		t.Fatalf("count nodes: %v", err)
	}
	if count != 0 {
		t.Fatalf("status endpoint should not create node shell, got %d rows", count)
	}
}

func TestEmbedConnectCreatesShellWithoutSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := openEmbedHandlerTestDB(t)
	handler := EmbedHandler{DB: db}

	router := gin.New()
	router.GET("/embed/nodes/connect", handler.ConnectNode)

	req := httptest.NewRequest(http.MethodGet, "/embed/nodes/connect?uuid=komari-connect&name=Komari%20Connect", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"exists":true`) {
		t.Fatalf("expected connected shell to exist, got %s", recorder.Body.String())
	}

	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", "komari-connect").Error; err != nil {
		t.Fatalf("expected connect node shell: %v", err)
	}
}
