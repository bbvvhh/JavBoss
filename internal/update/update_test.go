package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------- fixtures

type archiveFile struct {
	name string
	data []byte
	mode fs.FileMode
	// symlink 非空时写成符号链接条目，链接目标是它。
	symlink string
}

func writeArchive(t *testing.T, format PackageFormat, path string, files []archiveFile) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create archive directory: %v", err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	defer file.Close()

	if format == FormatZip {
		writer := zip.NewWriter(file)
		for _, entry := range files {
			header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
			header.SetMode(archiveMode(entry))
			target, err := writer.CreateHeader(header)
			if err != nil {
				t.Fatalf("write zip header %s: %v", entry.name, err)
			}
			if _, err := target.Write(entry.data); err != nil {
				t.Fatalf("write zip entry %s: %v", entry.name, err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("close zip writer: %v", err)
		}
		return
	}

	gzipWriter := gzip.NewWriter(file)
	writer := tar.NewWriter(gzipWriter)
	for _, entry := range files {
		header := &tar.Header{
			Name:     entry.name,
			Mode:     int64(archiveMode(entry).Perm()),
			Size:     int64(len(entry.data)),
			Typeflag: tar.TypeReg,
		}
		if entry.symlink != "" {
			header.Typeflag = tar.TypeSymlink
			header.Linkname = entry.symlink
			header.Size = 0
		} else if entry.mode.IsDir() || strings.HasSuffix(entry.name, "/") {
			header.Typeflag = tar.TypeDir
			header.Size = 0
		}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatalf("write tar header %s: %v", entry.name, err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if _, err := writer.Write(entry.data); err != nil {
			t.Fatalf("write tar entry %s: %v", entry.name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close tar writer: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}
}

func archiveMode(entry archiveFile) fs.FileMode {
	if entry.symlink != "" {
		return fs.ModeSymlink | 0o777
	}
	if entry.mode == 0 {
		return 0o644
	}
	return entry.mode
}

// fakeBinary 造一个只有文件头的最小可执行文件，用于通过架构校验。
func fakeBinary(goos, goarch string) []byte {
	if goos == "windows" {
		header := make([]byte, 0x48)
		copy(header, "MZ")
		binary.LittleEndian.PutUint32(header[0x3c:0x40], 0x40)
		copy(header[0x40:], []byte{'P', 'E', 0, 0})
		machines := peMachines[goarch]
		if len(machines) > 0 {
			binary.LittleEndian.PutUint16(header[0x44:0x46], machines[0])
		}
		return header
	}
	header := make([]byte, 64)
	copy(header, elfMagic)
	header[5] = 1
	machines := elfMachines[goarch]
	if len(machines) > 0 {
		binary.LittleEndian.PutUint16(header[18:20], machines[0])
	}
	return header
}

// hostPackageStem 是当前平台发布包的文件名主干。
func hostPackageStem() string {
	return "javboss-v2.1.2-" + platformLabel(runtime.GOOS, runtime.GOARCH)
}

// hostArchiveFiles 造一份能在当前平台上通过校验的发布包内容。
func hostArchiveFiles(extra ...archiveFile) []archiveFile {
	stem := hostPackageStem()
	files := []archiveFile{{
		name: stem + "/" + MainBinaryName(runtime.GOOS),
		data: fakeBinary(runtime.GOOS, runtime.GOARCH),
		mode: 0o644,
	}}
	return append(files, extra...)
}

func setupDirs(t *testing.T) (dataDir, programDir, root string) {
	t.Helper()
	root = t.TempDir()
	dataDir = filepath.Join(root, "data")
	programDir = filepath.Join(root, "program")
	for _, dir := range []string{dataDir, programDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("create %s: %v", dir, err)
		}
	}
	return dataDir, programDir, root
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("%s should not exist, stat error: %v", path, err)
	}
}

// ---------------------------------------------------------------- 文件名与描述

func TestValidPackageName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{name: "javboss-v2.1.2-windows-x86_64.zip", want: true},
		{name: "javboss-v2.1.2-linux-arm64-proot.tar.gz", want: true},
		{name: "javboss-v2.1.2-macos-arm64.zip", want: true},
		// 备份文件与发布包同前缀，绝不能出现在更新列表里。
		{name: "javboss-backup-20260923-101010.zip", want: false},
		{name: "javboss-BACKUP-20260923-101010.zip", want: false},
		{name: "javboss-.zip", want: false},
		{name: "javboss-v2.1.2-windows-x86_64.zip.sha256", want: false},
		{name: "javboss-v2.1.2-windows-x86_64.7z", want: false},
		{name: "../javboss-v2.1.2-windows-x86_64.zip", want: false},
		{name: `..\javboss-v2.1.2-windows-x86_64.zip`, want: false},
		{name: "other-v2.1.2-windows-x86_64.zip", want: false},
		{name: "", want: false},
	}
	for _, tc := range cases {
		if got := ValidPackageName(tc.name); got != tc.want {
			t.Errorf("ValidPackageName(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
	if !ValidSourceFileName("javboss-v2.1.2-windows-x86_64.zip.sha256") {
		t.Error("sidecar files must be readable from the update location")
	}
	if ValidSourceFileName("notes.txt") {
		t.Error("unrelated files must not be readable from the update location")
	}
}

func TestDescribePackagePlatform(t *testing.T) {
	cases := []struct {
		name     string
		platform string
		format   PackageFormat
	}{
		{name: "javboss-v2.1.2-windows-x86_64.zip", platform: "windows-x86_64", format: FormatZip},
		{name: "javboss-v2.1.2-linux-arm64-proot.tar.gz", platform: "linux-arm64-proot", format: FormatTarGz},
		{name: "javboss-v2.1.2-linux-arm64.zip", platform: "linux-arm64", format: FormatZip},
		{name: "javboss-v2.1.2-source.zip", platform: "", format: FormatZip},
	}
	for _, tc := range cases {
		pkg, ok := DescribePackage(tc.name, 10, time.Now())
		if !ok {
			t.Fatalf("DescribePackage(%q) rejected a valid package name", tc.name)
		}
		if pkg.Platform != tc.platform {
			t.Errorf("DescribePackage(%q).Platform = %q, want %q", tc.name, pkg.Platform, tc.platform)
		}
		if pkg.Format != tc.format {
			t.Errorf("DescribePackage(%q).Format = %q, want %q", tc.name, pkg.Format, tc.format)
		}
	}
	if _, ok := DescribePackage("javboss-backup-20260923-101010.zip", 10, time.Now()); ok {
		t.Error("backup archives must not be listed as update packages")
	}
}

func TestPlatformLabels(t *testing.T) {
	cases := []struct {
		goos   string
		goarch string
		want   []string
	}{
		{goos: "linux", goarch: "arm64", want: []string{"linux-arm64", "linux-arm64-proot"}},
		{goos: "linux", goarch: "amd64", want: []string{"linux-x86_64"}},
		{goos: "windows", goarch: "amd64", want: []string{"windows-x86_64"}},
		{goos: "darwin", goarch: "arm64", want: []string{"macos-arm64"}},
	}
	for _, tc := range cases {
		got := PlatformLabels(tc.goos, tc.goarch)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Errorf("PlatformLabels(%s, %s) = %v, want %v", tc.goos, tc.goarch, got, tc.want)
		}
	}
}

// ---------------------------------------------------------------- 解压

func TestCleanEntryName(t *testing.T) {
	valid := map[string]string{
		"pkg/javboss":     "pkg/javboss",
		"pkg/":            "pkg",
		"pkg/web/dist.js": "pkg/web/dist.js",
	}
	for input, want := range valid {
		got, err := cleanEntryName(input)
		if err != nil {
			t.Errorf("cleanEntryName(%q) returned %v", input, err)
			continue
		}
		if got != want {
			t.Errorf("cleanEntryName(%q) = %q, want %q", input, got, want)
		}
	}
	invalid := []string{
		"", "/etc/passwd", `pkg\javboss`, "pkg/../evil", "../evil", "..", ".", "./evil",
		"pkg/a//b", "C:/windows/system32/x.dll", "pkg/data.db:stream",
	}
	for _, input := range invalid {
		if _, err := cleanEntryName(input); err == nil {
			t.Errorf("cleanEntryName(%q) should have been rejected", input)
		}
	}
}

func TestExtractRejectsUnsafeArchives(t *testing.T) {
	formats := []PackageFormat{FormatZip, FormatTarGz}
	cases := []struct {
		name    string
		files   []archiveFile
		message string
	}{
		{
			name:    "parent traversal",
			files:   []archiveFile{{name: "pkg/../../evil.txt", data: []byte("x")}},
			message: "invalid path",
		},
		{
			name:    "absolute path",
			files:   []archiveFile{{name: "/evil.txt", data: []byte("x")}},
			message: "invalid path",
		},
		{
			name:    "data directory",
			files:   []archiveFile{{name: "pkg/data/javboss.db", data: []byte("x")}},
			message: "must not contain a data directory",
		},
		{
			name:    "two top-level directories",
			files:   []archiveFile{{name: "pkg/a.txt", data: []byte("x")}, {name: "other/b.txt", data: []byte("x")}},
			message: "more than one top-level directory",
		},
		{
			name:    "file at archive root",
			files:   []archiveFile{{name: "javboss", data: []byte("x")}},
			message: "is not inside a single top-level directory",
		},
	}
	for _, format := range formats {
		for _, tc := range cases {
			t.Run(string(format)+"/"+tc.name, func(t *testing.T) {
				root := t.TempDir()
				archivePath := filepath.Join(root, "javboss-v2.1.2-linux-x86_64"+format.Extension())
				writeArchive(t, format, archivePath, tc.files)
				destDir := filepath.Join(root, "unpacked")
				if _, err := Extract(context.Background(), archivePath, destDir); err == nil {
					t.Fatalf("Extract accepted an unsafe archive")
				} else if !strings.Contains(err.Error(), tc.message) {
					t.Fatalf("Extract error = %v, want it to mention %q", err, tc.message)
				}
				// 失败必须清场，不能留下半个解压结果。
				assertMissing(t, destDir)
			})
		}
	}
}

func TestExtractRejectsSymlinks(t *testing.T) {
	for _, format := range []PackageFormat{FormatZip, FormatTarGz} {
		t.Run(string(format), func(t *testing.T) {
			root := t.TempDir()
			archivePath := filepath.Join(root, "javboss-v2.1.2-linux-x86_64"+format.Extension())
			writeArchive(t, format, archivePath, []archiveFile{
				{name: "pkg/javboss", data: []byte("x")},
				{name: "pkg/link", symlink: "/etc/passwd"},
			})
			if _, err := Extract(context.Background(), archivePath, filepath.Join(root, "unpacked")); err == nil {
				t.Fatal("Extract accepted a symbolic link")
			} else if !strings.Contains(err.Error(), "symbolic link") {
				t.Fatalf("Extract error = %v, want it to mention the symbolic link", err)
			}
		})
	}
}

func TestExtractStripsTopLevelDirectory(t *testing.T) {
	for _, format := range []PackageFormat{FormatZip, FormatTarGz} {
		t.Run(string(format), func(t *testing.T) {
			root := t.TempDir()
			archivePath := filepath.Join(root, "javboss-v2.1.2-linux-x86_64"+format.Extension())
			writeArchive(t, format, archivePath, []archiveFile{
				{name: "javboss-v2.1.2-linux-x86_64/", mode: fs.ModeDir | 0o755},
				{name: "javboss-v2.1.2-linux-x86_64/web/dist/index.html", data: []byte("<html>"), mode: 0o644},
				{name: "javboss-v2.1.2-linux-x86_64/internal/bin/ffmpeg", data: []byte("bin"), mode: 0o644},
			})
			manifest, err := Extract(context.Background(), archivePath, filepath.Join(root, "unpacked"))
			if err != nil {
				t.Fatalf("Extract: %v", err)
			}
			if manifest.Root != "javboss-v2.1.2-linux-x86_64" {
				t.Errorf("Manifest.Root = %q", manifest.Root)
			}
			if len(manifest.Entries) != 2 {
				t.Fatalf("Manifest.Entries = %d, want 2", len(manifest.Entries))
			}
			modes := map[string]fs.FileMode{}
			for _, entry := range manifest.Entries {
				modes[entry.Rel] = entry.Mode
			}
			// 关键文件在包里的权限位是 0644（Windows 打的 zip 一律是 0），
			// 解压后必须补成可执行。
			if modes["internal/bin/ffmpeg"] != 0o755 {
				t.Errorf("internal/bin/ffmpeg mode = %v, want 0755", modes["internal/bin/ffmpeg"])
			}
			if modes["web/dist/index.html"] != 0o644 {
				t.Errorf("web/dist/index.html mode = %v, want 0644", modes["web/dist/index.html"])
			}
			if _, err := os.Stat(filepath.Join(root, "unpacked", "web", "dist", "index.html")); err != nil {
				t.Errorf("extracted file is missing: %v", err)
			}
		})
	}
}

func TestFileMode(t *testing.T) {
	cases := []struct {
		rel      string
		archived fs.FileMode
		want     fs.FileMode
	}{
		{rel: "javboss", archived: 0, want: 0o755},
		{rel: "javboss.exe", archived: 0o644, want: 0o755},
		{rel: "start.sh", archived: 0, want: 0o755},
		{rel: "internal/bin/ffprobe", archived: 0, want: 0o755},
		{rel: "web/dist/index.html", archived: 0, want: 0o644},
		{rel: "web/dist/index.html", archived: 0o600, want: 0o600},
	}
	for _, tc := range cases {
		if got := fileMode(tc.rel, tc.archived); got != tc.want {
			t.Errorf("fileMode(%q, %v) = %v, want %v", tc.rel, tc.archived, got, tc.want)
		}
	}
}

// ---------------------------------------------------------------- 校验

func TestVerifySidecar(t *testing.T) {
	root := t.TempDir()
	archivePath := filepath.Join(root, "javboss-v2.1.2-linux-x86_64.zip")
	writeFile(t, archivePath, "payload")

	if err := VerifySidecar(archivePath); err != nil {
		t.Fatalf("missing sidecar should be accepted, got %v", err)
	}
	writeFile(t, archivePath+Sha256Ext, "0000000000000000000000000000000000000000000000000000000000000000\n")
	if err := VerifySidecar(archivePath); err == nil {
		t.Fatal("a mismatching sidecar must be rejected")
	}
	writeFile(t, archivePath+Sha256Ext, "not-a-digest\n")
	if err := VerifySidecar(archivePath); err == nil {
		t.Fatal("a malformed sidecar must be rejected")
	}
}

func TestParseChecksum(t *testing.T) {
	value := strings.Repeat("ab", 32)
	cases := []struct {
		content string
		want    string
		wantErr bool
	}{
		{content: value, want: value},
		{content: value + "\n", want: value},
		{content: value + "  javboss-v2.1.2-linux-x86_64.tar.gz\n", want: value},
		{content: strings.ToUpper(value), want: value},
		{content: "", wantErr: true},
		{content: "abc", wantErr: true},
		{content: strings.Repeat("z", 64), wantErr: true},
	}
	for _, tc := range cases {
		got, err := parseChecksum(tc.content)
		if tc.wantErr {
			if err == nil {
				t.Errorf("parseChecksum(%q) should have failed", tc.content)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseChecksum(%q) = %v", tc.content, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseChecksum(%q) = %q, want %q", tc.content, got, tc.want)
		}
	}
}

func TestValidateManifest(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "javboss"), string(fakeBinary("linux", "amd64")))
	writeFile(t, filepath.Join(root, "javboss.exe"), string(fakeBinary("windows", "amd64")))

	entries := func(names ...string) Manifest {
		manifest := Manifest{}
		for _, name := range names {
			manifest.Entries = append(manifest.Entries, Entry{Rel: name, Path: filepath.Join(root, name)})
		}
		return manifest
	}

	if err := ValidateManifest(entries("javboss"), "linux", "amd64"); err != nil {
		t.Errorf("ValidateManifest(linux, amd64) = %v", err)
	}
	if err := ValidateManifest(entries("javboss.exe"), "windows", "amd64"); err != nil {
		t.Errorf("ValidateManifest(windows, amd64) = %v", err)
	}
	// 平台不对：拿 linux 的包在 windows 上找不到 javboss.exe。
	if err := ValidateManifest(entries("javboss"), "windows", "amd64"); err == nil {
		t.Error("a package without the platform main binary must be rejected")
	}
	// 架构不对：冲着 arm64 编译的二进制不能替换 amd64 程序。
	if err := ValidateManifest(entries("javboss"), "linux", "arm64"); err == nil {
		t.Error("a package built for another architecture must be rejected")
	}
}

func TestVerifyBinaryArchitectureRejectsGarbage(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "javboss")
	writeFile(t, path, "not an executable")
	if err := VerifyBinaryArchitecture(path, "amd64"); err == nil {
		t.Fatal("a file without a known header must be rejected")
	}
}

// ---------------------------------------------------------------- 暂存与落地

func TestApplyWithoutStagedPackage(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	_, err := Apply(context.Background(), ApplyOptions{DataDir: dataDir, ProgramDir: programDir})
	if !errors.Is(err, ErrNothingStaged) {
		t.Fatalf("Apply without a staged package = %v, want ErrNothingStaged", err)
	}
}

func TestStageRejectsPackageWithoutMainBinary(t *testing.T) {
	dataDir, programDir, root := setupDirs(t)
	name := hostPackageStem() + ZipExt
	archivePath := filepath.Join(root, name)
	writeArchive(t, FormatZip, archivePath, []archiveFile{
		{name: hostPackageStem() + "/web/dist/index.html", data: []byte("<html>")},
	})

	_, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
	})
	if err == nil {
		t.Fatal("a package without the main binary must be rejected")
	}
	if !strings.Contains(err.Error(), "does not contain") {
		t.Fatalf("Stage error = %v, want it to mention the missing binary", err)
	}
	assertMissing(t, filepath.Join(UpdateDir(dataDir), unpackedDirName))
}

func TestStageRejectsWrongArchitecture(t *testing.T) {
	dataDir, programDir, root := setupDirs(t)
	name := hostPackageStem() + ZipExt
	archivePath := filepath.Join(root, name)
	header := fakeBinary("linux", "amd64")
	// 把机器码改成一个谁都不是的值。
	binary.LittleEndian.PutUint16(header[18:20], 9999)
	writeArchive(t, FormatZip, archivePath, []archiveFile{
		{name: hostPackageStem() + "/" + MainBinaryName(runtime.GOOS), data: header},
	})

	_, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
	})
	if err == nil {
		t.Fatal("a package built for another architecture must be rejected")
	}
	if !strings.Contains(err.Error(), "different architecture") {
		t.Fatalf("Stage error = %v, want it to mention the architecture", err)
	}
}

func TestStageRejectsPackageWithDataDirectory(t *testing.T) {
	dataDir, programDir, root := setupDirs(t)
	name := hostPackageStem() + ZipExt
	archivePath := filepath.Join(root, name)
	writeArchive(t, FormatZip, archivePath, hostArchiveFiles(archiveFile{
		name: hostPackageStem() + "/data/javboss.db",
		data: []byte("stolen"),
	}))

	_, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
	})
	if err == nil {
		t.Fatal("a package containing a data directory must be rejected")
	}
	assertMissing(t, filepath.Join(UpdateDir(dataDir), unpackedDirName))
}

// 远程发布包先下载到 data/update/staging/ 里，Stage 清理暂存时不能把这一层目录
// 连同刚下载好的归档一起删掉，否则真机上表现为「校验失败：open update package:
// ... no such file or directory」。本机目录形式的发布包不在暂存目录里，走的是另一条分支。
func TestStageKeepsDownloadedArchiveUnderStaging(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	name := hostPackageStem() + ZipExt
	archivePath := StageArchivePath(dataDir, name)
	writeArchive(t, FormatZip, archivePath, hostArchiveFiles())

	// 上一次留下的中间产物与旧下载，本次都应当被清掉。
	staleArchive := StageArchivePath(dataDir, hostPackageStem()+"-old.zip")
	writeFile(t, staleArchive, "stale download")
	writeFile(t, filepath.Join(UpdateDir(dataDir), planFileName), "{}")
	writeFile(t, filepath.Join(UpdateDir(dataDir), unpackedDirName, "old.txt"), "old")

	pending, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
	})
	if err != nil {
		t.Fatalf("stage downloaded package: %v", err)
	}
	if pending.FileName != name || pending.FileCount == 0 {
		t.Fatalf("pending = %#v", pending)
	}
	if _, err := os.Stat(archivePath); err != nil {
		t.Fatalf("the downloaded archive was removed: %v", err)
	}
	assertMissing(t, staleArchive)
	assertMissing(t, filepath.Join(UpdateDir(dataDir), planFileName))
	assertMissing(t, filepath.Join(UpdateDir(dataDir), unpackedDirName, "old.txt"))
}

func TestStageAndApplyReplacesProgramFiles(t *testing.T) {
	// Windows 上平台层不直接替换文件，而是把替换交给退出后运行的 helper（见 apply_windows.go），
	// 这里只覆盖 Unix 的整条链路；helper 脚本本身由 apply_windows_test.go 覆盖。
	if runtime.GOOS == "windows" {
		t.Skip("the replacement is deferred to the helper script on Windows")
	}
	for _, format := range []PackageFormat{FormatZip, FormatTarGz} {
		t.Run(string(format), func(t *testing.T) {
			dataDir, programDir, root := setupDirs(t)
			stem := hostPackageStem()
			name := stem + format.Extension()
			archivePath := filepath.Join(root, name)

			writeFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS)), "old-binary")
			writeFile(t, filepath.Join(programDir, ConfigFileName), "port = 17654\n")
			writeFile(t, filepath.Join(programDir, DataDirName, "javboss.db"), "local-database")
			writeArchive(t, format, archivePath, hostArchiveFiles(
				archiveFile{name: stem + "/web/dist/index.html", data: []byte("<html>new"), mode: 0o644},
				// 包里的配置与 data 都不许覆盖本机版本。
				archiveFile{name: stem + "/" + ConfigFileName, data: []byte("port = 9999\n"), mode: 0o644},
			))

			pending, err := Stage(context.Background(), StageOptions{
				DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
			})
			if err != nil {
				t.Fatalf("Stage: %v", err)
			}
			if pending.FileCount != 3 {
				t.Fatalf("Pending.FileCount = %d, want 3", pending.FileCount)
			}

			applied, err := Apply(context.Background(), ApplyOptions{
				DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath,
			})
			if err != nil {
				t.Fatalf("Apply: %v", err)
			}
			if applied.Error != "" {
				t.Fatalf("Apply reported %q", applied.Error)
			}
			// 包里有 3 个文件，但 config.toml 不进替换计划。
			if applied.FileCount != 2 {
				t.Fatalf("AppliedResult.FileCount = %d, want 2", applied.FileCount)
			}
			if applied.Deferred {
				t.Fatal("the unix path must not defer the replacement")
			}
			if got := readFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS))); got != string(fakeBinary(runtime.GOOS, runtime.GOARCH)) {
				t.Fatal("the main binary was not replaced")
			}
			if got := readFile(t, filepath.Join(programDir, "web", "dist", "index.html")); got != "<html>new" {
				t.Fatalf("the new asset was not installed, got %q", got)
			}
			if got := readFile(t, filepath.Join(programDir, ConfigFileName)); got != "port = 17654\n" {
				t.Fatalf("config.toml must keep the local version, got %q", got)
			}
			if got := readFile(t, filepath.Join(programDir, DataDirName, "javboss.db")); got != "local-database" {
				t.Fatalf("the data directory must stay untouched, got %q", got)
			}

			if pending, err := ReadPending(dataDir); err != nil || pending != nil {
				t.Fatalf("ReadPending = %v, %v; want nil, nil", pending, err)
			}
			result, err := ReadApplied(dataDir)
			if err != nil {
				t.Fatalf("ReadApplied: %v", err)
			}
			if result == nil || result.FileName != name || !result.RestartNeeded {
				t.Fatalf("ReadApplied = %+v", result)
			}
			assertMissing(t, filepath.Join(UpdateDir(dataDir), unpackedDirName))
			if err := AcknowledgeApplied(dataDir); err != nil {
				t.Fatalf("AcknowledgeApplied: %v", err)
			}
			if result, err := ReadApplied(dataDir); err != nil || result != nil {
				t.Fatalf("ReadApplied after acknowledge = %+v, %v", result, err)
			}
		})
	}
}

// TestReplaceAllRestoresReplacedFiles 直接覆盖替换与回滚的核心逻辑，
// 它不经过平台层，所以在所有平台上都会被跑到。
func TestReplaceAllRestoresReplacedFiles(t *testing.T) {
	root := t.TempDir()
	sources := filepath.Join(root, "sources")
	programDir := filepath.Join(root, "program")
	rollbackDir := filepath.Join(root, "rollback")
	binaryName := MainBinaryName(runtime.GOOS)

	writeFile(t, filepath.Join(sources, binaryName), "new-binary")
	writeFile(t, filepath.Join(sources, "web", "dist", "app.js"), "new-asset")
	writeFile(t, filepath.Join(programDir, binaryName), "old-binary")
	writeFile(t, filepath.Join(rollbackDir, binaryName), "old-binary")

	plan := []PlanEntry{
		{
			Rel: binaryName, Source: filepath.Join(sources, binaryName),
			Target:   filepath.Join(programDir, binaryName),
			Rollback: filepath.Join(rollbackDir, binaryName), Mode: 0o755,
		},
		{Rel: "web/dist/app.js", Source: filepath.Join(sources, "web", "dist", "app.js"), Target: filepath.Join(programDir, "web", "dist", "app.js"), Mode: 0o644},
	}
	replaced, err := replaceAll(context.Background(), plan)
	if err != nil {
		t.Fatalf("replaceAll: %v", err)
	}
	if len(replaced) != 2 {
		t.Fatalf("replaceAll replaced %d files, want 2", len(replaced))
	}
	if got := readFile(t, filepath.Join(programDir, binaryName)); got != "new-binary" {
		t.Fatalf("the binary was not replaced, got %q", got)
	}

	// 第二次替换必定失败：web 成了普通文件，没法再建 web/dist。
	if err := os.RemoveAll(filepath.Join(programDir, "web")); err != nil {
		t.Fatalf("remove web directory: %v", err)
	}
	writeFile(t, filepath.Join(programDir, "web"), "not a directory")
	if _, err := replaceAll(context.Background(), plan); err == nil {
		t.Fatal("replaceAll should have failed")
	} else if got := readFile(t, filepath.Join(programDir, binaryName)); got != "old-binary" {
		t.Fatalf("the failed run did not restore the binary, got %q", got)
	}
}

func TestApplyRestoresFilesWhenReplacementFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the replacement is deferred to the helper script on Windows")
	}
	dataDir, programDir, root := setupDirs(t)
	stem := hostPackageStem()
	name := stem + ZipExt
	archivePath := filepath.Join(root, name)

	writeFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS)), "old-binary")
	// 目标路径的父级是个普通文件，替换 web/dist/app.js 必然失败。
	writeFile(t, filepath.Join(programDir, "web"), "not a directory")
	writeArchive(t, FormatZip, archivePath, hostArchiveFiles(
		archiveFile{name: stem + "/web/dist/app.js", data: []byte("new"), mode: 0o644},
	))

	if _, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath, FileName: name,
	}); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if _, err := Apply(context.Background(), ApplyOptions{
		DataDir: dataDir, ProgramDir: programDir, ArchivePath: archivePath,
	}); err == nil {
		t.Fatal("Apply should have failed")
	}
	// 已经替换过的文件必须还原，不能留半个新版本。
	if got := readFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS))); got != "old-binary" {
		t.Fatalf("the replaced file was not restored, got %q", got)
	}
	if got := readFile(t, filepath.Join(programDir, "web")); got != "not a directory" {
		t.Fatalf("an unrelated file was modified, got %q", got)
	}
	result, err := ReadApplied(dataDir)
	if err != nil {
		t.Fatalf("ReadApplied: %v", err)
	}
	if result == nil || result.Error == "" || result.RestartNeeded {
		t.Fatalf("ReadApplied = %+v, want a failure result without a restart hint", result)
	}
	assertMissing(t, filepath.Join(UpdateDir(dataDir), unpackedDirName))
}

// ---------------------------------------------------------------- 回滚

func TestRollbackWithoutCopiesKeepsProgramFiles(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	writeFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS)), "original")

	// 模拟「计划已落盘、回滚副本还没生成」就被强杀的状态。
	if err := writeJSON(filepath.Join(UpdateDir(dataDir), planFileName), storedPlan{Entries: []storedEntry{
		{Rel: MainBinaryName(runtime.GOOS), Mode: 0o755, Existing: true},
	}}); err != nil {
		t.Fatalf("write plan: %v", err)
	}

	restored, err := Rollback(dataDir, programDir)
	if err == nil {
		t.Fatal("Rollback must report that it could not restore anything")
	}
	if restored != 0 {
		t.Fatalf("Rollback restored %d files, want 0", restored)
	}
	if got := readFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS))); got != "original" {
		t.Fatalf("Rollback deleted a program file it never replaced, got %q", got)
	}
}

func TestRollbackRestoresAndRemoves(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	stageDir := UpdateDir(dataDir)
	rollbackDir := filepath.Join(stageDir, rollbackPrefix+"20260924-101010")

	writeFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS)), "new-binary")
	writeFile(t, filepath.Join(programDir, "web", "dist", "added.js"), "added")
	writeFile(t, filepath.Join(rollbackDir, MainBinaryName(runtime.GOOS)), "original")

	if err := writeJSON(filepath.Join(stageDir, planFileName), storedPlan{Entries: []storedEntry{
		{Rel: MainBinaryName(runtime.GOOS), Mode: 0o755, Existing: true},
		{Rel: "web/dist/added.js", Mode: 0o644},
	}}); err != nil {
		t.Fatalf("write plan: %v", err)
	}

	restored, err := Rollback(dataDir, programDir)
	if err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if restored != 2 {
		t.Fatalf("Rollback restored %d files, want 2", restored)
	}
	if got := readFile(t, filepath.Join(programDir, MainBinaryName(runtime.GOOS))); got != "original" {
		t.Fatalf("the replaced file was not restored, got %q", got)
	}
	assertMissing(t, filepath.Join(programDir, "web", "dist", "added.js"))
}

func TestHandleStartupRollsBackInterruptedUpdate(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	stageDir := UpdateDir(dataDir)
	rollbackDir := filepath.Join(stageDir, rollbackPrefix+"20260924-101010")
	stem := hostPackageStem()

	binaryName := MainBinaryName(runtime.GOOS)
	writeFile(t, filepath.Join(programDir, binaryName), "half-updated")
	writeFile(t, filepath.Join(rollbackDir, binaryName), "original")
	if err := writeJSON(filepath.Join(stageDir, pendingFileName), Pending{
		FileName: stem + ZipExt, StagedAt: time.Now(), FileCount: 1,
	}); err != nil {
		t.Fatalf("write pending: %v", err)
	}
	if err := writeJSON(filepath.Join(stageDir, planFileName), storedPlan{Entries: []storedEntry{
		{Rel: binaryName, Mode: 0o755, Existing: true},
	}}); err != nil {
		t.Fatalf("write plan: %v", err)
	}

	outcome := HandleStartup(programDir, dataDir)
	if !outcome.RolledBack || outcome.Restored != 1 {
		t.Fatalf("HandleStartup = %+v, want one rolled back file", outcome)
	}
	if got := readFile(t, filepath.Join(programDir, binaryName)); got != "original" {
		t.Fatalf("the interrupted update was not rolled back, got %q", got)
	}
	if outcome.Result == nil || outcome.Result.Error == "" {
		t.Fatalf("StartupResult.Result = %+v, want an explanation for the user", outcome.Result)
	}
	// 结论留给前端提示，暂存残留要清干净。
	if result, err := ReadApplied(dataDir); err != nil || result == nil {
		t.Fatalf("ReadApplied = %+v, %v; want the rollback result", result, err)
	}
	if pending, err := ReadPending(dataDir); err != nil || pending != nil {
		t.Fatalf("ReadPending = %+v, %v; want the staging to be cleaned", pending, err)
	}
	assertMissing(t, rollbackDir)
}

func TestHandleStartupWithoutPendingKeepsAppliedResult(t *testing.T) {
	dataDir, programDir, _ := setupDirs(t)
	if err := writeJSON(filepath.Join(UpdateDir(dataDir), appliedFileName), AppliedResult{
		FileName: "javboss-v2.1.2-linux-x86_64.zip", RestartNeeded: true,
	}); err != nil {
		t.Fatalf("write applied: %v", err)
	}
	outcome := HandleStartup(programDir, dataDir)
	if outcome.RolledBack {
		t.Fatal("HandleStartup rolled back without a pending update")
	}
	if outcome.Result == nil || outcome.Result.FileName != "javboss-v2.1.2-linux-x86_64.zip" {
		t.Fatalf("HandleStartup = %+v, want the previous result", outcome)
	}
}

// ---------------------------------------------------------------- 位置

func TestLocalSourceListAndProbe(t *testing.T) {
	root := t.TempDir()
	older := time.Now().Add(-time.Hour)
	newer := time.Now()
	for name, modified := range map[string]time.Time{
		"javboss-v2.1.1-" + platformLabel(runtime.GOOS, runtime.GOARCH) + ".zip": older,
		"javboss-v2.1.2-" + platformLabel(runtime.GOOS, runtime.GOARCH) + ".zip": newer,
		"javboss-backup-20260923-101010.zip":                                     newer,
		"notes.txt":                                                              newer,
		"javboss-v2.1.2-linux-x86_64.zip.sha256":                                 newer,
	} {
		writeFile(t, filepath.Join(root, name), "payload")
		if err := os.Chtimes(filepath.Join(root, name), modified, modified); err != nil {
			t.Fatalf("touch %s: %v", name, err)
		}
	}

	source := NewLocalSource(root)
	if err := source.Probe(context.Background()); err != nil {
		t.Fatalf("Probe: %v", err)
	}
	packages, err := source.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(packages) != 2 {
		t.Fatalf("List returned %d packages, want 2", len(packages))
	}
	if !strings.Contains(packages[0].Name, "v2.1.2") {
		t.Fatalf("the newest package should come first, got %s", packages[0].Name)
	}
	if !packages[0].Compatible {
		t.Error("a package for the current platform must be reported as compatible")
	}

	// 边车要能取回，取不到时不算错误。
	destPath := filepath.Join(root, "out", "checksum")
	if found, err := source.FetchSidecar(context.Background(), packages[0].Name, destPath); err != nil || found {
		t.Fatalf("FetchSidecar for a missing sidecar = %v, %v", found, err)
	}
	// 没配置目录时 List 返回空，Probe 报错。
	empty := NewLocalSource("")
	if packages, err := empty.List(context.Background()); err != nil || packages != nil {
		t.Fatalf("List without a directory = %v, %v", packages, err)
	}
	if err := empty.Probe(context.Background()); err == nil {
		t.Fatal("Probe without a directory must fail")
	}
}

func TestStageRejectsProgramDirectoryInsideData(t *testing.T) {
	dataDir, _, _ := setupDirs(t)
	programDir := filepath.Join(dataDir, "program")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatalf("create program dir: %v", err)
	}
	_, err := Stage(context.Background(), StageOptions{
		DataDir: dataDir, ProgramDir: programDir,
		ArchivePath: filepath.Join(dataDir, "javboss-v2.1.2-x.zip"), FileName: "javboss-v2.1.2-x.zip",
	})
	if err == nil || !strings.Contains(err.Error(), "outside the data directory") {
		t.Fatalf("Stage error = %v, want it to refuse a program directory inside data", err)
	}
}
