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

// Result reports what Apply did, so the caller can inform the user (e.g. that the
// binary was migrated to a per-user path).
type Result struct {
	MigratedTo string // new path if the binary was moved off a system dir, else ""
	Note       string // human-facing note about the migration, if any
}

// Apply downloads assetURL (verifying against shaURL when present), then spawns
// the detached updater and returns. The caller should exit shortly after so the
// updater can replace the binary.
func Apply(doer transport.Doer, assetURL, shaURL string) (Result, error) {
	var res Result
	if assetURL == "" {
		return res, fmt.Errorf("no download available for this platform")
	}
	self, err := os.Executable()
	if err != nil {
		return res, fmt.Errorf("locate self: %w", err)
	}
	self, _ = filepath.EvalSymlinks(self)

	// Where the new binary will live. If the current location isn't writable
	// (installed system-wide, e.g. /usr/local/bin — needs sudo), migrate to the
	// per-user dir (~/.local/bin) so this and every future update need no sudo.
	// The old system binary is turned into a shim that forwards to the new one, so
	// callers hitting the old PATH entry still run the updated enx.
	dir := filepath.Dir(self)
	target := self          // where the new binary is installed
	migrating := false      // true when we moved to a new dir
	if !writable(dir) {
		home, _ := os.UserHomeDir()
		newDir := filepath.Join(home, ".local", "bin")
		if err := os.MkdirAll(newDir, 0o755); err != nil {
			return res, fmt.Errorf("can't create %s: %w", newDir, err)
		}
		if !writable(newDir) {
			return res, fmt.Errorf("can't self-update: neither %s nor %s is writable", dir, newDir)
		}
		target = filepath.Join(newDir, filepath.Base(self))
		dir = newDir
		migrating = true
		res.MigratedTo = target
		res.Note = "enx was installed system-wide; it's been moved to " + target +
			" so future updates need no sudo. Ensure ~/.local/bin is on your PATH."
	}

	// 1. Download to a temp file next to the target (same volume → atomic move).
	tmp := filepath.Join(dir, ".enx-update.tmp")
	if err := download(doer, assetURL, tmp); err != nil {
		return res, fmt.Errorf("download: %w", err)
	}

	// 2. Verify checksum when a .sha256 is published.
	if shaURL != "" {
		want, err := fetchSHA(doer, shaURL)
		if err == nil && want != "" {
			got, _ := fileSHA(tmp)
			if !strings.EqualFold(got, want) {
				_ = os.Remove(tmp)
				return res, fmt.Errorf("checksum mismatch")
			}
		}
	}
	if runtime.GOOS != "windows" {
		_ = os.Chmod(tmp, 0o755)
	}

	// 3. Spawn the detached updater (waits for us to exit, then swaps + restarts).
	//    When migrating, also leave a shim at the old system path (best-effort).
	oldPath := ""
	if migrating {
		oldPath = self
	}
	if err := spawnUpdater(target, tmp, oldPath); err != nil {
		_ = os.Remove(tmp)
		return res, err
	}
	return res, nil
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
// spawnUpdater writes + launches a detached OS script that: waits for the parent
// (this process) to exit, installs the new binary at target, restarts it, and —
// when oldPath is set (migration off a system dir) — replaces the old binary with
// a shim that forwards to the new one (best-effort; skipped if not writable).
func spawnUpdater(target, tmp, oldPath string) error {
	pid := os.Getpid()
	if runtime.GOOS == "windows" {
		return spawnWindows(target, tmp, oldPath, pid)
	}
	return spawnUnix(target, tmp, oldPath, pid)
}

func spawnUnix(target, tmp, oldPath string, pid int) error {
	// Shim step: only when migrating and the old path is writable (no sudo). The
	// shim execs the new binary so anyone still hitting the old PATH entry runs it.
	shim := ""
	if oldPath != "" && oldPath != target {
		shim = fmt.Sprintf(`
if [ -w "%s" ] || [ -w "$(dirname "%s")" ]; then
  printf '#!/bin/sh\nexec "%s" "$@"\n' > "%s"   # replace old binary with a forwarding shim
  chmod +x "%s"
fi`, oldPath, oldPath, target, oldPath, oldPath)
	}
	script := filepath.Join(filepath.Dir(target), ".enx-update.sh")
	body := fmt.Sprintf(`#!/bin/sh
# Wait for the running enx (pid %d) to exit.
for i in $(seq 1 100); do
  kill -0 %d 2>/dev/null || break
  sleep 0.2
done
rm -f "%s"          # delete any old binary at the target first (parity with Windows)
mv "%s" "%s"        # install the new binary
chmod +x "%s"%s
"%s" >/dev/null 2>&1 &   # restart, detached
rm -f "%s"
`, pid, pid, target, tmp, target, target, shim, target, script)
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		return err
	}
	cmd := exec.Command("/bin/sh", script)
	cmd.Stdout, cmd.Stderr = nil, nil
	detach(cmd)
	return cmd.Start()
}

func spawnWindows(target, tmp, oldPath string, pid int) error {
	// Migration shim on Windows: point the old exe location at the new one via a
	// .cmd forwarder (only when migrating and it's a different path).
	shim := ""
	if oldPath != "" && oldPath != target {
		cmdPath := strings.TrimSuffix(oldPath, ".exe") + ".cmd"
		shim = fmt.Sprintf("\nRemove-Item -Force \"%s\"\nSet-Content -Path \"%s\" -Value '@\"%s\" %%*'", oldPath, cmdPath, target)
	}
	script := filepath.Join(filepath.Dir(target), ".enx-update.ps1")
	body := fmt.Sprintf(`$ErrorActionPreference = "SilentlyContinue"
# Wait for the running enx (pid %d) to exit.
for ($i=0; $i -lt 100; $i++) {
  if (-not (Get-Process -Id %d)) { break }
  Start-Sleep -Milliseconds 200
}
Remove-Item -Force "%s"           # delete the old exe first (Windows can't replace a running exe)
Move-Item -Force "%s" "%s"        # install the new exe%s
Start-Process -FilePath "%s"      # restart
Remove-Item -Force "%s"
`, pid, pid, target, tmp, target, shim, target, script)
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
