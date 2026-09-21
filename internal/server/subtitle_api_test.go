package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/service"

	"github.com/gin-gonic/gin"
)

const testSubtitleSRT = "1\r\n00:00:01,000 --> 00:00:04,500\r\n第一句\r\n\r\n2\r\n00:01:02,250 --> 00:01:05,000\r\nsecond\r\n"

type subtitleFixture struct {
	router    *gin.Engine
	videoID   int64
	javCode   string
	filename  string
	mediaFile string
	dataDir   string
	provider  *httptest.Server
	videoSecs int64
}

// newSubtitleFixture wires a database, one JAV-linked video and a fake
// subtitle provider that mimics the Xunlei oracle endpoint.
func newSubtitleFixture(t *testing.T) subtitleFixture {
	t.Helper()

	dataDir := t.TempDir()
	database, err := dbpkg.Open(filepath.Join(dataDir, "javboss.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	previousConfig := common.AppConfig
	common.DB = database
	common.AppConfig = &common.Config{DatabasePath: filepath.Join(dataDir, "javboss.db")}
	t.Cleanup(func() {
		common.DB = previousDB
		common.AppConfig = previousConfig
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/sub/") {
			w.Header().Set("Content-Type", "application/x-subrip")
			_, _ = w.Write([]byte(testSubtitleSRT))
			return
		}
		base := "http://" + r.Host + "/sub/"
		payload := map[string]any{
			"code":   0,
			"result": "ok",
			"data": []map[string]any{
				// 时长完全一致但没有文件名匹配
				{"cid": "CLOSE", "url": base + "close.srt", "ext": "srt", "name": "unrelated-release.srt", "duration": 7467301, "languages": []string{"简体"}},
				// 文件名匹配但时长差 67 秒
				{"cid": "NAME", "url": base + "name.srt", "ext": "srt", "name": "ABP-001.srt", "duration": 7400000, "languages": []string{"繁體"}},
				// 文件名匹配且时长最接近
				{"cid": "BEST", "url": base + "best.srt", "ext": "srt", "name": "ABP-001.srt", "duration": 7467301, "languages": []string{"简体"}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(payload)
	}))
	t.Cleanup(provider.Close)

	const filename = "ABP-001.mp4"
	mediaDir := t.TempDir()
	mediaFile := filepath.Join(mediaDir, filename)
	if err := os.WriteFile(mediaFile, []byte("video"), 0o600); err != nil {
		t.Fatalf("write media file: %v", err)
	}

	dir := models.Directory{Path: mediaDir}
	jav := models.Jav{Code: "ABP-001", Title: "test"}
	video := models.Video{Fingerprint: "subtitle-endpoint-video", DurationSec: 7467}
	for name, value := range map[string]any{"directory": &dir, "jav": &jav, "video": &video} {
		if err := database.Create(value).Error; err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}
	loc, err := dbpkg.UpsertVideoLocation(
		context.Background(),
		video.ID,
		dir.ID,
		filename,
		time.Unix(1710000000, 0).UTC(),
	)
	if err != nil {
		t.Fatalf("create video location: %v", err)
	}
	if err := database.Model(&models.VideoLocation{}).
		Where("id = ?", loc.ID).
		Update("jav_id", jav.ID).Error; err != nil {
		t.Fatalf("link jav: %v", err)
	}
	if err := dbpkg.UpsertConfig(context.Background(), map[string]string{
		service.SubtitleSettingsKey: provider.URL + "/oracle/subtitle?name={keyword}",
	}); err != nil {
		t.Fatalf("store subtitle api url: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/videos/:id/subtitles", listVideoSubtitles)
	router.POST("/videos/:id/subtitles/search", searchVideoSubtitles)
	router.POST("/videos/:id/subtitles/download", downloadVideoSubtitle)
	router.POST("/videos/:id/subtitles/mpv", controlVideoSubtitleInMPV)
	router.GET("/videos/:id/subtitles/:subtitle_id/file", getVideoSubtitleFile)
	router.GET("/videos/:id/subtitles/:subtitle_id/raw", getVideoSubtitleRaw)
	router.DELETE("/videos/:id/subtitles/:subtitle_id", deleteVideoSubtitle)
	router.POST("/subtitles/search", searchSubtitlesOnce)
	router.POST("/subtitles/batch-download", startSubtitleBatchDownload)
	router.GET("/subtitles/batch-download", getSubtitleBatchDownload)
	router.POST("/subtitles/batch-download/cancel", cancelSubtitleBatchDownload)

	return subtitleFixture{
		router:    router,
		videoID:   video.ID,
		javCode:   jav.Code,
		filename:  filename,
		mediaFile: mediaFile,
		dataDir:   dataDir,
		provider:  provider,
		videoSecs: video.DurationSec,
	}
}

func (f subtitleFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, req)
	return recorder
}

type subtitleSearchResponse struct {
	Keyword string `json:"keyword"`
	Items   []struct {
		Name            string `json:"name"`
		SourceID        string `json:"source_id"`
		Language        string `json:"language"`
		DurationMS      int64  `json:"duration_ms"`
		MatchTier       int    `json:"match_tier"`
		NameMatched     bool   `json:"name_matched"`
		DurationDeltaMS int64  `json:"duration_delta_ms"`
		Downloaded      bool   `json:"downloaded"`
		Recommended     bool   `json:"recommended"`
	} `json:"items"`
	VideoDurationMS int64 `json:"video_duration_ms"`
}

func TestSearchVideoSubtitlesUsesJavCodeAndRanksByName(t *testing.T) {
	f := newSubtitleFixture(t)

	recorder := f.do(t, http.MethodPost, "/videos/"+strconv.FormatInt(f.videoID, 10)+"/subtitles/search", `{}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload subtitleSearchResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Keyword != f.javCode {
		t.Fatalf("keyword = %q, want the JAV code %q", payload.Keyword, f.javCode)
	}
	if payload.VideoDurationMS != f.videoSecs*1000 {
		t.Fatalf("video_duration_ms = %d", payload.VideoDurationMS)
	}
	if len(payload.Items) != 3 {
		t.Fatalf("items = %d, want 3", len(payload.Items))
	}
	// 文件名匹配优先于「时长更接近」，所以推荐的一定是 ABP-001.srt 里最接近的那条。
	if !payload.Items[0].Recommended {
		t.Fatal("first item should be recommended")
	}
	if payload.Items[0].SourceID != "BEST" {
		t.Fatalf("recommended = %+v, want the name match with the closest duration", payload.Items[0])
	}
	if !payload.Items[0].NameMatched || payload.Items[0].DurationDeltaMS != 301 {
		t.Fatalf("recommended item metadata = %+v", payload.Items[0])
	}
	if payload.Items[0].Language != "简体" {
		t.Fatalf("language = %q", payload.Items[0].Language)
	}
	if payload.Items[0].DurationMS != 7467301 {
		t.Fatalf("duration_ms = %d", payload.Items[0].DurationMS)
	}
}

// 默认关键词必须是 JAV 番号：没有番号时不能退化成拿本地文件名去搜。
func TestSearchVideoSubtitlesRequiresKeywordWithoutJavCode(t *testing.T) {
	f := newSubtitleFixture(t)
	if err := common.DB.Model(&models.VideoLocation{}).
		Where("video_id = ?", f.videoID).
		Update("jav_id", nil).Error; err != nil {
		t.Fatalf("unlink jav: %v", err)
	}
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)

	recorder := f.do(t, http.MethodPost, videoPath+"/subtitles/search", `{}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "error_zh") {
		t.Fatalf("response is not a localized error: %s", recorder.Body.String())
	}

	// 手动输入关键词仍然可用。
	manual := f.do(t, http.MethodPost, videoPath+"/subtitles/search", `{"keyword":"ABP-001"}`)
	if manual.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", manual.Code, manual.Body.String())
	}
	var payload subtitleSearchResponse
	if err := json.Unmarshal(manual.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Keyword != "ABP-001" {
		t.Fatalf("keyword = %q", payload.Keyword)
	}
}

func TestSearchVideoSubtitlesAcceptsCustomKeyword(t *testing.T) {
	f := newSubtitleFixture(t)
	recorder := f.do(t, http.MethodPost, "/videos/"+strconv.FormatInt(f.videoID, 10)+"/subtitles/search", `{"keyword":"SSIS-001"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload subtitleSearchResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Keyword != "SSIS-001" {
		t.Fatalf("keyword = %q", payload.Keyword)
	}
}

func TestDownloadSubtitleStoresFileAndServesWebVTT(t *testing.T) {
	f := newSubtitleFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)

	body := fmt.Sprintf(`{"url":%q,"name":"ABP-001.srt","ext":"srt","language":"简体","duration_ms":7467301,"source_id":"BEST"}`,
		f.provider.URL+"/sub/best.srt")
	recorder := f.do(t, http.MethodPost, videoPath+"/subtitles/download", body)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var created struct {
		AlreadyDownloaded bool `json:"already_downloaded"`
		Subtitle          struct {
			ID       int64  `json:"id"`
			Filename string `json:"filename"`
			Format   string `json:"format"`
			Size     int64  `json:"size"`
			Playable bool   `json:"playable"`
			URL      string `json:"url"`
		} `json:"subtitle"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.AlreadyDownloaded {
		t.Fatal("first download must not be reported as already downloaded")
	}
	if created.Subtitle.Filename != "ABP-001.srt" || created.Subtitle.Format != "srt" || !created.Subtitle.Playable {
		t.Fatalf("created subtitle = %+v", created.Subtitle)
	}
	if created.Subtitle.Size != int64(len(testSubtitleSRT)) {
		t.Fatalf("size = %d, want %d", created.Subtitle.Size, len(testSubtitleSRT))
	}

	// 文件必须落在 JavBoss 自己的 data/subtitle/<video_id>/ 下。
	onDisk := filepath.Join(f.dataDir, "subtitle", strconv.FormatInt(f.videoID, 10), "ABP-001.srt")
	if _, err := os.Stat(onDisk); err != nil {
		t.Fatalf("subtitle file was not stored: %v", err)
	}
	// 数据库里要有关联记录
	var count int64
	if err := common.DB.Model(&models.VideoSubtitle{}).Where("video_id = ?", f.videoID).Count(&count).Error; err != nil {
		t.Fatalf("count subtitles: %v", err)
	}
	if count != 1 {
		t.Fatalf("subtitle rows = %d, want 1", count)
	}

	// 列表接口能带出播放地址
	listRecorder := f.do(t, http.MethodGet, videoPath+"/subtitles", "")
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list status = %d body = %s", listRecorder.Code, listRecorder.Body.String())
	}
	var listed struct {
		JavCode   string `json:"jav_code"`
		Subtitles []struct {
			ID         int64  `json:"id"`
			URL        string `json:"url"`
			DurationMS int64  `json:"duration_ms"`
			Language   string `json:"language"`
		} `json:"subtitles"`
	}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	// 前端用服务端返回的 jav_code 预填搜索框，它必须来自 jav 表的 code。
	if listed.JavCode != f.javCode {
		t.Fatalf("jav_code = %q, want %q", listed.JavCode, f.javCode)
	}
	if len(listed.Subtitles) != 1 || listed.Subtitles[0].ID != created.Subtitle.ID {
		t.Fatalf("listed subtitles = %+v", listed.Subtitles)
	}
	if listed.Subtitles[0].DurationMS != 7467301 {
		t.Fatalf("listed duration = %d", listed.Subtitles[0].DurationMS)
	}

	// 网页播放器拿到的是转好的 WebVTT
	filePath := videoPath + "/subtitles/" + strconv.FormatInt(created.Subtitle.ID, 10) + "/file"
	fileRecorder := f.do(t, http.MethodGet, filePath, "")
	if fileRecorder.Code != http.StatusOK {
		t.Fatalf("file status = %d body = %s", fileRecorder.Code, fileRecorder.Body.String())
	}
	if contentType := fileRecorder.Header().Get("Content-Type"); !strings.Contains(contentType, "text/vtt") {
		t.Fatalf("Content-Type = %q, want text/vtt", contentType)
	}
	vtt := fileRecorder.Body.String()
	if !strings.HasPrefix(vtt, "WEBVTT") || !strings.Contains(vtt, "00:00:01.000 --> 00:00:04.500") {
		t.Fatalf("served subtitle is not valid WebVTT: %q", vtt)
	}

	// 原始文件仍然可以取回
	rawRecorder := f.do(t, http.MethodGet, videoPath+"/subtitles/"+strconv.FormatInt(created.Subtitle.ID, 10)+"/raw", "")
	if rawRecorder.Code != http.StatusOK {
		t.Fatalf("raw status = %d", rawRecorder.Code)
	}
	if rawRecorder.Body.String() != testSubtitleSRT {
		t.Fatalf("raw body was modified: %q", rawRecorder.Body.String())
	}
}

func TestDeleteSubtitleRemovesFileAndRowButKeepsVideo(t *testing.T) {
	f := newSubtitleFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)

	download := f.do(t, http.MethodPost, videoPath+"/subtitles/download",
		fmt.Sprintf(`{"url":%q,"name":"ABP-001.srt","ext":"srt","source_id":"BEST"}`, f.provider.URL+"/sub/best.srt"))
	if download.Code != http.StatusCreated {
		t.Fatalf("download status = %d body = %s", download.Code, download.Body.String())
	}
	var created struct {
		Subtitle struct {
			ID int64 `json:"id"`
		} `json:"subtitle"`
	}
	if err := json.Unmarshal(download.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode download response: %v", err)
	}

	onDisk := filepath.Join(f.dataDir, "subtitle", strconv.FormatInt(f.videoID, 10), "ABP-001.srt")
	deletePath := videoPath + "/subtitles/" + strconv.FormatInt(created.Subtitle.ID, 10)
	recorder := f.do(t, http.MethodDelete, deletePath, "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("delete status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(onDisk); !os.IsNotExist(err) {
		t.Fatalf("subtitle file still exists: %v", err)
	}
	var count int64
	if err := common.DB.Model(&models.VideoSubtitle{}).Where("video_id = ?", f.videoID).Count(&count).Error; err != nil {
		t.Fatalf("count subtitles: %v", err)
	}
	if count != 0 {
		t.Fatalf("subtitle rows = %d, want 0", count)
	}
	// 再次删除返回 404
	if again := f.do(t, http.MethodDelete, deletePath, ""); again.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", again.Code)
	}
	// 视频本身与用户文件必须原封不动
	var video models.Video
	if err := common.DB.First(&video, f.videoID).Error; err != nil {
		t.Fatalf("video row disappeared: %v", err)
	}
	content, err := os.ReadFile(f.mediaFile)
	if err != nil {
		t.Fatalf("user media file disappeared: %v", err)
	}
	if string(content) != "video" {
		t.Fatalf("user media file was modified: %q", string(content))
	}
}

func TestDownloadSubtitleIsIdempotentForSameSource(t *testing.T) {
	f := newSubtitleFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)
	body := fmt.Sprintf(`{"url":%q,"name":"ABP-001.srt","ext":"srt","source_id":"BEST"}`, f.provider.URL+"/sub/best.srt")

	first := f.do(t, http.MethodPost, videoPath+"/subtitles/download", body)
	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d body = %s", first.Code, first.Body.String())
	}
	second := f.do(t, http.MethodPost, videoPath+"/subtitles/download", body)
	if second.Code != http.StatusCreated {
		t.Fatalf("second status = %d body = %s", second.Code, second.Body.String())
	}
	var payload struct {
		AlreadyDownloaded bool `json:"already_downloaded"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.AlreadyDownloaded {
		t.Fatal("second download of the same provider entry should be reported as already downloaded")
	}
	entries, err := os.ReadDir(filepath.Join(f.dataDir, "subtitle", strconv.FormatInt(f.videoID, 10)))
	if err != nil {
		t.Fatalf("read subtitle dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("stored files = %d, want 1", len(entries))
	}
}

func TestDownloadSubtitleRejectsInvalidRequest(t *testing.T) {
	f := newSubtitleFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)
	for name, body := range map[string]string{
		"缺少地址":   `{"name":"a.srt"}`,
		"非法JSON": `{"url":`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := f.do(t, http.MethodPost, videoPath+"/subtitles/download", body)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestBatchSubtitleDownloadPicksFileNameMatch(t *testing.T) {
	f := newSubtitleFixture(t)
	waitForSubtitleBatchIdle(t)

	recorder := f.do(t, http.MethodPost, "/subtitles/batch-download", `{}`)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	status := waitForSubtitleBatchDone(t)
	if status.Succeeded != 1 || status.Failed != 0 {
		t.Fatalf("status = %+v, want one success", status)
	}

	var stored []models.VideoSubtitle
	if err := common.DB.Where("video_id = ?", f.videoID).Find(&stored).Error; err != nil {
		t.Fatalf("load subtitles: %v", err)
	}
	if len(stored) != 1 {
		t.Fatalf("stored subtitles = %d, want 1", len(stored))
	}
	if stored[0].SourceID != "BEST" {
		t.Fatalf("picked source = %q, want the file name match with the closest duration", stored[0].SourceID)
	}
	if !stored[0].Auto {
		t.Fatal("batch downloads must be marked as automatic")
	}
	if stored[0].DurationMS != 7467301 {
		t.Fatalf("stored duration = %d", stored[0].DurationMS)
	}
}

func TestBatchSubtitleDownloadSkipsVideosThatAlreadyHaveSubtitles(t *testing.T) {
	f := newSubtitleFixture(t)
	waitForSubtitleBatchIdle(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)
	if recorder := f.do(t, http.MethodPost, videoPath+"/subtitles/download",
		fmt.Sprintf(`{"url":%q,"name":"ABP-001.srt","ext":"srt","source_id":"BEST"}`, f.provider.URL+"/sub/best.srt")); recorder.Code != http.StatusCreated {
		t.Fatalf("seed download status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	if recorder := f.do(t, http.MethodPost, "/subtitles/batch-download", `{}`); recorder.Code != http.StatusAccepted {
		t.Fatalf("batch status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	status := waitForSubtitleBatchDone(t)
	if status.Skipped != 1 || status.Succeeded != 0 {
		t.Fatalf("status = %+v, want the video to be skipped", status)
	}
}

type subtitleBatchStatusPayload struct {
	Running   bool     `json:"running"`
	Total     int      `json:"total"`
	Processed int      `json:"processed"`
	Succeeded int      `json:"succeeded"`
	Skipped   int      `json:"skipped"`
	Failed    int      `json:"failed"`
	Errors    []string `json:"errors"`
}

func waitForSubtitleBatchIdle(t *testing.T) {
	t.Helper()
	service.CancelSubtitleBatchDownload()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !service.SubtitleBatchDownloadStatus().Running {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("subtitle batch download did not stop")
}

func waitForSubtitleBatchDone(t *testing.T) subtitleBatchStatusPayload {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		status := service.SubtitleBatchDownloadStatus()
		if !status.Running {
			return subtitleBatchStatusPayload{
				Running: status.Running, Total: status.Total, Processed: status.Processed,
				Succeeded: status.Succeeded, Skipped: status.Skipped, Failed: status.Failed, Errors: status.Errors,
			}
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal("subtitle batch download did not finish in time")
	return subtitleBatchStatusPayload{}
}

func TestSubtitleMPVControlWithoutPlayer(t *testing.T) {
	f := newSubtitleFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(f.videoID, 10)

	// 没有下载过字幕也不该崩：先存一条再调用。
	download := f.do(t, http.MethodPost, videoPath+"/subtitles/download",
		fmt.Sprintf(`{"url":%q,"name":"ABP-001.srt","ext":"srt","source_id":"BEST"}`, f.provider.URL+"/sub/best.srt"))
	if download.Code != http.StatusCreated {
		t.Fatalf("download status = %d body = %s", download.Code, download.Body.String())
	}
	var created struct {
		Subtitle struct {
			ID int64 `json:"id"`
		} `json:"subtitle"`
		MPVAttached bool `json:"mpv_attached"`
	}
	if err := json.Unmarshal(download.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode download response: %v", err)
	}
	if created.MPVAttached {
		t.Fatal("mpv_attached must stay false when no mpv window is running")
	}

	for name, body := range map[string]string{
		"加载字幕": `{"subtitle_id":1}`,
		"关闭字幕": `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := f.do(t, http.MethodPost, videoPath+"/subtitles/mpv", body)
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409 (body=%s)", recorder.Code, recorder.Body.String())
			}
			payload := map[string]string{}
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload["error_zh"] == "" || payload["error_en"] == "" {
				t.Fatalf("error response must be localized: %v", payload)
			}
		})
	}
}

func TestSubtitleSearchOnceValidatesKeyword(t *testing.T) {
	f := newSubtitleFixture(t)
	recorder := f.do(t, http.MethodPost, "/subtitles/search", `{"keyword":""}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	ok := f.do(t, http.MethodPost, "/subtitles/search", `{"keyword":"ABP-001"}`)
	if ok.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", ok.Code, ok.Body.String())
	}
	var payload struct {
		Total int `json:"total"`
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
	}
	if err := json.Unmarshal(ok.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Total != 3 || len(payload.Items) != 3 {
		t.Fatalf("payload = %+v", payload)
	}
}
