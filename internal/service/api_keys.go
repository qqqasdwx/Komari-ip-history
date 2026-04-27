package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"komari-ip-history/internal/auth"
	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

type APIKeyDetail struct {
	ID         uint    `json:"id"`
	Name       string  `json:"name"`
	Enabled    bool    `json:"enabled"`
	LastUsedAt *string `json:"last_used_at"`
}

type APIKeyCreateResult struct {
	ID      uint   `json:"id"`
	Name    string `json:"name"`
	Key     string `json:"key"`
	Enabled bool   `json:"enabled"`
}

type APIAccessLogDetail struct {
	ID         uint      `json:"id"`
	APIKeyID   uint      `json:"api_key_id"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	StatusCode int       `json:"status_code"`
	RemoteAddr string    `json:"remote_addr"`
	CreatedAt  time.Time `json:"created_at"`
}

func ListAPIKeys(db *gorm.DB) ([]APIKeyDetail, error) {
	var keys []models.APIKey
	if err := db.Order("created_at ASC").Find(&keys).Error; err != nil {
		return nil, err
	}
	items := make([]APIKeyDetail, 0, len(keys))
	for _, key := range keys {
		var lastUsedAt *string
		if key.LastUsedAt != nil && !key.LastUsedAt.IsZero() {
			formatted := key.LastUsedAt.UTC().Format("2006-01-02T15:04:05Z")
			lastUsedAt = &formatted
		}
		items = append(items, APIKeyDetail{
			ID:         key.ID,
			Name:       key.Name,
			Enabled:    key.Enabled,
			LastUsedAt: lastUsedAt,
		})
	}
	return items, nil
}

func CreateAPIKey(db *gorm.DB, name string) (APIKeyCreateResult, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return APIKeyCreateResult{}, errors.New("api key name is required")
	}

	plainKey, err := auth.NewSessionToken()
	if err != nil {
		return APIKeyCreateResult{}, err
	}
	hash := hashAPIKey(plainKey)

	model := models.APIKey{
		Name:    trimmedName,
		KeyHash: hash,
		Enabled: true,
	}
	if err := db.Create(&model).Error; err != nil {
		return APIKeyCreateResult{}, err
	}

	return APIKeyCreateResult{
		ID:      model.ID,
		Name:    model.Name,
		Key:     plainKey,
		Enabled: model.Enabled,
	}, nil
}

func SetAPIKeyEnabled(db *gorm.DB, id uint, enabled bool) (APIKeyDetail, error) {
	if id == 0 {
		return APIKeyDetail{}, errors.New("api key id is required")
	}
	var model models.APIKey
	if err := db.First(&model, "id = ?", id).Error; err != nil {
		return APIKeyDetail{}, err
	}
	if err := db.Model(&model).Update("enabled", enabled).Error; err != nil {
		return APIKeyDetail{}, err
	}
	model.Enabled = enabled
	var lastUsedAt *string
	if model.LastUsedAt != nil && !model.LastUsedAt.IsZero() {
		formatted := model.LastUsedAt.UTC().Format("2006-01-02T15:04:05Z")
		lastUsedAt = &formatted
	}
	return APIKeyDetail{
		ID:         model.ID,
		Name:       model.Name,
		Enabled:    model.Enabled,
		LastUsedAt: lastUsedAt,
	}, nil
}

func DeleteAPIKey(db *gorm.DB, id uint) error {
	if id == 0 {
		return errors.New("api key id is required")
	}
	return db.Delete(&models.APIKey{}, "id = ?", id).Error
}

func ListAPIAccessLogs(db *gorm.DB, apiKeyID uint, limit int) ([]APIAccessLogDetail, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	query := db.Order("created_at DESC").Limit(limit)
	if apiKeyID > 0 {
		query = query.Where("api_key_id = ?", apiKeyID)
	}
	var logs []models.APIAccessLog
	if err := query.Find(&logs).Error; err != nil {
		return nil, err
	}
	items := make([]APIAccessLogDetail, 0, len(logs))
	for _, item := range logs {
		items = append(items, APIAccessLogDetail{
			ID:         item.ID,
			APIKeyID:   item.APIKeyID,
			Method:     item.Method,
			Path:       item.Path,
			StatusCode: item.StatusCode,
			RemoteAddr: item.RemoteAddr,
			CreatedAt:  item.CreatedAt,
		})
	}
	return items, nil
}

func ValidateAPIKey(db *gorm.DB, key string) (*models.APIKey, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil, errors.New("missing api key")
	}
	var model models.APIKey
	if err := db.First(&model, "key_hash = ? AND enabled = ?", hashAPIKey(trimmed), true).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("invalid api key")
		}
		return nil, err
	}
	now := time.Now().UTC()
	_ = db.Model(&model).Update("last_used_at", now).Error
	model.LastUsedAt = &now
	return &model, nil
}

func hashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}
