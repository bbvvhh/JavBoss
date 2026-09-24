// Package update 实现程序自更新：用一个发布包替换程序目录里的文件。
//
// 发布包由用户手动上传到一个位置（本机目录或 WebDAV 远程目录），流程与数据备份/恢复一致：
// 列出 → 下载 → 校验 → 解压到暂存 → 覆盖程序目录 → 重启生效。
//
// 两条硬约束（见 .trae/documents/javboss-program-self-update.md）：
//   - data/ 目录坚决不动：包内出现 data/ 条目整包拒收，覆盖时也排除 data/**；
//   - config.toml 保留本地版本，不用包内的覆盖。
package update

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"javboss/internal/backup"
)

const (
	// FileNamePrefix 是发布包文件名前缀。
	FileNamePrefix = "javboss-"
	// ZipExt 与 TarGzExt 是支持的两类归档扩展名。
	ZipExt   = ".zip"
	TarGzExt = ".tar.gz"
	// Sha256Ext 是校验边车文件的后缀，发布脚本把它写在归档旁边。
	Sha256Ext = ".sha256"
	// ConfigFileName 是配置文件，更新时保留本地版本。
	ConfigFileName = "config.toml"
	// DataDirName 是数据目录，更新时绝对不动。
	DataDirName = backup.DataRootName
)

// PackageFormat 是发布包的归档格式。
type PackageFormat string

const (
	FormatZip   PackageFormat = "zip"
	FormatTarGz PackageFormat = "targz"
)

// Extension 返回该格式对应的文件扩展名。
func (f PackageFormat) Extension() string {
	if f == FormatTarGz {
		return TarGzExt
	}
	return ZipExt
}

// Package 描述一个发布包。
type Package struct {
	Name       string        `json:"name"`
	Size       int64         `json:"size"`
	ModifiedAt time.Time     `json:"modified_at"`
	Format     PackageFormat `json:"format"`
	// Platform 是文件名里的平台串，例如 windows-x86_64；认不出来时为空。
	Platform string `json:"platform"`
	// Compatible 表示这个包能不能在当前平台上运行。不能运行的包只展示、不可执行。
	Compatible bool `json:"compatible"`
}

// ValidPackageName 判断 name 是否可能是本程序的发布包，同时挡掉路径穿越。
func ValidPackageName(name string) bool {
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `/\`) {
		return false
	}
	if !strings.HasPrefix(name, FileNamePrefix) {
		return false
	}
	// 备份文件与发布包同前缀，但它们不是更新包（data 目录的备份不允许出现在更新列表里）。
	// 大小写一并挡掉：Windows 上文件名大小写不敏感，改个大小写就能混进来。
	if strings.HasPrefix(strings.ToLower(name), backup.FileNamePrefix) {
		return false
	}
	stem, ok := trimPackageExt(name)
	return ok && len(stem) > len(FileNamePrefix)
}

// ValidSourceFileName 是允许出现在发布包位置里的文件名：发布包本体，或它的 .sha256 边车。
// 它同时作为 WebDAV 存储的文件名规则，所以边车必须一并放行，否则取不回校验文件。
func ValidSourceFileName(name string) bool {
	if ValidPackageName(name) {
		return true
	}
	if !strings.HasSuffix(name, Sha256Ext) {
		return false
	}
	return ValidPackageName(strings.TrimSuffix(name, Sha256Ext))
}

// DetectFormat 从文件名判断归档格式。
func DetectFormat(name string) (PackageFormat, bool) {
	if strings.HasSuffix(name, TarGzExt) {
		return FormatTarGz, true
	}
	if strings.HasSuffix(name, ZipExt) {
		return FormatZip, true
	}
	return "", false
}

// DescribePackage 把一个已存在的文件整理成发布包描述。
// 文件名不符合发布包规则时返回 false（调用方跳过它）。
func DescribePackage(name string, size int64, modifiedAt time.Time) (Package, bool) {
	if !ValidPackageName(name) {
		return Package{}, false
	}
	format, ok := DetectFormat(name)
	if !ok {
		return Package{}, false
	}
	platform := PackagePlatform(name)
	return Package{
		Name:       name,
		Size:       size,
		ModifiedAt: modifiedAt,
		Format:     format,
		Platform:   platform,
		Compatible: platform != "" && PlatformCompatible(platform),
	}, true
}

// knownPlatforms 是发布脚本可能产出的平台串，更具体的排在前面
// （linux-arm64-proot 必须先于 linux-arm64 匹配）。
var knownPlatforms = []string{
	"linux-arm64-proot",
	"windows-x86_64",
	"linux-x86_64",
	"linux-arm64",
	"macos-x86_64",
	"macos-arm64",
}

// PackagePlatform 提取发布包文件名里的平台串；认不出来时返回空串。
func PackagePlatform(name string) string {
	stem, ok := trimPackageExt(name)
	if !ok {
		return ""
	}
	for _, platform := range knownPlatforms {
		if strings.HasSuffix(stem, "-"+platform) {
			return platform
		}
	}
	return ""
}

// PlatformLabels 返回当前平台上可以直接运行的发布包平台串。
// 与 scripts/cli/cli.mjs 的 PLATFORM_CHOICES、scripts/build-proot-arm64.sh 的产物名保持一致。
func PlatformLabels(goos, goarch string) []string {
	labels := []string{platformLabel(goos, goarch)}
	// proot 包是给 Termux/proot 用的 linux/arm64 构建，与普通 linux-arm64 同为 arm64。
	if goos == "linux" && goarch == "arm64" {
		labels = append(labels, "linux-arm64-proot")
	}
	return labels
}

// PlatformCompatible 判断某个平台串能否在当前程序上运行。
func PlatformCompatible(platform string) bool {
	for _, label := range PlatformLabels(runtime.GOOS, runtime.GOARCH) {
		if label == platform {
			return true
		}
	}
	return false
}

// CurrentPlatform 返回当前程序的平台串，用于界面提示。
func CurrentPlatform() string {
	return platformLabel(runtime.GOOS, runtime.GOARCH)
}

// ErrNothingStaged 表示没有已暂存、等待落地的更新。
var ErrNothingStaged = errors.New("update: nothing staged to apply")

// trimPackageExt 去掉归档扩展名，返回文件名主干。
func trimPackageExt(name string) (string, bool) {
	for _, ext := range []string{TarGzExt, ZipExt} {
		if strings.HasSuffix(name, ext) {
			return strings.TrimSuffix(name, ext), true
		}
	}
	return "", false
}

// platformLabel 把 GOOS/GOARCH 翻译成发布包文件名里的平台串。
func platformLabel(goos, goarch string) string {
	if goos == "darwin" {
		goos = "macos"
	}
	switch goarch {
	case "amd64":
		goarch = "x86_64"
	case "arm64":
		goarch = "arm64"
	}
	return fmt.Sprintf("%s-%s", goos, goarch)
}

func sortPackages(packages []Package) {
	sort.Slice(packages, func(i, j int) bool {
		if packages[i].ModifiedAt.Equal(packages[j].ModifiedAt) {
			return packages[i].Name > packages[j].Name
		}
		return packages[i].ModifiedAt.After(packages[j].ModifiedAt)
	})
}
