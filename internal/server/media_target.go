package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/service"
	"javboss/internal/storage"
)

// noWriteDeadline disables the response write deadline for long media streams.
var noWriteDeadline = time.Time{}

// mediaTarget describes how to read one video file, whether it lives on the
// local filesystem or on a remote storage backend.
//
// MediaPath is what ffprobe/ffmpeg/mpv must open. For remote targets it contains
// credentials, so it must never be logged directly: pass it through
// storage.Redact first.
type mediaTarget struct {
	Location  *models.VideoLocation
	Backend   storage.Backend
	RelPath   string
	MediaPath string
	Remote    bool
}

// mediaTargetFromLocation resolves the storage backend and relative path of a
// video location that was loaded with its DirectoryRef.
func mediaTargetFromLocation(ctx context.Context, loc *models.VideoLocation) (*mediaTarget, error) {
	backend, relPath, err := service.LocationBackend(ctx, loc)
	if err != nil {
		return nil, err
	}
	return &mediaTarget{
		Location:  loc,
		Backend:   backend,
		RelPath:   relPath,
		MediaPath: backend.MediaPath(relPath),
		Remote:    loc.DirectoryRef.IsRemote(),
	}, nil
}

// mediaTargetFromRequest resolves a playback request.
//
// A location id is authoritative: it is the only identifier that stays valid for
// remote directories, where "dir_path" is a synthetic identity rather than a
// filesystem path. Only when no location id resolves do we fall back to the
// legacy path/dir_path pair, and that fallback also understands a remote
// identity so older clients keep working.
func mediaTargetFromRequest(ctx context.Context, req videoPathRequest) (*mediaTarget, error) {
	if req.VideoID > 0 && req.LocationID > 0 {
		loc, err := dbpkg.GetActiveVideoLocation(ctx, req.VideoID, req.LocationID)
		if err != nil {
			return nil, err
		}
		if loc != nil {
			return mediaTargetFromLocation(ctx, loc)
		}
	}

	if connectionID, remoteRoot, ok := storage.ParseRemoteIdentity(req.DirPath); ok {
		return mediaTargetFromRemoteIdentity(ctx, connectionID, remoteRoot, req.Path)
	}

	fullPath, _, err := resolveVideoPath(req.Path, req.DirPath)
	if err != nil {
		return nil, err
	}
	return &mediaTarget{MediaPath: fullPath}, nil
}

// mediaTargetFromRemoteIdentity builds a target from a "webdav://<id><path>"
// directory identity plus a root-relative file path.
func mediaTargetFromRemoteIdentity(
	ctx context.Context,
	connectionID int64,
	remoteRoot string,
	relPath string,
) (*mediaTarget, error) {
	record, err := dbpkg.GetStorageConnection(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, fmt.Errorf("storage connection %d no longer exists", connectionID)
	}
	backend, err := storage.NewWebDAV(storage.Connection{
		ID:       record.ID,
		Name:     record.Name,
		Kind:     storage.KindWebDAV,
		URL:      record.URL,
		Username: record.Username,
		Password: record.Password,
	}, remoteRoot)
	if err != nil {
		return nil, err
	}
	cleanRel := storage.CleanRelPath(relPath)
	return &mediaTarget{
		Backend:   backend,
		RelPath:   cleanRel,
		MediaPath: backend.MediaPath(cleanRel),
		Remote:    true,
	}, nil
}

// ensureMediaExists verifies a target is readable before playback, returning a
// localized response when it is not.
func ensureMediaExists(c *gin.Context, target *mediaTarget) bool {
	ctx := c.Request.Context()
	if target.Remote {
		entry, err := target.Backend.Stat(ctx, target.RelPath)
		if err != nil {
			respondPlaybackError(c, err)
			return false
		}
		if entry.IsDir {
			respondLocalizedError(c, http.StatusBadRequest, "目标路径不是文件", "Path is not a file")
			return false
		}
		return true
	}
	if _, err := os.Stat(target.MediaPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			respondLocalizedError(c, http.StatusNotFound, "视频文件或所在目录不存在", "Video file or directory does not exist")
			return false
		}
		logging.Error("stat stream file error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取视频文件失败", "Failed to inspect video file")
		return false
	}
	return true
}

// respondRemoteWriteUnsupported rejects an operation that would need to modify
// files on a remote directory.
func respondRemoteWriteUnsupported(c *gin.Context, zhAction, enAction string) {
	respondLocalizedError(
		c,
		http.StatusNotImplemented,
		"当前目录是 WebDAV 远程目录，暂不支持"+zhAction,
		"This directory is a read-only WebDAV source; "+enAction+" is not supported",
	)
}

// serveRemoteMediaFile streams a remote file through the local HTTP endpoint,
// forwarding Range requests so browser seeking keeps working. Credentials never
// leave the process.
func serveRemoteMediaFile(c *gin.Context, target *mediaTarget) {
	ctx := c.Request.Context()
	if target.Backend == nil {
		respondLocalizedError(c, http.StatusInternalServerError, "远程存储后端不可用", "The remote storage backend is unavailable")
		return
	}

	entry, err := target.Backend.Stat(ctx, target.RelPath)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}
	if entry.IsDir {
		respondLocalizedError(c, http.StatusBadRequest, "目标路径不是文件", "Path is not a file")
		return
	}

	start, end := int64(0), int64(-1)
	status := http.StatusOK
	if header := strings.TrimSpace(c.GetHeader("Range")); header != "" {
		parsedStart, parsedEnd, ok := parseByteRange(header, entry.Size)
		if !ok {
			c.Header("Content-Range", fmt.Sprintf("bytes */%d", entry.Size))
			c.Status(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		start, end = parsedStart, parsedEnd
		status = http.StatusPartialContent
	}

	reader, err := target.Backend.OpenRange(ctx, target.RelPath, start, end)
	if err != nil {
		respondPlaybackError(c, err)
		return
	}
	defer reader.Close()

	total := reader.TotalSize()
	if total < 0 {
		total = entry.Size
	}
	contentType := reader.ContentType()
	if contentType == "" {
		contentType = storage.MimeTypeForName(entry.Name)
	}
	rangeStart, rangeEnd := reader.RangeStart(), reader.RangeEnd()
	length := rangeEnd - rangeStart + 1
	if length < 0 {
		length = 0
	}

	if err := http.NewResponseController(c.Writer).SetWriteDeadline(noWriteDeadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
		logging.Error("disable remote stream write deadline error: %v", err)
	}
	c.Header("Accept-Ranges", "bytes")
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(length, 10))
	if status == http.StatusPartialContent {
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", rangeStart, rangeEnd, total))
	}
	c.Status(status)
	if c.Request.Method == http.MethodHead {
		return
	}
	if _, err := io.Copy(c.Writer, reader); err != nil && !errors.Is(err, context.Canceled) {
		logging.Error("stream remote media failed: path=%s err=%v", storage.Redact(target.MediaPath), storage.RedactError(err))
	}
}

// parseByteRange parses a single-range "bytes=" header against a known size and
// returns inclusive offsets. Ok is false for unsatisfiable or multi-range input.
func parseByteRange(header string, size int64) (int64, int64, bool) {
	value := strings.TrimSpace(header)
	if !strings.HasPrefix(strings.ToLower(value), "bytes=") {
		return 0, 0, false
	}
	value = strings.TrimSpace(value[len("bytes="):])
	if strings.Contains(value, ",") {
		return 0, 0, false
	}
	startPart, endPart, ok := strings.Cut(value, "-")
	if !ok {
		return 0, 0, false
	}
	startPart, endPart = strings.TrimSpace(startPart), strings.TrimSpace(endPart)

	// Suffix range: bytes=-500 means the last 500 bytes.
	if startPart == "" {
		suffix, err := strconv.ParseInt(endPart, 10, 64)
		if err != nil || suffix <= 0 || size <= 0 {
			return 0, 0, false
		}
		if suffix > size {
			suffix = size
		}
		return size - suffix, size - 1, true
	}

	start, err := strconv.ParseInt(startPart, 10, 64)
	if err != nil || start < 0 || (size > 0 && start >= size) {
		return 0, 0, false
	}
	if endPart == "" {
		return start, size - 1, true
	}
	end, err := strconv.ParseInt(endPart, 10, 64)
	if err != nil || end < start {
		return 0, 0, false
	}
	if size > 0 && end >= size {
		end = size - 1
	}
	return start, end, true
}
