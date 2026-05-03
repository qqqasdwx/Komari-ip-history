package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const apiKeyPrefix = "ipq_"

var (
	ErrAPIKeyMissing  = errors.New("missing api key")
	ErrAPIKeyInvalid  = errors.New("invalid api key")
	ErrAPIKeyDisabled = errors.New("api key disabled")
)

type APIKeyItem struct {
	ID           uint       `json:"id"`
	Name         string     `json:"name"`
	KeyPrefix    string     `json:"key_prefix"`
	Enabled      bool       `json:"enabled"`
	LastUsedAt   *time.Time `json:"last_used_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	PlaintextKey string     `json:"plaintext_key,omitempty"`
}

type APIAccessLogItem struct {
	ID         uint      `json:"id"`
	APIKeyID   *uint     `json:"api_key_id"`
	KeyPrefix  string    `json:"key_prefix"`
	KeyName    string    `json:"key_name"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	StatusCode int       `json:"status_code"`
	RemoteIP   string    `json:"remote_ip"`
	CreatedAt  time.Time `json:"created_at"`
}

type APIAccessLogPage struct {
	Items      []APIAccessLogItem `json:"items"`
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	TotalPages int                `json:"total_pages"`
}

func CreateAPIKey(db *gorm.DB, name string) (APIKeyItem, error) {
	normalizedName, err := normalizeAPIKeyName(name)
	if err != nil {
		return APIKeyItem{}, err
	}
	plaintext, err := newPlaintextAPIKey()
	if err != nil {
		return APIKeyItem{}, err
	}

	key := models.APIKey{
		Name:      normalizedName,
		KeyPrefix: APIKeyDisplayPrefix(plaintext),
		KeyHash:   HashAPIKey(plaintext),
		Enabled:   true,
	}
	if err := db.Create(&key).Error; err != nil {
		return APIKeyItem{}, err
	}

	item := apiKeyItem(key)
	item.PlaintextKey = plaintext
	return item, nil
}

func ListAPIKeys(db *gorm.DB) ([]APIKeyItem, error) {
	var keys []models.APIKey
	if err := db.Order("created_at DESC").Find(&keys).Error; err != nil {
		return nil, err
	}
	items := make([]APIKeyItem, 0, len(keys))
	for _, key := range keys {
		items = append(items, apiKeyItem(key))
	}
	return items, nil
}

func UpdateAPIKey(db *gorm.DB, id uint, name *string, enabled *bool) (APIKeyItem, error) {
	if id == 0 {
		return APIKeyItem{}, gorm.ErrRecordNotFound
	}
	updates := map[string]any{}
	if name != nil {
		normalizedName, err := normalizeAPIKeyName(*name)
		if err != nil {
			return APIKeyItem{}, err
		}
		updates["name"] = normalizedName
	}
	if enabled != nil {
		updates["enabled"] = *enabled
	}
	if len(updates) == 0 {
		return GetAPIKey(db, id)
	}

	var key models.APIKey
	if err := db.First(&key, id).Error; err != nil {
		return APIKeyItem{}, err
	}
	if err := db.Model(&key).Updates(updates).Error; err != nil {
		return APIKeyItem{}, err
	}
	if err := db.First(&key, id).Error; err != nil {
		return APIKeyItem{}, err
	}
	return apiKeyItem(key), nil
}

func DeleteAPIKey(db *gorm.DB, id uint) error {
	if id == 0 {
		return gorm.ErrRecordNotFound
	}
	result := db.Delete(&models.APIKey{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func GetAPIKey(db *gorm.DB, id uint) (APIKeyItem, error) {
	var key models.APIKey
	if err := db.First(&key, id).Error; err != nil {
		return APIKeyItem{}, err
	}
	return apiKeyItem(key), nil
}

func VerifyAPIKey(db *gorm.DB, plaintext string) (models.APIKey, error) {
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" {
		return models.APIKey{}, ErrAPIKeyMissing
	}

	var key models.APIKey
	if err := db.First(&key, "key_hash = ?", HashAPIKey(plaintext)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.APIKey{}, ErrAPIKeyInvalid
		}
		return models.APIKey{}, err
	}
	if !key.Enabled {
		return models.APIKey{}, ErrAPIKeyDisabled
	}

	now := time.Now().UTC()
	if err := db.Model(&key).Update("last_used_at", now).Error; err != nil {
		return models.APIKey{}, err
	}
	key.LastUsedAt = &now
	return key, nil
}

func RecordAPIAccessLog(db *gorm.DB, key *models.APIKey, fallbackKeyPrefix, method, path, remoteIP string, statusCode int) {
	if db == nil {
		return
	}
	if statusCode <= 0 {
		statusCode = 200
	}

	log := models.APIAccessLog{
		KeyPrefix:  trimMax(strings.TrimSpace(fallbackKeyPrefix), 16),
		Method:     trimMax(strings.ToUpper(strings.TrimSpace(method)), 16),
		Path:       trimMax(strings.TrimSpace(path), 2048),
		StatusCode: statusCode,
		RemoteIP:   trimMax(strings.TrimSpace(remoteIP), 64),
		CreatedAt:  time.Now().UTC(),
	}
	if key != nil && key.ID != 0 {
		log.APIKeyID = &key.ID
		log.KeyPrefix = key.KeyPrefix
		log.KeyName = key.Name
	}
	_ = db.Create(&log).Error
}

func ListAPIAccessLogs(db *gorm.DB, page, pageSize int) (APIAccessLogPage, error) {
	page = normalizeHistoryPage(page)
	pageSize = normalizeHistoryPageSize(0, pageSize)

	baseQuery := db.Model(&models.APIAccessLog{})
	var total int64
	if err := baseQuery.Count(&total).Error; err != nil {
		return APIAccessLogPage{}, err
	}

	var logs []models.APIAccessLog
	if err := db.Order("created_at DESC").
		Order("id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&logs).
		Error; err != nil {
		return APIAccessLogPage{}, err
	}

	items := make([]APIAccessLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, APIAccessLogItem{
			ID:         log.ID,
			APIKeyID:   log.APIKeyID,
			KeyPrefix:  log.KeyPrefix,
			KeyName:    log.KeyName,
			Method:     log.Method,
			Path:       log.Path,
			StatusCode: log.StatusCode,
			RemoteIP:   log.RemoteIP,
			CreatedAt:  log.CreatedAt,
		})
	}

	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	return APIAccessLogPage{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func APIKeyDisplayPrefix(plaintext string) string {
	plaintext = strings.TrimSpace(plaintext)
	if len(plaintext) <= 12 {
		return plaintext
	}
	return plaintext[:12]
}

func HashAPIKey(plaintext string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(plaintext)))
	return hex.EncodeToString(sum[:])
}

func newPlaintextAPIKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return apiKeyPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func normalizeAPIKeyName(name string) (string, error) {
	value := strings.TrimSpace(name)
	if value == "" {
		return "", errors.New("name is required")
	}
	if len([]rune(value)) > 128 {
		return "", errors.New("name is too long")
	}
	return value, nil
}

func apiKeyItem(key models.APIKey) APIKeyItem {
	return APIKeyItem{
		ID:         key.ID,
		Name:       key.Name,
		KeyPrefix:  key.KeyPrefix,
		Enabled:    key.Enabled,
		LastUsedAt: key.LastUsedAt,
		CreatedAt:  key.CreatedAt,
		UpdatedAt:  key.UpdatedAt,
	}
}

func trimMax(value string, maxLength int) string {
	if maxLength <= 0 {
		return ""
	}
	if len(value) <= maxLength {
		return value
	}
	return value[:maxLength]
}
