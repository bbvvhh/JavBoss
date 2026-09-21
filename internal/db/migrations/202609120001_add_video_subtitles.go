package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202609120001_add_video_subtitles.go",
		addVideoSubtitles,
		irreversibleMigration,
	)
}

// addVideoSubtitles stores subtitles downloaded from an online provider. Files
// themselves live under <dataDir>/subtitle/<video_id>/; this table only records
// the link between a video and each downloaded subtitle.
func addVideoSubtitles(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "video_subtitle" (
			id integer PRIMARY KEY AUTOINCREMENT,
			video_id integer NOT NULL,
			filename text NOT NULL DEFAULT "",
			title text NOT NULL DEFAULT "",
			language text NOT NULL DEFAULT "",
			format text NOT NULL DEFAULT "",
			duration_ms integer NOT NULL DEFAULT 0,
			size integer NOT NULL DEFAULT 0,
			auto numeric NOT NULL DEFAULT false,
			source_id text NOT NULL DEFAULT "",
			source_url text NOT NULL DEFAULT "",
			created_at datetime,
			updated_at datetime
		)`,
		`CREATE INDEX IF NOT EXISTS idx_video_subtitle_video_id ON video_subtitle(video_id)`,
	)
}
