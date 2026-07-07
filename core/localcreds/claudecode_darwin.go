//go:build darwin

package localcreds

import (
	"os/exec"
	"os/user"
	"strings"
)

// readClaudeKeychain reads the Claude Code OAuth blob from the macOS login
// keychain via `security`.
func readClaudeKeychain() ([]byte, bool) {
	out, err := exec.Command("security", "find-generic-password", "-s", claudeKeychainService, "-w").Output()
	if err != nil {
		return nil, false
	}
	b := []byte(strings.TrimSpace(string(out)))
	if len(b) == 0 {
		return nil, false
	}
	return b, true
}

// writeClaudeKeychain upserts the Claude Code OAuth blob into the macOS login
// keychain (-U updates an existing entry).
func writeClaudeKeychain(blob []byte) error {
	acct := "enowx"
	if u, err := user.Current(); err == nil && u.Username != "" {
		acct = u.Username
	}
	return exec.Command("security", "add-generic-password",
		"-U", "-s", claudeKeychainService, "-a", acct, "-w", string(blob)).Run()
}
