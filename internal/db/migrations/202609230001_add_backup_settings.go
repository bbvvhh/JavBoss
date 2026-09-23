package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("202609230001_add_backup_settings.go", addBackupSettings, irreversibleMigration)
}

func addBackupSettings(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "backup_settings" (
			id integer PRIMARY KEY AUTOINCREMENT,
			backup_path text NOT NULL DEFAULT "",
			password text NOT NULL DEFAULT "",
			created_at datetime,
			updated_at datetime
		)`,
	)
}
