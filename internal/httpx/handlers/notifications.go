package handlers

import (
	"errors"
	"net/http"

	"komari-ip-history/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h AdminHandler) GetNotificationSettings(c *gin.Context) {
	settings, err := service.GetNotificationSettings(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification settings"})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) PutNotificationSettings(c *gin.Context) {
	var req service.NotificationSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	settings, err := service.SetNotificationSettings(h.DB, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h AdminHandler) ListNotificationChannels(c *gin.Context) {
	items, err := service.ListNotificationChannels(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification channels"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) CreateNotificationChannel(c *gin.Context) {
	var req service.NotificationChannelInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.CreateNotificationChannel(h.DB, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) UpdateNotificationChannel(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	var req service.NotificationChannelUpdateInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.UpdateNotificationChannel(h.DB, id, req)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteNotificationChannel(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	if err := service.DeleteNotificationChannel(h.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification channel not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to delete notification channel"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) TestNotificationChannel(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid channel id"})
		return
	}
	item, err := service.TestNotificationChannel(h.DB, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) ListNotificationRules(c *gin.Context) {
	items, err := service.ListNotificationRules(h.DB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h AdminHandler) CreateNotificationRule(c *gin.Context) {
	var req service.NotificationRuleInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.CreateNotificationRule(h.DB, req)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification channel not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) UpdateNotificationRule(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid rule id"})
		return
	}
	var req service.NotificationRuleUpdateInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request"})
		return
	}
	item, err := service.UpdateNotificationRule(h.DB, id, req)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification rule not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h AdminHandler) DeleteNotificationRule(c *gin.Context) {
	id, ok := parseIDParam(c.Param("id"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid rule id"})
		return
	}
	if err := service.DeleteNotificationRule(h.DB, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "notification rule not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to delete notification rule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h AdminHandler) ListNotificationDeliveryLogs(c *gin.Context) {
	page := parsePositiveInt(c.Query("page"))
	pageSize := parsePositiveInt(c.Query("page_size"))
	items, err := service.ListNotificationDeliveryLogs(h.DB, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to load notification delivery logs"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h AdminHandler) ClearNotificationDeliveryLogs(c *gin.Context) {
	if err := service.ClearNotificationDeliveryLogs(h.DB); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "failed to clear notification delivery logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
