package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202610200001_add_directory_mode.go",
		addDirectoryMode,
		irreversibleMigration,
	)
}

func addDirectoryMode(ctx context.Context, tx *sql.Tx) error {
	return addColumnIfMissing(
		ctx,
		tx,
		"directory",
		"mode",
		`text NOT NULL DEFAULT ""`,
	)
}
