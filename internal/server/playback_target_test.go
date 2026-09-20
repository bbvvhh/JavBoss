package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/storage"
)

// These tests lock down the reported bug: a WebDAV directory's Path is the
// synthetic identity "webdav://<connectionID><remotePath>", and the frontend
// used to send it as dir_path in play/open/reveal bodies. The eager local-path
// validation rejected it, so every remote playback failed with "invalid
// dir_path" even though location_id was present and perfectly resolvable.
const reportedRemoteDirPath = "webdav://1/7788/R"
const reportedRemoteRelPath = "水/.L3.mp4"

func TestResolveVideoPathRequestFromBodyAcceptsRemoteIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := `{"video_id":567,"location_id":580,"path":"水/.L3.mp4","dir_path":"webdav://1/7788/R"}`
	c.Request = httptest.NewRequest(http.MethodPost, "/videos/play", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	req, err := resolveVideoPathRequestFromBody(c)
	if err != nil {
		t.Fatalf("a remote directory identity must not fail body decoding: %v", err)
	}
	if req.VideoID != 567 || req.LocationID != 580 {
		t.Fatalf("location id was not decoded: %+v", req)
	}
	if req.DirPath != reportedRemoteDirPath {
		t.Fatalf("dir_path = %q", req.DirPath)
	}
}

// setupRemotePlaybackFixture registers one WebDAV connection, one remote
// directory, one video and one location, mirroring a scanned remote library.
func setupRemotePlaybackFixture(t *testing.T) (*models.VideoLocation, models.StorageConnection) {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "remote-playback.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previous := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previous
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	ctx := context.Background()
	name := "fixture dav"
	url := "http://dav.example.test/dav"
	user := "alice"
	password := "secret"
	connection, err := db.CreateStorageConnection(ctx, db.StorageConnectionInput{
		Name: &name, URL: &url, Username: &user, Password: &password,
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	connectionID := connection.ID
	directory, err := db.CreateDirectoryFromSource(ctx, db.DirectorySource{
		Kind: storage.KindWebDAV, Path: "/7788/R", ConnectionID: &connectionID,
	})
	if err != nil {
		t.Fatalf("create remote directory: %v", err)
	}
	video := &models.Video{Fingerprint: "remote-playback-fixture", Size: 1024, DurationSec: 60}
	if err := db.CreateVideo(ctx, video); err != nil {
		t.Fatalf("create video: %v", err)
	}
	location, err := db.UpsertVideoLocation(ctx, video.ID, directory.ID, reportedRemoteRelPath, time.Unix(1710000000, 0).UTC())
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	return location, *connection
}

func TestMediaTargetPrefersLocationOverRemoteIdentityDirPath(t *testing.T) {
	location, connection := setupRemotePlaybackFixture(t)

	target, err := mediaTargetFromRequest(context.Background(), videoPathRequest{
		VideoID:    location.VideoID,
		LocationID: location.ID,
		Path:       reportedRemoteRelPath,
		DirPath:    storage.RemoteIdentity(connection.ID, "/7788/R"),
	})
	if err != nil {
		t.Fatalf("resolve target: %v", err)
	}
	if !target.Remote {
		t.Fatal("a WebDAV location must resolve to a remote target")
	}
	if target.RelPath != reportedRemoteRelPath {
		t.Fatalf("RelPath = %q", target.RelPath)
	}
	if !strings.Contains(target.MediaPath, "/dav/7788/R/") {
		t.Fatalf("MediaPath must point at the remote collection: %s", storage.Redact(target.MediaPath))
	}
	if !strings.Contains(target.MediaPath, "alice:secret@") {
		t.Fatalf("MediaPath must carry credentials for ffmpeg/mpv: %s", storage.Redact(target.MediaPath))
	}
}

// A client that only holds the directory record (no location id) must still be
// able to play, because the identity fully describes the remote source.
func TestMediaTargetResolvesRemoteIdentityWithoutLocationID(t *testing.T) {
	_, connection := setupRemotePlaybackFixture(t)

	target, err := mediaTargetFromRequest(context.Background(), videoPathRequest{
		VideoID: 567,
		Path:    reportedRemoteRelPath,
		DirPath: storage.RemoteIdentity(connection.ID, "/7788/R"),
	})
	if err != nil {
		t.Fatalf("resolve target from identity: %v", err)
	}
	if !target.Remote || target.Backend == nil {
		t.Fatal("identity fallback must produce a remote backend")
	}
	if target.RelPath != reportedRemoteRelPath {
		t.Fatalf("RelPath = %q, want %q", target.RelPath, reportedRemoteRelPath)
	}
	parsed, err := url.Parse(target.MediaPath)
	if err != nil {
		t.Fatalf("parse MediaPath: %v", err)
	}
	if !strings.HasSuffix(parsed.Path, "/dav/7788/R/"+reportedRemoteRelPath) {
		t.Fatalf("MediaPath path = %q", parsed.Path)
	}
	if parsed.User == nil || parsed.User.Username() != "alice" {
		t.Fatalf("MediaPath must carry the connection username: %v", parsed.User)
	}
}

// HTTP-level regression for the reported failure: the exact body the frontend
// sent must get past request decoding and target resolution. /videos/open is
// used because it rejects a remote target before ever launching a player, so a
// "read-only WebDAV source" response proves the path was resolved as remote -
// whereas the bug produced "Invalid video file path" first.
func TestOpenVideoFileAcceptsReportedRemotePayload(t *testing.T) {
	location, connection := setupRemotePlaybackFixture(t)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router)

	body := `{"video_id":` + strconv.FormatInt(location.VideoID, 10) +
		`,"location_id":` + strconv.FormatInt(location.ID, 10) +
		`,"path":"水/.L3.mp4","dir_path":"` + storage.RemoteIdentity(connection.ID, "/7788/R") + `"}`
	request := httptest.NewRequest(http.MethodPost, "/videos/open", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code == http.StatusBadRequest {
		t.Fatalf("the reported payload must not be rejected as an invalid path: %s", recorder.Body.String())
	}
	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("expected the read-only WebDAV response, got %d: %s", recorder.Code, recorder.Body.String())
	}
	payload := recorder.Body.String()
	if !strings.Contains(payload, "WebDAV") {
		t.Fatalf("expected a WebDAV read-only message, got: %s", payload)
	}
}

func TestMediaTargetStillResolvesLocalPaths(t *testing.T) {
	root := t.TempDir()
	target, err := mediaTargetFromRequest(context.Background(), videoPathRequest{
		Path:    "sub/movie.mp4",
		DirPath: root,
	})
	if err != nil {
		t.Fatalf("resolve local target: %v", err)
	}
	if target.Remote {
		t.Fatal("a local path must not be treated as remote")
	}
	if !strings.HasSuffix(target.MediaPath, filepath.Join("sub", "movie.mp4")) {
		t.Fatalf("MediaPath = %q", target.MediaPath)
	}
}

func TestMediaTargetRejectsUnusableInput(t *testing.T) {
	if _, err := mediaTargetFromRequest(context.Background(), videoPathRequest{
		Path: "movie.mp4", DirPath: "",
	}); err == nil {
		t.Fatal("a missing dir_path must still be rejected")
	}
	// A Windows drive-less relative dir_path is not usable as a local root.
	if _, err := mediaTargetFromRequest(context.Background(), videoPathRequest{
		Path: "movie.mp4", DirPath: "7788/R",
	}); err == nil {
		t.Fatal("a relative local dir_path must still be rejected")
	}
}
