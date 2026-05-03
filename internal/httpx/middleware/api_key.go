package middleware

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"komari-ip-history/internal/models"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const currentAPIKeyKey = "current_api_key"

type APIKeyRateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]apiKeyRateBucket
}

type apiKeyRateBucket struct {
	WindowStart time.Time
	Count       int
}

func NewAPIKeyRateLimiter(limit int, window time.Duration) *APIKeyRateLimiter {
	return &APIKeyRateLimiter{
		limit:   limit,
		window:  window,
		buckets: make(map[string]apiKeyRateBucket),
	}
}

func (l *APIKeyRateLimiter) Allow(identity string, now time.Time) (bool, time.Duration) {
	if l == nil || l.limit <= 0 {
		return true, 0
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if l.window <= 0 {
		l.window = time.Minute
	}

	bucket := l.buckets[identity]
	if bucket.WindowStart.IsZero() || now.Sub(bucket.WindowStart) >= l.window {
		l.buckets[identity] = apiKeyRateBucket{WindowStart: now, Count: 1}
		return true, 0
	}
	if bucket.Count >= l.limit {
		return false, l.window - now.Sub(bucket.WindowStart)
	}
	bucket.Count += 1
	l.buckets[identity] = bucket
	return true, 0
}

func RequireAPIKey(db *gorm.DB, limiter *APIKeyRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractAPIKeyToken(c)
		key, err := service.VerifyAPIKey(db, token)
		if err != nil {
			status := http.StatusUnauthorized
			message := "unauthorized"
			if errors.Is(err, service.ErrAPIKeyDisabled) {
				status = http.StatusForbidden
				message = "api key disabled"
			}
			c.JSON(status, gin.H{"message": message})
			c.Abort()
			service.RecordAPIAccessLog(db, nil, service.APIKeyDisplayPrefix(token), c.Request.Method, c.Request.URL.RequestURI(), c.ClientIP(), status)
			return
		}

		allowed, retryAfter := limiter.Allow(strconv.FormatUint(uint64(key.ID), 10), time.Now().UTC())
		if !allowed {
			status := http.StatusTooManyRequests
			if retryAfter > 0 {
				c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
			}
			c.JSON(status, gin.H{"message": "rate limit exceeded"})
			c.Abort()
			service.RecordAPIAccessLog(db, &key, "", c.Request.Method, c.Request.URL.RequestURI(), c.ClientIP(), status)
			return
		}

		c.Set(currentAPIKeyKey, key)
		c.Next()
		status := c.Writer.Status()
		if status <= 0 {
			status = http.StatusOK
		}
		service.RecordAPIAccessLog(db, &key, "", c.Request.Method, c.Request.URL.RequestURI(), c.ClientIP(), status)
	}
}

func GetCurrentAPIKey(c *gin.Context) (models.APIKey, bool) {
	value, ok := c.Get(currentAPIKeyKey)
	if !ok {
		return models.APIKey{}, false
	}
	key, ok := value.(models.APIKey)
	return key, ok
}

func extractAPIKeyToken(c *gin.Context) string {
	if token := strings.TrimSpace(c.GetHeader("X-API-Key")); token != "" {
		return token
	}

	authorization := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:])
	}

	return ""
}
