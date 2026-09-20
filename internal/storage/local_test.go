package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalBackendWalkAndStat(t *testing.T) {
	root := t.TempDir()
	payload := videoPayload()
	writeTestFile(t, filepath.Join(root, "sub", "movie.mp4"), payload)
	writeTestFile(t, filepath.Join(root, "note.txt"), []byte("note"))

	backend, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local backend: %v", err)
	}
	if backend.Kind() != KindLocal {
		t.Fatalf("kind = %q, want %q", backend.Kind(), KindLocal)
	}

	seen := map[string]int64{}
	if err := backend.Walk(context.Background(), func(entry Entry) error {
		seen[entry.RelPath] = entry.Size
		return nil
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(seen) != 2 || seen["sub/movie.mp4"] != int64(len(payload)) {
		t.Fatalf("unexpected walk result: %#v", seen)
	}

	entry, err := backend.Stat(context.Background(), "sub/movie.mp4")
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if entry.Name != "movie.mp4" || entry.IsDir || entry.ModTime.IsZero() {
		t.Fatalf("unexpected stat entry: %#v", entry)
	}
}

func TestLocalBackendOpenRange(t *testing.T) {
	root := t.TempDir()
	payload := videoPayload()
	writeTestFile(t, filepath.Join(root, "movie.mp4"), payload)

	backend, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local backend: %v", err)
	}
	reader, err := backend.OpenRange(context.Background(), "movie.mp4", 100, 149)
	if err != nil {
		t.Fatalf("open range: %v", err)
	}
	defer reader.Close()
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(body) != string(payload[100:150]) {
		t.Fatalf("range body mismatch: got %d bytes", len(body))
	}
	if reader.RangeStart() != 100 || reader.RangeEnd() != 149 || reader.TotalSize() != int64(len(payload)) {
		t.Fatalf("unexpected range metadata: %d-%d/%d", reader.RangeStart(), reader.RangeEnd(), reader.TotalSize())
	}

	// end < 0 means "to EOF".
	tail, err := backend.OpenRange(context.Background(), "movie.mp4", int64(len(payload))-5, -1)
	if err != nil {
		t.Fatalf("open tail range: %v", err)
	}
	defer tail.Close()
	tailBody, err := io.ReadAll(tail)
	if err != nil {
		t.Fatalf("read tail: %v", err)
	}
	if len(tailBody) != 5 {
		t.Fatalf("tail length = %d, want 5", len(tailBody))
	}
}

func TestLocalBackendRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "inside.mp4"), []byte("x"))
	backend, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local backend: %v", err)
	}
	// A path that escapes the root collapses to nothing, so nothing outside can
	// ever be addressed.
	if got := CleanRelPath("../../etc/passwd"); got != "" {
		t.Fatalf("CleanRelPath must reject escaping paths, got %q", got)
	}
	if got := CleanRelPath("a/../../b"); got != "" {
		t.Fatalf("CleanRelPath must reject escaping paths, got %q", got)
	}
	if got := CleanRelPath("a/../b"); got != "b" {
		t.Fatalf("CleanRelPath should keep in-root traversal, got %q", got)
	}

	// Escaping input therefore resolves to the root itself, never to a parent.
	entry, err := backend.Stat(context.Background(), "../../etc/passwd")
	if err != nil {
		t.Fatalf("escaping path must stay inside the root, got: %v", err)
	}
	if !entry.IsDir {
		t.Fatalf("escaping path should resolve to the root directory, got %#v", entry)
	}
	if _, err := NewLocal("relative/path"); err == nil {
		t.Fatal("NewLocal must reject relative roots")
	}
}

func TestLocalBackendMediaPathAndMissing(t *testing.T) {
	root := t.TempDir()
	backend, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local backend: %v", err)
	}
	want := filepath.Join(root, "a", "b.mp4")
	if got := backend.MediaPath("a/b.mp4"); got != want {
		t.Fatalf("MediaPath = %q, want %q", got, want)
	}
	if _, err := backend.Stat(context.Background(), "ghost.mp4"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stat missing file error = %v, want ErrNotFound", err)
	}
	if !IsUnavailable(ErrNotFound) || !IsUnavailable(os.ErrNotExist) {
		t.Fatal("missing paths must count as unavailable roots")
	}
	if IsUnavailable(errors.New("syntax error")) {
		t.Fatal("unrelated errors must not be treated as unavailable")
	}
}

func TestPathHelpers(t *testing.T) {
	if got := NormalizeRemotePath(""); got != "/" {
		t.Fatalf("NormalizeRemotePath(\"\") = %q, want \"/\"", got)
	}
	if got := NormalizeRemotePath("a/b/"); got != "/a/b" {
		t.Fatalf("NormalizeRemotePath = %q, want /a/b", got)
	}
	if got := JoinRemotePath("/a", "b/c"); got != "/a/b/c" {
		t.Fatalf("JoinRemotePath = %q, want /a/b/c", got)
	}
	if got := JoinRemotePath("/", "b"); got != "/b" {
		t.Fatalf("JoinRemotePath root = %q, want /b", got)
	}
	if got := CleanRelPath(`a\b\c`); got != "a/b/c" {
		t.Fatalf("CleanRelPath backslashes = %q, want a/b/c", got)
	}
	if got := CleanRelPath("a/./b/../c"); got != "a/c" {
		t.Fatalf("CleanRelPath dot segments = %q, want a/c", got)
	}
}

func TestRedactRemovesCredentials(t *testing.T) {
	if got := Redact("http://user:pass@host/dav/x.mp4"); got != "http://***@host/dav/x.mp4" {
		t.Fatalf("Redact = %q", got)
	}
	plain := "/local/path/movie.mp4"
	if got := Redact(plain); got != plain {
		t.Fatalf("Redact changed a credential-free path: %q", got)
	}
	if got := RedactError(errors.New("GET http://u:p@h/x failed")); got.Error() != "GET http://***@h/x failed" {
		t.Fatalf("RedactError = %q", got.Error())
	}
}

func TestRemoteIdentityRoundTrip(t *testing.T) {
	identity := RemoteIdentity(1, "/7788/R")
	if identity != "webdav://1/7788/R" {
		t.Fatalf("RemoteIdentity = %q, want webdav://1/7788/R", identity)
	}
	// Paths are canonicalized the same way as the stored remote root.
	if got := RemoteIdentity(42, "7788/R/"); got != "webdav://42/7788/R" {
		t.Fatalf("RemoteIdentity normalization = %q", got)
	}

	id, remotePath, ok := ParseRemoteIdentity(identity)
	if !ok || id != 1 || remotePath != "/7788/R" {
		t.Fatalf("ParseRemoteIdentity = (%d, %q, %v)", id, remotePath, ok)
	}
	// Case-insensitive scheme, like URL schemes in general.
	if _, _, ok := ParseRemoteIdentity("WebDAV://7/a/b"); !ok {
		t.Fatal("scheme matching must be case-insensitive")
	}

	for _, invalid := range []string{
		"", "7788/R", "/7788/R", "webdav://", "webdav://abc/x",
		"webdav://0/x", "webdav://-3/x", "webdav://12", "D:\\Videos", "/mnt/videos",
	} {
		if _, _, ok := ParseRemoteIdentity(invalid); ok {
			t.Fatalf("ParseRemoteIdentity(%q) must fail", invalid)
		}
	}
}

func TestNormalizeKindAndMimeTypes(t *testing.T) {
	cases := map[string]string{
		"":        KindLocal,
		"local":   KindLocal,
		"webdav":  KindWebDAV,
		"WebDAV":  KindWebDAV,
		"dav":     KindWebDAV,
		"remote":  KindWebDAV,
		"unknown": KindLocal,
	}
	for input, want := range cases {
		if got := NormalizeKind(input); got != want {
			t.Fatalf("NormalizeKind(%q) = %q, want %q", input, got, want)
		}
	}
	if got := MimeTypeForName("/a/b/MOVIE.MKV"); got != "video/x-matroska" {
		t.Fatalf("MimeTypeForName mkv = %q", got)
	}
	if got := MimeTypeForName("clip.mp4"); got != "video/mp4" {
		t.Fatalf("MimeTypeForName mp4 = %q", got)
	}
	if got := MimeTypeForName("archive.rar"); got != "application/octet-stream" {
		t.Fatalf("MimeTypeForName unknown = %q", got)
	}
}

func TestReadPrefixStopsAtFileEnd(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "small.bin"), []byte("abc"))
	backend, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local backend: %v", err)
	}
	prefix, err := ReadPrefix(context.Background(), backend, "small.bin", HeaderSniffSize)
	if err != nil {
		t.Fatalf("ReadPrefix: %v", err)
	}
	if string(prefix) != "abc" {
		t.Fatalf("ReadPrefix = %q, want abc", prefix)
	}
}
