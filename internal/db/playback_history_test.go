package db

import (
	"context"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"
)

// playbackFixture 建一条目录 + 两个视频（各有一个有效位置），返回按创建顺序排列的视频。
func playbackFixture(t *testing.T) (context.Context, []models.Video) {
	t.Helper()

	db := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	dir := models.Directory{Path: "/tmp/playback"}
	if err := db.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}

	videos := []models.Video{
		{
			DirectoryID: dir.ID,
			Path:        "first.mp4",
			Filename:    "first.mp4",
			Fingerprint: "playback-first",
			DurationSec: 600,
			CreatedAt:   now,
		},
		{
			DirectoryID: dir.ID,
			Path:        "second.mp4",
			Filename:    "second.mp4",
			Fingerprint: "playback-second",
			DurationSec: 1200,
			CreatedAt:   now.Add(time.Second),
		},
	}
	if err := db.Create(&videos).Error; err != nil {
		t.Fatalf("create videos: %v", err)
	}
	createVideoLocationsForVideos(t, db, videos...)
	return ctx, videos
}

func TestUpsertPlaybackHistoryKeepsSingleRowPerVideo(t *testing.T) {
	ctx, videos := playbackFixture(t)
	videoID := videos[0].ID

	if err := UpsertPlaybackHistory(ctx, models.PlaybackHistory{
		VideoID:     videoID,
		PositionSec: 30,
		DurationSec: 600,
		PlayedAt:    time.Unix(1710000010, 0).UTC(),
	}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if err := UpsertPlaybackHistory(ctx, models.PlaybackHistory{
		VideoID:     videoID,
		PositionSec: 120.5,
		DurationSec: 600,
		PlayedAt:    time.Unix(1710000100, 0).UTC(),
	}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	record, err := GetPlaybackHistory(ctx, videoID)
	if err != nil {
		t.Fatalf("GetPlaybackHistory() error = %v", err)
	}
	if record == nil {
		t.Fatal("expected playback history, got nil")
	}
	if record.PositionSec != 120.5 || record.DurationSec != 600 {
		t.Fatalf("unexpected progress: %#v", record)
	}

	var count int64
	if err := common.DB.Model(&models.PlaybackHistory{}).Count(&count).Error; err != nil {
		t.Fatalf("count playback history: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected a single row per video, got %d", count)
	}
}

func TestGetPlaybackHistoryMissingReturnsNil(t *testing.T) {
	ctx, videos := playbackFixture(t)

	record, err := GetPlaybackHistory(ctx, videos[0].ID)
	if err != nil {
		t.Fatalf("GetPlaybackHistory() error = %v", err)
	}
	if record != nil {
		t.Fatalf("expected nil record, got %#v", record)
	}
}

func TestListPlaybackHistoryOrdersByPlayedAtAndSkipsDeletedLocations(t *testing.T) {
	ctx, videos := playbackFixture(t)
	first, second := videos[0], videos[1]

	records := []models.PlaybackHistory{
		{
			VideoID:     first.ID,
			PositionSec: 10,
			DurationSec: 600,
			PlayedAt:    time.Unix(1710000010, 0).UTC(),
		},
		{
			VideoID:     second.ID,
			PositionSec: 20,
			DurationSec: 1200,
			PlayedAt:    time.Unix(1710000200, 0).UTC(),
		},
	}
	for _, record := range records {
		if err := UpsertPlaybackHistory(ctx, record); err != nil {
			t.Fatalf("upsert playback history: %v", err)
		}
	}

	items, err := ListPlaybackHistory(ctx, 10, 0)
	if err != nil {
		t.Fatalf("ListPlaybackHistory() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("unexpected item count: got %d want 2", len(items))
	}
	if items[0].VideoID != second.ID || items[1].VideoID != first.ID {
		t.Fatalf("unexpected order: %#v", items)
	}
	if items[0].Video.ID != second.ID || items[0].Video.Filename != "second.mp4" {
		t.Fatalf("video payload missing: %#v", items[0].Video)
	}
	if items[0].PositionSec != 20 || items[0].DurationSec != 1200 {
		t.Fatalf("unexpected progress payload: %#v", items[0])
	}

	// 隐藏视频位置后，对应记录不再出现在列表里，总数同步下降。
	if err := common.DB.
		Model(&models.VideoLocation{}).
		Where("video_id = ?", second.ID).
		Update("is_delete", true).Error; err != nil {
		t.Fatalf("hide second location: %v", err)
	}
	items, err = ListPlaybackHistory(ctx, 10, 0)
	if err != nil {
		t.Fatalf("ListPlaybackHistory() after hide error = %v", err)
	}
	if len(items) != 1 || items[0].VideoID != first.ID {
		t.Fatalf("unexpected items after hide: %#v", items)
	}
	total, err := CountPlaybackHistory(ctx)
	if err != nil {
		t.Fatalf("CountPlaybackHistory() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("unexpected total: got %d want 1", total)
	}
}

func TestDeletePlaybackHistory(t *testing.T) {
	ctx, videos := playbackFixture(t)
	videoID := videos[0].ID

	if err := UpsertPlaybackHistory(ctx, models.PlaybackHistory{
		VideoID:     videoID,
		PositionSec: 42,
		DurationSec: 600,
	}); err != nil {
		t.Fatalf("upsert playback history: %v", err)
	}
	if err := DeletePlaybackHistory(ctx, videoID); err != nil {
		t.Fatalf("DeletePlaybackHistory() error = %v", err)
	}
	record, err := GetPlaybackHistory(ctx, videoID)
	if err != nil {
		t.Fatalf("GetPlaybackHistory() error = %v", err)
	}
	if record != nil {
		t.Fatalf("expected record removed, got %#v", record)
	}
}

func TestDeleteByIDsRemovesPlaybackHistory(t *testing.T) {
	ctx, videos := playbackFixture(t)
	videoID := videos[0].ID

	if err := UpsertPlaybackHistory(ctx, models.PlaybackHistory{
		VideoID:     videoID,
		PositionSec: 42,
		DurationSec: 600,
	}); err != nil {
		t.Fatalf("upsert playback history: %v", err)
	}
	if err := DeleteByIDs(ctx, []int64{videoID}); err != nil {
		t.Fatalf("DeleteByIDs() error = %v", err)
	}

	var count int64
	if err := common.DB.Model(&models.PlaybackHistory{}).Count(&count).Error; err != nil {
		t.Fatalf("count playback history: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected playback history removed with video, got %d rows", count)
	}
}
