package localcreds

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// claudeKeychainService is the macOS login-keychain entry Claude Code stores its
// OAuth credential under.
const claudeKeychainService = "Claude Code-credentials"

// claudeCredsFile is the file Claude Code uses on Linux/Windows (and macOS when
// the keychain is unavailable — e.g. inside a terminal profile).
func claudeCredsFile() string {
	if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		return filepath.Join(dir, ".credentials.json")
	}
	return filepath.Join(home(), ".claude", ".credentials.json")
}

// parseClaudeCreds normalizes a Claude Code credential blob ({claudeAiOauth:{…}}
// or the inner object) into enowx's canonical creds map.
func parseClaudeCreds(raw []byte) map[string]string {
	var top map[string]json.RawMessage
	if json.Unmarshal(raw, &top) != nil {
		return nil
	}
	inner := raw
	if o, ok := top["claudeAiOauth"]; ok {
		inner = o
	}
	var o struct {
		AccessToken      string   `json:"accessToken"`
		RefreshToken     string   `json:"refreshToken"`
		ExpiresAt        int64    `json:"expiresAt"`
		Scopes           []string `json:"scopes"`
		SubscriptionType string   `json:"subscriptionType"`
	}
	if json.Unmarshal(inner, &o) != nil || o.AccessToken == "" {
		return nil
	}
	creds := map[string]string{
		"access_token":      o.AccessToken,
		"refresh_token":     o.RefreshToken,
		"subscription_type": o.SubscriptionType,
		"scopes":            strings.Join(o.Scopes, " "),
	}
	if o.ExpiresAt > 0 {
		creds["expires_at"] = fmt.Sprintf("%d", o.ExpiresAt)
	}
	return creds
}

// buildClaudeBlob renders enowx creds back into Claude Code's on-disk/keychain
// JSON shape ({claudeAiOauth:{…}}).
func buildClaudeBlob(creds map[string]string) []byte {
	oauth := map[string]any{
		"accessToken":  creds["access_token"],
		"refreshToken": creds["refresh_token"],
	}
	if v := strings.TrimSpace(creds["subscription_type"]); v != "" {
		oauth["subscriptionType"] = v
	}
	if v := strings.TrimSpace(creds["scopes"]); v != "" {
		oauth["scopes"] = strings.Fields(v)
	}
	if v := strings.TrimSpace(creds["expires_at"]); v != "" {
		var ms int64
		if _, err := fmt.Sscan(v, &ms); err == nil {
			oauth["expiresAt"] = ms
		}
	}
	b, _ := json.Marshal(map[string]any{"claudeAiOauth": oauth})
	return b
}

// writeClaudeCodeAuth writes an account's creds to where Claude Code reads its
// login, cross-platform, so applying an account switches the active Claude login.
// Writes the credentials file when CLAUDE_CONFIG_DIR is set (e.g. inside a
// terminal profile) or on Linux/Windows; on native macOS it also updates the
// login keychain. Returns the target written.
func writeClaudeCodeAuth(creds map[string]string) (string, error) {
	if strings.TrimSpace(creds["access_token"]) == "" || strings.TrimSpace(creds["refresh_token"]) == "" {
		return "", fmt.Errorf("claude code credentials are incomplete")
	}
	blob := buildClaudeBlob(creds)

	// Profile / non-macOS: the file is authoritative.
	if strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")) != "" || runtime.GOOS != "darwin" {
		path := claudeCredsFile()
		if err := writeRawAtomic(path, blob); err != nil {
			return "", err
		}
		return path, nil
	}
	// Native macOS: the keychain is authoritative.
	if err := writeClaudeKeychain(blob); err != nil {
		return "", fmt.Errorf("write keychain: %w", err)
	}
	return "keychain:" + claudeKeychainService, nil
}

// writeRawAtomic writes bytes to path via a temp file + rename (0600).
func writeRawAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// scanClaudeCode detects a local Claude Code login: the keychain on macOS, else
// the credentials file. Returns nil if not logged in.
func scanClaudeCode() *Found {
	// 1) File (Linux/Windows; macOS inside a profile via CLAUDE_CONFIG_DIR).
	if b, err := os.ReadFile(claudeCredsFile()); err == nil {
		if creds := parseClaudeCreds(b); len(creds) > 0 {
			return &Found{Provider: "claudecode", Target: "Claude Code", Path: claudeCredsFile(), Creds: creds}
		}
	}
	// 2) macOS keychain.
	if raw, ok := readClaudeKeychain(); ok {
		if creds := parseClaudeCreds(raw); len(creds) > 0 {
			return &Found{Provider: "claudecode", Target: "Claude Code", Path: "keychain:" + claudeKeychainService, Creds: creds}
		}
	}
	return nil
}
