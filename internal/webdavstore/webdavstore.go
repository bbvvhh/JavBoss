// Package webdavstore 把备份写到 WebDAV 服务器上的一个集合里。
//
// internal/storage 的 Backend 是「只读视频源」契约（见该包的包注释），所以这里只借用
// 它的读能力（PROPFIND / 带 Range 的 GET），写能力（PUT / MKCOL / DELETE）由本包自己
// 实现，避免把只读契约撑成可写。这样备份也能落到扫描目录所在的网盘上。
package webdavstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"javboss/internal/backup"
	"javboss/internal/storage"
	"javboss/internal/util"
)

// ErrReadOnly 表示服务器上这个集合存在，但拒绝写入（很多网盘只提供只读 WebDAV）。
var ErrReadOnly = errors.New("webdav backup location is not writable")

// Store 实现 backup.Store，把归档放在某个 WebDAV 连接的远程目录里。
type Store struct {
	conn   storage.Connection
	root   string
	base   *url.URL
	client *http.Client
	reader *storage.WebDAV
}

// New 构建写入 conn 上 remotePath 目录的备份存储。
func New(conn storage.Connection, remotePath string) (*Store, error) {
	reader, err := storage.NewWebDAV(conn, remotePath)
	if err != nil {
		return nil, err
	}
	base, err := parseBaseURL(conn.URL)
	if err != nil {
		return nil, err
	}
	// 复用 util 的客户端：它带代理探测，并且在系统 /etc/resolv.conf 只有失效的
	// loopback 解析器时（Termux/容器）会换用可用的 DNS 兜底。恢复必须走这条路：
	// 移动云 EOS 这类 WebDAV 的 GET 会 302 到对象存储域名，跟随跳转请求解析的
	// 是另一个域名，用默认解析器会直接 dial 失败。
	// 不设总超时：备份归档可能有几个 GB，靠调用方的 context 控制。
	client := util.NewHTTPClientWithTransport(0, func(transport *http.Transport) {
		transport.ForceAttemptHTTP2 = true
		transport.MaxIdleConns = 8
		transport.IdleConnTimeout = 90 * time.Second
		transport.TLSHandshakeTimeout = 15 * time.Second
		transport.ExpectContinueTimeout = 5 * time.Second
		transport.ResponseHeaderTimeout = 60 * time.Second
		// 备份归档不可被中间层重新编码。
		transport.DisableCompression = true
	})
	return &Store{
		conn:   conn,
		root:   storage.NormalizeRemotePath(remotePath),
		base:   base,
		client: client,
		reader: reader,
	}, nil
}

// Root 返回备份所在的远程目录（已规范化）。
func (s *Store) Root() string { return s.root }

func (s *Store) List(ctx context.Context) ([]backup.File, error) {
	entries, err := s.reader.List(ctx, "")
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	files := make([]backup.File, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir || !backup.ValidFileName(entry.Name) {
			continue
		}
		files = append(files, backup.File{
			Name: entry.Name, Size: entry.Size, ModifiedAt: entry.ModTime,
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModifiedAt.After(files[j].ModifiedAt) })
	return files, nil
}

func (s *Store) Exists(ctx context.Context, name string) (bool, error) {
	if !backup.ValidFileName(name) {
		return false, nil
	}
	if _, err := s.reader.Stat(ctx, name); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *Store) Put(ctx context.Context, name string, write func(io.Writer) error) (backup.File, error) {
	if !backup.ValidFileName(name) {
		return backup.File{}, fmt.Errorf("invalid backup file name %q", name)
	}
	// WebDAV 服务器普遍不接受长度未知的 PUT（分块传输），所以先落到本机临时文件，
	// 知道长度后再整块上传。
	tempDir, err := os.MkdirTemp("", "javboss-backup-upload-")
	if err != nil {
		return backup.File{}, fmt.Errorf("create upload staging directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	tempPath := filepath.Join(tempDir, name)
	staging, err := os.Create(tempPath)
	if err != nil {
		return backup.File{}, fmt.Errorf("create upload staging file: %w", err)
	}
	writeErr := write(staging)
	closeErr := staging.Close()
	if writeErr != nil {
		return backup.File{}, writeErr
	}
	if closeErr != nil {
		return backup.File{}, fmt.Errorf("close upload staging file: %w", closeErr)
	}
	info, err := os.Stat(tempPath)
	if err != nil {
		return backup.File{}, fmt.Errorf("inspect upload staging file: %w", err)
	}

	if err := s.upload(ctx, name, tempPath, info.Size()); err != nil {
		return backup.File{}, err
	}
	return backup.File{Name: name, Size: info.Size(), ModifiedAt: time.Now()}, nil
}

func (s *Store) Fetch(ctx context.Context, name, destPath string) error {
	if !backup.ValidFileName(name) {
		return fmt.Errorf("invalid backup file name %q", name)
	}
	request, err := s.newRequest(ctx, http.MethodGet, name, nil)
	if err != nil {
		return err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("webdav GET %s: %w", storage.Redact(name), err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return requestError("GET", response.StatusCode, response.Status, name)
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return fmt.Errorf("create restore staging directory: %w", err)
	}
	file, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create restore staging file: %w", err)
	}
	if _, err := io.Copy(file, response.Body); err != nil {
		_ = file.Close()
		_ = os.Remove(destPath)
		return fmt.Errorf("download backup archive: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close restore staging file: %w", err)
	}
	return nil
}

func (s *Store) Delete(ctx context.Context, name string) error {
	if !backup.ValidFileName(name) {
		return fmt.Errorf("invalid backup file name %q", name)
	}
	response, err := s.send(ctx, http.MethodDelete, name, nil)
	if err != nil {
		return err
	}
	if response.StatusCode == http.StatusNotFound {
		return fmt.Errorf("backup file %q does not exist", name)
	}
	if err := requestError("DELETE", response.StatusCode, response.Status, name); err != nil {
		return err
	}
	return nil
}

// Probe 验证这个位置当下真的能用：目录存在，并且能上传、能删除。
// 很多网盘的 WebDAV 是只读挂载，提前发现比等到备份时失败要好。
func (s *Store) Probe(ctx context.Context) error {
	// 和本机备份目录一样，远程目录也必须是已经存在的集合。
	if _, err := s.reader.StatRoot(ctx); err != nil {
		return err
	}
	name := fmt.Sprintf(".javboss-write-test-%d", time.Now().UnixNano())
	payload := []byte("javboss")
	request, err := s.newRequest(ctx, http.MethodPut, name, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.ContentLength = int64(len(payload))
	request.Header.Set("Content-Type", "application/octet-stream")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("webdav PUT %s: %w", storage.Redact(name), err)
	}
	drainAndClose(response)
	if err := requestError("PUT", response.StatusCode, response.Status, name); err != nil {
		return err
	}
	deleteResponse, err := s.send(ctx, http.MethodDelete, name, nil)
	if err != nil {
		return err
	}
	return requestError("DELETE", deleteResponse.StatusCode, deleteResponse.Status, name)
}

func (s *Store) upload(ctx context.Context, name, sourcePath string, size int64) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open upload staging file: %w", err)
	}
	defer source.Close()

	request, err := s.newRequest(ctx, http.MethodPut, name, source)
	if err != nil {
		return err
	}
	request.ContentLength = size
	request.Header.Set("Content-Type", "application/zip")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("webdav PUT %s: %w", storage.Redact(name), err)
	}
	drainAndClose(response)
	return requestError("PUT", response.StatusCode, response.Status, name)
}

// send 发送一个不需要 body 响应的请求。
func (s *Store) send(ctx context.Context, method, remotePath string, body io.Reader) (*http.Response, error) {
	request, err := s.newRequest(ctx, method, remotePath, body)
	if err != nil {
		return nil, err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("webdav %s %s: %w", method, storage.Redact(remotePath), err)
	}
	drainAndClose(response)
	return response, nil
}

// endpoint 构造 remotePath 对应的绝对 URL（不含凭证）。
func (s *Store) endpoint(remotePath string) string {
	u := *s.base
	u.Path = s.base.Path + storage.JoinRemotePath(s.root, remotePath)
	return u.String()
}

func (s *Store) newRequest(ctx context.Context, method, remotePath string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, s.endpoint(remotePath), body)
	if err != nil {
		return nil, err
	}
	if s.conn.Username != "" {
		request.SetBasicAuth(s.conn.Username, s.conn.Password)
	}
	return request, nil
}

// parseBaseURL 把连接 URL 规整成用于拼请求地址的基址。
func parseBaseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("WebDAV URL is required")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse WebDAV URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("WebDAV URL must use http or https")
	}
	if parsed.Host == "" {
		return nil, errors.New("WebDAV URL must include a host")
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	parsed.RawPath = ""
	return parsed, nil
}

// requestError 把非 2xx 状态码翻译成调用方（尤其是 WebDAV 只读挂载）能看懂的错误。
func requestError(action string, statusCode int, status, remotePath string) error {
	if statusCode >= 200 && statusCode < 300 {
		return nil
	}
	redacted := storage.Redact(remotePath)
	switch statusCode {
	case http.StatusUnauthorized:
		return fmt.Errorf("%w: %s", storage.ErrUnauthorized, redacted)
	case http.StatusForbidden, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		// 目录在、但服务器不给写：绝大多数是只读 WebDAV 挂载。
		return fmt.Errorf("%w: webdav %s %s: %s", ErrReadOnly, action, redacted, status)
	case http.StatusNotFound, http.StatusGone, http.StatusConflict:
		// 409 表示上级集合不存在，对用户来说等同于「备份目录不存在」。
		return fmt.Errorf("%w: %s", storage.ErrNotFound, redacted)
	default:
		return fmt.Errorf("webdav %s %s failed: %s", action, redacted, status)
	}
}

// drainAndClose 读完并关闭响应体，让连接可以被复用。
func drainAndClose(response *http.Response) {
	if response == nil || response.Body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
	_ = response.Body.Close()
}
