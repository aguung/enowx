package mitm

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// InstallCA adds the CA to the system trust store so the IDE (and its Electron/
// Node language servers) accept our leaf certs. Per-platform; needs elevated
// privileges. Idempotent.
func (c *CA) InstallCA() error {
	switch runtime.GOOS {
	case "darwin":
		return c.installDarwin()
	case "windows":
		return c.installWindows()
	case "linux":
		return c.installLinux()
	}
	return fmt.Errorf("unsupported platform %q", runtime.GOOS)
}

// UninstallCA removes the CA from the trust store (best-effort).
func (c *CA) UninstallCA() error {
	switch runtime.GOOS {
	case "darwin":
		return run("security", "delete-certificate", "-c", caCommonName, "/Library/Keychains/System.keychain")
	case "windows":
		return run("certutil", "-delstore", "Root", caCommonName)
	case "linux":
		dst := linuxTrustPath()
		if dst != "" {
			_ = os.Remove(dst)
			return linuxUpdateTrust()
		}
	}
	return nil
}

// Trusted reports whether the CA is already in the trust store.
func (c *CA) Trusted() bool {
	switch runtime.GOOS {
	case "darwin":
		return run("security", "find-certificate", "-c", caCommonName, "/Library/Keychains/System.keychain") == nil
	case "windows":
		fp := c.fingerprint()
		return run("certutil", "-verifystore", "Root", fp) == nil
	case "linux":
		dst := linuxTrustPath()
		return dst != "" && fileExists(dst)
	}
	return false
}

func (c *CA) installDarwin() error {
	// Adding to the System keychain needs root — prompt via the native admin
	// dialog. (Deleting a stale copy first is best-effort and non-fatal.)
	return runElevated("security", "add-trusted-cert", "-d", "-r", "trustRoot",
		"-k", "/Library/Keychains/System.keychain", c.CertPath())
}

func (c *CA) installWindows() error {
	return runElevated("certutil", "-addstore", "-f", "Root", c.CertPath())
}

func (c *CA) installLinux() error {
	dst := linuxTrustPath()
	if dst == "" {
		return fmt.Errorf("unsupported Linux trust layout")
	}
	// Copy the cert into the trust anchors dir and refresh the store — both need
	// root, so do it in one elevated shell invocation.
	updater := "update-ca-certificates"
	if _, err := exec.LookPath("update-ca-certificates"); err != nil {
		updater = "update-ca-trust extract"
	}
	script := fmt.Sprintf("mkdir -p %q && cp %q %q && %s",
		filepath.Dir(dst), c.CertPath(), dst, updater)
	return runElevated("sh", "-c", script)
}

// linuxTrustPath returns the CA anchor path for the current distro family, or "".
func linuxTrustPath() string {
	candidates := []string{
		"/usr/local/share/ca-certificates",       // Debian/Ubuntu
		"/etc/pki/ca-trust/source/anchors",       // Fedora/RHEL
		"/etc/ca-certificates/trust-source/anchors", // Arch
	}
	for _, dir := range candidates {
		if dirExists(dir) {
			return filepath.Join(dir, "enx-mitm.crt")
		}
	}
	// Default to the Debian layout even if the dir doesn't exist yet.
	return "/usr/local/share/ca-certificates/enx-mitm.crt"
}

func linuxUpdateTrust() error {
	if _, err := exec.LookPath("update-ca-certificates"); err == nil {
		return run("update-ca-certificates")
	}
	if _, err := exec.LookPath("update-ca-trust"); err == nil {
		return run("update-ca-trust", "extract")
	}
	return nil
}

func (c *CA) fingerprint() string {
	sum := sha1.Sum(c.cert.Raw)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// --- small os helpers ---

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %v: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }
func dirExists(p string) bool  { fi, err := os.Stat(p); return err == nil && fi.IsDir() }
