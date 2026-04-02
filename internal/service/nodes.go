package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"komari-ip-history/internal/auth"
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
	KomariNodeUUID string         `json:"komari_node_uuid"`
	Name           string         `json:"name"`
	HasData        bool           `json:"has_data"`
	CurrentSummary string         `json:"current_summary"`
	CurrentResult  map[string]any `json:"current_result"`
	UpdatedAt      *time.Time     `json:"updated_at"`
	CreatedAt      time.Time      `json:"created_at"`
}

type NodeReportConfig struct {
	EndpointPath  string `json:"endpoint_path"`
	ReporterToken string `json:"reporter_token"`
}

type NodeDetail struct {
	KomariNodeUUID string           `json:"komari_node_uuid"`
	Name           string           `json:"name"`
	HasData        bool             `json:"has_data"`
	CurrentSummary string           `json:"current_summary"`
	UpdatedAt      *time.Time       `json:"updated_at"`
	CurrentResult  map[string]any   `json:"current_result"`
	ReportConfig   NodeReportConfig `json:"report_config"`
}

type PublicNodeDetail struct {
	HasData       bool           `json:"has_data"`
	CurrentResult map[string]any `json:"current_result"`
}

type ReportNodeInput struct {
	Summary    string         `json:"summary"`
	Result     map[string]any `json:"result"`
	RecordedAt *time.Time     `json:"recorded_at"`
}

func newReporterToken() (string, error) {
	return auth.NewSessionToken()
}

func RegisterNode(db *gorm.DB, cfg config.Config, input RegisterNodeInput) (*models.Node, bool, error) {
	if input.KomariNodeUUID == "" || input.Name == "" {
		return nil, false, errors.New("uuid and name are required")
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if err == nil {
		node.Name = input.Name
		if node.ReporterToken == "" {
			token, err := newReporterToken()
			if err != nil {
				return nil, true, err
			}
			node.ReporterToken = token
		}
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
	reporterToken, err := newReporterToken()
	if err != nil {
		return nil, false, err
	}
	node.ReporterToken = reporterToken

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
		current := map[string]any{}
		if node.CurrentResultJSON != "" {
			_ = json.Unmarshal([]byte(node.CurrentResultJSON), &current)
		}
		items = append(items, NodeListItem{
			KomariNodeUUID: node.KomariNodeUUID,
			Name:           node.Name,
			HasData:        node.HasData,
			CurrentSummary: node.CurrentSummary,
			CurrentResult:  current,
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

	return NodeDetail{
		KomariNodeUUID: node.KomariNodeUUID,
		Name:           node.Name,
		HasData:        node.HasData,
		CurrentSummary: node.CurrentSummary,
		UpdatedAt:      node.CurrentResultUpdatedAt,
		CurrentResult:  current,
		ReportConfig: NodeReportConfig{
			EndpointPath:  "/api/v1/report/nodes/" + node.KomariNodeUUID,
			ReporterToken: node.ReporterToken,
		},
	}, nil
}

func GetNodeHistory(db *gorm.DB, uuid string) ([]models.NodeHistory, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return nil, err
	}

	var history []models.NodeHistory
	if err := db.Where("node_id = ?", node.ID).Order("recorded_at DESC").Find(&history).Error; err != nil {
		return nil, err
	}
	return history, nil
}

func GetPublicNodeDetail(db *gorm.DB, uuid string, displayIP string) (PublicNodeDetail, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return PublicNodeDetail{}, err
	}

	current := map[string]any{}
	if node.CurrentResultJSON != "" {
		_ = json.Unmarshal([]byte(node.CurrentResultJSON), &current)
	}

	current = sanitizePublicCurrentResult(current)
	applyPublicDisplayIP(current, displayIP)

	return PublicNodeDetail{
		HasData:       node.HasData,
		CurrentResult: current,
	}, nil
}

func sanitizePublicCurrentResult(result map[string]any) map[string]any {
	allowedKeys := map[string]struct{}{
		"Head":   {},
		"Info":   {},
		"Type":   {},
		"Score":  {},
		"Factor": {},
		"Media":  {},
		"Mail":   {},
	}

	filtered := make(map[string]any, len(allowedKeys))
	for key, value := range result {
		if _, ok := allowedKeys[key]; ok {
			filtered[key] = value
		}
	}
	return filtered
}

func applyPublicDisplayIP(result map[string]any, displayIP string) {
	head, ok := result["Head"].(map[string]any)
	if !ok || head == nil {
		head = map[string]any{}
		result["Head"] = head
	}

	displayIP = strings.TrimSpace(displayIP)
	if displayIP == "" {
		head["IP"] = nil
		return
	}
	head["IP"] = displayIP
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

func RotateNodeReporterToken(db *gorm.DB, uuid string) (NodeReportConfig, error) {
	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return NodeReportConfig{}, err
	}

	token, err := newReporterToken()
	if err != nil {
		return NodeReportConfig{}, err
	}
	if err := db.Model(&node).Update("reporter_token", token).Error; err != nil {
		return NodeReportConfig{}, err
	}

	return NodeReportConfig{
		EndpointPath:  "/api/v1/report/nodes/" + node.KomariNodeUUID,
		ReporterToken: token,
	}, nil
}

func ReportNode(db *gorm.DB, uuid, token string, input ReportNodeInput) error {
	if strings.TrimSpace(token) == "" {
		return errors.New("missing reporter token")
	}
	if len(input.Result) == 0 {
		return errors.New("result is required")
	}

	var node models.Node
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err != nil {
		return err
	}
	if node.ReporterToken == "" || token != node.ReporterToken {
		return errors.New("invalid reporter token")
	}

	recordedAt := time.Now().UTC()
	if input.RecordedAt != nil && !input.RecordedAt.IsZero() {
		recordedAt = input.RecordedAt.UTC()
	}

	raw, err := json.MarshalIndent(input.Result, "", "  ")
	if err != nil {
		return err
	}

	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		summary = "Reporter update"
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&node).Updates(map[string]any{
			"has_data":                  true,
			"current_summary":           summary,
			"current_result_json":       string(raw),
			"current_result_updated_at": recordedAt,
		}).Error; err != nil {
			return err
		}

		history := models.NodeHistory{
			NodeID:     node.ID,
			ResultJSON: string(raw),
			Summary:    summary,
			RecordedAt: recordedAt,
		}
		return tx.Create(&history).Error
	})
}
