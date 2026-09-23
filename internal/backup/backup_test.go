package backup

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	zip "github.com/yeka/zip"
)

const testPassword = "s3cret-pass"

func TestRunSkipsCacheToolsLockAndUsesSnapshot(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")

	writeTestFile(t, filepath.Join(dataDir, "cover", "a.jpg"), "cover-a")
	writeTestFile(t, filepath.Join(dataDir, "thumbnails", "b.jpg"), "thumb-b")
	writeTestFile(t, filepath.Join(dataDir, "cache", "streams", "seg.ts"), "cache-seg")
	writeTestFile(t, filepath.Join(dataDir, "tools", "windows-amd64", "ffmpeg.exe"), "ffmpeg")
	writeTestFile(t, filepath.Join(dataDir, RestoreDirName, unpackedDirName, "data", "stale"), "staged")
	writeTestFile(t, filepath.Join(dataDir, "javboss.lock"), "lock")
	writeTestFile(t, filepath.Join(dataDir, "javboss.db"), "live-db")
	writeTestFile(t, filepath.Join(dataDir, "javboss.db-wal"), "wal")

	store := NewLocalStore(backupDir)
	file, err := Run(context.Background(), Options{
		DataDir:      dataDir,
		DatabaseName: "javboss.db",
		Store:        store,
		Password:     testPassword,
		Snapshot: func(_ context.Context, destPath string) error {
			return os.WriteFile(destPath, []byte("snapshot-db"), 0o644)
		},
	})
	if err != nil {
		t.Fatalf("run backup: %v", err)
	}
	if !ValidFileName(file.Name) {
		t.Fatalf("backup file name %q is not recognized", file.Name)
	}
	if file.Size <= 0 {
		t.Fatalf("backup size = %d", file.Size)
	}

	entries := readArchiveEntries(t, filepath.Join(backupDir, file.Name), testPassword)
	if got := entries["data/cover/a.jpg"]; got != "cover-a" {
		t.Fatalf("cover entry = %q", got)
	}
	if got := entries["data/thumbnails/b.jpg"]; got != "thumb-b" {
		t.Fatalf("thumbnail entry = %q", got)
	}
	// 运行中的库必须换成一致性快照
	if got := entries["data/javboss.db"]; got != "snapshot-db" {
		t.Fatalf("database entry = %q", got)
	}
	for _, skipped := range []string{
		"data/cache/streams/seg.ts",
		"data/tools/windows-amd64/ffmpeg.exe",
		"data/restore/unpacked/data/stale",
		"data/javboss.lock",
		"data/javboss.db-wal",
	} {
		if _, ok := entries[skipped]; ok {
			t.Fatalf("backup should not contain %s", skipped)
		}
	}

	// 列表只返回本程序生成的备份
	files, err := store.List(context.Background())
	if err != nil {
		t.Fatalf("list backups: %v", err)
	}
	if len(files) != 1 || files[0].Name != file.Name {
		t.Fatalf("backup list = %#v", files)
	}
	writeTestFile(t, filepath.Join(backupDir, "other.zip"), "not ours")
	if files, err = store.List(context.Background()); err != nil || len(files) != 1 {
		t.Fatalf("backup list after unrelated file = %#v (%v)", files, err)
	}
	if err := store.Delete(context.Background(), file.Name); err != nil {
		t.Fatalf("delete backup: %v", err)
	}
	if err := store.Delete(context.Background(), "../escape.zip"); err == nil {
		t.Fatal("delete accepted a path-traversing name")
	}
	// 备份目录落在 data 里时不能把自己打包进去
	nestedDir := filepath.Join(dataDir, "backups")
	nested, err := Run(context.Background(), Options{
		DataDir:      dataDir,
		DatabaseName: "javboss.db",
		Store:        NewLocalStore(nestedDir),
		Snapshot: func(_ context.Context, destPath string) error {
			return os.WriteFile(destPath, []byte("snapshot-db"), 0o644)
		},
	})
	if err != nil {
		t.Fatalf("run backup inside data dir: %v", err)
	}
	reader, err := zip.OpenReader(filepath.Join(nestedDir, nested.Name))
	if err != nil {
		t.Fatalf("open nested backup archive: %v", err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if strings.HasPrefix(entry.Name, DataRootName+"/backups/") {
			t.Fatalf("backup packed itself: %s", entry.Name)
		}
	}
}

func TestStageAndApplyRestore(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")

	writeTestFile(t, filepath.Join(dataDir, "cover", "a.jpg"), "cover-a")
	writeTestFile(t, filepath.Join(dataDir, "subtitle", "s.srt"), "subtitle-s")

	file := runTestBackup(t, dataDir, backupDir, testPassword)

	// 打包后再改动 data 目录，恢复时应当被备份里的内容覆盖回来
	writeTestFile(t, filepath.Join(dataDir, "cover", "a.jpg"), "changed")
	if err := os.RemoveAll(filepath.Join(dataDir, "subtitle")); err != nil {
		t.Fatalf("remove subtitle dir: %v", err)
	}
	writeTestFile(t, filepath.Join(dataDir, "javboss.db-wal"), "stale-wal")

	archivePath := filepath.Join(backupDir, file.Name)
	pending, err := Stage(context.Background(), RestoreOptions{
		DataDir: dataDir, DatabaseName: "javboss.db", ArchivePath: archivePath,
		FileName: file.Name, Password: testPassword,
	})
	if err != nil {
		t.Fatalf("stage restore: %v", err)
	}
	if pending.FileName != file.Name || pending.FileCount != 3 {
		t.Fatalf("pending = %#v", pending)
	}
	stored, err := ReadPending(dataDir)
	if err != nil || stored == nil || stored.FileName != file.Name {
		t.Fatalf("pending marker = %#v (%v)", stored, err)
	}
	// 重启之前 data 目录不能被动过
	if got := readTestFile(t, filepath.Join(dataDir, "cover", "a.jpg")); got != "changed" {
		t.Fatalf("data changed before restart: %q", got)
	}

	result := ApplyPending(dataDir, "javboss.db")
	if result.Error != "" {
		t.Fatalf("apply pending restore: %s", result.Error)
	}
	if result.FileName != file.Name || result.FileCount != 3 {
		t.Fatalf("apply result = %#v", result)
	}
	if got := readTestFile(t, filepath.Join(dataDir, "cover", "a.jpg")); got != "cover-a" {
		t.Fatalf("restored cover = %q", got)
	}
	if got := readTestFile(t, filepath.Join(dataDir, "subtitle", "s.srt")); got != "subtitle-s" {
		t.Fatalf("restored subtitle = %q", got)
	}
	// 旧库的 WAL 必须清掉，否则新库会读到废弃的 WAL
	if _, err := os.Stat(filepath.Join(dataDir, "javboss.db-wal")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("stale wal still exists (%v)", err)
	}
	if stored, err := ReadPending(dataDir); err != nil || stored != nil {
		t.Fatalf("pending marker after apply = %#v (%v)", stored, err)
	}
	applied, err := ReadApplied(dataDir)
	if err != nil || applied == nil || applied.FileName != file.Name {
		t.Fatalf("applied marker = %#v (%v)", applied, err)
	}
	// 复制到程序目录的备份文件用完即删，备份目录里的原文件全程保留
	if _, err := os.Stat(filepath.Join(dataDir, RestoreDirName, sourceFileName)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("staged archive copy still exists (%v)", err)
	}
	if _, err := os.Stat(archivePath); err != nil {
		t.Fatalf("original backup file is gone: %v", err)
	}
	if err := AcknowledgeApplied(dataDir); err != nil {
		t.Fatalf("acknowledge applied: %v", err)
	}
	if applied, err := ReadApplied(dataDir); err != nil || applied != nil {
		t.Fatalf("applied marker after acknowledge = %#v (%v)", applied, err)
	}
	// 没有待恢复标记时再启动一次不应做任何事
	if empty := ApplyPending(dataDir, "javboss.db"); empty.FileName != "" {
		t.Fatalf("unexpected apply without pending marker: %#v", empty)
	}
}

func TestStageRejectsWrongPassword(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	writeTestFile(t, filepath.Join(dataDir, "cover", "a.jpg"), "cover-a")
	file := runTestBackup(t, dataDir, backupDir, testPassword)

	_, err := Stage(context.Background(), RestoreOptions{
		DataDir: dataDir, DatabaseName: "javboss.db",
		ArchivePath: filepath.Join(backupDir, file.Name), FileName: file.Name, Password: "wrong",
	})
	if !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("stage with wrong password = %v", err)
	}
	// 失败时不能留下待恢复标记或半个解压结果
	if stored, err := ReadPending(dataDir); err != nil || stored != nil {
		t.Fatalf("pending marker after failure = %#v (%v)", stored, err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, RestoreDirName, unpackedDirName)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("staged data after failure exists (%v)", err)
	}
}

func TestStageRequiresPasswordForEncryptedArchive(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	backupDir := filepath.Join(root, "backups")
	writeTestFile(t, filepath.Join(dataDir, "cover", "a.jpg"), "cover-a")
	file := runTestBackup(t, dataDir, backupDir, testPassword)

	_, err := Stage(context.Background(), RestoreOptions{
		DataDir: dataDir, DatabaseName: "javboss.db",
		ArchivePath: filepath.Join(backupDir, file.Name), FileName: file.Name,
	})
	if err == nil || !strings.Contains(err.Error(), "password") {
		t.Fatalf("stage without password = %v", err)
	}
}

func TestStageRejectsEntriesOutsideData(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("create data dir: %v", err)
	}
	archivePath := filepath.Join(root, FileNamePrefix+"20260923-101010"+FileExt)
	archive, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	zipw := zip.NewWriter(archive)
	for name, content := range map[string]string{
		"data/javboss.db": "db",
		"escape.txt":      "nope",
	} {
		writer, err := zipw.Create(name)
		if err != nil {
			t.Fatalf("create entry %s: %v", name, err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatalf("write entry %s: %v", name, err)
		}
	}
	if err := zipw.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive file: %v", err)
	}

	_, err = Stage(context.Background(), RestoreOptions{
		DataDir: dataDir, DatabaseName: "javboss.db",
		ArchivePath: archivePath, FileName: filepath.Base(archivePath),
	})
	if err == nil || !strings.Contains(err.Error(), "outside the data directory") {
		t.Fatalf("stage with escaping entry = %v", err)
	}
}

func runTestBackup(t *testing.T, dataDir, backupDir, password string) File {
	t.Helper()
	writeTestFile(t, filepath.Join(dataDir, "javboss.db"), "live-db")
	file, err := Run(context.Background(), Options{
		DataDir:      dataDir,
		DatabaseName: "javboss.db",
		Store:        NewLocalStore(backupDir),
		Password:     password,
		Snapshot: func(_ context.Context, destPath string) error {
			return os.WriteFile(destPath, []byte("snapshot-db"), 0o644)
		},
	})
	if err != nil {
		t.Fatalf("run backup: %v", err)
	}
	return file
}

func TestLocalStoreValidatesLocation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	store := NewLocalStore(dir)
	// 目录还不存在时探测必须失败，用户才知道要换一个位置
	if err := store.Probe(context.Background()); err == nil {
		t.Fatal("probe accepted a missing directory")
	}
	// 相对路径直接被拒，避免把备份写到进程当前目录
	failing := NewLocalStore("relative")
	if _, err := failing.Put(context.Background(), "javboss-backup-x.zip", func(io.Writer) error {
		return nil
	}); err == nil {
		t.Fatal("put accepted a relative directory")
	}

	if _, err := store.Put(context.Background(), "javboss-backup-x.zip", func(w io.Writer) error {
		_, err := w.Write([]byte("payload"))
		return err
	}); err != nil {
		t.Fatalf("put into a new directory: %v", err)
	}
	if err := store.Probe(context.Background()); err != nil {
		t.Fatalf("probe after put: %v", err)
	}
	if err := store.Delete(context.Background(), "javboss-backup-x.zip"); err != nil {
		t.Fatalf("delete backup: %v", err)
	}
	if err := store.Delete(context.Background(), "javboss-backup-x.zip"); err == nil {
		t.Fatal("delete accepted a file that does not exist")
	}
}

// readArchiveEntries 用密码读出压缩包里的全部文件，顺带验证加密标记。
func readArchiveEntries(t *testing.T, archivePath, password string) map[string]string {
	t.Helper()
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	defer reader.Close()

	entries := make(map[string]string, len(reader.File))
	for _, file := range reader.File {
		if strings.HasSuffix(file.Name, "/") {
			continue
		}
		if !file.IsEncrypted() {
			t.Fatalf("archive entry %s is not encrypted", file.Name)
		}
		file.SetPassword(password)
		reader, err := file.Open()
		if err != nil {
			t.Fatalf("open entry %s: %v", file.Name, err)
		}
		content, err := io.ReadAll(reader)
		_ = reader.Close()
		if err != nil {
			t.Fatalf("read entry %s: %v", file.Name, err)
		}
		entries[file.Name] = string(content)
	}
	return entries
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func readTestFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(content)
}
