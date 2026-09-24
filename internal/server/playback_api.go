package server

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

// parseVideoIDParam 解析 /videos/:id 之类的路径参数。
func parseVideoIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "视频 ID 无效", "Invalid video ID")
		return 0, false
	}
	return id, true
}

// listPlaybackHistory 返回播放记录列表（视频模块与 JAV 模块合在一起，按播放时间倒序）。
func listPlaybackHistory(c *gin.Context) {
	limit := queryInt(c, "limit", 50)
	offset := queryInt(c, "offset", 0)

	items, err := dbpkg.ListPlaybackHistory(c.Request.Context(), limit, offset)
	if err != nil {
		logging.Error("list playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载播放记录失败", "Failed to load playback history")
		return
	}
	total, err := dbpkg.CountPlaybackHistory(c.Request.Context())
	if err != nil {
		logging.Error("count playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "统计播放记录失败", "Failed to count playback history")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": total,
	})
}

// getVideoPlayback 返回单个视频文件的播放记录；没有记录时 playback 为 null。
func getVideoPlayback(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	if video, err := dbpkg.GetVideo(c.Request.Context(), videoID); err != nil {
		logging.Error("get video for playback error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	} else if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	record, err := dbpkg.GetPlaybackHistory(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("get playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载播放记录失败", "Failed to load playback history")
		return
	}
	c.JSON(http.StatusOK, gin.H{"playback": record})
}

// updateVideoPlayback 上报播放进度。播放器每几秒、暂停与关闭时各调一次。
func updateVideoPlayback(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	var request struct {
		PositionSec float64 `json:"position_sec"`
		// 浏览器播放器的 duration 是浮点秒数（video.js 的 duration() 返回 double），
		// 这里必须按浮点接收再取整：解到 int64 会直接报类型错误，前端每次上报都 400。
		DurationSec float64 `json:"duration_sec"`
		LocationID  int64   `json:"location_id"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "播放进度格式不正确", "Invalid playback position")
		return
	}
	if video, err := dbpkg.GetVideo(c.Request.Context(), videoID); err != nil {
		logging.Error("get video for playback error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	} else if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	record := models.PlaybackHistory{
		VideoID:     videoID,
		LocationID:  request.LocationID,
		PositionSec: request.PositionSec,
		DurationSec: int64(math.Round(request.DurationSec)),
		PlayedAt:    time.Now(),
	}
	if err := dbpkg.UpsertPlaybackHistory(c.Request.Context(), record); err != nil {
		logging.Error("upsert playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存播放进度失败", "Failed to save playback position")
		return
	}
	c.JSON(http.StatusOK, gin.H{"playback": record})
}

// deleteVideoPlayback 清除播放记录（播放结束或用户选择从头播放）。
func deleteVideoPlayback(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	if err := dbpkg.DeletePlaybackHistory(c.Request.Context(), videoID); err != nil {
		logging.Error("delete playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "清除播放记录失败", "Failed to clear playback history")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// clearPlaybackHistory 清空全部播放记录（移动端「清空观看记录」会同时调用）。
func clearPlaybackHistory(c *gin.Context) {
	deleted, err := dbpkg.ClearPlaybackHistory(c.Request.Context())
	if err != nil {
		logging.Error("clear playback history error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "清空播放记录失败", "Failed to clear playback history")
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": deleted})
}
