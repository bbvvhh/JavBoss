package server

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"javboss/internal/common"
	"javboss/internal/update"
)

type updateFixture struct {
	backupFixture
	programDir string
}

// newUpdateFixture 在备份 fixture 的基础上补一个「程序目录」，
// 程序更新覆盖的就是它（生产环境里由 common.BaseDir 提供）。
func newUpdateFixture(t *testing.T) updateFixture {
	t.Helper()
	fixture := newBackupFixture(t)
	programDir := t.TempDir()
	previousBaseDir := common.BaseDir
	common.BaseDir = programDir
	t.Cleanup(func() { common.BaseDir = previousBaseDir })
	return updateFixture{backupFixture: fixture, programDir: programDir}
}

func decodeUpdateOverview(t *testing.T, recorder *httptest.ResponseRecorder) updateOverview {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var overview updateOverview
	if err := json.Unmarshal(recorder.Body.Bytes(), &overview); err != nil {
		t.Fatalf("decode update overview: %v", err)
	}
	return overview
}

// fakeExecutable 造一个只有文件头的最小可执行文件，好让架构校验通过。
func fakeExecutable() []byte {
	if runtime.GOOS == "windows" {
		header := make([]byte, 0x48)
		copy(header, "MZ")
		binary.LittleEndian.PutUint32(header[0x3c:0x40], 0x40)
		copy(header[0x40:], []byte{'P', 'E', 0, 0})
		machine := uint16(0x8664)
		if runtime.GOARCH == "arm64" {
			machine = 0xaa64
		}
		binary.LittleEndian.PutUint16(header[0x44:0x46], machine)
		return header
	}
	header := make([]byte, 64)
	copy(header, []byte{0x7f, 'E', 'L', 'F'})
	header[5] = 1
	machine := uint16(62)
	switch runtime.GOARCH {
	case "arm64":
		machine = 183
	case "arm":
		machine = 40
	case "386":
		machine = 3
	}
	binary.LittleEndian.PutUint16(header[18:20], machine)
	return header
}

// currentPlatformPackageName 是当前平台能直接运行的发布包文件名。
func currentPlatformPackageName() string {
	return "javboss-v9.9.9-" + update.CurrentPlatform() + update.ZipExt
}

// incompatiblePlatform 返回一个当前平台跑不了的平台串。
func incompatiblePlatform() string {
	for _, label := range []string{"windows-x86_64", "linux-x86_64", "linux-arm64", "macos-arm64"} {
		if !update.PlatformCompatible(label) {
			return label
		}
	}
	return ""
}

func writeUpdatePackage(t *testing.T, dir, name string, extra map[string]string) {
	t.Helper()
	stem := strings.TrimSuffix(strings.TrimSuffix(name, update.TarGzExt), update.ZipExt)
	file, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("create update package: %v", err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	entries := map[string][]byte{
		stem + "/" + update.MainBinaryName(runtime.GOOS): fakeExecutable(),
	}
	for entryName, content := range extra {
		entries[stem+"/"+entryName] = []byte(content)
	}
	for entryName, content := range entries {
		header := &zip.FileHeader{Name: entryName, Method: zip.Deflate}
		header.SetMode(0o644)
		target, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatalf("write update package header %s: %v", entryName, err)
		}
		if _, err := target.Write(content); err != nil {
			t.Fatalf("write update package entry %s: %v", entryName, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close update package: %v", err)
	}
}

// TestUpdateAPIWithLocalFolder 覆盖本机目录形式的完整链路：
// 未配置 → 保存设置 → 列表 → 拒绝非法/异平台包 → 应用 → 确认结果。
func TestUpdateAPIWithLocalFolder(t *testing.T) {
	fixture := newUpdateFixture(t)
	packageDir := t.TempDir()

	overview := decodeUpdateOverview(t, fixture.do(t, http.MethodGet, "/update", ""))
	if overview.Platform != update.CurrentPlatform() {
		t.Fatalf("overview.Platform = %q", overview.Platform)
	}
	if overview.ProgramDir != fixture.programDir {
		t.Fatalf("overview.ProgramDir = %q, want %q", overview.ProgramDir, fixture.programDir)
	}
	if overview.PackagesError == "" {
		t.Fatal("an unconfigured update folder must be reported")
	}

	name := currentPlatformPackageName()
	writeUpdatePackage(t, packageDir, name, map[string]string{"web/dist/index.html": "<html>"})
	// 同前缀的备份文件绝不能出现在发布包列表里。
	if err := os.WriteFile(filepath.Join(packageDir, "javboss-backup-20260923-101010.zip"), []byte("backup"), 0o644); err != nil {
		t.Fatalf("write backup file: %v", err)
	}

	overview = decodeUpdateOverview(t, fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":`+strconv.Quote(packageDir)+`}`))
	if overview.UpdatePath != packageDir || overview.PackagesError != "" {
		t.Fatalf("settings overview = %#v", overview)
	}
	if len(overview.Packages) != 1 || overview.Packages[0].Name != name || !overview.Packages[0].Compatible {
		t.Fatalf("packages = %#v", overview.Packages)
	}

	// 保存路径必须是已存在的目录
	missing := filepath.Join(t.TempDir(), "missing")
	if recorder := fixture.do(t, http.MethodPut, "/update/settings", `{"update_path":`+strconv.Quote(missing)+`}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save missing update folder = %d", recorder.Code)
	}
	// 非法文件名不能触发更新
	if recorder := fixture.do(t, http.MethodPost, "/update/apply", `{"name":"../evil.zip"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("apply with invalid name = %d", recorder.Code)
	}
	// 别的平台的包要当场拒绝
	if platform := incompatiblePlatform(); platform != "" {
		other := "javboss-v9.9.9-" + platform + update.ZipExt
		if recorder := fixture.do(t, http.MethodPost, "/update/apply", `{"name":`+strconv.Quote(other)+`}`); recorder.Code != http.StatusBadRequest {
			t.Fatalf("apply with an incompatible platform = %d", recorder.Code)
		}
	}
	// 文件不在目录里
	absent := "javboss-v9.9.9-" + update.CurrentPlatform() + "-absent" + update.ZipExt
	if recorder := fixture.do(t, http.MethodPost, "/update/apply", `{"name":`+strconv.Quote(absent)+`}`); recorder.Code != http.StatusNotFound {
		t.Fatalf("apply with a missing package = %d", recorder.Code)
	}

	if runtime.GOOS == "windows" {
		// Windows 上替换交给退出后运行的 helper：接口写完响应就会退出进程，
		// 这里不触发，helper 脚本本身由 internal/update 的测试覆盖。
		t.Skip("the replacement is deferred to the helper script on Windows")
	}

	overview = decodeUpdateOverview(t, fixture.do(t, http.MethodPost, "/update/apply", `{"name":`+strconv.Quote(name)+`}`))
	if overview.LastUpdate == nil || overview.LastUpdate.Error != "" || !overview.LastUpdate.RestartNeeded {
		t.Fatalf("last update = %#v", overview.LastUpdate)
	}
	if overview.Pending != nil {
		t.Fatalf("pending update was not cleared: %#v", overview.Pending)
	}
	if _, err := os.Stat(filepath.Join(fixture.programDir, update.MainBinaryName(runtime.GOOS))); err != nil {
		t.Fatalf("the program binary was not replaced: %v", err)
	}
	if _, err := os.Stat(filepath.Join(fixture.programDir, "web", "dist", "index.html")); err != nil {
		t.Fatalf("the new asset was not installed: %v", err)
	}

	overview = decodeUpdateOverview(t, fixture.do(t, http.MethodPost, "/update/acknowledge", "{}"))
	if overview.LastUpdate != nil {
		t.Fatalf("acknowledge did not clear the result: %#v", overview.LastUpdate)
	}
}

// TestUpdateAPIWithWebDAVFolder 覆盖把发布包放在 WebDAV 上的链路。
// 发布包目录通常是只读挂载，所以只读的 WebDAV 连接也必须被接受。
func TestUpdateAPIWithWebDAVFolder(t *testing.T) {
	fixture := newUpdateFixture(t)
	dav := newWebDAVConnection(t, true)
	updatesDir := filepath.Join(dav.root, "updates")
	if err := os.MkdirAll(updatesDir, 0o755); err != nil {
		t.Fatalf("create updates collection: %v", err)
	}
	name := currentPlatformPackageName()
	writeUpdatePackage(t, updatesDir, name, nil)

	connectionID := strconv.FormatInt(dav.connectionID, 10)
	overview := decodeUpdateOverview(t, fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":"/updates","connection_id":`+connectionID+`}`))
	if overview.UpdateConnectionID == nil || *overview.UpdateConnectionID != dav.connectionID {
		t.Fatalf("update connection = %#v", overview.UpdateConnectionID)
	}
	if overview.UpdateConnectionName != dav.name || overview.UpdatePath != "/updates" {
		t.Fatalf("settings overview = %#v", overview)
	}
	if overview.PackagesError != "" || len(overview.Packages) != 1 || overview.Packages[0].Name != name {
		t.Fatalf("packages = %#v (%s)", overview.Packages, overview.PackagesError)
	}

	if recorder := fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":"/updates","connection_id":9999}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save unknown connection = %d", recorder.Code)
	}
	if recorder := fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":"/missing","connection_id":`+connectionID+`}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save missing remote folder = %d", recorder.Code)
	}
	if overview := decodeUpdateOverview(t, fixture.do(t, http.MethodGet, "/update", "")); overview.UpdateConnectionID == nil ||
		*overview.UpdateConnectionID != dav.connectionID {
		t.Fatalf("a rejected location must not be saved: %#v", overview.UpdateConnectionID)
	}

	if runtime.GOOS == "windows" {
		t.Skip("the replacement is deferred to the helper script on Windows")
	}

	// 远程包先下载到 data/update/staging/ 再解压、覆盖。
	overview = decodeUpdateOverview(t, fixture.do(t, http.MethodPost, "/update/apply", `{"name":`+strconv.Quote(name)+`}`))
	if overview.LastUpdate == nil || overview.LastUpdate.Error != "" {
		t.Fatalf("last update = %#v", overview.LastUpdate)
	}
	if _, err := os.Stat(filepath.Join(fixture.programDir, update.MainBinaryName(runtime.GOOS))); err != nil {
		t.Fatalf("the program binary was not replaced: %v", err)
	}
	if _, err := os.Stat(filepath.Join(update.UpdateDir(fixture.dataDir), "staging", name)); err == nil {
		t.Fatal("the downloaded package should have been cleaned up")
	}
}

// assertSameContent 断言两个文件的内容完全一致。
func assertSameContent(t *testing.T, want, got string) {
	t.Helper()
	expected, err := os.ReadFile(want)
	if err != nil {
		t.Fatalf("read %s: %v", want, err)
	}
	actual, err := os.ReadFile(got)
	if err != nil {
		t.Fatalf("read %s: %v", got, err)
	}
	if !bytes.Equal(expected, actual) {
		t.Fatalf("%s does not match %s", got, want)
	}
}

// assertDirEmpty 断言目录里空无一物，用来证明「下载」没有碰程序目录。
func assertDirEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	if len(entries) != 0 {
		t.Fatalf("%s should be untouched, found %d entries", dir, len(entries))
	}
}

// TestUpdateDownloadWithLocalFolder 覆盖本机目录来源的「下载」兜底按钮：
// 包被复制到更新流程统一使用的暂存路径，程序目录一字节都不动。
func TestUpdateDownloadWithLocalFolder(t *testing.T) {
	fixture := newUpdateFixture(t)
	packageDir := t.TempDir()
	name := currentPlatformPackageName()
	writeUpdatePackage(t, packageDir, name, map[string]string{"web/dist/index.html": "<html>"})

	if recorder := fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":`+strconv.Quote(packageDir)+`}`); recorder.Code != http.StatusOK {
		t.Fatalf("save update settings = %d body = %s", recorder.Code, recorder.Body.String())
	}
	// 非法文件名不能触发下载
	if recorder := fixture.do(t, http.MethodPost, "/update/download", `{"name":"../evil.zip"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("download with an invalid name = %d", recorder.Code)
	}
	// 目录里没有的包要报「不存在」，不是「位置不可用」
	absent := "javboss-v9.9.9-" + update.CurrentPlatform() + "-absent" + update.ZipExt
	if recorder := fixture.do(t, http.MethodPost, "/update/download", `{"name":`+strconv.Quote(absent)+`}`); recorder.Code != http.StatusNotFound {
		t.Fatalf("download a missing package = %d", recorder.Code)
	}

	recorder := fixture.do(t, http.MethodPost, "/update/download", `{"name":`+strconv.Quote(name)+`}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("download = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var result updateDownload
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode download result: %v", err)
	}
	want := update.StageArchivePath(fixture.dataDir, name)
	if result.Name != name || result.Path != want {
		t.Fatalf("download result = %#v, want path %q", result, want)
	}
	assertSameContent(t, filepath.Join(packageDir, name), want)
	assertDirEmpty(t, fixture.programDir)
}

// TestUpdateDownloadWithWebDAVFolder 覆盖远程来源的「下载」：
// 包落在 staging/ 下（与 apply 的落点一致），只读挂载也能用，程序目录不被触碰。
func TestUpdateDownloadWithWebDAVFolder(t *testing.T) {
	fixture := newUpdateFixture(t)
	dav := newWebDAVConnection(t, true)
	updatesDir := filepath.Join(dav.root, "updates")
	if err := os.MkdirAll(updatesDir, 0o755); err != nil {
		t.Fatalf("create updates collection: %v", err)
	}
	name := currentPlatformPackageName()
	writeUpdatePackage(t, updatesDir, name, nil)

	if recorder := fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":"/updates","connection_id":`+strconv.FormatInt(dav.connectionID, 10)+`}`); recorder.Code != http.StatusOK {
		t.Fatalf("save update settings = %d body = %s", recorder.Code, recorder.Body.String())
	}

	recorder := fixture.do(t, http.MethodPost, "/update/download", `{"name":`+strconv.Quote(name)+`}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("download = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var result updateDownload
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode download result: %v", err)
	}
	want := update.StageArchivePath(fixture.dataDir, name)
	if result.Path != want {
		t.Fatalf("download result path = %q, want %q", result.Path, want)
	}
	assertSameContent(t, filepath.Join(updatesDir, name), want)
	assertDirEmpty(t, fixture.programDir)
}

func TestUpdateSettingsRejectsInvalidPayload(t *testing.T) {
	fixture := newUpdateFixture(t)
	if recorder := fixture.do(t, http.MethodPut, "/update/settings", "{not json}"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save invalid payload = %d", recorder.Code)
	}
	// WebDAV 模式下必须给出远程目录
	dav := newWebDAVConnection(t, true)
	if recorder := fixture.do(t, http.MethodPut, "/update/settings",
		`{"update_path":"","connection_id":`+strconv.FormatInt(dav.connectionID, 10)+`}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save empty remote folder = %d", recorder.Code)
	}
}
