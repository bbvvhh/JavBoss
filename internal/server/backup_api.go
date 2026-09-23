package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"javboss/internal/backup"
	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/storage"
	"javboss/internal/webdavstore"
)

// backupOpMu 串行化打包与恢复：恢复正在解压时再打包会得到一份半旧半新的数据。
var backupOpMu = make(chan struct{}, 1)

// backupOverview 是备份模块一次拉取的全部状态，所有写接口也返回它。
type backupOverview struct {
	BackupPath string `json:"backup_path"`
	// BackupConnectionID 非空时，backup_path 是这条 WebDAV 连接上的远程目录。
	BackupConnectionID   *int64               `json:"backup_connection_id"`
	BackupConnectionName string               `json:"backup_connection_name"`
	PasswordSet          bool                 `json:"password_set"`
	Files                []backup.File        `json:"files"`
	PendingRestore       *backup.Pending      `json:"pending_restore"`
	LastRestore          *backupRestoreResult `json:"last_restore"`
	// FilesError 是列举备份文件失败的原因（比如 WebDAV 暂时连不上）。
	// 这种情况下设置本身仍然可用，前端只提示列表读不到。
	FilesError string `json:"files_error"`
}

// backupRestoreResult 是最近一次重启落地的恢复结果。
type backupRestoreResult struct {
	FileName  string    `json:"file_name"`
	AppliedAt time.Time `json:"applied_at"`
	FileCount int       `json:"file_count"`
	Error     string    `json:"error"`
	// MissingDirectories 是恢复进来的库里指向本机不存在路径的本地目录，仅提示，不改写。
	MissingDirectories []string `json:"missing_directories"`
}

func getBackup(c *gin.Context) {
	respondBackupOverview(c, http.StatusOK)
}

func updateBackupSettings(c *gin.Context) {
	var request struct {
		BackupPath *string `json:"backup_path"`
		// ConnectionID 非空/正数表示备份写到该 WebDAV 连接的远程目录；0 表示改回本机目录。
		// 不传时保持当前选择。
		ConnectionID  *int64  `json:"connection_id"`
		Password      *string `json:"password"`
		ClearPassword bool    `json:"clear_password"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "备份设置格式不正确", "Invalid backup settings")
		return
	}
	settings, err := db.GetBackupSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取备份设置失败", "Failed to load backup settings")
		return
	}
	if request.ConnectionID != nil {
		if *request.ConnectionID > 0 {
			id := *request.ConnectionID
			settings.ConnectionID = &id
		} else {
			settings.ConnectionID = nil
		}
	}
	if request.BackupPath != nil {
		path := strings.TrimSpace(*request.BackupPath)
		if settings.ConnectionID == nil {
			directory, err := normalizeBackupDirectory(path)
			if err != nil {
				respondLocalizedError(c, http.StatusBadRequest, "备份保存路径必须是已存在的本地目录", "The backup directory must be an existing local directory")
				return
			}
			settings.BackupPath = directory
		} else {
			remotePath := storage.CleanRelPath(path)
			if remotePath == "" {
				respondLocalizedError(c, http.StatusBadRequest, "请选择 WebDAV 上的备份目录", "Choose a folder on the WebDAV server")
				return
			}
			settings.BackupPath = storage.NormalizeRemotePath(remotePath)
		}
	}
	// 位置发生变化时立刻验证真的可用：很多网盘的 WebDAV 是只读挂载，
	// 等到备份时才发现就太晚了。
	if (request.BackupPath != nil || request.ConnectionID != nil) && settings.ConnectionID != nil {
		store, err := resolveBackupStore(c.Request.Context(), settings)
		if err == nil {
			err = store.Probe(c.Request.Context())
		}
		if err != nil {
			logging.Error("probe backup store error: %v", err)
			zhMessage, enMessage := backupStoreErrorMessage(err)
			respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
			return
		}
	}
	switch {
	case request.ClearPassword:
		settings.Password = ""
	case request.Password != nil && *request.Password != "":
		// 空字符串表示「不修改」，清空密码请用 clear_password。
		if utf8.RuneCountInString(*request.Password) > backup.MaxPasswordLength {
			respondLocalizedError(c, http.StatusBadRequest, "压缩密码过长", "The backup password is too long")
			return
		}
		settings.Password = *request.Password
	}
	if err := db.SaveBackupSettings(c.Request.Context(), settings); err != nil {
		logging.Error("save backup settings error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存备份设置失败", "Failed to save backup settings")
		return
	}
	respondBackupOverview(c, http.StatusOK)
}

func runBackup(c *gin.Context) {
	var request struct {
		Password *string `json:"password"`
	}
	if err := c.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
		respondLocalizedError(c, http.StatusBadRequest, "备份设置格式不正确", "Invalid backup settings")
		return
	}
	settings, err := db.GetBackupSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取备份设置失败", "Failed to load backup settings")
		return
	}
	if backupPathMissing(settings) {
		respondLocalizedError(c, http.StatusBadRequest, "请先设置备份保存路径", "Set the backup directory first")
		return
	}
	store, err := resolveBackupStore(c.Request.Context(), settings)
	if err != nil {
		logging.Error("resolve backup store error: %v", err)
		zhMessage, enMessage := backupStoreErrorMessage(err)
		respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
		return
	}
	password := settings.Password
	if request.Password != nil && *request.Password != "" {
		if utf8.RuneCountInString(*request.Password) > backup.MaxPasswordLength {
			respondLocalizedError(c, http.StatusBadRequest, "压缩密码过长", "The backup password is too long")
			return
		}
		password = *request.Password
	}
	dataDir, databaseName, err := backupTarget()
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取数据目录失败", "Failed to resolve the data directory")
		return
	}

	release, ok := acquireBackupOp()
	if !ok {
		respondLocalizedError(c, http.StatusConflict, "已有备份或恢复任务正在执行，请稍后再试", "Another backup or restore is already running")
		return
	}
	defer release()
	// 打包可能超过服务器默认的 30s 写超时，这里单独放宽。
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{})

	if _, err := backup.Run(c.Request.Context(), backup.Options{
		DataDir:      dataDir,
		DatabaseName: databaseName,
		Store:        store,
		Password:     password,
		Snapshot:     db.SnapshotTo,
	}); err != nil {
		logging.Error("run backup error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "备份失败："+err.Error(), "Backup failed: "+err.Error())
		return
	}
	respondBackupOverview(c, http.StatusOK)
}

func restoreBackup(c *gin.Context) {
	var request struct {
		Name     string  `json:"name"`
		Password *string `json:"password"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "恢复请求格式不正确", "Invalid restore request")
		return
	}
	name := strings.TrimSpace(request.Name)
	if !backup.ValidFileName(name) {
		respondLocalizedError(c, http.StatusBadRequest, "备份文件不存在", "Backup file not found")
		return
	}
	settings, err := db.GetBackupSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取备份设置失败", "Failed to load backup settings")
		return
	}
	if backupPathMissing(settings) {
		respondLocalizedError(c, http.StatusBadRequest, "请先设置备份保存路径", "Set the backup directory first")
		return
	}
	store, err := resolveBackupStore(c.Request.Context(), settings)
	if err != nil {
		logging.Error("resolve backup store error: %v", err)
		zhMessage, enMessage := backupStoreErrorMessage(err)
		respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
		return
	}
	password := settings.Password
	if request.Password != nil && *request.Password != "" {
		password = *request.Password
	}
	dataDir, databaseName, err := backupTarget()
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取数据目录失败", "Failed to resolve the data directory")
		return
	}
	// 远程备份直接下载到暂存目录，Stage 会就地解压，不再多复制一份。
	archivePath := backup.StageSourcePath(dataDir)
	if settings.ConnectionID == nil {
		archivePath = filepath.Join(settings.BackupPath, name)
		if info, err := os.Stat(archivePath); err != nil || !info.Mode().IsRegular() {
			respondLocalizedError(c, http.StatusNotFound, "备份文件不存在", "Backup file not found")
			return
		}
	}

	release, ok := acquireBackupOp()
	if !ok {
		respondLocalizedError(c, http.StatusConflict, "已有备份或恢复任务正在执行，请稍后再试", "Another backup or restore is already running")
		return
	}
	defer release()
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{})

	if settings.ConnectionID != nil {
		if err := store.Fetch(c.Request.Context(), name, archivePath); err != nil {
			logging.Error("download backup archive error: %v", err)
			if errors.Is(err, storage.ErrNotFound) {
				respondLocalizedError(c, http.StatusNotFound, "备份文件不存在", "Backup file not found")
				return
			}
			zhMessage, enMessage := backupStoreErrorMessage(err)
			respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
			return
		}
	}

	if _, err := backup.Stage(c.Request.Context(), backup.RestoreOptions{
		DataDir:      dataDir,
		DatabaseName: databaseName,
		ArchivePath:  archivePath,
		FileName:     name,
		Password:     password,
	}); err != nil {
		if errors.Is(err, backup.ErrWrongPassword) {
			respondLocalizedError(c, http.StatusBadRequest, "压缩密码不正确，或备份文件已损坏", "The backup password is incorrect, or the file is corrupted")
			return
		}
		logging.Error("stage restore error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "恢复失败："+err.Error(), "Restore failed: "+err.Error())
		return
	}
	respondBackupOverview(c, http.StatusOK)
}

func deleteBackupFile(c *gin.Context) {
	settings, err := db.GetBackupSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取备份设置失败", "Failed to load backup settings")
		return
	}
	store, err := resolveBackupStore(c.Request.Context(), settings)
	if err != nil {
		logging.Error("resolve backup store error: %v", err)
		zhMessage, enMessage := backupStoreErrorMessage(err)
		respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
		return
	}
	if err := store.Delete(c.Request.Context(), c.Param("name")); err != nil {
		logging.Error("delete backup file error: %v", err)
		respondLocalizedError(c, http.StatusNotFound, "删除备份文件失败", "Failed to delete the backup file")
		return
	}
	respondBackupOverview(c, http.StatusOK)
}

// acknowledgeBackupRestore 清除「最近一次恢复」的提示。
func acknowledgeBackupRestore(c *gin.Context) {
	dataDir, _, err := backupTarget()
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取数据目录失败", "Failed to resolve the data directory")
		return
	}
	if err := backup.AcknowledgeApplied(dataDir); err != nil {
		logging.Error("acknowledge restore result error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新恢复状态失败", "Failed to update the restore state")
		return
	}
	respondBackupOverview(c, http.StatusOK)
}

func respondBackupOverview(c *gin.Context, status int) {
	overview, err := loadBackupOverview(c.Request.Context())
	if err != nil {
		logging.Error("load backup overview error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取备份配置失败", "Failed to load backup settings")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(status, overview)
}

func loadBackupOverview(ctx context.Context) (*backupOverview, error) {
	settings, err := db.GetBackupSettings(ctx)
	if err != nil {
		return nil, err
	}
	dataDir, _, err := backupTarget()
	if err != nil {
		return nil, err
	}
	pending, err := backup.ReadPending(dataDir)
	if err != nil {
		return nil, err
	}
	applied, err := backup.ReadApplied(dataDir)
	if err != nil {
		return nil, err
	}

	overview := &backupOverview{
		BackupPath:         settings.BackupPath,
		BackupConnectionID: settings.ConnectionID,
		PasswordSet:        settings.Password != "",
		PendingRestore:     pending,
	}
	// 备份位置不可用时（比如 WebDAV 连不上、连接被删了）依然返回设置本身，
	// 只把「读不到备份列表」的原因带上，否则整个设置页都会打不开。
	store, storeErr := resolveBackupStore(ctx, settings)
	if storeErr != nil {
		overview.FilesError = storeErr.Error()
	} else if files, err := store.List(ctx); err != nil {
		logging.Error("list backup files error: %v", err)
		overview.FilesError = err.Error()
	} else {
		overview.Files = files
	}
	if settings.ConnectionID != nil {
		if record, err := db.GetStorageConnection(ctx, *settings.ConnectionID); err == nil && record != nil {
			overview.BackupConnectionName = record.Name
		}
	}
	if applied != nil {
		result := &backupRestoreResult{
			FileName: applied.FileName, AppliedAt: applied.AppliedAt,
			FileCount: applied.FileCount, Error: applied.Error,
		}
		if applied.Error == "" {
			missing, err := missingLocalDirectories(ctx)
			if err != nil {
				return nil, err
			}
			result.MissingDirectories = missing
		}
		overview.LastRestore = result
	}
	return overview, nil
}

// missingLocalDirectories 列出恢复后在本机找不到的本地目录，交给前端提示。
// 恢复只覆盖数据，不会改写指向别的设备的视频目录路径。
func missingLocalDirectories(ctx context.Context) ([]string, error) {
	directories, err := db.ListDirectories(ctx)
	if err != nil {
		return nil, err
	}
	missing := make([]string, 0, len(directories))
	for _, directory := range directories {
		if directory.IsRemote() || strings.TrimSpace(directory.Path) == "" {
			continue
		}
		if _, err := os.Stat(directory.Path); err != nil {
			missing = append(missing, directory.Path)
		}
	}
	sort.Strings(missing)
	return missing, nil
}

// backupTarget 返回 data 目录与数据库文件名。
func backupTarget() (string, string, error) {
	cfg := common.AppConfig
	if cfg == nil || strings.TrimSpace(cfg.DatabasePath) == "" {
		return "", "", errors.New("backup: application config is unavailable")
	}
	return filepath.Dir(cfg.DatabasePath), filepath.Base(cfg.DatabasePath), nil
}

// acquireBackupOp 尝试占用打包/恢复名额，占用失败返回 (nil, false)。
func acquireBackupOp() (func(), bool) {
	select {
	case backupOpMu <- struct{}{}:
		return func() { <-backupOpMu }, true
	default:
		return nil, false
	}
}

// resolveBackupStore 返回当前设置对应的备份存放位置：本机目录或 WebDAV 远程目录。
func resolveBackupStore(ctx context.Context, settings *models.BackupSettings) (backup.Store, error) {
	if settings == nil {
		return nil, errors.New("backup settings are unavailable")
	}
	if settings.ConnectionID == nil || *settings.ConnectionID <= 0 {
		return backup.NewLocalStore(settings.BackupPath), nil
	}
	connection, err := loadProbeConnection(ctx, *settings.ConnectionID)
	if err != nil {
		return nil, fmt.Errorf("load backup WebDAV connection: %w", err)
	}
	store, err := webdavstore.New(connection, settings.BackupPath)
	if err != nil {
		return nil, fmt.Errorf("connect backup WebDAV location: %w", err)
	}
	return store, nil
}

// backupPathMissing 表示还没有配置任何备份保存位置。
func backupPathMissing(settings *models.BackupSettings) bool {
	if settings == nil {
		return true
	}
	if settings.ConnectionID != nil && *settings.ConnectionID > 0 {
		return false
	}
	return strings.TrimSpace(settings.BackupPath) == ""
}

// backupStoreErrorMessage 把备份位置的故障翻译成用户能自己处理的提示。
func backupStoreErrorMessage(err error) (string, string) {
	switch {
	case errors.Is(err, webdavstore.ErrReadOnly):
		return "该 WebDAV 目录不可写，服务器可能只提供只读挂载",
			"The WebDAV folder is not writable; the server may expose a read-only mount"
	case errors.Is(err, storage.ErrUnauthorized):
		return "WebDAV 认证失败，请检查连接的账号密码",
			"WebDAV authentication failed; check the connection credentials"
	case errors.Is(err, storage.ErrNotFound):
		return "WebDAV 上的备份目录不存在或已被删除",
			"The backup folder does not exist on the WebDAV server"
	case errors.Is(err, db.ErrStorageConnectionNotFound):
		return "备份使用的 WebDAV 连接已不存在，请重新选择",
			"The WebDAV connection used for backups no longer exists; choose another one"
	default:
		return "备份位置不可用：" + err.Error(), "The backup location is unavailable: " + err.Error()
	}
}

func normalizeBackupDirectory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	value = filepath.Clean(value)
	if !filepath.IsAbs(value) {
		return "", errors.New("backup directory is not absolute")
	}
	info, err := os.Stat(value)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("backup directory is not a directory")
	}
	return value, nil
}
