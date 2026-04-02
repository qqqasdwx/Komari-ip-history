package handlers

import (
	"net/http"
	"strconv"

	"komari-ip-history/internal/config"
	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NodeHandler struct {
	DB  *gorm.DB
	Cfg config.Config
}

func (h NodeHandler) List(c *gin.Context) {
	items, err := service.ListNodes(h.DB, c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load nodes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h NodeHandler) Detail(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	detail, err := service.GetNodeDetail(h.DB, c.Param("uuid"), targetID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h NodeHandler) History(c *gin.Context) {
	targetID := parseTargetID(c.Query("target_id"))
	limit := parsePositiveInt(c.Query("limit"))
	items, err := service.GetNodeHistory(h.DB, c.Param("uuid"), targetID, limit)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h NodeHandler) AddTarget(c *gin.Context) {
	var req service.AddNodeTargetInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}

	item, err := service.AddNodeTarget(h.DB, h.Cfg, c.Param("uuid"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h NodeHandler) DeleteTarget(c *gin.Context) {
	targetIDValue, err := strconv.ParseUint(c.Param("targetID"), 10, 64)
	if err != nil || targetIDValue == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid target id"})
		return
	}
	if err := service.DeleteNodeTarget(h.DB, c.Param("uuid"), uint(targetIDValue)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "target not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h NodeHandler) ReorderTargets(c *gin.Context) {
	var req service.ReorderNodeTargetsInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	if err := service.ReorderNodeTargets(h.DB, c.Param("uuid"), req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h NodeHandler) Delete(c *gin.Context) {
	if err := service.DeleteNode(h.DB, c.Param("uuid")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h NodeHandler) RotateReporterToken(c *gin.Context) {
	config, err := service.RotateNodeReporterToken(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, config)
}

func parseTargetID(raw string) *uint {
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		return nil
	}
	targetID := uint(value)
	return &targetID
}

func parsePositiveInt(raw string) int {
	if raw == "" {
		return 0
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}
