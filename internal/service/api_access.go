package service

import (
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

func RecordAPIAccessLog(db *gorm.DB, apiKeyID uint, method, path string, statusCode int, remoteAddr string) error {
	if db == nil || apiKeyID == 0 {
		return nil
	}
	entry := models.APIAccessLog{
		APIKeyID:   apiKeyID,
		Method:     strings.TrimSpace(strings.ToUpper(method)),
		Path:       strings.TrimSpace(path),
		StatusCode: statusCode,
		RemoteAddr: strings.TrimSpace(remoteAddr),
		CreatedAt:  time.Now().UTC(),
	}
	return db.Create(&entry).Error
}
