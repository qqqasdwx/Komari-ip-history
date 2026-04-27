package models

import (
	"time"

	"komari-ip-history/internal/auth"

	"gorm.io/gorm"
)

type AdminUser struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Username     string    `gorm:"size:64;uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"size:255;not null" json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Session struct {
	Token     string    `gorm:"primaryKey;size:128" json:"token"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	User      AdminUser `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	ExpiresAt time.Time `gorm:"index;not null" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Node struct {
	ID                     uint       `gorm:"primaryKey" json:"id"`
	NodeUUID               string     `gorm:"size:48;uniqueIndex;not null;default:''" json:"node_uuid"`
	KomariNodeUUID         string     `gorm:"size:64;uniqueIndex;not null" json:"komari_node_uuid"`
	Name                   string     `gorm:"size:255;not null" json:"name"`
	HasData                bool       `gorm:"not null;default:false" json:"has_data"`
	CurrentSummary         string     `gorm:"size:512" json:"current_summary"`
	CurrentResultJSON      string     `gorm:"type:longtext" json:"-"`
	CurrentResultUpdatedAt *time.Time `json:"current_result_updated_at"`
	ReporterToken          string     `gorm:"size:128" json:"-"`
	InstallToken           string     `gorm:"size:48;index;not null;default:''" json:"-"`
	ReporterScheduleCron   string     `gorm:"size:64;not null;default:'0 0 * * *'" json:"-"`
	ReporterTimezone       string     `gorm:"size:64;not null;default:'UTC'" json:"-"`
	ReporterRunImmediately bool       `gorm:"not null;default:true" json:"-"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

func (n *Node) BeforeCreate(_ *gorm.DB) error {
	if n.NodeUUID == "" {
		token, err := auth.NewInstallToken()
		if err != nil {
			return err
		}
		n.NodeUUID = token
	}
	if n.InstallToken != "" {
		return nil
	}
	token, err := auth.NewInstallToken()
	if err != nil {
		return err
	}
	n.InstallToken = token
	return nil
}

type NodeTarget struct {
	ID                     uint       `gorm:"primaryKey" json:"id"`
	NodeID                 uint       `gorm:"uniqueIndex:idx_node_target_ip;index;not null" json:"node_id"`
	Node                   Node       `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	TargetIP               string     `gorm:"size:64;uniqueIndex:idx_node_target_ip;not null" json:"target_ip"`
	Source                 string     `gorm:"size:24;not null;default:'manual'" json:"source"`
	Enabled                bool       `gorm:"not null;default:true" json:"enabled"`
	SortOrder              int        `gorm:"index;not null;default:0" json:"sort_order"`
	HasData                bool       `gorm:"not null;default:false" json:"has_data"`
	CurrentSummary         string     `gorm:"size:512" json:"current_summary"`
	CurrentResultJSON      string     `gorm:"type:longtext" json:"-"`
	CurrentResultUpdatedAt *time.Time `json:"current_result_updated_at"`
	LastSeenAt             *time.Time `json:"last_seen_at"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

type KomariBinding struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	NodeID         uint      `gorm:"uniqueIndex;not null" json:"node_id"`
	Node           Node      `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	KomariNodeUUID string    `gorm:"size:64;uniqueIndex;not null" json:"komari_node_uuid"`
	KomariNodeName string    `gorm:"size:255;not null" json:"komari_node_name"`
	BindingSource  string    `gorm:"size:24;not null;default:'from_komari'" json:"binding_source"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type NodeHistory struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	NodeID     uint      `gorm:"index;not null" json:"node_id"`
	ResultJSON string    `gorm:"type:longtext" json:"result_json"`
	Summary    string    `gorm:"size:512" json:"summary"`
	RecordedAt time.Time `gorm:"index;not null" json:"recorded_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type NodeTargetHistory struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	NodeTargetID uint       `gorm:"index;index:idx_node_target_history_target_recorded,priority:1;not null" json:"node_target_id"`
	NodeTarget   NodeTarget `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	ResultJSON   string     `gorm:"type:longtext" json:"result_json"`
	Summary      string     `gorm:"size:512" json:"summary"`
	IsFavorite   bool       `gorm:"not null;default:false;index:idx_node_target_history_favorite_recorded,priority:1" json:"is_favorite"`
	RecordedAt   time.Time  `gorm:"index;index:idx_node_target_history_target_recorded,priority:2;index:idx_node_target_history_favorite_recorded,priority:2;not null" json:"recorded_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

type AppSetting struct {
	Key       string    `gorm:"primaryKey;size:128" json:"key"`
	Value     string    `gorm:"type:longtext;not null" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

type NotificationChannel struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Name       string    `gorm:"size:128;not null" json:"name"`
	Type       string    `gorm:"size:32;index;not null" json:"type"`
	Enabled    bool      `gorm:"not null;default:true" json:"enabled"`
	ConfigJSON string    `gorm:"type:longtext;not null;default:'{}'" json:"config_json"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type NotificationRule struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	NodeID    uint      `gorm:"not null;default:0" json:"-"`
	TargetID  uint      `gorm:"not null;default:0" json:"-"`
	ChannelID uint      `gorm:"not null;default:0" json:"-"`
	FieldID   string    `gorm:"size:255;not null;index" json:"field_id"`
	AllNodes  bool      `gorm:"not null;default:false" json:"all_nodes"`
	Enabled   bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type NotificationRuleNodeScope struct {
	ID         uint             `gorm:"primaryKey" json:"id"`
	RuleID     uint             `gorm:"index;not null" json:"rule_id"`
	Rule       NotificationRule `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	NodeID     uint             `gorm:"index;not null" json:"node_id"`
	Node       Node             `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	AllTargets bool             `gorm:"not null;default:false" json:"all_targets"`
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

type NotificationRuleTargetScope struct {
	ID          uint                      `gorm:"primaryKey" json:"id"`
	RuleNodeID  uint                      `gorm:"index;not null" json:"rule_node_id"`
	RuleNode    NotificationRuleNodeScope `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	TargetID    uint                      `gorm:"index;not null" json:"target_id"`
	Target      NodeTarget                `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	CreatedAt   time.Time                 `json:"created_at"`
	UpdatedAt   time.Time                 `json:"updated_at"`
}

type NotificationDelivery struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	RuleID          uint      `gorm:"index;not null" json:"rule_id"`
	HistoryEntryID  uint      `gorm:"index;not null" json:"history_entry_id"`
	Status          string    `gorm:"size:24;not null" json:"status"`
	ResponseSummary string    `gorm:"size:1024" json:"response_summary"`
	CreatedAt       time.Time `json:"created_at"`
}

type APIKey struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	Name       string     `gorm:"size:128;not null" json:"name"`
	KeyHash    string     `gorm:"size:128;uniqueIndex;not null" json:"-"`
	Enabled    bool       `gorm:"not null;default:true" json:"enabled"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type APIAccessLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	APIKeyID   uint      `gorm:"index;not null" json:"api_key_id"`
	Method     string    `gorm:"size:16;not null" json:"method"`
	Path       string    `gorm:"size:255;not null" json:"path"`
	StatusCode int       `gorm:"not null" json:"status_code"`
	RemoteAddr string    `gorm:"size:255" json:"remote_addr"`
	CreatedAt  time.Time `json:"created_at"`
}
