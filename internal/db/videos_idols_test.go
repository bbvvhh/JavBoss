package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"
)

// TestListVideosHydratesJavIdols 锁定「移动端大图模式的演员行有数据」这件事。
//
// Video.Jav 是 gorm:"-" 手工组装的，hydrateLocationJavs 不显式 Preload("Idols")
// 的话 jav.idols 永远是空的 —— 而且不会有任何报错，只会安静地少一行演员。
// 所以这条断言必须有，否则哪天有人"顺手简化"掉 Preload 也不会被发现。
func TestListVideosHydratesJavIdols(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "hydrate-idols.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	ctx := context.Background()
	dir := models.Directory{Path: t.TempDir()}
	if err := database.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}

	idols := []models.JavIdol{{Name: "演员甲"}, {Name: "演员乙"}}
	if err := database.Create(&idols).Error; err != nil {
		t.Fatalf("create idols: %v", err)
	}

	jav := models.Jav{Code: "IDOL-001", Title: "带演员的作品", Idols: idols}
	if err := database.Create(&jav).Error; err != nil {
		t.Fatalf("create jav: %v", err)
	}

	video := models.Video{Fingerprint: "hydrate-idols-video"}
	if err := database.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc, err := UpsertVideoLocation(ctx, video.ID, dir.ID, "movie.mp4", time.Unix(1710000000, 0).UTC())
	if err != nil {
		t.Fatalf("create video location: %v", err)
	}
	javID := jav.ID
	if err := database.Model(&models.VideoLocation{}).
		Where("id = ?", loc.ID).
		Update("jav_id", javID).Error; err != nil {
		t.Fatalf("link jav: %v", err)
	}

	locations, err := ListVideos(ctx, 10, 0, nil, "", "recent", nil, nil)
	if err != nil {
		t.Fatalf("list videos: %v", err)
	}
	if len(locations) != 1 {
		t.Fatalf("got %d locations, want 1", len(locations))
	}
	got := locations[0].Jav
	if got == nil {
		t.Fatalf("location.Jav is nil")
	}
	if got.Code != "IDOL-001" {
		t.Fatalf("jav.Code = %q, want IDOL-001", got.Code)
	}
	if len(got.Idols) != 2 {
		t.Fatalf("jav.Idols 有 %d 位演员，want 2（Preload(\"Idols\") 是否被去掉了？）", len(got.Idols))
	}
	names := map[string]bool{}
	for _, idol := range got.Idols {
		names[idol.Name] = true
	}
	for _, want := range []string{"演员甲", "演员乙"} {
		if !names[want] {
			t.Fatalf("jav.Idols 缺少 %q，实际 %v", want, names)
		}
	}
}
