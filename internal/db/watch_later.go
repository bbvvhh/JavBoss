package db

import (
	"context"
	"errors"
	"fmt"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AddWatchLater 把视频加入「稍后观看」。重复加入是幂等的：已存在时保留首次加入时间，
// 列表顺序因此不会因为反复点按而跳动。
func AddWatchLater(ctx context.Context, videoID int64) error {
	if videoID <= 0 {
		return errors.New("video id cannot be zero")
	}
	record := models.WatchLater{VideoID: videoID}
	err := common.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "video_id"}},
			DoNothing: true,
		}).
		Create(&record).Error
	if err != nil {
		return fmt.Errorf("add watch later for video %d: %w", videoID, err)
	}
	return nil
}

// RemoveWatchLater 把视频移出「稍后观看」；不在列表里时不做任何事（幂等）。
func RemoveWatchLater(ctx context.Context, videoID int64) error {
	if videoID <= 0 {
		return errors.New("video id cannot be zero")
	}
	if err := common.DB.WithContext(ctx).
		Where("video_id = ?", videoID).
		Delete(&models.WatchLater{}).Error; err != nil {
		return fmt.Errorf("remove watch later for video %d: %w", videoID, err)
	}
	return nil
}

// IsInWatchLater 报告某个视频是否在「稍后观看」列表里。
func IsInWatchLater(ctx context.Context, videoID int64) (bool, error) {
	if videoID <= 0 {
		return false, nil
	}
	var count int64
	if err := common.DB.WithContext(ctx).
		Model(&models.WatchLater{}).
		Where("video_id = ?", videoID).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("check watch later for video %d: %w", videoID, err)
	}
	return count > 0, nil
}

// ListWatchLater 按加入时间倒序返回「稍后观看」列表，并带上视频展示载荷。
// 只返回仍然存在有效文件位置的视频，已被隐藏/移除的视频不会出现在列表里。
func ListWatchLater(ctx context.Context, limit, offset int) ([]models.WatchLaterItem, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var records []models.WatchLater
	if err := common.DB.WithContext(ctx).
		Model(&models.WatchLater{}).
		Where("EXISTS (?)", activeWatchLaterLocationSubquery(ctx)).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Offset(offset).
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list watch later: %w", err)
	}
	if len(records) == 0 {
		return []models.WatchLaterItem{}, nil
	}

	videoIDs := make([]int64, 0, len(records))
	for _, record := range records {
		videoIDs = append(videoIDs, record.VideoID)
	}
	videos, err := activeVideosForIDs(ctx, videoIDs)
	if err != nil {
		return nil, err
	}

	items := make([]models.WatchLaterItem, 0, len(records))
	for _, record := range records {
		video, ok := videos[record.VideoID]
		if !ok {
			// 视频已没有有效位置（并发隐藏/删除），跳过这一行。
			continue
		}
		items = append(items, models.WatchLaterItem{
			VideoID:   record.VideoID,
			CreatedAt: record.CreatedAt,
			Video:     video,
		})
	}
	return items, nil
}

// CountWatchLater 统计仍然有效的稍后观看条数，语义与 ListWatchLater 保持一致。
func CountWatchLater(ctx context.Context) (int64, error) {
	var count int64
	if err := common.DB.WithContext(ctx).
		Model(&models.WatchLater{}).
		Where("EXISTS (?)", activeWatchLaterLocationSubquery(ctx)).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count watch later: %w", err)
	}
	return count, nil
}

// activeWatchLaterLocationSubquery 判断某个视频是否还有有效位置，
// 用 watch_later.video_id 关联 video_location。
func activeWatchLaterLocationSubquery(ctx context.Context) *gorm.DB {
	return common.DB.WithContext(ctx).
		Table("video_location vl").
		Select("1").
		Joins("JOIN directory d ON d.id = vl.directory_id").
		Where("vl.video_id = watch_later.video_id").
		Where("COALESCE(vl.is_delete, 0) = 0").
		Where("COALESCE(d.is_delete, 0) = 0").
		Where("COALESCE(d.enabled, 1) <> 0")
}
