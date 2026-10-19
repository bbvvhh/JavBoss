package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("202610190001_add_jav_duplicate_whitelist.go", addJavDuplicateWhitelist, irreversibleMigration)
}

// addJavDuplicateWhitelist keeps the JAV works that the user chose to skip in
// the duplicate scan. One row per JAV work.
func addJavDuplicateWhitelist(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "jav_duplicate_whitelist" (
			id integer PRIMARY KEY AUTOINCREMENT,
			jav_id integer NOT NULL,
			code text NOT NULL DEFAULT "",
			created_at datetime,
			CONSTRAINT fk_jav_duplicate_whitelist_jav FOREIGN KEY (jav_id) REFERENCES jav(id) ON UPDATE CASCADE ON DELETE CASCADE
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_jav_duplicate_whitelist_jav_id ON jav_duplicate_whitelist(jav_id)`,
	)
}
