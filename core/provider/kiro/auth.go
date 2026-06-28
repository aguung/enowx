package kiro

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/enowdev/enowx/core/provider"
	"github.com/enowdev/enowx/core/transport"
)

const ssoOIDCURLTemplate = "https://oidc.%s.amazonaws.com/token"

// authManager holds a single account's tokens and refreshes them on demand.
// It is keyed by account ID inside the provider so refreshes persist.
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
	return am
}

func (am *authManager) profileARN() string {
	am.mu.Lock()
	defer am.mu.Unlock()
	return am.creds["profile_arn"]
}

// token returns a valid access token, refreshing first if expired.
func (am *authManager) token() (string, error) {
	am.mu.Lock()
	tok := am.creds["access_token"]
	expired := !am.expires.IsZero() && time.Now().After(am.expires)
	am.mu.Unlock()

	if tok != "" && !expired {
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
	clientID := am.creds["client_id"]
	clientSecret := am.creds["client_secret"]
	region := am.creds["sso_region"]
	am.mu.Unlock()

	if refreshTok == "" {
		return fmt.Errorf("kiro: no refresh_token")
	}
	if region == "" {
		region = "us-east-1"
	}

	payload := map[string]string{
		"grantType":    "refresh_token",
		"refreshToken": refreshTok,
	}
	if clientID != "" {
		payload["clientId"] = clientID
		payload["clientSecret"] = clientSecret
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf(ssoOIDCURLTemplate, region), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := am.doer.Do(req)
	if err != nil {
		return fmt.Errorf("kiro refresh: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("kiro refresh status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var out struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    int    `json:"expiresIn"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("kiro refresh decode: %w", err)
	}
	if out.AccessToken == "" {
		return fmt.Errorf("kiro refresh: empty accessToken")
	}

	expiresIn := out.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	am.mu.Lock()
	am.creds["access_token"] = out.AccessToken
	if out.RefreshToken != "" {
		am.creds["refresh_token"] = out.RefreshToken
	}
	am.expires = time.Now().Add(time.Duration(expiresIn-60) * time.Second)
	am.creds["expires_at"] = am.expires.Format(time.RFC3339)
	snapshot := make(map[string]string, len(am.creds))
	maps.Copy(snapshot, am.creds)
	am.mu.Unlock()

	if am.save != nil {
		am.save(am.id, snapshot)
	}
	return nil
}

func (am *authManager) headers(token string) map[string]string {
	h := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/x-amz-json-1.1",
	}
	if arn := am.profileARN(); arn != "" {
		h["x-amzn-codewhisperer-profilearn"] = arn
	}
	return h
}
