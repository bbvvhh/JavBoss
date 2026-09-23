package backup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	zip "github.com/yeka/zip"
)

const (
	pendingFileName = "pending.json"
	appliedFileName = "applied.json"
	unpackedDirName = "unpacked"
	sourceFileName  = "source" + FileExt
)

// ErrWrongPassword 表示加密条目解不开：密码不对，或备份文件已损坏。
var ErrWrongPassword = errors.New("backup: cannot decrypt backup archive")

// Pending 描述一份已暂存、等待重启生效的恢复。
type Pending struct {
	FileName  string    `json:"file_name"`
	StagedAt  time.Time `json:"staged_at"`
	FileCount int       `json:"file_count"`
	TotalSize int64     `json:"total_size"`
}

// AppliedResult 描述最近一次启动时落地的恢复结果。前端提示后调用 AcknowledgeApplied 清除。
type AppliedResult struct {
	FileName  string    `json:"file_name"`
	AppliedAt time.Time `json:"applied_at"`
	FileCount int       `json:"file_count"`
	Error     string    `json:"error"`
}

// RestoreOptions 描述一次「恢复准备」的输入。
type RestoreOptions struct {
	DataDir      string
	DatabaseName string
	// ArchivePath 是备份目录里那份备份文件的绝对路径，恢复过程不会改动它。
	ArchivePath string
	FileName    string
	Password    string
}

// Stage 把备份文件复制到 data/restore 下解压，并写下待恢复标记。
//
// 不直接覆盖 data 目录：数据库在运行中被替换会出错，所以真正的覆盖放到下次启动、
// 数据库打开之前完成（见 ApplyPending）。
func Stage(ctx context.Context, opts RestoreOptions) (Pending, error) {
	stageDir, err := opts.validate()
	if err != nil {
		return Pending{}, err
	}
	reader, err := zip.OpenReader(opts.ArchivePath)
	if err != nil {
		return Pending{}, fmt.Errorf("open backup archive: %w", err)
	}
	defer reader.Close()

	entries, err := validateEntries(reader.File, opts.DatabaseName)
	if err != nil {
		return Pending{}, err
	}
	if err := ensurePasswordAvailable(entries, opts.Password); err != nil {
		return Pending{}, err
	}

	// 重新暂存前先清掉上一次的中间产物，避免两次恢复叠加。
	unpackedDir := filepath.Join(stageDir, unpackedDirName)
	if err := os.RemoveAll(unpackedDir); err != nil {
		return Pending{}, fmt.Errorf("clean staged restore data: %w", err)
	}
	if err := os.MkdirAll(unpackedDir, 0o755); err != nil {
		return Pending{}, fmt.Errorf("create staged restore directory: %w", err)
	}
	if err := os.Remove(filepath.Join(stageDir, pendingFileName)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Pending{}, fmt.Errorf("clear previous restore marker: %w", err)
	}
	// 先把备份文件复制到程序目录，再解压；备份位置里的原文件全程只读。
	// 远程备份已经由 Store.Fetch 直接下载到这个位置，就不用再自己复制自己了。
	sourcePath := filepath.Join(stageDir, sourceFileName)
	if !samePath(opts.ArchivePath, sourcePath) {
		if err := copyFile(opts.ArchivePath, sourcePath); err != nil {
			return Pending{}, err
		}
	}

	pending := Pending{FileName: opts.FileName, StagedAt: time.Now(), FileCount: len(entries)}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return Pending{}, err
		}
		written, err := extractEntry(entry, unpackedDir, opts.Password)
		if err != nil {
			// 解压失败时清掉暂存，绝不能留下半个待恢复的目录。
			cleanupStaging(stageDir)
			return Pending{}, err
		}
		pending.TotalSize += written
	}
	if err := writeJSON(filepath.Join(stageDir, pendingFileName), pending); err != nil {
		cleanupStaging(stageDir)
		return Pending{}, err
	}
	return pending, nil
}

// ApplyPending 在启动早期（打开数据库之前）把暂存的恢复覆盖到 data 目录。
//
// Applied 为 true 表示这次启动确实处理过一次恢复；处理结果（含失败原因）写进
// applied.json，前端读到后提示用户，然后调用 AcknowledgeApplied 清除。
func ApplyPending(dataDir, databaseName string) AppliedResult {
	stageDir := filepath.Join(dataDir, RestoreDirName)
	pending, ok, err := readPending(stageDir)
	if err != nil || !ok {
		return AppliedResult{}
	}

	result := AppliedResult{FileName: pending.FileName, AppliedAt: time.Now()}
	source := filepath.Join(stageDir, unpackedDirName, DataRootName)
	switch err := copyTree(source, dataDir); {
	case err != nil:
		result.Error = err.Error()
	default:
		// 旧库留下的 WAL/SHM 属于被覆盖掉的数据库，必须清掉，
		// 否则新库第一次打开时会读到废弃的 WAL。
		if err := removeDatabaseSidecars(dataDir, databaseName); err != nil {
			result.Error = err.Error()
		} else {
			result.FileCount = pending.FileCount
		}
	}

	// 无论成败都清掉暂存目录（含复制进来的备份文件和待恢复标记）：失败的话
	// 用户可以在界面上重新恢复一次，而不是每次启动都重试一遍坏数据。
	if err := os.RemoveAll(stageDir); err != nil {
		result.Error = strings.TrimSpace(result.Error + "; " + err.Error())
	}
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		result.Error = strings.TrimSpace(result.Error + "; " + err.Error())
		return result
	}
	if err := writeJSON(filepath.Join(stageDir, appliedFileName), result); err != nil {
		result.Error = strings.TrimSpace(result.Error + "; " + err.Error())
	}
	return result
}

// StageSourcePath 是 Stage 放「本次要恢复的归档」的绝对路径。
//
// 远程备份可以先 Store.Fetch 到这里，再交给 Stage，避免下载完再本机复制一份。
func StageSourcePath(dataDir string) string {
	return filepath.Join(dataDir, RestoreDirName, sourceFileName)
}

// ReadPending 返回待生效的恢复；没有则返回 nil。
func ReadPending(dataDir string) (*Pending, error) {
	pending, ok, err := readPending(filepath.Join(dataDir, RestoreDirName))
	if err != nil || !ok {
		return nil, err
	}
	return &pending, nil
}

// ReadApplied 返回最近一次恢复的结果；没有则返回 nil。
func ReadApplied(dataDir string) (*AppliedResult, error) {
	var result AppliedResult
	err := readJSON(filepath.Join(dataDir, RestoreDirName, appliedFileName), &result)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// AcknowledgeApplied 清除最近一次恢复的结果标记。
func AcknowledgeApplied(dataDir string) error {
	err := os.Remove(filepath.Join(dataDir, RestoreDirName, appliedFileName))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("clear restore result: %w", err)
	}
	return nil
}

func (o RestoreOptions) validate() (string, error) {
	if !filepath.IsAbs(o.DataDir) {
		return "", errors.New("restore: data directory must be an absolute path")
	}
	if o.DatabaseName == "" || filepath.Base(o.DatabaseName) != o.DatabaseName {
		return "", errors.New("restore: invalid database name")
	}
	if !filepath.IsAbs(o.ArchivePath) {
		return "", errors.New("restore: backup file must be an absolute path")
	}
	if !ValidFileName(o.FileName) {
		return "", fmt.Errorf("restore: invalid backup file name %q", o.FileName)
	}
	return filepath.Join(o.DataDir, RestoreDirName), nil
}

// validateEntries 校验压缩包内容并返回其中的文件条目。
func validateEntries(files []*zip.File, databaseName string) ([]*zip.File, error) {
	entries := make([]*zip.File, 0, len(files))
	hasDatabase := false
	for _, file := range files {
		rel, isDir, err := entryRelativePath(file.Name)
		if err != nil {
			return nil, err
		}
		if isDir {
			continue
		}
		if file.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("backup archive contains a symbolic link: %s", file.Name)
		}
		if rel == databaseName {
			hasDatabase = true
		}
		entries = append(entries, file)
	}
	if len(entries) == 0 {
		return nil, errors.New("backup archive is empty")
	}
	if !hasDatabase {
		return nil, fmt.Errorf("backup archive does not contain %s/%s", DataRootName, databaseName)
	}
	return entries, nil
}

func ensurePasswordAvailable(entries []*zip.File, password string) error {
	if password != "" {
		return nil
	}
	for _, entry := range entries {
		if entry.IsEncrypted() {
			return errors.New("backup archive is encrypted; a password is required")
		}
	}
	return nil
}

// entryRelativePath 校验压缩包条目名并返回它相对 data 根目录的路径。
// 所有条目都必须位于 data/ 之下，恢复时才可能只覆盖 data 目录。
func entryRelativePath(name string) (string, bool, error) {
	invalid := func() (string, bool, error) {
		return "", false, fmt.Errorf("invalid path in backup archive: %q", name)
	}
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, `\`) {
		return invalid()
	}
	isDir := strings.HasSuffix(name, "/")
	trimmed := strings.TrimSuffix(name, "/")
	clean := path.Clean(trimmed)
	if clean != trimmed || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return invalid()
	}
	if strings.Contains(clean, ":") {
		return invalid()
	}
	if clean == DataRootName {
		return "", true, nil
	}
	rel := strings.TrimPrefix(clean, DataRootName+"/")
	if rel == clean {
		return "", false, fmt.Errorf("backup archive entry %q is outside the data directory", name)
	}
	return rel, isDir, nil
}

func extractEntry(entry *zip.File, unpackedDir, password string) (int64, error) {
	rel, _, err := entryRelativePath(entry.Name)
	if err != nil {
		return 0, err
	}
	if entry.IsEncrypted() {
		entry.SetPassword(password)
	}
	source, err := entry.Open()
	if err != nil {
		return 0, fmt.Errorf("open archive entry %s: %w", entry.Name, err)
	}
	defer source.Close()

	target := filepath.Join(unpackedDir, DataRootName, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, fmt.Errorf("create restore directory: %w", err)
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, fmt.Errorf("create restored file: %w", err)
	}
	// 密码错误在 ZipCrypto 下表现为读完整个条目时 CRC 校验失败：加密条目读失败
	// 基本都是密码不对（或备份损坏），单独成一类错误让界面能给出人话提示。
	written, copyErr := io.Copy(file, source)
	closeErr := file.Close()
	if copyErr != nil {
		if entry.IsEncrypted() {
			return 0, fmt.Errorf("%w: %s", ErrWrongPassword, entry.Name)
		}
		return 0, fmt.Errorf("extract archive entry %s: %w", entry.Name, copyErr)
	}
	if closeErr != nil {
		return 0, fmt.Errorf("close restored file: %w", closeErr)
	}
	return written, nil
}

func copyTree(source, dest string) error {
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("inspect staged restore data: %w", err)
	}
	if !info.IsDir() {
		return errors.New("staged restore data is missing")
	}
	return filepath.WalkDir(source, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dest, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		return copyFile(current, target)
	})
}

func copyFile(source, dest string) error {
	in, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open %s: %w", source, err)
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create %s: %w", dest, err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return fmt.Errorf("copy to %s: %w", dest, err)
	}
	if err := out.Close(); err != nil {
		return fmt.Errorf("close %s: %w", dest, err)
	}
	return nil
}

func removeDatabaseSidecars(dataDir, databaseName string) error {
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		target := filepath.Join(dataDir, databaseName+suffix)
		if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove stale database file: %w", err)
		}
	}
	return nil
}

func cleanupStaging(stageDir string) {
	_ = os.RemoveAll(filepath.Join(stageDir, unpackedDirName))
	_ = os.Remove(filepath.Join(stageDir, sourceFileName))
	_ = os.Remove(filepath.Join(stageDir, pendingFileName))
}

func readPending(stageDir string) (Pending, bool, error) {
	var pending Pending
	err := readJSON(filepath.Join(stageDir, pendingFileName), &pending)
	if errors.Is(err, fs.ErrNotExist) {
		return Pending{}, false, nil
	}
	if err != nil {
		return Pending{}, false, err
	}
	return pending, true, nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return nil
}

func writeJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode %s: %w", filepath.Base(path), err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}
