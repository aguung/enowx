package mitm

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"time"
)

// tlsCertEntry is a cached leaf cert for one SNI host.
type tlsCertEntry struct {
	cert    *tls.Certificate
	expires time.Time
}

// GetCertificate is the tls.Config callback: it returns (minting + caching on
// first use) a leaf cert for the requested SNI host, signed by our CA.
func (c *CA) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	host := hello.ServerName
	if host == "" {
		host = "localhost"
	}
	c.mu.Lock()
	if e := c.cache[host]; e != nil && timeNow().Before(e.expires) {
		c.mu.Unlock()
		return e.cert, nil
	}
	c.mu.Unlock()

	leaf, err := c.mintLeaf(host)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.cache[host] = &tlsCertEntry{cert: leaf, expires: timeNow().AddDate(1, 0, 0).Add(-24 * time.Hour)}
	c.mu.Unlock()
	return leaf, nil
}

// mintLeaf creates a leaf cert for host (SAN: host + *.host or the IP), signed by
// the CA.
func (c *CA) mintLeaf(host string) (*tls.Certificate, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: host, Organization: []string{"enx"}},
		NotBefore:    timeNow().Add(-time.Hour),
		NotAfter:     timeNow().AddDate(1, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = []net.IP{ip}
	} else {
		tmpl.DNSNames = []string{host, "*." + host}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, c.cert, &key.PublicKey, c.key)
	if err != nil {
		return nil, err
	}
	return &tls.Certificate{
		Certificate: [][]byte{der, c.cert.Raw},
		PrivateKey:  key,
		Leaf:        mustParse(der),
	}, nil
}

func mustParse(der []byte) *x509.Certificate {
	cert, _ := x509.ParseCertificate(der)
	return cert
}
