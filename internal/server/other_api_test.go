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

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"

	"github.com/gin-gonic/gin"
)

// otherFixture 造出「一个其它模式目录（含分层路径）+ 一个视频模式目录」的场景，
// 并挂上其它模式需要的几个路由。
func otherFixture(t *testing.T) (router *gin.Engine, otherDir, videoDir models.Directory) {
	t.Helper()

	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "other.db"))
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

	otherDir = models.Directory{Path: "/media/other-api", Mode: models.DirectoryModeOther}
	videoDir = models.Directory{Path: "/media/video-api"}
	if err := database.Create(&otherDir).Error; err != nil {
		t.Fatalf("create other directory: %v", err)
	}
	if err := database.Create(&videoDir).Error; err != nil {
		t.Fatalf("create video directory: %v", err)
	}

	now := time.Unix(1710000000, 0).UTC()
	for _, fixture := range []struct {
		dir  int64
		path string
		fp   string
	}{
		{otherDir.ID, "A/B/f.mp4", "other-api-fp-1"},
		{otherDir.ID, "A/g.mp4", "other-api-fp-2"},
		{otherDir.ID, "h.mp4", "other-api-fp-3"},
		{videoDir.ID, "x.mp4", "video-api-fp-1"},
	} {
		video := models.Video{Fingerprint: fixture.fp}
		if err := database.Create(&video).Error; err != nil {
			t.Fatalf("create video %s: %v", fixture.fp, err)
		}
		if _, err := dbpkg.UpsertVideoLocation(context.Background(), video.ID, fixture.dir, fixture.path, now); err != nil {
			t.Fatalf("create location %s: %v", fixture.path, err)
		}
	}

	gin.SetMode(gin.TestMode)
	router = gin.New()
	router.PATCH("/directories/:id", updateDirectory)
	router.GET("/other/directories", listOtherDirectories)
	router.GET("/other/list", listOtherContents)
	router.GET("/other/search", searchOtherContents)
	return router, otherDir, videoDir
}

func doJSON(t *testing.T, router *gin.Engine, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestOtherModeDirectoryCreateAndUpdatePersistsMode(t *testing.T) {
	router, otherDir, videoDir := otherFixture(t)
	ctx := context.Background()

	// 创建路径：mode=other 必须落到库里，否则这个目录会被视频模式误收。
	created, err := dbpkg.CreateDirectoryFromSource(ctx, dbpkg.DirectorySource{Path: t.TempDir(), Mode: models.DirectoryModeOther})
	if err != nil {
		t.Fatalf("CreateDirectoryFromSource other: %v", err)
	}
	if created.Mode != models.DirectoryModeOther || !created.IsOtherMode() {
		t.Fatalf("created directory mode = %q, want other", created.Mode)
	}
	if _, err := dbpkg.CreateDirectoryFromSource(ctx, dbpkg.DirectorySource{Path: t.TempDir(), Mode: "bogus"}); err == nil {
		t.Fatal("CreateDirectoryFromSource accepted an invalid mode")
	}

	// 更新路径：把视频模式目录改成其它模式后要能读到，并且非法值必须 400。
	updated := doJSON(t, router, http.MethodPatch, "/directories/"+strconv.FormatInt(videoDir.ID, 10), `{"mode":"other"}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update mode status = %d body = %s", updated.Code, updated.Body.String())
	}
	var payload models.Directory
	if err := json.Unmarshal(updated.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if payload.Mode != models.DirectoryModeOther {
		t.Fatalf("updated mode = %q, want other", payload.Mode)
	}

	rejected := doJSON(t, router, http.MethodPatch, "/directories/"+strconv.FormatInt(otherDir.ID, 10), `{"mode":"bogus"}`)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("invalid mode status = %d, want 400 (body=%s)", rejected.Code, rejected.Body.String())
	}
}

func TestOtherDirectoriesEndpointListsOnlyOtherMode(t *testing.T) {
	router, otherDir, _ := otherFixture(t)

	recorder := doJSON(t, router, http.MethodGet, "/other/directories", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Items []models.Directory `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Items) != 1 || payload.Items[0].ID != otherDir.ID {
		t.Fatalf("other directories = %#v, want only %d", payload.Items, otherDir.ID)
	}
	if payload.Items[0].ScannedVideoCount != 3 {
		t.Fatalf("video count = %d, want 3", payload.Items[0].ScannedVideoCount)
	}
}

func TestOtherListEndpointReturnsFoldersAndImmediateVideos(t *testing.T) {
	router, otherDir, videoDir := otherFixture(t)
	id := strconv.FormatInt(otherDir.ID, 10)

	recorder := doJSON(t, router, http.MethodGet, "/other/list?directory_id="+id, "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Folders []dbpkg.OtherFolder `json:"folders"`
		Items   []models.Video      `json:"items"`
		Total   int64               `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Folders) != 1 || payload.Folders[0].Path != "A" || payload.Folders[0].VideoCount != 2 {
		t.Fatalf("folders = %#v, want only A", payload.Folders)
	}
	if len(payload.Items) != 1 || payload.Items[0].Filename != "h.mp4" {
		t.Fatalf("items = %#v, want only h.mp4", payload.Items)
	}
	if payload.Total != 1 {
		t.Fatalf("total = %d, want 1", payload.Total)
	}

	// 下钻一层：A 下应有 B，同级视频应为空。
	nested := doJSON(t, router, http.MethodGet, "/other/list?directory_id="+id+"&path=A", "")
	if nested.Code != http.StatusOK {
		t.Fatalf("nested status = %d body = %s", nested.Code, nested.Body.String())
	}
	if err := json.Unmarshal(nested.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode nested response: %v", err)
	}
	if len(payload.Folders) != 1 || payload.Folders[0].Path != "A/B" {
		t.Fatalf("nested folders = %#v, want only A/B", payload.Folders)
	}
	if len(payload.Items) != 1 || payload.Items[0].Filename != "g.mp4" {
		t.Fatalf("nested items = %#v, want only g.mp4", payload.Items)
	}

	// 视频模式目录不属于其它模式，必须拒绝，避免分层视图串到视频模式。
	notOther := doJSON(t, router, http.MethodGet, "/other/list?directory_id="+strconv.FormatInt(videoDir.ID, 10), "")
	if notOther.Code != http.StatusBadRequest {
		t.Fatalf("video-mode directory status = %d, want 400", notOther.Code)
	}

	missing := doJSON(t, router, http.MethodGet, "/other/list?directory_id=999999", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing directory status = %d, want 404", missing.Code)
	}

	invalid := doJSON(t, router, http.MethodGet, "/other/list", "")
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("missing directory_id status = %d, want 400", invalid.Code)
	}
}

func TestOtherSearchEndpointFindsNestedFiles(t *testing.T) {
	router, otherDir, videoDir := otherFixture(t)

	// 不带 directory_id：在整个其它模式范围里递归搜索。
	recorder := doJSON(t, router, http.MethodGet, "/other/search?search=g.mp4", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Items []models.Video `json:"items"`
		Total int64          `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Total != 1 || len(payload.Items) != 1 || payload.Items[0].Filename != "g.mp4" {
		t.Fatalf("search result = %#v total=%d, want only g.mp4", payload.Items, payload.Total)
	}
	if payload.Items[0].DirectoryID != otherDir.ID {
		t.Fatalf("result directory = %d, want %d", payload.Items[0].DirectoryID, otherDir.ID)
	}

	// 指定非其它模式目录必须拒绝，避免搜索结果串到视频模式。
	notOther := doJSON(t, router, http.MethodGet, "/other/search?directory_id="+strconv.FormatInt(videoDir.ID, 10)+"&search=.mp4", "")
	if notOther.Code != http.StatusBadRequest {
		t.Fatalf("video-mode directory status = %d, want 400", notOther.Code)
	}

	// 空关键词不应被当作「返回全部」。
	empty := doJSON(t, router, http.MethodGet, "/other/search", "")
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty search status = %d, want 400", empty.Code)
	}

	// 前缀把搜索限制在子树里。
	scoped := doJSON(t, router, http.MethodGet, "/other/search?directory_id="+strconv.FormatInt(otherDir.ID, 10)+"&path=A/B&search=.mp4", "")
	if scoped.Code != http.StatusOK {
		t.Fatalf("scoped status = %d body = %s", scoped.Code, scoped.Body.String())
	}
	if err := json.Unmarshal(scoped.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode scoped response: %v", err)
	}
	if payload.Total != 1 || len(payload.Items) != 1 || payload.Items[0].Filename != "f.mp4" {
		t.Fatalf("scoped result = %#v total=%d, want only f.mp4", payload.Items, payload.Total)
	}
}

func TestOtherListEndpointHidesFoldersWhileSearching(t *testing.T) {
	router, otherDir, _ := otherFixture(t)
	id := strconv.FormatInt(otherDir.ID, 10)

	recorder := doJSON(t, router, http.MethodGet, "/other/list?directory_id="+id+"&search=h.mp4", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Folders []dbpkg.OtherFolder `json:"folders"`
		Items   []models.Video      `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Folders) != 0 {
		t.Fatalf("folders should be hidden while searching: %#v", payload.Folders)
	}
	if len(payload.Items) != 1 || payload.Items[0].Filename != "h.mp4" {
		t.Fatalf("search items = %#v, want only h.mp4", payload.Items)
	}
}
