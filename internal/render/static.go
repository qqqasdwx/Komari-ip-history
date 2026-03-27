package render

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"komari-ip-history/internal/config"

	"github.com/gin-gonic/gin"
)

func MountSPA(router *gin.Engine, cfg config.Config) {
	base := cfg.BasePath

	router.GET(base, serveIndex(cfg))
	router.GET(base+"/", serveIndex(cfg))
	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Status(http.StatusNotFound)
			return
		}

		requestPath := c.Request.URL.Path
		if requestPath != base && !strings.HasPrefix(requestPath, base+"/") {
			c.Status(http.StatusNotFound)
			return
		}

		relPath := strings.TrimPrefix(requestPath, base)
		if relPath == "" || relPath == "/" {
			serveIndex(cfg)(c)
			return
		}
		if strings.HasPrefix(relPath, "/api/") || strings.HasPrefix(relPath, "/embed/") {
			c.Status(http.StatusNotFound)
			return
		}

		publicPath := filepath.Join("public", filepath.Clean(strings.TrimPrefix(relPath, "/")))
		if info, err := os.Stat(publicPath); err == nil && !info.IsDir() {
			c.File(publicPath)
			return
		}

		serveIndex(cfg)(c)
	})
}

func serveIndex(cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		indexPath := filepath.Join("public", "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			c.File(indexPath)
			return
		}

		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>`+cfg.AppName+`</title>
  </head>
  <body>
    <pre>`+fmt.Sprintf("%s frontend is not built yet.\nRun the web build or use the development compose environment.", cfg.AppName)+`</pre>
  </body>
</html>`)
	}
}
