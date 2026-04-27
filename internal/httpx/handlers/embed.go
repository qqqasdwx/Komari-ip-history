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

func (h EmbedHandler) registerInput(c *gin.Context) (service.RegisterNodeInput, error) {
	var req service.RegisterNodeInput
	if c.Request.Method == http.MethodGet {
		req.KomariNodeUUID = c.Query("uuid")
		req.Name = c.Query("name")
		return req, nil
	}
	err := c.ShouldBindJSON(&req)
	return req, err
}

func (h EmbedHandler) Register(c *gin.Context) {
	if _, ok := middleware.GetCurrentUser(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"login_required": true})
		return
	}

	req, err := h.registerInput(c)
	if err != nil {
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

func (h EmbedHandler) RegisterBeacon(c *gin.Context) {
	req, err := h.registerInput(c)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	if _, _, err := service.SyncKomariNode(h.DB, req); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h EmbedHandler) Loader(c *gin.Context) {
	c.Header("Content-Type", "application/javascript; charset=utf-8")
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.String(http.StatusInternalServerError, "console.error(%q);", "failed to load integration settings")
		return
	}
	c.String(http.StatusOK, service.LoaderScript(h.Cfg, integration.EffectivePublicBaseURL, integration.GuestReadEnabled))
}
