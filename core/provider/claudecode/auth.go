package claudecode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const (
	// oauthTokenURL refreshes a Claude Code subscription token.
	oauthTokenURL = "https://api.anthropic.com/v1/oauth/token"
	// oauthClientID is the public Claude Code OAuth client id (not a secret; it's
	// the same value the CLI ships and is required on the refresh call).
	oauthClientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
	// refreshWindow refreshes a token this long before it actually expires.
	refreshWindow = 5 * time.Minute
)

// authManager holds one account's tokens and refreshes them on demand.
type authManager struct {
	doer  transport.Doer
	save  CredSaver
	accID int64

	mu      sync.Mutex
	creds   map[string]string
	expires time.Time
}

func newAuthManager(doer transport.Doer, save CredSaver, acc provider.Account) *authManager {
	creds := map[string]string{}
	for k, v := range acc.Creds {
		creds[k] = v
	}
	am := &authManager{doer: doer, save: save, accID: acc.ID, creds: creds}
	if exp := creds["expires_at"]; exp != "" {
		am.expires = parseExpiry(exp)
	}
	return am
}

// token returns a valid access token, refreshing when it's expired or about to.
func (am *authManager) token() (string, error) {
	am.mu.Lock()
	access := am.creds["access_token"]
	soon := am.expires.IsZero() || time.Until(am.expires) < refreshWindow
	am.mu.Unlock()

	if access != "" && !soon {
		return access, nil
	}
	if err := am.refresh(); err != nil {
		// If we still have a token, serve with it and let the upstream decide.
		if access != "" {
			return access, nil
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
		return fmt.Errorf("claudecode: no refresh_token")
	}

	payload, _ := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": refreshTok,
		"client_id":     oauthClientID,
	})
	req, err := http.NewRequest(http.MethodPost, oauthTokenURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := am.doer.Do(req)
	if err != nil {
		return fmt.Errorf("claudecode refresh: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("claudecode refresh status %d: %s", resp.StatusCode, string(raw))
	}

	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("claudecode refresh decode: %w", err)
	}
	if out.AccessToken == "" {
		return fmt.Errorf("claudecode refresh: empty access_token")
	}

	am.mu.Lock()
	am.creds["access_token"] = out.AccessToken
	if out.RefreshToken != "" {
		am.creds["refresh_token"] = out.RefreshToken
	}
	if out.ExpiresIn > 0 {
		am.expires = time.Now().Add(time.Duration(out.ExpiresIn-60) * time.Second)
		am.creds["expires_at"] = fmt.Sprintf("%d", am.expires.UnixMilli())
	}
	saved := map[string]string{}
	for k, v := range am.creds {
		saved[k] = v
	}
	am.mu.Unlock()

	if am.save != nil {
		am.save(am.accID, saved)
	}
	return nil
}

// parseExpiry accepts an RFC3339 timestamp or unix millis (Claude Code stores
// expiresAt as unix millis).
func parseExpiry(s string) time.Time {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	var ms int64
	if _, err := fmt.Sscan(s, &ms); err == nil && ms > 0 {
		return time.UnixMilli(ms)
	}
	return time.Time{}
}
