package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202609100001_add_storage_connections.go",
		addStorageConnections,
		irreversibleMigration,
	)
}

// addStorageConnections introduces remote (WebDAV) video sources: one connection
// table holding the endpoint and credentials, plus three directory columns that
// let an existing local directory be repointed at a remote root in place.
func addStorageConnections(ctx context.Context, tx *sql.Tx) error {
	if err := execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "storage_connection" (
			id integer PRIMARY KEY AUTOINCREMENT,
			name text NOT NULL,
			url text NOT NULL,
			username text NOT NULL,
			password text NOT NULL,
			created_at datetime,
			updated_at datetime
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_connection_name ON storage_connection(name)`,
	); err != nil {
		return err
	}
	if err := addColumnIfMissing(ctx, tx, "directory", "kind", `text NOT NULL DEFAULT ""`); err != nil {
		return err
	}
	if err := addColumnIfMissing(ctx, tx, "directory", "connection_id", `integer`); err != nil {
		return err
	}
	return addColumnIfMissing(ctx, tx, "directory", "remote_path", `text NOT NULL DEFAULT ""`)
}
