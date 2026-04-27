package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NodeHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h NodeHandler) List(c *gin.Context) {
	items, err := service.ListNodes(h.DB, c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load nodes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h NodeHandler) KomariBindingCandidates(c *gin.Context) {
	items, err := service.ListKomariBindingCandidates(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load komari binding candidates"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h NodeHandler) Create(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	node, err := service.CreateStandaloneNode(h.DB, req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":                 node.ID,
		"node_uuid":          node.NodeUUID,
		"komari_node_uuid":   node.KomariNodeUUID,
		"komari_node_name":   "",
		"has_komari_binding": false,
		"name":               node.Name,
		"has_data":           node.HasData,
		"updated_at":         node.CurrentResultUpdatedAt,
		"created_at":         node.CreatedAt,
	})
}

func (h NodeHandler) Update(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	node, err := service.UpdateNodeName(h.DB, c.Param("uuid"), req.Name)
	if err != nil {
		if err.Error() == "name is required" {
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	detail, detailErr := service.GetNodeDetail(h.DB, c.Param("uuid"), nil)
	if detailErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":                 detail.ID,
		"node_uuid":          detail.NodeUUID,
		"komari_node_uuid":   detail.KomariNodeUUID,
		"komari_node_name":   detail.KomariNodeName,
		"has_komari_binding": detail.HasKomariBinding,
		"name":               detail.Name,
		"has_data":           detail.HasData,
		"updated_at":         detail.UpdatedAt,
		"created_at":         node.CreatedAt,
	})
}

func (h NodeHandler) BindKomari(c *gin.Context) {
	var req struct {
		NodeID         uint   `json:"node_id"`
		KomariNodeUUID string `json:"komari_node_uuid"`
		KomariNodeName string `json:"komari_node_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.BindNodeToKomari(h.DB, req.NodeID, req.KomariNodeUUID, req.KomariNodeName)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) UnbindKomari(c *gin.Context) {
	var req struct {
		NodeID uint `json:"node_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	if err := service.UnbindNodeFromKomari(h.DB, req.NodeID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h NodeHandler) Detail(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	detail, err := service.GetNodeDetail(h.DB, c.Param("uuid"), targetID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h NodeHandler) History(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	limit := parsePositiveInt(c.Query("limit"))
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	startAt, endAt := parseHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistory(h.DB, c.Param("uuid"), targetID, limit, page, pageSize, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h NodeHandler) HistoryEvents(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	startAt, endAt := parseHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistoryEvents(h.DB, c.Param("uuid"), targetID, c.Query("field"), page, pageSize, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h NodeHandler) HistoryFields(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	startAt, endAt := parseHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistoryFieldOptions(h.DB, c.Param("uuid"), targetID, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h NodeHandler) FavoriteHistory(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	historyIDValue, err := strconv.ParseUint(c.Param("historyID"), 10, 64)
	if err != nil || historyIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid history id"})
		return
	}
	item, favoriteErr := service.SetNodeHistoryFavorite(h.DB, c.Param("uuid"), targetID, uint(historyIDValue), true)
	if favoriteErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "history not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) UnfavoriteHistory(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	historyIDValue, err := strconv.ParseUint(c.Param("historyID"), 10, 64)
	if err != nil || historyIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid history id"})
		return
	}
	item, favoriteErr := service.SetNodeHistoryFavorite(h.DB, c.Param("uuid"), targetID, uint(historyIDValue), false)
	if favoriteErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "history not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) AddTarget(c *gin.Context) {
	var req service.AddNodeTargetInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	item, err := service.AddNodeTarget(h.DB, h.Cfg, c.Param("uuid"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) DeleteTarget(c *gin.Context) {
	targetIDValue, err := strconv.ParseUint(c.Param("targetID"), 10, 64)
	if err != nil || targetIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	if err := service.DeleteNodeTarget(h.DB, c.Param("uuid"), uint(targetIDValue)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h NodeHandler) EnableTarget(c *gin.Context) {
	targetIDValue, err := strconv.ParseUint(c.Param("targetID"), 10, 64)
	if err != nil || targetIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	item, enableErr := service.SetNodeTargetEnabled(h.DB, c.Param("uuid"), uint(targetIDValue), true)
	if enableErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) DisableTarget(c *gin.Context) {
	targetIDValue, err := strconv.ParseUint(c.Param("targetID"), 10, 64)
	if err != nil || targetIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	item, enableErr := service.SetNodeTargetEnabled(h.DB, c.Param("uuid"), uint(targetIDValue), false)
	if enableErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) ReorderTargets(c *gin.Context) {
	var req service.ReorderNodeTargetsInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	if err := service.ReorderNodeTargets(h.DB, c.Param("uuid"), req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h NodeHandler) Delete(c *gin.Context) {
	if err := service.DeleteNode(h.DB, c.Param("uuid")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h NodeHandler) RotateReporterToken(c *gin.Context) {
	config, err := service.RotateNodeReporterToken(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, config)
}

func (h NodeHandler) PreviewReportConfig(c *gin.Context) {
	runImmediately, err := service.ParseOptionalRunImmediately(c.Query("run_immediately"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid run_immediately"})
		return
	}
	preview, previewErr := service.GetNodeReportConfigPreview(h.DB, c.Param("uuid"), c.Query("cron"), c.Query("timezone"), runImmediately)
	if previewErr != nil {
		if previewErr.Error() == "invalid cron expression" || previewErr.Error() == "invalid timezone" {
			c.JSON(http.StatusBadRequest, gin.H{"message": previewErr.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, preview)
}

func (h NodeHandler) UpdateReportConfig(c *gin.Context) {
	var req service.UpdateNodeReportConfigInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	config, updateErr := service.UpdateNodeReportConfig(h.DB, c.Param("uuid"), req)
	if updateErr != nil {
		if updateErr.Error() == "invalid cron expression" || updateErr.Error() == "invalid timezone" {
			c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, config)
}

func parseTargetID(raw string) *uint {
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		return nil
	}
	targetID := uint(value)
	return &targetID
}

func parsePositiveInt(raw string) int {
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func parseHistoryDateRange(startRaw, endRaw string) (*time.Time, *time.Time) {
	parseDateTime := func(raw string) (*time.Time, bool) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil, false
		}
		rfcLayouts := []string{time.RFC3339Nano, time.RFC3339}
		for _, layout := range rfcLayouts {
			value, err := time.Parse(layout, raw)
			if err == nil {
				utc := value.UTC()
				return &utc, false
			}
		}
		layouts := []struct {
			layout   string
			dateOnly bool
		}{
			{layout: "2006-01-02 15:04:05", dateOnly: false},
			{layout: "2006-01-02T15:04:05", dateOnly: false},
			{layout: "2006-01-02T15:04", dateOnly: false},
			{layout: "2006-01-02", dateOnly: true},
		}
		for _, candidate := range layouts {
			value, err := time.ParseInLocation(candidate.layout, raw, time.Local)
			if err == nil {
				utc := value.UTC()
				return &utc, candidate.dateOnly
			}
		}
		return nil, false
	}

	startAt, _ := parseDateTime(startRaw)
	endAt, endDateOnly := parseDateTime(endRaw)
	if endAt == nil {
		return startAt, nil
	}
	if endDateOnly {
		next := endAt.Add(24 * time.Hour)
		return startAt, &next
	}
	return startAt, endAt
}
