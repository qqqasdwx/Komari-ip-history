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

type KomariNodeEntryState struct {
	NodeUUID       string `json:"node_uuid"`
	KomariNodeUUID string `json:"komari_node_uuid"`
	Name           string `json:"name"`
	Exists         bool   `json:"exists"`
	HasData        bool   `json:"has_data"`
	TargetCount    int64  `json:"target_count"`
	Connected      bool   `json:"connected"`
}

type AddNodeTargetInput struct {
	IP string `json:"ip"`
}

type ReorderNodeTargetsInput struct {
	TargetIDs []uint `json:"target_ids"`
}

type NodeListItem struct {
	NodeUUID       string     `json:"node_uuid"`
	KomariNodeUUID string     `json:"komari_node_uuid"`
	Name           string     `json:"name"`
	HasData        bool       `json:"has_data"`
	UpdatedAt      *time.Time `json:"updated_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

type NodeTargetListItem struct {
	ID        uint       `json:"id"`
	IP        string     `json:"ip"`
	HasData   bool       `json:"has_data"`
	UpdatedAt *time.Time `json:"updated_at"`
	SortOrder int        `json:"sort_order"`
}

type NodeTargetDetail struct {
	ID        uint           `json:"id"`
	IP        string         `json:"ip"`
	HasData   bool           `json:"has_data"`
	UpdatedAt *time.Time     `json:"updated_at"`
	Result    map[string]any `json:"current_result"`
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
	RunImmediately bool        `json:"run_immediately"`
	NextRuns       []time.Time `json:"next_runs"`
}

type NodeInstallConfig struct {
	NodeUUID       string   `json:"node_uuid"`
	ReportEndpoint string   `json:"report_endpoint"`
	ReporterToken  string   `json:"reporter_token"`
	ScheduleCron   string   `json:"schedule_cron"`
	RunImmediately bool     `json:"run_immediately"`
	TargetIPs      []string `json:"target_ips"`
}

type NodeDetail struct {
	NodeUUID         string               `json:"node_uuid"`
	KomariNodeUUID   string               `json:"komari_node_uuid"`
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

func newReporterToken() (string, error) {
	return auth.NewSessionToken()
}

func newInstallToken() (string, error) {
	return auth.NewInstallToken()
}

func RegisterNode(db *gorm.DB, _ config.Config, input RegisterNodeInput) (*models.Node, bool, error) {
	if strings.TrimSpace(input.KomariNodeUUID) == "" || strings.TrimSpace(input.Name) == "" {
		return nil, false, errors.New("uuid and name are required")
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if err == nil {
		node.Name = input.Name
		if node.ReporterToken == "" {
			token, tokenErr := newReporterToken()
			if tokenErr != nil {
				return nil, true, tokenErr
			}
			node.ReporterToken = token
		}
		if node.InstallToken == "" {
			token, tokenErr := newInstallToken()
			if tokenErr != nil {
				return nil, true, tokenErr
			}
			node.InstallToken = token
		}
		if strings.TrimSpace(node.ReporterScheduleCron) == "" {
			node.ReporterScheduleCron = defaultReporterScheduleCron
		}
		if saveErr := db.Save(&node).Error; saveErr != nil {
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
		Name:                   input.Name,
		ReporterToken:          reporterToken,
		InstallToken:           installToken,
		ReporterScheduleCron:   defaultReporterScheduleCron,
		ReporterRunImmediately: true,
	}
	if err := db.Create(&node).Error; err != nil {
		return nil, false, err
	}
	return &node, false, nil
}

func SyncKomariNode(db *gorm.DB, input RegisterNodeInput) (*models.Node, bool, error) {
	return RegisterNode(db, config.Config{}, input)
}

func GetKomariNodeEntryState(db *gorm.DB, input RegisterNodeInput) (KomariNodeEntryState, error) {
	if strings.TrimSpace(input.KomariNodeUUID) == "" || strings.TrimSpace(input.Name) == "" {
		return KomariNodeEntryState{}, errors.New("uuid and name are required")
	}

	var node models.Node
	err := db.First(&node, "komari_node_uuid = ?", input.KomariNodeUUID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return KomariNodeEntryState{
			KomariNodeUUID: input.KomariNodeUUID,
			Name:           input.Name,
			Exists:         false,
		}, nil
	}
	if err != nil {
		return KomariNodeEntryState{}, err
	}

	return buildKomariNodeEntryState(db, node)
}

func SyncKomariNodeEntryState(db *gorm.DB, input RegisterNodeInput) (KomariNodeEntryState, error) {
	node, _, err := SyncKomariNode(db, input)
	if err != nil {
		return KomariNodeEntryState{}, err
	}
	return buildKomariNodeEntryState(db, *node)
}

func buildKomariNodeEntryState(db *gorm.DB, node models.Node) (KomariNodeEntryState, error) {
	var targetCount int64
	if err := db.Model(&models.NodeTarget{}).Where("node_id = ?", node.ID).Count(&targetCount).Error; err != nil {
		return KomariNodeEntryState{}, err
	}

	return KomariNodeEntryState{
		NodeUUID:       node.NodeUUID,
		KomariNodeUUID: node.KomariNodeUUID,
		Name:           node.Name,
		Exists:         true,
		HasData:        node.HasData,
		TargetCount:    targetCount,
		Connected:      targetCount > 0,
	}, nil
}

func ListNodes(db *gorm.DB, keyword string) ([]NodeListItem, error) {
	var nodes []models.Node
	query := db.Order("has_data DESC").Order("current_result_updated_at DESC").Order("created_at DESC")
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR node_uuid LIKE ? OR komari_node_uuid LIKE ?", like, like, like)
	}
	if err := query.Find(&nodes).Error; err != nil {
		return nil, err
	}

	items := make([]NodeListItem, 0, len(nodes))
	for _, node := range nodes {
		items = append(items, NodeListItem{
			NodeUUID:       node.NodeUUID,
			KomariNodeUUID: node.KomariNodeUUID,
			Name:           node.Name,
			HasData:        node.HasData,
			UpdatedAt:      node.CurrentResultUpdatedAt,
			CreatedAt:      node.CreatedAt,
		})
	}
	return items, nil
}

func GetNodeDetail(db *gorm.DB, uuid string, selectedTargetID *uint) (NodeDetail, error) {
	node, targets, err := loadNodeWithTargets(db, uuid)
	if err != nil {
		return NodeDetail{}, err
	}

	selected, err := selectNodeTarget(targets, selectedTargetID)
	if err != nil {
		return NodeDetail{}, err
	}

	targetItems := make([]NodeTargetListItem, 0, len(targets))
	reportIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetItems = append(targetItems, NodeTargetListItem{
			ID:        target.ID,
			IP:        target.TargetIP,
			HasData:   target.HasData,
			UpdatedAt: target.CurrentResultUpdatedAt,
			SortOrder: target.SortOrder,
		})
		reportIPs = append(reportIPs, target.TargetIP)
	}

	reportConfig, err := buildNodeReportConfig(node, reportIPs)
	if err != nil {
		return NodeDetail{}, err
	}

	detail := NodeDetail{
		NodeUUID:       node.NodeUUID,
		KomariNodeUUID: node.KomariNodeUUID,
		Name:           node.Name,
		HasData:        node.HasData,
		UpdatedAt:      node.CurrentResultUpdatedAt,
		Targets:        targetItems,
		ReportConfig:   reportConfig,
	}

	if selected != nil {
		detail.SelectedTargetID = &selected.ID
		detail.CurrentTarget = &NodeTargetDetail{
			ID:        selected.ID,
			IP:        selected.TargetIP,
			HasData:   selected.HasData,
			UpdatedAt: selected.CurrentResultUpdatedAt,
			Result:    decodeResultJSON(selected.CurrentResultJSON),
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
		ID:        created.ID,
		IP:        created.TargetIP,
		HasData:   created.HasData,
		UpdatedAt: created.CurrentResultUpdatedAt,
		SortOrder: created.SortOrder,
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

	return NodeReportConfig{
		EndpointPath:  "/api/v1/report/nodes/" + nodeRouteUUID(node),
		InstallerPath: "/api/v1/report/nodes/" + nodeRouteUUID(node) + "/install.sh",
		ReporterToken: token,
		TargetIPs:     targetIPs,
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
	if len(targets) == 0 {
		return "", errors.New("no target ip configured")
	}

	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, runImmediately := normalizeReporterSchedule(node)
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

	return buildNodeInstallScript(node, targetIPs, nodeReportEndpointURL(reportEndpointURL, node), normalizedCron, runImmediately), nil
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
	if len(targets) == 0 {
		return NodeInstallConfig{}, errors.New("no target ip configured")
	}

	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return NodeInstallConfig{}, err
	}

	return NodeInstallConfig{
		NodeUUID:       nodeRouteUUID(node),
		ReportEndpoint: nodeReportEndpointURL(reportEndpointURL, node),
		ReporterToken:  node.ReporterToken,
		ScheduleCron:   normalizedCron,
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
	if len(targets) == 0 {
		return NodeInstallConfig{}, errors.New("no target ip configured")
	}

	targetIPs := make([]string, 0, len(targets))
	for _, target := range targets {
		targetIPs = append(targetIPs, target.TargetIP)
	}
	scheduleCron, runImmediately := normalizeReporterSchedule(node)
	normalizedCron, _, err := parseReporterSchedule(scheduleCron)
	if err != nil {
		return NodeInstallConfig{}, err
	}

	reportEndpointURL := strings.TrimRight(reportBaseURL, "/") + "/api/v1/report/nodes/" + nodeRouteUUID(node)
	return NodeInstallConfig{
		NodeUUID:       nodeRouteUUID(node),
		ReportEndpoint: reportEndpointURL,
		ReporterToken:  node.ReporterToken,
		ScheduleCron:   normalizedCron,
		RunImmediately: runImmediately,
		TargetIPs:      targetIPs,
	}, nil
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

	var node models.Node
	if loaded, err := loadNodeByUUID(db, uuid); err != nil {
		return err
	} else {
		node = loaded
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
		if err := tx.Model(target).Updates(map[string]any{
			"has_data":                  true,
			"current_summary":           summary,
			"current_result_json":       string(raw),
			"current_result_updated_at": recordedAt,
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
		return recomputeNodeState(tx, node.ID)
	})
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

func loadNodeByUUID(db *gorm.DB, uuid string) (models.Node, error) {
	trimmed := strings.TrimSpace(uuid)
	if trimmed == "" {
		return models.Node{}, gorm.ErrRecordNotFound
	}
	var node models.Node
	if err := db.First(&node, "node_uuid = ?", trimmed).Error; err == nil {
		return node, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Node{}, err
	}
	if err := db.First(&node, "komari_node_uuid = ?", trimmed).Error; err != nil {
		return models.Node{}, err
	}
	return node, nil
}

func nodeRouteUUID(node models.Node) string {
	if value := strings.TrimSpace(node.NodeUUID); value != "" {
		return value
	}
	return strings.TrimSpace(node.KomariNodeUUID)
}

func nodeReportEndpointURL(reportEndpointURL string, node models.Node) string {
	endpoint := strings.TrimSpace(reportEndpointURL)
	marker := "/report/nodes/"
	if index := strings.LastIndex(endpoint, marker); index >= 0 {
		return endpoint[:index+len(marker)] + nodeRouteUUID(node)
	}
	return endpoint
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

func buildNodeInstallScript(node models.Node, targetIPs []string, reportEndpointURL, scheduleCron string, runImmediately bool) string {
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
	builder.WriteString("  if command -v curl >/dev/null 2>&1; then\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v apt >/dev/null 2>&1; then\n")
	builder.WriteString("    apt update\n")
	builder.WriteString("    apt install -y curl\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v yum >/dev/null 2>&1; then\n")
	builder.WriteString("    yum install -y curl\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  if command -v apk >/dev/null 2>&1; then\n")
	builder.WriteString("    apk add --no-cache curl\n")
	builder.WriteString("    return\n")
	builder.WriteString("  fi\n")
	builder.WriteString("  echo \"curl is required, and no supported package manager was found.\" >&2\n")
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
	builder.WriteString("REPORTER_TOKEN=" + shellQuote(node.ReporterToken) + "\n")
	builder.WriteString("TARGET_IPS=(")
	for index, ip := range targetIPs {
		if index > 0 {
			builder.WriteString(" ")
		}
		builder.WriteString(shellQuote(ip))
	}
	builder.WriteString(")\n\n")
	builder.WriteString("WORKDIR=$(mktemp -d)\n")
	builder.WriteString("cleanup() {\n")
	builder.WriteString("  rm -rf \"$WORKDIR\"\n")
	builder.WriteString("}\n")
	builder.WriteString("trap cleanup EXIT\n\n")
	builder.WriteString("for TARGET_IP in \"${TARGET_IPS[@]}\"; do\n")
	builder.WriteString("  SAFE_NAME=$(printf '%s' \"$TARGET_IP\" | tr ':/' '__')\n")
	builder.WriteString("  RESULT_FILE=\"$WORKDIR/$SAFE_NAME.json\"\n")
	builder.WriteString("  PROBE_LOG=\"$WORKDIR/$SAFE_NAME.log\"\n")
	builder.WriteString("  PROBE_EXIT=0\n")
	builder.WriteString("  echo \"Probing $TARGET_IP...\"\n")
	builder.WriteString("  if ! bash <(curl -fsSL https://IP.Check.Place) -j -y -i \"$TARGET_IP\" -o \"$RESULT_FILE\" >\"$PROBE_LOG\" 2>&1; then\n")
	builder.WriteString("    PROBE_EXIT=$?\n")
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
