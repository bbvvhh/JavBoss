package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"golang.org/x/net/webdav"
)

const (
	testUser     = "javboss"
	testPassword = "s3cret"
)

// newTestWebDAV starts a real WebDAV server (x/net/webdav) backed by root, with
// HTTP Basic authentication, so the client is exercised end to end.
func newTestWebDAV(t *testing.T, root string) *httptest.Server {
	t.Helper()
	handler := &webdav.Handler{
		Prefix:     "/dav/",
		FileSystem: webdav.Dir(root),
		LockSystem: webdav.NewMemLS(),
	}
	mux := http.NewServeMux()
	mux.Handle("/dav/", basicAuth(handler))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func basicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != testUser || password != testPassword {
			w.Header().Set("WWW-Authenticate", `Basic realm="javboss-test"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newTestWebDAVBackend(t *testing.T, server *httptest.Server) *WebDAV {
	t.Helper()
	backend, err := NewWebDAV(Connection{
		ID:       1,
		Name:     "test",
		Kind:     KindWebDAV,
		URL:      server.URL + "/dav",
		Username: testUser,
		Password: testPassword,
	}, "/")
	if err != nil {
		t.Fatalf("new webdav backend: %v", err)
	}
	return backend
}

func writeTestFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// videoPayload is large enough that range requests return a real partial body.
func videoPayload() []byte {
	payload := make([]byte, 4096)
	for i := range payload {
		payload[i] = byte('a' + i%26)
	}
	return payload
}

func TestWebDAVStatRootAndList(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "movie.mp4"), videoPayload())
	writeTestFile(t, filepath.Join(root, "nested", "clip.mkv"), []byte("nested"))
	server := newTestWebDAV(t, root)
	backend := newTestWebDAVBackend(t, server)

	ctx := context.Background()
	rootEntry, err := backend.StatRoot(ctx)
	if err != nil {
		t.Fatalf("stat root: %v", err)
	}
	if !rootEntry.IsDir {
		t.Fatalf("root entry should be a collection: %#v", rootEntry)
	}

	entries, err := backend.List(ctx, "")
	if err != nil {
		t.Fatalf("list root: %v", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}
	sort.Strings(names)
	if len(names) != 2 || names[0] != "movie.mp4" || names[1] != "nested" {
		t.Fatalf("unexpected root listing: %#v", names)
	}

	nested, err := backend.List(ctx, "nested")
	if err != nil {
		t.Fatalf("list nested: %v", err)
	}
	if len(nested) != 1 || nested[0].RelPath != "nested/clip.mkv" || nested[0].IsDir {
		t.Fatalf("unexpected nested listing: %#v", nested)
	}
}

func TestWebDAVWalkReportsFilesWithMetadata(t *testing.T) {
	root := t.TempDir()
	payload := videoPayload()
	writeTestFile(t, filepath.Join(root, "a", "one.mp4"), payload)
	writeTestFile(t, filepath.Join(root, "a", "b", "two.mkv"), []byte("two"))
	writeTestFile(t, filepath.Join(root, "cover.jpg"), []byte("jpg"))
	server := newTestWebDAV(t, root)
	backend := newTestWebDAVBackend(t, server)

	seen := map[string]int64{}
	err := backend.Walk(context.Background(), func(entry Entry) error {
		if entry.IsDir {
			t.Fatalf("Walk must not yield directories: %#v", entry)
		}
		seen[entry.RelPath] = entry.Size
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(seen) != 3 {
		t.Fatalf("walk saw %d files, want 3: %#v", len(seen), seen)
	}
	if seen["a/one.mp4"] != int64(len(payload)) {
		t.Fatalf("size for a/one.mp4 = %d, want %d", seen["a/one.mp4"], len(payload))
	}
	if _, ok := seen["cover.jpg"]; !ok {
		t.Fatalf("walk must report non-video files too: %#v", seen)
	}
}

func TestWebDAVOpenRangeHonoursOffsets(t *testing.T) {
	root := t.TempDir()
	payload := videoPayload()
	writeTestFile(t, filepath.Join(root, "movie.mp4"), payload)
	server := newTestWebDAV(t, root)
	backend := newTestWebDAVBackend(t, server)

	reader, err := backend.OpenRange(context.Background(), "movie.mp4", 10, 19)
	if err != nil {
		t.Fatalf("open range: %v", err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read range: %v", err)
	}
	if string(body) != string(payload[10:20]) {
		t.Fatalf("range body = %q, want %q", body, payload[10:20])
	}
	if reader.RangeStart() != 10 || reader.RangeEnd() != 19 {
		t.Fatalf("reported range = %d-%d, want 10-19", reader.RangeStart(), reader.RangeEnd())
	}
	if reader.TotalSize() != int64(len(payload)) {
		t.Fatalf("total size = %d, want %d", reader.TotalSize(), len(payload))
	}
}

func TestWebDAVStatMissingPathAndBadCredentials(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "movie.mp4"), []byte("x"))
	server := newTestWebDAV(t, root)

	backend := newTestWebDAVBackend(t, server)
	if _, err := backend.Stat(context.Background(), "missing.mp4"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stat missing path error = %v, want ErrNotFound", err)
	}

	wrong, err := NewWebDAV(Connection{URL: server.URL + "/dav", Username: testUser, Password: "wrong"}, "/")
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}
	if _, err := wrong.StatRoot(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("wrong password error = %v, want ErrUnauthorized", err)
	}
	if !IsUnavailable(ErrUnauthorized) {
		t.Fatal("ErrUnauthorized must be treated as a temporarily unavailable root")
	}
}

func TestWebDAVMediaPathEmbedsCredentials(t *testing.T) {
	root := t.TempDir()
	server := newTestWebDAV(t, root)
	backend := newTestWebDAVBackend(t, server)

	mediaPath := backend.MediaPath("a/movie one.mp4")
	if !strings.HasSuffix(mediaPath, "/dav/a/movie%20one.mp4") {
		t.Fatalf("unexpected media path: %s", mediaPath)
	}
	if !strings.Contains(mediaPath, testUser+":"+testPassword+"@") {
		t.Fatalf("media path must carry credentials for ffmpeg/mpv: %s", mediaPath)
	}
	if redacted := Redact(mediaPath); strings.Contains(redacted, testPassword) {
		t.Fatalf("Redact leaked the password: %s", redacted)
	}
}

func TestWebDAVNestedRootPath(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "library", "hd", "movie.mp4"), []byte("video"))
	server := newTestWebDAV(t, root)

	backend, err := NewWebDAV(Connection{
		URL:      server.URL + "/dav",
		Username: testUser,
		Password: testPassword,
	}, "/library/hd")
	if err != nil {
		t.Fatalf("new backend: %v", err)
	}
	entry, err := backend.Stat(context.Background(), "movie.mp4")
	if err != nil {
		t.Fatalf("stat below nested root: %v", err)
	}
	if entry.Size != 5 {
		t.Fatalf("nested stat size = %d, want 5", entry.Size)
	}
}

func TestNewWebDAVRejectsInvalidURLs(t *testing.T) {
	for _, raw := range []string{"", "ftp://host/dav", "://nope"} {
		if _, err := NewWebDAV(Connection{URL: raw}, "/"); err == nil {
			t.Fatalf("NewWebDAV(%q) should fail", raw)
		}
	}
}
