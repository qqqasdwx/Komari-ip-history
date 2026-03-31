package handlers

import (
	"net/http"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type EmbedHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h EmbedHandler) Status(c *gin.Context) {
	if _, ok := middleware.GetCurrentUser(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"login_required": true,
		})
		return
	}

	status, err := service.GetNodeStatus(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load status"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h EmbedHandler) Register(c *gin.Context) {
	if _, ok := middleware.GetCurrentUser(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"login_required": true})
		return
	}

	var req service.RegisterNodeInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	node, existed, err := service.RegisterNode(h.DB, h.Cfg, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"existed": existed,
		"node": gin.H{
			"komari_node_uuid": node.KomariNodeUUID,
			"name":             node.Name,
			"has_data":         node.HasData,
		},
	})
}

func (h EmbedHandler) Current(c *gin.Context) {
	if _, ok := middleware.GetCurrentUser(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"login_required": true})
		return
	}

	detail, err := service.GetNodeDetail(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h EmbedHandler) Loader(c *gin.Context) {
	c.Header("Content-Type", "application/javascript; charset=utf-8")
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.String(http.StatusInternalServerError, "console.error(%q);", "failed to load integration settings")
		return
	}
	c.String(http.StatusOK, service.LoaderScript(h.Cfg, integration.EffectivePublicBaseURL))
}
