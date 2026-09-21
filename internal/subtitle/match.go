package subtitle

import (
	"sort"
	"strings"
	"unicode"
)

// Match tiers, best first.
const (
	TierExactName    = 0
	TierPartialName  = 1
	TierNoName       = 2
	partialNameFloor = 4
)

// NameKey normalizes a file name for comparison: the extension is dropped,
// every character that is not a letter or digit is removed and ASCII letters
// are lower-cased. "ABP-001.mp4" and "abp_001.SRT" therefore share "abp001".
func NameKey(name string) string {
	base, _ := splitFileName(name)
	if strings.TrimSpace(base) == "" {
		return ""
	}
	var out strings.Builder
	for _, r := range base {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(unicode.ToLower(r))
		}
	}
	return out.String()
}

// MatchTier scores how well a result's file name matches the video file name.
func MatchTier(resultName, videoFilename string) int {
	resultKey := NameKey(resultName)
	videoKey := NameKey(videoFilename)
	if resultKey == "" || videoKey == "" {
		return TierNoName
	}
	if resultKey == videoKey {
		return TierExactName
	}
	shorter, longer := resultKey, videoKey
	if len(shorter) > len(longer) {
		shorter, longer = longer, shorter
	}
	if len(shorter) < partialNameFloor {
		return TierNoName
	}
	if strings.Contains(longer, shorter) {
		return TierPartialName
	}
	return TierNoName
}

// ScoredResult pairs a search result with its ranking information.
type ScoredResult struct {
	Result SearchResult
	Tier   int
	// DurationDeltaMS is the absolute distance between the subtitle and video
	// duration, or -1 when either duration is unknown.
	DurationDeltaMS int64
}

// RankResults scores every result against the video and returns them sorted
// best-first. Ties keep the provider's own ordering, which already reflects its
// language preference.
func RankResults(results []SearchResult, videoFilename string, videoDurationMS int64) []ScoredResult {
	scored := make([]ScoredResult, 0, len(results))
	for _, result := range results {
		delta := int64(-1)
		if result.DurationMS > 0 && videoDurationMS > 0 {
			delta = result.DurationMS - videoDurationMS
			if delta < 0 {
				delta = -delta
			}
		}
		scored = append(scored, ScoredResult{
			Result:          result,
			Tier:            MatchTier(result.Name, videoFilename),
			DurationDeltaMS: delta,
		})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].Tier != scored[j].Tier {
			return scored[i].Tier < scored[j].Tier
		}
		left, right := scored[i].DurationDeltaMS, scored[j].DurationDeltaMS
		leftKnown, rightKnown := left >= 0, right >= 0
		if leftKnown != rightKnown {
			return leftKnown
		}
		if leftKnown && left != right {
			return left < right
		}
		return false
	})
	return scored
}

// PickBest selects the subtitle a one-click download should take: an exact file
// name match first, then a partial name match, and within the same tier the
// closest duration wins. Results without a duration rank last.
func PickBest(results []SearchResult, videoFilename string, videoDurationMS int64) (SearchResult, bool) {
	ranked := RankResults(results, videoFilename, videoDurationMS)
	if len(ranked) == 0 {
		return SearchResult{}, false
	}
	return ranked[0].Result, true
}
