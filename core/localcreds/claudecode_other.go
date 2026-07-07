//go:build !darwin

package localcreds

// On Linux/Windows Claude Code stores its credential in a file, not a keychain,
// so these are no-ops (the file path is handled by the cross-platform code).
func readClaudeKeychain() ([]byte, bool) { return nil, false }

func writeClaudeKeychain(blob []byte) error { return nil }
