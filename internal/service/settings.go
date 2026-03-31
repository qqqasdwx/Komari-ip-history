package service

import (
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const changePrioritySettingKey = "change_priority"
const integrationBaseURLSettingKey = "integration_public_base_url"

type ChangePriorityConfig struct {
	SecondaryPaths []string `json:"secondary_paths"`
}

type IntegrationSettings struct {
	PublicBaseURL          string `json:"public_base_url"`
	EffectivePublicBaseURL string `json:"effective_public_base_url"`
}


func defaultChangePriorityConfig() ChangePriorityConfig {
	return ChangePriorityConfig{
		SecondaryPaths: []string{"Meta"},
	}
}

func normalizePaths(paths []string) []string {
	seen := make(map[string]struct{})
	items := make([]string, 0, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		items = append(items, path)
	}
	sort.Strings(items)
	return items
}


func GetChangePriorityConfig(db *gorm.DB) (ChangePriorityConfig, error) {
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", changePrioritySettingKey).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return defaultChangePriorityConfig(), nil
		}
		return ChangePriorityConfig{}, err
	}

	var cfg ChangePriorityConfig
	if err := json.Unmarshal([]byte(setting.Value), &cfg); err != nil {
		return ChangePriorityConfig{}, err
	}
	cfg.SecondaryPaths = normalizePaths(cfg.SecondaryPaths)
	return cfg, nil
}

func SetChangePriorityConfig(db *gorm.DB, cfg ChangePriorityConfig) (ChangePriorityConfig, error) {
	cfg.SecondaryPaths = normalizePaths(cfg.SecondaryPaths)

	payload, err := json.Marshal(cfg)
	if err != nil {
		return ChangePriorityConfig{}, err
	}

	if err := db.Save(&models.AppSetting{
		Key:       changePrioritySettingKey,
		Value:     string(payload),
		UpdatedAt: time.Now(),
	}).Error; err != nil {
		return ChangePriorityConfig{}, err
	}
	return cfg, nil
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

func GetIntegrationSettings(db *gorm.DB, cfgPublicBaseURL string) (IntegrationSettings, error) {
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", integrationBaseURLSettingKey).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return IntegrationSettings{
				PublicBaseURL:          "",
				EffectivePublicBaseURL: EffectivePublicBaseURL(cfgPublicBaseURL, ""),
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
	}, nil
}

func SetIntegrationSettings(db *gorm.DB, cfgPublicBaseURL string, raw string) (IntegrationSettings, error) {
	value, err := ValidatePublicBaseURL(raw)
	if err != nil {
		return IntegrationSettings{}, err
	}

	if err := db.Save(&models.AppSetting{
		Key:       integrationBaseURLSettingKey,
		Value:     value,
		UpdatedAt: time.Now(),
	}).Error; err != nil {
		return IntegrationSettings{}, err
	}

	return IntegrationSettings{
		PublicBaseURL:          value,
		EffectivePublicBaseURL: EffectivePublicBaseURL(cfgPublicBaseURL, value),
	}, nil
}
