package storage

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"javboss/internal/common/logging"
	"javboss/internal/util"
)

const (
	// webdavPropfindTimeout bounds a single PROPFIND. Depth-1 listings on slow
	// servers can take a while, but a hung request must not stall a scan forever.
	webdavPropfindTimeout = 90 * time.Second
	// webdavMaxDepth guards against pathological or looping remote trees.
	webdavMaxDepth = 64
)

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>` +
	`<d:propfind xmlns:d="DAV:"><d:prop>` +
	`<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/>` +
	`</d:prop></d:propfind>`

// WebDAV reads a remote WebDAV collection as a read-only video root.
type WebDAV struct {
	conn   Connection
	root   string
	base   *url.URL
	client *http.Client
}

// NewWebDAV builds a backend for one WebDAV connection and remote root path.
func NewWebDAV(conn Connection, remoteRoot string) (*WebDAV, error) {
	base, err := parseWebDAVBaseURL(conn.URL)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{
		Proxy: util.DetectProxyFunc(),
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 5 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		// Ranges and transcoding rely on byte-exact transfers.
		DisableCompression: true,
	}
	return &WebDAV{
		conn: conn,
		root: NormalizeRemotePath(remoteRoot),
		base: base,
		// No client timeout: media reads are long-lived. PROPFIND applies its own
		// context deadline instead.
		client: &http.Client{Transport: transport},
	}, nil
}

func parseWebDAVBaseURL(raw string) (*url.URL, error) {
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

func (b *WebDAV) Kind() string { return KindWebDAV }

func (b *WebDAV) Root() string { return b.root }

// Connection returns the connection this backend was built from.
func (b *WebDAV) Connection() Connection { return b.conn }

// endpoint builds the absolute request URL for a remote path (no credentials).
func (b *WebDAV) endpoint(remotePath string) string {
	u := *b.base
	u.Path = b.base.Path + NormalizeRemotePath(remotePath)
	return u.String()
}

// MediaPath embeds credentials so ffprobe/ffmpeg/mpv can fetch the file directly.
func (b *WebDAV) MediaPath(relPath string) string {
	u := *b.base
	u.Path = b.base.Path + JoinRemotePath(b.root, relPath)
	if b.conn.Username != "" {
		u.User = url.UserPassword(b.conn.Username, b.conn.Password)
	}
	return u.String()
}

func (b *WebDAV) StatRoot(ctx context.Context) (Entry, error) {
	entries, err := b.propfindEntries(ctx, b.root, "0")
	if err != nil {
		return Entry{}, err
	}
	if len(entries) == 0 {
		return Entry{}, MissingPathError(b.root)
	}
	if !entries[0].IsDir {
		return Entry{}, fmt.Errorf("WebDAV path %q is not a collection", b.root)
	}
	return entries[0], nil
}

func (b *WebDAV) Stat(ctx context.Context, relPath string) (Entry, error) {
	remotePath := JoinRemotePath(b.root, relPath)
	entries, err := b.propfindEntries(ctx, remotePath, "0")
	if err != nil {
		return Entry{}, err
	}
	if len(entries) == 0 {
		return Entry{}, MissingPathError(remotePath)
	}
	entry := entries[0]
	entry.RelPath = CleanRelPath(relPath)
	if entry.RelPath == "" {
		entry.Name = baseName(remotePath)
	}
	return entry, nil
}

// List returns the immediate children of one remote directory.
func (b *WebDAV) List(ctx context.Context, relPath string) ([]Entry, error) {
	remotePath := JoinRemotePath(b.root, relPath)
	entries, err := b.propfindEntries(ctx, remotePath, "1")
	if err != nil {
		return nil, err
	}
	prefix := CleanRelPath(relPath)
	result := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if entry.RelPath == "" {
			continue
		}
		childRel := entry.RelPath
		if prefix != "" {
			childRel = prefix + "/" + entry.RelPath
		}
		entry.RelPath = CleanRelPath(childRel)
		if entry.RelPath == "" {
			continue
		}
		result = append(result, entry)
	}
	return result, nil
}

// Walk lists the remote tree one directory level at a time. Depth-1 PROPFIND is
// used because many WebDAV servers reject Depth: infinity.
func (b *WebDAV) Walk(ctx context.Context, yield func(Entry) error) error {
	return b.walk(ctx, b.root, "", 0, yield)
}

func (b *WebDAV) walk(ctx context.Context, remotePath, relPrefix string, depth int, yield func(Entry) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if depth > webdavMaxDepth {
		return fmt.Errorf("WebDAV tree deeper than %d levels at %s", webdavMaxDepth, remotePath)
	}
	entries, err := b.propfindEntries(ctx, remotePath, "1")
	if err != nil {
		// A directory removed concurrently must not abort the whole scan.
		if errors.Is(err, ErrNotFound) {
			logging.Info("webdav directory disappeared during scan, skip: path=%s", remotePath)
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.RelPath == "" {
			continue
		}
		childRel := CleanRelPath(relPrefix + "/" + entry.RelPath)
		if childRel == "" {
			continue
		}
		if entry.IsDir {
			childRemote := JoinRemotePath(remotePath, entry.RelPath)
			if err := b.walk(ctx, childRemote, childRel, depth+1, yield); err != nil {
				return err
			}
			continue
		}
		entry.RelPath = childRel
		if err := yield(entry); err != nil {
			return err
		}
	}
	return nil
}

func (b *WebDAV) OpenRange(ctx context.Context, relPath string, start, end int64) (RangeReader, error) {
	remotePath := JoinRemotePath(b.root, relPath)
	request, err := b.newRequest(ctx, http.MethodGet, remotePath, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept-Encoding", "identity")
	if start > 0 || end >= 0 {
		request.Header.Set("Range", formatByteRange(start, end))
	}

	response, err := b.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("webdav GET %s: %w", Redact(remotePath), err)
	}
	if err := webdavStatusError(response, remotePath); err != nil {
		return nil, err
	}

	mediaType := strings.TrimSpace(response.Header.Get("Content-Type"))
	if mediaType == "" {
		mediaType = MimeTypeForName(remotePath)
	}

	switch response.StatusCode {
	case http.StatusPartialContent:
		rangeStart, rangeEnd, total := parseContentRange(response.Header.Get("Content-Range"))
		if rangeStart < 0 {
			// Malformed Content-Range: fall back to the requested offsets.
			rangeStart = start
			rangeEnd = end
			total = -1
		}
		if total < 0 {
			if length := response.ContentLength; length > 0 {
				total = rangeStart + length
			}
		}
		return &webdavRangeReader{
			body: response.Body, size: total, start: rangeStart, end: rangeEnd, mediaType: mediaType,
		}, nil
	default:
		// Server ignored the Range header and returned the whole entity.
		if start > 0 {
			if _, err := io.CopyN(io.Discard, response.Body, start); err != nil {
				_ = response.Body.Close()
				return nil, fmt.Errorf("webdav skip to offset %d: %w", start, err)
			}
		}
		total := response.ContentLength
		if total >= 0 {
			total += start
		}
		rangeEnd := end
		if total >= 0 {
			rangeEnd = total - 1
		}
		return &webdavRangeReader{
			body: response.Body, size: total, start: start, end: rangeEnd, mediaType: mediaType,
		}, nil
	}
}

func (b *WebDAV) newRequest(ctx context.Context, method, remotePath string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, b.endpoint(remotePath), body)
	if err != nil {
		return nil, err
	}
	if b.conn.Username != "" {
		request.SetBasicAuth(b.conn.Username, b.conn.Password)
	}
	return request, nil
}

type davRawEntry struct {
	Entry
	Found bool
}

func (b *WebDAV) propfindEntries(ctx context.Context, remotePath, depth string) ([]Entry, error) {
	propfindCtx, cancel := context.WithTimeout(ctx, webdavPropfindTimeout)
	defer cancel()

	request, err := b.newRequest(propfindCtx, "PROPFIND", remotePath, strings.NewReader(propfindBody))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Depth", depth)
	request.Header.Set("Content-Type", "application/xml; charset=utf-8")

	response, err := b.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("webdav PROPFIND %s: %w", Redact(remotePath), err)
	}
	defer response.Body.Close()
	if err := webdavStatusError(response, remotePath); err != nil {
		return nil, err
	}

	payload, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("webdav read PROPFIND response: %w", err)
	}
	var multistatus davMultiStatus
	if err := xml.Unmarshal(payload, &multistatus); err != nil {
		return nil, fmt.Errorf("webdav parse PROPFIND response for %s: %w", Redact(remotePath), err)
	}

	selfPath := ""
	entries := make([]davRawEntry, 0, len(multistatus.Responses))
	for i, item := range multistatus.Responses {
		hrefPath, ok := hrefToPath(item.Href)
		if !ok {
			continue
		}
		if i == 0 {
			selfPath = strings.TrimSuffix(hrefPath, "/")
		}
		rel, ok := b.relativeFromHref(selfPath, remotePath, hrefPath)
		if !ok {
			continue
		}
		prop, found := item.props()
		entry := davRawEntry{Found: found}
		entry.RelPath = rel
		entry.Name = baseName(hrefPath)
		entry.IsDir = prop.ResourceType.IsCollection()
		entry.Size = parseContentLength(prop.ContentLength)
		entry.ModTime = parseLastModified(prop.LastModified)
		entries = append(entries, entry)
	}

	found := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if !entry.Found && !entry.IsDir {
			continue
		}
		found = append(found, entry.Entry)
	}
	return found, nil
}

// relativeFromHref maps a PROPFIND href to a path relative to the requested
// directory. Servers disagree about whether hrefs include the collection path,
// so several prefixes are attempted before falling back to the last segment.
func (b *WebDAV) relativeFromHref(selfPath, remotePath, hrefPath string) (string, bool) {
	trimmed := strings.TrimSuffix(hrefPath, "/")
	if selfPath != "" {
		if trimmed == selfPath {
			return "", true
		}
		if strings.HasPrefix(trimmed, selfPath+"/") {
			return CleanRelPath(strings.TrimPrefix(trimmed, selfPath+"/")), true
		}
	}
	basePath := strings.TrimSuffix(b.base.Path, "/")
	full := basePath + NormalizeRemotePath(remotePath)
	full = strings.TrimSuffix(full, "/")
	if full != "" {
		if trimmed == full {
			return "", true
		}
		if strings.HasPrefix(trimmed, full+"/") {
			return CleanRelPath(strings.TrimPrefix(trimmed, full+"/")), true
		}
	}
	// Last resort for depth-1 listings from servers that rewrite hrefs.
	if selfPath == "" || strings.Count(strings.TrimPrefix(trimmed, selfPath), "/") <= 1 {
		segment := baseName(trimmed)
		if segment == "" {
			return "", false
		}
		logging.Info("webdav href did not match collection path, using last segment: href=%s base=%s", Redact(hrefPath), Redact(selfPath))
		return segment, true
	}
	return "", false
}

func (r davResponse) props() (davProp, bool) {
	for _, propstat := range r.Propstat {
		status := strings.TrimSpace(propstat.Status)
		if status == "" || strings.Contains(status, " 200 ") {
			return propstat.Prop, true
		}
	}
	return davProp{}, false
}

type davMultiStatus struct {
	Responses []davResponse `xml:"response"`
}

type davResponse struct {
	Href     string        `xml:"href"`
	Propstat []davPropstat `xml:"propstat"`
}

type davPropstat struct {
	Status string  `xml:"status"`
	Prop   davProp `xml:"prop"`
}

type davProp struct {
	ResourceType  davResourceType `xml:"resourcetype"`
	ContentLength string          `xml:"getcontentlength"`
	LastModified  string          `xml:"getlastmodified"`
	ContentType   string          `xml:"getcontenttype"`
}

// davResourceType reads the raw children so any namespace prefix works.
type davResourceType struct {
	Inner string `xml:",innerxml"`
}

func (rt davResourceType) IsCollection() bool {
	return strings.Contains(rt.Inner, "collection")
}

func webdavStatusError(response *http.Response, remotePath string) error {
	switch {
	case response.StatusCode == http.StatusUnauthorized, response.StatusCode == http.StatusForbidden:
		_ = response.Body.Close()
		return fmt.Errorf("%w: %s", ErrUnauthorized, Redact(remotePath))
	case response.StatusCode == http.StatusNotFound, response.StatusCode == http.StatusGone:
		_ = response.Body.Close()
		return MissingPathError(remotePath)
	case response.StatusCode == http.StatusMethodNotAllowed, response.StatusCode == http.StatusNotImplemented:
		_ = response.Body.Close()
		return fmt.Errorf("%w: WebDAV server rejected %s", ErrUnsupported, Redact(remotePath))
	case response.StatusCode >= 400:
		status := response.Status
		_ = response.Body.Close()
		return fmt.Errorf("webdav request failed: %s: %s", status, Redact(remotePath))
	}
	return nil
}

// hrefToPath converts a PROPFIND href into a decoded URL path.
func hrefToPath(href string) (string, bool) {
	href = strings.TrimSpace(href)
	if href == "" {
		return "", false
	}
	parsed, err := url.Parse(href)
	if err != nil {
		return href, true
	}
	path := parsed.Path
	if path == "" {
		path = parsed.Opaque
	}
	if path == "" {
		return "", false
	}
	return path, true
}

func baseName(p string) string {
	p = strings.TrimSuffix(strings.TrimSpace(p), "/")
	if p == "" {
		return ""
	}
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		return p[idx+1:]
	}
	return p
}

func parseContentLength(raw string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

var davTimeLayouts = []string{
	http.TimeFormat,
	time.RFC1123,
	time.RFC1123Z,
	"Mon, 2 Jan 2006 15:04:05 GMT",
	"Mon, 2 Jan 2006 15:04:05 -0700",
	time.RFC3339,
}

func parseLastModified(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	if parsed, err := http.ParseTime(raw); err == nil {
		return parsed.UTC()
	}
	for _, layout := range davTimeLayouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func formatByteRange(start, end int64) string {
	if start < 0 {
		start = 0
	}
	if end < 0 {
		return fmt.Sprintf("bytes=%d-", start)
	}
	return fmt.Sprintf("bytes=%d-%d", start, end)
}

// parseContentRange parses "bytes 0-1023/123456". Missing total yields -1 and
// malformed input yields start -1.
func parseContentRange(raw string) (int64, int64, int64) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return -1, -1, -1
	}
	raw = strings.TrimSpace(strings.TrimPrefix(strings.ToLower(raw), "bytes"))
	rangePart, totalPart, hasTotal := strings.Cut(raw, "/")
	startPart, endPart, ok := strings.Cut(strings.TrimSpace(rangePart), "-")
	if !ok {
		return -1, -1, -1
	}
	start, err := strconv.ParseInt(strings.TrimSpace(startPart), 10, 64)
	if err != nil {
		return -1, -1, -1
	}
	end, err := strconv.ParseInt(strings.TrimSpace(endPart), 10, 64)
	if err != nil {
		return -1, -1, -1
	}
	total := int64(-1)
	if hasTotal {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(totalPart), 10, 64); err == nil {
			total = parsed
		}
	}
	return start, end, total
}

type webdavRangeReader struct {
	body      io.ReadCloser
	size      int64
	start     int64
	end       int64
	mediaType string
}

func (r *webdavRangeReader) Read(p []byte) (int, error) { return r.body.Read(p) }
func (r *webdavRangeReader) Close() error               { return r.body.Close() }
func (r *webdavRangeReader) TotalSize() int64           { return r.size }
func (r *webdavRangeReader) RangeStart() int64          { return r.start }
func (r *webdavRangeReader) RangeEnd() int64            { return r.end }
func (r *webdavRangeReader) ContentType() string        { return r.mediaType }
