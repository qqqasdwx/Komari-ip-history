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

type PublicHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h PublicHandler) APIList(c *gin.Context) {
	items, err := service.ListNodesForAPI(h.DB, c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load nodes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h PublicHandler) APIDetail(c *gin.Context) {
	var targetID *uint
	if raw := strings.TrimSpace(c.Query("target_id")); raw != "" {
		value, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr == nil && value > 0 {
			parsed := uint(value)
			targetID = &parsed
		}
	}
	detail, err := service.GetNodeDetailForAPI(h.DB, c.Param("uuid"), targetID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h PublicHandler) APITargets(c *gin.Context) {
	items, err := service.ListNodeTargetsForAPI(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h PublicHandler) APITargetDetail(c *gin.Context) {
	targetIDValue, err := strconv.ParseUint(c.Param("targetID"), 10, 64)
	if err != nil || targetIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	item, detailErr := service.GetNodeTargetForAPI(h.DB, c.Param("uuid"), uint(targetIDValue))
	if detailErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h PublicHandler) APIHistory(c *gin.Context) {
	targetID := parsePublicTargetID(c.Query("target_id"))
	page := parsePublicPositiveInt(c.Query("page"))
	pageSize := parsePublicPositiveInt(c.Query("page_size"))
	startAt, endAt := parsePublicHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistoryForAPI(h.DB, c.Param("uuid"), targetID, page, pageSize, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h PublicHandler) APIHistoryEvents(c *gin.Context) {
	targetID := parsePublicTargetID(c.Query("target_id"))
	page := parsePublicPositiveInt(c.Query("page"))
	pageSize := parsePublicPositiveInt(c.Query("page_size"))
	startAt, endAt := parsePublicHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistoryEventsForAPI(h.DB, c.Param("uuid"), targetID, c.Query("field"), page, pageSize, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h PublicHandler) Current(c *gin.Context) {
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	if !integration.GuestReadEnabled {
		c.JSON(http.StatusForbidden, gin.H{"message": "guest access disabled"})
		return
	}

	displayIP := strings.TrimSpace(c.Query("display_ip"))
	var targetID *uint
	if raw := strings.TrimSpace(c.Query("target_id")); raw != "" {
		value, parseErr := strconv.ParseUint(raw, 10, 64)
		if parseErr == nil && value > 0 {
			parsed := uint(value)
			targetID = &parsed
		}
	}

	detail, err := service.GetPublicNodeDetail(h.DB, c.Param("uuid"), targetID, displayIP)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func parsePublicTargetID(raw string) *uint {
	value, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil || value == 0 {
		return nil
	}
	parsed := uint(value)
	return &parsed
}

func parsePublicPositiveInt(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func parsePublicHistoryDateRange(startRaw, endRaw string) (*time.Time, *time.Time) {
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
