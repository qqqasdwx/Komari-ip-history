package service

import (
	"encoding/json"
	"errors"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"
	"komari-ip-history/internal/sampledata"

	"gorm.io/gorm"
)

type RegisterNodeInput struct {
	KomariNodeUUID string `json:"uuid"`
	Name           string `json:"name"`
}

type NodeStatus struct {
	Exists    bool       `json:"exists"`
	HasData   bool       `json:"has_data"`
	NodeName  string     `json:"node_name,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type NodeListItem struct {
	KomariNodeUUID string     `json:"komari_node_uuid"`
	Name           string     `json:"name"`
	HasData        bool       `json:"has_data"`
	CurrentSummary string     `json:"current_summary"`
	UpdatedAt      *time.Time `json:"updated_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

type NodeDetail struct {
	KomariNodeUUID string               `json:"komari_node_uuid"`
	Name           string               `json:"name"`
	HasData        bool                 `json:"has_data"`
	CurrentSummary string               `json:"current_summary"`
	UpdatedAt      *time.Time           `json:"updated_at"`
	CurrentResult  map[string]any       `json:"current_result"`
	History        []models.NodeHistory `json:"history"`
}

func RegisterNode(db *gorm.DB, cfg config.Config, input RegisterNodeInput) (*models.Node, bool, error) {
	if input.KomariNodeUUID == "" || input.Name == "" {
		return nil, false, errors.New("uuid and name are required")
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if err == nil {
		node.Name = input.Name
		if err := db.Save(&node).Error; err != nil {
			return nil, true, err
		}
		return &node, true, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, false, err
	}

	node = models.Node{
		KomariNodeUUID: input.KomariNodeUUID,
		Name:           input.Name,
	}

	var history *models.NodeHistory
	if cfg.IsDevelopment() {
		raw, summary, updatedAt, err := sampledata.DefaultCurrentResult(input.KomariNodeUUID, input.Name)
		if err != nil {
			return nil, false, err
		}
		node.HasData = true
		node.CurrentResultJSON = raw
		node.CurrentSummary = summary
		node.CurrentResultUpdatedAt = &updatedAt
		history = &models.NodeHistory{
			ResultJSON: raw,
			Summary:    summary,
			RecordedAt: updatedAt,
		}
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&node).Error; err != nil {
			return err
		}
		if history != nil {
			history.NodeID = node.ID
			if err := tx.Create(history).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, false, err
	}
	return &node, false, nil
}

func ListNodes(db *gorm.DB, keyword string) ([]NodeListItem, error) {
	var nodes []models.Node
	query := db.Order("has_data DESC").Order("current_result_updated_at DESC").Order("created_at DESC")
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR komari_node_uuid LIKE ?", like, like)
	}
	if err := query.Find(&nodes).Error; err != nil {
		return nil, err
	}

	items := make([]NodeListItem, 0, len(nodes))
	for _, node := range nodes {
		items = append(items, NodeListItem{
			KomariNodeUUID: node.KomariNodeUUID,
			Name:           node.Name,
			HasData:        node.HasData,
			CurrentSummary: node.CurrentSummary,
			UpdatedAt:      node.CurrentResultUpdatedAt,
			CreatedAt:      node.CreatedAt,
		})
	}
	return items, nil
}

func GetNodeStatus(db *gorm.DB, uuid string) (NodeStatus, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return NodeStatus{Exists: false}, nil
		}
		return NodeStatus{}, err
	}
	return NodeStatus{
		Exists:    true,
		HasData:   node.HasData,
		NodeName:  node.Name,
		UpdatedAt: node.CurrentResultUpdatedAt,
	}, nil
}

func GetNodeDetail(db *gorm.DB, uuid string) (NodeDetail, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return NodeDetail{}, err
	}

	current := map[string]any{}
	if node.CurrentResultJSON != "" {
		_ = json.Unmarshal([]byte(node.CurrentResultJSON), &current)
	}

	var history []models.NodeHistory
	if err := db.Where("node_id = ?", node.ID).Order("recorded_at DESC").Find(&history).Error; err != nil {
		return NodeDetail{}, err
	}

	return NodeDetail{
		KomariNodeUUID: node.KomariNodeUUID,
		Name:           node.Name,
		HasData:        node.HasData,
		CurrentSummary: node.CurrentSummary,
		UpdatedAt:      node.CurrentResultUpdatedAt,
		CurrentResult:  current,
		History:        history,
	}, nil
}

func DeleteNode(db *gorm.DB, uuid string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var node models.Node
		if err := tx.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", node.ID).Delete(&models.NodeHistory{}).Error; err != nil {
			return err
		}
		return tx.Delete(&node).Error
	})
}
