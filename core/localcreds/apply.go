package localcreds

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SupportsApply reports whether a provider's credentials can be written back to a
// local IDE/CLI auth file.
func SupportsApply(provider string) bool {
	switch provider {
	case "kiro", "codex", "claudecode":
		return true
	}
	return false
}

// Apply writes an account's credentials to the local IDE/CLI auth file for its
// provider and returns the path written. target is "desktop" (default) or "cli"
// (kiro only).
func Apply(provider string, creds map[string]string, target string) (string, error) {
	switch provider {
	case "kiro":
		return writeKiroAuth(creds, target)
	case "codex":
		return writeCodexAuth(creds)
	case "claudecode":
		return writeClaudeCodeAuth(creds)
	}
	return "", fmt.Errorf("apply is only supported for Kiro, Codex, and Claude Code")
}

type kiroAuthFile struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ProfileARN   string `json:"profileArn"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	AuthMethod   string `json:"authMethod,omitempty"`
	Provider     string `json:"provider,omitempty"`
	StartURL     string `json:"startUrl,omitempty"`
	ClientID     string `json:"clientId,omitempty"`
	ClientSecret string `json:"clientSecret,omitempty"`
	Region       string `json:"region,omitempty"`
}

func writeKiroAuth(creds map[string]string, target string) (string, error) {
	access := strings.TrimSpace(creds["access_token"])
	refresh := strings.TrimSpace(creds["refresh_token"])
	profileARN := strings.TrimSpace(creds["profile_arn"])
	if access == "" || refresh == "" {
		return "", fmt.Errorf("kiro credentials are incomplete")
	}

	fileName := "kiro-auth-token.json"
	if strings.EqualFold(strings.TrimSpace(target), "cli") {
		fileName = "kiro-auth-token-cli.json"
	}
	path, err := homeJoin(".aws", "sso", "cache", fileName)
	if err != nil {
		return "", err
	}

	f := kiroAuthFile{
		AccessToken:  access,
		RefreshToken: refresh,
		ProfileARN:   profileARN,
		ExpiresAt:    normalizeTime(creds["expires_at"]),
		AuthMethod:   strings.TrimSpace(creds["auth_method"]),
		Provider:     strings.TrimSpace(creds["provider"]),
		StartURL:     strings.TrimSpace(creds["start_url"]),
		ClientID:     strings.TrimSpace(creds["client_id"]),
		ClientSecret: strings.TrimSpace(creds["client_secret"]),
		Region:       firstNonEmpty(creds["sso_region"], creds["region"]),
	}
	if f.AuthMethod == "" {
		f.AuthMethod = "social"
	}
	if f.Provider == "" {
		switch strings.ToLower(f.AuthMethod) {
		case "builder-id", "idc":
			f.Provider = "AWS"
		case "github":
			f.Provider = "GitHub"
		default:
			f.Provider = "Google"
		}
	}
	if f.Region == "" {
		f.Region = "us-east-1"
	}
	if f.ExpiresAt == "" {
		f.ExpiresAt = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	}
	if err := writeJSONAtomic(path, f); err != nil {
		return "", err
	}
	return path, nil
}

type codexTokens struct {
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	AccountID    string `json:"account_id,omitempty"`
}

type codexAuthFile struct {
	AuthMode     string      `json:"auth_mode"`
	OpenAIAPIKey any         `json:"OPENAI_API_KEY"`
	Tokens       codexTokens `json:"tokens"`
	LastRefresh  string      `json:"last_refresh,omitempty"`
}

func writeCodexAuth(creds map[string]string) (string, error) {
	access := strings.TrimSpace(creds["access_token"])
	refresh := strings.TrimSpace(creds["refresh_token"])
	if access == "" || refresh == "" {
		return "", fmt.Errorf("codex credentials are incomplete")
	}
	path, err := homeJoin(".codex", "auth.json")
	if err != nil {
		return "", err
	}
	f := codexAuthFile{
		AuthMode:     "chatgpt",
		OpenAIAPIKey: nil,
		Tokens: codexTokens{
			AccessToken:  access,
			RefreshToken: refresh,
			IDToken:      strings.TrimSpace(creds["id_token"]),
			AccountID:    codexAccountID(creds),
		},
		LastRefresh: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := writeJSONAtomic(path, f); err != nil {
		return "", err
	}
	return path, nil
}

// codexAccountID resolves the ChatGPT account id from creds or the JWT.
func codexAccountID(creds map[string]string) string {
	if id := strings.TrimSpace(creds["account_id"]); id != "" {
		return id
	}
	for _, tok := range []string{creds["access_token"], creds["id_token"]} {
		claims := jwtClaims(tok)
		if len(claims) == 0 {
			continue
		}
		if auth, _ := claims["https://api.openai.com/auth"].(map[string]any); len(auth) > 0 {
			for _, k := range []string{"chatgpt_account_id", "chatgpt_account_user_id", "user_id"} {
				if v, _ := auth[k].(string); strings.TrimSpace(v) != "" {
					return v
				}
			}
		}
		if v, _ := claims["sub"].(string); strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// --- helpers ---

func homeJoin(parts ...string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(append([]string{home}, parts...)...), nil
}

func writeJSONAtomic(path string, payload any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("prepare auth directory: %w", err)
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
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

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

// normalizeTime returns an RFC3339 timestamp, passing through parseable values.
func normalizeTime(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if _, err := time.Parse(time.RFC3339, v); err == nil {
		return v
	}
	return ""
}

func jwtClaims(token string) map[string]any {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) < 2 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var claims map[string]any
	if json.Unmarshal(raw, &claims) != nil {
		return nil
	}
	return claims
}
