package service

import (
	"time"

	"gorm.io/gorm"
)

type PublicAPIListItem struct {
	ID               uint       `json:"id"`
	NodeUUID         string     `json:"node_uuid"`
	KomariNodeUUID   string     `json:"komari_node_uuid"`
	KomariNodeName   string     `json:"komari_node_name"`
	HasKomariBinding bool       `json:"has_komari_binding"`
	Name             string     `json:"name"`
	HasData          bool       `json:"has_data"`
	UpdatedAt        *time.Time `json:"updated_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

type PublicAPITarget struct {
	ID         uint           `json:"id"`
	IP         string         `json:"ip"`
	Source     string         `json:"source"`
	Enabled    bool           `json:"enabled"`
	HasData    bool           `json:"has_data"`
	UpdatedAt  *time.Time     `json:"updated_at"`
	LastSeenAt *time.Time     `json:"last_seen_at"`
	Result     map[string]any `json:"current_result,omitempty"`
}

type PublicAPIDetail struct {
	ID               uint              `json:"id"`
	NodeUUID         string            `json:"node_uuid"`
	KomariNodeUUID   string            `json:"komari_node_uuid"`
	KomariNodeName   string            `json:"komari_node_name"`
	HasKomariBinding bool              `json:"has_komari_binding"`
	Name             string            `json:"name"`
	HasData          bool              `json:"has_data"`
	UpdatedAt        *time.Time        `json:"updated_at"`
	Targets          []PublicAPITarget `json:"targets"`
	SelectedTargetID *uint             `json:"selected_target_id,omitempty"`
	CurrentTarget    *PublicAPITarget  `json:"current_target,omitempty"`
}

func ListNodesForAPI(db *gorm.DB, keyword string) ([]PublicAPIListItem, error) {
	items, err := ListNodes(db, keyword)
	if err != nil {
		return nil, err
	}
	result := make([]PublicAPIListItem, 0, len(items))
	for _, item := range items {
		result = append(result, PublicAPIListItem{
			ID:               item.ID,
			NodeUUID:         item.NodeUUID,
			KomariNodeUUID:   item.KomariNodeUUID,
			KomariNodeName:   item.KomariNodeName,
			HasKomariBinding: item.HasKomariBinding,
			Name:             item.Name,
			HasData:          item.HasData,
			UpdatedAt:        item.UpdatedAt,
			CreatedAt:        item.CreatedAt,
		})
	}
	return result, nil
}

func GetNodeDetailForAPI(db *gorm.DB, uuid string, selectedTargetID *uint) (PublicAPIDetail, error) {
	detail, err := GetNodeDetail(db, uuid, selectedTargetID)
	if err != nil {
		return PublicAPIDetail{}, err
	}
	targets := make([]PublicAPITarget, 0, len(detail.Targets))
	for _, target := range detail.Targets {
		targets = append(targets, PublicAPITarget{
			ID:         target.ID,
			IP:         target.IP,
			Source:     target.Source,
			Enabled:    target.Enabled,
			HasData:    target.HasData,
			UpdatedAt:  target.UpdatedAt,
			LastSeenAt: target.LastSeenAt,
		})
	}
	result := PublicAPIDetail{
		ID:               detail.ID,
		NodeUUID:         detail.NodeUUID,
		KomariNodeUUID:   detail.KomariNodeUUID,
		KomariNodeName:   detail.KomariNodeName,
		HasKomariBinding: detail.HasKomariBinding,
		Name:             detail.Name,
		HasData:          detail.HasData,
		UpdatedAt:        detail.UpdatedAt,
		Targets:          targets,
		SelectedTargetID: detail.SelectedTargetID,
	}
	if detail.CurrentTarget != nil {
		result.CurrentTarget = &PublicAPITarget{
			ID:         detail.CurrentTarget.ID,
			IP:         detail.CurrentTarget.IP,
			Source:     detail.CurrentTarget.Source,
			Enabled:    detail.CurrentTarget.Enabled,
			HasData:    detail.CurrentTarget.HasData,
			UpdatedAt:  detail.CurrentTarget.UpdatedAt,
			LastSeenAt: detail.CurrentTarget.LastSeenAt,
			Result:     detail.CurrentTarget.Result,
		}
	}
	return result, nil
}

func ListNodeTargetsForAPI(db *gorm.DB, uuid string) ([]PublicAPITarget, error) {
	detail, err := GetNodeDetail(db, uuid, nil)
	if err != nil {
		return nil, err
	}
	items := make([]PublicAPITarget, 0, len(detail.Targets))
	for _, target := range detail.Targets {
		items = append(items, PublicAPITarget{
			ID:         target.ID,
			IP:         target.IP,
			Source:     target.Source,
			Enabled:    target.Enabled,
			HasData:    target.HasData,
			UpdatedAt:  target.UpdatedAt,
			LastSeenAt: target.LastSeenAt,
		})
	}
	return items, nil
}

func GetNodeTargetForAPI(db *gorm.DB, uuid string, targetID uint) (PublicAPITarget, error) {
	detail, err := GetNodeDetail(db, uuid, &targetID)
	if err != nil {
		return PublicAPITarget{}, err
	}
	if detail.CurrentTarget == nil {
		return PublicAPITarget{}, gorm.ErrRecordNotFound
	}
	return PublicAPITarget{
		ID:         detail.CurrentTarget.ID,
		IP:         detail.CurrentTarget.IP,
		Source:     detail.CurrentTarget.Source,
		Enabled:    detail.CurrentTarget.Enabled,
		HasData:    detail.CurrentTarget.HasData,
		UpdatedAt:  detail.CurrentTarget.UpdatedAt,
		LastSeenAt: detail.CurrentTarget.LastSeenAt,
		Result:     detail.CurrentTarget.Result,
	}, nil
}

func GetNodeHistoryForAPI(db *gorm.DB, uuid string, selectedTargetID *uint, page, pageSize int, startAt, endAt *time.Time) (NodeHistoryPage, error) {
	return GetNodeHistory(db, uuid, selectedTargetID, 0, page, pageSize, startAt, endAt)
}

func GetNodeHistoryEventsForAPI(db *gorm.DB, uuid string, selectedTargetID *uint, fieldID string, page, pageSize int, startAt, endAt *time.Time) (NodeHistoryChangeEventPage, error) {
	return GetNodeHistoryEvents(db, uuid, selectedTargetID, fieldID, page, pageSize, startAt, endAt)
}
