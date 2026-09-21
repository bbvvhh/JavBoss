package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/mpv"
	"javboss/internal/subtitle"
)

// SubtitleSettingsKey is the config key holding the user configured search
// endpoint. An empty value falls back to the built-in Xunlei endpoint.
const SubtitleSettingsKey = "subtitle_api_url"

// ErrSubtitleStorageUnavailable is returned when JavBoss' data directory is unknown.
var ErrSubtitleStorageUnavailable = errors.New("subtitle storage is unavailable")

// SubtitleDownloadRequest describes one subtitle to fetch and store.
type SubtitleDownloadRequest struct {
	URL        string
	Name       string
	Ext        string
	Language   string
	DurationMS int64
	SourceID   string
	Auto       bool
}

// SubtitleDataDir returns the JavBoss data directory holding downloaded subtitles.
func SubtitleDataDir() (string, error) {
	if common.AppConfig == nil || strings.TrimSpace(common.AppConfig.DatabasePath) == "" {
		return "", ErrSubtitleStorageUnavailable
	}
	return filepath.Dir(common.AppConfig.DatabasePath), nil
}

// ConfiguredSubtitleAPIURL reads the search endpoint from the config table.
func ConfiguredSubtitleAPIURL(ctx context.Context) string {
	cfg, err := dbpkg.ListConfig(ctx)
	if err != nil {
		logging.Error("load subtitle api url failed: %v", err)
		return subtitle.DefaultAPIURL
	}
	return subtitle.NormalizeAPIURL(cfg[SubtitleSettingsKey])
}

// SubtitleFilePath resolves the on-disk path of a stored subtitle.
func SubtitleFilePath(videoID int64, filename string) (string, error) {
	dataDir, err := SubtitleDataDir()
	if err != nil {
		return "", err
	}
	path := subtitle.FilePath(dataDir, videoID, filename)
	if path == "" {
		return "", errors.New("subtitle file name is invalid")
	}
	return path, nil
}

// DownloadAndStoreVideoSubtitle downloads one provider result into JavBoss'
// subtitle directory and links it to the video. Downloading the same provider
// entry twice is a no-op and returns the stored row.
func DownloadAndStoreVideoSubtitle(ctx context.Context, videoID int64, req SubtitleDownloadRequest) (*models.VideoSubtitle, bool, error) {
	if videoID <= 0 {
		return nil, false, errors.New("video id cannot be zero")
	}
	if strings.TrimSpace(req.URL) == "" {
		return nil, false, errors.New("subtitle url is required")
	}
	if existing, err := dbpkg.FindVideoSubtitleBySource(ctx, videoID, req.SourceID); err != nil {
		return nil, false, err
	} else if existing != nil {
		if _, statErr := SubtitleFilePath(videoID, existing.Filename); statErr == nil {
			return existing, true, nil
		}
	}

	dataDir, err := SubtitleDataDir()
	if err != nil {
		return nil, false, err
	}
	dir := subtitle.Dir(dataDir, videoID)
	if dir == "" {
		return nil, false, ErrSubtitleStorageUnavailable
	}

	data, err := subtitle.Download(ctx, req.URL)
	if err != nil {
		return nil, false, err
	}
	format := subtitle.DetectFormat(req.Name, data)
	if !subtitle.SupportedExtension(format) {
		return nil, false, fmt.Errorf("%w: %s", subtitle.ErrUnsupportedFormat, format)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, false, fmt.Errorf("create subtitle directory: %w", err)
	}

	base := req.Name
	if strings.TrimSpace(base) == "" {
		base = filepath.Base(req.URL)
	}
	filename, err := subtitle.AllocateFilename(dir, base, format, req.SourceID)
	if err != nil {
		return nil, false, err
	}
	targetPath := filepath.Join(dir, filename)
	if err := writeSubtitleFile(targetPath, data); err != nil {
		return nil, false, err
	}

	item := &models.VideoSubtitle{
		VideoID:    videoID,
		Filename:   filename,
		Title:      strings.TrimSpace(req.Name),
		Language:   strings.TrimSpace(req.Language),
		Format:     format,
		DurationMS: req.DurationMS,
		Size:       int64(len(data)),
		Auto:       req.Auto,
		SourceID:   strings.TrimSpace(req.SourceID),
		SourceURL:  strings.TrimSpace(req.URL),
	}
	if err := dbpkg.CreateVideoSubtitle(ctx, item); err != nil {
		_ = os.Remove(targetPath)
		return nil, false, err
	}
	return item, false, nil
}

func writeSubtitleFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".javboss-subtitle-*")
	if err != nil {
		return fmt.Errorf("create subtitle temp file: %w", err)
	}
	tempPath := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}
	if _, err := temp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("write subtitle file: %w", err)
	}
	if err := temp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("sync subtitle file: %w", err)
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close subtitle file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("install subtitle file: %w", err)
	}
	return nil
}

// DeleteStoredVideoSubtitle removes both the database row and the file. Only
// files inside JavBoss' subtitle directory are ever deleted.
func DeleteStoredVideoSubtitle(ctx context.Context, videoID, subtitleID int64) (bool, error) {
	item, err := dbpkg.GetVideoSubtitle(ctx, videoID, subtitleID)
	if err != nil {
		return false, err
	}
	if item == nil {
		return false, nil
	}
	deleted, err := dbpkg.DeleteVideoSubtitle(ctx, videoID, subtitleID)
	if err != nil {
		return false, err
	}
	if path, pathErr := SubtitleFilePath(videoID, item.Filename); pathErr == nil {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			logging.Error("remove subtitle file failed (video_id=%d, subtitle_id=%d): %v", videoID, subtitleID, err)
		}
	}
	return deleted, nil
}

// AttachSubtitleToPlayer pushes one stored subtitle into the running mpv window
// and selects it. Playback of the file itself is mpv's own job: mpv renders
// srt/ass/vtt natively, so no conversion is involved here.
func AttachSubtitleToPlayer(ctx context.Context, videoID, subtitleID int64) error {
	item, err := dbpkg.GetVideoSubtitle(ctx, videoID, subtitleID)
	if err != nil {
		return err
	}
	if item == nil {
		return errors.New("subtitle does not exist")
	}
	path, err := SubtitleFilePath(videoID, item.Filename)
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("subtitle file is unavailable: %w", err)
	}
	return mpv.LoadSubtitleFile(path)
}

// AttachSubtitleToPlayerIfPlaying attaches a subtitle only when the reusable mpv
// window is playing that exact video right now.
func AttachSubtitleToPlayerIfPlaying(ctx context.Context, videoID, subtitleID int64) (bool, error) {
	if !mpv.ReusablePlayerRunning() {
		return false, nil
	}
	video, err := dbpkg.GetVideo(ctx, videoID)
	if err != nil || video == nil {
		return false, err
	}
	media, err := ResolveVideoMedia(ctx, video)
	if err != nil {
		return false, err
	}
	if !mpv.IsPlayingMedia(media.Path) {
		return false, nil
	}
	if err := AttachSubtitleToPlayer(ctx, videoID, subtitleID); err != nil {
		return false, err
	}
	return true, nil
}

// DisablePlayerSubtitles turns subtitle rendering off in the running mpv window.
func DisablePlayerSubtitles() error {
	return mpv.DisableSubtitles()
}
