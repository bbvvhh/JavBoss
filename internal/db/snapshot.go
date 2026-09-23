package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"javboss/internal/common"
)

// SnapshotTo 用 VACUUM INTO 导出一份一致的数据库副本。
//
// 运行中的库开了 WAL，直接按文件复制会拿到半写状态的快照，备份必须用这个副本。
func SnapshotTo(ctx context.Context, destPath string) error {
	if common.DB == nil {
		return errors.New("snapshot database: nil db")
	}
	if strings.TrimSpace(destPath) == "" {
		return errors.New("snapshot database: empty destination")
	}
	// VACUUM INTO 拒绝覆盖已存在的文件。
	if err := os.Remove(destPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("snapshot database: %w", err)
	}
	if err := common.DB.WithContext(ctx).Exec("VACUUM INTO ?", destPath).Error; err != nil {
		return fmt.Errorf("snapshot database: %w", err)
	}
	return nil
}
