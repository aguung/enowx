package mitm

import (
	"crypto/tls"
	"crypto/x509"
	"testing"
)

// The CA mints a leaf that verifies against the CA, with the right SAN.
func TestCALeafRoundTrip(t *testing.T) {
	ca, err := LoadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatalf("ca: %v", err)
	}
	leaf, err := ca.GetCertificate(&tls.ClientHelloInfo{ServerName: "cloudcode-pa.googleapis.com"})
	if err != nil {
		t.Fatalf("leaf: %v", err)
	}
	roots := x509.NewCertPool()
	caCert, _ := x509.ParseCertificate(ca.cert.Raw)
	roots.AddCert(caCert)
	if _, err := leaf.Leaf.Verify(x509.VerifyOptions{DNSName: "cloudcode-pa.googleapis.com", Roots: roots}); err != nil {
		t.Fatalf("leaf does not verify against CA: %v", err)
	}
	// A wildcard subdomain also verifies.
	if _, err := leaf.Leaf.Verify(x509.VerifyOptions{DNSName: "x.cloudcode-pa.googleapis.com", Roots: roots}); err != nil {
		t.Fatalf("wildcard SAN failed: %v", err)
	}
}

// Leaf certs are cached per SNI.
func TestLeafCache(t *testing.T) {
	ca, _ := LoadOrCreateCA(t.TempDir())
	a, _ := ca.GetCertificate(&tls.ClientHelloInfo{ServerName: "a.com"})
	b, _ := ca.GetCertificate(&tls.ClientHelloInfo{ServerName: "a.com"})
	if a != b {
		t.Fatal("expected cached leaf for same host")
	}
}

// Host routing + interceptable matching.
func TestToolRouting(t *testing.T) {
	tl, ok := toolForHost("cloudcode-pa.googleapis.com")
	if !ok || tl.Key != "antigravity" {
		t.Fatalf("host routing failed: %v %v", ok, tl.Key)
	}
	if !tl.interceptable("/v1beta/models/gemini:streamGenerateContent") {
		t.Fatal("expected chat path to be interceptable")
	}
	if tl.interceptable("/v1/health") {
		t.Fatal("non-chat path should not intercept")
	}
	if _, ok := toolForHost("example.com"); ok {
		t.Fatal("unknown host should not route")
	}
}

// hosts block strip/replace preserves surrounding content.
func TestStripBlock(t *testing.T) {
	in := "127.0.0.1 keep.local\n" + hostsBegin + "\n127.0.0.1 x.com\n" + hostsEnd + "\n10.0.0.1 also.keep\n"
	out := stripBlock(in)
	if want := "keep.local"; !contains(out, want) || contains(out, "x.com") {
		t.Fatalf("strip failed: %q", out)
	}
	if !contains(out, "also.keep") {
		t.Fatal("content after block was lost")
	}
}

// resolveModel: exact, substring, wildcard, passthrough.
func TestResolveModel(t *testing.T) {
	m := New(t.TempDir(), "http://localhost:1430", func() string { return "enx-x" })
	m.SetAliases("antigravity", map[string]string{"gemini-3-pro": "clc/claude-opus-4-8", "flash": "kr/fast"})
	if got := m.resolveModel("antigravity", "gemini-3-pro"); got != "clc/claude-opus-4-8" {
		t.Fatalf("exact: %q", got)
	}
	if got := m.resolveModel("antigravity", "gemini-3-flash-latest"); got != "kr/fast" {
		t.Fatalf("substring: %q", got)
	}
	if got := m.resolveModel("antigravity", "unknown"); got != "" {
		t.Fatalf("passthrough expected, got %q", got)
	}
	m.SetAliases("copilot", map[string]string{"*": "clc/claude-sonnet-5"})
	if got := m.resolveModel("copilot", "anything"); got != "clc/claude-sonnet-5" {
		t.Fatalf("wildcard: %q", got)
	}
}

func contains(s, sub string) bool { return len(s) >= len(sub) && (indexOf(s, sub) >= 0) }
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
