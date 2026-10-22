package migrations

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestAddDirectoryModeDefaultsExistingRowsToVideoMode(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE directory (id integer PRIMARY KEY, path text)`); err != nil {
		t.Fatalf("create directory table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO directory (id, path) VALUES (1, '/media/one')`); err != nil {
		t.Fatalf("seed directory: %v", err)
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin migration: %v", err)
	}
	if err := addDirectoryMode(context.Background(), tx); err != nil {
		_ = tx.Rollback()
		t.Fatalf("add directory mode: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit migration: %v", err)
	}

	// 存量目录必须自动归入视频模式，即 mode 为空串。
	var mode string
	if err := db.QueryRow(`SELECT mode FROM directory WHERE id = 1`).Scan(&mode); err != nil {
		t.Fatalf("read migrated directory: %v", err)
	}
	if mode != "" {
		t.Fatalf("existing directory mode = %q, want empty (video mode)", mode)
	}

	// 列必须是 NOT NULL 且默认空串，否则后续写入会被 NULL 打乱模式判断。
	rows, err := db.Query(`PRAGMA table_info(directory)`)
	if err != nil {
		t.Fatalf("read table info: %v", err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var (
			cid       int
			name      string
			ctype     string
			notNull   int
			defaultV  sql.NullString
			primaryKy int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &defaultV, &primaryKy); err != nil {
			t.Fatalf("scan table info: %v", err)
		}
		if name != "mode" {
			continue
		}
		found = true
		if notNull != 1 {
			t.Fatalf("mode column notnull = %d, want 1", notNull)
		}
		if !defaultV.Valid || defaultV.String != `""` {
			t.Fatalf("mode column default = %v, want an empty string literal", defaultV)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate table info: %v", err)
	}
	if !found {
		t.Fatal("mode column missing after migration")
	}
}
