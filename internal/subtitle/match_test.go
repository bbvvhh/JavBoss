package subtitle

import "testing"

func TestNameKeyDropsExtensionCaseAndSeparators(t *testing.T) {
	cases := map[string]string{
		"ABP-001.mp4":            "abp001",
		"abp_001.SRT":            "abp001",
		"ABP 001.mkv":            "abp001",
		"SSIS-001-C-chinese.srt": "ssis001cchinese",
		"":                       "",
		"   ":                    "",
		"花子.mp4":                 "花子",
	}
	for input, want := range cases {
		if got := NameKey(input); got != want {
			t.Fatalf("NameKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestMatchTierPrefersExactThenPartialNames(t *testing.T) {
	cases := []struct {
		name     string
		result   string
		video    string
		wantTier int
	}{
		{"完全同名", "ABP-001.srt", "ABP-001.mp4", TierExactName},
		{"仅分隔符不同", "abp_001.SRT", "ABP-001.mp4", TierExactName},
		{"字幕名包含视频名", "ABP-001-HD 中文字幕.srt", "ABP-001.mp4", TierPartialName},
		{"视频名包含字幕名", "ABP-001.srt", "ABP-001-HD 中文字幕.mp4", TierPartialName},
		{"完全无关", "other.srt", "ABP-001.mp4", TierNoName},
		{"视频名太短不做包含匹配", "AB-1.srt", "AB.mp4", TierNoName},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MatchTier(tc.result, tc.video); got != tc.wantTier {
				t.Fatalf("MatchTier(%q, %q) = %d, want %d", tc.result, tc.video, got, tc.wantTier)
			}
		})
	}
}

// 需求：优先按文件名匹配；同名多份时按视频时长与字幕时长最接近的取。
func TestPickBestPrefersFileNameOverCloserDuration(t *testing.T) {
	results := []SearchResult{
		{Name: "ABP-001.srt", DurationMS: 7_470_000, SourceID: "name-match"},
		{Name: "unrelated-release.srt", DurationMS: 7_467_301, SourceID: "closer-duration"},
	}
	best, ok := PickBest(results, "ABP-001.mp4", 7_467_301)
	if !ok {
		t.Fatal("PickBest returned no result")
	}
	if best.SourceID != "name-match" {
		t.Fatalf("best = %q, want the file name match", best.SourceID)
	}
}

func TestPickBestBreaksSameNameTiesByDuration(t *testing.T) {
	results := []SearchResult{
		{Name: "ABP-001.srt", DurationMS: 5_673_000, SourceID: "far"},
		{Name: "ABP-001.srt", DurationMS: 7_467_400, SourceID: "exact"},
		{Name: "ABP-001.srt", DurationMS: 7_468_000, SourceID: "close"},
	}
	best, ok := PickBest(results, "ABP-001.mp4", 7_467_301)
	if !ok {
		t.Fatal("PickBest returned no result")
	}
	if best.SourceID != "exact" {
		t.Fatalf("best = %q, want the closest duration", best.SourceID)
	}
}

func TestPickBestFallsBackToClosestDurationWithoutNameMatch(t *testing.T) {
	results := []SearchResult{
		{Name: "alpha.srt", DurationMS: 1_000_000, SourceID: "far"},
		{Name: "beta.srt", DurationMS: 0, SourceID: "unknown"},
		{Name: "gamma.srt", DurationMS: 7_400_000, SourceID: "close"},
	}
	best, ok := PickBest(results, "ABP-001.mp4", 7_467_301)
	if !ok {
		t.Fatal("PickBest returned no result")
	}
	if best.SourceID != "close" {
		t.Fatalf("best = %q, want the closest duration", best.SourceID)
	}

	// 时长为 0 的字幕排在有duration的字幕之后，但不能让整个选择失败。
	ranked := RankResults(results, "ABP-001.mp4", 7_467_301)
	if ranked[len(ranked)-1].Result.SourceID != "unknown" {
		t.Fatalf("result without duration should rank last: %+v", ranked)
	}
}

func TestPickBestOnEmptyResults(t *testing.T) {
	if _, ok := PickBest(nil, "ABP-001.mp4", 1000); ok {
		t.Fatal("PickBest must report no result for an empty list")
	}
}
