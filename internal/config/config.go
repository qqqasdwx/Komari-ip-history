package config

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	AppName           string
	AppEnv            string
	ListenAddr        string
	BasePath          string
	DatabasePath      string
	SessionCookieName string
	SessionTTL        time.Duration
	DefaultAdminUser  string
	DefaultAdminPass  string
	PublicBaseURL     string
	CookieSecure      bool
}

func Load() Config {
	return Config{
		AppName:           env("IPQ_APP_NAME", "Komari IP Quality"),
		AppEnv:            env("IPQ_APP_ENV", "production"),
		ListenAddr:        env("IPQ_LISTEN", ":8090"),
		BasePath:          normalizeBasePath(env("IPQ_BASE_PATH", "")),
		DatabasePath:      filepath.Clean(env("IPQ_DB_PATH", "./data/ipq.db")),
		SessionCookieName: env("IPQ_SESSION_COOKIE", "ipq_session"),
		SessionTTL:        30 * 24 * time.Hour,
		DefaultAdminUser:  env("IPQ_DEFAULT_ADMIN_USERNAME", "admin"),
		DefaultAdminPass:  env("IPQ_DEFAULT_ADMIN_PASSWORD", "admin"),
		PublicBaseURL:     strings.TrimRight(env("IPQ_PUBLIC_BASE_URL", ""), "/"),
		CookieSecure:      strings.EqualFold(env("IPQ_COOKIE_SECURE", "false"), "true"),
	}
}

func (c Config) IsDevelopment() bool {
	return strings.EqualFold(c.AppEnv, "development")
}

func (c Config) APIBase() string {
	return c.BasePath + "/api/v1"
}

func normalizeBasePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return strings.TrimRight(path, "/")
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
