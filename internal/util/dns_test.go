package util

import (
	"errors"
	"reflect"
	"testing"
)

func TestParseNameServers(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    []string
	}{
		{
			name:    "普通条目",
			content: "nameserver 223.5.5.5\nnameserver 119.29.29.29\n",
			want:    []string{"223.5.5.5:53", "119.29.29.29:53"},
		},
		{
			name:    "注释、空行与其它指令",
			content: "# comment\n; another\n\nnameserver 8.8.8.8 # 行尾注释\nsearch lan\noptions timeout:1\n",
			want:    []string{"8.8.8.8:53"},
		},
		{
			name:    "IPv6 与显式端口",
			content: "nameserver ::1\nnameserver [2001:4860:4860::8888]:5353\nnameserver 1.1.1.1:5353\n",
			want:    []string{"[::1]:53", "[2001:4860:4860::8888]:5353", "1.1.1.1:5353"},
		},
		{
			name:    "去重",
			content: "nameserver 1.1.1.1\nnameserver 1.1.1.1\n",
			want:    []string{"1.1.1.1:53"},
		},
		{
			name:    "垃圾内容被忽略",
			content: "nameserver not-an-ip\nnameserver\nfoo bar baz\n",
			want:    []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseNameServers(tc.content)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseNameServers(%q) = %v, want %v", tc.content, got, tc.want)
			}
		})
	}
}

func TestParseDNSServerList(t *testing.T) {
	cases := map[string][]string{
		"223.5.5.5":                        {"223.5.5.5:53"},
		"223.5.5.5, 119.29.29.29":          {"223.5.5.5:53", "119.29.29.29:53"},
		"192.168.1.1:5353":                 {"192.168.1.1:5353"},
		"nameserver 8.8.8.8":               {"8.8.8.8:53"},
		"[2001:4860:4860::8888]:5353":      {"[2001:4860:4860::8888]:5353"},
		"8.8.8.8;1.1.1.1":                  {"8.8.8.8:53", "1.1.1.1:53"},
		"":                                 {},
		"definitely not a dns server host": {},
	}
	for input, want := range cases {
		got := parseDNSServerList(input)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("parseDNSServerList(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestChooseDNSServers(t *testing.T) {
	systemConf := "nameserver 192.168.1.1\nnameserver 2001:4860:4860::8888\n"
	loopbackConf := "nameserver ::1\n"

	cases := []struct {
		name           string
		override       string
		resolvConf     string
		readErr        error
		supportsResolv bool
		wantSource     string
		want           []string
	}{
		{
			name:           "系统配置可用就用系统的",
			resolvConf:     systemConf,
			supportsResolv: true,
			wantSource:     "system",
			want:           []string{"192.168.1.1:53", "[2001:4860:4860::8888]:53"},
		},
		{
			name:           "只有 loopback 时兜底到内置 DNS（proot 的 ::1 场景）",
			resolvConf:     loopbackConf,
			supportsResolv: true,
			wantSource:     "builtin",
			want:           builtinDNSServers,
		},
		{
			name:           "没有 resolv.conf 时兜底（Termux 原生场景）",
			readErr:        errors.New("open /etc/resolv.conf: no such file or directory"),
			supportsResolv: true,
			wantSource:     "builtin",
			want:           builtinDNSServers,
		},
		{
			name:           "Windows 之类的平台交回系统解析器",
			resolvConf:     "",
			supportsResolv: false,
			wantSource:     "system",
			want:           nil,
		},
		{
			name:           "显式配置优先于一切",
			override:       "9.9.9.9, 8.8.4.4",
			resolvConf:     systemConf,
			supportsResolv: true,
			wantSource:     "configured",
			want:           []string{"9.9.9.9:53", "8.8.4.4:53"},
		},
		{
			name:           "显式配置即使是 loopback 也照用（用户明确要求）",
			override:       "127.0.0.1:5353",
			resolvConf:     systemConf,
			supportsResolv: true,
			wantSource:     "configured",
			want:           []string{"127.0.0.1:5353"},
		},
		{
			name:           "Windows 上也可以用显式配置覆盖",
			override:       "223.5.5.5",
			supportsResolv: false,
			wantSource:     "configured",
			want:           []string{"223.5.5.5:53"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, source := chooseDNSServers(tc.override, tc.resolvConf, tc.readErr, tc.supportsResolv)
			if source != tc.wantSource {
				t.Fatalf("source = %q, want %q", source, tc.wantSource)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("servers = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestIsUsableNameServer(t *testing.T) {
	cases := map[string]bool{
		"223.5.5.5:53":   true,
		"192.168.1.1:53": true,
		"127.0.0.1:53":   false,
		"[::1]:53":       false,
		"localhost:53":   false,
		"":               false,
	}
	for server, want := range cases {
		if got := isUsableNameServer(server); got != want {
			t.Fatalf("isUsableNameServer(%q) = %v, want %v", server, got, want)
		}
	}
}

func TestDNSResolverRespectsOverrideAndSystemConfig(t *testing.T) {
	// Explicit override → always a custom resolver.
	SetDNSServer("127.0.0.1:1")
	t.Cleanup(func() { SetDNSServer("") })
	if DNSResolver() == nil {
		t.Fatal("an explicit DNS override must produce a custom resolver")
	}

	// Empty override → back to automatic detection. On Windows (the CI/dev host)
	// that means "no custom resolver"; on Unix it depends on /etc/resolv.conf.
	SetDNSServer("")
	_, source := chooseDNSServers("", "", nil, usesResolvConf())
	resolver := DNSResolver()
	if source == "system" && resolver != nil {
		t.Fatal("a usable system configuration must not be overridden")
	}
	if source != "system" && resolver == nil {
		t.Fatalf("source %q must produce a resolver", source)
	}
}
