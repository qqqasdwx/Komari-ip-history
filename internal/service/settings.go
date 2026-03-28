package service

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const displayFieldsSettingKey = "display_fields"
const changePrioritySettingKey = "change_priority"

type DisplayFieldsConfig struct {
	HiddenPaths []string `json:"hidden_paths"`
}

type ChangePriorityConfig struct {
	SecondaryPaths []string `json:"secondary_paths"`
}

func GetDisplayFieldsConfig(db *gorm.DB) (DisplayFieldsConfig, error) {
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", displayFieldsSettingKey).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return DisplayFieldsConfig{}, nil
		}
		return DisplayFieldsConfig{}, err
	}

	var cfg DisplayFieldsConfig
	if err := json.Unmarshal([]byte(setting.Value), &cfg); err != nil {
		return DisplayFieldsConfig{}, err
	}
	return cfg, nil
}

func SetDisplayFieldsConfig(db *gorm.DB, cfg DisplayFieldsConfig) error {
	payload, err := json.Marshal(cfg)
	if err != nil {
		return err
	}

	return db.Save(&models.AppSetting{
		Key:       displayFieldsSettingKey,
		Value:     string(payload),
		UpdatedAt: time.Now(),
	}).Error
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

func ListDisplayFieldPaths(db *gorm.DB) ([]string, error) {
	var nodes []models.Node
	if err := db.Select("current_result_json").Where("current_result_json <> ''").Find(&nodes).Error; err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	for _, node := range nodes {
		var payload any
		if err := json.Unmarshal([]byte(node.CurrentResultJSON), &payload); err != nil {
			continue
		}
		collectFieldPaths("", payload, seen)
	}

	paths := make([]string, 0, len(seen))
	for path := range seen {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

func collectFieldPaths(prefix string, value any, seen map[string]struct{}) {
	switch typed := value.(type) {
	case map[string]any:
		if len(typed) == 0 {
			if prefix != "" {
				seen[prefix] = struct{}{}
			}
			return
		}
		for key, child := range typed {
			next := key
			if prefix != "" {
				next = prefix + "." + key
			}
			collectFieldPaths(next, child, seen)
		}
	case []any:
		if prefix != "" {
			seen[prefix] = struct{}{}
		}
	default:
		if prefix != "" {
			seen[prefix] = struct{}{}
		}
	}
}
