package db

import (
	"context"
	"path/filepath"
	"testing"

	"javboss/internal/models"
)

func TestSearchJavDuplicatesAndWhitelist(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	dir := models.Directory{Path: t.TempDir()}
	if err := db.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}

	createJav := func(code string) models.Jav {
		t.Helper()
		item := models.Jav{Code: code}
		if err := db.Create(&item).Error; err != nil {
			t.Fatalf("create jav %s: %v", code, err)
		}
		return item
	}
	addFile := func(javID int64, rel string, isDelete bool) {
		t.Helper()
		video := models.Video{Fingerprint: "fp-" + rel}
		if err := db.Create(&video).Error; err != nil {
			t.Fatalf("create video %s: %v", rel, err)
		}
		loc := models.VideoLocation{
			VideoID:      video.ID,
			DirectoryID:  dir.ID,
			RelativePath: rel,
			Filename:     filepath.Base(rel),
			JavID:        &javID,
			IsDelete:     isDelete,
		}
		if err := db.Create(&loc).Error; err != nil {
			t.Fatalf("create location %s: %v", rel, err)
		}
	}

	duplicateJav := createJav("AAA-001")
	singleJav := createJav("BBB-002")
	whitelistedJav := createJav("CCC-003")

	addFile(duplicateJav.ID, "a/one.mp4", false)
	addFile(duplicateJav.ID, "a/two.mp4", false)
	addFile(singleJav.ID, "b/one.mp4", false)
	addFile(singleJav.ID, "b/two.mp4", true) // hidden/deleted location does not count
	addFile(whitelistedJav.ID, "c/one.mp4", false)
	addFile(whitelistedJav.ID, "c/two.mp4", false)

	items, total, err := SearchJavDuplicates(ctx, "", "", 100, 0, nil)
	if err != nil {
		t.Fatalf("SearchJavDuplicates: %v", err)
	}
	if total != 2 {
		t.Fatalf("duplicate total = %d, want 2", total)
	}
	if len(items) != 2 {
		t.Fatalf("duplicate item count = %d, want 2", len(items))
	}

	byCode := map[string]models.Jav{}
	for _, item := range items {
		byCode[item.Code] = item
	}
	if _, ok := byCode["AAA-001"]; !ok {
		t.Fatalf("expected AAA-001 in duplicates, got %v", byCode)
	}
	if _, ok := byCode["CCC-003"]; !ok {
		t.Fatalf("expected CCC-003 in duplicates, got %v", byCode)
	}
	if item, ok := byCode["AAA-001"]; ok && len(item.Videos) != 2 {
		t.Fatalf("AAA-001 videos = %d, want 2", len(item.Videos))
	}

	// A search term narrows the result set.
	searched, searchTotal, err := SearchJavDuplicates(ctx, "CCC", "", 100, 0, nil)
	if err != nil {
		t.Fatalf("SearchJavDuplicates(search): %v", err)
	}
	if searchTotal != 1 || len(searched) != 1 || searched[0].Code != "CCC-003" {
		t.Fatalf("search result = total %d items %v, want CCC-003 only", searchTotal, searched)
	}

	added, err := AddJavDuplicateWhitelist(ctx, []int64{whitelistedJav.ID, whitelistedJav.ID})
	if err != nil {
		t.Fatalf("AddJavDuplicateWhitelist: %v", err)
	}
	if added != 1 {
		t.Fatalf("added = %d, want 1", added)
	}

	entries, err := ListJavDuplicateWhitelist(ctx)
	if err != nil {
		t.Fatalf("ListJavDuplicateWhitelist: %v", err)
	}
	if len(entries) != 1 || entries[0].Code != "CCC-003" {
		t.Fatalf("whitelist entries = %v, want CCC-003", entries)
	}

	items, total, err = SearchJavDuplicates(ctx, "", "", 100, 0, nil)
	if err != nil {
		t.Fatalf("SearchJavDuplicates after whitelist: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].Code != "AAA-001" {
		t.Fatalf("after whitelist = total %d items %v, want AAA-001 only", total, items)
	}

	removed, err := RemoveJavDuplicateWhitelist(ctx, []int64{whitelistedJav.ID})
	if err != nil {
		t.Fatalf("RemoveJavDuplicateWhitelist: %v", err)
	}
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}

	_, total, err = SearchJavDuplicates(ctx, "", "", 100, 0, nil)
	if err != nil {
		t.Fatalf("SearchJavDuplicates after removal: %v", err)
	}
	if total != 2 {
		t.Fatalf("after removal total = %d, want 2", total)
	}
}
