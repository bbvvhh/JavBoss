package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Entry 是解压出来的一个文件。
type Entry struct {
	// Rel 是文件相对程序目录的路径（正斜杠分隔）。
	Rel string
	// Path 是解压后的绝对路径。
	Path string
	Size int64
	Mode fs.FileMode
}

// Manifest 是一次解压的结果。
type Manifest struct {
	// Root 是归档里的顶层目录名（发布包中与包同名的那层目录）。
	Root      string
	Entries   []Entry
	TotalSize int64
}

// Extract 把发布包解压到 destDir，并剥掉归档的顶层目录。
//
// 逐条目校验：拒绝绝对路径、`..`、反斜杠、盘符与符号链接；包内一旦出现 data/ 条目
// 就整包拒收（发布脚本本来就不打 data/，出现即打包错误，也彻底杜绝覆盖数据的可能）。
// 任何一步失败都会清掉 destDir，绝不留下半个解压结果。
func Extract(ctx context.Context, archivePath, destDir string) (Manifest, error) {
	format, ok := DetectFormat(archivePath)
	if !ok {
		return Manifest{}, fmt.Errorf("unsupported update package %q", filepath.Base(archivePath))
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return Manifest{}, fmt.Errorf("create update staging directory: %w", err)
	}

	extractor := &extractor{destDir: destDir}
	var err error
	if format == FormatZip {
		err = extractZip(ctx, archivePath, extractor)
	} else {
		err = extractTarGz(ctx, archivePath, extractor)
	}
	if err == nil && len(extractor.entries) == 0 {
		err = errors.New("update package is empty")
	}
	if err != nil {
		_ = os.RemoveAll(destDir)
		return Manifest{}, err
	}
	return Manifest{
		Root:      extractor.root,
		Entries:   extractor.entries,
		TotalSize: extractor.total,
	}, nil
}

// extractor 累积一次解压的状态：顶层目录名与已写出的文件。
type extractor struct {
	destDir string
	root    string
	entries []Entry
	total   int64
}

// write 把一个归档条目写到 destDir 下，同时校验顶层目录与 data/ 条目。
func (e *extractor) write(entry archiveEntry, source io.Reader) error {
	rel, skip, err := e.relative(entry)
	if err != nil {
		return err
	}
	if skip {
		return nil
	}
	target := filepath.Join(e.destDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create update directory: %w", err)
	}
	mode := fileMode(rel, entry.mode)
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("create update file %s: %w", rel, err)
	}
	written, copyErr := io.Copy(file, source)
	closeErr := file.Close()
	if copyErr != nil {
		return fmt.Errorf("extract archive entry %s: %w", entry.name, copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close update file %s: %w", rel, closeErr)
	}
	// OpenFile 的权限会被 umask 削掉，这里再补一次，保证 start.sh 之类真的可执行。
	if err := os.Chmod(target, mode); err != nil {
		return fmt.Errorf("set update file mode %s: %w", rel, err)
	}
	e.entries = append(e.entries, Entry{Rel: rel, Path: target, Size: written, Mode: mode})
	e.total += written
	return nil
}

// relative 校验条目的位置并返回它相对程序目录的路径。
// skip 为 true 表示这是顶层目录自身，不需要写出。
func (e *extractor) relative(entry archiveEntry) (rel string, skip bool, err error) {
	first, rest, nested := cutSegment(entry.rel)
	if first == "" {
		return "", false, fmt.Errorf("invalid path in update package: %q", entry.name)
	}
	if e.root == "" {
		e.root = first
	}
	if first != e.root {
		return "", false, fmt.Errorf("update package has more than one top-level directory: %q and %q", e.root, first)
	}
	if !nested {
		if entry.isDir {
			return "", true, nil
		}
		return "", false, fmt.Errorf("update package entry %q is not inside a single top-level directory", entry.name)
	}
	// 顶层目录之下出现 data/ 说明打包有问题，直接整包拒收。
	if rest == DataDirName || strings.HasPrefix(rest, DataDirName+"/") {
		return "", false, fmt.Errorf("update package must not contain a %s directory: %q", DataDirName, entry.name)
	}
	return rest, false, nil
}

// archiveEntry 是一个已经通过路径校验的归档条目。
type archiveEntry struct {
	name  string
	rel   string
	isDir bool
	size  int64
	mode  fs.FileMode
}

func newArchiveEntry(name string, mode fs.FileMode, size int64) (archiveEntry, error) {
	rel, err := cleanEntryName(name)
	if err != nil {
		return archiveEntry{}, err
	}
	if mode&fs.ModeSymlink != 0 {
		return archiveEntry{}, fmt.Errorf("update package contains a symbolic link: %q", name)
	}
	if mode&(fs.ModeDevice|fs.ModeCharDevice|fs.ModeNamedPipe|fs.ModeSocket|fs.ModeIrregular) != 0 {
		return archiveEntry{}, fmt.Errorf("update package contains an unsupported file type: %q", name)
	}
	return archiveEntry{name: name, rel: rel, isDir: mode.IsDir(), size: size, mode: mode}, nil
}

// cleanEntryName 校验归档条目名并返回干净的相对路径，挡掉一切越权写法。
func cleanEntryName(name string) (string, error) {
	invalid := func() error {
		return fmt.Errorf("invalid path in update package: %q", name)
	}
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, `\`) {
		return "", invalid()
	}
	trimmed := strings.TrimSuffix(name, "/")
	clean := path.Clean(trimmed)
	if clean != trimmed || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", invalid()
	}
	// 挡掉 Windows 盘符（C:/...）与 NTFS 数据流（a:b）。
	if strings.Contains(clean, ":") {
		return "", invalid()
	}
	return clean, nil
}

// cutSegment 把相对路径切成第一段与剩余部分。
func cutSegment(rel string) (first, rest string, nested bool) {
	if index := strings.Index(rel, "/"); index >= 0 {
		return rel[:index], rel[index+1:], true
	}
	return rel, "", false
}

func extractZip(ctx context.Context, archivePath string, extractor *extractor) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open update package: %w", err)
	}
	defer reader.Close()
	for _, file := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry, err := newArchiveEntry(file.Name, file.Mode(), int64(file.UncompressedSize64))
		if err != nil {
			return err
		}
		if entry.isDir {
			if _, _, err := extractor.relative(entry); err != nil {
				return err
			}
			continue
		}
		source, err := file.Open()
		if err != nil {
			return fmt.Errorf("open archive entry %s: %w", file.Name, err)
		}
		writeErr := extractor.write(entry, source)
		source.Close()
		if writeErr != nil {
			return writeErr
		}
	}
	return nil
}

func extractTarGz(ctx context.Context, archivePath string, extractor *extractor) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open update package: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("read update package: %w", err)
	}
	defer gzipReader.Close()

	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read update package: %w", err)
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeReg:
		case tar.TypeDir:
		case tar.TypeSymlink, tar.TypeLink:
			return fmt.Errorf("update package contains a symbolic link: %q", header.Name)
		default:
			return fmt.Errorf("update package contains an unsupported file type: %q", header.Name)
		}
		entry, err := newArchiveEntry(header.Name, header.FileInfo().Mode(), header.Size)
		if err != nil {
			return err
		}
		if entry.isDir {
			if _, _, err := extractor.relative(entry); err != nil {
				return err
			}
			continue
		}
		if err := extractor.write(entry, reader); err != nil {
			return err
		}
	}
}

// executableNames 是必须带执行位的文件名，与 scripts/cli/cli.mjs 的
// ZIP_EXECUTABLE_FILES、scripts/build-proot-arm64.sh 的 mode_for 保持一致。
var executableNames = map[string]struct{}{
	"javboss":         {},
	"javboss.exe":     {},
	"start.sh":        {},
	"javboss.command": {},
}

// fileMode 决定解压出来的文件权限：关键文件按文件名固定 0755，
// 其余取归档里记录的权限；归档没记录（Windows 打的 zip 一律是 0）时兜底 0644。
func fileMode(rel string, archived fs.FileMode) fs.FileMode {
	if _, ok := executableNames[rel]; ok {
		return 0o755
	}
	if strings.HasPrefix(rel, "internal/bin/") {
		return 0o755
	}
	if perm := archived.Perm(); perm != 0 {
		return perm
	}
	return 0o644
}
