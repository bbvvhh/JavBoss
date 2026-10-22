package db

import (
	"context"
	"testing"
	"time"

	"javboss/internal/models"
)

// otherModeFixture 造出「一个其它模式目录 + 一个视频模式目录」的分层场景：
//
//	其它模式：A/B/f.mp4、A/g.mp4、C/e.mp4、h.mp4
//	视频模式：x.mp4
func otherModeFixture(t *testing.T) (otherDir, videoDir models.Directory) {
	t.Helper()
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	otherDir = models.Directory{Path: "/media/other", Mode: models.DirectoryModeOther}
	videoDir = models.Directory{Path: "/media/video"} // 空串即视频模式
	if err := gdb.Create(&otherDir).Error; err != nil {
		t.Fatalf("create other directory: %v", err)
	}
	if err := gdb.Create(&videoDir).Error; err != nil {
		t.Fatalf("create video directory: %v", err)
	}

	fixtures := []struct {
		dir  int64
		path string
		fp   string
	}{
		{otherDir.ID, "A/B/f.mp4", "other-fp-1"},
		{otherDir.ID, "A/g.mp4", "other-fp-2"},
		{otherDir.ID, "C/e.mp4", "other-fp-3"},
		{otherDir.ID, "h.mp4", "other-fp-4"},
		{videoDir.ID, "x.mp4", "video-fp-1"},
	}
	for _, f := range fixtures {
		video := models.Video{Fingerprint: f.fp}
		if err := gdb.Create(&video).Error; err != nil {
			t.Fatalf("create video %s: %v", f.fp, err)
		}
		if _, err := UpsertVideoLocation(ctx, video.ID, f.dir, f.path, now); err != nil {
			t.Fatalf("create location %s: %v", f.path, err)
		}
	}
	return otherDir, videoDir
}

func TestListOtherDirectoriesOnlyReturnsOtherModeDirectories(t *testing.T) {
	otherDir, _ := otherModeFixture(t)

	dirs, err := ListOtherDirectories(context.Background())
	if err != nil {
		t.Fatalf("ListOtherDirectories: %v", err)
	}
	if len(dirs) != 1 || dirs[0].ID != otherDir.ID {
		t.Fatalf("other directories = %#v, want only %d", dirs, otherDir.ID)
	}
	if dirs[0].ScannedVideoCount != 4 {
		t.Fatalf("other directory video count = %d, want 4", dirs[0].ScannedVideoCount)
	}
}

func TestListOtherSubfoldersWalksEachLevel(t *testing.T) {
	otherDir, _ := otherModeFixture(t)
	ctx := context.Background()

	// 顶层只应看到 A / C，计数是递归的（A 下含 A/B/f.mp4 与 A/g.mp4）。
	top, err := ListOtherSubfolders(ctx, otherDir.ID, "")
	if err != nil {
		t.Fatalf("ListOtherSubfolders top: %v", err)
	}
	if len(top) != 2 {
		t.Fatalf("top folders = %#v, want A and C", top)
	}
	if top[0].Name != "A" || top[0].Path != "A" || top[0].VideoCount != 2 {
		t.Fatalf("folder A = %#v", top[0])
	}
	if top[1].Name != "C" || top[1].Path != "C" || top[1].VideoCount != 1 {
		t.Fatalf("folder C = %#v", top[1])
	}

	// A 下只应看到 B，Path 必须是可直接回环下钻的 "A/B"。
	nested, err := ListOtherSubfolders(ctx, otherDir.ID, "A")
	if err != nil {
		t.Fatalf("ListOtherSubfolders A: %v", err)
	}
	if len(nested) != 1 || nested[0].Name != "B" || nested[0].Path != "A/B" || nested[0].VideoCount != 1 {
		t.Fatalf("folders under A = %#v", nested)
	}

	// 同级视频不该被算成子文件夹。
	if _, err := ListOtherSubfolders(ctx, otherDir.ID, "A/B"); err != nil {
		t.Fatalf("ListOtherSubfolders A/B: %v", err)
	}
}

func TestListOtherModeVideosOnlyReturnsImmediateFiles(t *testing.T) {
	otherDir, _ := otherModeFixture(t)
	ctx := context.Background()

	// 顶层只有 h.mp4 是直接子文件，A/B/f.mp4、A/g.mp4、C/e.mp4 都藏在子文件夹里。
	root, err := ListOtherModeVideos(ctx, otherDir.ID, "", 50, 0, nil, "", "recent", nil)
	if err != nil {
		t.Fatalf("ListOtherModeVideos root: %v", err)
	}
	if len(root) != 1 || root[0].Filename != "h.mp4" {
		t.Fatalf("root videos = %#v, want only h.mp4", root)
	}

	total, err := CountOtherModeVideos(ctx, otherDir.ID, "", nil, "")
	if err != nil {
		t.Fatalf("CountOtherModeVideos root: %v", err)
	}
	if total != 1 {
		t.Fatalf("root video total = %d, want 1", total)
	}

	atA, err := ListOtherModeVideos(ctx, otherDir.ID, "A", 50, 0, nil, "", "recent", nil)
	if err != nil {
		t.Fatalf("ListOtherModeVideos A: %v", err)
	}
	if len(atA) != 1 || atA[0].Filename != "g.mp4" {
		t.Fatalf("videos under A = %#v, want only g.mp4", atA)
	}

	atAB, err := ListOtherModeVideos(ctx, otherDir.ID, "A/B", 50, 0, nil, "", "recent", nil)
	if err != nil {
		t.Fatalf("ListOtherModeVideos A/B: %v", err)
	}
	if len(atAB) != 1 || atAB[0].Filename != "f.mp4" {
		t.Fatalf("videos under A/B = %#v, want only f.mp4", atAB)
	}
}

func TestSearchOtherModeVideosWalksNestedFolders(t *testing.T) {
	otherDir, videoDir := otherModeFixture(t)
	ctx := context.Background()

	// 文件名搜索必须递归到子文件夹：g.mp4 位于 A 下，f.mp4 位于 A/B 下。
	nested, err := SearchOtherModeVideos(ctx, otherDir.ID, "", 50, 0, "g.mp4", "recent", nil)
	if err != nil {
		t.Fatalf("SearchOtherModeVideos g.mp4: %v", err)
	}
	if len(nested) != 1 || nested[0].Filename != "g.mp4" {
		t.Fatalf("nested search = %#v, want only g.mp4", nested)
	}

	// 前缀可以把搜索限制在某个子树里。
	insideB, err := SearchOtherModeVideos(ctx, otherDir.ID, "A/B", 50, 0, ".mp4", "recent", nil)
	if err != nil {
		t.Fatalf("SearchOtherModeVideos A/B: %v", err)
	}
	if len(insideB) != 1 || insideB[0].Filename != "f.mp4" {
		t.Fatalf("search inside A/B = %#v, want only f.mp4", insideB)
	}

	// directoryID=0 在全库其它模式目录里搜，视频模式目录不能混进来。
	all, err := SearchOtherModeVideos(ctx, 0, "", 50, 0, ".mp4", "recent", nil)
	if err != nil {
		t.Fatalf("SearchOtherModeVideos all: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("global search returned %d rows (%#v), want the 4 other-mode rows", len(all), all)
	}
	for _, item := range all {
		if item.DirectoryID == videoDir.ID {
			t.Fatalf("global search leaked video-mode row: %#v", item)
		}
	}

	total, err := CountSearchOtherModeVideos(ctx, 0, "", ".mp4")
	if err != nil {
		t.Fatalf("CountSearchOtherModeVideos: %v", err)
	}
	if total != 4 {
		t.Fatalf("global search total = %d, want 4", total)
	}
}

func TestListVideosWithOptionsExcludesOtherModeDirectories(t *testing.T) {
	otherDir, videoDir := otherModeFixture(t)
	ctx := context.Background()

	withOther, err := ListVideosWithOptions(ctx, 50, 0, nil, "", "recent", VideoQueryOptions{})
	if err != nil {
		t.Fatalf("ListVideosWithOptions all: %v", err)
	}
	if len(withOther) != 5 {
		t.Fatalf("all videos = %d, want 5", len(withOther))
	}

	// 视频模式必须看不到其它模式目录里的任何视频（包含深层子文件夹里的）。
	excluded, err := ListVideosWithOptions(ctx, 50, 0, nil, "", "recent", VideoQueryOptions{ExcludeMode: models.DirectoryModeOther})
	if err != nil {
		t.Fatalf("ListVideosWithOptions exclude other: %v", err)
	}
	if len(excluded) != 1 || excluded[0].DirectoryID != videoDir.ID {
		t.Fatalf("excluded videos = %#v, want only the video-mode row", excluded)
	}

	count, err := CountVideosWithOptions(ctx, nil, "", VideoQueryOptions{ExcludeMode: models.DirectoryModeOther})
	if err != nil {
		t.Fatalf("CountVideosWithOptions exclude other: %v", err)
	}
	if count != 1 {
		t.Fatalf("excluded count = %d, want 1", count)
	}
	if otherDir.ID == 0 {
		t.Fatal("fixture did not create the other-mode directory")
	}
}
