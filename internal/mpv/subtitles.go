package mpv

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"javboss/internal/common/logging"
	"javboss/internal/subtitle"
)

// ErrPlayerNotRunning is returned when a subtitle cannot be pushed because the
// reusable mpv window is not playing anything.
var ErrPlayerNotRunning = errors.New("mpv player is not running")

const (
	// subtitleAttachTimeout bounds the retry loop used right after loadfile.
	subtitleAttachTimeout    = 3 * time.Second
	subtitleAttachRetryDelay = 100 * time.Millisecond
)

// SubtitleFilesForVideo lists the subtitles JavBoss downloaded for a video,
// oldest first: mpv exposes them in this order, and the newest one should end up
// selected.
//
// The path layout must stay in sync with internal/subtitle.Dir; it is why this
// package imports that one instead of rebuilding the path by hand.
func SubtitleFilesForVideo(dataDir string, videoID int64) []string {
	dir := subtitle.Dir(dataDir, videoID)
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	type candidate struct {
		path       string
		modifiedAt time.Time
	}
	candidates := make([]candidate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !subtitle.SupportedExtension(filepath.Ext(entry.Name())) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		candidates = append(candidates, candidate{
			path:       filepath.Join(dir, entry.Name()),
			modifiedAt: info.ModTime(),
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].modifiedAt.Equal(candidates[j].modifiedAt) {
			return candidates[i].path < candidates[j].path
		}
		return candidates[i].modifiedAt.Before(candidates[j].modifiedAt)
	})

	paths := make([]string, 0, len(candidates))
	for _, item := range candidates {
		paths = append(paths, item.path)
	}
	return paths
}

// buildSubtitleCLIArgs returns the --sub-file arguments used when mpv is
// launched as a fresh process.
//
// Verified against mpv 0.41: `--sub-file` may be repeated and appends one entry
// per occurrence, while the plural `--sub-files` REPLACES the list (and does not
// split on commas), so repeating the singular alias is the only form that keeps
// more than one subtitle.
func buildSubtitleCLIArgs(options PlayOptions) []string {
	files := SubtitleFilesForVideo(options.DataDir, options.VideoID)
	if len(files) == 0 {
		return nil
	}
	args := make([]string, 0, len(files))
	for _, file := range files {
		args = append(args, "--sub-file="+file)
	}
	return args
}

// subtitleLoadFileOptions returns the per-file "sub-files" value for the IPC
// loadfile command.
//
// The options map only accepts a single file per key (an array is rejected by
// mpv and fails the whole loadfile), so a playlist entry gets its newest
// subtitle; playVideoLocked adds the remaining ones with sub-add.
func subtitleLoadFileOptions(options PlayOptions) (string, bool) {
	files := SubtitleFilesForVideo(options.DataDir, options.VideoID)
	if len(files) == 0 {
		return "", false
	}
	return files[len(files)-1], true
}

// addRemainingSubtitles attaches every subtitle except the newest one to the
// file that was just loaded. The newest file already came from the loadfile
// options and stays selected.
//
// mpv can reject sub-add while the file is still being opened, so the command is
// retried briefly instead of being dropped.
func addRemainingSubtitles(ipcPath string, options PlayOptions) error {
	files := SubtitleFilesForVideo(options.DataDir, options.VideoID)
	if len(files) < 2 {
		return nil
	}
	pending := files[:len(files)-1]
	deadline := time.Now().Add(subtitleAttachTimeout)
	var lastErr error
	for len(pending) > 0 {
		failed := make([]string, 0, len(pending))
		for _, file := range pending {
			if err := runIPCCommand(ipcPath, []any{"sub-add", file, "auto"}); err != nil {
				lastErr = err
				failed = append(failed, file)
			}
		}
		if len(failed) == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			break
		}
		pending = failed
		time.Sleep(subtitleAttachRetryDelay)
	}
	return lastErr
}

// ReusablePlayerRunning reports whether the reusable mpv window is alive.
func ReusablePlayerRunning() bool {
	defaultSession.mu.Lock()
	defer defaultSession.mu.Unlock()
	return defaultSession.ipcPath != ""
}

// CurrentMediaPath returns the file the reusable MPV window plays right now.
func CurrentMediaPath() (string, error) {
	ipcPath, err := reusableIPC()
	if err != nil {
		return "", err
	}
	data, err := queryIPCCommand(ipcPath, []any{"get_property", "path"})
	if err != nil {
		return "", err
	}
	var path string
	if err := json.Unmarshal(data, &path); err != nil {
		return "", fmt.Errorf("decode mpv path: %w", err)
	}
	return path, nil
}

// IsPlayingMedia reports whether the reusable MPV window currently plays this
// exact file. It is what keeps "attach the subtitle I just downloaded" from
// touching a different video that happens to be playing.
func IsPlayingMedia(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	current, err := CurrentMediaPath()
	if err != nil {
		return false
	}
	return sameMediaPath(current, path)
}

// LoadSubtitleFile pushes one downloaded subtitle into the running MPV window and
// selects it. Any previously loaded copy of the same file is removed first so
// repeated clicks do not stack duplicate tracks.
func LoadSubtitleFile(path string) error {
	ipcPath, err := reusableIPC()
	if err != nil {
		return err
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("subtitle path is empty")
	}
	removeLoadedSubtitle(ipcPath, path)
	return runIPCCommand(ipcPath, []any{"sub-add", path, "select"})
}

// DisableSubtitles turns subtitle rendering off in the running MPV window.
func DisableSubtitles() error {
	ipcPath, err := reusableIPC()
	if err != nil {
		return err
	}
	return runIPCCommand(ipcPath, []any{"set_property", "sid", "no"})
}

func reusableIPC() (string, error) {
	defaultSession.mu.Lock()
	defer defaultSession.mu.Unlock()
	if defaultSession.ipcPath == "" || defaultSession.cmd == nil {
		return "", ErrPlayerNotRunning
	}
	return defaultSession.ipcPath, nil
}

func removeLoadedSubtitle(ipcPath, path string) {
	data, err := queryIPCCommand(ipcPath, []any{"get_property", "track-list"})
	if err != nil {
		logging.Error("read mpv track list failed: %v", err)
		return
	}
	var tracks []struct {
		ID               int64  `json:"id"`
		Type             string `json:"type"`
		ExternalFilename string `json:"external-filename"`
	}
	if err := json.Unmarshal(data, &tracks); err != nil {
		return
	}
	for _, track := range tracks {
		if track.Type != "sub" || !sameMediaPath(track.ExternalFilename, path) {
			continue
		}
		if err := runIPCCommand(ipcPath, []any{"sub-remove", track.ID}); err != nil {
			logging.Error("remove mpv subtitle %d failed: %v", track.ID, err)
		}
	}
}

func sameMediaPath(left, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if left == "" || right == "" {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}
