package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202609240001_add_playback_history.go",
		addPlaybackHistory,
		irreversibleMigration,
	)
}

// addPlaybackHistory 保存每个视频文件的最近一次播放进度。
// video_id 上的唯一索引保证「一个视频文件一条最新记录」，记录量被视频总数封顶。
func addPlaybackHistory(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "playback_history" (
			id integer PRIMARY KEY AUTOINCREMENT,
			video_id integer NOT NULL,
			location_id integer NOT NULL DEFAULT 0,
			position_sec real NOT NULL DEFAULT 0,
			duration_sec integer NOT NULL DEFAULT 0,
			played_at datetime,
			created_at datetime,
			updated_at datetime
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_history_video_id ON playback_history(video_id)`,
		`CREATE INDEX IF NOT EXISTS idx_playback_history_played_at ON playback_history(played_at)`,
	)
}
