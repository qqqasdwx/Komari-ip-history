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
	ID                       uint       `gorm:"primaryKey" json:"id"`
	NodeUUID                 string     `gorm:"size:48;not null;default:''" json:"node_uuid"`
	KomariNodeUUID           string     `gorm:"size:64;not null;default:''" json:"komari_node_uuid"`
	KomariNodeName           string     `gorm:"size:255;not null;default:''" json:"komari_node_name"`
	Name                     string     `gorm:"size:255;not null" json:"name"`
	HasData                  bool       `gorm:"not null;default:false" json:"has_data"`
	CurrentSummary           string     `gorm:"size:512" json:"current_summary"`
	CurrentResultJSON        string     `gorm:"type:longtext" json:"-"`
	CurrentResultUpdatedAt   *time.Time `json:"current_result_updated_at"`
	ReporterToken            string     `gorm:"size:128" json:"-"`
	InstallToken             string     `gorm:"size:48;index;not null;default:''" json:"-"`
	ReporterScheduleCron     string     `gorm:"size:64;not null;default:'0 0 * * *'" json:"-"`
	ReporterScheduleTimezone string     `gorm:"size:64;not null;default:''" json:"-"`
	ReporterRunImmediately   bool       `gorm:"not null;default:true" json:"-"`
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
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
	TargetSource           string     `gorm:"size:16;not null;default:'manual'" json:"target_source"`
	ReportEnabled          bool       `gorm:"not null;default:true" json:"report_enabled"`
	LastDiscoveredAt       *time.Time `json:"last_discovered_at"`
	SortOrder              int        `gorm:"index;not null;default:0" json:"sort_order"`
	HasData                bool       `gorm:"not null;default:false" json:"has_data"`
	CurrentSummary         string     `gorm:"size:512" json:"current_summary"`
	CurrentResultJSON      string     `gorm:"type:longtext" json:"-"`
	CurrentResultUpdatedAt *time.Time `json:"current_result_updated_at"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
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

type APIKey struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	Name       string         `gorm:"size:128;not null" json:"name"`
	KeyPrefix  string         `gorm:"size:16;index;not null" json:"key_prefix"`
	KeyHash    string         `gorm:"size:64;uniqueIndex;not null" json:"-"`
	Enabled    bool           `gorm:"not null;default:true" json:"enabled"`
	LastUsedAt *time.Time     `json:"last_used_at"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

type APIAccessLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	APIKeyID   *uint     `gorm:"index" json:"api_key_id"`
	APIKey     APIKey    `gorm:"constraint:OnDelete:SET NULL" json:"-"`
	KeyPrefix  string    `gorm:"size:16;index;not null;default:''" json:"key_prefix"`
	KeyName    string    `gorm:"size:128;not null;default:''" json:"key_name"`
	Method     string    `gorm:"size:16;not null" json:"method"`
	Path       string    `gorm:"size:2048;not null" json:"path"`
	StatusCode int       `gorm:"index;not null" json:"status_code"`
	RemoteIP   string    `gorm:"size:64;not null;default:''" json:"remote_ip"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}
