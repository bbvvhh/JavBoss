package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/webdav"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/service"
	"javboss/internal/storage"
	"javboss/internal/util"
)

// This file contains an opt-in end-to-end test for a WebDAV video source.
//
// It covers the whole read path that a real deployment uses: PROPFIND traversal,
// ffprobe metadata extraction over a credentialed HTTP URL, database upsert, and
// HTTP Range streaming back to the browser.
//
// The only trick is that no real ffprobe is required: the test copies its own
// test binary to internal/bin/ffprobe(.exe) and lets TestMain recognize the
// activation environment variable, so the "ffprobe" that the scan pipeline runs
// is a stub which really fetches the URL it was handed. That proves the URL
// JavBoss builds (including credentials) is genuinely fetchable.
//
// Run it with:
//
//	JAVBOSS_E2E_WEBDAV=1 go test ./internal/server -run TestWebDAVScanEndToEnd -v
const (
	e2eEnableEnv       = "JAVBOSS_E2E_WEBDAV"
	fakeProbeActiveEnv = "JAVBOSS_FAKE_FFPROBE_ACTIVE"
	fakeProbeLogEnv    = "JAVBOSS_FAKE_FFPROBE_LOG"
)

// e2eProbePayload is the fake media file served over WebDAV.
func e2eProbePayload() []byte {
	payload := make([]byte, 64)
	for i := range payload {
		payload[i] = byte('A' + i%26)
	}
	return payload
}

func TestMain(m *testing.M) {
	if os.Getenv(fakeProbeActiveEnv) == "1" {
		os.Exit(runFakeProbe())
	}
	os.Exit(m.Run())
}

// runFakeProbe emulates the ffprobe invocation JavBoss performs. It fails when
// the source cannot actually be fetched, so a broken URL or missing credentials
// shows up as a scan failure instead of a silent stub success.
func runFakeProbe() int {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "fake ffprobe: no arguments")
		return 2
	}
	source := args[len(args)-1]

	if logPath := strings.TrimSpace(os.Getenv(fakeProbeLogEnv)); logPath != "" {
		if handle, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			_, _ = handle.WriteString(source + "\n")
			_ = handle.Close()
		}
	}

	if !strings.HasPrefix(source, "http://") && !strings.HasPrefix(source, "https://") {
		fmt.Fprintf(os.Stderr, "fake ffprobe only reads http sources, got %q\n", source)
		return 1
	}

	request, err := http.NewRequest(http.MethodGet, source, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fake ffprobe: %v\n", err)
		return 1
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fake ffprobe cannot fetch source: %v\n", err)
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		fmt.Fprintf(os.Stderr, "fake ffprobe fetch status %d\n", response.StatusCode)
		return 1
	}
	header, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		fmt.Fprintf(os.Stderr, "fake ffprobe read: %v\n", err)
		return 1
	}
	if len(header) == 0 {
		fmt.Fprintln(os.Stderr, "fake ffprobe read an empty body")
		return 1
	}

	probe := map[string]any{
		"streams": []map[string]any{
			{
				"index": 0, "codec_type": "video", "codec_name": "h264",
				"width": 1920, "height": 1080, "avg_frame_rate": "30000/1001",
				"r_frame_rate": "30000/1001", "bit_rate": "5000000",
			},
			{
				"index": 1, "codec_type": "audio", "codec_name": "aac",
				"sample_rate": "48000", "channels": 2, "bit_rate": "128000",
			},
		},
		"format": map[string]any{
			"duration": "120.500000", "size": "64", "bit_rate": "5128000", "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
		},
	}
	if err := json.NewEncoder(os.Stdout).Encode(probe); err != nil {
		fmt.Fprintf(os.Stderr, "fake ffprobe encode: %v\n", err)
		return 1
	}
	return 0
}

// installFakeProbe copies the running test binary to internal/bin/ffprobe(.exe)
// below the current working directory, which is where util.ResolveFFprobePath
// looks in non-release builds.
func installFakeProbe(t *testing.T) {
	t.Helper()
	workingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	binaryName := "ffprobe"
	if strings.EqualFold(filepath.Ext(os.Args[0]), ".exe") {
		binaryName += ".exe"
	}
	binDir := filepath.Join(workingDir, "internal", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("create stub bin dir: %v", err)
	}
	target := filepath.Join(binDir, binaryName)
	source, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatalf("read test binary: %v", err)
	}
	if err := os.WriteFile(target, source, 0o755); err != nil {
		t.Fatalf("write stub ffprobe: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Remove(target)
		_ = os.Remove(binDir)
		_ = os.Remove(filepath.Join(workingDir, "internal"))
	})

	resolved, err := util.ResolveFFprobePath()
	if err != nil {
		t.Fatalf("resolve stub ffprobe: %v", err)
	}
	if filepath.Clean(resolved) != filepath.Clean(target) {
		t.Fatalf("ffprobe resolved to %q instead of the stub %q; run this test on its own", resolved, target)
	}
}

func TestWebDAVScanEndToEnd(t *testing.T) {
	if os.Getenv(e2eEnableEnv) != "1" {
		t.Skip("set JAVBOSS_E2E_WEBDAV=1 to run the WebDAV end-to-end test")
	}

	installFakeProbe(t)

	const (
		user     = "davuser"
		password = "davpass"
	)
	logPath := filepath.Join(t.TempDir(), "ffprobe-calls.log")
	t.Setenv(fakeProbeActiveEnv, "1")
	t.Setenv(fakeProbeLogEnv, logPath)

	// 1. Serve a fake video over WebDAV, behind HTTP Basic auth.
	root := t.TempDir()
	payload := e2eProbePayload()
	if err := os.MkdirAll(filepath.Join(root, "JAV", "HD"), 0o755); err != nil {
		t.Fatalf("mkdir media tree: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "JAV", "HD", "zzz-clip.mp4"), payload, 0o644); err != nil {
		t.Fatalf("write fake video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "JAV", "HD", "poster.jpg"), []byte("jpeg"), 0o644); err != nil {
		t.Fatalf("write non-video file: %v", err)
	}
	handler := &webdav.Handler{Prefix: "/dav/", FileSystem: webdav.Dir(root), LockSystem: webdav.NewMemLS()}
	mux := http.NewServeMux()
	mux.Handle("/dav/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPassword, ok := r.BasicAuth()
		if !ok || gotUser != user || gotPassword != password {
			w.Header().Set("WWW-Authenticate", `Basic realm="javboss-e2e"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	davServer := httptest.NewServer(mux)
	t.Cleanup(davServer.Close)

	// 2. Register the remote source in a throwaway database.
	database, err := db.Open(filepath.Join(t.TempDir(), "e2e.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	ctx := context.Background()
	connection, err := db.CreateStorageConnection(ctx, db.StorageConnectionInput{
		Name:     stringPointer("e2e dav"),
		URL:      stringPointer(davServer.URL + "/dav"),
		Username: stringPointer(user),
		Password: stringPointer(password),
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	connectionID := connection.ID
	directory, err := db.CreateDirectoryFromSource(ctx, db.DirectorySource{
		Kind:         storage.KindWebDAV,
		Path:         "/JAV/HD",
		ConnectionID: &connectionID,
	})
	if err != nil {
		t.Fatalf("create remote directory: %v", err)
	}

	// 3. Scan it exactly like the scheduler would.
	scanCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	summary, err := service.ScanDirectory(scanCtx, *directory)
	if err != nil {
		t.Fatalf("scan remote directory: %v", err)
	}
	if summary.Inserted != 1 {
		t.Fatalf("scan inserted %d videos, want 1 (summary=%+v)", summary.Inserted, summary)
	}

	locations, err := db.VideoLocationsByDirectory(ctx, directory.ID)
	if err != nil {
		t.Fatalf("load locations: %v", err)
	}
	if len(locations) != 1 {
		t.Fatalf("expected exactly one video location, got %d", len(locations))
	}
	location := locations[0]
	if location.RelativePath != "zzz-clip.mp4" {
		t.Fatalf("relative path = %q, want zzz-clip.mp4", location.RelativePath)
	}
	if location.Video.DurationSec != 121 && location.Video.DurationSec != 120 {
		t.Fatalf("probed duration = %d, want ~120", location.Video.DurationSec)
	}

	// 4. The probe must have fetched the credentialed WebDAV URL, not a local path.
	rawLog, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read ffprobe call log %s: %v", logPath, err)
	}
	logged := strings.TrimSpace(string(rawLog))
	wantSuffix := "/dav/JAV/HD/zzz-clip.mp4"
	wantPrefix := "http://" + user + ":" + password + "@"
	if !strings.HasSuffix(logged, wantSuffix) {
		t.Fatalf("ffprobe was not given the remote URL ending in %q; calls were:\n%s", wantSuffix, logged)
	}
	if !strings.HasPrefix(logged, wantPrefix) {
		t.Fatalf("ffprobe URL must carry credentials (%q); calls were:\n%s", wantPrefix, logged)
	}
	if host := strings.TrimPrefix(davServer.URL, "http://"); !strings.Contains(logged, host) {
		t.Fatalf("ffprobe must be given the WebDAV endpoint %q; calls were:\n%s", host, logged)
	}
	if strings.Contains(logged, string(os.PathSeparator)+"JAV") {
		t.Fatalf("ffprobe must not be given a local path; calls were:\n%s", logged)
	}

	// 5. Repeated scans must not re-probe an unchanged remote file, which is what
	// keeps WebDAV rescanning cheap.
	second, err := service.ScanDirectory(scanCtx, *directory)
	if err != nil {
		t.Fatalf("rescan remote directory: %v", err)
	}
	if second.Inserted != 0 || second.FilesSeen != 1 {
		t.Fatalf("rescan should reuse the existing row: %+v", second)
	}
	rescanLog, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("re-read ffprobe call log: %v", err)
	}
	if strings.Count(string(rescanLog), "\n") != 1 {
		t.Fatalf("unchanged files must not be probed again; calls were:\n%s", string(rescanLog))
	}

	// 6. The browser stream endpoint must proxy byte ranges from WebDAV.
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router)

	streamPath := fmt.Sprintf("/videos/%d/stream?location_id=%d", location.VideoID, location.ID)
	request := httptest.NewRequest(http.MethodGet, streamPath, nil)
	request.Header.Set("Range", "bytes=10-19")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("stream status = %d, want 206 (body=%s)", recorder.Code, recorder.Body.String())
	}
	if got, want := recorder.Body.String(), string(payload[10:20]); got != want {
		t.Fatalf("streamed range = %q, want %q", got, want)
	}
	if got := recorder.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 10-19/%d", len(payload)) {
		t.Fatalf("Content-Range = %q", got)
	}

	// 7. A full request without a Range header returns the whole file.
	fullRequest := httptest.NewRequest(http.MethodGet, streamPath, nil)
	fullRecorder := httptest.NewRecorder()
	router.ServeHTTP(fullRecorder, fullRequest)
	if fullRecorder.Code != http.StatusOK {
		t.Fatalf("full stream status = %d, want 200", fullRecorder.Code)
	}
	if fullRecorder.Body.Len() != len(payload) {
		t.Fatalf("full stream length = %d, want %d", fullRecorder.Body.Len(), len(payload))
	}

	// 8. Write operations must be refused for a remote directory.
	renameRequest := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/videos/%d/locations/%d", location.VideoID, location.ID),
		strings.NewReader(`{"filename":"renamed.mp4"}`),
	)
	renameRequest.Header.Set("Content-Type", "application/json")
	renameRecorder := httptest.NewRecorder()
	router.ServeHTTP(renameRecorder, renameRequest)
	if renameRecorder.Code != http.StatusNotImplemented {
		t.Fatalf("renaming a remote file should return 501, got %d", renameRecorder.Code)
	}

	var stored models.VideoLocation
	if err := database.First(&stored, location.ID).Error; err != nil {
		t.Fatalf("reload location: %v", err)
	}
	if stored.RelativePath != "zzz-clip.mp4" {
		t.Fatalf("relative path must be untouched after the rejected rename: %q", stored.RelativePath)
	}
}

func stringPointer(value string) *string { return &value }
