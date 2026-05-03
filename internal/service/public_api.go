package service

import (
	"strings"
	"time"

	"komari-ip-history/internal/models"

	"gorm.io/gorm"
)

type PublicAPINodeListItem struct {
	NodeUUID       string     `json:"node_uuid"`
	KomariNodeUUID string     `json:"komari_node_uuid"`
	KomariNodeName string     `json:"komari_node_name"`
	Name           string     `json:"name"`
	HasData        bool       `json:"has_data"`
	BindingState   string     `json:"binding_state"`
	TargetCount    int64      `json:"target_count"`
	UpdatedAt      *time.Time `json:"updated_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

type PublicAPINodeListPage struct {
	Items      []PublicAPINodeListItem `json:"items"`
	Total      int64                   `json:"total"`
	Page       int                     `json:"page"`
	PageSize   int                     `json:"page_size"`
	TotalPages int                     `json:"total_pages"`
}

type PublicAPITargetItem struct {
	ID        uint       `json:"id"`
	IP        string     `json:"ip"`
	Source    string     `json:"source"`
	HasData   bool       `json:"has_data"`
	UpdatedAt *time.Time `json:"updated_at"`
	SortOrder int        `json:"sort_order"`
}

type PublicAPITargetCurrent struct {
	ID        uint           `json:"id"`
	IP        string         `json:"ip"`
	Source    string         `json:"source"`
	HasData   bool           `json:"has_data"`
	UpdatedAt *time.Time     `json:"updated_at"`
	Summary   string         `json:"summary"`
	Result    map[string]any `json:"current_result"`
}

type PublicAPINodeDetail struct {
	NodeUUID       string                `json:"node_uuid"`
	KomariNodeUUID string                `json:"komari_node_uuid"`
	KomariNodeName string                `json:"komari_node_name"`
	Name           string                `json:"name"`
	HasData        bool                  `json:"has_data"`
	BindingState   string                `json:"binding_state"`
	UpdatedAt      *time.Time            `json:"updated_at"`
	Targets        []PublicAPITargetItem `json:"targets"`
	CreatedAt      time.Time             `json:"created_at"`
}

type PublicAPITargetList struct {
	Items []PublicAPITargetItem `json:"items"`
}

func ListPublicAPINodes(db *gorm.DB, keyword string, page, pageSize int) (PublicAPINodeListPage, error) {
	page = normalizeHistoryPage(page)
	pageSize = normalizeHistoryPageSize(0, pageSize)

	baseQuery := db.Model(&models.Node{})
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + keyword + "%"
		baseQuery = baseQuery.Where("name LIKE ? OR node_uuid LIKE ? OR komari_node_uuid LIKE ? OR komari_node_name LIKE ?", like, like, like, like)
	}

	var total int64
	if err := baseQuery.Count(&total).Error; err != nil {
		return PublicAPINodeListPage{}, err
	}

	var nodes []models.Node
	query := db.Order("has_data DESC").Order("current_result_updated_at DESC").Order("created_at DESC")
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR node_uuid LIKE ? OR komari_node_uuid LIKE ? OR komari_node_name LIKE ?", like, like, like, like)
	}
	if err := query.Offset((page - 1) * pageSize).Limit(pageSize).Find(&nodes).Error; err != nil {
		return PublicAPINodeListPage{}, err
	}

	items := make([]PublicAPINodeListItem, 0, len(nodes))
	for _, node := range nodes {
		var targetCount int64
		if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", node.ID).Count(&targetCount).Error; err != nil {
			return PublicAPINodeListPage{}, err
		}
		items = append(items, publicAPINodeListItem(node, targetCount))
	}

	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	return PublicAPINodeListPage{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func GetPublicAPINodeDetail(db *gorm.DB, uuid string) (PublicAPINodeDetail, error) {
	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return PublicAPINodeDetail{}, err
	}

	targetItems := make([]PublicAPITargetItem, 0, len(targets))
	for _, target := range targets {
		targetItems = append(targetItems, publicAPITargetItem(target))
	}

	return PublicAPINodeDetail{
		NodeUUID:       node.NodeUUID,
		KomariNodeUUID: node.KomariNodeUUID,
		KomariNodeName: node.KomariNodeName,
		Name:           node.Name,
		HasData:        node.HasData,
		BindingState:   nodeBindingState(node),
		UpdatedAt:      node.CurrentResultUpdatedAt,
		Targets:        targetItems,
		CreatedAt:      node.CreatedAt,
	}, nil
}

func GetPublicAPINodeTargets(db *gorm.DB, uuid string) (PublicAPITargetList, error) {
	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return PublicAPITargetList{}, err
	}
	items := make([]PublicAPITargetItem, 0, len(targets))
	for _, target := range targets {
		items = append(items, publicAPITargetItem(target))
	}
	return PublicAPITargetList{Items: items}, nil
}

func GetPublicAPITargetCurrent(db *gorm.DB, uuid string, targetID uint) (PublicAPITargetCurrent, error) {
	if targetID == 0 {
		return PublicAPITargetCurrent{}, gorm.ErrRecordNotFound
	}
	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return PublicAPITargetCurrent{}, err
	}
	for _, target := range targets {
		if target.ID != targetID {
			continue
		}
		return PublicAPITargetCurrent{
			ID:        target.ID,
			IP:        target.TargetIP,
			Source:    normalizeTargetSource(target.TargetSource),
			HasData:   target.HasData,
			UpdatedAt: target.CurrentResultUpdatedAt,
			Summary:   target.CurrentSummary,
			Result:    decodeResultJSON(target.CurrentResultJSON),
		}, nil
	}
	return PublicAPITargetCurrent{}, gorm.ErrRecordNotFound
}

func publicAPINodeListItem(node models.Node, targetCount int64) PublicAPINodeListItem {
	return PublicAPINodeListItem{
		NodeUUID:       node.NodeUUID,
		KomariNodeUUID: node.KomariNodeUUID,
		KomariNodeName: node.KomariNodeName,
		Name:           node.Name,
		HasData:        node.HasData,
		BindingState:   nodeBindingState(node),
		TargetCount:    targetCount,
		UpdatedAt:      node.CurrentResultUpdatedAt,
		CreatedAt:      node.CreatedAt,
	}
}

func publicAPITargetItem(target models.NodeTarget) PublicAPITargetItem {
	return PublicAPITargetItem{
		ID:        target.ID,
		IP:        target.TargetIP,
		Source:    normalizeTargetSource(target.TargetSource),
		HasData:   target.HasData,
		UpdatedAt: target.CurrentResultUpdatedAt,
		SortOrder: target.SortOrder,
	}
}
