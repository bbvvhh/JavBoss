package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
)

// 其它模式只做文件对账，不做 JAV 刮削/自动关联：扫描后位置照常保留、摘要照常落库，
// 但绝不能产生 jav_id 关联，也不能写入任何 JAV 元数据。
func TestScanDirectoryOtherModeSkipsJavLinking(t *testing.T) {
	resetDirectoryScanSessions(t)
	gdb, err := db.Open(filepath.Join(t.TempDir(), "other-scan.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := gdb.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	dir := models.Directory{Path: t.TempDir(), Mode: models.DirectoryModeOther}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}

	// 文件名刻意带上番号，视频模式下它会被丢进 JAV 关联队列。
	name := "ABC-123.mp4"
	full := filepath.Join(dir.Path, name)
	if err := os.WriteFile(full, []byte{0, 1, 2, 3}, 0600); err != nil {
		t.Fatalf("write video file: %v", err)
	}
	info, err := os.Stat(full)
	if err != nil {
		t.Fatalf("stat video file: %v", err)
	}

	// 预置与磁盘一致的 size/mtime，让扫描走「文件未变化」快路径，避免真实 ffprobe。
	video := models.Video{Fingerprint: "other-scan-fp", Size: info.Size(), DurationSec: 60}
	if err := gdb.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc := models.VideoLocation{
		VideoID:      video.ID,
		DirectoryID:  dir.ID,
		RelativePath: name,
		Filename:     name,
		ModifiedAt:   info.ModTime().UTC(),
	}
	if err := gdb.Create(&loc).Error; err != nil {
		t.Fatalf("create video location: %v", err)
	}

	summary, err := ScanDirectory(t.Context(), dir)
	if err != nil {
		t.Fatalf("scan other mode directory: %v", err)
	}
	if summary.FilesSeen != 1 {
		t.Fatalf("files seen = %d, want 1", summary.FilesSeen)
	}

	var saved models.VideoLocation
	if err := gdb.Where("directory_id = ?", dir.ID).First(&saved).Error; err != nil {
		t.Fatalf("reload video location: %v", err)
	}
	if saved.JavID != nil {
		t.Fatalf("other mode linked JAV metadata, jav_id = %d", *saved.JavID)
	}

	var javCount int64
	if err := gdb.Model(&models.Jav{}).Where("UPPER(code) = ?", "ABC-123").Count(&javCount).Error; err != nil {
		t.Fatalf("count jav rows: %v", err)
	}
	if javCount != 0 {
		t.Fatalf("other mode scan created %d JAV rows, want 0", javCount)
	}

	// 「跳过刮削」不等于「跳过扫描」：摘要必须照常记录完成时间。
	var refreshed models.Directory
	if err := gdb.First(&refreshed, dir.ID).Error; err != nil {
		t.Fatalf("reload directory: %v", err)
	}
	if refreshed.LastScanSummary.FinishedAtUnixMS < time.Now().Add(-time.Minute).UnixMilli() {
		t.Fatalf("scan summary was not persisted: %+v", refreshed.LastScanSummary)
	}
}
