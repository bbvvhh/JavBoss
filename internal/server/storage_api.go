package server

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/storage"
)

// storageProbeTimeout bounds a manual connection test or remote browse.
const storageProbeTimeout = 30 * time.Second

type storageConnectionRequest struct {
	Name     *string `json:"name"`
	URL      *string `json:"url"`
	Username *string `json:"username"`
	Password *string `json:"password"`
}

// listStorageConnections returns every remote storage connection. Passwords are
// never serialized; HasPassword tells the UI whether one is stored.
func listStorageConnections(c *gin.Context) {
	connections, err := dbpkg.ListStorageConnections(c.Request.Context())
	if err != nil {
		logging.Error("list storage connections error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载远程连接列表失败", "Failed to load remote connections")
		return
	}
	c.JSON(http.StatusOK, connections)
}

func createStorageConnection(c *gin.Context) {
	var req storageConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "新增连接请求无效", "Invalid connection request")
		return
	}
	connection, err := dbpkg.CreateStorageConnection(c.Request.Context(), toConnectionInput(req))
	if err != nil {
		logging.Error("create storage connection error: %v", err)
		respondStorageConnectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, connection)
}

func updateStorageConnection(c *gin.Context) {
	id, err := parseStorageConnectionID(c)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "连接 ID 无效", "Invalid connection ID")
		return
	}
	var req storageConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "修改连接请求无效", "Invalid connection request")
		return
	}
	connection, err := dbpkg.UpdateStorageConnection(c.Request.Context(), id, toConnectionInput(req))
	if err != nil {
		logging.Error("update storage connection error: %v", err)
		respondStorageConnectionError(c, err)
		return
	}
	if connection == nil {
		respondLocalizedError(c, http.StatusNotFound, "连接不存在", "Connection does not exist")
		return
	}
	c.JSON(http.StatusOK, connection)
}

func deleteStorageConnection(c *gin.Context) {
	id, err := parseStorageConnectionID(c)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "连接 ID 无效", "Invalid connection ID")
		return
	}
	switch err := dbpkg.DeleteStorageConnection(c.Request.Context(), id); {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	case errors.Is(err, dbpkg.ErrStorageConnectionInUse):
		respondLocalizedError(c, http.StatusConflict, "该连接仍被目录使用，请先切换或删除相关目录", "This connection is still used by directories; reassign or delete them first")
	case errors.Is(err, dbpkg.ErrStorageConnectionNotFound):
		respondLocalizedError(c, http.StatusNotFound, "连接不存在", "Connection does not exist")
	default:
		logging.Error("delete storage connection error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "删除连接失败", "Failed to delete the connection")
	}
}

// testStorageConnection verifies credentials and that a collection is reachable.
// It works for both a saved connection and unsaved form values, so the UI can
// validate an edit before persisting it.
func testStorageConnection(c *gin.Context) {
	var req struct {
		ConnectionID int64  `json:"connection_id"`
		URL          string `json:"url"`
		Username     string `json:"username"`
		Password     string `json:"password"`
		Path         string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "连接测试请求无效", "Invalid connection test request")
		return
	}

	connection, err := buildProbeConnection(c.Request.Context(), req.ConnectionID, req.URL, req.Username, req.Password)
	if err != nil {
		respondStorageConnectionError(c, err)
		return
	}
	remotePath := storage.NormalizeRemotePath(req.Path)
	backend, err := storage.NewWebDAV(connection, remotePath)
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "WebDAV 地址无效", "Invalid WebDAV address")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), storageProbeTimeout)
	defer cancel()
	entry, err := backend.StatRoot(ctx)
	if err != nil {
		logging.Error("test storage connection failed: url=%s err=%v", storage.Redact(connection.URL), storage.RedactError(err))
		respondStorageProbeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"path":   remotePath,
		"name":   entry.Name,
	})
}

// browseStorageDirectories lists remote folders with the same response shape as
// the local directory picker, so the frontend can reuse one component.
func browseStorageDirectories(c *gin.Context) {
	connectionID, err := strconv.ParseInt(strings.TrimSpace(c.Query("connection_id")), 10, 64)
	if err != nil || connectionID <= 0 {
		respondLocalizedError(c, http.StatusBadRequest, "连接 ID 无效", "Invalid connection ID")
		return
	}
	connection, err := loadProbeConnection(c.Request.Context(), connectionID)
	if err != nil {
		respondStorageConnectionError(c, err)
		return
	}

	remotePath := storage.NormalizeRemotePath(c.Query("path"))
	// Root the backend at the endpoint so any collection can be browsed.
	backend, err := storage.NewWebDAV(connection, "/")
	if err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "WebDAV 地址无效", "Invalid WebDAV address")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), storageProbeTimeout)
	defer cancel()
	entries, err := backend.List(ctx, remotePath)
	if err != nil {
		logging.Error("browse remote directories failed: path=%s err=%v", storage.Redact(remotePath), storage.RedactError(err))
		respondStorageProbeError(c, err)
		return
	}

	showHidden := c.Query("show_hidden") == "true"
	directories := make([]browsableDirectory, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir {
			continue
		}
		if !showHidden && strings.HasPrefix(entry.Name, ".") {
			continue
		}
		directories = append(directories, browsableDirectory{Name: entry.Name, Path: "/" + entry.RelPath})
	}
	sort.Slice(directories, func(i, j int) bool {
		a, b := strings.ToLower(directories[i].Name), strings.ToLower(directories[j].Name)
		if a == b {
			return directories[i].Name < directories[j].Name
		}
		return a < b
	})

	parent := ""
	if remotePath != "/" {
		parent = storage.NormalizeRemotePath(parentRemotePath(remotePath))
	}
	c.JSON(http.StatusOK, directoryBrowseResponse{
		Path:        remotePath,
		Parent:      parent,
		Home:        "/",
		Roots:       []browsableDirectory{{Name: connection.Name, Path: "/"}},
		Directories: directories,
	})
}

func parentRemotePath(remotePath string) string {
	if idx := strings.LastIndex(strings.TrimSuffix(remotePath, "/"), "/"); idx > 0 {
		return remotePath[:idx]
	}
	return "/"
}

func toConnectionInput(req storageConnectionRequest) dbpkg.StorageConnectionInput {
	return dbpkg.StorageConnectionInput{
		Name:     req.Name,
		URL:      req.URL,
		Username: req.Username,
		Password: req.Password,
	}
}

func parseStorageConnectionID(c *gin.Context) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid connection id")
	}
	return id, nil
}

func loadProbeConnection(ctx context.Context, id int64) (storage.Connection, error) {
	record, err := dbpkg.GetStorageConnection(ctx, id)
	if err != nil {
		return storage.Connection{}, err
	}
	if record == nil {
		return storage.Connection{}, dbpkg.ErrStorageConnectionNotFound
	}
	return storage.Connection{
		ID:       record.ID,
		Name:     record.Name,
		Kind:     storage.KindWebDAV,
		URL:      record.URL,
		Username: record.Username,
		Password: record.Password,
	}, nil
}

// buildProbeConnection prefers explicitly supplied form values so an unsaved
// edit can be tested, falling back to the stored connection.
func buildProbeConnection(ctx context.Context, id int64, url, username, password string) (storage.Connection, error) {
	var connection storage.Connection
	if id > 0 {
		stored, err := loadProbeConnection(ctx, id)
		if err != nil {
			return storage.Connection{}, err
		}
		connection = stored
	}
	if strings.TrimSpace(url) != "" {
		connection.URL = strings.TrimSpace(url)
	}
	if username != "" {
		connection.Username = username
	}
	if password != "" {
		connection.Password = password
	}
	if strings.TrimSpace(connection.URL) == "" {
		return storage.Connection{}, errors.New("storage connection URL is required")
	}
	return connection, nil
}

func respondStorageConnectionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, dbpkg.ErrStorageConnectionNotFound):
		respondLocalizedError(c, http.StatusNotFound, "连接不存在", "Connection does not exist")
	case errors.Is(err, dbpkg.ErrStorageConnectionInUse):
		respondLocalizedError(c, http.StatusConflict, "该连接仍被目录使用", "This connection is still used by directories")
	default:
		respondLocalizedError(c, http.StatusBadRequest, "连接信息无效或名称已存在", "The connection is invalid or its name already exists")
	}
}

func respondStorageProbeError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		respondLocalizedError(c, http.StatusNotFound, "远程路径不存在", "The remote path does not exist")
	case errors.Is(err, storage.ErrUnauthorized):
		respondLocalizedError(c, http.StatusForbidden, "WebDAV 认证失败，请检查账号密码", "WebDAV authentication failed; check the credentials")
	case errors.Is(err, storage.ErrUnsupported):
		respondLocalizedError(c, http.StatusNotImplemented, "该服务器不支持 WebDAV 协议", "The server does not support the WebDAV protocol")
	default:
		respondLocalizedError(c, http.StatusBadGateway, "无法连接远程服务器，请检查地址与网络", "Cannot reach the remote server; check the address and network")
	}
}
