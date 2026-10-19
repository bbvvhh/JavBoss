package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
)

// listWatchLater 返回「稍后观看」列表，按加入时间倒序。
func listWatchLater(c *gin.Context) {
	limit := queryInt(c, "limit", 50)
	offset := queryInt(c, "offset", 0)

	items, err := dbpkg.ListWatchLater(c.Request.Context(), limit, offset)
	if err != nil {
		logging.Error("list watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载稍后观看失败", "Failed to load watch later list")
		return
	}
	total, err := dbpkg.CountWatchLater(c.Request.Context())
	if err != nil {
		logging.Error("count watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "统计稍后观看失败", "Failed to count watch later list")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": total,
	})
}

// getVideoWatchLater 报告某个视频是否在「稍后观看」列表里。
func getVideoWatchLater(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	if video, err := dbpkg.GetVideo(c.Request.Context(), videoID); err != nil {
		logging.Error("get video for watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	} else if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	inList, err := dbpkg.IsInWatchLater(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("check watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载稍后观看失败", "Failed to load watch later list")
		return
	}
	c.JSON(http.StatusOK, gin.H{"in_list": inList})
}

// addVideoWatchLater 把视频加入「稍后观看」（重复加入是幂等的）。
func addVideoWatchLater(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	if video, err := dbpkg.GetVideo(c.Request.Context(), videoID); err != nil {
		logging.Error("get video for watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	} else if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}
	if err := dbpkg.AddWatchLater(c.Request.Context(), videoID); err != nil {
		logging.Error("add watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加入稍后观看失败", "Failed to add to watch later")
		return
	}
	c.JSON(http.StatusOK, gin.H{"in_list": true})
}

// removeVideoWatchLater 把视频移出「稍后观看」（不在列表里也是成功）。
func removeVideoWatchLater(c *gin.Context) {
	videoID, ok := parseVideoIDParam(c)
	if !ok {
		return
	}
	if err := dbpkg.RemoveWatchLater(c.Request.Context(), videoID); err != nil {
		logging.Error("remove watch later error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "移出稍后观看失败", "Failed to remove from watch later")
		return
	}
	c.JSON(http.StatusOK, gin.H{"in_list": false})
}
