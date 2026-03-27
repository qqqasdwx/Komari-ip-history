package handlers

import (
	"net/http"
	"time"

	"komari-ip-history/internal/auth"
	"komari-ip-history/internal/config"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/models"

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

	c.SetCookie(
		h.Cfg.SessionCookieName,
		token,
		int(h.Cfg.SessionTTL.Seconds()),
		cookiePath(h.Cfg),
		"",
		h.Cfg.CookieSecure,
		true,
	)

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

	c.SetCookie(h.Cfg.SessionCookieName, "", -1, cookiePath(h.Cfg), "", h.Cfg.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h AuthHandler) Me(c *gin.Context) {
	user, ok := middleware.GetCurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"logged_in": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"logged_in":       true,
		"username":        user.Username,
		"app_env":         h.Cfg.AppEnv,
		"base_path":       h.Cfg.BasePath,
		"public_base_url": h.Cfg.PublicBaseURL,
	})
}

func cookiePath(cfg config.Config) string {
	if cfg.BasePath == "" {
		return "/"
	}
	return cfg.BasePath
}
