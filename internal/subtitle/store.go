package subtitle

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
)

// RootDirName is the directory below the JavBoss data directory that holds
// every downloaded subtitle. subtitle/<video_id>/<file> keeps one video's
// subtitles together and makes cleanup trivial.
const RootDirName = "subtitle"

const (
	maxBaseNameRunes = 80
	fallbackBaseName = "subtitle"
)

// Dir returns the on-disk directory holding one video's subtitles.
func Dir(dataDir string, videoID int64) string {
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" || videoID <= 0 {
		return ""
	}
	return filepath.Join(dataDir, RootDirName, strconv.FormatInt(videoID, 10))
}

// FilePath returns the on-disk path of one stored subtitle. The file name is
// reduced to its base name so a crafted value can never escape the directory.
func FilePath(dataDir string, videoID int64, filename string) string {
	dir := Dir(dataDir, videoID)
	if dir == "" {
		return ""
	}
	name := filepath.Base(strings.TrimSpace(filename))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return ""
	}
	return filepath.Join(dir, name)
}

// SafeBaseName turns a provider file name into a file-system safe base name
// without an extension.
func SafeBaseName(name string) string {
	base, _ := splitFileName(name)
	base = strings.TrimSpace(base)
	if base == "" {
		return fallbackBaseName
	}
	var out strings.Builder
	lastSpace := false
	for _, r := range base {
		switch {
		// Commas are dropped on purpose: mpv's --sub-files takes a comma
		// separated list, so a comma inside a file name would be ambiguous.
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' ||
			r == '<' || r == '>' || r == '|' || r == ',' || unicode.IsControl(r):
			continue
		case unicode.IsSpace(r):
			if !lastSpace && out.Len() > 0 {
				out.WriteRune(' ')
				lastSpace = true
			}
		default:
			out.WriteRune(r)
			lastSpace = false
		}
	}
	cleaned := strings.Trim(out.String(), " .")
	cleaned = trimRunes(cleaned, maxBaseNameRunes)
	if cleaned == "" {
		return fallbackBaseName
	}
	return cleaned
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}

// safeSuffix keeps the leading alphanumeric characters of a provider id.
func safeSuffix(sourceID string) string {
	var out strings.Builder
	for _, r := range strings.TrimSpace(sourceID) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(unicode.ToLower(r))
		}
		if out.Len() >= 8 {
			break
		}
	}
	return out.String()
}

// AllocateFilename picks a file name inside dir that does not collide with an
// existing file. Identical names from different providers get the provider id as
// a suffix so both files stay on disk (a video may own several subtitles).
func AllocateFilename(dir, base, ext, sourceID string) (string, error) {
	if strings.TrimSpace(dir) == "" {
		return "", errors.New("subtitle directory is required")
	}
	cleanBase := SafeBaseName(base)
	if cleanBase == "" {
		cleanBase = fallbackBaseName
	}
	cleanExt := normalizeFormat(ext)
	if cleanExt == "" {
		cleanExt = FormatSRT
	}
	cleanExt = strings.TrimLeft(cleanExt, ".")

	candidates := []string{cleanBase + "." + cleanExt}
	if suffix := safeSuffix(sourceID); suffix != "" {
		candidates = append(candidates, fmt.Sprintf("%s-%s.%s", cleanBase, suffix, cleanExt))
		for index := 2; index <= 20; index++ {
			candidates = append(candidates, fmt.Sprintf("%s-%s-%d.%s", cleanBase, suffix, index, cleanExt))
		}
	} else {
		for index := 2; index <= 20; index++ {
			candidates = append(candidates, fmt.Sprintf("%s-%d.%s", cleanBase, index, cleanExt))
		}
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(dir, candidate)); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return candidate, nil
			}
			return "", fmt.Errorf("inspect subtitle target: %w", err)
		}
	}
	return "", errors.New("unable to allocate a subtitle file name")
}
