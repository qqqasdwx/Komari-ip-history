package service

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

type NotificationProviderField struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Required bool     `json:"required,omitempty"`
	Default  string   `json:"default,omitempty"`
	Options  []string `json:"options,omitempty"`
	Help     string   `json:"help,omitempty"`
}

type NotificationProviderDefinition struct {
	Type   string                      `json:"type"`
	Fields []NotificationProviderField `json:"fields"`
}

type NotificationChannelPayload struct {
	Name    string         `json:"name"`
	Type    string         `json:"type"`
	Enabled bool           `json:"enabled"`
	Config  map[string]any `json:"config"`
}

type NotificationChannelDetail struct {
	ID       uint           `json:"id"`
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Enabled  bool           `json:"enabled"`
	IsActive bool           `json:"is_active"`
	Config   map[string]any `json:"config"`
}

type NotificationRuleNodeScopePayload struct {
	NodeID     uint   `json:"node_id"`
	AllTargets bool   `json:"all_targets"`
	TargetIDs  []uint `json:"target_ids"`
}

type NotificationRulePayload struct {
	FieldID    string                             `json:"field_id"`
	AllNodes   bool                               `json:"all_nodes"`
	NodeScopes []NotificationRuleNodeScopePayload `json:"node_scopes"`
	Enabled    bool                               `json:"enabled"`
}

type NotificationRuleTargetDetail struct {
	TargetID uint   `json:"target_id"`
	TargetIP string `json:"target_ip"`
}

type NotificationRuleNodeScopeDetail struct {
	ID         uint                           `json:"id"`
	NodeID     uint                           `json:"node_id"`
	NodeName   string                         `json:"node_name"`
	AllTargets bool                           `json:"all_targets"`
	Targets    []NotificationRuleTargetDetail `json:"targets"`
}

type NotificationRuleDetail struct {
	ID         uint                              `json:"id"`
	FieldID    string                            `json:"field_id"`
	AllNodes   bool                              `json:"all_nodes"`
	Enabled    bool                              `json:"enabled"`
	NodeScopes []NotificationRuleNodeScopeDetail `json:"node_scopes"`
	CreatedAt  time.Time                         `json:"created_at"`
	UpdatedAt  time.Time                         `json:"updated_at"`
}

type NotificationDeliveryDetail struct {
	ID              uint      `json:"id"`
	RuleID          uint      `json:"rule_id"`
	HistoryEntryID  uint      `json:"history_entry_id"`
	Status          string    `json:"status"`
	ResponseSummary string    `json:"response_summary"`
	CreatedAt       time.Time `json:"created_at"`
}

func NotificationProviderDefinitions() map[string]NotificationProviderDefinition {
	return map[string]NotificationProviderDefinition{
		"telegram": {
			Type: "telegram",
			Fields: []NotificationProviderField{
				{Name: "bot_token", Type: "text", Required: true},
				{Name: "chat_id", Type: "text", Required: true},
				{Name: "message_thread_id", Type: "text", Help: "Optional. Supergroup thread ID."},
				{Name: "endpoint", Type: "text", Required: true, Default: "https://api.telegram.org/bot"},
			},
		},
		"javascript": {
			Type: "javascript",
			Fields: []NotificationProviderField{
				{
					Name:     "script",
					Type:     "richtext",
					Required: true,
					Help:     "Implement sendMessage(message, title) and optionally sendEvent(event). Available APIs: fetch(), xhr(), console.log().",
				},
			},
		},
		"webhook": {
			Type: "webhook",
			Fields: []NotificationProviderField{
				{Name: "url", Type: "text", Required: true},
				{Name: "method", Type: "option", Default: "GET", Options: []string{"POST", "GET"}},
				{Name: "content_type", Type: "text", Default: "application/json"},
				{Name: "headers", Type: "text", Help: "HTTP headers in JSON format"},
				{Name: "body", Type: "text", Default: "{\"message\":\"{{message}}\"}"},
				{Name: "username", Type: "text"},
				{Name: "password", Type: "password"},
			},
		},
	}
}

func ListNotificationProviderDefinitions() []NotificationProviderDefinition {
	defs := NotificationProviderDefinitions()
	keys := make([]string, 0, len(defs))
	for key := range defs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	items := make([]NotificationProviderDefinition, 0, len(keys))
	for _, key := range keys {
		items = append(items, defs[key])
	}
	return items
}

func ListNotificationChannels(db *gorm.DB) ([]NotificationChannelDetail, error) {
	var channels []models.NotificationChannel
	if err := db.Order("created_at ASC").Find(&channels).Error; err != nil {
		return nil, err
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return nil, err
	}
	items := make([]NotificationChannelDetail, 0, len(channels))
	for _, channel := range channels {
		isActive := settings.ActiveChannelID != nil && *settings.ActiveChannelID == channel.ID
		items = append(items, NotificationChannelDetail{
			ID:       channel.ID,
			Name:     channel.Name,
			Type:     channel.Type,
			Enabled:  channel.Enabled,
			IsActive: isActive,
			Config:   decodeChannelConfig(channel.ConfigJSON),
		})
	}
	return items, nil
}

func GetNotificationChannel(db *gorm.DB, id uint) (NotificationChannelDetail, error) {
	if id == 0 {
		return NotificationChannelDetail{}, errors.New("channel id is required")
	}
	var channel models.NotificationChannel
	if err := db.First(&channel, "id = ?", id).Error; err != nil {
		return NotificationChannelDetail{}, err
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return NotificationChannelDetail{}, err
	}
	return NotificationChannelDetail{
		ID:       channel.ID,
		Name:     channel.Name,
		Type:     channel.Type,
		Enabled:  channel.Enabled,
		IsActive: settings.ActiveChannelID != nil && *settings.ActiveChannelID == channel.ID,
		Config:   decodeChannelConfig(channel.ConfigJSON),
	}, nil
}

func CreateNotificationChannel(db *gorm.DB, payload NotificationChannelPayload) (NotificationChannelDetail, error) {
	return saveNotificationChannel(db, nil, payload)
}

func UpdateNotificationChannel(db *gorm.DB, id uint, payload NotificationChannelPayload) (NotificationChannelDetail, error) {
	if id == 0 {
		return NotificationChannelDetail{}, errors.New("channel id is required")
	}
	return saveNotificationChannel(db, &id, payload)
}

func SetNotificationChannelEnabled(db *gorm.DB, id uint, enabled bool) (NotificationChannelDetail, error) {
	if id == 0 {
		return NotificationChannelDetail{}, errors.New("channel id is required")
	}
	var channel models.NotificationChannel
	if err := db.First(&channel, "id = ?", id).Error; err != nil {
		return NotificationChannelDetail{}, err
	}
	if err := db.Model(&channel).Update("enabled", enabled).Error; err != nil {
		return NotificationChannelDetail{}, err
	}
	return GetNotificationChannel(db, id)
}

func DeleteNotificationChannel(db *gorm.DB, id uint) error {
	if id == 0 {
		return errors.New("channel id is required")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		settings, err := GetNotificationSettings(tx)
		if err != nil {
			return err
		}
		if settings.ActiveChannelID != nil && *settings.ActiveChannelID == id {
			if _, err := SetNotificationSettings(tx, nil, settings.TitleTemplate, settings.MessageTemplate); err != nil {
				return err
			}
		}
		return tx.Delete(&models.NotificationChannel{}, "id = ?", id).Error
	})
}

func SetActiveNotificationChannel(db *gorm.DB, id uint) (NotificationSettings, error) {
	if id == 0 {
		return NotificationSettings{}, errors.New("channel id is required")
	}
	channel, err := GetNotificationChannel(db, id)
	if err != nil {
		return NotificationSettings{}, err
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		return NotificationSettings{}, err
	}
	if !channel.Enabled {
		return NotificationSettings{}, errors.New("notification channel disabled")
	}
	return SetNotificationSettings(db, &id, settings.TitleTemplate, settings.MessageTemplate)
}

func ListNotificationRules(db *gorm.DB) ([]NotificationRuleDetail, error) {
	var rules []models.NotificationRule
	if err := db.Order("created_at ASC").Find(&rules).Error; err != nil {
		return nil, err
	}
	items := make([]NotificationRuleDetail, 0, len(rules))
	for _, rule := range rules {
		detail, err := loadNotificationRuleDetail(db, rule)
		if err != nil {
			return nil, err
		}
		if !detail.AllNodes && len(detail.NodeScopes) == 0 {
			continue
		}
		items = append(items, detail)
	}
	return items, nil
}

func CreateNotificationRule(db *gorm.DB, payload NotificationRulePayload) (NotificationRuleDetail, error) {
	return saveNotificationRule(db, nil, payload)
}

func UpdateNotificationRule(db *gorm.DB, id uint, payload NotificationRulePayload) (NotificationRuleDetail, error) {
	if id == 0 {
		return NotificationRuleDetail{}, errors.New("rule id is required")
	}
	return saveNotificationRule(db, &id, payload)
}

func DeleteNotificationRule(db *gorm.DB, id uint) error {
	if id == 0 {
		return errors.New("rule id is required")
	}
	return db.Delete(&models.NotificationRule{}, "id = ?", id).Error
}

func ListNotificationDeliveries(db *gorm.DB, limit int, statusFilter string) ([]NotificationDeliveryDetail, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	query := db.Order("created_at DESC").Limit(limit)
	statusFilter = strings.TrimSpace(strings.ToLower(statusFilter))
	if statusFilter != "" {
		query = query.Where("status = ?", statusFilter)
	}
	var deliveries []models.NotificationDelivery
	if err := query.Find(&deliveries).Error; err != nil {
		return nil, err
	}
	items := make([]NotificationDeliveryDetail, 0, len(deliveries))
	for _, delivery := range deliveries {
		items = append(items, NotificationDeliveryDetail{
			ID:              delivery.ID,
			RuleID:          delivery.RuleID,
			HistoryEntryID:  delivery.HistoryEntryID,
			Status:          delivery.Status,
			ResponseSummary: delivery.ResponseSummary,
			CreatedAt:       delivery.CreatedAt,
		})
	}
	return items, nil
}

func ClearNotificationDeliveries(db *gorm.DB) error {
	return db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.NotificationDelivery{}).Error
}

func saveNotificationChannel(db *gorm.DB, id *uint, payload NotificationChannelPayload) (NotificationChannelDetail, error) {
	name := strings.TrimSpace(payload.Name)
	channelType := strings.TrimSpace(strings.ToLower(payload.Type))
	if name == "" {
		return NotificationChannelDetail{}, errors.New("channel name is required")
	}
	if _, ok := NotificationProviderDefinitions()[channelType]; !ok {
		return NotificationChannelDetail{}, errors.New("invalid notification channel type")
	}
	configJSON, err := json.Marshal(payload.Config)
	if err != nil {
		return NotificationChannelDetail{}, err
	}

	channel := models.NotificationChannel{
		Name:       name,
		Type:       channelType,
		Enabled:    payload.Enabled,
		ConfigJSON: string(configJSON),
	}
	if id != nil {
		if err := db.First(&channel, "id = ?", *id).Error; err != nil {
			return NotificationChannelDetail{}, err
		}
		channel.Name = name
		channel.Type = channelType
		channel.Enabled = payload.Enabled
		channel.ConfigJSON = string(configJSON)
	}
	if err := db.Save(&channel).Error; err != nil {
		return NotificationChannelDetail{}, err
	}
	return GetNotificationChannel(db, channel.ID)
}

func saveNotificationRule(db *gorm.DB, id *uint, payload NotificationRulePayload) (NotificationRuleDetail, error) {
	fieldID := strings.TrimSpace(payload.FieldID)
	if fieldID == "" {
		return NotificationRuleDetail{}, errors.New("field_id is required")
	}
	if !payload.AllNodes && len(payload.NodeScopes) == 0 {
		return NotificationRuleDetail{}, errors.New("at least one node scope is required")
	}

	var rule models.NotificationRule
	if id != nil {
		if err := db.First(&rule, "id = ?", *id).Error; err != nil {
			return NotificationRuleDetail{}, err
		}
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		rule.FieldID = fieldID
		rule.NodeID = 0
		rule.TargetID = 0
		rule.ChannelID = 0
		rule.AllNodes = payload.AllNodes
		rule.Enabled = payload.Enabled
		if err := tx.Save(&rule).Error; err != nil {
			return err
		}

		if err := tx.Delete(&models.NotificationRuleNodeScope{}, "rule_id = ?", rule.ID).Error; err != nil {
			return err
		}
		if payload.AllNodes {
			return nil
		}

		seenNodeIDs := map[uint]struct{}{}
		for _, scope := range payload.NodeScopes {
			if scope.NodeID == 0 {
				return errors.New("node_id is required")
			}
			if _, exists := seenNodeIDs[scope.NodeID]; exists {
				return errors.New("duplicate node scope")
			}
			seenNodeIDs[scope.NodeID] = struct{}{}

			var node models.Node
			if err := tx.First(&node, "id = ?", scope.NodeID).Error; err != nil {
				return err
			}

			ruleNode := models.NotificationRuleNodeScope{
				RuleID:     rule.ID,
				NodeID:     scope.NodeID,
				AllTargets: scope.AllTargets,
			}
			if err := tx.Create(&ruleNode).Error; err != nil {
				return err
			}

			if scope.AllTargets {
				continue
			}
			if len(scope.TargetIDs) == 0 {
				return errors.New("target_ids is required when all_targets is false")
			}
			seenTargetIDs := map[uint]struct{}{}
			for _, targetID := range scope.TargetIDs {
				if targetID == 0 {
					return errors.New("target_id is required")
				}
				if _, exists := seenTargetIDs[targetID]; exists {
					continue
				}
				seenTargetIDs[targetID] = struct{}{}
				var target models.NodeTarget
				if err := tx.First(&target, "id = ? AND node_id = ?", targetID, scope.NodeID).Error; err != nil {
					return err
				}
				if err := tx.Create(&models.NotificationRuleTargetScope{
					RuleNodeID: ruleNode.ID,
					TargetID:   target.ID,
				}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		return NotificationRuleDetail{}, err
	}

	return loadNotificationRuleDetail(db, rule)
}

func loadNotificationRuleDetail(db *gorm.DB, rule models.NotificationRule) (NotificationRuleDetail, error) {
	var scopes []models.NotificationRuleNodeScope
	if err := db.Where("rule_id = ?", rule.ID).Order("id ASC").Find(&scopes).Error; err != nil {
		return NotificationRuleDetail{}, err
	}
	scopeItems := make([]NotificationRuleNodeScopeDetail, 0, len(scopes))
	for _, scope := range scopes {
		var node models.Node
		if err := db.First(&node, "id = ?", scope.NodeID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return NotificationRuleDetail{}, err
		}
		var targetScopes []models.NotificationRuleTargetScope
		if err := db.Where("rule_node_id = ?", scope.ID).Order("id ASC").Find(&targetScopes).Error; err != nil {
			return NotificationRuleDetail{}, err
		}
		targetItems := make([]NotificationRuleTargetDetail, 0, len(targetScopes))
		for _, targetScope := range targetScopes {
			var target models.NodeTarget
			if err := db.First(&target, "id = ?", targetScope.TargetID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return NotificationRuleDetail{}, err
			}
			targetItems = append(targetItems, NotificationRuleTargetDetail{
				TargetID: target.ID,
				TargetIP: target.TargetIP,
			})
		}
		if !scope.AllTargets && len(targetItems) == 0 {
			continue
		}
		scopeItems = append(scopeItems, NotificationRuleNodeScopeDetail{
			ID:         scope.ID,
			NodeID:     scope.NodeID,
			NodeName:   node.Name,
			AllTargets: scope.AllTargets,
			Targets:    targetItems,
		})
	}
	return NotificationRuleDetail{
		ID:         rule.ID,
		FieldID:    rule.FieldID,
		AllNodes:   rule.AllNodes,
		Enabled:    rule.Enabled,
		NodeScopes: scopeItems,
		CreatedAt:  rule.CreatedAt,
		UpdatedAt:  rule.UpdatedAt,
	}, nil
}

func PruneNotificationScopesForDeletedTarget(db *gorm.DB, targetID uint) error {
	if db == nil || targetID == 0 {
		return nil
	}
	var affectedScopes []models.NotificationRuleNodeScope
	if err := db.
		Joins("JOIN notification_rule_target_scopes ON notification_rule_target_scopes.rule_node_id = notification_rule_node_scopes.id").
		Where("notification_rule_target_scopes.target_id = ?", targetID).
		Find(&affectedScopes).Error; err != nil {
		return err
	}
	if len(affectedScopes) == 0 {
		return nil
	}

	scopeIDs := make([]uint, 0, len(affectedScopes))
	for _, scope := range affectedScopes {
		scopeIDs = append(scopeIDs, scope.ID)
	}
	if err := db.Delete(&models.NotificationRuleTargetScope{}, "target_id = ?", targetID).Error; err != nil {
		return err
	}
	return pruneEmptyNotificationNodeScopes(db, scopeIDs)
}

func PruneNotificationScopesForDeletedNode(db *gorm.DB, nodeID uint) error {
	if db == nil || nodeID == 0 {
		return nil
	}
	var affectedScopes []models.NotificationRuleNodeScope
	if err := db.Where("node_id = ?", nodeID).Find(&affectedScopes).Error; err != nil {
		return err
	}
	if len(affectedScopes) == 0 {
		return nil
	}

	scopeIDs := make([]uint, 0, len(affectedScopes))
	ruleIDs := make([]uint, 0, len(affectedScopes))
	for _, scope := range affectedScopes {
		scopeIDs = append(scopeIDs, scope.ID)
		ruleIDs = append(ruleIDs, scope.RuleID)
	}
	if err := db.Delete(&models.NotificationRuleTargetScope{}, "rule_node_id IN ?", scopeIDs).Error; err != nil {
		return err
	}
	if err := db.Delete(&models.NotificationRuleNodeScope{}, "id IN ?", scopeIDs).Error; err != nil {
		return err
	}
	return pruneScopelessNotificationRules(db, ruleIDs)
}

func pruneEmptyNotificationNodeScopes(db *gorm.DB, candidateScopeIDs []uint) error {
	candidateScopeIDs = uniqueUintValues(candidateScopeIDs)
	if len(candidateScopeIDs) == 0 {
		return nil
	}
	var emptyScopes []models.NotificationRuleNodeScope
	if err := db.
		Where("id IN ? AND all_targets = ?", candidateScopeIDs, false).
		Where("NOT EXISTS (SELECT 1 FROM notification_rule_target_scopes WHERE notification_rule_target_scopes.rule_node_id = notification_rule_node_scopes.id)").
		Find(&emptyScopes).Error; err != nil {
		return err
	}
	if len(emptyScopes) == 0 {
		return nil
	}
	emptyScopeIDs := make([]uint, 0, len(emptyScopes))
	ruleIDs := make([]uint, 0, len(emptyScopes))
	for _, scope := range emptyScopes {
		emptyScopeIDs = append(emptyScopeIDs, scope.ID)
		ruleIDs = append(ruleIDs, scope.RuleID)
	}
	if err := db.Delete(&models.NotificationRuleNodeScope{}, "id IN ?", emptyScopeIDs).Error; err != nil {
		return err
	}
	return pruneScopelessNotificationRules(db, ruleIDs)
}

func pruneScopelessNotificationRules(db *gorm.DB, candidateRuleIDs []uint) error {
	candidateRuleIDs = uniqueUintValues(candidateRuleIDs)
	if len(candidateRuleIDs) == 0 {
		return nil
	}
	var rules []models.NotificationRule
	if err := db.Where("id IN ? AND all_nodes = ?", candidateRuleIDs, false).Find(&rules).Error; err != nil {
		return err
	}
	for _, rule := range rules {
		var scopeCount int64
		if err := db.Model(&models.NotificationRuleNodeScope{}).Where("rule_id = ?", rule.ID).Count(&scopeCount).Error; err != nil {
			return err
		}
		if scopeCount == 0 {
			if err := db.Delete(&models.NotificationRule{}, "id = ?", rule.ID).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func uniqueUintValues(values []uint) []uint {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[uint]struct{}, len(values))
	unique := make([]uint, 0, len(values))
	for _, value := range values {
		if value == 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func decodeChannelConfig(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}
	}
	result := make(map[string]any)
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return map[string]any{}
	}
	return result
}
