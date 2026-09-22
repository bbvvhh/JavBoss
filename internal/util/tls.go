package util

import (
	"crypto/x509"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"javboss/internal/common/logging"
)

// crypto/x509 reads CA certificates from a fixed set of paths, and the result is
// cached on first use. That default list is wrong for Android/Termux:
//
//   - /system/etc/security/cacerts is only consulted when the binary was built
//     with GOOS=android; ours is a linux binary, so Go never looks there (on
//     Android 14+ the system CAs also moved to the Conscrypt APEX);
//   - Termux keeps its own bundle under $PREFIX/etc.
//
// The result is an empty root pool and every HTTPS request failing with:
//
//	tls: failed to verify certificate: x509: certificate signed by unknown authority
//
// This file makes sure Go has roots before anything does TLS. Instead of merely
// checking that some path exists, it *parses* the certificates the way Go would
// and falls back to the Termux/Android locations when that yields nothing.

const caBundleEnvVar = "JAVBOSS_CA_BUNDLE"

// minUsefulRoots is how many certificates we expect a working bundle to provide.
// Anything below this counts as broken and triggers the fallback search.
const minUsefulRoots = 20

// standardCACertFiles mirrors crypto/x509's certFiles for linux
// (go/src/crypto/x509/root_linux.go). Go reads the first one it can open.
var standardCACertFiles = []string{
	"/etc/ssl/certs/ca-certificates.crt",                // Debian/Ubuntu/Gentoo etc.
	"/etc/pki/tls/certs/ca-bundle.crt",                  // Fedora/RHEL 6
	"/etc/ssl/ca-bundle.pem",                            // OpenSUSE
	"/etc/pki/tls/cacert.pem",                           // OpenELEC
	"/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // CentOS/RHEL 7
	"/etc/ssl/cert.pem",                                 // Alpine Linux
}

// standardCACertDirs mirrors crypto/x509's certDirectories for linux. Note that
// the Android system directory is deliberately absent: a linux build does not
// read it, which is why it is only offered as a fallback below.
var standardCACertDirs = []string{
	"/etc/ssl/certs",     // SLES10/SLES11
	"/etc/pki/tls/certs", // Fedora/RHEL
}

// termuxRoots are the prefixes Termux uses for $PREFIX.
func termuxRoots() []string {
	roots := make([]string, 0, 2)
	if prefix := strings.TrimSpace(os.Getenv("PREFIX")); prefix != "" {
		roots = append(roots, prefix)
	}
	const fixed = "/data/data/com.termux/files/usr"
	if len(roots) == 0 || roots[0] != fixed {
		roots = append(roots, fixed)
	}
	return roots
}

// fallbackCAFiles lists bundles to try when Go's own locations yield no roots.
func fallbackCAFiles(override string) []string {
	files := make([]string, 0, 8)
	if override != "" {
		files = append(files, override)
	}
	for _, root := range termuxRoots() {
		files = append(files,
			filepath.Join(root, "etc", "tls", "cert.pem"),
			filepath.Join(root, "etc", "ssl", "certs", "ca-certificates.crt"),
			filepath.Join(root, "etc", "ca-certificates.crt"),
		)
	}
	files = append(files,
		// Some Termux setups export a bundle through the Termux packages dir.
		"/data/data/com.termux/files/usr/opt/openssl/certs/ca-certificates.crt",
	)
	return dedupeStrings(files)
}

// fallbackCADirs lists certificate directories to try when Go's own locations
// yield no roots. Pointing SSL_CERT_DIR at them makes Go read them even though
// its built-in list does not mention them.
func fallbackCADirs() []string {
	return []string{
		"/apex/com.android.conscrypt/cacerts", // Android 14+ system roots
		"/system/etc/security/cacerts",        // Android <= 13 system roots
		"/data/misc/keychain/certs-added",     // Android user-trusted CAs
	}
}

// EnsureSystemCertificateBundle makes sure HTTPS verification has roots to work
// with. It returns the path it installed ("" when nothing had to change).
func EnsureSystemCertificateBundle() string {
	if !usesFileCertificateStore() {
		// Windows and macOS read the OS certificate store, not these files.
		return ""
	}

	envFile := strings.TrimSpace(os.Getenv("SSL_CERT_FILE"))
	envDir := strings.TrimSpace(os.Getenv("SSL_CERT_DIR"))
	override := strings.TrimSpace(os.Getenv(caBundleEnvVar))

	// Does what Go would load right now actually contain roots? A file with
	// bytes in it is not enough: an empty or unparsable bundle used to be
	// mistaken for a working one.
	if roots := systemRootCount(envFile, envDir); roots >= minUsefulRoots {
		logging.Info("tls: using the CA bundle the system already provides (%d roots)", roots)
		return ""
	} else if roots > 0 {
		logging.Info("tls: the system CA bundle only provides %d roots; looking for a better one", roots)
	}

	files, dirs := fallbackCAFiles(override), fallbackCADirs()
	for _, path := range files {
		if certificateFileRootCount(path) < minUsefulRoots {
			continue
		}
		// A file takes precedence in Go, so clear the directory override.
		_ = os.Unsetenv("SSL_CERT_DIR")
		_ = os.Setenv("SSL_CERT_FILE", path)
		logging.Info("tls: using the CA bundle at %s", path)
		return path
	}
	for _, path := range dirs {
		if certificateDirRootCount(path) < minUsefulRoots {
			continue
		}
		_ = os.Unsetenv("SSL_CERT_FILE")
		_ = os.Setenv("SSL_CERT_DIR", path)
		logging.Info("tls: using the CA certificates in %s", path)
		return path
	}

	logging.Info(
		"tls: no usable CA bundle found; HTTPS will fail until one is installed. Checked: %s",
		strings.Join(append(append(append([]string{}, standardCACertFiles...), standardCACertDirs...), append(files, dirs...)...), ", "),
	)
	return ""
}

// systemRootCount mirrors x509.loadSystemRoots for the current environment: the
// first readable file from the file list, plus every entry of every directory in
// the directory list.
func systemRootCount(envFile, envDir string) int {
	files := standardCACertFiles
	if envFile != "" {
		files = []string{envFile}
	}
	count := 0
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		count += certificatePEMCount(data)
		break
	}

	dirs := standardCACertDirs
	if envDir != "" {
		dirs = strings.Split(envDir, ":")
	}
	for _, dir := range dirs {
		count += certificateDirRootCount(dir)
	}
	return count
}

func certificateFileRootCount(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	return certificatePEMCount(data)
}

func certificateDirRootCount(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		count += certificatePEMCount(data)
	}
	return count
}

// certificatePEMCount counts the certificates in a PEM blob, treating anything
// unparsable as empty.
func certificatePEMCount(data []byte) int {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return 0
	}
	return len(pool.Subjects())
}

// usesFileCertificateStore reports whether crypto/x509 reads CA certificates
// from files on this platform. Windows uses the system store and macOS uses the
// keychain, so the bundle-probing below would be meaningless there.
func usesFileCertificateStore() bool {
	switch runtime.GOOS {
	case "windows", "darwin":
		return false
	default:
		return true
	}
}
