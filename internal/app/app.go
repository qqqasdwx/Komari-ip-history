package app

import (
	"net/http"
	"time"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/database"
	"komari-ip-history/internal/httpx/handlers"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/render"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
)

func Run() error {
	cfg := config.Load()

	db, err := database.Open(cfg)
	if err != nil {
		return err
	}
	_ = database.CleanupExpiredSessions(db)
	_, _ = service.CleanupExpiredHistorySnapshots(db, time.Now().UTC())
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for tick := range ticker.C {
			_, _ = service.CleanupExpiredHistorySnapshots(db, tick.UTC())
		}
	}()

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	router.Use(middleware.SessionAuth(db, cfg))

	authHandler := handlers.AuthHandler{DB: db, Cfg: cfg}
	adminHandler := handlers.AdminHandler{DB: db, Cfg: cfg}
	nodeHandler := handlers.NodeHandler{DB: db, Cfg: cfg}
	embedHandler := handlers.EmbedHandler{DB: db, Cfg: cfg}
	publicHandler := handlers.PublicHandler{DB: db, Cfg: cfg}
	reportHandler := handlers.ReportHandler{DB: db, Cfg: cfg}

	api := router.Group(cfg.APIBase())
	{
		api.GET("/health", handlers.Health)
		api.GET("/auth/me", authHandler.Me)
		api.POST("/auth/login", authHandler.Login)
		api.POST("/auth/logout", authHandler.Logout)

		api.POST("/embed/nodes/register", embedHandler.Register)
		api.GET("/public/nodes/:uuid/current", publicHandler.Current)
		api.GET("/report/nodes/:uuid/install.sh", reportHandler.InstallScript)
		api.POST("/report/nodes/:uuid", reportHandler.Report)

		admin := api.Group("/admin")
		admin.Use(middleware.RequireAdmin())
		{
			admin.GET("/runtime", adminHandler.Runtime)
			admin.GET("/integration", adminHandler.GetIntegrationSettings)
			admin.PUT("/integration", adminHandler.PutIntegrationSettings)
			admin.GET("/history-retention", adminHandler.GetHistoryRetentionSettings)
			admin.PUT("/history-retention", adminHandler.PutHistoryRetentionSettings)
			admin.PUT("/profile", adminHandler.UpdateProfile)
			admin.GET("/header-preview", adminHandler.HeaderPreview)
		}

		nodes := api.Group("/nodes")
		nodes.Use(middleware.RequireAdmin())
		{
			nodes.GET("", nodeHandler.List)
			nodes.GET("/:uuid", nodeHandler.Detail)
			nodes.GET("/:uuid/history", nodeHandler.History)
			nodes.GET("/:uuid/history/events", nodeHandler.HistoryEvents)
			nodes.GET("/:uuid/history/fields", nodeHandler.HistoryFields)
			nodes.GET("/:uuid/history/:historyID", nodeHandler.HistoryDetail)
			nodes.POST("/:uuid/history/:historyID/favorite", nodeHandler.FavoriteHistory)
			nodes.DELETE("/:uuid/history/:historyID/favorite", nodeHandler.UnfavoriteHistory)
			nodes.POST("/:uuid/targets", nodeHandler.AddTarget)
			nodes.DELETE("/:uuid/targets/:targetID", nodeHandler.DeleteTarget)
			nodes.POST("/:uuid/targets/reorder", nodeHandler.ReorderTargets)
			nodes.GET("/:uuid/report-config/preview", nodeHandler.PreviewReportConfig)
			nodes.PUT("/:uuid/report-config", nodeHandler.UpdateReportConfig)
			nodes.POST("/:uuid/reporter-token/rotate", nodeHandler.RotateReporterToken)
			nodes.DELETE("/:uuid", nodeHandler.Delete)
		}
	}

	router.GET(cfg.BasePath+"/embed/loader.js", embedHandler.Loader)
	render.MountSPA(router, cfg)

	server := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: router,
	}
	return server.ListenAndServe()
}
