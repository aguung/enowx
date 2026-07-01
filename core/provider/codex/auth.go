package codex

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const (
	oauthClientID = "app_EMoamEEZ73f0CkXaXp7hrann"
	oauthTokenURL = "https://auth.openai.com/oauth/token"
	refreshWindow = 5 * time.Minute
)

// authManager holds one account's tokens and refreshes them on demand.
type authManager struct {
	mu      sync.Mutex
	doer    transport.Doer
	save    CredSaver
	id      int64
	creds   map[string]string
	expires time.Time
}

func newAuthManager(doer transport.Doer, save CredSaver, acc provider.Account) *authManager {
	creds := make(map[string]string, len(acc.Creds))
	maps.Copy(creds, acc.Creds)
	am := &authManager{doer: doer, save: save, id: acc.ID, creds: creds}
	if exp := creds["expires_at"]; exp != "" {
		if t, err := time.Parse(time.RFC3339, exp); err == nil {
			am.expires = t
		}
	}
	if am.expires.IsZero() {
		am.expires = jwtExpiry(creds["access_token"])
	}
	return am
}

func (am *authManager) accountID() string {
	am.mu.Lock()
	defer am.mu.Unlock()
	return am.creds["account_id"]
}

// token returns a valid access token, refreshing when it's expired or about to.
func (am *authManager) token() (string, error) {
	am.mu.Lock()
	tok := am.creds["access_token"]
	soon := am.expires.IsZero() || time.Until(am.expires) < refreshWindow
	am.mu.Unlock()

	if tok != "" && !soon {
		return tok, nil
	}
	if err := am.refresh(); err != nil {
		if tok != "" {
			return tok, nil // fall back to the existing token
		}
		return "", err
	}
	am.mu.Lock()
	defer am.mu.Unlock()
	return am.creds["access_token"], nil
}

func (am *authManager) refresh() error {
	am.mu.Lock()
	refreshTok := am.creds["refresh_token"]
	am.mu.Unlock()
	if refreshTok == "" {
		return fmt.Errorf("codex: no refresh_token")
	}

	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshTok},
		"client_id":     {oauthClientID},
	}
	req, err := http.NewRequest(http.MethodPost, oauthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := am.doer.Do(req)
	if err != nil {
		return fmt.Errorf("codex refresh: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("codex refresh status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("codex refresh decode: %w", err)
	}
	if out.AccessToken == "" {
		return fmt.Errorf("codex refresh: empty access_token")
	}

	am.mu.Lock()
	am.creds["access_token"] = out.AccessToken
	if out.RefreshToken != "" {
		am.creds["refresh_token"] = out.RefreshToken
	}
	if out.IDToken != "" {
		am.creds["id_token"] = out.IDToken
	}
	switch {
	case out.ExpiresIn > 0:
		am.expires = time.Now().Add(time.Duration(out.ExpiresIn-60) * time.Second)
	default:
		if t := jwtExpiry(out.AccessToken); !t.IsZero() {
			am.expires = t
		} else {
			am.expires = time.Now().Add(time.Hour)
		}
	}
	am.creds["expires_at"] = am.expires.Format(time.RFC3339)
	snapshot := make(map[string]string, len(am.creds))
	maps.Copy(snapshot, am.creds)
	am.mu.Unlock()

	if am.save != nil {
		am.save(am.id, snapshot)
	}
	return nil
}

// --- JWT helpers (claims only; signature not verified — tokens come from us) ---

func jwtClaims(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var claims map[string]any
	if json.Unmarshal(payload, &claims) != nil {
		return nil
	}
	return claims
}

func jwtExpiry(token string) time.Time {
	claims := jwtClaims(token)
	if exp, ok := claims["exp"].(float64); ok && exp > 0 {
		return time.Unix(int64(exp), 0)
	}
	return time.Time{}
}

func emailFromJWT(token string) string {
	if e, ok := jwtClaims(token)["email"].(string); ok {
		return e
	}
	return ""
}

// accountIDFromJWT digs the ChatGPT account id out of the OpenAI auth claim,
// falling back to the top-level subject.
func accountIDFromJWT(token string) string {
	claims := jwtClaims(token)
	if auth, ok := claims["https://api.openai.com/auth"].(map[string]any); ok {
		for _, k := range []string{"chatgpt_account_id", "chatgpt_account_user_id", "user_id"} {
			if v, ok := auth[k].(string); ok && strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	if sub, ok := claims["sub"].(string); ok {
		return sub
	}
	return ""
}
