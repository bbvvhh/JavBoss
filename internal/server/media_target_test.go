package server

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"javboss/internal/storage"
)

// stubBackend is an in-memory storage.Backend used to exercise the remote
// streaming proxy without a network server.
type stubBackend struct {
	content []byte
	name    string
}

func (s *stubBackend) Kind() string { return storage.KindWebDAV }

func (s *stubBackend) Root() string { return "/" }

func (s *stubBackend) StatRoot(context.Context) (storage.Entry, error) {
	return storage.Entry{IsDir: true}, nil
}

func (s *stubBackend) Walk(context.Context, func(storage.Entry) error) error { return nil }

func (s *stubBackend) List(context.Context, string) ([]storage.Entry, error) { return nil, nil }

func (s *stubBackend) Stat(_ context.Context, relPath string) (storage.Entry, error) {
	return storage.Entry{
		RelPath: relPath,
		Name:    s.name,
		Size:    int64(len(s.content)),
	}, nil
}

func (s *stubBackend) OpenRange(_ context.Context, _ string, start, end int64) (storage.RangeReader, error) {
	if end < 0 || end >= int64(len(s.content)) {
		end = int64(len(s.content)) - 1
	}
	if start < 0 {
		start = 0
	}
	return &stubRangeReader{
		Reader: strings.NewReader(string(s.content[start : end+1])),
		size:   int64(len(s.content)),
		start:  start,
		end:    end,
	}, nil
}

func (s *stubBackend) MediaPath(string) string { return "http://user:pass@example.test/dav/x.mp4" }

type stubRangeReader struct {
	io.Reader
	size  int64
	start int64
	end   int64
}

func (r *stubRangeReader) Close() error        { return nil }
func (r *stubRangeReader) TotalSize() int64    { return r.size }
func (r *stubRangeReader) RangeStart() int64   { return r.start }
func (r *stubRangeReader) RangeEnd() int64     { return r.end }
func (r *stubRangeReader) ContentType() string { return "video/mp4" }

func callRemoteStream(t *testing.T, method, rangeHeader string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, "/videos/1/stream", nil)
	if rangeHeader != "" {
		c.Request.Header.Set("Range", rangeHeader)
	}
	backend := &stubBackend{content: []byte("0123456789abcdefghij"), name: "movie.mp4"}
	serveRemoteMediaFile(c, &mediaTarget{Backend: backend, RelPath: "movie.mp4", Remote: true})
	// Going through the engine would flush the status; calling the handler
	// directly requires an explicit flush.
	c.Writer.WriteHeaderNow()
	return recorder
}

func TestServeRemoteMediaFileFullBody(t *testing.T) {
	recorder := callRemoteStream(t, http.MethodGet, "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Body.String(); got != "0123456789abcdefghij" {
		t.Fatalf("body = %q", got)
	}
	if recorder.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("missing Accept-Ranges: %v", recorder.Header())
	}
	if recorder.Header().Get("Content-Length") != "20" {
		t.Fatalf("Content-Length = %q", recorder.Header().Get("Content-Length"))
	}
	if recorder.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("Content-Type = %q", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Content-Range") != "" {
		t.Fatal("a full response must not send Content-Range")
	}
}

func TestServeRemoteMediaFilePartialBody(t *testing.T) {
	recorder := callRemoteStream(t, http.MethodGet, "bytes=10-14")
	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", recorder.Code)
	}
	if got := recorder.Body.String(); got != "abcde" {
		t.Fatalf("body = %q, want abcde", got)
	}
	if got := recorder.Header().Get("Content-Range"); got != "bytes 10-14/20" {
		t.Fatalf("Content-Range = %q, want bytes 10-14/20", got)
	}
	if got := recorder.Header().Get("Content-Length"); got != "5" {
		t.Fatalf("Content-Length = %q, want 5", got)
	}
}

func TestServeRemoteMediaFileSuffixRange(t *testing.T) {
	recorder := callRemoteStream(t, http.MethodGet, "bytes=-4")
	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", recorder.Code)
	}
	if got := recorder.Body.String(); got != "ghij" {
		t.Fatalf("body = %q, want ghij", got)
	}
}

func TestServeRemoteMediaFileUnsatisfiableRange(t *testing.T) {
	recorder := callRemoteStream(t, http.MethodGet, "bytes=500-600")
	if recorder.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status = %d, want 416", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Range"); got != "bytes */20" {
		t.Fatalf("Content-Range = %q, want bytes */20", got)
	}
}

func TestServeRemoteMediaFileHeadHasNoBody(t *testing.T) {
	recorder := callRemoteStream(t, http.MethodHead, "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("HEAD must not write a body, got %q", recorder.Body.String())
	}
	if recorder.Header().Get("Content-Length") != "20" {
		t.Fatalf("HEAD must still advertise the length: %q", recorder.Header().Get("Content-Length"))
	}
}

func TestParseByteRange(t *testing.T) {
	cases := []struct {
		header    string
		size      int64
		wantStart int64
		wantEnd   int64
		wantOK    bool
	}{
		{"bytes=0-99", 1000, 0, 99, true},
		{"bytes=100-", 1000, 100, 999, true},
		{"bytes=-100", 1000, 900, 999, true},
		{"bytes=0-5000", 1000, 0, 999, true},
		{"BYTES=5-9", 1000, 5, 9, true},
		{"bytes=1000-", 1000, 0, 0, false},
		{"bytes=500-100", 1000, 0, 0, false},
		{"bytes=0-1,5-6", 1000, 0, 0, false},
		{"items=0-1", 1000, 0, 0, false},
		{"bytes=abc-def", 1000, 0, 0, false},
		{"bytes=-0", 1000, 0, 0, false},
	}
	for _, tc := range cases {
		start, end, ok := parseByteRange(tc.header, tc.size)
		if ok != tc.wantOK {
			t.Fatalf("parseByteRange(%q, %d) ok = %v, want %v", tc.header, tc.size, ok, tc.wantOK)
		}
		if !tc.wantOK {
			continue
		}
		if start != tc.wantStart || end != tc.wantEnd {
			t.Fatalf("parseByteRange(%q, %d) = %d-%d, want %d-%d", tc.header, tc.size, start, end, tc.wantStart, tc.wantEnd)
		}
	}
}
