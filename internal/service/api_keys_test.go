package service

import (
	"errors"
	"strings"
	"testing"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openAPIKeyServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.APIKey{}, &models.APIAccessLog{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func TestCreateAPIKeyShowsPlaintextOnceAndStoresHash(t *testing.T) {
	db := openAPIKeyServiceTestDB(t)

	created, err := CreateAPIKey(db, "Monitoring")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}
	if created.PlaintextKey == "" {
		t.Fatalf("expected plaintext key on create")
	}
	if !strings.HasPrefix(created.PlaintextKey, apiKeyPrefix) {
		t.Fatalf("unexpected key prefix: %s", created.PlaintextKey)
	}

	items, err := ListAPIKeys(db)
	if err != nil {
		t.Fatalf("list api keys: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one key, got %d", len(items))
	}
	if items[0].PlaintextKey != "" {
		t.Fatalf("list should not return plaintext key")
	}

	var stored models.APIKey
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatalf("load stored key: %v", err)
	}
	if stored.KeyHash == "" || strings.Contains(stored.KeyHash, created.PlaintextKey) {
		t.Fatalf("expected stored hash, got %q", stored.KeyHash)
	}
}

func TestVerifyAPIKeyRejectsInvalidDisabledAndDeletedKeys(t *testing.T) {
	db := openAPIKeyServiceTestDB(t)

	created, err := CreateAPIKey(db, "External")
	if err != nil {
		t.Fatalf("create api key: %v", err)
	}

	if _, err := VerifyAPIKey(db, "bad-key"); !errors.Is(err, ErrAPIKeyInvalid) {
		t.Fatalf("expected invalid key error, got %v", err)
	}

	if _, err := VerifyAPIKey(db, created.PlaintextKey); err != nil {
		t.Fatalf("valid key should pass: %v", err)
	}

	disabled := false
	if _, err := UpdateAPIKey(db, created.ID, nil, &disabled); err != nil {
		t.Fatalf("disable key: %v", err)
	}
	if _, err := VerifyAPIKey(db, created.PlaintextKey); !errors.Is(err, ErrAPIKeyDisabled) {
		t.Fatalf("expected disabled key error, got %v", err)
	}

	enabled := true
	if _, err := UpdateAPIKey(db, created.ID, nil, &enabled); err != nil {
		t.Fatalf("enable key: %v", err)
	}
	if err := DeleteAPIKey(db, created.ID); err != nil {
		t.Fatalf("delete key: %v", err)
	}
	if _, err := VerifyAPIKey(db, created.PlaintextKey); !errors.Is(err, ErrAPIKeyInvalid) {
		t.Fatalf("expected deleted key to be invalid, got %v", err)
	}
}
