package util

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"javboss/internal/common/logging"
)

// Outbound HTTP clients can use a resolver that survives environments where the
// system resolver configuration is missing or useless.
//
// Why this exists: on Unix, Go's own resolver reads /etc/resolv.conf. Android has
// no such file, so a third-party (unpatched) Go binary running in Termux natively
// falls back to the built-in defaults 127.0.0.1:53 / [::1]:53, where nothing
// listens:
//
//	dial tcp: lookup api-shoulei-ssl.xunlei.com on [::1]:53: read udp ...: connection refused
//
// Minimal containers whose /etc/resolv.conf only lists a loopback stub
// (systemd-resolved) fail the same way. Both are fixed by falling back to public
// DNS servers, which need no resolution themselves because they are plain IPs.
//
// Windows is deliberately excluded: Go uses the OS resolver there (not
// /etc/resolv.conf), so its configuration is never "missing".

const (
	dnsDefaultPort  = "53"
	dnsDialTimeout  = 5 * time.Second
	dnsServerEnvVar = "JAVBOSS_DNS"
)

// builtinDNSServers are used when nothing usable can be read from the system.
// AliDNS/Tencent DNS come first because the subtitle and metadata providers live
// in mainland China; Cloudflare is the last resort.
var builtinDNSServers = []string{"223.5.5.5:53", "119.29.29.29:53", "1.1.1.1:53"}

var (
	dnsMu      sync.Mutex
	dnsServers []string
	dnsSource  string
	// dnsOverride holds SetDNSServer's value.
	dnsOverride string
)

// SetDNSServer overrides the resolver used by outbound HTTP clients. Accepted
// forms: "223.5.5.5", "223.5.5.5:53", "8.8.8.8,1.1.1.1". An empty value restores
// automatic detection. Call it before the first HTTP client is created.
func SetDNSServer(value string) {
	dnsMu.Lock()
	defer dnsMu.Unlock()
	dnsOverride = strings.TrimSpace(value)
	dnsServers = nil
	dnsSource = ""
}

// DNSResolver returns a resolver that overrides the system DNS configuration, or
// nil when the system configuration is usable and should be left alone.
func DNSResolver() *net.Resolver {
	servers, source := resolvedDNSServers()
	if source == "system" || len(servers) == 0 {
		return nil
	}
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			dialer := &net.Dialer{Timeout: dnsDialTimeout}
			var lastErr error
			for _, server := range servers {
				conn, err := dialer.DialContext(ctx, network, server)
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr == nil {
				lastErr = errors.New("no DNS server configured")
			}
			return nil, fmt.Errorf("dns: no server reachable (%s): %w", strings.Join(servers, ", "), lastErr)
		},
	}
}

// resolvedDNSServers decides once which servers the resolver should use.
func resolvedDNSServers() ([]string, string) {
	dnsMu.Lock()
	defer dnsMu.Unlock()
	if dnsServers != nil || dnsSource != "" {
		return dnsServers, dnsSource
	}

	override := strings.TrimSpace(os.Getenv(dnsServerEnvVar))
	if dnsOverride != "" {
		override = dnsOverride
	}
	content, readErr := os.ReadFile(resolvConfPath())
	servers, source := chooseDNSServers(override, string(content), readErr, usesResolvConf())
	dnsServers, dnsSource = servers, source
	switch source {
	case "builtin":
		logging.Info(
			"dns: no usable system resolver (%s); falling back to %v",
			describeResolvConfSource(string(content), readErr),
			servers,
		)
	case "configured":
		logging.Info("dns: using configured name servers %v", servers)
	default:
		logging.Info("dns: using the system resolver")
	}
	return dnsServers, dnsSource
}

func resolvConfPath() string {
	return "/etc/resolv.conf"
}

// usesResolvConf reports whether the platform's Go resolver reads
// /etc/resolv.conf. Windows uses the OS API instead.
func usesResolvConf() bool {
	return runtime.GOOS != "windows"
}

// chooseDNSServers is the pure part of the decision, kept separate so every
// branch is testable without touching the real /etc/resolv.conf.
//
// Source meanings: "configured" (explicit override), "system" (leave the default
// resolver alone) and "builtin" (override with public DNS).
func chooseDNSServers(override, resolvConf string, readErr error, supportsResolvConf bool) ([]string, string) {
	if servers := parseDNSServerList(override); len(servers) > 0 {
		return servers, "configured"
	}
	if !supportsResolvConf {
		return nil, "system"
	}
	if readErr == nil {
		usable := make([]string, 0, 4)
		for _, server := range parseNameServers(resolvConf) {
			if isUsableNameServer(server) {
				usable = append(usable, server)
			}
		}
		if len(usable) > 0 {
			return usable, "system"
		}
	}
	return append([]string(nil), builtinDNSServers...), "builtin"
}

func describeResolvConfSource(content string, readErr error) string {
	if readErr != nil {
		return readErr.Error()
	}
	servers := parseNameServers(content)
	if len(servers) == 0 {
		return "no nameserver entries"
	}
	return "only loopback nameservers " + strings.Join(servers, ", ")
}

// parseDNSServerList parses an explicit override: comma or space separated
// entries, with or without the "nameserver" keyword.
func parseDNSServerList(value string) []string {
	servers := make([]string, 0, 4)
	for _, field := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ';'
	}) {
		if server, ok := normalizeNameServer(field); ok {
			servers = append(servers, server)
		}
	}
	return dedupeStrings(servers)
}

// parseNameServers extracts "nameserver" entries from resolv.conf content.
func parseNameServers(content string) []string {
	servers := make([]string, 0, 4)
	for _, rawLine := range strings.Split(content, "\n") {
		line := rawLine
		if index := strings.IndexAny(line, "#;"); index >= 0 {
			line = line[:index]
		}
		fields := strings.Fields(line)
		if len(fields) < 2 || !strings.EqualFold(fields[0], "nameserver") {
			continue
		}
		if server, ok := normalizeNameServer(fields[1]); ok {
			servers = append(servers, server)
		}
	}
	return dedupeStrings(servers)
}

func normalizeNameServer(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if strings.HasPrefix(value, "[") {
		// Bracketed IPv6, optionally with a port: [::1]:53
		if host, port, err := net.SplitHostPort(value); err == nil {
			if net.ParseIP(host) == nil {
				return "", false
			}
			return net.JoinHostPort(host, port), true
		}
		host := strings.TrimSuffix(strings.TrimPrefix(value, "["), "]")
		if net.ParseIP(host) == nil {
			return "", false
		}
		return net.JoinHostPort(host, dnsDefaultPort), true
	}
	if net.ParseIP(value) != nil {
		return net.JoinHostPort(value, dnsDefaultPort), true
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || port == "" || net.ParseIP(host) == nil {
		return "", false
	}
	return net.JoinHostPort(host, port), true
}

// isUsableNameServer rejects loopback entries: in a Termux/container environment
// they point at a resolver that is not running, which is the whole failure mode
// this fallback exists for.
func isUsableNameServer(server string) bool {
	host, _, err := net.SplitHostPort(server)
	if err != nil {
		host = server
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	return !ip.IsLoopback()
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
