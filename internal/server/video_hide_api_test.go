package server

import (
	"context"
	"encoding/json"
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

	"github.com/gin-gonic/gin"
)

// hideFixture 造出「真实文件 + 目录 + Video + VideoLocation」的最小场景。
// 文件是真的写在磁盘上的 —— 这个测试的重点就是证明接口不会删它。
type hideFixture struct {
	router     *gin.Engine
	mediaDir   string
	filePath   string
	fileBody   string
	videoID    int64
	locationID int64
}

func newHideFixture(t *testing.T) hideFixture {
	t.Helper()

	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "hide.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	mediaDir := t.TempDir()
	const fileBody = "this is the user's irreplaceable video file"
	filePath := filepath.Join(mediaDir, "movie.mp4")
	if err := os.WriteFile(filePath, []byte(fileBody), 0o600); err != nil {
		t.Fatalf("write media file: %v", err)
	}

	dir := models.Directory{Path: mediaDir}
	video := models.Video{Fingerprint: "hide-endpoint-video"}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc, err := dbpkg.UpsertVideoLocation(
		context.Background(),
		video.ID,
		dir.ID,
		"movie.mp4",
		time.Unix(1710000000, 0).UTC(),
	)
	if err != nil {
		t.Fatalf("create video location: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/videos/locations/hide", hideVideoLocations)

	return hideFixture{
		router:     router,
		mediaDir:   mediaDir,
		filePath:   filePath,
		fileBody:   fileBody,
		videoID:    video.ID,
		locationID: loc.ID,
	}
}

func (f hideFixture) hide(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/videos/locations/hide", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, req)
	return recorder
}

// assertFileUntouched 是这个接口存在的全部理由：文件必须原封不动。
func (f hideFixture) assertFileUntouched(t *testing.T) {
	t.Helper()
	info, err := os.Stat(f.filePath)
	if err != nil {
		t.Fatalf("视频文件在「从媒体库移除」之后消失了: %v", err)
	}
	if info.IsDir() {
		t.Fatalf("视频文件变成了目录: %s", f.filePath)
	}
	content, err := os.ReadFile(f.filePath)
	if err != nil {
		t.Fatalf("读取视频文件失败: %v", err)
	}
	if string(content) != f.fileBody {
		t.Fatalf("视频文件内容被改动了: %q", string(content))
	}
	entries, err := os.ReadDir(f.mediaDir)
	if err != nil {
		t.Fatalf("读取媒体目录失败: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "movie.mp4" {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("媒体目录被改动了，实际内容: %v", names)
	}
}

func TestHideVideoLocationsRemovesFromLibraryButKeepsTheFile(t *testing.T) {
	f := newHideFixture(t)

	recorder := f.hide(t, `{"location_ids":[`+strconv.FormatInt(f.locationID, 10)+`]}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		Status string `json:"status"`
		Hidden int64  `json:"hidden"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Status != "ok" || payload.Hidden != 1 {
		t.Fatalf("payload = %+v, want {ok 1}", payload)
	}

	// 1) 文件必须还在，且内容不变
	f.assertFileUntouched(t)

	// 2) location 被标记为已删除
	var loc models.VideoLocation
	if err := common.DB.First(&loc, f.locationID).Error; err != nil {
		t.Fatalf("load video location: %v", err)
	}
	if !loc.IsDelete {
		t.Fatalf("VideoLocation.IsDelete 仍然是 false")
	}

	// 3) Video 行与其标签都保留 —— 重新扫描到同一个文件时要能把标签找回来
	var video models.Video
	if err := common.DB.First(&video, f.videoID).Error; err != nil {
		t.Fatalf("Video 行被删掉了: %v", err)
	}

	// 4) 列表里已经看不到它了
	list := gin.New()
	list.GET("/videos", listVideos)
	listRecorder := httptest.NewRecorder()
	list.ServeHTTP(listRecorder, httptest.NewRequest(http.MethodGet, "/videos", nil))
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list videos status = %d", listRecorder.Code)
	}
	var listed struct {
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if listed.Total != 0 {
		t.Fatalf("移除后列表里还有 %d 条", listed.Total)
	}
}

func TestHideVideoLocationsSupportsBatchAndIgnoresUnknownIDs(t *testing.T) {
	f := newHideFixture(t)

	// 重复 id 只算一次；不存在的 id 不会被算进 hidden —— 否则接口就是在虚报工作量。
	body := `{"location_ids":[` + strconv.FormatInt(f.locationID, 10) + `,` + strconv.FormatInt(f.locationID, 10) + `,999999]}`
	recorder := f.hide(t, body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Hidden int64 `json:"hidden"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Hidden != 1 {
		t.Fatalf("hidden = %d, want 1（重复去重、未知 id 不计）", payload.Hidden)
	}
	f.assertFileUntouched(t)
}

func TestHideVideoLocationsRejectsInvalidPayload(t *testing.T) {
	f := newHideFixture(t)

	for name, body := range map[string]string{
		"空数组":     `{"location_ids":[]}`,
		"缺少字段":    `{}`,
		"零值 id":   `{"location_ids":[0]}`,
		"负数 id":   `{"location_ids":[-3]}`,
		"非法 JSON": `{"location_ids":`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := f.hide(t, body)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, http.StatusBadRequest, recorder.Body.String())
			}
			if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
				t.Fatalf("Content-Type = %q, want JSON", contentType)
			}
			f.assertFileUntouched(t)
		})
	}
}
