package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h AdminHandler) ListAPIKeys(c *gin.Context) {
	items, err := service.ListAPIKeys(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load api keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) CreateAPIKey(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.CreateAPIKey(h.DB, req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) UpdateAPIKey(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid api key id"})
		return
	}
	var req struct {
		Name    *string `json:"name"`
		Enabled *bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.UpdateAPIKey(h.DB, id, req.Name, req.Enabled)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "api key not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteAPIKey(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid api key id"})
		return
	}
	if err := service.DeleteAPIKey(h.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "api key not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to delete api key"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) ListAPIAccessLogs(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	items, err := service.ListAPIAccessLogs(h.DB, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load api access logs"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func parseIDParam(raw string) (uint, bool) {
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		return 0, false
	}
	return uint(value), true
}
