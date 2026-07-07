// Package updater performs a Windows-safe self-update: it downloads the new
// binary, verifies it, then hands off to a DETACHED helper script that waits for
// this process to exit, deletes the old binary (Windows can't overwrite a running
// exe, so we delete first), installs the new one, and restarts the app.
package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/enowdev/enowx/core/transport"
)

// Apply downloads assetURL (verifying against shaURL when present), then spawns
// the detached updater and returns. The caller should exit shortly after so the
// updater can replace the binary.
func Apply(doer transport.Doer, assetURL, shaURL string) error {
	if assetURL == "" {
		return fmt.Errorf("no download available for this platform")
	}
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate self: %w", err)
	}
	self, _ = filepath.EvalSymlinks(self)

	// 1. Download to a temp file next to the target (same volume → atomic move).
	dir := filepath.Dir(self)
	// Bail early with a clear, actionable message if we can't write here (e.g. enx
	// was installed to /usr/local/bin, which needs sudo). Self-update only works
	// when the binary lives somewhere the user can write.
	if !writable(dir) {
		return fmt.Errorf(
			"can't self-update: %s isn't writable (installed system-wide). "+
				"Reinstall to your home so updates need no sudo:\n"+
				"  curl -fsSL https://raw.githubusercontent.com/enowdev/enowx/main/install.sh | sh\n"+
				"(installs to ~/.local/bin; your config in ~/.enowx is unaffected)", dir)
	}
	tmp := filepath.Join(dir, ".enx-update.tmp")
	if err := download(doer, assetURL, tmp); err != nil {
		return fmt.Errorf("download: %w", err)
	}

	// 2. Verify checksum when a .sha256 is published.
	if shaURL != "" {
		want, err := fetchSHA(doer, shaURL)
		if err == nil && want != "" {
			got, _ := fileSHA(tmp)
			if !strings.EqualFold(got, want) {
				_ = os.Remove(tmp)
				return fmt.Errorf("checksum mismatch")
			}
		}
	}
	if runtime.GOOS != "windows" {
		_ = os.Chmod(tmp, 0o755)
	}

	// 3. Spawn the detached updater (waits for us to exit, then swaps + restarts).
	if err := spawnUpdater(self, tmp); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// writable reports whether we can create files in dir (the real test for
// self-update: can we drop the temp binary + swap it in without sudo).
func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".enx-wtest-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}

func download(doer transport.Doer, url, dest string) error {
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	resp, err := doer.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func fetchSHA(doer transport.Doer, url string) (string, error) {
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	resp, err := doer.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("http %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return strings.Fields(string(b))[0], nil
}

func fileSHA(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// spawnUpdater writes + launches a detached OS script that: waits for the parent
// (this process) to exit, deletes the old binary, moves the new one into place,
// and starts it again.
func spawnUpdater(target, tmp string) error {
	pid := os.Getpid()
	if runtime.GOOS == "windows" {
		return spawnWindows(target, tmp, pid)
	}
	return spawnUnix(target, tmp, pid)
}

func spawnUnix(target, tmp string, pid int) error {
	script := filepath.Join(filepath.Dir(target), ".enx-update.sh")
	body := fmt.Sprintf(`#!/bin/sh
# Wait for the running enx (pid %d) to exit.
for i in $(seq 1 100); do
  kill -0 %d 2>/dev/null || break
  sleep 0.2
done
rm -f "%s"          # delete the old binary first (parity with Windows)
mv "%s" "%s"        # install the new binary
chmod +x "%s"
"%s" >/dev/null 2>&1 &   # restart, detached
rm -f "%s"
`, pid, pid, target, tmp, target, target, target, script)
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		return err
	}
	cmd := exec.Command("/bin/sh", script)
	cmd.Stdout, cmd.Stderr = nil, nil
	detach(cmd)
	return cmd.Start()
}

func spawnWindows(target, tmp string, pid int) error {
	script := filepath.Join(filepath.Dir(target), ".enx-update.ps1")
	body := fmt.Sprintf(`$ErrorActionPreference = "SilentlyContinue"
# Wait for the running enx (pid %d) to exit.
for ($i=0; $i -lt 100; $i++) {
  if (-not (Get-Process -Id %d)) { break }
  Start-Sleep -Milliseconds 200
}
Remove-Item -Force "%s"           # delete the old exe first (Windows can't replace a running exe)
Move-Item -Force "%s" "%s"        # install the new exe
Start-Process -FilePath "%s"      # restart
Remove-Item -Force "%s"
`, pid, pid, target, tmp, target, target, script)
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		return err
	}
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script)
	detach(cmd)
	return cmd.Start()
}

// ExitSoon exits the process after a short delay so the detached updater (which
// is waiting for us to die) can proceed.
func ExitSoon() {
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()
}
