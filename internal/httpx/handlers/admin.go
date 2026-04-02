package handlers

import (
	"net/http"
	"strings"

	"komari-ip-history/internal/auth"
	"komari-ip-history/internal/config"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/models"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func inferredPublicBaseURL(c *gin.Context, basePath string) string {
	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(c.Request.Host)
	}
	host = strings.TrimRight(host, "/")
	if host == "" {
		return ""
	}

	return scheme + "://" + host + strings.TrimRight(basePath, "/")
}

type AdminHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h AdminHandler) Runtime(c *gin.Context) {
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	if integration.EffectivePublicBaseURL == "" {
		integration.EffectivePublicBaseURL = inferredPublicBaseURL(c, h.Cfg.BasePath)
	}

	c.JSON(http.StatusOK, gin.H{
		"app_name":                  h.Cfg.AppName,
		"app_env":                   h.Cfg.AppEnv,
		"base_path":                 h.Cfg.BasePath,
		"public_base_url":           integration.PublicBaseURL,
		"effective_public_base_url": integration.EffectivePublicBaseURL,
	})
}

func (h AdminHandler) GetIntegrationSettings(c *gin.Context) {
	settings, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	if settings.EffectivePublicBaseURL == "" {
		settings.EffectivePublicBaseURL = inferredPublicBaseURL(c, h.Cfg.BasePath)
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) PutIntegrationSettings(c *gin.Context) {
	var req struct {
		PublicBaseURL    string `json:"public_base_url"`
		GuestReadEnabled bool   `json:"guest_read_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	settings, err := service.SetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL, req.PublicBaseURL, req.GuestReadEnabled)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) GetChangePriority(c *gin.Context) {
	cfg, err := service.GetChangePriorityConfig(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h AdminHandler) PutChangePriority(c *gin.Context) {
	var req service.ChangePriorityConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	cfg, err := service.SetChangePriorityConfig(h.DB, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to save settings"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h AdminHandler) UpdateProfile(c *gin.Context) {
	user, ok := middleware.GetCurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	updates := map[string]any{}
	if strings.TrimSpace(req.Username) != "" {
		updates["username"] = strings.TrimSpace(req.Username)
	}
	if strings.TrimSpace(req.Password) != "" {
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to hash password"})
			return
		}
		updates["password_hash"] = hash
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "nothing to update"})
		return
	}

	if err := h.DB.Model(&models.AdminUser{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to update profile"})
		return
	}

	token, _ := c.Cookie(h.Cfg.SessionCookieName)
	if token != "" {
		_ = h.DB.Delete(&models.Session{}, "token = ?", token).Error
	}
	setSessionCookie(c, h.Cfg, "", -1)
	c.JSON(http.StatusOK, gin.H{"status": "reauth_required"})
}

func (h AdminHandler) HeaderPreview(c *gin.Context) {
	variant := c.DefaultQuery("variant", "loader")
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	publicBaseURL := c.Query("public_base_url")
	if strings.TrimSpace(publicBaseURL) != "" {
		normalized, err := service.ValidatePublicBaseURL(publicBaseURL)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
			return
		}
		integration.EffectivePublicBaseURL = normalized
	}
	if integration.EffectivePublicBaseURL == "" {
		integration.EffectivePublicBaseURL = inferredPublicBaseURL(c, h.Cfg.BasePath)
	}
	c.JSON(http.StatusOK, gin.H{
		"variant": variant,
		"code":    service.HeaderPreview(h.Cfg, integration.EffectivePublicBaseURL, integration.GuestReadEnabled, variant),
	})
}
