package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Store 是备份归档的存放位置。
//
// 备份可以落在本机目录（LocalStore），也可以落到扫描目录所在的 WebDAV 服务器上
// （见 internal/webdavstore），后端逻辑只依赖这个接口，不关心备份具体存在哪。
type Store interface {
	// List 返回该位置下本程序生成的备份文件，按时间倒序排列。
	List(ctx context.Context) ([]File, error)
	// Exists 判断某个备份文件名是否已存在，用于生成不重名的文件名。
	Exists(ctx context.Context, name string) (bool, error)
	// Put 产出名为 name 的备份：write 负责把归档内容写进传入的 writer。
	Put(ctx context.Context, name string, write func(io.Writer) error) (File, error)
	// Fetch 把备份文件复制/下载到本机 destPath，供恢复流程解压。
	Fetch(ctx context.Context, name, destPath string) error
	// Delete 删除该位置下的备份文件，只接受本程序生成的备份文件名。
	Delete(ctx context.Context, name string) error
	// Probe 验证该位置当前可读、可写、可列举，用于保存设置时提前报错。
	Probe(ctx context.Context) error
}

// LocalStore 把备份放在本机的一个目录里。
type LocalStore struct {
	Dir string
}

// NewLocalStore 返回本机目录形式的备份存放位置。
func NewLocalStore(dir string) *LocalStore {
	return &LocalStore{Dir: strings.TrimSpace(dir)}
}

// Dir 是备份目录里 name 对应的绝对路径。
func (s *LocalStore) filePath(name string) string {
	return filepath.Join(s.Dir, name)
}

func (s *LocalStore) List(ctx context.Context) ([]File, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.Dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read backup directory: %w", err)
	}
	files := make([]File, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !ValidFileName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, File{Name: entry.Name(), Size: info.Size(), ModifiedAt: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModifiedAt.After(files[j].ModifiedAt) })
	return files, nil
}

func (s *LocalStore) Exists(ctx context.Context, name string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if s.Dir == "" || !ValidFileName(name) {
		return false, nil
	}
	_, err := os.Stat(s.filePath(name))
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("inspect backup file: %w", err)
}

func (s *LocalStore) Put(ctx context.Context, name string, write func(io.Writer) error) (File, error) {
	if err := ctx.Err(); err != nil {
		return File{}, err
	}
	if !ValidFileName(name) {
		return File{}, fmt.Errorf("invalid backup file name %q", name)
	}
	if err := s.validateDir(); err != nil {
		return File{}, err
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return File{}, fmt.Errorf("create backup directory: %w", err)
	}
	// 先在备份目录里写临时文件，全部成功后再改名成正式文件，避免留下半个备份。
	workDir, err := os.MkdirTemp(s.Dir, ".backup-")
	if err != nil {
		return File{}, fmt.Errorf("create backup work directory: %w", err)
	}
	defer os.RemoveAll(workDir)

	stagingPath := filepath.Join(workDir, name)
	archive, err := os.Create(stagingPath)
	if err != nil {
		return File{}, fmt.Errorf("create backup archive: %w", err)
	}
	writeErr := write(archive)
	closeErr := archive.Close()
	if writeErr != nil {
		return File{}, writeErr
	}
	if closeErr != nil {
		return File{}, fmt.Errorf("close backup archive: %w", closeErr)
	}

	target := s.filePath(name)
	if err := os.Rename(stagingPath, target); err != nil {
		return File{}, fmt.Errorf("store backup archive: %w", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		return File{}, fmt.Errorf("inspect backup archive: %w", err)
	}
	return File{Name: name, Size: info.Size(), ModifiedAt: info.ModTime()}, nil
}

func (s *LocalStore) Fetch(ctx context.Context, name, destPath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !ValidFileName(name) {
		return fmt.Errorf("invalid backup file name %q", name)
	}
	if err := s.validateDir(); err != nil {
		return err
	}
	source := s.filePath(name)
	info, err := os.Stat(source)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("backup file %q does not exist", name)
		}
		return fmt.Errorf("inspect backup file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("backup file %q is not a regular file", name)
	}
	return copyFile(source, destPath)
}

func (s *LocalStore) Delete(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !ValidFileName(name) {
		return fmt.Errorf("invalid backup file name %q", name)
	}
	if err := s.validateDir(); err != nil {
		return err
	}
	target := s.filePath(name)
	info, err := os.Stat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("backup file %q does not exist", name)
		}
		return fmt.Errorf("inspect backup file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("backup file %q is not a regular file", name)
	}
	if err := os.Remove(target); err != nil {
		return fmt.Errorf("delete backup file: %w", err)
	}
	return nil
}

func (s *LocalStore) Probe(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.validateDir(); err != nil {
		return err
	}
	info, err := os.Stat(s.Dir)
	if err != nil {
		return fmt.Errorf("backup directory is not usable: %w", err)
	}
	if !info.IsDir() {
		return errors.New("backup directory is not a directory")
	}
	file, err := os.CreateTemp(s.Dir, ".javboss-write-test-")
	if err != nil {
		return fmt.Errorf("backup directory is not writable: %w", err)
	}
	name := file.Name()
	_ = file.Close()
	_ = os.Remove(name)
	return nil
}

func (s *LocalStore) validateDir() error {
	if s.Dir == "" {
		return errors.New("backup: backup directory is not configured")
	}
	if !filepath.IsAbs(s.Dir) {
		return errors.New("backup: backup directory must be an absolute path")
	}
	return nil
}
