package handlers

import (
	"net/http"

	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type NodeHandler struct {
	DB *gorm.DB
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
	detail, err := service.GetNodeDetail(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h NodeHandler) History(c *gin.Context) {
	detail, err := service.GetNodeDetail(h.DB, c.Param("uuid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": detail.History})
}

func (h NodeHandler) Delete(c *gin.Context) {
	if err := service.DeleteNode(h.DB, c.Param("uuid")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "node not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
