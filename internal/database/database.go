package database

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"komari-ip-history/internal/auth"
	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func Open(cfg config.Config) (*gorm.DB, error) {
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), os.ModePerm); err != nil {
		return nil, err
	}

	db, err := gorm.Open(sqlite.Open(cfg.DatabasePath), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&models.AdminUser{},
		&models.Session{},
		&models.Node{},
		&models.NodeTarget{},
		&models.NodeHistory{},
		&models.NodeTargetHistory{},
		&models.AppSetting{},
	); err != nil {
		return nil, err
	}

	if err := ensureDefaultAdmin(db, cfg); err != nil {
		return nil, err
	}
	if err := migrateLegacyNodeTargets(db); err != nil {
		return nil, err
	}
	if err := rebuildNodeAggregates(db); err != nil {
		return nil, err
	}

	return db, nil
}

func ensureDefaultAdmin(db *gorm.DB, cfg config.Config) error {
	var count int64
	if err := db.Model(&models.AdminUser{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := auth.HashPassword(cfg.DefaultAdminPass)
	if err != nil {
		return err
	}

	user := models.AdminUser{
		Username:     cfg.DefaultAdminUser,
		PasswordHash: hash,
	}
	return db.Create(&user).Error
}

func CleanupExpiredSessions(db *gorm.DB) error {
	if db == nil {
		return errors.New("nil database")
	}
	return db.Where("expires_at <= CURRENT_TIMESTAMP").Delete(&models.Session{}).Error
}

func migrateLegacyNodeTargets(db *gorm.DB) error {
	var nodes []models.Node
	if err := db.Find(&nodes).Error; err != nil {
		return err
	}

	for _, node := range nodes {
		var targetCount int64
		if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", node.ID).Count(&targetCount).Error; err != nil {
			return err
		}
		if targetCount > 0 || node.CurrentResultJSON == "" {
			continue
		}

		targetIP := extractLegacyTargetIP(node.CurrentResultJSON)
		if targetIP == "" {
			continue
		}

		target := models.NodeTarget{
			NodeID:                 node.ID,
			TargetIP:               targetIP,
			SortOrder:              0,
			HasData:                node.HasData,
			CurrentSummary:         node.CurrentSummary,
			CurrentResultJSON:      node.CurrentResultJSON,
			CurrentResultUpdatedAt: node.CurrentResultUpdatedAt,
		}

		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&target).Error; err != nil {
				return err
			}

			var legacyHistory []models.NodeHistory
			if err := tx.Where("node_id = ?", node.ID).Order("recorded_at ASC").Find(&legacyHistory).Error; err != nil {
				return err
			}

			if len(legacyHistory) == 0 && node.CurrentResultUpdatedAt != nil {
				legacyHistory = append(legacyHistory, models.NodeHistory{
					NodeID:     node.ID,
					ResultJSON: node.CurrentResultJSON,
					Summary:    node.CurrentSummary,
					RecordedAt: node.CurrentResultUpdatedAt.UTC(),
				})
			}

			for _, item := range legacyHistory {
				history := models.NodeTargetHistory{
					NodeTargetID: target.ID,
					ResultJSON:   item.ResultJSON,
					Summary:      item.Summary,
					RecordedAt:   item.RecordedAt,
				}
				if err := tx.Create(&history).Error; err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}

	return nil
}

func extractLegacyTargetIP(raw string) string {
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ""
	}
	head, _ := payload["Head"].(map[string]any)
	if head == nil {
		return ""
	}
	value, _ := head["IP"].(string)
	value = strings.TrimSpace(value)
	if value == "" || net.ParseIP(value) == nil {
		return ""
	}
	return value
}

func rebuildNodeAggregates(db *gorm.DB) error {
	var nodes []models.Node
	if err := db.Find(&nodes).Error; err != nil {
		return err
	}

	for _, node := range nodes {
		var targets []models.NodeTarget
		if err := db.Where("node_id = ?", node.ID).Find(&targets).Error; err != nil {
			return err
		}

		hasData := false
		var updatedAt *time.Time
		for _, target := range targets {
			if !target.HasData || target.CurrentResultUpdatedAt == nil {
				continue
			}
			value := target.CurrentResultUpdatedAt.UTC()
			if updatedAt == nil || value.After(*updatedAt) {
				updatedAt = &value
			}
			hasData = true
		}

		updates := map[string]any{
			"has_data":                  hasData,
			"current_summary":           "",
			"current_result_json":       "",
			"current_result_updated_at": updatedAt,
		}
		if err := db.Model(&models.Node{}).Where("id = ?", node.ID).Updates(updates).Error; err != nil {
			return err
		}
	}

	return nil
}
