package server

import (
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
)

const (
	// uiModeCookieName 是「用户显式选择用哪套界面」的 Cookie。
	// 移动端「我的 → 切换到电脑版」也是写它，所以名字必须和前端保持一致。
	uiModeCookieName = "javboss_ui"
	uiModeMobile     = "mobile"
	uiModeDesktop    = "desktop"
	// 一年，与移动端写入的 max-age 对齐。
	uiModeCookieTTL = 365 * 24 * 60 * 60
	mobileUIPrefix  = "/m/"
)

// mobileUserAgentPattern 只用来「猜」。Cookie 才是最终裁决 —— 猜错了用户永远能自救
// （移动端 → 切换到电脑版；PC 端 → 访问 /?mobile=1）。
// iPad 按决策算移动端。
var mobileUserAgentPattern = regexp.MustCompile(
	`(?i)(android|iphone|ipad|ipod|windows phone|blackberry|opera mini|iemobile|mobile)`,
)

// uiStatic 是一次解析好的静态资源布局。空字符串表示对应的前端不存在。
type uiStatic struct {
	desktopRoot  string
	desktopIndex string
	mobileRoot   string
	mobileIndex  string
}

func (ui uiStatic) hasDesktop() bool { return ui.desktopIndex != "" }
func (ui uiStatic) hasMobile() bool  { return ui.mobileIndex != "" }

// NewRouter constructs a gin router with API routes and optional static file serving.
//
// staticDir 是 PC 前端（web/dist），mobileStaticDir 是移动端（web-mobile/dist）。
// 两者都可以为空 —— 为空时对应的界面不提供，且移动端不存在时永远走 PC。
func NewRouter(staticDir, mobileStaticDir string, auth *AuthService) *gin.Engine {
	router := gin.New()
	router.Use(ginLogger(), gin.Recovery(), extensionAPIAccess())
	router.GET("/healthz", handleHealth)
	registerAuthRoutes(router, auth)
	protected := router.Group("/")
	protected.Use(auth.requireAuth())
	registerExtensionRoutes(protected)
	registerProtectedAuthRoutes(protected, auth)
	RegisterRoutes(protected)

	ui := resolveUIStatic(staticDir, mobileStaticDir)
	if ui.hasDesktop() || ui.hasMobile() {
		registerUIRoutes(router, ui)
		describeUIStatic(ui)
	}

	return router
}

// resolveUIStatic 解析两套前端的目录并做符号链接归一，供后续路径逃逸检查使用。
func resolveUIStatic(staticDir, mobileStaticDir string) uiStatic {
	ui := uiStatic{}
	if root, index := resolveStaticRoot(staticDir, "frontend"); index != "" {
		ui.desktopRoot, ui.desktopIndex = root, index
	}
	if root, index := resolveStaticRoot(mobileStaticDir, "mobile frontend"); index != "" {
		ui.mobileRoot, ui.mobileIndex = root, index
	}
	return ui
}

// resolveStaticRoot 校验目录并返回「绝对且已解析符号链接」的根与 index.html 路径。
// 任何不合法的情况都返回空字符串，调用方据此关闭对应的静态服务。
func resolveStaticRoot(dir, label string) (string, string) {
	if dir == "" {
		return "", ""
	}
	fi, err := os.Stat(dir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logging.Error("%s static path check error: %v", label, err)
		}
		return "", ""
	}
	if !fi.IsDir() {
		logging.Error("%s static path %s is not a directory; serving disabled", label, dir)
		return "", ""
	}

	root, absErr := filepath.Abs(dir)
	if absErr != nil {
		logging.Error("resolve %s static path error: %v", label, absErr)
		root = dir
	}
	if resolved, resolveErr := filepath.EvalSymlinks(root); resolveErr == nil {
		root = resolved
	}
	index := filepath.Join(root, "index.html")
	if _, err := os.Stat(index); err != nil {
		logging.Error("%s index %s is unavailable; serving disabled", label, index)
		return "", ""
	}
	return root, index
}

func describeUIStatic(ui uiStatic) {
	if ui.hasDesktop() {
		logging.Info("serving frontend from %s", ui.desktopRoot)
	}
	if ui.hasMobile() {
		logging.Info("serving mobile frontend from %s", ui.mobileRoot)
	} else {
		logging.Info("mobile frontend is unavailable; all requests will use the desktop UI")
	}
}

func registerUIRoutes(router *gin.Engine, ui uiStatic) {
	if ui.hasDesktop() {
		for _, path := range []string{"/", "/index.html"} {
			router.GET(path, ui.handleUIRoot)
			router.HEAD(path, ui.handleUIRoot)
		}
	}
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if isAPIPath(path) {
			respondLocalizedError(c, http.StatusNotFound, "接口不存在", "API endpoint was not found")
			return
		}
		if ui.serveMobileStatic(c) {
			return
		}
		if ui.hasDesktop() {
			if serveStaticFileUnder(c, ui.desktopRoot, "/") {
				return
			}
			if acceptsHTML(c) {
				ui.handleUIRoot(c)
				return
			}
		}
		respondLocalizedError(c, http.StatusNotFound, "请求的资源不存在", "The requested resource was not found")
	})
}

// handleUIRoot 处理「PC 前端的 HTML 入口」，也就是唯一会做界面选择的地方。
//
// 判定优先级（见 design/DESIGN.md §3.2）：
//  1. ?mobile=1 / ?desktop=1  → 写 Cookie 并立刻按它跳转（一次 302 到位，不会来回弹）
//  2. Cookie javboss_ui       → 显式选择，永远优先于 UA
//  3. User-Agent              → 猜
func (ui uiStatic) handleUIRoot(c *gin.Context) {
	if !acceptsHTML(c) {
		// 非导航请求（例如直接抓 /index.html 的脚本）不参与分流。
		serveIndexHTML(c, ui.desktopIndex)
		return
	}

	if mode := requestedUIMode(c); mode != "" {
		setUIModeCookie(c, mode)
		if mode == uiModeMobile && ui.hasMobile() {
			redirectToMobileUI(c)
			return
		}
		serveIndexHTML(c, ui.desktopIndex)
		return
	}

	if ui.hasMobile() && preferMobileUI(c) {
		redirectToMobileUI(c)
		return
	}
	serveIndexHTML(c, ui.desktopIndex)
}

// serveMobileStatic 处理 /m 与 /m/*。返回 true 表示已经写过响应。
func (ui uiStatic) serveMobileStatic(c *gin.Context) bool {
	path := c.Request.URL.Path
	if path == "/m" {
		target := mobileUIPrefix
		if raw := c.Request.URL.RawQuery; raw != "" {
			target += "?" + raw
		}
		c.Redirect(http.StatusMovedPermanently, target)
		return true
	}
	if !strings.HasPrefix(path, mobileUIPrefix) {
		return false
	}
	if !ui.hasMobile() {
		respondLocalizedError(c, http.StatusNotFound, "移动端界面未安装", "The mobile frontend is not installed")
		return true
	}
	if serveStaticFileUnder(c, ui.mobileRoot, mobileUIPrefix) {
		return true
	}
	if acceptsHTML(c) {
		// 移动端是纯 SPA、没有路由，任何未命中的路径都回到同一个入口。
		serveIndexHTML(c, ui.mobileIndex)
		return true
	}
	respondLocalizedError(c, http.StatusNotFound, "请求的资源不存在", "The requested resource was not found")
	return true
}

// preferMobileUI 在 Cookie 与 UA 之间做最终裁决。
func preferMobileUI(c *gin.Context) bool {
	switch strings.ToLower(uiModeCookie(c)) {
	case uiModeDesktop:
		return false
	case uiModeMobile:
		return true
	}
	return isMobileUserAgent(c.GetHeader("User-Agent"))
}

func uiModeCookie(c *gin.Context) string {
	value, err := c.Cookie(uiModeCookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

// requestedUIMode 读 ?mobile=1 / ?desktop=1。两者同时出现时 desktop 优先（更保守）。
func requestedUIMode(c *gin.Context) string {
	query := c.Request.URL.Query()
	if queryFlag(query.Get("desktop")) {
		return uiModeDesktop
	}
	if queryFlag(query.Get("mobile")) {
		return uiModeMobile
	}
	return ""
}

func queryFlag(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// setUIModeCookie 记住用户的显式选择。与移动端前端写的是同一个 Cookie 名与有效期。
func setUIModeCookie(c *gin.Context, mode string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(uiModeCookieName, mode, uiModeCookieTTL, "/", "", false, false)
}

// redirectToMobileUI 跳到移动端，并保留原始路径与查询串（去掉切换参数本身）。
// 保留路径是为了让将来移动端加上路由后不用改这里；现在 /m/* 一律回落同一个入口。
func redirectToMobileUI(c *gin.Context) {
	target := mobileUIPrefix
	rest := strings.TrimPrefix(c.Request.URL.Path, "/")
	if rest != "" && !strings.EqualFold(rest, "index.html") {
		target += rest
	}
	if query := mobileRedirectQuery(c.Request.URL.Query()); query != "" {
		target += "?" + query
	}
	// 302 且带 Set-Cookie，必须禁止缓存，否则代理可能把跳转缓存给别的设备。
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	c.Header("Vary", "User-Agent, Cookie")
	c.Redirect(http.StatusFound, target)
}

func mobileRedirectQuery(values url.Values) string {
	values.Del("mobile")
	values.Del("desktop")
	return values.Encode()
}

func isMobileUserAgent(userAgent string) bool {
	if strings.TrimSpace(userAgent) == "" {
		return false
	}
	return mobileUserAgentPattern.MatchString(userAgent)
}

func acceptsHTML(c *gin.Context) bool {
	return strings.Contains(c.GetHeader("Accept"), "text/html")
}

func isAPIPath(path string) bool {
	for _, prefix := range []string{
		"/auth",
		"/config",
		"/directories",
		"/downloader",
		"/downloads",
		"/extension",
		"/healthz",
		"/jav",
		"/storage",
		"/subtitles",
		"/sync",
		"/tags",
		"/tools",
		"/videos",
	} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// serveStaticFileUnder 从 root 下按 urlPrefix 提供静态文件。
// prefix 为 "/" 时等价于原来的 serveFrontendStaticFile（PC 前端）。
func serveStaticFileUnder(c *gin.Context, root, urlPrefix string) bool {
	if root == "" {
		return false
	}
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return false
	}

	relativePath := strings.TrimPrefix(c.Request.URL.Path, urlPrefix)
	if !fs.ValidPath(relativePath) || relativePath == "." || strings.Contains(relativePath, `\`) {
		return false
	}

	filePath, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(relativePath)))
	if err != nil {
		return false
	}
	relativeToRoot, err := filepath.Rel(root, filePath)
	if err != nil || relativeToRoot == ".." || strings.HasPrefix(relativeToRoot, ".."+string(filepath.Separator)) {
		return false
	}
	info, err := os.Stat(filePath)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}

	if strings.EqualFold(filepath.Ext(filePath), ".webmanifest") {
		c.Header("Content-Type", "application/manifest+json")
	}
	c.File(filePath)
	return true
}

func serveIndexHTML(c *gin.Context, indexPath string) {
	data, err := os.ReadFile(indexPath)
	if err != nil {
		logging.Error("read frontend index error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "前端页面暂不可用", "The frontend is unavailable")
		return
	}
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	// 同一个 URL 会因为 UA / Cookie 返回不同界面，必须声明。
	c.Header("Vary", "User-Agent, Cookie")
	if c.Request.Method == http.MethodHead {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Status(http.StatusOK)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

func ginLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logging.Info("%s %s %d %dB %s", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), c.Writer.Size(), time.Since(start))
	}
}
