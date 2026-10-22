package server

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

// listOtherDirectories returns the directories that belong to the other mode.
// They are rendered as the top-level folder tiles of the other-mode view.
func listOtherDirectories(c *gin.Context) {
	dirs, err := dbpkg.ListOtherDirectories(c.Request.Context())
	if err != nil {
		logging.Error("list other directories error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载其它模式目录失败", "Failed to load other-mode directories")
		return
	}
	if dirs == nil {
		dirs = []models.Directory{}
	}
	c.JSON(http.StatusOK, gin.H{"items": dirs})
}

// listOtherContents browses one other-mode directory at a path prefix, returning the
// child folders plus the direct video files. A missing/unknown directory, or one that
// is not in the other mode, is rejected so the layered view cannot leak video-mode rows.
func listOtherContents(c *gin.Context) {
	directoryID := queryInt(c, "directory_id", 0)
	if directoryID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "目录 ID 无效", "Invalid directory ID")
		return
	}

	ctx := c.Request.Context()
	dir, err := dbpkg.GetDirectory(ctx, int64(directoryID))
	if err != nil {
		logging.Error("load other directory error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
		return
	}
	if dir == nil || dir.IsDelete {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}
	if !dir.IsOtherMode() {
		respondLocalizedError(c, http.StatusBadRequest, "目录不属于其它模式", "Directory is not in the other mode")
		return
	}

	path := c.Query("path")
	limit := queryInt(c, "limit", 100)
	offset := queryInt(c, "offset", 0)
	tagFilter := parseTagQuery(c.Query("tags"))
	search := strings.TrimSpace(c.Query("search"))
	sort := strings.TrimSpace(c.Query("sort"))
	seed, ok := parseOtherSeed(c)
	if !ok {
		return
	}

	folders := []dbpkg.OtherFolder{}
	// 搜索/标签筛选只在当前层的视频里生效，此时文件夹列表没有意义，直接留空。
	if search == "" && len(tagFilter) == 0 {
		folders, err = dbpkg.ListOtherSubfolders(ctx, int64(directoryID), path)
		if err != nil {
			logging.Error("list other subfolders error: %v", err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载子文件夹失败", "Failed to load subfolders")
			return
		}
		if folders == nil {
			folders = []dbpkg.OtherFolder{}
		}
	}

	items, err := dbpkg.ListOtherModeVideos(ctx, int64(directoryID), path, limit, offset, tagFilter, search, sort, seed)
	if err != nil {
		logging.Error("list other mode videos error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频列表失败", "Failed to load videos")
		return
	}
	if items == nil {
		items = []models.Video{}
	}

	total, err := dbpkg.CountOtherModeVideos(ctx, int64(directoryID), path, tagFilter, search)
	if err != nil {
		logging.Error("count other mode videos error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "统计视频数量失败", "Failed to count videos")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"directory": dir,
		"folders":   folders,
		"items":     items,
		"total":     total,
	})
}

// searchOtherContents searches video filenames and folder names recursively inside
// other-mode directories. With no directory_id it searches every other-mode directory,
// which backs the top-level search box of the other-mode view.
func searchOtherContents(c *gin.Context) {
	search := strings.TrimSpace(c.Query("search"))
	if search == "" {
		respondLocalizedError(c, http.StatusBadRequest, "搜索关键词不能为空", "Search keyword is required")
		return
	}

	ctx := c.Request.Context()
	directoryID := queryInt(c, "directory_id", 0)
	var directory *models.Directory
	if directoryID > 0 {
		dir, err := dbpkg.GetDirectory(ctx, int64(directoryID))
		if err != nil {
			logging.Error("load other directory for search error: %v", err)
			respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
			return
		}
		if dir == nil || dir.IsDelete {
			respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
			return
		}
		if !dir.IsOtherMode() {
			respondLocalizedError(c, http.StatusBadRequest, "目录不属于其它模式", "Directory is not in the other mode")
			return
		}
		directory = dir
	}

	path := c.Query("path")
	limit := queryInt(c, "limit", 100)
	offset := queryInt(c, "offset", 0)
	sort := strings.TrimSpace(c.Query("sort"))
	seed, ok := parseOtherSeed(c)
	if !ok {
		return
	}

	items, err := dbpkg.SearchOtherModeVideos(ctx, int64(directoryID), path, limit, offset, search, sort, seed)
	if err != nil {
		logging.Error("search other mode videos error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "搜索视频失败", "Failed to search videos")
		return
	}
	if items == nil {
		items = []models.Video{}
	}

	total, err := dbpkg.CountSearchOtherModeVideos(ctx, int64(directoryID), path, search)
	if err != nil {
		logging.Error("count other mode search error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "统计搜索结果失败", "Failed to count search results")
		return
	}

	folders, err := dbpkg.SearchOtherModeFolders(ctx, int64(directoryID), path, search)
	if err != nil {
		logging.Error("search other mode folders error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "搜索文件夹失败", "Failed to search folders")
		return
	}
	if folders == nil {
		folders = []dbpkg.OtherSearchFolder{}
	}

	c.JSON(http.StatusOK, gin.H{"directory": directory, "folders": folders, "items": items, "total": total})
}

// parseOtherSeed reads the optional random seed shared by the other-mode endpoints.
// It responds with 400 and returns ok=false when the value is present but invalid.
func parseOtherSeed(c *gin.Context) (*int64, bool) {
	seedParam := strings.TrimSpace(c.Query("seed"))
	if seedParam == "" {
		return nil, true
	}
	parsed, err := strconv.ParseInt(seedParam, 10, 64)
	if err != nil || parsed <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "随机种子无效", "Invalid random seed")
		return nil, false
	}
	return &parsed, true
}

// listOtherTags returns the tag counts scoped to one other-mode directory.
func listOtherTags(c *gin.Context) {
	directoryID := queryInt(c, "directory_id", 0)
	if directoryID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "目录 ID 无效", "Invalid directory ID")
		return
	}

	ctx := c.Request.Context()
	dir, err := dbpkg.GetDirectory(ctx, int64(directoryID))
	if err != nil {
		logging.Error("load other directory for tags error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
		return
	}
	if dir == nil || dir.IsDelete || !dir.IsOtherMode() {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}

	tags, err := dbpkg.ListOtherModeTags(ctx, int64(directoryID))
	if err != nil {
		logging.Error("list other mode tags error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频标签失败", "Failed to load video tags")
		return
	}
	if tags == nil {
		tags = []dbpkg.TagCount{}
	}
	c.JSON(http.StatusOK, tags)
}
