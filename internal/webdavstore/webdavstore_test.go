package webdavstore

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/net/webdav"

	"javboss/internal/backup"
	"javboss/internal/storage"
)

const (
	testUser     = "javboss"
	testPassword = "s3cret"
)

// newTestServer 起一个真实的 WebDAV 服务器（x/net/webdav），root 是它的根目录。
// readOnly 为 true 时拒绝一切写操作的请求，用来模拟只读挂载的网盘。
func newTestServer(t *testing.T, root string, readOnly bool) *httptest.Server {
	t.Helper()
	handler := &webdav.Handler{
		Prefix:     "/dav/",
		FileSystem: webdav.Dir(root),
		LockSystem: webdav.NewMemLS(),
	}
	var next http.Handler = handler
	if readOnly {
		next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPut, http.MethodDelete, "MKCOL":
				http.Error(w, "read-only", http.StatusForbidden)
				return
			}
			handler.ServeHTTP(w, r)
		})
	}
	mux := http.NewServeMux()
	mux.Handle("/dav/", basicAuth(next))
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

func newTestStore(t *testing.T, server *httptest.Server, remotePath string) *Store {
	t.Helper()
	store, err := New(storage.Connection{
		ID:       1,
		Name:     "test",
		Kind:     storage.KindWebDAV,
		URL:      server.URL + "/dav",
		Username: testUser,
		Password: testPassword,
	}, remotePath)
	if err != nil {
		t.Fatalf("new webdav backup store: %v", err)
	}
	return store
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestStoreRoundTrip(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "backups", "javboss-backup-20260923-101010.zip"), "old-backup")
	writeTestFile(t, filepath.Join(root, "backups", "movie.mp4"), "not-a-backup")
	server := newTestServer(t, root, false)
	store := newTestStore(t, server, "/backups")
	ctx := context.Background()

	files, err := store.List(ctx)
	if err != nil {
		t.Fatalf("list backups: %v", err)
	}
	if len(files) != 1 || files[0].Name != "javboss-backup-20260923-101010.zip" {
		t.Fatalf("backup list = %#v", files)
	}

	name := "javboss-backup-20260923-111111.zip"
	if exists, err := store.Exists(ctx, name); err != nil || exists {
		t.Fatalf("exists before upload = %v (%v)", exists, err)
	}
	written, err := store.Put(ctx, name, func(w io.Writer) error {
		_, err := io.WriteString(w, "fresh-backup")
		return err
	})
	if err != nil {
		t.Fatalf("put backup: %v", err)
	}
	if written.Name != name || written.Size == 0 {
		t.Fatalf("written file = %#v", written)
	}
	if got := readFile(t, filepath.Join(root, "backups", name)); got != "fresh-backup" {
		t.Fatalf("uploaded content = %q", got)
	}
	if exists, err := store.Exists(ctx, name); err != nil || !exists {
		t.Fatalf("exists after upload = %v (%v)", exists, err)
	}

	// 备份文件属于「视频目录里的外来文件」，恢复时要能原样取回
	dest := filepath.Join(t.TempDir(), "restore", "source.zip")
	if err := store.Fetch(ctx, name, dest); err != nil {
		t.Fatalf("fetch backup: %v", err)
	}
	if got := readFile(t, dest); got != "fresh-backup" {
		t.Fatalf("fetched content = %q", got)
	}

	if err := store.Probe(ctx); err != nil {
		t.Fatalf("probe writable collection: %v", err)
	}
	if err := store.Delete(ctx, name); err != nil {
		t.Fatalf("delete backup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "backups", name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("uploaded backup still exists (%v)", err)
	}
	if err := store.Delete(ctx, name); err == nil {
		t.Fatal("delete accepted a file that does not exist")
	}
}

func TestStoreIgnoresMissingCollection(t *testing.T) {
	server := newTestServer(t, t.TempDir(), false)
	store := newTestStore(t, server, "/backups")
	ctx := context.Background()

	files, err := store.List(ctx)
	if err != nil || len(files) != 0 {
		t.Fatalf("list missing collection = %#v (%v)", files, err)
	}
	if exists, err := store.Exists(ctx, "javboss-backup-20260923-101010.zip"); err != nil || exists {
		t.Fatalf("exists in missing collection = %v (%v)", exists, err)
	}
}

// TestStoreRequiresExistingCollection 确认远程目录和本机目录一样必须已经存在，
// 否则用户可能以为备份成功了，其实写到了别处。
func TestStoreRequiresExistingCollection(t *testing.T) {
	server := newTestServer(t, t.TempDir(), false)
	store := newTestStore(t, server, "/new/backups")
	ctx := context.Background()

	if err := store.Probe(ctx); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("probe on a missing collection = %v", err)
	}
	name := "javboss-backup-20260923-121212.zip"
	if _, err := store.Put(ctx, name, func(w io.Writer) error {
		_, err := io.WriteString(w, "payload")
		return err
	}); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("put into a missing collection = %v", err)
	}
}

func TestStoreRejectsReadOnlyLocation(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "backups", "javboss-backup-20260923-101010.zip"), "old-backup")
	server := newTestServer(t, root, true)
	store := newTestStore(t, server, "/backups")
	ctx := context.Background()

	// 只读挂载：列表能读，写探测必须报「不可写」
	if files, err := store.List(ctx); err != nil || len(files) != 1 {
		t.Fatalf("list on read-only server = %#v (%v)", files, err)
	}
	if err := store.Probe(ctx); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("probe on read-only server = %v", err)
	}
	if _, err := store.Put(ctx, "javboss-backup-20260923-131313.zip", func(w io.Writer) error {
		_, err := io.WriteString(w, "payload")
		return err
	}); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("put on read-only server = %v", err)
	}
	if err := store.Delete(ctx, "javboss-backup-20260923-101010.zip"); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("delete on read-only server = %v", err)
	}
}

func TestStoreReportsAuthenticationFailure(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "backups", "javboss-backup-20260923-101010.zip"), "old-backup")
	server := newTestServer(t, root, false)
	store, err := New(storage.Connection{
		Kind:     storage.KindWebDAV,
		URL:      server.URL + "/dav",
		Username: testUser,
		Password: "wrong",
	}, "/backups")
	if err != nil {
		t.Fatalf("new webdav backup store: %v", err)
	}
	if err := store.Probe(context.Background()); !errors.Is(err, storage.ErrUnauthorized) {
		t.Fatalf("probe with bad credentials = %v", err)
	}
}

func TestStoreRejectsInvalidNames(t *testing.T) {
	server := newTestServer(t, t.TempDir(), false)
	store := newTestStore(t, server, "/backups")
	ctx := context.Background()

	for _, name := range []string{"", "../escape.zip", "movie.mp4", "javboss-backup-x.txt"} {
		if _, err := store.Put(ctx, name, func(io.Writer) error { return nil }); err == nil {
			t.Fatalf("put accepted %q", name)
		}
		if err := store.Delete(ctx, name); err == nil {
			t.Fatalf("delete accepted %q", name)
		}
		if err := store.Fetch(ctx, name, filepath.Join(t.TempDir(), "x.zip")); err == nil {
			t.Fatalf("fetch accepted %q", name)
		}
		if exists, err := store.Exists(ctx, name); err != nil || exists {
			t.Fatalf("exists(%q) = %v (%v)", name, exists, err)
		}
	}
}

// TestStoreFetchFollowsRedirect 复刻移动云 EOS 这类 WebDAV 的行为：GET 备份文件
// 会被 302 到一个临时签名的对象地址（另一个 host、不再需要 WebDAV 认证）。
// 恢复要跟着跳转把字节取回来，而不是把 302 当成失败。
func TestStoreFetchFollowsRedirect(t *testing.T) {
	const payload = "redirected-backup-bytes"
	name := "javboss-backup-20260923-151515.zip"

	objectMux := http.NewServeMux()
	objectMux.HandleFunc("/objects/"+name, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, payload)
	})
	objectServer := httptest.NewServer(objectMux)
	t.Cleanup(objectServer.Close)

	davMux := http.NewServeMux()
	davMux.Handle("/dav/", basicAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
			return
		}
		http.Redirect(w, r, objectServer.URL+"/objects/"+name+"?X-Amz-Signature=test", http.StatusFound)
	})))
	server := httptest.NewServer(davMux)
	t.Cleanup(server.Close)

	store, err := New(storage.Connection{
		Kind:     storage.KindWebDAV,
		URL:      server.URL + "/dav",
		Username: testUser,
		Password: testPassword,
	}, "/backups")
	if err != nil {
		t.Fatalf("new webdav backup store: %v", err)
	}

	dest := filepath.Join(t.TempDir(), "restore", "source.zip")
	if err := store.Fetch(context.Background(), name, dest); err != nil {
		t.Fatalf("fetch redirected backup: %v", err)
	}
	if got := readFile(t, dest); got != payload {
		t.Fatalf("fetched content = %q", got)
	}
}

func TestStoreFetchMissingFile(t *testing.T) {
	server := newTestServer(t, t.TempDir(), false)
	store := newTestStore(t, server, "/backups")
	err := store.Fetch(context.Background(), "javboss-backup-20260923-101010.zip",
		filepath.Join(t.TempDir(), "source.zip"))
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("fetch missing backup = %v", err)
	}
}

// TestStoreKeepsArchiveBytes 确认上传的是原始字节：备份是加密 zip，
// 中间层不能重新压缩或改写内容。
func TestStoreKeepsArchiveBytes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "backups"), 0o755); err != nil {
		t.Fatalf("create backup collection: %v", err)
	}
	server := newTestServer(t, root, false)
	store := newTestStore(t, server, "/backups")
	payload := strings.Repeat("javboss-backup-payload-", 128)
	name := "javboss-backup-20260923-141414.zip"
	if _, err := store.Put(context.Background(), name, func(w io.Writer) error {
		_, err := io.WriteString(w, payload)
		return err
	}); err != nil {
		t.Fatalf("put backup: %v", err)
	}
	if got := readFile(t, filepath.Join(root, "backups", name)); got != payload {
		t.Fatalf("uploaded content changed: %d bytes", len(got))
	}
	if !backup.ValidFileName(name) {
		t.Fatalf("test file name %q is not a valid backup name", name)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(content)
}
