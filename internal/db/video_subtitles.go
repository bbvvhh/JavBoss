package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
)

// ListVideoSubtitles returns every subtitle linked to a video, newest last.
func ListVideoSubtitles(ctx context.Context, videoID int64) ([]models.VideoSubtitle, error) {
	if videoID <= 0 {
		return nil, errors.New("video id cannot be zero")
	}
	var items []models.VideoSubtitle
	if err := common.DB.WithContext(ctx).
		Where("video_id = ?", videoID).
		Order("id").
		Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list video subtitles: %w", err)
	}
	return items, nil
}

// GetVideoSubtitle loads one subtitle row by its identifier.
func GetVideoSubtitle(ctx context.Context, videoID, subtitleID int64) (*models.VideoSubtitle, error) {
	if videoID <= 0 || subtitleID <= 0 {
		return nil, errors.New("video id and subtitle id are required")
	}
	var item models.VideoSubtitle
	err := common.DB.WithContext(ctx).
		Where("id = ? AND video_id = ?", subtitleID, videoID).
		First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get video subtitle %d: %w", subtitleID, err)
	}
	return &item, nil
}

// FindVideoSubtitleBySource returns an already downloaded subtitle for the same
// provider entry, which makes a repeated download idempotent.
func FindVideoSubtitleBySource(ctx context.Context, videoID int64, sourceID string) (*models.VideoSubtitle, error) {
	sourceID = strings.TrimSpace(sourceID)
	if videoID <= 0 || sourceID == "" {
		return nil, nil
	}
	var item models.VideoSubtitle
	err := common.DB.WithContext(ctx).
		Where("video_id = ? AND source_id = ?", videoID, sourceID).
		Order("id").
		First(&item).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("find video subtitle by source: %w", err)
	}
	return &item, nil
}

// CreateVideoSubtitle inserts one subtitle row and fills its identifier.
func CreateVideoSubtitle(ctx context.Context, item *models.VideoSubtitle) error {
	if item == nil {
		return errors.New("subtitle is nil")
	}
	if item.VideoID <= 0 {
		return errors.New("video id cannot be zero")
	}
	if err := common.DB.WithContext(ctx).Create(item).Error; err != nil {
		return fmt.Errorf("create video subtitle: %w", err)
	}
	return nil
}

// DeleteVideoSubtitle removes one subtitle row. It reports whether a row was
// deleted; the on-disk file is handled by the caller.
func DeleteVideoSubtitle(ctx context.Context, videoID, subtitleID int64) (bool, error) {
	if videoID <= 0 || subtitleID <= 0 {
		return false, errors.New("video id and subtitle id are required")
	}
	res := common.DB.WithContext(ctx).
		Where("id = ? AND video_id = ?", subtitleID, videoID).
		Delete(&models.VideoSubtitle{})
	if res.Error != nil {
		return false, fmt.Errorf("delete video subtitle: %w", res.Error)
	}
	return res.RowsAffected > 0, nil
}

// CountVideoSubtitlesByVideoIDs returns how many subtitles each video owns.
func CountVideoSubtitlesByVideoIDs(ctx context.Context, videoIDs []int64) (map[int64]int, error) {
	ids := uniqueInt64s(videoIDs)
	counts := make(map[int64]int, len(ids))
	if len(ids) == 0 {
		return counts, nil
	}
	var rows []struct {
		VideoID int64 `gorm:"column:video_id"`
		Total   int   `gorm:"column:total"`
	}
	if err := common.DB.WithContext(ctx).
		Model(&models.VideoSubtitle{}).
		Select("video_id, COUNT(*) AS total").
		Where("video_id IN ?", ids).
		Group("video_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("count video subtitles: %w", err)
	}
	for _, row := range rows {
		counts[row.VideoID] = row.Total
	}
	return counts, nil
}

// SubtitleBatchTarget is one video the one-click subtitle downloader can handle.
type SubtitleBatchTarget struct {
	VideoID     int64  `gorm:"column:video_id"`
	Filename    string `gorm:"column:filename"`
	DurationSec int64  `gorm:"column:duration_sec"`
	Code        string `gorm:"column:code"`
}

// JavCodeForVideo returns the JAV code a video is linked to, or "" when the
// video has no visible JAV association yet.
func JavCodeForVideo(ctx context.Context, videoID int64) (string, error) {
	if videoID <= 0 {
		return "", errors.New("video id cannot be zero")
	}
	var rows []struct {
		Code string `gorm:"column:code"`
	}
	if err := common.DB.WithContext(ctx).
		Table("video_location").
		Select("jav.code AS code").
		Joins("JOIN jav ON jav.id = video_location.jav_id").
		Joins("JOIN directory ON directory.id = video_location.directory_id").
		Where("video_location.video_id = ?", videoID).
		Where(activeLocationWhereSQL("video_location", "directory")).
		Where("video_location.jav_id IS NOT NULL").
		Where("TRIM(COALESCE(jav.code, '')) <> ''").
		Order("video_location.id").
		Limit(1).
		Scan(&rows).Error; err != nil {
		return "", fmt.Errorf("load jav code for video %d: %w", videoID, err)
	}
	if len(rows) == 0 {
		return "", nil
	}
	return strings.TrimSpace(rows[0].Code), nil
}

// ListSubtitleBatchTargets lists every visible video that is linked to a JAV
// entry with a usable code, which is what the batch downloader searches for.
func ListSubtitleBatchTargets(ctx context.Context) ([]SubtitleBatchTarget, error) {
	var rows []SubtitleBatchTarget
	if err := common.DB.WithContext(ctx).
		Table("video_location").
		Select("video.id AS video_id, video_location.filename AS filename, video.duration_sec AS duration_sec, jav.code AS code").
		Joins("JOIN video ON video.id = video_location.video_id").
		Joins("JOIN jav ON jav.id = video_location.jav_id").
		Joins("JOIN directory ON directory.id = video_location.directory_id").
		Where(activeLocationWhereSQL("video_location", "directory")).
		Where("video_location.jav_id IS NOT NULL").
		Where("TRIM(COALESCE(jav.code, '')) <> ''").
		Order("video.id, video_location.id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list subtitle batch targets: %w", err)
	}

	seen := make(map[int64]struct{}, len(rows))
	targets := make([]SubtitleBatchTarget, 0, len(rows))
	for _, row := range rows {
		if row.VideoID <= 0 {
			continue
		}
		if _, ok := seen[row.VideoID]; ok {
			continue
		}
		seen[row.VideoID] = struct{}{}
		targets = append(targets, row)
	}
	return targets, nil
}
