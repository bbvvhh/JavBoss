package db

import (
	"context"
	"testing"
	"time"

	"javboss/internal/models"
)

func TestManageAndAssignTagCategories(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()

	categoryA, err := CreateTagCategory(ctx, " A ")
	if err != nil {
		t.Fatalf("CreateTagCategory A: %v", err)
	}
	categoryB, err := CreateTagCategory(ctx, "B")
	if err != nil {
		t.Fatalf("CreateTagCategory B: %v", err)
	}
	if categoryA.Name != "A" || categoryA.SortOrder != 0 || categoryB.SortOrder != 1 {
		t.Fatalf("unexpected categories: A=%+v B=%+v", categoryA, categoryB)
	}

	tag, err := CreateTag(ctx, "grouped")
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}
	if err := AssignTagsCategory(ctx, []int64{tag.ID}, &categoryB.ID); err != nil {
		t.Fatalf("AssignTagsCategory: %v", err)
	}
	tags, err := ListTags(ctx, nil, "")
	if err != nil {
		t.Fatalf("ListTags: %v", err)
	}
	if len(tags) != 1 || tags[0].CategoryID == nil || *tags[0].CategoryID != categoryB.ID || tags[0].Category != "B" {
		t.Fatalf("listed tag category = %+v", tags)
	}

	if err := ReorderTagCategories(ctx, []int64{categoryB.ID, 0, categoryA.ID}); err != nil {
		t.Fatalf("ReorderTagCategories: %v", err)
	}
	if err := RenameTagCategory(ctx, categoryB.ID, "Renamed"); err != nil {
		t.Fatalf("RenameTagCategory: %v", err)
	}
	categories, err := ListTagCategories(ctx)
	if err != nil {
		t.Fatalf("ListTagCategories: %v", err)
	}
	if len(categories) != 2 || categories[0].ID != categoryB.ID || categories[0].SortOrder != 0 || categories[0].Name != "Renamed" || categories[1].SortOrder != 2 {
		t.Fatalf("reordered categories = %+v", categories)
	}

	if err := DeleteTagCategory(ctx, categoryB.ID); err != nil {
		t.Fatalf("DeleteTagCategory: %v", err)
	}
	var stored models.Tag
	if err := gdb.First(&stored, tag.ID).Error; err != nil {
		t.Fatalf("load tag: %v", err)
	}
	if stored.CategoryID != nil {
		t.Fatalf("deleted category still assigned: %+v", stored)
	}
	categories, err = ListTagCategories(ctx)
	if err != nil {
		t.Fatalf("ListTagCategories after delete: %v", err)
	}
	if len(categories) != 1 || categories[0].ID != categoryA.ID || categories[0].SortOrder != 1 {
		t.Fatalf("normalized categories = %+v", categories)
	}
}

func TestAssignTagsCategoryRejectsMissingCategory(t *testing.T) {
	openTestDB(t)
	tag, err := CreateTag(context.Background(), "tag")
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}
	missingID := int64(999)
	if err := AssignTagsCategory(context.Background(), []int64{tag.ID}, &missingID); err == nil {
		t.Fatal("AssignTagsCategory accepted a missing category")
	}
}

func TestListTagsExcludeModeDropsOtherModeCounts(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	otherDir := models.Directory{Path: "/media/tags-other", Mode: models.DirectoryModeOther}
	videoDir := models.Directory{Path: "/media/tags-video"}
	if err := gdb.Create(&otherDir).Error; err != nil {
		t.Fatalf("create other directory: %v", err)
	}
	if err := gdb.Create(&videoDir).Error; err != nil {
		t.Fatalf("create video directory: %v", err)
	}

	tag := models.Tag{Name: "shared-tag"}
	if err := gdb.Create(&tag).Error; err != nil {
		t.Fatalf("create tag: %v", err)
	}
	for _, fixture := range []struct {
		dir  int64
		path string
		fp   string
	}{
		{otherDir.ID, "movie.mp4", "tags-fp-other"},
		{videoDir.ID, "movie.mp4", "tags-fp-video"},
	} {
		video := models.Video{Fingerprint: fixture.fp}
		if err := gdb.Create(&video).Error; err != nil {
			t.Fatalf("create video %s: %v", fixture.fp, err)
		}
		if _, err := UpsertVideoLocation(ctx, video.ID, fixture.dir, fixture.path, now); err != nil {
			t.Fatalf("create location %s: %v", fixture.path, err)
		}
		if err := gdb.Create(&models.VideoTag{VideoID: video.ID, TagID: tag.ID, CreatedAt: now}).Error; err != nil {
			t.Fatalf("create video tag: %v", err)
		}
	}

	all, err := ListTags(ctx, nil, "")
	if err != nil {
		t.Fatalf("ListTags all: %v", err)
	}
	if len(all) != 1 || all[0].Count != 2 {
		t.Fatalf("tag counts without exclusion = %#v", all)
	}

	excluded, err := ListTags(ctx, nil, models.DirectoryModeOther)
	if err != nil {
		t.Fatalf("ListTags exclude other: %v", err)
	}
	if len(excluded) != 1 || excluded[0].Count != 1 {
		t.Fatalf("tag counts excluding other mode = %#v", excluded)
	}
}
