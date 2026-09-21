package mpv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"javboss/internal/subtitle"
)

const sampleSRT = "1\n00:00:01,000 --> 00:00:04,500\nhello\n\n2\n00:00:05,000 --> 00:00:06,000\nworld\n"

// Opt in with JAVBOSS_TEST_MPV pointing at a real mpv binary. It proves that the
// downloaded subtitles really end up in mpv's track list, both for a fresh
// launch (--sub-files) and for a loadfile issued over IPC.
func TestSubtitleAttachmentWithRealMPV(t *testing.T) {
	if os.Getenv("JAVBOSS_TEST_MPV") == "" {
		t.Skip("set JAVBOSS_TEST_MPV to run the real MPV subtitle regression test")
	}
	t.Setenv(modernZEnvDir, writeModernZTestAssets(t))

	dataDir := t.TempDir()
	image, err := filepath.Abs("../../web/public/icon-192.png")
	if err != nil {
		t.Fatal(err)
	}
	videoID := int64(4242)
	// Two subtitles for the same video: the newer one must end up selected.
	first := writeTestSubtitle(t, dataDir, videoID, "ABP-001.srt", sampleSRT)
	second := writeTestSubtitle(t, dataDir, videoID, "ABP-001-zh.ass", sampleSRT)
	// Keep a deterministic order regardless of filesystem timestamp resolution.
	now := time.Now()
	_ = os.Chtimes(first, now.Add(-time.Minute), now.Add(-time.Minute))
	_ = os.Chtimes(second, now, now)

	options := PlayOptions{DataDir: dataDir, VideoID: videoID}
	files := SubtitleFilesForVideo(dataDir, videoID)
	if len(files) != 2 || files[0] != first || files[1] != second {
		t.Fatalf("SubtitleFilesForVideo = %v, want [%s %s]", files, first, second)
	}

	// --- fresh process path: --sub-files on the command line ------------------
	vicmd, endpoint, err := buildCommandWithIPC("", options)
	if err != nil {
		t.Fatal(err)
	}
	vicmd.Args = append(vicmd.Args, "--vo=null", "--ao=null", "--image-display-duration=inf")
	if err := vicmd.Start(); err != nil {
		t.Fatalf("start mpv: %v", err)
	}
	t.Cleanup(func() {
		_ = runIPCCommand(endpoint, []any{"quit"})
		_ = vicmd.Wait()
	})
	if err := waitForIPCReady(endpoint); err != nil {
		t.Fatalf("wait for ipc: %v", err)
	}
	if err := runIPCCommand(endpoint, []any{"loadfile", image, "replace"}); err != nil {
		t.Fatalf("loadfile: %v", err)
	}
	assertSubtitleTracks(t, endpoint, first, second)

	// --- IPC path: per-file "sub-files" in the loadfile options plus sub-add ---
	session := &playerSession{ipcPath: endpoint}
	if err := session.playVideoLocked(image, options); err != nil {
		t.Fatalf("playVideoLocked: %v", err)
	}
	assertSubtitleTracks(t, endpoint, first, second)

	// --- pushing a downloaded subtitle into the running window ----------------
	defaultSession.mu.Lock()
	defaultSession.cmd = vicmd
	defaultSession.ipcPath = endpoint
	defaultSession.mu.Unlock()
	t.Cleanup(func() {
		defaultSession.mu.Lock()
		defaultSession.cmd = nil
		defaultSession.ipcPath = ""
		defaultSession.mu.Unlock()
	})

	if !ReusablePlayerRunning() {
		t.Fatal("ReusablePlayerRunning() = false")
	}
	if err := LoadSubtitleFile(second); err != nil {
		t.Fatalf("LoadSubtitleFile: %v", err)
	}
	// Clicking twice must not stack duplicate tracks.
	if err := LoadSubtitleFile(second); err != nil {
		t.Fatalf("LoadSubtitleFile (repeat): %v", err)
	}
	tracks := subtitleTracks(t, endpoint)
	if got := countSubtitleTracks(tracks, second); got != 1 {
		t.Fatalf("loaded %d copies of %s, want 1 (track-list=%v)", got, second, tracks)
	}
	if sid, ok := readMPVTestProperty(t, endpoint, "sid").(float64); !ok || sid <= 0 {
		t.Fatalf("sid = %#v, want the added subtitle to be selected", readMPVTestProperty(t, endpoint, "sid"))
	}
	if err := DisableSubtitles(); err != nil {
		t.Fatalf("DisableSubtitles: %v", err)
	}
	// mpv reports "no" or false depending on how the property is read.
	if got := readMPVTestProperty(t, endpoint, "sid"); got != "no" && got != false {
		t.Fatalf("sid after DisableSubtitles = %#v, want no", got)
	}
	if path, err := CurrentMediaPath(); err != nil || !sameMediaPath(path, image) {
		t.Fatalf("CurrentMediaPath = %q (%v), want %q", path, err, image)
	}
	if !IsPlayingMedia(image) {
		t.Fatal("IsPlayingMedia must recognise the file that is playing")
	}
	if IsPlayingMedia(filepath.Join(filepath.Dir(image), "something-else.mp4")) {
		t.Fatal("IsPlayingMedia must reject a different file")
	}
}

func TestSubtitleAttachmentWithoutPlayer(t *testing.T) {
	if err := LoadSubtitleFile("whatever.srt"); err == nil {
		t.Fatal("expected an error when no reusable player is running")
	}
	if err := DisableSubtitles(); err == nil {
		t.Fatal("expected an error when no reusable player is running")
	}
}

func writeTestSubtitle(t *testing.T, dataDir string, videoID int64, name, content string) string {
	t.Helper()
	dir := subtitle.Dir(dataDir, videoID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func subtitleTracks(t *testing.T, endpoint string) []map[string]any {
	t.Helper()
	raw, ok := readMPVTestProperty(t, endpoint, "track-list").([]any)
	if !ok {
		t.Fatalf("track-list is not a list")
	}
	tracks := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		if track, ok := entry.(map[string]any); ok {
			tracks = append(tracks, track)
		}
	}
	return tracks
}

func countSubtitleTracks(tracks []map[string]any, path string) int {
	count := 0
	for _, track := range tracks {
		if track["type"] != "sub" {
			continue
		}
		filename, _ := track["external-filename"].(string)
		if sameMediaPath(filename, path) {
			count++
		}
	}
	return count
}

func assertSubtitleTracks(t *testing.T, endpoint string, want ...string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		tracks := subtitleTracks(t, endpoint)
		missing := ""
		for _, path := range want {
			if countSubtitleTracks(tracks, path) == 0 {
				missing = path
				break
			}
		}
		if missing == "" {
			return
		}
		if time.Now().After(deadline) {
			names := make([]string, 0, len(tracks))
			for _, track := range tracks {
				filename, _ := track["external-filename"].(string)
				names = append(names, strings.TrimSpace(strings.Join([]string{track["type"].(string), filename}, " ")))
			}
			t.Fatalf("subtitle %s never appeared in track-list: %v", missing, names)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
