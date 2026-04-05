package handlers

import (
	"net/http"
	"strings"
	"time"

	"komari-ip-history/internal/auth"
	"komari-ip-history/internal/config"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/models"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	var user models.AdminUser
	if err := h.DB.First(&user, "username = ?", req.Username).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid username or password"})
		return
	}
	if !auth.CheckPassword(user.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid username or password"})
		return
	}

	token, err := auth.NewSessionToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to create session"})
		return
	}

	session := models.Session{
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(h.Cfg.SessionTTL),
	}
	if err := h.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to create session"})
		return
	}

	setSessionCookie(c, h.Cfg, token, int(h.Cfg.SessionTTL.Seconds()))

	c.JSON(http.StatusOK, gin.H{
		"username":  user.Username,
		"base_path": h.Cfg.BasePath,
	})
}

func (h AuthHandler) Logout(c *gin.Context) {
	token, _ := c.Cookie(h.Cfg.SessionCookieName)
	if token != "" {
		_ = h.DB.Delete(&models.Session{}, "token = ?", token).Error
	}

	setSessionCookie(c, h.Cfg, "", -1)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h AuthHandler) Me(c *gin.Context) {
	user, ok := middleware.GetCurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"logged_in": false})
		return
	}
	integration, err := service.GetIntegrationSettings(h.DB, h.Cfg.PublicBaseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load settings"})
		return
	}
	if integration.EffectivePublicBaseURL == "" {
		integration.EffectivePublicBaseURL = inferredPublicBaseURL(c, h.Cfg.BasePath)
	}
	c.JSON(http.StatusOK, gin.H{
		"logged_in":                 true,
		"username":                  user.Username,
		"app_env":                   h.Cfg.AppEnv,
		"base_path":                 h.Cfg.BasePath,
		"public_base_url":           integration.PublicBaseURL,
		"effective_public_base_url": integration.EffectivePublicBaseURL,
	})
}

func requestCookieSecure(c *gin.Context, cfg config.Config) bool {
	if cfg.CookieSecure {
		return true
	}

	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if index := strings.Index(scheme, ","); index >= 0 {
		scheme = strings.TrimSpace(scheme[:index])
	}
	if strings.EqualFold(scheme, "https") {
		return true
	}
	return c.Request.TLS != nil
}

func cookiePath(cfg config.Config) string {
	if cfg.BasePath == "" {
		return "/"
	}
	return cfg.BasePath
}

func setSessionCookie(c *gin.Context, cfg config.Config, value string, maxAge int) {
	secure := requestCookieSecure(c, cfg)
	if secure {
		c.SetSameSite(http.SameSiteNoneMode)
	} else {
		c.SetSameSite(http.SameSiteLaxMode)
	}

	c.SetCookie(
		cfg.SessionCookieName,
		value,
		maxAge,
		cookiePath(cfg),
		"",
		secure,
		true,
	)
}
