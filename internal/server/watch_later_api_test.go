package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

type watchLaterAPIFixture struct {
	router *gin.Engine
	video  models.Video
}

func newWatchLaterAPIFixture(t *testing.T) watchLaterAPIFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "watch-later.db"))
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

	dir := models.Directory{Path: "/media/watch-later-api"}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	video := models.Video{Fingerprint: "watch-later-api-a", DurationSec: 600}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	if _, err := dbpkg.UpsertVideoLocation(
		context.Background(),
		video.ID,
		dir.ID,
		"a.mp4",
		time.Unix(1710000000, 0).UTC(),
	); err != nil {
		t.Fatalf("create video location: %v", err)
	}

	router := gin.New()
	RegisterRoutes(router)
	return watchLaterAPIFixture{router: router, video: video}
}

func (f watchLaterAPIFixture) do(t *testing.T, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, nil)
	f.router.ServeHTTP(recorder, request)
	return recorder
}

func TestWatchLaterAPIAddListRemove(t *testing.T) {
	fixture := newWatchLaterAPIFixture(t)
	videoPath := "/videos/" + strconv.FormatInt(fixture.video.ID, 10) + "/watch-later"

	// 初始状态：不在列表里。
	recorder := fixture.do(t, http.MethodGet, videoPath)
	if recorder.Code != http.StatusOK {
		t.Fatalf("get empty watch later status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var status struct {
		InList bool `json:"in_list"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode empty watch later status: %v", err)
	}
	if status.InList {
		t.Fatal("expected video to be absent from watch later initially")
	}

	// 加入。
	recorder = fixture.do(t, http.MethodPut, videoPath)
	if recorder.Code != http.StatusOK {
		t.Fatalf("add watch later status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	// 重复加入幂等。
	if recorder = fixture.do(t, http.MethodPut, videoPath); recorder.Code != http.StatusOK {
		t.Fatalf("re-add watch later status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = fixture.do(t, http.MethodGet, videoPath)
	if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode watch later status: %v", err)
	}
	if !status.InList {
		t.Fatal("expected video to be present in watch later after add")
	}

	// 列表只有一项，且载荷带上视频。
	recorder = fixture.do(t, http.MethodGet, "/watch-later?limit=10")
	if recorder.Code != http.StatusOK {
		t.Fatalf("list watch later status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var list struct {
		Items []models.WatchLaterItem `json:"items"`
		Total int64                   `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode watch later list: %v", err)
	}
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("expected one watch later item, got total=%d len=%d", list.Total, len(list.Items))
	}
	if list.Items[0].VideoID != fixture.video.ID || list.Items[0].Video.ID != fixture.video.ID {
		t.Fatalf("unexpected watch later item: %#v", list.Items[0])
	}

	// 移出。
	recorder = fixture.do(t, http.MethodDelete, videoPath)
	if recorder.Code != http.StatusOK {
		t.Fatalf("remove watch later status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = fixture.do(t, http.MethodGet, "/watch-later?limit=10")
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode watch later list after remove: %v", err)
	}
	if list.Total != 0 || len(list.Items) != 0 {
		t.Fatalf("expected empty watch later list, got total=%d len=%d", list.Total, len(list.Items))
	}
}

func TestWatchLaterAPIUnknownVideo(t *testing.T) {
	fixture := newWatchLaterAPIFixture(t)

	recorder := fixture.do(t, http.MethodGet, "/videos/99999/watch-later")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("get unknown video watch later status = %d", recorder.Code)
	}
	recorder = fixture.do(t, http.MethodPut, "/videos/99999/watch-later")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("add unknown video watch later status = %d", recorder.Code)
	}
	recorder = fixture.do(t, http.MethodPut, "/videos/abc/watch-later")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("add invalid video watch later status = %d", recorder.Code)
	}
}
