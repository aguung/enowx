// Package mitm implements a local transparent HTTPS proxy that intercepts a
// proprietary IDE's hardcoded API endpoint and reroutes it through this gateway.
//
// The IDE can't be pointed at a custom base URL, so we (a) redirect its host to
// 127.0.0.1 via the OS hosts file, (b) terminate TLS locally with a CA we install
// into the system trust store, and (c) rewrite the request to the gateway. This
// is invasive (trust store + hosts file + a privileged :443 listener) and carries
// account-ban risk — it's opt-in and clearly warned in the UI.
package mitm

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	caCommonName = "enx MITM Root CA"
	caFileName   = "rootCA.crt"
	keyFileName  = "rootCA.key"
)

// CA is a self-signed root used to mint per-domain leaf certs on the fly.
type CA struct {
	dir  string
	cert *x509.Certificate
	key  *rsa.PrivateKey
	pem  []byte // the CA cert in PEM (for trust-store install)

	mu    sync.Mutex
	cache map[string]*tlsCertEntry
}

// LoadOrCreateCA loads the CA from dir, generating (and persisting) one if absent
// or expiring within 30 days.
func LoadOrCreateCA(dir string) (*CA, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	ca := &CA{dir: dir, cache: map[string]*tlsCertEntry{}}
	if cert, key, pemBytes, ok := ca.loadExisting(); ok && !expiringSoon(cert) {
		ca.cert, ca.key, ca.pem = cert, key, pemBytes
		return ca, nil
	}
	if err := ca.generate(); err != nil {
		return nil, err
	}
	return ca, nil
}

// PEM returns the CA certificate in PEM form (for installing into the trust store).
func (c *CA) PEM() []byte { return c.pem }

// CertPath / KeyPath are the on-disk locations.
func (c *CA) CertPath() string { return filepath.Join(c.dir, caFileName) }
func (c *CA) KeyPath() string  { return filepath.Join(c.dir, keyFileName) }

func (c *CA) loadExisting() (*x509.Certificate, *rsa.PrivateKey, []byte, bool) {
	certPEM, err := os.ReadFile(c.CertPath())
	if err != nil {
		return nil, nil, nil, false
	}
	keyPEM, err := os.ReadFile(c.KeyPath())
	if err != nil {
		return nil, nil, nil, false
	}
	cb, _ := pem.Decode(certPEM)
	kb, _ := pem.Decode(keyPEM)
	if cb == nil || kb == nil {
		return nil, nil, nil, false
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return nil, nil, nil, false
	}
	key, err := x509.ParsePKCS1PrivateKey(kb.Bytes)
	if err != nil {
		return nil, nil, nil, false
	}
	return cert, key, certPEM, true
}

func (c *CA) generate() error {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: caCommonName, Organization: []string{"enx"}},
		NotBefore:             timeNow().Add(-time.Hour),
		NotAfter:              timeNow().AddDate(10, 0, 0),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := os.WriteFile(c.CertPath(), certPEM, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(c.KeyPath(), keyPEM, 0o600); err != nil {
		return err
	}
	c.cert, c.key, c.pem = cert, key, certPEM
	return nil
}

func expiringSoon(cert *x509.Certificate) bool {
	return timeNow().Add(30 * 24 * time.Hour).After(cert.NotAfter)
}

// timeNow is a seam so tests can pin time; real code uses the wall clock.
var timeNow = time.Now
