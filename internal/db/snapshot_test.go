package db

import (
	"context"
	"path/filepath"
	"testing"

	"javboss/internal/common"
	"javboss/internal/models"
)

func TestSnapshotToExportsConsistentCopy(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(filepath.Join(dir, "javboss.db"))
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
	if err := UpsertConfig(ctx, map[string]string{"snapshot_probe": "1"}); err != nil {
		t.Fatalf("write probe config: %v", err)
	}

	dest := filepath.Join(dir, "snapshot.db")
	if err := SnapshotTo(ctx, dest); err != nil {
		t.Fatalf("snapshot database: %v", err)
	}
	// 重复导出到同一个路径必须可用（VACUUM INTO 本身拒绝覆盖已存在的文件）
	if err := SnapshotTo(ctx, dest); err != nil {
		t.Fatalf("snapshot database twice: %v", err)
	}

	snapshot, err := Open(dest)
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer func() {
		if sqlDB, dbErr := snapshot.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	}()

	var row models.Config
	if err := snapshot.First(&row, "key = ?", "snapshot_probe").Error; err != nil {
		t.Fatalf("read probe config from snapshot: %v", err)
	}
	if row.Value != "1" {
		t.Fatalf("probe config value = %q", row.Value)
	}
}
