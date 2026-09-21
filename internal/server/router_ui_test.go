package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const (
	desktopIndexBody = "<!doctype html><html><body>desktop ui</body></html>"
	mobileIndexBody  = "<!doctype html><html><body>mobile ui</body></html>"
	desktopUAAgent   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
	iphoneUAAgent    = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

// writeUIFixture 造出两套可区分的前端目录（index.html 内容不同）。
func writeUIFixture(t *testing.T) (string, string) {
	t.Helper()
	desktopDir := filepath.Join(t.TempDir(), "web")
	mobileDir := filepath.Join(t.TempDir(), "web-mobile")
	writeFixtureFile(t, filepath.Join(desktopDir, "index.html"), desktopIndexBody)
	writeFixtureFile(t, filepath.Join(desktopDir, "assets", "app.js"), "console.log('desktop')")
	writeFixtureFile(t, filepath.Join(mobileDir, "index.html"), mobileIndexBody)
	writeFixtureFile(t, filepath.Join(mobileDir, "assets", "app.js"), "console.log('mobile')")
	return desktopDir, mobileDir
}

func writeFixtureFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

type uiRequest struct {
	path      string
	userAgent string
	accept    string
	cookies   []*http.Cookie
}

func performUIRequest(router http.Handler, req uiRequest) *httptest.ResponseRecorder {
	httpReq := httptest.NewRequest(http.MethodGet, req.path, nil)
	if req.userAgent != "" {
		httpReq.Header.Set("User-Agent", req.userAgent)
	}
	if req.accept != "" {
		httpReq.Header.Set("Accept", req.accept)
	}
	for _, cookie := range req.cookies {
		httpReq.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httpReq)
	return recorder
}

func uiModeCookieFrom(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == uiModeCookieName {
			return cookie
		}
	}
	return nil
}

// TestMobileUserAgentIsRedirectedToMobileUI 覆盖决策链里「UA 猜」的那一层。
// iPad 按决策归移动端，所以也在表里。
func TestMobileUserAgentIsRedirectedToMobileUI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, mobileDir := writeUIFixture(t)
	router := NewRouter(desktopDir, mobileDir, testAuthService(t))

	mobileAgents := map[string]string{
		"iPhone":        iphoneUAAgent,
		"iPad":          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		"Android":       "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
		"Windows Phone": "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) AppleWebKit/537.36 Edge/18.0",
		"BlackBerry":    "Mozilla/5.0 (BlackBerry; U; BlackBerry 9900) AppleWebKit/534.11 Mobile Safari/534.11",
		"Opera Mini":    "Opera/9.80 (J2ME/MIDP; Opera Mini/9.80) Presto/2.12.423 Version/12.16",
		"IEMobile":      "Mozilla/5.0 (compatible; MSIE 9.0; Windows Phone OS 7.5; Trident/5.0; IEMobile/9.0)",
		"Mobile":        "Mozilla/5.0 (Linux; U; en-US) AppleWebKit/533.1 (KHTML, like Gecko) Mobile/9B206",
	}
	for name, agent := range mobileAgents {
		t.Run("mobile/"+name, func(t *testing.T) {
			recorder := performUIRequest(router, uiRequest{
				path:      "/",
				userAgent: agent,
				accept:    "text/html",
			})
			if recorder.Code != http.StatusFound {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusFound)
			}
			if location := recorder.Header().Get("Location"); location != "/m/" {
				t.Fatalf("Location = %q, want /m/", location)
			}
		})
	}

	for name, agent := range map[string]string{
		"desktop chrome": desktopUAAgent,
		"empty":          "",
		"curl":           "curl/8.4.0",
	} {
		t.Run("desktop/"+name, func(t *testing.T) {
			recorder := performUIRequest(router, uiRequest{
				path:      "/",
				userAgent: agent,
				accept:    "text/html",
			})
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if body := recorder.Body.String(); body != desktopIndexBody {
				t.Fatalf("body = %q, want desktop index", body)
			}
		})
	}
}

// TestUICookieOverridesUserAgent 是「猜错了也能自救」的核心保证：
// Cookie 是显式选择，永远优先于 UA，且两个方向都要生效。
func TestUICookieOverridesUserAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, mobileDir := writeUIFixture(t)
	router := NewRouter(desktopDir, mobileDir, testAuthService(t))

	t.Run("iPhone + desktop cookie stays on PC", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/",
			userAgent: iphoneUAAgent,
			accept:    "text/html",
			cookies:   []*http.Cookie{{Name: uiModeCookieName, Value: uiModeDesktop}},
		})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (不应该跳转)", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); body != desktopIndexBody {
			t.Fatalf("body = %q, want desktop index", body)
		}
	})

	t.Run("desktop + mobile cookie goes to mobile", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/",
			userAgent: desktopUAAgent,
			accept:    "text/html",
			cookies:   []*http.Cookie{{Name: uiModeCookieName, Value: uiModeMobile}},
		})
		if recorder.Code != http.StatusFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusFound)
		}
		if location := recorder.Header().Get("Location"); location != "/m/" {
			t.Fatalf("Location = %q, want /m/", location)
		}
	})

	t.Run("PC SPA fallback path also redirects for mobile UA", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/client/route?tag=abc",
			userAgent: iphoneUAAgent,
			accept:    "text/html",
		})
		if recorder.Code != http.StatusFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusFound)
		}
		if location := recorder.Header().Get("Location"); location != "/m/client/route?tag=abc" {
			t.Fatalf("Location = %q, want /m/client/route?tag=abc", location)
		}
	})
}

// TestUIModeSwitchQueryWritesCookie 覆盖 ?desktop=1 / ?mobile=1 这条「手动互切」路径。
func TestUIModeSwitchQueryWritesCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, mobileDir := writeUIFixture(t)
	router := NewRouter(desktopDir, mobileDir, testAuthService(t))

	t.Run("?desktop=1 on a phone serves PC and remembers it", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/?desktop=1",
			userAgent: iphoneUAAgent,
			accept:    "text/html",
		})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); body != desktopIndexBody {
			t.Fatalf("body = %q, want desktop index", body)
		}
		cookie := uiModeCookieFrom(t, recorder)
		if cookie == nil || cookie.Value != uiModeDesktop {
			t.Fatalf("%s cookie = %+v, want desktop", uiModeCookieName, cookie)
		}
		if cookie.MaxAge <= 0 {
			t.Fatalf("cookie MaxAge = %d, want a persistent cookie", cookie.MaxAge)
		}
	})

	t.Run("?mobile=1 on a PC redirects to /m/ and remembers it", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/?mobile=1",
			userAgent: desktopUAAgent,
			accept:    "text/html",
		})
		if recorder.Code != http.StatusFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusFound)
		}
		if location := recorder.Header().Get("Location"); location != "/m/" {
			t.Fatalf("Location = %q, want /m/（切换参数必须被剥掉）", location)
		}
		cookie := uiModeCookieFrom(t, recorder)
		if cookie == nil || cookie.Value != uiModeMobile {
			t.Fatalf("%s cookie = %+v, want mobile", uiModeCookieName, cookie)
		}
	})

	t.Run("?mobile=1 keeps the rest of the query string", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/?mobile=1&tag=abc",
			userAgent: desktopUAAgent,
			accept:    "text/html",
		})
		if location := recorder.Header().Get("Location"); location != "/m/?tag=abc" {
			t.Fatalf("Location = %q, want /m/?tag=abc", location)
		}
	})

	t.Run("no mobile build installed never redirects", func(t *testing.T) {
		pcOnly := NewRouter(desktopDir, "", testAuthService(t))
		for _, path := range []string{"/", "/?mobile=1"} {
			recorder := performUIRequest(pcOnly, uiRequest{
				path:      path,
				userAgent: iphoneUAAgent,
				accept:    "text/html",
			})
			if recorder.Code != http.StatusOK {
				t.Fatalf("%s: status = %d, want %d", path, recorder.Code, http.StatusOK)
			}
			if body := recorder.Body.String(); body != desktopIndexBody {
				t.Fatalf("%s: body = %q, want desktop index", path, body)
			}
		}
	})
}

// TestMobileUIStaticServing 覆盖 /m/ 的静态托管与 SPA 回落。
func TestMobileUIStaticServing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, mobileDir := writeUIFixture(t)
	router := NewRouter(desktopDir, mobileDir, testAuthService(t))

	t.Run("/m redirects to /m/", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{path: "/m", userAgent: desktopUAAgent})
		if recorder.Code != http.StatusMovedPermanently {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusMovedPermanently)
		}
		if location := recorder.Header().Get("Location"); location != "/m/" {
			t.Fatalf("Location = %q, want /m/", location)
		}
	})

	t.Run("/m/ serves the MOBILE index, not the desktop one", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{path: "/m/", accept: "text/html"})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); body != mobileIndexBody {
			t.Fatalf("body = %q, want mobile index", body)
		}
	})

	t.Run("/m/assets serves the mobile asset", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{path: "/m/assets/app.js"})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); body != "console.log('mobile')" {
			t.Fatalf("body = %q, want the mobile asset", body)
		}
	})

	t.Run("/m/<unknown> falls back to the mobile index", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:   "/m/some/deep/route",
			accept: "text/html",
		})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); body != mobileIndexBody {
			t.Fatalf("body = %q, want mobile index", body)
		}
	})

	t.Run("/m/unknown asset is a JSON 404, not HTML", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{path: "/m/assets/missing.js"})
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
		}
		if contentType := recorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
			t.Fatalf("Content-Type = %q, want JSON", contentType)
		}
	})

	t.Run("/m/ cannot escape the mobile root", func(t *testing.T) {
		secretPath := filepath.Join(filepath.Dir(mobileDir), "secret.txt")
		writeFixtureFile(t, secretPath, "top secret")
		for _, accept := range []string{"", "text/html"} {
			recorder := performUIRequest(router, uiRequest{path: "/m/../secret.txt", accept: accept})
			if strings.Contains(recorder.Body.String(), "top secret") {
				t.Fatalf("Accept=%q 泄露了移动端根目录之外的文件: %s", accept, recorder.Body.String())
			}
		}
	})
}

// TestMobileUIUnavailableUnderPrefix 保证没装移动端时 /m/ 明确报错，
// 而不是悄悄回落到 PC 的 index（那会让用户在一个假 URL 下看到电脑版界面）。
func TestMobileUIUnavailableUnderPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, _ := writeUIFixture(t)
	router := NewRouter(desktopDir, "", testAuthService(t))

	recorder := performUIRequest(router, uiRequest{path: "/m/", accept: "text/html"})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}
	if body := recorder.Body.String(); strings.Contains(body, "desktop ui") {
		t.Fatalf("body served the desktop index under /m/: %s", body)
	}
}

// TestMobileUADoesNotBreakAPIAccess 是最重要的一条边界：
// 分流只对 HTML 导航请求生效，绝不能影响接口与真实静态资源。
func TestMobileUADoesNotBreakAPIAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	desktopDir, mobileDir := writeUIFixture(t)
	router := NewRouter(desktopDir, mobileDir, testAuthService(t))

	t.Run("real desktop asset is served even for a phone", func(t *testing.T) {
		for _, accept := range []string{"", "text/html"} {
			recorder := performUIRequest(router, uiRequest{
				path:      "/assets/app.js",
				userAgent: iphoneUAAgent,
				accept:    accept,
			})
			if recorder.Code != http.StatusOK {
				t.Fatalf("Accept=%q: status = %d, want %d", accept, recorder.Code, http.StatusOK)
			}
			if body := recorder.Body.String(); body != "console.log('desktop')" {
				t.Fatalf("Accept=%q: body = %q, want the desktop asset", accept, body)
			}
		}
	})

	t.Run("API 404 stays JSON for a phone", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{
			path:      "/videos/does-not-exist",
			userAgent: iphoneUAAgent,
			accept:    "text/html,application/xhtml+xml",
		})
		if recorder.Code == http.StatusFound {
			t.Fatalf("API 路径被重定向到了 %q", recorder.Header().Get("Location"))
		}
		if contentType := recorder.Header().Get("Content-Type"); strings.Contains(contentType, "text/html") {
			t.Fatalf("API 路径返回了 HTML: %s", contentType)
		}
	})

	t.Run("healthz is unaffected", func(t *testing.T) {
		recorder := performUIRequest(router, uiRequest{path: "/healthz", userAgent: iphoneUAAgent})
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if !strings.Contains(recorder.Body.String(), "ok") {
			t.Fatalf("body = %q", recorder.Body.String())
		}
	})
}
