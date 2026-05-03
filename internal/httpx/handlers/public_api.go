package handlers

import (
	"errors"
	"net/http"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PublicAPIHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h PublicAPIHandler) ListNodes(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	items, err := service.ListPublicAPINodes(h.DB, c.Query("q"), page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load nodes"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h PublicAPIHandler) NodeDetail(c *gin.Context) {
	detail, err := service.GetPublicAPINodeDetail(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h PublicAPIHandler) NodeTargets(c *gin.Context) {
	items, err := service.GetPublicAPINodeTargets(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h PublicAPIHandler) TargetCurrent(c *gin.Context) {
	targetID, ok := parseIDParam(c.Param("targetID"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	item, err := service.GetPublicAPITargetCurrent(h.DB, c.Param("uuid"), targetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load target"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h PublicAPIHandler) NodeHistory(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	limit := parsePositiveInt(c.Query("limit"))
	startAt, endAt := parseHistoryDateRange(c.Query("start_date"), c.Query("end_date"))
	items, err := service.GetNodeHistory(h.DB, c.Param("uuid"), targetID, limit, page, pageSize, startAt, endAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h PublicAPIHandler) NodeHistoryEvents(c *gin.Context) {
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
