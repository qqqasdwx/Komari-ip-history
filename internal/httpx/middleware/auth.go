package middleware

import (
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const currentUserKey = "current_user"

func SessionAuth(db *gorm.DB, cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(cfg.SessionCookieName)
		if err != nil || token == "" {
			c.Next()
			return
		}

		var session models.Session
		if err := db.Preload("User").First(&session, "token = ?", token).Error; err != nil {
			c.Next()
			return
		}
		if session.ExpiresAt.Before(time.Now()) {
			_ = db.Delete(&session).Error
			c.Next()
			return
		}

		c.Set(currentUserKey, session.User)
		c.Next()
	}
}

func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := GetCurrentUser(c); !ok {
			c.JSON(401, gin.H{"message": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func GetCurrentUser(c *gin.Context) (models.AdminUser, bool) {
	value, ok := c.Get(currentUserKey)
	if !ok {
		return models.AdminUser{}, false
	}
	user, ok := value.(models.AdminUser)
	return user, ok
}
