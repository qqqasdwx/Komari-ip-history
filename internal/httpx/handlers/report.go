package handlers

import (
	"errors"
	"net/http"
	"strings"

	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReportHandler struct {
	DB *gorm.DB
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
		case "result is required":
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
