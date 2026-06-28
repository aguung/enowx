package kiro

import (
	"encoding/json"
	"strings"
)

// NormalizeCreds accepts a pasted Kiro auth blob (camelCase from kiro-auth-token
// .json or snake_case) and returns our canonical snake_case credential map.
func NormalizeCreds(raw map[string]any) map[string]string {
	out := map[string]string{}
	get := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := raw[k]; ok {
				if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
		}
		return ""
	}
	set := func(dst string, v string) {
		if v != "" {
			out[dst] = v
		}
	}
	set("access_token", get("access_token", "accessToken"))
	set("refresh_token", get("refresh_token", "refreshToken"))
	set("profile_arn", get("profile_arn", "profileArn"))
	set("sso_region", get("sso_region", "ssoRegion", "region"))
	set("auth_method", get("auth_method", "authMethod"))
	set("client_id", get("client_id", "clientId"))
	set("client_secret", get("client_secret", "clientSecret"))
	set("expires_at", get("expires_at", "expiresAt"))
	set("email", get("email"))
	return out
}

// ParseManualJSON parses a pasted auth JSON string into canonical creds.
func ParseManualJSON(s string) (map[string]string, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(s)), &raw); err != nil {
		return nil, err
	}
	return NormalizeCreds(raw), nil
}
