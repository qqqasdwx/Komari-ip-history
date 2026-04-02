package app

import (
	"net/http"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/database"
	"komari-ip-history/internal/httpx/handlers"
	"komari-ip-history/internal/httpx/middleware"
	"komari-ip-history/internal/render"

	"github.com/gin-gonic/gin"
)

func Run() error {
	cfg := config.Load()

	db, err := database.Open(cfg)
	if err != nil {
		return err
	}
	_ = database.CleanupExpiredSessions(db)

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
			admin.PUT("/profile", adminHandler.UpdateProfile)
			admin.GET("/header-preview", adminHandler.HeaderPreview)
		}

		nodes := api.Group("/nodes")
		nodes.Use(middleware.RequireAdmin())
		{
			nodes.GET("", nodeHandler.List)
			nodes.GET("/:uuid", nodeHandler.Detail)
			nodes.GET("/:uuid/history", nodeHandler.History)
			nodes.POST("/:uuid/targets", nodeHandler.AddTarget)
			nodes.DELETE("/:uuid/targets/:targetID", nodeHandler.DeleteTarget)
			nodes.POST("/:uuid/targets/reorder", nodeHandler.ReorderTargets)
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
