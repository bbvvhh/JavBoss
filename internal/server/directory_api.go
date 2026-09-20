package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/service"
	"javboss/internal/storage"
)

const maxDirectoryAutoScanIntervalMinutes = 525600

// listDirectories reports current-scan counts while scanning, otherwise directory totals.
func listDirectories(c *gin.Context) {
	dirs, err := dbpkg.ListDirectories(c.Request.Context())
	if err != nil {
		logging.Error("list directories error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载目录列表失败", "Failed to load directories")
		return
	}
	type directoryResponse struct {
		models.Directory
		IsScanning       bool   `json:"is_scanning"`
		WorkStatus       string `json:"work_status"`
		ScannedFileCount int64  `json:"scanned_file_count"` // Current scan only; zero when idle.
		ScanElapsedMS    int64  `json:"scan_elapsed_ms"`    // Includes file scanning and JAV linking; zero when idle.
	}
	response := make([]directoryResponse, len(dirs))
	for i := range dirs {
		workStatus, progress := service.DirectoryWorkSnapshot(dirs[i].ID)
		if progress != nil {
			dirs[i].ScannedVideoCount = progress.ScannedVideoCount
			dirs[i].ScrapedVideoCount = progress.ScrapedVideoCount
		}
		response[i] = directoryResponse{
			Directory:  dirs[i],
			IsScanning: workStatus == service.DirectoryWorkScanning,
			WorkStatus: workStatus,
		}
		if progress != nil {
			response[i].ScannedFileCount = progress.ScannedFileCount
			response[i].ScanElapsedMS = progress.ElapsedMS
		}
	}
	c.JSON(http.StatusOK, response)
}

// directorySourceRequest carries the storage-source fields of a directory
// create/update request.
type directorySourceRequest struct {
	Path         *string `json:"path"`
	RemotePath   *string `json:"remote_path"`
	Kind         *string `json:"kind"`
	ConnectionID *int64  `json:"connection_id"`
}

// changed reports whether the request asks to change where the directory reads from.
func (r directorySourceRequest) changed() bool {
	return r.Path != nil || r.RemotePath != nil || r.Kind != nil || r.ConnectionID != nil
}

// build resolves the requested source on top of the directory's current values,
// so a partial edit (for example only switching the kind) keeps the rest.
func (r directorySourceRequest) build(current *models.Directory) dbpkg.DirectorySource {
	source := dbpkg.DirectorySource{Kind: current.StorageKind(), Path: current.Path}
	if current.IsRemote() {
		source.Path = current.RemotePath
		source.ConnectionID = current.ConnectionID
	}
	if r.Kind != nil {
		source.Kind = *r.Kind
	}
	if storage.NormalizeKind(source.Kind) == storage.KindWebDAV {
		if r.ConnectionID != nil {
			source.ConnectionID = r.ConnectionID
		}
		switch {
		case r.RemotePath != nil:
			source.Path = *r.RemotePath
		case r.Path != nil:
			source.Path = *r.Path
		}
		return source
	}
	// Switching back to a local path drops the remote fields.
	source.ConnectionID = nil
	if r.Path != nil {
		source.Path = *r.Path
	}
	return source
}

func createDirectory(c *gin.Context) {
	var req struct {
		Path         string `json:"path"`
		RemotePath   string `json:"remote_path"`
		Kind         string `json:"kind"`
		ConnectionID int64  `json:"connection_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "添加目录请求无效", "Invalid add-directory request")
		return
	}

	source := dbpkg.DirectorySource{Kind: req.Kind, Path: strings.TrimSpace(req.Path)}
	if storage.NormalizeKind(req.Kind) == storage.KindWebDAV {
		source.Path = strings.TrimSpace(req.RemotePath)
		if source.Path == "" {
			source.Path = strings.TrimSpace(req.Path)
		}
		connectionID := req.ConnectionID
		source.ConnectionID = &connectionID
	}
	if strings.TrimSpace(source.Path) == "" {
		respondLocalizedError(c, http.StatusBadRequest, "目录路径不能为空", "Directory path is required")
		return
	}

	dir, err := dbpkg.CreateDirectoryFromSource(c.Request.Context(), source)
	if err != nil {
		logging.Error("create directory error: %v", err)
		respondDirectorySourceError(c, err, "添加目录失败，请检查路径是否有效或已存在", "Failed to add directory; check whether the path is valid or already exists")
		return
	}
	go func(created models.Directory) {
		ctx := context.Background()
		if _, err := service.ScanDirectory(ctx, created); err != nil {
			if errors.Is(err, service.ErrDirectoryScanInProgress) {
				return
			}
			logging.Error("scan after create failed id=%d path=%s err=%v", created.ID, created.Path, err)
		}
	}(*dir)
	c.JSON(http.StatusCreated, dir)
}

func updateDirectory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "目录 ID 无效", "Invalid directory ID")
		return
	}

	var req struct {
		Path                    *string `json:"path"`
		RemotePath              *string `json:"remote_path"`
		Kind                    *string `json:"kind"`
		ConnectionID            *int64  `json:"connection_id"`
		IsDelete                *bool   `json:"is_delete"`
		Enabled                 *bool   `json:"enabled"`
		AutoScanEnabled         *bool   `json:"auto_scan_enabled"`
		AutoScanIntervalMinutes *int    `json:"auto_scan_interval_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "修改目录请求无效", "Invalid directory update request")
		return
	}
	if req.Path != nil && strings.TrimSpace(*req.Path) == "" {
		respondLocalizedError(c, http.StatusBadRequest, "目录路径不能为空", "Directory path is required")
		return
	}
	if req.RemotePath != nil && strings.TrimSpace(*req.RemotePath) == "" {
		respondLocalizedError(c, http.StatusBadRequest, "远程路径不能为空", "Remote path is required")
		return
	}
	if req.AutoScanIntervalMinutes != nil &&
		(*req.AutoScanIntervalMinutes < 1 || *req.AutoScanIntervalMinutes > maxDirectoryAutoScanIntervalMinutes) {
		respondLocalizedError(c, http.StatusBadRequest, "自动扫描周期必须在 1 到 525600 分钟之间", "The automatic scan interval must be between 1 and 525600 minutes")
		return
	}

	current, err := dbpkg.GetDirectory(c.Request.Context(), id)
	if err != nil {
		logging.Error("get directory for update failed id=%d err=%v", id, err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
		return
	}
	if current == nil {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}

	sourceRequest := directorySourceRequest{
		Path:         req.Path,
		RemotePath:   req.RemotePath,
		Kind:         req.Kind,
		ConnectionID: req.ConnectionID,
	}
	sourceChanged := sourceRequest.changed()
	var source *dbpkg.DirectorySource
	if sourceChanged {
		resolved := sourceRequest.build(current)
		if strings.TrimSpace(resolved.Path) == "" {
			respondLocalizedError(c, http.StatusBadRequest, "目录路径不能为空", "Directory path is required")
			return
		}
		source = &resolved
	}

	var releaseScanReservation func()
	if sourceChanged || req.IsDelete != nil {
		reserveCtx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		release, err := service.CancelAndReserveDirectoryScan(reserveCtx, id)
		cancel()
		if err != nil {
			logging.Error("cancel directory scan before update failed id=%d err=%v", id, err)
			respondLocalizedError(c, http.StatusConflict, "目录扫描正在停止，请稍后重试", "The directory scan is stopping; please try again shortly")
			return
		}
		releaseScanReservation = release
		defer func() {
			if releaseScanReservation != nil {
				releaseScanReservation()
			}
		}()
	}

	dir, err := dbpkg.UpdateDirectorySource(c.Request.Context(), id, source, req.IsDelete, req.Enabled)
	if err != nil {
		logging.Error("update directory error: %v", err)
		respondDirectorySourceError(c, err, "修改目录失败，请检查路径是否有效或已存在", "Failed to update directory; check whether the path is valid or already exists")
		return
	}
	if dir == nil {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}
	if req.AutoScanEnabled != nil || req.AutoScanIntervalMinutes != nil {
		dir, err = dbpkg.UpdateDirectoryScanSettings(
			c.Request.Context(),
			id,
			req.AutoScanEnabled,
			req.AutoScanIntervalMinutes,
		)
		if err != nil {
			logging.Error("update directory scan settings error: %v", err)
			respondLocalizedError(c, http.StatusBadRequest, "修改目录扫描设置失败", "Failed to update directory scan settings")
			return
		}
		if dir == nil {
			respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
			return
		}
	}
	if releaseScanReservation != nil {
		releaseScanReservation()
		releaseScanReservation = nil
	}
	shouldScan := sourceChanged || (req.IsDelete != nil && !*req.IsDelete)
	go func(updated models.Directory, scan bool) {
		if updated.IsDelete || !scan {
			return
		}
		ctx := context.Background()
		if _, err := service.ScanDirectory(ctx, updated); err != nil {
			if errors.Is(err, service.ErrDirectoryScanInProgress) {
				return
			}
			logging.Error("scan after update failed id=%d path=%s err=%v", updated.ID, updated.Path, err)
		}
	}(*dir, shouldScan)
	c.JSON(http.StatusOK, dir)
}

// respondDirectorySourceError maps storage source failures to localized responses.
func respondDirectorySourceError(c *gin.Context, err error, zhFallback, enFallback string) {
	switch {
	case errors.Is(err, dbpkg.ErrStorageConnectionNotFound):
		respondLocalizedError(c, http.StatusBadRequest, "所选 WebDAV 连接不存在", "The selected WebDAV connection does not exist")
	default:
		respondLocalizedError(c, http.StatusBadRequest, zhFallback, enFallback)
	}
}

func scanDirectory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "目录 ID 无效", "Invalid directory ID")
		return
	}

	dir, err := dbpkg.GetDirectory(c.Request.Context(), id)
	if err != nil {
		logging.Error("get directory for manual scan failed id=%d err=%v", id, err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
		return
	}
	if dir == nil || dir.IsDelete {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}
	if service.DirectoryWorkStatus(id) != service.DirectoryWorkIdle {
		respondLocalizedError(c, http.StatusConflict, "目录正在执行其他任务，请稍后重试", "The directory is busy; please try again later")
		return
	}
	if err := service.StartManualDirectoryScan(*dir); err != nil {
		if errors.Is(err, service.ErrDirectoryScanInProgress) {
			respondLocalizedError(c, http.StatusConflict, "目录正在执行其他任务，请稍后重试", "The directory is busy; please try again later")
			return
		}
		logging.Error("start manual directory scan failed id=%d err=%v", id, err)
		respondLocalizedError(c, http.StatusInternalServerError, "启动目录扫描失败", "Failed to start the directory scan")
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"work_status": service.DirectoryWorkScanning})
}

func processDirectory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "目录 ID 无效", "Invalid directory ID")
		return
	}

	var req struct {
		Mode   string `json:"mode"`
		Layout string `json:"layout"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "目录处理请求无效", "Invalid directory processing request")
		return
	}

	dir, err := dbpkg.GetDirectory(c.Request.Context(), id)
	if err != nil {
		logging.Error("get directory for processing failed id=%d err=%v", id, err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取目录失败", "Failed to load directory")
		return
	}
	if dir == nil || dir.IsDelete {
		respondLocalizedError(c, http.StatusNotFound, "目录不存在", "Directory does not exist")
		return
	}
	if dir.Missing {
		respondLocalizedError(c, http.StatusConflict, "目录当前不可用", "The directory is currently unavailable")
		return
	}
	if dir.IsRemote() {
		respondRemoteWriteUnsupported(c, "整理远程目录", "organizing a remote directory")
		return
	}

	startCtx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := service.StartDirectoryProcessing(startCtx, *dir, req.Mode, req.Layout); err != nil {
		switch {
		case errors.Is(err, service.ErrRemoteDirectoryReadOnly):
			respondRemoteWriteUnsupported(c, "整理远程目录", "organizing a remote directory")
		case errors.Is(err, service.ErrInvalidDirectoryProcessMode):
			respondLocalizedError(c, http.StatusBadRequest, "目录处理模式无效", "Invalid directory processing mode")
		case errors.Is(err, service.ErrInvalidDirectoryProcessLayout):
			respondLocalizedError(c, http.StatusBadRequest, "目录整理方式无效", "Invalid directory organization layout")
		case errors.Is(err, service.ErrDirectoryWorkInProgress),
			errors.Is(err, service.ErrDirectoryScanInProgress),
			errors.Is(err, context.DeadlineExceeded):
			respondLocalizedError(c, http.StatusConflict, "目录正在执行其他任务，请稍后重试", "The directory is busy; please try again later")
		default:
			logging.Error("start directory processing failed id=%d mode=%s err=%v", id, req.Mode, err)
			respondLocalizedError(c, http.StatusInternalServerError, "启动目录处理失败", "Failed to start directory processing")
		}
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"work_status": service.DirectoryWorkStatus(id)})
}
