package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/storage"
	"javboss/internal/update"
)

// updateOpMu 串行化「下载 + 解压 + 覆盖」：更新的每一步都假设程序目录没被别人动过。
var updateOpMu = make(chan struct{}, 1)

// updateOverview 是程序更新模块一次拉取的全部状态，所有写接口也返回它。
type updateOverview struct {
	UpdatePath string `json:"update_path"`
	// UpdateConnectionID 非空时，update_path 是这条 WebDAV 连接上的远程目录。
	UpdateConnectionID   *int64 `json:"update_connection_id"`
	UpdateConnectionName string `json:"update_connection_name"`
	// Platform 是当前程序的平台串，用于和发布包文件名里的平台比对。
	Platform string `json:"platform"`
	// ProgramDir 是即将被覆盖的程序目录，界面上要如实告诉用户。
	ProgramDir string                `json:"program_dir"`
	Packages   []update.Package      `json:"packages"`
	Pending    *update.Pending       `json:"pending"`
	LastUpdate *update.AppliedResult `json:"last_update"`
	// PackagesError 是列举发布包失败的原因（比如 WebDAV 暂时连不上）。
	// 这种情况下设置本身仍然可用，前端只提示列表读不到。
	PackagesError string `json:"packages_error"`
}

func getUpdate(c *gin.Context) {
	respondUpdateOverview(c, http.StatusOK)
}

func updateUpdateSettings(c *gin.Context) {
	var request struct {
		UpdatePath *string `json:"update_path"`
		// ConnectionID 非空/正数表示发布包放在该 WebDAV 连接的远程目录；0 表示改回本机目录。
		// 不传时保持当前选择。
		ConnectionID *int64 `json:"connection_id"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "更新设置格式不正确", "Invalid update settings")
		return
	}
	settings, err := db.GetUpdateSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取更新设置失败", "Failed to load update settings")
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
	if request.UpdatePath != nil {
		path := strings.TrimSpace(*request.UpdatePath)
		if settings.ConnectionID == nil {
			directory, err := normalizeBackupDirectory(path)
			if err != nil {
				respondLocalizedError(c, http.StatusBadRequest, "更新包目录必须是已存在的本地目录", "The update folder must be an existing local directory")
				return
			}
			settings.UpdatePath = directory
		} else {
			remotePath := storage.CleanRelPath(path)
			if remotePath == "" {
				respondLocalizedError(c, http.StatusBadRequest, "请选择 WebDAV 上的更新包目录", "Choose a folder on the WebDAV server")
				return
			}
			settings.UpdatePath = storage.NormalizeRemotePath(remotePath)
		}
	}
	// 位置发生变化时立刻验证真的能读到：发布包目录经常是只读挂载，
	// 或者路径写法不对，等到点更新才发现就太晚了。
	if (request.UpdatePath != nil || request.ConnectionID != nil) && settings.ConnectionID != nil {
		source, err := resolveUpdateSource(c.Request.Context(), settings)
		if err == nil {
			err = source.Probe(c.Request.Context())
		}
		if err != nil {
			logging.Error("probe update source error: %v", err)
			zhMessage, enMessage := updateSourceErrorMessage(err)
			respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
			return
		}
	}
	if err := db.SaveUpdateSettings(c.Request.Context(), settings); err != nil {
		logging.Error("save update settings error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存更新设置失败", "Failed to save update settings")
		return
	}
	respondUpdateOverview(c, http.StatusOK)
}

// applyUpdate 下载并校验发布包、解压到暂存，再覆盖程序目录。
//
// 覆盖是这一步立刻做的：用户点的是「更新」，不是「准备更新」。
// Windows 上覆盖由 helper 在进程退出后接手（Deferred），所以这里写完响应就退出进程。
func applyUpdate(c *gin.Context) {
	var request struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "更新请求格式不正确", "Invalid update request")
		return
	}
	name := strings.TrimSpace(request.Name)
	if !update.ValidPackageName(name) {
		respondLocalizedError(c, http.StatusBadRequest, "更新包不存在", "Update package not found")
		return
	}
	settings, err := db.GetUpdateSettings(c.Request.Context())
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取更新设置失败", "Failed to load update settings")
		return
	}
	if updatePathMissing(settings) {
		respondLocalizedError(c, http.StatusBadRequest, "请先设置更新包所在目录", "Set the update folder first")
		return
	}
	if platform := update.PackagePlatform(name); platform != "" && !update.PlatformCompatible(platform) {
		respondLocalizedError(c, http.StatusBadRequest,
			"这个更新包是给 "+platform+" 用的，不能用在 "+update.CurrentPlatform()+" 上",
			"This update package targets "+platform+" and cannot be used on "+update.CurrentPlatform())
		return
	}
	source, err := resolveUpdateSource(c.Request.Context(), settings)
	if err != nil {
		logging.Error("resolve update source error: %v", err)
		zhMessage, enMessage := updateSourceErrorMessage(err)
		respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
		return
	}
	dataDir, programDir, err := updateTarget()
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取程序目录失败", "Failed to resolve the program directory")
		return
	}

	release, ok := acquireUpdateOp()
	if !ok {
		respondLocalizedError(c, http.StatusConflict, "已有更新任务正在执行，请稍后再试", "Another update is already running")
		return
	}
	defer release()
	// 下载与解压可能超过服务器默认的 30s 写超时，这里单独放宽。
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Time{})

	archivePath := filepath.Join(settings.UpdatePath, name)
	if settings.ConnectionID != nil {
		// 远程包先下载到暂存目录，校验边车尽力取回（发布脚本不一定产出它）。
		archivePath = update.StageArchivePath(dataDir, name)
		if err := source.Fetch(c.Request.Context(), name, archivePath); err != nil {
			logging.Error("download update package error: %v", err)
			if errors.Is(err, storage.ErrNotFound) {
				respondLocalizedError(c, http.StatusNotFound, "更新包不存在", "Update package not found")
				return
			}
			zhMessage, enMessage := updateSourceErrorMessage(err)
			respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
			return
		}
		if _, err := source.FetchSidecar(c.Request.Context(), name, archivePath+update.Sha256Ext); err != nil {
			logging.Error("download update checksum error: %v", err)
			zhMessage, enMessage := updateSourceErrorMessage(err)
			respondLocalizedError(c, http.StatusBadRequest, zhMessage, enMessage)
			return
		}
	} else if info, err := os.Stat(archivePath); err != nil || !info.Mode().IsRegular() {
		respondLocalizedError(c, http.StatusNotFound, "更新包不存在", "Update package not found")
		return
	}

	if _, err := update.Stage(c.Request.Context(), update.StageOptions{
		DataDir:     dataDir,
		ProgramDir:  programDir,
		ArchivePath: archivePath,
		FileName:    name,
	}); err != nil {
		if errors.Is(err, update.ErrNothingStaged) {
			respondLocalizedError(c, http.StatusConflict, "没有可用的更新包", "No update package is available")
			return
		}
		logging.Error("stage update error: %v", err)
		respondLocalizedError(c, http.StatusBadRequest, "更新包校验失败："+err.Error(), "The update package was rejected: "+err.Error())
		return
	}

	applied, err := update.Apply(c.Request.Context(), update.ApplyOptions{
		DataDir:     dataDir,
		ProgramDir:  programDir,
		ArchivePath: archivePath,
	})
	if err != nil {
		logging.Error("apply update error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新失败："+err.Error(), "Update failed: "+err.Error())
		return
	}
	respondUpdateOverview(c, http.StatusOK)
	if applied.Deferred {
		// Windows：替换由 helper 在本进程退出后进行。响应必须完整写出去之后再退出，
		// 否则前端会拿到截断的 JSON。
		c.Writer.Flush()
		update.ExitForUpdate()
	}
}

// acknowledgeUpdate 清除「最近一次更新」的提示。
func acknowledgeUpdate(c *gin.Context) {
	dataDir, _, err := backupTarget()
	if err != nil {
		respondLocalizedError(c, http.StatusInternalServerError, "读取数据目录失败", "Failed to resolve the data directory")
		return
	}
	if err := update.AcknowledgeApplied(dataDir); err != nil {
		logging.Error("acknowledge update result error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "更新更新状态失败", "Failed to update the update state")
		return
	}
	respondUpdateOverview(c, http.StatusOK)
}

func respondUpdateOverview(c *gin.Context, status int) {
	overview, err := loadUpdateOverview(c.Request.Context())
	if err != nil {
		logging.Error("load update overview error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取更新配置失败", "Failed to load update settings")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(status, overview)
}

func loadUpdateOverview(ctx context.Context) (*updateOverview, error) {
	settings, err := db.GetUpdateSettings(ctx)
	if err != nil {
		return nil, err
	}
	dataDir, programDir, err := updateTarget()
	if err != nil {
		return nil, err
	}
	pending, err := update.ReadPending(dataDir)
	if err != nil {
		return nil, err
	}
	applied, err := update.ReadApplied(dataDir)
	if err != nil {
		return nil, err
	}

	overview := &updateOverview{
		UpdatePath:         settings.UpdatePath,
		UpdateConnectionID: settings.ConnectionID,
		Platform:           update.CurrentPlatform(),
		ProgramDir:         programDir,
		Pending:            pending,
		LastUpdate:         applied,
	}
	// 位置不可用时（比如 WebDAV 连不上、连接被删了）依然返回设置本身，
	// 只把「读不到发布包列表」的原因带上，否则整个设置页都会打不开。
	source, sourceErr := resolveUpdateSource(ctx, settings)
	if sourceErr != nil {
		overview.PackagesError = sourceErr.Error()
	} else if packages, err := source.List(ctx); err != nil {
		logging.Error("list update packages error: %v", err)
		overview.PackagesError = err.Error()
	} else {
		overview.Packages = packages
	}
	if settings.ConnectionID != nil {
		if record, err := db.GetStorageConnection(ctx, *settings.ConnectionID); err == nil && record != nil {
			overview.UpdateConnectionName = record.Name
		}
	}
	return overview, nil
}

// updateTarget 返回 data 目录与要被覆盖的程序目录。
func updateTarget() (string, string, error) {
	dataDir, _, err := backupTarget()
	if err != nil {
		return "", "", err
	}
	programDir := strings.TrimSpace(common.BaseDir)
	if programDir == "" {
		return "", "", errors.New("update: program directory is unavailable")
	}
	return dataDir, programDir, nil
}

// acquireUpdateOp 尝试占用更新名额，占用失败返回 (nil, false)。
func acquireUpdateOp() (func(), bool) {
	select {
	case updateOpMu <- struct{}{}:
		return func() { <-updateOpMu }, true
	default:
		return nil, false
	}
}

// resolveUpdateSource 返回当前设置对应的发布包位置：本机目录或 WebDAV 远程目录。
func resolveUpdateSource(ctx context.Context, settings *models.UpdateSettings) (update.Source, error) {
	if settings == nil {
		return nil, errors.New("update settings are unavailable")
	}
	if settings.ConnectionID == nil || *settings.ConnectionID <= 0 {
		dir := strings.TrimSpace(settings.UpdatePath)
		if dir == "" {
			return nil, errors.New("update: update folder is not configured")
		}
		return update.NewLocalSource(dir), nil
	}
	connection, err := loadProbeConnection(ctx, *settings.ConnectionID)
	if err != nil {
		return nil, fmt.Errorf("load update WebDAV connection: %w", err)
	}
	source, err := update.NewWebDAVSource(connection, settings.UpdatePath)
	if err != nil {
		return nil, fmt.Errorf("connect update WebDAV location: %w", err)
	}
	return source, nil
}

// updatePathMissing 表示还没有配置任何更新包位置。
func updatePathMissing(settings *models.UpdateSettings) bool {
	if settings == nil {
		return true
	}
	if settings.ConnectionID != nil && *settings.ConnectionID > 0 {
		return false
	}
	return strings.TrimSpace(settings.UpdatePath) == ""
}

// updateSourceErrorMessage 把更新包位置的故障翻译成用户能自己处理的提示。
func updateSourceErrorMessage(err error) (string, string) {
	switch {
	case errors.Is(err, storage.ErrUnauthorized):
		return "WebDAV 认证失败，请检查连接的账号密码", "WebDAV authentication failed; check the connection credentials"
	case errors.Is(err, storage.ErrNotFound):
		return "WebDAV 上的更新包目录不存在或已被删除", "The update folder does not exist on the WebDAV server"
	case errors.Is(err, db.ErrStorageConnectionNotFound):
		return "更新使用的 WebDAV 连接已不存在，请重新选择", "The WebDAV connection used for updates no longer exists; choose another one"
	default:
		return "更新包位置不可用：" + err.Error(), "The update package location is unavailable: " + err.Error()
	}
}
