package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/mpv"
	"javboss/internal/subtitle"
)

// setupSubtitlePlayerTest seeds a video plus one downloaded subtitle and points
// common.AppConfig at the temp data directory.
func setupSubtitlePlayerTest(t *testing.T) (videoID int64, subtitleID int64, dataDir string) {
	t.Helper()

	dataDir = t.TempDir()
	database, err := db.Open(filepath.Join(dataDir, "javboss.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	previousConfig := common.AppConfig
	common.DB = database
	common.AppConfig = &common.Config{DatabasePath: filepath.Join(dataDir, "javboss.db")}
	t.Cleanup(func() {
		common.DB = previousDB
		common.AppConfig = previousConfig
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})

	video := models.Video{Fingerprint: "subtitle-player-video"}
	if err := database.Create(&video).Error; err != nil {
		t.Fatal(err)
	}
	item := models.VideoSubtitle{
		VideoID:  video.ID,
		Filename: "ABP-001.srt",
		Title:    "ABP-001.srt",
		Format:   subtitle.FormatSRT,
	}
	dir := subtitle.Dir(dataDir, video.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, item.Filename), []byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateVideoSubtitle(context.Background(), &item); err != nil {
		t.Fatal(err)
	}
	return video.ID, item.ID, dataDir
}

func TestAttachSubtitleRequiresRunningPlayer(t *testing.T) {
	videoID, subtitleID, _ := setupSubtitlePlayerTest(t)
	ctx := context.Background()

	// mpv 没在播放时，"如果正在播放就挂字幕" 必须是静默 no-op。
	attached, err := AttachSubtitleToPlayerIfPlaying(ctx, videoID, subtitleID)
	if err != nil {
		t.Fatalf("AttachSubtitleToPlayerIfPlaying: %v", err)
	}
	if attached {
		t.Fatal("nothing may be attached while no mpv window is running")
	}

	// 显式挂载则必须把「播放器没在运行」如实报出来。
	if err := AttachSubtitleToPlayer(ctx, videoID, subtitleID); !errors.Is(err, mpv.ErrPlayerNotRunning) {
		t.Fatalf("AttachSubtitleToPlayer = %v, want ErrPlayerNotRunning", err)
	}
}

func TestAttachSubtitleValidatesTarget(t *testing.T) {
	videoID, _, dataDir := setupSubtitlePlayerTest(t)
	ctx := context.Background()

	if err := AttachSubtitleToPlayer(ctx, videoID, 9999); err == nil {
		t.Fatal("a missing subtitle row must be an error")
	}

	// 文件被手工删掉时也要报错，而不是把不存在的路径塞给 mpv。
	if err := os.RemoveAll(filepath.Join(dataDir, "subtitle")); err != nil {
		t.Fatal(err)
	}
	if err := AttachSubtitleToPlayer(ctx, videoID, 1); err == nil {
		t.Fatal("a missing subtitle file must be an error")
	}
}
