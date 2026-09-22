package util

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"
)

const (
	termuxPrefix = "/data/data/com.termux/files/usr"
	apexCADir    = "/apex/com.android.conscrypt/cacerts"
)

// selfSignedPEM builds a minimal, valid certificate so the counting logic can be
// tested against real PEM data.
func selfSignedPEM(t *testing.T) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "javboss.test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestCertificatePEMCount(t *testing.T) {
	if got := certificatePEMCount([]byte("this is not a certificate")); got != 0 {
		t.Fatalf("certificatePEMCount(garbage) = %d, want 0", got)
	}
	cert := selfSignedPEM(t)
	if got := certificatePEMCount(cert); got != 1 {
		t.Fatalf("certificatePEMCount(one cert) = %d, want 1", got)
	}
	if got := certificatePEMCount(append(append([]byte{}, cert...), cert...)); got != 1 {
		// The same certificate twice still counts once (the pool deduplicates).
		t.Fatalf("certificatePEMCount(duplicate cert) = %d, want 1 (deduplicated)", got)
	}
}

func TestCertificateFileCountsReadRealFiles(t *testing.T) {
	dir := t.TempDir()
	bundle := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(bundle, selfSignedPEM(t), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := certificateFileRootCount(bundle); got != 1 {
		t.Fatalf("certificateFileRootCount = %d, want 1", got)
	}
	if got := certificateFileRootCount(filepath.Join(dir, "missing.pem")); got != 0 {
		t.Fatalf("certificateFileRootCount(missing) = %d, want 0", got)
	}
	if got := certificateDirRootCount(dir); got != 1 {
		t.Fatalf("certificateDirRootCount = %d, want 1", got)
	}
	if got := certificateDirRootCount(filepath.Join(dir, "nope")); got != 0 {
		t.Fatalf("certificateDirRootCount(missing) = %d, want 0", got)
	}
}

// This is the bug that made "tls: using the system CA bundle" appear while the
// root pool was actually empty: a bundle file full of bytes that holds no
// certificate. The count must come from parsing, not from file size.
func TestUnparsableStandardBundleIsNotAccepted(t *testing.T) {
	dir := t.TempDir()
	empty := filepath.Join(dir, "ca-certificates.crt")
	if err := os.WriteFile(empty, []byte("# no certificates here\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := certificateFileRootCount(empty); got != 0 {
		t.Fatalf("a bundle without certificates must count as 0, got %d", got)
	}
	if got := systemRootCount(empty, ""); got != 0 {
		t.Fatalf("systemRootCount must ignore an empty bundle, got %d", got)
	}
}

func TestSystemRootCountUsesExplicitEnvironment(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "custom.pem")
	if err := os.WriteFile(file, selfSignedPEM(t), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := systemRootCount(file, ""); got != 1 {
		t.Fatalf("systemRootCount(SSL_CERT_FILE) = %d, want 1", got)
	}
	if runtime.GOOS == "windows" {
		// Go splits SSL_CERT_DIR on ":" (OpenSSL semantics), which cannot work
		// with Windows drive letters - and this code path is unused there.
		t.Skip("SSL_CERT_DIR is colon-separated, so a Windows path cannot be tested")
	}
	// SSL_CERT_DIR replaces the directory list entirely, exactly like Go does.
	if got := systemRootCount("", dir); got < 1 {
		t.Fatalf("systemRootCount(SSL_CERT_DIR) = %d, want >= 1", got)
	}
}

func TestFallbackCandidatesCoverTermuxAndAndroid(t *testing.T) {
	t.Setenv("PREFIX", "/custom/prefix")
	files := fallbackCAFiles("")
	if !slices.Contains(files, filepath.Join("/custom/prefix", "etc", "tls", "cert.pem")) {
		t.Fatalf("$PREFIX was ignored: %v", files)
	}
	if !slices.Contains(files, filepath.Join(termuxPrefix, "etc", "tls", "cert.pem")) {
		t.Fatalf("the fixed Termux path must stay as a fallback: %v", files)
	}
	if dirs := fallbackCADirs(); !slices.Contains(dirs, apexCADir) {
		t.Fatalf("the Android APEX directory is missing: %v", dirs)
	}
}

// Windows/macOS read the OS certificate store, so the file probing must be a
// complete no-op there (otherwise we would set SSL_CERT_FILE for nothing).
func TestEnsureSystemCertificateBundleSkipsPlatformCertificateStores(t *testing.T) {
	if usesFileCertificateStore() {
		t.Skip("this platform reads CA certificates from files")
	}
	t.Setenv("SSL_CERT_FILE", "")
	t.Setenv("SSL_CERT_DIR", "")
	t.Setenv("JAVBOSS_CA_BUNDLE", "")
	if got := EnsureSystemCertificateBundle(); got != "" {
		t.Fatalf("EnsureSystemCertificateBundle() = %q, want a no-op", got)
	}
}
