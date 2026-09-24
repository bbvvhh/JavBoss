package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("202609240002_add_update_settings.go", addUpdateSettings, irreversibleMigration)
}

// addUpdateSettings 保存程序更新包所在位置（本机目录或 WebDAV 远程目录）。
// connection_id 为空表示 update_path 是本机目录。
func addUpdateSettings(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE IF NOT EXISTS "update_settings" (
			id integer PRIMARY KEY AUTOINCREMENT,
			update_path text NOT NULL DEFAULT "",
			created_at datetime,
			updated_at datetime,
			connection_id integer
		)`,
	)
}
