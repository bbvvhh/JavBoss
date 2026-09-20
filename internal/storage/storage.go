// Package storage provides a read-only abstraction over video source roots.
//
// JavBoss only ever reads from user directories, so every backend implements the
// same read-only surface: list files, stat one file, read a byte range, and build
// the string that ffprobe/ffmpeg/mpv should open.
//
// The package is intentionally free of dependencies on internal/common or
// internal/db so that internal/manager can use it without creating an import
// cycle (internal/common imports internal/manager).
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"javboss/internal/models"
	"javboss/internal/util"
)

// Kind values persisted on models.Directory.
const (
	KindLocal  = models.DirectoryKindLocal
	KindWebDAV = models.DirectoryKindWebDAV
)

// NormalizeKind maps arbitrary input to a known kind, defaulting to local.
func NormalizeKind(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case KindWebDAV, "dav", "web_dav", "remote":
		return KindWebDAV
	default:
		return KindLocal
	}
}

var (
	// ErrNotFound reports that the path does not exist on the backing storage.
	ErrNotFound = errors.New("storage path not found")
	// ErrUnsupported reports that the backend cannot perform the request.
	ErrUnsupported = errors.New("storage operation not supported")
	// ErrUnauthorized reports rejected credentials.
	ErrUnauthorized = errors.New("storage authentication failed")
)

// Entry describes one file below a backend root.
type Entry struct {
	// RelPath is slash-separated and relative to the root (no leading slash).
	RelPath string
	Name    string
	Size    int64
	ModTime time.Time
	IsDir   bool
}

// Connection describes one configured remote storage endpoint.
//
// Credentials never leave the process: MediaPath embeds them only into strings
// handed to child processes, and every log line must go through Redact first.
type Connection struct {
	ID       int64
	Name     string
	Kind     string
	URL      string
	Username string
	Password string
}

// Backend is a read-only view over exactly one video source root.
type Backend interface {
	// Kind is KindLocal or KindWebDAV.
	Kind() string
	// Root is the absolute local path, or the slash-separated remote root.
	Root() string
	// StatRoot verifies the root is reachable and is a directory.
	StatRoot(ctx context.Context) (Entry, error)
	// Walk visits every regular file below the root. Directory entries are not
	// yielded. Walk returns the first non-skippable error, or ctx.Err().
	Walk(ctx context.Context, yield func(Entry) error) error
	// List returns the immediate children (files and directories) of one path
	// below the root. An empty relPath lists the root itself.
	List(ctx context.Context, relPath string) ([]Entry, error)
	// Stat returns metadata for a single path relative to the root.
	Stat(ctx context.Context, relPath string) (Entry, error)
	// OpenRange reads bytes [start, end] inclusive. end < 0 reads to EOF. The
	// returned reader reports the byte offsets it actually serves so callers can
	// forward them to an HTTP client without buffering the whole file.
	OpenRange(ctx context.Context, relPath string, start, end int64) (RangeReader, error)
	// MediaPath is the string to hand to ffprobe/ffmpeg/mpv. It may contain
	// credentials, so it must never be logged directly.
	MediaPath(relPath string) string
}

// RangeReader streams a byte range of one file. Implementations may return fewer
// bytes than the whole file but must report the inclusive offsets they serve.
type RangeReader interface {
	io.ReadCloser
	// TotalSize is the full file size, or -1 when the backend cannot report it.
	TotalSize() int64
	// RangeStart and RangeEnd are the inclusive offsets this reader returns.
	RangeStart() int64
	RangeEnd() int64
	// ContentType is the backend-reported MIME type, or empty when unknown.
	ContentType() string
}

// IsRemote reports whether the kind requires network access.
func IsRemote(kind string) bool {
	return NormalizeKind(kind) == KindWebDAV
}

// CleanRelPath normalizes a slash-separated path relative to a root. It returns
// an empty string when the input escapes the root.
func CleanRelPath(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	raw = strings.Trim(raw, "/")
	if raw == "" {
		return ""
	}
	parts := make([]string, 0, 8)
	for _, part := range strings.Split(raw, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) == 0 {
				return ""
			}
			parts = parts[:len(parts)-1]
		default:
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, "/")
}

// NormalizeRemotePath canonicalizes a remote root path: always slash separated,
// always starting with "/", never ending with "/" (except the bare root "/").
func NormalizeRemotePath(raw string) string {
	cleaned := CleanRelPath(raw)
	if cleaned == "" {
		return "/"
	}
	return "/" + cleaned
}

// JoinRemotePath joins a canonical remote root with a relative path.
func JoinRemotePath(root, relPath string) string {
	root = NormalizeRemotePath(root)
	rel := CleanRelPath(relPath)
	if rel == "" {
		return root
	}
	if root == "/" {
		return "/" + rel
	}
	return root + "/" + rel
}

// remoteIdentityPrefix is the scheme used by models.Directory.Path for remote
// sources: "webdav://<connectionID><remotePath>". It is unique per connection
// and can never collide with an absolute local path.
const remoteIdentityPrefix = KindWebDAV + "://"

// RemoteIdentity builds the unique Directory.Path value for a remote source.
func RemoteIdentity(connectionID int64, remotePath string) string {
	return fmt.Sprintf("%s%d%s", remoteIdentityPrefix, connectionID, NormalizeRemotePath(remotePath))
}

// ParseRemoteIdentity splits a "webdav://<connectionID><remotePath>" identity.
//
// Callers need this because a directory record exposes the identity as its Path,
// so a client that only holds the directory row may hand it back as a "directory
// path". It is not a filesystem path, but it does fully describe where the files
// live, which is exactly what the playback fallback needs.
func ParseRemoteIdentity(identity string) (connectionID int64, remotePath string, ok bool) {
	value := strings.TrimSpace(identity)
	if len(value) <= len(remoteIdentityPrefix) ||
		!strings.EqualFold(value[:len(remoteIdentityPrefix)], remoteIdentityPrefix) {
		return 0, "", false
	}
	rest := value[len(remoteIdentityPrefix):]
	separator := strings.IndexByte(rest, '/')
	if separator <= 0 {
		return 0, "", false
	}
	id, err := strconv.ParseInt(rest[:separator], 10, 64)
	if err != nil || id <= 0 {
		return 0, "", false
	}
	return id, NormalizeRemotePath(rest[separator:]), true
}

// Redact removes credentials embedded in URLs so they never reach logs.
func Redact(text string) string {
	return util.RedactURLs(text)
}

// RedactError redacts credentials inside an error message.
func RedactError(err error) error {
	return util.RedactError(err)
}

// RedactArgs redacts credentials inside a command line slice for logging.
func RedactArgs(args []string) []string {
	return util.RedactArgs(args)
}

// IsUnavailable reports whether a backend failure means the root is temporarily
// unreachable (offline server, bad credentials, deleted folder) rather than
// permanently misconfigured. Callers use it to mark a directory "missing"
// without discarding the library that was already scraped from it.
func IsUnavailable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrUnsupported) {
		return true
	}
	if util.IsPathUnavailable(err) {
		return true
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

// MissingPathError wraps ErrNotFound with the offending path (already redacted).
func MissingPathError(path string) error {
	return fmt.Errorf("%w: %s", ErrNotFound, Redact(path))
}

// videoMimeByExt covers the containers JavBoss expects to stream. Go's built-in
// mime table is platform dependent (on Windows it reads the registry), so keep an
// explicit list for the formats that matter.
var videoMimeByExt = map[string]string{
	".3g2":  "video/3gpp2",
	".3gp":  "video/3gpp",
	".asf":  "video/x-ms-asf",
	".avi":  "video/x-msvideo",
	".f4v":  "video/x-f4v",
	".flv":  "video/x-flv",
	".m2ts": "video/mp2t",
	".m4v":  "video/mp4",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".mp4":  "video/mp4",
	".mpe":  "video/mpeg",
	".mpeg": "video/mpeg",
	".mpg":  "video/mpeg",
	".mts":  "video/mp2t",
	".ogm":  "video/ogg",
	".ogv":  "video/ogg",
	".rm":   "application/vnd.rn-realmedia",
	".rmvb": "application/vnd.rn-realmedia-vbr",
	".ts":   "video/mp2t",
	".vob":  "video/dvd",
	".webm": "video/webm",
	".wmv":  "video/x-ms-wmv",
}

// MimeTypeForName returns the MIME type for a file name, falling back to the
// standard library and finally to a generic binary type.
func MimeTypeForName(name string) string {
	ext := strings.ToLower(pathExt(name))
	if mimeType, ok := videoMimeByExt[ext]; ok {
		return mimeType
	}
	return "application/octet-stream"
}

// pathExt returns the extension of a slash-separated path without importing
// path/filepath, so remote paths behave the same on every platform.
func pathExt(name string) string {
	base := name
	if idx := strings.LastIndexAny(name, "/\\"); idx >= 0 {
		base = name[idx+1:]
	}
	if idx := strings.LastIndex(base, "."); idx > 0 {
		return base[idx:]
	}
	return ""
}

// HeaderSniffSize is the number of leading bytes needed to detect a container.
const HeaderSniffSize = 4 * 204

// ReadPrefix reads up to n leading bytes of a file. It returns a short slice
// (without error) when the file is smaller than n.
func ReadPrefix(ctx context.Context, backend Backend, relPath string, n int) ([]byte, error) {
	if backend == nil || n <= 0 {
		return nil, nil
	}
	reader, err := backend.OpenRange(ctx, relPath, 0, int64(n-1))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(io.LimitReader(reader, int64(n)))
}
