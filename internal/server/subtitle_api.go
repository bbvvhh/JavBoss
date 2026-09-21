package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/mpv"
	"javboss/internal/service"
	"javboss/internal/subtitle"
)

const (
	maxSubtitleSearchItems = 100
	maxSubtitleBatchLimit  = 100000
)

type videoSubtitleInfo struct {
	ID         int64     `json:"id"`
	VideoID    int64     `json:"video_id"`
	Title      string    `json:"title"`
	Filename   string    `json:"filename"`
	Language   string    `json:"language"`
	Format     string    `json:"format"`
	DurationMS int64     `json:"duration_ms"`
	Size       int64     `json:"size"`
	Auto       bool      `json:"auto"`
	Playable   bool      `json:"playable"`
	CreatedAt  time.Time `json:"created_at"`
	URL        string    `json:"url"`
	RawURL     string    `json:"raw_url"`
}

type subtitleSearchItem struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	Ext             string `json:"ext"`
	Language        string `json:"language"`
	DurationMS      int64  `json:"duration_ms"`
	SourceID        string `json:"source_id"`
	ExtraName       string `json:"extra_name"`
	MatchTier       int    `json:"match_tier"`
	NameMatched     bool   `json:"name_matched"`
	DurationDeltaMS int64  `json:"duration_delta_ms"`
	Downloaded      bool   `json:"downloaded"`
	SubtitleID      int64  `json:"subtitle_id,omitempty"`
	Recommended     bool   `json:"recommended"`
}

// listVideoSubtitles returns every subtitle already stored for a video.
func listVideoSubtitles(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	items, err := dbpkg.ListVideoSubtitles(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("list video subtitles error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载字幕列表失败", "Failed to load subtitles")
		return
	}

	apiURL := service.ConfiguredSubtitleAPIURL(c.Request.Context())
	infos := make([]videoSubtitleInfo, 0, len(items))
	for _, item := range items {
		infos = append(infos, buildVideoSubtitleInfo(item))
	}
	// 番号一律以 jav 表的 code 为准（前端拿到的 video 对象不一定带 jav 关联），
	// 前端用它预填搜索框，这里返回服务端解析出来的那份。
	javCode, err := dbpkg.JavCodeForVideo(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("load jav code for subtitles error: %v", err)
		javCode = ""
	}
	c.JSON(http.StatusOK, gin.H{
		"video_id":  videoID,
		"jav_code":  javCode,
		"api_url":   apiURL,
		"subtitles": infos,
	})
}

// searchVideoSubtitles queries the configured provider for one video.
//
// The keyword defaults to the JAV code read from the jav table; the local file
// name is only used later to decide which result fits the video best.
func searchVideoSubtitles(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		Keyword string `json:"keyword"`
	}
	_ = c.ShouldBindJSON(&req)

	video, err := dbpkg.GetVideo(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("load video for subtitle search error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}

	code, err := dbpkg.JavCodeForVideo(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("load jav code for subtitle search error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载番号失败", "Failed to load the JAV code")
		return
	}
	keyword := strings.TrimSpace(req.Keyword)
	if keyword == "" {
		// 默认只用 JAV 番号搜索；本地文件名只是「选哪份字幕」的匹配依据，
		// 不是关键词（文件名常常带分辨率、演员、站点后缀，搜不出东西）。
		keyword = code
	}
	if keyword == "" {
		respondLocalizedError(c, http.StatusBadRequest, "该视频还没有关联番号，请手动输入关键词", "This video has no JAV code yet. Enter a keyword manually.")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	results, err := subtitle.Search(ctx, service.ConfiguredSubtitleAPIURL(c.Request.Context()), keyword)
	if err != nil {
		logging.Error("subtitle search failed (keyword=%s): %v", keyword, err)
		respondLocalizedError(c, http.StatusBadGateway, "字幕搜索失败，请检查接口地址或网络", "Subtitle search failed. Check the API URL or your network.")
		return
	}

	existing, err := dbpkg.ListVideoSubtitles(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("list subtitles before search error: %v", err)
	}
	bySource := make(map[string]int64, len(existing))
	for _, item := range existing {
		if strings.TrimSpace(item.SourceID) == "" {
			continue
		}
		bySource[item.SourceID] = item.ID
	}

	videoDurationMS := video.DurationSec * 1000
	ranked := subtitle.RankResults(results, video.Filename, videoDurationMS)
	if len(ranked) > maxSubtitleSearchItems {
		ranked = ranked[:maxSubtitleSearchItems]
	}

	items := make([]subtitleSearchItem, 0, len(ranked))
	for index, scored := range ranked {
		subtitleID, downloaded := bySource[scored.Result.SourceID]
		items = append(items, subtitleSearchItem{
			Name:            scored.Result.Name,
			URL:             scored.Result.URL,
			Ext:             scored.Result.Ext,
			Language:        scored.Result.Language(),
			DurationMS:      scored.Result.DurationMS,
			SourceID:        scored.Result.SourceID,
			ExtraName:       scored.Result.ExtraName,
			MatchTier:       scored.Tier,
			NameMatched:     scored.Tier < subtitle.TierNoName,
			DurationDeltaMS: scored.DurationDeltaMS,
			Downloaded:      downloaded,
			SubtitleID:      subtitleID,
			Recommended:     index == 0,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"video_id":          videoID,
		"keyword":           keyword,
		"video_filename":    video.Filename,
		"video_duration_ms": videoDurationMS,
		"items":             items,
	})
}

// searchSubtitlesOnce checks a configured endpoint without touching a video.
func searchSubtitlesOnce(c *gin.Context) {
	var req struct {
		Keyword string `json:"keyword"`
		APIURL  string `json:"api_url"`
	}
	_ = c.ShouldBindJSON(&req)

	keyword := strings.TrimSpace(req.Keyword)
	if keyword == "" {
		respondLocalizedError(c, http.StatusBadRequest, "请输入搜索关键词", "Enter a search keyword")
		return
	}
	apiURL := subtitle.NormalizeAPIURL(req.APIURL)
	if strings.TrimSpace(req.APIURL) == "" {
		apiURL = service.ConfiguredSubtitleAPIURL(c.Request.Context())
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	results, err := subtitle.Search(ctx, apiURL, keyword)
	if err != nil {
		logging.Error("subtitle endpoint test failed: %v", err)
		respondLocalizedError(c, http.StatusBadGateway, "字幕接口测试失败，请检查地址或网络", "The subtitle endpoint test failed. Check the URL or your network.")
		return
	}
	items := make([]subtitleSearchItem, 0, len(results))
	for index, result := range results {
		if index >= 20 {
			break
		}
		items = append(items, subtitleSearchItem{
			Name:        result.Name,
			URL:         result.URL,
			Ext:         result.Ext,
			Language:    result.Language(),
			DurationMS:  result.DurationMS,
			SourceID:    result.SourceID,
			ExtraName:   result.ExtraName,
			MatchTier:   subtitle.TierNoName,
			Recommended: index == 0,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"api_url": apiURL,
		"keyword": keyword,
		"total":   len(results),
		"items":   items,
	})
}

// downloadVideoSubtitle stores one chosen search result and links it to the video.
func downloadVideoSubtitle(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		URL        string `json:"url"`
		Name       string `json:"name"`
		Ext        string `json:"ext"`
		Language   string `json:"language"`
		DurationMS int64  `json:"duration_ms"`
		SourceID   string `json:"source_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "字幕下载请求无效", "Invalid subtitle download request")
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		respondLocalizedError(c, http.StatusBadRequest, "字幕下载地址不能为空", "The subtitle URL is required")
		return
	}

	video, err := dbpkg.GetVideo(c.Request.Context(), videoID)
	if err != nil {
		logging.Error("load video for subtitle download error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载视频信息失败", "Failed to load video information")
		return
	}
	if video == nil {
		respondLocalizedError(c, http.StatusNotFound, "视频不存在", "Video does not exist")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	item, already, err := service.DownloadAndStoreVideoSubtitle(ctx, videoID, service.SubtitleDownloadRequest{
		URL:        req.URL,
		Name:       req.Name,
		Ext:        req.Ext,
		Language:   req.Language,
		DurationMS: req.DurationMS,
		SourceID:   req.SourceID,
	})
	if err != nil {
		logging.Error("download video subtitle error: %v", err)
		switch {
		case errors.Is(err, subtitle.ErrSubtitleTooLarge):
			respondLocalizedError(c, http.StatusRequestEntityTooLarge, "字幕文件过大", "The subtitle file is too large")
		case errors.Is(err, subtitle.ErrUnsupportedFormat):
			respondLocalizedError(c, http.StatusUnsupportedMediaType, "暂不支持该字幕格式", "That subtitle format is not supported")
		default:
			respondLocalizedError(c, http.StatusBadGateway, "字幕下载失败", "Failed to download the subtitle")
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"already_downloaded": already,
		"subtitle":           buildVideoSubtitleInfo(*item),
		// 正在用 MPV 播放这个视频时，直接把新字幕挂上去。
		"mpv_attached": attachSubtitleToMPVIfPlaying(c, videoID, item.ID),
	})
}

// controlVideoSubtitleInMPV loads one downloaded subtitle into the running MPV
// window, or turns subtitles off when no subtitle id is given.
func controlVideoSubtitleInMPV(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		SubtitleID int64 `json:"subtitle_id"`
	}
	_ = c.ShouldBindJSON(&req)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if req.SubtitleID <= 0 {
		if err := service.DisablePlayerSubtitles(); err != nil {
			respondMPVSubtitleError(c, err, "关闭 MPV 字幕失败", "Failed to turn off MPV subtitles")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "disabled": true})
		return
	}

	if err := service.AttachSubtitleToPlayer(ctx, videoID, req.SubtitleID); err != nil {
		if errors.Is(err, mpv.ErrPlayerNotRunning) {
			respondLocalizedError(
				c,
				http.StatusConflict,
				"MPV 播放器当前没有可控制的窗口（未在播放，或关闭了「播放器窗口复用」）；字幕已保存在本地，下次播放会自动加载",
				"There is no controllable MPV window right now (nothing is playing, or window reuse is disabled); the subtitle is stored locally and loads automatically on the next playback",
			)
			return
		}
		respondMPVSubtitleError(c, err, "在 MPV 中加载字幕失败", "Failed to load the subtitle in MPV")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "attached": true})
}

func respondMPVSubtitleError(c *gin.Context, err error, zhMessage, enMessage string) {
	if errors.Is(err, mpv.ErrPlayerNotRunning) {
		respondLocalizedError(
			c,
			http.StatusConflict,
			"MPV 播放器当前没有可控制的窗口",
			"There is no controllable MPV window right now",
		)
		return
	}
	logging.Error("mpv subtitle control error: %v", err)
	respondLocalizedError(c, http.StatusInternalServerError, zhMessage, enMessage)
}

func attachSubtitleToMPVIfPlaying(c *gin.Context, videoID, subtitleID int64) bool {
	attached, err := service.AttachSubtitleToPlayerIfPlaying(c.Request.Context(), videoID, subtitleID)
	if err != nil {
		logging.Error("attach downloaded subtitle to mpv failed: %v", err)
		return false
	}
	return attached
}

// getVideoSubtitleFile serves a stored subtitle as WebVTT for the web player.
func getVideoSubtitleFile(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	item, ok := loadSubtitleForRequest(c, videoID)
	if !ok {
		return
	}
	path, err := service.SubtitleFilePath(videoID, item.Filename)
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "字幕路径无效", "The subtitle path is invalid")
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "字幕文件不存在", "The subtitle file does not exist")
			return
		}
		logging.Error("read video subtitle error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取字幕文件失败", "Failed to read the subtitle file")
		return
	}
	payload, err := subtitle.ToVTT(item.Format, data)
	if err != nil {
		logging.Error("convert video subtitle error: %v", err)
		respondLocalizedError(c, http.StatusUnsupportedMediaType, "该字幕格式无法在网页中播放", "That subtitle format cannot be played in the browser")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/vtt; charset=utf-8", payload)
}

// getVideoSubtitleRaw serves the untouched file, e.g. for external players.
func getVideoSubtitleRaw(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	item, ok := loadSubtitleForRequest(c, videoID)
	if !ok {
		return
	}
	path, err := service.SubtitleFilePath(videoID, item.Filename)
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "字幕路径无效", "The subtitle path is invalid")
		return
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "字幕文件不存在", "The subtitle file does not exist")
			return
		}
		logging.Error("stat video subtitle error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取字幕文件失败", "Failed to read the subtitle file")
		return
	}
	c.File(path)
}

// deleteVideoSubtitle removes a downloaded subtitle and its database row.
func deleteVideoSubtitle(c *gin.Context) {
	videoID, ok := parsePositiveParam(c, "id")
	if !ok {
		return
	}
	subtitleID, ok := parsePositiveParam(c, "subtitle_id")
	if !ok {
		return
	}
	deleted, err := service.DeleteStoredVideoSubtitle(c.Request.Context(), videoID, subtitleID)
	if err != nil {
		logging.Error("delete video subtitle error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "删除字幕失败", "Failed to delete the subtitle")
		return
	}
	if !deleted {
		respondLocalizedError(c, http.StatusNotFound, "字幕不存在", "The subtitle does not exist")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// startSubtitleBatchDownload launches the one-click download of every JAV video's subtitle.
func startSubtitleBatchDownload(c *gin.Context) {
	var req struct {
		Overwrite bool `json:"overwrite"`
		Limit     int  `json:"limit"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.Limit < 0 {
		respondLocalizedError(c, http.StatusBadRequest, "下载数量不能为负数", "The limit cannot be negative")
		return
	}
	if req.Limit > maxSubtitleBatchLimit {
		req.Limit = maxSubtitleBatchLimit
	}

	status, err := service.StartSubtitleBatchDownload(service.SubtitleBatchOptions{
		Overwrite: req.Overwrite,
		Limit:     req.Limit,
	})
	if err != nil {
		if errors.Is(err, service.ErrSubtitleBatchRunning) {
			c.JSON(http.StatusConflict, gin.H{
				"error_zh": "字幕批量下载正在进行中",
				"error_en": "A subtitle batch download is already running",
				"status":   status,
			})
			return
		}
		logging.Error("start subtitle batch download error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "启动字幕批量下载失败", "Failed to start the subtitle batch download")
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": status})
}

// getSubtitleBatchDownload reports the progress of the one-click downloader.
func getSubtitleBatchDownload(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": service.SubtitleBatchDownloadStatus()})
}

// cancelSubtitleBatchDownload stops a running batch download.
func cancelSubtitleBatchDownload(c *gin.Context) {
	canceled := service.CancelSubtitleBatchDownload()
	c.JSON(http.StatusOK, gin.H{
		"canceled": canceled,
		"status":   service.SubtitleBatchDownloadStatus(),
	})
}

func loadSubtitleForRequest(c *gin.Context, videoID int64) (*models.VideoSubtitle, bool) {
	subtitleID, ok := parsePositiveParam(c, "subtitle_id")
	if !ok {
		return nil, false
	}
	item, err := dbpkg.GetVideoSubtitle(c.Request.Context(), videoID, subtitleID)
	if err != nil {
		logging.Error("load video subtitle error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载字幕信息失败", "Failed to load the subtitle")
		return nil, false
	}
	if item == nil {
		respondLocalizedError(c, http.StatusNotFound, "字幕不存在", "The subtitle does not exist")
		return nil, false
	}
	return item, true
}

func parsePositiveParam(c *gin.Context, name string) (int64, bool) {
	value, err := strconv.ParseInt(strings.TrimSpace(c.Param(name)), 10, 64)
	if err != nil || value <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "参数无效", "Invalid request parameter")
		return 0, false
	}
	return value, true
}

func buildVideoSubtitleInfo(item models.VideoSubtitle) videoSubtitleInfo {
	videoPart := strconv.FormatInt(item.VideoID, 10)
	subtitlePart := strconv.FormatInt(item.ID, 10)
	base := "/videos/" + videoPart + "/subtitles/" + subtitlePart
	info := videoSubtitleInfo{
		ID:         item.ID,
		VideoID:    item.VideoID,
		Title:      item.Title,
		Filename:   item.Filename,
		Language:   item.Language,
		Format:     item.Format,
		DurationMS: item.DurationMS,
		Size:       item.Size,
		Auto:       item.Auto,
		Playable:   subtitle.SupportedExtension(item.Format),
		CreatedAt:  item.CreatedAt,
		URL:        base + "/file",
		RawURL:     base + "/raw",
	}
	if path, err := service.SubtitleFilePath(item.VideoID, item.Filename); err == nil {
		if stat, statErr := os.Stat(path); statErr == nil {
			version := strconv.FormatInt(stat.ModTime().UnixNano(), 10)
			info.URL += "?mtime=" + version
			info.RawURL += "?mtime=" + version
		}
	}
	return info
}
