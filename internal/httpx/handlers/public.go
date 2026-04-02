package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PublicHandler struct {
	DB  *gorm.DB
	Cfg config.Config
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
