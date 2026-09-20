package migrations

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

// Upgrading an existing install must keep every directory usable as a local
// source: the new WebDAV columns have to default to "local" without a NULL kind
// or a bogus remote path.
func TestAddStorageConnectionsKeepsExistingDirectoriesLocal(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE directory (id integer PRIMARY KEY, path text, is_delete numeric NOT NULL DEFAULT 0)`); err != nil {
		t.Fatalf("create directory table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO directory (id, path) VALUES (1, 'D:\Videos'), (2, '/mnt/videos')`); err != nil {
		t.Fatalf("seed directories: %v", err)
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin migration: %v", err)
	}
	if err := addStorageConnections(context.Background(), tx); err != nil {
		_ = tx.Rollback()
		t.Fatalf("add storage connections: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit migration: %v", err)
	}

	rows, err := db.Query(`SELECT id, kind, connection_id, remote_path FROM directory ORDER BY id`)
	if err != nil {
		t.Fatalf("read migrated directories: %v", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var (
			id           int64
			kind         string
			connectionID sql.NullInt64
			remotePath   string
		)
		if err := rows.Scan(&id, &kind, &connectionID, &remotePath); err != nil {
			t.Fatalf("scan migrated directory: %v", err)
		}
		count++
		if kind != "" {
			t.Fatalf("directory %d kind = %q, want the empty local default", id, kind)
		}
		if connectionID.Valid {
			t.Fatalf("directory %d must not gain a connection id", id)
		}
		if remotePath != "" {
			t.Fatalf("directory %d remote path = %q, want empty", id, remotePath)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate directories: %v", err)
	}
	if count != 2 {
		t.Fatalf("migrated %d directories, want 2", count)
	}

	// The connection table must exist and accept a row after migration.
	if _, err := db.Exec(
		`INSERT INTO storage_connection (name, url, username, password) VALUES ('dav', 'https://dav.example.com/dav', 'u', 'p')`,
	); err != nil {
		t.Fatalf("insert storage connection: %v", err)
	}
	// Names are unique.
	if _, err := db.Exec(
		`INSERT INTO storage_connection (name, url, username, password) VALUES ('dav', 'https://other', '', '')`,
	); err == nil {
		t.Fatal("storage connection names must be unique")
	}

	// Running the migration twice must be a no-op.
	tx2, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin second migration: %v", err)
	}
	if err := addStorageConnections(context.Background(), tx2); err != nil {
		_ = tx2.Rollback()
		t.Fatalf("re-run migration: %v", err)
	}
	if err := tx2.Commit(); err != nil {
		t.Fatalf("commit second migration: %v", err)
	}
}
