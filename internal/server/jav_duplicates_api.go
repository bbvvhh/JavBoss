package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

type javDuplicateWhitelistRequest struct {
	JavIDs []int64 `json:"jav_ids" binding:"required,min=1,dive,gt=0"`
}

// listJavDuplicates returns JAV works that resolve to more than one active video
// file, excluding whitelisted works.
func listJavDuplicates(c *gin.Context) {
	limit := queryInt(c, "limit", 100)
	offset := queryInt(c, "offset", 0)
	items, total, err := dbpkg.SearchJavDuplicates(
		c.Request.Context(),
		strings.TrimSpace(c.Query("search")),
		strings.TrimSpace(c.Query("sort")),
		limit,
		offset,
		nil,
	)
	if err != nil {
		logging.Error("list jav duplicates error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "查重失败", "Failed to scan duplicates")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": total,
	})
}

func listJavDuplicateWhitelist(c *gin.Context) {
	items, err := dbpkg.ListJavDuplicateWhitelist(c.Request.Context())
	if err != nil {
		logging.Error("list jav duplicate whitelist error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载查重白名单失败", "Failed to load the duplicate whitelist")
		return
	}
	if items == nil {
		items = []models.JavDuplicateWhitelist{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func addJavDuplicateWhitelist(c *gin.Context) {
	var req javDuplicateWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "请提供要加入白名单的作品", "JAV item IDs are required")
		return
	}
	added, err := dbpkg.AddJavDuplicateWhitelist(c.Request.Context(), req.JavIDs)
	if err != nil {
		logging.Error("add jav duplicate whitelist error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加入查重白名单失败", "Failed to add to the duplicate whitelist")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "added": added})
}

func removeJavDuplicateWhitelist(c *gin.Context) {
	var req javDuplicateWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "请提供要移出白名单的作品", "JAV item IDs are required")
		return
	}
	removed, err := dbpkg.RemoveJavDuplicateWhitelist(c.Request.Context(), req.JavIDs)
	if err != nil {
		logging.Error("remove jav duplicate whitelist error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "移出查重白名单失败", "Failed to remove from the duplicate whitelist")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "removed": removed})
}
