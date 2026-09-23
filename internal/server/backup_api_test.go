package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/webdav"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"
)

type backupFixture struct {
	router    *gin.Engine
	dataDir   string
	backupDir string
}

func newBackupFixture(t *testing.T) backupFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	dataDir := t.TempDir()
	database, err := dbpkg.Open(filepath.Join(dataDir, "javboss.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	previousConfig := common.AppConfig
	common.DB = database
	common.AppConfig = &common.Config{DatabasePath: filepath.Join(dataDir, "javboss.db")}
	t.Cleanup(func() {
		common.DB = previousDB
		common.AppConfig = previousConfig
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	coverDir := filepath.Join(dataDir, "cover")
	if err := os.MkdirAll(coverDir, 0o755); err != nil {
		t.Fatalf("create cover dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(coverDir, "a.jpg"), []byte("cover-a"), 0o644); err != nil {
		t.Fatalf("write cover file: %v", err)
	}

	router := gin.New()
	RegisterRoutes(router)
	return backupFixture{router: router, dataDir: dataDir, backupDir: t.TempDir()}
}

// webdavFixture 是一条指向测试 WebDAV 服务器的存储连接。
type webdavFixture struct {
	connectionID int64
	name         string
	root         string
}

// newWebDAVConnection 起一个 WebDAV 测试服务器并把它登记成一条存储连接。
// readOnly 为 true 时所有写操作返回 403，用来模拟只读挂载的网盘。
func newWebDAVConnection(t *testing.T, readOnly bool) webdavFixture {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "backups"), 0o755); err != nil {
		t.Fatalf("create backup collection: %v", err)
	}
	handler := &webdav.Handler{
		Prefix:     "/dav/",
		FileSystem: webdav.Dir(root),
		LockSystem: webdav.NewMemLS(),
	}
	var next http.Handler = handler
	if readOnly {
		next = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPut, http.MethodDelete, "MKCOL":
				http.Error(w, "read-only", http.StatusForbidden)
				return
			}
			handler.ServeHTTP(w, r)
		})
	}
	mux := http.NewServeMux()
	mux.Handle("/dav/", next)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	name := "dav-" + filepath.Base(root)
	url := server.URL + "/dav"
	username := ""
	password := ""
	connection, err := dbpkg.CreateStorageConnection(context.Background(), dbpkg.StorageConnectionInput{
		Name: &name, URL: &url, Username: &username, Password: &password,
	})
	if err != nil {
		t.Fatalf("create storage connection: %v", err)
	}
	return webdavFixture{connectionID: connection.ID, name: name, root: root}
}

func (f backupFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, request)
	return recorder
}

func decodeBackupOverview(t *testing.T, recorder *httptest.ResponseRecorder) backupOverview {
	t.Helper()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var overview backupOverview
	if err := json.Unmarshal(recorder.Body.Bytes(), &overview); err != nil {
		t.Fatalf("decode backup overview: %v", err)
	}
	return overview
}

func TestBackupAPIRoundTrip(t *testing.T) {
	fixture := newBackupFixture(t)

	// 还没配置备份路径时不允许打包
	if recorder := fixture.do(t, http.MethodPost, "/backup/run", "{}"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("backup without directory = %d", recorder.Code)
	}
	// 备份路径必须是已存在的目录
	missing := filepath.Join(t.TempDir(), "missing")
	if recorder := fixture.do(t, http.MethodPut, "/backup/settings", `{"backup_path":`+strconv.Quote(missing)+`}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save missing backup path = %d", recorder.Code)
	}

	overview := decodeBackupOverview(t, fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":`+strconv.Quote(fixture.backupDir)+`,"password":"pw"}`))
	if overview.BackupPath != fixture.backupDir || !overview.PasswordSet {
		t.Fatalf("settings overview = %#v", overview)
	}
	if overview.LastRestore != nil || overview.PendingRestore != nil {
		t.Fatalf("unexpected restore state = %#v", overview)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodPost, "/backup/run", "{}"))
	if len(overview.Files) != 1 {
		t.Fatalf("backup files = %#v", overview.Files)
	}
	name := overview.Files[0].Name
	archivePath := filepath.Join(fixture.backupDir, name)
	if info, err := os.Stat(archivePath); err != nil || info.Size() == 0 {
		t.Fatalf("backup archive = %#v (%v)", info, err)
	}

	// 非法文件名不能触发恢复
	if recorder := fixture.do(t, http.MethodPost, "/backup/restore", `{"name":"../evil.zip"}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("restore with invalid name = %d", recorder.Code)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodPost, "/backup/restore", `{"name":`+strconv.Quote(name)+`}`))
	if overview.PendingRestore == nil || overview.PendingRestore.FileName != name {
		t.Fatalf("pending restore = %#v", overview.PendingRestore)
	}
	if _, err := os.Stat(filepath.Join(fixture.dataDir, "restore", "pending.json")); err != nil {
		t.Fatalf("pending marker is missing: %v", err)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodDelete, "/backup/files/"+name, ""))
	if len(overview.Files) != 0 {
		t.Fatalf("backup files after delete = %#v", overview.Files)
	}
	if _, err := os.Stat(archivePath); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("backup archive still exists (%v)", err)
	}
}

// TestBackupAPIWithWebDAVLocation 覆盖「把备份存到扫描目录所在的 WebDAV 上」的完整链路：
// 保存设置、备份、恢复、删除。备份文件全程在对方服务器上，程序本地只留暂存副本。
func TestBackupAPIWithWebDAVLocation(t *testing.T) {
	fixture := newBackupFixture(t)
	dav := newWebDAVConnection(t, false)

	overview := decodeBackupOverview(t, fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":"/backups","connection_id":`+strconv.FormatInt(dav.connectionID, 10)+`}`))
	if overview.BackupConnectionID == nil || *overview.BackupConnectionID != dav.connectionID {
		t.Fatalf("backup connection = %#v", overview.BackupConnectionID)
	}
	if overview.BackupPath != "/backups" || overview.BackupConnectionName != dav.name {
		t.Fatalf("settings overview = %#v", overview)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodPost, "/backup/run", "{}"))
	if len(overview.Files) != 1 {
		t.Fatalf("backup files = %#v (%s)", overview.Files, overview.FilesError)
	}
	name := overview.Files[0].Name
	remotePath := filepath.Join(dav.root, "backups", name)
	if info, err := os.Stat(remotePath); err != nil || info.Size() == 0 {
		t.Fatalf("remote backup archive = %#v (%v)", info, err)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodPost, "/backup/restore",
		`{"name":`+strconv.Quote(name)+`}`))
	if overview.PendingRestore == nil || overview.PendingRestore.FileName != name {
		t.Fatalf("pending restore = %#v", overview.PendingRestore)
	}
	// 远程备份会被下载到暂存目录，Stage 就地解压，不再多复制一份
	if info, err := os.Stat(filepath.Join(fixture.dataDir, "restore", "source.zip")); err != nil || info.Size() == 0 {
		t.Fatalf("staged remote archive = %#v (%v)", info, err)
	}

	overview = decodeBackupOverview(t, fixture.do(t, http.MethodDelete, "/backup/files/"+name, ""))
	if len(overview.Files) != 0 {
		t.Fatalf("backup files after delete = %#v", overview.Files)
	}
	if _, err := os.Stat(remotePath); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("remote backup archive still exists (%v)", err)
	}
}

func TestBackupSettingsRejectsUnusableWebDAVLocation(t *testing.T) {
	fixture := newBackupFixture(t)

	// 只读挂载：能列目录但写不进去，必须当场拒绝
	readOnly := newWebDAVConnection(t, true)
	recorder := fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":"/backups","connection_id":`+strconv.FormatInt(readOnly.connectionID, 10)+`}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("save read-only location = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if overview := decodeBackupOverview(t, fixture.do(t, http.MethodGet, "/backup", "")); overview.BackupConnectionID != nil {
		t.Fatalf("read-only location was saved: %#v", overview.BackupConnectionID)
	}

	// 不存在的连接
	if recorder := fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":"/backups","connection_id":9999}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save unknown connection = %d", recorder.Code)
	}
	// 服务器上不存在这个目录
	writable := newWebDAVConnection(t, false)
	if recorder := fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":"/missing","connection_id":`+strconv.FormatInt(writable.connectionID, 10)+`}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("save missing remote folder = %d", recorder.Code)
	}
	// 既没选连接又没填路径才算没配置
	if recorder := fixture.do(t, http.MethodPost, "/backup/run", "{}"); recorder.Code != http.StatusBadRequest {
		t.Fatalf("backup without location = %d", recorder.Code)
	}
}

func TestBackupRestoreRejectsWrongPassword(t *testing.T) {
	fixture := newBackupFixture(t)
	decodeBackupOverview(t, fixture.do(t, http.MethodPut, "/backup/settings",
		`{"backup_path":`+strconv.Quote(fixture.backupDir)+`,"password":"pw"}`))
	overview := decodeBackupOverview(t, fixture.do(t, http.MethodPost, "/backup/run", "{}"))
	name := overview.Files[0].Name

	recorder := fixture.do(t, http.MethodPost, "/backup/restore",
		`{"name":`+strconv.Quote(name)+`,"password":"nope"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("restore with wrong password = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(fixture.dataDir, "restore", "pending.json")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("pending marker written for a failed restore (%v)", err)
	}
}
