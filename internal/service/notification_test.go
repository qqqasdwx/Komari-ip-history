package service

import (
	"testing"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openNotificationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Node{},
		&models.NodeTarget{},
		&models.KomariBinding{},
		&models.NodeHistory{},
		&models.NodeTargetHistory{},
		&models.AppSetting{},
		&models.NotificationChannel{},
		&models.NotificationRule{},
		&models.NotificationRuleNodeScope{},
		&models.NotificationRuleTargetScope{},
		&models.NotificationDelivery{},
	); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	return db
}

func createScopedNotificationRule(t *testing.T, db *gorm.DB, nodeUUID string) (models.Node, models.NodeTarget, NotificationRuleDetail) {
	t.Helper()

	node := models.Node{NodeUUID: nodeUUID, KomariNodeUUID: nodeUUID + "-komari", Name: nodeUUID, ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	rule, err := CreateNotificationRule(db, NotificationRulePayload{
		FieldID:  "score.ipqs",
		Enabled:  true,
		AllNodes: false,
		NodeScopes: []NotificationRuleNodeScopePayload{{
			NodeID:     node.ID,
			AllTargets: false,
			TargetIDs:  []uint{target.ID},
		}},
	})
	if err != nil {
		t.Fatalf("create notification rule: %v", err)
	}
	return node, target, rule
}

func TestCreateNotificationChannel(t *testing.T) {
	db := openNotificationTestDB(t)

	channel, err := CreateNotificationChannel(db, NotificationChannelPayload{
		Name:    "默认 Telegram",
		Type:    "telegram",
		Enabled: true,
		Config: map[string]any{
			"bot_token": "bot-token",
			"chat_id":   "123",
		},
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if channel.Type != "telegram" {
		t.Fatalf("unexpected channel type: %s", channel.Type)
	}
	if channel.Config["chat_id"] != "123" {
		t.Fatalf("unexpected config: %#v", channel.Config)
	}
}

func TestCreateNotificationRule(t *testing.T) {
	db := openNotificationTestDB(t)

	node := models.Node{KomariNodeUUID: "node-notify", Name: "node-notify", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	rule, err := CreateNotificationRule(db, NotificationRulePayload{
		FieldID:  "score.ipqs",
		Enabled:  true,
		AllNodes: false,
		NodeScopes: []NotificationRuleNodeScopePayload{
			{
				NodeID:     node.ID,
				AllTargets: false,
				TargetIDs:  []uint{target.ID},
			},
		},
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}
	if rule.FieldID != "score.ipqs" {
		t.Fatalf("unexpected field id: %s", rule.FieldID)
	}
	if len(rule.NodeScopes) != 1 || len(rule.NodeScopes[0].Targets) != 1 {
		t.Fatalf("unexpected rule scopes: %#v", rule.NodeScopes)
	}
}

func TestDeleteNodeTargetPrunesNotificationScopesAndInvalidRule(t *testing.T) {
	db := openNotificationTestDB(t)
	node, target, rule := createScopedNotificationRule(t, db, "node-prune-target")

	if err := DeleteNodeTarget(db, node.NodeUUID, target.ID); err != nil {
		t.Fatalf("delete node target: %v", err)
	}

	var targetScopeCount int64
	if err := db.Model(&models.NotificationRuleTargetScope{}).Where("target_id = ?", target.ID).Count(&targetScopeCount).Error; err != nil {
		t.Fatalf("count target scopes: %v", err)
	}
	if targetScopeCount != 0 {
		t.Fatalf("expected target scopes to be pruned, got %d", targetScopeCount)
	}
	var nodeScopeCount int64
	if err := db.Model(&models.NotificationRuleNodeScope{}).Where("rule_id = ?", rule.ID).Count(&nodeScopeCount).Error; err != nil {
		t.Fatalf("count node scopes: %v", err)
	}
	if nodeScopeCount != 0 {
		t.Fatalf("expected empty node scopes to be pruned, got %d", nodeScopeCount)
	}
	var ruleCount int64
	if err := db.Model(&models.NotificationRule{}).Where("id = ?", rule.ID).Count(&ruleCount).Error; err != nil {
		t.Fatalf("count rules: %v", err)
	}
	if ruleCount != 0 {
		t.Fatalf("expected invalid non-AllNodes rule to be deleted, got %d", ruleCount)
	}
}

func TestDeleteNodePrunesNotificationScopesAndInvalidRule(t *testing.T) {
	db := openNotificationTestDB(t)
	node, target, rule := createScopedNotificationRule(t, db, "node-prune-node")

	if err := DeleteNode(db, node.NodeUUID); err != nil {
		t.Fatalf("delete node: %v", err)
	}

	var targetScopeCount int64
	if err := db.Model(&models.NotificationRuleTargetScope{}).Where("target_id = ?", target.ID).Count(&targetScopeCount).Error; err != nil {
		t.Fatalf("count target scopes: %v", err)
	}
	if targetScopeCount != 0 {
		t.Fatalf("expected target scopes to be pruned, got %d", targetScopeCount)
	}
	var nodeScopeCount int64
	if err := db.Model(&models.NotificationRuleNodeScope{}).Where("rule_id = ?", rule.ID).Count(&nodeScopeCount).Error; err != nil {
		t.Fatalf("count node scopes: %v", err)
	}
	if nodeScopeCount != 0 {
		t.Fatalf("expected node scopes to be pruned, got %d", nodeScopeCount)
	}
	var ruleCount int64
	if err := db.Model(&models.NotificationRule{}).Where("id = ?", rule.ID).Count(&ruleCount).Error; err != nil {
		t.Fatalf("count rules: %v", err)
	}
	if ruleCount != 0 {
		t.Fatalf("expected invalid non-AllNodes rule to be deleted, got %d", ruleCount)
	}
}

func TestListNotificationRulesSkipsOrphanScopes(t *testing.T) {
	db := openNotificationTestDB(t)
	_, target, _ := createScopedNotificationRule(t, db, "node-orphan-list")
	if err := db.Delete(&models.NodeTarget{}, "id = ?", target.ID).Error; err != nil {
		t.Fatalf("delete target without cleanup: %v", err)
	}

	rules, err := ListNotificationRules(db)
	if err != nil {
		t.Fatalf("list notification rules with orphan target: %v", err)
	}
	if len(rules) != 0 {
		t.Fatalf("expected invalid non-AllNodes orphan rule to be hidden, got %#v", rules)
	}
}

func TestNotificationProviderDefinitionsIncludeKomariLikeSenders(t *testing.T) {
	defs := NotificationProviderDefinitions()
	for _, key := range []string{"telegram", "javascript", "webhook"} {
		if _, ok := defs[key]; !ok {
			t.Fatalf("expected provider %s", key)
		}
	}
}

func TestListNotificationDeliveries(t *testing.T) {
	db := openNotificationTestDB(t)
	if err := db.AutoMigrate(&models.NotificationDelivery{}); err != nil {
		t.Fatalf("migrate deliveries: %v", err)
	}

	if err := db.Create(&models.NotificationDelivery{
		RuleID:         1,
		HistoryEntryID: 2,
		Status:         "success",
	}).Error; err != nil {
		t.Fatalf("create delivery: %v", err)
	}

	items, err := ListNotificationDeliveries(db, 10, "")
	if err != nil {
		t.Fatalf("list deliveries: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(items))
	}
	if items[0].Status != "success" {
		t.Fatalf("unexpected delivery status: %s", items[0].Status)
	}
}

func TestDeleteNotificationChannelAlsoDeletesRules(t *testing.T) {
	db := openNotificationTestDB(t)

	channel := models.NotificationChannel{Name: "default", Type: "telegram", Enabled: true, ConfigJSON: `{"chat_id":"1"}`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	node := models.Node{KomariNodeUUID: "node-rule-delete", Name: "node-rule-delete", ReporterToken: "token"}
	if err := db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	target := models.NodeTarget{NodeID: node.ID, TargetIP: "1.1.1.1", Source: "manual", Enabled: true}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("create target: %v", err)
	}
	rule, err := CreateNotificationRule(db, NotificationRulePayload{
		FieldID:  "score.ipqs",
		Enabled:  true,
		AllNodes: false,
		NodeScopes: []NotificationRuleNodeScopePayload{{
			NodeID:     node.ID,
			AllTargets: false,
			TargetIDs:  []uint{target.ID},
		}},
	})
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}
	activeChannelID := channel.ID
	if _, err := SetNotificationSettings(db, &activeChannelID, defaultNotificationTitleTemplate, defaultNotificationMessageTemplate); err != nil {
		t.Fatalf("set active channel: %v", err)
	}

	if err := DeleteNotificationChannel(db, channel.ID); err != nil {
		t.Fatalf("delete channel: %v", err)
	}

	var count int64
	if err := db.Model(&models.NotificationRule{}).Where("id = ?", rule.ID).Count(&count).Error; err != nil {
		t.Fatalf("count rules: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected rules to remain, got %d", count)
	}
	settings, err := GetNotificationSettings(db)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if settings.ActiveChannelID != nil {
		t.Fatalf("expected active channel to be cleared, got %v", *settings.ActiveChannelID)
	}
}

func TestNotificationSettingsRoundTrip(t *testing.T) {
	db := openNotificationTestDB(t)

	settings, err := GetNotificationSettings(db)
	if err != nil {
		t.Fatalf("get notification settings: %v", err)
	}
	if settings.ActiveChannelID != nil {
		t.Fatal("expected active channel to default nil")
	}

	channel := models.NotificationChannel{Name: "default", Type: "telegram", Enabled: true, ConfigJSON: `{"chat_id":"1"}`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatalf("create channel: %v", err)
	}
	activeChannelID := channel.ID
	saved, err := SetNotificationSettings(db, &activeChannelID, "title: {{node_name}}", "message: {{current_value}}")
	if err != nil {
		t.Fatalf("set notification settings: %v", err)
	}
	if saved.ActiveChannelID == nil || *saved.ActiveChannelID != channel.ID {
		t.Fatalf("unexpected active channel: %#v", saved.ActiveChannelID)
	}
	if saved.TitleTemplate != "title: {{node_name}}" {
		t.Fatalf("unexpected title template: %s", saved.TitleTemplate)
	}
	if saved.MessageTemplate != "message: {{current_value}}" {
		t.Fatalf("unexpected message template: %s", saved.MessageTemplate)
	}
}

func TestClearNotificationDeliveries(t *testing.T) {
	db := openNotificationTestDB(t)
	if err := db.Create(&models.NotificationDelivery{RuleID: 1, HistoryEntryID: 2, Status: "success"}).Error; err != nil {
		t.Fatalf("create delivery: %v", err)
	}
	if err := ClearNotificationDeliveries(db); err != nil {
		t.Fatalf("clear deliveries: %v", err)
	}
	var count int64
	if err := db.Model(&models.NotificationDelivery{}).Count(&count).Error; err != nil {
		t.Fatalf("count deliveries: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected deliveries cleared, got %d", count)
	}
}

func TestRenderNotificationTemplate(t *testing.T) {
	event := NotificationEvent{
		NodeName:         "Node A",
		KomariNodeUUID:   "node-a",
		TargetIP:         "1.1.1.1",
		FieldLabel:       "Organization",
		GroupPath:        []string{"Info"},
		PreviousValue:    "Org A",
		CurrentValue:     "Org B",
		PreviousRecorded: "2026-04-17T08:00:00Z",
		RecordedAt:       time.Date(2026, 4, 17, 9, 0, 0, 0, time.UTC),
		DetailURL:        "https://ipq.example.com/#/nodes/node-a?target_id=1",
		CompareURL:       "https://ipq.example.com/#/nodes/node-a/compare?target_id=1",
	}

	rendered := RenderNotificationTemplate("{{node_name}} {{field_path}} {{current_value}} {{detail_url}}", event, "")
	if rendered != "Node A Info / Organization Org B https://ipq.example.com/#/nodes/node-a?target_id=1" {
		t.Fatalf("unexpected rendered template: %s", rendered)
	}
}
