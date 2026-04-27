package handlers

import (
	"errors"
	"net/http"
	"strconv"
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

func (h AdminHandler) GetHistoryRetentionSettings(c *gin.Context) {
	settings, err := service.GetHistoryRetentionSettings(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load history retention settings"})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) PutHistoryRetentionSettings(c *gin.Context) {
	var req struct {
		RetentionDays int `json:"retention_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	settings, err := service.SetHistoryRetentionSettings(h.DB, req.RetentionDays)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
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
		if isUniqueConstraintErr(err) {
			c.JSON(http.StatusConflict, gin.H{"message": "username already exists"})
			return
		}
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

func isUniqueConstraintErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
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

func (h AdminHandler) ListNotificationProviderDefinitions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"items": service.ListNotificationProviderDefinitions()})
}

func (h AdminHandler) GetNotificationSettings(c *gin.Context) {
	settings, err := service.GetNotificationSettings(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification settings"})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) PutNotificationSettings(c *gin.Context) {
	var req struct {
		ActiveChannelID *uint  `json:"active_channel_id"`
		TitleTemplate   string `json:"title_template"`
		MessageTemplate string `json:"message_template"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	settings, err := service.SetNotificationSettings(h.DB, req.ActiveChannelID, req.TitleTemplate, req.MessageTemplate)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "channel not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to save notification settings"})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) ListNotificationChannels(c *gin.Context) {
	items, err := service.ListNotificationChannels(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification channels"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) CreateNotificationChannel(c *gin.Context) {
	var req service.NotificationChannelPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.CreateNotificationChannel(h.DB, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) UpdateNotificationChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("channelID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	var req service.NotificationChannelPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, updateErr := service.UpdateNotificationChannel(h.DB, uint(id), req)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) EnableNotificationChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("channelID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	item, updateErr := service.SetNotificationChannelEnabled(h.DB, uint(id), true)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DisableNotificationChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("channelID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	item, updateErr := service.SetNotificationChannelEnabled(h.DB, uint(id), false)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteNotificationChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("channelID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	if deleteErr := service.DeleteNotificationChannel(h.DB, uint(id)); deleteErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": deleteErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) ListNotificationRules(c *gin.Context) {
	items, err := service.ListNotificationRules(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) CreateNotificationRule(c *gin.Context) {
	var req service.NotificationRulePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.CreateNotificationRule(h.DB, req)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "related resource not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) UpdateNotificationRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("ruleID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid rule id"})
		return
	}
	var req service.NotificationRulePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, updateErr := service.UpdateNotificationRule(h.DB, uint(id), req)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "rule not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteNotificationRule(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("ruleID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid rule id"})
		return
	}
	if deleteErr := service.DeleteNotificationRule(h.DB, uint(id)); deleteErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": deleteErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) ListNotificationDeliveries(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	items, err := service.ListNotificationDeliveries(h.DB, limit, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification deliveries"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) ClearNotificationDeliveries(c *gin.Context) {
	if err := service.ClearNotificationDeliveries(h.DB); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to clear notification deliveries"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "cleared"})
}

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

func (h AdminHandler) EnableAPIKey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("keyID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid api key id"})
		return
	}
	item, updateErr := service.SetAPIKeyEnabled(h.DB, uint(id), true)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "api key not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DisableAPIKey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("keyID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid api key id"})
		return
	}
	item, updateErr := service.SetAPIKeyEnabled(h.DB, uint(id), false)
	if updateErr != nil {
		if errors.Is(updateErr, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "api key not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": updateErr.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteAPIKey(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("keyID"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid api key id"})
		return
	}
	if deleteErr := service.DeleteAPIKey(h.DB, uint(id)); deleteErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": deleteErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) ListAPIAccessLogs(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	var apiKeyID uint
	if raw := strings.TrimSpace(c.Query("api_key_id")); raw != "" {
		if parsed, err := strconv.ParseUint(raw, 10, 64); err == nil {
			apiKeyID = uint(parsed)
		}
	}
	items, err := service.ListAPIAccessLogs(h.DB, apiKeyID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load api access logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) TestNotificationChannel(c *gin.Context) {
	var req struct {
		ChannelID uint `json:"channel_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	if err := service.SendTestNotification(h.DB, req.ChannelID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
