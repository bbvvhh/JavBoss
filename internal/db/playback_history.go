package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UpsertPlaybackHistory 写入某个视频文件的最近一次播放进度。
// 同一个 video_id 只保留一条记录（冲突时更新进度与播放时间）。
func UpsertPlaybackHistory(ctx context.Context, record models.PlaybackHistory) error {
	if record.VideoID <= 0 {
		return errors.New("video id cannot be zero")
	}
	if record.PositionSec < 0 {
		record.PositionSec = 0
	}
	if record.DurationSec < 0 {
		record.DurationSec = 0
	}
	if record.PlayedAt.IsZero() {
		record.PlayedAt = time.Now()
	}
	err := common.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "video_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"location_id",
				"position_sec",
				"duration_sec",
				"played_at",
				"updated_at",
			}),
		}).
		Create(&record).Error
	if err != nil {
		return fmt.Errorf("upsert playback history for video %d: %w", record.VideoID, err)
	}
	return nil
}

// GetPlaybackHistory 返回某个视频文件的播放记录；没有记录时返回 nil。
func GetPlaybackHistory(ctx context.Context, videoID int64) (*models.PlaybackHistory, error) {
	if videoID <= 0 {
		return nil, nil
	}
	var record models.PlaybackHistory
	err := common.DB.WithContext(ctx).
		Where("video_id = ?", videoID).
		First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("get playback history for video %d: %w", videoID, err)
	}
	return &record, nil
}

// ListPlaybackHistory 按播放时间倒序返回播放记录，并带上视频展示载荷。
// 只返回仍然存在有效文件位置的视频，已被隐藏/移除的视频不会出现在列表里。
func ListPlaybackHistory(ctx context.Context, limit, offset int) ([]models.PlaybackHistoryItem, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var records []models.PlaybackHistory
	if err := common.DB.WithContext(ctx).
		Model(&models.PlaybackHistory{}).
		Where("EXISTS (?)", activePlaybackLocationSubquery(ctx)).
		Order("played_at DESC, id DESC").
		Limit(limit).
		Offset(offset).
		Find(&records).Error; err != nil {
		return nil, fmt.Errorf("list playback history: %w", err)
	}
	if len(records) == 0 {
		return []models.PlaybackHistoryItem{}, nil
	}

	videoIDs := make([]int64, 0, len(records))
	for _, record := range records {
		videoIDs = append(videoIDs, record.VideoID)
	}
	videos, err := activeVideosForIDs(ctx, videoIDs)
	if err != nil {
		return nil, err
	}

	items := make([]models.PlaybackHistoryItem, 0, len(records))
	for _, record := range records {
		video, ok := videos[record.VideoID]
		if !ok {
			// 视频已没有有效位置（并发隐藏/删除），跳过这一行。
			continue
		}
		items = append(items, models.PlaybackHistoryItem{
			VideoID:     record.VideoID,
			LocationID:  record.LocationID,
			PositionSec: record.PositionSec,
			DurationSec: record.DurationSec,
			PlayedAt:    record.PlayedAt,
			Video:       video,
		})
	}
	return items, nil
}

// CountPlaybackHistory 统计仍然有效的播放记录条数，语义与 ListPlaybackHistory 保持一致。
func CountPlaybackHistory(ctx context.Context) (int64, error) {
	var count int64
	if err := common.DB.WithContext(ctx).
		Model(&models.PlaybackHistory{}).
		Where("EXISTS (?)", activePlaybackLocationSubquery(ctx)).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count playback history: %w", err)
	}
	return count, nil
}

// DeletePlaybackHistory 删除某个视频文件的播放记录（播放结束或用户选择从头播放时调用）。
func DeletePlaybackHistory(ctx context.Context, videoID int64) error {
	if videoID <= 0 {
		return errors.New("video id cannot be zero")
	}
	if err := common.DB.WithContext(ctx).
		Where("video_id = ?", videoID).
		Delete(&models.PlaybackHistory{}).Error; err != nil {
		return fmt.Errorf("delete playback history for video %d: %w", videoID, err)
	}
	return nil
}

// ClearPlaybackHistory 删除全部播放记录，返回删除的条数。
// 「清空观看记录」会连同服务端记录一起清，避免清完列表里还在。
func ClearPlaybackHistory(ctx context.Context) (int64, error) {
	// GORM 默认拒绝无 WHERE 的全表删除，这里显式放行。
	result := common.DB.WithContext(ctx).Where("1 = 1").Delete(&models.PlaybackHistory{})
	if result.Error != nil {
		return 0, fmt.Errorf("clear playback history: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// activePlaybackLocationSubquery 判断某个视频是否还有有效位置，
// 用 playback_history.video_id 关联 video_location。
func activePlaybackLocationSubquery(ctx context.Context) *gorm.DB {
	return common.DB.WithContext(ctx).
		Table("video_location vl").
		Select("1").
		Joins("JOIN directory d ON d.id = vl.directory_id").
		Where("vl.video_id = playback_history.video_id").
		Where("COALESCE(vl.is_delete, 0) = 0").
		Where("COALESCE(d.is_delete, 0) = 0").
		Where("COALESCE(d.enabled, 1) <> 0")
}

// activeVideosForIDs 按视频组装展示载荷（与 ListVideos 同源），返回 video_id 到视频的映射。
func activeVideosForIDs(ctx context.Context, videoIDs []int64) (map[int64]models.Video, error) {
	result := make(map[int64]models.Video, len(videoIDs))
	if len(videoIDs) == 0 {
		return result, nil
	}
	var locations []models.VideoLocation
	if err := common.DB.WithContext(ctx).
		Model(&models.VideoLocation{}).
		Joins("JOIN directory ON directory.id = video_location.directory_id").
		Joins("JOIN video ON video.id = video_location.video_id").
		Where(activeLocationWhereSQL("video_location", "directory")).
		Where("video_location.video_id IN ?", videoIDs).
		Preload("DirectoryRef").
		Preload("Video").
		Preload("Video.Tags").
		Order("video_location.id DESC").
		Find(&locations).Error; err != nil {
		return nil, fmt.Errorf("load playback history videos: %w", err)
	}
	if err := hydrateLocationJavs(ctx, locations); err != nil {
		return nil, err
	}
	for _, loc := range locations {
		if loc.Video.ID == 0 {
			continue
		}
		// locations 已按 id 倒序，同一个视频只取第一个（最新的位置）。
		if _, ok := result[loc.Video.ID]; ok {
			continue
		}
		result[loc.Video.ID] = videoFromLocation(loc)
	}
	return result, nil
}
