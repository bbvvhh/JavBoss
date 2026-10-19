package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202610190002_add_watch_later.go",
		addWatchLater,
		irreversibleMigration,
	)
}

// addWatchLater 保存「稍后观看」列表。
// video_id 上的唯一索引保证「一个视频文件最多一项」，重复加入由 UPSERT 幂等处理。
func addWatchLater(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "watch_later" (
			id integer PRIMARY KEY AUTOINCREMENT,
			video_id integer NOT NULL,
			created_at datetime,
			updated_at datetime
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_later_video_id ON watch_later(video_id)`,
	)
}
