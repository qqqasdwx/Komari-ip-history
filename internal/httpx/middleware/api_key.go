package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"komari-ip-history/internal/models"
)

const currentAPIKeyContextKey = "current_api_key"

type APIKeyMiddlewareOption func(*apiKeyMiddlewareConfig)

type apiKeyMiddlewareConfig struct {
	rateLimitRequests int
	rateLimitWindow   time.Duration
}

type apiRateLimitState struct {
	windowStartedAt time.Time
	requests        int
}

type apiRateLimiter struct {
	mu     sync.Mutex
	states map[uint]apiRateLimitState
}

var publicAPIRateLimiter = &apiRateLimiter{
	states: make(map[uint]apiRateLimitState),
}

func WithPublicAPIRateLimit(maxRequests int, window time.Duration) APIKeyMiddlewareOption {
	return func(cfg *apiKeyMiddlewareConfig) {
		if maxRequests > 0 {
			cfg.rateLimitRequests = maxRequests
		}
		if window > 0 {
			cfg.rateLimitWindow = window
		}
	}
}

func RequireAPIKey(db *gorm.DB, options ...APIKeyMiddlewareOption) gin.HandlerFunc {
	cfg := apiKeyMiddlewareConfig{
		rateLimitRequests: 120,
		rateLimitWindow:   time.Minute,
	}
	for _, option := range options {
		if option != nil {
			option(&cfg)
		}
	}

	return func(c *gin.Context) {
		key := strings.TrimSpace(c.GetHeader("X-IPQ-API-Key"))
		if key == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "missing api key"})
			c.Abort()
			return
		}
		model, err := service.ValidateAPIKey(db, key)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid api key"})
			c.Abort()
			return
		}
		c.Set(currentAPIKeyContextKey, *model)

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		if !publicAPIRateLimiter.Allow(model.ID, cfg.rateLimitRequests, cfg.rateLimitWindow, time.Now().UTC()) {
			_ = service.RecordAPIAccessLog(db, model.ID, c.Request.Method, path, http.StatusTooManyRequests, c.ClientIP())
			c.Header("Retry-After", strconvInt(int(cfg.rateLimitWindow.Seconds())))
			c.JSON(http.StatusTooManyRequests, gin.H{"message": "rate limit exceeded"})
			c.Abort()
			return
		}

		c.Next()
		_ = service.RecordAPIAccessLog(db, model.ID, c.Request.Method, path, c.Writer.Status(), c.ClientIP())
	}
}

func GetCurrentAPIKey(c *gin.Context) (models.APIKey, bool) {
	value, ok := c.Get(currentAPIKeyContextKey)
	if !ok {
		return models.APIKey{}, false
	}
	model, ok := value.(models.APIKey)
	return model, ok
}

func (l *apiRateLimiter) Allow(apiKeyID uint, maxRequests int, window time.Duration, now time.Time) bool {
	if l == nil || apiKeyID == 0 || maxRequests <= 0 || window <= 0 {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	state := l.states[apiKeyID]
	if state.windowStartedAt.IsZero() || now.Sub(state.windowStartedAt) >= window {
		l.states[apiKeyID] = apiRateLimitState{
			windowStartedAt: now,
			requests:        1,
		}
		return true
	}
	if state.requests >= maxRequests {
		return false
	}
	state.requests += 1
	l.states[apiKeyID] = state
	return true
}

func ResetPublicAPIRateLimiterForTesting() {
	if publicAPIRateLimiter == nil {
		return
	}
	publicAPIRateLimiter.mu.Lock()
	defer publicAPIRateLimiter.mu.Unlock()
	publicAPIRateLimiter.states = make(map[uint]apiRateLimitState)
}

func strconvInt(value int) string {
	return strconv.FormatInt(int64(value), 10)
}
