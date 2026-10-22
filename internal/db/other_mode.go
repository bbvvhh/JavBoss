package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"
)

// OtherFolder describes one child folder inside a browsed other-mode path.
// Path is the value to pass back as the `path` argument to drill one level down.
type OtherFolder struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	VideoCount int64  `json:"video_count"`
}

// ListOtherDirectories returns the active directories that belong to the other mode.
// The returned rows carry the usual scanned/scraped counts so the UI can render
// folder tiles the same way it renders directories elsewhere.
func ListOtherDirectories(ctx context.Context) ([]models.Directory, error) {
	var dirs []models.Directory
	if err := common.DB.WithContext(ctx).
		Model(&models.Directory{}).
		Select(`directory.*,
			COUNT(video_location.id) AS scanned_video_count,
			COALESCE(SUM(CASE WHEN video_location.jav_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS scraped_video_count`).
		Joins(`LEFT JOIN video_location
			ON video_location.directory_id = directory.id
			AND COALESCE(video_location.is_delete, 0) = 0`).
		Where("COALESCE(directory.mode, '') = ?", models.DirectoryModeOther).
		Where("COALESCE(directory.is_delete, 0) = 0").
		Group("directory.id").
		Order("directory.id").
		Find(&dirs).Error; err != nil {
		return nil, fmt.Errorf("list other directories: %w", err)
	}
	return dirs, nil
}

// ListOtherSubfolders returns the direct child folders below prefix inside an
// other-mode directory. The counts are recursive (they include deeper levels) so a
// folder tile reflects everything nested under it.
//
// Instr/substr are used instead of LIKE so folder names containing "%" or "_" are
// treated literally. prefix is normalised to a slash-separated relative path with no
// leading or trailing slashes ("" means the directory root).
func ListOtherSubfolders(ctx context.Context, directoryID int64, prefix string) ([]OtherFolder, error) {
	if directoryID <= 0 {
		return nil, errors.New("directory id cannot be zero")
	}
	prefix = normalizeBrowsePrefix(prefix)
	cut := 1 // substr is 1-based: position 1 keeps the whole path.
	boundary := ""
	top := prefix == ""
	if !top {
		cut = len(prefix) + 2
		boundary = prefix + "/"
	}

	where := `video_location.directory_id = ?
		AND COALESCE(video_location.is_delete, 0) = 0
		AND COALESCE(directory.is_delete, 0) = 0
		AND COALESCE(directory.enabled, 1) <> 0
		AND COALESCE(directory.mode, '') = '` + models.DirectoryModeOther + `'`
	args := []any{cut, directoryID}
	if !top {
		where += " AND instr(video_location.relative_path, ?) = 1"
		args = append(args, boundary)
	}

	raw := `SELECT substr(t.rem, 1, instr(t.rem, '/') - 1) AS name, COUNT(*) AS video_count
		FROM (
			SELECT substr(video_location.relative_path, ?) AS rem
			FROM video_location
			JOIN directory ON directory.id = video_location.directory_id
			WHERE ` + where + `
		) t
		WHERE instr(t.rem, '/') > 0
		GROUP BY name
		ORDER BY name`

	var folders []OtherFolder
	if err := common.DB.WithContext(ctx).Raw(raw, args...).Scan(&folders).Error; err != nil {
		return nil, fmt.Errorf("list other subfolders: %w", err)
	}
	for i := range folders {
		if top {
			folders[i].Path = folders[i].Name
		} else {
			folders[i].Path = prefix + "/" + folders[i].Name
		}
	}
	return folders, nil
}

// ListOtherModeVideos lists the direct video files under a directory + prefix.
func ListOtherModeVideos(ctx context.Context, directoryID int64, prefix string, limit, offset int, tagNames []string, search, sort string, seed *int64) ([]models.Video, error) {
	return ListVideosWithOptions(ctx, limit, offset, tagNames, search, sort, otherModeVideoOptions(directoryID, prefix, seed))
}

// CountOtherModeVideos counts the direct video files under a directory + prefix.
func CountOtherModeVideos(ctx context.Context, directoryID int64, prefix string, tagNames []string, search string) (int64, error) {
	return CountVideosWithOptions(ctx, tagNames, search, otherModeVideoOptions(directoryID, prefix, nil))
}

func otherModeVideoOptions(directoryID int64, prefix string, seed *int64) VideoQueryOptions {
	return VideoQueryOptions{
		DirectoryIDs:  []int64{directoryID},
		PathPrefix:    normalizeBrowsePrefix(prefix),
		ImmediateOnly: true,
		Seed:          seed,
	}
}

// SearchOtherModeVideos searches filenames recursively inside other-mode directories.
// directoryID > 0 scopes the search to that directory (prefix optionally narrows it to
// a subtree); directoryID == 0 searches every active other-mode directory, which is what
// the top-level search box uses. Unlike ListOtherModeVideos this never limits the depth.
func SearchOtherModeVideos(ctx context.Context, directoryID int64, prefix string, limit, offset int, search, sort string, seed *int64) ([]models.Video, error) {
	return ListVideosWithOptions(ctx, limit, offset, nil, search, sort, searchOtherModeOptions(directoryID, prefix, seed))
}

// CountSearchOtherModeVideos counts the recursive filename matches for SearchOtherModeVideos.
func CountSearchOtherModeVideos(ctx context.Context, directoryID int64, prefix, search string) (int64, error) {
	return CountVideosWithOptions(ctx, nil, search, searchOtherModeOptions(directoryID, prefix, nil))
}

// OtherSearchFolder is a folder whose own name matches an other-mode keyword search.
// DirectoryID tells the UI which other-mode directory the path belongs to, so a result
// can be opened directly even when the search spans every directory.
type OtherSearchFolder struct {
	DirectoryID int64  `json:"directory_id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	VideoCount  int64  `json:"video_count"`
}

// SearchOtherModeFolders walks every folder segment of the active other-mode video paths
// and returns folders whose leaf name contains search. directoryID > 0 restricts the walk
// to that directory, prefix narrows it to a subtree; 0 searches all other-mode directories.
//
// The walk is done with a recursive CTE so only matching rows leave SQLite. instr/lower
// are used instead of LIKE so "%" and "_" in names are treated literally. Results are
// capped because folders are not paginated (videos are).
func SearchOtherModeFolders(ctx context.Context, directoryID int64, prefix, search string) ([]OtherSearchFolder, error) {
	search = strings.TrimSpace(search)
	if search == "" {
		return nil, nil
	}
	prefix = normalizeBrowsePrefix(prefix)

	where := `COALESCE(video_location.is_delete, 0) = 0
		AND COALESCE(directory.is_delete, 0) = 0
		AND COALESCE(directory.enabled, 1) <> 0
		AND COALESCE(directory.mode, '') = '` + models.DirectoryModeOther + `'`
	args := []any{}
	if directoryID > 0 {
		where += " AND video_location.directory_id = ?"
		args = append(args, directoryID)
	}
	if prefix != "" {
		where += " AND instr(video_location.relative_path, ?) = 1"
		args = append(args, prefix+"/")
	}
	args = append(args, search)

	raw := `WITH RECURSIVE seed(directory_id, relative_path) AS (
			SELECT video_location.directory_id, video_location.relative_path
			FROM video_location
			JOIN directory ON directory.id = video_location.directory_id
			WHERE ` + where + `
		), parts(directory_id, rest, prefix, name) AS (
			SELECT directory_id, relative_path, '', '' FROM seed
			UNION ALL
			SELECT p.directory_id,
				substr(p.rest, instr(p.rest, '/') + 1),
				CASE WHEN p.prefix = '' THEN substr(p.rest, 1, instr(p.rest, '/') - 1)
					ELSE p.prefix || '/' || substr(p.rest, 1, instr(p.rest, '/') - 1) END,
				substr(p.rest, 1, instr(p.rest, '/') - 1)
			FROM parts p
			WHERE instr(p.rest, '/') > 0
		)
		SELECT DISTINCT p.directory_id, p.prefix AS path, p.name,
			(SELECT COUNT(*)
				FROM video_location v
				WHERE v.directory_id = p.directory_id
					AND COALESCE(v.is_delete, 0) = 0
					AND instr(v.relative_path, p.prefix || '/') = 1) AS video_count
		FROM parts p
		WHERE p.prefix <> '' AND instr(lower(p.name), lower(?)) > 0
		ORDER BY p.name, p.directory_id, path
		LIMIT 200`

	var folders []OtherSearchFolder
	if err := common.DB.WithContext(ctx).Raw(raw, args...).Scan(&folders).Error; err != nil {
		return nil, fmt.Errorf("search other mode folders: %w", err)
	}
	return folders, nil
}

func searchOtherModeOptions(directoryID int64, prefix string, seed *int64) VideoQueryOptions {
	opts := VideoQueryOptions{
		IncludeMode:   models.DirectoryModeOther,
		PathPrefix:    normalizeBrowsePrefix(prefix),
		ImmediateOnly: false,
		Seed:          seed,
	}
	if directoryID > 0 {
		opts.DirectoryIDs = []int64{directoryID}
	}
	return opts
}

// ListOtherModeTags returns the tag counts scoped to a single other-mode directory.
// The directory id already pins the scope, so no mode exclusion is needed.
func ListOtherModeTags(ctx context.Context, directoryID int64) ([]TagCount, error) {
	if directoryID <= 0 {
		return nil, errors.New("directory id cannot be zero")
	}
	return ListTags(ctx, []int64{directoryID}, "")
}
