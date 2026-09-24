package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

type playbackAPIFixture struct {
	router *gin.Engine
	video  models.Video
	// 第二个视频用来说明「同一 JAV 的多个文件各记一条」。
	other models.Video
}

func newPlaybackAPIFixture(t *testing.T) playbackAPIFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "test.db"))
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

	dir := models.Directory{Path: "/media/playback-api"}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	videos := []models.Video{
		{Fingerprint: "playback-api-a", DurationSec: 600},
		{Fingerprint: "playback-api-b", DurationSec: 1200},
	}
	if err := database.Create(&videos).Error; err != nil {
		t.Fatalf("create videos: %v", err)
	}
	for i, video := range videos {
		name := []string{"a.mp4", "b.mp4"}[i]
		if _, err := dbpkg.UpsertVideoLocation(
			context.Background(),
			video.ID,
			dir.ID,
			name,
			time.Unix(1710000000, 0).UTC(),
		); err != nil {
			t.Fatalf("create video location: %v", err)
		}
	}

	router := gin.New()
	RegisterRoutes(router)
	return playbackAPIFixture{router: router, video: videos[0], other: videos[1]}
}

func (f playbackAPIFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	f.router.ServeHTTP(recorder, request)
	return recorder
}

func TestPlaybackHistoryAPIUpsertListAndDelete(t *testing.T) {
	fixture := newPlaybackAPIFixture(t)
	videoID := fixture.video.ID

	// 未播放过的视频：200 且 playback 为 null。
	recorder := fixture.do(t, http.MethodGet, "/videos/"+strconv.FormatInt(videoID, 10)+"/playback", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("get empty playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var empty struct {
		Playback *models.PlaybackHistory `json:"playback"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &empty); err != nil {
		t.Fatalf("decode empty playback: %v", err)
	}
	if empty.Playback != nil {
		t.Fatalf("expected null playback, got %#v", empty.Playback)
	}

	videoPath := "/videos/" + strconv.FormatInt(videoID, 10) + "/playback"

	// 上报进度。
	body := `{"position_sec":123.5,"duration_sec":600,"location_id":7}`
	recorder = fixture.do(t, http.MethodPut, videoPath, body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("put playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	// 再次上报：同一个视频只保留一条记录，进度被覆盖。
	recorder = fixture.do(t, http.MethodPut, videoPath, `{"position_sec":200,"duration_sec":600}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("second put playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = fixture.do(t, http.MethodGet, videoPath, "")
	var payload struct {
		Playback *models.PlaybackHistory `json:"playback"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode playback: %v", err)
	}
	if payload.Playback == nil || payload.Playback.PositionSec != 200 {
		t.Fatalf("unexpected playback payload: %#v", payload.Playback)
	}

	// 另一个视频单独记录一条，说明同一作品下的多个文件互不影响。
	recorder = fixture.do(t, http.MethodPut, "/videos/"+strconv.FormatInt(fixture.other.ID, 10)+"/playback",
		`{"position_sec":30,"duration_sec":1200}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("put other playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = fixture.do(t, http.MethodGet, "/playback/history?limit=10", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("list playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var history struct {
		Items []models.PlaybackHistoryItem `json:"items"`
		Total int64                        `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &history); err != nil {
		t.Fatalf("decode playback history: %v", err)
	}
	if history.Total != 2 || len(history.Items) != 2 {
		t.Fatalf("unexpected history payload: %#v", history)
	}
	if history.Items[0].VideoID != fixture.other.ID {
		t.Fatalf("expected newest record first, got %#v", history.Items)
	}
	if len(history.Items[0].Video.Locations) == 0 {
		t.Fatalf("expected video payload with location, got %#v", history.Items[0].Video)
	}

	// 清除记录。
	recorder = fixture.do(t, http.MethodDelete, videoPath, "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("delete playback status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	record, err := dbpkg.GetPlaybackHistory(context.Background(), videoID)
	if err != nil {
		t.Fatalf("GetPlaybackHistory() error = %v", err)
	}
	if record != nil {
		t.Fatalf("expected playback cleared, got %#v", record)
	}
}

func TestPlaybackHistoryAPIClearAll(t *testing.T) {
	fixture := newPlaybackAPIFixture(t)
	ctx := context.Background()
	for _, video := range []models.Video{fixture.video, fixture.other} {
		if err := dbpkg.UpsertPlaybackHistory(ctx, models.PlaybackHistory{
			VideoID:     video.ID,
			PositionSec: 60,
			DurationSec: video.DurationSec,
		}); err != nil {
			t.Fatalf("seed playback history: %v", err)
		}
	}

	recorder := fixture.do(t, http.MethodDelete, "/playback/history", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("clear playback history status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Deleted int64 `json:"deleted"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode clear payload: %v", err)
	}
	if payload.Deleted != 2 {
		t.Fatalf("expected 2 deleted, got %d", payload.Deleted)
	}
	remaining, err := dbpkg.CountPlaybackHistory(ctx)
	if err != nil {
		t.Fatalf("CountPlaybackHistory() error = %v", err)
	}
	if remaining != 0 {
		t.Fatalf("expected 0 remaining records, got %d", remaining)
	}
}

func TestPlaybackHistoryAPIAcceptsFractionalDuration(t *testing.T) {
	fixture := newPlaybackAPIFixture(t)
	ctx := context.Background()
	videoPath := "/videos/" + strconv.FormatInt(fixture.video.ID, 10) + "/playback"

	// 浏览器播放器的 duration 是浮点秒数（如 600.75），API 必须容忍，
	// 否则前端每次上报都会 400，播放记录永远写不进去。
	recorder := fixture.do(t, http.MethodPut, videoPath, `{"position_sec":12.5,"duration_sec":600.75}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("fractional duration status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	record, err := dbpkg.GetPlaybackHistory(ctx, fixture.video.ID)
	if err != nil {
		t.Fatalf("GetPlaybackHistory() error = %v", err)
	}
	if record == nil {
		t.Fatal("expected playback record to be stored")
	}
	if record.PositionSec != 12.5 {
		t.Fatalf("expected position 12.5, got %v", record.PositionSec)
	}
	if record.DurationSec != 601 {
		t.Fatalf("expected rounded duration 601, got %d", record.DurationSec)
	}
}

func TestPlaybackHistoryAPIRejectsUnknownVideo(t *testing.T) {
	fixture := newPlaybackAPIFixture(t)

	recorder := fixture.do(t, http.MethodGet, "/videos/99999/playback", "")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("get unknown video playback status = %d", recorder.Code)
	}

	recorder = fixture.do(t, http.MethodPut, "/videos/99999/playback", `{"position_sec":1}`)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("put unknown video playback status = %d", recorder.Code)
	}

	recorder = fixture.do(t, http.MethodPut, "/videos/abc/playback", `{"position_sec":1}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("put invalid video id status = %d", recorder.Code)
	}
}
