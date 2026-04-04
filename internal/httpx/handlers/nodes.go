package handlers

import (
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

func (h NodeHandler) HistoryDetail(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	historyIDValue, err := strconv.ParseUint(c.Param("historyID"), 10, 64)
	if err != nil || historyIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid history id"})
		return
	}
	startAt, endAt := parseHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	item, detailErr := service.GetNodeHistoryDetail(h.DB, c.Param("uuid"), targetID, uint(historyIDValue), startAt, endAt)
	if detailErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "history not found"})
		return
	}
	c.JSON(http.StatusOK, item)
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
			value, err := time.Parse(candidate.layout, raw)
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
