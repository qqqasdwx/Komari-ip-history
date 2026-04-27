package service

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

const notificationActiveChannelIDSettingKey = "notification_active_channel_id"
const notificationTitleTemplateSettingKey = "notification_title_template"
const notificationMessageTemplateSettingKey = "notification_message_template"

const defaultNotificationTitleTemplate = ""
const defaultNotificationMessageTemplate = "字段变化: {{field_path}}\n旧值: {{previous_value}}\n新值: {{current_value}}\n目标 IP: {{target_ip}}\n时间: {{recorded_at}}\n详情: {{detail_url}}"

type NotificationSettings struct {
	ActiveChannelID *uint  `json:"active_channel_id"`
	TitleTemplate   string `json:"title_template"`
	MessageTemplate string `json:"message_template"`
}

func GetNotificationSettings(db *gorm.DB) (NotificationSettings, error) {
	activeChannelID, err := getOptionalUintSetting(db, notificationActiveChannelIDSettingKey)
	if err != nil {
		return NotificationSettings{}, err
	}
	return NotificationSettings{
		ActiveChannelID: activeChannelID,
		TitleTemplate:   getTextSetting(db, notificationTitleTemplateSettingKey, defaultNotificationTitleTemplate),
		MessageTemplate: getTextSetting(db, notificationMessageTemplateSettingKey, defaultNotificationMessageTemplate),
	}, nil
}

func SetNotificationSettings(db *gorm.DB, activeChannelID *uint, titleTemplate string, messageTemplate string) (NotificationSettings, error) {
	titleTemplate = strings.TrimSpace(titleTemplate)
	messageTemplate = strings.TrimSpace(messageTemplate)
	if messageTemplate == "" {
		messageTemplate = defaultNotificationMessageTemplate
	}
	if activeChannelID != nil && *activeChannelID != 0 {
		var channel models.NotificationChannel
		if err := db.First(&channel, "id = ?", *activeChannelID).Error; err != nil {
			return NotificationSettings{}, err
		}
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := setOptionalUintSetting(tx, notificationActiveChannelIDSettingKey, activeChannelID); err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := tx.Save(&models.AppSetting{
			Key:       notificationTitleTemplateSettingKey,
			Value:     titleTemplate,
			UpdatedAt: now,
		}).Error; err != nil {
			return err
		}
		return tx.Save(&models.AppSetting{
			Key:       notificationMessageTemplateSettingKey,
			Value:     messageTemplate,
			UpdatedAt: now,
		}).Error
	}); err != nil {
		return NotificationSettings{}, err
	}

	return NotificationSettings{
		ActiveChannelID: activeChannelID,
		TitleTemplate:   titleTemplate,
		MessageTemplate: messageTemplate,
	}, nil
}

func RenderNotificationTemplate(template string, event NotificationEvent, fallback string) string {
	template = strings.TrimSpace(template)
	if template == "" {
		template = fallback
	}
	values := map[string]string{
		"node_name":            event.NodeName,
		"komari_node_uuid":     event.KomariNodeUUID,
		"target_ip":            event.TargetIP,
		"field_id":             event.FieldID,
		"field_label":          event.FieldLabel,
		"field_path":           strings.Join(append(append([]string{}, event.GroupPath...), event.FieldLabel), " / "),
		"previous_value":       event.PreviousValue,
		"current_value":        event.CurrentValue,
		"previous_recorded_at": event.PreviousRecorded,
		"recorded_at":          event.RecordedAt.Format(time.RFC3339),
		"detail_url":           event.DetailURL,
		"compare_url":          event.CompareURL,
		"title":                buildNotificationTitle(event),
		"message":              buildNotificationMessage(event),
	}
	rendered := template
	for key, value := range values {
		rendered = strings.ReplaceAll(rendered, "{{"+key+"}}", value)
	}
	return rendered
}

func getTextSetting(db *gorm.DB, key string, fallback string) string {
	if db == nil {
		return fallback
	}
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", key).Error; err != nil {
		if isMissingTableErr(err) {
			return fallback
		}
		return fallback
	}
	value := strings.TrimSpace(setting.Value)
	if value == "" {
		return fallback
	}
	return value
}

func getOptionalUintSetting(db *gorm.DB, key string) (*uint, error) {
	if db == nil {
		return nil, nil
	}
	var setting models.AppSetting
	if err := db.First(&setting, "key = ?", key).Error; err != nil {
		if isMissingTableErr(err) || errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	value := strings.TrimSpace(setting.Value)
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil || parsed == 0 {
		return nil, nil
	}
	result := uint(parsed)
	return &result, nil
}

func setOptionalUintSetting(db *gorm.DB, key string, value *uint) error {
	now := time.Now().UTC()
	if value == nil || *value == 0 {
		return db.Save(&models.AppSetting{
			Key:       key,
			Value:     "",
			UpdatedAt: now,
		}).Error
	}
	return db.Save(&models.AppSetting{
		Key:       key,
		Value:     strconv.FormatUint(uint64(*value), 10),
		UpdatedAt: now,
	}).Error
}
