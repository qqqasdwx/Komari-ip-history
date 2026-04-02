package service

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const integrationBaseURLSettingKey = "integration_public_base_url"
const integrationGuestReadEnabledSettingKey = "integration_guest_read_enabled"

type IntegrationSettings struct {
	PublicBaseURL          string `json:"public_base_url"`
	EffectivePublicBaseURL string `json:"effective_public_base_url"`
	GuestReadEnabled       bool   `json:"guest_read_enabled"`
}

func NormalizePublicBaseURL(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func ValidatePublicBaseURL(raw string) (string, error) {
	value := NormalizePublicBaseURL(raw)
	if value == "" {
		return "", nil
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("public_base_url must start with http:// or https://")
	}
	if parsed.Host == "" {
		return "", errors.New("public_base_url must include host")
	}
	return value, nil
}

func EffectivePublicBaseURL(cfgPublicBaseURL string, override string) string {
	override = NormalizePublicBaseURL(override)
	if override != "" {
		return override
	}
	value := NormalizePublicBaseURL(cfgPublicBaseURL)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}
	if host := strings.TrimSpace(strings.ToLower(parsed.Hostname())); host == "localhost" || host == "0.0.0.0" || strings.HasPrefix(host, "127.") {
		return ""
	}
	return value
}

func getBoolSetting(db *gorm.DB, key string, fallback bool) (bool, error) {
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", key).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return fallback, nil
		}
		return fallback, err
	}

	value := strings.TrimSpace(strings.ToLower(setting.Value))
	switch value {
	case "", "0", "false", "no", "off":
		return false, nil
	case "1", "true", "yes", "on":
		return true, nil
	default:
		return fallback, nil
	}
}

func setBoolSetting(db *gorm.DB, key string, value bool) error {
	storedValue := "false"
	if value {
		storedValue = "true"
	}

	return db.Save(&models.AppSetting{
		Key:       key,
		Value:     storedValue,
		UpdatedAt: time.Now(),
	}).Error
}

func GetIntegrationSettings(db *gorm.DB, cfgPublicBaseURL string) (IntegrationSettings, error) {
	guestReadEnabled, err := getBoolSetting(db, integrationGuestReadEnabledSettingKey, false)
	if err != nil {
		return IntegrationSettings{}, err
	}

	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", integrationBaseURLSettingKey).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return IntegrationSettings{
				PublicBaseURL:          "",
				EffectivePublicBaseURL: EffectivePublicBaseURL(cfgPublicBaseURL, ""),
				GuestReadEnabled:       guestReadEnabled,
			}, nil
		}
		return IntegrationSettings{}, err
	}

	value, err := ValidatePublicBaseURL(setting.Value)
	if err != nil {
		value = NormalizePublicBaseURL(setting.Value)
	}
	return IntegrationSettings{
		PublicBaseURL:          value,
		EffectivePublicBaseURL: EffectivePublicBaseURL(cfgPublicBaseURL, value),
		GuestReadEnabled:       guestReadEnabled,
	}, nil
}

func SetIntegrationSettings(db *gorm.DB, cfgPublicBaseURL string, raw string, guestReadEnabled bool) (IntegrationSettings, error) {
	value, err := ValidatePublicBaseURL(raw)
	if err != nil {
		return IntegrationSettings{}, err
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&models.AppSetting{
			Key:       integrationBaseURLSettingKey,
			Value:     value,
			UpdatedAt: time.Now(),
		}).Error; err != nil {
			return err
		}
		return setBoolSetting(tx, integrationGuestReadEnabledSettingKey, guestReadEnabled)
	}); err != nil {
		return IntegrationSettings{}, err
	}

	return IntegrationSettings{
		PublicBaseURL:          value,
		EffectivePublicBaseURL: EffectivePublicBaseURL(cfgPublicBaseURL, value),
		GuestReadEnabled:       guestReadEnabled,
	}, nil
}
