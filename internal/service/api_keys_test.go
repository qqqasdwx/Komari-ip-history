package service

import (
	"testing"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openAPIKeysTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.APIKey{}, &models.APIAccessLog{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestCreateAndListAPIKeys(t *testing.T) {
	db := openAPIKeysTestDB(t)

	created, err := CreateAPIKey(db, "readonly")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}
	if created.Key == "" {
		t.Fatal("expected plain key to be returned once")
	}

	items, err := ListAPIKeys(db)
	if err != nil {
		t.Fatalf("list api keys: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 api key, got %d", len(items))
	}
	if items[0].Name != "readonly" {
		t.Fatalf("unexpected api key name: %s", items[0].Name)
	}
}

func TestSetAPIKeyEnabled(t *testing.T) {
	db := openAPIKeysTestDB(t)

	created, err := CreateAPIKey(db, "toggle")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	item, err := SetAPIKeyEnabled(db, created.ID, false)
	if err != nil {
		t.Fatalf("disable api key: %v", err)
	}
	if item.Enabled {
		t.Fatal("expected api key to be disabled")
	}
}

func TestValidateAPIKey(t *testing.T) {
	db := openAPIKeysTestDB(t)

	created, err := CreateAPIKey(db, "validate")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	model, err := ValidateAPIKey(db, created.Key)
	if err != nil {
		t.Fatalf("validate api key: %v", err)
	}
	if model.Name != "validate" {
		t.Fatalf("unexpected api key name: %s", model.Name)
	}
}

func TestListAPIAccessLogs(t *testing.T) {
	db := openAPIKeysTestDB(t)

	if err := db.Create(&models.APIAccessLog{
		APIKeyID:   1,
		Method:     "GET",
		Path:       "/api/public/v1/nodes",
		StatusCode: 200,
		RemoteAddr: "127.0.0.1",
	}).Error; err != nil {
		t.Fatalf("create api access log: %v", err)
	}

	items, err := ListAPIAccessLogs(db, 1, 10)
	if err != nil {
		t.Fatalf("list api access logs: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 access log, got %d", len(items))
	}
	if items[0].Path != "/api/public/v1/nodes" {
		t.Fatalf("unexpected log path: %s", items[0].Path)
	}
}
