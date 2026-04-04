package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const historyRetentionDaysSettingKey = "history_retention_days"
const defaultHistoryRetentionDays = -1
const historyRetentionGrowthWindowDays = 7

type HistoryRetentionSettings struct {
	RetentionDays           int   `json:"retention_days"`
	HistoryBytes            int64 `json:"history_bytes"`
	RecentGrowthBytesPerDay int64 `json:"recent_growth_bytes_per_day"`
	EstimatedRetainedBytes  int64 `json:"estimated_retained_bytes"`
	EstimatedIsUnbounded    bool  `json:"estimated_is_unbounded"`
}

func ValidateHistoryRetentionDays(days int) error {
	if days == -1 || days >= 1 {
		return nil
	}
	return errors.New("retention_days must be -1 or a positive integer")
}

func getIntSetting(db *gorm.DB, key string, fallback int) (int, error) {
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", key).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return fallback, nil
		}
		return fallback, err
	}

	var parsedValue int
	if _, scanErr := fmt.Sscanf(setting.Value, "%d", &parsedValue); scanErr != nil {
		return fallback, nil
	}
	return parsedValue, nil
}

func setIntSetting(db *gorm.DB, key string, value int) error {
	return db.Save(&models.AppSetting{
		Key:       key,
		Value:     fmt.Sprintf("%d", value),
		UpdatedAt: time.Now().UTC(),
	}).Error
}

func GetHistoryRetentionDays(db *gorm.DB) (int, error) {
	return getIntSetting(db, historyRetentionDaysSettingKey, defaultHistoryRetentionDays)
}

func currentHistoryBytes(db *gorm.DB) (int64, error) {
	return historyBytesSince(db, nil)
}

func historyBytesSince(db *gorm.DB, startAt *time.Time) (int64, error) {
	query := db.Model(&models.NodeTargetHistory{})
	if startAt != nil {
		query = query.Where("recorded_at >= ?", startAt.UTC())
	}
	var total sql.NullInt64
	if err := query.Select("COALESCE(SUM(LENGTH(result_json) + LENGTH(summary)), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	if !total.Valid {
		return 0, nil
	}
	return total.Int64, nil
}

func recentGrowthBytesPerDay(db *gorm.DB, now time.Time) (int64, error) {
	windowStart := now.UTC().AddDate(0, 0, -historyRetentionGrowthWindowDays)
	bytes, err := historyBytesSince(db, &windowStart)
	if err != nil {
		return 0, err
	}
	return bytes / historyRetentionGrowthWindowDays, nil
}

func buildHistoryRetentionSettings(db *gorm.DB, retentionDays int, now time.Time) (HistoryRetentionSettings, error) {
	historyBytes, err := currentHistoryBytes(db)
	if err != nil {
		return HistoryRetentionSettings{}, err
	}
	growthPerDay, err := recentGrowthBytesPerDay(db, now)
	if err != nil {
		return HistoryRetentionSettings{}, err
	}

	settings := HistoryRetentionSettings{
		RetentionDays:           retentionDays,
		HistoryBytes:            historyBytes,
		RecentGrowthBytesPerDay: growthPerDay,
	}
	if retentionDays == -1 {
		settings.EstimatedRetainedBytes = historyBytes
		settings.EstimatedIsUnbounded = true
		return settings, nil
	}

	if growthPerDay > 0 {
		settings.EstimatedRetainedBytes = growthPerDay * int64(retentionDays)
	} else {
		settings.EstimatedRetainedBytes = historyBytes
	}
	return settings, nil
}

func GetHistoryRetentionSettings(db *gorm.DB) (HistoryRetentionSettings, error) {
	retentionDays, err := GetHistoryRetentionDays(db)
	if err != nil {
		return HistoryRetentionSettings{}, err
	}
	return buildHistoryRetentionSettings(db, retentionDays, time.Now().UTC())
}

func SetHistoryRetentionSettings(db *gorm.DB, retentionDays int) (HistoryRetentionSettings, error) {
	if err := ValidateHistoryRetentionDays(retentionDays); err != nil {
		return HistoryRetentionSettings{}, err
	}
	if err := setIntSetting(db, historyRetentionDaysSettingKey, retentionDays); err != nil {
		return HistoryRetentionSettings{}, err
	}
	return buildHistoryRetentionSettings(db, retentionDays, time.Now().UTC())
}

func CleanupExpiredHistorySnapshots(db *gorm.DB, now time.Time) (int64, error) {
	retentionDays, err := GetHistoryRetentionDays(db)
	if err != nil {
		return 0, err
	}
	if retentionDays == -1 {
		return 0, nil
	}

	cutoff := now.UTC().AddDate(0, 0, -retentionDays)
	result := db.Where("recorded_at < ? AND is_favorite = ?", cutoff, false).Delete(&models.NodeTargetHistory{})
	return result.RowsAffected, result.Error
}
