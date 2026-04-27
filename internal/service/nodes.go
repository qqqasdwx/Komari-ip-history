package service

import (
	"encoding/json"
	"errors"
	"net"
	"strconv"
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

const standaloneKomariNodeUUIDPrefix = "ipq-"

type AddNodeTargetInput struct {
	IP string `json:"ip"`
}

type ReorderNodeTargetsInput struct {
	TargetIDs []uint `json:"target_ids"`
}

type NodeListItem struct {
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

type KomariBindingCandidate struct {
	NodeID             uint   `json:"node_id"`
	NodeName           string `json:"node_name"`
	KomariNodeUUID     string `json:"komari_node_uuid"`
	KomariNodeName     string `json:"komari_node_name"`
	HasExistingBinding bool   `json:"has_existing_binding"`
}

type NodeTargetListItem struct {
	ID         uint       `json:"id"`
	IP         string     `json:"ip"`
	Source     string     `json:"source"`
	Enabled    bool       `json:"enabled"`
	HasData    bool       `json:"has_data"`
	UpdatedAt  *time.Time `json:"updated_at"`
	LastSeenAt *time.Time `json:"last_seen_at"`
	SortOrder  int        `json:"sort_order"`
}

type NodeTargetDetail struct {
	ID         uint           `json:"id"`
	IP         string         `json:"ip"`
	Source     string         `json:"source"`
	Enabled    bool           `json:"enabled"`
	HasData    bool           `json:"has_data"`
	UpdatedAt  *time.Time     `json:"updated_at"`
	LastSeenAt *time.Time     `json:"last_seen_at"`
	Result     map[string]any `json:"current_result"`
}

type PublicTargetListItem struct {
	ID        uint       `json:"id"`
	Label     string     `json:"label"`
	HasData   bool       `json:"has_data"`
	UpdatedAt *time.Time `json:"updated_at"`
	SortOrder int        `json:"sort_order"`
}

type PublicTargetDetail struct {
	ID        uint           `json:"id"`
	Label     string         `json:"label"`
	HasData   bool           `json:"has_data"`
	UpdatedAt *time.Time     `json:"updated_at"`
	Result    map[string]any `json:"current_result"`
}

type NodeReportConfig struct {
	EndpointPath   string      `json:"endpoint_path"`
	InstallerPath  string      `json:"installer_path"`
	ReporterToken  string      `json:"reporter_token"`
	InstallToken   string      `json:"install_token"`
	TargetIPs      []string    `json:"target_ips"`
	ScheduleCron   string      `json:"schedule_cron"`
	Timezone       string      `json:"timezone"`
	RunImmediately bool        `json:"run_immediately"`
	NextRuns       []time.Time `json:"next_runs"`
}

type NodeInstallConfig struct {
	NodeUUID       string   `json:"node_uuid"`
	ReportEndpoint string   `json:"report_endpoint"`
	ReporterToken  string   `json:"reporter_token"`
	ScheduleCron   string   `json:"schedule_cron"`
	Timezone       string   `json:"timezone"`
	RunImmediately bool     `json:"run_immediately"`
	TargetIPs      []string `json:"target_ips"`
}

type NodeDetail struct {
	ID               uint                 `json:"id"`
	NodeUUID         string               `json:"node_uuid"`
	KomariNodeUUID   string               `json:"komari_node_uuid"`
	KomariNodeName   string               `json:"komari_node_name"`
	HasKomariBinding bool                 `json:"has_komari_binding"`
	NeedsConnect     bool                 `json:"needs_connect"`
	Name             string               `json:"name"`
	HasData          bool                 `json:"has_data"`
	UpdatedAt        *time.Time           `json:"updated_at"`
	Targets          []NodeTargetListItem `json:"targets"`
	SelectedTargetID *uint                `json:"selected_target_id"`
	CurrentTarget    *NodeTargetDetail    `json:"current_target"`
	ReportConfig     NodeReportConfig     `json:"report_config"`
}

type PublicNodeDetail struct {
	HasData          bool                   `json:"has_data"`
	Targets          []PublicTargetListItem `json:"targets"`
	SelectedTargetID *uint                  `json:"selected_target_id"`
	CurrentTarget    *PublicTargetDetail    `json:"current_target"`
}

type NodeHistoryEntry struct {
	ID         uint           `json:"id"`
	TargetID   uint           `json:"target_id"`
	TargetIP   string         `json:"target_ip"`
	IsFavorite bool           `json:"is_favorite"`
	RecordedAt time.Time      `json:"recorded_at"`
	Summary    string         `json:"summary"`
	Result     map[string]any `json:"result"`
}

type NodeHistoryPage struct {
	Items      []NodeHistoryEntry `json:"items"`
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	TotalPages int                `json:"total_pages"`
}

type ReportNodeInput struct {
	TargetIP   string         `json:"target_ip"`
	Summary    string         `json:"summary"`
	Result     map[string]any `json:"result"`
	RecordedAt *time.Time     `json:"recorded_at"`
}

type ReportPlanInput struct {
	CandidateIPs     []string              `json:"candidate_ips"`
	AgentVersion     string                `json:"agent_version"`
	Hostname         string                `json:"hostname"`
	InterfaceSummary []ReportPlanInterface `json:"interface_summary"`
}

type ReportPlanInterface struct {
	Name string   `json:"name"`
	IPs  []string `json:"ips"`
}

type ReportPlanTarget struct {
	TargetID uint   `json:"target_id"`
	TargetIP string `json:"target_ip"`
	Source   string `json:"source"`
	Enabled  bool   `json:"enabled"`
}

type ReportPlan struct {
	ApprovedTargets []ReportPlanTarget `json:"approved_targets"`
	ScheduleCron    string             `json:"schedule_cron"`
	Timezone        string             `json:"timezone"`
	RunImmediately  bool               `json:"run_immediately"`
}

func newReporterToken() (string, error) {
	return auth.NewSessionToken()
}

func newInstallToken() (string, error) {
	return auth.NewInstallToken()
}

func newStandaloneNodeUUID() (string, error) {
	return auth.NewInstallToken()
}

func buildAutoBoundNodeName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "未命名节点"
	}
	return trimmed + "（自动绑定）"
}

func hasAutoBoundNodeName(nodeName string, komariName string) bool {
	trimmedNodeName := strings.TrimSpace(nodeName)
	trimmedKomariName := strings.TrimSpace(komariName)
	return trimmedNodeName == trimmedKomariName || trimmedNodeName == buildAutoBoundNodeName(trimmedKomariName)
}

func ensureNodeReporterDefaults(node *models.Node) error {
	if node == nil {
		return nil
	}
	if strings.TrimSpace(node.ReporterToken) == "" {
		token, err := newReporterToken()
		if err != nil {
			return err
		}
		node.ReporterToken = token
	}
	if strings.TrimSpace(node.InstallToken) == "" {
		token, err := newInstallToken()
		if err != nil {
			return err
		}
		node.InstallToken = token
	}
	if strings.TrimSpace(node.ReporterScheduleCron) == "" {
		node.ReporterScheduleCron = defaultReporterScheduleCron
	}
	if strings.TrimSpace(node.ReporterTimezone) == "" {
		node.ReporterTimezone = defaultReporterTimezone
	}
	return nil
}

func isStandaloneInternalNode(node models.Node) bool {
	return strings.HasPrefix(strings.TrimSpace(node.KomariNodeUUID), standaloneKomariNodeUUIDPrefix)
}

func isStandaloneInternalUUID(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), standaloneKomariNodeUUIDPrefix)
}

func isInvalidKomariCandidateName(name string) bool {
	normalized := strings.TrimSpace(strings.ToLower(name))
	switch normalized {
	case "", "未命名节点", "komari monitor":
		return true
	default:
		return false
	}
}

func isKomariShadowNode(db *gorm.DB, node models.Node) bool {
	if db == nil || node.ID == 0 || node.HasData || isStandaloneInternalNode(node) {
		return false
	}
	binding, err := loadKomariBinding(db, node.ID)
	if err != nil || binding != nil {
		return false
	}
	var targetCount int64
	if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", node.ID).Count(&targetCount).Error; err != nil {
		return false
	}
	return targetCount == 0
}

func canAdoptKomariShadowNode(db *gorm.DB, nodeID uint, komariNodeUUID string) bool {
	if db == nil || nodeID == 0 {
		return false
	}
	var node models.Node
	if err := db.First(&node, "id = ?", nodeID).Error; err != nil {
		return false
	}
	if strings.TrimSpace(node.KomariNodeUUID) != strings.TrimSpace(komariNodeUUID) {
		return false
	}
	return isKomariShadowNode(db, node)
}

func SyncKomariNode(db *gorm.DB, input RegisterNodeInput) (*models.Node, bool, error) {
	if strings.TrimSpace(input.KomariNodeUUID) == "" || strings.TrimSpace(input.Name) == "" {
		return nil, false, errors.New("uuid and name are required")
	}

	var binding models.KomariBinding
	if err := db.Preload("Node").First(&binding, "komari_node_uuid = ?", input.KomariNodeUUID).Error; err == nil {
		oldKomariName := binding.KomariNodeName
		binding.KomariNodeName = input.Name
		if hasAutoBoundNodeName(binding.Node.Name, oldKomariName) {
			binding.Node.Name = buildAutoBoundNodeName(input.Name)
		}
		if err := ensureNodeReporterDefaults(&binding.Node); err != nil {
			return nil, true, err
		}
		if saveErr := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(&binding.Node).Error; err != nil {
				return err
			}
			return tx.Save(&binding).Error
		}); saveErr != nil {
			return nil, true, saveErr
		}
		return &binding.Node, true, nil
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if err == nil {
		node.Name = input.Name
		if err := ensureNodeReporterDefaults(&node); err != nil {
			return nil, true, err
		}
		if saveErr := db.Save(&node).Error; saveErr != nil {
			return nil, true, saveErr
		}
		return &node, true, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, false, err
	}

	node = models.Node{
		KomariNodeUUID:         input.KomariNodeUUID,
		Name:                   input.Name,
		ReporterScheduleCron:   defaultReporterScheduleCron,
		ReporterTimezone:       defaultReporterTimezone,
		ReporterRunImmediately: true,
	}
	if err := ensureNodeReporterDefaults(&node); err != nil {
		return nil, false, err
	}
	if err := db.Create(&node).Error; err != nil {
		return nil, false, err
	}
	return &node, false, nil
}

func RegisterNode(db *gorm.DB, _ config.Config, input RegisterNodeInput) (*models.Node, bool, error) {
	if strings.TrimSpace(input.KomariNodeUUID) == "" || strings.TrimSpace(input.Name) == "" {
		return nil, false, errors.New("uuid and name are required")
	}

	autoBoundName := buildAutoBoundNodeName(input.Name)

	var binding models.KomariBinding
	if err := db.Preload("Node").First(&binding, "komari_node_uuid = ?", input.KomariNodeUUID).Error; err == nil {
		oldKomariName := binding.KomariNodeName
		binding.KomariNodeName = input.Name
		if canMigrateKomariShellNode(db, binding.NodeID, binding.KomariNodeUUID) || hasAutoBoundNodeName(binding.Node.Name, oldKomariName) {
			binding.Node.Name = autoBoundName
		}
		if binding.BindingSource == "from_komari" {
			binding.BindingSource = "auto"
		}
		if err := ensureNodeReporterDefaults(&binding.Node); err != nil {
			return nil, true, err
		}
		if saveErr := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(&binding.Node).Error; err != nil {
				return err
			}
			return tx.Save(&binding).Error
		}); saveErr != nil {
			return nil, true, saveErr
		}
		return &binding.Node, true, nil
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if err == nil {
		node.Name = autoBoundName
		if err := ensureNodeReporterDefaults(&node); err != nil {
			return nil, true, err
		}
		if saveErr := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(&node).Error; err != nil {
				return err
			}
			return tx.Create(&models.KomariBinding{
				NodeID:         node.ID,
				KomariNodeUUID: input.KomariNodeUUID,
				KomariNodeName: input.Name,
				BindingSource:  "auto",
			}).Error
		}); saveErr != nil {
			return nil, true, saveErr
		}
		return &node, true, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, false, err
	}

	reporterToken, err := newReporterToken()
	if err != nil {
		return nil, false, err
	}
	installToken, err := newInstallToken()
	if err != nil {
		return nil, false, err
	}

	node = models.Node{
		KomariNodeUUID:         input.KomariNodeUUID,
		Name:                   autoBoundName,
		ReporterToken:          reporterToken,
		InstallToken:           installToken,
		ReporterScheduleCron:   defaultReporterScheduleCron,
		ReporterTimezone:       defaultReporterTimezone,
		ReporterRunImmediately: true,
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&node).Error; err != nil {
			return err
		}
		return tx.Create(&models.KomariBinding{
			NodeID:         node.ID,
			KomariNodeUUID: node.KomariNodeUUID,
			KomariNodeName: input.Name,
			BindingSource:  "auto",
		}).Error
	}); err != nil {
		return nil, false, err
	}
	return &node, false, nil
}

func CreateStandaloneNode(db *gorm.DB, name string) (*models.Node, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, errors.New("name is required")
	}
	internalUUID, err := newStandaloneNodeUUID()
	if err != nil {
		return nil, err
	}
	reporterToken, err := newReporterToken()
	if err != nil {
		return nil, err
	}
	installToken, err := newInstallToken()
	if err != nil {
		return nil, err
	}
	node := models.Node{
		KomariNodeUUID:         "ipq-" + internalUUID,
		Name:                   trimmedName,
		ReporterToken:          reporterToken,
		InstallToken:           installToken,
		ReporterScheduleCron:   defaultReporterScheduleCron,
		ReporterTimezone:       defaultReporterTimezone,
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func UpdateNodeName(db *gorm.DB, uuid string, name string) (*models.Node, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, errors.New("name is required")
	}
	node, err := loadNodeByUUID(db, uuid)
	if err != nil {
		return nil, err
	}
	if err := db.Model(&node).Update("name", trimmedName).Error; err != nil {
		return nil, err
	}
	node.Name = trimmedName

	var binding models.KomariBinding
	if err := db.First(&binding, "node_id = ?", node.ID).Error; err == nil && strings.TrimSpace(binding.KomariNodeName) == "" {
		_ = db.Model(&binding).Update("komari_node_name", trimmedName).Error
	}

	return &node, nil
}

func BindNodeToKomari(db *gorm.DB, nodeID uint, komariNodeUUID string, komariNodeName string) (*models.KomariBinding, error) {
	if nodeID == 0 {
		return nil, errors.New("node id is required")
	}
	komariNodeUUID = strings.TrimSpace(komariNodeUUID)
	komariNodeName = strings.TrimSpace(komariNodeName)
	if komariNodeUUID == "" || komariNodeName == "" {
		return nil, errors.New("komari node uuid and name are required")
	}

	var node models.Node
	if err := db.First(&node, "id = ?", nodeID).Error; err != nil {
		return nil, err
	}

	var result models.KomariBinding
	if err := db.Transaction(func(tx *gorm.DB) error {
		var currentBinding models.KomariBinding
		hasCurrentBinding := tx.First(&currentBinding, "node_id = ?", nodeID).Error == nil

		var existingBinding models.KomariBinding
		if err := tx.First(&existingBinding, "komari_node_uuid = ?", komariNodeUUID).Error; err == nil && existingBinding.NodeID != nodeID {
			if !canMigrateKomariShellNode(tx, existingBinding.NodeID, komariNodeUUID) {
				return errors.New("komari node already bound")
			}
			if err := tx.Delete(&models.KomariBinding{}, "node_id = ?", existingBinding.NodeID).Error; err != nil {
				return err
			}
			if err := tx.Delete(&models.Node{}, "id = ?", existingBinding.NodeID).Error; err != nil {
				return err
			}
		}

		var existingNode models.Node
		if err := tx.First(&existingNode, "komari_node_uuid = ?", komariNodeUUID).Error; err == nil && existingNode.ID != nodeID {
			if !canAdoptKomariShadowNode(tx, existingNode.ID, komariNodeUUID) {
				return errors.New("komari node already bound")
			}
			if err := tx.Delete(&models.Node{}, "id = ?", existingNode.ID).Error; err != nil {
				return err
			}
		}

		if hasCurrentBinding {
			currentBinding.KomariNodeUUID = komariNodeUUID
			currentBinding.KomariNodeName = komariNodeName
			currentBinding.BindingSource = "manual"
			if err := tx.Save(&currentBinding).Error; err != nil {
				return err
			}
			result = currentBinding
			return nil
		}

		binding := models.KomariBinding{
			NodeID:         nodeID,
			KomariNodeUUID: komariNodeUUID,
			KomariNodeName: komariNodeName,
			BindingSource:  "manual",
		}
		if err := tx.Create(&binding).Error; err != nil {
			return err
		}
		result = binding
		return nil
	}); err != nil {
		return nil, err
	}
	return &result, nil
}

func UnbindNodeFromKomari(db *gorm.DB, nodeID uint) error {
	if nodeID == 0 {
		return errors.New("node id is required")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var binding models.KomariBinding
		if err := tx.First(&binding, "node_id = ?", nodeID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.KomariBinding{}, "node_id = ?", nodeID).Error; err != nil {
			return err
		}
		var node models.Node
		if err := tx.First(&node, "id = ?", nodeID).Error; err != nil {
			return err
		}
		if strings.TrimSpace(node.KomariNodeUUID) == strings.TrimSpace(binding.KomariNodeUUID) {
			internalUUID, err := newStandaloneNodeUUID()
			if err != nil {
				return err
			}
			return tx.Model(&node).Update("komari_node_uuid", standaloneKomariNodeUUIDPrefix+internalUUID).Error
		}
		return nil
	})
}

func ListNodes(db *gorm.DB, keyword string) ([]NodeListItem, error) {
	var nodes []models.Node
	query := db.Order("has_data DESC").Order("current_result_updated_at DESC").Order("created_at DESC")
	if err := query.Find(&nodes).Error; err != nil {
		return nil, err
	}
	normalizedKeyword := strings.TrimSpace(strings.ToLower(keyword))

	items := make([]NodeListItem, 0, len(nodes))
	for _, node := range nodes {
		binding, _ := loadKomariBinding(db, node.ID)
		if binding != nil && isStandaloneInternalUUID(binding.KomariNodeUUID) {
			binding = nil
		}
		if binding == nil && isKomariShadowNode(db, node) {
			continue
		}
		if binding != nil && canMigrateKomariShellNode(db, node.ID, binding.KomariNodeUUID) {
			continue
		}
		komariNodeUUID := node.KomariNodeUUID
		komariNodeName := node.Name
		hasKomariBinding := false
		if binding != nil {
			komariNodeUUID = binding.KomariNodeUUID
			komariNodeName = binding.KomariNodeName
			hasKomariBinding = true
		}
		if normalizedKeyword != "" {
			candidates := []string{
				node.Name,
				node.NodeUUID,
				node.KomariNodeUUID,
				komariNodeUUID,
				komariNodeName,
			}
			matched := false
			for _, candidate := range candidates {
				if strings.Contains(strings.ToLower(strings.TrimSpace(candidate)), normalizedKeyword) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		items = append(items, NodeListItem{
			ID:               node.ID,
			NodeUUID:         node.NodeUUID,
			KomariNodeUUID:   komariNodeUUID,
			KomariNodeName:   komariNodeName,
			HasKomariBinding: hasKomariBinding,
			Name:             node.Name,
			HasData:          node.HasData,
			UpdatedAt:        node.CurrentResultUpdatedAt,
			CreatedAt:        node.CreatedAt,
		})
	}
	return items, nil
}

func ListKomariBindingCandidates(db *gorm.DB) ([]KomariBindingCandidate, error) {
	var nodes []models.Node
	if err := db.Order("created_at ASC").Find(&nodes).Error; err != nil {
		return nil, err
	}
	items := make([]KomariBindingCandidate, 0, len(nodes))
	seen := make(map[string]struct{}, len(nodes))
	for _, node := range nodes {
		if !isKomariShadowNode(db, node) || isInvalidKomariCandidateName(node.Name) {
			continue
		}
		komariNodeUUID := strings.TrimSpace(node.KomariNodeUUID)
		if komariNodeUUID == "" {
			continue
		}
		items = append(items, KomariBindingCandidate{
			NodeID:             node.ID,
			NodeName:           "",
			KomariNodeUUID:     komariNodeUUID,
			KomariNodeName:     node.Name,
			HasExistingBinding: false,
		})
		seen[komariNodeUUID] = struct{}{}
	}

	var bindings []models.KomariBinding
	if err := db.Order("created_at ASC").Find(&bindings).Error; err != nil {
		return nil, err
	}
	for _, binding := range bindings {
		if isStandaloneInternalUUID(binding.KomariNodeUUID) {
			continue
		}
		if _, exists := seen[binding.KomariNodeUUID]; exists {
			continue
		}
		var node models.Node
		if err := db.First(&node, "id = ?", binding.NodeID).Error; err != nil {
			continue
		}
		if canMigrateKomariShellNode(db, binding.NodeID, binding.KomariNodeUUID) {
			if isInvalidKomariCandidateName(binding.KomariNodeName) {
				continue
			}
			items = append(items, KomariBindingCandidate{
				NodeID:             binding.NodeID,
				NodeName:           "",
				KomariNodeUUID:     binding.KomariNodeUUID,
				KomariNodeName:     binding.KomariNodeName,
				HasExistingBinding: false,
			})
			seen[binding.KomariNodeUUID] = struct{}{}
			continue
		}
		items = append(items, KomariBindingCandidate{
			NodeID:             binding.NodeID,
			NodeName:           node.Name,
			KomariNodeUUID:     binding.KomariNodeUUID,
			KomariNodeName:     binding.KomariNodeName,
			HasExistingBinding: true,
		})
		seen[binding.KomariNodeUUID] = struct{}{}
	}
	return items, nil
}

func GetNodeDetail(db *gorm.DB, uuid string, selectedTargetID *uint) (NodeDetail, error) {
	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeDetail{}, err
	}
	binding, _ := loadKomariBinding(db, node.ID)
	if binding != nil && isStandaloneInternalUUID(binding.KomariNodeUUID) {
		binding = nil
	}
	needsConnect := false
	if binding == nil {
		needsConnect = isKomariShadowNode(db, node)
	} else if canMigrateKomariShellNode(db, node.ID, binding.KomariNodeUUID) {
		needsConnect = true
	}

	selected, err := selectNodeTarget(targets, selectedTargetID)
	if err != nil {
		return NodeDetail{}, err
	}

	targetItems := make([]NodeTargetListItem, 0, len(targets))
	reportIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetItems = append(targetItems, NodeTargetListItem{
			ID:         target.ID,
			IP:         target.TargetIP,
			Source:     target.Source,
			Enabled:    target.Enabled,
			HasData:    target.HasData,
			UpdatedAt:  target.CurrentResultUpdatedAt,
			LastSeenAt: target.LastSeenAt,
			SortOrder:  target.SortOrder,
		})
		reportIPs = append(reportIPs, target.TargetIP)
	}

	reportConfig, err := buildNodeReportConfig(node, reportIPs)
	if err != nil {
		return NodeDetail{}, err
	}

	komariNodeUUID := node.KomariNodeUUID
	komariNodeName := node.Name
	hasKomariBinding := false
	if binding != nil && !needsConnect {
		komariNodeUUID = binding.KomariNodeUUID
		komariNodeName = binding.KomariNodeName
		hasKomariBinding = true
	}

	detail := NodeDetail{
		ID:               node.ID,
		NodeUUID:         node.NodeUUID,
		KomariNodeUUID:   komariNodeUUID,
		KomariNodeName:   komariNodeName,
		HasKomariBinding: hasKomariBinding,
		NeedsConnect:     needsConnect,
		Name:             node.Name,
		HasData:          node.HasData,
		UpdatedAt:        node.CurrentResultUpdatedAt,
		Targets:          targetItems,
		ReportConfig:     reportConfig,
	}

	if selected != nil {
		detail.SelectedTargetID = &selected.ID
		detail.CurrentTarget = &NodeTargetDetail{
			ID:         selected.ID,
			IP:         selected.TargetIP,
			Source:     selected.Source,
			Enabled:    selected.Enabled,
			HasData:    selected.HasData,
			UpdatedAt:  selected.CurrentResultUpdatedAt,
			LastSeenAt: selected.LastSeenAt,
			Result:     decodeResultJSON(selected.CurrentResultJSON),
		}
	}

	return detail, nil
}

func GetNodeHistory(db *gorm.DB, uuid string, selectedTargetID *uint, limit, page, pageSize int, startAt, endAt *time.Time) (NodeHistoryPage, error) {
	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeHistoryPage{}, err
	}

	_, scopedTargets, err := resolveHistoryTargetScope(targets, selectedTargetID)
	if err != nil {
		return NodeHistoryPage{}, err
	}
	if len(targets) == 0 {
		return NodeHistoryPage{
			Items:      []NodeHistoryEntry{},
			Total:      0,
			Page:       1,
			PageSize:   normalizeHistoryPageSize(limit, pageSize),
			TotalPages: 0,
		}, nil
	}

	targetByID := make(map[uint]models.NodeTarget, len(targets))
	for _, target := range targets {
		targetByID[target.ID] = target
	}
	targetScope := make([]uint, 0, len(scopedTargets))
	for _, target := range scopedTargets {
		targetScope = append(targetScope, target.ID)
	}

	baseQuery := db.Model(&models.NodeTargetHistory{}).Where("node_target_id IN ?", targetScope)
	baseQuery = applyHistoryRange(baseQuery, startAt, endAt)
	var total int64
	if err := baseQuery.Count(&total).Error; err != nil {
		return NodeHistoryPage{}, err
	}

	var history []models.NodeTargetHistory
	query := db.Where("node_target_id IN ?", targetScope).Order("recorded_at DESC")
	query = applyHistoryRange(query, startAt, endAt)
	if limit > 0 {
		query = query.Limit(limit)
		page = 1
		pageSize = limit
	} else {
		page = normalizeHistoryPage(page)
		pageSize = normalizeHistoryPageSize(limit, pageSize)
		query = query.Offset((page - 1) * pageSize).Limit(pageSize)
	}
	if err := query.Find(&history).Error; err != nil {
		return NodeHistoryPage{}, err
	}

	items := make([]NodeHistoryEntry, 0, len(history))
	for _, item := range history {
		target := targetByID[item.NodeTargetID]
		items = append(items, NodeHistoryEntry{
			ID:         item.ID,
			TargetID:   item.NodeTargetID,
			TargetIP:   target.TargetIP,
			IsFavorite: item.IsFavorite,
			RecordedAt: item.RecordedAt,
			Summary:    item.Summary,
			Result:     decodeResultJSON(item.ResultJSON),
		})
	}

	totalPages := 0
	if pageSize > 0 && total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}

	return NodeHistoryPage{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func SetNodeHistoryFavorite(db *gorm.DB, uuid string, selectedTargetID *uint, historyID uint, favorite bool) (NodeHistoryEntry, error) {
	if historyID == 0 {
		return NodeHistoryEntry{}, errors.New("history id is required")
	}

	_, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeHistoryEntry{}, err
	}

	_, scopedTargets, err := resolveHistoryTargetScope(targets, selectedTargetID)
	if err != nil {
		return NodeHistoryEntry{}, err
	}
	if len(scopedTargets) == 0 {
		return NodeHistoryEntry{}, gorm.ErrRecordNotFound
	}

	targetByID := make(map[uint]models.NodeTarget, len(targets))
	targetScope := make([]uint, 0, len(scopedTargets))
	for _, target := range targets {
		targetByID[target.ID] = target
	}
	for _, target := range scopedTargets {
		targetScope = append(targetScope, target.ID)
	}

	var history models.NodeTargetHistory
	if err := db.Where("id = ? AND node_target_id IN ?", historyID, targetScope).First(&history).Error; err != nil {
		return NodeHistoryEntry{}, err
	}
	if err := db.Model(&history).Update("is_favorite", favorite).Error; err != nil {
		return NodeHistoryEntry{}, err
	}
	history.IsFavorite = favorite

	target := targetByID[history.NodeTargetID]
	return NodeHistoryEntry{
		ID:         history.ID,
		TargetID:   target.ID,
		TargetIP:   target.TargetIP,
		IsFavorite: history.IsFavorite,
		RecordedAt: history.RecordedAt,
		Summary:    history.Summary,
		Result:     decodeResultJSON(history.ResultJSON),
	}, nil
}

func GetPublicNodeDetail(db *gorm.DB, uuid string, selectedTargetID *uint, displayIP string) (PublicNodeDetail, error) {
	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return PublicNodeDetail{}, err
	}

	selected, err := selectNodeTarget(targets, selectedTargetID)
	if err != nil {
		return PublicNodeDetail{}, err
	}

	detail := PublicNodeDetail{
		HasData: node.HasData,
		Targets: make([]PublicTargetListItem, 0, len(targets)),
	}
	for index, target := range targets {
		detail.Targets = append(detail.Targets, PublicTargetListItem{
			ID:        target.ID,
			Label:     publicTargetLabel(index),
			HasData:   target.HasData,
			UpdatedAt: target.CurrentResultUpdatedAt,
			SortOrder: target.SortOrder,
		})
	}

	if selected != nil {
		result := sanitizePublicCurrentResult(decodeResultJSON(selected.CurrentResultJSON))
		if len(targets) > 0 && targets[0].ID == selected.ID {
			applyPublicDisplayIP(result, displayIP)
		} else {
			applyPublicDisplayIP(result, "")
		}
		detail.SelectedTargetID = &selected.ID
		selectedIndex := 0
		for i, target := range targets {
			if target.ID == selected.ID {
				selectedIndex = i
				break
			}
		}
		detail.CurrentTarget = &PublicTargetDetail{
			ID:        selected.ID,
			Label:     publicTargetLabel(selectedIndex),
			HasData:   selected.HasData,
			UpdatedAt: selected.CurrentResultUpdatedAt,
			Result:    result,
		}
	}

	return detail, nil
}

func AddNodeTarget(db *gorm.DB, cfg config.Config, uuid string, input AddNodeTargetInput) (NodeTargetListItem, error) {
	ip, err := normalizeTargetIP(input.IP)
	if err != nil {
		return NodeTargetListItem{}, err
	}

	var node models.Node
	if loaded, err := loadNodeByUUID(db, uuid); err != nil {
		return NodeTargetListItem{}, err
	} else {
		node = loaded
	}

	existingTarget, err := findNodeTargetByNormalizedIP(db, node.ID, ip)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return NodeTargetListItem{}, err
	}
	if existingTarget != nil {
		return NodeTargetListItem{}, errors.New("ip already exists")
	}

	var created models.NodeTarget
	if err := db.Transaction(func(tx *gorm.DB) error {
		sortOrder, err := nextNodeTargetSortOrder(tx, node.ID)
		if err != nil {
			return err
		}

		created = models.NodeTarget{
			NodeID:    node.ID,
			TargetIP:  ip,
			Source:    "manual",
			Enabled:   true,
			SortOrder: sortOrder,
		}

		if cfg.IsDevelopment() {
			raw, summary, updatedAt, err := sampledata.DefaultTargetResult(node.KomariNodeUUID, node.Name, ip)
			if err != nil {
				return err
			}
			created.HasData = true
			created.CurrentSummary = summary
			created.CurrentResultJSON = raw
			created.CurrentResultUpdatedAt = &updatedAt
		}

		if err := tx.Create(&created).Error; err != nil {
			return err
		}

		if created.HasData && created.CurrentResultUpdatedAt != nil {
			history := models.NodeTargetHistory{
				NodeTargetID: created.ID,
				ResultJSON:   created.CurrentResultJSON,
				Summary:      created.CurrentSummary,
				RecordedAt:   created.CurrentResultUpdatedAt.UTC(),
			}
			if err := tx.Create(&history).Error; err != nil {
				return err
			}
		}

		return recomputeNodeState(tx, node.ID)
	}); err != nil {
		return NodeTargetListItem{}, err
	}

	return NodeTargetListItem{
		ID:         created.ID,
		IP:         created.TargetIP,
		Source:     created.Source,
		Enabled:    created.Enabled,
		HasData:    created.HasData,
		UpdatedAt:  created.CurrentResultUpdatedAt,
		LastSeenAt: created.LastSeenAt,
		SortOrder:  created.SortOrder,
	}, nil
}

func DeleteNodeTarget(db *gorm.DB, uuid string, targetID uint) error {
	if targetID == 0 {
		return errors.New("target id is required")
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var node models.Node
		loadedNode, err := loadNodeByUUID(tx, uuid)
		if err != nil {
			return err
		}
		node = loadedNode

		var target models.NodeTarget
		if err := tx.First(&target, "id = ? AND node_id = ?", targetID, node.ID).Error; err != nil {
			return err
		}

		if err := PruneNotificationScopesForDeletedTarget(tx, target.ID); err != nil {
			return err
		}
		if err := tx.Where("node_target_id = ?", target.ID).Delete(&models.NodeTargetHistory{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&target).Error; err != nil {
			return err
		}
		if err := normalizeNodeTargetSortOrder(tx, node.ID); err != nil {
			return err
		}
		return recomputeNodeState(tx, node.ID)
	})
}

func SetNodeTargetEnabled(db *gorm.DB, uuid string, targetID uint, enabled bool) (NodeTargetListItem, error) {
	if targetID == 0 {
		return NodeTargetListItem{}, errors.New("target id is required")
	}

	var node models.Node
	if loaded, err := loadNodeByUUID(db, uuid); err != nil {
		return NodeTargetListItem{}, err
	} else {
		node = loaded
	}

	var target models.NodeTarget
	if err := db.First(&target, "id = ? AND node_id = ?", targetID, node.ID).Error; err != nil {
		return NodeTargetListItem{}, err
	}

	if err := db.Model(&target).Update("enabled", enabled).Error; err != nil {
		return NodeTargetListItem{}, err
	}
	target.Enabled = enabled

	return NodeTargetListItem{
		ID:         target.ID,
		IP:         target.TargetIP,
		Source:     target.Source,
		Enabled:    target.Enabled,
		HasData:    target.HasData,
		UpdatedAt:  target.CurrentResultUpdatedAt,
		LastSeenAt: target.LastSeenAt,
		SortOrder:  target.SortOrder,
	}, nil
}

func ReorderNodeTargets(db *gorm.DB, uuid string, input ReorderNodeTargetsInput) error {
	if len(input.TargetIDs) == 0 {
		return errors.New("target_ids is required")
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var node models.Node
		loadedNode, err := loadNodeByUUID(tx, uuid)
		if err != nil {
			return err
		}
		node = loadedNode

		var targets []models.NodeTarget
		if err := tx.Where("node_id = ?", node.ID).Find(&targets).Error; err != nil {
			return err
		}
		if len(targets) != len(input.TargetIDs) {
			return errors.New("target_ids mismatch")
		}

		existing := make(map[uint]struct{}, len(targets))
		for _, target := range targets {
			existing[target.ID] = struct{}{}
		}
		seen := make(map[uint]struct{}, len(input.TargetIDs))
		for _, targetID := range input.TargetIDs {
			if _, ok := existing[targetID]; !ok {
				return errors.New("target_ids mismatch")
			}
			if _, ok := seen[targetID]; ok {
				return errors.New("target_ids mismatch")
			}
			seen[targetID] = struct{}{}
		}
		if len(seen) != len(existing) {
			return errors.New("target_ids mismatch")
		}

		for index, targetID := range input.TargetIDs {
			if err := tx.Model(&models.NodeTarget{}).
				Where("id = ? AND node_id = ?", targetID, node.ID).
				Update("sort_order", index).
				Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func GetNodeReportPlan(db *gorm.DB, uuid, token string, input ReportPlanInput) (ReportPlan, error) {
	if strings.TrimSpace(token) == "" {
		return ReportPlan{}, errors.New("missing reporter token")
	}

	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return ReportPlan{}, err
	}
	if node.ReporterToken == "" || token != node.ReporterToken {
		return ReportPlan{}, errors.New("invalid reporter token")
	}

	normalizedIPs := make([]string, 0, len(input.CandidateIPs))
	seen := make(map[string]struct{}, len(input.CandidateIPs))
	for _, candidate := range input.CandidateIPs {
		normalized, normalizeErr := normalizeTargetIP(candidate)
		if normalizeErr != nil {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		normalizedIPs = append(normalizedIPs, normalized)
	}

	if len(normalizedIPs) > 0 {
		if err := db.Transaction(func(tx *gorm.DB) error {
			currentNode, currentTargets, loadErr := loadNodeWithTargets(tx, uuid)
			if loadErr != nil {
				return loadErr
			}
			existing := make(map[string]models.NodeTarget, len(currentTargets))
			for _, target := range currentTargets {
				existing[target.TargetIP] = target
			}

			nextSortOrder := len(currentTargets)
			for _, candidate := range normalizedIPs {
				if _, ok := existing[candidate]; ok {
					continue
				}
				target := models.NodeTarget{
					NodeID:    currentNode.ID,
					TargetIP:  candidate,
					Source:    "discovered",
					Enabled:   true,
					SortOrder: nextSortOrder,
				}
				if err := tx.Create(&target).Error; err != nil {
					return err
				}
				nextSortOrder += 1
			}
			return nil
		}); err != nil {
			return ReportPlan{}, err
		}
		_, targets, err = loadNodeWithTargets(db, uuid)
		if err != nil {
			return ReportPlan{}, err
		}
	}

	approvedTargets := make([]ReportPlanTarget, 0, len(targets))
	candidateSet := make(map[string]struct{}, len(normalizedIPs))
	for _, ip := range normalizedIPs {
		candidateSet[ip] = struct{}{}
	}

	for _, target := range targets {
		if !target.Enabled {
			continue
		}
		if target.Source == "manual" {
			approvedTargets = append(approvedTargets, ReportPlanTarget{
				TargetID: target.ID,
				TargetIP: target.TargetIP,
				Source:   target.Source,
				Enabled:  target.Enabled,
			})
			continue
		}
		if len(candidateSet) > 0 {
			if _, ok := candidateSet[target.TargetIP]; !ok {
				continue
			}
		}
		approvedTargets = append(approvedTargets, ReportPlanTarget{
			TargetID: target.ID,
			TargetIP: target.TargetIP,
			Source:   target.Source,
			Enabled:  target.Enabled,
		})
	}

	scheduleCron, timezone, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return ReportPlan{}, err
	}
	normalizedTimezone, _, err := parseReporterTimezone(timezone)
	if err != nil {
		return ReportPlan{}, err
	}

	return ReportPlan{
		ApprovedTargets: approvedTargets,
		ScheduleCron:    normalizedCron,
		Timezone:        normalizedTimezone,
		RunImmediately:  runImmediately,
	}, nil
}

func DeleteNode(db *gorm.DB, uuid string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var node models.Node
		loadedNode, err := loadNodeByUUID(tx, uuid)
		if err != nil {
			return err
		}
		node = loadedNode
		var targets []models.NodeTarget
		if err := tx.Where("node_id = ?", node.ID).Find(&targets).Error; err != nil {
			return err
		}
		if len(targets) > 0 {
			targetIDs := make([]uint, 0, len(targets))
			for _, target := range targets {
				targetIDs = append(targetIDs, target.ID)
			}
			if err := tx.Where("node_target_id IN ?", targetIDs).Delete(&models.NodeTargetHistory{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("node_id = ?", node.ID).Delete(&models.NodeHistory{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", node.ID).Delete(&models.KomariBinding{}).Error; err != nil {
			return err
		}
		if err := PruneNotificationScopesForDeletedNode(tx, node.ID); err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", node.ID).Delete(&models.NodeTarget{}).Error; err != nil {
			return err
		}
		return tx.Delete(&node).Error
	})
}

func RotateNodeReporterToken(db *gorm.DB, uuid string) (NodeReportConfig, error) {
	var node models.Node
	if loaded, err := loadNodeByUUID(db, uuid); err != nil {
		return NodeReportConfig{}, err
	} else {
		node = loaded
	}

	token, err := newReporterToken()
	if err != nil {
		return NodeReportConfig{}, err
	}
	if err := db.Model(&node).Update("reporter_token", token).Error; err != nil {
		return NodeReportConfig{}, err
	}

	var targets []models.NodeTarget
	if err := db.Where("node_id = ?", node.ID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return NodeReportConfig{}, err
	}
	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	_, timezone, _ := normalizeReporterSchedule(node)
	routeUUID := nodeRouteUUID(node)

	return NodeReportConfig{
		EndpointPath:  "/api/v1/report/nodes/" + routeUUID,
		InstallerPath: "/api/v1/report/nodes/" + routeUUID + "/install.sh",
		ReporterToken: token,
		TargetIPs:     targetIPs,
		Timezone:      timezone,
	}, nil
}

func GetNodeInstallScript(db *gorm.DB, uuid, token, reportEndpointURL string, scheduleCronOverride string, runImmediatelyOverride *bool) (string, error) {
	if strings.TrimSpace(token) == "" {
		return "", errors.New("missing reporter token")
	}

	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return "", err
	}
	if node.ReporterToken == "" || token != node.ReporterToken {
		return "", errors.New("invalid reporter token")
	}

	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, timezone, runImmediately := normalizeReporterSchedule(node)
	if strings.TrimSpace(scheduleCronOverride) != "" {
		scheduleCron = scheduleCronOverride
	}
	if runImmediatelyOverride != nil {
		runImmediately = *runImmediatelyOverride
	}
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return "", err
	}
	normalizedTimezone, _, err := parseReporterTimezone(timezone)
	if err != nil {
		return "", err
	}

	localProbeURL := ""
	if config.Load().IsDevelopment() {
		localProbeURL = strings.TrimRight(reportEndpointURL, "/")
		if index := strings.Index(localProbeURL, "/api/v1/report/nodes/"); index >= 0 {
			localProbeURL = localProbeURL[:index] + "/api/v1/report/local-probe"
		}
	}

	return buildNodeInstallScript(node, targetIPs, reportEndpointURL, normalizedCron, normalizedTimezone, runImmediately, localProbeURL), nil
}

func GetNodeInstallConfig(db *gorm.DB, uuid, token, reportEndpointURL string) (NodeInstallConfig, error) {
	if strings.TrimSpace(token) == "" {
		return NodeInstallConfig{}, errors.New("missing reporter token")
	}

	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeInstallConfig{}, err
	}
	if node.ReporterToken == "" || token != node.ReporterToken {
		return NodeInstallConfig{}, errors.New("invalid reporter token")
	}

	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, timezone, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return NodeInstallConfig{}, err
	}
	normalizedTimezone, _, err := parseReporterTimezone(timezone)
	if err != nil {
		return NodeInstallConfig{}, err
	}
	routeUUID := nodeRouteUUID(node)

	return NodeInstallConfig{
		NodeUUID:       routeUUID,
		ReportEndpoint: reportEndpointURL,
		ReporterToken:  node.ReporterToken,
		ScheduleCron:   normalizedCron,
		Timezone:       normalizedTimezone,
		RunImmediately: runImmediately,
		TargetIPs:      targetIPs,
	}, nil
}

func GetNodeInstallConfigByInstallToken(db *gorm.DB, installToken, reportBaseURL string) (NodeInstallConfig, error) {
	if strings.TrimSpace(installToken) == "" {
		return NodeInstallConfig{}, errors.New("missing install token")
	}

	var node models.Node
	if err := db.First(&node, "install_token = ?", installToken).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return NodeInstallConfig{}, errors.New("invalid install token")
		}
		return NodeInstallConfig{}, err
	}

	targets := []models.NodeTarget{}
	if err := db.Where("node_id = ?", node.ID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return NodeInstallConfig{}, err
	}
	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, timezone, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return NodeInstallConfig{}, err
	}
	normalizedTimezone, _, err := parseReporterTimezone(timezone)
	if err != nil {
		return NodeInstallConfig{}, err
	}
	routeUUID := nodeRouteUUID(node)

	reportEndpointURL := strings.TrimRight(reportBaseURL, "/") + "/api/v1/report/nodes/" + routeUUID
	return NodeInstallConfig{
		NodeUUID:       routeUUID,
		ReportEndpoint: reportEndpointURL,
		ReporterToken:  node.ReporterToken,
		ScheduleCron:   normalizedCron,
		Timezone:       normalizedTimezone,
		RunImmediately: runImmediately,
		TargetIPs:      targetIPs,
	}, nil
}

func GetNodeInstallScriptByInstallToken(db *gorm.DB, installToken, reportBaseURL string) (string, error) {
	if strings.TrimSpace(installToken) == "" {
		return "", errors.New("missing install token")
	}

	var node models.Node
	if err := db.First(&node, "install_token = ?", installToken).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", errors.New("invalid install token")
		}
		return "", err
	}

	targets := []models.NodeTarget{}
	if err := db.Where("node_id = ?", node.ID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return "", err
	}
	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}

	scheduleCron, timezone, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return "", err
	}
	normalizedTimezone, _, err := parseReporterTimezone(timezone)
	if err != nil {
		return "", err
	}

	reportEndpointURL := strings.TrimRight(reportBaseURL, "/") + "/api/v1/report/nodes/" + nodeRouteUUID(node)
	localProbeURL := ""
	if config.Load().IsDevelopment() {
		localProbeURL = strings.TrimRight(reportBaseURL, "/") + "/api/v1/report/local-probe"
	}

	return buildNodeInstallScript(node, targetIPs, reportEndpointURL, normalizedCron, normalizedTimezone, runImmediately, localProbeURL), nil
}

func ReportNode(db *gorm.DB, uuid, token string, input ReportNodeInput) error {
	if strings.TrimSpace(token) == "" {
		return errors.New("missing reporter token")
	}
	targetIP, err := normalizeTargetIP(input.TargetIP)
	if err != nil {
		return err
	}
	if len(input.Result) == 0 {
		return errors.New("result is required")
	}

	node, err := loadNodeByUUID(db, uuid)
	if err != nil {
		return err
	}
	if node.ReporterToken == "" || token != node.ReporterToken {
		return errors.New("invalid reporter token")
	}

	target, err := findNodeTargetByNormalizedIP(db, node.ID, targetIP)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("target ip not configured")
		}
		return err
	}
	if !target.Enabled {
		return errors.New("target ip reporting disabled")
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

	previousResult := decodeResultJSON(target.CurrentResultJSON)
	var historyID uint
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(target).Updates(map[string]any{
			"has_data":                  true,
			"current_summary":           summary,
			"current_result_json":       string(raw),
			"current_result_updated_at": recordedAt,
			"last_seen_at":              recordedAt,
		}).Error; err != nil {
			return err
		}

		history := models.NodeTargetHistory{
			NodeTargetID: target.ID,
			ResultJSON:   string(raw),
			Summary:      summary,
			RecordedAt:   recordedAt,
		}
		if err := tx.Create(&history).Error; err != nil {
			return err
		}
		historyID = history.ID
		return recomputeNodeState(tx, node.ID)
	}); err != nil {
		return err
	}

	currentResult := decodeResultJSON(string(raw))
	return DispatchNotificationRules(db, node, *target, historyID, previousResult, currentResult, recordedAt)
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

func loadNodeWithTargets(db *gorm.DB, uuid string) (models.Node, []models.NodeTarget, error) {
	node, err := loadNodeByUUID(db, uuid)
	if err != nil {
		return models.Node{}, nil, err
	}

	var targets []models.NodeTarget
	if err := db.Where("node_id = ?", node.ID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return models.Node{}, nil, err
	}

	return node, targets, nil
}

func loadKomariBinding(db *gorm.DB, nodeID uint) (*models.KomariBinding, error) {
	var binding models.KomariBinding
	if err := db.First(&binding, "node_id = ?", nodeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &binding, nil
}

func canMigrateKomariShellNode(db *gorm.DB, nodeID uint, komariNodeUUID string) bool {
	if db == nil || nodeID == 0 {
		return false
	}
	binding, err := loadKomariBinding(db, nodeID)
	if err != nil || binding == nil || binding.BindingSource != "from_komari" {
		return false
	}
	var node models.Node
	if err := db.First(&node, "id = ?", nodeID).Error; err != nil {
		return false
	}
	if strings.TrimSpace(node.KomariNodeUUID) != strings.TrimSpace(komariNodeUUID) || strings.TrimSpace(binding.KomariNodeUUID) != strings.TrimSpace(komariNodeUUID) {
		return false
	}
	if node.HasData {
		return false
	}
	var targetCount int64
	if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", nodeID).Count(&targetCount).Error; err != nil {
		return false
	}
	return targetCount == 0
}

func selectNodeTarget(targets []models.NodeTarget, selectedTargetID *uint) (*models.NodeTarget, error) {
	if len(targets) == 0 {
		return nil, nil
	}
	if selectedTargetID == nil || *selectedTargetID == 0 {
		return &targets[0], nil
	}
	for index := range targets {
		if targets[index].ID == *selectedTargetID {
			return &targets[index], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func resolveHistoryTargetScope(targets []models.NodeTarget, selectedTargetID *uint) (*models.NodeTarget, []models.NodeTarget, error) {
	if len(targets) == 0 {
		return nil, nil, nil
	}
	if selectedTargetID == nil || *selectedTargetID == 0 {
		return nil, append([]models.NodeTarget{}, targets...), nil
	}
	selected, err := selectNodeTarget(targets, selectedTargetID)
	if err != nil {
		return nil, nil, err
	}
	if selected == nil {
		return nil, nil, nil
	}
	return selected, []models.NodeTarget{*selected}, nil
}

func decodeResultJSON(raw string) map[string]any {
	result := map[string]any{}
	if raw == "" {
		return result
	}
	_ = json.Unmarshal([]byte(raw), &result)
	return result
}

func publicTargetLabel(index int) string {
	return "IP " + strconv.Itoa(index+1)
}

func nodeRouteUUID(node models.Node) string {
	if strings.TrimSpace(node.NodeUUID) != "" {
		return strings.TrimSpace(node.NodeUUID)
	}
	return strings.TrimSpace(node.KomariNodeUUID)
}

func loadNodeByUUID(db *gorm.DB, uuid string) (models.Node, error) {
	var node models.Node
	if err := db.First(&node, "node_uuid = ?", uuid).Error; err == nil {
		return node, nil
	}
	if err := db.First(&node, "komari_node_uuid = ?", uuid).Error; err == nil {
		return node, nil
	}
	var binding models.KomariBinding
	if err := db.First(&binding, "komari_node_uuid = ?", uuid).Error; err != nil {
		return models.Node{}, err
	}
	if err := db.First(&node, "id = ?", binding.NodeID).Error; err != nil {
		return models.Node{}, err
	}
	return node, nil
}

func normalizeTargetIP(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	parsed := net.ParseIP(value)
	if parsed == nil {
		return "", errors.New("invalid ip")
	}
	if ipv4 := parsed.To4(); ipv4 != nil {
		return ipv4.String(), nil
	}
	return parsed.String(), nil
}

func findNodeTargetByNormalizedIP(db *gorm.DB, nodeID uint, targetIP string) (*models.NodeTarget, error) {
	var targets []models.NodeTarget
	if err := db.Where("node_id = ?", nodeID).Find(&targets).Error; err != nil {
		return nil, err
	}
	for index := range targets {
		normalized, err := normalizeTargetIP(targets[index].TargetIP)
		if err != nil {
			continue
		}
		if normalized == targetIP {
			return &targets[index], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func nextNodeTargetSortOrder(db *gorm.DB, nodeID uint) (int, error) {
	var targets []models.NodeTarget
	if err := db.Where("node_id = ?", nodeID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return 0, err
	}
	if len(targets) == 0 {
		return 0, nil
	}
	return targets[len(targets)-1].SortOrder + 1, nil
}

func normalizeNodeTargetSortOrder(tx *gorm.DB, nodeID uint) error {
	var targets []models.NodeTarget
	if err := tx.Where("node_id = ?", nodeID).Order("sort_order ASC").Order("id ASC").Find(&targets).Error; err != nil {
		return err
	}
	for index, target := range targets {
		if target.SortOrder == index {
			continue
		}
		if err := tx.Model(&models.NodeTarget{}).Where("id = ?", target.ID).Update("sort_order", index).Error; err != nil {
			return err
		}
	}
	return nil
}

func recomputeNodeState(tx *gorm.DB, nodeID uint) error {
	var targets []models.NodeTarget
	if err := tx.Where("node_id = ?", nodeID).Find(&targets).Error; err != nil {
		return err
	}

	hasData := false
	var updatedAt *time.Time
	for _, target := range targets {
		if !target.HasData || target.CurrentResultUpdatedAt == nil {
			continue
		}
		if updatedAt == nil || target.CurrentResultUpdatedAt.After(*updatedAt) {
			value := target.CurrentResultUpdatedAt.UTC()
			updatedAt = &value
		}
		hasData = true
	}

	updates := map[string]any{
		"has_data":                  hasData,
		"current_summary":           "",
		"current_result_json":       "",
		"current_result_updated_at": updatedAt,
	}
	return tx.Model(&models.Node{}).Where("id = ?", nodeID).Updates(updates).Error
}

func normalizeHistoryPage(page int) int {
	if page <= 0 {
		return 1
	}
	return page
}

func normalizeHistoryPageSize(limit, pageSize int) int {
	if limit > 0 {
		return limit
	}
	if pageSize <= 0 {
		return 20
	}
	if pageSize > 100 {
		return 100
	}
	return pageSize
}

func applyHistoryRange(query *gorm.DB, startAt, endAt *time.Time) *gorm.DB {
	if startAt != nil && !startAt.IsZero() {
		query = query.Where("recorded_at >= ?", startAt.UTC())
	}
	if endAt != nil && !endAt.IsZero() {
		query = query.Where("recorded_at < ?", endAt.UTC())
	}
	return query
}

func buildNodeInstallScript(node models.Node, targetIPs []string, reportEndpointURL, scheduleCron, timezone string, runImmediately bool, localProbeURL string) string {
	var builder strings.Builder
	unitName := "ipq-reporter-" + node.KomariNodeUUID
	installDir := "/opt/" + unitName
	scriptPath := installDir + "/run.sh"
	legacyScriptPath := "/usr/local/bin/" + unitName + ".sh"
	servicePath := "/etc/systemd/system/" + unitName + ".service"
	timerPath := "/etc/systemd/system/" + unitName + ".timer"
	cronPath := "/etc/cron.d/" + unitName

	builder.WriteString("#!/usr/bin/env bash\n")
	builder.WriteString("set -euo pipefail\n\n")
	builder.WriteString("if [ \"$(id -u)\" -ne 0 ]; then\n")
	builder.WriteString("  echo \"This installer must be run as root.\" >&2\n")
	builder.WriteString("  exit 1\n")
	builder.WriteString("fi\n\n")
	builder.WriteString("install_dependencies() {\n")
	builder.WriteString("  if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v apt >/dev/null 2>&1; then\n")
	builder.WriteString("    apt update\n")
	builder.WriteString("    apt install -y curl jq\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v yum >/dev/null 2>&1; then\n")
	builder.WriteString("    yum install -y curl jq\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v apk >/dev/null 2>&1; then\n")
	builder.WriteString("    apk add --no-cache curl jq\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  echo \"curl and jq are required, and no supported package manager was found.\" >&2\n")
	builder.WriteString("  exit 1\n")
	builder.WriteString("}\n\n")
	builder.WriteString("install_dependencies\n\n")
	builder.WriteString("if command -v systemctl >/dev/null 2>&1; then\n")
	builder.WriteString("  systemctl stop " + shellQuote(unitName+".timer") + " >/dev/null 2>&1 || true\n")
	builder.WriteString("  systemctl disable " + shellQuote(unitName+".timer") + " >/dev/null 2>&1 || true\n")
	builder.WriteString("  systemctl stop " + shellQuote(unitName+".service") + " >/dev/null 2>&1 || true\n")
	builder.WriteString("  systemctl disable " + shellQuote(unitName+".service") + " >/dev/null 2>&1 || true\n")
	builder.WriteString("fi\n")
	builder.WriteString("rm -f " + shellQuote(servicePath) + " " + shellQuote(timerPath) + " " + shellQuote(cronPath) + " " + shellQuote(legacyScriptPath) + "\n")
	builder.WriteString("mkdir -p " + shellQuote(installDir) + "\n\n")

	builder.WriteString("cat > " + shellQuote(scriptPath) + " <<'IPQ_REPORTER_SCRIPT'\n")
	builder.WriteString("#!/usr/bin/env bash\n")
	builder.WriteString("set -euo pipefail\n\n")
	builder.WriteString("REPORT_ENDPOINT=" + shellQuote(reportEndpointURL) + "\n")
	builder.WriteString("PLAN_ENDPOINT=" + shellQuote(strings.TrimRight(reportEndpointURL, "/")+"/plan") + "\n")
	builder.WriteString("REPORTER_TOKEN=" + shellQuote(node.ReporterToken) + "\n")
	if strings.TrimSpace(localProbeURL) != "" {
		builder.WriteString("LOCAL_PROBE_URL=" + shellQuote(localProbeURL) + "\n")
	} else {
		builder.WriteString("LOCAL_PROBE_URL=''\n")
	}
	builder.WriteString("WORKDIR=$(mktemp -d)\n")
	builder.WriteString("cleanup() {\n")
	builder.WriteString("  rm -rf \"$WORKDIR\"\n")
	builder.WriteString("}\n")
	builder.WriteString("trap cleanup EXIT\n\n")
	builder.WriteString("discover_candidate_ips() {\n")
	builder.WriteString("  if command -v ip >/dev/null 2>&1; then\n")
	builder.WriteString("    ip -o addr show up scope global | awk '{print $4}' | cut -d/ -f1 | while read -r ip; do\n")
	builder.WriteString("      [ -z \"$ip\" ] && continue\n")
	builder.WriteString("      case \"$ip\" in\n")
	builder.WriteString("        127.*|::1|fe80:*) continue ;;\n")
	builder.WriteString("      esac\n")
	builder.WriteString("      printf '%s\\n' \"$ip\"\n")
	builder.WriteString("    done\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v hostname >/dev/null 2>&1; then\n")
	builder.WriteString("    hostname -I 2>/dev/null | tr ' ' '\\n' | while read -r ip; do\n")
	builder.WriteString("      [ -z \"$ip\" ] && continue\n")
	builder.WriteString("      case \"$ip\" in\n")
	builder.WriteString("        127.*|::1|fe80:*) continue ;;\n")
	builder.WriteString("      esac\n")
	builder.WriteString("      printf '%s\\n' \"$ip\"\n")
	builder.WriteString("    done\n")
	builder.WriteString("  fi\n")
	builder.WriteString("}\n\n")
	builder.WriteString("discover_interface_summary_json() {\n")
	builder.WriteString("  if ! command -v ip >/dev/null 2>&1; then\n")
	builder.WriteString("    printf '[]'\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  ip -j addr show up scope global 2>/dev/null | jq -c '[.[] | {name: .ifname, ips: [(.addr_info // [])[] | select((.scope // \"\") == \"global\") | .local]} | select((.ips | length) > 0)]'\n")
	builder.WriteString("}\n\n")
	builder.WriteString("mapfile -t CANDIDATE_IPS < <(discover_candidate_ips | awk '!seen[$0]++')\n")
	builder.WriteString("if [ \"${#CANDIDATE_IPS[@]}\" -eq 0 ]; then\n")
	builder.WriteString("  echo \"No candidate IPs were discovered on this node.\" >&2\n")
	builder.WriteString("fi\n")
	builder.WriteString("HOSTNAME_VALUE=\"\"\n")
	builder.WriteString("if command -v hostname >/dev/null 2>&1; then\n")
	builder.WriteString("  HOSTNAME_VALUE=$(hostname 2>/dev/null || true)\n")
	builder.WriteString("fi\n")
	builder.WriteString("INTERFACE_SUMMARY_JSON=$(discover_interface_summary_json)\n")
	builder.WriteString("AGENT_VERSION=\"install-script-v2\"\n")
	builder.WriteString("CANDIDATE_IPS_JSON='[]'\n")
	builder.WriteString("if [ \"${#CANDIDATE_IPS[@]}\" -gt 0 ]; then\n")
	builder.WriteString("  CANDIDATE_IPS_JSON=$(printf '%s\\n' \"${CANDIDATE_IPS[@]}\" | jq -R . | jq -s .)\n")
	builder.WriteString("fi\n")
	builder.WriteString("PLAN_FILE=\"$WORKDIR/plan.json\"\n")
	builder.WriteString("if ! jq -n \\\n")
	builder.WriteString("  --argjson candidate_ips \"$CANDIDATE_IPS_JSON\" \\\n")
	builder.WriteString("  --arg agent_version \"$AGENT_VERSION\" \\\n")
	builder.WriteString("  --arg hostname \"$HOSTNAME_VALUE\" \\\n")
	builder.WriteString("  --argjson interface_summary \"$INTERFACE_SUMMARY_JSON\" \\\n")
	builder.WriteString("  '{candidate_ips: $candidate_ips, agent_version: $agent_version, hostname: $hostname, interface_summary: $interface_summary}' \\\n")
	builder.WriteString("  | curl -fsS -X POST \\\n")
	builder.WriteString("      -H 'Content-Type: application/json' \\\n")
	builder.WriteString("      -H \"X-IPQ-Reporter-Token: ${REPORTER_TOKEN}\" \\\n")
	builder.WriteString("      --data-binary @- \\\n")
	builder.WriteString("      \"$PLAN_ENDPOINT\" -o \"$PLAN_FILE\"; then\n")
	builder.WriteString("  echo \"Failed to fetch reporting plan.\" >&2\n")
	builder.WriteString("  exit 1\n")
	builder.WriteString("fi\n")
	builder.WriteString("mapfile -t TARGET_IPS < <(jq -er '.approved_targets[].target_ip' \"$PLAN_FILE\")\n")
	builder.WriteString("if [ \"${#TARGET_IPS[@]}\" -eq 0 ]; then\n")
	builder.WriteString("  echo \"No approved target IPs returned by the server. Nothing to probe.\"\n")
	builder.WriteString("  exit 0\n")
	builder.WriteString("fi\n\n")
	builder.WriteString("for TARGET_IP in \"${TARGET_IPS[@]}\"; do\n")
	builder.WriteString("  SAFE_NAME=$(printf '%s' \"$TARGET_IP\" | tr ':/' '__')\n")
	builder.WriteString("  RESULT_FILE=\"$WORKDIR/$SAFE_NAME.json\"\n")
	builder.WriteString("  PROBE_LOG=\"$WORKDIR/$SAFE_NAME.log\"\n")
	builder.WriteString("  PROBE_EXIT=0\n")
	builder.WriteString("  echo \"Probing $TARGET_IP...\"\n")
	builder.WriteString("  if [ -n \"$LOCAL_PROBE_URL\" ]; then\n")
	builder.WriteString("    if ! curl -fsS -G --data-urlencode \"target_ip=$TARGET_IP\" \"$LOCAL_PROBE_URL\" -o \"$RESULT_FILE\" >\"$PROBE_LOG\" 2>&1; then\n")
	builder.WriteString("      PROBE_EXIT=$?\n")
	builder.WriteString("    fi\n")
	builder.WriteString("  else\n")
	builder.WriteString("    if ! bash <(curl -fsSL https://IP.Check.Place) -j -y -i \"$TARGET_IP\" -o \"$RESULT_FILE\" >\"$PROBE_LOG\" 2>&1; then\n")
	builder.WriteString("      PROBE_EXIT=$?\n")
	builder.WriteString("    fi\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if [ ! -s \"$RESULT_FILE\" ]; then\n")
	builder.WriteString("    echo \"IPQuality probe failed or returned empty result: $TARGET_IP\" >&2\n")
	builder.WriteString("    continue\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if [ \"$PROBE_EXIT\" -ne 0 ]; then\n")
	builder.WriteString("    echo \"IPQuality probe exited with code $PROBE_EXIT for $TARGET_IP, but JSON output was produced; continuing to upload.\" >&2\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  {\n")
	builder.WriteString("    printf '{\"target_ip\":\"%s\",\"result\":' \"$TARGET_IP\"\n")
	builder.WriteString("    cat \"$RESULT_FILE\"\n")
	builder.WriteString("    printf '}'\n")
	builder.WriteString("  } | curl -fsS -X POST \\\n")
	builder.WriteString("      -H 'Content-Type: application/json' \\\n")
	builder.WriteString("      -H \"X-IPQ-Reporter-Token: ${REPORTER_TOKEN}\" \\\n")
	builder.WriteString("      --data-binary @- \\\n")
	builder.WriteString("      \"$REPORT_ENDPOINT\" >/dev/null\n")
	builder.WriteString("  echo \"Uploaded result for $TARGET_IP.\"\n")
	builder.WriteString("done\n")
	builder.WriteString("IPQ_REPORTER_SCRIPT\n\n")

	builder.WriteString("chmod +x " + shellQuote(scriptPath) + "\n\n")
	builder.WriteString("cat > " + shellQuote(cronPath) + " <<'IPQ_REPORTER_CRON'\n")
	builder.WriteString("SHELL=/bin/bash\n")
	builder.WriteString("PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n")
	builder.WriteString("CRON_TZ=" + timezone + "\n")
	builder.WriteString(scheduleCron + " root " + scriptPath + "\n")
	builder.WriteString("IPQ_REPORTER_CRON\n\n")
	builder.WriteString("chmod 0644 " + shellQuote(cronPath) + "\n")
	builder.WriteString("if command -v systemctl >/dev/null 2>&1; then\n")
	builder.WriteString("  systemctl daemon-reload >/dev/null 2>&1 || true\n")
	builder.WriteString("  if systemctl list-unit-files cron.service >/dev/null 2>&1; then\n")
	builder.WriteString("    systemctl enable --now cron.service >/dev/null 2>&1 || true\n")
	builder.WriteString("  elif systemctl list-unit-files crond.service >/dev/null 2>&1; then\n")
	builder.WriteString("    systemctl enable --now crond.service >/dev/null 2>&1 || true\n")
	builder.WriteString("  fi\n")
	builder.WriteString("fi\n\n")
	if runImmediately {
		builder.WriteString("echo " + shellQuote("Running the reporter immediately once after installation. This may take several minutes.") + "\n")
		builder.WriteString("if ! " + shellQuote(scriptPath) + "; then\n")
		builder.WriteString("  echo " + shellQuote("Immediate run failed. Scheduled execution remains installed.") + " >&2\n")
		builder.WriteString("fi\n\n")
	}
	builder.WriteString("echo " + shellQuote("Installed "+unitName+" with "+strconv.Itoa(len(targetIPs))+" target IP(s).") + "\n")
	builder.WriteString("echo " + shellQuote("Schedule: "+scheduleCron) + "\n")
	builder.WriteString("echo " + shellQuote("Timezone: "+timezone) + "\n")
	if runImmediately {
		builder.WriteString("echo " + shellQuote("Immediate execution: enabled") + "\n")
	} else {
		builder.WriteString("echo " + shellQuote("Immediate execution: disabled") + "\n")
	}
	builder.WriteString("echo " + shellQuote("Re-run this command after changing the target IP list or schedule to replace the existing reporter configuration.") + "\n")
	return builder.String()
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
