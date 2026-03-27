package database

import (
	"errors"
	"os"
	"path/filepath"

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
		&models.NodeHistory{},
		&models.AppSetting{},
	); err != nil {
		return nil, err
	}

	if err := ensureDefaultAdmin(db, cfg); err != nil {
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
