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
	KomariNodeUUID         string     `gorm:"size:64;uniqueIndex;not null" json:"komari_node_uuid"`
	Name                   string     `gorm:"size:255;not null" json:"name"`
	HasData                bool       `gorm:"not null;default:false" json:"has_data"`
	CurrentSummary         string     `gorm:"size:512" json:"current_summary"`
	CurrentResultJSON      string     `gorm:"type:longtext" json:"-"`
	CurrentResultUpdatedAt *time.Time `json:"current_result_updated_at"`
	ReporterToken          string     `gorm:"size:128" json:"-"`
	InstallToken           string     `gorm:"size:48;index;not null;default:''" json:"-"`
	ReporterScheduleCron   string     `gorm:"size:64;not null;default:'0 0 * * *'" json:"-"`
	ReporterRunImmediately bool       `gorm:"not null;default:true" json:"-"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

func (n *Node) BeforeCreate(_ *gorm.DB) error {
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
