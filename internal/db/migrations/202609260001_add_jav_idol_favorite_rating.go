package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202609260001_add_jav_idol_favorite_rating.go",
		addJavIdolFavoriteRating,
		irreversibleMigration,
	)
}

func addJavIdolFavoriteRating(ctx context.Context, tx *sql.Tx) error {
	return addColumnIfMissing(ctx, tx, "jav_idol", "favorite_rating", "real NOT NULL DEFAULT 0")
}
