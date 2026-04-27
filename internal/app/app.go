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
		api.GET("/embed/nodes/register", embedHandler.RegisterBeacon)
		api.GET("/public/nodes/:uuid/current", publicHandler.Current)
		api.GET("/report/install-config/:installToken", reportHandler.InstallConfigByToken)
		api.GET("/report/install-script/:installToken", reportHandler.InstallScriptByToken)
		api.GET("/report/local-probe", reportHandler.LocalProbe)
		api.GET("/report/nodes/:uuid/install.sh", reportHandler.InstallScript)
		api.GET("/report/nodes/:uuid/install-config", reportHandler.InstallConfig)
		api.POST("/report/nodes/:uuid/plan", reportHandler.Plan)
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
			admin.GET("/notification/settings", adminHandler.GetNotificationSettings)
			admin.PUT("/notification/settings", adminHandler.PutNotificationSettings)
			admin.GET("/notification/providers", adminHandler.ListNotificationProviderDefinitions)
			admin.GET("/notification/channels", adminHandler.ListNotificationChannels)
			admin.POST("/notification/channels", adminHandler.CreateNotificationChannel)
			admin.PUT("/notification/channels/:channelID", adminHandler.UpdateNotificationChannel)
			admin.POST("/notification/channels/:channelID/enable", adminHandler.EnableNotificationChannel)
			admin.POST("/notification/channels/:channelID/disable", adminHandler.DisableNotificationChannel)
			admin.DELETE("/notification/channels/:channelID", adminHandler.DeleteNotificationChannel)
			admin.POST("/notification/test", adminHandler.TestNotificationChannel)
			admin.GET("/notification/rules", adminHandler.ListNotificationRules)
			admin.POST("/notification/rules", adminHandler.CreateNotificationRule)
			admin.PUT("/notification/rules/:ruleID", adminHandler.UpdateNotificationRule)
			admin.DELETE("/notification/rules/:ruleID", adminHandler.DeleteNotificationRule)
			admin.GET("/notification/deliveries", adminHandler.ListNotificationDeliveries)
			admin.DELETE("/notification/deliveries", adminHandler.ClearNotificationDeliveries)
			admin.GET("/api-keys", adminHandler.ListAPIKeys)
			admin.POST("/api-keys", adminHandler.CreateAPIKey)
			admin.POST("/api-keys/:keyID/enable", adminHandler.EnableAPIKey)
			admin.POST("/api-keys/:keyID/disable", adminHandler.DisableAPIKey)
			admin.DELETE("/api-keys/:keyID", adminHandler.DeleteAPIKey)
			admin.GET("/api-access-logs", adminHandler.ListAPIAccessLogs)
		}

		nodes := api.Group("/nodes")
		nodes.Use(middleware.RequireAdmin())
		{
			nodes.POST("", nodeHandler.Create)
			nodes.GET("", nodeHandler.List)
			nodes.GET("/komari-binding/candidates", nodeHandler.KomariBindingCandidates)
			nodes.GET("/:uuid", nodeHandler.Detail)
			nodes.PUT("/:uuid", nodeHandler.Update)
			nodes.GET("/:uuid/history", nodeHandler.History)
			nodes.GET("/:uuid/history/events", nodeHandler.HistoryEvents)
			nodes.GET("/:uuid/history/fields", nodeHandler.HistoryFields)
			nodes.POST("/:uuid/history/:historyID/favorite", nodeHandler.FavoriteHistory)
			nodes.DELETE("/:uuid/history/:historyID/favorite", nodeHandler.UnfavoriteHistory)
			nodes.POST("/:uuid/targets", nodeHandler.AddTarget)
			nodes.DELETE("/:uuid/targets/:targetID", nodeHandler.DeleteTarget)
			nodes.POST("/:uuid/targets/:targetID/enable", nodeHandler.EnableTarget)
			nodes.POST("/:uuid/targets/:targetID/disable", nodeHandler.DisableTarget)
			nodes.POST("/:uuid/targets/reorder", nodeHandler.ReorderTargets)
			nodes.GET("/:uuid/report-config/preview", nodeHandler.PreviewReportConfig)
			nodes.PUT("/:uuid/report-config", nodeHandler.UpdateReportConfig)
			nodes.POST("/komari-binding", nodeHandler.BindKomari)
			nodes.DELETE("/komari-binding", nodeHandler.UnbindKomari)
			nodes.POST("/:uuid/reporter-token/rotate", nodeHandler.RotateReporterToken)
			nodes.DELETE("/:uuid", nodeHandler.Delete)
		}
	}

	registerPublicAPIRoutes := func(group *gin.RouterGroup) {
		group.Use(middleware.RequireAPIKey(db))
		group.GET("/nodes", publicHandler.APIList)
		group.GET("/nodes/:uuid", publicHandler.APIDetail)
		group.GET("/nodes/:uuid/targets", publicHandler.APITargets)
		group.GET("/nodes/:uuid/targets/:targetID", publicHandler.APITargetDetail)
		group.GET("/nodes/:uuid/history", publicHandler.APIHistory)
		group.GET("/nodes/:uuid/history/events", publicHandler.APIHistoryEvents)
	}

	registerPublicAPIRoutes(api.Group("/public/v1"))
	registerPublicAPIRoutes(router.Group(cfg.BasePath + "/api/public/v1"))

	router.GET(cfg.BasePath+"/embed/loader.js", embedHandler.Loader)
	render.MountSPA(router, cfg)

	server := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: router,
	}
	return server.ListenAndServe()
}
