package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"javboss/internal/common/logging"
)

// LocalBackend reads from an absolute path on the local filesystem, including
// rclone/FUSE mounts and SMB shares exposed as directories.
type LocalBackend struct {
	root string
}

// NewLocal creates a backend for an absolute local directory.
func NewLocal(root string) (*LocalBackend, error) {
	cleaned := filepath.Clean(strings.TrimSpace(root))
	if cleaned == "" || cleaned == "." {
		return nil, errors.New("local storage root is required")
	}
	if !filepath.IsAbs(cleaned) {
		return nil, fmt.Errorf("local storage root must be absolute: %s", cleaned)
	}
	return &LocalBackend{root: cleaned}, nil
}

func (b *LocalBackend) Kind() string { return KindLocal }

func (b *LocalBackend) Root() string { return b.root }

func (b *LocalBackend) StatRoot(ctx context.Context) (Entry, error) {
	if err := ctx.Err(); err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(b.root)
	if err != nil {
		return Entry{}, err
	}
	if !info.IsDir() {
		return Entry{}, fmt.Errorf("path %q is not a directory", b.root)
	}
	return Entry{Name: filepath.Base(b.root), IsDir: true, ModTime: info.ModTime().UTC()}, nil
}

func (b *LocalBackend) Walk(ctx context.Context, yield func(Entry) error) error {
	return filepath.WalkDir(b.root, func(candidatePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			logging.Error("walk directory entry failed, skip: root=%s path=%s err=%v", b.root, candidatePath, walkErr)
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			if errors.Is(err, fs.ErrPermission) {
				return nil
			}
			return err
		}
		relPath, relErr := b.relPathFor(candidatePath)
		if relErr != nil {
			return relErr
		}
		if relPath == "" {
			return nil
		}
		return yield(Entry{
			RelPath: relPath,
			Name:    info.Name(),
			Size:    info.Size(),
			ModTime: info.ModTime().UTC(),
		})
	})
}

func (b *LocalBackend) List(ctx context.Context, relPath string) ([]Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	full, err := b.fullPath(relPath)
	if err != nil {
		return nil, err
	}
	dirEntries, err := os.ReadDir(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, MissingPathError(full)
		}
		return nil, err
	}
	prefix := CleanRelPath(relPath)
	result := make([]Entry, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		info, infoErr := dirEntry.Info()
		if infoErr != nil {
			continue
		}
		name := dirEntry.Name()
		entryRel := name
		if prefix != "" {
			entryRel = prefix + "/" + name
		}
		result = append(result, Entry{
			RelPath: CleanRelPath(entryRel),
			Name:    name,
			Size:    info.Size(),
			ModTime: info.ModTime().UTC(),
			IsDir:   info.IsDir(),
		})
	}
	return result, nil
}

func (b *LocalBackend) Stat(ctx context.Context, relPath string) (Entry, error) {
	if err := ctx.Err(); err != nil {
		return Entry{}, err
	}
	full, err := b.fullPath(relPath)
	if err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Entry{}, MissingPathError(full)
		}
		return Entry{}, err
	}
	return Entry{
		RelPath: CleanRelPath(relPath),
		Name:    info.Name(),
		Size:    info.Size(),
		ModTime: info.ModTime().UTC(),
		IsDir:   info.IsDir(),
	}, nil
}

func (b *LocalBackend) OpenRange(ctx context.Context, relPath string, start, end int64) (RangeReader, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	full, err := b.fullPath(relPath)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, MissingPathError(full)
		}
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	if info.IsDir() {
		_ = file.Close()
		return nil, fmt.Errorf("path %q is a directory", relPath)
	}
	size := info.Size()
	resolvedStart, resolvedEnd := resolveRange(start, end, size)
	if resolvedStart > 0 {
		if _, err := file.Seek(resolvedStart, io.SeekStart); err != nil {
			_ = file.Close()
			return nil, err
		}
	}
	return &localRangeReader{
		Reader:    io.LimitReader(file, resolvedEnd-resolvedStart+1),
		closer:    file,
		size:      size,
		start:     resolvedStart,
		end:       resolvedEnd,
		mediaType: MimeTypeForName(full),
	}, nil
}

// resolveRange clamps a requested inclusive byte range to the file size.
func resolveRange(start, end, size int64) (int64, int64) {
	if size <= 0 {
		return 0, -1
	}
	if start < 0 {
		start = 0
	}
	if start >= size {
		start = size - 1
	}
	if end < 0 || end >= size {
		end = size - 1
	}
	if end < start {
		end = start
	}
	return start, end
}

type localRangeReader struct {
	io.Reader
	closer    io.Closer
	size      int64
	start     int64
	end       int64
	mediaType string
}

func (l *localRangeReader) Close() error        { return l.closer.Close() }
func (l *localRangeReader) TotalSize() int64    { return l.size }
func (l *localRangeReader) RangeStart() int64   { return l.start }
func (l *localRangeReader) RangeEnd() int64     { return l.end }
func (l *localRangeReader) ContentType() string { return l.mediaType }

// MediaPath returns the absolute local path ffprobe/ffmpeg/mpv should open.
func (b *LocalBackend) MediaPath(relPath string) string {
	rel := CleanRelPath(relPath)
	if rel == "" {
		return b.root
	}
	return filepath.Join(b.root, filepath.FromSlash(rel))
}

func (b *LocalBackend) fullPath(relPath string) (string, error) {
	rel := CleanRelPath(relPath)
	if rel == "" {
		return b.root, nil
	}
	full := filepath.Join(b.root, filepath.FromSlash(rel))
	relCheck, err := filepath.Rel(b.root, full)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path %q escapes local root", relPath)
	}
	return full, nil
}

func (b *LocalBackend) relPathFor(candidatePath string) (string, error) {
	normalized := filepath.Clean(candidatePath)
	rel, err := filepath.Rel(b.root, normalized)
	if err != nil {
		return "", err
	}
	if rel == "." || strings.HasPrefix(rel, "..") {
		return "", nil
	}
	return CleanRelPath(filepath.ToSlash(rel)), nil
}
