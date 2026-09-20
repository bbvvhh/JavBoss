package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"
	"javboss/internal/storage"

	"gorm.io/gorm"
)

func normalizeDirectoryPath(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", errors.New("directory path cannot be empty")
	}
	cleaned := filepath.Clean(p)
	if !filepath.IsAbs(cleaned) {
		abs, err := filepath.Abs(cleaned)
		if err != nil {
			return "", fmt.Errorf("resolve directory: %w", err)
		}
		cleaned = abs
	}
	if info, err := os.Stat(cleaned); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("directory %q does not exist", cleaned)
		}
		return "", fmt.Errorf("stat directory: %w", err)
	} else if !info.IsDir() {
		return "", fmt.Errorf("path %q is not a directory", cleaned)
	}
	return cleaned, nil
}

// ListDirectories returns all directories regardless of status.
func ListDirectories(ctx context.Context) ([]models.Directory, error) {
	var dirs []models.Directory
	if err := common.DB.WithContext(ctx).
		Model(&models.Directory{}).
		Select(`directory.*,
			COUNT(video_location.id) AS scanned_video_count,
			COALESCE(SUM(CASE WHEN video_location.jav_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS scraped_video_count`).
		Joins(`LEFT JOIN video_location
			ON video_location.directory_id = directory.id
			AND COALESCE(video_location.is_delete, 0) = 0`).
		Group("directory.id").
		Order("directory.id").
		Find(&dirs).Error; err != nil {
		return nil, fmt.Errorf("list directories: %w", err)
	}
	return dirs, nil
}

// ListActiveDirectories returns directories that are not marked as deleted.
func ListActiveDirectories(ctx context.Context) ([]models.Directory, error) {
	var dirs []models.Directory
	if err := common.DB.WithContext(ctx).
		Where("COALESCE(is_delete, 0) = 0").
		Order("id").
		Find(&dirs).Error; err != nil {
		return nil, fmt.Errorf("list active directories: %w", err)
	}
	return dirs, nil
}

// GetDirectory fetches a single directory by id.
func GetDirectory(ctx context.Context, id int64) (*models.Directory, error) {
	if id == 0 {
		return nil, errors.New("directory id cannot be zero")
	}
	var dir models.Directory
	if err := common.DB.WithContext(ctx).First(&dir, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get directory: %w", err)
	}
	return &dir, nil
}

// DirectorySource describes where a directory reads its files from.
//
// For local directories Path is an absolute filesystem path. For remote
// directories Path is the collection path below the connection endpoint.
type DirectorySource struct {
	Kind         string
	Path         string
	ConnectionID *int64
}

// ResolveDirectorySource validates a source and returns the directory columns to
// persist. Remote sources must reference an existing storage connection. This
// function only reads the database; reachability is checked by the caller.
func ResolveDirectorySource(ctx context.Context, source DirectorySource) (*models.Directory, error) {
	switch storage.NormalizeKind(source.Kind) {
	case storage.KindWebDAV:
		if source.ConnectionID == nil || *source.ConnectionID <= 0 {
			return nil, errors.New("a remote directory requires a storage connection")
		}
		// Guard against a client sending the synthetic identity Path
		// ("webdav://<id>/x") back as the remote path. Persisting it would create
		// a nonsense remote folder and hide every existing location on the next
		// scan, so reject it outright.
		if strings.Contains(source.Path, "://") {
			return nil, errors.New("remote path must be a collection path, not a URL")
		}
		connection, err := GetStorageConnection(ctx, *source.ConnectionID)
		if err != nil {
			return nil, err
		}
		if connection == nil {
			return nil, ErrStorageConnectionNotFound
		}
		remotePath := storage.NormalizeRemotePath(source.Path)
		connectionID := *source.ConnectionID
		return &models.Directory{
			Path:         directoryRemoteIdentity(connectionID, remotePath),
			Kind:         storage.KindWebDAV,
			ConnectionID: &connectionID,
			RemotePath:   remotePath,
		}, nil
	default:
		normalized, err := normalizeDirectoryPath(source.Path)
		if err != nil {
			return nil, err
		}
		return &models.Directory{
			Path:         normalized,
			Kind:         storage.KindLocal,
			ConnectionID: nil,
			RemotePath:   "",
		}, nil
	}
}

// directoryRemoteIdentity is the unique Path stored for a remote directory.
// The scheme keeps it distinct from any absolute local path.
func directoryRemoteIdentity(connectionID int64, remotePath string) string {
	return storage.RemoteIdentity(connectionID, remotePath)
}

// CreateDirectoryFromSource registers a new directory from a validated source.
func CreateDirectoryFromSource(ctx context.Context, source DirectorySource) (*models.Directory, error) {
	resolved, err := ResolveDirectorySource(ctx, source)
	if err != nil {
		return nil, err
	}

	var existing models.Directory
	err = common.DB.WithContext(ctx).Where("path = ?", resolved.Path).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("create directory: %w", err)
	}

	// If directory exists but was soft-deleted, restore it instead of inserting a new row.
	if err == nil {
		if existing.IsDelete {
			return updateDirectoryWithVisibility(ctx, existing.ID, func(tx *gorm.DB, dir *models.Directory) error {
				applyDirectorySource(dir, resolved)
				dir.IsDelete = false
				dir.Missing = false
				dir.Enabled = true
				return nil
			})
		}
		return nil, fmt.Errorf("directory %q already exists", resolved.Path)
	}

	dir := *resolved
	if err := common.DB.WithContext(ctx).Create(&dir).Error; err != nil {
		return nil, fmt.Errorf("create directory: %w", err)
	}
	return &dir, nil
}

// applyDirectorySource copies resolved storage columns onto a directory row.
func applyDirectorySource(dir *models.Directory, resolved *models.Directory) {
	dir.Path = resolved.Path
	dir.Kind = resolved.Kind
	dir.ConnectionID = resolved.ConnectionID
	dir.RemotePath = resolved.RemotePath
}

// CreateDirectory registers a new local directory.
func CreateDirectory(ctx context.Context, path string) (*models.Directory, error) {
	return CreateDirectoryFromSource(ctx, DirectorySource{Kind: storage.KindLocal, Path: path})
}

// UpdateDirectory patches a local directory's path, deletion flag and enabled flag.
func UpdateDirectory(ctx context.Context, id int64, path *string, isDelete *bool, enabled *bool) (*models.Directory, error) {
	if path == nil {
		return UpdateDirectorySource(ctx, id, nil, isDelete, enabled)
	}
	source := DirectorySource{Kind: storage.KindLocal, Path: *path}
	return UpdateDirectorySource(ctx, id, &source, isDelete, enabled)
}

// UpdateDirectorySource updates a directory. A nil source leaves storage columns
// untouched.
//
// Switching the source never hides the directory's existing video locations:
// the follow-up scan reconciles them, so a temporarily unreachable remote root
// cannot blank out an already scraped library. This is what makes an in-place
// local -> WebDAV switch seamless.
func UpdateDirectorySource(
	ctx context.Context,
	id int64,
	source *DirectorySource,
	isDelete *bool,
	enabled *bool,
) (*models.Directory, error) {
	var resolved *models.Directory
	if source != nil {
		var err error
		resolved, err = ResolveDirectorySource(ctx, *source)
		if err != nil {
			return nil, err
		}
	}

	return updateDirectoryWithVisibility(ctx, id, func(tx *gorm.DB, dir *models.Directory) error {
		if resolved != nil {
			sourceChanged := dir.Path != resolved.Path ||
				dir.StorageKind() != resolved.Kind ||
				dir.RemotePath != resolved.RemotePath ||
				!sameConnectionID(dir.ConnectionID, resolved.ConnectionID)
			if dir.Path != resolved.Path {
				var other models.Directory
				if err := tx.Where("path = ?", resolved.Path).First(&other).Error; err != nil {
					if !errors.Is(err, gorm.ErrRecordNotFound) {
						return fmt.Errorf("lookup conflicting directory: %w", err)
					}
				} else if other.ID != dir.ID {
					if other.IsDelete {
						// Restore the soft-deleted record (other) and mark current dir as deleted instead.
						if err := tx.Model(&models.Directory{}).
							Where("id = ?", other.ID).
							Updates(map[string]any{"is_delete": false, "missing": false}).Error; err != nil {
							return fmt.Errorf("restore deleted directory: %w", err)
						}
						dir.IsDelete = true
						// Keep dir.Path unchanged to avoid uniqueness conflict; caller attempted to reuse other's path.
						resolved.Path = dir.Path
					} else {
						return fmt.Errorf("directory %q already exists", resolved.Path)
					}
				}
			}
			applyDirectorySource(dir, resolved)
			if sourceChanged {
				dir.Missing = false
			}
		}
		if isDelete != nil {
			dir.IsDelete = *isDelete
		}
		if enabled != nil {
			dir.Enabled = *enabled
		}
		return nil
	})
}

func sameConnectionID(left, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// UpdateDirectoryScanSettings updates only automatic-scan fields. The targeted update is safe to
// run while a scan is active because it cannot overwrite scan state or the latest scan summary.
func UpdateDirectoryScanSettings(
	ctx context.Context,
	id int64,
	autoScanEnabled *bool,
	autoScanIntervalMinutes *int,
) (*models.Directory, error) {
	if id <= 0 {
		return nil, errors.New("directory id cannot be zero")
	}
	updates := map[string]any{}
	if autoScanEnabled != nil {
		updates["auto_scan_enabled"] = *autoScanEnabled
	}
	if autoScanIntervalMinutes != nil {
		if *autoScanIntervalMinutes <= 0 {
			return nil, errors.New("automatic scan interval must be positive")
		}
		updates["auto_scan_interval_minutes"] = *autoScanIntervalMinutes
	}
	if len(updates) > 0 {
		result := common.DB.WithContext(ctx).
			Model(&models.Directory{}).
			Where("id = ?", id).
			Updates(updates)
		if result.Error != nil {
			return nil, fmt.Errorf("update directory scan settings: %w", result.Error)
		}
	}
	return GetDirectory(ctx, id)
}

// SetDirectoryMissing updates whether a directory is temporarily unavailable.
// Missing directories and their videos remain visible until explicitly deleted.
func SetDirectoryMissing(ctx context.Context, id int64, missing bool) error {
	if id <= 0 {
		return errors.New("directory id cannot be zero")
	}
	if err := common.DB.WithContext(ctx).
		Model(&models.Directory{}).
		Where("id = ?", id).
		Update("missing", missing).Error; err != nil {
		return fmt.Errorf("update directory missing status: %w", err)
	}
	return nil
}

// UpdateDirectoryLastScanSummary stores the latest successfully completed scan result.
func UpdateDirectoryLastScanSummary(
	ctx context.Context,
	id int64,
	summary models.DirectoryScanSummary,
) error {
	if id <= 0 {
		return errors.New("directory id must be positive")
	}
	result := common.DB.WithContext(ctx).
		Model(&models.Directory{}).
		Where("id = ?", id).
		UpdateColumn("last_scan_summary", summary)
	if result.Error != nil {
		return fmt.Errorf("update directory last scan summary: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return errors.New("directory not found")
	}
	return nil
}

// SetDirectoryDeletedAndHideVideos toggles deletion flag and hides/unhides its videos.
func SetDirectoryDeletedAndHideVideos(ctx context.Context, id int64, deleted bool) (*models.Directory, error) {
	return updateDirectoryWithVisibility(ctx, id, func(tx *gorm.DB, dir *models.Directory) error {
		dir.IsDelete = deleted
		return nil
	})
}

func updateDirectoryWithVisibility(ctx context.Context, id int64, mutate func(tx *gorm.DB, dir *models.Directory) error) (*models.Directory, error) {
	if id == 0 {
		return nil, errors.New("directory id cannot be zero")
	}

	var dir models.Directory
	err := common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&dir, id).Error; err != nil {
			return err
		}

		if mutate != nil {
			if err := mutate(tx, &dir); err != nil {
				return err
			}
		}

		if err := tx.Save(&dir).Error; err != nil {
			return fmt.Errorf("update directory: %w", err)
		}

		return nil
	})

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &dir, nil
}

// DirectoriesByIDs returns directories matching the provided ids.
func DirectoriesByIDs(ctx context.Context, ids []int64) ([]models.Directory, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var dirs []models.Directory
	if err := common.DB.WithContext(ctx).Where("id IN ?", ids).Order("id").Find(&dirs).Error; err != nil {
		return nil, fmt.Errorf("list directories by ids: %w", err)
	}
	return dirs, nil
}
