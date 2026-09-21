// Package subtitle searches online subtitle providers and maintains the
// subtitle files JavBoss keeps in its own data directory.
//
// Only JavBoss' own files are ever written here: downloads land in
// <dataDir>/subtitle/<video_id>/ and the user's media directories are never
// touched.
package subtitle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"javboss/internal/util"
)

// DefaultAPIURL is the built-in Xunlei subtitle search endpoint. `{keyword}` is
// replaced with the URL-escaped search term. A URL without any placeholder gets
// a `name=` query parameter appended instead, so users may configure either
// form.
const DefaultAPIURL = "https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name={keyword}"

const (
	// maxSearchResponseBytes caps the JSON search response we are willing to read.
	maxSearchResponseBytes = 8 << 20
	// MaxSubtitleBytes caps a single subtitle download (subtitles are text; 20 MiB
	// is already far beyond any real file).
	MaxSubtitleBytes int64 = 20 << 20
	searchUserAgent        = "Mozilla/5.0 (compatible; JavBoss)"
)

// ErrSubtitleTooLarge is returned when a downloaded subtitle exceeds MaxSubtitleBytes.
var ErrSubtitleTooLarge = errors.New("subtitle file is too large")

// SearchResult is a single subtitle offered by a provider.
type SearchResult struct {
	Name       string   `json:"name"`
	URL        string   `json:"url"`
	Ext        string   `json:"ext"`
	Languages  []string `json:"languages"`
	DurationMS int64    `json:"duration_ms"`
	SourceID   string   `json:"source_id"`
	ExtraName  string   `json:"extra_name"`
	Score      float64  `json:"score"`
}

// Language returns the joined, human readable language label of a result.
func (r SearchResult) Language() string {
	parts := make([]string, 0, len(r.Languages))
	seen := make(map[string]struct{}, len(r.Languages))
	for _, item := range r.Languages {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		parts = append(parts, value)
	}
	return strings.Join(parts, " / ")
}

// NormalizeAPIURL trims a configured endpoint and falls back to DefaultAPIURL.
func NormalizeAPIURL(apiURL string) string {
	apiURL = strings.TrimSpace(apiURL)
	if apiURL == "" {
		return DefaultAPIURL
	}
	return apiURL
}

// BuildSearchURL renders the configured endpoint template for one keyword.
func BuildSearchURL(apiURL, keyword string) (string, error) {
	template := NormalizeAPIURL(apiURL)
	escaped := url.QueryEscape(strings.TrimSpace(keyword))
	replaced := false
	for _, placeholder := range []string{"{keyword}", "{Keyword}", "{name}", "{Name}", "{kw}", "{}"} {
		if strings.Contains(template, placeholder) {
			template = strings.ReplaceAll(template, placeholder, escaped)
			replaced = true
		}
	}
	if !replaced {
		separator := "?"
		if strings.Contains(template, "?") {
			separator = "&"
		}
		template += separator + "name=" + escaped
	}
	return validateHTTPURL(template, "subtitle API URL")
}

func validateHTTPURL(raw, label string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("%s is invalid: %w", label, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%s must use http or https", label)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("%s is missing a host", label)
	}
	return parsed.String(), nil
}

// Search queries the provider for one keyword.
func Search(ctx context.Context, apiURL, keyword string) ([]SearchResult, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, errors.New("subtitle search keyword is required")
	}
	endpoint, err := BuildSearchURL(apiURL, keyword)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build subtitle search request: %w", err)
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", searchUserAgent)

	resp, err := util.DoRequest(req)
	if err != nil {
		return nil, fmt.Errorf("subtitle search request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("subtitle search failed with status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSearchResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read subtitle search response: %w", err)
	}
	if int64(len(body)) > maxSearchResponseBytes {
		return nil, errors.New("subtitle search response is too large")
	}
	return ParseSearchResponse(body)
}

// ParseSearchResponse decodes the provider payload and drops unusable entries.
func ParseSearchResponse(body []byte) ([]SearchResult, error) {
	var payload struct {
		Code   int             `json:"code"`
		Result string          `json:"result"`
		Data   []searchPayload `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode subtitle search response: %w", err)
	}
	if payload.Code != 0 {
		if strings.TrimSpace(payload.Result) != "" {
			return nil, fmt.Errorf("subtitle search returned code %d (%s)", payload.Code, payload.Result)
		}
		return nil, fmt.Errorf("subtitle search returned code %d", payload.Code)
	}

	results := make([]SearchResult, 0, len(payload.Data))
	seen := make(map[string]struct{}, len(payload.Data))
	for _, item := range payload.Data {
		rawURL := strings.TrimSpace(item.URL)
		name := strings.TrimSpace(item.Name)
		if rawURL == "" || name == "" {
			continue
		}
		if _, err := url.Parse(rawURL); err != nil {
			continue
		}
		sourceID := strings.TrimSpace(item.CID)
		if sourceID == "" {
			sourceID = strings.TrimSpace(item.GCID)
		}
		dedupeKey := sourceID
		if dedupeKey == "" {
			dedupeKey = rawURL
		}
		if _, ok := seen[dedupeKey]; ok {
			continue
		}
		seen[dedupeKey] = struct{}{}

		results = append(results, SearchResult{
			Name:       name,
			URL:        rawURL,
			Ext:        normalizeFormat(item.Ext),
			Languages:  item.Languages,
			DurationMS: int64(item.Duration),
			SourceID:   sourceID,
			ExtraName:  strings.TrimSpace(item.ExtraName),
			Score:      item.Score,
		})
	}
	return results, nil
}

type searchPayload struct {
	GCID      string        `json:"gcid"`
	CID       string        `json:"cid"`
	URL       string        `json:"url"`
	Ext       string        `json:"ext"`
	Name      string        `json:"name"`
	Duration  flexibleInt64 `json:"duration"`
	Languages []string      `json:"languages"`
	Score     float64       `json:"score"`
	ExtraName string        `json:"extra_name"`
}

// flexibleInt64 accepts a JSON number or numeric string, because providers are
// inconsistent about the duration field.
type flexibleInt64 int64

func (value *flexibleInt64) UnmarshalJSON(data []byte) error {
	if value == nil {
		return errors.New("flexibleInt64: nil receiver")
	}
	raw := strings.TrimSpace(string(data))
	if raw == "" || raw == "null" {
		*value = 0
		return nil
	}
	raw = strings.Trim(raw, `"`)
	if raw == "" {
		*value = 0
		return nil
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		*value = 0
		return nil
	}
	*value = flexibleInt64(parsed)
	return nil
}

// Download fetches a subtitle file's bytes, refusing anything oversized.
func Download(ctx context.Context, rawURL string) ([]byte, error) {
	endpoint, err := validateHTTPURL(rawURL, "subtitle URL")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build subtitle download request: %w", err)
	}
	req.Header.Set("Accept", "*/*")
	req.Header.Set("User-Agent", searchUserAgent)

	resp, err := util.DoRequest(req)
	if err != nil {
		return nil, fmt.Errorf("subtitle download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("subtitle download failed with status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxSubtitleBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read subtitle file: %w", err)
	}
	if int64(len(body)) > MaxSubtitleBytes {
		return nil, ErrSubtitleTooLarge
	}
	if len(bytesTrimSpace(body)) == 0 {
		return nil, errors.New("downloaded subtitle file is empty")
	}
	return body, nil
}
