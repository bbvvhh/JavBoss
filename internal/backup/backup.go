// Package backup 负责把 data 目录打包成加密备份，以及把备份恢复到 data 目录。
//
// 打包范围是「整个 data 目录减去四类东西」：
//   - data/cache、data/tools：可再生缓存与按平台架构下载的工具二进制；
//   - data/restore：本包自己的恢复暂存目录（否则会把备份自己打进备份里）；
//   - javboss.lock 等单实例锁。
//
// 另外运行中的 SQLite 库开了 WAL，直接按文件复制会得到半写状态的快照，
// 所以库文件一律用 VACUUM INTO 导出的副本替换（见 Options.Snapshot）。
package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	zip "github.com/yeka/zip"
)

const (
	// FileNamePrefix 是备份文件名前缀，只有带该前缀的 .zip 才会出现在恢复列表里。
	FileNamePrefix = "javboss-backup-"
	// FileExt 是备份文件扩展名。
	FileExt = ".zip"
	// MaxPasswordLength 限制压缩密码长度。
	MaxPasswordLength = 128

	// DataRootName 是压缩包内所有条目的顶层目录名，解压后对应程序的 data 目录。
	DataRootName = "data"
	// RestoreDirName 是 data 下的恢复暂存目录。
	RestoreDirName = "restore"
	// UpdateDirName 是 data 下的程序更新暂存/回滚目录（见 internal/update）。
	UpdateDirName = "update"

	fileNameTimeLayout = "20060102-150405"
)

// 打包时跳过的 data 顶层子目录。
var excludedTopDirs = map[string]struct{}{
	"cache": {},
	"tools": {},
	// 暂存目录必须排除，否则备份会把自己包含进去。
	RestoreDirName: {},
	// 更新暂存目录里是刚解压的发布包与被覆盖文件的回滚副本，同样不能进备份：
	// 否则备份体积暴涨，恢复后还会把旧的程序文件带回来。
	UpdateDirName: {},
}

// 打包时跳过的 data 顶层文件（单实例锁）。
var excludedTopFiles = map[string]struct{}{
	"javboss.lock":  {},
	"pornboss.lock": {},
}

// File 描述一个已存在的备份文件。
type File struct {
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

// Options 描述一次打包所需的输入。
type Options struct {
	DataDir      string
	DatabaseName string
	Password     string
	// Store 决定归档写到哪里。
	Store Store
	// Snapshot 生成数据库一致性快照；nil 时拒绝打包。
	Snapshot func(ctx context.Context, destPath string) error
}

// Run 打包 data 目录并写入 opts.Store，返回生成的备份文件。
func Run(ctx context.Context, opts Options) (File, error) {
	if err := opts.validate(); err != nil {
		return File{}, err
	}
	name, err := uniqueFileName(ctx, opts.Store)
	if err != nil {
		return File{}, err
	}

	// 数据库快照要先落在本机磁盘上：opts.Store 可能是远程位置，不能拿它当临时目录。
	workDir, err := os.MkdirTemp("", "javboss-backup-")
	if err != nil {
		return File{}, fmt.Errorf("create backup work directory: %w", err)
	}
	defer os.RemoveAll(workDir)

	snapshotPath := filepath.Join(workDir, opts.DatabaseName)
	return opts.Store.Put(ctx, name, func(out io.Writer) error {
		return writeArchive(ctx, out, opts, snapshotPath)
	})
}

// ValidFileName 判断 name 是否为本程序生成的备份文件名，同时挡掉路径穿越。
func ValidFileName(name string) bool {
	if name == "" || name != filepath.Base(name) {
		return false
	}
	if strings.ContainsAny(name, `/\`) {
		return false
	}
	if !strings.HasPrefix(name, FileNamePrefix) || !strings.HasSuffix(name, FileExt) {
		return false
	}
	return len(name) > len(FileNamePrefix)+len(FileExt)
}

func (o Options) validate() error {
	if !filepath.IsAbs(o.DataDir) {
		return errors.New("backup: data directory must be an absolute path")
	}
	if o.Store == nil {
		return errors.New("backup: missing backup store")
	}
	if o.DatabaseName == "" || filepath.Base(o.DatabaseName) != o.DatabaseName {
		return errors.New("backup: invalid database name")
	}
	if o.Snapshot == nil {
		return errors.New("backup: missing database snapshot function")
	}
	if local, ok := o.Store.(*LocalStore); ok && samePath(o.DataDir, local.Dir) {
		return errors.New("backup: backup directory must differ from the data directory")
	}
	return nil
}

// archiveExclusion 返回打包时应跳过的、位于 data 目录内的相对路径。
// 只有本机备份目录可能落在 data 里，此时必须跳过，否则备份会把自己打进去。
func archiveExclusion(dataDir string, store Store) string {
	local, ok := store.(*LocalStore)
	if !ok {
		return ""
	}
	return relativeInside(dataDir, local.Dir)
}

func writeArchive(ctx context.Context, out io.Writer, opts Options, snapshotPath string) error {
	zipw := zip.NewWriter(out)
	dbName := opts.DatabaseName
	backupRel := archiveExclusion(opts.DataDir, opts.Store)

	walkErr := filepath.WalkDir(opts.DataDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(opts.DataDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			// 备份目录落在 data 里时跳过它，否则会把备份打进去。
			if rel == backupRel {
				return fs.SkipDir
			}
			if !strings.Contains(rel, "/") {
				if _, ok := excludedTopDirs[rel]; ok {
					return fs.SkipDir
				}
			}
			return nil
		}
		if !strings.Contains(rel, "/") {
			if _, ok := excludedTopFiles[rel]; ok {
				return nil
			}
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			// 符号链接等特殊文件不进备份，恢复时也就不会写出奇怪的东西。
			return nil
		}
		entryName := DataRootName + "/" + rel
		if rel == dbName {
			// 运行中的库必须用一致性快照替换。
			if err := opts.Snapshot(ctx, snapshotPath); err != nil {
				return fmt.Errorf("snapshot database: %w", err)
			}
			return addFile(zipw, entryName, snapshotPath, info, opts.Password)
		}
		if rel == dbName+"-wal" || rel == dbName+"-shm" || rel == dbName+"-journal" {
			// 数据库的临时文件由快照覆盖，打进备份反而会让恢复出来的库不一致。
			return nil
		}
		return addFile(zipw, entryName, path, info, opts.Password)
	})
	if walkErr != nil {
		_ = zipw.Close()
		return fmt.Errorf("collect data files: %w", walkErr)
	}
	if err := zipw.Close(); err != nil {
		return fmt.Errorf("finalize backup archive: %w", err)
	}
	return nil
}

func addFile(zipw *zip.Writer, entryName, sourcePath string, info fs.FileInfo, password string) error {
	header := &zip.FileHeader{Name: entryName, Method: zip.Deflate}
	header.SetMode(info.Mode())
	header.SetModTime(info.ModTime())
	if password != "" {
		// ZipCrypto（StandardEncryption）兼容性最好，7-Zip / Windows 资源管理器都能解。
		header.SetPassword(password)
		header.SetEncryptionMethod(zip.StandardEncryption)
	}
	writer, err := zipw.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("create archive entry %s: %w", entryName, err)
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open %s: %w", sourcePath, err)
	}
	defer source.Close()
	if _, err := io.Copy(writer, source); err != nil {
		return fmt.Errorf("write archive entry %s: %w", entryName, err)
	}
	return nil
}

// uniqueFileName 以当前时间为基准，找一个 store 里还不存在的备份文件名。
func uniqueFileName(ctx context.Context, store Store) (string, error) {
	base := FileNamePrefix + time.Now().Format(fileNameTimeLayout)
	for i := 1; i <= 100; i++ {
		name := base + FileExt
		if i > 1 {
			name = fmt.Sprintf("%s-%d%s", base, i, FileExt)
		}
		exists, err := store.Exists(ctx, name)
		if err != nil {
			return "", err
		}
		if !exists {
			return name, nil
		}
	}
	return "", errors.New("too many backups created in the same second")
}

// relativeInside 返回 target 相对 base 的斜杠路径；target 不在 base 内时返回空串。
func relativeInside(base, target string) string {
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == "." {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return ""
	}
	return rel
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
