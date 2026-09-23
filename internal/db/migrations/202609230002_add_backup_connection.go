package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("202609230002_add_backup_connection.go", addBackupConnection, irreversibleMigration)
}

// addBackupConnection 允许把备份写到某个 WebDAV 连接下的远程目录。
// 为空表示 backup_path 是本机目录（老行为）。
func addBackupConnection(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`ALTER TABLE "backup_settings" ADD COLUMN connection_id integer`,
	)
}
