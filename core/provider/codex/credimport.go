package codex

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ParseManualJSON accepts a pasted Codex auth.json (snake_case or camelCase) and
// returns canonical creds. Missing account_id/email are derived from the JWTs.
func ParseManualJSON(s string) (map[string]string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty JSON")
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		return nil, err
	}
	// Codex CLI nests tokens under "tokens"; accept both shapes.
	if t, ok := raw["tokens"].(map[string]any); ok {
		for k, v := range t {
			if _, exists := raw[k]; !exists {
				raw[k] = v
			}
		}
	}
	get := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := raw[k].(string); ok && v != "" {
				return v
			}
		}
		return ""
	}
	access := get("access_token", "accessToken")
	if access == "" {
		return nil, fmt.Errorf("missing access_token")
	}
	creds := credsFromTokens(access, get("refresh_token", "refreshToken"), get("id_token", "idToken"), 0)
	if a := get("account_id", "accountId"); a != "" {
		creds["account_id"] = a
	}
	if e := get("email"); e != "" {
		creds["email"] = e
	}
	// Honor an explicit last_refresh/expires if present, else keep the derived one.
	if exp := get("expires_at", "expiresAt"); exp != "" {
		if _, err := time.Parse(time.RFC3339, exp); err == nil {
			creds["expires_at"] = exp
		}
	}
	return creds, nil
}
