package subtitle

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSafeBaseNameRemovesUnsafeCharacters(t *testing.T) {
	cases := map[string]string{
		"ABP-001.srt":             "ABP-001",
		`..\..\evil.srt`:          "evil",
		"/etc/passwd":             "passwd",
		`a:b*c?d"e<f>g|h.srt`:     "abcdefgh",
		"  trailing dots . . .  ": "trailing dots",
		"tab\tinside.srt":         "tabinside",
		"":                        "subtitle",
		"///":                     "subtitle",
		"ABP-001-HD 中文字幕 水咲ローラ.srt": "ABP-001-HD 中文字幕 水咲ローラ",
	}
	for input, want := range cases {
		if got := SafeBaseName(input); got != want {
			t.Fatalf("SafeBaseName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSafeBaseNameCapsLength(t *testing.T) {
	long := ""
	for i := 0; i < 200; i++ {
		long += "a"
	}
	got := SafeBaseName(long + ".srt")
	if len([]rune(got)) != maxBaseNameRunes {
		t.Fatalf("len = %d, want %d", len([]rune(got)), maxBaseNameRunes)
	}
}

func TestAllocateFilenameAvoidsCollisions(t *testing.T) {
	dir := t.TempDir()

	first, err := AllocateFilename(dir, "ABP-001.srt", "srt", "CID1")
	if err != nil {
		t.Fatalf("AllocateFilename: %v", err)
	}
	if first != "ABP-001.srt" {
		t.Fatalf("first = %q", first)
	}
	if err := os.WriteFile(filepath.Join(dir, first), []byte("a"), 0o644); err != nil {
		t.Fatalf("write first: %v", err)
	}

	second, err := AllocateFilename(dir, "ABP-001.srt", "srt", "CID2")
	if err != nil {
		t.Fatalf("AllocateFilename: %v", err)
	}
	if second != "ABP-001-cid2.srt" {
		t.Fatalf("second = %q, want the provider id suffix", second)
	}
	if err := os.WriteFile(filepath.Join(dir, second), []byte("b"), 0o644); err != nil {
		t.Fatalf("write second: %v", err)
	}

	third, err := AllocateFilename(dir, "ABP-001.srt", "srt", "CID2")
	if err != nil {
		t.Fatalf("AllocateFilename: %v", err)
	}
	if third != "ABP-001-cid2-2.srt" {
		t.Fatalf("third = %q", third)
	}
}

func TestAllocateFilenameFallsBackToSRT(t *testing.T) {
	dir := t.TempDir()
	got, err := AllocateFilename(dir, "movie", "", "")
	if err != nil {
		t.Fatalf("AllocateFilename: %v", err)
	}
	if got != "movie.srt" {
		t.Fatalf("got = %q", got)
	}
}

func TestFilePathStaysInsideTheVideoDirectory(t *testing.T) {
	dataDir := t.TempDir()
	got := FilePath(dataDir, 42, "../../../etc/passwd")
	want := filepath.Join(dataDir, RootDirName, "42", "passwd")
	if got != want {
		t.Fatalf("FilePath = %q, want %q", got, want)
	}
	if FilePath(dataDir, 0, "a.srt") != "" {
		t.Fatal("invalid video id must yield an empty path")
	}
}

func TestDirLayout(t *testing.T) {
	dataDir := t.TempDir()
	got := Dir(dataDir, 7)
	want := filepath.Join(dataDir, "subtitle", "7")
	if got != want {
		t.Fatalf("Dir = %q, want %q", got, want)
	}
}
