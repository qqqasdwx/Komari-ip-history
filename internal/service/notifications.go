package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"github.com/dop251/goja"
	"gorm.io/gorm"
)

const (
	notificationSettingsKey = "notification_settings"

	NotificationChannelTelegram   = "telegram"
	NotificationChannelWebhook    = "webhook"
	NotificationChannelJavaScript = "javascript"

	NotificationDeliverySuccess = "success"
	NotificationDeliveryFailed  = "failed"

	notificationDefaultTitleTemplate = ""
	notificationDefaultBodyTemplate  = "节点：{{node_name}}\n目标 IP：{{target_ip}}\n字段：{{field_label}}\n旧值：{{old_value}}\n新值：{{new_value}}\n记录时间：{{recorded_at}}\n详情：{{detail_url}}\n对比：{{compare_url}}"
	notificationSenderTimeout        = 3 * time.Second
)

type NotificationSettings struct {
	Enabled         bool   `json:"enabled"`
	ActiveChannelID *uint  `json:"active_channel_id"`
	TitleTemplate   string `json:"title_template"`
	BodyTemplate    string `json:"body_template"`
}

type NotificationChannelInput struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`
	Enabled bool              `json:"enabled"`
	Config  map[string]string `json:"config"`
}

type NotificationChannelUpdateInput struct {
	Name    *string            `json:"name"`
	Type    *string            `json:"type"`
	Enabled *bool              `json:"enabled"`
	Config  *map[string]string `json:"config"`
}

type NotificationChannelItem struct {
	ID        uint              `json:"id"`
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	Enabled   bool              `json:"enabled"`
	Config    map[string]string `json:"config"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type NotificationRuleInput struct {
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	ChannelID uint   `json:"channel_id"`
	NodeUUID  string `json:"node_uuid"`
	TargetIP  string `json:"target_ip"`
	FieldID   string `json:"field_id"`
}

type NotificationRuleUpdateInput struct {
	Name      *string `json:"name"`
	Enabled   *bool   `json:"enabled"`
	ChannelID *uint   `json:"channel_id"`
	NodeUUID  *string `json:"node_uuid"`
	TargetIP  *string `json:"target_ip"`
	FieldID   *string `json:"field_id"`
}

type NotificationRuleItem struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	Enabled     bool      `json:"enabled"`
	ChannelID   uint      `json:"channel_id"`
	ChannelName string    `json:"channel_name"`
	ChannelType string    `json:"channel_type"`
	NodeUUID    string    `json:"node_uuid"`
	TargetIP    string    `json:"target_ip"`
	FieldID     string    `json:"field_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type NotificationDeliveryLogItem struct {
	ID            uint      `json:"id"`
	ChannelID     *uint     `json:"channel_id"`
	RuleID        *uint     `json:"rule_id"`
	ChannelName   string    `json:"channel_name"`
	ChannelType   string    `json:"channel_type"`
	RuleName      string    `json:"rule_name"`
	Status        string    `json:"status"`
	Error         string    `json:"error"`
	Title         string    `json:"title"`
	Body          string    `json:"body"`
	NodeUUID      string    `json:"node_uuid"`
	NodeName      string    `json:"node_name"`
	TargetIP      string    `json:"target_ip"`
	FieldID       string    `json:"field_id"`
	FieldLabel    string    `json:"field_label"`
	PreviousValue string    `json:"previous_value"`
	CurrentValue  string    `json:"current_value"`
	RecordedAt    time.Time `json:"recorded_at"`
	DetailURL     string    `json:"detail_url"`
	CompareURL    string    `json:"compare_url"`
	CreatedAt     time.Time `json:"created_at"`
}

type NotificationDeliveryLogPage struct {
	Items      []NotificationDeliveryLogItem `json:"items"`
	Total      int64                         `json:"total"`
	Page       int                           `json:"page"`
	PageSize   int                           `json:"page_size"`
	TotalPages int                           `json:"total_pages"`
}

type notificationChangeEvent struct {
	NodeUUID         string
	NodeName         string
	TargetID         uint
	TargetIP         string
	FieldID          string
	FieldLabel       string
	FieldOptionLabel string
	PreviousValue    DisplayFieldValue
	CurrentValue     DisplayFieldValue
	RecordedAt       time.Time
	DetailURL        string
	CompareURL       string
}

type notificationRenderedMessage struct {
	Title   string
	Body    string
	Context map[string]any
	Event   notificationChangeEvent
}

func GetNotificationSettings(db *gorm.DB) (NotificationSettings, error) {
	settings := defaultNotificationSettings()
	var stored models.AppSetting
	if err := db.First(&stored, "key = ?", notificationSettingsKey).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return settings, nil
		}
		return NotificationSettings{}, err
	}
	if err := json.Unmarshal([]byte(stored.Value), &settings); err != nil {
		return defaultNotificationSettings(), nil
	}
	settings.TitleTemplate = strings.TrimSpace(settings.TitleTemplate)
	if strings.TrimSpace(settings.BodyTemplate) == "" {
		settings.BodyTemplate = notificationDefaultBodyTemplate
	}
	return settings, nil
}

func SetNotificationSettings(db *gorm.DB, settings NotificationSettings) (NotificationSettings, error) {
	settings.TitleTemplate = strings.TrimSpace(settings.TitleTemplate)
	if strings.TrimSpace(settings.BodyTemplate) == "" {
		settings.BodyTemplate = notificationDefaultBodyTemplate
	}
	if settings.ActiveChannelID != nil {
		if *settings.ActiveChannelID == 0 {
			settings.ActiveChannelID = nil
		} else if err := ensureNotificationChannelExists(db, *settings.ActiveChannelID); err != nil {
			return NotificationSettings{}, err
		}
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return NotificationSettings{}, err
	}
	if err := db.Save(&models.AppSetting{
		Key:       notificationSettingsKey,
		Value:     string(raw),
		UpdatedAt: time.Now().UTC(),
	}).Error; err != nil {
		return NotificationSettings{}, err
	}
	return settings, nil
}

func ListNotificationChannels(db *gorm.DB) ([]NotificationChannelItem, error) {
	var channels []models.NotificationChannel
	if err := db.Order("created_at DESC").Find(&channels).Error; err != nil {
		return nil, err
	}
	items := make([]NotificationChannelItem, 0, len(channels))
	for _, channel := range channels {
		items = append(items, notificationChannelItem(channel))
	}
	return items, nil
}

func CreateNotificationChannel(db *gorm.DB, input NotificationChannelInput) (NotificationChannelItem, error) {
	name, err := normalizeNotificationName(input.Name)
	if err != nil {
		return NotificationChannelItem{}, err
	}
	channelType, err := normalizeNotificationChannelType(input.Type)
	if err != nil {
		return NotificationChannelItem{}, err
	}
	config, err := normalizeNotificationChannelConfig(channelType, input.Config)
	if err != nil {
		return NotificationChannelItem{}, err
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return NotificationChannelItem{}, err
	}
	channel := models.NotificationChannel{
		Name:       name,
		Type:       channelType,
		Enabled:    input.Enabled,
		ConfigJSON: string(raw),
	}
	if err := db.Select("Name", "Type", "Enabled", "ConfigJSON").Create(&channel).Error; err != nil {
		return NotificationChannelItem{}, err
	}
	if err := db.Model(&channel).Update("enabled", input.Enabled).Error; err != nil {
		return NotificationChannelItem{}, err
	}
	channel.Enabled = input.Enabled
	return notificationChannelItem(channel), nil
}

func UpdateNotificationChannel(db *gorm.DB, id uint, input NotificationChannelUpdateInput) (NotificationChannelItem, error) {
	if id == 0 {
		return NotificationChannelItem{}, gorm.ErrRecordNotFound
	}
	var channel models.NotificationChannel
	if err := db.First(&channel, id).Error; err != nil {
		return NotificationChannelItem{}, err
	}
	updates := map[string]any{}
	channelType := channel.Type
	if input.Type != nil {
		normalizedType, err := normalizeNotificationChannelType(*input.Type)
		if err != nil {
			return NotificationChannelItem{}, err
		}
		channelType = normalizedType
		updates["type"] = normalizedType
	}
	if input.Name != nil {
		name, err := normalizeNotificationName(*input.Name)
		if err != nil {
			return NotificationChannelItem{}, err
		}
		updates["name"] = name
	}
	if input.Enabled != nil {
		updates["enabled"] = *input.Enabled
	}
	if input.Config != nil {
		config, err := normalizeNotificationChannelConfig(channelType, *input.Config)
		if err != nil {
			return NotificationChannelItem{}, err
		}
		raw, err := json.Marshal(config)
		if err != nil {
			return NotificationChannelItem{}, err
		}
		updates["config_json"] = string(raw)
	}
	if len(updates) > 0 {
		if err := db.Model(&channel).Updates(updates).Error; err != nil {
			return NotificationChannelItem{}, err
		}
	}
	if err := db.First(&channel, id).Error; err != nil {
		return NotificationChannelItem{}, err
	}
	return notificationChannelItem(channel), nil
}

func DeleteNotificationChannel(db *gorm.DB, id uint) error {
	if id == 0 {
		return gorm.ErrRecordNotFound
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("channel_id = ?", id).Delete(&models.NotificationRule{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&models.NotificationChannel{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		settings, err := GetNotificationSettings(tx)
		if err != nil {
			return err
		}
		if settings.ActiveChannelID != nil && *settings.ActiveChannelID == id {
			settings.ActiveChannelID = nil
			if _, err := SetNotificationSettings(tx, settings); err != nil {
				return err
			}
		}
		return nil
	})
}

func TestNotificationChannel(db *gorm.DB, id uint) (NotificationDeliveryLogItem, error) {
	var channel models.NotificationChannel
	if err := db.First(&channel, id).Error; err != nil {
		return NotificationDeliveryLogItem{}, err
	}
	event := notificationChangeEvent{
		NodeUUID:         "test-node",
		NodeName:         "测试节点",
		TargetID:         1,
		TargetIP:         "203.0.113.10",
		FieldID:          "info.organization",
		FieldLabel:       "组织",
		FieldOptionLabel: "基础信息 / 组织",
		PreviousValue:    DisplayFieldValue{ID: "info.organization", Label: "组织", Text: "旧值", Tone: "neutral"},
		CurrentValue:     DisplayFieldValue{ID: "info.organization", Label: "组织", Text: "新值", Tone: "good"},
		RecordedAt:       time.Now().UTC(),
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return NotificationDeliveryLogItem{}, err
	}
	message := renderNotificationMessage(settings, event)
	log := deliverNotificationMessage(db, channel, nil, message)
	return notificationDeliveryLogItem(log), nil
}

func ListNotificationRules(db *gorm.DB) ([]NotificationRuleItem, error) {
	var rules []models.NotificationRule
	if err := db.Preload("Channel").Order("created_at DESC").Find(&rules).Error; err != nil {
		return nil, err
	}
	items := make([]NotificationRuleItem, 0, len(rules))
	for _, rule := range rules {
		items = append(items, notificationRuleItem(rule))
	}
	return items, nil
}

func CreateNotificationRule(db *gorm.DB, input NotificationRuleInput) (NotificationRuleItem, error) {
	rule, err := buildNotificationRule(db, input)
	if err != nil {
		return NotificationRuleItem{}, err
	}
	if err := db.Select("Name", "Enabled", "ChannelID", "NodeUUID", "TargetIP", "FieldID").Create(&rule).Error; err != nil {
		return NotificationRuleItem{}, err
	}
	if err := db.Model(&rule).Update("enabled", input.Enabled).Error; err != nil {
		return NotificationRuleItem{}, err
	}
	rule.Enabled = input.Enabled
	if err := db.Preload("Channel").First(&rule, rule.ID).Error; err != nil {
		return NotificationRuleItem{}, err
	}
	return notificationRuleItem(rule), nil
}

func UpdateNotificationRule(db *gorm.DB, id uint, input NotificationRuleUpdateInput) (NotificationRuleItem, error) {
	if id == 0 {
		return NotificationRuleItem{}, gorm.ErrRecordNotFound
	}
	var rule models.NotificationRule
	if err := db.First(&rule, id).Error; err != nil {
		return NotificationRuleItem{}, err
	}
	updates := map[string]any{}
	if input.Name != nil {
		name, err := normalizeNotificationName(*input.Name)
		if err != nil {
			return NotificationRuleItem{}, err
		}
		updates["name"] = name
	}
	if input.Enabled != nil {
		updates["enabled"] = *input.Enabled
	}
	if input.ChannelID != nil {
		if err := ensureNotificationChannelExists(db, *input.ChannelID); err != nil {
			return NotificationRuleItem{}, err
		}
		updates["channel_id"] = *input.ChannelID
	}
	if input.NodeUUID != nil {
		updates["node_uuid"] = strings.TrimSpace(*input.NodeUUID)
	}
	if input.TargetIP != nil {
		targetIP, err := normalizeOptionalNotificationTargetIP(*input.TargetIP)
		if err != nil {
			return NotificationRuleItem{}, err
		}
		updates["target_ip"] = targetIP
	}
	if input.FieldID != nil {
		updates["field_id"] = normalizeNotificationFieldID(*input.FieldID)
	}
	if len(updates) > 0 {
		if err := db.Model(&rule).Updates(updates).Error; err != nil {
			return NotificationRuleItem{}, err
		}
	}
	if err := db.Preload("Channel").First(&rule, id).Error; err != nil {
		return NotificationRuleItem{}, err
	}
	return notificationRuleItem(rule), nil
}

func DeleteNotificationRule(db *gorm.DB, id uint) error {
	if id == 0 {
		return gorm.ErrRecordNotFound
	}
	result := db.Delete(&models.NotificationRule{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func ListNotificationDeliveryLogs(db *gorm.DB, page, pageSize int, status string) (NotificationDeliveryLogPage, error) {
	page = normalizeHistoryPage(page)
	pageSize = normalizeHistoryPageSize(0, pageSize)
	status, err := normalizeNotificationDeliveryStatusFilter(status)
	if err != nil {
		return NotificationDeliveryLogPage{}, err
	}
	query := db.Model(&models.NotificationDeliveryLog{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return NotificationDeliveryLogPage{}, err
	}
	var logs []models.NotificationDeliveryLog
	if err := query.Order("created_at DESC").Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs).Error; err != nil {
		return NotificationDeliveryLogPage{}, err
	}
	items := make([]NotificationDeliveryLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, notificationDeliveryLogItem(log))
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	return NotificationDeliveryLogPage{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func ClearNotificationDeliveryLogs(db *gorm.DB) error {
	return db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.NotificationDeliveryLog{}).Error
}

func TriggerNotificationsForHistory(db *gorm.DB, historyID uint) error {
	return triggerNotificationsForHistory(db, historyID, "")
}

func triggerNotificationsForHistory(db *gorm.DB, historyID uint, cfgPublicBaseURL string) error {
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	events, err := buildNotificationEventsForHistory(db, historyID, cfgPublicBaseURL)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}
	activeChannel, err := getActiveNotificationChannel(db, settings)
	if err != nil {
		return err
	}
	var rules []models.NotificationRule
	if err := db.Preload("Channel").Where("enabled = ?", true).Find(&rules).Error; err != nil {
		return err
	}
	for _, event := range events {
		for _, rule := range rules {
			if !notificationRuleMatches(rule, event) {
				continue
			}
			channel := rule.Channel
			if activeChannel != nil {
				channel = *activeChannel
			}
			if channel.ID == 0 {
				continue
			}
			message := renderNotificationMessage(settings, event)
			deliverNotificationMessage(db, channel, &rule, message)
		}
	}
	return nil
}

func buildNotificationEventsForHistory(db *gorm.DB, historyID uint, cfgPublicBaseURL string) ([]notificationChangeEvent, error) {
	var history models.NodeTargetHistory
	if err := db.Preload("NodeTarget").Preload("NodeTarget.Node").First(&history, historyID).Error; err != nil {
		return nil, err
	}
	target := history.NodeTarget
	node := target.Node

	var previous models.NodeTargetHistory
	previousErr := db.Where(
		"node_target_id = ? AND (recorded_at < ? OR (recorded_at = ? AND id < ?))",
		history.NodeTargetID,
		history.RecordedAt,
		history.RecordedAt,
		history.ID,
	).Order("recorded_at DESC").Order("id DESC").First(&previous).Error
	if previousErr != nil && !errors.Is(previousErr, gorm.ErrRecordNotFound) {
		return nil, previousErr
	}

	currentValues, err := extractDisplayFieldValues(decodeResultJSON(history.ResultJSON))
	if err != nil {
		return nil, err
	}
	currentMap := displayFieldValueMap(currentValues)
	previousMap := map[string]DisplayFieldValue{}
	if previousErr == nil {
		previousValues, err := extractDisplayFieldValues(decodeResultJSON(previous.ResultJSON))
		if err != nil {
			return nil, err
		}
		previousMap = displayFieldValueMap(previousValues)
	}

	ids := unionFieldIDs(previousMap, currentMap)
	links := notificationLinks(db, cfgPublicBaseURL, node, target)
	events := make([]notificationChangeEvent, 0, len(ids))
	for _, id := range ids {
		if shouldIgnoreHistoryEventField(id) {
			continue
		}
		currentValue, currentOK := currentMap[id]
		previousValue, previousOK := previousMap[id]
		if !currentOK && !previousOK {
			continue
		}
		if !previousOK {
			previousValue = buildMissingDisplayFieldLike(currentValue)
		}
		if !currentOK {
			currentValue = buildMissingDisplayFieldLike(previousValue)
		}
		if compareDisplayFieldValues(previousValue, currentValue) {
			continue
		}
		events = append(events, notificationChangeEvent{
			NodeUUID:         nodeRouteUUID(node),
			NodeName:         node.Name,
			TargetID:         target.ID,
			TargetIP:         target.TargetIP,
			FieldID:          id,
			FieldLabel:       currentValue.Label,
			FieldOptionLabel: buildDisplayFieldOptionLabel(currentValue),
			PreviousValue:    previousValue,
			CurrentValue:     currentValue,
			RecordedAt:       history.RecordedAt,
			DetailURL:        links.detailURL,
			CompareURL:       links.compareURL,
		})
	}
	sort.Slice(events, func(i, j int) bool {
		return strings.Compare(events[i].FieldID, events[j].FieldID) < 0
	})
	return events, nil
}

func deliverNotificationMessage(db *gorm.DB, channel models.NotificationChannel, rule *models.NotificationRule, message notificationRenderedMessage) models.NotificationDeliveryLog {
	status := NotificationDeliverySuccess
	errorMessage := ""
	if err := sendNotificationMessage(channel, message); err != nil {
		status = NotificationDeliveryFailed
		errorMessage = err.Error()
	}
	log := models.NotificationDeliveryLog{
		ChannelID:     &channel.ID,
		ChannelName:   channel.Name,
		ChannelType:   channel.Type,
		Status:        status,
		Error:         errorMessage,
		Title:         message.Title,
		Body:          message.Body,
		NodeUUID:      message.Event.NodeUUID,
		NodeName:      message.Event.NodeName,
		TargetIP:      message.Event.TargetIP,
		FieldID:       message.Event.FieldID,
		FieldLabel:    message.Event.FieldLabel,
		PreviousValue: message.Event.PreviousValue.Text,
		CurrentValue:  message.Event.CurrentValue.Text,
		RecordedAt:    message.Event.RecordedAt,
		DetailURL:     message.Event.DetailURL,
		CompareURL:    message.Event.CompareURL,
		CreatedAt:     time.Now().UTC(),
	}
	if rule != nil {
		log.RuleID = &rule.ID
		log.RuleName = rule.Name
	}
	if err := db.Create(&log).Error; err != nil {
		log.Error = strings.TrimSpace(log.Error + " log error: " + err.Error())
	}
	return log
}

func sendNotificationMessage(channel models.NotificationChannel, message notificationRenderedMessage) error {
	config := decodeNotificationChannelConfig(channel.ConfigJSON)
	switch channel.Type {
	case NotificationChannelTelegram:
		return sendTelegramNotification(config, message)
	case NotificationChannelWebhook:
		return sendWebhookNotification(config, message)
	case NotificationChannelJavaScript:
		return sendJavaScriptNotification(config, message)
	default:
		return fmt.Errorf("unsupported channel type: %s", channel.Type)
	}
}

func sendTelegramNotification(config map[string]string, message notificationRenderedMessage) error {
	botToken := strings.TrimSpace(config["bot_token"])
	chatID := strings.TrimSpace(config["chat_id"])
	apiURL := strings.TrimSpace(config["api_url"])
	if apiURL == "" {
		endpoint := strings.TrimRight(strings.TrimSpace(config["endpoint"]), "/")
		if endpoint == "" {
			endpoint = "https://api.telegram.org/bot"
		}
		if botToken == "" {
			return errors.New("telegram bot token is required")
		}
		apiURL = endpoint + url.PathEscape(botToken) + "/sendMessage"
	}
	if chatID == "" {
		return errors.New("telegram chat id is required")
	}
	payload := map[string]any{
		"chat_id": chatID,
		"text":    strings.TrimSpace(message.Body),
	}
	if messageThreadID := strings.TrimSpace(config["message_thread_id"]); messageThreadID != "" {
		payload["message_thread_id"] = messageThreadID
	}
	return postJSON(apiURL, nil, payload)
}

func sendWebhookNotification(config map[string]string, message notificationRenderedMessage) error {
	webhookURL := strings.TrimSpace(config["url"])
	if webhookURL == "" {
		return errors.New("webhook url is required")
	}
	method := strings.ToUpper(strings.TrimSpace(config["method"]))
	if method == "" {
		method = http.MethodPost
	}
	if method != http.MethodPost && method != http.MethodGet {
		return errors.New("webhook method must be GET or POST")
	}
	headers := map[string]string{}
	rawHeaders := strings.TrimSpace(config["headers_json"])
	if rawHeaders == "" {
		rawHeaders = strings.TrimSpace(config["headers"])
	}
	if rawHeaders != "" {
		if err := json.Unmarshal([]byte(rawHeaders), &headers); err != nil {
			return errors.New("webhook headers must be a JSON object")
		}
	}
	contentType := strings.TrimSpace(config["content_type"])
	if contentType == "" {
		contentType = "application/json"
	}
	bodyTemplate := strings.TrimSpace(config["body"])
	if bodyTemplate != "" {
		body := renderNotificationTemplate(bodyTemplate, notificationEventTemplateValues(message))
		return sendWebhookRequest(webhookURL, method, contentType, headers, config, strings.NewReader(body))
	}
	if method == http.MethodGet {
		return sendWebhookRequest(webhookURL, method, contentType, headers, config, nil)
	}
	raw, err := json.Marshal(message.Context)
	if err != nil {
		return err
	}
	return sendWebhookRequest(webhookURL, method, contentType, headers, config, bytes.NewReader(raw))
}

func sendJavaScriptNotification(config map[string]string, message notificationRenderedMessage) error {
	script := strings.TrimSpace(config["script"])
	if script == "" {
		return errors.New("javascript sender script is required")
	}
	if hasObviousUnboundedJavaScriptLoop(script) {
		return errors.New("javascript sender timeout: unbounded loop is not allowed")
	}
	ensureJavaScriptNotificationSchedulerCapacity()
	vm := goja.New()
	done := make(chan error, 1)
	go func() {
		done <- runJavaScriptNotification(vm, script, message)
	}()

	timer := time.NewTimer(notificationSenderTimeout)
	defer timer.Stop()

	select {
	case err := <-done:
		return err
	case <-timer.C:
		select {
		case err := <-done:
			return err
		default:
		}
		vm.Interrupt("javascript sender timeout")
		return errors.New("javascript sender timeout")
	}
}

func hasObviousUnboundedJavaScriptLoop(script string) bool {
	compact := strings.ToLower(strings.Join(strings.Fields(script), ""))
	return strings.Contains(compact, "while(true)") || strings.Contains(compact, "for(;;)")
}

func ensureJavaScriptNotificationSchedulerCapacity() {
	if runtime.GOMAXPROCS(0) < 2 {
		// A tight user script can occupy a single Go scheduler P long enough to delay timers.
		runtime.GOMAXPROCS(2)
	}
}

func runJavaScriptNotification(vm *goja.Runtime, script string, message notificationRenderedMessage) error {
	if _, err := vm.RunString(script); err != nil {
		return err
	}
	if sendEvent, ok := goja.AssertFunction(vm.Get("sendEvent")); ok {
		result, err := sendEvent(goja.Undefined(), vm.ToValue(notificationEventPayload(message)))
		if err != nil {
			return err
		}
		return validateJavaScriptNotificationResult(result.Export())
	}
	if sendMessage, ok := goja.AssertFunction(vm.Get("sendMessage")); ok {
		result, err := sendMessage(goja.Undefined(), vm.ToValue(message.Body), vm.ToValue(message.Title))
		if err != nil {
			return err
		}
		return validateJavaScriptNotificationResult(result.Export())
	}
	send, ok := goja.AssertFunction(vm.Get("send"))
	if !ok {
		return errors.New("javascript sender must define send(input), sendMessage(message, title), or sendEvent(event)")
	}
	result, err := send(goja.Undefined(), vm.ToValue(map[string]any{
		"title":   message.Title,
		"body":    message.Body,
		"context": message.Context,
		"event":   notificationEventPayload(message),
	}))
	if err != nil {
		return err
	}
	return validateJavaScriptNotificationResult(result.Export())
}

func postJSON(endpoint string, headers map[string]string, payload any) error {
	ctx, cancel := context.WithTimeout(context.Background(), notificationSenderTimeout)
	defer cancel()
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		if strings.TrimSpace(key) == "" {
			continue
		}
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func renderNotificationMessage(settings NotificationSettings, event notificationChangeEvent) notificationRenderedMessage {
	contextValues := map[string]string{
		"node_uuid":          event.NodeUUID,
		"node_name":          event.NodeName,
		"target_id":          strconv.FormatUint(uint64(event.TargetID), 10),
		"target_ip":          event.TargetIP,
		"field_id":           event.FieldID,
		"field_label":        event.FieldLabel,
		"field_option_label": event.FieldOptionLabel,
		"old_value":          event.PreviousValue.Text,
		"new_value":          event.CurrentValue.Text,
		"old_tone":           event.PreviousValue.Tone,
		"new_tone":           event.CurrentValue.Tone,
		"recorded_at":        event.RecordedAt.Format(time.RFC3339),
		"detail_url":         event.DetailURL,
		"compare_url":        event.CompareURL,
	}
	title := ""
	body := renderNotificationTemplate(settings.BodyTemplate, contextValues)
	contextMap := make(map[string]any, len(contextValues))
	for key, value := range contextValues {
		contextMap[key] = value
	}
	return notificationRenderedMessage{
		Title:   title,
		Body:    body,
		Context: contextMap,
		Event:   event,
	}
}

func renderNotificationTemplate(template string, values map[string]string) string {
	result := template
	for key, value := range values {
		result = strings.ReplaceAll(result, "{{"+key+"}}", value)
	}
	return result
}

func notificationRuleMatches(rule models.NotificationRule, event notificationChangeEvent) bool {
	nodeUUID := strings.TrimSpace(rule.NodeUUID)
	if nodeUUID != "" && nodeUUID != event.NodeUUID {
		return false
	}
	targetIP := strings.TrimSpace(rule.TargetIP)
	if targetIP != "" && targetIP != event.TargetIP {
		return false
	}
	fieldID := normalizeNotificationFieldID(rule.FieldID)
	return fieldID == "" || fieldID == event.FieldID
}

func notificationLinks(db *gorm.DB, cfgPublicBaseURL string, node models.Node, target models.NodeTarget) struct {
	detailURL  string
	compareURL string
} {
	integration, err := GetIntegrationSettings(db, cfgPublicBaseURL)
	if err != nil {
		return struct {
			detailURL  string
			compareURL string
		}{}
	}
	baseURL := strings.TrimRight(integration.EffectivePublicBaseURL, "/")
	if baseURL == "" {
		return struct {
			detailURL  string
			compareURL string
		}{}
	}
	routeUUID := url.PathEscape(nodeRouteUUID(node))
	targetID := strconv.FormatUint(uint64(target.ID), 10)
	return struct {
		detailURL  string
		compareURL string
	}{
		detailURL:  baseURL + "/#/nodes/" + routeUUID + "?target_id=" + targetID,
		compareURL: baseURL + "/#/nodes/" + routeUUID + "/snapshots?target_id=" + targetID,
	}
}

func displayFieldValueMap(values []DisplayFieldValue) map[string]DisplayFieldValue {
	items := make(map[string]DisplayFieldValue, len(values))
	for _, value := range values {
		items[value.ID] = value
	}
	return items
}

func buildNotificationRule(db *gorm.DB, input NotificationRuleInput) (models.NotificationRule, error) {
	name, err := normalizeNotificationName(input.Name)
	if err != nil {
		return models.NotificationRule{}, err
	}
	channelID := input.ChannelID
	if channelID == 0 {
		settings, err := GetNotificationSettings(db)
		if err != nil {
			return models.NotificationRule{}, err
		}
		if settings.ActiveChannelID != nil {
			channelID = *settings.ActiveChannelID
		}
	}
	if err := ensureNotificationChannelExists(db, channelID); err != nil {
		return models.NotificationRule{}, err
	}
	targetIP, err := normalizeOptionalNotificationTargetIP(input.TargetIP)
	if err != nil {
		return models.NotificationRule{}, err
	}
	return models.NotificationRule{
		Name:      name,
		Enabled:   input.Enabled,
		ChannelID: channelID,
		NodeUUID:  strings.TrimSpace(input.NodeUUID),
		TargetIP:  targetIP,
		FieldID:   normalizeNotificationFieldID(input.FieldID),
	}, nil
}

func ensureNotificationChannelExists(db *gorm.DB, channelID uint) error {
	if channelID == 0 {
		return errors.New("current notification channel is required")
	}
	var count int64
	if err := db.Model(&models.NotificationChannel{}).Where("id = ?", channelID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func getActiveNotificationChannel(db *gorm.DB, settings NotificationSettings) (*models.NotificationChannel, error) {
	if settings.ActiveChannelID == nil || *settings.ActiveChannelID == 0 {
		return nil, nil
	}
	var channel models.NotificationChannel
	if err := db.First(&channel, *settings.ActiveChannelID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &channel, nil
}

func normalizeNotificationName(name string) (string, error) {
	value := strings.TrimSpace(name)
	if value == "" {
		return "", errors.New("name is required")
	}
	if len([]rune(value)) > 128 {
		return "", errors.New("name is too long")
	}
	return value, nil
}

func normalizeNotificationChannelType(channelType string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(channelType))
	switch value {
	case NotificationChannelTelegram, NotificationChannelWebhook, NotificationChannelJavaScript:
		return value, nil
	default:
		return "", errors.New("unsupported channel type")
	}
}

func normalizeNotificationChannelConfig(channelType string, config map[string]string) (map[string]string, error) {
	if config == nil {
		config = map[string]string{}
	}
	normalized := make(map[string]string, len(config))
	for key, value := range config {
		normalized[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	switch channelType {
	case NotificationChannelTelegram:
		if normalized["api_url"] == "" && normalized["bot_token"] == "" {
			return nil, errors.New("telegram bot token is required")
		}
		if normalized["chat_id"] == "" {
			return nil, errors.New("telegram chat id is required")
		}
	case NotificationChannelWebhook:
		if normalized["url"] == "" {
			return nil, errors.New("webhook url is required")
		}
		if _, err := url.ParseRequestURI(normalized["url"]); err != nil {
			return nil, errors.New("webhook url is invalid")
		}
		rawHeaders := normalized["headers_json"]
		if rawHeaders == "" {
			rawHeaders = normalized["headers"]
		}
		if rawHeaders != "" {
			headers := map[string]string{}
			if err := json.Unmarshal([]byte(rawHeaders), &headers); err != nil {
				return nil, errors.New("webhook headers must be a JSON object")
			}
		}
		method := strings.ToUpper(normalized["method"])
		if method != "" && method != http.MethodPost && method != http.MethodGet {
			return nil, errors.New("webhook method must be GET or POST")
		}
	case NotificationChannelJavaScript:
		if normalized["script"] == "" {
			return nil, errors.New("javascript sender script is required")
		}
	}
	return normalized, nil
}

func normalizeNotificationDeliveryStatusFilter(raw string) (string, error) {
	status := strings.TrimSpace(strings.ToLower(raw))
	if status == "" {
		return "", nil
	}
	switch status {
	case NotificationDeliverySuccess, NotificationDeliveryFailed:
		return status, nil
	default:
		return "", errors.New("notification delivery status filter is invalid")
	}
}

func normalizeOptionalNotificationTargetIP(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	return normalizeTargetIP(value)
}

func normalizeNotificationFieldID(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

func defaultNotificationSettings() NotificationSettings {
	return NotificationSettings{
		Enabled:       false,
		TitleTemplate: notificationDefaultTitleTemplate,
		BodyTemplate:  notificationDefaultBodyTemplate,
	}
}

func notificationChannelItem(channel models.NotificationChannel) NotificationChannelItem {
	return NotificationChannelItem{
		ID:        channel.ID,
		Name:      channel.Name,
		Type:      channel.Type,
		Enabled:   channel.Enabled,
		Config:    decodeNotificationChannelConfig(channel.ConfigJSON),
		CreatedAt: channel.CreatedAt,
		UpdatedAt: channel.UpdatedAt,
	}
}

func notificationRuleItem(rule models.NotificationRule) NotificationRuleItem {
	return NotificationRuleItem{
		ID:          rule.ID,
		Name:        rule.Name,
		Enabled:     rule.Enabled,
		ChannelID:   rule.ChannelID,
		ChannelName: rule.Channel.Name,
		ChannelType: rule.Channel.Type,
		NodeUUID:    rule.NodeUUID,
		TargetIP:    rule.TargetIP,
		FieldID:     rule.FieldID,
		CreatedAt:   rule.CreatedAt,
		UpdatedAt:   rule.UpdatedAt,
	}
}

func notificationDeliveryLogItem(log models.NotificationDeliveryLog) NotificationDeliveryLogItem {
	return NotificationDeliveryLogItem{
		ID:            log.ID,
		ChannelID:     log.ChannelID,
		RuleID:        log.RuleID,
		ChannelName:   log.ChannelName,
		ChannelType:   log.ChannelType,
		RuleName:      log.RuleName,
		Status:        log.Status,
		Error:         log.Error,
		Title:         log.Title,
		Body:          log.Body,
		NodeUUID:      log.NodeUUID,
		NodeName:      log.NodeName,
		TargetIP:      log.TargetIP,
		FieldID:       log.FieldID,
		FieldLabel:    log.FieldLabel,
		PreviousValue: log.PreviousValue,
		CurrentValue:  log.CurrentValue,
		RecordedAt:    log.RecordedAt,
		DetailURL:     log.DetailURL,
		CompareURL:    log.CompareURL,
		CreatedAt:     log.CreatedAt,
	}
}

func sendWebhookRequest(endpoint string, method string, contentType string, headers map[string]string, config map[string]string, body io.Reader) error {
	ctx, cancel := context.WithTimeout(context.Background(), notificationSenderTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", contentType)
	}
	for key, value := range headers {
		if strings.TrimSpace(key) == "" {
			continue
		}
		req.Header.Set(key, value)
	}
	username := strings.TrimSpace(config["username"])
	password := strings.TrimSpace(config["password"])
	if username != "" || password != "" {
		req.SetBasicAuth(username, password)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func notificationEventTemplateValues(message notificationRenderedMessage) map[string]string {
	values := make(map[string]string, len(message.Context))
	for key, value := range message.Context {
		values[key] = fmt.Sprint(value)
	}
	return values
}

func notificationEventPayload(message notificationRenderedMessage) map[string]any {
	values := map[string]any{
		"title":   message.Title,
		"body":    message.Body,
		"message": strings.TrimSpace(message.Title + "\n\n" + message.Body),
	}
	for key, value := range message.Context {
		values[key] = value
	}
	return values
}

func validateJavaScriptNotificationResult(exported any) error {
	if exported == nil {
		return nil
	}
	if promise, ok := exported.(*goja.Promise); ok {
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			return validateJavaScriptNotificationResult(promise.Result().Export())
		case goja.PromiseStateRejected:
			return fmt.Errorf("%v", promise.Result())
		default:
			return errors.New("javascript sender returned pending promise")
		}
	}
	if resultMap, ok := exported.(map[string]any); ok {
		if okValue, exists := resultMap["ok"]; exists && !truthyNotificationResult(okValue) {
			if messageValue, hasMessage := resultMap["message"]; hasMessage {
				return fmt.Errorf("%v", messageValue)
			}
			return errors.New("javascript sender returned ok=false")
		}
	}
	return nil
}

func decodeNotificationChannelConfig(raw string) map[string]string {
	config := map[string]string{}
	_ = json.Unmarshal([]byte(raw), &config)
	if config == nil {
		return map[string]string{}
	}
	return config
}

func truthyNotificationResult(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.TrimSpace(strings.ToLower(typed)) != "false" && strings.TrimSpace(typed) != ""
	case float64:
		return typed != 0
	case int64:
		return typed != 0
	default:
		return value != nil
	}
}
