package update

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"javboss/internal/backup"
	"javboss/internal/storage"
	"javboss/internal/webdavstore"
)

// Source 是发布包所在的位置：本机目录或 WebDAV 远程目录。
//
// 与备份不同，更新只读这个位置（发布包由用户手动上传），所以没有 Put/Delete。
type Source interface {
	// List 返回该位置里的发布包，按修改时间倒序。
	List(ctx context.Context) ([]Package, error)
	// Fetch 把发布包复制/下载到本机 destPath，供解压与校验使用。
	Fetch(ctx context.Context, name, destPath string) error
	// FetchSidecar 尽力取回 name 旁边的 .sha256 校验边车。
	// 没有边车时返回 false（放行校验），而不是当成错误。
	FetchSidecar(ctx context.Context, name, destPath string) (bool, error)
	// Probe 验证该位置当下可读，用于保存设置时提前报错。
	Probe(ctx context.Context) error
}

// LocalSource 把发布包放在本机的一个目录里。
type LocalSource struct {
	Dir string
}

// NewLocalSource 返回本机目录形式的发布包位置。
func NewLocalSource(dir string) *LocalSource {
	return &LocalSource{Dir: strings.TrimSpace(dir)}
}

func (s *LocalSource) List(ctx context.Context) ([]Package, error) {
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
		return nil, fmt.Errorf("read update directory: %w", err)
	}
	packages := make([]Package, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		pkg, ok := DescribePackage(entry.Name(), info.Size(), info.ModTime())
		if !ok {
			continue
		}
		packages = append(packages, pkg)
	}
	sortPackages(packages)
	return packages, nil
}

func (s *LocalSource) Fetch(ctx context.Context, name, destPath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	source, err := s.packagePath(name)
	if err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("update package %q does not exist", name)
		}
		return fmt.Errorf("inspect update package: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("update package %q is not a regular file", name)
	}
	return copyFile(source, destPath)
}

func (s *LocalSource) FetchSidecar(ctx context.Context, name, destPath string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	source, err := s.packagePath(name)
	if err != nil {
		return false, err
	}
	source += Sha256Ext
	info, err := os.Stat(source)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect checksum file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return false, nil
	}
	return true, copyFile(source, destPath)
}

func (s *LocalSource) Probe(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.validateDir(); err != nil {
		return err
	}
	if _, err := os.ReadDir(s.Dir); err != nil {
		return fmt.Errorf("update directory is not readable: %w", err)
	}
	return nil
}

func (s *LocalSource) validateDir() error {
	if s.Dir == "" {
		return errors.New("update: update directory is not configured")
	}
	if !filepath.IsAbs(s.Dir) {
		return errors.New("update: update directory must be an absolute path")
	}
	info, err := os.Stat(s.Dir)
	if err != nil {
		return fmt.Errorf("update directory is not usable: %w", err)
	}
	if !info.IsDir() {
		return errors.New("update directory is not a directory")
	}
	return nil
}

// packagePath 校验包名与目录后返回发布包在本机的绝对路径。
func (s *LocalSource) packagePath(name string) (string, error) {
	if !ValidPackageName(name) {
		return "", fmt.Errorf("invalid update package name %q", name)
	}
	if err := s.validateDir(); err != nil {
		return "", err
	}
	return filepath.Join(s.Dir, name), nil
}

// WebDAVSource 把发布包放在某个 WebDAV 连接的远程目录里。
type WebDAVSource struct {
	store *webdavstore.Store
}

// NewWebDAVSource 构建读取 conn 上 remotePath 目录的发布包位置。
func NewWebDAVSource(conn storage.Connection, remotePath string) (*WebDAVSource, error) {
	store, err := webdavstore.NewWithNameFilter(conn, remotePath, ValidSourceFileName)
	if err != nil {
		return nil, err
	}
	return &WebDAVSource{store: store}, nil
}

func (s *WebDAVSource) List(ctx context.Context) ([]Package, error) {
	return ListPackages(ctx, s.store)
}

func (s *WebDAVSource) Fetch(ctx context.Context, name, destPath string) error {
	if !ValidPackageName(name) {
		return fmt.Errorf("invalid update package name %q", name)
	}
	return s.store.Fetch(ctx, name, destPath)
}

func (s *WebDAVSource) FetchSidecar(ctx context.Context, name, destPath string) (bool, error) {
	if !ValidPackageName(name) {
		return false, fmt.Errorf("invalid update package name %q", name)
	}
	// 发布包目录多数是只读挂载，边车不存在是常态，不能当成错误。
	err := s.store.Fetch(ctx, name+Sha256Ext, destPath)
	if errors.Is(err, storage.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Probe 只验证远程目录存在且可读：发布包目录常常是只读挂载，不需要写权限。
func (s *WebDAVSource) Probe(ctx context.Context) error {
	if err := s.store.ExistsRoot(ctx); err != nil {
		return err
	}
	_, err := s.store.List(ctx)
	return err
}

// ListPackages 把一个 backup.Store 里的归档列成发布包，按修改时间倒序。
// 文件名规则由构造 store 时注入（WebDAV 侧是 ValidSourceFileName），
// 所以这里只负责过滤掉边车等非发布包条目。
func ListPackages(ctx context.Context, store backup.Store) ([]Package, error) {
	files, err := store.List(ctx)
	if err != nil {
		return nil, err
	}
	packages := make([]Package, 0, len(files))
	for _, file := range files {
		pkg, ok := DescribePackage(file.Name, file.Size, file.ModifiedAt)
		if !ok {
			continue
		}
		packages = append(packages, pkg)
	}
	sortPackages(packages)
	return packages, nil
}

// copyFile 复制一个普通文件，必要时创建目标目录。
func copyFile(source, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("create directory for %s: %w", filepath.Base(dest), err)
	}
	in, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open %s: %w", filepath.Base(source), err)
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create %s: %w", filepath.Base(dest), err)
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return fmt.Errorf("copy to %s: %w", filepath.Base(dest), err)
	}
	if err := out.Close(); err != nil {
		return fmt.Errorf("close %s: %w", filepath.Base(dest), err)
	}
	return nil
}
