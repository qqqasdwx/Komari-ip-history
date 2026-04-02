package handlers

import (
	"errors"
	"net/http"
	"strings"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReportHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h ReportHandler) Report(c *gin.Context) {
	var req service.ReportNodeInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	token := extractReporterToken(c)
	err := service.ReportNode(h.DB, c.Param("uuid"), token, req)
	if err != nil {
		switch err.Error() {
		case "missing reporter token", "invalid reporter token":
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		case "result is required", "invalid target ip", "target ip not configured":
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to store report"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "reported"})
}

func (h ReportHandler) InstallScript(c *gin.Context) {
	token := extractReporterToken(c)

	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load integration settings"})
		return
	}

	publicBaseURL := integration.EffectivePublicBaseURL
	if publicBaseURL == "" {
		publicBaseURL = inferredPublicBaseURL(c, h.Cfg.BasePath)
	}
	if publicBaseURL == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to infer public base url"})
		return
	}

	reportEndpointURL := strings.TrimRight(publicBaseURL, "/") + h.Cfg.APIBase() + "/report/nodes/" + c.Param("uuid")
	script, err := service.GetNodeInstallScript(h.DB, c.Param("uuid"), token, reportEndpointURL)
	if err != nil {
		switch err.Error() {
		case "missing reporter token", "invalid reporter token":
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		case "no target ip configured":
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to build installer"})
		}
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/x-shellscript; charset=utf-8", []byte(script))
}

func extractReporterToken(c *gin.Context) string {
	if token := strings.TrimSpace(c.GetHeader("X-IPQ-Reporter-Token")); token != "" {
		return token
	}

	authorization := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:])
	}

	return ""
}
