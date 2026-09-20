package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"javboss/internal/db"
	"javboss/internal/manager"
	"javboss/internal/models"
	"javboss/internal/storage"
)

// DirectoryBackend builds the read-only storage backend for one directory,
// loading the WebDAV connection record when the directory is remote.
func DirectoryBackend(ctx context.Context, dir models.Directory) (storage.Backend, error) {
	switch dir.StorageKind() {
	case storage.KindWebDAV:
		connection, err := loadDirectoryConnection(ctx, dir)
		if err != nil {
			return nil, err
		}
		return storage.NewWebDAV(connection, dir.RemotePath)
	default:
		if strings.TrimSpace(dir.Path) == "" {
			return nil, errors.New("directory path is empty")
		}
		return storage.NewLocal(dir.Path)
	}
}

// LocationBackend resolves the backend and root-relative path of one video location.
func LocationBackend(ctx context.Context, loc *models.VideoLocation) (storage.Backend, string, error) {
	if loc == nil {
		return nil, "", errors.New("video location is nil")
	}
	backend, err := DirectoryBackend(ctx, loc.DirectoryRef)
	if err != nil {
		return nil, "", err
	}
	return backend, storage.CleanRelPath(loc.RelativePath), nil
}

// LocationMediaPath returns the string ffprobe/ffmpeg/mpv should open for one
// video location: an absolute local path, or a credentialed URL for WebDAV.
//
// The returned value may contain credentials and must not be logged directly;
// pass it through storage.Redact first.
func LocationMediaPath(ctx context.Context, loc *models.VideoLocation) (string, error) {
	backend, relPath, err := LocationBackend(ctx, loc)
	if err != nil {
		return "", err
	}
	return backend.MediaPath(relPath), nil
}

// ResolveVideoMedia implements manager.MediaResolver so the screenshot manager
// can read remote videos without importing this package.
func ResolveVideoMedia(ctx context.Context, video *models.Video) (manager.ResolvedMedia, error) {
	loc := primaryLocation(video)
	if loc == nil {
		return manager.ResolvedMedia{}, errors.New("video location missing")
	}
	mediaPath, err := LocationMediaPath(ctx, loc)
	if err != nil {
		return manager.ResolvedMedia{}, err
	}
	return manager.ResolvedMedia{Path: mediaPath, Remote: loc.DirectoryRef.IsRemote()}, nil
}

func primaryLocation(video *models.Video) *models.VideoLocation {
	if video == nil || len(video.Locations) == 0 {
		return nil
	}
	for i := range video.Locations {
		if !video.Locations[i].IsDelete {
			return &video.Locations[i]
		}
	}
	return &video.Locations[0]
}

func loadDirectoryConnection(ctx context.Context, dir models.Directory) (storage.Connection, error) {
	if dir.ConnectionID == nil || *dir.ConnectionID <= 0 {
		return storage.Connection{}, fmt.Errorf("directory %d has no storage connection", dir.ID)
	}
	record, err := db.GetStorageConnection(ctx, *dir.ConnectionID)
	if err != nil {
		return storage.Connection{}, err
	}
	if record == nil {
		return storage.Connection{}, fmt.Errorf("storage connection %d no longer exists", *dir.ConnectionID)
	}
	return storage.Connection{
		ID:       record.ID,
		Name:     record.Name,
		Kind:     storage.KindWebDAV,
		URL:      record.URL,
		Username: record.Username,
		Password: record.Password,
	}, nil
}

// IsRemoteMediaError reports whether a failure came from the remote endpoint
// rather than from the local filesystem.
func IsRemoteMediaError(err error) bool {
	return errors.Is(err, storage.ErrUnauthorized) || errors.Is(err, storage.ErrUnsupported)
}
