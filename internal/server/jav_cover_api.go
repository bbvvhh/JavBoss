package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/manager"
)

// JavCoverRedownloadOnMissingKey 是「封面文件缺失时是否自动重新下载」的配置键。
const JavCoverRedownloadOnMissingKey = "jav_cover_redownload_on_missing"

// javCoverRedownloadOnMissingEnabled 读取上述开关。键缺失或值非法时按开启处理，
// 与加入开关之前的行为保持一致。
func javCoverRedownloadOnMissingEnabled(ctx context.Context) bool {
	entries, err := dbpkg.ListConfig(ctx)
	if err != nil {
		logging.Error("load jav cover redownload setting failed: %v", err)
		return true
	}
	value := strings.TrimSpace(entries[JavCoverRedownloadOnMissingKey])
	if value == "" {
		return true
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return true
	}
	return enabled
}

// getJavCover serves a downloaded JAV cover if present; otherwise enqueues and returns 404.
func getJavCover(c *gin.Context) {
	code := c.Param("code")
	cfg := common.AppConfig
	if cfg == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return
	}

	c.Header("Cache-Control", "no-cache, must-revalidate")

	if path, ok := manager.FindCoverPath(cfg.JavCoverDir, code); ok {
		c.File(path)
		return
	}

	if common.CoverManager != nil && javCoverRedownloadOnMissingEnabled(c.Request.Context()) {
		common.CoverManager.Enqueue(code)
	}
	respondLocalizedError(c, http.StatusNotFound, "JAV 封面不存在", "JAV cover was not found")
}

func updateJavCover(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	cfg := common.AppConfig
	if cfg == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "应用配置尚未加载", "Application configuration is not loaded")
		return
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "更新 JAV 封面请求无效", "Invalid JAV cover update request")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	if err := manager.DownloadCoverFromURL(ctx, cfg.JavCoverDir, code, req.URL); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "下载 JAV 封面失败，请检查图片地址", "Failed to download the JAV cover; check the image URL")
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": strings.ToLower(code)})
}
